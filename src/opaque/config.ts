/**
 * Configuration for the `@opaquecash/opaque` SDK session. Chain-neutral: Ethereum (Sepolia) and
 * Solana (cluster + RPC from `lib/chain`) are peers — register, send, scan, sweep, PSR, and UAB
 * relay all work on whichever chain's wallet is connected.
 */

import { getCluster, getRpcUrl } from "../lib/chain";

/** Sepolia chain id (the only EVM chain Opaque is deployed to today). */
export const SEPOLIA_CHAIN_ID = 11155111;

/** Sepolia JSON-RPC for EVM reads/writes. Override with `VITE_SEPOLIA_RPC_URL`. */
export const SEPOLIA_RPC_URL =
  (import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined)?.trim() ||
  "https://ethereum-sepolia.publicnode.com";

/** Solana cluster + RPC, resolved from the existing `lib/chain` env conventions. */
export const SOLANA_CLUSTER = getCluster();
export const SOLANA_RPC_URL = getRpcUrl();

/** Starknet Sepolia JSON-RPC (0.10.x) for the stealth sweep broadcast. Override with
 * `VITE_STARKNET_RPC_URL`. */
export const STARKNET_RPC_URL =
  (import.meta.env.VITE_STARKNET_RPC_URL as string | undefined)?.trim() ||
  "https://api.zan.top/public/starknet-sepolia/rpc/v0_10";

/**
 * Same-origin V2 Groth16 verification key, used to Garaga-encode Starknet proof
 * submissions. Must stay the exact key the on-chain verifier class was generated
 * from — served next to the wasm/zkey the prover already loads.
 */
export const PSR_VKEY_URL = "/circuits/v2/verification_key.json";

/** Scope tag for the cached SETUP_MESSAGE signature when keys derive from an Ethereum wallet. */
export const ETHEREUM_SESSION_SCOPE = `ethereum:${SEPOLIA_CHAIN_ID}`;

/** Dynamic-import URL for the wasm-pack `cryptography.js`. Override with `VITE_WASM_URL`. */
export const WASM_MODULE_SPECIFIER =
  (import.meta.env.VITE_WASM_URL as string | undefined)?.trim() ||
  new URL("/pkg/cryptography.js", import.meta.url).href;

/**
 * Placeholder EVM address used when no Ethereum wallet is connected. Stealth keys derive from a
 * wallet signature, not from this address, so read paths (scan, balances, sweep) work with the
 * placeholder; Ethereum writes require a real connected address (the session rebuilds the client
 * when one connects).
 */
export const PLACEHOLDER_EVM_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

/**
 * Optional EVM scan lookback (blocks). When `VITE_EVM_SCAN_WINDOW` is set, inbox
 * scans pass `fromBlock = latest - window` instead of scanning from genesis: faster
 * on live Sepolia and required for deterministic E2E runs against a local fork
 * (full-range getLogs proxies to the upstream RPC and rate-limits).
 */
export const EVM_SCAN_WINDOW = (() => {
  const raw = (import.meta.env.VITE_EVM_SCAN_WINDOW as string | undefined)?.trim();
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? BigInt(Math.floor(n)) : null;
})();

/** Resolve the scan lower bound for the configured window (undefined = adapter default). */
export async function evmScanFromBlock(): Promise<bigint | undefined> {
  if (!EVM_SCAN_WINDOW) return undefined;
  try {
    const res = await fetch(SEPOLIA_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    });
    const head = BigInt(((await res.json()) as { result: string }).result);
    return head > EVM_SCAN_WINDOW ? head - EVM_SCAN_WINDOW : 0n;
  } catch {
    return undefined;
  }
}
