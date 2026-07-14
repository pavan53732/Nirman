// AgentRuntime — sub-agent activation tracer.
//
// Pavan's orchestrator builds a DAG of Tasks; each Task carries an `agent`
// (an AgentRole). The ExecutionEngine dispatches those tasks at runtime, which
// is the moment a "sub-agent" is conceptually activated. This tracer subscribes
// to the ExecutionEngine event bus (exactly like observability.ts does) and
// records, per agent:
//   - activatedAt  : the ts of the FIRST `task-started` event for that agent
//   - completedAt  : the ts of the LAST `task-succeeded` / `task-failed` event
//   - taskIds      : every task id the agent handled
//   - status       : "active" if any of its tasks are still running, else "completed"
//
// This is RUNTIME PROOF that dynamically-spawned agents actually activate and
// complete — not just exist as static config. Exposed via /api/agents/trace.
//
// IMPORTANT: EngineEvent only carries `taskId` (not a full Task object), so the
// tracer resolves the Task (and its `agent` field) via a lookup function passed
// to `attach()`. This keeps the tracer decoupled from the engine internals
// while still giving us the agent attribution we need.

import type { AgentLayer, AgentRole, EngineEvent, Task } from "./types";
import { agents } from "./data/agents";

/* ---------------- Agent metadata (sourced from data/agents.ts) ---------------- */

/** Human-readable label per agent role (the `name` field on the Agent registry). */
export const AGENT_LABELS: Record<string, string> = Object.fromEntries(
  agents.map((a) => [a.role, a.name])
);

/** Layer display name per agent role, e.g. "Layer 3: Engineering". */
export const AGENT_LAYERS: Record<string, string> = Object.fromEntries(
  agents.map((a) => [a.role, layerLabel(a.layer)])
);

function layerLabel(layer: AgentLayer): string {
  switch (layer) {
    case "executive":
      return "Layer 1: Executive";
    case "architecture":
      return "Layer 2: Architecture";
    case "engineering":
      return "Layer 3: Engineering";
    case "quality":
      return "Layer 4: Quality & Delivery";
    case "cross-cutting":
      return "Layer 5: Cross-cutting Services";
    case "dynamic":
      return "Layer 6: Dynamic Sub-agents";
    default:
      return "Unknown Layer";
  }
}

/* ---------------- Tracer ---------------- */

export interface AgentActivation {
  agent: AgentRole;
  /** Human label sourced from data/agents.ts (e.g. "Forge" for frontend-generator). */
  label: string;
  /** ts of the FIRST task-started event for this agent. */
  activatedAt: number;
  /** ts of the LAST task-succeeded/task-failed event for this agent, or null if still active. */
  completedAt: number | null;
  /** All task ids this agent handled (deduped, insertion-ordered). */
  taskIds: string[];
  /** Number of distinct tasks dispatched to this agent. */
  taskCount: number;
  /** "active" if any of this agent's tasks are still running, otherwise "completed". */
  status: "active" | "completed";
  /** Display label for the agent's layer (e.g. "Layer 3: Engineering"). */
  layer: string;
  /** Most recent stageId this agent operated in (convenience for the UI). */
  stageId?: string;
}

export class AgentRuntime {
  private activations = new Map<AgentRole, AgentActivation>();
  /** How many of this agent's tasks are currently running (drives `status`). */
  private activeCount = new Map<AgentRole, number>();
  private listener?: (e: EngineEvent) => void;
  private unsubscribe?: () => void;
  private getTask?: (taskId: string) => Task | undefined;
  private attached = false;

  /**
   * Subscribe to an event bus.
   *
   * @param subscribe  The event-bus subscribe fn (e.g. `executionEngine.subscribe`).
   * @param getTask    Resolves a taskId to a Task so we can read `task.agent`.
   *                   The ExecutionEngine events carry only `taskId`, not the
   *                   full task, so this lookup is mandatory.
   */
  attach(
    subscribe: (fn: (e: EngineEvent) => void) => () => void,
    getTask: (taskId: string) => Task | undefined
  ): void {
    if (this.attached) return; // idempotent — never double-subscribe
    this.attached = true;
    this.getTask = getTask;
    this.listener = (e: EngineEvent) => this.handleEvent(e);
    this.unsubscribe = subscribe(this.listener);
  }

  /** Detach from the event bus. Safe to call multiple times. */
  detach(): void {
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch {
        /* ignore — best-effort cleanup */
      }
    }
    this.unsubscribe = undefined;
    this.listener = undefined;
    this.getTask = undefined;
    this.attached = false;
  }

  /** Returns true once `attach()` has wired the tracer to a live event bus. */
  isAttached(): boolean {
    return this.attached;
  }

  private handleEvent(e: EngineEvent): void {
    // EngineEvent carries only `taskId`, so resolve the Task to read `agent`.
    if (!e.taskId) return;
    const task = this.getTask?.(e.taskId);
    if (!task || !task.agent) return;
    const agent = task.agent;

    if (e.type === "task-started") {
      const existing = this.activations.get(agent);
      if (!existing) {
        this.activations.set(agent, {
          agent,
          label: AGENT_LABELS[agent] ?? agent,
          activatedAt: e.ts,
          completedAt: null,
          taskIds: [task.id],
          taskCount: 1,
          status: "active",
          layer: AGENT_LAYERS[agent] ?? "Unknown Layer",
          stageId: task.stageId,
        });
      } else {
        // Another task for an already-activated agent — track it and (re)mark active.
        if (!existing.taskIds.includes(task.id)) {
          existing.taskIds.push(task.id);
          existing.taskCount += 1;
        }
        existing.stageId = task.stageId;
        existing.status = "active";
        existing.completedAt = null;
      }
      this.activeCount.set(agent, (this.activeCount.get(agent) ?? 0) + 1);
      return;
    }

    if (e.type === "task-succeeded" || e.type === "task-failed") {
      const existing = this.activations.get(agent);
      if (!existing) {
        // A completion arrived without a prior activation record — still record
        // it so we never lose proof that this agent ran. Synthesize an activation
        // using the completion ts as both activation and completion (best-effort).
        this.activations.set(agent, {
          agent,
          label: AGENT_LABELS[agent] ?? agent,
          activatedAt: e.ts,
          completedAt: e.ts,
          taskIds: [task.id],
          taskCount: 1,
          status: "completed",
          layer: AGENT_LAYERS[agent] ?? "Unknown Layer",
          stageId: task.stageId,
        });
        return;
      }
      // Decrement active count; `completedAt` always tracks the LATEST completion
      // event for this agent (last-task-done semantics).
      const prev = this.activeCount.get(agent) ?? 0;
      const next = Math.max(0, prev - 1);
      this.activeCount.set(agent, next);
      existing.completedAt = e.ts;
      existing.status = next > 0 ? "active" : "completed";
      return;
    }
  }

  /** All recorded activations, sorted by activation time (oldest first). */
  getActivations(): AgentActivation[] {
    return [...this.activations.values()].sort((a, b) => a.activatedAt - b.activatedAt);
  }

  /** A single activation by agent role, if any. */
  getActivation(agent: AgentRole): AgentActivation | undefined {
    return this.activations.get(agent);
  }

  /** Snapshot summary useful for quick UI badges / logs. */
  getSummary(): {
    totalAgents: number;
    activeAgents: number;
    completedAgents: number;
    totalTasks: number;
  } {
    const all = this.getActivations();
    return {
      totalAgents: all.length,
      activeAgents: all.filter((a) => a.status === "active").length,
      completedAgents: all.filter((a) => a.status === "completed").length,
      totalTasks: all.reduce((sum, a) => sum + a.taskCount, 0),
    };
  }

  /** Reset all recorded activations (e.g. on a fresh build). */
  clear(): void {
    this.activations.clear();
    this.activeCount.clear();
  }
}

/* ---------------- Singleton ---------------- */

export const agentRuntime = new AgentRuntime();

/* ---------------- Auto-attach (client + server, lazy) ---------------- */
//
// We attach on BOTH the client and the server. The orchestrator runs CLIENT-
// SIDE (Zustand store), so the client-side executionEngine singleton is the
// one that actually dispatches tasks. The client-side tracer records agent
// activations, then the orchestrator's scheduleTraceSync() POSTs them to the
// server's /api/agents/trace endpoint.
//
// We lazy-import the engine to avoid any chance of a circular import at
// module-load time (the engine imports many things; this tracer is near the
// leaf).

let autoAttachStarted = false;
export function initAgentRuntime(): void {
  if (autoAttachStarted) return;
  autoAttachStarted = true;
  void import("./execution-engine")
    .then(({ executionEngine }) => {
      // Resolve a taskId to its Task so we can read `agent`. allTasks() returns
      // the full live Map view (including completed tasks), which is exactly
      // what we need to attribute late-arriving completion events.
      const getTask = (taskId: string): Task | undefined =>
        executionEngine.allTasks().find((t) => t.id === taskId);
      agentRuntime.attach(
        (fn) => executionEngine.subscribe(fn),
        getTask
      );
    })
    .catch(() => {
      // If the engine module fails to load, stay detached — the endpoint will
      // simply report an empty list rather than crash.
    });
}

// Kick off auto-attach eagerly so that by the time a build runs, the tracer
// is already wired up to the executionEngine event bus.
initAgentRuntime();
