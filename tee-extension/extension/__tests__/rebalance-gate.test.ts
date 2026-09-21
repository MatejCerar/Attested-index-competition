/**
 * Hardened INDEX/REBALANCE tests: the enclave recomputes the deterministic
 * build from (matrixCsv, config) and signs ONLY weights that equal it, so a
 * compromised relay cannot get arbitrary weights signed. Response shape stays
 * {digest, preimage, signature} for the existing on-chain relay.
 *
 * Run: node --test tee-extension/extension/__tests__/rebalance-gate.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import "./resolve-ts.mjs";

const handlers = await import("../handlers.ts");
const { buildIndexBps, parseCsv } = await import("../build-index.ts");
const { recoverMessageAddress, keccak256 } = await import("viem");

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(
  readFileSync(join(HERE, "golden_weights.json"), "utf-8"),
);
const CSV = readFileSync(join(HERE, "..", "..", "..", GOLDEN.matrix), "utf-8");
const BUILT = buildIndexBps(parseCsv(CSV), GOLDEN.config);

const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const VAULT = "0x1111111111111111111111111111111111111111";

function envelope(over: Record<string, unknown> = {}): string {
  const obj = {
    vault: VAULT,
    nonce: "3",
    weightsBps: BUILT.weightsBps,
    pricesE18: BUILT.weightsBps.map(() => "1000000000000000000"),
    ids: BUILT.tickers,
    config: GOLDEN.config,
    matrixCsv: CSV,
    ...over,
  };
  return "0x" + Buffer.from(JSON.stringify(obj), "utf-8").toString("hex");
}

function decodeResp(r: [string | null, number, string | null]) {
  return JSON.parse(Buffer.from(r[0]!.slice(2), "hex").toString("utf-8"));
}

function setEnv(): void {
  process.env.TEE_REBALANCER_KEY = TEST_KEY;
  delete process.env.INDEX_VAULT;
  handlers.resetState();
}

test("signs when weightsBps equal the deterministic build", async () => {
  setEnv();
  const r = await handlers.handleIndexRebalance(envelope());
  assert.deepEqual([r[1], r[2]], [1, null]);

  const resp = decodeResp(r);
  // response shape unchanged: exactly {digest, preimage, signature}
  assert.deepEqual(Object.keys(resp).sort(), [
    "digest",
    "preimage",
    "signature",
  ]);
  assert.equal(resp.digest, keccak256(resp.preimage));
  const recovered = await recoverMessageAddress({
    message: { raw: resp.digest },
    signature: resp.signature,
  });
  assert.equal(recovered.toLowerCase(), TEST_ADDR.toLowerCase());
});

test("signs a vault-order permutation (id -> bps mapping is what matters)", async () => {
  setEnv();
  const r = await handlers.handleIndexRebalance(
    envelope({
      ids: [...BUILT.tickers].reverse(),
      weightsBps: [...BUILT.weightsBps].reverse(),
    }),
  );
  assert.deepEqual([r[1], r[2]], [1, null]);
});

test("rejects weights that differ from the deterministic build", async () => {
  setEnv();
  // move 1 bp between two names: still sums to 10000, passes the old check
  const tampered = [...BUILT.weightsBps];
  tampered[0]! += 1;
  tampered[1]! -= 1;
  const r = await handlers.handleIndexRebalance(
    envelope({ weightsBps: tampered }),
  );
  assert.deepEqual(
    [r[1], r[2]],
    [0, "weights do not match deterministic build"],
  );
  assert.deepEqual(handlers.reportRebalanceState(), {
    rebalanceCount: 0,
    lastDigest: "",
  });
});

test("rejects mislabeled ids and wrong constituent sets", async () => {
  setEnv();
  // swap two ids whose weights differ (0 and 7: 1000 bps vs 601 bps)
  const swappedIds = [...BUILT.tickers];
  [swappedIds[0], swappedIds[7]] = [swappedIds[7]!, swappedIds[0]!];
  const swapped = await handlers.handleIndexRebalance(
    envelope({ ids: swappedIds }),
  );
  assert.deepEqual(
    [swapped[1], swapped[2]],
    [0, "weights do not match deterministic build"],
  );

  const dropped = await handlers.handleIndexRebalance(
    envelope({
      ids: BUILT.tickers.slice(1),
      weightsBps: BUILT.weightsBps.slice(1),
      pricesE18: BUILT.weightsBps.slice(1).map(() => "1"),
    }),
  );
  assert.equal(dropped[1], 0);
});

test("rejects an envelope missing the build inputs", async () => {
  setEnv();
  const noCsv = await handlers.handleIndexRebalance(envelope({ matrixCsv: "" }));
  assert.deepEqual(
    [noCsv[1], noCsv[2]],
    [0, "matrixCsv must be the frozen feature matrix csv"],
  );

  const noCfg = await handlers.handleIndexRebalance(envelope({ config: null }));
  assert.deepEqual(
    [noCfg[1], noCfg[2]],
    [0, "config must be the index config object"],
  );

  const noIds = await handlers.handleIndexRebalance(envelope({ ids: undefined }));
  assert.deepEqual(
    [noIds[1], noIds[2]],
    [0, "ids must be an array of constituent id strings"],
  );
});

test("keeps the vault pin", async () => {
  setEnv();
  process.env.INDEX_VAULT = "0x2222222222222222222222222222222222222222";
  const r = await handlers.handleIndexRebalance(envelope());
  assert.deepEqual([r[1], r[2]], [0, "vault not permitted by enclave"]);
  delete process.env.INDEX_VAULT;
});
