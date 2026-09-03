/**
 * Configuration: version and operation identifiers.
 *
 * Mirrors go/internal/config/config.go. The op-type and op-command strings MUST
 * match the bytes32 constants in contracts/InstructionSender.sol exactly, or
 * actions fall through to "unsupported op type".
 */

export const VERSION = "0.1.0";

export const OP_TYPE_GREETING = "GREETING";
export const OP_COMMAND_SAY_HELLO = "SAY_HELLO";
export const OP_COMMAND_SAY_GOODBYE = "SAY_GOODBYE";

// Index rebalance extension. bytes32("INDEX") / bytes32("REBALANCE"), same
// string->bytes32 scheme as the GREETING constants above. These MUST match the
// OP_TYPE_INDEX / OP_COMMAND_REBALANCE constants in InstructionSender.sol:
//   INDEX = 0x494e444558000000...  REBALANCE = 0x5245424149...
export const OP_TYPE_INDEX = "INDEX";
export const OP_COMMAND_REBALANCE = "REBALANCE";
