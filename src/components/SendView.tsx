import { useState, useEffect, useMemo, useCallback } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { createPublicClient, http, type Address } from "viem";
import { RpcProvider } from "starknet";
import { shortenAddress } from "../lib/format";
import { getRpcUrl, getCluster } from "../lib/chain";
import { getExplorerTxUrl } from "../lib/explorer";
import {
  NATIVE_ASSET,
  formatNativeAmount,
  parseNativeAmount,
  type ChainKey,
  type DisplayChain,
} from "../lib/chainAssets";
import { useOpaqueSession } from "../opaque/useOpaqueSession";
import { useConnectedWallets } from "../hooks/useConnectedWallets";
import { useStarknetWallet } from "../context/StarknetWalletContext";
import { SEPOLIA_RPC_URL, STARKNET_RPC_URL } from "../opaque/config";
import { getConfigForCluster } from "../contracts/contract-config";
import { ProtocolStepper } from "./ProtocolStepper";
import type { ProtocolStep } from "./ProtocolStepper";
import { useProtocolLog } from "../context/ProtocolLogContext";
import { useTxHistoryStore } from "../store/txHistoryStore";

const isMetaAddress = (value: string): boolean => {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  return normalized.length === 2 + 66 * 2 && (normalized.startsWith("0x02") || normalized.startsWith("0x03"));
};

/** Name-shaped recipients resolved through the SDK (ONS / ENS / SNS). */
const isNameInput = (value: string): boolean => /^[^\s]+\.(eth|sol)$/i.test(value);

/** STRK token (Sepolia) — used to read the sender's spendable balance. */
const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** Human label per `resolveRecipient` source tag. */
const RESOLVE_SOURCE_LABEL: Record<string, string> = {
  "ons-mirror": "ONS via Solana mirror (no Ethereum RPC)",
  "ons-registry": "ONS via Ethereum registry",
  "ens-text": "ENS com.opaque.meta record",
  "sns-record": "SNS Records V2 (TXT)",
  "evm-registry": "Ethereum stealth registry",
  "solana-registry": "Solana stealth registry",
  "ipfs-did": "IPFS DID document",
  "meta-address": "meta-address",
};

/** The other chain a native announcement can be relayed to (Wormhole). Starknet has no relay. */
const OTHER_CHAIN_LABEL: Record<ChainKey, string> = {
  ethereum: "Solana",
  solana: "Ethereum",
};

const SEND_CHAINS: { id: DisplayChain; label: string }[] = [
  { id: "ethereum", label: "Ethereum" },
  { id: "solana", label: "Solana" },
  { id: "starknet", label: "Starknet" },
];

export function SendView() {
  const { client, isSetup, canActOn, derivationSource } = useOpaqueSession();
  const wallets = useConnectedWallets();
  const strk = useStarknetWallet();
  const { push: logPush } = useProtocolLog();
  const pushTx = useTxHistoryStore((s) => s.push);
  const cluster = getCluster();
  const currentConfig = getConfigForCluster(cluster);

  // Whether a native send on `c` is possible: its wallet is connected (and on Sepolia for Starknet).
  const canSend = useCallback(
    (c: DisplayChain): boolean =>
      c === "starknet" ? strk.connected && strk.onSepolia : canActOn(c),
    [strk.connected, strk.onSepolia, canActOn],
  );

  // Default to the derivation-source chain when its wallet can sign, else the first usable chain.
  const usableChains = useMemo(
    () => (["ethereum", "solana", "starknet"] as const).filter((c) => canSend(c)),
    [canSend],
  );
  const [chain, setChain] = useState<DisplayChain>(() =>
    derivationSource && canSend(derivationSource) ? derivationSource : usableChains[0] ?? "solana",
  );
  useEffect(() => {
    if (!usableChains.includes(chain) && usableChains.length > 0) setChain(usableChains[0]);
  }, [usableChains, chain]);

  const asset = NATIVE_ASSET[chain];
  const senderAddress =
    chain === "solana"
      ? wallets.solana.address
      : chain === "starknet"
        ? strk.address
        : wallets.ethereum.address;

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [relayCrossChain, setRelayCrossChain] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txChain, setTxChain] = useState<DisplayChain>("solana");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [steps, setSteps] = useState<ProtocolStep[]>([]);
  const [activeBalance, setActiveBalance] = useState<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [resolved, setResolved] = useState<{ metaAddressHex: string; source: string } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Cross-chain relay is a Wormhole EVM↔Solana feature; Starknet announces locally only. When
  // Starknet is selected the checkbox is hidden and `relayCrossChain` is ignored by the send.
  const canRelay = chain !== "starknet";
  const relayRequested = canRelay && relayCrossChain;

  // Resolve name-shaped recipients as the user types (ONS mirror-first, then ENS/SNS),
  // so the sender sees the meta-address and resolution path before sending.
  useEffect(() => {
    const value = recipient.trim();
    setResolved(null);
    setResolveError(null);
    if (!client || !value || isMetaAddress(value) || !isNameInput(value)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setResolving(true);
      try {
        const r = await client.resolveRecipient(value);
        if (!cancelled) setResolved({ metaAddressHex: r.metaAddressHex, source: r.source });
      } catch (e) {
        if (!cancelled) setResolveError(e instanceof Error ? e.message : "Name did not resolve.");
      } finally {
        if (!cancelled) setResolving(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recipient, client]);

  useEffect(() => {
    if (!senderAddress) {
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
          raw = BigInt(await connection.getBalance(new PublicKey(senderAddress)));
        } else if (chain === "starknet") {
          const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });
          const res = await provider.callContract({
            contractAddress: STRK_TOKEN,
            entrypoint: "balanceOf",
            calldata: [senderAddress],
          });
          const felts = Array.isArray(res) ? res : (res as { result: string[] }).result;
          raw = BigInt(felts[0]) + (BigInt(felts[1]) << 128n);
        } else {
          const publicClient = createPublicClient({ transport: http(SEPOLIA_RPC_URL) });
          raw = await publicClient.getBalance({ address: senderAddress as Address });
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
  }, [senderAddress, chain]);

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

  const connectHint = (c: DisplayChain): string =>
    c === "ethereum"
      ? "Connect an Ethereum wallet to send on Ethereum."
      : c === "starknet"
        ? "Connect a Starknet wallet (on Sepolia) to send on Starknet."
        : "Connect a Solana wallet to send on Solana.";

  const handleSend = async () => {
    setError(null);
    setTxHash(null);
    if (!client || !canSend(chain)) {
      setError(connectHint(chain));
      return;
    }
    if (chain === "solana" && !currentConfig) {
      setError("Connect to a supported Solana cluster.");
      return;
    }
    const recipientMeta = recipient.trim();
    if (!recipientMeta || !amount) {
      setError("Enter recipient and amount.");
      return;
    }
    if (!isMetaAddress(recipientMeta) && !(isNameInput(recipientMeta) && resolved)) {
      setError(
        isNameInput(recipientMeta)
          ? (resolveError ?? "Waiting for the name to resolve…")
          : "Enter a stealth meta-address (0x + 132 hex) or a name (alice.opqtest.eth, .eth, .sol).",
      );
      return;
    }

    let value: bigint;
    try {
      value = parseNativeAmount(amount, chain);
    } catch {
      setError("Invalid amount.");
      return;
    }
    if (value === 0n) {
      setError("Amount must be greater than 0.");
      return;
    }

    setSending(true);
    setSteps([]);
    setError(null);

    const addStep = (status: ProtocolStep["status"], label: string, detail?: string) => {
      const id = `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setSteps((prev) => prev.concat([{ id, status, label, detail }]));
    };

    try {
      let resultTxHash: string;
      let destination: string;

      if (chain === "starknet") {
        // Starknet is account-abstraction: the SDK builds the (transfer + announce) multicall and
        // the connected wallet signs/broadcasts it. No SDK-held signer, unlike EVM/Solana.
        addStep("wait", "Deriving stealth destination + sending…");
        logPush("blockchain", "Preparing stealth STRK transfer + announce");
        const built = await client.buildStarknetStealthSend({
          recipient: recipientMeta,
          amount: value,
        });
        if (!strk.walletAccount) throw new Error("Starknet wallet is not connected.");
        const res = await strk.walletAccount.execute(built.calls);
        const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });
        await provider.waitForTransaction(res.transaction_hash);
        resultTxHash = res.transaction_hash;
        destination = built.stealthAddress;
      } else {
        addStep(
          "wait",
          relayRequested
            ? "Sending transfer + cross-chain announcement…"
            : "Deriving stealth destination + sending…",
        );
        logPush("blockchain", `Preparing stealth ${asset.symbol} transfer + announce`);

        // One call: derive one-time stealth destination, transfer the native asset, and announce
        // (announce_with_relay / UAB relay when relaying cross-chain over Wormhole).
        const result = await client.sendStealthPayment({
          chain,
          recipient: recipientMeta,
          amount: value,
          announce: true,
          relay: relayRequested,
        });
        resultTxHash = result.txHash;
        destination = result.destination ?? result.stealthAddress;
      }

      setTxHash(resultTxHash);
      setTxChain(chain);
      addStep("done", "Transfer confirmed.", resultTxHash);
      if (relayRequested) {
        addStep("done", `Announcement relayed to ${OTHER_CHAIN_LABEL[chain as ChainKey]} via Wormhole.`);
      }
      logPush("blockchain", `Tx: ${resultTxHash.slice(0, 18)}…`);

      pushTx({
        cluster,
        chain,
        kind: "sent",
        counterparty: shortenAddress(destination),
        amountLamports: value.toString(),
        tokenSymbol: asset.symbol,
        tokenAddress: null,
        amount: formatNativeAmount(value, chain),
        txHash: resultTxHash,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Send failed";
      setError(msg);
      setSteps((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        return prev.slice(0, -1).concat([{ ...last, status: "error" as const, detail: msg }]);
      });
      logPush("ui", `Send failed: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  if (!isSetup) {
    return (
      <div className="card max-w-lg mx-auto text-center text-neutral-500">
        Complete key setup first so you can receive as well.
      </div>
    );
  }

  if (usableChains.length === 0) {
    return (
      <div className="card max-w-lg mx-auto text-center text-neutral-500">
        Connect an Ethereum, Solana, or Starknet wallet to send.
      </div>
    );
  }

  const sendDisabled =
    sending ||
    (chain === "solana" && !currentConfig) ||
    isInsufficientBalance ||
    !recipient.trim() ||
    !amount.trim();

  return (
    <div className="card max-w-lg mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-white">Send {asset.symbol}</h2>
        <div className="inline-flex rounded-lg border border-ink-700 bg-ink-900 p-0.5 text-xs">
          {SEND_CHAINS.map((c) => {
            const disabled = !canSend(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={disabled}
                onClick={() => setChain(c.id)}
                title={disabled ? `Connect a ${c.label} wallet to use this chain` : undefined}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  chain === c.id
                    ? "bg-sol-purple text-white"
                    : disabled
                      ? "text-ink-600 cursor-not-allowed"
                      : "text-mist hover:text-white"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-sm text-neutral-500 mb-6">
        Send {asset.symbol} to a stealth meta-address. The app derives a one-time stealth
        destination on {asset.label} and publishes an on-chain announcement.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-neutral-500 mb-1.5">Recipient</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x02… meta-address or alice.opqtest.eth"
            className="input-field"
          />
          {resolving && (
            <p className="mt-1.5 text-neutral-600 text-xs">Resolving name…</p>
          )}
          {resolved && (
            <p className="mt-1.5 text-xs text-success break-all">
              {shortenAddress(resolved.metaAddressHex)} ·{" "}
              {RESOLVE_SOURCE_LABEL[resolved.source] ?? resolved.source}
            </p>
          )}
          {resolveError && !resolving && (
            <p className="mt-1.5 text-xs text-error">{resolveError}</p>
          )}
        </div>
        <div>
          <label className="block text-sm text-neutral-500 mb-1.5">Amount ({asset.symbol})</label>
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
              className="absolute right-2 top-1/2 -translate-y-1/2 py-1 px-2 text-xs font-medium text-neutral-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              MAX
            </button>
          </div>
          {balanceLoading && <p className="mt-1.5 text-neutral-600 text-xs">Loading balance…</p>}
          {chain === "starknet" && (
            <p className="mt-1.5 text-mist/60 text-xs">
              ~{formatNativeAmount(asset.feeBuffer, "starknet")} STRK is reserved so the recipient can
              later self-fund the account deploy when they withdraw.
            </p>
          )}
          {isInsufficientBalance && formattedMaxBalance != null && (
            <p className="mt-1.5 text-red-400 text-xs">
              Exceeds available balance ({formattedMaxBalance} {asset.symbol})
            </p>
          )}
        </div>
        {canRelay && (
          <label className="flex items-start gap-2.5 rounded-lg border border-ink-700 bg-ink-900/30 px-3 py-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={relayCrossChain}
              onChange={(e) => setRelayCrossChain(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-ink-600 bg-ink-900 accent-sol-purple"
            />
            <span className="text-xs text-mist">
              Also relay the announcement to {OTHER_CHAIN_LABEL[chain as ChainKey]} (Wormhole). The
              recipient sees it on either chain.
              <span className="block text-mist/60 mt-0.5">
                No {OTHER_CHAIN_LABEL[chain as ChainKey]} wallet needed to relay from {asset.label}.
              </span>
            </span>
          </label>
        )}
        {error && <p className="text-error text-sm">{error}</p>}
        {txHash &&
          (() => {
            const explorerUrl = getExplorerTxUrl(txHash, txChain);
            return (
              <div className="p-3 rounded-lg bg-neutral-900 border border-border text-sm space-y-2">
                <div>
                  <span className="text-success">Sent.</span>{" "}
                  <span className="font-mono text-neutral-500 break-all text-xs">{txHash}</span>
                </div>
                {explorerUrl && (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-300"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    View on Explorer
                  </a>
                )}
              </div>
            );
          })()}
        {sending && steps.length > 0 && <ProtocolStepper steps={steps} />}
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sendDisabled}
          className={`w-full py-2.5 px-4 rounded-lg text-sm font-medium btn-primary ${sending ? "loading" : ""}`}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
