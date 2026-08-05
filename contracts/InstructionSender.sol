// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TODO(flare): Replace local interfaces with imports from flare-smart-contracts-v2 once published as a package.
import { ITeeExtensionRegistry } from "./interfaces/ITeeExtensionRegistry.sol";
import { ITeeMachineRegistry } from "./interfaces/ITeeMachineRegistry.sol";

/// @title InstructionSender (PolicyGuard XRPL)
/// @notice On-chain policy layer and instruction entry point for the PolicyGuard TEE extension.
///
/// PolicyGuard turns an XRPL account into a *keyless*, policy-controlled account:
/// the XRPL secret is generated inside the TEE and never leaves it, and the TEE
/// only produces a signature for a Payment that satisfies the active policy.
///
/// Division of responsibility:
///   - This contract is the *public record* of the policy. Anyone can read which
///     wallet has which daily limit, and every request is emitted as an event.
///   - The TEE is the *enforcement point*. It holds the only copy of the signing
///     key, keeps its own 24h rolling spend ledger inside the enclave, and decides
///     whether to sign. This contract deliberately does NOT reject over-limit
///     requests: an over-limit request must still reach the enclave so the enclave
///     can answer with an auditable verdict rather than the request disappearing
///     in a revert.
///
/// The single policy type in this MVP is a rolling 24-hour spending limit in drops.
///
/// DO NOT MODIFY: constructor, setExtensionId(), _getExtensionId() — these are the
/// scaffold's registry-discovery mechanics and the deploy tooling depends on them.
contract InstructionSender {
    // ---------------------------------------------------------------------
    // Operation constants.
    //
    // These MUST match the string constants in go/internal/config/config.go
    // exactly. Solidity stores them as bytes32("..."); the Go side compares
    // teeutils.ToHash("..."). A mismatch surfaces as "unsupported op type".
    // ---------------------------------------------------------------------

    /// @notice Operation type for wallet lifecycle actions.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_TYPE_WALLET = bytes32("WALLET");

    /// @notice Command instructing the TEE to generate a fresh XRPL keypair in-enclave.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_CREATE = bytes32("CREATE");

    /// @notice Operation type for policy administration.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_TYPE_POLICY = bytes32("POLICY");

    /// @notice Command setting the rolling 24h spending limit.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_SET_LIMIT = bytes32("SET_LIMIT");

    /// @notice Operation type for payment actions.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_TYPE_PAYMENT = bytes32("PAYMENT");

    /// @notice Command asking the TEE to evaluate the policy and sign an XRPL Payment.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_REQUEST = bytes32("REQUEST");

    // ---------------------------------------------------------------------
    // FCC registry wiring — DO NOT MODIFY.
    // ---------------------------------------------------------------------

    /// @notice Reference to the TEE extension registry contract.
    ITeeExtensionRegistry public immutable TEE_EXTENSION_REGISTRY;
    /// @notice Reference to the TEE machine registry contract.
    ITeeMachineRegistry public immutable TEE_MACHINE_REGISTRY;

    /// @notice First public extension ID. The registry reserves IDs below this
    /// for system extensions; public extensions are assigned from here up.
    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000; // 65536

    uint256 private _extensionId;

    // ---------------------------------------------------------------------
    // Policy storage.
    // ---------------------------------------------------------------------

    /// @notice A policy-controlled XRPL wallet.
    /// @param owner Flare address permitted to administer the policy and spend.
    /// @param dailyLimitDrops Rolling 24h spending cap, in XRP drops. Zero means
    ///        no limit has been set yet, which the TEE treats as "deny everything".
    /// @param createdAt Block timestamp the wallet was registered.
    /// @param exists Set once the wallet has been created.
    struct Wallet {
        address owner;
        uint64 dailyLimitDrops;
        uint64 createdAt;
        bool exists;
    }

    /// @notice Registered wallets by id.
    mapping(uint64 walletId => Wallet wallet) private _wallets;

    /// @notice Wallet ids owned by a given Flare address, for UI enumeration.
    mapping(address owner => uint64[] walletIds) private _walletsByOwner;

    /// @notice Id assigned to the next created wallet. Starts at 1 so that 0 is
    /// an unambiguous "not a wallet" sentinel.
    uint64 public nextWalletId = 1;

    /// @notice Id assigned to the next payment request. Doubles as the enclave's
    /// replay-protection nonce.
    uint64 public nextRequestId = 1;

    // ---------------------------------------------------------------------
    // Events.
    // ---------------------------------------------------------------------

    /// @notice Emitted when a wallet is registered on-chain.
    /// @param teeDispatched True if WALLET/CREATE reached the enclave. False means the
    ///        record exists but no XRPL keypair has been generated for it yet.
    event WalletCreated(uint64 indexed walletId, address indexed owner, bool teeDispatched);

    /// @notice Emitted when an instruction could not be dispatched because no TEE
    /// machine is registered to this extension.
    /// @dev Deliberately loud. The on-chain half of the operation succeeded and the
    ///      confidential half did not, and conflating the two would be dishonest.
    event TeeUnavailable(bytes32 opType, bytes32 opCommand);

    /// @notice Emitted when the rolling 24h limit changes.
    /// @param teeDispatched True if POLICY/SET_LIMIT reached the enclave.
    event DailyLimitSet(uint64 indexed walletId, uint64 limitDrops, bool teeDispatched);

    /// @notice Emitted for every payment request forwarded to the enclave.
    /// @dev The verdict is deliberately absent — it comes back through the TEE
    ///      action result, because only the enclave can decide.
    event PaymentRequested(
        uint64 indexed walletId,
        uint64 indexed requestId,
        string destination,
        uint64 amountDrops,
        uint64 limitDrops,
        bool teeDispatched
    );

    // ---------------------------------------------------------------------
    // Errors.
    // ---------------------------------------------------------------------

    /// @notice The referenced wallet has never been created.
    error WalletNotFound(uint64 walletId);
    /// @notice The caller does not own the referenced wallet.
    error NotWalletOwner(uint64 walletId, address caller);
    /// @notice A payment of zero drops was requested.
    error InvalidAmount();
    /// @notice An empty destination address was supplied.
    error InvalidDestination();

    /// @notice Initializes the contract with registry addresses.
    /// @param _teeExtensionRegistry Address of the TEE extension registry.
    /// @param _teeMachineRegistry Address of the TEE machine registry.
    constructor(
        ITeeExtensionRegistry _teeExtensionRegistry,
        ITeeMachineRegistry _teeMachineRegistry
    ) {
        require(address(_teeExtensionRegistry) != address(0), "TeeExtensionRegistry cannot be zero address");
        require(address(_teeMachineRegistry) != address(0), "TeeMachineRegistry cannot be zero address");
        require(address(_teeExtensionRegistry).code.length > 0, "TeeExtensionRegistry has no code");
        require(address(_teeMachineRegistry).code.length > 0, "TeeMachineRegistry has no code");
        TEE_EXTENSION_REGISTRY = _teeExtensionRegistry;
        TEE_MACHINE_REGISTRY = _teeMachineRegistry;
    }

    /// @notice Finds and sets this contract's extension id. Can only be set once.
    /// DO NOT MODIFY this function.
    function setExtensionId() external {
        require(_extensionId == 0, "Extension ID already set.");

        uint256 c = TEE_EXTENSION_REGISTRY.nextPublicExtensionId();
        for (uint256 i = FIRST_PUBLIC_EXTENSION_ID; i < c; ++i) {
            if (TEE_EXTENSION_REGISTRY.getTeeExtensionInstructionsSender(i) == address(this)) {
                _extensionId = i;
                return;
            }
        }
        revert("Extension ID not found.");
    }

    // ---------------------------------------------------------------------
    // Wallet lifecycle.
    // ---------------------------------------------------------------------

    /// @notice Registers a new policy-controlled wallet and asks the TEE to
    /// generate its XRPL keypair inside the enclave.
    /// @dev The secret never exists outside the TEE, so there is nothing to hand
    ///      back here. The enclave returns only the derived classic address and
    ///      public key in its action result.
    /// @return walletId The id assigned to the new wallet.
    function createWallet() external payable returns (uint64 walletId) {
        walletId = nextWalletId++;

        _wallets[walletId] = Wallet({
            owner: msg.sender,
            dailyLimitDrops: 0,
            createdAt: uint64(block.timestamp),
            exists: true
        });
        _walletsByOwner[msg.sender].push(walletId);

        bool dispatched = _send(OP_TYPE_WALLET, OP_COMMAND_CREATE, abi.encode(walletId, msg.sender));
        emit WalletCreated(walletId, msg.sender, dispatched);
    }

    /// @notice Sets or updates the rolling 24h spending limit for a wallet.
    /// @param _walletId Wallet to configure.
    /// @param _limitDrops New limit in XRP drops (1 XRP = 1_000_000 drops).
    function setDailyLimit(uint64 _walletId, uint64 _limitDrops) external payable {
        _requireOwner(_walletId);

        _wallets[_walletId].dailyLimitDrops = _limitDrops;

        bool dispatched = _send(OP_TYPE_POLICY, OP_COMMAND_SET_LIMIT, abi.encode(_walletId, _limitDrops));
        emit DailyLimitSet(_walletId, _limitDrops, dispatched);
    }

    /// @notice Asks the TEE to evaluate the active policy and, if it passes, sign
    /// an XRPL Payment transaction.
    /// @dev The current on-chain limit is included in the instruction so the enclave
    ///      can cross-check it against the limit it stored. The enclave applies the
    ///      stricter of the two, so a stale enclave value can never authorise more
    ///      than the public on-chain policy allows.
    /// @param _walletId Wallet to spend from.
    /// @param _destination XRPL classic address of the recipient (r...).
    /// @param _amountDrops Amount to send, in drops.
    /// @param _sequence XRPL account sequence number for the transaction.
    /// @param _feeDrops XRPL network fee, in drops.
    /// @param _lastLedgerSequence Ledger index after which the transaction expires.
    /// @param _destinationTag Optional destination tag; pass 0 to omit the field.
    /// @return requestId Id of the created request, used for replay protection.
    function requestPayment(
        uint64 _walletId,
        string calldata _destination,
        uint64 _amountDrops,
        uint32 _sequence,
        uint32 _feeDrops,
        uint32 _lastLedgerSequence,
        uint32 _destinationTag
    ) external payable returns (uint64 requestId) {
        _requireOwner(_walletId);
        if (_amountDrops == 0) revert InvalidAmount();
        if (bytes(_destination).length == 0) revert InvalidDestination();

        requestId = nextRequestId++;
        uint64 limitDrops = _wallets[_walletId].dailyLimitDrops;

        bool dispatched = _send(
            OP_TYPE_PAYMENT,
            OP_COMMAND_REQUEST,
            abi.encode(
                _walletId,
                requestId,
                _destination,
                _amountDrops,
                limitDrops,
                _sequence,
                _feeDrops,
                _lastLedgerSequence,
                _destinationTag,
                uint64(block.timestamp)
            )
        );

        emit PaymentRequested(_walletId, requestId, _destination, _amountDrops, limitDrops, dispatched);
    }

    // ---------------------------------------------------------------------
    // Views.
    // ---------------------------------------------------------------------

    /// @notice Reads a wallet's public policy record.
    /// @param _walletId Wallet to read.
    /// @return owner Flare address that controls the wallet.
    /// @return dailyLimitDrops Rolling 24h cap in drops (0 = unset, deny all).
    /// @return createdAt Timestamp the wallet was registered.
    function getWallet(uint64 _walletId)
        external
        view
        returns (address owner, uint64 dailyLimitDrops, uint64 createdAt)
    {
        Wallet storage w = _wallets[_walletId];
        if (!w.exists) revert WalletNotFound(_walletId);
        return (w.owner, w.dailyLimitDrops, w.createdAt);
    }

    /// @notice Lists the wallets registered by an address.
    /// @param _owner Address to enumerate.
    /// @return Wallet ids owned by `_owner`.
    function getWalletsByOwner(address _owner) external view returns (uint64[] memory) {
        return _walletsByOwner[_owner];
    }

    /// @notice Returns the extension id assigned to this contract, or 0 if unset.
    /// @return The extension id.
    function extensionId() external view returns (uint256) {
        return _extensionId;
    }

    // ---------------------------------------------------------------------
    // Internals.
    // ---------------------------------------------------------------------

    /// @dev Builds the instruction params and forwards to the registry. The
    ///      registry charges a minimum fee of 1000 wei per instruction, so every
    ///      caller-facing function is payable and forwards msg.value.
    ///
    ///      `cosigners` is left empty, which means the instruction is relayed under
    ///      the extension's default data-provider consensus rules. Populating it
    ///      would additionally require those providers to co-sign before the
    ///      enclave accepts the instruction.
    function _send(bytes32 _opType, bytes32 _opCommand, bytes memory _message)
        internal
        returns (bool dispatched)
    {
        // No registered machine means there is no enclave to answer. Asking the
        // registry for one of zero reverts with TooMany(), which would take the
        // on-chain policy record down with it — so the availability check happens
        // here, and the caller is told which of the two halves actually ran.
        if (!isTeeAvailable()) {
            emit TeeUnavailable(_opType, _opCommand);
            return false;
        }

        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);

        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: _opType,
            opCommand: _opCommand,
            message: _message,
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });

        TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(teeIds, params);
        return true;
    }

    /// @notice Whether any TEE machine is currently registered to this extension.
    /// @dev The public, on-chain answer to "can this contract reach an enclave right
    ///      now". Callers should read this before assuming a payment will be
    ///      evaluated: with no machine, the policy record is still written and
    ///      auditable, but no signature can be produced by anyone.
    /// @return True when at least one active machine is available.
    function isTeeAvailable() public view returns (bool) {
        if (_extensionId == 0) return false;
        return TEE_MACHINE_REGISTRY.getActiveTeeMachines(_extensionId).length > 0;
    }

    /// @dev Reverts unless the caller owns an existing wallet.
    function _requireOwner(uint64 _walletId) internal view {
        Wallet storage w = _wallets[_walletId];
        if (!w.exists) revert WalletNotFound(_walletId);
        if (w.owner != msg.sender) revert NotWalletOwner(_walletId, msg.sender);
    }

    /// @notice Returns the cached extension ID, reverting if not yet set.
    /// @return The extension ID assigned to this contract.
    function _getExtensionId() internal view returns (uint256) {
        require(_extensionId != 0, "Extension ID is not set.");
        return _extensionId;
    }
}
