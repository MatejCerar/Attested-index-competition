// The allowed index assets. Order is canonical and stable. Cash is the USD
// stablecoin (valued 1.0) and is NOT one of these.
export const ASSETS = ["BTC", "ETH", "XRP", "SOL", "AVAX", "DOGE", "FLR"];

export const isAsset = (s) => ASSETS.includes(s);
