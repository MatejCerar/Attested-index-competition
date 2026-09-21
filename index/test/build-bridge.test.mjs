// node --test: the JS bridge must reproduce the golden weightsBps (emitted by
// the Python builder, pinned for the enclave TS port) exactly, and its Merkle
// root must match the enclave's epoch.ts outputRoot. Identical bps here means
// the enclave INDEX/REBALANCE gate accepts what the bridge builds.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import "../../tee-extension/extension/__tests__/resolve-ts.mjs";
import {
    buildFromConfig,
    buildIndexBps,
    parseCsv,
    loadMatrixCsv,
    matrixHash,
    indexOutputRoot,
} from "../build-index.mjs";
import {ATTESTED_INDICES} from "../attested-indices.mjs";
import {getStrategy} from "../strategies.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const golden = JSON.parse(
    readFileSync(
        join(root, "tee-extension", "extension", "__tests__", "golden_weights.json"),
        "utf8"
    )
);
const csv = readFileSync(join(root, golden.matrix), "utf8");

test("bridge reproduces the golden weightsBps for the house config", () => {
    const {tickers, weightsBps} = buildIndexBps(parseCsv(csv), golden.config);
    assert.deepEqual(tickers, golden.tickers);
    assert.deepEqual(weightsBps, golden.weightsBps);
    assert.equal(weightsBps.reduce((a, b) => a + b, 0), 10000);
});

test("bridge reproduces every golden variant", () => {
    for (const v of golden.variants) {
        const cfg = {...golden.config, ...v.overrides};
        const {tickers, weightsBps} = buildIndexBps(parseCsv(csv), cfg);
        assert.deepEqual(tickers, v.tickers, JSON.stringify(v.overrides));
        assert.deepEqual(weightsBps, v.weightsBps, JSON.stringify(v.overrides));
    }
});

test("frozen matrix on disk is the golden matrix", () => {
    assert.equal(loadMatrixCsv(), csv);
    assert.match(matrixHash(), /^0x[0-9a-f]{64}$/);
});

test("outputRoot matches the enclave epoch.ts implementation", async () => {
    const epoch = await import(
        "../../tee-extension/extension/epoch.ts"
    );
    const {ids, weightsBps, outputRoot} = buildFromConfig(golden.config, csv);
    assert.equal(outputRoot, epoch.indexOutputRoot(ids, weightsBps));
    assert.equal(matrixHash(csv), epoch.manifestHashOf(csv));
    assert.equal(indexOutputRoot(ids, weightsBps), outputRoot);
});

test("every attested index config builds and sums to 10000 bps", () => {
    for (const ix of ATTESTED_INDICES) {
        const built = buildFromConfig(ix.config);
        assert.ok(built.ids.length > 0, ix.id);
        assert.equal(built.weightsBps.reduce((a, b) => a + b, 0), 10000, ix.id);
        assert.equal(built.ids.length, new Set(built.ids).size, ix.id);
        assert.equal(getStrategy(ix.strategy).id, ix.strategy);
    }
});
