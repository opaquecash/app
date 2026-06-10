/**
 * Session store for the `@opaquecash/opaque` SDK. Holds the single `OpaqueClient` instance and
 * the derived meta-address. Replaces `KeysContext`'s in-memory master-key storage — the client
 * owns the viewing/spending keys internally; components read `client.getMetaAddressHex()` (mirrored
 * here as `metaAddress`) instead of raw keys.
 *
 * Also tracks which wallet derived the stealth keys (`derivationSource`) and keeps the raw
 * SETUP_MESSAGE signature in memory so the client can be rebuilt with fresh signers when a wallet
 * connects or disconnects, without prompting for a new signature.
 */

import { create } from "zustand";
import type { OpaqueClient } from "@opaquecash/opaque";
import type { Hex } from "viem";

export type DerivationSource = "ethereum" | "solana";

interface OpaqueSessionState {
  client: OpaqueClient | null;
  metaAddress: Hex | null;
  /** Transient status text for the connect flow (signing, deriving, …). */
  status: string | null;
  /** Which connected wallet signed SETUP_MESSAGE to derive the stealth keys. */
  derivationSource: DerivationSource | null;
  /** In-memory copy of the SETUP_MESSAGE signature, used to rebuild the client on signer changes. */
  walletSignature: Hex | null;
  /** Snapshot of the signers the current client was built with (rebuild trigger). */
  signerFingerprint: string | null;
  /** True once the user confirmed their derived meta-address and entered the app. */
  entered: boolean;
  setSession: (params: {
    client: OpaqueClient;
    metaAddress: Hex;
    derivationSource: DerivationSource;
    walletSignature: Hex;
    signerFingerprint: string;
  }) => void;
  /** Swap in a rebuilt client (same keys, new signers) without touching the rest of the session. */
  replaceClient: (client: OpaqueClient, signerFingerprint: string) => void;
  setEntered: (entered: boolean) => void;
  clearSession: () => void;
  setStatus: (status: string | null) => void;
}

export const useOpaqueStore = create<OpaqueSessionState>((set) => ({
  client: null,
  metaAddress: null,
  status: null,
  derivationSource: null,
  walletSignature: null,
  signerFingerprint: null,
  entered: false,
  setSession: ({ client, metaAddress, derivationSource, walletSignature, signerFingerprint }) =>
    set({ client, metaAddress, derivationSource, walletSignature, signerFingerprint, status: null }),
  replaceClient: (client, signerFingerprint) => set({ client, signerFingerprint }),
  setEntered: (entered) => set({ entered }),
  clearSession: () =>
    set({
      client: null,
      metaAddress: null,
      status: null,
      derivationSource: null,
      walletSignature: null,
      signerFingerprint: null,
      entered: false,
    }),
  setStatus: (status) => set({ status }),
}));
