// Tiny node test harness for strategies, weights, and prices. No deps.
import assert from "node:assert/strict";
import {
    interval,
    drift,
    combined,
    maxDriftBps,
    getStrategy,
    STRATEGIES,
} from "../strategies.mjs";
import {normalizeWeights, weightsToBps} from "../weights.mjs";
import {getPricesSync, getPrices} from "../prices.mjs";

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

t("registry resolves known strategies", () => {
    for (const id of ["hourly", "ten-minute", "five-minute", "drift-5pct", "hourly-or-drift"]) {
        assert.equal(getStrategy(id).id, id);
    }
    assert.throws(() => getStrategy("nope"));
    assert.ok(Object.keys(STRATEGIES).length >= 5);
});

t("normalizeWeights strips, renormalizes, sums 100", () => {
    const w = normalizeWeights({BTC: 60, ETH: 40, FOO: 999, ZERO: 0});
    assert.equal(Object.values(w).reduce((a, v) => a + v, 0), 100);
    assert.ok(!("FOO" in w) && !("ZERO" in w));
});

t("normalizeWeights renormalizes non-100 input", () => {
    const w = normalizeWeights({BTC: 3, ETH: 1}); // 3:1 -> 75/25
    assert.equal(w.BTC, 75);
    assert.equal(w.ETH, 25);
});

t("normalizeWeights returns null on empty", () => {
    assert.equal(normalizeWeights({FOO: 10}), null);
    assert.equal(normalizeWeights({}), null);
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

console.log(`\n${passed} strategy/weight/price tests passed`);
