//go:generate go run github.com/ethereum/go-ethereum/cmd/abigen --abi=InstructionSender.abi --bin=InstructionSender.bin --pkg=policyguard --type=InstructionSender --out=autogen.go

// Package policyguard holds the generated Go bindings for the PolicyGuard
// InstructionSender contract. Run scripts/generate-bindings.sh after changing
// contracts/InstructionSender.sol — autogen.go is gitignored and regenerated.
package policyguard
