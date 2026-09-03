// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {
    ContractRegistry
} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {
    IWeb2Json
} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {
    MerkleProof
} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IAttestationVerifier} from "./attestation/IAttestationVerifier.sol";

/// An epoch finalizes only once N independent enclaves sign the same
/// outputRoot. Index and audit epochs share this contract; only the leaf
/// schema under outputRoot differs.
contract AttestedEpochRegistry {
    enum PayloadType {
        Index,
        Audit
    }

    struct Series {
        bytes32 methodologyHash;
        uint32 minReplicas;
        PayloadType payloadType;
        bool active;
    }

    struct EpochAttestation {
        bytes32 seriesId;
        uint64 epochId;
        bytes32 manifestHash;
        bytes32 outputRoot;
        bytes32 codeMeasurement;
        uint64 producedAt;
    }

    struct Epoch {
        bytes32 manifestHash;
        bytes32 outputRoot;
        uint32 replicas;
        bool finalized;
    }

    address public governance;
    IAttestationVerifier public attestationVerifier;

    mapping(bytes32 => bool) public allowedCode;
    mapping(address => bytes32) public enclaveMeasurement;
    mapping(bytes32 => Series) public series;
    mapping(bytes32 => Epoch) public epochs;
    mapping(bytes32 => mapping(address => bool)) private _counted;

    event SeriesRegistered(bytes32 indexed seriesId, PayloadType kind);
    event EpochReplica(
        bytes32 indexed seriesId,
        uint64 indexed epochId,
        address enclave,
        uint32 replicas
    );
    event AcceptedEpoch(
        bytes32 indexed seriesId, uint64 indexed epochId, bytes32 outputRoot
    );
    event ManifestAnchored(
        bytes32 indexed seriesId, uint64 indexed epochId, bytes32 manifestHash
    );

    error NotGovernance();
    error SeriesInactive();
    error BadCode();
    error OutputMismatch();
    error AlreadyCounted();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    constructor(address _governance) {
        governance = _governance;
    }

    function setAllowedCode(bytes32 measurement, bool ok)
        external
        onlyGovernance
    {
        allowedCode[measurement] = ok;
    }

    function setAttestationVerifier(IAttestationVerifier v)
        external
        onlyGovernance
    {
        attestationVerifier = v;
    }

    function registerEnclave(address signer, bytes32 measurement)
        external
        onlyGovernance
    {
        enclaveMeasurement[signer] = measurement;
    }

    /// Permissionless: an enclave binds its signer to an allowed measurement
    /// by presenting an attestation quote.
    function registerEnclaveWithQuote(bytes calldata quote) external {
        (address signer, bytes32 measurement) =
            attestationVerifier.verifyQuote(quote);
        if (!allowedCode[measurement]) revert BadCode();
        enclaveMeasurement[signer] = measurement;
    }

    function registerSeries(
        bytes32 seriesId,
        bytes32 methodologyHash,
        uint32 minReplicas,
        PayloadType kind
    ) external onlyGovernance {
        require(minReplicas > 0, "minReplicas=0");
        series[seriesId] = Series({
            methodologyHash: methodologyHash,
            minReplicas: minReplicas,
            payloadType: kind,
            active: true
        });
        emit SeriesRegistered(seriesId, kind);
    }

    function submitEpoch(EpochAttestation calldata att, bytes calldata sig)
        external
    {
        Series memory s = series[att.seriesId];
        if (!s.active) revert SeriesInactive();
        if (!allowedCode[att.codeMeasurement]) revert BadCode();

        address signer = ECDSA.recover(_digest(att), sig);
        if (enclaveMeasurement[signer] != att.codeMeasurement) {
            revert BadCode();
        }

        bytes32 k = _key(att.seriesId, att.epochId);
        Epoch storage e = epochs[k];

        if (e.replicas == 0) {
            e.manifestHash = att.manifestHash;
            e.outputRoot = att.outputRoot;
        } else if (
            e.manifestHash != att.manifestHash || e.outputRoot != att.outputRoot
        ) {
            revert OutputMismatch();
        }

        if (_counted[k][signer]) revert AlreadyCounted();
        _counted[k][signer] = true;
        e.replicas += 1;
        emit EpochReplica(att.seriesId, att.epochId, signer, e.replicas);

        if (!e.finalized && e.replicas >= s.minReplicas) {
            e.finalized = true;
            emit AcceptedEpoch(att.seriesId, att.epochId, e.outputRoot);
        }
    }

    /// Optional: anchor public manifest facts via FDC Web2Json.
    function anchorManifest(
        bytes32 seriesId,
        uint64 epochId,
        bytes32 manifestHash,
        IWeb2Json.Proof calldata proof
    ) external {
        require(
            ContractRegistry.getFdcVerification().verifyWeb2Json(proof),
            "invalid FDC proof"
        );
        emit ManifestAnchored(seriesId, epochId, manifestHash);
    }

    function isFinalized(bytes32 seriesId, uint64 epochId)
        external
        view
        returns (bool)
    {
        return epochs[_key(seriesId, epochId)].finalized;
    }

    function outputRootOf(bytes32 seriesId, uint64 epochId)
        external
        view
        returns (bytes32)
    {
        return epochs[_key(seriesId, epochId)].outputRoot;
    }

    function verifyLeaf(
        bytes32 seriesId,
        uint64 epochId,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        Epoch memory e = epochs[_key(seriesId, epochId)];
        if (!e.finalized) return false;
        return MerkleProof.verify(proof, e.outputRoot, leaf);
    }

    function _key(bytes32 seriesId, uint64 epochId)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(seriesId, epochId));
    }

    function _digest(EpochAttestation calldata att)
        private
        pure
        returns (bytes32)
    {
        bytes32 h = keccak256(
            abi.encode(
                att.seriesId,
                att.epochId,
                att.manifestHash,
                att.outputRoot,
                att.codeMeasurement,
                att.producedAt
            )
        );
        return ECDSA.toEthSignedMessageHash(h);
    }
}
