/**
 * Solana program IDs used by the frontend, sourced from the generated
 * `@opaquecash/deployments` registry (regenerate with `npm run generate` in the
 * `solana` repo after an `anchor deploy`).
 */

import { requireSolanaProgramIds } from "@opaquecash/deployments";

const devnet = requireSolanaProgramIds("devnet");

export const deployedAddresses = {
  cluster: "devnet",
  stealthRegistry: devnet.stealthRegistry,
  stealthAnnouncer: devnet.stealthAnnouncer,
  groth16Verifier: devnet.groth16Verifier,
  reputationVerifier: devnet.reputationVerifier,
  schemaRegistry: devnet.schemaRegistry,
  attestationEngineV2: devnet.attestationEngineV2,
} as const;

export type DeployedAddresses = typeof deployedAddresses;
