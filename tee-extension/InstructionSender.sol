// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TODO: Replace local interfaces with imports from flare-smart-contracts-v2 once published as a package.
import { ITeeExtensionRegistry } from "./interfaces/ITeeExtensionRegistry.sol";
import { ITeeMachineRegistry } from "./interfaces/ITeeMachineRegistry.sol";

/// @title IndexInstructionSender
/// @author Flare Foundation
/// @notice On-chain entry point for sending INDEX/REBALANCE instructions to the TEE.
///
/// DO NOT MODIFY: constructor, setExtensionId(), _getExtensionId()
contract IndexInstructionSender {
    /// @notice Operation type for greeting actions (SAY_HELLO, SAY_GOODBYE).
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_TYPE_GREETING = bytes32("GREETING");

    /// @notice Command for the SAY_HELLO action.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_SAY_HELLO = bytes32("SAY_HELLO");

    /// @notice Command for the SAY_GOODBYE action.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_SAY_GOODBYE = bytes32("SAY_GOODBYE");

    /// @notice Operation type for index rebalance actions.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_TYPE_INDEX = bytes32("INDEX");

    /// @notice Command for the index rebalance signing action.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_REBALANCE = bytes32("REBALANCE");

    /// @notice Reference to the TEE extension registry contract.
    ITeeExtensionRegistry public immutable TEE_EXTENSION_REGISTRY;
    /// @notice Reference to the TEE machine registry contract.
    ITeeMachineRegistry public immutable TEE_MACHINE_REGISTRY;

    /// @notice First public extension ID. The registry reserves IDs below this
    /// for system/reserved extensions; public extensions are assigned from here up.
    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000; // 65536

    uint256 private _extensionId;

    /// @notice Payload for the SAY_GOODBYE instruction.
    struct SayGoodbyeMessage {
        string name;
        string reason;
    }

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

    /// @notice Sends an INDEX/REBALANCE instruction to the TEE.
    /// @param _message Hex-encoded UTF-8 JSON rebalance envelope:
    ///                 {"vault":"0x..","nonce":n,"weightsBps":[..],"pricesE18":[..]}.
    ///                 The enclave validates it and EIP-191 signs
    ///                 keccak256(abi.encode(vault, nonce, weightsBps, pricesE18))
    ///                 with the key whose address == StableIndexVault.rebalancer.
    function sendRebalance(bytes calldata _message) external payable {
        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);

        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_INDEX,
            opCommand: OP_COMMAND_REBALANCE,
            message: _message,
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });

        TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(
            teeIds,
            params
        );
    }

    /// @notice Returns the cached extension ID, reverting if not yet set.
    /// @return The extension ID assigned to this contract.
    function _getExtensionId() internal view returns (uint256) {
        require(_extensionId != 0, "Extension ID is not set.");
        return _extensionId;
    }
}
