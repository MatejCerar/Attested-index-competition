import {BrowserProvider, Contract, parseUnits} from "ethers";

// The deposit + mint seam. With a real EIP-1193 provider (an injected wallet
// selected via EIP-6963) and a deployed stable/vault address it does real
// Coston2 txs: MockUSDC.faucet() to mint 1000 test USD to the connected wallet,
// and approve + StableIndexVault.deposit(amount) to deposit. With the mock
// (demo) account it returns a simulated result so the UI flows with no chain.

// Minimal EIP-1193 provider surface we rely on.
export interface Eip1193Provider {
  request(args: {method: string; params?: unknown[] | object}): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

export interface DepositArgs {
  provider: Eip1193Provider | null;
  stable: string | null;
  vault: string | null;
  amountUsdc: number;
  mode: "mock" | "injected";
}

export interface MintArgs {
  provider: Eip1193Provider | null;
  stable: string | null;
  amountUsdc?: number;
  mode: "mock" | "injected";
}

export interface DepositResult {
  ok: boolean;
  mocked: boolean;
  txHash?: string;
  explorer?: string;
  address?: string;
  error?: string;
}

export const COSTON2_CHAIN_ID = 114;
const COSTON2_CHAIN_ID_HEX = "0x72"; // 114
const USDC_DECIMALS = 6;
const EXPLORER = "https://coston2-explorer.flare.network";

// Minimal ABIs for the mint + deposit path.
const ERC20_ABI = ["function approve(address spender,uint256 amount) returns (bool)"];
const VAULT_ABI = ["function deposit(uint256 amount)"];
const FAUCET_ABI = ["function faucet()"];

const COSTON2_PARAMS = {
  chainId: COSTON2_CHAIN_ID_HEX,
  chainName: "Flare Testnet Coston2",
  nativeCurrency: {name: "Coston2 Flare", symbol: "C2FLR", decimals: 18},
  rpcUrls: ["https://coston2-api.flare.network/ext/C/rpc"],
  blockExplorerUrls: [EXPLORER],
};

function explorerTx(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

// Ensure the wallet is on Coston2 (chain 114). Requests a switch, adding the
// chain on 4902 (unknown chain). Throws a readable error if the user rejects.
export async function ensureCoston2(provider: Eip1193Provider): Promise<void> {
  const current = (await provider.request({method: "eth_chainId"})) as string;
  if (typeof current === "string" && parseInt(current, 16) === COSTON2_CHAIN_ID) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{chainId: COSTON2_CHAIN_ID_HEX}],
    });
  } catch (e) {
    const code = (e as {code?: number}).code;
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [COSTON2_PARAMS],
      });
      return;
    }
    if (code === 4001) {
      throw new Error("Network switch rejected: please switch your wallet to Coston2 (chain 114).");
    }
    throw e;
  }
}

// Mint 1000 test USD to the CONNECTED wallet via MockUSDC.faucet() (which mints
// FAUCET_AMOUNT to msg.sender). Real tx on Coston2; mocked with the demo
// account or when no stable address is configured.
export async function mintTestUsd(args: MintArgs): Promise<DepositResult> {
  const {provider, stable, mode} = args;
  const amountUsdc = args.amountUsdc ?? 1000;
  if (mode !== "injected" || !provider || !stable) {
    return {ok: true, mocked: true, txHash: mockTxHash("mint", amountUsdc)};
  }
  try {
    await ensureCoston2(provider);
    const browser = new BrowserProvider(provider);
    const signer = await browser.getSigner();
    const address = await signer.getAddress();
    const usdc = new Contract(stable, FAUCET_ABI, signer);
    const tx = await usdc.faucet();
    const rec = await tx.wait();
    const hash = rec?.hash ?? tx.hash;
    return {ok: true, mocked: false, txHash: hash, explorer: explorerTx(hash), address};
  } catch (e) {
    return {ok: false, mocked: false, error: errMessage(e)};
  }
}

// Deposit `amountUsdc` into a deployed StableIndexVault: approve mUSDC on the
// stable, then vault.deposit(amount). Real tx on Coston2; mocked with the demo
// account or when no stable/vault address is available.
export async function depositOnChain(args: DepositArgs): Promise<DepositResult> {
  const {provider, stable, vault, amountUsdc, mode} = args;
  if (mode !== "injected" || !provider || !stable || !vault) {
    return {ok: true, mocked: true, txHash: mockTxHash(vault ?? "vault", amountUsdc)};
  }
  try {
    await ensureCoston2(provider);
    const browser = new BrowserProvider(provider);
    const signer = await browser.getSigner();
    const address = await signer.getAddress();
    const amount = parseUnits(String(amountUsdc), USDC_DECIMALS);
    const usdc = new Contract(stable, ERC20_ABI, signer);
    await (await usdc.approve(vault, amount)).wait();
    const v = new Contract(vault, VAULT_ABI, signer);
    const tx = await v.deposit(amount);
    const rec = await tx.wait();
    const hash = rec?.hash ?? tx.hash;
    return {ok: true, mocked: false, txHash: hash, explorer: explorerTx(hash), address};
  } catch (e) {
    return {ok: false, mocked: false, error: errMessage(e)};
  }
}

function errMessage(e: unknown): string {
  const code = (e as {code?: number}).code;
  if (code === 4001) return "Transaction rejected in wallet.";
  const shortMessage = (e as {shortMessage?: string}).shortMessage;
  return String(shortMessage ?? (e as Error)?.message ?? e);
}

// A deterministic pseudo-hash so the mocked UI can show a plausible link.
function mockTxHash(vault: string, amount: number): string {
  let h = 0;
  const s = `${vault}:${amount}:${Date.now()}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return "0x" + h.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}
