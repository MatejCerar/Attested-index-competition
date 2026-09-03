// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// Verifies a TEE attestation quote and returns the enclave signer and the
/// code image it ran. A real implementation parses a DCAP/tee-proxy quote.
interface IAttestationVerifier {
    function verifyQuote(bytes calldata quote)
        external
        view
        returns (address signer, bytes32 measurement);
}
