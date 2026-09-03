import {BrowserProvider, Contract, parseUnits} from "ethers";

// The deposit seam: the real deal, just mocked. With no injected wallet it
// returns a simulated result (no chain, no funds). With an injected wallet it
// approves mUSDC and calls vault.deposit(amount) on Coston2. Same call shape as
// scripts/orchestrate-rebalance.mjs, so it is a true EVM path, only mocked by
// default.
export interface DepositArgs {
  vault: string;
  amountUsdc: number;
  mode: "mock" | "injected";
}

export interface DepositResult {
  ok: boolean;
  mocked: boolean;
  txHash?: string;
  error?: string;
}

const COSTON2_CHAIN_ID = 114;
const USDC_DECIMALS = 6;

// Minimal ABIs for the deposit + mint path.
const ERC20_ABI = ["function approve(address spender,uint256 amount) returns (bool)"];
const VAULT_ABI = ["function deposit(uint256 amount)"];
const USDC_MINT_ABI = ["function mint(address to,uint256 amount)"];

// Read from a global config the app can inject at runtime; falls back to null
// so the mock path is used when addresses are not configured.
function stableAddress(): string | null {
  return (window as any).__INDEX_COMPETITION_STABLE__ ?? null;
}

export async function depositOnChain(args: DepositArgs): Promise<DepositResult> {
  const {vault, amountUsdc, mode} = args;
  const injected = typeof window !== "undefined" && (window as any).ethereum;
  const stable = stableAddress();

  if (mode !== "injected" || !injected || !stable) {
    // Mocked: simulate a successful deposit without touching a chain.
    return {ok: true, mocked: true, txHash: mockTxHash(vault, amountUsdc)};
  }

  try {
    const provider = new BrowserProvider(injected);
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== COSTON2_CHAIN_ID) {
      return {ok: false, mocked: false, error: "Wrong network: connect to Coston2 (chain 114)."};
    }
    const signer = await provider.getSigner();
    const amount = parseUnits(String(amountUsdc), USDC_DECIMALS);
    const usdc = new Contract(stable, ERC20_ABI, signer);
    await (await usdc.approve(vault, amount)).wait();
    const v = new Contract(vault, VAULT_ABI, signer);
    const tx = await v.deposit(amount);
    const rec = await tx.wait();
    return {ok: true, mocked: false, txHash: rec?.hash ?? tx.hash};
  } catch (e) {
    return {ok: false, mocked: false, error: String((e as Error).message ?? e)};
  }
}

// Mint test USD 1:1 through the same seam. With a wallet + configured stable
// address it calls MockUSDC.mint(to, amount) on Coston2; otherwise it mocks a
// successful mint so the UI flow works with no chain.
export async function mintTestUsd(amountUsdc = 1000): Promise<DepositResult> {
  const injected = typeof window !== "undefined" && (window as any).ethereum;
  const stable = stableAddress();
  if (!injected || !stable) {
    return {ok: true, mocked: true, txHash: mockTxHash("mint", amountUsdc)};
  }
  try {
    const provider = new BrowserProvider(injected);
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== COSTON2_CHAIN_ID) {
      return {ok: false, mocked: false, error: "Wrong network: connect to Coston2 (chain 114)."};
    }
    const signer = await provider.getSigner();
    const to = await signer.getAddress();
    const amount = parseUnits(String(amountUsdc), USDC_DECIMALS);
    const usdc = new Contract(stable, USDC_MINT_ABI, signer);
    const tx = await usdc.mint(to, amount);
    const rec = await tx.wait();
    return {ok: true, mocked: false, txHash: rec?.hash ?? tx.hash};
  } catch (e) {
    return {ok: false, mocked: false, error: String((e as Error).message ?? e)};
  }
}

// A deterministic pseudo-hash so the mocked UI can show a plausible link.
function mockTxHash(vault: string, amount: number): string {
  let h = 0;
  const s = `${vault}:${amount}:${Date.now()}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return "0x" + h.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}
