/**
 * In-memory state store with debounced JSON persistence to `<config.dataDir>/state.json`.
 *
 * Wiring contract: the integrator calls `loadState()` once at boot, then mutates the
 * returned `DaemonState` (or uses the typed helpers). Persisting is fire-and-forget —
 * mutations schedule a debounced write, no awaits required from callers.
 *
 * Deliberately not SQLite — better-sqlite3 fails to build on Node 26 today.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Hex } from "viem";

export type MilestoneKey = `${string}-${string}`; // `${projectId}-${milestoneIndex}`

export type RunPhase = "assigned" | "accepting" | "running" | "submitting" | "done" | "failed";

export interface MilestoneRun {
  projectId: string; // bigints serialized as decimal strings
  milestoneIndex: string;
  assignee: Hex;
  phase: RunPhase;
  acceptTxId?: string; // Circle transaction id (NOT an on-chain hash)
  submitTxId?: string;
  acceptTxHash?: Hex;
  submitTxHash?: Hex;
  deliverableUri?: string;
  deliverableHash?: string;
  logPath?: string;
  error?: string;
  startedAt: number; // epoch ms
  updatedAt: number;
}

export interface DaemonState {
  startedAt: number;
  sca: Hex | null; // resolved at boot from Circle
  runs: Record<MilestoneKey, MilestoneRun>;
}

export const milestoneKey = (projectId: bigint, milestoneIndex: bigint): MilestoneKey =>
  `${projectId.toString()}-${milestoneIndex.toString()}` as MilestoneKey;

function emptyState(): DaemonState {
  return { startedAt: Date.now(), sca: null, runs: {} };
}

/**
 * Stateful handle returned from `loadState`. Internal — keep call surface small.
 */
export interface StateHandle {
  get(): Readonly<DaemonState>;
  setSca(addr: Hex): void;
  upsertRun(key: MilestoneKey, patch: Partial<MilestoneRun> & Pick<MilestoneRun, "projectId" | "milestoneIndex" | "assignee">): MilestoneRun;
  patchRun(key: MilestoneKey, patch: Partial<MilestoneRun>): MilestoneRun | undefined;
  listRuns(): MilestoneRun[];
  flush(): Promise<void>;
}

export async function loadState(dataDir: string): Promise<StateHandle> {
  const file = path.resolve(dataDir, "state.json");
  await fs.mkdir(dataDir, { recursive: true });

  let state: DaemonState = emptyState();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<DaemonState>;
    state = {
      startedAt: parsed.startedAt ?? Date.now(),
      sca: (parsed.sca as Hex | null | undefined) ?? null,
      runs: parsed.runs ?? {},
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[chord:state] failed to read ${file}, starting fresh:`, err);
    }
  }

  // Debounced writer — bunch up frequent mutations.
  let dirty = false;
  let pending: NodeJS.Timeout | null = null;
  let flushPromise: Promise<void> | null = null;

  const writeNow = async (): Promise<void> => {
    dirty = false;
    const snapshot = JSON.stringify(state, null, 2);
    await fs.writeFile(file, snapshot, "utf8");
  };

  const schedule = (): void => {
    dirty = true;
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      flushPromise = writeNow().catch(err => {
        console.warn("[chord:state] persist failed:", err);
      });
    }, 200);
  };

  const touch = (run: MilestoneRun): MilestoneRun => {
    run.updatedAt = Date.now();
    return run;
  };

  return {
    get: () => state,
    setSca: addr => {
      state.sca = addr;
      schedule();
    },
    upsertRun: (key, patch) => {
      const existing = state.runs[key];
      const merged: MilestoneRun = existing
        ? { ...existing, ...patch }
        : {
            phase: "assigned",
            startedAt: Date.now(),
            updatedAt: Date.now(),
            ...patch,
          };
      state.runs[key] = touch(merged);
      schedule();
      return merged;
    },
    patchRun: (key, patch) => {
      const existing = state.runs[key];
      if (!existing) return undefined;
      const merged = touch({ ...existing, ...patch });
      state.runs[key] = merged;
      schedule();
      return merged;
    },
    listRuns: () => Object.values(state.runs),
    flush: async () => {
      if (pending) {
        clearTimeout(pending);
        pending = null;
      }
      if (dirty) await writeNow();
      else if (flushPromise) await flushPromise;
    },
  };
}
