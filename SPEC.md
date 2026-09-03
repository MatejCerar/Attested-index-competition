# SPEC: ARE index-first rewrite

This is the shared contract for the rewrite. Workers code to the interfaces
here. If a worker needs an interface change, the architect adjudicates and
updates this file.

Style rules (enforced on every file):
- No emojis. No em dashes. Use hyphen, comma, colon, or two sentences.
- Terse code, comments max one line where they earn their place.
- Node: ESM (.mjs), ethers v6 style matching demo/.
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
  demo/abi/SyntheticIndexVault.json is also kept.
- demo/baskets.mjs -> content moves to index/indices.mjs + index/assets.mjs.
- demo/frontend/ -> moves to top-level frontend/.

DEPLOYMENT.md is preserved verbatim; new deploys append only.

## Target repo shape

```
index/
  assets.mjs        allowed asset symbols (no FLR-as-cash; FLR is just an asset)
  indices.mjs       static index definitions (id, name, prompt, weights, strategy)
  strategies.mjs    rebalance strategy templates (interval + drift harness)
  prices.mjs        stub USD price source + documented Uniswap V3 TWAP seam
  generate.mjs      Claude Haiku headless weight generation + refresh loop
  test/strategies.test.mjs   node test harness for strategies + prices
rebalancer/
  rebalancer.mjs    main loop, DRY (no chain) + LIVE (chain + FCC sign)
src/
  MockUSDC.sol         simple 6-decimals ERC20, mint for demo
  StableIndexVault.sol stablecoin-denominated vault, FCC-gated rebalance
  (kept) SyntheticIndexVault.sol, attestation/, libs/, consumers/
frontend/
  index.html, data.js  leaderboard, USD NAV, shows strategy + rebalance reason
enclave/            unchanged tee-node signer
test/               Foundry: AttestedEpochRegistry.t.sol (kept),
                    StableIndexVault.t.sol (new), MockUSDC via vault test
demo/               orchestrate-rebalance.mjs updated to stablecoin + new vault;
                    old orchestrate*.mjs kept; abi/ gets StableIndexVault.json
README.md           inverted order
DEPLOYMENT.md       preserved
SPEC.md             this file
```

## Assets

Allowed asset symbols (index/assets.mjs):
```
export const ASSETS = ["BTC", "ETH", "XRP", "SOL", "AVAX", "DOGE", "FLR"];
```
Order is canonical and stable; indices reference symbols, not indices. Cash is
the stablecoin (USD = 1.0) and is NOT one of ASSETS.

## Contracts

### MockUSDC.sol
Minimal ERC20, 6 decimals, name "Mock USD Coin", symbol "mUSDC". Public
`mint(address to, uint256 amount)` for demo funding (testnet only). Extend OZ
ERC20 with `decimals()` overridden to 6. OZ path:
`@openzeppelin/contracts/token/ERC20/ERC20.sol`.

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

Regenerate demo/abi/StableIndexVault.json from forge out (abi + bytecode) for
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

Uniswap V3 TWAP seam (PHASE 2, DO NOT BUILD NOW):
Document a `createUniswapPriceSource({provider, pools})` factory that would
return the same `{getPrices(symbols)}` interface by reading each asset's pool
`slot0`/`observe` TWAP tick and converting to USD. Leave a clearly commented
stub that throws "not implemented (phase 2)". The rebalancer and generator
depend only on the `getPrices(symbols) -> {SYM: number}` contract, so the pool
reader drops in without touching callers.

## Strategies (index/strategies.mjs)

Each strategy is a pure object:
```
{ id, name, description, shouldRebalance({now, lastRebalanceAt,
  currentWeightsBps, targetWeightsBps}) -> boolean }
```
- now, lastRebalanceAt: ms epoch numbers.
- currentWeightsBps, targetWeightsBps: objects SYM -> integer bps (sum ~10000).

Templates:
- Interval templates: `intervalHourly` (3600000), `intervalTenMin` (600000),
  `intervalFiveMin` (300000). Rebalance when now - lastRebalanceAt >= intervalMs.
- Drift harness: `drift(driftBps=500)` factory. Rebalance when max over assets
  of |currentBps - targetBps| >= driftBps.
- Combined: `combined({intervalMs, driftBps})` factory. Rebalance if interval
  elapsed OR drift band breached (early rebalance).

Export a `STRATEGIES` registry keyed by id and a `getStrategy(id)` helper.
Indices reference a strategy by id string.

Include a small factory helper so more intervals are one-liners.

## Indices (index/indices.mjs)

An index record:
```
{ id, name, prompt, weights: {SYM: pct}, strategy: "<strategyId>", rationale? }
```
weights are integer percentages summing to 100 over ASSETS. Port the 5 baskets
from demo/baskets.mjs, assign each a strategy id (mix interval + drift +
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
with the full prompt on stdin. The full prompt is:
`<index.prompt>. Based only on your own knowledge, return ONLY compact JSON
{"weights":{SYM:pct,...}} with pct integers summing to 100 over exactly these
allowed assets: [BTC,ETH,XRP,SOL,AVAX,DOGE,FLR]. No prose.`

Exports:
```
export async function generateWeights(index, {timeoutMs=45000} = {})
  // -> {weights:{SYM:pct}, source:"live"|"fallback", raw?}
export function refreshLoop(indices, onUpdate, {intervalMs=60000} = {})
  // -> {stop()}  regenerates every intervalMs, sequential, Ctrl-C safe
```
- generateWeights: spawn claude, feed prompt on stdin, timeout per call, parse,
  normalize via normalizeWeights against ASSETS. On any failure (CLI missing,
  timeout, bad JSON, empty after normalize) return the index's current/last-good
  weights with source "fallback" and log that live-gen is unavailable.
- refreshLoop: process indices sequentially (one at a time, no parallel spend),
  call onUpdate(indexId, newWeights, source) after each, sleep intervalMs
  between full passes. Guard against runaway cost: sequential + per-call timeout.
  Return a stop() that clears timers; also wire SIGINT in the CLI entrypoint.
- A `node index/generate.mjs` CLI entrypoint: one pass over INDICES, print the
  generated (or fallback) weights, and if `--loop` given, run refreshLoop.

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

## Frontend (frontend/index.html + data.js)

Leaderboard only. Adapt to stablecoin: show USD NAV (not C2FLR), show each
index's strategy (name) and last rebalance reason. Keep the dark UI. data.js
shape (window.DEMO):
```
{
  generatedAt, network, stable, platform, rebalancer, attestedBy,
  feeBps, platformRevenueUsd, baseline: {SYM: usdPrice},
  indices: [ { id, name, prompt, strategy, strategyName, weights,
    vault, depositUsd, feeUsd, feeTx, depositTx, rebalanceTx,
    rebalanceReason, positions:[{sym, weight, units, basePx, drift}],
    weekReturn, rank } ]
}
```
Orchestrator (demo/orchestrate-rebalance.mjs) writes frontend/data.js in this
shape. Frontend reads window.DEMO. Keep it a plain static file openable
directly.

## Orchestrator (demo/orchestrate-rebalance.mjs)

Update to: deploy MockUSDC, deploy StableIndexVault per index, mint stable to a
depositor, take fee (stable transfer to platform), deposit (approve +
deposit(amount)), FCC-sign (address,nonce,weightsBps,pricesE18) without flrUsd,
relay rebalance, read holdings, score with deterministic drift, write
frontend/data.js in the new shape. Prices from index/prices.mjs stub. Keep the
old FTSO orchestrator file intact as history; this file is the new path.

## README order (inverted)

1. Index (headline: what an index is, static + AI-generated via Claude Code,
   prompt -> weights).
2. Rebalancer + strategy templates (interval + drift harness).
3. Frontend / leaderboard (the demo).
4. Trust / attestation footnote (FCC/TEE, brief, accurate).
Preserve DEPLOYMENT.md facts and reference it.
