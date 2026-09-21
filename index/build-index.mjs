// ESM bridge to the canonical deterministic builder. Node strips types from
// .ts imports natively (v23.6+), so this re-exports the EXACT module the
// enclave runs (tee-extension/extension/build-index.ts): same code path, same
// float intermediates, same bps. No shell-out, no compiled copy, so JS callers
// cannot drift from the enclave rebalance gate.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {AbiCoder, concat, encodeBytes32String, getBytes, keccak256, toUtf8Bytes} from "ethers";
import {
    buildIndex,
    buildIndexBps,
    parseCsv,
    weightsToBps,
} from "../tee-extension/extension/build-index.ts";

export {buildIndex, buildIndexBps, parseCsv, weightsToBps};

const __dirname = dirname(fileURLToPath(import.meta.url));
const abi = AbiCoder.defaultAbiCoder();

// The one frozen feature matrix every attested index builds over.
export const MATRIX_PATH = join(
    __dirname, "..", "deterministic-index", "example_data", "feature_matrix_v1.csv"
);

let _csv = null;
export function loadMatrixCsv() {
    return (_csv ??= readFileSync(MATRIX_PATH, "utf8"));
}

// manifestHash: keccak256 of the frozen matrix bytes (epoch.ts manifestHashOf).
export function matrixHash(csv = loadMatrixCsv()) {
    return keccak256(toUtf8Bytes(csv));
}

// Merkle leaf/root over (id, weightBps), byte-for-byte with epoch.ts and
// src/libs/IndexWeightLeaf.sol: leaf = keccak256(abi.encode(bytes32, uint16)),
// leaves sorted ascending, pairs hashed OZ-commutative.
export function indexWeightLeaf(id, weightBps) {
    return keccak256(abi.encode(["bytes32", "uint16"], [encodeBytes32String(id), weightBps]));
}
function hashPair(a, b) {
    const [x, y] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    return keccak256(concat([getBytes(x), getBytes(y)]));
}
export function indexOutputRoot(ids, weightsBps) {
    let level = ids.map((id, i) => indexWeightLeaf(id, weightsBps[i]).toLowerCase()).sort();
    if (level.length === 0) throw new Error("no leaves");
    while (level.length > 1) {
        const next = [];
        for (let i = 0; i < level.length; i += 2)
            next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
        level = next;
    }
    return level[0];
}

// Full canonical build for a config over the frozen matrix. Returns the exact
// arrays the enclave INDEX/REBALANCE gate recomputes, plus display extras.
export function buildFromConfig(config, csv = loadMatrixCsv()) {
    const rows = parseCsv(csv);
    const entries = buildIndex(rows, config);
    const {tickers, weightsBps} = buildIndexBps(rows, config);
    return {
        ids: tickers,
        weightsBps,
        weightsPct: weightsBps.map((b) => b / 100),
        entries,
        outputRoot: indexOutputRoot(tickers, weightsBps),
        matrixCsv: csv,
        matrixHash: matrixHash(csv),
    };
}
