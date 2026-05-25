/**
 * Smoke test for the off-chain WorkContract storage helpers.
 *
 *   yarn workspace @chord/nextjs exec tsx scripts/smoke-contractStorage.ts
 *
 * The repo has no Jest/Vitest; daemon uses the same `tsx scripts/smoke-*.ts`
 * pattern. This script exercises hash determinism, round-trip persistence,
 * and canonicalization stability against field-reorder input.
 */
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { hashContract, loadContract, storeContract } from "../utils/contractStorage";
import { type WorkContract, WORK_CONTRACT_SCHEMA, canonicalize, toWorkContract } from "../types/contract";

type CheckResult = { name: string; ok: boolean; detail?: string };

const results: CheckResult[] = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  const status = ok ? "PASS" : "FAIL";
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  // Use a throwaway temp dir so the smoke does not pollute the repo-root store.
  const tmp = mkdtempSync(path.join(tmpdir(), "chord-contracts-smoke-"));
  process.env.CHORD_CONTRACTS_DIR = tmp;
  console.log(`storage dir: ${tmp}\n`);

  try {
    const draft = {
      result: "A signed PR that adds /api/contracts",
      authority: "May write under packages/nextjs; may not edit Solidity",
      proof: "Link to PR + curl transcript",
      acceptance: "tsc passes; smoke script exits 0",
      failure: "If a route 500s, fix and re-run; else mark failed",
    };

    const a: WorkContract = toWorkContract(draft, 1_700_000_000_000);

    // 1. Hash determinism.
    console.log("1. hash determinism");
    const h1 = hashContract(a);
    const h2 = hashContract(a);
    check("same input -> same hash", h1 === h2, `${h1.slice(0, 12)}...`);
    check("hash is 64 hex chars", /^[0-9a-f]{64}$/.test(h1));

    // 2. Round-trip.
    console.log("\n2. round-trip store + load");
    const stored = await storeContract(a);
    check("store returns chord:// uri", stored.uri.startsWith("chord://"));
    check("uri hash matches computed hash", stored.uri === `chord://${h1}`);
    check("bytes is positive", stored.bytes > 0, `${stored.bytes} bytes`);

    const loaded = await loadContract(h1);
    check("loaded is not null", loaded !== null);
    if (loaded) {
      const sameJson = canonicalize(loaded) === canonicalize(a);
      check("loaded canonicalizes equal to original", sameJson);
      check("loaded.schema is the version tag", loaded.schema === WORK_CONTRACT_SCHEMA);
    }

    // 3. Canonicalization — keys in shuffled order must hash identically.
    console.log("\n3. canonicalization stability");
    const reordered = {
      createdAt: a.createdAt,
      failure: a.failure,
      acceptance: a.acceptance,
      proof: a.proof,
      authority: a.authority,
      result: a.result,
      schema: a.schema,
    } as WorkContract;
    const hReordered = hashContract(reordered);
    check("shuffled input -> same hash", hReordered === h1);

    // 4. Idempotent re-store (same content, second call) returns same hash.
    console.log("\n4. idempotent re-store");
    const stored2 = await storeContract(a);
    check("second store returns same hash", stored2.hash === h1);
    check("second store returns same uri", stored2.uri === stored.uri);

    // 5. loadContract on unknown hash returns null.
    console.log("\n5. unknown hash");
    const missing = await loadContract("0".repeat(64));
    check("unknown hash returns null", missing === null);

    // 6. loadContract throws on malformed hash.
    console.log("\n6. malformed hash rejected");
    let threw = false;
    try {
      await loadContract("not-a-hash");
    } catch {
      threw = true;
    }
    check("malformed hash throws", threw);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.error("FAILED:");
    for (const f of failed) console.error(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
