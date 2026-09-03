// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {AttestedEpochRegistry} from "../src/AttestedEpochRegistry.sol";
import {IndexVault} from "../src/consumers/IndexVault.sol";
import {
    SimulatedAttestationVerifier
} from "../src/attestation/SimulatedAttestationVerifier.sol";

/// Deploy once and reuse. Set GOVERNANCE and ENCLAVE_CODE (tee-node image
/// digest) in the env. Enclaves self-register later via
/// registerEnclaveWithQuote; new epochs/series need no redeploy.
contract Deploy is Script {
    function run() external {
        address gov = vm.envAddress("GOVERNANCE");
        bytes32 code = vm.envBytes32("ENCLAVE_CODE");
        bytes32 seriesId = keccak256("PF-AI-COMPUTE");

        vm.startBroadcast();
        AttestedEpochRegistry reg = new AttestedEpochRegistry(gov);
        reg.setAttestationVerifier(new SimulatedAttestationVerifier());
        reg.setAllowedCode(code, true);
        reg.registerSeries(
            seriesId,
            keccak256("20-80-blend-v1"),
            2,
            AttestedEpochRegistry.PayloadType.Index
        );
        new IndexVault(reg, seriesId);
        vm.stopBroadcast();
    }
}
