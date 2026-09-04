import {useQuery} from "@tanstack/react-query";
import type {Catalog, LeaderboardData, LiveData} from "@/core/types.ts";

const base = import.meta.env.BASE_URL;

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(`${base}data/${path}`);
  if (!r.ok) throw new Error(`failed to load ${path}: ${r.status}`);
  return r.json();
}

export function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: () => fetchJson<Catalog>("catalog.json"),
    staleTime: Infinity,
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => fetchJson<LeaderboardData>("leaderboard.json"),
    refetchInterval: 30_000,
  });
}

// The live board auto-refreshes fast; the live engine rewrites live.json every
// tick (default 15s), so a 5s poll keeps the board visibly moving.
export function useLive() {
  return useQuery({
    queryKey: ["live"],
    queryFn: () => fetchJson<LiveData>("live.json"),
    refetchInterval: 5_000,
  });
}
