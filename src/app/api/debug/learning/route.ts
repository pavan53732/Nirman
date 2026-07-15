import { NextResponse } from "next/server";
import {
  runtimeLearning,
  type LearningKind,
} from "@/lib/engine/runtime-learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Debug endpoint for the RuntimeLearning system (Depth-3 — Runtime Learning).
 *
 * GET /api/debug/learning
 *   Returns the learning summary (totalLearnings, byKind, byTag, avgConfidence,
 *   topLearnings). Useful for a quick "what does Nirman know?" read-back.
 *
 * GET /api/debug/learning?kind=preferred-stack&platform=web
 *   Returns recommendations (high-confidence learnings for that kind +
 *   platform) and avoidances (failed learnings for that kind + platform).
 *   This is the shape the decision engine will consume when "prefer stacks
 *   that worked before" / "avoid strategies that failed" is wired in.
 *
 * POST /api/debug/learning
 *   Body: { action: "seed" | "record" | "clear", kind?, title?, content?,
 *           outcome?, tags?, context? }
 *
 *   - action="seed"    : seed 9 demo learnings (idempotent — calling twice
 *                        increments occurrence counts rather than duping).
 *   - action="record"  : record a single learning. Requires kind, title,
 *                        content; outcome defaults to "neutral"; tags default
 *                        to []; context is optional.
 *   - action="clear"   : wipe all learnings.
 *
 * NOTE: This endpoint MUTATES the shared `runtimeLearning` singleton. On the
 * server, records live in-process for the module's lifetime (localStorage is
 * unavailable). On the client (browser), records persist to localStorage and
 * survive reloads. The seed → query demo flow works in both environments.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as LearningKind | null;
  const platform = url.searchParams.get("platform") || undefined;

  if (kind) {
    const recommendations = runtimeLearning.recommend(kind, { platform });
    const avoidances = runtimeLearning.avoid(kind, { platform });
    return NextResponse.json({
      kind,
      platform,
      recommendations: recommendations.map((r) => ({
        title: r.title,
        confidence: r.confidence,
        content: r.content.substring(0, 200),
      })),
      avoidances: avoidances.map((r) => ({
        title: r.title,
        failureCount: r.failureCount,
        content: r.content.substring(0, 200),
      })),
    });
  }

  return NextResponse.json(runtimeLearning.getSummary());
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    switch (body.action) {
      case "seed":
        runtimeLearning.seedDemoLearnings();
        return NextResponse.json({
          ok: true,
          summary: runtimeLearning.getSummary(),
        });

      case "record": {
        const record = runtimeLearning.record(
          body.kind,
          body.title,
          body.content,
          body.outcome || "neutral",
          body.tags || [],
          body.context
        );
        return NextResponse.json({ ok: true, record });
      }

      case "clear":
        runtimeLearning.clear();
        return NextResponse.json({ ok: true });

      default:
        return NextResponse.json(
          { error: `Unknown action: ${body.action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
