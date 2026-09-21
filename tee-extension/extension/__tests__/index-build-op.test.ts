/**
 * INDEX/BUILD handler tests: the deterministic build runs INSIDE the enclave
 * and the handler signs the exact EpochAttestation AttestedEpochRegistry
 * verifies. Asserts: golden weights reproduced, outputRoot identical across
 * independent invocations (replica agreement), manifestHash = keccak(matrix),
 * attestation preimage field order, signature recovers to the TEE key, and
 * the cross-language leaf/root vector pinned in test/AttestedEpochRegistry.t.sol.
 *
 * Run: node --test tee-extension/extension/__tests__/index-build-op.test.ts
 * (resolve-ts.mjs maps the sources' scaffold-form ".js" imports to .ts).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import "./resolve-ts.mjs";

const handlers = await import("../handlers.ts");
const epoch = await import("../epoch.ts");
const { keccak256, stringToHex, encodeAbiParameters, recoverMessageAddress } =
  await import("viem");

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(
  readFileSync(join(HERE, "golden_weights.json"), "utf-8"),
);
const CSV = readFileSync(join(HERE, "..", "..", "..", GOLDEN.matrix), "utf-8");

// anvil account #0; the enclave uses its own TEE key in prod.
const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const MEASUREMENT = keccak256(stringToHex("enclave-image-v0.0.21"));

const ENVELOPE = {
  seriesId: "PF-DETERMINISTIC-INDEX",
  epochId: 1,
  config: GOLDEN.config,
  matrixCsv: CSV,
  producedAt: 1758400000,
};

function msgOf(obj: unknown): string {
  return "0x" + Buffer.from(JSON.stringify(obj), "utf-8").toString("hex");
}

function decodeResp(r: [string | null, number, string | null]) {
  return JSON.parse(Buffer.from(r[0]!.slice(2), "hex").toString("utf-8"));
}

function setEnv(): void {
  process.env.TEE_REBALANCER_KEY = TEST_KEY;
  process.env.MEASUREMENT = MEASUREMENT;
}

test("builds the golden weights and a deterministic outputRoot", async () => {
  setEnv();
  handlers.resetState();

  const a = await handlers.handleIndexBuild(msgOf(ENVELOPE));
  assert.deepEqual([a[1], a[2]], [1, null]);
  const ra = decodeResp(a);
  assert.deepEqual(ra.ids, GOLDEN.tickers);
  assert.deepEqual(ra.weightsBps, GOLDEN.weightsBps);
  assert.equal(ra.manifestHash, keccak256(stringToHex(CSV)));

  // second independent invocation: identical root and signature (replica
  // agreement is what lets the registry finalize)
  const b = await handlers.handleIndexBuild(msgOf(ENVELOPE));
  const rb = decodeResp(b);
  assert.equal(rb.outputRoot, ra.outputRoot);
  assert.equal(rb.signature, ra.signature);
  assert.equal(rb.preimage, ra.preimage);

  assert.deepEqual(handlers.reportIndexBuildState(), {
    indexBuildCount: 2,
    lastOutputRoot: ra.outputRoot,
  });
  // conformance-pinned reportState() untouched
  assert.deepEqual(handlers.reportState(), {
    greetingCount: 0,
    lastGreeting: "",
    farewellCount: 0,
    lastFarewell: "",
  });
});

test("preimage matches AttestedEpochRegistry._digest field order and the signature recovers to the TEE key", async () => {
  setEnv();
  const r = await handlers.handleIndexBuild(msgOf(ENVELOPE));
  const resp = decodeResp(r);

  const expected = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint64" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint64" },
    ],
    [
      keccak256(stringToHex(ENVELOPE.seriesId)),
      1n,
      resp.manifestHash,
      resp.outputRoot,
      MEASUREMENT,
      1758400000n,
    ],
  );
  assert.equal(resp.preimage, expected);

  const recovered = await recoverMessageAddress({
    message: { raw: keccak256(resp.preimage) },
    signature: resp.signature,
  });
  assert.equal(recovered.toLowerCase(), TEST_ADDR.toLowerCase());
});

test("leaf and root pin the cross-language vector used by the Foundry test", () => {
  // Same 3-name epoch as test_indexWeightEpochVerifies in
  // test/AttestedEpochRegistry.t.sol; both sides hardcode these values.
  assert.equal(
    epoch.indexWeightLeaf("AAA", 3334),
    "0x1498c7ccce0feae7fc01b867d17726ed4782ef170cbeb5a1df7241175979c10c",
  );
  assert.equal(
    epoch.indexOutputRoot(["AAA", "BBB", "CCC"], [3334, 3333, 3333]),
    "0x3560cde7041a474a365a29b97a7305da65ac65757b901aa6fa4bf5d1cb83335b",
  );
  // order-free: leaves are sorted before the tree is built
  assert.equal(
    epoch.indexOutputRoot(["CCC", "AAA", "BBB"], [3333, 3334, 3333]),
    epoch.indexOutputRoot(["AAA", "BBB", "CCC"], [3334, 3333, 3333]),
  );
});

test("rejects bad envelopes and missing enclave env", async () => {
  setEnv();
  const bad = await handlers.handleIndexBuild("0xZZ");
  assert.equal(bad[1], 0);
  assert.match(bad[2]!, /decoding request/);

  const noCsv = await handlers.handleIndexBuild(
    msgOf({ ...ENVELOPE, matrixCsv: "" }),
  );
  assert.deepEqual(
    [noCsv[1], noCsv[2]],
    [0, "matrixCsv must be the frozen feature matrix csv"],
  );

  delete process.env.MEASUREMENT;
  const noMeas = await handlers.handleIndexBuild(msgOf(ENVELOPE));
  assert.deepEqual([noMeas[1], noMeas[2]], [0, "MEASUREMENT not set in enclave"]);
  setEnv();
});
