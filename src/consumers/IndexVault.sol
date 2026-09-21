// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {AttestedEpochRegistry} from "../AttestedEpochRegistry.sol";
import {IndexLeaf} from "../libs/IndexLeaf.sol";
import {IndexWeightLeaf} from "../libs/IndexWeightLeaf.sol";

/// Example consumer: a weight is trusted only if its leaf is proven against
/// a finalized epoch. A substituted weight has no valid proof.
contract IndexVault {
    AttestedEpochRegistry public immutable registry;
    bytes32 public immutable seriesId;

    constructor(AttestedEpochRegistry _registry, bytes32 _seriesId) {
        registry = _registry;
        seriesId = _seriesId;
    }

    function attestedWeightPpm(
        uint64 epochId,
        uint64 cik,
        uint8 qwenScore,
        uint32 weightPpm,
        bytes32[] calldata proof
    ) external view returns (uint32) {
        bytes32 leaf = IndexLeaf.hash(cik, qwenScore, weightPpm);
        require(
            registry.verifyLeaf(seriesId, epochId, leaf, proof),
            "unattested weight"
        );
        return weightPpm;
    }

    /// Deterministic bps index (INDEX/BUILD epochs): a rebalance weight is
    /// trusted only if its (id, weightBps) leaf proves against a finalized
    /// root. The registry needs no changes; verifyLeaf is leaf-schema free.
    function attestedWeightBps(
        uint64 epochId,
        bytes32 id,
        uint16 weightBps,
        bytes32[] calldata proof
    ) external view returns (uint16) {
        bytes32 leaf = IndexWeightLeaf.hash(id, weightBps);
        require(
            registry.verifyLeaf(seriesId, epochId, leaf, proof),
            "unattested weight"
        );
        return weightBps;
    }
}
