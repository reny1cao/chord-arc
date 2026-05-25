/**
 * Deploy ChordEscrow to Arc Testnet via Circle Smart Contract Platform.
 *
 * Uses the daemon's existing CIRCLE_* env so we don't need to decrypt the local
 * hardhat deployer key. The SCA referenced by CIRCLE_WALLET_ID is the deployer
 * and pays gas in USDC on Arc.
 *
 * Outputs the new contract address. Use it to update:
 *   packages/hardhat/deployments/arcTestnet/ChordEscrow.json (address field)
 *   packages/nextjs/contracts/deployedContracts.ts (chainId 5042002 address)
 *   README.md + docs/{SUBMISSION,PROTOCOL}.md links
 */
import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { initiateSmartContractPlatformClient } from "@circle-fin/smart-contract-platform";
import { generateEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";
const ARTIFACT_PATH = resolve(__dirname, "..", "..", "hardhat", "artifacts", "contracts", "ChordEscrow.sol", "ChordEscrow.json");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main() {
  const apiKey = need("CIRCLE_API_KEY");
  const entitySecret = need("CIRCLE_ENTITY_SECRET");
  const walletId = need("CIRCLE_WALLET_ID");

  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));
  const abiJson = JSON.stringify(artifact.abi);
  const bytecode: string = artifact.bytecode;
  if (!bytecode.startsWith("0x")) throw new Error("bytecode is not 0x-prefixed");

  console.log("[deploy] ChordEscrow bytecode bytes:", (bytecode.length - 2) / 2);
  console.log("[deploy] constructor: USDC =", ARC_TESTNET_USDC);
  console.log("[deploy] deployer wallet id:", walletId);

  const scp = initiateSmartContractPlatformClient({ apiKey, entitySecret });

  // Bypass SDK for the POST to see raw response (SDK swallows it). Use SDK's encryption
  // helper for entity secret. Polling uses scp.getContract normally.
  const entitySecretCiphertext = await generateEntitySecretCiphertext({ apiKey, entitySecret });
  const idempotencyKey = randomUUID();
  // Wire format: feeLevel goes at top level, not nested under `fee`. The SDK
  // transforms the nested form for us, but we're bypassing the SDK for diagnostics.
  const body = {
    name: "ChordEscrow",
    blockchain: "ARC-TESTNET",
    walletId,
    abiJson,
    bytecode,
    constructorParameters: [ARC_TESTNET_USDC],
    feeLevel: "MEDIUM",
    idempotencyKey,
    entitySecretCiphertext,
  };
  const httpRes = await fetch("https://api.circle.com/v1/w3s/contracts/deploy", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const httpText = await httpRes.text();
  console.log("[deploy] HTTP", httpRes.status, httpText);
  if (!httpRes.ok) throw new Error(`HTTP ${httpRes.status}: ${httpText}`);
  const deployRes = JSON.parse(httpText);

  const contractId = deployRes.data?.contractId;
  const txId = deployRes.data?.transactionId;
  if (!contractId) throw new Error(`deployContract returned no contractId: ${JSON.stringify(deployRes.data)}`);
  console.log("[deploy] contractId:", contractId);
  console.log("[deploy] transactionId:", txId);

  let contract: any;
  for (let i = 0; i < 60; i++) {
    const res = await scp.getContract({ id: contractId });
    contract = res.data?.contract;
    const status = contract?.deploymentStatus ?? "UNKNOWN";
    process.stdout.write(`[deploy] poll ${i + 1}/60 status=${status}\r`);
    if (status === "COMPLETE") break;
    if (status === "FAILED") throw new Error("Deployment failed (status FAILED)");
    await new Promise(r => setTimeout(r, 5000));
  }
  process.stdout.write("\n");

  const address = contract?.contractAddress ?? contract?.address;
  if (!address) throw new Error(`Deployment did not complete in time. Last contract: ${JSON.stringify(contract)}`);
  console.log("[deploy] ChordEscrow deployed at:", address);
  console.log("[deploy] block explorer: https://testnet.arcscan.app/address/" + address);
}

main().catch(err => {
  console.error("[deploy] FAILED:", err);
  // Circle SDK error wraps the axios response — dig out the actual server message
  const e = err as any;
  if (e?.response?.data) console.error("[deploy] response.data:", JSON.stringify(e.response.data, null, 2));
  if (e?.errors) console.error("[deploy] errors:", JSON.stringify(e.errors, null, 2));
  if (e?.data) console.error("[deploy] data:", JSON.stringify(e.data, null, 2));
  if (e?.body) console.error("[deploy] body:", JSON.stringify(e.body, null, 2));
  process.exit(1);
});
