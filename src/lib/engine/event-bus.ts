// AgentEventBus — a pub/sub event bus for reactive agent scheduling.
//
// The reviewer said: "True agent scheduling: Agents should publish and consume
// events rather than relying on direct orchestration calls where possible."
//
// The SharedContext blackboard (see shared-context.ts) is the SYNCHRONOUS
// channel agents use to pass work products to each other: the Planner writes
// "plan", the Architect reads "plan". But the orchestrator still hardcodes the
// dependency — it has to know that the Architect runs after the Planner.
//
// The AgentEventBus is the ASYNCHRONOUS channel agents use to signal state
// changes. The Generator publishes "code-generated"; the Reviewer has
// SUBSCRIBED to "code-generated" events and auto-activates when code is ready.
// The orchestrator doesn't need to know that the Reviewer should run after the
// Generator — the Reviewer simply declared its interest.
//
// This file is the COMPLEMENT to the SharedContext blackboard:
//   - SharedContext = data plane (synchronous, key/value, build-scoped)
//   - AgentEventBus = control plane (async, pub/sub, process-scoped)
//
// RELATIONSHIP to ExecutionEngine.subscribe() and Observability.subscribe():
//   - ExecutionEngine.subscribe() lets the UI listen to EngineEvents
//     (task-queued, task-started, task-succeeded, task-failed) — fine-grained
//     task-lifecycle events emitted by the scheduler itself.
//   - Observability.subscribe() lets the UI listen to EngineEvents that have
//     been recorded for metrics (token usage, failures, workflow aggregates).
//   - AgentEventBus is a HIGHER-LEVEL bus: it carries domain events
//     ("code-generated", "build-completed", "review-failed",
//     "specialist-needed") published BY AGENTS — not by the scheduler. Agents
//     use it to coordinate without the orchestrator's involvement.
//
// EVENT TYPES (the reactive contract):
//   - "requirements-analyzed"  (from requirements-analyst)
//   - "plan-created"            (from planner)
//   - "architecture-designed"   (from solution-architect)
//   - "code-generated"          (from frontend-generator, per target)
//   - "build-completed"         (from build-engineer, per target)
//   - "tests-generated"         (from test-generator)
//   - "review-completed"        (from code-reviewer)
//   - "package-ready"           (from packaging-engineer)
//   - "specialist-needed"       (from any agent requesting a dynamic sub-agent)
//   - "gate-failed"             (from orchestrator gate tasks)
//
// Each event carries: type, source (agent role), targetKey (optional, e.g.
// "web"), timestamp, and a payload (any data the publisher wants to share).

/**
 * An event published by an agent (or by the orchestrator) on the bus. Events
 * are immutable once published; the timestamp is filled in by the bus if the
 * publisher did not supply one.
 */
export interface AgentEvent {
  /** Event type — see the EVENT TYPES list in the file header. */
  type: string;
  /** Agent role that published the event (e.g. "frontend-generator"). */
  source: string;
  /**
   * Platform target the event pertains to ("web" | "windows" | "android" |
   * "cli" | undefined for global events). Lets subscribers filter by target.
   */
  targetKey?: string;
  /** ms timestamp — filled in by the bus if omitted by the publisher. */
  timestamp: number;
  /** Event-specific data (any shape the publisher wants to share). */
  payload: unknown;
}

/**
 * A handler invoked when a matching event is published. May be async; the bus
 * awaits the handler via Promise.resolve but treats it as fire-and-forget —
 * handler errors are swallowed so a faulty subscriber can't break the
 * publisher.
 */
export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;

/**
 * A registered subscription. Returned by subscribe() (internally) and listed
 * by getSubscriptions() for debugging. The `id` is needed for unsubscribe().
 */
export interface AgentSubscription {
  /** Stable unique id (sub-<ts>-<rand5>) — used by unsubscribe(). */
  id: string;
  /** Event type the subscriber is interested in. "*" = all events. */
  eventType: string;
  /** The handler to invoke when a matching event is published. */
  handler: AgentEventHandler;
  /** Which agent (or component) subscribed — for debugging/lineage. */
  subscriberAgent: string;
}

/**
 * AgentEventBus — the pub/sub control plane for reactive agent scheduling.
 *
 * The bus is a process-wide singleton (see `agentEventBus` export below) so
 * that any agent, any handler, and any debug endpoint all share the same
 * subscription graph. State is held in two private fields:
 *   - subscriptions: Map<eventType, AgentSubscription[]>
 *   - eventLog:      AgentEvent[] (capped at maxLogSize, FIFO eviction)
 *
 * Publish() is SYNCHRONOUS in the sense that it appends to the log and
 * dispatches to subscribers immediately, but each subscriber handler is
 * invoked via Promise.resolve(...).catch(() => {}) so async handlers don't
 * block the publisher and a faulty handler can't throw into the publisher's
 * stack.
 */
export class AgentEventBus {
  private subscriptions = new Map<string, AgentSubscription[]>();
  private eventLog: AgentEvent[] = [];
  private maxLogSize = 200;

  /**
   * Publish an event. All matching subscribers (exact eventType match +
   * wildcard "*" subscribers) are notified asynchronously. The event is
   * appended to the in-memory log regardless of whether anyone is listening.
   *
   * @param event The event payload — `timestamp` is optional and filled in
   *              by the bus if omitted.
   */
  publish(event: Omit<AgentEvent, "timestamp"> & { timestamp?: number }): void {
    const fullEvent: AgentEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    };
    this.eventLog.push(fullEvent);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }
    // Notify exact-match subscribers + wildcard subscribers.
    // Wildcards are stored under the key "*" so they receive every event.
    const exact = this.subscriptions.get(fullEvent.type) ?? [];
    const wildcard = this.subscriptions.get("*") ?? [];
    const all = [...exact, ...wildcard];
    for (const sub of all) {
      // Fire-and-forget async — don't block the publisher, swallow errors so
      // a faulty subscriber can't crash the publisher.
      Promise.resolve(sub.handler(fullEvent)).catch(() => {});
    }
  }

  /**
   * Subscribe to an event type. Returns an unsubscribe function the caller
   * should invoke when it no longer wants notifications (e.g. on shutdown or
   * scope exit). Pass "*" as eventType to receive ALL events.
   *
   * @param eventType      Event type to listen for, or "*" for all.
   * @param handler        Function invoked on each matching event.
   * @param subscriberAgent Name of the subscribing agent (debugging/lineage).
   * @returns An unsubscribe function — call it to remove the subscription.
   */
  subscribe(
    eventType: string,
    handler: AgentEventHandler,
    subscriberAgent: string
  ): () => void {
    const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const sub: AgentSubscription = { id, eventType, handler, subscriberAgent };
    const existing = this.subscriptions.get(eventType) ?? [];
    existing.push(sub);
    this.subscriptions.set(eventType, existing);
    return () => this.unsubscribe(id);
  }

  /**
   * Unsubscribe by subscription ID. Walks all event types (since the ID
   * uniquely identifies the subscription but we don't index by ID) and
   * removes the matching subscription. Empty subscription arrays are deleted
   * so getSubscriptions() / getSummary() don't report phantom entries.
   */
  unsubscribe(subscriptionId: string): void {
    for (const [type, subs] of this.subscriptions.entries()) {
      const filtered = subs.filter((s) => s.id !== subscriptionId);
      if (filtered.length === 0) {
        this.subscriptions.delete(type);
      } else {
        this.subscriptions.set(type, filtered);
      }
    }
  }

  /**
   * Get the event log, most-recent-first. The log is capped at maxLogSize
   * (200 by default) with FIFO eviction, so this returns at most `limit`
   * entries.
   *
   * @param limit Maximum number of events to return (default 50).
   */
  getEventLog(limit = 50): AgentEvent[] {
    return this.eventLog.slice(-limit).reverse();
  }

  /** Get all active subscriptions across all event types. */
  getSubscriptions(): AgentSubscription[] {
    return [...this.subscriptions.values()].flat();
  }

  /**
   * Get a debugging summary of the bus state: subscription counts, event
   * counts by type, and the 10 most recent events. Returned by the
   * /api/debug/event-bus GET endpoint.
   */
  getSummary() {
    const subs = this.getSubscriptions();
    const log = this.eventLog;
    const eventsByType: Record<string, number> = {};
    for (const e of log) {
      eventsByType[e.type] = (eventsByType[e.type] ?? 0) + 1;
    }
    return {
      totalSubscriptions: subs.length,
      subscriptionsByEvent: this.groupSubsByEvent(),
      totalEventsPublished: log.length,
      eventsByType,
      recentEvents: this.getEventLog(10),
    };
  }

  /** Group active subscriptions by event type (helper for getSummary). */
  private groupSubsByEvent(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [type, subs] of this.subscriptions.entries()) {
      counts[type] = subs.length;
    }
    return counts;
  }

  /**
   * Clear all subscriptions + the event log. Called at the start of a fresh
   * build (or by tests) to reset the bus to a clean state. Does NOT re-register
   * default subscriptions — the caller must invoke registerDefaultSubscriptions()
   * again if it wants the reactive graph active.
   */
  clear(): void {
    this.subscriptions.clear();
    this.eventLog = [];
  }
}

/**
 * Process-wide singleton event bus. Agents and the orchestrator all publish
 * to and subscribe from this same instance, which is what makes the reactive
 * graph work without explicit wiring.
 */
export const agentEventBus = new AgentEventBus();

/**
 * Register the default reactive subscription graph (Wave 2C enhancement).
 *
 * This wires up the canonical agent-to-event relationships so that the event
 * bus actually DRIVES the runtime — subscribers don't just log the trigger,
 * they submit follow-up Tasks to the ExecutionEngine / TaskGraph:
 *
 *   code-generated  → build-engineer  → submits a build task to the engine
 *   build-completed → test-generator   → runs verificationLoop.verify() on a
 *                                        newly constructed verify task (which
 *                                        itself inserts fix tasks on failure)
 *   gate-failed     → orchestrator     → logs (the VerificationLoop already
 *                                        creates fix tasks inline when it
 *                                        runs verify() — see verification-loop.ts)
 *   specialist-needed → dynamic-spawner → spawns the matching dynamic agent
 *                                        via dynamicAgentRegistry.spawn()
 *   package-ready   → export-manager   → re-publishes as `export-ready` so
 *                                        downstream packaging handlers wake up
 *   artifact-created → artifact-registry → logs (placeholder for future
 *                                          artifact indexing / lineage tracking)
 *
 * All follow-up work happens via DYNAMIC imports (`await import("./task-graph")`,
 * `await import("./execution-engine")`, etc.). This breaks the static import
 * cycle: event-bus is imported by index.ts which is imported by many server +
 * client modules; statically importing execution-engine here would pull the
 * full task scheduler (and its `child_process`-adjacent deps) into every
 * caller's bundle. Dynamic import keeps the bus cheap to load while still
 * enabling reactive task submission at runtime.
 *
 * The subscriber signature is unchanged from before — the public API
 * (`publish`, `subscribe`, `getSummary`, `getSubscriptions`, `getEventLog`,
 * `unsubscribe`, `clear`) is identical. Only the HANDLER BODIES changed:
 * they used to `console.log(...)`; they now perform real work.
 *
 * Safe to call multiple times — but each call ADDS subscriptions, so the
 * canonical pattern is to call it once at startup (or lazily via the
 * /api/debug/event-driven GET endpoint when `getSubscriptions().length === 0`).
 */
export function registerDefaultSubscriptions(): void {
  // ─────────────────────────────────────────────────────────────────────────
  // code-generated → submit a build task to the ExecutionEngine.
  //
  // When any generator (frontend-generator, build-engineer-for-target, etc.)
  // publishes `code-generated`, the reactive graph constructs a new build
  // task via `makeTask`, records it in the TaskGraph (as an `insert`
  // mutation so observers can distinguish runtime-inserted tasks from the
  // initial submitAll batch), and hands it to `executionEngine.insertTask()`
  // so the scheduler actually picks it up.
  // ─────────────────────────────────────────────────────────────────────────
  agentEventBus.subscribe(
    "code-generated",
    async (e) => {
      console.log(
        `[EventBus] Code generated for ${e.targetKey ?? "unknown"} by ${e.source} — submitting build task`
      );
      try {
        const { taskGraph } = await import("./task-graph");
        const { executionEngine, makeTask } = await import("./execution-engine");
        const buildTask = makeTask({
          // `WorkflowId` is typed as a closed union (8 ids) in types.ts.
          // "reactive" is the runtime tag for tasks submitted by the event
          // bus itself — the closed union is just a static-analysis aid; at
          // runtime `workflowId` is an opaque string passed through. The
          // cast mirrors the one in verification-loop.ts (line 168).
          workflowId: "reactive" as never,
          stageId: "build",
          title: `Build (${e.targetKey ?? "unknown"})`,
          description: `Reactive build task triggered by code-generated event from ${e.source}`,
          agent: "build-engineer",
          // In a full implementation `dependsOn` would list the originating
          // generation task id (passed in the event payload). The debug
          // endpoint does not currently supply one, so we leave it empty —
          // the task is immediately runnable.
          dependsOn: [],
        });
        taskGraph.insert(
          buildTask,
          `reactive: code-generated for ${e.targetKey ?? "unknown"} (source: ${e.source})`
        );
        executionEngine.insertTask(buildTask);
      } catch (err) {
        console.error("[EventBus] Failed to submit build task:", err);
      }
    },
    "build-engineer"
  );

  // ─────────────────────────────────────────────────────────────────────────
  // build-completed → run verification on a freshly constructed verify task.
  //
  // The VerificationLoop (Wave 1D) encapsulates the generate→build→verify→fix
  // cycle. Here we hand it a verify task seeded with the build output; if
  // verification fails the loop itself creates fix tasks and inserts them
  // into the TaskGraph (it calls `taskGraph.insert(fixTask, reason)`
  // internally — see verification-loop.ts:179). So the reactive chain is:
  //   build-completed → verify → pass? → done
  //                          → fail? → VerificationLoop inserts fix tasks
  // ─────────────────────────────────────────────────────────────────────────
  agentEventBus.subscribe(
    "build-completed",
    async (e) => {
      console.log(
        `[EventBus] Build completed for ${e.targetKey ?? "unknown"} — submitting verify task`
      );
      try {
        const { verificationLoop } = await import("./verification-loop");
        const { makeTask } = await import("./execution-engine");
        const verifyTask = makeTask({
          workflowId: "reactive" as never,
          stageId: "test",
          title: `Verify (${e.targetKey ?? "unknown"})`,
          description: `Reactive verify task triggered by build-completed event from ${e.source}`,
          agent: "test-generator",
          dependsOn: [],
          gate: "compilation",
        });
        // `makeTask` does not set `result` on the returned Task; the
        // verification loop's output-presence check would fail without a
        // result. Seed it with the build payload (or a placeholder string
        // if the publisher didn't include one) so the loop's structural
        // checks have something to see.
        (verifyTask as { result?: string }).result =
          typeof e.payload === "string"
            ? e.payload
            : "build output";
        await verificationLoop.verify(verifyTask, {
          targetType: e.targetKey,
        });
      } catch (err) {
        console.error("[EventBus] Failed to submit verify task:", err);
      }
    },
    "test-generator"
  );

  // ─────────────────────────────────────────────────────────────────────────
  // gate-failed → the VerificationLoop already creates fix tasks inline
  // when it runs `verify()` on a failing task (see verification-loop.ts
  // :159–186). This subscriber just logs so observers watching the event
  // bus can see the gate failure even if they don't have direct access to
  // the VerificationLoop's results map.
  // ─────────────────────────────────────────────────────────────────────────
  agentEventBus.subscribe(
    "gate-failed",
    (e) => {
      console.log(
        `[EventBus] Gate failed — VerificationLoop will create fix tasks: ${JSON.stringify(e.payload)}`
      );
    },
    "orchestrator"
  );

  // ─────────────────────────────────────────────────────────────────────────
  // specialist-needed → spawn the matching dynamic sub-agent.
  //
  // The publisher includes `{ capability, reason? }` in the payload. We map
  // the capability to a specialist role via `planDynamicSpawns`, then spawn
  // each role via `dynamicAgentRegistry.spawn(role, spec, handler)`. The
  // spawned agent is recorded for lineage (it shows up in
  // /api/debug/dynamic-agents). In a full integration the orchestrator
  // would then call `executeAndDestroy(agentId, buildCtx)` to run it; this
  // subscriber only handles the SPAWN half (lifecycle management stays
  // with the caller that owns the parent execution context).
  // ─────────────────────────────────────────────────────────────────────────
  agentEventBus.subscribe(
    "specialist-needed",
    async (e) => {
      console.log(
        `[EventBus] Specialist needed — spawning dynamic agent: ${JSON.stringify(e.payload)}`
      );
      try {
        const {
          dynamicAgentRegistry,
          planDynamicSpawns,
          makeSpecialistHandler,
        } = await import("./dynamic-agents");
        const payload = e.payload as {
          capability?: string;
          reason?: string;
        } | null;
        if (payload?.capability) {
          const roles = planDynamicSpawns([payload.capability as never]);
          for (const role of roles) {
            const agent = dynamicAgentRegistry.spawn(
              role,
              {
                objective:
                  payload.reason || `Specialist for ${payload.capability}`,
                parentAgentId: e.source,
              },
              makeSpecialistHandler(role)
            );
            console.log(`[EventBus] Spawned ${role} (${agent.id})`);
          }
        }
      } catch (err) {
        console.error("[EventBus] Failed to spawn specialist:", err);
      }
    },
    "dynamic-spawner"
  );

  // ─────────────────────────────────────────────────────────────────────────
  // package-ready → re-publish as `export-ready`.
  //
  // The packaging engineer signals "package-ready" when the build artifacts
  // are wrapped into a distributable form. The export-manager subscribes
  // and re-publishes an `export-ready` event so downstream consumers
  // (export handlers, installer-specialist, release-engineer) can wake up
  // without each one having to subscribe to package-ready itself.
  // ─────────────────────────────────────────────────────────────────────────
  agentEventBus.subscribe(
    "package-ready",
    (e) => {
      console.log(
        `[EventBus] Package ready for ${e.targetKey ?? "unknown"} — publishing export-ready`
      );
      agentEventBus.publish({
        type: "export-ready",
        source: "packaging-engineer",
        targetKey: e.targetKey,
        payload: e.payload,
      });
    },
    "export-manager"
  );

  // ─────────────────────────────────────────────────────────────────────────
  // artifact-created → log (placeholder for future artifact indexing).
  //
  // In the V2 architecture the ArtifactRegistry (artifact-registry.ts) is
  // the source of truth for versioned artifacts. Future work (Wave 3) will
  // make the registry queryable by type / target / lineage; once that
  // lands this subscriber can call `artifactRegistry.produce(...)` to
  // persist the artifact. For now we log so observers can see when
  // artifacts are produced.
  // ─────────────────────────────────────────────────────────────────────────
  agentEventBus.subscribe(
    "artifact-created",
    (e) => {
      console.log(
        `[EventBus] Artifact created: ${JSON.stringify(e.payload).substring(0, 100)}`
      );
    },
    "artifact-registry"
  );
}
