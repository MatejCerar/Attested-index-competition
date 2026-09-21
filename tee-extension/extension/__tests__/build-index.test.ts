/**
 * Golden-vector cross-language parity test.
 *
 * golden_weights.json is emitted by deterministic-index/emit_golden.py: the
 * Python builder run on example_data/feature_matrix_v1.csv + config.yaml,
 * quantized with to_bps. This test re-runs the TS port (build-index.ts) on the
 * SAME csv with the config embedded in the golden file and asserts the integer
 * bps output is EXACTLY equal. Passing = the enclave's re-run reproduces the
 * canonical index byte for byte at the bps boundary.
 *
 * Run (no deps, Node >= 22.18 strips types natively):
 *   node --test tee-extension/extension/__tests__/build-index.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildIndexBps,
  parseCsv,
  weightsToBps,
  type IndexConfig,
} from "../build-index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(
  readFileSync(join(HERE, "golden_weights.json"), "utf-8"),
) as {
  matrix: string;
  config: IndexConfig;
  tickers: string[];
  weightsBps: number[];
  variants: {
    overrides: Partial<IndexConfig>;
    tickers: string[];
    weightsBps: number[];
  }[];
};
const CSV = readFileSync(
  join(HERE, "..", "..", "..", GOLDEN.matrix),
  "utf-8",
);

test("TS build matches the Python golden vector exactly", () => {
  const { tickers, weightsBps } = buildIndexBps(parseCsv(CSV), GOLDEN.config);
  assert.deepEqual(tickers, GOLDEN.tickers);
  assert.deepEqual(weightsBps, GOLDEN.weightsBps);
});

test("bps sum to 10000", () => {
  const { weightsBps } = buildIndexBps(parseCsv(CSV), GOLDEN.config);
  assert.equal(
    weightsBps.reduce((a, b) => a + b, 0),
    10000,
  );
  for (const b of weightsBps) assert.ok(Number.isInteger(b) && b >= 0);
});

test("row order independent", () => {
  const rows = parseCsv(CSV);
  const shuffled = [...rows].reverse();
  const a = buildIndexBps(rows, GOLDEN.config);
  const b = buildIndexBps(shuffled, GOLDEN.config);
  assert.deepEqual(a, b);
});

test("scoring-sensitive variants match Python (loose caps expose the norms)", () => {
  for (const v of GOLDEN.variants) {
    const cfg = { ...GOLDEN.config, ...v.overrides };
    const { tickers, weightsBps } = buildIndexBps(parseCsv(CSV), cfg);
    assert.deepEqual(tickers, v.tickers, JSON.stringify(v.overrides));
    assert.deepEqual(weightsBps, v.weightsBps, JSON.stringify(v.overrides));
  }
});

test("weightsToBps: largest remainder, ties by id ascending", () => {
  // 3 x 1/3: floors 3333, leftover 1 goes to the lowest id on the tie ("a").
  assert.deepEqual(weightsToBps(["b", "a", "c"], [1, 1, 1]), [3333, 3334, 3333]);
  // Exact split: no leftover to distribute.
  assert.deepEqual(weightsToBps(["x", "y", "z"], [0.15, 0.25, 0.6]), [1500, 2500, 6000]);
});
