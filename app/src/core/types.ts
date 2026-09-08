// Shared shapes for the catalog universe, leaderboard, and live board. These
// mirror the JSON the backend writes (scripts/catalog.json,
// app/public/data/{leaderboard,live}.json) so the app reads it directly.
// RWA-only board: no crypto in the selectable universe.

export interface CatalogAsset {
  id: string;
  ticker: string;
  issuer: string;
  issuerName: string;
  name: string;
  assetClass: string;
  access?: string;
  venues?: string[];
  chains?: number;
  priceUsd: number | null;
  priceExact?: boolean;
  priceSource: string | null; // "ftso" | "csv" | null
  vol24?: number | null;
  kind?: "rwa";
}

export interface Catalog {
  generatedAt: string;
  total: number;
  priceable: number;
  ftsoCount: number;
  classes: string[];
  assets: CatalogAsset[];
}

export interface LeaderboardPosition {
  sym: string;
  weight: number;
  units: number;
  basePx: number;
  drift: number;
  source?: string;
}

export interface LeaderboardIndex {
  id: string;
  name: string;
  prompt: string;
  rationale?: string;
  weights: Record<string, number>;
  strategy: string;
  strategyName?: string;
  rebalanceReason?: string;
  owner?: string; // "you" for a submitted basket
  mine?: boolean;
  vault?: string;
  depositUsd?: number;
  feeUsd?: number;
  depositTx?: string;
  rebalanceTx?: string;
  txSample?: boolean; // rebalanceTx is a resolvable reference, not this basket's
  positions: LeaderboardPosition[];
  weekReturn: number;
  rank: number;
}

export interface LeaderboardData {
  generatedAt: string;
  network: string;
  stable?: string;
  platform?: string;
  rebalancer?: string;
  attestedBy?: string;
  feeBps: number;
  platformRevenueUsd: number;
  sample?: boolean;
  baseline?: Record<string, number>;
  indices: LeaderboardIndex[];
}

export interface LiveLeg {
  sym: string;
  weight: number;
  dead: boolean;
  price: number | null;
  chg: number | null;
}

export interface NavPoint {
  t: number; // ms epoch
  nav: number;
  ret: number;
}

export interface LiveIndex {
  id: string;
  name: string;
  prompt: string;
  kind: "rwa";
  rebalances?: number;
  coverage: number;
  notExecutable: boolean;
  nav?: number;
  ret?: number;
  tvl?: number | null; // real deposited stablecoin in the vault, USD (on-chain)
  rank?: number;
  strategy?: string;
  strategyName?: string;
  lastReason?: string;
  onChain?: boolean;
  owner?: string | null; // "you" for a submitted basket racing live
  mine?: boolean;
  vault?: string | null;
  rebalanceTx?: string | null;
  txSample?: boolean;
  series?: NavPoint[];
  legs: LiveLeg[];
}

export interface LiveData {
  startedAt: string;
  elapsedSec: number;
  durationSec: number;
  intervalSec: number;
  rebalanceSec: number;
  capital: number;
  finished: boolean;
  continuous?: boolean;
  source: string;
  sourceLabel?: string;
  sample?: boolean;
  indices: LiveIndex[];
}

// The builder's in-progress index and a user basket (appended to
// user-baskets.json, matching build.html's shape plus strategy).
export interface UserBasket {
  id: string;
  name: string;
  prompt: string;
  rationale?: string;
  kind: "rwa";
  strategy: string;
  weights: Record<string, number>;
}
