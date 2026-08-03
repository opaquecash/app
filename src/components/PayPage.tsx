/**
 * Universal payment page: /pay/:identifier
 * Resolves a stealth meta-address (hex) or .sol placeholder name, then shows amount UI. The payer
 * needs no Opaque identity — just a connected wallet on either chain (Solana or Ethereum).
 */

import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Connection, PublicKey } from "@solana/web3.js";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { getCluster, getRpcUrl } from "../lib/chain";
import { isEnsName } from "../lib/ens";
import { getConfigForCluster } from "../contracts/contract-config";
import { createSendOnlyClient } from "../opaque/sendOnly";
import { getExplorerTxUrl } from "../lib/explorer";
import { NATIVE_ASSET, formatNativeAmount, parseNativeAmount, type ChainKey } from "../lib/chainAssets";
import { useConnectedWallets } from "../hooks/useConnectedWallets";
import { useWallet as useSolanaAdapterWallet } from "@solana/wallet-adapter-react";
import { SEPOLIA_RPC_URL } from "../opaque/config";
import { ChainToggle } from "./ChainToggle";

function isDirectMetaAddress(s: string): boolean {
  const t = s.trim().startsWith("0x") ? s.trim() : "0x" + s.trim();
  return t.length === 2 + 66 * 2 && (t.startsWith("0x02") || t.startsWith("0x03"));
}

function formatRecipientDisplay(id: string): string {
  if (!id) return "";
  const trimmed = id.trim();
  const with0x = trimmed.startsWith("0x") ? trimmed : "0x" + trimmed;
  if (isDirectMetaAddress(with0x)) {
    return with0x.slice(0, 5) + "…" + with0x.slice(-4);
  }
  return trimmed;
}

type ResolveStatus = "idle" | "resolving" | "found" | "not_found";

export function PayPage() {
  const { identifier } = useParams<{ identifier: string }>();
  const navigate = useNavigate();
  const wallets = useConnectedWallets();
  const { signTransaction } = useSolanaAdapterWallet();
  const cluster = getCluster();
  const config = getConfigForCluster(cluster);
  const [resolveStatus, setResolveStatus] = useState<ResolveStatus>("idle");
  const [resolvedMeta, setResolvedMeta] = useState<Hex | null>(null);
  const [displayName, setDisplayName] = useState<string>("");

  const payableChains = useMemo(
    () =>
      ([
        ...(wallets.solana.connected && signTransaction ? (["solana"] as const) : []),
        ...(wallets.ethereum.connected && wallets.ethereum.walletClient ? (["ethereum"] as const) : []),
      ]) as ChainKey[],
    [wallets.solana.connected, signTransaction, wallets.ethereum.connected, wallets.ethereum.walletClient],
  );
  const [chain, setChain] = useState<ChainKey>("solana");
  useEffect(() => {
    if (!payableChains.includes(chain) && payableChains.length > 0) setChain(payableChains[0]);
  }, [payableChains, chain]);

  const asset = NATIVE_ASSET[chain];
  const payerAddress = chain === "solana" ? wallets.solana.address : wallets.ethereum.address;

  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txChain, setTxChain] = useState<ChainKey>("solana");
  const [sending, setSending] = useState(false);
  const [activeBalance, setActiveBalance] = useState<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    const id = identifier?.trim();
    if (!id) {
      setResolveStatus("not_found");
      setResolvedMeta(null);
      return;
    }
    setDisplayName(id);
    setResolveStatus("resolving");
    setResolvedMeta(null);

    // Direct stealth meta-address in the URL is the supported form. (.sol/SNS name resolution
    // is not implemented, so those resolve to not_found.)
    if (isEnsName(id)) {
      setResolveStatus("not_found");
      return;
    }
    const with0x = id.startsWith("0x") ? id : "0x" + id;
    if (isDirectMetaAddress(with0x)) {
      setResolvedMeta(with0x as Hex);
      setResolveStatus("found");
    } else {
      setResolveStatus("not_found");
    }
  }, [identifier]);

  useEffect(() => {
    if (!payerAddress) {
      setActiveBalance(null);
      return;
    }
    let cancelled = false;
    setBalanceLoading(true);
    (async () => {
      try {
        let raw: bigint;
        if (chain === "solana") {
          const connection = new Connection(getRpcUrl(), "confirmed");
          raw = BigInt(await connection.getBalance(new PublicKey(payerAddress)));
        } else {
          const publicClient = createPublicClient({ transport: http(SEPOLIA_RPC_URL) });
          raw = await publicClient.getBalance({ address: payerAddress as Address });
        }
        if (!cancelled) setActiveBalance(raw);
      } catch {
        if (!cancelled) setActiveBalance(null);
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payerAddress, chain]);

  const maxSendableBalance = useMemo(() => {
    if (activeBalance == null) return null;
    return activeBalance > asset.feeBuffer ? activeBalance - asset.feeBuffer : 0n;
  }, [activeBalance, asset.feeBuffer]);

  const inputAmount = useMemo(() => {
    const raw = amount.trim();
    if (!raw) return null;
    try {
      return parseNativeAmount(raw, chain);
    } catch {
      return null;
    }
  }, [amount, chain]);

  const isInsufficientBalance = Boolean(
    maxSendableBalance != null &&
      inputAmount != null &&
      inputAmount > 0n &&
      inputAmount > maxSendableBalance
  );

  const formattedMaxBalance =
    maxSendableBalance != null ? formatNativeAmount(maxSendableBalance, chain) : null;

  const handleMaxAmount = () => {
    if (maxSendableBalance == null || maxSendableBalance === 0n) return;
    setAmount(formattedMaxBalance ?? "0");
  };

  const handleSendPrivately = async () => {
    setError(null);
    setTxHash(null);
    if (!resolvedMeta || !payableChains.includes(chain)) return;
    if (chain === "solana" && !config) return;
    if (inputAmount == null || inputAmount <= 0n) {
      setError("Enter a valid amount.");
      return;
    }
    setSending(true);
    try {
      // Send-only client: the payer has no Opaque identity; derive the recipient's one-time
      // stealth destination, transfer, and announce in one flow on the selected chain.
      const client = await createSendOnlyClient({
        solana:
          wallets.solana.connected && wallets.solana.publicKey && signTransaction
            ? {
                connection: new Connection(getRpcUrl(), "confirmed"),
                publicKey: wallets.solana.publicKey,
                signTransaction,
              }
            : undefined,
        ethereum:
          wallets.ethereum.connected && wallets.ethereum.address && wallets.ethereum.walletClient
            ? {
                address: wallets.ethereum.address as Address,
                walletClient: wallets.ethereum.walletClient,
              }
            : undefined,
      });
      const result = await client.sendStealthPayment({
        chain,
        recipient: resolvedMeta,
        amount: inputAmount,
        announce: true,
      });
      setTxHash(result.txHash);
      setTxChain(chain);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Send failed";
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  if (resolveStatus === "not_found") {
    return (
      <div className="min-h-screen bg-ink-950 bg-grid-fade bg-size-grid text-white flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900/30 p-6 text-center shadow-2xl backdrop-blur-lg">
          <h1 className="font-display text-2xl font-bold text-white mb-2">User Not Found</h1>
          <p className="text-mist text-sm mb-6">
            The identifier could not be resolved to a registered stealth meta-address. It may be invalid or the user
            may not have registered yet.
          </p>
          <button
            type="button"
            onClick={() => navigate("/app")}
            className="w-full rounded-xl bg-sol-gradient px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Return to App
          </button>
        </div>
      </div>
    );
  }

  if (resolveStatus === "resolving" || resolveStatus === "idle") {
    return (
      <div className="min-h-screen bg-ink-950 bg-grid-fade bg-size-grid text-white flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-ink-600 border-t-sol-purple rounded-full animate-spin" aria-hidden />
          <p className="text-sm text-mist">Resolving recipient…</p>
        </div>
      </div>
    );
  }

  const canSend = Boolean(
    payableChains.includes(chain) && resolvedMeta && (chain !== "solana" || config),
  );
  const showConnectPrompt = payableChains.length === 0;

  const recipientLabel = formatRecipientDisplay(displayName);

  return (
    <div className="min-h-screen bg-ink-950 bg-grid-fade bg-size-grid text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        {showConnectPrompt ? (
          <div className="card-glass text-center border border-ink-700/70">
            <p className="text-mist text-sm mb-2">Pay</p>
            <p className="text-white font-mono text-lg mb-6 break-all">{recipientLabel}</p>
            <div className="flex justify-center mb-6" aria-hidden>
              <div
                className="w-12 h-12 rounded-full border border-ink-700 flex items-center justify-center bg-ink-900/40"
                title="Encrypted Connection"
              >
                <svg className="w-6 h-6 text-mist" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                  />
                </svg>
              </div>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void wallets.solana.connect().catch((e) => setError(e instanceof Error ? e.message : "Failed to connect"))}
                disabled={wallets.solana.connecting}
                className="w-full rounded-xl bg-sol-gradient px-4 py-3.5 text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {wallets.solana.connecting ? "Connecting…" : "Connect Solana Wallet"}
              </button>
              <button
                type="button"
                onClick={() => void wallets.ethereum.connect().catch((e) => setError(e instanceof Error ? e.message : "Failed to connect"))}
                disabled={wallets.ethereum.connecting}
                className="w-full rounded-xl border border-ink-600 bg-ink-900/60 px-4 py-3.5 text-base font-semibold text-white hover:border-sol-purple/40 disabled:opacity-50"
              >
                {wallets.ethereum.connecting ? "Connecting…" : "Connect Ethereum Wallet"}
              </button>
            </div>
            {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
          </div>
        ) : (
          <>
            <div className="card-glass border border-ink-700/70 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-mist text-sm">To</p>
                  <p className="text-white font-mono text-base break-all">{recipientLabel}</p>
                </div>
                <ChainToggle
                  value={chain}
                  // Pay-links stay on the 2-chain send set (no starknet segment shown),
                  // so narrow the wider toggle union back to ChainKey here.
                  onChange={(c) => {
                    if (c !== "starknet") setChain(c);
                  }}
                  ethConnected={payableChains.includes("ethereum")}
                  solConnected={payableChains.includes("solana")}
                />
              </div>
              <div>
                <label className="block text-sm text-mist mb-1.5">Amount ({asset.symbol})</label>
                <div className="relative flex rounded-lg shadow-sm">
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.01"
                    className={`input-field flex-1 pr-14 ${isInsufficientBalance ? "border-red-500/50 focus:border-red-500/70 focus:ring-red-500/20" : ""}`}
                  />
                  <button
                    type="button"
                    onClick={handleMaxAmount}
                    disabled={maxSendableBalance == null || maxSendableBalance === 0n || balanceLoading}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md py-1 px-2 text-xs font-medium text-mist hover:text-white disabled:opacity-50"
                  >
                    MAX
                  </button>
                </div>
                {balanceLoading && <p className="mt-1.5 text-mist/70 text-xs">Loading balance…</p>}
                {isInsufficientBalance && formattedMaxBalance != null && (
                  <p className="mt-1.5 text-red-400 text-xs">
                    Exceeds available balance ({formattedMaxBalance} {asset.symbol})
                  </p>
                )}
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              {txHash &&
                (() => {
                  const explorerUrl = getExplorerTxUrl(txHash, txChain);
                  return (
                    <div className="p-3 rounded-lg bg-ink-900/50 border border-ink-700 text-sm space-y-2">
                      <div>
                        <span className="text-emerald-400">Sent.</span>{" "}
                        <span className="font-mono text-mist break-all text-xs">{txHash}</span>
                      </div>
                      {explorerUrl && (
                        <a
                          href={explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-mist hover:text-white"
                        >
                          View on Explorer
                        </a>
                      )}
                    </div>
                  );
                })()}
              <button
                type="button"
                onClick={() => void handleSendPrivately()}
                disabled={sending || !canSend || isInsufficientBalance || !amount.trim()}
                className={`w-full rounded-xl bg-sol-gradient px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 ${sending ? "loading" : ""}`}
              >
                {sending ? "Sending…" : "Send Privately"}
              </button>
            </div>
            <p className="mt-4 text-center">
              <button
                type="button"
                onClick={() => navigate("/app")}
                className="text-mist/80 hover:text-white text-sm transition-colors"
              >
                ← Return to App
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
