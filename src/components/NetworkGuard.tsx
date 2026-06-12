import type { ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { getCluster } from "../lib/chain";
import { isClusterSupported } from "../contracts/contract-config";
import { SEPOLIA_CHAIN_ID } from "../opaque/config";

type NetworkGuardProps = {
  children: ReactNode;
};

export function NetworkGuard({ children }: NetworkGuardProps) {
  const cluster = getCluster();
  const showUnsupported = !isClusterSupported(cluster);
  const { address: ethAddress, chainId: ethChainId } = useAccount();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();
  const wrongEvmNetwork = ethAddress != null && ethChainId !== SEPOLIA_CHAIN_ID;

  if (!showUnsupported && !wrongEvmNetwork) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="network-guard-title"
      >
        <div className="max-w-md w-full">
          {showUnsupported ? (
            <div className="card text-center">
              <h2 id="network-guard-title" className="text-lg font-semibold text-white mb-2">
                Unsupported cluster
              </h2>
              <p className="text-sm text-neutral-400">
                Opaque supports devnet only. Set VITE_SOLANA_CLUSTER=devnet in your environment to continue.
              </p>
            </div>
          ) : (
            <div className="card text-center">
              <h2 id="network-guard-title" className="text-lg font-semibold text-white mb-2">
                Wrong Ethereum network
              </h2>
              <p className="text-sm text-neutral-400">
                Your Ethereum wallet is connected to another network. Opaque runs on Sepolia —
                switch to continue Ethereum-side actions.
              </p>
              <button
                type="button"
                onClick={() => switchChain({ chainId: SEPOLIA_CHAIN_ID })}
                disabled={isSwitching}
                className="mt-4 w-full rounded-xl bg-sol-gradient px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-95 disabled:opacity-50"
              >
                {isSwitching ? "Switching…" : "Switch to Sepolia"}
              </button>
              {switchError && (
                <p className="mt-3 text-xs text-red-300">
                  Switch failed or was rejected — change the network manually in your wallet.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
