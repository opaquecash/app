import { useEffect, useState } from "react";
import { useConnectedWallets } from "../hooks/useConnectedWallets";
import { useOpaqueSession } from "../opaque/useOpaqueSession";
import type { DerivationSource } from "../opaque/store";
import {
  getRememberSignaturePreference,
  setRememberSignaturePreference,
} from "../lib/signatureSession";

type Phase = "idle" | "deriving" | "error";

function shorten(value: string, lead = 6, tail = 6): string {
  return value.length <= lead + tail + 1 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

function WalletRow({
  label,
  sublabel,
  connected,
  address,
  connecting,
  onConnect,
  onDisconnect,
}: {
  label: string;
  sublabel: string;
  connected: boolean;
  address: string | null;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-900/40 px-4 py-3">
      <div className="min-w-0 text-left">
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-xs text-mist truncate">
          {connected && address ? shorten(address) : sublabel}
        </p>
      </div>
      {connected ? (
        <button
          type="button"
          onClick={onDisconnect}
          className="shrink-0 rounded-lg border border-ink-600 bg-ink-950/40 px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-sol-purple/30 hover:text-white"
        >
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={connecting}
          className="shrink-0 rounded-lg bg-sol-gradient px-3 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-95 disabled:opacity-50"
        >
          {connecting ? "Connecting…" : "Connect"}
        </button>
      )}
    </div>
  );
}

export function LandingView() {
  const {
    isSetup,
    entered,
    setEntered,
    connect: deriveSession,
    status,
    metaAddress,
    derivationSource,
  } = useOpaqueSession();
  const wallets = useConnectedWallets();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<DerivationSource | null>(null);
  const [rememberSession, setRememberSession] = useState<boolean>(() =>
    getRememberSignaturePreference(),
  );

  useEffect(() => {
    setRememberSignaturePreference(rememberSession);
  }, [rememberSession]);

  // Auto-pick the derivation wallet when exactly one is connected; with both connected the
  // choice is the user's (different wallets sign SETUP_MESSAGE differently → different keys).
  useEffect(() => {
    const sol = wallets.solana.connected;
    const eth = wallets.ethereum.connected;
    if (sol && !eth) setSource("solana");
    else if (eth && !sol) setSource("ethereum");
    else if (!sol && !eth) setSource(null);
    else setSource((prev) => prev);
  }, [wallets.solana.connected, wallets.ethereum.connected]);

  const handleConnectSolana = async () => {
    setError(null);
    if (wallets.solana.wallets.length === 0) {
      setError("No Solana wallet found. Install Phantom or Solflare.");
      setPhase("error");
      return;
    }
    try {
      await wallets.solana.connect();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect Solana wallet");
      setPhase("error");
    }
  };

  const handleConnectEthereum = async () => {
    setError(null);
    try {
      await wallets.ethereum.connect();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect Ethereum wallet. Is MetaMask installed?");
      setPhase("error");
    }
  };

  const handleDerive = async () => {
    if (!source) return;
    setError(null);
    setPhase("deriving");
    try {
      // Builds the OpaqueClient (sign or restore cached signature, derive keys, load scanner).
      await deriveSession({ derivationSource: source, remember: rememberSession });
      setPhase("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
      setPhase("error");
    }
  };

  if (isSetup && entered) return null;

  // Keys derived — show the meta-address before entering the app.
  if (isSetup && metaAddress) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-5 sm:px-8 py-16">
        <div className="w-full max-w-md text-center">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">
            Your stealth identity
          </h1>
          <p className="mt-3 text-sm text-mist">
            Derived from your {derivationSource === "ethereum" ? "Ethereum" : "Solana"} wallet
            signature, on-device. Share this meta-address to receive private payments on either
            chain.
          </p>
          <div className="mt-6 rounded-xl border border-ink-700 bg-ink-900/40 px-4 py-3">
            <p className="font-mono text-xs text-white break-all">{metaAddress}</p>
          </div>
          <button
            type="button"
            onClick={() => setEntered(true)}
            className="mt-6 w-full rounded-xl bg-sol-gradient px-6 py-3.5 text-sm font-semibold text-white transition-all hover:shadow-[0_0_32px_rgba(153,69,255,0.3)] hover:scale-[1.02] active:scale-[0.98]"
          >
            Continue to app
          </button>
        </div>
      </div>
    );
  }

  const bothConnected = wallets.solana.connected && wallets.ethereum.connected;
  const deriving = phase === "deriving";

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 sm:px-8 py-16">
      <div className="w-full max-w-md text-center">
        <h1 className="font-display text-5xl font-extrabold tracking-tight text-white sm:text-6xl">
          Opaque<span className="text-sol-gradient">.</span>
        </h1>

        <p className="mt-4 text-mist">
          Connect an Ethereum or Solana wallet — or both — and derive stealth keys to begin. Keys
          are generated on-device and never leave your browser.
        </p>

        <div className="mt-8 space-y-3 text-left">
          <WalletRow
            label="Ethereum"
            sublabel="MetaMask or any injected wallet (Sepolia)"
            connected={wallets.ethereum.connected}
            address={wallets.ethereum.address}
            connecting={wallets.ethereum.connecting}
            onConnect={() => void handleConnectEthereum()}
            onDisconnect={() => wallets.ethereum.disconnect()}
          />
          <WalletRow
            label="Solana"
            sublabel="Phantom or Solflare"
            connected={wallets.solana.connected}
            address={wallets.solana.address}
            connecting={wallets.solana.connecting}
            onConnect={() => void handleConnectSolana()}
            onDisconnect={() => wallets.solana.disconnect()}
          />
        </div>

        {bothConnected && (
          <div className="mt-5 rounded-xl border border-ink-700 bg-ink-900/30 px-4 py-3 text-left">
            <p className="text-xs font-semibold text-white mb-2">Derive stealth keys from</p>
            <div className="flex gap-4">
              {(["ethereum", "solana"] as const).map((c) => (
                <label key={c} className="inline-flex items-center gap-2 text-xs text-mist cursor-pointer select-none">
                  <input
                    type="radio"
                    name="derivation-source"
                    checked={source === c}
                    onChange={() => setSource(c)}
                    className="h-3.5 w-3.5 accent-sol-purple"
                  />
                  {c === "ethereum" ? "Ethereum wallet" : "Solana wallet"}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-mist/70">
              Each wallet signature derives a different key set (a different meta-address). Pick
              the wallet that holds your Opaque identity.
            </p>
          </div>
        )}

        {!deriving && (
          <>
            <button
              type="button"
              onClick={() => void handleDerive()}
              disabled={!wallets.anyConnected || !source}
              className="mt-6 w-full rounded-xl bg-sol-gradient px-6 py-3.5 text-sm font-semibold text-white transition-all hover:shadow-[0_0_32px_rgba(153,69,255,0.3)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {wallets.anyConnected ? "Sign & derive stealth keys" : "Connect a wallet to begin"}
            </button>
            <label className="mt-3 inline-flex items-center gap-2 text-xs text-mist cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberSession}
                onChange={(e) => setRememberSession(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-ink-600 bg-ink-900 accent-sol-purple"
              />
              Remember signature for this tab (about 30 minutes)
            </label>
          </>
        )}

        {deriving && (
          <div className="mt-8 flex flex-col items-center gap-3">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-600 border-t-sol-purple" />
            <p className="text-sm text-mist">{status ?? "Deriving your stealth keys…"}</p>
          </div>
        )}

        {phase === "error" && error && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-950/20 px-4 py-3 text-left text-sm text-red-200">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
