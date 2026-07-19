/**
 * Starknet wallet connection (Argent / Braavos, via get-starknet's built-in picker).
 *
 * Unlike Ethereum and Solana, a Starknet wallet is NOT a source the Opaque identity derives
 * from — stealth keys still come from the connected EVM/Solana signature. The Starknet wallet
 * is purely a spending account: it pays STRK and signs the stealth transfer + announce multicall
 * when sending on Starknet (the counterfactual-account sweep path needs no wallet at all).
 *
 * We wrap get-starknet's injected StarknetWindowObject in a starknet.js `WalletAccount`, which is
 * what exposes `.execute(calls)`. The account reads through our own Sepolia RPC and signs through
 * the wallet.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RpcProvider, WalletAccount, constants } from "starknet";
import { connect as starknetConnect, disconnect as starknetDisconnect } from "get-starknet";
import { STARKNET_RPC_URL } from "../opaque/config";

/** Starknet Sepolia chain id (`SN_SEPOLIA`). Opaque is only deployed to Sepolia today. */
export const STARKNET_SEPOLIA_CHAIN_ID = constants.StarknetChainId.SN_SEPOLIA;

/** The subset of get-starknet's window object we depend on (kept loose for version drift). */
interface StarknetWindowObjectLike {
  id?: string;
  name?: string;
  icon?: string;
  chainId?: string;
  selectedAddress?: string;
  request?: (call: { type: string; params?: unknown }) => Promise<unknown>;
  on?: (event: string, handler: (payload: unknown) => void) => void;
  off?: (event: string, handler: (payload: unknown) => void) => void;
}

interface StarknetWalletState {
  connected: boolean;
  connecting: boolean;
  address: string | null;
  chainId: string | null;
  walletName: string | null;
  /** True only when connected AND on Starknet Sepolia. */
  onSepolia: boolean;
  walletAccount: WalletAccount | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Ask the connected wallet to switch to Starknet Sepolia. */
  switchToSepolia: () => Promise<void>;
  error: string | null;
}

const StarknetWalletContext = createContext<StarknetWalletState | null>(null);

/** Normalise a chain id from either the SWO field or a wallet_requestChainId reply. */
function normalizeChainId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

export function StarknetWalletProvider({ children }: { children: ReactNode }) {
  const [connecting, setConnecting] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [walletAccount, setWalletAccount] = useState<WalletAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const swoRef = useRef<StarknetWindowObjectLike | null>(null);

  // One provider for the session; the WalletAccount reads through it.
  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC_URL }), []);

  const clear = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setWalletName(null);
    setWalletAccount(null);
  }, []);

  const attach = useCallback(async (swo: StarknetWindowObjectLike) => {
    const wa = await WalletAccount.connect(
      provider,
      // get-starknet's SWO satisfies the injected-wallet shape WalletAccount expects; the
      // published types differ across versions, so bridge them explicitly.
      swo as never,
    );
    swoRef.current = swo;

    // Prefer the wallet's live chain id, falling back to the SWO field.
    let cid = normalizeChainId(swo.chainId);
    try {
      const reported = await swo.request?.({ type: "wallet_requestChainId" });
      cid = normalizeChainId(reported) ?? cid;
    } catch {
      /* wallet may not support the request; the SWO field is enough */
    }

    setWalletAccount(wa);
    setAddress(wa.address ?? swo.selectedAddress ?? null);
    setChainId(cid);
    setWalletName(swo.name ?? swo.id ?? "Starknet wallet");

    // React to account / network changes without forcing a reconnect.
    const onAccounts = (payload: unknown) => {
      const next = Array.isArray(payload) ? (payload[0] as string | undefined) : undefined;
      if (next) setAddress(next);
      else clear();
    };
    const onNetwork = (payload: unknown) => setChainId(normalizeChainId(payload));
    swo.on?.("accountsChanged", onAccounts);
    swo.on?.("networkChanged", onNetwork);
  }, [clear, provider]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const swo = (await starknetConnect({
        modalMode: "alwaysAsk",
      })) as unknown as StarknetWindowObjectLike | null;
      if (!swo) return; // user dismissed the picker
      await attach(swo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect Starknet wallet.");
      clear();
    } finally {
      setConnecting(false);
    }
  }, [attach, clear]);

  const disconnect = useCallback(async () => {
    try {
      await starknetDisconnect({ clearLastWallet: true });
    } catch {
      /* best-effort */
    }
    swoRef.current = null;
    clear();
  }, [clear]);

  const switchToSepolia = useCallback(async () => {
    const swo = swoRef.current;
    if (!swo?.request) return;
    try {
      await swo.request({
        type: "wallet_switchStarknetChain",
        params: { chainId: STARKNET_SEPOLIA_CHAIN_ID },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to switch network.");
    }
  }, []);

  // Silently reconnect the previously authorised wallet on mount (no picker).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const swo = (await starknetConnect({
          modalMode: "neverAsk",
        })) as unknown as StarknetWindowObjectLike | null;
        if (!cancelled && swo) await attach(swo);
      } catch {
        /* nothing previously authorised */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attach]);

  const connected = walletAccount != null && address != null;
  const onSepolia = connected && chainId === STARKNET_SEPOLIA_CHAIN_ID;

  return (
    <StarknetWalletContext.Provider
      value={{
        connected,
        connecting,
        address,
        chainId,
        walletName,
        onSepolia,
        walletAccount,
        connect,
        disconnect,
        switchToSepolia,
        error,
      }}
    >
      {children}
    </StarknetWalletContext.Provider>
  );
}

/** Access the Starknet wallet connection. Returns an inert state when no provider is mounted. */
export function useStarknetWallet(): StarknetWalletState {
  const ctx = useContext(StarknetWalletContext);
  if (!ctx) {
    return {
      connected: false,
      connecting: false,
      address: null,
      chainId: null,
      walletName: null,
      onSepolia: false,
      walletAccount: null,
      connect: async () => {},
      disconnect: async () => {},
      switchToSepolia: async () => {},
      error: null,
    };
  }
  return ctx;
}
