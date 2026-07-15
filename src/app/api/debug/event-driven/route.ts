// Debug Endpoint — Event-Driven Runtime (Wave 2C).
//
// Proves the reactive subscription graph actually DRIVES the runtime:
// subscribers don't just `console.log` — they submit follow-up Tasks to the
// ExecutionEngine / TaskGraph and run the VerificationLoop on completed builds.
//
//   GET  /api/debug/event-driven
//        → returns the live subscription graph (eventType + subscriberAgent
//          for each), the 20 most recent events, and the current TaskGraph
//          summary. If no subscriptions have been registered yet, registers
//          the default reactive graph first so the response is non-empty.
//
//   POST /api/debug/event-driven  { type?, source?, targetKey?, payload? }
//        → publishes an event onto the bus, waits a tick (100ms) for the
//          async subscribers to fire, then returns:
//            - the published event type
//            - tasksBefore / tasksAfter / tasksSubmitted (the delta proves
//              the reactive chain inserted a follow-up task)
//            - the 5 most recent events on the bus
//            - the updated TaskGraph summary
//
// Reactive chain (canonical demo):
//   curl -s -X POST http://localhost:3000/api/debug/event-driven \
//     -H 'Content-Type: application/json' \
//     -d '{"type":"code-generated","source":"frontend-generator","targetKey":"web","payload":{"files":24}}'
//
//   Expected: tasksSubmitted === 1 — the `code-generated` subscriber
//   constructed a build task, inserted it into the TaskGraph, and handed it
//   to executionEngine.insertTask(). The build task is now visible in the
//   TaskGraph summary (insertions += 1, totalTasks += 1).
//
// Strict file ownership (per Wave 2C brief): this endpoint is the only NEW
// server entry point created by the wave. It depends only on the public
// `agentEventBus`, `registerDefaultSubscriptions` exports from event-bus.ts
// and the `taskGraph` singleton from task-graph.ts — both already exported
// from the engine index. No other engine module is touched.

import { NextResponse } from "next/server";
import {
  agentEventBus,
  registerDefaultSubscriptions,
} from "@/lib/engine/event-bus";
import { taskGraph } from "@/lib/engine/task-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — return the current subscription graph + event log + task graph
 * summary. Lazily registers the default reactive subscription graph if no
 * subscriptions have been registered yet (e.g. on a fresh process).
 *
 * Returns:
 *   {
 *     subscriptions: [{ eventType, subscriberAgent }, ...],
 *     eventLog:      AgentEvent[],   // 20 most recent, newest first
 *     taskGraphSummary: TaskGraph.getSummary(),
 *   }
 */
export async function GET() {
  if (agentEventBus.getSubscriptions().length === 0) {
    registerDefaultSubscriptions();
  }
  return NextResponse.json({
    subscriptions: agentEventBus.getSubscriptions().map((s) => ({
      eventType: s.eventType,
      subscriber: s.subscriberAgent,
    })),
    eventLog: agentEventBus.getEventLog(20),
    taskGraphSummary: taskGraph.getSummary(),
  });
}

/**
 * POST — publish an event onto the bus and observe the resulting task
 * submissions. The request body shape is:
 *   { type?: string, source?: string, targetKey?: string, payload?: unknown }
 *
 * Defaults are supplied for missing fields so a bare POST `{}` publishes a
 * `code-generated` event from `debug-endpoint` with `payload: {}` — that
 * triggers the build-task-submission subscriber, proving the reactive
 * chain works end-to-end.
 *
 * The handler waits 100ms after publishing so the async subscribers
 * (which use `await import("./...")` to load the engine modules
 * lazily) have time to complete their follow-up task submission. It
 * then returns the before/after task counts so the caller can verify
 * `tasksSubmitted > 0` for events that drive the runtime.
 */
export async function POST(req: Request) {
  try {
    if (agentEventBus.getSubscriptions().length === 0) {
      registerDefaultSubscriptions();
    }
    const body = (await req.json().catch(() => ({}))) as {
      type?: string;
      source?: string;
      targetKey?: string;
      payload?: unknown;
    } | null;

    const beforeSummary = taskGraph.getSummary();
    const beforeTasks = beforeSummary.totalTasks;
    const beforeInsertions = beforeSummary.insertions;

    agentEventBus.publish({
      type: body?.type || "code-generated",
      source: body?.source || "debug-endpoint",
      targetKey: body?.targetKey,
      payload: body?.payload ?? {},
    });

    // Wait a tick for async subscribers (which `await import(...)` the
    // engine modules) to complete their follow-up task submission. 100ms is
    // generous — module resolution + makeTask + taskGraph.insert +
    // executionEngine.insertTask is well under 10ms on a warm dev server.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const afterSummary = taskGraph.getSummary();
    const afterTasks = afterSummary.totalTasks;
    const afterInsertions = afterSummary.insertions;

    return NextResponse.json({
      published: true,
      eventType: body?.type || "code-generated",
      tasksBefore: beforeTasks,
      tasksAfter: afterTasks,
      tasksSubmitted: afterTasks - beforeTasks,
      insertionsBefore: beforeInsertions,
      insertionsAfter: afterInsertions,
      insertionsDelta: afterInsertions - beforeInsertions,
      eventLog: agentEventBus.getEventLog(5),
      taskGraphSummary: afterSummary,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Event-driven debug failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
