/**
 * Starknet (Sepolia) wallet connect/disconnect, peer to `EthConnectButton` and `SolConnectButton`.
 * Connecting it lights up Starknet-side sends. Stealth keys still derive from the EVM/Solana
 * signature — this wallet only pays STRK and signs the transfer + announce multicall.
 */

import { useStarknetWallet } from "../context/StarknetWalletContext";

function shortStark(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function StarknetConnectButton() {
  const { connected, connecting, address, onSepolia, connect, disconnect, switchToSepolia } =
    useStarknetWallet();

  if (connected && address && !onSepolia) {
    return (
      <button
        type="button"
        onClick={() => void switchToSepolia()}
        title="Your Starknet wallet is on the wrong network — Opaque runs on Sepolia"
        className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:border-amber-400/60 hover:text-amber-100"
      >
        Switch to Sepolia
      </button>
    );
  }

  if (connected && address) {
    return (
      <button
        type="button"
        onClick={() => void disconnect()}
        title="Disconnect Starknet wallet"
        className="rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-sol-purple/30 hover:text-white"
      >
        STRK {shortStark(address)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void connect()}
      disabled={connecting}
      title="Connect a Starknet wallet (Argent, Braavos) for Starknet-side sends"
      className="rounded-lg border border-ink-600 bg-ink-900/60 px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-sol-purple/30 hover:text-white disabled:opacity-50"
    >
      {connecting ? "Connecting…" : "Connect STRK"}
    </button>
  );
}
