// Debug Endpoint — Tool Intelligence.
//
// Proves the ToolIntelligence collector works end-to-end:
//
//   GET  /api/debug/tool-intelligence
//     → returns the per-tool summary (totalToolsTracked, totalInvocations,
//       avgSuccessRate, and a `tools[]` array with per-tool stats +
//       recommendations).
//
//   POST /api/debug/tool-intelligence  body: { action, ... }
//     → performs an action. Supported actions:
//         { action: "seed" }
//           Seeds demo data (tsc, npm-build, dotnet-build, gradle-build) so
//           the endpoint has something to show before any real builds run.
//         { action: "record", toolId, durationMs?, success?, errorType?,
//                    errorMessage?, context? }
//           Records one tool invocation. Returns the freshly-computed stats
//           for that tool.
//         { action: "recommend", toolId }
//           Returns the scheduling recommendation for a tool (priority,
//           expectedDurationMs, shouldRetry, maxRetries, timeoutMs, notes).
//         { action: "optimal-order", toolIds? }
//           Returns the optimal execution order for the given toolIds
//           (default: ["tsc", "npm-build", "dotnet-build"]).
//         { action: "clear" }
//           Clears all collected invocations and stats.
//
// Usage:
//   # Seed demo data
//   curl -s -X POST http://localhost:3000/api/debug/tool-intelligence \
//        -H 'Content-Type: application/json' \
//        -d '{"action":"seed"}'
//
//   # Inspect the summary
//   curl -s http://localhost:3000/api/debug/tool-intelligence | jq
//
//   # Get a recommendation for tsc
//   curl -s -X POST http://localhost:3000/api/debug/tool-intelligence \
//        -H 'Content-Type: application/json' \
//        -d '{"action":"recommend","toolId":"tsc"}' | jq
//
//   # Get the optimal order for a set of tools
//   curl -s -X POST http://localhost:3000/api/debug/tool-intelligence \
//        -H 'Content-Type: application/json' \
//        -d '{"action":"optimal-order","toolIds":["tsc","npm-build","dotnet-build","gradle-build"]}' | jq

import { NextResponse } from "next/server";
import { toolIntelligence } from "@/lib/engine/tool-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — return the tool-intelligence summary. The summary is a fresh snapshot
 * every call (no caching at the HTTP layer); the underlying collector caches
 * per-tool stats until the next `record()` invalidates them.
 */
export async function GET() {
  return NextResponse.json(toolIntelligence.getSummary());
}

/**
 * POST — perform an action. See the file header for the full action list.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: "seed" | "record" | "recommend" | "optimal-order" | "clear";
      toolId?: string;
      durationMs?: number;
      success?: boolean;
      errorType?: string;
      errorMessage?: string;
      context?: {
        fileCount?: number;
        projectSize?: "small" | "medium" | "large";
        platform?: string;
      };
      toolIds?: string[];
    } | null;

    switch (body?.action) {
      case "seed":
        toolIntelligence.seedDemoData();
        return NextResponse.json({
          ok: true,
          action: "seed",
          summary: toolIntelligence.getSummary(),
        });

      case "record": {
        const toolId = body.toolId || "unknown";
        toolIntelligence.record({
          toolId,
          timestamp: Date.now(),
          durationMs: typeof body.durationMs === "number" ? body.durationMs : 1000,
          success: body.success ?? true,
          errorType: body.errorType,
          errorMessage: body.errorMessage,
          context: body.context,
        });
        return NextResponse.json({
          ok: true,
          action: "record",
          toolId,
          stats: toolIntelligence.getStats(toolId),
        });
      }

      case "recommend": {
        const toolId = body.toolId || "unknown";
        const recommendation = toolIntelligence.recommend(toolId);
        return NextResponse.json({ toolId, recommendation });
      }

      case "optimal-order": {
        const requested = body.toolIds ?? ["tsc", "npm-build", "dotnet-build"];
        const optimalOrder = toolIntelligence.optimalOrder(requested);
        return NextResponse.json({ requested, optimalOrder });
      }

      case "clear":
        toolIntelligence.clear();
        return NextResponse.json({ ok: true, action: "clear" });

      default:
        return NextResponse.json(
          {
            error: `Unknown action: ${body?.action ?? "(none)"}`,
            supportedActions: ["seed", "record", "recommend", "optimal-order", "clear"],
          },
          { status: 400 },
        );
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
