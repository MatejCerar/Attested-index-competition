/**
 * INDEX/REBALANCE handler + rebalance-signer tests (scaffold-side, vitest).
 *
 * Asserts the integration contract with src/StableIndexVault.sol: the digest is
 * keccak256(abi.encode(address vault, uint256 nonce, uint16[] weightsBps,
 * uint256[] pricesE18)); the signature recovers to the TEE key's address; the
 * digest is deterministic and changes with the nonce; and validation rejects
 * bad weights / prices / hex. Since the Phase 3 hardening the handler also
 * recomputes buildIndexBps(matrixCsv, config) and signs ONLY weights equal to
 * that deterministic build; the envelope carries {ids, config, matrixCsv}.
 * Response shape {digest, preimage, signature} is unchanged.
 */

import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  encodeRebalance,
  rebalanceDigest,
  signRebalance,
  validateRebalance,
  type Rebalance,
} from "../app/index.js";
import {
  buildIndexBps,
  parseCsv,
  type IndexConfig,
} from "../app/build-index.js";
import * as handlers from "../app/handlers.js";
import { bytesToHex, hexToBytes } from "../base/encoding.js";
import type { HandlerResult } from "../base/types.js";

// Deterministic test key (anvil account #0). Enclave uses its own key in prod.
const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const TEST_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// Tiny frozen matrix + rule; equal weighting of 3 names -> [3334, 3333, 3333]
// (largest remainder, tie to the lowest id).
const MATRIX_CSV = [
  "id,sector,market_cap_usd,f1",
  "AAA,tech,100,3",
  "BBB,tech,100,2",
  "CCC,energy,100,1",
].join("\n");

const CONFIG: IndexConfig = {
  version: 1,
  weights: { f1: 1 },
  normalization: "rank",
  winsor: 0,
  top_n: 3,
  max_weight: 1,
  sector_cap: 1,
  weighting: "equal",
  eligible_sectors: [],
  min_market_cap_usd: 0,
  id_col: "id",
  sector_col: "sector",
  market_cap_col: "market_cap_usd",
};

const BUILT = buildIndexBps(parseCsv(MATRIX_CSV), CONFIG);

const R: Rebalance = {
  vault: "0x1111111111111111111111111111111111111111",
  nonce: 3n,
  weightsBps: BUILT.weightsBps,
  pricesE18: BUILT.weightsBps.map(() => 1_000_000_000_000_000_000n),
};

function jsonMsg(obj: unknown): string {
  return bytesToHex(Buffer.from(JSON.stringify(obj), "utf-8"));
}

function rebalanceMsg(r: Rebalance, over: Record<string, unknown> = {}): string {
  return jsonMsg({
    vault: r.vault,
    nonce: r.nonce.toString(),
    weightsBps: r.weightsBps,
    pricesE18: r.pricesE18.map((p) => p.toString()),
    ids: BUILT.tickers,
    config: CONFIG,
    matrixCsv: MATRIX_CSV,
    ...over,
  });
}

function decodeResp(result: HandlerResult): {
  digest: string;
  preimage: string;
  signature: string;
} {
  return JSON.parse(Buffer.from(hexToBytes(result[0]!)).toString("utf-8"));
}

beforeEach(() => handlers.resetState());
afterEach(() => handlers.resetState());

describe("rebalance digest", () => {
  it("is deterministic and changes with the nonce", () => {
    expect(rebalanceDigest(R)).toBe(rebalanceDigest(R));
    expect(rebalanceDigest(R)).not.toBe(rebalanceDigest({ ...R, nonce: R.nonce + 1n }));
  });

  it("signature recovers to the signer address", async () => {
    const sig = await signRebalance(R, TEST_KEY);
    const recovered = await recoverMessageAddress({
      message: { raw: rebalanceDigest(R) },
      signature: sig,
    });
    expect(recovered.toLowerCase()).toBe(TEST_ADDR.toLowerCase());
    expect(recovered.toLowerCase()).toBe(privateKeyToAccount(TEST_KEY).address.toLowerCase());
  });

  it("validates weights and prices", () => {
    expect(validateRebalance(R)).toBeNull();
    expect(validateRebalance({ ...R, weightsBps: [5000, 3000, 1000] })).toContain("10000");
    expect(validateRebalance({ ...R, pricesE18: [0n, 1n, 1n] })).toContain("positive");
    expect(validateRebalance({ ...R, weightsBps: [5000, 5000] })).toContain("mismatch");
  });
});

describe("handleIndexRebalance", () => {
  it("returns status 1 and a signature that recovers to the TEE key", async () => {
    process.env.TEE_REBALANCER_KEY = TEST_KEY;
    delete process.env.INDEX_VAULT;

    const r = await handlers.handleIndexRebalance(rebalanceMsg(R));
    expect([r[1], r[2]]).toEqual([1, null]);

    const resp = decodeResp(r);
    expect(resp.preimage).toBe(encodeRebalance(R));
    expect(resp.digest).toBe(rebalanceDigest(R));

    const recovered = await recoverMessageAddress({
      message: { raw: resp.digest as `0x${string}` },
      signature: resp.signature as `0x${string}`,
    });
    expect(recovered.toLowerCase()).toBe(TEST_ADDR.toLowerCase());
  });

  it("rejects weights that differ from the deterministic build", async () => {
    process.env.TEE_REBALANCER_KEY = TEST_KEY;
    delete process.env.INDEX_VAULT;
    const tampered = [...BUILT.weightsBps];
    tampered[0]! += 1;
    tampered[1]! -= 1; // still sums to 10000: only the gate catches it
    const r = await handlers.handleIndexRebalance(
      rebalanceMsg({ ...R, weightsBps: tampered }),
    );
    expect(r[1]).toBe(0);
    expect(r[2]).toBe("weights do not match deterministic build");
  });

  it("rejects an envelope without the build inputs", async () => {
    process.env.TEE_REBALANCER_KEY = TEST_KEY;
    const r = await handlers.handleIndexRebalance(
      rebalanceMsg(R, { matrixCsv: "" }),
    );
    expect(r[1]).toBe(0);
    expect(r[2]).toContain("matrixCsv");
  });

  it("rejects a vault not pinned by the enclave", async () => {
    process.env.TEE_REBALANCER_KEY = TEST_KEY;
    process.env.INDEX_VAULT = "0x2222222222222222222222222222222222222222";
    const r = await handlers.handleIndexRebalance(rebalanceMsg(R));
    expect(r[1]).toBe(0);
    expect(r[2]).toContain("not permitted");
    delete process.env.INDEX_VAULT;
  });

  it("rejects invalid hex", async () => {
    process.env.TEE_REBALANCER_KEY = TEST_KEY;
    const r = await handlers.handleIndexRebalance("0xZZ");
    expect(r[1]).toBe(0);
    expect(r[2]).toContain("decoding request");
  });

  it("rejects weights that do not sum to 10000", async () => {
    process.env.TEE_REBALANCER_KEY = TEST_KEY;
    const r = await handlers.handleIndexRebalance(
      rebalanceMsg({ ...R, weightsBps: [5000, 3000, 1000] }),
    );
    expect(r[1]).toBe(0);
    expect(r[2]).toContain("10000");
  });

  it("increments the rebalance counter without touching greeting state", async () => {
    process.env.TEE_REBALANCER_KEY = TEST_KEY;
    delete process.env.INDEX_VAULT;
    await handlers.handleIndexRebalance(rebalanceMsg(R));
    await handlers.handleIndexRebalance(rebalanceMsg({ ...R, nonce: R.nonce + 1n }));
    expect(handlers.reportRebalanceState()).toMatchObject({ rebalanceCount: 2 });
    // reportState() (conformance-pinned) is untouched.
    expect(handlers.reportState()).toEqual({
      greetingCount: 0,
      lastGreeting: "",
      farewellCount: 0,
      lastFarewell: "",
    });
  });
});
