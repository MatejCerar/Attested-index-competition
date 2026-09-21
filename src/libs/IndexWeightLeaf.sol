// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// One leaf per constituent of a deterministic bps index epoch. IndexLeaf's
/// (cik, qwenScore, weightPpm) shape is specific to the filings index; the
/// enclave-built index (tee-extension INDEX/BUILD) keys names by ticker
/// (bytes32, utf8 right-zero-padded) with weights in bps summing to 10_000,
/// so it gets its own leaf. The off-chain tree (extension/epoch.ts) is built
/// over these leaves sorted ascending with OZ-commutative pair hashing, so
/// proofs verify with AttestedEpochRegistry.verifyLeaf unchanged.
library IndexWeightLeaf {
    function hash(bytes32 id, uint16 weightBps)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(id, weightBps));
    }
}
