// TaskGraph — a mutable DAG of tasks (Wave 1A, Runtime V2 Migration).
//
// Unlike the current submit-once model where the orchestrator builds the task
// list once and the ExecutionEngine runs it to completion, the TaskGraph can be
// updated DURING execution. New tasks can be inserted (e.g., verification-driven
// fix tasks created by the future Verification Loop), and existing tasks can be
// marked as superseded when a fix replaces their output.
//
// The graph tracks:
//   - All tasks (queued, ready, running, succeeded, failed, …)
//   - Dependency edges (task → dependsOn[])
//   - Insertion order (for deterministic scheduling)
//   - Mutation log (for observability — what was added when and why)
//
// Status note: the underlying `TaskStatus` union is
//   `queued | ready | running | succeeded | failed | cancelled | skipped`.
// Where the original migration spec spoke of "pending"/"completed", we use the
// real TaskStatus values (`queued` / `succeeded`) so the graph reflects actual
// engine state instead of an abstract parallel vocabulary.

import type { Task } from "./types";

/**
 * A single mutation event recorded against the TaskGraph. The full mutation
 * log is exposed via `getMutations()` and rolled up into `getSummary()` so
 * observers can see exactly when (and why) tasks entered or left the graph.
 */
export interface TaskGraphMutation {
  type: "add" | "insert" | "supersede" | "remove";
  taskId: string;
  timestamp: number;
  reason?: string;
}

/**
 * Mutable DAG of tasks. The TaskGraph is a passive data structure — it does
 * not schedule or execute tasks itself. The ExecutionEngine remains the
 * scheduler; the TaskGraph provides the structured, queryable, mutable task
 * store that the V2 architecture requires.
 *
 * Lifecycle:
 *   1. Orchestrator (or Workflow Engine) builds the initial graph via
 *      `addAll(tasks)` before starting the engine.
 *   2. ExecutionEngine runs the tasks; their `status` fields are mutated
 *      in-place by the engine (the graph holds the SAME Task object refs).
 *   3. The Verification Loop (Wave 1C, future) calls `insert(task, reason)`
 *      to add fix tasks on verification failure, then calls
 *      `executionEngine.insertTask(task)` to actually schedule them.
 *   4. `supersede(oldId, newId)` marks an old task as no longer authoritative
 *      when a fix replaces its output (status set to "failed" so the engine
 *      and trace treat it as terminal).
 */
export class TaskGraph {
  private tasks = new Map<string, Task>();
  private mutations: TaskGraphMutation[] = [];
  private insertionOrder: string[] = [];

  /** Add a task to the graph (initial build). Idempotent on the id — adding
   *  a task whose id already exists will overwrite the prior entry but will
   *  still record an `add` mutation. */
  add(task: Task): void {
    this.tasks.set(task.id, task);
    if (!this.insertionOrder.includes(task.id)) {
      this.insertionOrder.push(task.id);
    }
    this.mutations.push({ type: "add", taskId: task.id, timestamp: Date.now() });
  }

  /** Add multiple tasks (initial build). */
  addAll(tasks: Task[]): void {
    for (const t of tasks) this.add(t);
  }

  /**
   * Insert a task into a RUNNING graph. This is the key V2 capability:
   * verification failures insert fix tasks without stopping the build.
   *
   * Distinct from `add()` in that it records an `insert` mutation (not `add`)
   * so observers can distinguish initial-graph tasks from runtime-inserted
   * tasks. Callers should pair this with `executionEngine.insertTask(task)`
   * to actually schedule the task.
   */
  insert(task: Task, reason?: string): void {
    this.tasks.set(task.id, task);
    if (!this.insertionOrder.includes(task.id)) {
      this.insertionOrder.push(task.id);
    }
    this.mutations.push({
      type: "insert",
      taskId: task.id,
      timestamp: Date.now(),
      reason,
    });
  }

  /**
   * Mark a task as superseded by another (e.g., old version replaced by a
   * fix task). The old task's status is set to "failed" so the engine and
   * trace treat it as terminal; the new task is expected to already exist in
   * the graph (typically inserted via `insert()` immediately before).
   *
   * No-op if the old task is not in the graph.
   */
  supersede(oldTaskId: string, newTaskId: string, reason?: string): void {
    const old = this.tasks.get(oldTaskId);
    if (!old) return;
    old.status = "failed";
    this.mutations.push({
      type: "supersede",
      taskId: oldTaskId,
      timestamp: Date.now(),
      reason: reason ?? `superseded by ${newTaskId}`,
    });
  }

  /** Get a task by ID. */
  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /** Get all tasks in insertion order. */
  all(): Task[] {
    return this.insertionOrder
      .map((id) => this.tasks.get(id))
      .filter((t): t is Task => Boolean(t));
  }

  /**
   * Get tasks that are ready to run: dependencies satisfied (every dep is in
   * `completedTaskIds`) and the task itself has not yet been dispatched by
   * the engine (status is `queued` or `ready`).
   *
   * `completedTaskIds` is supplied by the caller (typically the set of task
   * ids whose status is `succeeded` or `skipped`); the TaskGraph itself does
   * not track completion separately from the Task objects' status fields.
   */
  ready(completedTaskIds: Set<string>): Task[] {
    return this.all().filter(
      (t) =>
        (t.status === "queued" || t.status === "ready") &&
        t.dependsOn.every((dep) => completedTaskIds.has(dep))
    );
  }

  /** Get tasks by status. */
  byStatus(status: Task["status"]): Task[] {
    return this.all().filter((t) => t.status === status);
  }

  /** Get tasks by agent role. */
  byAgent(agent: string): Task[] {
    return this.all().filter((t) => t.agent === agent);
  }

  /** Get tasks by stage id. */
  byStage(stageId: string): Task[] {
    return this.all().filter((t) => t.stageId === stageId);
  }

  /** Get the mutation log (for observability). Returns a defensive copy so
   *  callers cannot mutate the internal log. */
  getMutations(): TaskGraphMutation[] {
    return [...this.mutations];
  }

  /** Get a summary for debugging. Mirrors the shape expected by the
   *  /api/debug/task-graph endpoint. */
  getSummary() {
    const tasks = this.all();
    return {
      totalTasks: tasks.length,
      queued: tasks.filter((t) => t.status === "queued").length,
      ready: tasks.filter((t) => t.status === "ready").length,
      running: tasks.filter((t) => t.status === "running").length,
      succeeded: tasks.filter((t) => t.status === "succeeded").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      cancelled: tasks.filter((t) => t.status === "cancelled").length,
      skipped: tasks.filter((t) => t.status === "skipped").length,
      mutations: this.mutations.length,
      insertions: this.mutations.filter((m) => m.type === "insert").length,
      supersedes: this.mutations.filter((m) => m.type === "supersede").length,
      recentMutations: this.mutations.slice(-10),
    };
  }

  /** Clear the graph (for a fresh build). */
  clear(): void {
    this.tasks.clear();
    this.mutations = [];
    this.insertionOrder = [];
  }
}

/** Shared singleton TaskGraph instance. Importing this module bootstraps the
 *  graph; the orchestrator (and future Wave 1C Verification Loop) populate
 *  it during a build. */
export const taskGraph = new TaskGraph();
