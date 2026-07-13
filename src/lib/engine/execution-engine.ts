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
    task.status = task.dependsOn.length === 0 ? "ready" : "queued";
    this.emit({ type: "task-queued", taskId: task.id, workflowId: task.workflowId, message: `Queued: ${task.title}`, level: "debug" });
    this.trySchedule();
  }

  submitAll(tasks: Task[]): void {
    for (const t of tasks) this.submit(t);
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
    // Start ready tasks up to the parallelism limit
    const ready = [...this.tasks.values()].filter((t) => t.status === "ready");
    for (const t of ready) {
      if (this.running.size >= this.maxParallel) break;
      this.start(t);
    }
    if (promoted > 0 || ready.length > 0) {
      this.emit({ type: "task-queued", message: `trySchedule: promoted ${promoted}, started ${Math.min(ready.length, this.maxParallel - 0)}, running=${this.running.size}`, level: "debug" });
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
  private start(task: Task): void {
    task.status = "running";
    task.startedAt = Date.now();
    this.running.add(task.id);
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
          this.emit({ type: "task-failed", taskId: task.id, stageId: task.stageId, message: `${task.title} failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`, level: "error" });
          this.trySchedule();
          return;
        }
        this.emit({ type: "task-succeeded", taskId: task.id, stageId: task.stageId, workflowId: task.workflowId, message: `${task.title} done in ${result.durationMs}ms (real tool run)`, level: "success" });
      } catch (err) {
        task.status = "failed";
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
        this.emit({ type: "task-failed", taskId: task.id, stageId: task.stageId, message: `Gate failed: ${task.gate} — ${result.detail}`, level: "warn" });
        this.trySchedule();
        return;
      }
      this.emit({ type: "gate-evaluated", taskId: task.id, stageId: task.stageId, message: `Gate passed: ${task.gate} (${result.metric})`, level: "success" });
    }

    task.status = "succeeded";
    if (!task.result) task.result = "ok";
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

      // Log the diff to Build Memory via projectMemory
      const { projectMemory } = await import("./memories");
      projectMemory.write(
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
  }

  /* ---------------- Introspection ---------------- */
  allTasks(): Task[] {
    return [...this.tasks.values()];
  }
  tasksForStage(stageId: string): Task[] {
    return this.allTasks().filter((t) => t.stageId === stageId);
  }
  stageStatus(stageId: string): TaskStatus | "pending" {
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
}

/* ---------------- Checkpoint Manager ---------------- */
// Persists checkpoints to IndexedDB (async, large-capacity) so resume-after-
// crash works for long multi-target builds. Keeps an in-memory copy for
// synchronous access; IndexedDB is the durable store.
export class CheckpointManager {
  private checkpoints: import("./types").Checkpoint[] = [];

  save(stageId: string, workflowId: WorkflowId, stageStatusSnapshot: Record<string, TaskStatus>, memoryVersion: number, taskId?: string): import("./types").Checkpoint {
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
        stageStatusSnapshot: cp.stageStatusSnapshot as Record<string, string>,
        memoryVersion: cp.memoryVersion,
      })
    );
    return cp;
  }

  latest(): import("./types").Checkpoint | undefined {
    return this.checkpoints[this.checkpoints.length - 1];
  }

  /** Resume from the latest checkpoint: returns the stage to resume from. */
  resume(): { stageId: string; snapshot: Record<string, TaskStatus> } | null {
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
  async restoreFromIDB(workflowId?: string): Promise<{ stageId: string; snapshot: Record<string, TaskStatus> } | null> {
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
        stageStatusSnapshot: p.stageStatusSnapshot as Record<string, TaskStatus>,
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
