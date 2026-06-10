/**
 * Chain selection for PSR actions (schemas, attestations, proof submission). Defaults to the
 * session's derivation-source chain when its wallet can sign, else the first chain with a
 * connected wallet, and snaps back to a usable chain when wallets disconnect.
 */

import { useMemo, useState } from "react";
import { useOpaqueSession } from "../opaque/useOpaqueSession";
import type { ToggleChain } from "../components/ChainToggle";

export function usePsrChain() {
  const { canActOn, derivationSource } = useOpaqueSession();

  const usableChains = useMemo(
    () => (["ethereum", "solana"] as const).filter((c) => canActOn(c)),
    [canActOn],
  );

  // The user's explicit pick wins while its wallet is connected; otherwise fall back to the
  // derivation-source chain, then the first chain with a connected wallet.
  const [chosen, setChosen] = useState<ToggleChain | null>(null);
  const fallback =
    derivationSource && canActOn(derivationSource)
      ? derivationSource
      : usableChains[0] ?? "solana";
  const chain = chosen && usableChains.includes(chosen) ? chosen : fallback;

  return {
    chain,
    setChain: setChosen as (chain: ToggleChain) => void,
    ethConnected: canActOn("ethereum"),
    solConnected: canActOn("solana"),
  };
}
