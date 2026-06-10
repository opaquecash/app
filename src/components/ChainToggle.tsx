/**
 * Segmented control for choosing which chain an action targets. A chain is enabled only while
 * its wallet is connected; the same OpaqueClient method runs on either chain.
 */

export type ToggleChain = "ethereum" | "solana";

export function ChainToggle({
  value,
  onChange,
  ethConnected,
  solConnected,
}: {
  value: ToggleChain;
  onChange: (chain: ToggleChain) => void;
  ethConnected: boolean;
  solConnected: boolean;
}) {
  const chains: { id: ToggleChain; label: string; disabled: boolean }[] = [
    { id: "ethereum", label: "Ethereum", disabled: !ethConnected },
    { id: "solana", label: "Solana", disabled: !solConnected },
  ];
  return (
    <div className="inline-flex rounded-lg border border-ink-700 bg-ink-900 p-0.5 text-xs">
      {chains.map((c) => (
        <button
          key={c.id}
          type="button"
          disabled={c.disabled}
          onClick={() => onChange(c.id)}
          title={c.disabled ? `Connect ${c.label === "Ethereum" ? "an Ethereum" : "a Solana"} wallet to use this chain` : undefined}
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
