# Index Competition

Build an index. Deposit into it. Let an autonomous rebalancer run it. Compete.

An index is the headline primitive: a prompt, a set of asset weights, and a
rebalance strategy. This board is RWA-only: indices are defined over a universe
of ~2,300 tokenized real-world assets (equities, ETFs, metals, perps), ~1,300
of them priceable. No crypto is selectable anywhere. A rebalancer
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
  (RWA-only)
```

## 1. Index

An index record is `{ id, name, prompt, weights, strategy }`:

- `weights`: symbol -> integer percent, summing to 100.
- `strategy`: a reference to a rebalance strategy template (see section 2).
- `prompt`: the natural-language recipe that produced the weights.

Definitions and tooling live in `index/`:

```
index/assets.mjs      allowed asset symbols (empty: RWA-only, no crypto)
index/indices.mjs     the static index definitions (RWA sample indices)
index/weights.mjs     normalize/renormalize weights, pct <-> bps
index/strategies.mjs  rebalance strategy templates
index/prices.mjs      stub USD price source + Uniswap V3 pool price source
index/generate.mjs    AI weight + whole-index generation via Claude Code
index/catalog.mjs     the RWA-only selectable universe (from scripts/catalog.json)
```

An index can be fully static (a fixed prompt + weights + strategy) or it can
restate its weights, or its whole self, from its prompt.

### Whole-index generation (prompt -> entire index)

`generateIndex(prompt)` in `index/generate.mjs` turns one natural-language
prompt into a complete index object:

```
{ name, rationale, assets, weights, strategy }
```

`assets`/`weights` use catalog ids chosen ONLY from the universe. Because the
catalog is ~2,300 rows, the generator does NOT dump it into the prompt: it
builds a compact candidate shortlist for the prompt (keyword overlap on
ticker/name/class, top-N by volume), all RWA, asks the model to pick
tickers from that shortlist, then validates the answer against the catalog
(drops unknown tickers, renormalizes weights to sum 100, coerces the strategy to
a known id, default `hourly-or-drift`). On any failure it returns a safe default
index and logs that live-gen is unavailable.

```
node index/generate.mjs --index "A gold-heavy precious metals hedge with silver and platinum"
```

Sample (real `claude -p`, catalog-validated):

```
{ "name": "Gold-Led Precious Metals Hedge",
  "rationale": "Gold-dominant allocation with tactical silver and platinum ...",
  "assets": ["GLD::robinhood-markets-inc","SLV::robinhood-markets-inc",
             "PPLTon::ondo-global-markets-bvi-limited"],
  "weights": {"GLD::robinhood-markets-inc":70, "SLV::robinhood-markets-inc":15,
              "PPLTon::ondo-global-markets-bvi-limited":15},
  "strategy": "hourly-or-drift" }
```

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
per-call timeout to bound cost, and is safe to Ctrl-C. So an index like "the
largest tokenized US tech equities" restates its RWA weights each minute.

### Build your own index (RWA universe)

`rwa-database.txt` is the raw universe: ~8,900 tokenized-asset listings across
issuers, venues and chains. It is large and kept out of git (see `.gitignore`);
the committed, derived catalog (`scripts/catalog.json`, mirrored to
`app/public/data/catalog.json`) is what the app reads, so you only need the raw
txt to regenerate it. `scripts/build-catalog.mjs` collapses it to the set of
selectable instruments using one identity rule: **an asset is unique by (Ticker,
Issuer)**. The same ticker from a different issuer (say `TSLAx` from Backed vs
`TSLAon` from Ondo vs `TSLA` from Robinhood) is a different, separately-selectable
asset; the same (ticker, issuer) across many chains collapses to one. That yields
~2,300 instruments, ~1,300 of them priceable.

```
node scripts/build-catalog.mjs   # rwa-database.txt -> scripts/catalog.json
```

The `app/` `/build` page (see Frontend below) is the builder: search/filter the
universe, add assets, set an integer weight on each (they must sum to 100), pick
a rebalance strategy, name the index, write its thesis, and add it to the
competition (optionally depositing into a vault via the EVM seam). It also has a
"Generate from prompt" box wired to whole-index generation. When the local
server is running (`npm run compete`), "Add to competition" POSTs the basket to
`/api/add`, which scores it with the real rebalance math, tags it `owner:"you"`
so the live engine races it, and ranks it on the leaderboard. If the server is
unreachable the submission fails loudly (a red error), so nothing is silently
lost. Seven AI-recipe RWA indices ship as seed baskets in
`app/public/data/user-baskets.json` (Mag-7 Tokenized, AI & Semiconductors, Wall
Street Financials, Crypto-Equity Complex, Tokenized Index Funds, Consumer Brands,
and a Precious Metals basket). All baskets, house and user, are RWA-only.

## 2. Rebalancer and strategy templates

A rebalance strategy decides *when* to rebalance. Each template is a pure object
exposing `shouldRebalance({now, lastRebalanceAt, currentWeightsBps,
targetWeightsBps, nav, lastRebalanceNav})` plus `{id, name, description}`.
Shipped templates (`index/strategies.mjs`), grouped as the FE picker shows them:

- Intervals (rebalance once the interval has elapsed): `minute` (60000ms),
  `five-minute` (300000), `ten-minute` (600000), `thirty-minute` (1800000),
  `hourly` (3600000), `daily` (86400000).
- Drift harnesses (rebalance when max per-asset drift `|currentBps - targetBps|`
  breaches the band): `drift-2` (200bps), `drift-5` (500), `drift-10` (1000),
  `drift-20` (2000).
- Cooldown-gated drift (rebalance on a drift breach, but not more often than a
  minimum interval): `cooldown-drift-5-hourly`, `cooldown-drift-2-ten-minute`.
- Take-profit (rebalance when NAV is up >= X% since the last rebalance):
  `take-profit-5`, `take-profit-10`.
- Combined interval+drift (interval, or early on a drift breach):
  `five-minute-or-drift-2`, `ten-minute-or-drift-2`, `thirty-minute-or-drift-5`,
  `hourly-or-drift-5`.

The factory functions `interval`, `drift`, `combined`, `cooldownDrift`,
`takeProfit` build these; adding more is a one-liner. The legacy ids `drift-5pct`
and `hourly-or-drift` are kept as aliases. `app/src/core/strategies.ts` mirrors
the same ids/names/descriptions (grouped) for the `/build` picker.

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
stablecoin used for the demo: `mint(address to, uint256 amount)` mints any
amount and `faucet()` mints a fixed 1000e6 (1000 test USD, 1:1) to the caller,
so anyone can fund a deposit on testnet.

`src/SyntheticIndexVault.sol` is the prior FTSO-native vault, kept for the
existing Coston2 deploy: it holds native C2FLR and signs `(weights, prices,
flrUsd)`. Both vaults share the same idea: the vault only checks the enclave
signature and never reads a feed itself, so the price source is an off-chain
detail. Crypto and RWA legs go through the exact same on-chain rebalance.
Holdings are synthetic on the testnet (priced by the signed values, no DEX
needed); on Hyperliquid the same signed rebalance becomes real orders through an
agent wallet.

## 3. Frontend (`app/`)

One cohesive Flare-styled app (Vite + React 19 + Mantine + TanStack Router,
using the Flare smart-accounts theme, Satoshi font, and logo) covers the whole
product. It replaces the old fragmented static pages. Three routes:

- `/build` (the landing) - the **index builder**. Search/filter the RWA-only
  universe (the ~1,300 priceable RWA instruments from
  `app/public/data/catalog.json`; no crypto), add assets, set integer weights
  summing to 100, pick a rebalance strategy from the grouped picker (intervals /
  harnesses / combined, each with its one-line description), name the index and
  write a thesis, then "Mint 1000 test USD" (real `MockUSDC.mint` when a wallet
  is connected, mocked otherwise) and "Add to competition" (optionally depositing
  via the EVM seam). "Add to competition" only succeeds if the competition server
  accepts it; if the server is unreachable it shows a red error and adds nothing.
  A "Generate from prompt" box calls whole-index generation and pre-fills the
  builder. Both the generate and add actions call the local server (below) when
  it is running.
- `/leaderboard` - the ranked indices. USD NAV, weights, strategy, last
  rebalance reason, fee, and on-chain links (vault + rebalance tx when present).
  Reads `app/public/data/leaderboard.json`, which the live engine, the server's
  `/api/add`, and `scripts/orchestrate-rebalance.mjs` write (a deterministic
  sample is checked in so it renders without a chain).
- `/live` - the live competition board: per-index NAV/return lines over time
  (recharts), live rank with up/down movement, returnPct, strategy badge,
  coverage, last-rebalance reason, and on-chain badge when applicable.
  Auto-refresh every 5s. Reads `app/public/data/live.json`, which
  `scripts/live-engine.mjs` (or the legacy `scripts/compete.mjs`) writes each
  tick. The field is the 5 house indices plus any basket you submit from
  `/build`: submissions are picked up on the next tick, baselined at current
  prices (return starts at 0), tagged with a teal "Yours" badge and a subtle row
  highlight, and race exactly like a house index. One house index ("AI &
  Semiconductors") runs the `minute` strategy so it visibly rebalances about once
  a minute. Each submitted basket carries a Coston2 explorer tx + vault link: the
  real rebalance tx when run on-chain (PK + TEE_SIGN_URL), otherwise a real,
  resolvable reference tx labelled "(sample)".

### Run it (one command)

```
npm install                 # once, at the repo root
npm install --prefix app    # once, app deps
npm run demo                # server (:8787) + Vite dev server (:3000)
npm run compete             # live engine + server (:8787) + app (:3000)
```

`npm run demo` (`scripts/start.mjs`) starts both the local API server and the
app. Open http://localhost:3000/build, type a prompt to generate a real index
(Claude Haiku, catalog-validated), tweak the weights, and "Add to competition":
the server scores it with the real rebalance math and it appears ranked on
http://localhost:3000/leaderboard. The API is at http://localhost:8787.

`npm run compete` (`scripts/start-compete.mjs`) additionally runs the live
competition engine, so `/live` and `/leaderboard` move on live market data (see
the live competition engine section below). Ports: app :3000, API :8787.

The local server (`scripts/server.mjs`):

- `POST /api/generate {prompt}` -> `generateIndex()` (real Claude Haiku, catalog
  validated); returns `{name,rationale,assets,weights,strategy,source}` where
  `source` is `live` or `fallback` if the CLI is unavailable.
- `POST /api/add {basket}` -> validates against the catalog + strategies,
  appends to `user-baskets.json` (dedup by id), scores with the real vault
  rebalance math on the Uniswap price source (mock pools seeded from the
  catalog), upserts into `leaderboard.json` and re-ranks. With `PK` +
  `TEE_SIGN_URL` set it does the real Coston2 deposit + FCC-signed rebalance and
  records tx hashes; otherwise it scores off-chain.
- `GET /api/leaderboard` -> the current leaderboard.

The app falls back gracefully with the server absent: generation uses an
in-browser heuristic, and "Add" keeps the local-only session list with a notice.

```
cd app && npm install && npm run build   # production build
```

The connect-wallet UI keeps the Flare look, but deposits run on an EVM seam
(`app/src/core/evm-seam.ts`) that is mocked by default and does a real Coston2
`approve` + `vault.deposit()` only when an injected wallet is present and the
stable address is configured. The XRPL/FAssets domain pages and wallet plumbing
from the template are intentionally not carried over.

## Real competition (live data)

The attested leaderboard scores a rebalance on a simulated P&L path. To run a
*real* competition instead, `scripts/compete.mjs` prices every index on live
market data (`scripts/prices.mjs`), runs the rebalancer, and tracks realized
return over a window. Each index starts with equal capital; ranking at the end
is the real return. Every `REBALANCE_SEC` the rebalancer resets each index's holdings to its
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
node scripts/compete.mjs                                # HL oracle, 1h, rebalance 15m, $100k each
PRICE_SOURCE=yahoo node scripts/compete.mjs             # Yahoo/CoinGecko instead
DURATION_SEC=3600 INTERVAL_SEC=30 REBALANCE_SEC=600 node scripts/compete.mjs
INCLUDE_CRYPTO=1 node scripts/compete.mjs               # add the 5 crypto baskets to the field
```

It writes `app/public/data/live.json` every tick; open the app's `/live` route
to watch. Cash equities only move while US markets are open, but metals and
crypto move ~24h and keep the board alive off-hours.

Note the two price paths: the `index/` + `rebalancer/` loop uses
`index/prices.mjs` (the offline stub, or the Uniswap V3 pool source, see below)
so it runs with zero dependencies, while `scripts/compete.mjs` uses the live
market sources in `scripts/prices.mjs`. They are deliberately separate: the
stub/pools are for the deterministic strategy demo, the live sources for the real
competition.

## Live competition engine (`scripts/live-engine.mjs`) + `npm run compete`

`scripts/live-engine.mjs` is a continuous loop that turns the board into a real,
always-moving competition. It seeds a field of exactly five solid, distinct
RWA-only indices, each carrying a strategy from the expanded templates:

- **Big-Tech RWA** - tokenized mega-cap US tech (`thirty-minute-or-drift-5`)
- **AI & Semiconductors** - GPU/foundry/memory names (`minute`) - the 1-minute
  index that visibly rebalances about once a minute
- **Wall Street Financials** - money-center bank + card networks (`ten-minute-or-drift-2`)
- **Precious Metals** - gold-heavy metals hedge (`hourly-or-drift-5`)
- **Tokenized Index Funds** - broad-market tokenized ETFs (`drift-5`)

Every TICK (default `TICK_MS=15000`) it:

- fetches LIVE prices on Yahoo only (RWA): tokenized equities to the bare ticker,
  metals to futures `GC=F/SI=F/PL=F/PA=F`. No crypto/CoinGecko dependency. Calls
  are batched within a tick; a failed fetch keeps the last good price, and any
  symbol with no live source evolves off its last good price with a small bounded
  random walk (`WALK_BPS`, default 25) so the board always moves.
- takes a t0 baseline and tracks each index's NAV and return since t0.
- per index: computes current weights from `holdings * price`, runs the index's
  `strategy.shouldRebalance()`, and when true rebalances to target with the real
  vault math (`nav`, then `holdings[i] = nav*wBps/10000/price[i]`), logging the
  reason (`first rebalance`, `interval elapsed`, `drift Xbps >= Ybps`,
  `take-profit +X% >= Y%`). This is a constant-mix competition with per-index
  strategy timing.
- writes `app/public/data/live.json` every tick (per index: name, strategy,
  weights, NAV, returnPct, a NAV time-series for charting, last-rebalance reason,
  rank) and refreshes `app/public/data/leaderboard.json` ranked by return. So
  `/live` and `/leaderboard` update live.

Off-chain by default (no key, just live prices). ON-CHAIN when `PK` +
`TEE_SIGN_URL` are set: run `scripts/compete-setup.mjs` first to deploy
`MockUSDC` + one `MockUniswapV3Pool` per asset + five `StableIndexVault`s, mint
stable, deposit into each vault, and write `app/public/data/compete-onchain.json`
(the address maps the engine reads). Then each tick the engine pushes the live
price into every pool via `setPriceE18`, reads `slot0()` back (the real on-chain
price), and relays a real FCC-signed `rebalance()` for triggered indices,
recording tx hashes in `live.json`. Same loop, one flag. Safe to Ctrl-C; the
sample data is left in place.

```
node scripts/live-engine.mjs                       # off-chain, live prices, tick 15s
TICK_MS=5000 WALK_BPS=50 node scripts/live-engine.mjs
node scripts/compete-setup.mjs                     # (needs PK) deploy stable+pools+vaults
PK=... TEE_SIGN_URL=... node scripts/live-engine.mjs   # ON-CHAIN mode
npm run compete                                    # engine + API (:8787) + app (:3000)
```

`npm run compete` (`scripts/start-compete.mjs`) boots the live engine, the API
server, and the Vite dev server together, then shuts them all down on Ctrl-C.
Open http://localhost:3000/live to watch the board move and
http://localhost:3000/leaderboard for the live ranking. It is on-chain when
`PK` + `TEE_SIGN_URL` are set (after `compete-setup`), off-chain on live prices
otherwise. This is the live counterpart of `npm run demo` (server + app only).

## Real pricing via Uniswap V3 pools (mocked on Coston2)

`index/prices.mjs` exports `createUniswapPriceSource({provider, pools,
fallbackSource, Contract})`, returning the same `getPrices(symbols) -> {SYM:
number}` interface. It reads each asset's pool `slot0()` sqrtPriceX96 and
converts it to USD, mirroring `src/MockUniswapV3Pool.sol` exactly. `poolsFor()`
builds the `{SYM: poolAddress}` map. On Coston2 the pools are the deployed
`MockUniswapV3Pool` mocks (one per asset, paired with `MockUSDC`) acting as the
on-chain settlement price-holder: the keeper pushes the live market price in
(`setPriceE18`) and the vault reads `slot0` to rebalance. The reader can point at
a real pool where deep EVM liquidity exists (for example gold, the XAUt/USDT
Uniswap V3 pool on Ethereum); most tokenized US equities trade on Solana/CEXes
with no readable EVM pool, so they stay on the live feed (Yahoo). An asset with
no pool falls back to `fallbackSource`, and each leg reports which source priced
it (`uniswap` vs `fallback`).

`src/MockUniswapV3Pool.sol` implements enough of the real V3 interface that a
standard reader works: `slot0()` (sqrtPriceX96 seeded to a target price),
`token0()/token1()` (address-sorted pair ordering), and `observe()` (constant
cumulative ticks so a TWAP over any window resolves to the seeded price).
`seedPriceUsdE18(uint256)` initializes the pool (open, used by seed scripts and
tests); `setPriceE18(uint256)` is an owner-only live price setter (emits
`PriceUpdated`) so the live-engine keeper can push each tick's price on-chain
while the `slot0()/observe()` read path stays intact. The vault interface is
unchanged: the rebalancer reads pool prices off-chain and feeds them into the
existing signed `rebalance(weightsBps, pricesE18, sig)` path, so no on-chain
reader contract is needed.

```
# offline proof: seed pools in-process, read them back, build a rebalance call:
node scripts/uniswap-seed.mjs
# live: deploy MockUSDC + one pool per asset on Coston2, seed, relay a rebalance:
PK=<throwaway-coston2-key> node scripts/uniswap-seed.mjs
# route the stablecoin rebalancer through pools with POOLS=<{SYM:addr} json>:
PK=<key> POOLS=pools.json node rebalancer/rebalancer.mjs
```

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

The full flow (server + app):

```
npm install                 # repo root
npm install --prefix app    # app deps
npm run demo                # server :8787 + app :3000, open /build
```

Real on Coston2. Build the real tee-node image once (from the FCC scaffold),
then run the server or the orchestrator inside its network namespace so the
enclave signs. The server does the deposit + FCC-signed rebalance per submitted
index when `PK` + `TEE_SIGN_URL` are set:

```
node scripts/build-catalog.mjs   # rwa-database.txt -> scripts/catalog.json

git clone https://github.com/flare-foundation/fce-extension-scaffold
docker build -f fce-extension-scaffold/go/Dockerfile -t are/real-tee-node:v0.0.24 fce-extension-scaffold
docker run -d --name tee -e MODE=1 -e SIMULATED_TEE=true -e CHAIN_ID=114 \
  -e PROXY_URL=http://127.0.0.1:1 -e SIGN_PORT=7701 are/real-tee-node:v0.0.24

# stablecoin StableIndexVault loop for the 5 crypto indices (index/ + rebalancer/):
docker run --rm --network container:tee -v "$PWD":/app -w /app \
  -e PK=<throwaway-coston2-key> node:22-alpine node scripts/orchestrate-rebalance.mjs
```

Without a `PK` (and no tee-node), the server scores off-chain: it computes NAV
and holdings with the real vault rebalance math and writes the leaderboard with
no on-chain tx.

## Layout

```
index/                        index defs, strategies, prices, AI generation
  strategies.mjs              interval + drift + combined rebalance templates
  generate.mjs                Claude Code (Haiku): prompt -> weights or whole index
  catalog.mjs                 the RWA-only selectable universe
  prices.mjs                  stub source + Uniswap V3 pool price source
rebalancer/rebalancer.mjs     the rebalance loop (DRY + LIVE, optional pools)
app/                          the Flare-styled single app (Vite + React + Mantine)
  src/routes/                 /build, /leaderboard, /live
  src/core/                   wallet + EVM deposit seam, data hooks, generate seam
  public/data/                catalog.json, user-baskets.json, leaderboard/live json
src/StableIndexVault.sol      current vault: stablecoin-denominated, FCC-gated
src/MockUSDC.sol              6-decimals mock stablecoin
src/MockUniswapV3Pool.sol     V3 pool mock: slot0/observe seeded to a USD price
src/SyntheticIndexVault.sol   prior FTSO-native vault (existing Coston2 deploy)
src/AttestedEpochRegistry.sol N-of-N attestation gate (+ attestation/ libs/ consumers/)
test/                         Foundry tests (23, passing)
rwa-database.txt              raw universe (tab-separated, gitignored - local only)
scripts/catalog.json          derived universe read by scripts + app (committed)
scripts/build-catalog.mjs     rwa-database.txt -> catalog (dedup by ticker+issuer)
scripts/server.mjs            local API: /api/generate, /api/add (scores + ranks), /api/leaderboard
scripts/orchestrate-add.mjs   on-chain deposit + FCC-signed rebalance for one submitted basket
scripts/start.mjs             one command: server + Vite dev server together (npm run demo)
scripts/baskets.mjs           5 crypto index prompts + weights
scripts/user-baskets.json     7 AI-recipe RWA indices (seed for the app)
scripts/orchestrate-rebalance.mjs stablecoin StableIndexVault loop -> app leaderboard
scripts/uniswap-seed.mjs      deploy/seed V3 pools + rebalance on pool prices
scripts/prices.mjs            live price sources (Hyperliquid oracle / Yahoo / CoinGecko)
scripts/compete.mjs           real competition: live prices, rebalancer loop, ranking
enclave/                      the FCC tee-node signer
DEPLOYMENT.md                 live Coston2 addresses + tx hashes
SPEC.md                       the rewrite spec
```

## Phase 2

- Uniswap V3 pool price source: DONE. `createUniswapPriceSource` in
  `index/prices.mjs` reads each asset's pool `slot0` sqrtPriceX96 and drops into
  the rebalancer, generator and orchestrator unchanged. On Coston2 the pools are
  `MockUniswapV3Pool` mocks that act as the on-chain settlement price-holder (the
  keeper pushes the live market price via `setPriceE18`, the vault reads `slot0`
  to rebalance).
- Point an asset at a real pool where deep EVM liquidity exists (verified: gold,
  the XAUt/USDT Uniswap V3 pool on Ethereum, ~$2.4M TVL). Most tokenized US
  equities trade on Solana/CEXes with no readable EVM pool, so they stay on the
  live market feed (Yahoo); the mock pool remains the on-chain settlement holder.

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
