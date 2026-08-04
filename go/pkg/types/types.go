// Package types contains types that could be useful to other apps when interacting
// with the PolicyGuard extension.
package types

import "github.com/ethereum/go-ethereum/common"

// WalletState is the publicly observable state of one policy-controlled wallet.
//
// Everything here is safe to publish. The signing key is deliberately absent and has
// no accessor anywhere in the extension: the classic address and public key are the
// only parts of an XRPL identity that ever need to leave the enclave.
type WalletState struct {
	// WalletID is the id assigned by the InstructionSender contract.
	WalletID uint64 `json:"walletId"`
	// ClassicAddress is the XRPL r... address derived in-enclave.
	ClassicAddress string `json:"classicAddress"`
	// DailyLimitDrops is the rolling 24h limit currently enforced.
	DailyLimitDrops uint64 `json:"dailyLimitDrops"`
	// SpentDrops is how much of the window has been consumed as of the report.
	SpentDrops uint64 `json:"spentDrops"`
	// RemainingDrops is what is left in the current window.
	RemainingDrops uint64 `json:"remainingDrops"`
	// PaymentsSigned counts the payments this wallet has had approved.
	PaymentsSigned uint64 `json:"paymentsSigned"`
	// PaymentsRefused counts the requests refused by policy.
	PaymentsRefused uint64 `json:"paymentsRefused"`
}

// State holds the extension's observable state, returned by GET /state.
type State struct {
	// PolicyWindowHours is the width of the rolling spending window.
	PolicyWindowHours int `json:"policyWindowHours"`
	// Wallets lists every wallet the enclave manages, ordered by wallet id.
	Wallets []WalletState `json:"wallets"`
}

// --- DO NOT MODIFY below this line. ---

// StateResponse is the envelope returned by GET /state.
type StateResponse struct {
	StateVersion common.Hash `json:"stateVersion"`
	State        State       `json:"state"`
}
