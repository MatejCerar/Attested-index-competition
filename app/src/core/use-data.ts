import {useQuery} from "@tanstack/react-query";
import type {Catalog, LeaderboardData, LiveData} from "@/core/types.ts";

const base = import.meta.env.BASE_URL;
// When VITE_API_URL is set (hosted: FE on Cloudflare Pages, backend behind a
// tunnel) the board is read from the API. Otherwise the static files under
// public/data are used (local dev, or a self-contained static build).
const API = import.meta.env.VITE_API_URL as string | undefined;

async function fetchData<T>(name: "catalog" | "leaderboard" | "live"): Promise<T> {
  const url = API ? `${API}/${name}` : `${base}data/${name}.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`failed to load ${name}: ${r.status}`);
  return r.json();
}

export function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: () => fetchData<Catalog>("catalog"),
    staleTime: Infinity,
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => fetchData<LeaderboardData>("leaderboard"),
    refetchInterval: 30_000,
  });
}

// The live board auto-refreshes fast; the live engine rewrites live.json every
// tick (default 15s), so a 5s poll keeps the board visibly moving.
export function useLive() {
  return useQuery({
    queryKey: ["live"],
    queryFn: () => fetchData<LiveData>("live"),
    refetchInterval: 5_000,
  });
}
