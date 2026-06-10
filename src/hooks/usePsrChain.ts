/**
 * Chain selection for PSR actions (schemas, attestations, proof submission). Defaults to the
 * session's derivation-source chain when its wallet can sign, else the first chain with a
 * connected wallet, and snaps back to a usable chain when wallets disconnect.
 */

import { useEffect, useMemo, useState } from "react";
import { useOpaqueSession } from "../opaque/useOpaqueSession";
import type { ToggleChain } from "../components/ChainToggle";

export function usePsrChain() {
  const { canActOn, derivationSource } = useOpaqueSession();

  const usableChains = useMemo(
    () => (["ethereum", "solana"] as const).filter((c) => canActOn(c)),
    [canActOn],
  );

  const [chain, setChain] = useState<ToggleChain>(() =>
    derivationSource && canActOn(derivationSource) ? derivationSource : usableChains[0] ?? "solana",
  );

  useEffect(() => {
    if (!usableChains.includes(chain) && usableChains.length > 0) setChain(usableChains[0]);
  }, [usableChains, chain]);

  return {
    chain,
    setChain,
    ethConnected: canActOn("ethereum"),
    solConnected: canActOn("solana"),
  };
}
