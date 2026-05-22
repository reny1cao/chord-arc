/**
 * Circle Developer-Controlled Wallets thin wrapper.
 *
 * Wiring contract:
 *   const circle = createCircleClient();
 *   const sca = await getWalletAddress(circle, config.circle.walletId);
 *   const { txId } = await signAndSendContractCall(circle, {
 *     walletId, contractAddress: escrowAddress,
 *     abiSignature: "acceptMilestone(uint256,uint256)",
 *     abiParameters: [projectId.toString(), milestoneIndex.toString()],
 *   });
 *   const txHash = await waitForTxHash(circle, txId); // optional
 *
 * The SDK's `createContractExecutionTransaction` returns a Circle DB row id,
 * NOT an on-chain hash. The hash only appears after polling getTransaction
 * until the state advances to SENT/CONFIRMED. `waitForTxHash` does that polling.
 */
import {
  initiateDeveloperControlledWalletsClient,
  type CircleDeveloperControlledWalletsClient,
} from "@circle-fin/developer-controlled-wallets";
import { getAddress, type Address, type Hex } from "viem";
import { assertReadyForSigning, config } from "./config.js";

export type CircleClient = CircleDeveloperControlledWalletsClient;

/**
 * Construct a Circle SDK client from env-driven config.
 * Throws if CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET are missing.
 */
export function createCircleClient(): CircleClient {
  assertReadyForSigning();
  return initiateDeveloperControlledWalletsClient({
    apiKey: config.circle.apiKey,
    entitySecret: config.circle.entitySecret,
  });
}

/**
 * Fetch the on-chain address of the daemon's SCA. The Circle wallet record
 * stores `address` as a string — we normalize via viem's `getAddress` checksum.
 */
export async function getWalletAddress(client: CircleClient, walletId: string): Promise<Address> {
  const res = await client.getWallet({ id: walletId });
  const addr = res.data?.wallet?.address;
  if (!addr) throw new Error(`Circle wallet ${walletId} has no address (response shape unexpected)`);
  return getAddress(addr);
}

export interface SignAndSendOpts {
  walletId: string;
  contractAddress: Address;
  /**
   * Solidity-style function signature, e.g. `"acceptMilestone(uint256,uint256)"`.
   * Maps to the SDK's `abiFunctionSignature` field.
   */
  abiSignature: string;
  /**
   * ABI args — strings/numbers/booleans per the Circle SDK.
   * For uint256 args, pass decimal strings (bigints will not JSON-serialize).
   */
  abiParameters: unknown[];
  idempotencyKey?: string;
  refId?: string;
}

export interface SignAndSendResult {
  /** Circle internal transaction id (UUID). NOT an on-chain hash. */
  txId: string;
  /** Initial state reported by Circle, e.g. `INITIATED` / `QUEUED`. */
  state?: string;
}

/**
 * Submit a contract-execution transaction signed by the SCA.
 * Uses HIGH fee level by default — milestone settlement should not race.
 */
export async function signAndSendContractCall(
  client: CircleClient,
  opts: SignAndSendOpts,
): Promise<SignAndSendResult> {
  const res = await client.createContractExecutionTransaction({
    walletId: opts.walletId,
    contractAddress: getAddress(opts.contractAddress),
    abiFunctionSignature: opts.abiSignature,
    // SDK declares this as Array<any> — our caller boundary keeps it typed as unknown[].
    abiParameters: opts.abiParameters as unknown[],
    fee: {
      type: "level",
      config: { feeLevel: "HIGH" },
    },
    ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    ...(opts.refId ? { refId: opts.refId } : {}),
  });
  const txId = res.data?.id;
  if (!txId) throw new Error("Circle createContractExecutionTransaction returned no id");
  return { txId, state: res.data?.state };
}

export interface WaitForTxHashOpts {
  intervalMs?: number;
  timeoutMs?: number;
}

/**
 * Poll Circle's getTransaction until `txHash` is populated or the tx fails.
 * Returns the on-chain hash. Throws on terminal failure states or timeout.
 *
 * Default: 2 s interval, 120 s timeout. Override for testnets that take longer.
 */
export async function waitForTxHash(
  client: CircleClient,
  txId: string,
  opts: WaitForTxHashOpts = {},
): Promise<Hex> {
  const interval = opts.intervalMs ?? 2_000;
  const timeout = opts.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const res = await client.getTransaction({ id: txId });
    const tx = res.data?.transaction;
    if (tx?.txHash) return tx.txHash as Hex;
    const state = tx?.state;
    if (state === "FAILED" || state === "DENIED" || state === "CANCELLED") {
      throw new Error(`Circle tx ${txId} ended in state ${state}: ${tx?.errorReason ?? "unknown"}`);
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for Circle tx ${txId} hash after ${timeout}ms`);
}
