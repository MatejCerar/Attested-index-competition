import type {ReactNode} from "react";
import {createContext, use, useCallback, useEffect, useMemo, useState} from "react";
import type {Eip1193Provider} from "@/core/evm-seam.ts";

// A small wallet seam. It discovers injected wallets via EIP-6963 (so MetaMask
// and Phantom no longer collide on the ambiguous window.ethereum), lets the user
// pick one, and exposes the selected EIP-1193 provider so evm-seam can do real
// Coston2 txs. A mock "demo" account keeps the UI flowing with no chain.

// EIP-6963 provider info + provider handle.
export interface Eip6963ProviderDetail {
  info: {uuid: string; name: string; icon: string; rdns: string};
  provider: Eip1193Provider;
}

export interface WalletState {
  address: string | null;
  connected: boolean;
  mode: "mock" | "injected";
  provider: Eip1193Provider | null;
  wallets: Eip6963ProviderDetail[];
  // Connect to a discovered EIP-6963 wallet by uuid, the fallback injected
  // wallet (window.ethereum), or the mock demo account.
  connect: (target: {kind: "eip6963"; uuid: string} | {kind: "injected"} | {kind: "mock"}) => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState | null>(null);

const MOCK_ADDRESS = "0xdEmoC0570n2Acc0untFa11bacK0000000000dEaD";

export function WalletProvider({children}: {children: ReactNode}) {
  const [address, setAddress] = useState<string | null>(null);
  const [mode, setMode] = useState<"mock" | "injected">("mock");
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [wallets, setWallets] = useState<Eip6963ProviderDetail[]>([]);

  // EIP-6963 discovery: listen for announcements, then request them. Dedupe by
  // uuid so repeated announcements do not pile up.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (!detail?.info?.uuid || !detail.provider) return;
      setWallets((list) =>
        list.some((w) => w.info.uuid === detail.info.uuid) ? list : [...list, detail]
      );
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () =>
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
  }, []);

  const connectProvider = useCallback(async (p: Eip1193Provider) => {
    const accts = (await p.request({method: "eth_requestAccounts"})) as string[];
    setProvider(p);
    setAddress(accts[0] ?? null);
    setMode("injected");
  }, []);

  const connect = useCallback<WalletState["connect"]>(
    async (target) => {
      if (target.kind === "mock") {
        setProvider(null);
        setAddress(MOCK_ADDRESS);
        setMode("mock");
        return;
      }
      if (target.kind === "eip6963") {
        const found = wallets.find((w) => w.info.uuid === target.uuid);
        if (!found) throw new Error("Selected wallet is no longer available.");
        await connectProvider(found.provider);
        return;
      }
      // Fallback: the ambiguous window.ethereum as a single injected wallet.
      const injected =
        typeof window !== "undefined"
          ? ((window as {ethereum?: Eip1193Provider}).ethereum ?? null)
          : null;
      if (!injected) throw new Error("No injected wallet found.");
      await connectProvider(injected);
    },
    [wallets, connectProvider]
  );

  const disconnect = useCallback(() => {
    setAddress(null);
    setProvider(null);
    setMode("mock");
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      address,
      connected: address != null,
      mode,
      provider,
      wallets,
      connect,
      disconnect,
    }),
    [address, mode, provider, wallets, connect, disconnect]
  );

  return <WalletContext value={value}>{children}</WalletContext>;
}

export function useWallet(): WalletState {
  const ctx = use(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
