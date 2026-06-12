import { useState, useEffect, useCallback, useMemo } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { createPublicClient, http, type Address, type Hex } from "viem";
import {
  ephemeralPrivateKeyToCompressedPublicKey,
  type UnifiedOwnedOutput,
} from "@opaquecash/opaque";
import { hexToBytes, bytesToHex, shortenAddress } from "../lib/format";
import { getRpcUrl, getCluster } from "../lib/chain";
import { NATIVE_ASSET, formatNativeAmount, type ChainKey } from "../lib/chainAssets";
import { SEPOLIA_RPC_URL, evmScanFromBlock } from "../opaque/config";
import { useOpaqueSession } from "../opaque/useOpaqueSession";
import { useConnectedWallets } from "../hooks/useConnectedWallets";
import type { ProtocolStep } from "./ProtocolStepper";
import { ClaimModal } from "./ClaimModal";
import { useProtocolLog } from "../context/ProtocolLogContext";
import { useTxHistoryStore } from "../store/txHistoryStore";
import { useGhostAddressStore } from "../store/ghostAddressStore";
import { useWatchlist, useWatchlistStore } from "../hooks/useWatchlist";
import { useToast } from "../context/ToastContext";
import { ExplorerLink } from "./ExplorerLink";
import { ModalShell } from "./ModalShell";

function isEvmAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}

function isSolanaAddress(a: string): boolean {
  try {
    new PublicKey(a.trim());
    return true;
  } catch {
    return false;
  }
}

function isAddressForChain(a: string, chain: ChainKey): boolean {
  return chain === "ethereum" ? isEvmAddress(a) : isSolanaAddress(a);
}

function isAddress(a: string): boolean {
  return isEvmAddress(a) || isSolanaAddress(a);
}

export type FoundTx = {
  id: string;
  /** Chain this output lives on. */
  chain: ChainKey;
  /** Scanner stealth address (0x EVM-style) — used for display + matching. */
  address: string;
  /** Actual account holding the funds (base58 on Solana, 0x on Ethereum). */
  holderAddress?: string;
  balance: bigint;
  /** The balance RPC lookup failed — show the payment instead of hiding it as zero. */
  balanceUnknown?: boolean;
  /** 33-byte compressed ephemeral pubkey (hex) the SDK sweeps from. */
  ephemeralPublicKey?: string;
  txHash: string;
  blockNumber: number;
  isSpent?: boolean;
  source: "announcement" | "manual" | "watch";
  /** How an announced output was discovered: the chain's own announcer or relayed via Wormhole. */
  announceSource?: "native" | "uab";
};

/** Build a UnifiedOwnedOutput-shaped record for a ghost's stored ephemeral key (Solana). */
function ghostOutput(stealthAddress: string, ephemeralPrivKeyHex: string): UnifiedOwnedOutput {
  const ephemeralPublicKey = bytesToHex(
    ephemeralPrivateKeyToCompressedPublicKey(hexToBytes(ephemeralPrivKeyHex)),
  ) as Hex;
  return {
    stealthAddress: stealthAddress as `0x${string}`,
    transactionHash: "0x" as Hex,
    blockNumber: 0,
    logIndex: 0,
    viewTag: 0,
    ephemeralPublicKey,
    chain: "solana",
    chainId: 1,
    source: "native",
  };
}

export type PortfolioEntry = { tx: FoundTx; balanceRaw: bigint };

const SCAN_CHAINS: ChainKey[] = ["solana", "ethereum"];

export function PrivateBalanceView() {
  const { client, isSetup } = useOpaqueSession();
  const wallets = useConnectedWallets();
  const cluster = getCluster();
  const { push: logPush } = useProtocolLog();
  const pushTx = useTxHistoryStore((s) => s.push);
  const { showToast } = useToast();

  const [found, setFound] = useState<FoundTx[]>([]);
  const [ghostTxs, setGhostTxs] = useState<FoundTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [withdrawalSteps, setWithdrawalSteps] = useState<ProtocolStep[]>([]);
  const [destinationByTxId, setDestinationByTxId] = useState<Record<string, string>>({});
  const [claimModalTx, setClaimModalTx] = useState<FoundTx | null>(null);
  const [manualImportOpen, setManualImportOpen] = useState(false);
  const [manualImportAddress, setManualImportAddress] = useState("");
  const [manualImportError, setManualImportError] = useState<string | null>(null);

  const ghostStoreEntries = useGhostAddressStore((s) => s.entries);
  const watchlistAdd = useWatchlistStore((s) => s.add);
  const watchlistArchive = useWatchlistStore((s) => s.archive);
  const watchlistAddresses = useWatchlist(cluster);

  const solanaClient = useMemo(() => new Connection(getRpcUrl(), "confirmed"), []);
  const evmClient = useMemo(() => createPublicClient({ transport: http(SEPOLIA_RPC_URL) }), []);

  const ghostEntries = useMemo(
    () => ghostStoreEntries.filter((e) => e.cluster === cluster && !!e.ephemeralPrivKeyHex),
    [ghostStoreEntries, cluster],
  );

  // Discover announced owned outputs via the SDK (fetch + WASM match + balance, one path).
  // Both chains are scanned regardless of which wallets are connected — the stealth keys are
  // chain-neutral, and cross-chain (UAB) announcements are merged in for the unified inbox.
  useEffect(() => {
    if (!client) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Scan chains independently so one chain's RPC outage (e.g. a devnet
        // "long-term storage" error) cannot blank the other chain's payments.
        const fromBlock = await evmScanFromBlock();
        const perChain = await Promise.allSettled(
          SCAN_CHAINS.map((c) => client.scan({ chains: [c], fromBlock })),
        );
        const outputs = perChain.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
        perChain.forEach((r, i) => {
          if (r.status === "rejected") {
            console.warn(`[Opaque] ${SCAN_CHAINS[i]} scan failed; showing other chains`, r.reason);
          }
        });
        // Balance lookups settle per output: one chain's (or one output's) RPC failure
        // must not blank everything the scans just found.
        const balances = await Promise.all(
          outputs.map((o) =>
            client.getBalancesForOutputs([o]).then(
              (b) => b[0],
              (err) => {
                console.warn(`[Opaque] ${o.chain} balance lookup failed for ${o.stealthAddress}`, err);
                return undefined;
              },
            ),
          ),
        );
        if (cancelled) return;
        const txs: FoundTx[] = outputs.map((o, i) => ({
          id: `${o.chain}-${o.transactionHash}-${o.logIndex}`,
          chain: o.chain,
          address: o.stealthAddress,
          holderAddress: balances[i]?.address,
          balance: balances[i]?.nativeRaw ?? 0n,
          balanceUnknown: balances[i] === undefined,
          ephemeralPublicKey: o.ephemeralPublicKey,
          txHash: o.transactionHash,
          blockNumber: o.blockNumber,
          source: "announcement",
          announceSource: o.source,
        }));
        setFound(txs);
        logPush("wasm", `Matched ${txs.length} owned announcement(s) across chains`);
      } catch (err) {
        if (!cancelled) console.warn("[Opaque] scan error", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, refreshKey, logPush]);

  // Manual ghost balances (not announced): derive the Solana account + balance from stored keys.
  useEffect(() => {
    if (!client || cluster == null) {
      setGhostTxs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const outputs = ghostEntries.map((g) =>
          ghostOutput(g.stealthAddress, g.ephemeralPrivKeyHex as string),
        );
        // Per-output settle: one failed lookup hides only that ghost, not the whole list.
        const keyed = await Promise.all(
          outputs.map((o) =>
            client.getBalancesForOutputs([o]).then(
              (b) => b[0],
              (err) => {
                console.warn("[Opaque] ghost balance lookup failed", err);
                return undefined;
              },
            ),
          ),
        );
        // View-only watchlist addresses (no stored key): direct balance read on their chain.
        const viewOnly = watchlistAddresses.filter(
          (a) => !ghostEntries.some((g) => g.stealthAddress.toLowerCase() === a.toLowerCase()),
        );
        const viewBalances = await Promise.all(
          viewOnly.map(async (addr) => {
            try {
              if (isEvmAddress(addr)) {
                return await evmClient.getBalance({ address: addr as Address });
              }
              return BigInt(await solanaClient.getBalance(new PublicKey(addr)));
            } catch {
              return 0n;
            }
          }),
        );
        if (cancelled) return;
        const ghostFound: FoundTx[] = [];
        ghostEntries.forEach((g, i) => {
          const balance = keyed[i]?.nativeRaw ?? 0n;
          if (balance > 0n) {
            ghostFound.push({
              id: `ghost-${g.stealthAddress}`,
              chain: "solana",
              address: g.stealthAddress,
              holderAddress: keyed[i]?.address,
              balance,
              ephemeralPublicKey: outputs[i].ephemeralPublicKey,
              txHash: "",
              blockNumber: 0,
              source: "manual",
            });
          }
        });
        viewOnly.forEach((addr, i) => {
          const balance = viewBalances[i] ?? 0n;
          if (balance > 0n) {
            ghostFound.push({
              id: `watch-${addr}`,
              chain: isEvmAddress(addr) ? "ethereum" : "solana",
              address: addr,
              balance,
              txHash: "",
              blockNumber: 0,
              source: "watch",
            });
          }
        });
        setGhostTxs(ghostFound);
      } catch (err) {
        if (!cancelled) console.warn("[Opaque] ghost balance error", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, cluster, ghostEntries, watchlistAddresses, solanaClient, evmClient, refreshKey]);

  const portfolio = useMemo(() => {
    const activeTxs = [...found.filter((tx) => !tx.isSpent), ...ghostTxs];
    const totals: Record<ChainKey, bigint> = { ethereum: 0n, solana: 0n };
    const entries: PortfolioEntry[] = [];
    for (const tx of activeTxs) {
      // Unknown-balance rows stay visible (the payment exists; only its RPC read failed)
      // but contribute nothing to the totals.
      if (tx.balance > 0n || tx.balanceUnknown) {
        totals[tx.chain] += tx.balance;
        entries.push({ tx, balanceRaw: tx.balance });
      }
    }
    return { totals, entries };
  }, [found, ghostTxs]);

  const setDestination = useCallback((txId: string, value: string) => {
    setDestinationByTxId((prev) => ({ ...prev, [txId]: value }));
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    // The effects re-run on refreshKey; clear the flag shortly after.
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const handleClaim = useCallback(
    async (tx: FoundTx, destination: string) => {
      const trimmed = destination.trim();
      const asset = NATIVE_ASSET[tx.chain];
      if (!client) {
        setClaimError("Session not ready.");
        return;
      }
      if (tx.source === "watch" || !tx.ephemeralPublicKey) {
        setClaimError("This address has no stored key and cannot be withdrawn.");
        return;
      }
      if (tx.balance <= 0n) return;
      if (!trimmed || !isAddressForChain(trimmed, tx.chain)) {
        setClaimError(
          tx.chain === "ethereum"
            ? "Enter a valid Ethereum destination address."
            : "Enter a valid Solana destination address.",
        );
        return;
      }

      setClaimingId(tx.id);
      setClaimError(null);
      setWithdrawalSteps([
        { id: "wd-1", status: "wait", label: "Reconstructing key + sweeping…" },
      ]);
      logPush("wasm", "Reconstructing stealth key and signing claim tx…");
      logPush(
        "blockchain",
        `Claim: ${formatNativeAmount(tx.balance, tx.chain)} ${asset.symbol} → ${shortenAddress(trimmed)}`,
      );

      try {
        const { tx: sig } = await client.sweep({
          output: { ephemeralPublicKey: tx.ephemeralPublicKey as Hex },
          chain: tx.chain,
          destination: trimmed,
        });
        setWithdrawalSteps([{ id: "wd-1", status: "done", label: "Swept to destination." }]);
        pushTx({
          cluster,
          chain: tx.chain,
          kind: tx.source === "manual" ? "ghost" : "received",
          counterparty: tx.source === "manual" ? "Manual Ghost" : shortenAddress(tx.address, 10, 0),
          amountLamports: tx.balance.toString(),
          tokenSymbol: asset.symbol,
          tokenAddress: null,
          amount: formatNativeAmount(tx.balance, tx.chain),
          txHash: sig,
          stealthAddress: tx.address,
        });
        showToast("Withdrawal successful", {
          explorerTx: { cluster: cluster ?? undefined, txSig: sig, chain: tx.chain },
        });
        if (tx.source === "manual") {
          setGhostTxs((prev) => prev.filter((t) => t.id !== tx.id));
        } else {
          setFound((prev) => prev.map((t) => (t.id === tx.id ? { ...t, isSpent: true } : t)));
        }
        setClaimModalTx((prev) => (prev?.id === tx.id ? null : prev));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setClaimError(msg);
        setWithdrawalSteps([{ id: "wd-1", status: "error", label: "Sweep failed", detail: msg }]);
      } finally {
        setClaimingId(null);
      }
    },
    [client, cluster, pushTx, showToast, logPush],
  );

  const allEntries = portfolio.entries;
  const hasFunds = portfolio.totals.ethereum > 0n || portfolio.totals.solana > 0n;

  if (!isSetup) {
    return (
      <div className="card max-w-lg mx-auto text-center text-neutral-500">
        Complete key setup first.
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col">
      <div className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Private balance</h2>
            <p className="mt-1 text-sm text-mist">
              Funds across your stealth addresses on Ethereum and Solana. Withdraw to any address
              on the output's chain.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="rounded-xl border border-ink-600 bg-ink-950/30 px-3.5 py-2 text-sm font-medium text-mist transition-colors hover:border-sol-purple/30 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {refreshing || loading ? "Scanning…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => {
                setManualImportOpen(true);
                setManualImportAddress("");
                setManualImportError(null);
              }}
              className="rounded-xl border border-ink-600 bg-ink-950/30 px-3.5 py-2 text-sm font-medium text-mist transition-colors hover:border-sol-purple/30 hover:text-white"
            >
              Import ghost
            </button>
          </div>
        </div>
      </div>

      {claimError && !claimModalTx && (
        <div className="mb-4 p-3 rounded-xl bg-error/10 border border-error/30 text-error text-sm">
          {claimError}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-ink-700 bg-ink-900/25 p-6">
          <p className="text-mist text-sm">Deciphering payments…</p>
        </div>
      ) : !hasFunds && allEntries.length === 0 ? (
        <div className="rounded-2xl border border-ink-700 bg-ink-900/25 p-6">
          <p className="text-mist text-sm">No incoming payments found yet.</p>
          <p className="text-mist/70 text-xs mt-1">
            Payments sent to your stealth address on either chain will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {(["ethereum", "solana"] as const).map((c) => (
              <div key={c} className="rounded-2xl border border-ink-700 bg-ink-900/30 p-6">
                <p className="text-mist text-sm">Total {NATIVE_ASSET[c].symbol}</p>
                <p className="font-display text-2xl font-bold text-white mt-1">
                  {formatNativeAmount(portfolio.totals[c], c)}
                </p>
                <p className="text-mist/70 text-xs mt-1">
                  {allEntries.filter((e) => e.tx.chain === c).length} address
                  {allEntries.filter((e) => e.tx.chain === c).length !== 1 ? "es" : ""}
                </p>
              </div>
            ))}
          </div>

          <h3 className="font-display text-xl font-bold text-white">Stealth addresses</h3>
          <div className="space-y-3">
            {allEntries
              .filter((e) => e.balanceRaw > 0n || e.tx.balanceUnknown)
              .map(({ tx, balanceRaw }) => {
                const asset = NATIVE_ASSET[tx.chain];
                const amountStr = formatNativeAmount(balanceRaw, tx.chain);
                const canWithdraw = tx.source !== "watch" && !!tx.ephemeralPublicKey;
                const connectedDest =
                  tx.chain === "ethereum" ? wallets.ethereum.address : wallets.solana.address;
                return (
                  <div
                    key={tx.id}
                    className="rounded-2xl border border-ink-700 bg-ink-900/25 p-5 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-sol-purple/15 text-sol-purple border border-sol-purple/30 uppercase">
                          {asset.symbol}
                        </span>
                        {tx.announceSource === "uab" && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30"
                            title="Discovered via a cross-chain Wormhole announcement"
                          >
                            Cross-chain
                          </span>
                        )}
                        {tx.source !== "announcement" && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40">
                            {tx.source === "manual" ? "Manual/Ghost Funds" : "Watch-only"}
                          </span>
                        )}
                        <ExplorerLink
                          cluster={cluster}
                          chain={tx.chain}
                          value={tx.holderAddress ?? tx.address}
                          type="address"
                          className="text-mist text-xs"
                        />
                        {tx.txHash && (
                          <ExplorerLink
                            cluster={cluster}
                            chain={tx.chain}
                            value={tx.txHash}
                            type="tx"
                            className="text-mist/70 text-xs"
                            startChars={8}
                            endChars={6}
                          />
                        )}
                      </div>
                      {tx.balanceUnknown ? (
                        <p
                          className="text-amber-400 text-sm font-medium mt-0.5"
                          title="The balance RPC call failed — refresh to retry"
                        >
                          Balance unavailable
                        </p>
                      ) : (
                        <p className="text-success font-semibold mt-0.5">{amountStr} {asset.symbol}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {tx.source !== "announcement" && cluster != null && (
                        <button
                          type="button"
                          onClick={() => {
                            watchlistArchive(cluster, tx.address);
                            showToast("Address archived. It will no longer be polled for balances.");
                          }}
                          className="px-2 py-1 text-xs rounded-md border border-neutral-600 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300"
                        >
                          Archive
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!canWithdraw || claimingId !== null || tx.balanceUnknown}
                        onClick={() => setClaimModalTx(tx)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-sol-gradient text-white disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:opacity-90"
                      >
                        {claimingId === tx.id ? "Withdrawing…" : canWithdraw ? "Withdraw" : "No key"}
                      </button>
                    </div>
                    {canWithdraw && (
                      <div className="w-full mt-2">
                        <input
                          type="text"
                          value={destinationByTxId[tx.id] ?? ""}
                          onChange={(e) => setDestination(tx.id, e.target.value)}
                          placeholder={
                            tx.chain === "ethereum"
                              ? "Destination Ethereum address…"
                              : "Destination Solana address…"
                          }
                          className="input-field text-sm"
                        />
                        {connectedDest && (
                          <button
                            type="button"
                            onClick={() => setDestination(tx.id, connectedDest)}
                            className="mt-1.5 px-2 py-1 text-xs rounded-md btn-secondary"
                          >
                            Use connected wallet
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {claimModalTx && (
        <ClaimModal
          tx={claimModalTx}
          destination={destinationByTxId[claimModalTx.id] ?? ""}
          mainWalletAddress={
            (claimModalTx.chain === "ethereum"
              ? wallets.ethereum.address
              : wallets.solana.address) ?? undefined
          }
          cluster={cluster}
          claiming={claimingId === claimModalTx.id}
          error={claimError}
          onDestinationChange={(value: string) => setDestination(claimModalTx.id, value)}
          onConfirm={() => handleClaim(claimModalTx, destinationByTxId[claimModalTx.id] ?? "")}
          onClose={() => {
            setClaimModalTx(null);
            setClaimError(null);
            setWithdrawalSteps([]);
          }}
          withdrawalSteps={withdrawalSteps}
        />
      )}

      {manualImportOpen && (
        <ModalShell
          open
          title="Import ghost address"
          description="Add a previously generated stealth address to tracking. Without its ephemeral key, you can view balance but cannot withdraw."
          onClose={() => setManualImportOpen(false)}
          maxWidthClassName="max-w-md"
        >
          <input
            type="text"
            value={manualImportAddress}
            onChange={(e) => {
              setManualImportAddress(e.target.value);
              setManualImportError(null);
            }}
            placeholder="0x… or Solana address"
            className="input-field w-full mb-2 font-mono text-sm"
          />
          {manualImportError && <p className="text-error text-xs mb-3">{manualImportError}</p>}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setManualImportOpen(false)}
              className="rounded-xl border border-ink-600 bg-ink-950/30 px-4 py-2 text-sm font-medium text-mist hover:border-sol-purple/30 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const trimmed = manualImportAddress.trim();
                if (!trimmed || !isAddress(trimmed)) {
                  setManualImportError("Invalid address.");
                  return;
                }
                if (cluster == null) {
                  setManualImportError("Connect to a network first.");
                  return;
                }
                const stored = useGhostAddressStore
                  .getState()
                  .entries.find((e) => e.stealthAddress.toLowerCase() === trimmed.toLowerCase());
                if (
                  ghostEntries.some((e) => e.stealthAddress.toLowerCase() === trimmed.toLowerCase()) ||
                  watchlistAddresses.some((a) => a.toLowerCase() === trimmed.toLowerCase())
                ) {
                  setManualImportError("Address is already in the tracking list.");
                  return;
                }
                if (stored?.ephemeralPrivKeyHex) {
                  useGhostAddressStore.getState().add({
                    cluster,
                    stealthAddress: trimmed,
                    ephemeralPrivKeyHex: stored.ephemeralPrivKeyHex,
                  });
                }
                watchlistAdd(cluster, trimmed);
                setManualImportOpen(false);
                showToast("Ghost address added. Checking for funds…");
                setRefreshKey((k) => k + 1);
              }}
              className="rounded-xl bg-sol-gradient px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Add & check
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
