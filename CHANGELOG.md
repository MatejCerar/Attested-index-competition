# Changelog

## Real one-command flow, demo/ folded into scripts/ (2026-09-03)

- Renamed `demo/` to `scripts/` (all internal relative imports unchanged). The
  one external ref, `index/catalog.mjs`, now reads `scripts/catalog.json`.
- Deleted the dead FTSO orchestrator `demo/orchestrate.mjs` (wrote to the
  removed `demo/frontend/data.js`). Removed the dead `frontend/live.js` write in
  `compete.mjs` (it now writes only `app/public/data/live.json`). Dropped the
  redundant `scripts/package.json` + lockfile + node_modules: scripts resolve
  ethers from the repo root.
- New `scripts/server.mjs` (Node http, no framework, :8787): `POST /api/generate`
  (real Claude Haiku via generateIndex), `POST /api/add` (validate + score with
  the real vault rebalance math + upsert/re-rank the leaderboard; real Coston2
  deposit + FCC rebalance when PK + TEE_SIGN_URL are set, else off-chain), and
  `GET /api/leaderboard`. `scripts/orchestrate-add.mjs` holds the single-basket
  on-chain path.
- Wired the app: `app/.env.local` points generate + add at the server;
  `app/src/core/add.ts` POSTs the basket; `/build` submit() now reaches the
  leaderboard and invalidates the `["leaderboard"]` query, falling back to
  local-only state with a notice when the server is down.
- One command: `npm run demo` (`scripts/start.mjs`) runs the server + Vite dev
  server together. App :3000, API :8787.

## Rewrite: index-first, stablecoin-denominated (2026-09-03)

Re-centered the project so the index, the rebalancer, and the frontend are the
headline. The FCC/TEE attestation is kept but demoted to a footnote. FTSO is
removed; the vault is denominated in a mock USD stablecoin. Uniswap V3 pool
pricing is deferred to phase 2 behind a documented seam.

### Index (front of repo)

- New `index/` directory is the headline primitive. An index is
  `{ id, name, prompt, weights, strategy }`.
- `index/indices.mjs` holds the 5 static indices; `index/assets.mjs` fixes the
  allowed assets `BTC, ETH, XRP, SOL, AVAX, DOGE, FLR`.
- `index/generate.mjs` generates weights from a natural-language prompt via
  Claude Code headless (`claude -p --model claude-haiku-4-5-20251001`, tools
  disabled, prompt on STDIN), validates and renormalizes to sum 100, and can
  refresh on a ~60s loop. Falls back to last-good weights on any failure.

### Rebalancer and strategy templates

- `index/strategies.mjs`: interval templates (`hourly`, `ten-minute`,
  `five-minute`, plus an `interval(ms)` factory), a `drift(driftBps=500)`
  harness that fires when max per-asset weight drift breaches the band, and a
  `combined({intervalMs, driftBps})` template (interval OR early drift breach).
  Each exposes a pure `shouldRebalance()` plus metadata.
- `rebalancer/rebalancer.mjs`: per-index loop that reads prices, computes
  current weights, consults the strategy, and rebalances. DRY mode (no chain,
  no key) logs decisions; LIVE mode obtains the FCC signature from the tee-node
  and relays the on-chain `rebalance()`.

### Vault: FTSO native -> stablecoin

- `src/StableIndexVault.sol` supersedes `SyntheticIndexVault.sol` (kept for the
  historical FTSO deploy):
  - Constructor `(address _rebalancer, address _stable, uint256 _n)`; reads the
    stablecoin decimals once.
  - `deposit(uint256 amount)` pulls the stablecoin via `safeTransferFrom`
    (was `deposit() payable` in native C2FLR).
  - `rebalance(weightsBps, pricesE18, sig)` drops the `flrUsd` argument; cash is
    USD = 1.0. NAV = `cash + sum(holdings * price)` in USD 1e18. FCC signature
    gate now over `(address(this), nonce, weightsBps, pricesE18)`.
- `src/MockUSDC.sol`: 6-decimals mock stablecoin for deposits.

### Prices

- `index/prices.mjs`: a deterministic in-repo stub price source today. Phase-2
  seam documented: `createUniswapPriceSource({provider, pools})` returns the
  same `getPrices(symbols)` interface, so it drops in without touching the
  rebalancer, generator, or orchestrator.

### Frontend and docs

- `frontend/` (top level) is the leaderboard: USD NAV, per-index strategy, and
  the rebalance reason. Old `demo/frontend/` removed.
- `README.md` reordered: Index -> Rebalancer -> Frontend, attestation last.
- `demo/orchestrate-rebalance.mjs` rewritten to the stablecoin path; old FTSO
  orchestrators and `demo/baskets.mjs` kept as history.
- `DEPLOYMENT.md` addresses and tx hashes preserved (rewrite note appended).
- Layered onto the existing `index-competition` repo, preserving its git
  history and the RWA universe (`rwa-database.txt`, `demo/catalog.json`, the
  builder, and the live-competition harness `demo/compete.mjs`). The stablecoin
  `index/` + `rebalancer/` loop uses an offline stub price source; the RWA
  competition keeps its live sources in `demo/prices.mjs`.

### Verification

- `forge build` clean; `forge test` -> 17 passed, 0 failed (5 StableIndexVault
  + 9 attestation + 3 SyntheticIndexVault tests).
- `node --check` passes on all new modules; strategy/weight/price test -> 10/10.
- DRY rebalancer produces sensible decisions; live Claude-Haiku generation
  verified (4/5 live, 1/5 graceful fallback in one pass).

### Deferred (phase 2)

- Uniswap V3 TWAP price source (seam in `index/prices.mjs`).
