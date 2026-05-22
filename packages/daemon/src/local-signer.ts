/**
 * Local private-key signer — Hardhat/anvil counterpart to `circle.ts`.
 *
 * Mirrors the Circle surface so `index.ts` can branch on signer choice once at
 * boot and then call the same method names everywhere:
 *
 *   const local = createLocalClient();
 *   const addr  = await getWalletAddress(local);
 *   const { txId } = await signAndSendContractCall(local, opts);
 *   const hash = await waitForTxHash(local, txId);
 *
 * Differences from the Circle path:
 *   - `txId` IS the on-chain hash (we sign + send synchronously via viem). The
 *     Circle SDK returns a Circle DB row id, then polls — here there's no DB.
 *   - `idempotencyKey` is logged only; the local chain has no dedup table. A
 *     local rerun WILL produce a fresh tx. That's fine for smoke testing.
 *   - We auto-detect chain id from the RPC and build a one-shot viem `Chain`
 *     object — using `arcTestnet` (id 5042002) against Hardhat (id 31337) would
 *     trip viem's ChainMismatchError on every `sendTransaction`.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { chordEscrowAbi } from "./chord-escrow-abi.js";
import { config } from "./config.js";
import type { SignAndSendOpts, SignAndSendResult, WaitForTxHashOpts } from "./circle.js";

export interface LocalClient {
  account: PrivateKeyAccount;
  wallet: WalletClient;
  publicClient: PublicClient;
  rpcUrl: string;
  chainId: number;
}

function normalizePrivateKey(raw: string): Hex {
  const trimmed = raw.trim();
  const hex = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "CHORD_LOCAL_PRIVATE_KEY must be a 32-byte hex string (64 hex chars), with or without 0x prefix",
    );
  }
  return `0x${hex.toLowerCase()}` as Hex;
}

/**
 * Build a local-mode client. Reads the private key from
 * `CHORD_LOCAL_PRIVATE_KEY` (or `opts.privateKey` for tests) and probes the RPC
 * for its chain id so the resulting WalletClient can sign + send safely.
 *
 * NB: this is async because we have to talk to the RPC to discover the chain id
 * before constructing the WalletClient. Callers should `await` it during boot.
 */
export async function createLocalClient(opts: { privateKey?: string; rpcUrl?: string } = {}): Promise<LocalClient> {
  const keyRaw = opts.privateKey ?? config.localPrivateKey ?? process.env.CHORD_LOCAL_PRIVATE_KEY ?? "";
  if (!keyRaw) {
    throw new Error("CHORD_LOCAL_PRIVATE_KEY is required for local signing mode");
  }
  const privateKey = normalizePrivateKey(keyRaw);
  const account = privateKeyToAccount(privateKey);

  const rpcUrl = opts.rpcUrl ?? config.arcRpcUrl;

  // Probe the live chain id so the WalletClient's chain matches the connected
  // node. Otherwise viem rejects sendTransaction with ChainMismatchError.
  const idProbe = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await idProbe.getChainId();

  const chain = defineChain({
    id: chainId,
    name: chainId === 31337 ? "Hardhat" : chainId === config.arcChainId ? "Arc Testnet" : `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  });

  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  return { account, wallet, publicClient, rpcUrl, chainId };
}

/**
 * Return the signer's checksummed address. The `_client` arg is the LocalClient
 * the caller already created — kept positional to mirror the Circle signature
 * `getWalletAddress(client, walletId)`. We accept and ignore a second arg so
 * `index.ts` doesn't have to special-case the call.
 */
export function getWalletAddress(client: LocalClient, _walletId?: string): Promise<Address> {
  return Promise.resolve(getAddress(client.account.address));
}

/**
 * Sign + broadcast a contract call against the daemon's own ABI. Encodes
 * calldata via `encodeFunctionData` from `chordEscrowAbi`, so the
 * `abiSignature` field is used only for routing — we map it to the matching
 * function name on the ABI.
 */
export async function signAndSendContractCall(
  client: LocalClient,
  opts: SignAndSendOpts,
): Promise<SignAndSendResult> {
  const functionName = opts.abiSignature.split("(")[0];
  if (!functionName) {
    throw new Error(`local-signer: cannot parse function name from "${opts.abiSignature}"`);
  }
  // Sanity: ensure the function lives on our ABI. Reverts in viem when name is
  // unknown are cryptic, so fail loudly here.
  const known = chordEscrowAbi.some(
    item => item.type === "function" && (item as { name?: string }).name === functionName,
  );
  if (!known) {
    throw new Error(`local-signer: unknown function "${functionName}" — not in chord-escrow-abi.ts`);
  }

  const data = encodeFunctionData({
    abi: chordEscrowAbi,
    functionName: functionName as "acceptMilestone" | "submitMilestone",
    // Cast: the SDK's any[] passes through to viem's strict ABI-typed args.
    args: opts.abiParameters as never,
  });

  if (opts.idempotencyKey) {
    // No on-chain dedup, but log so reruns are recognizable in stdout.
    console.log(`[chord:local] sending ${functionName} idem=${opts.idempotencyKey}`);
  }

  const txHash = await client.wallet.sendTransaction({
    account: client.account,
    chain: client.wallet.chain,
    to: getAddress(opts.contractAddress),
    data,
    value: 0n,
  });

  // For the Circle path `txId` is a Circle DB id and `txHash` is filled in later
  // by waitForTxHash. Here we already have the hash, so we use it for both.
  return { txId: txHash, state: "SENT" };
}

/**
 * Wait for the transaction to be mined. Mirrors Circle's `waitForTxHash`:
 * input is a `txId` (here just the hash itself), output is the on-chain hash.
 * Throws if the receipt comes back with `status === "reverted"`.
 */
export async function waitForTxHash(
  client: LocalClient,
  txId: string,
  opts: WaitForTxHashOpts = {},
): Promise<Hex> {
  const timeout = opts.timeoutMs ?? 60_000;
  const receipt = await client.publicClient.waitForTransactionReceipt({
    hash: txId as Hex,
    timeout,
    pollingInterval: opts.intervalMs ?? 500,
  });
  if (receipt.status === "reverted") {
    throw new Error(`local-signer: tx ${txId} reverted on-chain (block ${receipt.blockNumber})`);
  }
  return receipt.transactionHash;
}
