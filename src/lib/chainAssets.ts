/**
 * Native-asset metadata and amount helpers per chain. The app sends/sweeps native assets only
 * (lamports on Solana, wei on Ethereum Sepolia).
 */

/** Chains the app can send from in the UI (native send + sweep write flows). */
export type ChainKey = "ethereum" | "solana";

/**
 * Chains the app can scan and display balances for. Starknet is display/scan-only for now:
 * it appears in the unified inbox, but its send/sweep write flows (which need a Starknet
 * wallet) are not wired into the UI yet, so it is deliberately absent from {@link ChainKey}.
 */
export type DisplayChain = ChainKey | "starknet";

export type NativeAssetInfo = {
  symbol: string;
  decimals: number;
  label: string;
  /** Base units kept aside so the MAX button leaves room for fees. */
  feeBuffer: bigint;
};

export const NATIVE_ASSET: Record<DisplayChain, NativeAssetInfo> = {
  ethereum: {
    symbol: "ETH",
    decimals: 18,
    label: "Ethereum (Sepolia)",
    feeBuffer: 300_000_000_000_000n, // 0.0003 ETH
  },
  solana: {
    symbol: "SOL",
    decimals: 9,
    label: "Solana",
    feeBuffer: 10_000n, // lamports
  },
  starknet: {
    symbol: "STRK",
    decimals: 18,
    label: "Starknet (Sepolia)",
    feeBuffer: 1_500_000_000_000_000_000n, // ~1.5 STRK: a stealth sweep self-funds deploy_account
  },
};

/** Parse a decimal string into base units (lamports / wei / fri). Throws on invalid input. */
export function parseNativeAmount(value: string, chain: DisplayChain): bigint {
  const { decimals } = NATIVE_ASSET[chain];
  const trimmed = value.trim();
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error("Invalid amount");
  }
  const [whole = "0", frac = ""] = trimmed.split(".");
  if (frac.length > decimals) throw new Error("Too many decimal places");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Format base units as a trimmed decimal string (e.g. `1.5`, `0.001`). */
export function formatNativeAmount(raw: bigint, chain: DisplayChain): string {
  const { decimals } = NATIVE_ASSET[chain];
  const unit = 10n ** BigInt(decimals);
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs / unit;
  const frac = (abs % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  const out = frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
  return negative ? `-${out}` : out;
}
