# pipeline/oracle - pluggable price oracle

One interface, three modes. Everything speaks the same contract as
`index/prices.mjs`:

```
const oracle = createOracle({mode});          // "enclave-signed" | "fdc" | "raw"
await oracle.getPrices(symbols)               // {SYM: number}  fast display path
await oracle.getAttestedPrices(symbols)       // {prices, attestation}
oracle.verify(attestation)                    // {ok, recovered}  enclave mode
```

Symbols are underlying market symbols (AAPL, GC=F), the same keys the live
engine uses.

## Mode: enclave-signed (default)

The TEE fetches the market price and signs
`keccak256(abi.encode(symbols, pricesE18, timestamp))` via its `/sign`
endpoint (same signer, same `enclave/teesign.mjs` path as rebalances). The
attestation is `{prices, pricesE18, timestamp, signature, signer}` and
`SignedPriceOracle.sol` verifies it on-chain with ECDSA +
toEthSignedMessageHash before storing `priceUsdE18` per symbol.
`SignedPriceFeed` wraps one symbol behind the exact no-arg `priceUsdE18()`
getter `MockUniswapV3Pool` has, so vault readers do not change.

Trust model: identical to rebalances. If you trust the enclave to sign the
allocation, the same enclave signing the price adds no new party. Latency is
one HTTP fetch plus one sign, so it works at the 15s tick.

## Mode: fdc (Web2Json, optional)

A decentralized attestation of the same web fetch: Flare's data providers all
fetch the URL, apply the jq filter, and vote a Merkle root on-chain, verified
via `IWeb2JsonVerification.verifyWeb2Json`. This module builds real Web2Json
requests (Yahoo chart endpoint, jq extracting `regularMarketPrice`) and
returns the `IWeb2Json.Proof`-shaped attestation, currently stubbed: the
live round-trip (FdcHub submit, wait for round finality, DA-layer proof
fetch) is marked TODO in `oracle.mjs`.

## Do we need FDC, and is it too slow?

Honestly: it is too slow for the display feed and not needed for the demo,
but it is the right upgrade for the rebalance path.

- FDC voting rounds are ~90s plus finalization, so per-15s-tick pricing is
  impossible. Use it only at rebalance cadence (minutes to hours), which is
  where the money actually moves.
- With enclave signing, price integrity reduces to one machine's attestation.
  That is acceptable while the same machine already signs rebalances: FDC
  would not lower the demo's trust floor.
- FDC matters when you stop trusting the single enclave: it makes the price
  input decentralized, so a compromised enclave could still only rebalance at
  honest prices. That is the "fully decentralized" endgame, not a tick-feed
  replacement.

So: enclave-signed per tick for display and fast paths, FDC per rebalance
when the decentralized mode is wired up.

## Files

- `oracle.mjs` - the factory, payload encoding, local verify, Web2Json
  request builder
- `SignedPriceOracle.sol` - on-chain verifier + per-symbol store, plus the
  drop-in `SignedPriceFeed`. foundry.toml's `src = "src"` does not cover
  pipeline/, so build it explicitly:
  `forge build pipeline/oracle/SignedPriceOracle.sol`
  (or move it into src/ when it goes to deploy)
- `oracle.test.mjs` - hermetic, `node --test pipeline/oracle/oracle.test.mjs`
