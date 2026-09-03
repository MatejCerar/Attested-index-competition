# Index Competition

Build an index. Deposit into it. Let an autonomous rebalancer run it. Compete.

An index is the headline primitive: a prompt, a set of asset weights, and a
rebalance strategy. Anyone defines one over crypto or a universe of ~2,300
tokenized real-world assets (equities, ETFs, metals, perps). A rebalancer
running inside Flare Confidential Compute (FCC) moves the vault's holdings to
those weights on a schedule the index picks. Indices are ranked on a
leaderboard, the best attract more deposits, and the platform earns a fee. No
human touches the money or the allocation: the rebalance only executes when the
FCC enclave signs it, so the product is autonomous, not advisory.

```
  build            fund              rebalance (FCC)          rank
  ---------        ------------      ------------------       ------------
  prompt      ->   deposit + fee ->  enclave signs weights -> leaderboard
  + weights        (real tx)         vault moves holdings     more deposits
  + strategy       (USD stable)      on-chain, per strategy   flow to winners
  (crypto/RWA)
```

## 1. Index

An index record is `{ id, name, prompt, weights, strategy }`:

- `weights`: symbol -> integer percent, summing to 100.
- `strategy`: a reference to a rebalance strategy template (see section 2).
- `prompt`: the natural-language recipe that produced the weights.

Definitions and tooling live in `index/`:

```
index/assets.mjs      allowed asset symbols
index/indices.mjs     the static index definitions (sample indices)
index/weights.mjs     normalize/renormalize weights, pct <-> bps
index/strategies.mjs  rebalance strategy templates
index/prices.mjs      stub USD price source + Uniswap V3 TWAP seam (phase 2)
index/generate.mjs    AI weight generation via Claude Code + refresh loop
```

An index can be fully static (a fixed prompt + weights + strategy) or it can
restate its weights from its prompt.

### AI-generated weights (prompt -> weights)

`index/generate.mjs` turns an index's prompt into weights by shelling out to the
Claude Code CLI with the cheapest model:

```
node index/generate.mjs           # one pass over all indices
node index/generate.mjs --loop    # regenerate every INTERVAL_MS (default 60s)
```

The generator pipes the prompt to `claude -p --model claude-haiku-4-5-...` with
web/shell tools disabled so the model answers from its own knowledge, parses the
returned JSON `{"weights":{SYM:pct,...}}`, and normalizes it (strips non-allowed
symbols, renormalizes to 100, clamps). If the CLI is unavailable or returns
junk, it falls back to the index's last-good weights and logs that live-gen is
unavailable. The refresh loop runs sequentially, one index at a time, with a
per-call timeout to bound cost, and is safe to Ctrl-C. So an index like "give me
the top 5 crypto assets by market cap" restates its weights each minute.

### Build your own index (RWA universe)

`rwa-database.txt` is the raw universe: ~8,900 tokenized-asset listings across
issuers, venues and chains. It is large and kept out of git (see `.gitignore`);
the committed, derived catalog (`demo/catalog.json` and
`demo/frontend/catalog.js`) is what the app reads, so you only need the raw txt
to regenerate it. `demo/build-catalog.mjs` collapses it to the set of selectable
instruments using one identity rule: **an asset is unique by (Ticker, Issuer)**.
The same ticker from a different issuer (say `TSLAx` from Backed vs `TSLAon`
from Ondo vs `TSLA` from Robinhood) is a different, separately-selectable asset;
the same (ticker, issuer) across many chains collapses to one. That yields
~2,300 instruments, ~1,300 of them priceable.

```
cd demo && npm install
node build-catalog.mjs   # rwa-database.txt -> frontend/catalog.js (+ catalog.json)
```

Open `demo/frontend/build.html`: search/filter the universe, add assets, set a
percentage weight on each (they must sum to 100), name the index and write its
thesis, then "Add index to competition". Download the resulting
`user-baskets.json` into `demo/`. Seven AI-recipe RWA indices ship in
`demo/user-baskets.json` (Mag-7 Tokenized, AI & Semiconductors, Wall Street
Financials, Crypto-Equity Complex, Tokenized Index Funds, Consumer Brands, and a
Precious Metals basket). Five crypto baskets ship in `demo/baskets.mjs`.

## 2. Rebalancer and strategy templates

A rebalance strategy decides *when* to rebalance. Each template is a pure object
exposing `shouldRebalance({now, lastRebalanceAt, currentWeightsBps,
targetWeightsBps})` plus `{id, name, description}`. Shipped templates
(`index/strategies.mjs`):

- Interval: `hourly` (3600000ms), `ten-minute` (600000), `five-minute`
  (300000). Rebalance once the interval has elapsed. Adding more is a one-liner.
- Drift harness: `drift(driftBps=500)`. Rebalance when the max per-asset drift
  `|currentBps - targetBps|` breaches the band (default 5%).
- Combined: `combined({intervalMs, driftBps})`. Rebalance on the interval, or
  early if the drift band is breached.

The rebalancer (`rebalancer/rebalancer.mjs`) runs the loop. Per index, per tick
it reads prices, computes current portfolio weights from holdings * price, asks
the index's strategy `shouldRebalance()`, and if true it computes the target
holdings, obtains the FCC signature from the tee-node `/sign` endpoint, and
relays the real on-chain `rebalance()`.

```
DRY=1 node rebalancer/rebalancer.mjs   # no chain, no key: logs decisions
```

DRY mode (default when no `PK` is set) simulates holdings and just logs each
decision with its reason ("first rebalance", "interval elapsed", "drift Xbps >=
Ybps"), so it runs with zero external dependencies. LIVE mode (`PK` set, plus a
`VAULTS` json of `{indexId: vaultAddr}`) relays real rebalances signed by the
FCC tee-node.

### The vault

`src/StableIndexVault.sol` is the current vault: stablecoin-denominated.
`deposit(amount)` pulls the USD stablecoin via `transferFrom`; `rebalance(
weightsBps, pricesE18, sig)` moves holdings to the target weights and is gated by
an FCC signature over `(vault, nonce, weightsBps, pricesE18)`. Cash is the
stablecoin, valued at 1.0 USD, so no cash price is signed. NAV is computed in USD
from `holdings * price + cash`. `src/MockUSDC.sol` is the 6-decimals mock
stablecoin used for the demo.

`src/SyntheticIndexVault.sol` is the prior FTSO-native vault, kept for the
existing Coston2 deploy: it holds native C2FLR and signs `(weights, prices,
flrUsd)`. Both vaults share the same idea: the vault only checks the enclave
signature and never reads a feed itself, so the price source is an off-chain
detail. Crypto and RWA legs go through the exact same on-chain rebalance.
Holdings are synthetic on the testnet (priced by the signed values, no DEX
needed); on Hyperliquid the same signed rebalance becomes real orders through an
agent wallet.

## 3. Frontend / leaderboards

The demo is the leaderboard, static pages served as plain `<script>` includes,
so no server is needed: open the files directly (if your browser blocks local
file scripts, serve the folder with `npx serve` or `python3 -m http.server`).

- `frontend/index.html` - the stablecoin leaderboard for the `index/` +
  `rebalancer/` loop. Ranks indices by USD NAV and shows each index's weights,
  strategy, and last rebalance reason. `frontend/data.js` (`window.DEMO`) is
  written by `demo/orchestrate-rebalance.mjs`; a deterministic sample is checked
  in so it renders without a chain.
- `demo/frontend/build.html` - the **index builder**. Search and filter the
  ~2,300-asset RWA universe, add assets, set each weight, export
  `user-baskets.json` for the competition.
- `demo/frontend/index.html` - the attested **RWA leaderboard**. Ranks every
  index by its (simulated) 7-day return with per-leg price-source badges, the
  fee, and links to the on-chain vault and rebalance tx when run with a `PK`.
- `demo/frontend/live.html` - the **live competition** board (real market data,
  see below). Auto-refreshes every 15s while `compete.mjs` runs.

## Real competition (live data)

The attested leaderboard scores a rebalance on a simulated P&L path. To run a
*real* competition instead, `demo/compete.mjs` prices every index on live market
data (`demo/prices.mjs`), runs the rebalancer, and tracks realized return over a
window. Each index starts with equal capital; ranking at the end is the real
return. Every `REBALANCE_SEC` the rebalancer resets each index's holdings to its
target weights at current prices (a constant-mix strategy), the exact action the
FCC enclave signs on-chain, here run against live data so you can watch it.

**Price source (`PRICE_SOURCE`)**

- `hl` (default) - **Hyperliquid mainnet oracle**, the target venue. Prices the
  exact HIP-3 stock/commodity/metal perps (and crypto) an index would trade
  against, read-only and free, so no capital and no tokens are needed. Legs not
  listed on HL are dropped and the index's remaining weights renormalized, with
  coverage shown; an index with nothing on HL is marked not executable and
  excluded from the ranking.
- `yahoo` - venue-agnostic: **Yahoo Finance** for RWA legs (token mapped to its
  underlying, metals to futures `GC=F/SI=F/PL=F/PA=F`) and **CoinGecko** for
  crypto. Full coverage of the seed indices.

```
cd demo
node compete.mjs                                  # HL oracle, 1h, rebalance 15m, $100k each
PRICE_SOURCE=yahoo node compete.mjs               # Yahoo/CoinGecko instead
DURATION_SEC=3600 INTERVAL_SEC=30 REBALANCE_SEC=600 node compete.mjs
INCLUDE_CRYPTO=1 node compete.mjs                 # add the 5 crypto baskets to the field
```

It writes `frontend/live.js` every tick; open `demo/frontend/live.html` to
watch. Cash equities only move while US markets are open, but metals and crypto
move ~24h and keep the board alive off-hours.

Note the two price paths: the `index/` + `rebalancer/` loop uses the offline
stub in `index/prices.mjs` (with the Uniswap seam) so it runs with zero
dependencies, while `demo/compete.mjs` uses the live market sources in
`demo/prices.mjs`. They are deliberately separate: the stub is for the
deterministic strategy demo, the live sources are for the real competition.

### Why Hyperliquid, not a testnet

The tokenized stocks live on **Hyperliquid mainnet** (HIP-3 perp dexes: AAPL,
NVDA, TSLA, GOLD, ...). Coston2 has no equities, and HL *testnet* has only
crypto perps plus unverified squatter spot tokens, so a testnet does not make
the stock competition more real, it makes it fake. Reading the HL mainnet oracle
(free) is the faithful, zero-capital way to run it; real execution is the same
code with an order-placing adapter, provable cheaply on HL testnet for a
crypto-only index.

## Quickstart

Tests:

```
npm install
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
forge test -vv
```

Demo on Coston2. Build the real tee-node image once (from the FCC scaffold),
then run a loop inside its network namespace so the enclave signs:

```
cd demo && npm install
node build-catalog.mjs   # rwa-database.txt -> frontend/catalog.js (skip if unchanged)

git clone https://github.com/flare-foundation/fce-extension-scaffold
docker build -f fce-extension-scaffold/go/Dockerfile -t are/real-tee-node:v0.0.24 fce-extension-scaffold
docker run -d --name tee -e MODE=1 -e SIMULATED_TEE=true -e CHAIN_ID=114 \
  -e PROXY_URL=http://127.0.0.1:1 -e SIGN_PORT=7701 are/real-tee-node:v0.0.24

# RWA + crypto attested leaderboard (simulated P&L):
docker run --rm --network container:tee -v "$PWD":/demo -w /demo \
  -e PK=<throwaway-coston2-key> node:22-alpine node orchestrate.mjs

# stablecoin StableIndexVault loop (index/ + rebalancer/):
docker run --rm --network container:tee -v "$PWD/..":/app -w /app \
  -e PK=<throwaway-coston2-key> node:22-alpine node demo/orchestrate-rebalance.mjs
```

Without a `PK` (and no tee-node), `node orchestrate.mjs` runs in preview mode:
it resolves prices and writes the leaderboard with no on-chain tx.

## Layout

```
index/                        index defs, strategies, prices, AI weight generation
  strategies.mjs              interval + drift + combined rebalance templates
  generate.mjs                Claude Code (Haiku) prompt -> weights + refresh loop
rebalancer/rebalancer.mjs     the rebalance loop (DRY + LIVE)
frontend/                     stablecoin leaderboard (index/ + rebalancer/ loop)
src/StableIndexVault.sol      current vault: stablecoin-denominated, FCC-gated
src/MockUSDC.sol              6-decimals mock stablecoin
src/SyntheticIndexVault.sol   prior FTSO-native vault (existing Coston2 deploy)
src/AttestedEpochRegistry.sol N-of-N attestation gate (+ attestation/ libs/ consumers/)
test/                         Foundry tests (17, passing)
rwa-database.txt              raw universe (tab-separated, gitignored - local only)
demo/catalog.json             derived universe read by orchestrate (committed)
demo/frontend/catalog.js      derived universe read by the builder (committed)
demo/build-catalog.mjs        rwa-database.txt -> catalog (dedup by ticker+issuer)
demo/baskets.mjs              5 crypto index prompts + weights
demo/user-baskets.json        7 AI-recipe RWA indices (editable in the builder)
demo/orchestrate.mjs          RWA + crypto: deposits + FCC-signed on-chain rebalance
demo/orchestrate-rebalance.mjs stablecoin StableIndexVault loop
demo/prices.mjs               live price sources (Hyperliquid oracle / Yahoo / CoinGecko)
demo/compete.mjs              real competition: live prices, rebalancer loop, ranking
demo/frontend/build.html      the index builder (pick assets, set weights)
demo/frontend/index.html      attested RWA leaderboard (simulated 7d P&L)
demo/frontend/live.html       live competition board (real data, auto-refresh)
enclave/                      the FCC tee-node signer
DEPLOYMENT.md                 live Coston2 addresses + tx hashes
SPEC.md                       the rewrite spec
```

## Phase 2

- Uniswap V3 pool TWAP price source. The seam is documented in
  `index/prices.mjs`: a `createUniswapPriceSource({provider, pools})` factory
  returns the same `getPrices(symbols) -> {SYM: number}` interface, so it drops
  in without touching the rebalancer, the generator, or the orchestrator.

## Roadmap: Hyperliquid

The demo runs on Flare because that is where FCC lives. The target venue is
Hyperliquid: each index becomes an autonomous vault (leader = the FCC enclave
holding a trade-only agent wallet) or a HIP-3 index perp, the leaderboard is
native, and the fee is a builder code. The FCC attestation is the edge over a
human vault leader.

## Trust / attestation (footnote)

The rebalance is gated by a signature from a rebalancer key that lives inside a
Flare Confidential Compute (FCC) tee-node, so the allocation is executed
autonomously and the rebalance is a real on-chain state change rather than a
value someone typed in. A separate `AttestedEpochRegistry` provides an N-of-N
attestation gate: multiple enclaves must agree on an epoch's output root before
it finalizes, and a substituted result cannot be attested. The enclave wiring is
in `enclave/` and the live proof (real tee-node v0.0.24, MODE=1, signatures and
finalized epochs) is in `DEPLOYMENT.md`.

## Notes

Deposits, fees, and rebalances are real on Coston2. Three things are not
production yet: the multi-day performance shown is simulated from the price
baseline (a real week takes a week); RWA legs are priced from the catalog
snapshot where no live feed exists (a real deployment would wire an oracle per
asset); and attestation runs in MODE=1 (simulated hardware), with MODE=0 on
Confidential Space the only change for real hardware attestation.
