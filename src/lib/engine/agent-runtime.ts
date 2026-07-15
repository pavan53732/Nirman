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

import type {
  AgentLayer,
  AgentRole,
  Capability,
  EngineEvent,
  PlatformKind,
  Task,
} from "./types";
import type {
  AgentExecutionContext,
  AgentExecutionResult,
  AgentHandler,
  SkillContent,
  SubAgentSpec,
} from "./agent-contracts";
import { agents } from "./data/agents";
import { getAgentHandler } from "./agent-handlers";
import { sharedContext } from "./shared-context";
import { contextBuilder, memoryAccess } from "./memories";

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

  /* ---------------- Execution Gateway ---------------- */
  //
  // The methods below turn AgentRuntime from a pure TRACER into the EXECUTION
  // GATEWAY — the single path through which all agent work flows. The
  // orchestrator no longer calls generators directly; it submits Tasks to
  // the ExecutionEngine, which (in turn) calls AgentRuntime.executeTask().
  //
  // executeTask() is responsible for:
  //   1. Looking up the agent's handler by role (from agent-handlers.ts)
  //   2. Building the AgentExecutionContext (memory slice + skills + shared
  //      context + spawnSubAgent + emit)
  //   3. Executing the handler
  //   4. Persisting the result's memoryWrites to memoryAccess (facade over projectMemory)
  //   5. Persisting the result's sharedWrites to the SharedContext blackboard
  //   6. Returning the result (with durationMs filled in)
  //
  // The tracer side (attach / handleEvent / getActivations / getSummary)
  // remains intact and continues to subscribe to the ExecutionEngine event
  // bus. Tracer-side recording and executor-side execution are COMPLEMENTARY:
  // the tracer proves agents activate; the executor proves they produce
  // outputs. Both run on every build.

  /**
   * Execute a single task by dispatching to its registered agent handler.
   *
   * This is the SINGLE ENTRY POINT for executing agent work in Nirman. The
   * ExecutionEngine calls this (directly or via a wrapper) for every Task it
   * schedules. Handlers are looked up by `task.agent` in the
   * {@link agentHandlers} registry.
   *
   * @param task         The task being executed (carries `agent`, `id`,
   *                     `title`, `stageId`).
   * @param prompt       The original user prompt.
   * @param capabilities Detected capabilities (auth, payments, offline-sync, …).
   * @returns            The handler's result, with `durationMs` filled in. If
   *                     no handler is registered for `task.agent`, returns a
   *                     structured failure (status="failure", error=…).
   */
  async executeTask(
    task: Task,
    prompt: string,
    capabilities: Capability[]
  ): Promise<AgentExecutionResult> {
    const start = Date.now();
    const handler: AgentHandler | undefined = getAgentHandler(task.agent);
    if (!handler) {
      return {
        status: "failure",
        error: `No handler registered for agent: ${task.agent}`,
        durationMs: Date.now() - start,
      };
    }

    // Build the agent's memory slice via the ContextBuilder. We use the
    // legacy entry point (buildForAgent) which returns just the slice + a
    // zero token estimate; that's all the executor needs at this layer.
    const memorySlice = contextBuilder.buildForAgent(task.agent, { prompt }).memorySlice;

    // Skills will be injected by Task K's skill-injector. For now we pass an
    // empty array — handlers are designed to degrade gracefully when no
    // SKILL.md content is available (they fall back to the prompt + memory).
    const skills: SkillContent[] = [];

    const ctx: AgentExecutionContext = {
      task,
      prompt,
      memory: memorySlice,
      skills,
      capabilities,
      platform: this.inferPlatform(task),
      shared: sharedContext,
      spawnSubAgent: (role: string, spec: SubAgentSpec) =>
        this.spawnSubAgent(role, spec, prompt, capabilities),
      // Emit is currently a no-op: the ExecutionEngine's emit is private and
      // we don't own execution-engine.ts (Task M does). The tracer side of
      // this runtime already observes task-level events via the bus, so
      // observability isn't broken — agent-emitted custom events just aren't
      // forwarded yet. Task M can wire this up later by exposing a public
      // engine.emit() or accepting a callback.
      emit: (_event: { type: string; message: string; level?: string }) => {
        /* no-op — see comment above */
      },
    };

    try {
      const result: AgentExecutionResult = await handler(ctx);
      result.durationMs = Date.now() - start;

      // Persist memory writes via the official MemoryAccess facade.
      // The handler declares WHAT to write (kind, title, content); the
      // runtime commits it with the agent role as the source — keeping
      // memory attribution honest (the runtime is the only thing that
      // mutates project memory). Each write is recorded in
      // `memoryAccess.getAccessLog()` for the audit trail.
      //
      // (Runtime V2 Audit, Phase 2 Step 6: internal modules must not
      // touch `projectMemory` directly — they go through `memoryAccess`.)
      if (result.memoryWrites) {
        for (const w of result.memoryWrites) {
          memoryAccess.write(w.kind, w.title, w.content, task.agent);
        }
      }

      // Commit shared-context writes. Handlers MAY have already written to
      // `ctx.shared` directly (the spec allows it), but we re-commit from
      // the declared `sharedWrites` to keep the audit trail honest and
      // ensure downstream agents see consistent state even if a handler
      // forgot to call ctx.shared.write().
      if (result.sharedWrites) {
        for (const w of result.sharedWrites) {
          sharedContext.write(w.key, w.value);
        }
      }

      return result;
    } catch (err) {
      return {
        status: "failure",
        error: String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Infer the platform target for a task by inspecting its title and stageId.
   * Used to set `AgentExecutionContext.platform` for generator/build/test/
   * packaging handlers that need a platform key but whose Task doesn't carry
   * one explicitly.
   *
   * Returns undefined if no platform signal is found — handlers then fall
   * back to "web" (the legacy default).
   */
  private inferPlatform(task: Task): PlatformKind | undefined {
    const signal = `${task.title} ${task.stageId ?? ""}`;
    if (/windows|desktop|winui|wpf|tauri/i.test(signal)) return "windows";
    if (/android|kotlin|compose|flutter/i.test(signal)) return "android";
    if (/web|next|react|frontend|frontend-generator/i.test(signal)) return "web";
    if (/\bcli\b|rust-cli|cobra|clap/i.test(signal)) return "cli";
    return undefined;
  }

  /**
   * Spawn a dynamic sub-agent. Currently a placeholder that returns a
   * structured-success result — the real lifecycle (registry, kill, lineage
   * tracking) is owned by Task J's DynamicAgentRegistry in dynamic-agents.ts.
   *
   * The interface is correct today so handlers can call `ctx.spawnSubAgent`
   * without breaking; Task J will swap the implementation to dispatch
   * through the registry once it lands.
   */
  private async spawnSubAgent(
    role: string,
    spec: SubAgentSpec,
    _prompt: string,
    _capabilities: Capability[]
  ): Promise<AgentExecutionResult> {
    return {
      status: "success",
      output: `Sub-agent ${role} spawned for: ${spec.objective}`,
    };
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
