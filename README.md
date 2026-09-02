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
issuers, venues and chains. `demo/build-catalog.mjs` collapses it to the set of
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

## The frontend (where to see it)

The frontend is two static pages under `demo/frontend/` - `data.js` and
`catalog.js` are `<script>` includes, so no server is needed: open the files
directly in a browser. (If your browser blocks local file scripts, serve the
folder, e.g. `cd demo/frontend && npx serve` or `python3 -m http.server`.)

- `demo/frontend/build.html` - the **index builder**. Search and filter the
  ~2,300-asset RWA universe, add assets, set each weight, name the index and
  write its thesis, then export `user-baskets.json` for the competition.
- `demo/frontend/index.html` - the **leaderboard**. Ranks every index by its
  (simulated) 7-day return, and shows each index's holdings, per-leg price
  source (FTSO/CSV badges), the fee, and - when run with a `PK` - links to the
  on-chain vault and rebalance tx on the Coston2 explorer.

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
rwa-database.txt              raw tokenized-asset universe (tab-separated)
demo/build-catalog.mjs        rwa-database.txt -> catalog (dedup by ticker+issuer)
demo/baskets.mjs              5 crypto index prompts + weights (opt-in: INCLUDE_CRYPTO)
demo/user-baskets.json        the 7 AI-recipe RWA indices (editable in the builder)
demo/orchestrate.mjs          deposits + FCC-signed on-chain rebalance (crypto + RWA)
demo/frontend/build.html      the index builder (pick assets, set weights)
demo/frontend/index.html      leaderboard
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
