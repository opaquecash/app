/**
 * Onboarding wizard shown when the user has derived keys but their meta-address is not yet
 * registered on every connected chain. Step 1: Info -> Step 2: Register on-chain (via
 * `OpaqueClient.registerMetaAddress`, once per connected unregistered chain) with per-chain
 * progress. Chains without a connected wallet are skipped. On success: "Vault Unlocked"
 * animation, then onComplete() to transition to dashboard.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getCluster } from "../lib/chain";
import { useOpaqueSession, type OpaqueChain } from "../opaque/useOpaqueSession";
import type { RegistrationByChain } from "../hooks/useRegistrationStatus";
import { isClusterSupported } from "../contracts/contract-config";

type Step = "info" | "register" | "success";
type ChainPhase = "pending" | "registering" | "done" | "error";

const CHAIN_LABEL: Record<OpaqueChain, string> = {
  ethereum: "Ethereum (Sepolia)",
  solana: "Solana",
  starknet: "Starknet (Sepolia)",
};

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value == null) return "Unknown error";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export type RegistrationWizardProps = {
  /** Registration status per connected chain (from useRegistrationStatus). */
  byChain: RegistrationByChain;
  onComplete: () => void;
};

export function RegistrationWizard({ byChain, onComplete }: RegistrationWizardProps) {
  const { client, connectedChains } = useOpaqueSession();
  const cluster = getCluster();
  const [step, setStep] = useState<Step>("info");
  const [phaseByChain, setPhaseByChain] = useState<Partial<Record<OpaqueChain, ChainPhase>>>({});
  const [error, setError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  const wrongSolanaCluster = !isClusterSupported(cluster);
  // Register on each connected chain that is not yet registered.
  const chainsToRegister = connectedChains.filter(
    (c) => byChain[c] !== true && !(c === "solana" && wrongSolanaCluster),
  );
  const registeredChains = connectedChains.filter((c) => byChain[c] === true);

  const handleRegister = async () => {
    if (!client) {
      setError("Session not ready. Reconnect your wallet.");
      return;
    }
    setError(null);
    setRegistering(true);
    let anyError = false;
    for (const chain of chainsToRegister) {
      if (phaseByChain[chain] === "done") continue;
      setPhaseByChain((p) => ({ ...p, [chain]: "registering" }));
      try {
        await client.registerMetaAddress(chain);
        setPhaseByChain((p) => ({ ...p, [chain]: "done" }));
      } catch (e) {
        anyError = true;
        setPhaseByChain((p) => ({ ...p, [chain]: "error" }));
        setError(`${CHAIN_LABEL[chain]}: ${toErrorMessage(e) || "Registration failed"}`);
      }
    }
    setRegistering(false);
    if (!anyError) {
      setStep("success");
      setTimeout(() => {
        onComplete();
      }, 1800);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto">
      <AnimatePresence mode="wait">
        {step === "success" ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="card flex flex-col items-center justify-center py-12 px-6 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="w-20 h-20 rounded-2xl bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center mb-6"
              aria-hidden
            >
              <svg
                className="w-10 h-10 text-emerald-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                />
              </svg>
            </motion.div>
            <h2 className="text-xl font-semibold text-white mb-1">Vault Unlocked</h2>
            <p className="text-sm text-neutral-500">Taking you to your dashboard…</p>
          </motion.div>
        ) : (
          <motion.div
            key="wizard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="card"
          >
            <h2 className="text-lg font-semibold text-white mb-1">Registration required</h2>

            {step === "info" && (
              <div className="space-y-4">
                <p className="text-sm text-neutral-400 leading-relaxed">
                  Your meta-address is not yet registered on every connected chain. Publishing it
                  lets others send you private payments by your wallet address. This is a one-time
                  setup per chain, and only chains you have connected are included.
                </p>
                <button
                  type="button"
                  onClick={() => setStep("register")}
                  className="w-full py-3 px-4 rounded-lg text-sm font-medium btn-primary"
                >
                  Continue
                </button>
                <button
                  type="button"
                  onClick={onComplete}
                  className="w-full py-2 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  Skip for now
                </button>
              </div>
            )}

            {step === "register" && (
              <div className="space-y-4 mb-0">
                {wrongSolanaCluster && connectedChains.includes("solana") && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                    <p className="text-sm text-amber-200">
                      Solana registration is available on devnet only; it will be skipped on this
                      cluster.
                    </p>
                  </div>
                )}
                <p className="text-sm text-neutral-400">
                  Publish your Stealth Meta-Address on-chain so others can send to you by your
                  wallet address.
                </p>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <div className="space-y-2">
                  {registeredChains.map((chain) => (
                    <div key={chain} className="flex items-center gap-2 text-sm text-emerald-500/80">
                      <span className="text-emerald-500" aria-hidden>✓</span>
                      {CHAIN_LABEL[chain]} — already registered
                    </div>
                  ))}
                  {chainsToRegister.map((chain) => {
                    const phase = phaseByChain[chain] ?? "pending";
                    return (
                      <div
                        key={chain}
                        className={`flex items-center gap-2 text-sm ${
                          phase === "registering"
                            ? "text-white"
                            : phase === "done"
                              ? "text-emerald-500/80"
                              : phase === "error"
                                ? "text-red-400"
                                : "text-neutral-500"
                        }`}
                      >
                        {phase === "done" ? (
                          <span className="text-emerald-500" aria-hidden>✓</span>
                        ) : phase === "registering" ? (
                          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
                        ) : phase === "error" ? (
                          <span aria-hidden>✕</span>
                        ) : (
                          <span className="w-4 h-4 rounded-full border border-neutral-600" aria-hidden />
                        )}
                        {CHAIN_LABEL[chain]}
                      </div>
                    );
                  })}
                  {chainsToRegister.length === 0 && (
                    <p className="text-sm text-neutral-500">
                      Nothing to register on the connected chains.
                    </p>
                  )}
                </div>
                {!registering && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleRegister()}
                      disabled={!client || chainsToRegister.length === 0}
                      className="w-full py-3 px-4 rounded-lg text-sm font-medium btn-primary disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                    >
                      Register on {chainsToRegister.map((c) => CHAIN_LABEL[c]).join(" + ") || "chain"}
                    </button>
                    <button
                      type="button"
                      onClick={onComplete}
                      className="w-full py-2 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                    >
                      Skip for now
                    </button>
                  </>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
