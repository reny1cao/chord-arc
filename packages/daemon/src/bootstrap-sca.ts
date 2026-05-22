#!/usr/bin/env node
/**
 * One-shot bootstrap: create (or reuse) a Circle WalletSet and a Dev-Controlled
 * SCA on Arc Testnet for this daemon. Prints the ready-to-paste env block.
 *
 * Wiring contract: standalone script. Run with:
 *   tsx packages/daemon/src/bootstrap-sca.ts --name specialist-react
 *
 * Required env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET
 * Optional env: CIRCLE_WALLET_SET_ID (reuse instead of creating a new set)
 *
 * Idempotency: uses a deterministic key derived from sha256(name + "wallet-set"
 * / "wallet"), so re-running the script after a flake won't create duplicates.
 */
import { createHash, randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

interface Args {
  name: string;
  blockchain: "ARC-TESTNET";
}

function parseArgs(argv: string[]): Args {
  const out: Args = { name: "chord-daemon", blockchain: "ARC-TESTNET" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name" && argv[i + 1]) {
      out.name = argv[++i] ?? out.name;
    } else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return out;
}

function printUsage(): void {
  console.log(`
Usage: tsx src/bootstrap-sca.ts [--name <label>]

Creates a Circle Dev-Controlled SCA on Arc Testnet for this daemon.

Required env:
  CIRCLE_API_KEY         your Circle Web3 API key (test_)
  CIRCLE_ENTITY_SECRET   registered 32-byte hex entity secret

Optional env:
  CIRCLE_WALLET_SET_ID   reuse this wallet set instead of creating a new one
`);
}

/**
 * Build a UUID-formatted deterministic idempotency key from `purpose` and `name`.
 * Circle accepts arbitrary strings but its examples use UUIDs — we conform.
 */
function deterministicKey(purpose: string, name: string): string {
  const hex = createHash("sha256").update(`${purpose}::${name}`).digest("hex");
  // Format as a v4-shaped UUID. (Variant/version bits are cosmetic for idempotency.)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function main(): Promise<void> {
  // parse first so --help / -h works without creds
  const args = parseArgs(process.argv.slice(2));

  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    console.error(
      "Missing required env. Both CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set.\n" +
        "Get an API key at https://console.circle.com/api-keys and generate an entity secret with:\n" +
        "  node -e \"require('@circle-fin/developer-controlled-wallets').generateEntitySecret()\"",
    );
    process.exit(1);
  }

  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  let walletSetId = process.env.CIRCLE_WALLET_SET_ID || "";
  if (!walletSetId) {
    console.log(`[bootstrap] creating WalletSet name="${args.name}"`);
    const setRes = await client.createWalletSet({
      name: args.name,
      idempotencyKey: deterministicKey("wallet-set", args.name),
    });
    const created = setRes.data?.walletSet;
    if (!created?.id) throw new Error("createWalletSet returned no id");
    walletSetId = created.id;
    console.log(`[bootstrap] WalletSet id=${walletSetId}`);
  } else {
    console.log(`[bootstrap] reusing CIRCLE_WALLET_SET_ID=${walletSetId}`);
  }

  console.log(`[bootstrap] creating SCA on ${args.blockchain}`);
  const walletRes = await client.createWallets({
    walletSetId,
    blockchains: [args.blockchain],
    count: 1,
    accountType: "SCA",
    idempotencyKey: deterministicKey("wallet", `${args.name}:${args.blockchain}`),
    metadata: [{ name: args.name, refId: args.name }],
  });

  const wallets = walletRes.data?.wallets ?? [];
  if (wallets.length === 0) {
    // Idempotency replay returns no wallets — list to find the existing one.
    console.warn("[bootstrap] createWallets returned no wallets — listing existing for this set+blockchain");
    const listed = await client.listWallets({ walletSetId, blockchain: args.blockchain });
    const all = listed.data?.wallets ?? [];
    if (all.length === 0) throw new Error("No wallet found after creation attempt");
    wallets.push(...all);
  }

  const wallet = wallets[0];
  if (!wallet?.id || !wallet?.address) throw new Error("Wallet record missing id/address");

  console.log("");
  console.log("=== Chord SCA ready ===");
  console.log(`wallet id      : ${wallet.id}`);
  console.log(`wallet set id  : ${walletSetId}`);
  console.log(`address        : ${wallet.address}`);
  console.log(`blockchain     : ${args.blockchain}`);
  console.log("");
  console.log("# paste into your daemon .env:");
  console.log(`CIRCLE_WALLET_ID=${wallet.id}`);
  console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
  console.log(`ARC_SCA_ADDRESS=${wallet.address}`);
  console.log("");
  console.log(
    `# fund it: Circle faucet → ${wallet.address} (10 USDC per drip on Arc Testnet)`,
  );
  console.log(`# ref id used: bootstrap-${randomUUID().slice(0, 8)}`);
}

main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[bootstrap] failed: ${msg}`);
  if (process.env.CHORD_DEBUG && err instanceof Error) {
    console.error(err.stack);
  }
  process.exit(1);
});
