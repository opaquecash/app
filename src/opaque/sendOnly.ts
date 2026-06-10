/**
 * A send-only `OpaqueClient` for flows where the payer has no Opaque identity (the public
 * `/pay/:metaAddress` page). `sendStealthPayment` only uses the recipient's meta-address plus the
 * payer's connected wallet — Solana, Ethereum, or both — so the client's own derived keys are
 * irrelevant: we seed them from a fixed placeholder signature and skip the WASM module (send is
 * pure DKSAP + transaction building).
 */

import { OpaqueClient } from "@opaquecash/opaque";
import type { Address, Hex } from "viem";
import type { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  PLACEHOLDER_EVM_ADDRESS,
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
  // The app and the file:-linked SDK resolve separate copies of viem; cast the WalletClient
  // across that one nominal-type boundary.
  const ethereumWalletClient = (params.ethereum?.walletClient ?? undefined) as Parameters<
    typeof OpaqueClient.create
  >[0]["ethereumWalletClient"];
  return OpaqueClient.create({
    chainId: SEPOLIA_CHAIN_ID,
    rpcUrl: SEPOLIA_RPC_URL,
    walletSignature: SEND_ONLY_SIGNATURE,
    ethereumAddress: (params.ethereum?.address ?? PLACEHOLDER_EVM_ADDRESS) as Address,
    solana: {
      cluster: SOLANA_CLUSTER,
      rpcUrl: SOLANA_RPC_URL,
      ...(params.solana ? { connection: params.solana.connection } : {}),
    },
    ethereumWalletClient,
    solanaWallet: params.solana
      ? { publicKey: params.solana.publicKey, signTransaction: params.solana.signTransaction }
      : undefined,
  });
}
