// Smart Scheduler — provides intelligent scheduling strategies on top of the
// ExecutionEngine's basic FIFO scheduler.
//
// (Depth-5: "Smarter execution strategies — priority scheduling,
//  resource-aware parallelism, adaptive concurrency, deadline-aware.")
//
// Strategies:
//   1. Priority scheduling — tasks with higher priority run first
//   2. Resource-aware parallelism — reduce concurrency under memory pressure
//   3. Adaptive concurrency — adjust maxParallel based on tool performance
//   4. Deadline-aware — critical-path tasks get priority
//
// The SmartScheduler does NOT replace the ExecutionEngine. It PROVIDES
// scheduling decisions (which task next, how many parallel) that the
// ExecutionEngine can consult. The ExecutionEngine remains the single source
// of truth for actually dispatching tasks; the SmartScheduler is an advisory
// layer that future waves can wire into the engine's trySchedule() loop.
//
// This module is ADDITIVE — it does NOT modify execution-engine.ts,
// orchestrator.ts, task-graph.ts, or tool-intelligence.ts. The
// `smartScheduler` singleton is created at module load; consumers (the debug
// endpoint, a future wave's trySchedule() integration) import it and call
// `recommendOrder()` / `recommendConcurrency()` to get decisions.
//
// Backward compatibility: no existing symbol is modified. The SmartScheduler
// ships with a clean public API: `setPriority`, `getPriority`,
// `autoAssignPriorities`, `recommendOrder`, `recommendConcurrency`,
// `getCriticalPath`, `getSummary`, `clear`. Default config matches the
// ExecutionEngine's existing `maxParallel: 4` so behavior is identical to
// pre-Depth-5 when no scheduler signals are populated.

import type { Task } from "./types";

/**
 * Task priority levels, ordered from most to least urgent:
 *   - critical  : on the critical path (compilation gates, blocking downstream)
 *   - high      : produces work for downstream tasks (generation)
 *   - normal    : default for ordinary tasks (build, test)
 *   - low       : not on the critical path (packaging, documentation)
 *   - background: no dependents AND no dependencies (can be deferred)
 */
export type TaskPriority = "critical" | "high" | "normal" | "low" | "background";

/**
 * One task's recommended scheduling decision. Produced by `recommendOrder()`
 * for each ready task; the caller (ExecutionEngine, debug UI) consumes the
 * sorted list to decide dispatch order.
 */
export interface SchedulingDecision {
  taskId: string;
  priority: TaskPriority;
  /** Human-readable explanation of why this priority was chosen. */
  reason: string;
  /** Estimated wall-clock duration in ms (from `task.durationMs` if set, else stage heuristics). */
  estimatedDurationMs: number;
  /** Whether the task should be dispatched in the current tick. Background tasks may be deferred when the queue is deep. */
  shouldRunNow: boolean;
}

/**
 * Recommended concurrency level + the factors that drove the decision.
 * Produced by `recommendConcurrency()`; the caller can apply it by setting
 * `executionEngine.maxParallel` (or by gating dispatch in trySchedule()).
 */
export interface ConcurrencyRecommendation {
  /** Recommended max parallel tasks for the current tick. */
  maxParallel: number;
  /** Human-readable explanation of all adjustments applied. */
  reason: string;
  /** The raw signals that drove the recommendation (for observability). */
  factors: {
    /** 0-1, where 1 = at/above 2x memoryThresholdMB. */
    memoryPressure: number;
    /** 0-1, where 1 = very fast (≤1s avg) and 0 = very slow (≥60s avg). */
    avgToolSpeed: number;
    /** Number of tasks currently waiting to be dispatched. */
    taskQueueDepth: number;
    /** Number of tasks on the critical path (counted by autoAssignPriorities). */
    criticalPathTasks: number;
  };
}

/**
 * Configuration for the SmartScheduler. All fields have sensible defaults
 * matching the existing ExecutionEngine behavior; callers override only what
 * they need.
 */
export interface SmartSchedulerConfig {
  /** Default parallelism level (matches ExecutionEngine's maxParallel=4). */
  baseMaxParallel: number;
  /** Floor for parallelism — never go below this, even under heavy pressure. */
  minParallel: number;
  /** Ceiling for parallelism — never exceed this, even with fast tools. */
  maxParallel: number;
  /** Heap usage (MB) above which parallelism is reduced. */
  memoryThresholdMB: number;
  /** Tool avg duration (ms) above which tools are considered "slow". */
  slowToolThresholdMs: number;
}

const DEFAULT_CONFIG: SmartSchedulerConfig = {
  baseMaxParallel: 4,
  minParallel: 1,
  maxParallel: 8,
  memoryThresholdMB: 512, // 512 MB heap
  slowToolThresholdMs: 30000, // 30s
};

/**
 * SmartScheduler — the advisory scheduling layer.
 *
 * State:
 *   - `taskPriorities` — per-task priority assignments (set explicitly via
 *     `setPriority()` or auto-derived via `autoAssignPriorities()`).
 *   - `criticalPath` — set of task IDs that block the most downstream work
 *     (currently: compilation gates, since they block all downstream
 *     build/test/package tasks).
 *
 * The scheduler is stateless across builds — call `clear()` between builds
 * to reset priority assignments. The shared `smartScheduler` singleton is
 * safe to import from anywhere in the engine.
 */
export class SmartScheduler {
  private config: SmartSchedulerConfig;
  private taskPriorities = new Map<string, TaskPriority>();
  private criticalPath = new Set<string>();

  constructor(config: Partial<SmartSchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Assign a priority to a task. Explicit assignments override
   * auto-assignment. Marking a task "critical" also adds it to the
   * critical-path set (used by `recommendConcurrency()`'s factors).
   */
  setPriority(taskId: string, priority: TaskPriority): void {
    this.taskPriorities.set(taskId, priority);
    if (priority === "critical") {
      this.criticalPath.add(taskId);
    }
  }

  /**
   * Get the priority of a task (defaults to "normal" if not set).
   */
  getPriority(taskId: string): TaskPriority {
    return this.taskPriorities.get(taskId) ?? "normal";
  }

  /**
   * Auto-assign priorities based on task metadata (stage, gate, dependency
   * graph). Heuristics:
   *
   *   - Compilation gates → "critical" (they block ALL downstream work)
   *   - Other gates → "high"
   *   - Generation stage → "high" (produces work for downstream)
   *   - Build/test stage → "normal"
   *   - Packaging/documentation → "low"
   *   - Tasks with no dependents AND no deps AND not generate → "background"
   *
   * The background check is guarded by `priority === "normal"` so it cannot
   * downgrade a task that already earned a higher (critical/high) or lower
   * (low) priority. This prevents, e.g., a compilation gate with no deps
   * from being misclassified as background.
   */
  autoAssignPriorities(tasks: Task[]): void {
    for (const task of tasks) {
      let priority: TaskPriority = "normal";

      // Gate tasks on the critical path are high priority
      if (task.gate) {
        priority = "high";
        // Compilation gates are critical (they block downstream work)
        if (task.gate === "compilation") {
          priority = "critical";
          this.criticalPath.add(task.id);
        }
      }

      // Generation tasks are high priority (they produce work for others)
      if (task.stageId === "generate") {
        priority = "high";
      }

      // Build/test tasks are normal — but ONLY when no gate has already set
      // a higher priority. Without the `!task.gate` guard, this would
      // clobber a compilation gate's "critical" priority back to "normal"
      // (since "build" is the stageId for compilation gates). The check is
      // otherwise a no-op (priority already defaults to "normal") — kept
      // for explicitness and to make the intent visible to future readers.
      if (!task.gate && (task.stageId === "build" || task.stageId === "test")) {
        priority = "normal";
      }

      // Documentation/packaging are low priority (not on critical path)
      if (task.stageId === "package" || task.title.toLowerCase().includes("document")) {
        priority = "low";
      }

      // Tasks with no dependencies and no dependents are background — but
      // ONLY if they haven't already been assigned a non-normal priority
      // (critical/high/low). This guard prevents the background heuristic
      // from downgrading, e.g., a compilation gate with no deps to
      // "background" (which would defeat deadline-aware scheduling).
      const hasDependents = tasks.some((t) => t.dependsOn.includes(task.id));
      if (
        priority === "normal" &&
        !hasDependents &&
        task.dependsOn.length === 0 &&
        task.stageId !== "generate"
      ) {
        priority = "background";
      }

      this.setPriority(task.id, priority);
    }
  }

  /**
   * Get the recommended execution order for a set of ready tasks.
   *
   * Sort order:
   *   1. Priority (critical first, background last)
   *   2. Within the same priority, shorter estimated duration first
   *      (minimize total waiting time — shortest-job-first)
   *
   * The `shouldRunNow` flag is true for all non-background tasks; background
   * tasks run only when the ready queue is shallow (≤2 tasks), so they
   * don't starve when the system is busy.
   */
  recommendOrder(readyTasks: Task[]): SchedulingDecision[] {
    const priorityOrder: Record<TaskPriority, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3,
      background: 4,
    };

    return readyTasks
      .map((task) => {
        const priority = this.getPriority(task.id);
        const estimatedDurationMs = this.estimateDuration(task);
        return {
          taskId: task.id,
          priority,
          reason: this.priorityReason(task, priority),
          estimatedDurationMs,
          shouldRunNow: priority !== "background" || readyTasks.length <= 2,
        };
      })
      .sort((a, b) => {
        // Sort by priority first
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        // Same priority: shorter tasks first (minimize waiting)
        return a.estimatedDurationMs - b.estimatedDurationMs;
      });
  }

  /**
   * Recommend the current concurrency level based on runtime factors.
   *
   * Algorithm (additive adjustments on top of `baseMaxParallel`):
   *   1. Memory pressure > 0.7  → halve parallelism (floor: minParallel)
   *      Memory pressure > 0.5  → quarter-reduce (×0.75)
   *   2. Avg tool speed < 0.3   → halve parallelism (slow tools waste slots)
   *      Avg tool speed > 0.7   → boost ×1.5 IF queue is deep (cap: maxParallel)
   *   3. Queue depth < recommended → cap at queue depth (no point having
   *      more slots than tasks waiting)
   *
   * Returns the recommended `maxParallel`, a human-readable reason string,
   * and the raw factors for observability.
   */
  recommendConcurrency(opts: {
    currentMemoryMB?: number;
    avgToolDurationMs?: number;
    queueDepth?: number;
    runningTasks?: number;
  }): ConcurrencyRecommendation {
    const memoryPressure = this.calculateMemoryPressure(opts.currentMemoryMB);
    const avgToolSpeed = this.calculateToolSpeed(opts.avgToolDurationMs);

    let recommended = this.config.baseMaxParallel;
    const reasons: string[] = [];

    // Reduce parallelism under memory pressure
    if (memoryPressure > 0.7) {
      recommended = Math.max(this.config.minParallel, Math.floor(recommended * 0.5));
      reasons.push(
        `high memory pressure (${(memoryPressure * 100).toFixed(0)}%) — reduced parallelism`
      );
    } else if (memoryPressure > 0.5) {
      recommended = Math.max(this.config.minParallel, Math.floor(recommended * 0.75));
      reasons.push(
        `moderate memory pressure (${(memoryPressure * 100).toFixed(0)}%) — slightly reduced parallelism`
      );
    }

    // Reduce parallelism if tools are slow
    if (avgToolSpeed < 0.3) {
      recommended = Math.max(this.config.minParallel, Math.floor(recommended * 0.5));
      reasons.push(
        `slow tools detected (avg ${opts.avgToolDurationMs?.toFixed(0)}ms) — reduced parallelism`
      );
    } else if (avgToolSpeed > 0.7) {
      // Increase parallelism if tools are fast and queue is deep
      if ((opts.queueDepth ?? 0) > recommended) {
        recommended = Math.min(this.config.maxParallel, Math.floor(recommended * 1.5));
        reasons.push(`fast tools + deep queue — increased parallelism`);
      }
    }

    // Don't exceed queue depth — more slots than tasks is wasteful
    if ((opts.queueDepth ?? 0) < recommended) {
      recommended = Math.max(1, opts.queueDepth ?? 1);
      reasons.push(`queue depth (${opts.queueDepth}) limits parallelism`);
    }

    if (reasons.length === 0) {
      reasons.push(`base parallelism (${this.config.baseMaxParallel}) — no adjustments needed`);
    }

    return {
      maxParallel: recommended,
      reason: reasons.join("; "),
      factors: {
        memoryPressure,
        avgToolSpeed,
        taskQueueDepth: opts.queueDepth ?? 0,
        criticalPathTasks: this.criticalPath.size,
      },
    };
  }

  /**
   * Get the critical path (tasks that block the most downstream work).
   * Currently populated by `autoAssignPriorities()` for compilation gates
   * and by explicit `setPriority(id, "critical")` calls.
   */
  getCriticalPath(): string[] {
    return [...this.criticalPath];
  }

  /**
   * Get a summary for debugging. Returns the total number of prioritized
   * tasks, a count per priority level, the critical-path length, and the
   * active config.
   */
  getSummary() {
    const priorities = [...this.taskPriorities.entries()];
    const byPriority: Record<TaskPriority, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
      background: 0,
    };
    for (const [, p] of priorities) {
      byPriority[p]++;
    }

    return {
      totalTasksPrioritized: priorities.length,
      byPriority,
      criticalPathLength: this.criticalPath.size,
      config: this.config,
    };
  }

  /**
   * Calculate memory pressure as a 0-1 scalar.
   *   - currentMemoryMB ≤ 0.5 × threshold → 0 (no pressure)
   *   - currentMemoryMB ≥ 2.0 × threshold → 1 (max pressure)
   *   - In between: linear scale
   */
  private calculateMemoryPressure(currentMemoryMB?: number): number {
    if (currentMemoryMB === undefined) return 0;
    if (currentMemoryMB <= this.config.memoryThresholdMB * 0.5) return 0;
    if (currentMemoryMB >= this.config.memoryThresholdMB * 2) return 1;
    // Linear scale between 0.5x and 2x threshold
    return (
      (currentMemoryMB - this.config.memoryThresholdMB * 0.5) /
      (this.config.memoryThresholdMB * 1.5)
    );
  }

  /**
   * Calculate tool speed as a 0-1 scalar (1 = fast, 0 = slow).
   *   - avgDurationMs ≤ 1000ms  → 1 (very fast)
   *   - avgDurationMs ≥ 60000ms → 0 (very slow)
   *   - In between: linear scale
   */
  private calculateToolSpeed(avgDurationMs?: number): number {
    if (avgDurationMs === undefined) return 0.5;
    if (avgDurationMs <= 1000) return 1; // 1s = very fast
    if (avgDurationMs >= 60000) return 0; // 60s = very slow
    // Linear scale between 1s and 60s
    return 1 - (avgDurationMs - 1000) / 59000;
  }

  /**
   * Estimate a task's duration. Uses `task.durationMs` if set (the engine
   * populates this from real tool execution after the first run); otherwise
   * falls back to a stage-based heuristic.
   */
  private estimateDuration(task: Task): number {
    // Use task.durationMs if set, otherwise estimate by stage
    if (task.durationMs > 0) return task.durationMs;

    switch (task.stageId) {
      case "analyze":
      case "plan":
        return 500;
      case "generate":
        return 5000;
      case "build":
        return 30000;
      case "test":
        return 10000;
      case "package":
        return 15000;
      default:
        return 2000;
    }
  }

  /**
   * Compose a human-readable reason string for a task's priority assignment.
   * Used by the debug endpoint to explain WHY each task got its priority.
   */
  private priorityReason(task: Task, priority: TaskPriority): string {
    const reasons: string[] = [];

    if (task.gate === "compilation") {
      reasons.push("compilation gate (critical path)");
    } else if (task.gate) {
      reasons.push(`${task.gate} gate`);
    }

    if (task.stageId === "generate") {
      reasons.push("generation stage (produces downstream work)");
    }

    if (task.dependsOn.length === 0) {
      reasons.push("no dependencies (ready immediately)");
    }

    if (task.dependsOn.length > 2) {
      reasons.push(`${task.dependsOn.length} dependencies (long chain)`);
    }

    if (priority === "background") {
      reasons.push("not on critical path");
    }

    return reasons.length > 0 ? reasons.join("; ") : "default priority";
  }

  /** Reset all priority assignments and the critical-path set. */
  clear(): void {
    this.taskPriorities.clear();
    this.criticalPath.clear();
  }
}

/**
 * Shared singleton SmartScheduler. Import this (NOT the class) from anywhere
 * in the engine or the API layer.
 *
 * On the SERVER (Next.js route handlers), the singleton is per-process —
 * every request sees the same accumulated priorities. On the CLIENT, it's
 * per-page-session. Call `clear()` between builds to reset state.
 */
export const smartScheduler = new SmartScheduler();
