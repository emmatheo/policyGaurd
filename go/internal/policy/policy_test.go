package policy

import (
	"strings"
	"testing"
	"time"
)

const (
	xrp  = uint64(1_000_000)
	wid  = uint64(1)
	hour = time.Hour
)

func newEngine() (*Engine, time.Time) {
	e := NewEngine(24 * hour)
	e.Register(wid)
	return e, time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
}

// TestDeniesBeforeLimitIsSet pins the fail-closed default. A freshly created wallet
// with no configured policy must refuse everything, not allow everything.
func TestDeniesBeforeLimitIsSet(t *testing.T) {
	e, now := newEngine()

	d := e.Evaluate(wid, 1*xrp, 0, now)
	if d.Approved {
		t.Fatal("payment approved before any limit was configured")
	}
	if !strings.Contains(d.Reason, "no daily spending limit") {
		t.Errorf("reason %q does not explain that no limit is set", d.Reason)
	}
}

func TestApprovesWithinLimit(t *testing.T) {
	e, now := newEngine()
	e.SetLimit(wid, 10*xrp)

	d := e.Evaluate(wid, 4*xrp, 10*xrp, now)
	if !d.Approved {
		t.Fatalf("payment of 4 XRP refused under a 10 XRP limit: %s", d.Reason)
	}
	if d.RemainingDrops != 10*xrp {
		t.Errorf("remaining before spend = %d, want %d", d.RemainingDrops, 10*xrp)
	}
}

func TestRefusesOverLimit(t *testing.T) {
	e, now := newEngine()
	e.SetLimit(wid, 10*xrp)

	d := e.Evaluate(wid, 25*xrp, 10*xrp, now)
	if d.Approved {
		t.Fatal("payment of 25 XRP approved under a 10 XRP limit")
	}
	if !strings.Contains(d.Reason, "daily limit exceeded") {
		t.Errorf("reason %q does not name the limit breach", d.Reason)
	}
	// The reason has to be usable in a UI, so it must state the numbers involved.
	for _, want := range []string{"25 XRP", "10 XRP"} {
		if !strings.Contains(d.Reason, want) {
			t.Errorf("reason %q omits %q", d.Reason, want)
		}
	}
}

// TestSpendAccumulates covers the case that makes a daily limit meaningful: several
// individually-allowed payments must not add up to more than the cap.
func TestSpendAccumulates(t *testing.T) {
	e, now := newEngine()
	e.SetLimit(wid, 10*xrp)

	first := e.Evaluate(wid, 6*xrp, 10*xrp, now)
	if !first.Approved {
		t.Fatalf("first payment refused: %s", first.Reason)
	}
	e.Record(wid, 1, 6*xrp, "hash1", first, now)

	second := e.Evaluate(wid, 6*xrp, 10*xrp, now.Add(time.Minute))
	if second.Approved {
		t.Fatal("6 + 6 XRP approved under a 10 XRP limit")
	}
	if second.SpentDrops != 6*xrp {
		t.Errorf("spent = %d, want %d", second.SpentDrops, 6*xrp)
	}
	if second.RemainingDrops != 4*xrp {
		t.Errorf("remaining = %d, want %d", second.RemainingDrops, 4*xrp)
	}
}

func TestExactlyAtLimitIsAllowed(t *testing.T) {
	e, now := newEngine()
	e.SetLimit(wid, 10*xrp)

	d := e.Evaluate(wid, 10*xrp, 10*xrp, now)
	if !d.Approved {
		t.Fatalf("a payment exactly equal to the limit was refused: %s", d.Reason)
	}
}

func TestOneDropOverLimitIsRefused(t *testing.T) {
	e, now := newEngine()
	e.SetLimit(wid, 10*xrp)

	if d := e.Evaluate(wid, 10*xrp+1, 10*xrp, now); d.Approved {
		t.Fatal("a payment one drop over the limit was approved")
	}
}

// TestWindowRolls checks that budget is released as spends age out, and — more
// importantly — that it is not released early.
func TestWindowRolls(t *testing.T) {
	e, now := newEngine()
	e.SetLimit(wid, 10*xrp)

	d := e.Evaluate(wid, 10*xrp, 10*xrp, now)
	e.Record(wid, 1, 10*xrp, "hash1", d, now)

	// 23 hours later the earlier spend is still inside the window.
	if d := e.Evaluate(wid, 1*xrp, 10*xrp, now.Add(23*hour)); d.Approved {
		t.Error("budget was released before the 24h window elapsed")
	}

	// Just past 24 hours it has aged out.
	if d := e.Evaluate(wid, 10*xrp, 10*xrp, now.Add(24*hour+time.Second)); !d.Approved {
		t.Errorf("budget was not released after the window elapsed: %s", d.Reason)
	}
}

// TestPartialWindowRoll verifies the window is genuinely rolling rather than a
// fixed daily bucket: only the spends older than 24h are forgotten.
func TestPartialWindowRoll(t *testing.T) {
	e, now := newEngine()
	e.SetLimit(wid, 10*xrp)

	d1 := e.Evaluate(wid, 5*xrp, 10*xrp, now)
	e.Record(wid, 1, 5*xrp, "h1", d1, now)

	later := now.Add(12 * hour)
	d2 := e.Evaluate(wid, 5*xrp, 10*xrp, later)
	e.Record(wid, 2, 5*xrp, "h2", d2, later)

	// At now+25h the first spend has expired but the second has not.
	at := now.Add(25 * hour)
	d := e.Evaluate(wid, 5*xrp, 10*xrp, at)
	if !d.Approved {
		t.Errorf("expected 5 XRP of budget to be available: %s", d.Reason)
	}
	if d.SpentDrops != 5*xrp {
		t.Errorf("spent = %d, want %d (only the second payment should remain)", d.SpentDrops, 5*xrp)
	}
}

// TestStricterLimitWins is the cross-check against the on-chain policy. Neither side
// may unilaterally raise the cap.
func TestStricterLimitWins(t *testing.T) {
	e, now := newEngine()

	t.Run("chain lower than enclave", func(t *testing.T) {
		e.SetLimit(wid, 100*xrp)
		d := e.Evaluate(wid, 50*xrp, 10*xrp, now)
		if d.Approved {
			t.Error("enclave allowed 50 XRP when the on-chain limit was 10 XRP")
		}
		if d.LimitDrops != 10*xrp {
			t.Errorf("applied limit = %d, want the stricter %d", d.LimitDrops, 10*xrp)
		}
	})

	t.Run("enclave lower than chain", func(t *testing.T) {
		e.SetLimit(wid, 10*xrp)
		d := e.Evaluate(wid, 50*xrp, 100*xrp, now)
		if d.Approved {
			t.Error("enclave allowed 50 XRP when its own limit was 10 XRP")
		}
		if d.LimitDrops != 10*xrp {
			t.Errorf("applied limit = %d, want the stricter %d", d.LimitDrops, 10*xrp)
		}
	})
}

// TestUnsetSideDoesNotZeroTheLimit guards the sentinel: zero means "not configured",
// so an unset side must fall back to the other rather than denying everything.
func TestUnsetSideDoesNotZeroTheLimit(t *testing.T) {
	e, now := newEngine()
	e.SetLimit(wid, 10*xrp)

	if d := e.Evaluate(wid, 5*xrp, 0, now); !d.Approved {
		t.Errorf("an unset on-chain limit blocked a payment within the enclave limit: %s", d.Reason)
	}
}

// TestHandledReplaysVerdict covers at-least-once delivery: the same request id must
// not consume the daily budget twice.
func TestHandledReplaysVerdict(t *testing.T) {
	e, now := newEngine()
	e.SetLimit(wid, 10*xrp)

	d := e.Evaluate(wid, 6*xrp, 10*xrp, now)
	e.Record(wid, 42, 6*xrp, "hash", d, now)

	stored, ok := e.Handled(wid, 42)
	if !ok {
		t.Fatal("request 42 was not recorded as handled")
	}
	if !stored.Approved {
		t.Error("stored verdict lost its approval")
	}

	if _, ok := e.Handled(wid, 43); ok {
		t.Error("an unseen request id was reported as handled")
	}

	// The spend must be counted exactly once.
	if got := e.Spent(wid, now); got != 6*xrp {
		t.Errorf("spent = %d, want %d", got, 6*xrp)
	}
}

// TestRefusalDoesNotConsumeBudget makes sure a rejected payment leaves the window
// untouched — otherwise repeated over-limit attempts would lock out valid ones.
func TestRefusalDoesNotConsumeBudget(t *testing.T) {
	e, now := newEngine()
	e.SetLimit(wid, 10*xrp)

	refused := e.Evaluate(wid, 25*xrp, 10*xrp, now)
	e.Record(wid, 1, 25*xrp, "", refused, now)

	if got := e.Spent(wid, now); got != 0 {
		t.Errorf("a refused payment consumed %d drops of budget", got)
	}
	if d := e.Evaluate(wid, 10*xrp, 10*xrp, now); !d.Approved {
		t.Errorf("a valid payment was blocked after an earlier refusal: %s", d.Reason)
	}
}

func TestWalletsAreIsolated(t *testing.T) {
	e, now := newEngine()
	e.Register(2)
	e.SetLimit(wid, 10*xrp)
	e.SetLimit(2, 10*xrp)

	d := e.Evaluate(wid, 10*xrp, 10*xrp, now)
	e.Record(wid, 1, 10*xrp, "h", d, now)

	if got := e.Spent(2, now); got != 0 {
		t.Errorf("wallet 2 shows %d drops spent from wallet 1's payment", got)
	}
	if d := e.Evaluate(2, 10*xrp, 10*xrp, now); !d.Approved {
		t.Errorf("wallet 1's spending blocked wallet 2: %s", d.Reason)
	}
}

func TestFormatXRP(t *testing.T) {
	cases := map[uint64]string{
		0:          "0 XRP",
		1_000_000:  "1 XRP",
		10_000_000: "10 XRP",
		1_500_000:  "1.5 XRP",
		1:          "0.000001 XRP",
		2_100_000:  "2.1 XRP",
	}
	for drops, want := range cases {
		if got := formatXRP(drops); got != want {
			t.Errorf("formatXRP(%d) = %q, want %q", drops, got, want)
		}
	}
}
