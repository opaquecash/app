/**
 * Ethereum (Sepolia) wallet connect/disconnect, peer to `SolConnectButton`. Connecting it lights
 * up the Ethereum-side actions — register, send, scan, sweep, PSR, and UAB relay. With multiple
 * injected wallets installed (MetaMask + Phantom's EVM side), opens a picker instead of letting
 * the generic injected connector grab an arbitrary one.
 */

import { useState } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { SEPOLIA_CHAIN_ID } from "../opaque/config";
import { useConnectedWallets } from "../hooks/useConnectedWallets";
import { EvmWalletPicker } from "./EvmWalletPicker";

function shortEth(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function EthConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { ethereum } = useConnectedWallets();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (isConnected && address && chainId !== SEPOLIA_CHAIN_ID) {
    return (
      <button
        type="button"
        onClick={() => switchChain({ chainId: SEPOLIA_CHAIN_ID })}
        disabled={isSwitching}
        title="Your Ethereum wallet is on the wrong network — Opaque runs on Sepolia"
        className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:border-amber-400/60 hover:text-amber-100 disabled:opacity-50"
      >
        {isSwitching ? "Switching…" : "Switch to Sepolia"}
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        title="Disconnect Ethereum wallet"
        className="rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-sol-purple/30 hover:text-white"
      >
        ETH {shortEth(address)}
      </button>
    );
  }

  const handleConnect = () => {
    if (ethereum.connectors.length > 1) {
      setPickerOpen(true);
      return;
    }
    void ethereum.connect();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleConnect}
        disabled={ethereum.connecting}
        title="Connect an Ethereum wallet for Ethereum-side actions"
        className="rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-sol-purple/30 hover:text-white disabled:opacity-50"
      >
        {ethereum.connecting ? "Connecting…" : "Connect ETH"}
      </button>
      <EvmWalletPicker
        open={pickerOpen}
        connectors={ethereum.connectors}
        busy={ethereum.connecting}
        onSelect={(c) => {
          setPickerOpen(false);
          void ethereum.connect(c);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}
