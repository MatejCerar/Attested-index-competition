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
   [5] builder ........ build_index(matrix, config) -> weightsBps  (PURE)
        |               canonical, byte-identical in Python and TS
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
   `build_index`. It is what the enclave attests, and it runs rarely.
2. Rebalance execution: `(weights, live prices) -> holdings`. Runs every tick,
   on-chain in the vault.

The enclave does not run the builder every 15 seconds. It builds once per config
version, attests the weights, and per rebalance only signs "these attested
weights at these attested prices."

## Component map (logical stage -> where it lives)

| # | Stage | What it does | Where |
|---|---|---|---|
| 1 | harness | constrained model calls, JSON-schema-locked output, validation, freeze + human review | `deterministic-index/labeler.py`, `index/generate.mjs` |
| 2 | features | the feature contract (20 features: 11 NUMERIC, 6 SCORE, 3 LABEL) + the mock feature database (40 large caps) + the frozen matrix | `deterministic-index/features.py`, `deterministic-index/data/`, `deterministic-index/example_data/feature_matrix_v1.csv` |
| 3 | model | the one AI step: Claude Haiku maps descriptions -> SCORE/LABEL, temperature 0, enum-locked; also the prompt -> config author | `deterministic-index/labeler.py` (MODEL = claude-haiku-4-5), `index/generate.mjs` |
| 4 | oracle | price source behind one interface: enclave-signed (fast, default), FDC Web2Json (slower, decentralized, optional), raw (dev display feed) | `pipeline/oracle/oracle.mjs`, `pipeline/oracle/SignedPriceOracle.sol` |
| 5 | builder | the pure deterministic core, canonical and cross-language identical (integer-bps boundary + golden-vector parity test) | `deterministic-index/index_builder.py`, `tee-extension/extension/build-index.ts`, `index/build-index.mjs` (bridge) |
| 6 | rebalancer | decides when (strategies), builds weights via the bridge, gets prices from the oracle, sends the gated envelope, relays `rebalance()` | `rebalancer/rebalancer.mjs`, `index/strategies.mjs`, `scripts/live-engine.mjs` |
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

- Real: the feature contract and builder, the cross-language determinism (proven
  by a golden-vector test), the enclave build + attestation, the synthetic vault
  with real stable collateral, the strategies, the live prices (display feed).
- Simulated / deferred: the TEE hardware attestation is MODE=1 (signing real,
  hardware measurement simulated); FDC price attestation is stubbed to the
  request/proof shape (enclave-signed prices are the working default); the perps
  layer over the top-ranked indices is a future v2.

## Oracle: do we need FDC, is it too slow

FTSO is out of scope for now. FDC Web2Json is too slow for the 15s tick (voting
rounds ~90s+) and adds nothing while the same enclave already signs rebalances.
Default: enclave-signed price per tick. FDC becomes worth wiring only in the
decentralized mode, at rebalance cadence, when you stop trusting the single
enclave. See `pipeline/oracle/README.md`.

## Not yet wired (follow-ups)

- `scripts/compete-setup.mjs` still provisions vaults for the old house ids; it
  needs updating to the five `attested-*` ids before the on-chain attested path
  resolves `cfg.vaults[id]` (the engine skips gracefully until then).
- The frozen `example_data/feature_matrix_v1.csv` used by the build is 12 names;
  the full 40-name mock DB is in `deterministic-index/data/`. Freeze the 40-name
  matrix when ready.
- Gated signing requires `TEE_SIGN_URL` to point at the extension gateway
  `/sign`, not the bare tee-node (the bare node has no envelope gate).
