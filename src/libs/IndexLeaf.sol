// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// One leaf per accepted index constituent. weightPpm sums to 1_000_000
/// across the epoch; the off-chain tree is built over these in CIK order.
library IndexLeaf {
    function hash(uint64 cik, uint8 qwenScore, uint32 weightPpm)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(cik, qwenScore, weightPpm));
    }
}
