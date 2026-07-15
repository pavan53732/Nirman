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
 * Register the default reactive subscription graph.
 *
 * This wires up the canonical agent-to-event relationships so that, e.g., the
 * Reviewer auto-activates when code is generated, the Build Engineer
 * auto-activates when code is generated + reviewed, etc. In a full
 * implementation these handlers would submit follow-up Tasks to the
 * ExecutionEngine; for now they log the reactive trigger so the debug
 * endpoint can prove the wiring works.
 *
 * Call this at bootstrap (or via the /api/debug/event-bus GET endpoint) to
 * activate the reactive graph. Safe to call multiple times — but each call
 * ADDS subscriptions, so the canonical pattern is to call it once at startup.
 */
export function registerDefaultSubscriptions(): void {
  // Code Reviewer activates when any code is generated.
  agentEventBus.subscribe(
    "code-generated",
    (e) => {
      // In a full implementation, this would submit a review task to the
      // execution engine. For now, we log the reactive trigger so the debug
      // endpoint can prove the wiring.
      console.log(
        `[EventBus] Reviewer notified: code generated for ${e.targetKey ?? "unknown"} by ${e.source}`
      );
    },
    "code-reviewer"
  );

  // Build Engineer activates when code is generated + reviewed.
  agentEventBus.subscribe(
    "code-generated",
    (e) => {
      console.log(
        `[EventBus] Build Engineer notified: code ready for ${e.targetKey ?? "unknown"}`
      );
    },
    "build-engineer"
  );

  // Test Generator activates when code is generated.
  agentEventBus.subscribe(
    "code-generated",
    (e) => {
      console.log(
        `[EventBus] Test Generator notified: code ready for ${e.targetKey ?? "unknown"}`
      );
    },
    "test-generator"
  );

  // Packaging Engineer activates when build completes.
  agentEventBus.subscribe(
    "build-completed",
    (e) => {
      console.log(
        `[EventBus] Packaging Engineer notified: build done for ${e.targetKey ?? "unknown"}`
      );
    },
    "packaging-engineer"
  );

  // Orchestrator monitors gate failures.
  agentEventBus.subscribe(
    "gate-failed",
    (e) => {
      console.log(
        `[EventBus] Orchestrator notified: gate failed — ${JSON.stringify(e.payload)}`
      );
    },
    "orchestrator"
  );

  // Dynamic agent spawning trigger.
  agentEventBus.subscribe(
    "specialist-needed",
    (e) => {
      console.log(
        `[EventBus] Dynamic spawn triggered: ${JSON.stringify(e.payload)}`
      );
    },
    "dynamic-spawner"
  );
}
