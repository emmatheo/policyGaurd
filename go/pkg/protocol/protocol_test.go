package protocol

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

// The vectors below were produced by Foundry's `cast abi-encode` using the exact
// signatures the Solidity contract calls abi.encode with. They pin the cross-language
// contract: if someone reorders or retypes an argument in InstructionSender.sol without
// updating this package, these tests fail rather than the mismatch surfacing at runtime
// as a decode error against a live TEE.
//
// Regenerate with:
//
//	cast abi-encode "f(uint64,address)" 1 0x1111111111111111111111111111111111111111
//	cast abi-encode "f(uint64,uint64)" 1 10000000
//	cast abi-encode "f(uint64,uint64,string,uint64,uint64,uint32,uint32,uint32,uint32,uint64)" \
//	    1 2 "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh" 4000000 10000000 7 12 100000000 0 1754222400

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if err != nil {
		t.Fatalf("decoding test vector: %v", err)
	}
	return b
}

func TestDecodeCreateRequestFromSolidityVector(t *testing.T) {
	const vector = "0x" +
		"0000000000000000000000000000000000000000000000000000000000000001" +
		"0000000000000000000000001111111111111111111111111111111111111111"

	req, err := DecodeCreateRequest(mustHex(t, vector))
	if err != nil {
		t.Fatalf("DecodeCreateRequest: %v", err)
	}
	if req.WalletID != 1 {
		t.Errorf("walletId = %d, want 1", req.WalletID)
	}
	want := common.HexToAddress("0x1111111111111111111111111111111111111111")
	if req.Owner != want {
		t.Errorf("owner = %s, want %s", req.Owner, want)
	}
}

func TestDecodeSetLimitRequestFromSolidityVector(t *testing.T) {
	const vector = "0x" +
		"0000000000000000000000000000000000000000000000000000000000000001" +
		"0000000000000000000000000000000000000000000000000000000000989680"

	req, err := DecodeSetLimitRequest(mustHex(t, vector))
	if err != nil {
		t.Fatalf("DecodeSetLimitRequest: %v", err)
	}
	if req.WalletID != 1 {
		t.Errorf("walletId = %d, want 1", req.WalletID)
	}
	if req.LimitDrops != 10_000_000 {
		t.Errorf("limitDrops = %d, want 10000000", req.LimitDrops)
	}
}

// TestDecodePaymentRequestFromSolidityVector is the important one: ten arguments, a
// dynamic string in the middle, and mixed uint32/uint64 widths. Any drift in order or
// width shows up here.
func TestDecodePaymentRequestFromSolidityVector(t *testing.T) {
	const vector = "0x" +
		"0000000000000000000000000000000000000000000000000000000000000001" +
		"0000000000000000000000000000000000000000000000000000000000000002" +
		"0000000000000000000000000000000000000000000000000000000000000140" +
		"00000000000000000000000000000000000000000000000000000000003d0900" +
		"0000000000000000000000000000000000000000000000000000000000989680" +
		"0000000000000000000000000000000000000000000000000000000000000007" +
		"000000000000000000000000000000000000000000000000000000000000000c" +
		"0000000000000000000000000000000000000000000000000000000005f5e100" +
		"0000000000000000000000000000000000000000000000000000000000000000" +
		"00000000000000000000000000000000000000000000000000000000688f4f40" +
		"0000000000000000000000000000000000000000000000000000000000000022" +
		"72486239434a4157794234726a39315652576e3936446b756b47346277647479" +
		"5468000000000000000000000000000000000000000000000000000000000000"

	req, err := DecodePaymentRequest(mustHex(t, vector))
	if err != nil {
		t.Fatalf("DecodePaymentRequest: %v", err)
	}

	checks := []struct {
		name      string
		got, want uint64
	}{
		{"walletId", req.WalletID, 1},
		{"requestId", req.RequestID, 2},
		{"amountDrops", req.AmountDrops, 4_000_000},
		{"limitDrops", req.LimitDrops, 10_000_000},
		{"sequence", uint64(req.Sequence), 7},
		{"feeDrops", uint64(req.FeeDrops), 12},
		{"lastLedgerSequence", uint64(req.LastLedgerSequence), 100_000_000},
		{"destinationTag", uint64(req.DestinationTag), 0},
		{"requestedAt", req.RequestedAt, 1_754_222_400},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s = %d, want %d", c.name, c.got, c.want)
		}
	}
	if req.Destination != "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh" {
		t.Errorf("destination = %q, want the test address", req.Destination)
	}
}

func TestPaymentRequestRoundTrip(t *testing.T) {
	original := &PaymentRequest{
		WalletID:           7,
		RequestID:          99,
		Destination:        "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
		AmountDrops:        4_000_000,
		LimitDrops:         10_000_000,
		Sequence:           3,
		FeeDrops:           12,
		LastLedgerSequence: 900_000,
		DestinationTag:     42,
		RequestedAt:        1_754_222_400,
	}

	encoded, err := EncodePaymentRequest(original)
	if err != nil {
		t.Fatalf("EncodePaymentRequest: %v", err)
	}
	decoded, err := DecodePaymentRequest(encoded)
	if err != nil {
		t.Fatalf("DecodePaymentRequest: %v", err)
	}
	if *decoded != *original {
		t.Errorf("round trip changed the request:\n got %+v\nwant %+v", *decoded, *original)
	}
}

func TestPaymentResponseRoundTrip(t *testing.T) {
	original := &PaymentResponse{
		RequestID:      99,
		Approved:       true,
		Reason:         "within daily limit: 6 XRP of 10 XRP remaining after this payment",
		SignedTxBlob:   []byte{0x12, 0x00, 0x00, 0x22, 0x80, 0x00, 0x00, 0x00},
		TxHash:         common.HexToHash("0xabc123"),
		LimitDrops:     10_000_000,
		SpentDrops:     0,
		RemainingDrops: 10_000_000,
	}

	encoded, err := EncodePaymentResponse(original)
	if err != nil {
		t.Fatalf("EncodePaymentResponse: %v", err)
	}
	decoded, err := DecodePaymentResponse(encoded)
	if err != nil {
		t.Fatalf("DecodePaymentResponse: %v", err)
	}

	if decoded.RequestID != original.RequestID || decoded.Approved != original.Approved ||
		decoded.Reason != original.Reason || decoded.TxHash != original.TxHash ||
		decoded.LimitDrops != original.LimitDrops || decoded.RemainingDrops != original.RemainingDrops {
		t.Errorf("round trip changed the response:\n got %+v\nwant %+v", *decoded, *original)
	}
	if !bytes.Equal(decoded.SignedTxBlob, original.SignedTxBlob) {
		t.Errorf("blob = %x, want %x", decoded.SignedTxBlob, original.SignedTxBlob)
	}
}

// TestRefusalRoundTrip covers the encoding a refusal actually uses: no blob, zero hash.
func TestRefusalRoundTrip(t *testing.T) {
	original := &PaymentResponse{
		RequestID:      100,
		Approved:       false,
		Reason:         "daily limit exceeded: requested 25 XRP, but only 10 XRP of the 10 XRP limit remains",
		LimitDrops:     10_000_000,
		SpentDrops:     0,
		RemainingDrops: 10_000_000,
	}

	encoded, err := EncodePaymentResponse(original)
	if err != nil {
		t.Fatalf("EncodePaymentResponse: %v", err)
	}
	decoded, err := DecodePaymentResponse(encoded)
	if err != nil {
		t.Fatalf("DecodePaymentResponse: %v", err)
	}
	if decoded.Approved {
		t.Error("a refusal round-tripped as approved")
	}
	if len(decoded.SignedTxBlob) != 0 {
		t.Errorf("a refusal round-tripped with a %d-byte blob", len(decoded.SignedTxBlob))
	}
	if decoded.TxHash != (common.Hash{}) {
		t.Error("a refusal round-tripped with a non-zero transaction hash")
	}
	if decoded.Reason != original.Reason {
		t.Errorf("reason = %q, want %q", decoded.Reason, original.Reason)
	}
}

func TestCreateResponseRoundTrip(t *testing.T) {
	original := &CreateResponse{
		WalletID:       3,
		ClassicAddress: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
		PublicKey:      mustHex(t, "0330E7FC9D56BB25D6893BA3F317AE5BCF33B3291BD63DB32654A313222F7FD020"),
	}

	encoded, err := EncodeCreateResponse(original)
	if err != nil {
		t.Fatalf("EncodeCreateResponse: %v", err)
	}
	decoded, err := DecodeCreateResponse(encoded)
	if err != nil {
		t.Fatalf("DecodeCreateResponse: %v", err)
	}
	if decoded.WalletID != original.WalletID || decoded.ClassicAddress != original.ClassicAddress {
		t.Errorf("round trip changed the response: %+v", *decoded)
	}
	if !bytes.Equal(decoded.PublicKey, original.PublicKey) {
		t.Errorf("publicKey = %x, want %x", decoded.PublicKey, original.PublicKey)
	}
}

func TestTruncatedPayloadIsRejected(t *testing.T) {
	encoded, err := EncodePaymentRequest(&PaymentRequest{
		WalletID: 1, RequestID: 1, Destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
		AmountDrops: 1, LimitDrops: 1,
	})
	if err != nil {
		t.Fatalf("EncodePaymentRequest: %v", err)
	}
	if _, err := DecodePaymentRequest(encoded[:len(encoded)/2]); err == nil {
		t.Error("a truncated payment payload decoded without error")
	}
	if _, err := DecodePaymentRequest(nil); err == nil {
		t.Error("an empty payload decoded without error")
	}
}
