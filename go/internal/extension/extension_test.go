package extension

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"policyguard-extension/internal/config"
	"policyguard-extension/internal/xrpl"
	"policyguard-extension/pkg/protocol"

	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

const (
	xrp = uint64(1_000_000)
	// destination is the XRPL "masterpassphrase" account, a well-known valid address.
	destination = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
)

// harness drives the extension through the same POST /action envelope the TEE node
// delivers, with a clock the test controls.
type harness struct {
	t   *testing.T
	ext *Extension
	now time.Time
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{
		t:   t,
		ext: New(0, 0),
		now: time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC),
	}
	h.ext.now = func() time.Time { return h.now }
	return h
}

// advance moves the enclave's clock forward, so the rolling window can be exercised
// without waiting a day.
func (h *harness) advance(d time.Duration) { h.now = h.now.Add(d) }

// send builds the DataFixed envelope and invokes the action router.
func (h *harness) send(opType, opCommand string, message []byte) (int, teetypes.ActionResult, string) {
	h.t.Helper()

	dataFixed := instruction.DataFixed{
		OPType:          teeutils.ToHash(opType),
		OPCommand:       teeutils.ToHash(opCommand),
		OriginalMessage: message,
	}
	envelope, err := json.Marshal(dataFixed)
	if err != nil {
		h.t.Fatalf("marshalling DataFixed: %v", err)
	}

	status, body := h.ext.processAction(teetypes.Action{
		Data: teetypes.ActionData{Message: envelope},
	})

	var result teetypes.ActionResult
	if status == http.StatusOK {
		if err := json.Unmarshal(body, &result); err != nil {
			h.t.Fatalf("unmarshalling ActionResult: %v (body: %s)", err, body)
		}
	}
	return status, result, string(body)
}

func (h *harness) createWallet(walletID uint64) *protocol.CreateResponse {
	h.t.Helper()

	message, err := protocol.EncodeCreateRequest(&protocol.CreateRequest{
		WalletID: walletID,
		Owner:    common.HexToAddress("0x1111111111111111111111111111111111111111"),
	})
	if err != nil {
		h.t.Fatalf("encoding CREATE: %v", err)
	}

	status, result, body := h.send(config.OPTypeWallet, config.OPCommandCreate, message)
	if status != http.StatusOK || result.Status != 1 {
		h.t.Fatalf("createWallet failed: http=%d status=%d body=%s", status, result.Status, body)
	}

	decoded, err := protocol.DecodeCreateResponse(result.Data)
	if err != nil {
		h.t.Fatalf("decoding CREATE response: %v", err)
	}
	return decoded
}

func (h *harness) setLimit(walletID, limitDrops uint64) {
	h.t.Helper()

	message, err := protocol.EncodeSetLimitRequest(&protocol.SetLimitRequest{
		WalletID:   walletID,
		LimitDrops: limitDrops,
	})
	if err != nil {
		h.t.Fatalf("encoding SET_LIMIT: %v", err)
	}

	status, result, body := h.send(config.OPTypePolicy, config.OPCommandSetLimit, message)
	if status != http.StatusOK || result.Status != 1 {
		h.t.Fatalf("setDailyLimit failed: http=%d status=%d body=%s", status, result.Status, body)
	}
}

// pay submits a payment request and returns the enclave's verdict.
func (h *harness) pay(walletID, requestID, amountDrops, onChainLimit uint64, seq uint32) *protocol.PaymentResponse {
	h.t.Helper()

	resp, result, body := h.payRaw(walletID, requestID, amountDrops, onChainLimit, seq, destination)
	if result.Status != 1 {
		h.t.Fatalf("payment request did not produce a verdict: status=%d body=%s", result.Status, body)
	}
	return resp
}

func (h *harness) payRaw(
	walletID, requestID, amountDrops, onChainLimit uint64,
	seq uint32,
	dest string,
) (*protocol.PaymentResponse, teetypes.ActionResult, string) {
	h.t.Helper()

	message, err := protocol.EncodePaymentRequest(&protocol.PaymentRequest{
		WalletID:           walletID,
		RequestID:          requestID,
		Destination:        dest,
		AmountDrops:        amountDrops,
		LimitDrops:         onChainLimit,
		Sequence:           seq,
		FeeDrops:           12,
		LastLedgerSequence: 100_000_000,
		RequestedAt:        uint64(h.now.Unix()),
	})
	if err != nil {
		h.t.Fatalf("encoding PAYMENT: %v", err)
	}

	_, result, body := h.send(config.OPTypePayment, config.OPCommandRequest, message)
	if result.Status != 1 {
		return nil, result, body
	}

	decoded, err := protocol.DecodePaymentResponse(result.Data)
	if err != nil {
		h.t.Fatalf("decoding PAYMENT response: %v", err)
	}
	return decoded, result, body
}

// TestDemoFlow is the scripted demo, executed end to end: create a wallet, set a
// 10 XRP limit, spend 4 XRP successfully, then have 25 XRP refused.
func TestDemoFlow(t *testing.T) {
	h := newHarness(t)

	created := h.createWallet(1)
	if !strings.HasPrefix(created.ClassicAddress, "r") {
		t.Fatalf("generated address %q is not an XRPL classic address", created.ClassicAddress)
	}
	// The address must derive from the public key the enclave returned.
	derived := xrpl.EncodeClassicAddress(xrpl.AccountIDFromPublicKey(created.PublicKey))
	if derived != created.ClassicAddress {
		t.Fatalf("address %s does not derive from the returned public key (%s)",
			created.ClassicAddress, derived)
	}

	h.setLimit(1, 10*xrp)

	allowed := h.pay(1, 1, 4*xrp, 10*xrp, 1)
	if !allowed.Approved {
		t.Fatalf("4 XRP refused under a 10 XRP limit: %s", allowed.Reason)
	}
	if len(allowed.SignedTxBlob) == 0 {
		t.Fatal("approved payment returned no signed transaction")
	}
	if allowed.TxHash == (common.Hash{}) {
		t.Fatal("approved payment returned a zero transaction hash")
	}

	blocked := h.pay(1, 2, 25*xrp, 10*xrp, 2)
	if blocked.Approved {
		t.Fatal("25 XRP approved under a 10 XRP limit")
	}
	if len(blocked.SignedTxBlob) != 0 {
		t.Fatal("refused payment still returned a signed transaction")
	}
	if !strings.Contains(blocked.Reason, "daily limit exceeded") {
		t.Errorf("refusal reason %q does not explain the limit breach", blocked.Reason)
	}
}

// TestSignedBlobIsAValidXRPLTransaction verifies the enclave's output is genuinely
// signed by the key behind the advertised address, rather than merely well-formed.
func TestSignedBlobIsAValidXRPLTransaction(t *testing.T) {
	h := newHarness(t)
	created := h.createWallet(1)
	h.setLimit(1, 10*xrp)

	approved := h.pay(1, 1, 4*xrp, 10*xrp, 7)
	if !approved.Approved {
		t.Fatalf("payment refused: %s", approved.Reason)
	}

	payment := &xrpl.Payment{
		Account:            created.ClassicAddress,
		Destination:        destination,
		AmountDrops:        4 * xrp,
		FeeDrops:           12,
		Sequence:           7,
		LastLedgerSequence: 100_000_000,
	}

	// Recover the signature from the blob and check it against the payment the
	// request described.
	blobHex := strings.ToUpper(hex.EncodeToString(approved.SignedTxBlob))
	if !strings.Contains(blobHex, "7321") {
		t.Error("signed blob does not contain a SigningPubKey field")
	}
	if !strings.Contains(blobHex, "7446") && !strings.Contains(blobHex, "7447") &&
		!strings.Contains(blobHex, "7445") {
		t.Error("signed blob does not contain a TxnSignature field")
	}

	signature, err := extractTxnSignature(approved.SignedTxBlob)
	if err != nil {
		t.Fatalf("extracting TxnSignature: %v", err)
	}

	ok, err := xrpl.VerifySignature(payment, publicKeyOf(t, h, 1), signature)
	if err != nil {
		t.Fatalf("verifying signature: %v", err)
	}
	if !ok {
		t.Error("the signature in the blob does not verify against the wallet's public key")
	}
}

// publicKeyOf reaches into the enclave state for the wallet's public key. Only the
// public half is exposed even here — the test cannot reach the secret either.
func publicKeyOf(t *testing.T, h *harness, walletID uint64) []byte {
	t.Helper()
	w, ok := h.ext.wallets[walletID]
	if !ok {
		t.Fatalf("wallet %d not found", walletID)
	}
	return w.keypair.PublicKey
}

// extractTxnSignature walks the serialized transaction for the TxnSignature field
// (type 7, field 4 — header byte 0x74).
func extractTxnSignature(blob []byte) ([]byte, error) {
	for i := 0; i < len(blob); {
		typeCode := blob[i] >> 4
		fieldCode := blob[i] & 0x0F
		i++
		if fieldCode == 0 {
			fieldCode = blob[i]
			i++
		}

		switch typeCode {
		case 1:
			i += 2
		case 2:
			i += 4
		case 6:
			i += 8
		case 7, 8:
			length := int(blob[i])
			i++
			if typeCode == 7 && fieldCode == 4 {
				return blob[i : i+length], nil
			}
			i += length
		default:
			return nil, errUnexpectedField
		}
	}
	return nil, errNoSignature
}

var (
	errUnexpectedField = &fieldError{"unexpected field type in serialized transaction"}
	errNoSignature     = &fieldError{"no TxnSignature field found"}
)

type fieldError struct{ msg string }

func (e *fieldError) Error() string { return e.msg }

// TestSpendAccumulatesAcrossRequests covers the case that makes a daily limit real:
// several individually-allowed payments must not sum past the cap.
func TestSpendAccumulatesAcrossRequests(t *testing.T) {
	h := newHarness(t)
	h.createWallet(1)
	h.setLimit(1, 10*xrp)

	if r := h.pay(1, 1, 6*xrp, 10*xrp, 1); !r.Approved {
		t.Fatalf("first 6 XRP payment refused: %s", r.Reason)
	}
	r := h.pay(1, 2, 6*xrp, 10*xrp, 2)
	if r.Approved {
		t.Fatal("6 + 6 XRP approved under a 10 XRP limit")
	}
	if r.SpentDrops != 6*xrp {
		t.Errorf("spent = %d drops, want %d", r.SpentDrops, 6*xrp)
	}
}

// TestWindowRollsInsideTheEnclave checks the enclave releases budget only after the
// window truly elapses.
func TestWindowRollsInsideTheEnclave(t *testing.T) {
	h := newHarness(t)
	h.createWallet(1)
	h.setLimit(1, 10*xrp)

	if r := h.pay(1, 1, 10*xrp, 10*xrp, 1); !r.Approved {
		t.Fatalf("initial payment refused: %s", r.Reason)
	}

	h.advance(23 * time.Hour)
	if r := h.pay(1, 2, 1*xrp, 10*xrp, 2); r.Approved {
		t.Error("budget released before the 24h window elapsed")
	}

	h.advance(2 * time.Hour) // now 25h after the first payment
	if r := h.pay(1, 3, 10*xrp, 10*xrp, 3); !r.Approved {
		t.Errorf("budget not released after the window elapsed: %s", r.Reason)
	}
}

// TestReplayedRequestDoesNotDoubleSpend covers at-least-once instruction delivery.
func TestReplayedRequestDoesNotDoubleSpend(t *testing.T) {
	h := newHarness(t)
	h.createWallet(1)
	h.setLimit(1, 10*xrp)

	first := h.pay(1, 1, 6*xrp, 10*xrp, 1)
	if !first.Approved {
		t.Fatalf("first payment refused: %s", first.Reason)
	}

	// The identical instruction arrives again.
	replay := h.pay(1, 1, 6*xrp, 10*xrp, 1)
	if !replay.Approved {
		t.Errorf("replayed request flipped to refused: %s", replay.Reason)
	}

	// A different request for the remaining 4 XRP must still fit, proving the replay
	// did not consume budget a second time.
	if r := h.pay(1, 2, 4*xrp, 10*xrp, 2); !r.Approved {
		t.Errorf("replay consumed budget twice: %s", r.Reason)
	}
}

// TestCreateIsIdempotent guards against minting a second key for the same wallet,
// which would strand any XRP already sent to the first address.
func TestCreateIsIdempotent(t *testing.T) {
	h := newHarness(t)

	first := h.createWallet(1)
	second := h.createWallet(1)

	if first.ClassicAddress != second.ClassicAddress {
		t.Errorf("re-creating wallet 1 produced a new address: %s then %s",
			first.ClassicAddress, second.ClassicAddress)
	}
}

func TestWalletsGetDistinctAddresses(t *testing.T) {
	h := newHarness(t)

	first := h.createWallet(1)
	second := h.createWallet(2)

	if first.ClassicAddress == second.ClassicAddress {
		t.Error("two wallets were given the same XRPL address")
	}
}

// TestPaymentBeforeLimitIsRefused pins the fail-closed default.
func TestPaymentBeforeLimitIsRefused(t *testing.T) {
	h := newHarness(t)
	h.createWallet(1)

	r := h.pay(1, 1, 1*xrp, 0, 1)
	if r.Approved {
		t.Fatal("payment approved before any limit was configured")
	}
	if !strings.Contains(r.Reason, "no daily spending limit") {
		t.Errorf("reason %q does not explain that no limit is set", r.Reason)
	}
}

// TestOnChainLimitCapsTheEnclave verifies the enclave cannot authorise more than the
// publicly auditable on-chain policy allows.
func TestOnChainLimitCapsTheEnclave(t *testing.T) {
	h := newHarness(t)
	h.createWallet(1)
	h.setLimit(1, 100*xrp)

	r := h.pay(1, 1, 50*xrp, 10*xrp, 1)
	if r.Approved {
		t.Fatal("enclave approved 50 XRP while the on-chain limit was 10 XRP")
	}
	if r.LimitDrops != 10*xrp {
		t.Errorf("applied limit = %d, want the stricter on-chain %d", r.LimitDrops, 10*xrp)
	}
}

func TestBadDestinationIsAnError(t *testing.T) {
	h := newHarness(t)
	h.createWallet(1)
	h.setLimit(1, 10*xrp)

	_, result, _ := h.payRaw(1, 1, 1*xrp, 10*xrp, 1, "rNotAValidAddress0000")
	if result.Status != 0 {
		t.Fatalf("a malformed destination produced status %d, want 0", result.Status)
	}
	if !strings.Contains(result.Log, "invalid destination") {
		t.Errorf("log %q does not name the bad destination", result.Log)
	}
}

// TestBadDestinationDoesNotConsumeBudget makes sure a typo cannot eat the allowance.
func TestBadDestinationDoesNotConsumeBudget(t *testing.T) {
	h := newHarness(t)
	h.createWallet(1)
	h.setLimit(1, 10*xrp)

	h.payRaw(1, 1, 10*xrp, 10*xrp, 1, "rNotAValidAddress0000")

	if r := h.pay(1, 2, 10*xrp, 10*xrp, 2); !r.Approved {
		t.Errorf("a rejected destination consumed the daily allowance: %s", r.Reason)
	}
}

func TestUnknownWalletIsAnError(t *testing.T) {
	h := newHarness(t)

	message, err := protocol.EncodeSetLimitRequest(&protocol.SetLimitRequest{WalletID: 99, LimitDrops: xrp})
	if err != nil {
		t.Fatalf("encoding SET_LIMIT: %v", err)
	}
	_, result, _ := h.send(config.OPTypePolicy, config.OPCommandSetLimit, message)
	if result.Status != 0 {
		t.Errorf("setting a limit on an unknown wallet returned status %d, want 0", result.Status)
	}
}

func TestUnsupportedOpTypeIsRejected(t *testing.T) {
	h := newHarness(t)

	status, _, body := h.send("NOT_A_REAL_OP", "NOPE", []byte{0x01})
	if status != http.StatusNotImplemented {
		t.Errorf("unsupported op type returned HTTP %d, want %d", status, http.StatusNotImplemented)
	}
	if !strings.Contains(body, "unsupported op type") {
		t.Errorf("body %q does not name the problem", body)
	}
}

func TestUnsupportedOpCommandIsRejected(t *testing.T) {
	h := newHarness(t)

	_, result, _ := h.send(config.OPTypeWallet, "DESTROY", []byte{0x01})
	if result.Status != 0 {
		t.Errorf("unsupported command returned status %d, want 0", result.Status)
	}
	if !strings.Contains(result.Log, "unsupported WALLET command") {
		t.Errorf("log %q does not name the problem", result.Log)
	}
}

func TestMalformedMessageIsRejected(t *testing.T) {
	h := newHarness(t)

	_, result, _ := h.send(config.OPTypeWallet, config.OPCommandCreate, []byte{0xDE, 0xAD})
	if result.Status != 0 {
		t.Errorf("a malformed CREATE message returned status %d, want 0", result.Status)
	}
}

// TestStateReportsOnlyPublicFields is the confidentiality check.
//
// It asserts the *shape* of the report rather than diffing it against the secret,
// because xrpl.Keypair has no accessor for the private key — not even an unexported
// one this package could reach. Adding a test-only escape hatch would defeat the
// property being tested, so the invariant enforced here is that every key in the
// serialised report is on a reviewed allowlist. A future field that leaked key
// material would have to be added to this list to pass, which is the point.
func TestStateReportsOnlyPublicFields(t *testing.T) {
	h := newHarness(t)
	created := h.createWallet(1)
	h.setLimit(1, 10*xrp)
	h.pay(1, 1, 4*xrp, 10*xrp, 1)

	state := h.ext.reportState()

	if len(state.Wallets) != 1 {
		t.Fatalf("state reports %d wallets, want 1", len(state.Wallets))
	}
	w := state.Wallets[0]
	if w.ClassicAddress != created.ClassicAddress {
		t.Errorf("state address = %s, want %s", w.ClassicAddress, created.ClassicAddress)
	}
	if w.SpentDrops != 4*xrp {
		t.Errorf("state spent = %d, want %d", w.SpentDrops, 4*xrp)
	}
	if w.RemainingDrops != 6*xrp {
		t.Errorf("state remaining = %d, want %d", w.RemainingDrops, 6*xrp)
	}
	if w.PaymentsSigned != 1 {
		t.Errorf("state signed count = %d, want 1", w.PaymentsSigned)
	}

	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshalling state: %v", err)
	}

	var generic map[string]any
	if err := json.Unmarshal(encoded, &generic); err != nil {
		t.Fatalf("re-parsing state: %v", err)
	}
	walletsRaw, ok := generic["wallets"].([]any)
	if !ok || len(walletsRaw) != 1 {
		t.Fatalf("state JSON has no wallets array: %s", encoded)
	}
	walletJSON, ok := walletsRaw[0].(map[string]any)
	if !ok {
		t.Fatalf("wallet entry is not an object: %s", encoded)
	}

	allowed := map[string]bool{
		"walletId": true, "classicAddress": true, "dailyLimitDrops": true,
		"spentDrops": true, "remainingDrops": true,
		"paymentsSigned": true, "paymentsRefused": true,
	}
	for key := range walletJSON {
		if !allowed[key] {
			t.Errorf("state report exposes unreviewed field %q — confirm it cannot leak key material", key)
		}
	}
}
