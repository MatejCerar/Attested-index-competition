// Tiny node test harness for strategies, weights, and prices. No deps.
import assert from "node:assert/strict";
import {
    interval,
    drift,
    combined,
    cooldownDrift,
    takeProfit,
    maxDriftBps,
    getStrategy,
    STRATEGIES,
    STRATEGY_GROUPS,
} from "../strategies.mjs";
import {normalizeWeights, weightsToBps} from "../weights.mjs";
import {
    getPricesSync,
    getPrices,
    sqrtPriceX96ToUsd,
    createUniswapPriceSource,
    poolsFor,
} from "../prices.mjs";

let passed = 0;
function t(name, fn) {
    fn();
    passed++;
    console.log(`ok ${name}`);
}

t("interval waits for elapsed", () => {
    const s = interval(1000);
    assert.equal(s.shouldRebalance({now: 0, lastRebalanceAt: null}), true);
    assert.equal(s.shouldRebalance({now: 500, lastRebalanceAt: 0}), false);
    assert.equal(s.shouldRebalance({now: 1000, lastRebalanceAt: 0}), true);
});

t("maxDriftBps computes max abs drift", () => {
    const cur = {BTC: 6000, ETH: 4000};
    const tgt = {BTC: 5000, ETH: 5000};
    assert.equal(maxDriftBps(cur, tgt), 1000);
});

t("drift fires only past the band", () => {
    const s = drift(500);
    const tgt = {BTC: 5000, ETH: 5000};
    assert.equal(
        s.shouldRebalance({currentWeightsBps: {BTC: 5300, ETH: 4700}, targetWeightsBps: tgt}),
        false
    );
    assert.equal(
        s.shouldRebalance({currentWeightsBps: {BTC: 5600, ETH: 4400}, targetWeightsBps: tgt}),
        true
    );
});

t("combined fires on interval OR drift", () => {
    const s = combined({intervalMs: 1000, driftBps: 500});
    const tgt = {BTC: 5000, ETH: 5000};
    // interval not elapsed, drift small -> false
    assert.equal(
        s.shouldRebalance({
            now: 100,
            lastRebalanceAt: 0,
            currentWeightsBps: {BTC: 5100, ETH: 4900},
            targetWeightsBps: tgt,
        }),
        false
    );
    // interval elapsed -> true
    assert.equal(
        s.shouldRebalance({
            now: 2000,
            lastRebalanceAt: 0,
            currentWeightsBps: {BTC: 5100, ETH: 4900},
            targetWeightsBps: tgt,
        }),
        true
    );
    // drift breached early -> true
    assert.equal(
        s.shouldRebalance({
            now: 100,
            lastRebalanceAt: 0,
            currentWeightsBps: {BTC: 5800, ETH: 4200},
            targetWeightsBps: tgt,
        }),
        true
    );
});

t("cooldownDrift gates on interval then drift", () => {
    const s = cooldownDrift({driftBps: 500, cooldownMs: 1000});
    const tgt = {BTC: 5000, ETH: 5000};
    // first ever -> true
    assert.equal(
        s.shouldRebalance({now: 0, lastRebalanceAt: null, currentWeightsBps: tgt, targetWeightsBps: tgt}),
        true
    );
    // within cooldown even with big drift -> false
    assert.equal(
        s.shouldRebalance({now: 500, lastRebalanceAt: 0, currentWeightsBps: {BTC: 7000, ETH: 3000}, targetWeightsBps: tgt}),
        false
    );
    // past cooldown but small drift -> false
    assert.equal(
        s.shouldRebalance({now: 1500, lastRebalanceAt: 0, currentWeightsBps: {BTC: 5100, ETH: 4900}, targetWeightsBps: tgt}),
        false
    );
    // past cooldown and drift breached -> true
    assert.equal(
        s.shouldRebalance({now: 1500, lastRebalanceAt: 0, currentWeightsBps: {BTC: 5800, ETH: 4200}, targetWeightsBps: tgt}),
        true
    );
});

t("takeProfit fires on NAV gain since last rebalance", () => {
    const s = takeProfit(5);
    assert.equal(s.shouldRebalance({nav: 100, lastRebalanceNav: null}), true);
    assert.equal(s.shouldRebalance({nav: 104, lastRebalanceNav: 100}), false);
    assert.equal(s.shouldRebalance({nav: 105, lastRebalanceNav: 100}), true);
    assert.equal(s.shouldRebalance({nav: 90, lastRebalanceNav: 100}), false);
});

t("registry resolves known strategies incl. new templates", () => {
    for (const id of [
        "minute", "five-minute", "ten-minute", "thirty-minute", "hourly", "daily",
        "drift-2", "drift-5", "drift-10", "drift-20",
        "cooldown-drift-5-hourly", "cooldown-drift-2-ten-minute",
        "take-profit-5", "take-profit-10",
        "five-minute-or-drift-2", "ten-minute-or-drift-2",
        "thirty-minute-or-drift-5", "hourly-or-drift-5",
        "drift-5pct", "hourly-or-drift", // legacy aliases
    ]) {
        assert.equal(getStrategy(id).id, id);
    }
    assert.throws(() => getStrategy("nope"));
    assert.ok(Object.keys(STRATEGIES).length >= 18);
    // Every grouped template resolves + carries metadata.
    for (const g of Object.values(STRATEGY_GROUPS))
        for (const s of g) {
            assert.ok(s.id && s.name && s.description);
            assert.equal(getStrategy(s.id).id, s.id);
        }
});

// normalizeWeights takes an explicit allowed list (ASSETS is empty on the
// RWA-only board); pass one here to exercise the strip/renormalize logic.
const ALLOW = ["AAA", "BBB"];
t("normalizeWeights strips, renormalizes, sums 100", () => {
    const w = normalizeWeights({AAA: 60, BBB: 40, FOO: 999, ZERO: 0}, ALLOW);
    assert.equal(Object.values(w).reduce((a, v) => a + v, 0), 100);
    assert.ok(!("FOO" in w) && !("ZERO" in w));
});

t("normalizeWeights renormalizes non-100 input", () => {
    const w = normalizeWeights({AAA: 3, BBB: 1}, ALLOW); // 3:1 -> 75/25
    assert.equal(w.AAA, 75);
    assert.equal(w.BBB, 25);
});

t("normalizeWeights returns null on empty", () => {
    assert.equal(normalizeWeights({FOO: 10}, ALLOW), null);
    assert.equal(normalizeWeights({}, ALLOW), null);
});

t("weightsToBps sums 10000", () => {
    const b = weightsToBps({BTC: 60, ETH: 40});
    assert.equal(b.BTC + b.ETH, 10000);
    const b2 = weightsToBps({A: 33, B: 33, C: 34});
    assert.equal(Object.values(b2).reduce((a, v) => a + v, 0), 10000);
});

t("prices stub is deterministic and complete", () => {
    const p = getPricesSync(["BTC", "ETH", "FLR"]);
    assert.equal(typeof p.BTC, "number");
    assert.ok(p.BTC > 0 && p.FLR > 0);
});

await (async () => {
    const p = await getPrices(["BTC"]);
    assert.equal(typeof p.BTC, "number");
})();

// Uniswap price source: seed a sqrtPriceX96 the same way MockUniswapV3Pool
// does, read it back through the source, and check round-trip + fallback.
function bigSqrt(v) {
    if (v < 2n) return v;
    let x0 = v / 2n;
    let x1 = (x0 + v / x0) / 2n;
    while (x1 < x0) {
        x0 = x1;
        x1 = (x0 + v / x0) / 2n;
    }
    return x0;
}
function seedSqrt(priceE18, assetIsToken0, ad, sd) {
    let num, den;
    if (assetIsToken0) {
        num = priceE18 * 10n ** BigInt(sd);
        den = 10n ** 18n * 10n ** BigInt(ad);
    } else {
        num = 10n ** 18n * 10n ** BigInt(ad);
        den = priceE18 * 10n ** BigInt(sd);
    }
    return bigSqrt((num << 96n) / den) << 48n;
}

t("sqrtPriceX96ToUsd round-trips both orderings", () => {
    for (const a0 of [true, false]) {
        const sp = seedSqrt(76769n * 10n ** 18n, a0, 18, 6);
        const usd = sqrtPriceX96ToUsd(sp, {
            assetIsToken0: a0,
            assetDecimals: 18,
            stableDecimals: 6,
        });
        assert.ok(Math.abs(usd - 76769) / 76769 < 1e-3);
    }
});

t("poolsFor accepts array and object", () => {
    assert.deepEqual(poolsFor([{sym: "BTC", address: "0x1"}]), {BTC: "0x1"});
    assert.deepEqual(poolsFor({ETH: "0x2"}), {ETH: "0x2"});
});

await (async () => {
    // In-memory Contract shim so the real source runs with no chain.
    const state = {
        "0xbtc": {sp: seedSqrt(76769n * 10n ** 18n, true, 18, 6), a0: true},
    };
    // A `new`-able Contract shim (the source calls `new Contract(...)`).
    function Contract(addr) {
        return {
            slot0: async () => [state[addr].sp, 0n, 0, 1, 1, 0, true],
            assetIsToken0: async () => state[addr].a0,
            assetDecimals: async () => 18,
            stableDecimals: async () => 6,
        };
    }
    const src = createUniswapPriceSource({
        provider: {},
        pools: {BTC: "0xbtc"},
        fallbackSource: {getPrices: async () => ({ETH: 2384.5})},
        Contract,
    });
    const prices = await src.getPrices(["BTC", "ETH"]);
    assert.ok(Math.abs(prices.BTC - 76769) / 76769 < 1e-3);
    assert.equal(prices.ETH, 2384.5); // no pool -> fallback
    assert.equal(src.sources.BTC, "uniswap");
    assert.equal(src.sources.ETH, "fallback");
    passed++;
    console.log("ok uniswap source reads pools + falls back for no-pool assets");
})();

console.log(`\n${passed} strategy/weight/price tests passed`);
