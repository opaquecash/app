/**
 * Solana wallet connect/disconnect, peer to `EthConnectButton`. Connecting it lights up the
 * Solana-side actions — register, send, scan, sweep, and PSR on the configured cluster.
 */

import { useWallet } from "../hooks/useWallet";

function shortSol(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function SolConnectButton() {
  const { isConnected, address, isConnecting, connect, disconnect } = useWallet();

  if (isConnected && address) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        title="Disconnect Solana wallet"
        className="rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-sol-purple/30 hover:text-white"
      >
        SOL {shortSol(address)}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void connect().catch((e) => console.error("[SolConnectButton] connect failed:", e))}
      disabled={isConnecting}
      title="Connect a Solana wallet for Solana-side actions"
      className="rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-sol-purple/30 hover:text-white disabled:opacity-50"
    >
      {isConnecting ? "Connecting…" : "Connect SOL"}
    </button>
  );
}
