package xrpl

import (
	"encoding/hex"
	"strings"
	"testing"
)

// TestRIPEMD160Vectors pins the vendored hash against the vectors published with the
// algorithm. If these pass, the address derivation below is testing base58 rather
// than debugging the hash.
func TestRIPEMD160Vectors(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", "9c1185a5c5e9fc54612808977ee8f548b2258d31"},
		{"a", "0bdc9d2d256b3ee9daae347be6f4dc835a467ffe"},
		{"abc", "8eb208f7e05d987a9b044a8e98c6b087f15a0bfc"},
		{"message digest", "5d0689ef49d2fae572b881b123a85ffa21595f36"},
		{"abcdefghijklmnopqrstuvwxyz", "f71c27109c692c1b56bbdceb5b9d2865b3708dbc"},
	}
	for _, c := range cases {
		got := hex.EncodeToString(ripemd160([]byte(c.in)))
		if got != c.want {
			t.Errorf("ripemd160(%q) = %s, want %s", c.in, got, c.want)
		}
	}
}

// TestRIPEMD160MultiBlock exercises the padding path where the message spans more
// than one 64-byte block and the length field lands in a fresh block.
func TestRIPEMD160MultiBlock(t *testing.T) {
	in := strings.Repeat("1234567890", 8) // 80 bytes
	want := "9b752e45573d4b39f4dbd3323cab82bf63326bfb"
	if got := hex.EncodeToString(ripemd160([]byte(in))); got != want {
		t.Errorf("ripemd160(8x1234567890) = %s, want %s", got, want)
	}
}

// TestClassicAddressFromKnownPublicKey checks the full derivation chain
// (SHA256 -> RIPEMD160 -> base58check) against the XRPL "masterpassphrase" account,
// the standard test vector shipped with rippled.
func TestClassicAddressFromKnownPublicKey(t *testing.T) {
	const (
		pubKeyHex   = "0330E7FC9D56BB25D6893BA3F317AE5BCF33B3291BD63DB32654A313222F7FD020"
		wantAddress = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
	)

	pubKey, err := hex.DecodeString(pubKeyHex)
	if err != nil {
		t.Fatalf("decoding test public key: %v", err)
	}

	got := EncodeClassicAddress(AccountIDFromPublicKey(pubKey))
	if got != wantAddress {
		t.Fatalf("derived address = %s, want %s", got, wantAddress)
	}
}

func TestDecodeClassicAddressRoundTrip(t *testing.T) {
	kp, err := GenerateKeypair()
	if err != nil {
		t.Fatalf("GenerateKeypair: %v", err)
	}

	accountID, err := DecodeClassicAddress(kp.ClassicAddress)
	if err != nil {
		t.Fatalf("DecodeClassicAddress(%s): %v", kp.ClassicAddress, err)
	}
	if hex.EncodeToString(accountID) != hex.EncodeToString(kp.AccountID) {
		t.Errorf("round-tripped account id = %x, want %x", accountID, kp.AccountID)
	}
	if !strings.HasPrefix(kp.ClassicAddress, "r") {
		t.Errorf("classic address %q does not start with 'r'", kp.ClassicAddress)
	}
}

// TestDecodeClassicAddressRejectsBadInput covers the trust boundary: destinations
// come from off-chain callers, and a corrupted address must fail rather than send
// XRP somewhere unspendable.
func TestDecodeClassicAddressRejectsBadInput(t *testing.T) {
	cases := map[string]string{
		"empty":            "",
		"bad checksum":     "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTi",
		"outside alphabet": "rHb9CJAWyB4rj91VRWn96DkukG4bwdty0h",
		"too short":        "rrrr",
		"not an address":   "hello world",
	}
	for name, addr := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeClassicAddress(addr); err == nil {
				t.Errorf("DecodeClassicAddress(%q) succeeded, want an error", addr)
			}
		})
	}
}

func testPayment(t *testing.T, from string) *Payment {
	t.Helper()
	return &Payment{
		Account:            from,
		Destination:        "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
		AmountDrops:        5_000_000,
		FeeDrops:           12,
		Sequence:           42,
		LastLedgerSequence: 900_000,
	}
}

// TestSerializeFieldOrdering asserts the canonical ordering rule directly by walking
// the emitted field headers. Ordering is the single easiest thing to get wrong and
// the hardest to notice, since a mis-ordered transaction only fails at the validator.
func TestSerializeFieldOrdering(t *testing.T) {
	kp, err := GenerateKeypair()
	if err != nil {
		t.Fatalf("GenerateKeypair: %v", err)
	}

	p := testPayment(t, kp.ClassicAddress)
	p.DestinationTag = 7

	encoded, err := p.serialize(kp.PublicKey, []byte{0x30, 0x02, 0x01, 0x01})
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	var prevType, prevField uint8
	var seen int
	for i := 0; i < len(encoded); {
		typeCode := encoded[i] >> 4
		fieldCode := encoded[i] & 0x0F
		i++
		if fieldCode == 0 {
			fieldCode = encoded[i]
			i++
		}

		if typeCode < prevType || (typeCode == prevType && fieldCode < prevField) {
			t.Fatalf("field (%d,%d) came after (%d,%d): not canonically ordered",
				typeCode, fieldCode, prevType, prevField)
		}
		prevType, prevField = typeCode, fieldCode
		seen++

		// Advance past the payload.
		switch typeCode {
		case typeUInt16:
			i += 2
		case typeUInt32:
			i += 4
		case typeAmount:
			i += 8
		case typeBlob, typeAccountID:
			length := int(encoded[i])
			i += 1 + length
		default:
			t.Fatalf("unexpected type code %d", typeCode)
		}
	}

	// TransactionType, Flags, Sequence, DestinationTag, LastLedgerSequence,
	// Amount, Fee, SigningPubKey, TxnSignature, Account, Destination.
	if seen != 11 {
		t.Errorf("serialized %d fields, want 11", seen)
	}
}

// TestSigningPayloadOmitsSignature guards the rule that the signed digest covers
// SigningPubKey but not TxnSignature.
func TestSigningPayloadOmitsSignature(t *testing.T) {
	kp, err := GenerateKeypair()
	if err != nil {
		t.Fatalf("GenerateKeypair: %v", err)
	}
	p := testPayment(t, kp.ClassicAddress)

	unsigned, err := p.serialize(kp.PublicKey, nil)
	if err != nil {
		t.Fatalf("serialize unsigned: %v", err)
	}
	signed, err := p.serialize(kp.PublicKey, []byte{0x30, 0x02, 0x01, 0x01})
	if err != nil {
		t.Fatalf("serialize signed: %v", err)
	}

	if len(signed) <= len(unsigned) {
		t.Errorf("signed payload (%d bytes) is not longer than unsigned (%d bytes)",
			len(signed), len(unsigned))
	}
	// 0x74 is the TxnSignature field header (type 7, field 4).
	if strings.Contains(hex.EncodeToString(unsigned), "7404") {
		t.Error("unsigned payload contains a TxnSignature field header")
	}
}

// TestSignAndVerify is the end-to-end check: what the enclave signs must verify
// against the public key it advertises.
func TestSignAndVerify(t *testing.T) {
	kp, err := GenerateKeypair()
	if err != nil {
		t.Fatalf("GenerateKeypair: %v", err)
	}

	p := testPayment(t, kp.ClassicAddress)
	signed, err := kp.Sign(p)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	if signed.TxBlob == "" || signed.Hash == "" {
		t.Fatal("Sign returned an empty blob or hash")
	}
	if len(signed.Hash) != 64 {
		t.Errorf("hash is %d hex chars, want 64", len(signed.Hash))
	}
	if signed.SigningPubKey != upperHex(kp.PublicKey) {
		t.Errorf("SigningPubKey = %s, want %s", signed.SigningPubKey, upperHex(kp.PublicKey))
	}

	sigBytes, err := hex.DecodeString(signed.TxnSignature)
	if err != nil {
		t.Fatalf("decoding signature: %v", err)
	}
	ok, err := VerifySignature(p, kp.PublicKey, sigBytes)
	if err != nil {
		t.Fatalf("VerifySignature: %v", err)
	}
	if !ok {
		t.Error("signature produced by Sign did not verify")
	}
}

// TestSignRejectsForeignAccount makes sure the enclave cannot be talked into signing
// a transaction that claims a different sender.
func TestSignRejectsForeignAccount(t *testing.T) {
	kp, err := GenerateKeypair()
	if err != nil {
		t.Fatalf("GenerateKeypair: %v", err)
	}

	p := testPayment(t, "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh")
	if _, err := kp.Sign(p); err == nil {
		t.Fatal("Sign accepted a payment whose Account is not the enclave wallet")
	}
}

// TestSignRejectsBadDestination confirms a malformed destination fails at signing
// time rather than producing an unsubmittable blob.
func TestSignRejectsBadDestination(t *testing.T) {
	kp, err := GenerateKeypair()
	if err != nil {
		t.Fatalf("GenerateKeypair: %v", err)
	}

	p := testPayment(t, kp.ClassicAddress)
	p.Destination = "rNotAValidAddress0000"
	if _, err := kp.Sign(p); err == nil {
		t.Fatal("Sign accepted a malformed destination address")
	}
}

func TestSignRejectsZeroAmount(t *testing.T) {
	kp, err := GenerateKeypair()
	if err != nil {
		t.Fatalf("GenerateKeypair: %v", err)
	}

	p := testPayment(t, kp.ClassicAddress)
	p.AmountDrops = 0
	if _, err := kp.Sign(p); err == nil {
		t.Fatal("Sign accepted a zero-drop payment")
	}
}

// TestSignIsDeterministic documents that signing uses RFC 6979, so the same payment
// always yields the same blob. Replay protection therefore has to come from the
// sequence number and request id, not from signature randomness.
func TestSignIsDeterministic(t *testing.T) {
	kp, err := GenerateKeypair()
	if err != nil {
		t.Fatalf("GenerateKeypair: %v", err)
	}

	first, err := kp.Sign(testPayment(t, kp.ClassicAddress))
	if err != nil {
		t.Fatalf("first Sign: %v", err)
	}
	second, err := kp.Sign(testPayment(t, kp.ClassicAddress))
	if err != nil {
		t.Fatalf("second Sign: %v", err)
	}

	if first.TxBlob != second.TxBlob {
		t.Error("signing the same payment twice produced different blobs")
	}
}

func TestEncodeVLTiers(t *testing.T) {
	cases := []struct {
		length int
		want   int // expected prefix length in bytes
	}{
		{0, 1}, {192, 1}, {193, 2}, {12480, 2}, {12481, 3}, {918744, 3},
	}
	for _, c := range cases {
		got, err := encodeVL(c.length)
		if err != nil {
			t.Fatalf("encodeVL(%d): %v", c.length, err)
		}
		if len(got) != c.want {
			t.Errorf("encodeVL(%d) produced %d prefix bytes, want %d", c.length, len(got), c.want)
		}
	}
	if _, err := encodeVL(918745); err == nil {
		t.Error("encodeVL accepted a length beyond the maximum")
	}
}

func TestAmountRejectsOverSupply(t *testing.T) {
	if _, err := amountField(fieldAmount, maxDrops+1); err == nil {
		t.Error("amountField accepted an amount larger than the total XRP supply")
	}
}
