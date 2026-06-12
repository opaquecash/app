/**
 * Chain-neutral wallet connection state. Neither chain is primary: the user can connect a
 * Solana wallet (Phantom/Solflare), an Ethereum wallet (injected via wagmi), or both. What is
 * connected drives which per-chain actions the app offers — see `useOpaqueSession.canActOn`.
 */

import { useCallback } from "react";
import { useAccount, useConnect, useDisconnect, useWalletClient } from "wagmi";
import { injected } from "wagmi/connectors";
import { SEPOLIA_CHAIN_ID } from "../opaque/config";
import { useWallet } from "./useWallet";

export type ChainKey = "ethereum" | "solana";

export function useConnectedWallets() {
  const sol = useWallet();
  const { address: ethAddress, isConnected: ethIsConnected } = useAccount();
  const { data: ethWalletClient } = useWalletClient();
  const { connectAsync, isPending: ethConnecting } = useConnect();
  const { disconnect: ethDisconnect } = useDisconnect();

  const solanaConnected = sol.isConnected && sol.publicKey != null;
  const ethereumConnected = ethIsConnected && ethAddress != null;

  const connectEthereum = useCallback(async () => {
    // Request Sepolia at connect time: the wallet prompts to switch if it's on another
    // network, so useWalletClient doesn't fail with a chain mismatch afterwards.
    await connectAsync({ connector: injected(), chainId: SEPOLIA_CHAIN_ID });
  }, [connectAsync]);

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
      disconnect: ethDisconnect,
    },
    connectedChains,
    anyConnected: connectedChains.length > 0,
  };
}
