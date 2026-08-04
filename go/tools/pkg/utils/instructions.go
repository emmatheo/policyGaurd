// Package utils wraps the PolicyGuard InstructionSender contract calls used by the
// deploy and test tooling.
package utils

import (
	"context"
	"math/big"
	"os"
	"time"

	"policyguard-extension/tools/pkg/contracts/policyguard"
	"policyguard-extension/tools/pkg/fccutils"
	"policyguard-extension/tools/pkg/support"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/pkg/errors"
)

// DefaultFee is the default fee paid with each instruction. The registry's minimum
// is 1000 wei; this is generously above it so a fee-schedule change does not break
// the demo. Override via FEE_WEI.
var DefaultFee = big.NewInt(1_000_000_000_000)

func init() {
	if feeStr := os.Getenv("FEE_WEI"); feeStr != "" {
		if fee, ok := new(big.Int).SetString(feeStr, 10); ok {
			DefaultFee = fee
		}
	}
}

// DeployInstructionSender deploys the PolicyGuard InstructionSender contract and
// returns its address.
func DeployInstructionSender(s *support.Support) (common.Address, *policyguard.InstructionSender, error) {
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Address{}, nil, errors.Errorf("failed to create transactor: %s", err)
	}

	// Both registry args are the FlareTeeManager diamond proxy: the diamond
	// routes ExtensionManager and MachineManager calls to the right facets.
	address, tx, contract, err := policyguard.DeployInstructionSender(
		opts, s.ChainClient, s.Addresses.FlareTeeManager, s.Addresses.FlareTeeManager,
	)
	if err != nil {
		return common.Address{}, nil, errors.Errorf("failed to deploy contract: %s", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	receipt, err := bind.WaitMined(ctx, s.ChainClient, tx)
	if err != nil {
		return common.Address{}, nil, errors.Errorf(
			"deployment tx not mined within 2 minutes (tx: %s): %s", tx.Hash().Hex(), err)
	}

	if receipt.Status != types.ReceiptStatusSuccessful {
		return common.Address{}, nil, errors.New("contract deployment failed")
	}

	return address, contract, nil
}

// SetExtensionId calls setExtensionId on the InstructionSender contract.
func SetExtensionId(s *support.Support, instructionSenderAddress common.Address) error {
	sender, err := policyguard.NewInstructionSender(instructionSenderAddress, s.ChainClient)
	if err != nil {
		return errors.Errorf("failed to bind contract: %s", err)
	}

	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return errors.Errorf("failed to create transactor: %s", err)
	}

	tx, err := sender.SetExtensionId(opts)
	if err != nil {
		return errors.Errorf("failed to call setExtensionId: %s",
			describeFailure(s, instructionSenderAddress, nil, "setExtensionId", err))
	}

	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return errors.Errorf("failed waiting for transaction: %s", err)
	}
	if receipt.Status != types.ReceiptStatusSuccessful {
		return errors.Errorf("setExtensionId transaction failed: %s",
			describeFailure(s, instructionSenderAddress, nil, "setExtensionId", nil))
	}

	return nil
}

// SendCreateWallet registers a new policy-controlled wallet and dispatches the
// WALLET/CREATE instruction. Returns (instructionId, txHash, walletId).
func SendCreateWallet(s *support.Support, instructionSenderAddress common.Address) (common.Hash, common.Hash, uint64, error) {
	sender, err := policyguard.NewInstructionSender(instructionSenderAddress, s.ChainClient)
	if err != nil {
		return common.Hash{}, common.Hash{}, 0, errors.Errorf("failed to bind contract: %s", err)
	}

	// createWallet returns the new id, but a state-changing call only yields a
	// receipt. Reading nextWalletId first gives the id the transaction will assign.
	walletID, err := sender.NextWalletId(&bind.CallOpts{})
	if err != nil {
		return common.Hash{}, common.Hash{}, 0, errors.Errorf("failed to read nextWalletId: %s", err)
	}

	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Hash{}, common.Hash{}, 0, errors.Errorf("failed to create transactor: %s", err)
	}
	opts.Value = DefaultFee

	tx, err := sender.CreateWallet(opts)
	if err != nil {
		return common.Hash{}, common.Hash{}, 0, errors.Errorf("failed to send createWallet: %s",
			describeFailure(s, instructionSenderAddress, DefaultFee, "createWallet", err))
	}

	instructionID, txHash, err := waitForInstruction(s, tx, "createWallet")
	return instructionID, txHash, walletID, err
}

// SendSetDailyLimit updates a wallet's rolling 24h limit and dispatches the
// POLICY/SET_LIMIT instruction. Returns (instructionId, txHash).
func SendSetDailyLimit(
	s *support.Support,
	instructionSenderAddress common.Address,
	walletID, limitDrops uint64,
) (common.Hash, common.Hash, error) {
	sender, err := policyguard.NewInstructionSender(instructionSenderAddress, s.ChainClient)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to bind contract: %s", err)
	}

	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to create transactor: %s", err)
	}
	opts.Value = DefaultFee

	tx, err := sender.SetDailyLimit(opts, walletID, limitDrops)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to send setDailyLimit: %s",
			describeFailure(s, instructionSenderAddress, DefaultFee, "setDailyLimit", err, walletID, limitDrops))
	}

	return waitForInstruction(s, tx, "setDailyLimit")
}

// PaymentParams describes an XRPL payment to submit for policy evaluation.
type PaymentParams struct {
	WalletID           uint64
	Destination        string
	AmountDrops        uint64
	Sequence           uint32
	FeeDrops           uint32
	LastLedgerSequence uint32
	DestinationTag     uint32
}

// SendRequestPayment dispatches the PAYMENT/REQUEST instruction. Returns
// (instructionId, txHash, requestId).
func SendRequestPayment(
	s *support.Support,
	instructionSenderAddress common.Address,
	p PaymentParams,
) (common.Hash, common.Hash, uint64, error) {
	sender, err := policyguard.NewInstructionSender(instructionSenderAddress, s.ChainClient)
	if err != nil {
		return common.Hash{}, common.Hash{}, 0, errors.Errorf("failed to bind contract: %s", err)
	}

	requestID, err := sender.NextRequestId(&bind.CallOpts{})
	if err != nil {
		return common.Hash{}, common.Hash{}, 0, errors.Errorf("failed to read nextRequestId: %s", err)
	}

	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Hash{}, common.Hash{}, 0, errors.Errorf("failed to create transactor: %s", err)
	}
	opts.Value = DefaultFee

	tx, err := sender.RequestPayment(
		opts,
		p.WalletID,
		p.Destination,
		p.AmountDrops,
		p.Sequence,
		p.FeeDrops,
		p.LastLedgerSequence,
		p.DestinationTag,
	)
	if err != nil {
		return common.Hash{}, common.Hash{}, 0, errors.Errorf("failed to send requestPayment: %s",
			describeFailure(s, instructionSenderAddress, DefaultFee, "requestPayment", err,
				p.WalletID, p.Destination, p.AmountDrops, p.Sequence, p.FeeDrops,
				p.LastLedgerSequence, p.DestinationTag))
	}

	instructionID, txHash, err := waitForInstruction(s, tx, "requestPayment")
	return instructionID, txHash, requestID, err
}

// waitForInstruction mines the transaction and extracts the instruction id from the
// TeeInstructionsSent event.
func waitForInstruction(s *support.Support, tx *types.Transaction, label string) (common.Hash, common.Hash, error) {
	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed waiting for transaction: %s", err)
	}
	if receipt.Status != types.ReceiptStatusSuccessful {
		return common.Hash{}, common.Hash{}, errors.Errorf("%s transaction failed with status: %d", label, receipt.Status)
	}

	// PolicyGuard emits its own event before dispatching, so the registry's
	// TeeInstructionsSent is not necessarily the first log. Scan for the one that
	// parses rather than assuming a position.
	for _, log := range receipt.Logs {
		instructionSent, err := s.TeeVerification.ParseTeeInstructionsSent(*log)
		if err == nil {
			return instructionSent.InstructionId, receipt.TxHash, nil
		}
	}
	return common.Hash{}, common.Hash{}, errors.Errorf(
		"no TeeInstructionsSent event found in the %s receipt (%d logs)", label, len(receipt.Logs))
}

// describeFailure enriches a contract-call error with a decoded revert reason.
// Reverts from the FCC registry are otherwise opaque, and the reason is usually the
// whole answer ("Extension ID is not set", "MachineManager.TooMany").
func describeFailure(
	s *support.Support,
	contract common.Address,
	value *big.Int,
	method string,
	cause error,
	args ...interface{},
) string {
	reason := ""
	if cause != nil {
		reason = fccutils.DecodeRevertReason(cause)
	}
	if reason == "" {
		if parsed, err := policyguard.InstructionSenderMetaData.GetAbi(); err == nil && parsed != nil {
			if callData, packErr := parsed.Pack(method, args...); packErr == nil {
				from := crypto.PubkeyToAddress(s.Prv.PublicKey)
				reason = fccutils.SimulateAndDecodeRevert(s.ChainClient, from, contract, value, callData)
			}
		}
	}

	switch {
	case cause != nil && reason != "":
		return cause.Error() + " (revert reason: " + reason + ")"
	case cause != nil:
		return cause.Error()
	case reason != "":
		return "revert reason: " + reason
	default:
		return "no revert reason available"
	}
}
