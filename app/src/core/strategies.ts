// The rebalance strategy templates the builder offers, mirrored from
// index/strategies.mjs (id + human label + description + group). The backend is
// the source of truth for behaviour; this is display + selection only.
export type StrategyGroup = "intervals" | "harnesses" | "combined";

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  group: StrategyGroup;
}

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  // Intervals.
  {id: "minute", name: "Minute", description: "Rebalance once a minute.", group: "intervals"},
  {id: "five-minute", name: "Five minute", description: "Rebalance every five minutes.", group: "intervals"},
  {id: "ten-minute", name: "Ten minute", description: "Rebalance every ten minutes.", group: "intervals"},
  {id: "thirty-minute", name: "Thirty minute", description: "Rebalance every thirty minutes.", group: "intervals"},
  {id: "hourly", name: "Hourly", description: "Rebalance once every hour.", group: "intervals"},
  {id: "daily", name: "Daily", description: "Rebalance once a day.", group: "intervals"},
  // Harnesses.
  {id: "drift-2", name: "Drift 2%", description: "Rebalance when any asset drifts 2% past target.", group: "harnesses"},
  {id: "drift-5", name: "Drift 5%", description: "Rebalance when any asset drifts 5% past target.", group: "harnesses"},
  {id: "drift-10", name: "Drift 10%", description: "Rebalance when any asset drifts 10% past target.", group: "harnesses"},
  {id: "drift-20", name: "Drift 20%", description: "Rebalance when any asset drifts 20% past target.", group: "harnesses"},
  {
    id: "cooldown-drift-5-hourly",
    name: "Drift 5% (hourly cooldown)",
    description: "Rebalance on 5% drift, at most once per hour.",
    group: "harnesses",
  },
  {
    id: "cooldown-drift-2-ten-minute",
    name: "Drift 2% (ten-minute cooldown)",
    description: "Rebalance on 2% drift, at most once per ten minutes.",
    group: "harnesses",
  },
  {
    id: "take-profit-5",
    name: "Take-profit 5%",
    description: "Rebalance when NAV is up 5% since the last rebalance.",
    group: "harnesses",
  },
  {
    id: "take-profit-10",
    name: "Take-profit 10%",
    description: "Rebalance when NAV is up 10% since the last rebalance.",
    group: "harnesses",
  },
  // Combined interval + drift.
  {
    id: "five-minute-or-drift-2",
    name: "Five minute or 2% drift",
    description: "Rebalance every five minutes, or earlier on a 2% drift breach.",
    group: "combined",
  },
  {
    id: "ten-minute-or-drift-2",
    name: "Ten minute or 2% drift",
    description: "Rebalance every ten minutes, or earlier on a 2% drift breach.",
    group: "combined",
  },
  {
    id: "thirty-minute-or-drift-5",
    name: "Thirty minute or 5% drift",
    description: "Rebalance every thirty minutes, or earlier on a 5% drift breach.",
    group: "combined",
  },
  {
    id: "hourly-or-drift-5",
    name: "Hourly or 5% drift",
    description: "Rebalance hourly, or earlier if the 5% drift band is breached.",
    group: "combined",
  },
];

export const STRATEGY_GROUP_LABELS: Record<StrategyGroup, string> = {
  intervals: "Intervals",
  harnesses: "Drift + profit harnesses",
  combined: "Combined interval + drift",
};

export const DEFAULT_STRATEGY = "hourly-or-drift-5";

export function strategyName(id: string): string {
  return STRATEGY_TEMPLATES.find((s) => s.id === id)?.name ?? id;
}
