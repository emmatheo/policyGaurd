package xrpl

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"math/big"
)

// XRPL uses its own base58 alphabet ("base58check with the Ripple dictionary"),
// deliberately different from Bitcoin's so that an address from one chain cannot be
// silently pasted into the other.
const xrplAlphabet = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz"

// prefixAccountID is the version byte for a classic account address (r...).
const prefixAccountID byte = 0x00

var (
	errBadChecksum = errors.New("xrpl: address checksum mismatch")
	errBadAlphabet = errors.New("xrpl: address contains a character outside the XRPL base58 alphabet")
)

// decodeTable maps a byte value to its index in xrplAlphabet, or -1.
var decodeTable = func() [256]int8 {
	var t [256]int8
	for i := range t {
		t[i] = -1
	}
	for i := 0; i < len(xrplAlphabet); i++ {
		t[xrplAlphabet[i]] = int8(i)
	}
	return t
}()

// base58Encode encodes input using the XRPL alphabet, preserving leading zero bytes
// as leading 'r' characters.
func base58Encode(input []byte) string {
	num := new(big.Int).SetBytes(input)
	radix := big.NewInt(58)
	mod := new(big.Int)

	var out []byte
	for num.Sign() > 0 {
		num.DivMod(num, radix, mod)
		out = append(out, xrplAlphabet[mod.Int64()])
	}

	// Every leading zero byte encodes to one leading alphabet[0] character.
	for _, b := range input {
		if b != 0 {
			break
		}
		out = append(out, xrplAlphabet[0])
	}

	// The loop above built the string backwards.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return string(out)
}

// base58Decode reverses base58Encode.
func base58Decode(input string) ([]byte, error) {
	num := big.NewInt(0)
	radix := big.NewInt(58)

	for i := 0; i < len(input); i++ {
		idx := decodeTable[input[i]]
		if idx < 0 {
			return nil, fmt.Errorf("%w: %q", errBadAlphabet, input[i])
		}
		num.Mul(num, radix)
		num.Add(num, big.NewInt(int64(idx)))
	}

	decoded := num.Bytes()

	// Restore leading zero bytes that base58Encode collapsed into alphabet[0].
	var leading int
	for leading < len(input) && input[leading] == xrplAlphabet[0] {
		leading++
	}

	out := make([]byte, leading+len(decoded))
	copy(out[leading:], decoded)
	return out, nil
}

// checksum returns the first 4 bytes of SHA256(SHA256(payload)).
func checksum(payload []byte) []byte {
	first := sha256.Sum256(payload)
	second := sha256.Sum256(first[:])
	return second[:4]
}

// base58CheckEncode prepends the version byte, appends the 4-byte double-SHA256
// checksum, and base58-encodes the result.
func base58CheckEncode(version byte, payload []byte) string {
	buf := make([]byte, 0, 1+len(payload)+4)
	buf = append(buf, version)
	buf = append(buf, payload...)
	buf = append(buf, checksum(buf)...)
	return base58Encode(buf)
}

// base58CheckDecode validates the checksum and version byte, returning the payload.
func base58CheckDecode(encoded string, expectedVersion byte) ([]byte, error) {
	raw, err := base58Decode(encoded)
	if err != nil {
		return nil, err
	}
	if len(raw) < 5 {
		return nil, fmt.Errorf("xrpl: address too short (%d bytes decoded)", len(raw))
	}

	body := raw[:len(raw)-4]
	want := raw[len(raw)-4:]
	got := checksum(body)
	for i := range got {
		if got[i] != want[i] {
			return nil, errBadChecksum
		}
	}

	if body[0] != expectedVersion {
		return nil, fmt.Errorf("xrpl: unexpected version byte 0x%02x (want 0x%02x)", body[0], expectedVersion)
	}
	return body[1:], nil
}
