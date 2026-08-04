// Package protocol defines the ABI encoding of every message exchanged between the
// PolicyGuard InstructionSender contract and the TEE extension.
//
// This is the single source of truth for that encoding. The enclave uses it to decode
// instructions and encode verdicts; clients use it to decode verdicts. Keeping both
// directions here means a change to the wire format is one edit, not three that have
// to be kept in step — the compiler cannot check an ABI schema, so the only defence
// is not writing it down twice.
//
// Each argument list mirrors an abi.encode(...) call in contracts/InstructionSender.sol,
// in the same order. Editing one without the other is what the round-trip tests catch.
package protocol

import (
	"fmt"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

// mustType builds an ABI type from a constant type string. The inputs are compile-time
// constants, so a failure is a programming error rather than a runtime condition.
func mustType(t string) abi.Type {
	typ, err := abi.NewType(t, "", nil)
	if err != nil {
		panic(fmt.Sprintf("protocol: invalid ABI type %q: %v", t, err))
	}
	return typ
}

var (
	typeUint64  = mustType("uint64")
	typeUint32  = mustType("uint32")
	typeString  = mustType("string")
	typeBytes   = mustType("bytes")
	typeBytes32 = mustType("bytes32")
	typeBool    = mustType("bool")
	typeAddress = mustType("address")
)

// --- WALLET / CREATE -------------------------------------------------------

// createRequestArgs matches abi.encode(walletId, owner) in createWallet().
var createRequestArgs = abi.Arguments{
	{Name: "walletId", Type: typeUint64},
	{Name: "owner", Type: typeAddress},
}

// createResponseArgs is what the enclave returns: the public half of the identity it
// generated. The secret has no representation here by design.
var createResponseArgs = abi.Arguments{
	{Name: "walletId", Type: typeUint64},
	{Name: "classicAddress", Type: typeString},
	{Name: "publicKey", Type: typeBytes},
}

// CreateRequest is a decoded WALLET/CREATE instruction.
type CreateRequest struct {
	WalletID uint64
	Owner    common.Address
}

// CreateResponse is the enclave's answer to WALLET/CREATE.
type CreateResponse struct {
	WalletID       uint64
	ClassicAddress string
	PublicKey      []byte
}

// DecodeCreateRequest parses a WALLET/CREATE instruction message.
func DecodeCreateRequest(data []byte) (*CreateRequest, error) {
	values, err := unpack(createRequestArgs, data, "CREATE request")
	if err != nil {
		return nil, err
	}
	req := &CreateRequest{}
	if err := assign(&req.WalletID, values[0], "walletId"); err != nil {
		return nil, err
	}
	if err := assign(&req.Owner, values[1], "owner"); err != nil {
		return nil, err
	}
	return req, nil
}

// EncodeCreateRequest builds a WALLET/CREATE instruction message.
func EncodeCreateRequest(r *CreateRequest) ([]byte, error) {
	return createRequestArgs.Pack(r.WalletID, r.Owner)
}

// EncodeCreateResponse builds the enclave's WALLET/CREATE result.
func EncodeCreateResponse(r *CreateResponse) ([]byte, error) {
	return createResponseArgs.Pack(r.WalletID, r.ClassicAddress, r.PublicKey)
}

// DecodeCreateResponse parses the enclave's WALLET/CREATE result.
func DecodeCreateResponse(data []byte) (*CreateResponse, error) {
	values, err := unpack(createResponseArgs, data, "CREATE response")
	if err != nil {
		return nil, err
	}
	resp := &CreateResponse{}
	if err := assign(&resp.WalletID, values[0], "walletId"); err != nil {
		return nil, err
	}
	if err := assign(&resp.ClassicAddress, values[1], "classicAddress"); err != nil {
		return nil, err
	}
	if err := assign(&resp.PublicKey, values[2], "publicKey"); err != nil {
		return nil, err
	}
	return resp, nil
}

// --- POLICY / SET_LIMIT ----------------------------------------------------

// setLimitArgs matches abi.encode(walletId, limitDrops) in setDailyLimit(), and is
// reused for the response, which echoes the applied limit.
var setLimitArgs = abi.Arguments{
	{Name: "walletId", Type: typeUint64},
	{Name: "limitDrops", Type: typeUint64},
}

// SetLimitRequest is a decoded POLICY/SET_LIMIT instruction. The response has the
// same shape: the enclave echoes back the limit it applied.
type SetLimitRequest struct {
	WalletID   uint64
	LimitDrops uint64
}

// SetLimitResponse is the enclave's answer to POLICY/SET_LIMIT.
type SetLimitResponse = SetLimitRequest

// DecodeSetLimitRequest parses a POLICY/SET_LIMIT instruction message.
func DecodeSetLimitRequest(data []byte) (*SetLimitRequest, error) {
	values, err := unpack(setLimitArgs, data, "SET_LIMIT request")
	if err != nil {
		return nil, err
	}
	req := &SetLimitRequest{}
	if err := assign(&req.WalletID, values[0], "walletId"); err != nil {
		return nil, err
	}
	if err := assign(&req.LimitDrops, values[1], "limitDrops"); err != nil {
		return nil, err
	}
	return req, nil
}

// EncodeSetLimitRequest builds a POLICY/SET_LIMIT instruction message.
func EncodeSetLimitRequest(r *SetLimitRequest) ([]byte, error) {
	return setLimitArgs.Pack(r.WalletID, r.LimitDrops)
}

// EncodeSetLimitResponse builds the enclave's POLICY/SET_LIMIT result.
func EncodeSetLimitResponse(r *SetLimitResponse) ([]byte, error) {
	return setLimitArgs.Pack(r.WalletID, r.LimitDrops)
}

// DecodeSetLimitResponse parses the enclave's POLICY/SET_LIMIT result.
func DecodeSetLimitResponse(data []byte) (*SetLimitResponse, error) {
	return DecodeSetLimitRequest(data)
}

// --- PAYMENT / REQUEST -----------------------------------------------------

// paymentRequestArgs matches the abi.encode(...) in requestPayment().
var paymentRequestArgs = abi.Arguments{
	{Name: "walletId", Type: typeUint64},
	{Name: "requestId", Type: typeUint64},
	{Name: "destination", Type: typeString},
	{Name: "amountDrops", Type: typeUint64},
	{Name: "limitDrops", Type: typeUint64},
	{Name: "sequence", Type: typeUint32},
	{Name: "feeDrops", Type: typeUint32},
	{Name: "lastLedgerSequence", Type: typeUint32},
	{Name: "destinationTag", Type: typeUint32},
	{Name: "requestedAt", Type: typeUint64},
}

// paymentResponseArgs carries the verdict back on-chain.
//
// A refusal is encoded as a successful result with Approved=false and an empty blob,
// not as an error. The distinction matters: "the policy said no" is an answer the
// caller asked for and can act on, while an error means the enclave could not reach a
// verdict at all.
var paymentResponseArgs = abi.Arguments{
	{Name: "requestId", Type: typeUint64},
	{Name: "approved", Type: typeBool},
	{Name: "reason", Type: typeString},
	{Name: "signedTxBlob", Type: typeBytes},
	{Name: "txHash", Type: typeBytes32},
	{Name: "limitDrops", Type: typeUint64},
	{Name: "spentDrops", Type: typeUint64},
	{Name: "remainingDrops", Type: typeUint64},
}

// PaymentRequest is a decoded PAYMENT/REQUEST instruction.
type PaymentRequest struct {
	WalletID           uint64
	RequestID          uint64
	Destination        string
	AmountDrops        uint64
	LimitDrops         uint64
	Sequence           uint32
	FeeDrops           uint32
	LastLedgerSequence uint32
	DestinationTag     uint32
	RequestedAt        uint64
}

// PaymentResponse is the enclave's verdict on a payment request.
type PaymentResponse struct {
	RequestID      uint64
	Approved       bool
	Reason         string
	SignedTxBlob   []byte
	TxHash         common.Hash
	LimitDrops     uint64
	SpentDrops     uint64
	RemainingDrops uint64
}

// DecodePaymentRequest parses a PAYMENT/REQUEST instruction message.
func DecodePaymentRequest(data []byte) (*PaymentRequest, error) {
	values, err := unpack(paymentRequestArgs, data, "PAYMENT request")
	if err != nil {
		return nil, err
	}

	req := &PaymentRequest{}
	targets := []struct {
		dst  interface{}
		name string
	}{
		{&req.WalletID, "walletId"},
		{&req.RequestID, "requestId"},
		{&req.Destination, "destination"},
		{&req.AmountDrops, "amountDrops"},
		{&req.LimitDrops, "limitDrops"},
		{&req.Sequence, "sequence"},
		{&req.FeeDrops, "feeDrops"},
		{&req.LastLedgerSequence, "lastLedgerSequence"},
		{&req.DestinationTag, "destinationTag"},
		{&req.RequestedAt, "requestedAt"},
	}
	for i, t := range targets {
		if err := assign(t.dst, values[i], t.name); err != nil {
			return nil, err
		}
	}
	return req, nil
}

// EncodePaymentRequest builds a PAYMENT/REQUEST instruction message.
func EncodePaymentRequest(r *PaymentRequest) ([]byte, error) {
	return paymentRequestArgs.Pack(
		r.WalletID, r.RequestID, r.Destination, r.AmountDrops, r.LimitDrops,
		r.Sequence, r.FeeDrops, r.LastLedgerSequence, r.DestinationTag, r.RequestedAt,
	)
}

// EncodePaymentResponse builds the enclave's PAYMENT/REQUEST verdict.
func EncodePaymentResponse(r *PaymentResponse) ([]byte, error) {
	blob := r.SignedTxBlob
	if blob == nil {
		blob = []byte{}
	}
	return paymentResponseArgs.Pack(
		r.RequestID, r.Approved, r.Reason, blob, [32]byte(r.TxHash),
		r.LimitDrops, r.SpentDrops, r.RemainingDrops,
	)
}

// DecodePaymentResponse parses the enclave's PAYMENT/REQUEST verdict.
func DecodePaymentResponse(data []byte) (*PaymentResponse, error) {
	values, err := unpack(paymentResponseArgs, data, "PAYMENT response")
	if err != nil {
		return nil, err
	}

	resp := &PaymentResponse{}
	targets := []struct {
		dst  interface{}
		name string
	}{
		{&resp.RequestID, "requestId"},
		{&resp.Approved, "approved"},
		{&resp.Reason, "reason"},
		{&resp.SignedTxBlob, "signedTxBlob"},
		{&resp.TxHash, "txHash"},
		{&resp.LimitDrops, "limitDrops"},
		{&resp.SpentDrops, "spentDrops"},
		{&resp.RemainingDrops, "remainingDrops"},
	}
	for i, t := range targets {
		if err := assign(t.dst, values[i], t.name); err != nil {
			return nil, err
		}
	}
	return resp, nil
}

// --- shared decoding helpers ----------------------------------------------

// unpack decodes data and checks the field count, so a truncated or mismatched
// payload fails with a message naming the message type rather than panicking on an
// index further down.
func unpack(args abi.Arguments, data []byte, what string) ([]interface{}, error) {
	values, err := args.Unpack(data)
	if err != nil {
		return nil, fmt.Errorf("decoding %s: %w", what, err)
	}
	if len(values) != len(args) {
		return nil, fmt.Errorf("decoding %s: got %d fields, want %d", what, len(values), len(args))
	}
	return values, nil
}

// assign type-asserts a decoded ABI value into a typed destination, reporting the
// field name on mismatch. A mismatch means the Go schema and the Solidity call have
// drifted apart, which is worth saying plainly.
func assign(dst interface{}, value interface{}, name string) error {
	switch d := dst.(type) {
	case *uint64:
		v, ok := value.(uint64)
		if !ok {
			return typeErr(name, value, "uint64")
		}
		*d = v
	case *uint32:
		v, ok := value.(uint32)
		if !ok {
			return typeErr(name, value, "uint32")
		}
		*d = v
	case *bool:
		v, ok := value.(bool)
		if !ok {
			return typeErr(name, value, "bool")
		}
		*d = v
	case *string:
		v, ok := value.(string)
		if !ok {
			return typeErr(name, value, "string")
		}
		*d = v
	case *[]byte:
		v, ok := value.([]byte)
		if !ok {
			return typeErr(name, value, "bytes")
		}
		*d = v
	case *common.Address:
		v, ok := value.(common.Address)
		if !ok {
			return typeErr(name, value, "address")
		}
		*d = v
	case *common.Hash:
		v, ok := value.([32]byte)
		if !ok {
			return typeErr(name, value, "bytes32")
		}
		*d = common.Hash(v)
	default:
		return fmt.Errorf("protocol: no decoder for destination type %T (field %q)", dst, name)
	}
	return nil
}

func typeErr(name string, value interface{}, want string) error {
	return fmt.Errorf("field %q decoded as %T, want %s", name, value, want)
}
