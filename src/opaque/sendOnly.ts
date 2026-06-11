/**
 * A send-only `OpaqueClient` for flows where the payer has no Opaque identity (the public
 * `/pay/:metaAddress` page). `sendStealthPayment` only uses the recipient's meta-address plus the
 * payer's connected wallet — Solana, Ethereum, or both — so the client's own derived keys are
 * irrelevant: we seed them from a fixed placeholder signature and skip the WASM module (send is
 * pure DKSAP + transaction building).
 */

import {
  OpaqueClient,
  type EvmUnifiedSigner,
  type SolanaUnifiedSigner,
  type UnifiedSigner,
} from "@opaquecash/opaque";
import type { Address, Hex } from "viem";
import type { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  SEPOLIA_CHAIN_ID,
  SEPOLIA_RPC_URL,
  SOLANA_CLUSTER,
  SOLANA_RPC_URL,
} from "./config";

const SEND_ONLY_SIGNATURE = ("0x" + "11".repeat(65)) as Hex;

export function createSendOnlyClient(params: {
  solana?: {
    connection: Connection;
    publicKey: PublicKey;
    signTransaction: (tx: Transaction) => Promise<Transaction>;
  };
  ethereum?: {
    address: Address;
    walletClient: unknown;
  };
}): Promise<OpaqueClient> {
  if (!params.solana && !params.ethereum) {
    throw new Error("createSendOnlyClient: connect a Solana or Ethereum wallet first.");
  }
  // The app and the file:-linked SDK resolve separate copies of viem / @solana/web3.js;
  // cast across that one nominal-type boundary.
  const wallets: UnifiedSigner[] = [
    ...(params.ethereum
      ? [
          {
            chain: "ethereum",
            address: params.ethereum.address,
            walletClient: params.ethereum.walletClient,
          } as EvmUnifiedSigner,
        ]
      : []),
    ...(params.solana
      ? [
          {
            chain: "solana",
            publicKey: params.solana.publicKey,
            signTransaction: params.solana.signTransaction,
          } as unknown as SolanaUnifiedSigner,
        ]
      : []),
  ];
  return OpaqueClient.fromWallet({
    wallets,
    // Fixed placeholder: send-only flows never use the client's own derived keys.
    walletSignature: SEND_ONLY_SIGNATURE,
    chainId: SEPOLIA_CHAIN_ID,
    rpcUrl: SEPOLIA_RPC_URL,
    solana: {
      cluster: SOLANA_CLUSTER,
      rpcUrl: SOLANA_RPC_URL,
      ...(params.solana ? { connection: params.solana.connection } : {}),
    },
  });
}
