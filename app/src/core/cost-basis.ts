// Per-wallet cost basis for vault deposits, tracked client-side (localStorage).
// The vault only knows your share balance on-chain, not what you paid, so we
// record each deposit here to show a real P&L (current value vs invested). Keyed
// by vault address; scoped to this browser. Cleared on a full redeem.
const KEY = "aidx-cost-basis-v1";

type Book = Record<string, number>; // vault (lowercased) -> cumulative USD in

function load(): Book {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function save(b: Book) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* storage unavailable - P&L just falls back to index return */
  }
}

export function recordDeposit(vault: string, usd: number) {
  const b = load();
  const k = vault.toLowerCase();
  b[k] = (b[k] || 0) + usd;
  save(b);
}

export function clearCostBasis(vault: string) {
  const b = load();
  delete b[vault.toLowerCase()];
  save(b);
}

export function getCostBasis(vault: string): number {
  return load()[vault.toLowerCase()] || 0;
}
