import {useQuery} from "@tanstack/react-query";

// The deployed Coston2 addresses the FE needs to do real txs: the MockUSDC
// stable, the per-index StableIndexVault addresses, and the mock pools. Served
// by scripts/server.mjs at /api/onchain, or from the static file under
// public/data when no API is configured (local static build).
const base = import.meta.env.BASE_URL;
const API = import.meta.env.VITE_API_URL as string | undefined;

export interface OnchainVault {
  addr: string;
  order?: string[];
}

export interface OnchainConfig {
  stable: string | null;
  vaults: Record<string, OnchainVault>;
  pools: Record<string, string>;
}

const EMPTY: OnchainConfig = {stable: null, vaults: {}, pools: {}};

async function fetchOnchain(): Promise<OnchainConfig> {
  const url = API ? `${API}/onchain` : `${base}data/compete-onchain.json`;
  try {
    const r = await fetch(url);
    if (!r.ok) return EMPTY;
    const j = await r.json();
    return {
      stable: j.stable ?? null,
      vaults: j.vaults ?? {},
      pools: j.pools ?? {},
    };
  } catch {
    return EMPTY;
  }
}

export function useOnchain() {
  return useQuery({
    queryKey: ["onchain"],
    queryFn: fetchOnchain,
    // The server adds vaults to this file at runtime (a user creating an index),
    // so refetch periodically instead of caching forever - otherwise the FE and
    // the live engine disagree on which vault address is current.
    staleTime: 8_000,
    refetchInterval: 10_000,
  });
}
