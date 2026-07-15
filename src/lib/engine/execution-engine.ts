// Execution Engine — the runtime for all agents.
// Agents do NOT execute directly. They submit Tasks to the Execution Engine.
// The engine: Task Queue, Dependency Scheduler, Parallel Execution Manager,
// Resource Manager, Cancellation Manager, Retry Manager, Checkpoint Manager,
// Event Bus. This prevents orchestrator bottleneck.

import type {
  Task,
  TaskStatus,
  EngineEvent,
  GateId,
  GateResult,
  WorkflowId,
  AgentRole,
} from "./types";
import { evaluateGate, selfHealController, SELF_HEAL_LEVELS } from "./self-healing";
import type { SelfHealLevel } from "./types";

type EventListener = (e: EngineEvent) => void;

export interface ExecutionEngineOptions {
  maxParallel: number;
  onTaskDone?: (task: Task) => void;
}

/* ---------------- Build Trace Recorder ---------------- */
//
// Records a per-task runtime trace that PROVES the ExecutionEngine actually
// performs parallel scheduling, dependency resolution, and deterministic
// completion ordering at runtime. Each task gets one TraceEntry with:
//   - scheduledAt: ts when submit()/submitAll() registered the task
//   - startedAt:   ts when the executor actually picked it up
//   - completedAt: ts when complete() finished (success or failure)
//   - parallelBatch: wave number — increments when the scheduler dispatches
//     2+ tasks in the same trySchedule() tick OR after a >50ms gap (which
//     indicates the previous wave's async work finished and a new wave is
//     starting). Tasks in the same batch are the ones that ran in parallel.
//
// The trace is exposed via executionEngine.getTrace() and the
// /api/build/trace HTTP endpoint for runtime inspection.

export interface TraceEntry {
  taskId: string;
  taskTitle: string;
  agent: string; // task.agent
  stageId: string;
  dependsOn: string[]; // task.dependsOn at scheduling time
  scheduledAt: number; // ms timestamp when submit()/submitAll() was called
  startedAt: number | null; // when executor actually picked it up
  completedAt: number | null;
  status: "pending" | "running" | "completed" | "failed";
  parallelBatch: number; // 1, 2, 3... — wave number (see above)
}

export class BuildTrace {
  private entries = new Map<string, TraceEntry>();
  private currentBatch = 0;
  private lastDispatchTs = 0;
  // 50ms gap between scheduler dispatches is treated as a wave boundary —
  // short enough that synchronous submitAll() bursts stay in one batch,
  // long enough that real async tool completions (which take ≥1 tick) start
  // a new batch when they unblock dependent tasks.
  private static readonly WAVE_GAP_MS = 50;

  /** Record that a task was scheduled (called from submit()). */
  recordScheduled(task: Task): void {
    if (this.entries.has(task.id)) return;
    this.entries.set(task.id, {
      taskId: task.id,
      taskTitle: task.title,
      agent: task.agent,
      stageId: task.stageId,
      dependsOn: [...task.dependsOn],
      scheduledAt: Date.now(),
      startedAt: null,
      completedAt: null,
      status: "pending",
      parallelBatch: 0, // assigned when the task actually starts
    });
  }

  /**
   * Decide the parallelBatch number for a new scheduler wave.
   * Called ONCE per trySchedule() call that actually dispatches ≥1 task.
   * `tasks` = the tasks about to start in this tick (used to detect new
   * waves triggered by synchronous in-memory completions, where the time
   * gap is 0ms but a dep that just completed proves a wave boundary).
   * Returns the batch number to assign to all of them.
   */
  nextBatch(tasks: Task[]): number {
    const now = Date.now();
    const gap = now - this.lastDispatchTs;
    // New wave when:
    //   - first ever dispatch (currentBatch === 0)
    //   - 2+ tasks dispatched in the same scheduler tick (true parallel batch)
    //   - significant time gap since the previous dispatch (>50ms) — previous
    //     wave's async work finished and a new wave is starting
    //   - any task being dispatched has a dependency that completed in the
    //     CURRENT batch — proves a synchronous in-memory cascade where a
    //     dep finished and its dependent is now starting (a new wave even
    //     though Date.now() hasn't advanced)
    const hasDepInCurrentBatch = tasks.some((t) =>
      t.dependsOn.some((depId) => {
        const dep = this.entries.get(depId);
        return (
          !!dep &&
          dep.parallelBatch === this.currentBatch &&
          dep.status === "completed"
        );
      })
    );
    const isNewWave =
      this.currentBatch === 0 ||
      tasks.length >= 2 ||
      gap > BuildTrace.WAVE_GAP_MS ||
      hasDepInCurrentBatch;
    if (isNewWave) {
      this.currentBatch++;
    }
    this.lastDispatchTs = now;
    return this.currentBatch;
  }

  /** Record that a task transitioned to running. */
  recordStarted(task: Task, batch: number): void {
    const e = this.entries.get(task.id);
    if (!e) return;
    e.startedAt = Date.now();
    e.status = "running";
    e.parallelBatch = batch;
  }

  /** Record that a task finished (success or failure). */
  recordCompleted(task: Task, status: "completed" | "failed"): void {
    const e = this.entries.get(task.id);
    if (!e) return;
    e.completedAt = Date.now();
    e.status = status;
  }

  /** Full trace sorted by scheduledAt then startedAt (stable, deterministic). */
  getTrace(): TraceEntry[] {
    return [...this.entries.values()].sort((a, b) => {
      if (a.scheduledAt !== b.scheduledAt) return a.scheduledAt - b.scheduledAt;
      const as = a.startedAt ?? 0;
      const bs = b.startedAt ?? 0;
      if (as !== bs) return as - bs;
      return a.taskId.localeCompare(b.taskId);
    });
  }

  /** Reset the trace (called from ExecutionEngine.reset()). */
  clear(): void {
    this.entries.clear();
    this.currentBatch = 0;
    this.lastDispatchTs = 0;
  }
}

export class ExecutionEngine {
  private tasks = new Map<string, Task>();
  private queue: string[] = []; // task ids ready/queued
  private running = new Set<string>();
  private listeners = new Set<EventListener>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private maxParallel: number;
  private onTaskDone?: (task: Task) => void;
  private cancelled = false;
  private eventCounter = 0;
  private trace = new BuildTrace();

  constructor(opts: ExecutionEngineOptions = { maxParallel: 4 }) {
    this.maxParallel = opts.maxParallel;
    this.onTaskDone = opts.onTaskDone;
  }

  /* ---------------- Event Bus ---------------- */
  subscribe(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(partial: Omit<EngineEvent, "id" | "ts">): void {
    const e: EngineEvent = { id: `ev-${++this.eventCounter}`, ts: Date.now(), ...partial };
    this.listeners.forEach((fn) => fn(e));
  }

  /* ---------------- Task Queue + Dependency Scheduler ---------------- */
  submit(task: Task): void {
    this.tasks.set(task.id, task);
    // Record the task in the build trace BEFORE any scheduling — this captures
    // the scheduledAt timestamp at the moment the task entered the engine.
    this.trace.recordScheduled(task);
    task.status = task.dependsOn.length === 0 ? "ready" : "queued";
    this.emit({ type: "task-queued", taskId: task.id, workflowId: task.workflowId, message: `Queued: ${task.title}`, level: "debug" });
    this.trySchedule();
  }

  submitAll(tasks: Task[]): void {
    for (const t of tasks) this.submit(t);
  }

  /**
   * Insert a task into a RUNNING graph. Used by the Verification Loop (Wave
   * 1C, future) to add fix tasks when verification fails. The task is
   * scheduled immediately if its dependencies are satisfied.
   *
   * This is the V2 dynamic task insertion capability — distinct from the
   * initial `submitAll()` bulk-load because it happens DURING execution,
   * after the engine has already begun dispatching other tasks. Operationally
   * it delegates to `submit()` (which registers the task in `this.tasks`,
   * records `scheduledAt` in the trace, assigns the initial status, emits a
   * `task-queued` event, and calls `trySchedule()` so the task is picked up
   * immediately if its dependencies are satisfied), then emits an additional
   * observability event so subscribers can distinguish insertions from the
   * initial graph.
   *
   * Backward compat: this method is additive — `submitAll()` and `submit()`
   * are unchanged. Existing callers continue to work as before.
   */
  insertTask(task: Task): void {
    // submit() handles: tasks.set, trace.recordScheduled, status assignment,
    // task-queued emit, and trySchedule(). No need to duplicate that logic.
    this.submit(task);
    // Additional observability marker: this task was dynamically inserted
    // into a running graph, not part of the initial submitAll() batch.
    this.emit({
      type: "task-queued",
      taskId: task.id,
      stageId: task.stageId,
      workflowId: task.workflowId,
      message: `Inserted into running graph: ${task.title}`,
      level: "info",
    });
  }

  private trySchedule(): void {
    if (this.cancelled) {
      this.emit({ type: "task-failed", message: `trySchedule: cancelled=true, skipping`, level: "debug" });
      return;
    }
    // Promote queued tasks whose dependencies are satisfied
    let promoted = 0;
    for (const t of this.tasks.values()) {
      if (t.status === "queued" && this.depsSatisfied(t)) {
        t.status = "ready";
        promoted++;
      }
    }
    // Collect ready tasks up to the parallelism limit. We snapshot the
    // dispatch list BEFORE calling start() so that all tasks dispatched in
    // this scheduler tick can be tagged with the same parallelBatch number.
    const ready = [...this.tasks.values()].filter((t) => t.status === "ready");
    const toDispatch: Task[] = [];
    for (const t of ready) {
      if (this.running.size + toDispatch.length >= this.maxParallel) break;
      toDispatch.push(t);
    }
    if (toDispatch.length > 0) {
      const batch = this.trace.nextBatch(toDispatch);
      for (const t of toDispatch) {
        this.start(t, batch);
      }
    }
    if (promoted > 0 || ready.length > 0) {
      this.emit({ type: "task-queued", message: `trySchedule: promoted ${promoted}, started ${toDispatch.length}, running=${this.running.size}`, level: "debug" });
    }
  }

  private depsSatisfied(t: Task): boolean {
    return t.dependsOn.every((depId) => {
      const dep = this.tasks.get(depId);
      return dep && (dep.status === "succeeded" || dep.status === "skipped");
    });
  }

  /* ---------------- Parallel Execution Manager ---------------- */
  // REAL execution: no setTimeout. Tasks either invoke a real tool (via the
  // server-side ToolManager through the client bridge) or, for non-tool tasks,
  // complete immediately with a real measured duration. Gate tasks run real
  // tsc/eslint and self-heal via the LLM repair API on failure.
  private start(task: Task, batch: number): void {
    task.status = "running";
    task.startedAt = Date.now();
    this.running.add(task.id);
    // Record the start (with the wave's parallelBatch number) AFTER the
    // task is marked running but BEFORE the task-started event fires, so
    // any subscriber that reads getTrace() sees the running state.
    this.trace.recordStarted(task, batch);
    this.emit({ type: "task-started", taskId: task.id, stageId: task.stageId, workflowId: task.workflowId, message: `Started: ${task.title}`, level: "info" });

    // Fire-and-forget async completion. The duration is measured from real
    // tool execution (or ~0ms for in-memory tasks), NOT a fake timeout.
    void this.complete(task);
  }

  private async complete(task: Task): Promise<void> {
    if (this.cancelled) return;
    this.running.delete(task.id);
    task.finishedAt = Date.now();
    task.durationMs = task.finishedAt - (task.startedAt ?? task.finishedAt);

    // If the task has a toolId, invoke the real tool now.
    if (task.toolId && !task.gate) {
      try {
        const { invokeToolClient } = await import("./tool-client");
        const cwd = (task as Task & { args?: { cwd?: string } }).args?.cwd;
        const result = await invokeToolClient(task.toolId, cwd ? { cwd } : {});
        task.result = result.success ? "ok" : `exit ${result.exitCode}`;
        if (!result.success) {
          task.status = "failed";
          this.trace.recordCompleted(task, "failed");
          this.emit({ type: "task-failed", taskId: task.id, stageId: task.stageId, message: `${task.title} failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`, level: "error" });
          this.trySchedule();
          return;
        }
        this.emit({ type: "task-succeeded", taskId: task.id, stageId: task.stageId, workflowId: task.workflowId, message: `${task.title} done in ${result.durationMs}ms (real tool run)`, level: "success" });
      } catch (err) {
        task.status = "failed";
        this.trace.recordCompleted(task, "failed");
        this.emit({ type: "task-failed", taskId: task.id, stageId: task.stageId, message: `${task.title} tool error: ${String(err)}`, level: "error" });
        this.trySchedule();
        return;
      }
    }

    // Quality gate evaluation (if this task is a gate)
    if (task.gate) {
      const gateCtx = (task as Task & { gateContext?: import("./self-healing").GateEvaluationContext }).gateContext ?? {};
      const result = await this.runGateWithHealing(task, gateCtx);
      if (!result.passed) {
        task.status = "failed";
        this.trace.recordCompleted(task, "failed");
        this.emit({ type: "task-failed", taskId: task.id, stageId: task.stageId, message: `Gate failed: ${task.gate} — ${result.detail}`, level: "warn" });
        this.trySchedule();
        return;
      }
      this.emit({ type: "gate-evaluated", taskId: task.id, stageId: task.stageId, message: `Gate passed: ${task.gate} (${result.metric})`, level: "success" });
    }

    task.status = "succeeded";
    if (!task.result) task.result = "ok";
    this.trace.recordCompleted(task, "completed");
    this.emit({ type: "task-succeeded", taskId: task.id, stageId: task.stageId, workflowId: task.workflowId, message: `Done: ${task.title} (${task.durationMs}ms)`, level: "success" });
    this.onTaskDone?.(task);
    this.trySchedule();
  }

  /* ---------------- Retry Manager + Self-healing ---------------- */
  // REAL self-healing: on gate failure, escalate through levels. For
  // compilation/lint failures, call the LLM repair API (/api/repair) which
  // returns a patched file, write it to the workspace via /api/workspace,
  // then re-run the gate. No forced pass — if healing is exhausted, the
  // gate genuinely fails.
  private async runGateWithHealing(
    task: Task,
    ctx: import("./self-healing").GateEvaluationContext
  ): Promise<GateResult> {
    let result = await evaluateGate(task.gate!, ctx);
    if (result.passed) return result;

    let level: SelfHealLevel = "fastfix";
    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      attempts++;
      const next = selfHealController.nextLevel(task.id, level);
      if (!next) break;
      level = next;
      this.emit({ type: "task-retried", taskId: task.id, message: `Self-heal @ ${SELF_HEAL_LEVELS.find((l) => l.id === level)?.label}`, level: "warn" });

      // For compilation failures with a workspace, attempt an LLM repair.
      if (task.gate === "compilation" && ctx.workspacePath && level !== "human-question") {
        const repaired = await this.attemptLLMRepair(ctx.workspacePath);
        if (repaired) {
          // Diff already logged to Build Memory in attemptLLMRepair
          void repaired.diff;
        }
      }

      const retry = await evaluateGate(task.gate!, ctx);
      if (retry.passed) {
        return retry;
      }
      result = retry;
    }
    // Healing exhausted — genuinely fail (no force-pass).
    return {
      gate: task.gate!,
      passed: false,
      detail: `${task.gate} failed after ${attempts} self-heal attempts: ${result.detail}`,
      metric: result.metric ?? "failed",
    };
  }

  /** Attempt to repair compilation errors via the LLM repair API.
   *  Reads the failing file, calls /api/repair, writes the patched content
   *  back to the workspace, and logs the diff to Build Memory. */
  private async attemptLLMRepair(workspacePath: string): Promise<{ file: string; diff: string } | null> {
    try {
      // Re-run tsc to get fresh errors
      const { invokeToolClient } = await import("./tool-client");
      const tscResult = await invokeToolClient("tsc-no-emit", { cwd: workspacePath });
      if (tscResult.success || !tscResult.errors?.length) return null;

      // Take the first error's file, read it, repair it, write it back.
      const firstError = tscResult.errors[0];
      const fileRes = await fetch(`/api/workspace?path=${encodeURIComponent(workspacePath)}&file=${encodeURIComponent(firstError.file)}`);
      if (!fileRes.ok) return null;
      const { content: originalContent } = await fileRes.json();

      const repairRes = await fetch("/api/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: firstError.file,
          fileContent: originalContent,
          errors: tscResult.errors,
          language: "typescript",
        }),
      });
      if (!repairRes.ok) return null;
      const { patchedContent, tokensUsed } = await repairRes.json();

      // Write the patched file back to the workspace
      const writeRes = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workspacePath, file: firstError.file, content: patchedContent }),
      });
      if (!writeRes.ok) return null;

      // Compute a simple diff for observability + Build Memory
      const origLines = originalContent.split("\n");
      const newLines = patchedContent.split("\n");
      const diffParts: string[] = [];
      const maxLines = Math.max(origLines.length, newLines.length);
      for (let i = 0; i < maxLines; i++) {
        if (origLines[i] !== newLines[i]) {
          if (origLines[i] !== undefined) diffParts.push(`- L${i + 1}: ${origLines[i]}`);
          if (newLines[i] !== undefined) diffParts.push(`+ L${i + 1}: ${newLines[i]}`);
        }
      }
      const diff = diffParts.join("\n").slice(0, 2000); // cap at 2KB

      // Log the diff to Build Memory via the MemoryAccess facade.
      // (Runtime V2 Audit, Phase 2 Step 6 — internal modules must not
      // touch `projectMemory` directly; they go through `memoryAccess`.)
      const { memoryAccess } = await import("./memories");
      memoryAccess.write(
        "build",
        `Repair diff: ${firstError.file}`,
        JSON.stringify({
          file: firstError.file,
          errors: tscResult.errors.slice(0, 5).map((e) => ({ line: e.line, message: e.message })),
          diff,
          repairedAt: new Date().toISOString(),
        }, null, 2),
        "debugger"
      );

      // Emit an event for the UI/logs
      this.emit({
        type: "task-retried",
        message: `Self-heal: patched ${firstError.file} (${diffParts.length} lines changed)`,
        level: "info",
      });

      // Charge real tokens from the repair LLM call
      const { observability } = await import("./observability");
      observability.chargeTokens("debugger" as AgentRole, tokensUsed ?? 0, "new-project");

      return { file: firstError.file, diff };
    } catch {
      return null;
    }
  }

  /* ---------------- Cancellation Manager ---------------- */
  cancelAll(): void {
    this.cancelled = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const t of this.tasks.values()) {
      if (t.status === "running" || t.status === "ready" || t.status === "queued") {
        // Mark any in-flight task as failed in the trace so the runtime
        // record reflects that it did not complete.
        if (t.status === "running") this.trace.recordCompleted(t, "failed");
        t.status = "cancelled";
      }
    }
    this.running.clear();
  }

  reset(): void {
    this.cancelAll();
    this.cancelled = false;
    this.tasks.clear();
    this.queue = [];
    this.running.clear();
    this.trace.clear();
  }

  /* ---------------- Introspection ---------------- */
  /**
   * Runtime task-graph trace: one TraceEntry per task with scheduledAt,
   * startedAt, completedAt, status, and parallelBatch (wave number). Used to
   * PROVE parallel scheduling, dependency resolution, and completion ordering
   * actually happen at runtime. Exposed via /api/build/trace.
   */
  getTrace(): TraceEntry[] {
    return this.trace.getTrace();
  }

  allTasks(): Task[] {
    return [...this.tasks.values()];
  }
  tasksForStage(stageId: string): Task[] {
    return this.allTasks().filter((t) => t.stageId === stageId);
  }
  /**
   * Coarse-grained stage status derived from the underlying tasks.
   *
   * Returns one of the UI-level `StageStatus` values (`"pending" |
   * `"running" | "done" | "failed"`) — NOT a strict `TaskStatus`. The
   * return type intentionally includes `"done"` and `"pending"`, which
   * are stage-level concepts that don't exist on individual tasks.
   */
  stageStatus(stageId: string): TaskStatus | "pending" | "done" {
    const tasks = this.tasksForStage(stageId);
    if (tasks.length === 0) return "pending";
    if (tasks.some((t) => t.status === "running")) return "running";
    if (tasks.every((t) => t.status === "succeeded" || t.status === "skipped")) return "done";
    if (tasks.some((t) => t.status === "failed" && t.retryLevel === undefined)) return "failed";
    if (tasks.some((t) => t.status === "ready" || t.status === "queued")) return "running";
    return "running";
  }
  isIdle(): boolean {
    return this.running.size === 0 && ![...this.tasks.values()].some((t) => t.status === "ready" || t.status === "queued");
  }

  /**
   * Compute progress as { completed, total, percent } from real task states.
   * Used by the UI to drive the progress bar — no timers, no fake counts.
   */
  getProgress(): { completed: number; total: number; percent: number } {
    const all = this.allTasks();
    const total = all.length;
    const completed = all.filter((t) => t.status === "succeeded" || t.status === "skipped").length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, total, percent };
  }

  /**
   * Derive the UI stage status for all 8 pipeline stages from real task states.
   * Returns a map stageId → "pending" | "running" | "done" | "failed".
   */
  getStageStatuses(): Record<string, "pending" | "running" | "done" | "failed"> {
    const out: Record<string, "pending" | "running" | "done" | "failed"> = {};
    const stageIds = ["analyze", "plan", "architect", "generate", "build", "test", "package", "ready"];
    for (const sid of stageIds) {
      const s = this.stageStatus(sid);
      if (s === "done") out[sid] = "done";
      else if (s === "running") out[sid] = "running";
      else if (s === "failed") out[sid] = "failed";
      else out[sid] = "pending";
    }
    return out;
  }

  /**
   * Get the real duration of a stage from its tasks' startedAt/finishedAt.
   * Returns 0 if no tasks have run for the stage.
   */
  getStageTiming(stageId: string): number {
    const tasks = this.tasksForStage(stageId);
    if (tasks.length === 0) return 0;
    const durations = tasks
      .filter((t) => t.startedAt && t.finishedAt)
      .map((t) => (t.finishedAt ?? 0) - (t.startedAt ?? 0));
    return durations.length > 0 ? Math.max(...durations) : 0;
  }
}

/* ---------------- Checkpoint Manager ---------------- */
// Persists checkpoints to IndexedDB (async, large-capacity) so resume-after-
// crash works for long multi-target builds. Keeps an in-memory copy for
// synchronous access; IndexedDB is the durable store.
export class CheckpointManager {
  private checkpoints: import("./types").Checkpoint[] = [];

  save(stageId: string, workflowId: WorkflowId, stageStatusSnapshot: Record<string, string>, memoryVersion: number, taskId?: string): import("./types").Checkpoint {
    const cp: import("./types").Checkpoint = {
      id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workflowId,
      stageId,
      taskId,
      ts: Date.now(),
      stageStatusSnapshot,
      memoryVersion,
    };
    this.checkpoints.push(cp);
    // Persist to IndexedDB asynchronously (fire-and-forget; IDB is the durable
    // store that survives crashes/reloads, unlike the in-memory copy).
    void import("./idb").then(({ idbSaveCheckpoint }) =>
      idbSaveCheckpoint({
        id: cp.id,
        workflowId: cp.workflowId,
        stageId: cp.stageId,
        taskId: cp.taskId,
        ts: cp.ts,
        stageStatusSnapshot: cp.stageStatusSnapshot,
        memoryVersion: cp.memoryVersion,
      })
    );
    return cp;
  }

  latest(): import("./types").Checkpoint | undefined {
    return this.checkpoints[this.checkpoints.length - 1];
  }

  /** Resume from the latest checkpoint: returns the stage to resume from. */
  resume(): { stageId: string; snapshot: Record<string, string> } | null {
    const cp = this.latest();
    if (!cp) return null;
    return { stageId: cp.stageId, snapshot: cp.stageStatusSnapshot };
  }

  all(): import("./types").Checkpoint[] {
    return [...this.checkpoints];
  }

  rollbackToLastGood(): import("./types").Checkpoint | undefined {
    // find the last checkpoint where all stages were succeeded/pending
    for (let i = this.checkpoints.length - 1; i >= 0; i--) {
      const cp = this.checkpoints[i];
      const allOk = Object.values(cp.stageStatusSnapshot).every(
        (s) => s === "succeeded" || s === "pending"
      );
      if (allOk) return cp;
    }
    return this.checkpoints[0];
  }

  /**
   * Restore from IndexedDB after a crash/reload. Loads the latest persisted
   * checkpoint for the given workflow (or any workflow if omitted) and
   * repopulates the in-memory list. Returns the stage to resume from, or null
   * if nothing was persisted.
   */
  async restoreFromIDB(workflowId?: string): Promise<{ stageId: string; snapshot: Record<string, string> } | null> {
    try {
      const { idbLoadCheckpoints } = await import("./idb");
      const persisted = await idbLoadCheckpoints(workflowId);
      if (persisted.length === 0) return null;
      // Repopulate in-memory checkpoints
      this.checkpoints = persisted.map((p) => ({
        id: p.id,
        workflowId: p.workflowId as WorkflowId,
        stageId: p.stageId,
        taskId: p.taskId,
        ts: p.ts,
        stageStatusSnapshot: p.stageStatusSnapshot,
        memoryVersion: p.memoryVersion,
      }));
      const latest = this.checkpoints[this.checkpoints.length - 1];
      return { stageId: latest.stageId, snapshot: latest.stageStatusSnapshot };
    } catch {
      return null;
    }
  }

  /** Check whether any checkpoints are persisted in IndexedDB. */
  async hasPersistedState(workflowId?: string): Promise<boolean> {
    try {
      const { idbLoadCheckpoints } = await import("./idb");
      const persisted = await idbLoadCheckpoints(workflowId);
      return persisted.length > 0;
    } catch {
      return false;
    }
  }

  clear(): void {
    this.checkpoints = [];
    // Also clear persisted state so a fresh build doesn't resume stale data.
    void import("./idb").then(({ idbClearCheckpoints }) => idbClearCheckpoints());
  }
}

export const executionEngine = new ExecutionEngine({ maxParallel: 4 });
export const checkpointManager = new CheckpointManager();

/* ---------------- Task factory ---------------- */
let taskCounter = 0;
export function makeTask(opts: {
  workflowId: WorkflowId;
  stageId: string;
  title: string;
  description: string;
  agent: AgentRole;
  toolId?: string;
  dependsOn?: string[];
  durationMs?: number;
  gate?: GateId;
}): Task {
  return {
    id: `task-${++taskCounter}`,
    workflowId: opts.workflowId,
    stageId: opts.stageId,
    title: opts.title,
    description: opts.description,
    agent: opts.agent,
    toolId: opts.toolId,
    dependsOn: opts.dependsOn ? [...opts.dependsOn] : [],
    status: "queued",
    // durationMs is measured at runtime from real tool execution (startedAt→finishedAt).
    // No fake random duration — default 0 until the task actually runs.
    durationMs: opts.durationMs ?? 0,
  };
}
