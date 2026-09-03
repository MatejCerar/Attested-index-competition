// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// One leaf per confirmed audit finding. codeHash pins the audited artifact;
/// confirmed is set by the in-enclave verifier (false positives never enter).
library AuditLeaf {
    function hash(
        bytes32 codeHash,
        bytes32 findingId,
        uint8 severity,
        bool confirmed
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(codeHash, findingId, severity, confirmed));
    }
}
