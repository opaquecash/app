/**
 * Checks whether the session's stealth meta-address is registered on each CONNECTED chain, via
 * the active `OpaqueClient`. Chains without a connected wallet are not checked (the SDK reads the
 * connected wallet's registry entry). Re-runs when the client (including signer rebuilds) or the
 * set of connected chains changes.
 */

import { useCallback, useEffect, useState } from "react";
import { useOpaqueStore } from "../opaque/store";
import type { OpaqueChain } from "../opaque/useOpaqueSession";

export type RegistrationByChain = Partial<Record<OpaqueChain, boolean>>;

export type RegistrationStatus = {
  /** Registration result per connected chain; absent key = chain not connected/checked. */
  byChain: RegistrationByChain;
  /** Every connected chain is registered (false when no chain is connected). */
  allRegistered: boolean;
  /** At least one connected chain is registered. */
  anyRegistered: boolean;
  isLoading: boolean;
  refresh: () => void;
};

export function useRegistrationStatus(connectedChains: OpaqueChain[]): RegistrationStatus {
  const client = useOpaqueStore((s) => s.client);
  const [byChain, setByChain] = useState<RegistrationByChain>({});
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const chainsKey = connectedChains.join(",");

  useEffect(() => {
    const chains = chainsKey === "" ? [] : (chainsKey.split(",") as OpaqueChain[]);
    if (!client || chains.length === 0) {
      setByChain({});
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      const entries = await Promise.all(
        chains.map(async (chain) => {
          try {
            return [chain, await client.isMetaAddressRegistered(chain)] as const;
          } catch {
            return [chain, false] as const;
          }
        }),
      );
      if (!cancelled) {
        setByChain(Object.fromEntries(entries) as RegistrationByChain);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, chainsKey, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const chains = chainsKey === "" ? [] : (chainsKey.split(",") as OpaqueChain[]);
  const allRegistered = chains.length > 0 && chains.every((c) => byChain[c] === true);
  const anyRegistered = chains.some((c) => byChain[c] === true);

  return { byChain, allRegistered, anyRegistered, isLoading, refresh };
}
