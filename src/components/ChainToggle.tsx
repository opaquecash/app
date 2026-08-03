/**
 * Segmented control for choosing which chain an action targets. A chain is enabled only while
 * its wallet is connected; the same OpaqueClient method runs on any of them. The Starknet
 * segment is opt-in per surface (`starknetConnected` prop): proof submission supports it, while
 * schema/attestation issuance stays EVM/Solana-only (no PSR issuance contracts on Starknet).
 */

export type ToggleChain = "ethereum" | "solana" | "starknet";

const CONNECT_HINT: Record<ToggleChain, string> = {
  ethereum: "Connect an Ethereum wallet to use this chain",
  solana: "Connect a Solana wallet to use this chain",
  starknet: "Connect a Starknet wallet to use this chain",
};

export function ChainToggle({
  value,
  onChange,
  ethConnected,
  solConnected,
  starknetConnected,
}: {
  value: ToggleChain;
  onChange: (chain: ToggleChain) => void;
  ethConnected: boolean;
  solConnected: boolean;
  /** Omit to hide the Starknet segment entirely (surfaces without Starknet support). */
  starknetConnected?: boolean;
}) {
  const chains: { id: ToggleChain; label: string; disabled: boolean }[] = [
    { id: "ethereum", label: "Ethereum", disabled: !ethConnected },
    { id: "solana", label: "Solana", disabled: !solConnected },
    ...(starknetConnected !== undefined
      ? [{ id: "starknet" as const, label: "Starknet", disabled: !starknetConnected }]
      : []),
  ];
  return (
    <div className="inline-flex rounded-lg border border-ink-700 bg-ink-900 p-0.5 text-xs">
      {chains.map((c) => (
        <button
          key={c.id}
          type="button"
          disabled={c.disabled}
          onClick={() => onChange(c.id)}
          title={c.disabled ? CONNECT_HINT[c.id] : undefined}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            value === c.id
              ? "bg-sol-purple text-white"
              : c.disabled
                ? "text-ink-600 cursor-not-allowed"
                : "text-mist hover:text-white"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
