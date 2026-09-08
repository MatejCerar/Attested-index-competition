import type {UserBasket} from "@/core/types.ts";

// POST a built basket to the competition server's /api/add. The server
// validates it against the RWA catalog, scores it with the real rebalance math,
// tags it owner:"you" in user-baskets.json (so the live engine races it), and
// upserts it into the leaderboard. Returns the ranked entry, or {ok:false} with
// an error if the server is unreachable so the caller can fail loudly (the
// submission never reached the competition).
const API = import.meta.env.VITE_API_URL as string | undefined;

export interface AddResult {
  ok: boolean;
  mode?: "chain" | "off-chain";
  entry?: {
    id: string;
    rank?: number;
    name: string;
    weekReturn: number;
    vault?: string; // the deployed index vault (when mode === "chain")
  };
  error?: string;
}

export async function addBasket(basket: UserBasket): Promise<AddResult> {
  if (!API) return {ok: false, error: "no server configured"};
  try {
    const r = await fetch(`${API}/add`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({basket}),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return {ok: false, error: j.error || `server ${r.status}`};
    }
    const j = await r.json();
    return {ok: true, mode: j.mode, entry: j.entry};
  } catch (e) {
    return {ok: false, error: String(e)};
  }
}
