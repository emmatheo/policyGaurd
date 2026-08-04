package extension

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"

	"policyguard-extension/internal/config"
	"policyguard-extension/internal/xrpl"

	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
)

// --- In most cases, you will not need to modify this file. ---

func (e *Extension) actionHandler(w http.ResponseWriter, r *http.Request) {
	var action teetypes.Action
	err := json.NewDecoder(r.Body).Decode(&action)
	if err != nil {
		http.Error(w, fmt.Sprintf("decoding action: %v", err), http.StatusBadRequest)
		return
	}

	logger.Infof("received action, ID: %s", action.Data.ID)

	status, body := e.processAction(action)

	logger.Infof("sending action result, ID: %s, status: %d, log: %s", action.Data.ID, status, getLogFromBody(body))

	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func buildResult(a teetypes.Action, df *instruction.DataFixed, data []byte, status uint8, err error) teetypes.ActionResult {
	ar := teetypes.ActionResult{
		ID:            a.Data.ID,
		SubmissionTag: a.Data.SubmissionTag,
		Version:       config.Version,
		OPType:        df.OPType,
		OPCommand:     df.OPCommand,
		Data:          data,
		Status:        status,
	}
	switch status {
	case 0:
		ar.Log = fmt.Sprintf("error: %v", err)
	case 1:
		ar.Log = "ok"
	}
	return ar
}

func getLogFromBody(body []byte) string {
	var ar teetypes.ActionResult
	if err := json.Unmarshal(body, &ar); err != nil {
		return string(body)
	}
	return ar.Log
}

// decodeSignedPayment converts the signer's uppercase-hex output into the raw bytes
// the ABI response carries.
func decodeSignedPayment(signed *xrpl.SignedPayment) ([]byte, common.Hash, error) {
	blob, err := hex.DecodeString(signed.TxBlob)
	if err != nil {
		return nil, common.Hash{}, fmt.Errorf("decoding signed transaction blob: %w", err)
	}
	hashBytes, err := hex.DecodeString(signed.Hash)
	if err != nil {
		return nil, common.Hash{}, fmt.Errorf("decoding transaction hash: %w", err)
	}
	if len(hashBytes) != common.HashLength {
		return nil, common.Hash{}, fmt.Errorf(
			"transaction hash is %d bytes, want %d", len(hashBytes), common.HashLength)
	}
	return blob, common.BytesToHash(hashBytes), nil
}
