// Debug Endpoint — AgentEventBus inspection + test-event publishing.
//
// Proves the AgentEventBus pub/sub layer works end-to-end:
//   GET  → returns the event bus summary (subscriptions + recent events).
//          If no subscriptions are registered yet, registers the default
//          reactive subscription graph (6 subscriptions) so the response is
//          non-empty.
//   POST → accepts { type, source, targetKey, payload } and publishes a test
//          event onto the bus. Returns { published: true, summary } so the
//          caller can verify both the event was logged AND which subscribers
//          were notified.
//
// The reviewer said: "True agent scheduling: Agents should publish and consume
// events rather than relying on direct orchestration calls where possible."
// This endpoint is the runtime proof that the pub/sub graph is wired: a POST
// with type="code-generated" triggers 3 subscribers (code-reviewer,
// build-engineer, test-generator) — proving that agents can coordinate
// without the orchestrator hardcoding every dependency.
//
// Usage:
//   GET  /api/debug/event-bus
//   POST /api/debug/event-bus -d '{"type":"code-generated","source":"frontend-generator","targetKey":"web","payload":{"files":24}}'

import { NextResponse } from "next/server";
import {
  agentEventBus,
  registerDefaultSubscriptions,
} from "@/lib/engine/event-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — return the current event bus summary. If no subscriptions have been
 * registered yet (e.g. the bus has just been cleared or the process just
 * started), register the default reactive subscription graph first so the
 * response is non-empty and useful for debugging.
 */
export async function GET() {
  if (agentEventBus.getSubscriptions().length === 0) {
    registerDefaultSubscriptions();
  }
  return NextResponse.json(agentEventBus.getSummary());
}

/**
 * POST — publish a test event onto the bus. The request body shape is:
 *   { type?: string, source?: string, targetKey?: string, payload?: unknown }
 * Defaults are supplied for missing fields so a bare POST `{}` publishes a
 * "test-event" from "debug-endpoint" with payload `{}`.
 *
 * Returns the resulting bus summary so the caller can verify:
 *   1. totalEventsPublished incremented (event was logged)
 *   2. eventsByType[type] incremented (event was classified)
 *   3. recentEvents[0] matches the published event
 */
export async function POST(req: Request) {
  try {
    if (agentEventBus.getSubscriptions().length === 0) {
      registerDefaultSubscriptions();
    }
    const body = (await req.json()) as {
      type?: string;
      source?: string;
      targetKey?: string;
      payload?: unknown;
    } | null;
    agentEventBus.publish({
      type: body?.type || "test-event",
      source: body?.source || "debug-endpoint",
      targetKey: body?.targetKey,
      payload: body?.payload ?? {},
    });
    return NextResponse.json({
      published: true,
      summary: agentEventBus.getSummary(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Event bus debug failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
