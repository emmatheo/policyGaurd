package extension

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	"policyguard-extension/internal/config"
	"policyguard-extension/internal/policy"
	"policyguard-extension/internal/xrpl"
	"policyguard-extension/pkg/protocol"
	"policyguard-extension/pkg/types"

	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"

	"github.com/flare-foundation/tee-node/pkg/processorutils"
)

// wallet is one policy-controlled XRPL identity held by this enclave.
type wallet struct {
	// keypair holds the signing key. It is reachable only from inside this package
	// and is never serialised, logged, or returned from a handler.
	keypair *xrpl.Keypair

	// owner is the Flare address the InstructionSender recorded as controlling this
	// wallet, kept for the state report.
	owner common.Address

	signed  uint64
	refused uint64
}

// Extension holds the enclave's mutable state.
//
// The framework dispatches actions serially, so handlers do not race each other. The
// mutex exists because GET /state is served concurrently with action processing.
type Extension struct {
	mu     sync.RWMutex
	Server *http.Server

	// signPort is the TEE node's sign/decrypt endpoint. PolicyGuard generates its
	// own keys rather than receiving them, so it is retained only for the node RPCs
	// the framework may need.
	signPort int

	// policy evaluates the spending rules. It is the authority on whether a payment
	// is allowed; the chain publishes the limit, but this is what gates the key.
	policy *policy.Engine

	// wallets maps wallet id to the identity generated for it.
	wallets map[uint64]*wallet

	// now is the clock, indirected so tests can advance the rolling window without
	// sleeping for a day.
	now func() time.Time
}

// --- DO NOT MODIFY: New(), actionHandler() are boilerplate.
func New(extensionPort, signPort int) *Extension {
	e := &Extension{
		signPort: signPort,
		policy:   policy.NewEngine(config.PolicyWindow),
		wallets:  make(map[uint64]*wallet),
		now:      time.Now,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /state", e.stateHandler)
	mux.HandleFunc("POST /action", e.actionHandler)

	e.Server = &http.Server{Addr: fmt.Sprintf(":%d", extensionPort), Handler: mux}
	return e
}

// stateHandler reports the policy posture of every wallet without exposing key material.
func (e *Extension) stateHandler(w http.ResponseWriter, r *http.Request) {
	e.mu.RLock()
	state := e.reportState()
	e.mu.RUnlock()

	stateResponse := types.StateResponse{
		StateVersion: teeutils.ToHash(config.Version),
		State:        state,
	}

	err := json.NewEncoder(w).Encode(stateResponse)
	if err != nil {
		http.Error(w, fmt.Sprintf("sending response: %v", err), http.StatusInternalServerError)
		return
	}
}

// reportState builds the GET /state snapshot. Callers must hold at least a read lock.
func (e *Extension) reportState() types.State {
	now := e.now()

	ids := make([]uint64, 0, len(e.wallets))
	for id := range e.wallets {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	wallets := make([]types.WalletState, 0, len(ids))
	for _, id := range ids {
		w := e.wallets[id]
		limit := e.policy.Limit(id)
		spent := e.policy.Spent(id, now)

		var remaining uint64
		if limit > spent {
			remaining = limit - spent
		}

		wallets = append(wallets, types.WalletState{
			WalletID:        id,
			ClassicAddress:  w.keypair.ClassicAddress,
			DailyLimitDrops: limit,
			SpentDrops:      spent,
			RemainingDrops:  remaining,
			PaymentsSigned:  w.signed,
			PaymentsRefused: w.refused,
		})
	}

	return types.State{
		PolicyWindowHours: int(config.PolicyWindow / time.Hour),
		Wallets:           wallets,
	}
}

func (e *Extension) processAction(action teetypes.Action) (int, []byte) {
	dataFixed, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
	if err != nil {
		return http.StatusBadRequest, []byte(fmt.Sprintf("decoding fixed data: %v", err))
	}

	var result teetypes.ActionResult
	switch dataFixed.OPType {
	case teeutils.ToHash(config.OPTypeWallet):
		result = e.routeWallet(action, dataFixed)
	case teeutils.ToHash(config.OPTypePolicy):
		result = e.routePolicy(action, dataFixed)
	case teeutils.ToHash(config.OPTypePayment):
		result = e.routePayment(action, dataFixed)
	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op type: received %s, expected one of [%s (%s), %s (%s), %s (%s)]",
			dataFixed.OPType.Hex(),
			teeutils.ToHash(config.OPTypeWallet).Hex(), config.OPTypeWallet,
			teeutils.ToHash(config.OPTypePolicy).Hex(), config.OPTypePolicy,
			teeutils.ToHash(config.OPTypePayment).Hex(), config.OPTypePayment,
		))
	}

	body, err := json.Marshal(result)
	if err != nil {
		return http.StatusInternalServerError, []byte(fmt.Sprintf("encoding action result: %v", err))
	}
	return http.StatusOK, body
}

func (e *Extension) routeWallet(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	if df.OPCommand != teeutils.ToHash(config.OPCommandCreate) {
		return buildResult(action, df, nil, 0, fmt.Errorf(
			"unsupported WALLET command %s, expected %s (%s)",
			df.OPCommand.Hex(), teeutils.ToHash(config.OPCommandCreate).Hex(), config.OPCommandCreate,
		))
	}
	return e.processWalletCreate(action, df)
}

func (e *Extension) routePolicy(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	if df.OPCommand != teeutils.ToHash(config.OPCommandSetLimit) {
		return buildResult(action, df, nil, 0, fmt.Errorf(
			"unsupported POLICY command %s, expected %s (%s)",
			df.OPCommand.Hex(), teeutils.ToHash(config.OPCommandSetLimit).Hex(), config.OPCommandSetLimit,
		))
	}
	return e.processPolicySetLimit(action, df)
}

func (e *Extension) routePayment(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	if df.OPCommand != teeutils.ToHash(config.OPCommandRequest) {
		return buildResult(action, df, nil, 0, fmt.Errorf(
			"unsupported PAYMENT command %s, expected %s (%s)",
			df.OPCommand.Hex(), teeutils.ToHash(config.OPCommandRequest).Hex(), config.OPCommandRequest,
		))
	}
	return e.processPaymentRequest(action, df)
}

// processWalletCreate generates a fresh XRPL identity inside the enclave.
//
// This is the step that makes the account keyless: the secret is created here, from
// the enclave's CSPRNG, and the only things that ever leave are the derived address
// and public key. There is no import path and no export path.
func (e *Extension) processWalletCreate(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	req, err := protocol.DecodeCreateRequest(df.OriginalMessage)
	if err != nil {
		return buildResult(action, df, nil, 0, err)
	}
	if req.WalletID == 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("wallet id must be non-zero"))
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	// Creation is idempotent. A redelivered CREATE must return the existing address
	// rather than mint a second key, which would strand any XRP already sent to the
	// first one.
	w, exists := e.wallets[req.WalletID]
	if !exists {
		keypair, genErr := xrpl.GenerateKeypair()
		if genErr != nil {
			return buildResult(action, df, nil, 0, fmt.Errorf("generating XRPL keypair: %v", genErr))
		}
		w = &wallet{keypair: keypair, owner: req.Owner}
		e.wallets[req.WalletID] = w
		e.policy.Register(req.WalletID)

		logger.Infof("created XRPL wallet %d with address %s", req.WalletID, keypair.ClassicAddress)
	} else {
		logger.Infof("wallet %d already exists, returning existing address %s",
			req.WalletID, w.keypair.ClassicAddress)
	}

	encoded, err := protocol.EncodeCreateResponse(&protocol.CreateResponse{
		WalletID:       req.WalletID,
		ClassicAddress: w.keypair.ClassicAddress,
		PublicKey:      w.keypair.PublicKey,
	})
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("encoding response: %v", err))
	}
	return buildResult(action, df, encoded, 1, nil)
}

// processPolicySetLimit updates the rolling 24h limit the enclave enforces.
func (e *Extension) processPolicySetLimit(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	req, err := protocol.DecodeSetLimitRequest(df.OriginalMessage)
	if err != nil {
		return buildResult(action, df, nil, 0, err)
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	if _, ok := e.wallets[req.WalletID]; !ok {
		return buildResult(action, df, nil, 0, fmt.Errorf("unknown wallet id %d", req.WalletID))
	}

	e.policy.SetLimit(req.WalletID, req.LimitDrops)
	logger.Infof("wallet %d daily limit set to %d drops", req.WalletID, req.LimitDrops)

	encoded, err := protocol.EncodeSetLimitResponse(&protocol.SetLimitResponse{
		WalletID:   req.WalletID,
		LimitDrops: req.LimitDrops,
	})
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("encoding response: %v", err))
	}
	return buildResult(action, df, encoded, 1, nil)
}

// processPaymentRequest evaluates the policy and either signs an XRPL Payment or
// refuses with a reason.
//
// Both outcomes are status 1. A refusal is the system working correctly: the caller
// asked whether a payment is permitted and got a definitive, explained answer.
// Status 0 is reserved for cases where no verdict could be reached at all — a
// malformed message, an unknown wallet, a bad destination.
func (e *Extension) processPaymentRequest(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	req, err := protocol.DecodePaymentRequest(df.OriginalMessage)
	if err != nil {
		return buildResult(action, df, nil, 0, err)
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	w, ok := e.wallets[req.WalletID]
	if !ok {
		return buildResult(action, df, nil, 0, fmt.Errorf("unknown wallet id %d", req.WalletID))
	}

	// Instruction delivery is at-least-once. Replaying the stored verdict keeps a
	// duplicate from consuming the daily budget twice.
	if prior, seen := e.policy.Handled(req.WalletID, req.RequestID); seen {
		logger.Infof("payment request %d already handled, replaying stored verdict", req.RequestID)
		return e.paymentResult(action, df, req, prior, nil)
	}

	// Validate the destination before consulting policy, so a typo is reported as a
	// bad address rather than silently consuming the daily allowance.
	if _, err := xrpl.DecodeClassicAddress(req.Destination); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("invalid destination address: %v", err))
	}

	// The clock is the enclave's own, not the timestamp in the instruction. A relayer
	// that could choose the evaluation time could replay an old instruction to make
	// the rolling window look empty.
	now := e.now()

	decision := e.policy.Evaluate(req.WalletID, req.AmountDrops, req.LimitDrops, now)

	if !decision.Approved {
		w.refused++
		e.policy.Record(req.WalletID, req.RequestID, req.AmountDrops, "", decision, now)
		logger.Infof("payment request %d REFUSED: %s", req.RequestID, decision.Reason)
		return e.paymentResult(action, df, req, decision, nil)
	}

	payment := &xrpl.Payment{
		Account:            w.keypair.ClassicAddress,
		Destination:        req.Destination,
		AmountDrops:        req.AmountDrops,
		FeeDrops:           uint64(req.FeeDrops),
		Sequence:           req.Sequence,
		LastLedgerSequence: req.LastLedgerSequence,
		DestinationTag:     req.DestinationTag,
	}

	signed, err := w.keypair.Sign(payment)
	if err != nil {
		// The policy allowed it but the transaction could not be built. Nothing was
		// spent, so the window must not be charged.
		return buildResult(action, df, nil, 0, fmt.Errorf("signing XRPL payment: %v", err))
	}

	w.signed++
	e.policy.Record(req.WalletID, req.RequestID, req.AmountDrops, signed.Hash, decision, now)
	logger.Infof("payment request %d APPROVED, signed tx %s", req.RequestID, signed.Hash)

	return e.paymentResult(action, df, req, decision, signed)
}

// paymentResult encodes a verdict into an ActionResult.
func (e *Extension) paymentResult(
	action teetypes.Action,
	df *instruction.DataFixed,
	req *protocol.PaymentRequest,
	decision policy.Decision,
	signed *xrpl.SignedPayment,
) teetypes.ActionResult {
	resp := &protocol.PaymentResponse{
		RequestID:      req.RequestID,
		Approved:       decision.Approved,
		Reason:         decision.Reason,
		LimitDrops:     decision.LimitDrops,
		SpentDrops:     decision.SpentDrops,
		RemainingDrops: decision.RemainingDrops,
	}

	if signed != nil {
		blob, hash, err := decodeSignedPayment(signed)
		if err != nil {
			return buildResult(action, df, nil, 0, err)
		}
		resp.SignedTxBlob = blob
		resp.TxHash = hash
	}

	encoded, err := protocol.EncodePaymentResponse(resp)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("encoding response: %v", err))
	}
	return buildResult(action, df, encoded, 1, nil)
}
