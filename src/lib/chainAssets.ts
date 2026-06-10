/**
 * Native-asset metadata and amount helpers per chain. The app sends/sweeps native assets only
 * (lamports on Solana, wei on Ethereum Sepolia).
 */

export type ChainKey = "ethereum" | "solana";

export type NativeAssetInfo = {
  symbol: string;
  decimals: number;
  label: string;
  /** Base units kept aside so the MAX button leaves room for fees. */
  feeBuffer: bigint;
};

export const NATIVE_ASSET: Record<ChainKey, NativeAssetInfo> = {
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
};

/** Parse a decimal string into base units (lamports / wei). Throws on invalid input. */
export function parseNativeAmount(value: string, chain: ChainKey): bigint {
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
export function formatNativeAmount(raw: bigint, chain: ChainKey): string {
  const { decimals } = NATIVE_ASSET[chain];
  const unit = 10n ** BigInt(decimals);
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs / unit;
  const frac = (abs % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  const out = frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
  return negative ? `-${out}` : out;
}
