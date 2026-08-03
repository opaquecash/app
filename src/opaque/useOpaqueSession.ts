/**
 * The single bridge between the wallet layer and the protocol. Builds one `OpaqueClient` from a
 * wallet signature over the canonical `SETUP_MESSAGE` (HKDF entropy for the stealth keys) and
 * stores it. All protocol behaviour comes from `@opaquecash/opaque`.
 *
 * Chain-neutral: the user derives keys from whichever wallet they choose — Ethereum
 * (`personal_sign` via wagmi) or Solana (`signMessage` via the wallet adapter). The two
 * signatures produce DIFFERENT keys (different HKDF inputs), so the derivation source is an
 * explicit identity choice, never silently switched. Every connected wallet's signer is threaded
 * into the client — including the Starknet spending account, which is never a derivation source —
 * and writes on a chain require that chain's wallet (`canActOn`). The 30-minute encrypted
 * signature cache (`lib/signatureSession`) avoids re-signing.
 */

import { useCallback, useEffect, useRef } from "react";
import { useConnection, useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import {
  OpaqueClient,
  SETUP_MESSAGE,
  requestSetupSignature,
  type EvmUnifiedSigner,
  type SolanaUnifiedSigner,
  type StarknetAccountLike,
  type UnifiedSigner,
} from "@opaquecash/opaque";
import type { Connection } from "@solana/web3.js";
import type { PublicKey, Transaction } from "@solana/web3.js";
import type { WalletAccount } from "starknet";
import type { Address, Hex } from "viem";
import { useStarknetWallet } from "../context/StarknetWalletContext";
import { wagmiConfig } from "./wagmi";
import { useOpaqueStore, type DerivationSource } from "./store";
import { useTxHistoryStore } from "../store/txHistoryStore";
import { useWatchlistStore } from "../hooks/useWatchlist";
import { useGhostAddressStore, GHOST_ADDRESSES_STORAGE_KEY } from "../store/ghostAddressStore";
import {
  clearSignatureSession,
  getRememberSignaturePreference,
  loadSignatureSession,
  saveSignatureSession,
} from "../lib/signatureSession";
import {
  ETHEREUM_SESSION_SCOPE,
  PSR_VKEY_URL,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_RPC_URL,
  SOLANA_CLUSTER,
  SOLANA_RPC_URL,
  WASM_MODULE_SPECIFIER,
} from "./config";

export type OpaqueChain = "ethereum" | "solana" | "starknet";

type Signers = {
  connection: Connection;
  ethereumAddress: Address | undefined;
  walletClient: unknown;
  publicKey: PublicKey | null;
  signTransaction: ((tx: Transaction) => Promise<Transaction>) | undefined;
  starknetAccount: WalletAccount | null;
};

/** Identifies which signers a client was built with, so wallet changes trigger a rebuild. */
function fingerprintSigners(s: Signers): string {
  return [
    s.ethereumAddress ?? "-",
    s.walletClient ? "wc" : "-",
    s.publicKey?.toBase58() ?? "-",
    s.signTransaction ? "st" : "-",
    s.starknetAccount?.address ?? "-",
  ].join("|");
}

/**
 * Connected wallets in the SDK's unified signer shape. The app and the file:-linked SDK
 * resolve separate copies of viem / @solana/web3.js, so structurally identical types are
 * nominally distinct; cast across this one boundary.
 */
function unifiedWallets(s: Signers): UnifiedSigner[] {
  return [
    ...(s.ethereumAddress && s.walletClient
      ? [
          {
            chain: "ethereum",
            address: s.ethereumAddress,
            walletClient: s.walletClient,
          } as EvmUnifiedSigner,
        ]
      : []),
    ...(s.publicKey && s.signTransaction
      ? [
          {
            chain: "solana",
            publicKey: s.publicKey,
            signTransaction: s.signTransaction,
          } as unknown as SolanaUnifiedSigner,
        ]
      : []),
  ];
}

async function buildClient(signature: Hex, s: Signers): Promise<OpaqueClient> {
  // The cached signature means fromWallet never prompts here; wallets only wire the
  // per-chain write signers (Solana-only sessions keep working with a placeholder EVM
  // address inside the SDK, never used for writes).
  return OpaqueClient.fromWallet({
    wallets: unifiedWallets(s),
    walletSignature: signature,
    chainId: SEPOLIA_CHAIN_ID,
    rpcUrl: SEPOLIA_RPC_URL,
    wasmModuleSpecifier: WASM_MODULE_SPECIFIER,
    solana: { cluster: SOLANA_CLUSTER, rpcUrl: SOLANA_RPC_URL, connection: s.connection },
    starknet: {
      // The app's starknet.js WalletAccount and the SDK's structural account type are
      // nominally distinct across package copies; cast at this one boundary (same as
      // unifiedWallets above).
      account: (s.starknetAccount as unknown as StarknetAccountLike) ?? undefined,
      psrVerificationKey: PSR_VKEY_URL,
    },
  });
}

export function useOpaqueSession() {
  const { connection } = useConnection();
  const { publicKey, signMessage, signTransaction } = useSolanaWallet();
  const { address: ethereumAddress, chainId: ethereumChainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const { walletAccount: starknetAccount } = useStarknetWallet();

  const client = useOpaqueStore((s) => s.client);
  const metaAddress = useOpaqueStore((s) => s.metaAddress);
  const status = useOpaqueStore((s) => s.status);
  const derivationSource = useOpaqueStore((s) => s.derivationSource);
  const entered = useOpaqueStore((s) => s.entered);
  const setSession = useOpaqueStore((s) => s.setSession);
  const setEntered = useOpaqueStore((s) => s.setEntered);
  const clearSession = useOpaqueStore((s) => s.clearSession);
  const setStatus = useOpaqueStore((s) => s.setStatus);

  const connect = useCallback(
    async (opts: { derivationSource: DerivationSource; remember?: boolean }): Promise<OpaqueClient> => {
      const source = opts.derivationSource;
      let sigHex: Hex | null = null;
      let evmWalletClient: unknown = walletClient ?? null;

      // A connected EVM wallet on the wrong network leaves useWalletClient empty (its query
      // throws ConnectorChainMismatchError), which used to surface as "not connected". Switch
      // to Sepolia and fetch the client imperatively instead.
      if (ethereumAddress && !evmWalletClient) {
        setStatus("Switching Ethereum wallet to Sepolia…");
        try {
          if (ethereumChainId !== SEPOLIA_CHAIN_ID) {
            await switchChainAsync({ chainId: SEPOLIA_CHAIN_ID });
          }
          evmWalletClient = await getWalletClient(wagmiConfig, { chainId: SEPOLIA_CHAIN_ID });
        } catch {
          evmWalletClient = null;
          if (source === "ethereum") {
            throw new Error(
              "Your Ethereum wallet is connected but on the wrong network. Switch it to Sepolia and try again.",
            );
          }
        }
      }

      if (source === "solana") {
        if (!publicKey || !signMessage) {
          throw new Error("Connect a Solana wallet (Phantom / Solflare) to derive keys from it.");
        }
        const address = publicKey.toBase58();
        setStatus("Restoring session…");
        sigHex = await loadSignatureSession({
          address,
          cluster: SOLANA_CLUSTER,
          message: SETUP_MESSAGE,
        });
        if (!sigHex) {
          setStatus("Requesting signature over SETUP_MESSAGE…");
          sigHex = await requestSetupSignature({
            chain: "solana",
            publicKey: address,
            signMessage,
          });
          await saveSignatureSession({
            signatureHex: sigHex,
            address,
            cluster: SOLANA_CLUSTER,
            message: SETUP_MESSAGE,
            remember: opts.remember ?? getRememberSignaturePreference(),
          });
        }
      } else {
        if (!ethereumAddress || !evmWalletClient) {
          throw new Error("Connect an Ethereum wallet (MetaMask or another injected wallet) to derive keys from it.");
        }
        setStatus("Restoring session…");
        sigHex = await loadSignatureSession({
          address: ethereumAddress,
          cluster: ETHEREUM_SESSION_SCOPE,
          message: SETUP_MESSAGE,
        });
        if (!sigHex) {
          setStatus("Requesting signature over SETUP_MESSAGE…");
          sigHex = await requestSetupSignature({
            chain: "ethereum",
            address: ethereumAddress,
            walletClient: evmWalletClient,
          } as unknown as EvmUnifiedSigner);
          await saveSignatureSession({
            signatureHex: sigHex,
            address: ethereumAddress,
            cluster: ETHEREUM_SESSION_SCOPE,
            message: SETUP_MESSAGE,
            remember: opts.remember ?? getRememberSignaturePreference(),
          });
        }
      }

      setStatus("Deriving stealth keys + loading scanner…");
      const s: Signers = {
        connection,
        ethereumAddress,
        walletClient: evmWalletClient,
        publicKey,
        signTransaction,
        starknetAccount,
      };
      const c = await buildClient(sigHex, s);
      setSession({
        client: c,
        metaAddress: c.getMetaAddressHex(),
        derivationSource: source,
        walletSignature: sigHex,
        signerFingerprint: fingerprintSigners(s),
      });
      setStatus(null);
      return c;
    },
    [
      publicKey,
      signMessage,
      signTransaction,
      walletClient,
      ethereumAddress,
      ethereumChainId,
      switchChainAsync,
      connection,
      starknetAccount,
      setSession,
      setStatus,
    ],
  );

  const disconnect = useCallback(() => {
    clearSignatureSession();
    clearSession();
    // OPQ-014 / OPQ-015: the tx-history, watchlist, and ghost-address stores hold the
    // user's private-payment graph (stealth addresses, counterparties, amounts) and the
    // plaintext ephemeral private keys for ghost receives. Wipe both the in-memory state
    // and their localStorage keys on disconnect so nothing sensitive survives logout.
    useTxHistoryStore.getState().clear();
    useWatchlistStore.getState().clear();
    useGhostAddressStore.getState().clear();
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem("opaque-tx-history");
        localStorage.removeItem("opaque-watchlist");
        localStorage.removeItem(GHOST_ADDRESSES_STORAGE_KEY);
      } catch {
        /* ignore private-mode / quota errors */
      }
    }
  }, [clearSession]);

  /** Whether write actions on `chain` are possible — requires that chain's wallet connected. */
  const canActOn = useCallback(
    (chain: OpaqueChain): boolean => {
      if (chain === "ethereum") return ethereumAddress != null && walletClient != null;
      if (chain === "starknet") return starknetAccount != null;
      return publicKey != null && signTransaction != null;
    },
    [ethereumAddress, walletClient, publicKey, signTransaction, starknetAccount],
  );

  const connectedChains: OpaqueChain[] = [
    ...(publicKey != null ? (["solana"] as const) : []),
    ...(ethereumAddress != null ? (["ethereum"] as const) : []),
    ...(starknetAccount != null ? (["starknet"] as const) : []),
  ];

  return {
    client,
    metaAddress,
    status,
    isSetup: client != null,
    entered,
    setEntered,
    derivationSource,
    connectedChains,
    canActOn,
    solanaAddress: publicKey?.toBase58() ?? null,
    ethereumAddress: ethereumAddress ?? null,
    connect,
    disconnect,
  };
}

/**
 * Mount ONCE (in App) to keep the client's signers in sync with the connected wallets: when a
 * wallet connects or disconnects after the session exists, the client is rebuilt from the cached
 * in-memory signature — same keys, fresh signers, no new signature prompt.
 */
export function useOpaqueSessionSync() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useSolanaWallet();
  const { address: ethereumAddress } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { walletAccount: starknetAccount } = useStarknetWallet();
  const rebuildingRef = useRef(false);

  const client = useOpaqueStore((s) => s.client);
  const walletSignature = useOpaqueStore((s) => s.walletSignature);
  const signerFingerprint = useOpaqueStore((s) => s.signerFingerprint);
  const replaceClient = useOpaqueStore((s) => s.replaceClient);

  useEffect(() => {
    if (!client || !walletSignature) return;
    const s: Signers = {
      connection,
      ethereumAddress,
      walletClient: walletClient ?? null,
      publicKey,
      signTransaction,
      starknetAccount,
    };
    const next = fingerprintSigners(s);
    if (next === signerFingerprint || rebuildingRef.current) return;
    rebuildingRef.current = true;
    void buildClient(walletSignature, s)
      .then((c) => replaceClient(c, next))
      .catch((e) => console.error("[Opaque] client rebuild after wallet change failed:", e))
      .finally(() => {
        rebuildingRef.current = false;
      });
  }, [
    client,
    walletSignature,
    signerFingerprint,
    connection,
    ethereumAddress,
    walletClient,
    publicKey,
    signTransaction,
    starknetAccount,
    replaceClient,
  ]);
}
