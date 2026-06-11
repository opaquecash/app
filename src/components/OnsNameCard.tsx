import { useCallback, useEffect, useMemo, useState } from "react";
import { ONS_DEPLOYMENTS } from "@opaquecash/deployments";
import type { OnsClaimStatus } from "@opaquecash/stealth-chain-solana";
import { useOpaqueSession } from "../opaque/useOpaqueSession";
import { useProtocolLog } from "../context/ProtocolLogContext";

const PARENT_NAME = ONS_DEPLOYMENTS[11155111]?.parentName ?? "opqtest.eth";
const LABEL_RE = /^[a-z0-9-]{1,63}$/;
const STORAGE_KEY = "opaque.ons.lastName";

type NameCheck =
  | { kind: "free" }
  | { kind: "yours"; meta: string }
  | { kind: "taken"; meta: string };

/**
 * Name a meta-address through ONS (spec/ONS.md): register from Ethereum
 * (immediately authoritative) or claim from Solana (provisional, shown as
 * "pending confirmation" until the canonical registry's mirror record lands).
 */
export function OnsNameCard() {
  const { client, isSetup, canActOn, metaAddress } = useOpaqueSession();
  const { push: logPush } = useProtocolLog();

  const [label, setLabel] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved?.endsWith(`.${PARENT_NAME}`)
      ? saved.slice(0, saved.length - PARENT_NAME.length - 1)
      : "";
  });
  const [check, setCheck] = useState<NameCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [claimStatus, setClaimStatus] = useState<OnsClaimStatus | null>(null);
  const [busy, setBusy] = useState<"register" | "claim" | "reconcile" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const normalizedLabel = label.trim().toLowerCase();
  const fullName = normalizedLabel ? `${normalizedLabel}.${PARENT_NAME}` : "";
  const labelValid = LABEL_RE.test(normalizedLabel) && !normalizedLabel.startsWith("-") && !normalizedLabel.endsWith("-");

  const refresh = useCallback(async () => {
    if (!client || !fullName || !labelValid) {
      setCheck(null);
      setClaimStatus(null);
      return;
    }
    setChecking(true);
    setError(null);
    try {
      let resolved: string | null = null;
      try {
        resolved = (await client.resolveRecipient(fullName)).metaAddressHex;
      } catch {
        resolved = null; // unregistered
      }
      setCheck(
        resolved == null
          ? { kind: "free" }
          : resolved.toLowerCase() === metaAddress?.toLowerCase()
            ? { kind: "yours", meta: resolved }
            : { kind: "taken", meta: resolved },
      );
      // Claim state only exists when Solana reads are available.
      try {
        setClaimStatus(await client.getOpaqueNameStatus(fullName));
      } catch {
        setClaimStatus(null);
      }
    } finally {
      setChecking(false);
    }
  }, [client, fullName, labelValid, metaAddress]);

  // Check on input settle; re-poll every 60s while a claim is pending.
  useEffect(() => {
    if (!fullName) return;
    const t = setTimeout(refresh, 500);
    return () => clearTimeout(t);
  }, [fullName, refresh]);

  useEffect(() => {
    if (claimStatus?.state !== "pending") return;
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [claimStatus?.state, refresh]);

  const remember = useCallback((name: string) => {
    localStorage.setItem(STORAGE_KEY, name);
  }, []);

  const handleRegister = async () => {
    if (!client || !fullName) return;
    setBusy("register");
    setError(null);
    setNotice(null);
    try {
      const txHash = await client.registerOpaqueName(normalizedLabel);
      remember(fullName);
      setNotice(`Registered ${fullName} on Ethereum (authoritative). Tx ${txHash.slice(0, 18)}…`);
      logPush("blockchain", `ONS register ${fullName}: ${txHash.slice(0, 18)}…`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleClaim = async () => {
    if (!client || !fullName) return;
    setBusy("claim");
    setError(null);
    setNotice(null);
    try {
      const { signature } = await client.claimOpaqueName(normalizedLabel);
      remember(fullName);
      setNotice(
        `Provisional claim sent for ${fullName}. It becomes yours only when Ethereum confirms — watch the badge below.`,
      );
      logPush("blockchain", `ONS claim ${fullName}: ${signature.slice(0, 18)}…`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Claim failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleReconcile = async () => {
    if (!client || !fullName) return;
    setBusy("reconcile");
    setError(null);
    try {
      await client.reconcileOpaqueName(fullName);
      setNotice("Provisional claim closed; rent refunded to the claimer.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reconcile failed.");
    } finally {
      setBusy(null);
    }
  };

  const claimBadge = useMemo(() => {
    switch (claimStatus?.state) {
      case "pending":
        return {
          cls: "bg-amber-500/15 text-amber-300 border-amber-500/40",
          text: "Pending confirmation (~20–40 min) — not yours yet",
        };
      case "confirmed":
        return {
          cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
          text: "Confirmed on Ethereum",
        };
      case "lost":
        return {
          cls: "bg-red-500/15 text-red-300 border-red-500/40",
          text: "Lost — the name was registered directly on Ethereum first",
        };
      case "expired":
        return {
          cls: "bg-ink-700/40 text-mist border-ink-600",
          text: "Claim expired (no confirmation within 24 h) — reconcile and retry",
        };
      default:
        return null;
    }
  }, [claimStatus?.state]);

  if (!isSetup) return null;

  return (
    <div className="mt-4 rounded-2xl border border-ink-700 bg-ink-900/25 p-5">
      <span className="inline-flex items-center rounded-lg bg-sol-purple-muted/30 px-2 py-1 text-[11px] font-medium text-sol-purple mb-3">
        ONS
      </span>
      <span className="font-display text-base font-bold text-white block mb-1.5">
        Name your meta-address
      </span>
      <p className="text-sm text-mist leading-relaxed mb-4">
        Claim <span className="font-mono text-white/80">name.{PARENT_NAME}</span> once and senders
        on both Ethereum and Solana resolve it to your meta-address. Ethereum registrations are
        immediately authoritative; Solana claims stay provisional until Ethereum confirms.
      </p>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="alice"
          className="input-field flex-1"
        />
        <span className="text-sm text-mist whitespace-nowrap">.{PARENT_NAME}</span>
      </div>

      {normalizedLabel && !labelValid && (
        <p className="mt-2 text-xs text-error">
          Labels are 1–63 lowercase letters, digits, or hyphens (no leading/trailing hyphen).
        </p>
      )}
      {checking && <p className="mt-2 text-xs text-neutral-600">Checking…</p>}
      {!checking && check?.kind === "yours" && (
        <p className="mt-2 text-xs text-success">{fullName} resolves to your meta-address.</p>
      )}
      {!checking && check?.kind === "taken" && !claimBadge && (
        <p className="mt-2 text-xs text-error">{fullName} is taken.</p>
      )}
      {!checking && check?.kind === "free" && (
        <p className="mt-2 text-xs text-mist">{fullName} is available.</p>
      )}

      {claimBadge && (
        <div className={`mt-3 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${claimBadge.cls}`}>
          {claimStatus?.state === "pending" && (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" />
          )}
          {claimBadge.text}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleRegister}
          disabled={!labelValid || busy != null || check?.kind !== "free" || !canActOn("ethereum")}
          className="rounded-xl bg-sol-gradient px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === "register" ? "Registering…" : "Register on Ethereum"}
        </button>
        <button
          type="button"
          onClick={handleClaim}
          disabled={!labelValid || busy != null || check?.kind !== "free" || !canActOn("solana")}
          className="rounded-xl border border-ink-600 bg-ink-950/30 px-3.5 py-2 text-sm font-medium text-mist transition-colors hover:border-sol-purple/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === "claim" ? "Claiming…" : "Claim from Solana"}
        </button>
        {claimStatus?.claim && claimStatus.state !== "pending" && (
          <button
            type="button"
            onClick={handleReconcile}
            disabled={busy != null || !canActOn("solana")}
            className="rounded-xl border border-ink-600 bg-ink-950/30 px-3.5 py-2 text-sm font-medium text-mist transition-colors hover:border-sol-purple/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === "reconcile" ? "Reconciling…" : "Reconcile claim"}
          </button>
        )}
      </div>

      {notice && <p className="mt-3 text-xs text-success">{notice}</p>}
      {error && <p className="mt-3 text-xs text-error break-all">{error}</p>}
    </div>
  );
}
