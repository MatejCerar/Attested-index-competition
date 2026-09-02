# Attested Index Competition

Build an index. Deposit into it. Let an autonomous rebalancer run it. Compete.

Anyone defines an index as a prompt plus asset weights, over crypto (live
FTSO) or a universe of ~2,300 tokenized real-world assets (equities, ETFs,
metals, perps). A rebalancer running inside Flare Confidential Compute (FCC)
moves the vault's holdings to those weights, priced on live FTSO where a feed
exists and otherwise on the catalog snapshot. Indices are ranked on a
leaderboard, the best attract more deposits, and the platform earns a fee. No
human touches the money or the allocation: the rebalance only executes when
the FCC enclave signs it, so the product is autonomous, not advisory.

```
  build            fund              rebalance (FCC)          rank
  ---------        ------------      ------------------       ------------
  prompt      ->   deposit + fee ->  enclave signs weights -> leaderboard
  + weights        (real tx)         vault moves holdings     more deposits
  (crypto/RWA)                       on-chain, FTSO or CSV    flow to winners
```

## Why it is different

- Autonomous: a TEE runs the index, not a fund manager. The `rebalance()` call
  reverts unless the FCC enclave key signed the exact weights and prices.
- On-chain: deposits, fees, and rebalances are real transactions; holdings
  live in the vault contract and actually move.
- Fee, not a wager: the platform earns a fee on activity. There is no pooled
  bet redistributed to winners, so it stays a competition, not a lottery.

## The rebalancer

`src/SyntheticIndexVault.sol` holds the native C2FLR deposit and tracks a
USD-valued portfolio. `rebalance(weightsBps, pricesE18, flrUsd, sig)` is gated
by an ECDSA signature over `(vault, nonce, weights, prices)` from the vault's
rebalancer key, which is the Flare tee-node inside the enclave. The enclave
resolves each asset's price off-chain (live FTSO where a feed exists, else the
catalog snapshot) and signs the prices with the weights, then anyone can relay
the transaction. Because the vault only checks the signature and never reads a
feed itself, the price source is an off-chain detail: crypto and RWA legs go
through the exact same on-chain rebalance. It depends only on OpenZeppelin
`ECDSA`.

Holdings are synthetic here (priced by the signed values, no DEX needed on the
testnet). On Hyperliquid the same signed rebalance becomes real orders through
an agent wallet.

## Build your own index (RWA universe)

`rwa-database.txt` is the raw universe: ~8,900 tokenized-asset listings across
issuers, venues and chains. It is large and kept out of git (see `.gitignore`);
the committed, derived catalog (`demo/catalog.json` and
`demo/frontend/catalog.js`) is what the app reads, so you only need the raw txt
to regenerate it. `demo/build-catalog.mjs` collapses it to the set of
selectable instruments using one identity rule: **an asset is unique by
(Ticker, Issuer)**. The same ticker from a different issuer (say `TSLAx` from
Backed vs `TSLAon` from Ondo vs `TSLA` from Robinhood) is a different,
separately-selectable asset; the same (ticker, issuer) across many chains
collapses to one. That yields ~2,300 instruments, ~1,300 of them priceable.

```
cd demo && npm install
node build-catalog.mjs   # rwa-database.txt -> frontend/catalog.js (+ catalog.json)
```

Open `demo/frontend/build.html`: search/filter the universe, add assets, set a
percentage weight on each (they must sum to 100), name the index and write its
thesis, then "Add index to competition". Download the resulting
`user-baskets.json` into `demo/`. Pricing per leg is **FTSO where a feed
exists, else the CSV snapshot** from the catalog; the badge on each leg shows
which.

Seven AI-recipe RWA indices ship in `demo/user-baskets.json` (each a
natural-language prompt plus weights): Mag-7 Tokenized, AI & Semiconductors,
Wall Street Financials, Crypto-Equity Complex, Tokenized Index Funds, Consumer
Brands, and a Precious Metals basket that exercises the FTSO path. They are the
default competition.

`orchestrate.mjs` runs every RWA index through the same FCC-signed on-chain
rebalance and ranks them on the leaderboard. With no `PK` set it runs in
preview mode (resolves prices and writes the leaderboard, no on-chain tx), so
you can see the competition without the tee-node. Set `INCLUDE_CRYPTO=1` to add
the five live-FTSO crypto baskets from `baskets.mjs` to the field:

```
cd demo && node orchestrate.mjs                 # preview: 7 RWA indices
INCLUDE_CRYPTO=1 node orchestrate.mjs           # also add the 5 crypto baskets
```

## Real competition (live data)

The attested leaderboard scores a rebalance on a simulated P&L path. To run a
*real* competition instead, `demo/compete.mjs` prices every index on live
market data, runs the rebalancer, and tracks realized return over a window.
Each index starts with equal capital; ranking at the end is the real return.

The rebalancer, every `REBALANCE_SEC`, resets each index's holdings to its
target weights at current prices (a constant-mix strategy) - the exact action
the FCC enclave signs on-chain in `orchestrate.mjs`, here run against live data
so you can watch it.

**Price source (`PRICE_SOURCE`)**

- `hl` (default) - **Hyperliquid mainnet oracle**, the target venue. It prices
  the exact HIP-3 stock/commodity/metal perps (and crypto) an index would trade
  against - read-only and free, so no capital and no tokens are needed. This is
  the real competition minus capital-at-risk execution: going live is swapping
  this read-only adapter for an order-placing one (an HL agent wallet the
  enclave holds - trade-only, cannot withdraw) using the same signed weights.
  Not every asset is listed on HL: legs that are not are dropped and the index's
  remaining weights renormalized, with coverage shown; an index with nothing on
  HL (e.g. the ETF or financials baskets today) is marked not executable and
  excluded from the ranking. Honest about what the venue can actually trade.
- `yahoo` - venue-agnostic: **Yahoo Finance** for the RWA legs (token mapped to
  its underlying symbol, metals to futures `GC=F/SI=F/PL=F/PA=F`) and
  **CoinGecko** for crypto. Full coverage of the seed indices; useful off the
  target venue.

Only relative moves matter, so a live baseline is taken at t0 and NAV tracked
each tick.

```
cd demo
node compete.mjs                                  # HL oracle, 1h, rebalance 15m, $100k each
PRICE_SOURCE=yahoo node compete.mjs               # Yahoo/CoinGecko instead
DURATION_SEC=3600 INTERVAL_SEC=30 REBALANCE_SEC=600 node compete.mjs
INCLUDE_CRYPTO=1 node compete.mjs                 # add the 5 crypto baskets to the field
```

It writes `frontend/live.js` every tick; open `frontend/live.html` to watch
(auto-refreshes every 15s), where per-index venue coverage and non-executable
indices are shown. Note on hours: cash equities only move while US markets are
open, but metals and crypto move ~24h and keep the board alive off-hours.

### Why Hyperliquid, not a testnet

The tokenized stocks live on **Hyperliquid mainnet** (HIP-3 perp dexes such as
`xyz`: AAPL, NVDA, TSLA, GOLD, ...). Coston2 has no equities, and HL *testnet*
has only crypto perps plus unverified squatter spot tokens - so a testnet does
not make the stock competition more real, it makes it fake. Reading the HL
mainnet oracle (free) is the faithful, zero-capital way to run it; real
execution is the same code with an order-placing adapter, provable cheaply on
HL testnet for a crypto-only index.

## The frontend (where to see it)

The frontend is two static pages under `demo/frontend/` - `data.js` and
`catalog.js` are `<script>` includes, so no server is needed: open the files
directly in a browser. (If your browser blocks local file scripts, serve the
folder, e.g. `cd demo/frontend && npx serve` or `python3 -m http.server`.)

- `demo/frontend/build.html` - the **index builder**. Search and filter the
  ~2,300-asset RWA universe, add assets, set each weight, name the index and
  write its thesis, then export `user-baskets.json` for the competition.
- `demo/frontend/index.html` - the attested **leaderboard**. Ranks every index
  by its (simulated) 7-day return, and shows each index's holdings, per-leg
  price source (FTSO/CSV badges), the fee, and - when run with a `PK` - links to
  the on-chain vault and rebalance tx on the Coston2 explorer.
- `demo/frontend/live.html` - the **live competition** board (real market data,
  see above). Auto-refreshes every 15s while `compete.mjs` runs.

## Quickstart

Tests:

```
npm install
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
forge test -vv
```

Demo on Coston2. It deploys a vault for every index (the seven RWA indices in
`demo/user-baskets.json`; add `INCLUDE_CRYPTO=1` for the 5 crypto baskets too),
deposits, rebalances, and writes the leaderboard. Build the catalog once, then
build the Flare tee-node and run the loop in its network namespace so the
enclave can sign:

```
cd demo && npm install
node build-catalog.mjs   # rwa-database.txt -> frontend/catalog.js (skip if unchanged)

git clone https://github.com/flare-foundation/fce-extension-scaffold
docker build -f fce-extension-scaffold/go/Dockerfile -t are/real-tee-node:v0.0.24 fce-extension-scaffold

docker run -d --name tee -e MODE=1 -e SIMULATED_TEE=true -e CHAIN_ID=114 \
  -e PROXY_URL=http://127.0.0.1:1 -e SIGN_PORT=7701 are/real-tee-node:v0.0.24
docker run --rm --network container:tee -v "$PWD":/demo -w /demo \
  -e PK=<throwaway-coston2-key> node:22-alpine node orchestrate.mjs
```

Without a `PK` (and no tee-node), `node orchestrate.mjs` runs in preview mode:
it resolves prices and writes the leaderboard with no on-chain tx.

Open `demo/frontend/index.html` for the leaderboard and `demo/frontend/build.html`
to build an index. Edit the crypto indices in `demo/baskets.mjs`; RWA indices
come from the builder into `demo/user-baskets.json`.

## Layout

```
src/SyntheticIndexVault.sol   the FCC-gated on-chain rebalancer
test/                         Foundry tests (3, passing)
rwa-database.txt              raw universe (tab-separated, gitignored - local only)
demo/catalog.json             derived universe read by orchestrate (committed)
demo/frontend/catalog.js      derived universe read by the builder (committed)
demo/build-catalog.mjs        rwa-database.txt -> catalog (dedup by ticker+issuer)
demo/baskets.mjs              5 crypto index prompts + weights (opt-in: INCLUDE_CRYPTO)
demo/user-baskets.json        the 7 AI-recipe RWA indices (editable in the builder)
demo/orchestrate.mjs          deposits + FCC-signed on-chain rebalance (crypto + RWA)
demo/prices.mjs               live price sources (Hyperliquid oracle / Yahoo / CoinGecko)
demo/compete.mjs              real competition: live prices, rebalancer loop, ranking
demo/frontend/build.html      the index builder (pick assets, set weights)
demo/frontend/index.html      attested leaderboard (simulated 7d P&L)
demo/frontend/live.html       live competition board (real data, auto-refresh)
```

## Roadmap: Hyperliquid

The demo runs on Flare because that is where FCC and FTSO live. The target
venue is Hyperliquid: each index becomes an autonomous vault (leader = the FCC
enclave holding a trade-only agent wallet) or a HIP-3 index perp, the
leaderboard is native, and the fee is a builder code. The FCC attestation is
the edge over a human vault leader.

## Notes

Deposits, fees, and rebalances are real on Coston2. Three things are not
production yet: the multi-day performance shown is simulated from the price
baseline (a real week takes a week); RWA legs are priced from the catalog
snapshot where FTSO has no feed (a real deployment would wire an oracle per
asset); and attestation runs in MODE=1 (simulated hardware), with MODE=0 on
Confidential Space the only change for real hardware attestation.
