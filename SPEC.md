# SPEC: ARE index-first rewrite

This is the shared contract for the rewrite. Workers code to the interfaces
here. If a worker needs an interface change, the architect adjudicates and
updates this file.

Style rules (enforced on every file):
- No emojis. No em dashes. Use hyphen, comma, colon, or two sentences.
- Terse code, comments max one line where they earn their place.
- Node: ESM (.mjs), ethers v6 style matching scripts/.
- Solidity: pragma ^0.8.25, SPDX MIT, prettier printWidth 80, tabWidth 4
  spaces, double quotes, bracketSpacing false (so {value: x}, no inner space),
  trailingComma es5. Resolve Flare contracts via ContractRegistry only if
  needed; the new vault needs no Flare contracts at all.

## What changed vs the old project (re-centering)

The project is re-centered so INDEX, REBALANCER, FRONTEND are the front of the
repo. FTSO and native C2FLR pricing are removed from the vault. The vault is
now denominated in a mock USD stablecoin. Attestation/FCC is demoted to a
README footnote but the enclave wiring and the on-chain FCC signature gate on
rebalance() are kept.

Superseded files:
- src/SyntheticIndexVault.sol -> superseded by src/StableIndexVault.sol. The
  old file is KEPT for the historical Coston2 deploy referenced in
  DEPLOYMENT.md, but is no longer the primary vault. Its ABI artifact
  scripts/abi/SyntheticIndexVault.json is also kept.
- index/indices.mjs holds the 5 RWA sample indices (RWA-only board; the old
  crypto baskets in scripts/baskets.mjs are legacy and no longer selectable).
- The static frontends (top-level frontend/, and the old demo/frontend/*.html)
  -> superseded by app/, a single Flare-styled React app. REMOVED. The
  derived data now lives as plain JSON under app/public/data/.

DEPLOYMENT.md is preserved verbatim; new deploys append only.

## Target repo shape

```
index/
  assets.mjs        allowed asset symbols (no FLR-as-cash; FLR is just an asset)
  indices.mjs       static index definitions (id, name, prompt, weights, strategy)
  strategies.mjs    rebalance strategy templates (intervals + drift + cooldown
                    + take-profit + combined; grouped, ~18 ids + 2 legacy aliases)
  prices.mjs        stub USD price source + documented Uniswap V3 TWAP seam
  generate.mjs      Claude Haiku headless weight generation + refresh loop
  test/strategies.test.mjs   node test harness for strategies + prices
rebalancer/
  rebalancer.mjs    main loop, DRY (no chain) + LIVE (chain + FCC sign)
src/
  MockUSDC.sol         6-decimals ERC20, public mint + faucet() (1000e6 to caller)
  MockUniswapV3Pool.sol V3 mock; seedPriceUsdE18 + owner-only setPriceE18 keeper
  StableIndexVault.sol stablecoin-denominated vault, FCC-gated rebalance
  (kept) SyntheticIndexVault.sol, attestation/, libs/, consumers/
frontend/
  index.html, data.js  leaderboard, USD NAV, shows strategy + rebalance reason
enclave/            unchanged tee-node signer
test/               Foundry: AttestedEpochRegistry.t.sol (kept),
                    StableIndexVault.t.sol, MockUSDC.t.sol (faucet),
                    MockUniswapV3Pool.t.sol (setPriceE18 round-trip)
scripts/            orchestrate-rebalance.mjs (stablecoin + new vault), server.mjs
                    (local API), compete.mjs (legacy windowed), uniswap-seed.mjs;
                    live-engine.mjs (continuous live competition, off/on-chain),
                    compete-setup.mjs (on-chain deploy of stable+pools+vaults),
                    start-compete.mjs (npm run compete: engine+API+app); abi/ has
                    StableIndexVault.json + MockUSDC.json + MockUniswapV3Pool.json
README.md           inverted order
DEPLOYMENT.md       preserved
SPEC.md             this file
```

## Assets

RWA-only board: there are no fixed crypto symbols. index/assets.mjs exports an
empty ASSETS list (kept for legacy importers, but nothing can select crypto):
```
export const ASSETS = [];
```
The selectable universe is the RWA catalog (scripts/catalog.json, ~1,300
priceable instruments), resolved via index/catalog.mjs. Ids are `Ticker::issuer`.
Cash is the stablecoin (USD = 1.0) and is NOT one of them.

## Contracts

### MockUSDC.sol
Minimal ERC20, 6 decimals, name "Mock USD Coin", symbol "mUSDC". Public
`mint(address to, uint256 amount)` for demo funding plus `faucet()` that mints a
fixed `FAUCET_AMOUNT` = 1000e6 (1000 test USD, 1:1) to `msg.sender` and emits
`Faucet` (testnet only, mint test USD 1:1). Extend OZ ERC20 with `decimals()`
overridden to 6. OZ path: `@openzeppelin/contracts/token/ERC20/ERC20.sol`.
Tested in test/MockUSDC.t.sol.

### StableIndexVault.sol
Stablecoin-denominated index vault. Constructor:
`constructor(address _rebalancer, address _stable, uint256 _n)`.
- `rebalancer` (immutable): the FCC enclave signer address.
- `stable` (immutable IERC20): the USD stablecoin, cash valued at 1.0 USD.
- `n` (immutable): number of index assets.

State:
- `uint256[] holdings` (1e18 synthetic units per asset).
- `uint256 cash` (stablecoin balance held as cash, in stable's own decimals).
- `uint256 totalDeposited` (cumulative deposits in stable units).
- `uint256 nonce`.

Interface:
```
function getHoldings() external view returns (uint256[] memory);
function deposit(uint256 amount) external;   // pulls via transferFrom
function rebalance(
    uint16[] calldata weightsBps,
    uint256[] calldata pricesE18,
    bytes calldata sig
) external;
```
Events:
```
event Deposited(address indexed from, uint256 amount);
event Rebalanced(
    uint256 nonce,
    uint16[] weightsBps,
    uint256[] holdings,
    uint256 navUsd1e18
);
```
Errors: BadSig, BadLen, BadWeights, Empty.

deposit(amount): `stable.safeTransferFrom(msg.sender, address(this), amount)`;
`cash += amount; totalDeposited += amount;` emit.

rebalance signature gate (drops flrUsd, matches old ordering minus flrUsd):
```
bytes32 h = keccak256(
    abi.encode(address(this), nonce, weightsBps, pricesE18)
);
require ECDSA.recover(ECDSA.toEthSignedMessageHash(h), sig) == rebalancer;
```
Then increment nonce.

NAV in USD 1e18: cash is USD, so scale stable decimals up to 1e18. Stable is
6 decimals, so `cashUsd1e18 = cash * 1e12`. Add
`sum(holdings[i] * pricesE18[i] / 1e18)`. If nav == 0 revert Empty. Then set
targets `holdings[i] = (nav * weightsBps[i] / 10000) * 1e18 / pricesE18[i]`.
Require `sum(weightsBps) == 10000`. Set `cash = 0` (fully deployed). Emit with
nav.

Note: to keep the vault decimals-agnostic and simple, hardcode the 1e12 scale
by requiring stable to be 6 decimals is acceptable for the demo, but PREFER
reading `IERC20Metadata(stable).decimals()` once in the constructor and storing
`stableTo1e18 = 10**(18 - dec)`. Use that factor: `cashUsd1e18 = cash * stableTo1e18`.

Prettier: no space inside braces, 4-space indent, double quotes.

### Foundry tests (test/StableIndexVault.t.sol)
Deploy MockUSDC, mint to a depositor, deposit, sign rebalance with a vm key set
as rebalancer, assert:
- deposit updates cash and totalDeposited.
- rebalance with valid sig sets holdings matching weights and nav; sum of
  holdings*price == nav (within rounding).
- bad signature reverts BadSig.
- weights not summing to 10000 reverts BadWeights.
- wrong array length reverts BadLen.
Keep AttestedEpochRegistry.t.sol passing unchanged.

Regenerate scripts/abi/StableIndexVault.json from forge out (abi + bytecode) for
the orchestrator to deploy.

## Price source (index/prices.mjs)

Deterministic, offline-friendly stub. Exports:
```
export async function getPrices(symbols)   // -> { SYM: usdPriceNumber, ... }
export function getPricesSync(symbols)      // same, from static seed
```
Backed by a static seed map STUB_PRICES (USD floats) for all ASSETS. getPrices
is async to match the future Uniswap reader shape but resolves the seed. Keep a
clean seam:

Uniswap V3 pool price source (BUILT):
`createUniswapPriceSource({provider, pools, fallbackSource, Contract})` returns
the same `{getPrices(symbols)}` interface by reading each asset's pool `slot0`
sqrtPriceX96 and converting to USD (mirrors src/MockUniswapV3Pool.sol). It also
exposes `poolsFor(pools)` and `sqrtPriceX96ToUsd(sp, meta)`, and reports a
per-symbol `sources` map (`uniswap` vs `fallback`). Assets with no pool defer to
`fallbackSource`. The rebalancer/generator/orchestrator depend only on
`getPrices(symbols) -> {SYM: number}`, so pools drop in without touching
callers. On Coston2 the pools are src/MockUniswapV3Pool.sol mocks acting as the
on-chain settlement price-holder (keeper pushes the live market price via
setPriceE18, vault reads slot0 to rebalance). A real pool can be substituted
where deep EVM liquidity exists (verified: gold via XAUt/USDT Uniswap V3 on
Ethereum); tokenized US equities lack it (Solana/CEX) and stay on the live feed.
Proof: scripts/uniswap-seed.mjs (offline + live) and the Foundry tests
test/MockUniswapV3Pool.t.sol + test/UniswapPricedRebalance.t.sol.

### MockUniswapV3Pool.sol
Minimal V3 pool mock, one per asset, paired with MockUSDC. Constructor
`(asset, stable, assetDecimals, stableDecimals, fee)`; token0/token1 are
address-sorted like the real pool; `owner` = deployer. `seedPriceUsdE18(
priceUsdE18)` (open) sets sqrtPriceX96 so a standard reader recovers the same USD
price; `setPriceE18(priceUsdE18)` is the owner-only live setter the live-engine
keeper calls each tick (emits `PriceUpdated`; same math, shared `_writePrice`).
Exposes `slot0()`, `token0()/token1()`, `observe()` (constant cumulative ticks),
and the pure helper `sqrtPriceX96For(...)`. Prices are seeded by the deploy/seed
script and updated live by the engine. Tested in test/MockUniswapV3Pool.t.sol
(set -> slot0 round-trip + owner gate).

## Strategies (index/strategies.mjs)

Each strategy is a pure object:
```
{ id, name, description, shouldRebalance({now, lastRebalanceAt,
  currentWeightsBps, targetWeightsBps, nav, lastRebalanceNav}) -> boolean }
```
- now, lastRebalanceAt: ms epoch numbers.
- currentWeightsBps, targetWeightsBps: objects SYM -> integer bps (sum ~10000).
- nav, lastRebalanceNav: numbers (take-profit only).

Factories: `interval(intervalMs)`, `drift(driftBps=500)`,
`combined({intervalMs, driftBps})`, `cooldownDrift({driftBps, cooldownMs})`
(drift breach gated by a min interval), `takeProfit(gainPct)` (fire when
nav/lastRebalanceNav - 1 >= gainPct). Ready-made ids, grouped for the FE picker:
- Intervals: `minute`, `five-minute`, `ten-minute`, `thirty-minute`, `hourly`,
  `daily`.
- Drift harnesses: `drift-2`, `drift-5`, `drift-10`, `drift-20`.
- Cooldown-gated drift: `cooldown-drift-5-hourly`, `cooldown-drift-2-ten-minute`.
- Take-profit: `take-profit-5`, `take-profit-10`.
- Combined: `five-minute-or-drift-2`, `ten-minute-or-drift-2`,
  `thirty-minute-or-drift-5`, `hourly-or-drift-5`.
Legacy aliases `drift-5pct` and `hourly-or-drift` are kept.

Export a `STRATEGIES` registry keyed by id, a `STRATEGY_GROUPS` map
(intervals/harnesses/combined) and a `getStrategy(id)` helper. Indices reference
a strategy by id string. Adding more is a one-line factory call.
app/src/core/strategies.ts mirrors the same ids/names/descriptions + group.

## Indices (index/indices.mjs)

An index record:
```
{ id, name, prompt, weights: {SYM: pct}, strategy: "<strategyId>", rationale? }
```
weights are integer percentages summing to 100 over ASSETS. Port the 5 baskets
from scripts/baskets.mjs, assign each a strategy id (mix interval + drift +
combined so the demo shows variety). Export INDICES array and getIndex(id).

Helpers (can live in indices.mjs or a shared util):
- `weightsToBps(weightsPct)` -> {SYM: bps} scaled *100, ensuring sum 10000
  (put rounding remainder on the largest weight).
- `normalizeWeights(rawWeightsPct, allowed)` -> integer pct summing to 100:
  strip non-allowed syms, drop <=0, renormalize, clamp, fix rounding on largest.

## AI generation (index/generate.mjs)

Shells out to Claude Code headless. VERIFIED working invocation in this env:
- Prompt is piped via STDIN (the variadic tool flags otherwise eat a prompt arg).
- Disable tools so the model answers from its own knowledge and does not try to
  fetch: `--disallowedTools WebFetch WebSearch Bash`.
- Model: `claude-haiku-4-5-20251001`.
- Output may be fenced (```json ... ```); strip fences before JSON.parse.

Exact command shape:
```
claude -p --model claude-haiku-4-5-20251001 \
  --disallowedTools WebFetch WebSearch Bash
```
with the full prompt on stdin. RWA-only: the model picks tickers from an RWA
candidate shortlist (there are no crypto symbols), and the answer is validated
against the RWA catalog.

Exports:
```
export async function generateWeights(index, {timeoutMs=45000, limit=60} = {})
  // -> {weights:{id:pct}, source:"live"|"fallback", raw?}
export function refreshLoop(indices, onUpdate, {intervalMs=60000} = {})
  // -> {stop()}  regenerates every intervalMs, sequential, Ctrl-C safe
```
- generateWeights: build an RWA candidate shortlist for index.prompt, spawn
  claude, feed the shortlist prompt on stdin, timeout per call, parse, and
  validate via validateIndex against the catalog. On any failure (CLI missing,
  timeout, bad JSON, empty after validation) return the index's current/last-good
  weights with source "fallback" and log that live-gen is unavailable.
- refreshLoop: process indices sequentially (one at a time, no parallel spend),
  call onUpdate(indexId, newWeights, source) after each, sleep intervalMs
  between full passes. Guard against runaway cost: sequential + per-call timeout.
  Return a stop() that clears timers; also wire SIGINT in the CLI entrypoint.
- A `node index/generate.mjs` CLI entrypoint: one pass over INDICES, print the
  generated (or fallback) weights, and if `--loop` given, run refreshLoop.

### Whole-index generation (BUILT)
`generateIndex(prompt, {timeoutMs, limit})` returns a full index object
`{name, rationale, assets, weights, strategy}` where assets/weights use catalog
ids chosen ONLY from the universe. It builds a compact candidate shortlist via
`candidatesForPrompt(prompt)` (index/catalog.mjs: keyword overlap on
ticker/name/class, top-N by volume, RWA-only), prompts the model to pick
tickers from that shortlist, then `validateIndex(parsed, cands)` resolves
tickers to catalog ids, drops unknowns, renormalizes weights to sum 100, and
coerces the strategy to a known id (default `hourly-or-drift`). On any failure
it returns a safe FALLBACK_INDEX and logs. CLI: `node index/generate.mjs
--index "<prompt>"`. The app's /build "Generate from prompt" box calls the same
contract (server endpoint via VITE_GENERATE_URL, else an in-browser heuristic
that mirrors candidatesForPrompt), always validated against the catalog.

### Catalog universe (index/catalog.mjs)
`loadCatalog()`, `selectableAssets()` (priceable RWA rows only, no crypto),
`assetIndex()` (id -> asset), `candidatesForPrompt()`.
This is the fixed, hardcoded universe: an index may only pick ids that exist
here.

## Rebalancer (rebalancer/rebalancer.mjs)

Per index, per tick:
1. prices = await getPrices(symbols)  (stub source).
2. currentWeightsBps from on-chain holdings * price (DRY: from a simulated
   holdings state seeded at target, then drifted, or from last rebalance).
3. targetWeightsBps = weightsToBps(index.weights).
4. strategy = getStrategy(index.strategy);
   if strategy.shouldRebalance({now, lastRebalanceAt, currentWeightsBps,
   targetWeightsBps}) -> rebalance.
5. On rebalance:
   - compute pricesE18 = symbols.map(s => round(price[s]*1e18)) as BigInt.
   - weightsBps = weightsToBps(index.weights) as uint16[] in ASSETS-of-index order.
   - message = AbiCoder.encode(["address","uint256","uint16[]","uint256[]"],
       [vaultAddr, nonce, weightsBps, pricesE18]).
   - sig = teeSign(TEE_SIGN_URL, message)  (reuse enclave/teesign.mjs).
   - LIVE: send vault.rebalance(weightsBps, pricesE18, sig) with a funded key.
   - DRY: log the decision + would-be tx, update simulated holdings/nonce, no
     chain, no key, no tee call (or optional tee call if URL set).

Modes:
- DRY (default when no PK): loop a few ticks over INDICES, log per-index
  decisions (rebalance yes/no + reason: "interval elapsed" / "drift Xbps>=Ybps"),
  print a summary. Must run with zero external deps beyond the repo modules.
- LIVE (PK set + vault addresses provided): real deposit already done by
  orchestrator; rebalancer relays real rebalance via FCC sign.

Env: TEE_SIGN_URL (default http://127.0.0.1:7701/sign), PK, RPC, DRY=1.
The reason string is surfaced so the frontend can show "last rebalance reason".

## Frontend (app/)

One Flare-styled app (Vite + React 19 + Mantine + TanStack Router) reusing the
smart-accounts template's theme.ts, global.css design tokens, Satoshi font, and
Flare logo. Shell + style only: the template's XRPL/FAssets domain pages and
wallet plumbing are dropped. Three routes: /build (landing, the index builder +
"Generate from prompt"), /leaderboard, /live. Data is plain JSON under
app/public/data: catalog.json + user-baskets.json (the fixed universe / seed
indices), leaderboard.json (orchestrator output), live.json (compete output).

Deposits run on an EVM seam (app/src/core/evm-seam.ts): mocked by default, and a
real Coston2 `approve` + `vault.deposit()` when an injected wallet is present
and window.__INDEX_COMPETITION_STABLE__ is set. The connect-wallet modal keeps
the Flare look with no XRPL plumbing.

leaderboard.json shape (matches the old window.DEMO):
```
{
  generatedAt, network, stable, platform, rebalancer, attestedBy,
  feeBps, platformRevenueUsd, baseline: {SYM: usdPrice},
  indices: [ { id, name, prompt, strategy, strategyName, weights,
    vault, depositUsd, feeUsd, depositTx, rebalanceTx,
    rebalanceReason, positions:[{sym, weight, units, basePx, drift}],
    weekReturn, rank } ]
}
```

## Orchestrator (scripts/orchestrate-rebalance.mjs)

Deploys MockUSDC, deploys StableIndexVault per index, mints stable to a
depositor, takes a fee (stable transfer to platform), deposits (approve +
deposit(amount)), FCC-signs (address,nonce,weightsBps,pricesE18) without flrUsd,
relays the rebalance, reads holdings, scores with deterministic drift, and
writes app/public/data/leaderboard.json in the shape above. Prices from
index/prices.mjs. The local server (scripts/server.mjs) reuses this deposit +
rebalance path per submitted basket via scripts/orchestrate-add.mjs. The old
FTSO orchestrator (demo/orchestrate.mjs) is removed (it wrote to the deleted
demo/frontend/data.js).

## Live competition engine (scripts/live-engine.mjs)

A continuous loop (default TICK_MS=15000) over a field of 5 RWA-only house
indices (Big-Tech RWA, AI & Semiconductors, Wall Street Financials, Precious
Metals, Tokenized Index Funds) plus any basket submitted from /build, each with a
strategy id from the templates. Exactly ONE house index, AI & Semiconductors,
uses the `minute` strategy so it rebalances about once a minute. Each tick
re-reads user-baskets.json and adds any basket tagged owner:"you" not already
racing: it is baselined at current prices (return starts at 0), carries
owner/mine + a Coston2 tx/vault link (real when on-chain, else a resolvable
sample tx flagged txSample), and from then on behaves exactly like a house index.
A joining basket's new legs are backfilled from lastGood (their catalog price
seed) on the join tick so baseline and first rebalance never see a 0 price; they
fetch live from the next tick. House baselines are never reset when a submission
joins mid-run. Per tick: batched LIVE prices on Yahoo (RWA equities to the bare
ticker, metals to futures; no crypto/CoinGecko) with a bounded random-walk
fallback (WALK_BPS) for any symbol with no live source or a failed fetch, so the
board always moves; a t0 baseline; per index the real vault math (nav, then
holdings[i] = nav*wBps/10000/price[i]) applied when strategy.shouldRebalance()
fires, logging the reason. Writes app/public/data/live.json each tick (per index:
name, strategy, weights, nav, ret, a NAV series for charting, lastReason, rank)
and re-ranks leaderboard.json by return. Off-chain by default; ON-CHAIN when PK +
TEE_SIGN_URL are set: push each price to the pool via setPriceE18, read slot0
back, relay the FCC-signed rebalance for triggered indices, record tx hashes.
compete-setup.mjs (needs PK) deploys MockUSDC + one MockUniswapV3Pool per asset +
5 vaults, deposits, and writes compete-onchain.json (the address maps the engine
reads); off-chain it is a clear no-op. start-compete.mjs = `npm run compete`:
engine + server (:8787) + app (:3000).

Submit is honest: /build's "Add to competition" POSTs to the server's /api/add,
which validates against the RWA catalog, tags the basket owner:"you" in
user-baskets.json (so the engine races it next tick), scores it and upserts the
leaderboard. If the POST fails or the server is unreachable, the FE shows a RED
error ("could not reach the competition server - is `npm run compete` running?")
and adds NOTHING; success is shown only on a real server response, with the
leaderboard/live links. There is no silent local-only fallback.

## README order (inverted)

1. Index (headline: what an index is, static + AI-generated via Claude Code,
   prompt -> weights).
2. Rebalancer + strategy templates (interval + drift harness).
3. Frontend / leaderboard (the demo).
4. Trust / attestation footnote (FCC/TEE, brief, accurate).
Preserve DEPLOYMENT.md facts and reference it.
