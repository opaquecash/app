/**
 * Broadcast a Starknet stealth sweep from the reconstructed one-time key.
 *
 * The recipient owns a counterfactual `StealthAccount`. Sweeping is two Starknet v3
 * transactions, both paid from the account's OWN STRK balance (no user wallet needed):
 *   1. `deploy_account` — brings the account on-chain (its secp256k1 `__validate_deploy__`
 *      is L2-gas-heavy, so we set explicit resource bounds).
 *   2. `execute(transferCall)` — moves the funds to the destination.
 *
 * This mirrors the flow validated on Sepolia (spec/starknet-integration.md §7.1). Because
 * the account self-funds its deploy fee, a dust balance cannot be swept — we detect that
 * up front and surface it rather than letting the deploy revert.
 */
import { Account, EthSigner, RpcProvider } from "starknet";

/** The shape returned by `OpaqueClient.buildStarknetSweep`. */
export interface StarknetSweep {
  signerPrivateKey: Uint8Array;
  address: string;
  salt: bigint;
  classHash: string;
  constructorCalldata: bigint[];
  transferCall: { contractAddress: string; entrypoint: string; calldata: string[] };
}

const toHex = (bytes: Uint8Array): string =>
  "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** A v3 resource-bound entry: cap the amount, and the max price per unit (both felts). */
type Bound = { max_amount: bigint; max_price_per_unit: bigint };
type ResourceBounds = { l1_gas: Bound; l2_gas: Bound; l1_data_gas: Bound };

/** Read the latest block's gas prices (in fri = STRK base units). */
async function currentGasPrices(provider: RpcProvider): Promise<{
  l1: bigint;
  l2: bigint;
  l1Data: bigint;
}> {
  const block = (await provider.getBlockWithTxHashes("latest")) as unknown as {
    l1_gas_price: { price_in_fri: string };
    l2_gas_price: { price_in_fri: string };
    l1_data_gas_price: { price_in_fri: string };
  };
  return {
    l1: BigInt(block.l1_gas_price.price_in_fri),
    l2: BigInt(block.l2_gas_price.price_in_fri),
    l1Data: BigInt(block.l1_data_gas_price.price_in_fri),
  };
}

// EVERY tx from this account runs a secp256k1 signature check in its validate entry point
// (__validate_deploy__ for the deploy, __validate__ for the transfer), which alone consumes
// ~25M L2 gas — so the transfer is NOT cheap and needs the same L2 budget as the deploy.
// Under-provisioning EITHER the L2 amount or the L1 price surfaces as validate "Out of gas".
// These amounts + PRICE FLOORS are the profile validated on Sepolia, kept as a floor so a
// gas-price spike scales us up without ever dropping below what provably works.
const DEPLOY_L2_AMOUNT = 25_000_000n;
const TRANSFER_L2_AMOUNT = 25_000_000n;
const L1_AMOUNT = 256n;
const L1_DATA_AMOUNT = 4096n;
const L1_PRICE_FLOOR = 450_000_000_000_000n;
const L2_PRICE_FLOOR = 46_000_000_000n;
const L1_DATA_PRICE_FLOOR = 1_600_000_000_000n;

const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** Bounds using the validated price profile as a floor (scaled up on a price spike). */
function boundsFor(prices: { l1: bigint; l2: bigint; l1Data: bigint }, l2Amount: bigint): ResourceBounds {
  return {
    l1_gas: { max_amount: L1_AMOUNT, max_price_per_unit: max(L1_PRICE_FLOOR, prices.l1 * 3n) },
    l2_gas: { max_amount: l2Amount, max_price_per_unit: max(L2_PRICE_FLOOR, prices.l2 * 3n / 2n) },
    l1_data_gas: {
      max_amount: L1_DATA_AMOUNT,
      max_price_per_unit: max(L1_DATA_PRICE_FLOOR, prices.l1Data * 3n),
    },
  };
}

/** Maximum fee this bound set can charge (Starknet requires `balance >= this`). */
function capOf(b: ResourceBounds): bigint {
  return (
    b.l1_gas.max_amount * b.l1_gas.max_price_per_unit +
    b.l2_gas.max_amount * b.l2_gas.max_price_per_unit +
    b.l1_data_gas.max_amount * b.l1_data_gas.max_price_per_unit
  );
}

export interface StarknetSweepResult {
  deployTx: string;
  transferTx: string;
}

/**
 * Deploy the stealth account and sweep it to `sweep.transferCall`'s destination.
 * `balance` is the account's STRK balance (used to size fee bounds). Returns both tx
 * hashes; the transfer hash is what the UI links.
 */
export async function broadcastStarknetSweep(
  sweep: StarknetSweep,
  balance: bigint,
  rpcUrl: string,
): Promise<StarknetSweepResult> {
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const prices = await currentGasPrices(provider);

  const deployBounds = boundsFor(prices, DEPLOY_L2_AMOUNT);
  const transferBounds = boundsFor(prices, TRANSFER_L2_AMOUNT);
  // deploy_account runs first with the full balance; Starknet checks `balance >=
  // Σ(max_amount·max_price)` for it, and the amount must exceed actual consumption. So the
  // binding constraint is that the balance covers the deploy ceiling. If it can't, the
  // payment is dust that no paymaster-free sweep can move.
  if (balance < capOf(deployBounds)) {
    throw new Error(
      "Balance is too low to cover the Starknet deploy_account fee — this stealth output " +
        "cannot be swept without a paymaster.",
    );
  }

  const signer = new EthSigner(toHex(sweep.signerPrivateKey));
  const account = new Account({ provider, address: sweep.address, signer });

  const deploy = await account.deployAccount(
    {
      classHash: sweep.classHash,
      constructorCalldata: sweep.constructorCalldata.map((x) => x.toString()),
      addressSalt: "0x" + sweep.salt.toString(16),
      contractAddress: sweep.address,
    },
    { resourceBounds: deployBounds },
  );
  await provider.waitForTransaction(deploy.transaction_hash);

  const transfer = await account.execute(sweep.transferCall, {
    resourceBounds: transferBounds,
  });
  await provider.waitForTransaction(transfer.transaction_hash);

  return { deployTx: deploy.transaction_hash, transferTx: transfer.transaction_hash };
}
