/**
 * Chain-neutral wallet connection state. Neither chain is primary: the user can connect a
 * Solana wallet (Phantom/Solflare), an Ethereum wallet (injected via wagmi), or both. What is
 * connected drives which per-chain actions the app offers — see `useOpaqueSession.canActOn`.
 */

import { useCallback, useMemo } from "react";
import { useAccount, useConnect, useDisconnect, useWalletClient, type Connector } from "wagmi";
import { injected } from "wagmi/connectors";
import { SEPOLIA_CHAIN_ID } from "../opaque/config";
import { useWallet } from "./useWallet";

export type ChainKey = "ethereum" | "solana";

export function useConnectedWallets() {
  const sol = useWallet();
  const { address: ethAddress, isConnected: ethIsConnected } = useAccount();
  const { data: ethWalletClient } = useWalletClient();
  const { connectors, connectAsync, isPending: ethConnecting } = useConnect();
  const { disconnect: ethDisconnect } = useDisconnect();

  const solanaConnected = sol.isConnected && sol.publicKey != null;
  const ethereumConnected = ethIsConnected && ethAddress != null;

  // EVM wallets discovered via EIP-6963 (MetaMask, Phantom's EVM side, Rabby, …). The generic
  // `injected()` connector grabs whichever provider claims window.ethereum — with both Phantom
  // and MetaMask installed that's often Phantom — so the user must get to pick by name.
  const ethereumConnectors = useMemo(() => {
    const discovered = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
    return discovered.length > 0 ? discovered : connectors.filter((c) => c.id === "injected");
  }, [connectors]);

  const connectEthereum = useCallback(
    async (connector?: Connector) => {
      // Request Sepolia at connect time: the wallet prompts to switch if it's on another
      // network, so useWalletClient doesn't fail with a chain mismatch afterwards.
      await connectAsync({
        connector: connector ?? ethereumConnectors[0] ?? injected(),
        chainId: SEPOLIA_CHAIN_ID,
      });
    },
    [connectAsync, ethereumConnectors],
  );

  const connectedChains: ChainKey[] = [
    ...(solanaConnected ? (["solana"] as const) : []),
    ...(ethereumConnected ? (["ethereum"] as const) : []),
  ];

  return {
    solana: {
      connected: solanaConnected,
      address: sol.address,
      publicKey: sol.publicKey,
      connecting: sol.isConnecting,
      connect: sol.connect,
      disconnect: sol.disconnect,
      wallets: sol.wallets,
    },
    ethereum: {
      connected: ethereumConnected,
      address: ethAddress ?? null,
      walletClient: ethWalletClient ?? null,
      connecting: ethConnecting,
      connect: connectEthereum,
      connectors: ethereumConnectors,
      disconnect: ethDisconnect,
    },
    connectedChains,
    anyConnected: connectedChains.length > 0,
  };
}
