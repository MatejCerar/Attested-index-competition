// Which indices each wallet created, stored locally. There are no user
// accounts, so ownership lives in this browser, keyed by the wallet address
// that submitted the index ("local" when none was connected). The shared
// board's owner:"you" flag just tells the engine to race a user submission; it
// is the same for everyone, so it must not drive the "Yours" badge.
const KEY = "aidx-my-indices-v2";

type Owned = Record<string, string[]>;

function ownerKey(address?: string | null): string {
  return address ? address.toLowerCase() : "local";
}

function read(): Owned {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Owned) : {};
  } catch {
    return {};
  }
}

export function recordMyIndex(id: string, address?: string | null): void {
  if (!id) return;
  const map = read();
  const key = ownerKey(address);
  const ids = new Set(map[key] ?? []);
  ids.add(id);
  map[key] = [...ids];
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // storage unavailable; badge just will not persist
  }
}

export function isMyIndex(
  id: string | undefined | null,
  address?: string | null
): boolean {
  return id ? (read()[ownerKey(address)] ?? []).includes(id) : false;
}
