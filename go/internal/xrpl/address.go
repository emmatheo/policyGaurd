// Package xrpl implements the parts of the XRP Ledger protocol the PolicyGuard
// enclave needs: keypair generation, classic-address derivation, canonical binary
// serialization of a Payment transaction, and transaction signing.
//
// It deliberately has no network client. The enclave's only job is to decide whether
// a payment is permitted and, if so, to produce a signed transaction blob. Handing
// that blob to the XRP Ledger is the caller's business and happens entirely outside
// the trust boundary — which is the point, since a signed blob reveals nothing about
// the key that produced it.
package xrpl

import (
	"crypto/sha256"
	"fmt"

	secp256k1 "github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// AccountIDLen is the length of a decoded XRPL account identifier.
const AccountIDLen = 20

// Keypair is an XRPL signing identity held inside the enclave.
//
// XRPL wallets are normally derived from a 16-byte seed via the family generator, and
// the seed is what a user backs up. PolicyGuard has no seed on purpose: the key is
// generated from the enclave's CSPRNG and never leaves, so there is nothing to back
// up and nothing to steal. XRPL derives the account address from the public key
// alone, so a directly generated secp256k1 keypair is a first-class XRPL identity.
type Keypair struct {
	priv *secp256k1.PrivateKey

	// PublicKey is the 33-byte compressed secp256k1 public key, which is what goes
	// into the transaction's SigningPubKey field.
	PublicKey []byte

	// AccountID is RIPEMD160(SHA256(PublicKey)).
	AccountID []byte

	// ClassicAddress is the base58check form of AccountID (the familiar r... string).
	ClassicAddress string
}

// GenerateKeypair creates a new XRPL identity using crypto/rand.
//
// The returned Keypair holds the only copy of the secret. There is no method on this
// type that exports it, and callers outside this package cannot reach the field.
func GenerateKeypair() (*Keypair, error) {
	priv, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		return nil, fmt.Errorf("generating secp256k1 key: %w", err)
	}
	return keypairFromPrivate(priv), nil
}

// keypairFromPrivate derives the public parts of an identity from a secret.
func keypairFromPrivate(priv *secp256k1.PrivateKey) *Keypair {
	pub := priv.PubKey().SerializeCompressed()
	accountID := AccountIDFromPublicKey(pub)
	return &Keypair{
		priv:           priv,
		PublicKey:      pub,
		AccountID:      accountID,
		ClassicAddress: EncodeClassicAddress(accountID),
	}
}

// AccountIDFromPublicKey computes RIPEMD160(SHA256(pubKey)).
func AccountIDFromPublicKey(pubKey []byte) []byte {
	sum := sha256.Sum256(pubKey)
	return ripemd160(sum[:])
}

// EncodeClassicAddress renders a 20-byte account ID as an r... address.
func EncodeClassicAddress(accountID []byte) string {
	return base58CheckEncode(prefixAccountID, accountID)
}

// DecodeClassicAddress parses an r... address back to its 20-byte account ID,
// rejecting anything with a bad checksum, wrong version byte, or wrong length.
//
// Payment destinations arrive from off-chain callers, so this is a trust boundary:
// a malformed or truncated address must fail loudly rather than produce a
// transaction that burns XRP into an unspendable account.
func DecodeClassicAddress(address string) ([]byte, error) {
	if address == "" {
		return nil, fmt.Errorf("xrpl: empty address")
	}
	accountID, err := base58CheckDecode(address, prefixAccountID)
	if err != nil {
		return nil, err
	}
	if len(accountID) != AccountIDLen {
		return nil, fmt.Errorf("xrpl: account id is %d bytes, want %d", len(accountID), AccountIDLen)
	}
	return accountID, nil
}
