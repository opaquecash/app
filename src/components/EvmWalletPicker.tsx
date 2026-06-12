/**
 * Picker for which injected EVM wallet to connect (EIP-6963 discovered connectors). With more
 * than one wallet extension installed (e.g. MetaMask + Phantom, which also injects an Ethereum
 * provider), the generic injected connector grabs an arbitrary one — this modal makes the
 * choice explicit.
 */

import type { Connector } from "wagmi";
import { ModalShell } from "./ModalShell";

type EvmWalletPickerProps = {
  open: boolean;
  connectors: readonly Connector[];
  busy?: boolean;
  onSelect: (connector: Connector) => void;
  onClose: () => void;
};

export function EvmWalletPicker({ open, connectors, busy, onSelect, onClose }: EvmWalletPickerProps) {
  return (
    <ModalShell
      open={open}
      title="Choose an Ethereum wallet"
      description="More than one Ethereum wallet extension is installed. Pick the one to connect."
      onClose={onClose}
      closeOnBackdrop={!busy}
      maxWidthClassName="max-w-sm"
    >
      <div className="space-y-2 px-6 py-5">
        {connectors.map((c) => (
          <button
            key={c.uid}
            type="button"
            onClick={() => onSelect(c)}
            disabled={busy}
            className="flex w-full items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:border-sol-purple/40 hover:bg-ink-800 disabled:opacity-50"
          >
            {c.icon ? (
              <img src={c.icon} alt="" className="h-6 w-6 rounded-md" />
            ) : (
              <span className="h-6 w-6 rounded-md bg-ink-700" aria-hidden />
            )}
            {c.name}
          </button>
        ))}
      </div>
    </ModalShell>
  );
}
