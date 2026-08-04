package xrpl

import (
	"crypto/sha512"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

// XRPL domain-separation prefixes. Every hashed payload is tagged so a blob signed
// for one purpose can never be replayed as another.
const (
	// prefixTransactionSig ("STX\0") tags the payload a single signer signs.
	prefixTransactionSig uint32 = 0x53545800
	// prefixTransactionID ("TXN\0") tags a fully signed transaction for hashing.
	prefixTransactionID uint32 = 0x54584E00
)

// SignedPayment is the enclave's output for an approved payment: everything needed
// to submit the transaction, and nothing that could reconstruct the key.
type SignedPayment struct {
	// TxBlob is the signed transaction, hex-encoded uppercase, ready to hand to
	// the XRPL `submit` method.
	TxBlob string `json:"txBlob"`
	// Hash is the transaction ID, hex-encoded uppercase.
	Hash string `json:"hash"`
	// SigningPubKey is the 33-byte compressed public key, hex-encoded uppercase.
	SigningPubKey string `json:"signingPubKey"`
	// TxnSignature is the DER-encoded signature, hex-encoded uppercase.
	TxnSignature string `json:"txnSignature"`
}

// sha512Half returns the first 32 bytes of SHA-512, which is XRPL's standard hash.
func sha512Half(data []byte) []byte {
	sum := sha512.Sum512(data)
	return sum[:32]
}

// withPrefix prepends a 4-byte big-endian domain-separation prefix.
func withPrefix(prefix uint32, data []byte) []byte {
	buf := make([]byte, 4, 4+len(data))
	binary.BigEndian.PutUint32(buf, prefix)
	return append(buf, data...)
}

// SigningHash returns the digest a signer must sign for this payment: the canonical
// serialization without TxnSignature, tagged with the transaction-signature prefix.
//
// Exported so the signing payload can be inspected and tested independently of the
// secret that signs it.
func (p *Payment) SigningHash(signingPubKey []byte) ([]byte, error) {
	encoded, err := p.serialize(signingPubKey, nil)
	if err != nil {
		return nil, err
	}
	return sha512Half(withPrefix(prefixTransactionSig, encoded)), nil
}

// Sign produces a signed XRPL Payment using the enclave-held key.
//
// The secret is used here and nowhere else; only the signature, public key, and
// resulting blob leave this function. Callers cannot supply the signing key — it is
// reached through the Keypair's unexported field — so there is no path by which an
// instruction could cause a different key to be used.
func (k *Keypair) Sign(p *Payment) (*SignedPayment, error) {
	if k == nil || k.priv == nil {
		return nil, fmt.Errorf("xrpl: keypair holds no signing key")
	}

	// The sender must be the enclave-held account. Signing for any other Account
	// would produce a transaction the ledger rejects, and silently accepting a
	// mismatch would hide a caller bug until submission.
	if p.Account != "" && p.Account != k.ClassicAddress {
		return nil, fmt.Errorf(
			"xrpl: payment Account %q does not match the enclave wallet %q",
			p.Account, k.ClassicAddress,
		)
	}
	p.Account = k.ClassicAddress

	hash, err := p.SigningHash(k.PublicKey)
	if err != nil {
		return nil, fmt.Errorf("building signing hash: %w", err)
	}

	// dcrd's Sign is deterministic (RFC 6979) and already returns a canonical
	// low-S signature, which is what XRPL's fully-canonical-signature rule wants.
	signature := ecdsa.Sign(k.priv, hash).Serialize()

	signed, err := p.serialize(k.PublicKey, signature)
	if err != nil {
		return nil, fmt.Errorf("serializing signed transaction: %w", err)
	}

	txHash := sha512Half(withPrefix(prefixTransactionID, signed))

	return &SignedPayment{
		TxBlob:        upperHex(signed),
		Hash:          upperHex(txHash),
		SigningPubKey: upperHex(k.PublicKey),
		TxnSignature:  upperHex(signature),
	}, nil
}

// VerifySignature checks a DER signature against a payment and public key. The
// enclave does not need this to operate, but signing code that cannot be verified in
// a test is signing code nobody should trust.
func VerifySignature(p *Payment, signingPubKey, signature []byte) (bool, error) {
	hash, err := p.SigningHash(signingPubKey)
	if err != nil {
		return false, err
	}
	sig, err := ecdsa.ParseDERSignature(signature)
	if err != nil {
		return false, fmt.Errorf("parsing DER signature: %w", err)
	}
	pub, err := parsePubKey(signingPubKey)
	if err != nil {
		return false, err
	}
	return sig.Verify(hash, pub), nil
}

// upperHex matches XRPL's convention of uppercase hex in JSON-RPC payloads.
func upperHex(b []byte) string {
	return strings.ToUpper(hex.EncodeToString(b))
}
