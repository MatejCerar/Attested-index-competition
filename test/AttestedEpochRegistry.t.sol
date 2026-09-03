// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {AttestedEpochRegistry} from "../src/AttestedEpochRegistry.sol";
import {IndexLeaf} from "../src/libs/IndexLeaf.sol";
import {
    SimulatedAttestationVerifier
} from "../src/attestation/SimulatedAttestationVerifier.sol";

contract AttestedEpochRegistryTest is Test {
    AttestedEpochRegistry reg;

    address gov = makeAddr("gov");
    bytes32 constant CODE = keccak256("enclave-image-v0.0.21");
    bytes32 constant SERIES = keccak256("PF-AI-COMPUTE");
    bytes32 constant METHOD = keccak256("20-80-blend-v1");

    uint256 pkA = 0xA11CE;
    uint256 pkB = 0xB0B;
    address encA;
    address encB;

    bytes32 outputRoot;
    bytes32 leafNvda;
    bytes32 leafAmd;

    function setUp() public {
        encA = vm.addr(pkA);
        encB = vm.addr(pkB);

        vm.startPrank(gov);
        reg = new AttestedEpochRegistry(gov);
        reg.setAllowedCode(CODE, true);
        reg.registerEnclave(encA, CODE);
        reg.registerEnclave(encB, CODE);
        reg.registerSeries(
            SERIES, METHOD, 2, AttestedEpochRegistry.PayloadType.Index
        );
        vm.stopPrank();

        // two-constituent epoch, root = sorted pair (OZ commutative hash)
        leafNvda = IndexLeaf.hash(1045810, 95, 108299); // ~10.83%
        leafAmd = IndexLeaf.hash(2488, 88, 41200);
        outputRoot = _hashPair(leafNvda, leafAmd);
    }

    function _att(bytes32 root)
        internal
        view
        returns (AttestedEpochRegistry.EpochAttestation memory a)
    {
        a = AttestedEpochRegistry.EpochAttestation({
            seriesId: SERIES,
            epochId: 1,
            manifestHash: keccak256("manifest-1"),
            outputRoot: root,
            codeMeasurement: CODE,
            producedAt: 1756600000
        });
    }

    function _sign(uint256 pk, AttestedEpochRegistry.EpochAttestation memory a)
        internal
        pure
        returns (bytes memory)
    {
        bytes32 h = keccak256(
            abi.encode(
                a.seriesId,
                a.epochId,
                a.manifestHash,
                a.outputRoot,
                a.codeMeasurement,
                a.producedAt
            )
        );
        bytes32 eth =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, eth);
        return abi.encodePacked(r, s, v);
    }

    function test_singleReplicaDoesNotFinalize() public {
        AttestedEpochRegistry.EpochAttestation memory a = _att(outputRoot);
        reg.submitEpoch(a, _sign(pkA, a));
        assertFalse(reg.isFinalized(SERIES, 1));
    }

    function test_twoAgreeingReplicasFinalize() public {
        AttestedEpochRegistry.EpochAttestation memory a = _att(outputRoot);
        reg.submitEpoch(a, _sign(pkA, a));
        reg.submitEpoch(a, _sign(pkB, a));
        assertTrue(reg.isFinalized(SERIES, 1));
        assertEq(reg.outputRootOf(SERIES, 1), outputRoot);
    }

    function test_mismatchReverts() public {
        AttestedEpochRegistry.EpochAttestation memory a = _att(outputRoot);
        reg.submitEpoch(a, _sign(pkA, a));

        AttestedEpochRegistry.EpochAttestation memory bad =
            _att(keccak256("tampered-root"));
        vm.expectRevert(AttestedEpochRegistry.OutputMismatch.selector);
        reg.submitEpoch(bad, _sign(pkB, bad));
    }

    function test_badCodeMeasurementReverts() public {
        AttestedEpochRegistry.EpochAttestation memory a = _att(outputRoot);
        a.codeMeasurement = keccak256("unapproved-image");
        vm.expectRevert(AttestedEpochRegistry.BadCode.selector);
        reg.submitEpoch(a, _sign(pkA, a));
    }

    function test_sameEnclaveCannotDoubleCount() public {
        AttestedEpochRegistry.EpochAttestation memory a = _att(outputRoot);
        reg.submitEpoch(a, _sign(pkA, a));
        vm.expectRevert(AttestedEpochRegistry.AlreadyCounted.selector);
        reg.submitEpoch(a, _sign(pkA, a));
    }

    function test_verifyLeafAfterFinalize() public {
        AttestedEpochRegistry.EpochAttestation memory a = _att(outputRoot);
        reg.submitEpoch(a, _sign(pkA, a));
        reg.submitEpoch(a, _sign(pkB, a));

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafAmd; // sibling of leafNvda
        assertTrue(reg.verifyLeaf(SERIES, 1, leafNvda, proof));

        proof[0] = keccak256("wrong-sibling");
        assertFalse(reg.verifyLeaf(SERIES, 1, leafNvda, proof));
    }

    function test_enclaveSelfRegistersViaQuote() public {
        SimulatedAttestationVerifier ver = new SimulatedAttestationVerifier();
        vm.startPrank(gov);
        reg.setAttestationVerifier(ver);
        vm.stopPrank();

        // fresh enclave the registry has never seen
        uint256 pkC = 0xC0FFEE;
        address encC = vm.addr(pkC);
        bytes memory quote = abi.encode(encC, CODE);
        reg.registerEnclaveWithQuote(quote); // permissionless
        assertEq(reg.enclaveMeasurement(encC), CODE);

        // and it can now co-finalize an epoch with enclave A
        AttestedEpochRegistry.EpochAttestation memory a = _att(outputRoot);
        reg.submitEpoch(a, _sign(pkA, a));
        reg.submitEpoch(a, _sign(pkC, a));
        assertTrue(reg.isFinalized(SERIES, 1));
    }

    function test_quoteWithUnapprovedCodeReverts() public {
        SimulatedAttestationVerifier ver = new SimulatedAttestationVerifier();
        vm.prank(gov);
        reg.setAttestationVerifier(ver);

        bytes memory quote =
            abi.encode(address(0xDEAD), keccak256("unapproved-image"));
        vm.expectRevert(AttestedEpochRegistry.BadCode.selector);
        reg.registerEnclaveWithQuote(quote);
    }

    // Four-constituent epoch: proves verifyLeaf works past a 2-leaf tree.
    function test_verifyLeafMultiLevelTree() public {
        bytes32[] memory leaves = new bytes32[](4);
        leaves[0] = IndexLeaf.hash(2488, 88, 41200);
        leaves[1] = IndexLeaf.hash(320193, 72, 30000); // sorted by CIK offchain
        leaves[2] = IndexLeaf.hash(789019, 80, 60000);
        leaves[3] = IndexLeaf.hash(1045810, 95, 108299);

        bytes32 n01 = _hashPair(leaves[0], leaves[1]);
        bytes32 n23 = _hashPair(leaves[2], leaves[3]);
        bytes32 root = _hashPair(n01, n23);

        AttestedEpochRegistry.EpochAttestation memory a = _att(root);
        a.epochId = 2;
        // both enclaves submit the same root for epoch 2
        _submitFor(pkA, a);
        _submitFor(pkB, a);
        assertTrue(reg.isFinalized(SERIES, 2));

        // prove leaves[0]: siblings are leaves[1] then n23
        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaves[1];
        proof[1] = n23;
        assertTrue(reg.verifyLeaf(SERIES, 2, leaves[0], proof));
    }

    function _submitFor(
        uint256 pk,
        AttestedEpochRegistry.EpochAttestation memory a
    ) internal {
        reg.submitEpoch(a, _sign(pk, a));
    }

    function _hashPair(bytes32 x, bytes32 y) internal pure returns (bytes32) {
        return x < y
            ? keccak256(abi.encodePacked(x, y))
            : keccak256(abi.encodePacked(y, x));
    }
}
