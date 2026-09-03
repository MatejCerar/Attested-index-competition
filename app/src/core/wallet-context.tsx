import type {ReactNode} from "react";
import {createContext, use, useCallback, useMemo, useState} from "react";
import {depositOnChain, mintTestUsd, type DepositResult} from "@/core/evm-seam.ts";

// A deliberately small wallet seam. The connect-wallet UI is kept for the Flare
// look, but deposits run on an EVM seam that is mocked by default and does a
// real Coston2 tx only when an injected wallet (window.ethereum) is present.
// No XRPL plumbing.
export interface WalletState {
  address: string | null;
  connected: boolean;
  mode: "mock" | "injected";
  connect: (mode: "mock" | "injected") => Promise<void>;
  disconnect: () => void;
  deposit: (vault: string, amountUsdc: number) => Promise<DepositResult>;
  mint: (amountUsdc?: number) => Promise<DepositResult>;
}

const WalletContext = createContext<WalletState | null>(null);

const MOCK_ADDRESS = "0xdEmoC0570n2Acc0untFa11bacK0000000000dEaD";

export function WalletProvider({children}: {children: ReactNode}) {
  const [address, setAddress] = useState<string | null>(null);
  const [mode, setMode] = useState<"mock" | "injected">("mock");

  const connect = useCallback(async (m: "mock" | "injected") => {
    if (m === "injected" && typeof window !== "undefined" && (window as any).ethereum) {
      const accts: string[] = await (window as any).ethereum.request({
        method: "eth_requestAccounts",
      });
      setAddress(accts[0] ?? MOCK_ADDRESS);
      setMode("injected");
      return;
    }
    // Mock connect: no chain, just a demo address so the UI flows.
    setAddress(MOCK_ADDRESS);
    setMode("mock");
  }, []);

  const disconnect = useCallback(() => setAddress(null), []);

  const deposit = useCallback(
    (vault: string, amountUsdc: number) => depositOnChain({vault, amountUsdc, mode}),
    [mode]
  );

  const mint = useCallback((amountUsdc = 1000) => mintTestUsd(amountUsdc), []);

  const value = useMemo<WalletState>(
    () => ({
      address,
      connected: address != null,
      mode,
      connect,
      disconnect,
      deposit,
      mint,
    }),
    [address, mode, connect, disconnect, deposit, mint]
  );

  return <WalletContext value={value}>{children}</WalletContext>;
}

export function useWallet(): WalletState {
  const ctx = use(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
