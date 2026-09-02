# Attested Index Competition

Build an index. Deposit into it. Let an autonomous rebalancer run it. Compete.

Anyone defines an index as a prompt plus asset weights. A rebalancer running
inside Flare Confidential Compute (FCC) moves the vault's holdings to those
weights, priced on live FTSO. Indices are ranked on a leaderboard, the best
attract more deposits, and the platform earns a fee. No human touches the
money or the allocation: the rebalance only executes when the FCC enclave
signs it, so the product is autonomous, not advisory.

```
  build            fund              rebalance (FCC)          rank
  ---------        ------------      ------------------       ------------
  prompt      ->   deposit + fee ->  enclave signs weights -> leaderboard
  + weights        (real tx)         vault moves holdings     more deposits
                                     on-chain, live FTSO      flow to winners
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
reads FTSO off-chain and signs the prices with the weights (on-chain FTSO
reads cost a fee inside a call), then anyone can relay the transaction. It
depends only on OpenZeppelin `ECDSA`.

Holdings are synthetic here (priced by the signed FTSO values, no DEX needed
on the testnet). On Hyperliquid the same signed rebalance becomes real orders
through an agent wallet.

## Quickstart

Tests:

```
npm install
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
forge test -vv
```

Demo on Coston2 (deploys 5 index vaults, deposits, rebalances, writes the
leaderboard). Build the Flare tee-node once, then run the loop in its network
namespace so the enclave can sign:

```
git clone https://github.com/flare-foundation/fce-extension-scaffold
docker build -f fce-extension-scaffold/go/Dockerfile -t are/real-tee-node:v0.0.24 fce-extension-scaffold

cd demo && npm install
docker run -d --name tee -e MODE=1 -e SIMULATED_TEE=true -e CHAIN_ID=114 \
  -e PROXY_URL=http://127.0.0.1:1 -e SIGN_PORT=7701 are/real-tee-node:v0.0.24
docker run --rm --network container:tee -v "$PWD":/demo -w /demo \
  -e PK=<throwaway-coston2-key> node:22-alpine node orchestrate.mjs
```

Open `demo/frontend/index.html` for the leaderboard. Edit the indices in
`demo/baskets.mjs`.

## Layout

```
src/SyntheticIndexVault.sol   the FCC-gated on-chain rebalancer
test/                         Foundry tests (3, passing)
demo/baskets.mjs              the 5 index prompts + weights
demo/orchestrate.mjs          deposits + FCC-signed on-chain rebalance
demo/frontend/                leaderboard (open index.html)
```

## Roadmap: Hyperliquid

The demo runs on Flare because that is where FCC and FTSO live. The target
venue is Hyperliquid: each index becomes an autonomous vault (leader = the FCC
enclave holding a trade-only agent wallet) or a HIP-3 index perp, the
leaderboard is native, and the fee is a builder code. The FCC attestation is
the edge over a human vault leader.

## Notes

Deposits, fees, and rebalances are real on Coston2. Two things are not
production yet: the multi-day performance shown is simulated from a live FTSO
baseline (a real week takes a week), and attestation runs in MODE=1 (simulated
hardware); MODE=0 on Confidential Space is the only change for real hardware
attestation.
