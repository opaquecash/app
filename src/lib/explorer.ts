/**
 * Explorer URLs per chain: Solana Explorer (by cluster) and Etherscan (Sepolia).
 * Chain defaults to Solana for legacy call sites that predate the cross-chain UI.
 */

import { getCluster, type SolanaCluster } from "./chain";

export type ExplorerChain = "ethereum" | "solana" | "starknet";

const SEPOLIA_ETHERSCAN_BASE = "https://sepolia.etherscan.io";
const STARKNET_VOYAGER_BASE = "https://sepolia.voyager.online";

function getSolanaExplorerBase(): string {
  return "https://explorer.solana.com";
}

function clusterParam(cluster: SolanaCluster): string {
  if (cluster === "mainnet-beta") return "";
  if (cluster === "localnet") return "?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899";
  return `?cluster=${cluster}`;
}

export function getExplorerTxUrl(
  txSignature: string | null,
  chain: ExplorerChain = "solana",
): string | null {
  if (!txSignature) return null;
  if (chain === "ethereum") return `${SEPOLIA_ETHERSCAN_BASE}/tx/${txSignature}`;
  if (chain === "starknet") return `${STARKNET_VOYAGER_BASE}/tx/${txSignature}`;
  const cluster = getCluster();
  return `${getSolanaExplorerBase()}/tx/${txSignature}${clusterParam(cluster)}`;
}

export function getExplorerAddressUrl(
  address: string | null,
  chain: ExplorerChain = "solana",
): string | null {
  if (!address) return null;
  if (chain === "ethereum") return `${SEPOLIA_ETHERSCAN_BASE}/address/${address}`;
  if (chain === "starknet") return `${STARKNET_VOYAGER_BASE}/contract/${address}`;
  const cluster = getCluster();
  return `${getSolanaExplorerBase()}/address/${address}${clusterParam(cluster)}`;
}
