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

// Ready-made templates. Add more intervals as one-liners.
export const intervalHourly = interval(3600000, {
    id: "hourly",
    name: "Hourly",
});
export const intervalTenMin = interval(600000, {
    id: "ten-minute",
    name: "Ten minute",
});
export const intervalFiveMin = interval(300000, {
    id: "five-minute",
    name: "Five minute",
});
export const drift5pct = drift(500, {id: "drift-5pct", name: "Drift 5%"});
export const combinedHourlyDrift = combined(
    {intervalMs: 3600000, driftBps: 500},
    {id: "hourly-or-drift", name: "Hourly or 5% drift"}
);

export const STRATEGIES = Object.fromEntries(
    [
        intervalHourly,
        intervalTenMin,
        intervalFiveMin,
        drift5pct,
        combinedHourlyDrift,
    ].map((s) => [s.id, s])
);

export function getStrategy(id) {
    const s = STRATEGIES[id];
    if (!s) throw new Error(`unknown strategy: ${id}`);
    return s;
}
