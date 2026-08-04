package xrpl

import (
	"fmt"

	secp256k1 "github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// parsePubKey decodes a 33-byte compressed secp256k1 public key.
func parsePubKey(b []byte) (*secp256k1.PublicKey, error) {
	pub, err := secp256k1.ParsePubKey(b)
	if err != nil {
		return nil, fmt.Errorf("xrpl: parsing public key: %w", err)
	}
	return pub, nil
}
