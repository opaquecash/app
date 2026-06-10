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
