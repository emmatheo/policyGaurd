// Package config contains configuration values and defaults used by the extension.
package config

import (
	"os"
	"strconv"
	"time"
)

const (
	// Version is the extension's SemVer version. Bump it whenever handler behaviour
	// or the instruction encoding changes — it is reported as the state version and
	// is what an on-chain consumer uses to know which contract it is talking to.
	Version = "0.1.0"

	// OPType and OPCommand strings.
	//
	// These MUST match the bytes32 constants in contracts/InstructionSender.sol
	// exactly. Solidity writes bytes32("WALLET"); the router compares
	// teeutils.ToHash("WALLET"). A mismatch shows up at runtime as
	// "unsupported op type" rather than at build time, so treat these as a
	// cross-language contract.
	OPTypeWallet  = "WALLET"
	OPTypePolicy  = "POLICY"
	OPTypePayment = "PAYMENT"

	OPCommandCreate   = "CREATE"
	OPCommandSetLimit = "SET_LIMIT"
	OPCommandRequest  = "REQUEST"

	// PolicyWindow is the width of the rolling spending window. The single policy
	// type in this MVP is "at most X drops per PolicyWindow".
	PolicyWindow = 24 * time.Hour

	TimeoutShutdown = 5 * time.Second
)

// Defaults — overridden by env vars in init().
var (
	ExtensionPort = 7702
	SignPort      = 7701
	ConfigPort    = 5501
)

func init() {
	if v := os.Getenv("EXTENSION_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			ExtensionPort = n
		}
	}
	if v := os.Getenv("SIGN_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			SignPort = n
		}
	}
	if v := os.Getenv("CONFIG_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			ConfigPort = n
		}
	}
}
