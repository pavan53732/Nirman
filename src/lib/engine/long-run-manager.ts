// Long-Run Manager — supports pause/resume/checkpoint/recover for projects
// that run 20-60 minutes.
//
// Capabilities:
//   1. Pause — stop execution, save full state to localStorage (and, in a
//      future revision, IndexedDB via ./idb.ts).
//   2. Resume — reload state, continue from where it paused.
//   3. Checkpoint — periodic auto-save every N tasks completed (in addition
//      to manual checkpoints and the implicit pre-pause checkpoint).
//   4. Recover — detect incomplete runs and offer resume.
//
// State saved:
//   - TaskGraph summary (counts by status — the full graph lives in
//     task-graph.ts and is persisted separately by the existing
//     CheckpointManager in execution-engine.ts).
//   - Memory version + artifact count (the full memory + artifact blobs
//     are persisted separately via ./idb.ts).
//   - Execution progress (current stage + task id).
//   - Timestamps (started, paused, resumed, last checkpoint).
//   - Checkpoint log (id, ts, tasksCompleted, stage, reason).
//
// This manager is a COORDINATION layer on top of the existing engine
// singletons (taskGraph, projectMemory, artifactRegistry, executionEngine).
// It does NOT modify any of them — it only reads summaries and persists a
// LongRunSnapshot so a build that's interrupted (pause, crash, browser
// refresh) can be resumed from the last checkpoint without restarting.

import { taskGraph } from "./task-graph";
import { projectMemory } from "./memories";
import { artifactRegistry } from "./artifact-registry";
// executionEngine is imported for type-completeness and future wiring (the
// engine exposes a checkpointManager that this LongRunManager complements).
// The import is intentionally side-effect-free — we do NOT call into the
// engine from this module to keep the ownership boundary clean.
import { executionEngine } from "./execution-engine";

// Touch the imports so lint/TS don't flag them as unused. These rebindings
// document the dependency surface (the manager READS from these singletons;
// future revisions can wire write-back hooks here).
void taskGraph;
void projectMemory;
void artifactRegistry;
void executionEngine;

/**
 * Lifecycle state of a long run.
 *
 *   running    — actively executing tasks
 *   paused     — halted by the user/system; state saved; can be resumed
 *   completed  — finished successfully
 *   failed     — terminal failure (still resumable from last checkpoint
 *                 via recover())
 *   recovering — transient state during recover(), immediately followed
 *                 by a transition to running via resume()
 */
export type RunState = "running" | "paused" | "completed" | "failed" | "recovering";

/**
 * Summary of the TaskGraph at snapshot time. We store the rollup (not the
 * full graph) here because the full graph is persisted separately by the
 * existing CheckpointManager — this snapshot just records progress counts
 * so the UI can render "5/12 tasks done" after a resume.
 */
export interface LongRunSnapshot {
  runId: string;
  state: RunState;
  prompt: string;
  projectId: string;
  taskGraphSummary: {
    totalTasks: number;
    completed: number;
    failed: number;
    pending: number;
  };
  memoryVersion: number;
  artifactCount: number;
  currentStage: string;
  currentTaskId: string | null;
  startedAt: number;
  pausedAt: number | null;
  resumedAt: number | null;
  lastCheckpointAt: number | null;
  checkpoints: CheckpointRecord[];
  elapsedMs: number;
}

/**
 * One checkpoint record. Appended to the snapshot's `checkpoints` array
 * every CHECKPOINT_INTERVAL tasks (periodic), on demand (manual), or right
 * before a pause (pre-pause).
 */
export interface CheckpointRecord {
  id: string;
  timestamp: number;
  tasksCompleted: number;
  stage: string;
  reason: "periodic" | "manual" | "pre-pause";
}

/**
 * A run that was interrupted (paused or failed) and can be resumed.
 * Surfaced via /api/debug/long-run so the UI can show a "Resume CRM app?"
 * prompt after a crash or browser refresh.
 */
export interface RecoveryCandidate {
  runId: string;
  prompt: string;
  pausedAt: number;
  tasksCompleted: number;
  canResume: boolean;
}

const CHECKPOINT_INTERVAL = 5; // checkpoint every 5 completed tasks
const STORAGE_KEY = "pavan.long-run.v1";

export class LongRunManager {
  private currentRun: LongRunSnapshot | null = null;
  private checkpointCount = 0;

  /**
   * Start a new long run. Replaces any existing current run (the previous
   * run's checkpoints are discarded — call `clear()` first if you want to
   * explicitly reset state before starting).
   */
  startRun(runId: string, prompt: string, projectId: string): LongRunSnapshot {
    this.currentRun = {
      runId,
      state: "running",
      prompt,
      projectId,
      taskGraphSummary: { totalTasks: 0, completed: 0, failed: 0, pending: 0 },
      memoryVersion: 0,
      artifactCount: 0,
      currentStage: "init",
      currentTaskId: null,
      startedAt: Date.now(),
      pausedAt: null,
      resumedAt: null,
      lastCheckpointAt: null,
      checkpoints: [],
      elapsedMs: 0,
    };
    this.checkpointCount = 0;
    this.persist();
    return this.currentRun;
  }

  /**
   * Pause the current run — save full state. Creates a "pre-pause"
   * checkpoint first so the resume point is exactly the moment of pause.
   * No-op (returns null) if there's no running run.
   */
  pause(): LongRunSnapshot | null {
    if (!this.currentRun || this.currentRun.state !== "running") return null;

    // Create a pre-pause checkpoint so the resume point is exactly now.
    this.checkpoint("pre-pause");

    this.currentRun.state = "paused";
    this.currentRun.pausedAt = Date.now();
    this.currentRun.elapsedMs = this.calculateElapsedMs();
    this.updateSnapshot();
    this.persist();
    return this.currentRun;
  }

  /**
   * Resume a paused run. No-op (returns null) if the current run isn't
   * paused. The resumedAt timestamp is recorded so the UI can show "resumed
   * 3 minutes after pause". The elapsedMs field is NOT recomputed here —
   * it stays at the paused value and accumulates again on the next pause or
   * complete().
   */
  resume(): LongRunSnapshot | null {
    if (!this.currentRun || this.currentRun.state !== "paused") return null;

    this.currentRun.state = "running";
    this.currentRun.resumedAt = Date.now();
    this.updateSnapshot();
    this.persist();
    return this.currentRun;
  }

  /**
   * Create a checkpoint (periodic or manual). Returns the new record, or
   * null if there's no current run.
   */
  checkpoint(reason: "periodic" | "manual" | "pre-pause" = "periodic"): CheckpointRecord | null {
    if (!this.currentRun) return null;

    this.checkpointCount++;
    const cp: CheckpointRecord = {
      id: `cp-${this.currentRun.runId}-${this.checkpointCount}`,
      timestamp: Date.now(),
      tasksCompleted: this.currentRun.taskGraphSummary.completed,
      stage: this.currentRun.currentStage,
      reason,
    };

    this.currentRun.checkpoints.push(cp);
    this.currentRun.lastCheckpointAt = cp.timestamp;
    this.persist();
    return cp;
  }

  /**
   * Update the snapshot from current engine state. Called after task
   * completions to track progress. Also fires an automatic "periodic"
   * checkpoint every CHECKPOINT_INTERVAL completed tasks.
   *
   * The auto-checkpoint condition is:
   *   - completed > 0 AND completed % INTERVAL === 0 AND no prior checkpoint, OR
   *   - last checkpoint's tasksCompleted + INTERVAL <= completed
   *
   * The two branches are OR'd; the explicit parens below make the
   * precedence clear (&& binds tighter than ||, but we don't rely on it).
   */
  updateProgress(currentStage: string, currentTaskId: string | null): void {
    if (!this.currentRun) return;

    this.currentRun.currentStage = currentStage;
    this.currentRun.currentTaskId = currentTaskId;
    this.updateSnapshot();

    const completed = this.currentRun.taskGraphSummary.completed;
    const cps = this.currentRun.checkpoints;
    const lastCp = cps.length > 0 ? cps[cps.length - 1] : null;

    const firstIntervalHit =
      completed > 0 &&
      completed % CHECKPOINT_INTERVAL === 0 &&
      lastCp === null;
    const nextIntervalHit =
      lastCp !== null && completed >= lastCp.tasksCompleted + CHECKPOINT_INTERVAL;

    if (firstIntervalHit || nextIntervalHit) {
      this.checkpoint("periodic");
    }
  }

  /**
   * Complete the current run. Transitions state to "completed" and freezes
   * the elapsed time.
   */
  complete(): LongRunSnapshot | null {
    if (!this.currentRun) return null;
    this.currentRun.state = "completed";
    this.currentRun.elapsedMs = this.calculateElapsedMs();
    this.persist();
    return this.currentRun;
  }

  /**
   * Mark the run as failed. The run remains resumable via recover() — the
   * state is "failed" but the checkpoints are preserved.
   */
  fail(reason?: string): LongRunSnapshot | null {
    if (!this.currentRun) return null;
    void reason; // reason is accepted for API symmetry; logged in future revision
    this.currentRun.state = "failed";
    this.currentRun.elapsedMs = this.calculateElapsedMs();
    this.persist();
    return this.currentRun;
  }

  /**
   * Find recovery candidates (incomplete runs). Loads any persisted run
   * from localStorage first so crash recovery works across page reloads.
   * Returns the current run if it's in a paused or failed state.
   */
  findRecoveryCandidates(): RecoveryCandidate[] {
    // Lazy-load from storage if we don't have a current run in memory.
    if (!this.currentRun) {
      this.load();
    }
    if (this.currentRun && (this.currentRun.state === "paused" || this.currentRun.state === "failed")) {
      return [
        {
          runId: this.currentRun.runId,
          prompt: this.currentRun.prompt,
          pausedAt:
            this.currentRun.pausedAt ??
            this.currentRun.lastCheckpointAt ??
            this.currentRun.startedAt,
          tasksCompleted: this.currentRun.taskGraphSummary.completed,
          canResume: this.currentRun.state === "paused",
        },
      ];
    }
    return [];
  }

  /**
   * Recover from a crash — reload state from last checkpoint and resume.
   * In a full implementation, this would restore the TaskGraph, memory,
   * and artifacts from IndexedDB. For now, it transitions the current run
   * through "recovering" → "running" via resume().
   */
  recover(runId: string): LongRunSnapshot | null {
    // Lazy-load from storage so recovery works after a fresh page load.
    if (!this.currentRun) {
      this.load();
    }
    if (this.currentRun && this.currentRun.runId === runId) {
      // Mark the run as recovering, then flip to "paused" so resume()'s
      // public contract (state === "paused") holds. The "recovering"
      // state is observable in the persist() snapshot between this line
      // and the resume() call below — in practice that's a single tick.
      this.currentRun.state = "recovering";
      this.persist();
      this.currentRun.state = "paused";
      return this.resume();
    }
    return null;
  }

  /** Returns the current run snapshot, or null if no run is active. */
  getCurrentRun(): LongRunSnapshot | null {
    return this.currentRun;
  }

  /** Returns the checkpoint log for the current run (empty if none). */
  getCheckpoints(): CheckpointRecord[] {
    return this.currentRun?.checkpoints ?? [];
  }

  /**
   * Pull fresh counts from the engine singletons into the snapshot. Called
   * by pause/resume/updateProgress so the snapshot always reflects the
   * latest engine state.
   *
   * The TaskGraph.getSummary() returns { totalTasks, succeeded, failed,
   * queued, ... } — we map those onto the snapshot's
   * { totalTasks, completed, failed, pending } fields.
   */
  private updateSnapshot(): void {
    if (!this.currentRun) return;

    const graphSummary = taskGraph.getSummary();
    this.currentRun.taskGraphSummary = {
      totalTasks: graphSummary.totalTasks,
      completed: graphSummary.succeeded,
      failed: graphSummary.failed,
      pending: graphSummary.queued,
    };
    this.currentRun.memoryVersion = projectMemory.version();
    this.currentRun.artifactCount = artifactRegistry.all().length;
  }

  /**
   * Calculate elapsed milliseconds from startedAt to pausedAt (if paused)
   * or now. Used by pause()/complete()/fail() to freeze the elapsed time.
   * NOTE: this is a simple wall-clock measure — it doesn't subtract pause
   * gaps. A future revision can track cumulative active time by storing
   * pausedAt/resumedAt pairs.
   */
  private calculateElapsedMs(): number {
    if (!this.currentRun) return 0;
    const end = this.currentRun.pausedAt ?? Date.now();
    return end - this.currentRun.startedAt;
  }

  /**
   * Persist the current snapshot to localStorage. Used by the client to
   * recover after a page refresh. No-op on the server (typeof window ===
   * "undefined"). Failures are swallowed — storage may be full, disabled
   * (private mode), or unavailable (SSR).
   */
  private persist(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.currentRun));
    } catch {
      // storage may be full or disabled
    }
  }

  /**
   * Load the persisted snapshot from localStorage. No-op on the server.
   * Failures (corrupt JSON, missing key) leave currentRun as-is.
   */
  private load(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.currentRun = JSON.parse(raw) as LongRunSnapshot;
      }
    } catch {
      // corrupt or missing — leave currentRun unchanged
    }
  }

  /**
   * Clear the current run and any persisted state. Used by the debug
   * endpoint to reset between test cycles.
   */
  clear(): void {
    this.currentRun = null;
    this.checkpointCount = 0;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }
}

export const longRunManager = new LongRunManager();

// On module init (browser only), lazy-load any persisted run and probe for
// recovery candidates. The setTimeout defers the read so it doesn't block
// first paint; findRecoveryCandidates() calls load() internally if there's
// no in-memory currentRun.
if (typeof window !== "undefined") {
  setTimeout(() => {
    try {
      longRunManager.findRecoveryCandidates();
    } catch {
      // non-fatal — recovery is best-effort
    }
  }, 1000);
}
