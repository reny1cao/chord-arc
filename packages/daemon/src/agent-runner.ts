/**
 * Spawn a coding-agent CLI in a sandboxed cwd, stream output, hash deliverable.
 *
 * Wiring contract:
 *   const result = await runAgentForMilestone({
 *     agentCli,              // from discoverAgentCli()
 *     projectId, milestoneIndex,
 *     description,           // from readMilestone().description
 *     onLog: line => emit("agent-log", { line, ... }),
 *   });
 *   // result.deliverableUri is a `file://` URI for D1 — IPFS pinning is post-MVP.
 *   // result.deliverableHash is sha256 of the sorted file tree.
 *
 * Per-CLI invocation lives in `argsForCli`. Add new agents by extending that switch.
 * For D1 we optimize for Claude Code; other agents fall back to `[-p <brief>]`.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import * as path from "node:path";
import { config } from "./config.js";
import type { DiscoveredAgent } from "./agent-discovery.js";

export interface RunAgentOpts {
  agentCli: DiscoveredAgent;
  projectId: bigint;
  milestoneIndex: bigint;
  description: string;
  acceptanceCriteria?: string;
  onLog: (line: string) => void;
  /**
   * Hard cap on wall-clock runtime. Default 20 min. Beyond this the child is
   * killed and the run errors out — protects against agent infinite loops.
   */
  timeoutMs?: number;
}

export interface RunAgentResult {
  cwd: string;
  briefPath: string;
  logPath: string;
  deliverableUri: string; // file:// URI for D1
  deliverableHash: string; // sha256-of-sorted-tree, hex
  fileCount: number;
  exitCode: number;
}

function briefFor(opts: Pick<RunAgentOpts, "projectId" | "milestoneIndex" | "description" | "acceptanceCriteria">): string {
  const parts = [
    `# Milestone ${opts.projectId.toString()}.${opts.milestoneIndex.toString()}`,
    "",
    "## Description",
    "",
    opts.description.trim(),
  ];
  if (opts.acceptanceCriteria && opts.acceptanceCriteria.trim().length > 0) {
    parts.push("", "## Acceptance Criteria", "", opts.acceptanceCriteria.trim());
  }
  parts.push(
    "",
    "## Output",
    "",
    "Write all deliverable files into the `./out/` directory in this working folder.",
    "When you're satisfied with the deliverable, exit with status 0.",
    "",
  );
  return parts.join("\n");
}

/**
 * Per-CLI argv. Claude Code reads its prompt from `-p <text>` as a positional arg.
 * Other CLIs (codex, gemini, etc.) accept `-p` similarly — fall back to that until
 * we learn otherwise.
 */
function argsForCli(cliName: string, briefPath: string, briefText: string): string[] {
  switch (cliName) {
    case "claude":
      // Claude Code: --output-format text keeps stdout human-readable for SSE.
      return ["-p", briefText, "--output-format", "text"];
    case "codex":
    case "gemini":
    case "qwen":
    case "kimi":
    case "opencode":
    case "cursor-agent":
      return ["-p", briefText];
    default:
      // Worst case: just pass the brief file path as a positional. Most CLIs
      // will at least show their --help on unknown invocation, which is fine —
      // the run will exit non-zero and we'll surface the log tail.
      return [briefPath];
  }
}

export async function runAgentForMilestone(opts: RunAgentOpts): Promise<RunAgentResult> {
  const cwd = path.resolve(
    config.dataDir,
    "milestones",
    `${opts.projectId.toString()}-${opts.milestoneIndex.toString()}`,
  );
  const outDir = path.join(cwd, "out");
  const briefPath = path.join(cwd, "BRIEF.md");
  const logPath = path.join(cwd, "run.log");

  await fs.mkdir(outDir, { recursive: true });
  const briefText = briefFor(opts);
  await fs.writeFile(briefPath, briefText, "utf8");

  const args = argsForCli(opts.agentCli.name, briefPath, briefText);
  const logStream = createWriteStream(logPath, { flags: "a" });
  logStream.write(`# Spawn: ${opts.agentCli.path} ${args.map(a => JSON.stringify(a)).join(" ")}\n# cwd: ${cwd}\n# at: ${new Date().toISOString()}\n\n`);

  const timeoutMs = opts.timeoutMs ?? 20 * 60_000;

  const exitCode: number = await new Promise<number>((resolve, reject) => {
    const child = spawn(opts.agentCli.path, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CHORD_MILESTONE_CWD: cwd, CHORD_MILESTONE_BRIEF: briefPath },
    });

    const killer = setTimeout(() => {
      logStream.write(`\n# TIMEOUT after ${timeoutMs}ms — killing PID ${child.pid}\n`);
      child.kill("SIGKILL");
    }, timeoutMs);

    const stream = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      logStream.write(text);
      // Push line-at-a-time to onLog so the SSE consumer can render incrementally.
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) opts.onLog(line);
      }
    };

    child.stdout.on("data", stream);
    child.stderr.on("data", stream);

    child.on("error", err => {
      clearTimeout(killer);
      logStream.end(`\n# spawn error: ${err.message}\n`);
      reject(err);
    });
    child.on("close", code => {
      clearTimeout(killer);
      logStream.end(`\n# exit code: ${code ?? "null"}\n`);
      resolve(code ?? -1);
    });
  });

  if (exitCode !== 0) {
    const tail = await readLogTail(logPath, 4096);
    throw new Error(`agent ${opts.agentCli.name} exited ${exitCode}\n--- log tail ---\n${tail}`);
  }

  const hashTarget = await pickHashTarget(cwd, outDir, briefPath, logPath);
  const { hash, count } = await hashTree(hashTarget);

  const deliverableUri = `file://${hashTarget}`;
  return {
    cwd,
    briefPath,
    logPath,
    deliverableUri,
    deliverableHash: hash,
    fileCount: count,
    exitCode,
  };
}

async function readLogTail(file: string, bytes: number): Promise<string> {
  try {
    const stat = await fs.stat(file);
    const size = Number(stat.size);
    const start = Math.max(0, size - bytes);
    const fh = await fs.open(file, "r");
    try {
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally {
      await fh.close();
    }
  } catch {
    return "(log unavailable)";
  }
}

/**
 * Prefer `out/` if the agent wrote there. Otherwise hash the cwd minus the
 * brief and log files (some CLIs write directly into cwd).
 */
async function pickHashTarget(cwd: string, outDir: string, briefPath: string, logPath: string): Promise<string> {
  const outEntries = await listFilesRecursive(outDir);
  if (outEntries.length > 0) return outDir;

  const cwdEntries = await listFilesRecursive(cwd);
  const excluded = new Set([path.resolve(briefPath), path.resolve(logPath)]);
  const productive = cwdEntries.filter(p => !excluded.has(path.resolve(p)));
  if (productive.length === 0) {
    // Agent produced nothing — surface a stub directory so we still have a URI.
    return outDir;
  }
  return cwd;
}

/**
 * SHA-256 of a sorted file tree. Mixes relative path + file SHA so renames
 * change the result. Returns the hex digest and file count.
 */
async function hashTree(rootDir: string): Promise<{ hash: string; count: number }> {
  const files = (await listFilesRecursive(rootDir)).sort();
  const top = createHash("sha256");
  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const buf = await fs.readFile(file);
    const fileHash = createHash("sha256").update(buf).digest("hex");
    top.update(rel);
    top.update("\0");
    top.update(fileHash);
    top.update("\n");
  }
  return { hash: top.digest("hex"), count: files.length };
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) out.push(abs);
    }
  }
  await walk(dir);
  return out;
}
