// Rebalance strategy templates. Each strategy is a pure object exposing
// shouldRebalance({now, lastRebalanceAt, currentWeightsBps, targetWeightsBps})
// plus {id, name, description}. All times are ms epoch. Weight maps are
// SYM -> integer bps (sum ~10000).

// Max absolute per-asset drift in bps between current and target.
export function maxDriftBps(currentWeightsBps, targetWeightsBps) {
    const syms = new Set([
        ...Object.keys(currentWeightsBps || {}),
        ...Object.keys(targetWeightsBps || {}),
    ]);
    let max = 0;
    for (const s of syms) {
        const c = currentWeightsBps?.[s] || 0;
        const t = targetWeightsBps?.[s] || 0;
        const d = Math.abs(c - t);
        if (d > max) max = d;
    }
    return max;
}

// Interval strategy: rebalance once the interval has elapsed.
export function interval(intervalMs, meta = {}) {
    return {
        id: meta.id || `interval-${intervalMs}`,
        name: meta.name || `Every ${Math.round(intervalMs / 60000)}m`,
        description:
            meta.description ||
            `Rebalance when at least ${intervalMs}ms have passed.`,
        intervalMs,
        shouldRebalance({now, lastRebalanceAt}) {
            if (lastRebalanceAt == null) return true;
            return now - lastRebalanceAt >= intervalMs;
        },
    };
}

// Drift harness: rebalance when any asset drifts past the band.
export function drift(driftBps = 500, meta = {}) {
    return {
        id: meta.id || `drift-${driftBps}`,
        name: meta.name || `Drift ${driftBps / 100}%`,
        description:
            meta.description ||
            `Rebalance when max asset drift >= ${driftBps}bps.`,
        driftBps,
        shouldRebalance({currentWeightsBps, targetWeightsBps}) {
            return maxDriftBps(currentWeightsBps, targetWeightsBps) >= driftBps;
        },
    };
}

// Combined: rebalance on the interval, or early if the drift band is breached.
export function combined({intervalMs, driftBps = 500}, meta = {}) {
    return {
        id: meta.id || `combined-${intervalMs}-${driftBps}`,
        name:
            meta.name ||
            `Every ${Math.round(intervalMs / 60000)}m or ${driftBps / 100}% drift`,
        description:
            meta.description ||
            `Rebalance when ${intervalMs}ms elapsed OR drift >= ${driftBps}bps.`,
        intervalMs,
        driftBps,
        shouldRebalance({now, lastRebalanceAt, currentWeightsBps, targetWeightsBps}) {
            const elapsed =
                lastRebalanceAt == null || now - lastRebalanceAt >= intervalMs;
            const breached =
                maxDriftBps(currentWeightsBps, targetWeightsBps) >= driftBps;
            return elapsed || breached;
        },
    };
}

// Cooldown-gated drift: rebalance on a drift breach, but never more often than
// a minimum interval (a cooldown between rebalances).
export function cooldownDrift({driftBps = 500, cooldownMs}, meta = {}) {
    return {
        id: meta.id || `cooldown-drift-${driftBps}-${cooldownMs}`,
        name:
            meta.name ||
            `Drift ${driftBps / 100}% (${Math.round(cooldownMs / 60000)}m cooldown)`,
        description:
            meta.description ||
            `Rebalance on >= ${driftBps}bps drift, at most once per ${cooldownMs}ms.`,
        driftBps,
        cooldownMs,
        shouldRebalance({now, lastRebalanceAt, currentWeightsBps, targetWeightsBps}) {
            if (lastRebalanceAt == null) return true;
            if (now - lastRebalanceAt < cooldownMs) return false;
            return maxDriftBps(currentWeightsBps, targetWeightsBps) >= driftBps;
        },
    };
}

// Take-profit harness: rebalance when the index is up >= gainPct since its last
// rebalance. Needs {nav, lastRebalanceNav} in the tick context.
export function takeProfit(gainPct = 5, meta = {}) {
    const g = gainPct / 100;
    return {
        id: meta.id || `take-profit-${gainPct}`,
        name: meta.name || `Take-profit ${gainPct}%`,
        description:
            meta.description ||
            `Rebalance when NAV is up >= ${gainPct}% since the last rebalance.`,
        gainPct,
        shouldRebalance({nav, lastRebalanceNav}) {
            if (lastRebalanceNav == null || !(lastRebalanceNav > 0)) return true;
            return nav / lastRebalanceNav - 1 >= g;
        },
    };
}

// Ready-made templates. Add more intervals as one-liners.
export const intervalMinute = interval(60000, {
    id: "minute",
    name: "Minute",
});
export const intervalFiveMin2 = interval(300000, {
    id: "five-minute",
    name: "Five minute",
});
export const intervalTenMin2 = interval(600000, {
    id: "ten-minute",
    name: "Ten minute",
});
export const intervalThirtyMin = interval(1800000, {
    id: "thirty-minute",
    name: "Thirty minute",
});
export const intervalDaily = interval(86400000, {
    id: "daily",
    name: "Daily",
});
export const intervalHourly = interval(3600000, {
    id: "hourly",
    name: "Hourly",
});
// Back-compat aliases (kept: the old ids stay valid).
export const intervalTenMin = intervalTenMin2;
export const intervalFiveMin = intervalFiveMin2;

// Drift harnesses at several bands.
export const drift2pct = drift(200, {id: "drift-2", name: "Drift 2%"});
export const drift5pct = drift(500, {id: "drift-5", name: "Drift 5%"});
export const drift10pct = drift(1000, {id: "drift-10", name: "Drift 10%"});
export const drift20pct = drift(2000, {id: "drift-20", name: "Drift 20%"});
// Keep the legacy id "drift-5pct" as an alias of drift-5.
export const drift5pctLegacy = drift(500, {id: "drift-5pct", name: "Drift 5%"});

// Combined interval+drift variants.
export const combinedHourlyDrift5 = combined(
    {intervalMs: 3600000, driftBps: 500},
    {id: "hourly-or-drift-5", name: "Hourly or 5% drift"}
);
// Keep the legacy id "hourly-or-drift" as an alias.
export const combinedHourlyDrift = combined(
    {intervalMs: 3600000, driftBps: 500},
    {id: "hourly-or-drift", name: "Hourly or 5% drift"}
);
export const combinedTenMinDrift2 = combined(
    {intervalMs: 600000, driftBps: 200},
    {id: "ten-minute-or-drift-2", name: "Ten minute or 2% drift"}
);
export const combinedThirtyMinDrift5 = combined(
    {intervalMs: 1800000, driftBps: 500},
    {id: "thirty-minute-or-drift-5", name: "Thirty minute or 5% drift"}
);
export const combinedFiveMinDrift2 = combined(
    {intervalMs: 300000, driftBps: 200},
    {id: "five-minute-or-drift-2", name: "Five minute or 2% drift"}
);

// Cooldown-gated drift.
export const cooldownDrift5Hourly = cooldownDrift(
    {driftBps: 500, cooldownMs: 3600000},
    {id: "cooldown-drift-5-hourly", name: "Drift 5% (hourly cooldown)"}
);
export const cooldownDrift2TenMin = cooldownDrift(
    {driftBps: 200, cooldownMs: 600000},
    {id: "cooldown-drift-2-ten-minute", name: "Drift 2% (ten-minute cooldown)"}
);

// Take-profit harnesses.
export const takeProfit5 = takeProfit(5, {id: "take-profit-5", name: "Take-profit 5%"});
export const takeProfit10 = takeProfit(10, {id: "take-profit-10", name: "Take-profit 10%"});

// Grouped for the FE picker: intervals, harnesses, combined.
export const STRATEGY_GROUPS = {
    intervals: [
        intervalMinute,
        intervalFiveMin2,
        intervalTenMin2,
        intervalThirtyMin,
        intervalHourly,
        intervalDaily,
    ],
    harnesses: [
        drift2pct,
        drift5pct,
        drift10pct,
        drift20pct,
        cooldownDrift5Hourly,
        cooldownDrift2TenMin,
        takeProfit5,
        takeProfit10,
    ],
    combined: [
        combinedFiveMinDrift2,
        combinedTenMinDrift2,
        combinedThirtyMinDrift5,
        combinedHourlyDrift5,
    ],
};

export const STRATEGIES = Object.fromEntries(
    [
        ...STRATEGY_GROUPS.intervals,
        ...STRATEGY_GROUPS.harnesses,
        ...STRATEGY_GROUPS.combined,
        drift5pctLegacy, // legacy id alias
        combinedHourlyDrift, // legacy id alias
    ].map((s) => [s.id, s])
);

export function getStrategy(id) {
    const s = STRATEGIES[id];
    if (!s) throw new Error(`unknown strategy: ${id}`);
    return s;
}
