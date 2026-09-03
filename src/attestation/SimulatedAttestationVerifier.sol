// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IAttestationVerifier} from "./IAttestationVerifier.sol";

/// MODE=1 stand-in: the quote is abi.encode(signer, measurement); no cert
/// chain is checked. Swap for a real DCAP/tee-proxy verifier for hardware
/// trust; the interface and the rest of the system stay unchanged.
contract SimulatedAttestationVerifier is IAttestationVerifier {
    function verifyQuote(bytes calldata quote)
        external
        pure
        returns (address signer, bytes32 measurement)
    {
        (signer, measurement) = abi.decode(quote, (address, bytes32));
    }
}
