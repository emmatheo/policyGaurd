// Package main runs the PolicyGuard end-to-end test against a deployed
// InstructionSender and a running TEE extension.
//
// It walks the full demo, on-chain, and asserts the outcome of each step:
//
//  1. setExtensionId on the deployed InstructionSender (idempotent)
//  2. createWallet   -> the enclave generates an XRPL keypair and returns the address
//  3. setDailyLimit  -> the enclave stores a 10 XRP rolling limit
//  4. requestPayment -> 4 XRP, under the limit: expect a signed XRPL transaction
//  5. requestPayment -> 25 XRP, over the limit: expect a refusal with a reason
//
// Step 5 is the point of the project, so it asserts a *refusal*, not an error: the
// instruction must succeed and come back with approved=false and an explanation.
package main

import (
	"encoding/hex"
	"flag"
	"os"
	"strings"
	"time"

	"policyguard-extension/internal/xrpl"
	"policyguard-extension/pkg/protocol"
	"policyguard-extension/tools/pkg/configs"
	"policyguard-extension/tools/pkg/fccutils"
	"policyguard-extension/tools/pkg/support"
	instrutils "policyguard-extension/tools/pkg/utils"

	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/pkg/errors"
)

const (
	dropsPerXRP = uint64(1_000_000)

	// dailyLimit is the policy the test configures.
	dailyLimit = 10 * dropsPerXRP
	// allowedAmount sits under the limit and must be signed.
	allowedAmount = 4 * dropsPerXRP
	// blockedAmount sits over the limit and must be refused.
	blockedAmount = 25 * dropsPerXRP

	// testDestination is the XRPL "masterpassphrase" account — a well-known address
	// that is guaranteed to decode cleanly.
	testDestination = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"

	// settleDelay gives the proxy and TEE time to pick up an instruction before the
	// first poll.
	settleDelay = 5 * time.Second
)

func main() {
	af := flag.String("a", configs.AddressesFile, "file with deployed addresses")
	cf := flag.String("c", configs.ChainNodeURL, "chain node url")
	pf := flag.String("p", configs.ExtensionProxyURL, "extension proxy url")
	instructionSenderF := flag.String("instructionSender", os.Getenv("INSTRUCTION_SENDER"),
		"InstructionSender contract address")
	flag.Parse()

	if *instructionSenderF == "" {
		logger.Fatal("--instructionSender flag is required (or set INSTRUCTION_SENDER in .env)")
	}

	instructionSender := common.HexToAddress(*instructionSenderF)

	s, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	// --- Step 1: setExtensionId ---
	logger.Infof("Step 1: Setting extension ID on InstructionSender...")
	if err := instrutils.SetExtensionId(s, instructionSender); err != nil {
		if strings.Contains(err.Error(), "already set") {
			logger.Infof("  Extension ID already set on contract, continuing")
		} else {
			fccutils.FatalWithCause(errors.Errorf(
				"setExtensionId failed — is the extension registered? Check pre-build.sh completed. Error: %s", err))
		}
	} else {
		logger.Infof("  Extension ID set.")
	}

	// --- Step 2: createWallet ---
	logger.Infof("Step 2: Creating a policy-controlled XRPL wallet...")
	createID, _, walletID, err := instrutils.SendCreateWallet(s, instructionSender)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("createWallet: %s", err))
	}
	logger.Infof("  wallet id %d, instruction %s", walletID, createID.Hex())

	createData := awaitResult(*pf, createID, "createWallet")
	created, err := protocol.DecodeCreateResponse(createData)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("decode createWallet result: %s", err))
	}
	logger.Infof("  XRPL address generated in-enclave: %s", created.ClassicAddress)

	if created.WalletID != walletID {
		fccutils.FatalWithCause(errors.Errorf(
			"FAIL: enclave reported wallet id %d, expected %d", created.WalletID, walletID))
	}
	// The address must be derivable from the returned public key, which proves the
	// enclave did not simply echo a value chosen off-chain.
	derived := xrpl.EncodeClassicAddress(xrpl.AccountIDFromPublicKey(created.PublicKey))
	if derived != created.ClassicAddress {
		fccutils.FatalWithCause(errors.Errorf(
			"FAIL: address %s does not derive from the returned public key (got %s)",
			created.ClassicAddress, derived))
	}
	logger.Infof("  address verified against the returned public key")

	// --- Step 3: setDailyLimit ---
	logger.Infof("Step 3: Setting the daily limit to %d XRP...", dailyLimit/dropsPerXRP)
	limitID, _, err := instrutils.SendSetDailyLimit(s, instructionSender, walletID, dailyLimit)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("setDailyLimit: %s", err))
	}

	limitData := awaitResult(*pf, limitID, "setDailyLimit")
	limitResp, err := protocol.DecodeSetLimitResponse(limitData)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("decode setDailyLimit result: %s", err))
	}
	if limitResp.LimitDrops != dailyLimit {
		fccutils.FatalWithCause(errors.Errorf(
			"FAIL: enclave stored a limit of %d drops, expected %d", limitResp.LimitDrops, dailyLimit))
	}
	logger.Infof("  enclave confirmed a limit of %d drops", limitResp.LimitDrops)

	// --- Step 4: an allowed payment ---
	logger.Infof("Step 4: Requesting %d XRP (under the limit)...", allowedAmount/dropsPerXRP)
	allowed := requestPayment(s, instructionSender, *pf, walletID, allowedAmount, 1)

	if !allowed.Approved {
		fccutils.FatalWithCause(errors.Errorf(
			"FAIL: a payment under the limit was refused: %s", allowed.Reason))
	}
	if len(allowed.SignedTxBlob) == 0 {
		fccutils.FatalWithCause(errors.New("FAIL: approved payment came back without a signed transaction"))
	}
	if allowed.TxHash == (common.Hash{}) {
		fccutils.FatalWithCause(errors.New("FAIL: approved payment came back without a transaction hash"))
	}
	logger.Infof("  APPROVED: %s", allowed.Reason)
	logger.Infof("  signed XRPL tx %s (%d bytes)", allowed.TxHash.Hex(), len(allowed.SignedTxBlob))
	logger.Infof("  tx_blob: %s", strings.ToUpper(hex.EncodeToString(allowed.SignedTxBlob)))

	// --- Step 5: a blocked payment ---
	logger.Infof("Step 5: Requesting %d XRP (over the limit)...", blockedAmount/dropsPerXRP)
	blocked := requestPayment(s, instructionSender, *pf, walletID, blockedAmount, 2)

	if blocked.Approved {
		fccutils.FatalWithCause(errors.Errorf(
			"FAIL: a payment of %d drops was approved under a %d drop limit",
			blockedAmount, dailyLimit))
	}
	if len(blocked.SignedTxBlob) != 0 {
		fccutils.FatalWithCause(errors.New("FAIL: a refused payment still returned a signed transaction"))
	}
	if blocked.Reason == "" {
		fccutils.FatalWithCause(errors.New("FAIL: a refused payment came back without a reason"))
	}
	logger.Infof("  REFUSED: %s", blocked.Reason)
	logger.Infof("  remaining allowance: %d drops of %d", blocked.RemainingDrops, blocked.LimitDrops)

	logger.Infof("All tests passed.")
}

// requestPayment sends a payment request and returns the enclave's verdict.
func requestPayment(
	s *support.Support,
	instructionSender common.Address,
	proxyURL string,
	walletID, amountDrops uint64,
	sequence uint32,
) *protocol.PaymentResponse {
	id, _, requestID, err := instrutils.SendRequestPayment(s, instructionSender, instrutils.PaymentParams{
		WalletID:    walletID,
		Destination: testDestination,
		AmountDrops: amountDrops,
		Sequence:    sequence,
		FeeDrops:    12,
		// A generous ceiling: this test never submits to XRPL, so the value only has
		// to be present and plausible.
		LastLedgerSequence: 100_000_000,
	})
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("requestPayment: %s", err))
	}
	logger.Infof("  request id %d, instruction %s", requestID, id.Hex())

	data := awaitResult(proxyURL, id, "requestPayment")
	resp, err := protocol.DecodePaymentResponse(data)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("decode requestPayment result: %s", err))
	}
	if resp.RequestID != requestID {
		fccutils.FatalWithCause(errors.Errorf(
			"FAIL: verdict is for request %d, expected %d", resp.RequestID, requestID))
	}
	return resp
}

// awaitResult polls the proxy for an instruction result and fails the run if the
// enclave could not reach a verdict.
//
// Status 0 is a genuine failure here. A policy refusal arrives as status 1 with
// approved=false, so this check does not swallow the case the test is built around.
func awaitResult(proxyURL string, instructionID common.Hash, label string) []byte {
	time.Sleep(settleDelay)

	resp, err := fccutils.ActionResult(proxyURL, instructionID)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("poll %s: %s", label, err))
	}
	if resp.Result.Status == 0 {
		fccutils.FatalWithCause(errors.Errorf("%s instruction failed: %s", label, resp.Result.Log))
	}
	return resp.Result.Data
}
