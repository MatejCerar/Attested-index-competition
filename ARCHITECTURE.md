# Architecture

The system is a pipeline. A prompt or a config becomes an index; the index is
built by pure, deterministic code; the enclave certifies that the weights are
the honest output of that code; an oracle prices the assets; the rebalancer
relays the move; the vault holds synthetic positions backed by real stablecoin
collateral. The one non-deterministic step (the model) is quarantined outside
the enclave and frozen into a reviewed artifact before anything downstream runs.

```
  prompt / config
        |
   [1] harness ........ constrain, schema-lock, validate, freeze + review
        |
   [2] features ....... the frozen feature matrix (NUMERIC + AI SCORE/LABEL)
        |
   [3] model .......... the ONLY AI step: Haiku labels descriptions -> matrix
        |               (non-deterministic, boxed, then frozen and hashed)
        |
   [5] builder ........ buildIndex(matrix, config) -> weightsBps  (PURE)
        |               one canonical TS module, everywhere
        |
   [7] fcc ............ enclave re-runs the builder, attests the weights via
        |               the epoch registry, and refuses to sign a rebalance
        |               whose weights do not match the build
        |
   [4] oracle ......... prices the assets (enclave-signed default, FDC optional)
        |
   [6] rebalancer ..... decides WHEN, sends the gated envelope, relays on-chain
        |
      vault ........... synthetic holdings, real stable collateral, real NAV
```

## The two deterministic computations

Keeping these separate is what makes the design cheap and trustworthy.

1. Index construction: `(frozen matrix, config) -> weightsBps`. Changes only
   when the matrix or the config version changes, NOT every tick. This is
   `buildIndex`. It is what the enclave attests, and it runs rarely.
2. Rebalance execution: `(weights, live prices) -> holdings`. Runs every tick,
   on-chain in the vault.

The enclave does not run the builder every 15 seconds. It builds once per config
version, attests the weights, and per rebalance only signs "these attested
weights at these attested prices."

## Component map (logical stage -> where it lives)

| # | Stage | What it does | Where |
|---|---|---|---|
| 1 | harness | constrained model calls, JSON-schema-locked output, validation, freeze + human review | `index/generate.mjs` |
| 2 | features | the feature contract (20 features: 11 NUMERIC, 6 SCORE, 3 LABEL) frozen into the matrix | `index/data/feature-matrix.csv` |
| 3 | model | the one AI step: Claude Haiku authors prompt -> config; the SCORE/LABEL columns of the matrix were labeled the same way, then frozen | `index/generate.mjs` |
| 4 | oracle | price source behind one interface: enclave-signed (fast, default), FDC Web2Json (slower, decentralized, optional), raw (dev display feed) | `scripts/oracle.mjs`, `src/SignedPriceOracle.sol` |
| 5 | builder | the pure deterministic core, one canonical TS module (integer-bps boundary) | `tee-extension/extension/build-index.ts`, `index/build-index.mjs` (bridge) |
| 6 | rebalancer | decides when (strategies), builds weights via the bridge, gets prices from the oracle, sends the gated envelope, relays `rebalance()` | `scripts/rebalancer.mjs`, `index/strategies.mjs`, `scripts/live-engine.mjs` |
| 7 | fcc | the enclave: `INDEX/BUILD` re-runs the builder and signs an epoch attestation; `INDEX/REBALANCE` re-runs the build and refuses to sign unless the requested weights match | `tee-extension/extension/{handlers,build-index,epoch}.ts`, `src/AttestedEpochRegistry.sol`, `src/libs/IndexWeightLeaf.sol`, `src/consumers/IndexVault.sol` |
|   | vault | synthetic holdings, stable stays as collateral, redemption capped by real balance, FCC-gated rebalance | `src/IndexShareVault.sol`, `src/StableIndexVault.sol` |
|   | app | config editor (weights are computed output, not typed) + provenance badges | `app/src/routes/build.tsx`, `app/src/components/provenance-badge.tsx` |

## Trust anchor: what the FCC signature means

Before: the enclave signed any weights that summed to 10000. The signature meant
"an enclave signed something."

Now: the enclave receives `(config, frozen matrix)`, re-runs `buildIndexBps`, and
will only sign a rebalance whose `weightsBps` equal the recomputed build. Two
enclave replicas independently build and must agree on the `outputRoot` before
`AttestedEpochRegistry` finalizes the epoch (a tampered operator producing
different weights fails to finalize). The signature now means "these weights are
the correct, reproducible output of the stated rule applied to the attested
data." Anyone can re-run the build and check.

## What is real vs simulated

- Real: the feature contract and builder, the enclave build + attestation, the
  synthetic vault with real stable collateral, the strategies, the live prices
  (display feed).
- Simulated / deferred: the TEE hardware attestation is MODE=1 (signing real,
  hardware measurement simulated); FDC price attestation is stubbed to the
  request/proof shape (enclave-signed prices are the working default); the perps
  layer over the top-ranked indices is a future v2.

## Oracle: do we need FDC, is it too slow

FTSO is out of scope for now. FDC Web2Json is too slow for the 15s tick (voting
rounds ~90s+) and adds nothing while the same enclave already signs rebalances.
Default: enclave-signed price per tick. FDC becomes worth wiring only in the
decentralized mode, at rebalance cadence, when you stop trusting the single
enclave. See `scripts/oracle.mjs`.

## Rebalance signals

The prompt-generated RebalanceSpec (`index/strategies.mjs`) supports these
triggers, combined by `combine: any|all` and always gated by `cooldownMs`:

ENCLAVE-REPRODUCIBLE now (path-free: computable from the current tick's
weights/prices alone, so the sign envelope can verify them):

- `intervalMs`: calendar cadence elapsed.
- `cooldownMs`: minimum time between rebalances (a gate, not a trigger).
- `driftBps`: aggregate portfolio drift (one-way turnover vs target).
- `nameBreachBps`: max single-name |current - target| weight deviation.
- `sectorDriftBps`: max sector-level deviation, name weights aggregated by the
  frozen matrix `sector` column.
- `takeProfitPct`: NAV gain since the last rebalance.
- `featureConditions` (scope `portfolio`): {feature, op: lt|gt, value} over the
  portfolio-weighted average of a frozen matrix numeric column, e.g. "avg
  dividend_yield < 2%". Signal = sum(liveWeightBps_i * frozenFeature_i) /
  sum(liveWeightBps_i) over mapped holdings (unmapped names skipped, weight
  renormalized among the mapped), so it moves every tick as weights drift yet
  is reproducible from the frozen matrix + live weights alone. Units follow the
  matrix: yields/growth/margins/vol are fractions (percent form in a spec is
  coerced, 2 -> 0.02), multiples and 0..5 scores compare as-is.

ENGINE-ONLY until attested history is threaded into the sign envelope
(history-based: they read the engine's NAV series / racing field):

- `drawdownPct`: NAV fallen this fraction from its running peak.
- `volBandPct`: realized stddev of recent per-tick returns over a small window.
- `trendFlip`: NAV below its own moving average over the last N points
  (N = the spec value, default 20).
- `relativeLagPct`: index return lags the benchmark by this fraction. The
  benchmark is the FIELD-AVERAGE return this tick (`fieldAverageReturn` in
  `scripts/live-engine.mjs`); swap that function to change the benchmark.
- `featureConditions` (scope `market`): `market_return` (return over the kept
  proxy price series) and `market_vol` (realized stddev of its recent per-tick
  returns), both fractions. The proxy is the tokenized S&P 500 ETF
  (`SPYx::backed-assets-je-limited`, priced off Yahoo SPY); change
  `MARKET_PROXY_ID` in `scripts/live-engine.mjs` to swap. If the proxy is
  missing from the catalog the engine falls back to the field-average return
  and field return dispersion. The rebalancer leaves market scope cold unless a
  caller supplies `ctx.marketSignals`; cold conditions never fire.

## Not yet wired (follow-ups)

- `scripts/compete-setup.mjs` still provisions vaults for the old house ids; it
  needs updating to the five `attested-*` ids before the on-chain attested path
  resolves `cfg.vaults[id]` (the engine skips gracefully until then).
- The frozen `index/data/feature-matrix.csv` used by the build is 12 names;
  freeze a larger matrix when ready.
- Gated signing requires `TEE_SIGN_URL` to point at the extension gateway
  `/sign`, not the bare tee-node (the bare node has no envelope gate).
- Attesting the history-based rebalance signals (drawdown, vol band, trend
  flip, relative lag, market-scope feature conditions) requires passing a
  bounded, attested NAV/price history into the enclave sign path (a future
  addition).
