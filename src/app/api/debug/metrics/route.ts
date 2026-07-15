// Debug Endpoint — Runtime Metrics.
//
// (Runtime V2 Audit, Phase 3 Step 13: "New /api/debug/metrics endpoint".)
//
// Proves the runtime metrics collector works end-to-end:
//
//   GET  /api/debug/metrics
//     → returns the full {@link RuntimeMetrics} snapshot. All fields are
//       present; values may be 0 / empty if no build has recorded metrics
//       yet.
//
//   POST /api/debug/metrics  body: { action, ... }
//     → records a metric event. Supported actions:
//         { action: "record-start" }
//           Marks build start (sets the latency timer's start ts).
//         { action: "record-end" }
//           Marks build end (sets the latency timer's end ts).
//         { action: "record-task", agent, durationMs, success, stage }
//           Records one task's start+complete pair (the only atomic record
//           exposed via POST — useful for ad-hoc latency tests without
//           having to drive a real build).
//         { action: "record-graph-query", queryType, latencyMs }
//           Records one workspace-graph query.
//         { action: "record-tokens", agent, tokens }
//           Records LLM token usage by an agent.
//         { action: "record-cache", hit: boolean }
//           Records a cache hit or miss.
//         { action: "record-verification", retries: number }
//           Records one verification round with `retries` fix-retries.
//         { action: "record-parallel-batch" }
//           Records one dispatched parallel batch.
//         { action: "reset" }
//           Clears all accumulated metrics (start fresh).
//
// Usage:
//   # Inspect the snapshot
//   curl -s http://localhost:3000/api/debug/metrics | jq
//
//   # Simulate a build lifecycle
//   curl -s -X POST http://localhost:3000/api/debug/metrics \
//        -H 'Content-Type: application/json' \
//        -d '{"action":"record-start"}'
//   curl -s -X POST http://localhost:3000/api/debug/metrics \
//        -H 'Content-Type: application/json' \
//        -d '{"action":"record-task","agent":"frontend-generator","durationMs":150,"success":true,"stage":"generate"}'
//   curl -s -X POST http://localhost:3000/api/debug/metrics \
//        -H 'Content-Type: application/json' \
//        -d '{"action":"record-end"}'
//
//   # Inspect again — agentUtilization + taskLatency should now be populated
//   curl -s http://localhost:3000/api/debug/metrics | jq '.agentUtilization, .taskLatency, .buildLatencyMs'

import { NextResponse } from "next/server";
import { runtimeMetrics } from "@/lib/engine/runtime-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — return the current runtime-metrics snapshot. The snapshot is a deep
 * copy; the caller can mutate it freely without affecting the collector.
 */
export async function GET() {
  return NextResponse.json(runtimeMetrics.getMetrics());
}

/**
 * POST — record a metric event. See the file header for the full action list.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      agent?: string;
      durationMs?: number;
      success?: boolean;
      stage?: string;
      queryType?: string;
      latencyMs?: number;
      tokens?: number;
      hit?: boolean;
      retries?: number;
    } | null;

    switch (body?.action) {
      case "record-start":
        runtimeMetrics.recordBuildStart();
        return NextResponse.json({ ok: true, action: "record-start" });

      case "record-end":
        runtimeMetrics.recordBuildEnd();
        return NextResponse.json({ ok: true, action: "record-end" });

      case "record-task": {
        const agent = body.agent || "unknown";
        const durationMs = typeof body.durationMs === "number" ? body.durationMs : 100;
        const success = body.success ?? true;
        const stage = body.stage || "unknown";
        // Record start+complete as a pair so both the concurrency counters
        // and the latency buckets are updated atomically.
        runtimeMetrics.recordTaskStart(agent);
        runtimeMetrics.recordTaskComplete(agent, durationMs, success, stage);
        return NextResponse.json({
          ok: true,
          action: "record-task",
          recorded: { agent, durationMs, success, stage },
        });
      }

      case "record-graph-query": {
        const queryType = body.queryType || "unknown";
        const latencyMs = typeof body.latencyMs === "number" ? body.latencyMs : 0;
        runtimeMetrics.recordGraphQuery(queryType, latencyMs);
        return NextResponse.json({
          ok: true,
          action: "record-graph-query",
          recorded: { queryType, latencyMs },
        });
      }

      case "record-tokens": {
        const agent = body.agent || "unknown";
        const tokens = typeof body.tokens === "number" ? body.tokens : 0;
        runtimeMetrics.recordTokens(agent, tokens);
        return NextResponse.json({
          ok: true,
          action: "record-tokens",
          recorded: { agent, tokens },
        });
      }

      case "record-cache": {
        const hit = body.hit ?? true;
        if (hit) runtimeMetrics.recordCacheHit();
        else runtimeMetrics.recordCacheMiss();
        return NextResponse.json({
          ok: true,
          action: "record-cache",
          recorded: { hit },
        });
      }

      case "record-verification": {
        const retries = typeof body.retries === "number" ? body.retries : 0;
        runtimeMetrics.recordVerification(retries);
        return NextResponse.json({
          ok: true,
          action: "record-verification",
          recorded: { retries },
        });
      }

      case "record-parallel-batch":
        runtimeMetrics.recordParallelBatch();
        return NextResponse.json({ ok: true, action: "record-parallel-batch" });

      case "reset":
        runtimeMetrics.reset();
        return NextResponse.json({ ok: true, action: "reset" });

      default:
        return NextResponse.json(
          {
            error: "Unknown action",
            supportedActions: [
              "record-start",
              "record-end",
              "record-task",
              "record-graph-query",
              "record-tokens",
              "record-cache",
              "record-verification",
              "record-parallel-batch",
              "reset",
            ],
          },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
