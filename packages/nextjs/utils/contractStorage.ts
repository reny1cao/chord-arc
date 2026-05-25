import { createHash } from "crypto";
import { mkdirSync } from "fs";
import { access, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import {
  type ContractStorageResponse,
  type WorkContract,
  buildContractURI,
  canonicalize,
} from "~~/types/contract";

/**
 * Storage helpers for content-addressed WorkContract JSON.
 * See docs/CONTRACT-SCHEMA.md (Storage API section).
 */

const HASH_REGEX = /^[0-9a-f]{64}$/;

let storageDirCache: string | null = null;

/**
 * Resolve the on-disk directory for stored contracts. Creates it on first call.
 *
 *  - `CHORD_CONTRACTS_DIR` env var overrides (absolute or relative to cwd).
 *  - Defaults to `<repo-root>/.chord-contracts/` resolved from
 *    `packages/nextjs/`.
 */
export function getStorageDir(): string {
  if (storageDirCache) return storageDirCache;
  const fromEnv = process.env.CHORD_CONTRACTS_DIR;
  const dir = fromEnv
    ? path.resolve(fromEnv)
    : path.resolve(process.cwd(), "..", "..", ".chord-contracts");
  mkdirSync(dir, { recursive: true });
  storageDirCache = dir;
  return dir;
}

/**
 * Compute the sha256 hash (lowercase hex) over the canonicalized contract
 * bytes. Identical logical contracts always produce identical hashes because
 * `canonicalize()` emits a fixed key order.
 */
export function hashContract(contract: WorkContract): string {
  const canonical = canonicalize(contract);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function pathForHash(hash: string): string {
  return path.join(getStorageDir(), `${hash}.json`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist a contract to `<storage-dir>/<hash>.json`. Idempotent: if a file
 * already exists at the target path (same hash => same bytes), we no-op and
 * just return the response.
 */
export async function storeContract(contract: WorkContract): Promise<ContractStorageResponse> {
  const canonical = canonicalize(contract);
  const bytes = Buffer.byteLength(canonical, "utf8");
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  const target = pathForHash(hash);

  if (!(await fileExists(target))) {
    // Atomic first-write: write to a temp file in the same directory, then rename.
    // `rename` within a filesystem is atomic on POSIX and on Windows for our use.
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, canonical, { encoding: "utf8" });
    await rename(tmp, target);
  }

  return {
    uri: buildContractURI(hash),
    hash,
    bytes,
  };
}

/**
 * Load a stored contract by its hex hash. Returns null if the file does not
 * exist. Throws on malformed hash (caller should validate first) or unparseable
 * JSON on disk.
 */
export async function loadContract(hash: string): Promise<WorkContract | null> {
  if (!HASH_REGEX.test(hash)) {
    throw new Error("hash must be 64 lowercase hex chars");
  }
  const target = pathForHash(hash);
  try {
    const raw = await readFile(target, "utf8");
    return JSON.parse(raw) as WorkContract;
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export function isValidHash(value: string): boolean {
  return HASH_REGEX.test(value);
}
