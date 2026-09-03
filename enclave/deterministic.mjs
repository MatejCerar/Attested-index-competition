// Deterministic epoch pipeline; leaf/root formulas match the Solidity side.
import {AbiCoder, keccak256, toUtf8Bytes, getBytes, id, concat} from "ethers";

const abi = AbiCoder.defaultAbiCoder();

export function manifestHash(m) {
    return keccak256(toUtf8Bytes(JSON.stringify(m, Object.keys(m).sort())));
}

export function indexLeaf(row) {
    return keccak256(
        abi.encode(["uint64", "uint8", "uint32"], [BigInt(row.cik), row.score, row.weightPpm])
    );
}

function hashPair(a, b) {
    const [x, y] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    return keccak256(concat([getBytes(x), getBytes(y)]));
}

export function buildRoot(leaves) {
    if (leaves.length === 0) throw new Error("no leaves");
    let level = [...leaves];
    while (level.length > 1) {
        const next = [];
        for (let i = 0; i < level.length; i += 2)
            next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
        level = next;
    }
    return level[0];
}

export function indexOutputRoot(rows) {
    const sorted = [...rows].sort((a, b) => (BigInt(a.cik) < BigInt(b.cik) ? -1 : 1));
    return buildRoot(sorted.map(indexLeaf));
}

export function seriesId(name) {
    return id(name);
}

// Sent to the tee-node /sign: keccak256(message) then TextHash equals the
// contract's _digest, so the signature verifies unchanged.
export function attestationMessage(att) {
    return abi.encode(
        ["bytes32", "uint64", "bytes32", "bytes32", "bytes32", "uint64"],
        [att.seriesId, att.epochId, att.manifestHash, att.outputRoot, att.codeMeasurement, att.producedAt]
    );
}
