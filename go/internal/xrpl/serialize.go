package xrpl

import (
	"encoding/binary"
	"fmt"
	"sort"
)

// XRPL canonical binary serialization for the subset of fields a Payment needs.
//
// The ledger recomputes this encoding from the transaction it receives and checks the
// signature against it, so the bytes produced here must match rippled exactly. Two
// rules carry all the risk:
//
//  1. Fields are emitted in ascending (typeCode, fieldCode) order, never in the order
//     the caller supplied them.
//  2. The signed payload omits TxnSignature but includes SigningPubKey.
//
// Getting either wrong produces a transaction that looks fine locally and is rejected
// by every validator, so both are covered by round-trip tests.

// XRPL type codes for the field types used here.
const (
	typeUInt16    = 1
	typeUInt32    = 2
	typeAmount    = 6
	typeBlob      = 7
	typeAccountID = 8
)

// Field codes, as defined in rippled's definitions.json.
const (
	fieldTransactionType    = 2
	fieldFlags              = 2
	fieldSequence           = 4
	fieldDestinationTag     = 14
	fieldLastLedgerSequence = 27
	fieldAmount             = 1
	fieldFee                = 8
	fieldSigningPubKey      = 3
	fieldTxnSignature       = 4
	fieldAccount            = 1
	fieldDestination        = 3
)

// txTypePayment is the TransactionType enum value for Payment.
const txTypePayment uint16 = 0

// posBit marks an XRP amount as positive. XRPL amounts use bit 63 to mean
// "issued currency" and bit 62 to mean "positive"; a drops amount is therefore
// always OR'd with 0x4000000000000000.
const posBit uint64 = 0x4000000000000000

// maxDrops is the total XRP supply in drops. Any larger value is not representable
// as an XRP amount and would be misread as an issued-currency amount.
const maxDrops uint64 = 100_000_000_000 * 1_000_000

// Payment is an XRPL Payment transaction in the shape PolicyGuard can build.
//
// Only the fields needed for a plain XRP-to-XRP transfer are modelled; paths,
// issued currencies, and partial payments are out of scope.
type Payment struct {
	// Account is the sender's classic address (the enclave-held wallet).
	Account string
	// Destination is the recipient's classic address.
	Destination string
	// AmountDrops is the amount to deliver, in drops.
	AmountDrops uint64
	// FeeDrops is the network fee, in drops.
	FeeDrops uint64
	// Sequence is the sender's next account sequence number.
	Sequence uint32
	// LastLedgerSequence bounds how long the transaction stays valid. Zero omits
	// the field, which makes the transaction valid indefinitely — undesirable, but
	// permitted by the protocol.
	LastLedgerSequence uint32
	// DestinationTag identifies a sub-account at the destination. Zero omits the
	// field, matching the convention that tag 0 and "no tag" are equivalent.
	DestinationTag uint32
	// Flags is the transaction flags bitfield.
	Flags uint32
}

// field is one serialized field, kept with its sort key so the whole set can be
// ordered canonically before being written out.
type field struct {
	typeCode  uint8
	fieldCode uint8
	payload   []byte
}

// encodeFieldID writes the field header. Both nibbles fit in one byte when the type
// and field codes are each below 16; otherwise the low nibble is zero and the field
// code follows in its own byte. Every type used here is below 16, so the third
// rippled case (uncommon type) cannot arise.
func encodeFieldID(typeCode, fieldCode uint8) []byte {
	if fieldCode < 16 {
		return []byte{typeCode<<4 | fieldCode}
	}
	return []byte{typeCode << 4, fieldCode}
}

// encodeVL writes a variable-length prefix using XRPL's three-tier scheme.
func encodeVL(length int) ([]byte, error) {
	switch {
	case length <= 192:
		return []byte{uint8(length)}, nil
	case length <= 12480:
		l := length - 193
		return []byte{uint8(193 + (l >> 8)), uint8(l & 0xFF)}, nil
	case length <= 918744:
		l := length - 12481
		return []byte{uint8(241 + (l >> 16)), uint8((l >> 8) & 0xFF), uint8(l & 0xFF)}, nil
	default:
		return nil, fmt.Errorf("xrpl: field of %d bytes exceeds the maximum variable length", length)
	}
}

func uint16Field(typeCode, fieldCode uint8, v uint16) field {
	var b [2]byte
	binary.BigEndian.PutUint16(b[:], v)
	return field{typeCode, fieldCode, b[:]}
}

func uint32Field(typeCode, fieldCode uint8, v uint32) field {
	var b [4]byte
	binary.BigEndian.PutUint32(b[:], v)
	return field{typeCode, fieldCode, b[:]}
}

func amountField(fieldCode uint8, drops uint64) (field, error) {
	if drops > maxDrops {
		return field{}, fmt.Errorf("xrpl: %d drops exceeds the total XRP supply", drops)
	}
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], drops|posBit)
	return field{typeAmount, fieldCode, b[:]}, nil
}

func blobField(fieldCode uint8, data []byte) (field, error) {
	prefix, err := encodeVL(len(data))
	if err != nil {
		return field{}, err
	}
	return field{typeBlob, fieldCode, append(prefix, data...)}, nil
}

// accountField encodes an account ID. Account IDs are always 20 bytes and are
// length-prefixed like a blob.
func accountField(fieldCode uint8, address string) (field, error) {
	accountID, err := DecodeClassicAddress(address)
	if err != nil {
		return field{}, err
	}
	prefix, _ := encodeVL(len(accountID)) // 20 bytes always fits the one-byte tier.
	return field{typeAccountID, fieldCode, append(prefix, accountID...)}, nil
}

// serialize builds the canonical byte encoding of the payment.
//
// signingPubKey is always included. txnSignature is included only when non-nil,
// which is what distinguishes the pre-signing payload from the final blob.
func (p *Payment) serialize(signingPubKey, txnSignature []byte) ([]byte, error) {
	if p.AmountDrops == 0 {
		return nil, fmt.Errorf("xrpl: payment amount must be greater than zero")
	}

	fields := []field{
		uint16Field(typeUInt16, fieldTransactionType, txTypePayment),
		uint32Field(typeUInt32, fieldFlags, p.Flags),
		uint32Field(typeUInt32, fieldSequence, p.Sequence),
	}

	// Tag 0 and "no tag" are treated as the same thing by the network, so omitting
	// the field for 0 keeps the encoding canonical.
	if p.DestinationTag != 0 {
		fields = append(fields, uint32Field(typeUInt32, fieldDestinationTag, p.DestinationTag))
	}
	if p.LastLedgerSequence != 0 {
		fields = append(fields, uint32Field(typeUInt32, fieldLastLedgerSequence, p.LastLedgerSequence))
	}

	amount, err := amountField(fieldAmount, p.AmountDrops)
	if err != nil {
		return nil, fmt.Errorf("encoding Amount: %w", err)
	}
	fields = append(fields, amount)

	fee, err := amountField(fieldFee, p.FeeDrops)
	if err != nil {
		return nil, fmt.Errorf("encoding Fee: %w", err)
	}
	fields = append(fields, fee)

	pubKeyField, err := blobField(fieldSigningPubKey, signingPubKey)
	if err != nil {
		return nil, fmt.Errorf("encoding SigningPubKey: %w", err)
	}
	fields = append(fields, pubKeyField)

	if txnSignature != nil {
		sigField, err := blobField(fieldTxnSignature, txnSignature)
		if err != nil {
			return nil, fmt.Errorf("encoding TxnSignature: %w", err)
		}
		fields = append(fields, sigField)
	}

	account, err := accountField(fieldAccount, p.Account)
	if err != nil {
		return nil, fmt.Errorf("encoding Account: %w", err)
	}
	fields = append(fields, account)

	destination, err := accountField(fieldDestination, p.Destination)
	if err != nil {
		return nil, fmt.Errorf("encoding Destination: %w", err)
	}
	fields = append(fields, destination)

	// Canonical order: ascending type code, then ascending field code.
	sort.SliceStable(fields, func(i, j int) bool {
		if fields[i].typeCode != fields[j].typeCode {
			return fields[i].typeCode < fields[j].typeCode
		}
		return fields[i].fieldCode < fields[j].fieldCode
	})

	var out []byte
	for _, f := range fields {
		out = append(out, encodeFieldID(f.typeCode, f.fieldCode)...)
		out = append(out, f.payload...)
	}
	return out, nil
}
