// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

// TODO: Replace this minimal interface with the full import once flare-smart-contracts-v2
// is published as a package:
//   import { ITeeMachineRegistry } from "flare-smart-contracts-v2/contracts/userInterfaces/tee/ITeeMachineRegistry.sol";
interface ITeeMachineRegistry {
    /// @notice A registered TEE machine.
    /// @param teeId Address derived from the machine's own key.
    /// @param teeProxyId Address of the proxy that fronts it.
    /// @param url Publicly reachable proxy URL. This is how a caller discovers where
    ///        to collect an instruction's result from — the chain decides which
    ///        machines handle the work, so the endpoint is not configuration.
    struct TeeMachine {
        address teeId;
        address teeProxyId;
        string url;
    }

    function getRandomTeeIds(uint256 _extensionId, uint256 _count)
        external view returns (address[] memory);

    /// @notice Every currently active machine registered to an extension.
    /// @dev Read this before dispatching: `getRandomTeeIds` reverts with `TooMany()`
    ///      when asked for more machines than exist, and an empty list is the normal
    ///      state for an extension whose enclave has not been registered yet.
    function getActiveTeeMachines(uint256 _extensionId)
        external view returns (TeeMachine[] memory);
}
