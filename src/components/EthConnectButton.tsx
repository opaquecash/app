/**
 * Ethereum (Sepolia) wallet connect/disconnect, peer to `SolConnectButton`. Connecting it lights
 * up the Ethereum-side actions — register, send, scan, sweep, PSR, and UAB relay. Uses wagmi's
 * injected connector.
 */

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";

function shortEth(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function EthConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

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
  return (
    <button
      type="button"
      onClick={() => connect({ connector: injected() })}
      disabled={isPending}
      title="Connect an Ethereum wallet for Ethereum-side actions"
      className="rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-sol-purple/30 hover:text-white disabled:opacity-50"
    >
      {isPending ? "Connecting…" : "Connect ETH"}
    </button>
  );
}
