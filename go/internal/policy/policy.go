// Package policy implements PolicyGuard's spending policy: a rolling 24-hour
// limit on how many drops a wallet may send.
//
// The ledger lives here, inside the enclave, rather than on Flare. That is the whole
// security argument: the enclave holds the only signing key, so the enclave's own
// accounting is the only accounting an attacker cannot rewrite. A compromised relayer
// can replay or reorder instructions, but it cannot make the enclave forget what it
// has already approved.
package policy

import (
	"fmt"
	"time"
)

// Decision explains why a payment was approved or refused. It is returned for both
// outcomes because a refusal is a normal, expected answer that the user needs to
// understand — not an error.
type Decision struct {
	// Approved reports whether the payment satisfies the policy.
	Approved bool `json:"approved"`
	// Reason is a human-readable explanation, always populated.
	Reason string `json:"reason"`
	// LimitDrops is the limit that was applied.
	LimitDrops uint64 `json:"limitDrops"`
	// SpentDrops is what the wallet had already spent in the window.
	SpentDrops uint64 `json:"spentDrops"`
	// RemainingDrops is what was left before this request.
	RemainingDrops uint64 `json:"remainingDrops"`
	// RequestedDrops is the amount that was asked for.
	RequestedDrops uint64 `json:"requestedDrops"`
}

// spend is one approved payment, remembered only long enough to age out of the window.
type spend struct {
	at     time.Time
	drops  uint64
	reqID  uint64
	digest string
}

// wallet is the per-wallet policy state.
type wallet struct {
	limitDrops uint64
	spends     []spend
	// handled remembers request ids the enclave has already answered, so a replayed
	// instruction returns the original verdict instead of double-charging the window.
	handled map[uint64]Decision
}

// Engine evaluates spending policy for every wallet the enclave manages.
//
// Engine is not internally synchronised. The extension framework serialises handler
// calls, and the extension holds its own mutex for the concurrent GET /state read, so
// adding a second lock here would only obscure where the real boundary is.
type Engine struct {
	window  time.Duration
	wallets map[uint64]*wallet
}

// NewEngine creates an Engine with the given rolling window.
func NewEngine(window time.Duration) *Engine {
	return &Engine{
		window:  window,
		wallets: make(map[uint64]*wallet),
	}
}

func (e *Engine) get(walletID uint64) *wallet {
	w, ok := e.wallets[walletID]
	if !ok {
		w = &wallet{handled: make(map[uint64]Decision)}
		e.wallets[walletID] = w
	}
	return w
}

// Register creates policy state for a new wallet. The limit starts at zero, which
// denies everything until the owner sets one — a wallet that silently allowed
// unlimited spending between creation and configuration would be the worst possible
// default.
func (e *Engine) Register(walletID uint64) {
	e.get(walletID)
}

// SetLimit updates a wallet's rolling limit.
func (e *Engine) SetLimit(walletID, limitDrops uint64) {
	e.get(walletID).limitDrops = limitDrops
}

// Limit reports the limit currently stored for a wallet.
func (e *Engine) Limit(walletID uint64) uint64 {
	return e.get(walletID).limitDrops
}

// Spent reports how many drops the wallet has spent inside the window ending at now.
func (e *Engine) Spent(walletID uint64, now time.Time) uint64 {
	w := e.get(walletID)
	e.prune(w, now)
	var total uint64
	for _, s := range w.spends {
		total += s.drops
	}
	return total
}

// prune drops spends that have aged out of the window. Trimming on access keeps the
// slice bounded by the number of payments actually made in a day, with no background
// goroutine to reason about inside the enclave.
func (e *Engine) prune(w *wallet, now time.Time) {
	cutoff := now.Add(-e.window)
	keep := w.spends[:0]
	for _, s := range w.spends {
		if s.at.After(cutoff) {
			keep = append(keep, s)
		}
	}
	w.spends = keep
}

// Evaluate decides whether a payment may proceed, without recording it.
//
// onChainLimit is the limit the InstructionSender published with the request. The
// stricter of the two limits wins: if the enclave somehow missed a SET_LIMIT
// instruction, it must not authorise more than the publicly auditable on-chain
// policy allows; and if the chain view is stale or forged upward, the enclave's own
// value still caps it.
func (e *Engine) Evaluate(walletID, amountDrops, onChainLimit uint64, now time.Time) Decision {
	w := e.get(walletID)
	e.prune(w, now)

	limit := effectiveLimit(w.limitDrops, onChainLimit)

	var spent uint64
	for _, s := range w.spends {
		spent += s.drops
	}

	var remaining uint64
	if limit > spent {
		remaining = limit - spent
	}

	d := Decision{
		LimitDrops:     limit,
		SpentDrops:     spent,
		RemainingDrops: remaining,
		RequestedDrops: amountDrops,
	}

	switch {
	case limit == 0:
		d.Reason = "no daily spending limit is configured for this wallet; " +
			"set a limit before requesting payments"

	case amountDrops > remaining:
		d.Reason = fmt.Sprintf(
			"daily limit exceeded: requested %s, but only %s of the %s limit remains "+
				"(%s already spent in the last %s)",
			formatXRP(amountDrops), formatXRP(remaining), formatXRP(limit),
			formatXRP(spent), formatWindow(e.window),
		)

	default:
		d.Approved = true
		d.Reason = fmt.Sprintf(
			"within daily limit: %s of %s remaining after this payment",
			formatXRP(remaining-amountDrops), formatXRP(limit),
		)
	}

	return d
}

// Record commits an approved spend to the window and remembers the verdict against
// the request id.
func (e *Engine) Record(walletID, requestID, amountDrops uint64, digest string, d Decision, now time.Time) {
	w := e.get(walletID)
	if d.Approved {
		w.spends = append(w.spends, spend{at: now, drops: amountDrops, reqID: requestID, digest: digest})
	}
	w.handled[requestID] = d
}

// Handled returns a previously issued verdict for a request id.
//
// Instruction delivery is at-least-once, so the same request can legitimately arrive
// twice. Replaying the stored verdict makes handling idempotent: a duplicate never
// consumes budget a second time, and never flips from approved to refused because the
// window moved on in between.
func (e *Engine) Handled(walletID, requestID uint64) (Decision, bool) {
	d, ok := e.get(walletID).handled[requestID]
	return d, ok
}

// effectiveLimit returns the stricter of the enclave's limit and the chain's, treating
// zero as "unset" rather than as a limit of zero.
func effectiveLimit(enclave, onChain uint64) uint64 {
	switch {
	case enclave == 0:
		return onChain
	case onChain == 0:
		return enclave
	case onChain < enclave:
		return onChain
	default:
		return enclave
	}
}

// dropsPerXRP is the drop denomination of XRP.
const dropsPerXRP = 1_000_000

// formatXRP renders drops as XRP for messages a person will read, trimming trailing
// zeros so "10 XRP" does not print as "10.000000 XRP".
func formatXRP(drops uint64) string {
	whole := drops / dropsPerXRP
	frac := drops % dropsPerXRP
	if frac == 0 {
		return fmt.Sprintf("%d XRP", whole)
	}
	s := fmt.Sprintf("%d.%06d", whole, frac)
	for len(s) > 0 && s[len(s)-1] == '0' {
		s = s[:len(s)-1]
	}
	return s + " XRP"
}

// formatWindow renders the policy window in whole hours where possible.
func formatWindow(d time.Duration) string {
	if d%time.Hour == 0 {
		return fmt.Sprintf("%d hours", int(d/time.Hour))
	}
	return d.String()
}
