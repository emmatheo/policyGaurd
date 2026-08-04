// Command relayer is a local stand-in for the Flare Confidential Compute instruction
// relay, for running PolicyGuard end to end without the full Coston2 stack.
//
// In production the path is:
//
//	InstructionSender.sol -> TeeExtensionRegistry event -> data providers reach
//	consensus and co-sign -> TEE proxy -> TEE node -> extension POST /action
//
// The Coston2 proxy needs an ngrok tunnel and indexer database credentials from Flare,
// which a developer will not have on day one. This relayer replaces only the transport:
// it builds the exact same DataFixed envelope the TEE node delivers and posts it to the
// same POST /action endpoint. The extension binary, its handlers, and the wire format
// are identical either way — nothing about the enclave's behaviour is special-cased
// for local mode.
//
// What it deliberately does NOT reproduce is the consensus layer. Instructions here are
// accepted because this process sent them, not because a threshold of data providers
// signed them. That is exactly the security property the real stack adds, so this is a
// development harness and not a substitute for a deployment.
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"policyguard-extension/internal/config"
	"policyguard-extension/pkg/protocol"

	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

func main() {
	listen := flag.String("listen", envOr("RELAYER_LISTEN", ":6674"), "address to listen on")
	extension := flag.String("extension", envOr("EXTENSION_URL", "http://127.0.0.1:7702"),
		"base URL of the TEE extension")
	origin := flag.String("cors-origin", envOr("CORS_ORIGIN", "*"),
		"value for Access-Control-Allow-Origin")
	flag.Parse()

	r := &relayer{extensionURL: strings.TrimRight(*extension, "/"), corsOrigin: *origin}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", r.withCORS(r.handleHealth))
	mux.HandleFunc("GET /state", r.withCORS(r.handleState))
	mux.HandleFunc("POST /wallet/create", r.withCORS(r.handleCreateWallet))
	mux.HandleFunc("POST /policy/limit", r.withCORS(r.handleSetLimit))
	mux.HandleFunc("POST /payment/request", r.withCORS(r.handleRequestPayment))
	mux.HandleFunc("OPTIONS /", r.withCORS(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	server := &http.Server{
		Addr:              *listen,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	fmt.Printf("PolicyGuard local relayer listening on %s, forwarding to %s\n", *listen, r.extensionURL)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "relayer: %v\n", err)
		os.Exit(1)
	}
}

type relayer struct {
	extensionURL string
	corsOrigin   string
}

// withCORS lets the Next.js dev server call the relayer directly from the browser.
func (r *relayer) withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", r.corsOrigin)
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if req.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, req)
	}
}

func (r *relayer) handleHealth(w http.ResponseWriter, _ *http.Request) {
	resp, err := http.Get(r.extensionURL + "/state")
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":    false,
			"error": fmt.Sprintf("extension unreachable at %s: %v", r.extensionURL, err),
		})
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "extension": r.extensionURL})
}

func (r *relayer) handleState(w http.ResponseWriter, _ *http.Request) {
	resp, err := http.Get(r.extensionURL + "/state")
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("extension unreachable: %v", err))
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("reading extension state: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}

// --- handlers --------------------------------------------------------------

type createWalletBody struct {
	WalletID uint64 `json:"walletId"`
	Owner    string `json:"owner"`
}

func (r *relayer) handleCreateWallet(w http.ResponseWriter, req *http.Request) {
	var body createWalletBody
	if err := decodeBody(req, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.WalletID == 0 {
		writeError(w, http.StatusBadRequest, "walletId must be non-zero")
		return
	}

	message, err := protocol.EncodeCreateRequest(&protocol.CreateRequest{
		WalletID: body.WalletID,
		Owner:    common.HexToAddress(body.Owner),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("encoding instruction: %v", err))
		return
	}

	result, err := r.deliver(config.OPTypeWallet, config.OPCommandCreate, message)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if result.Status == 0 {
		writeError(w, http.StatusUnprocessableEntity, result.Log)
		return
	}

	decoded, err := protocol.DecodeCreateResponse(result.Data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("decoding result: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"walletId":       decoded.WalletID,
		"classicAddress": decoded.ClassicAddress,
		"publicKey":      "0x" + common.Bytes2Hex(decoded.PublicKey),
	})
}

type setLimitBody struct {
	WalletID   uint64 `json:"walletId"`
	LimitDrops uint64 `json:"limitDrops"`
}

func (r *relayer) handleSetLimit(w http.ResponseWriter, req *http.Request) {
	var body setLimitBody
	if err := decodeBody(req, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	message, err := protocol.EncodeSetLimitRequest(&protocol.SetLimitRequest{
		WalletID:   body.WalletID,
		LimitDrops: body.LimitDrops,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("encoding instruction: %v", err))
		return
	}

	result, err := r.deliver(config.OPTypePolicy, config.OPCommandSetLimit, message)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if result.Status == 0 {
		writeError(w, http.StatusUnprocessableEntity, result.Log)
		return
	}

	decoded, err := protocol.DecodeSetLimitResponse(result.Data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("decoding result: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"walletId":   decoded.WalletID,
		"limitDrops": decoded.LimitDrops,
	})
}

type paymentBody struct {
	WalletID           uint64 `json:"walletId"`
	RequestID          uint64 `json:"requestId"`
	Destination        string `json:"destination"`
	AmountDrops        uint64 `json:"amountDrops"`
	LimitDrops         uint64 `json:"limitDrops"`
	Sequence           uint32 `json:"sequence"`
	FeeDrops           uint32 `json:"feeDrops"`
	LastLedgerSequence uint32 `json:"lastLedgerSequence"`
	DestinationTag     uint32 `json:"destinationTag"`
}

func (r *relayer) handleRequestPayment(w http.ResponseWriter, req *http.Request) {
	var body paymentBody
	if err := decodeBody(req, &body); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	message, err := protocol.EncodePaymentRequest(&protocol.PaymentRequest{
		WalletID:           body.WalletID,
		RequestID:          body.RequestID,
		Destination:        body.Destination,
		AmountDrops:        body.AmountDrops,
		LimitDrops:         body.LimitDrops,
		Sequence:           body.Sequence,
		FeeDrops:           body.FeeDrops,
		LastLedgerSequence: body.LastLedgerSequence,
		DestinationTag:     body.DestinationTag,
		RequestedAt:        uint64(time.Now().Unix()),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("encoding instruction: %v", err))
		return
	}

	result, err := r.deliver(config.OPTypePayment, config.OPCommandRequest, message)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	// Status 0 means the enclave could not reach a verdict at all. A policy refusal
	// is status 1 with approved=false and is passed through as a normal response.
	if result.Status == 0 {
		writeError(w, http.StatusUnprocessableEntity, result.Log)
		return
	}

	decoded, err := protocol.DecodePaymentResponse(result.Data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("decoding result: %v", err))
		return
	}

	out := map[string]any{
		"requestId":      decoded.RequestID,
		"approved":       decoded.Approved,
		"reason":         decoded.Reason,
		"limitDrops":     decoded.LimitDrops,
		"spentDrops":     decoded.SpentDrops,
		"remainingDrops": decoded.RemainingDrops,
	}
	if decoded.Approved {
		out["txBlob"] = strings.ToUpper(common.Bytes2Hex(decoded.SignedTxBlob))
		out["txHash"] = strings.ToUpper(strings.TrimPrefix(decoded.TxHash.Hex(), "0x"))
	}

	writeJSON(w, http.StatusOK, out)
}

// --- instruction delivery --------------------------------------------------

// deliver wraps a message in the DataFixed envelope the TEE node uses and posts it to
// the extension's action endpoint.
func (r *relayer) deliver(opType, opCommand string, message []byte) (*teetypes.ActionResult, error) {
	instructionID, err := randomHash()
	if err != nil {
		return nil, fmt.Errorf("generating instruction id: %w", err)
	}

	dataFixed := instruction.DataFixed{
		InstructionID:   instructionID,
		Timestamp:       uint64(time.Now().Unix()),
		OPType:          teeutils.ToHash(opType),
		OPCommand:       teeutils.ToHash(opCommand),
		OriginalMessage: message,
	}

	envelope, err := json.Marshal(dataFixed)
	if err != nil {
		return nil, fmt.Errorf("encoding instruction envelope: %w", err)
	}

	action := teetypes.Action{
		Data: teetypes.ActionData{
			ID:      instructionID,
			Message: envelope,
		},
	}

	payload, err := json.Marshal(action)
	if err != nil {
		return nil, fmt.Errorf("encoding action: %w", err)
	}

	resp, err := http.Post(r.extensionURL+"/action", "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("extension unreachable at %s: %w", r.extensionURL, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading extension response: %w", err)
	}

	// The extension answers non-2xx with a plain-text explanation rather than an
	// ActionResult, so surface that text instead of a JSON parse error.
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("extension returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var result teetypes.ActionResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decoding action result: %w", err)
	}
	return &result, nil
}

func randomHash() (common.Hash, error) {
	var h common.Hash
	if _, err := rand.Read(h[:]); err != nil {
		return common.Hash{}, err
	}
	return h, nil
}

// --- small helpers ---------------------------------------------------------

func decodeBody(req *http.Request, dst any) error {
	// Instruction payloads are small; the cap keeps a stray large body from being
	// read into memory.
	if err := json.NewDecoder(io.LimitReader(req.Body, 1<<20)).Decode(dst); err != nil {
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": message})
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
