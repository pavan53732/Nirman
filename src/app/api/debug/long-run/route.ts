// Debug Endpoint — Long-Run Manager (pause / resume / checkpoint / recover).
//
// Proves long-running execution (20-60 minute projects) can be paused,
// resumed, checkpointed, and recovered without restarting.
//
//   - GET  /api/debug/long-run
//        → returns the current run snapshot, recovery candidates, and the
//          checkpoint log. If no run is active, currentRun is null and the
//          recoveryCandidates array reflects whatever was persisted to
//          localStorage (empty on the server).
//
//   - POST /api/debug/long-run  { action, runId?, prompt?, projectId?, reason? }
//        → performs one of: start | pause | resume | checkpoint | complete
//          | fail | recover | clear. Returns { action, result, currentRun,
//          recoveryCandidates } so the caller can see the post-action state
//          in a single round trip.
//
// Usage:
//   curl -s http://localhost:3000/api/debug/long-run
//   curl -s -X POST http://localhost:3000/api/debug/long-run \
//     -H 'Content-Type: application/json' \
//     -d '{"action":"start","prompt":"CRM app","projectId":"proj-demo"}'
//   curl -s -X POST http://localhost:3000/api/debug/long-run \
//     -H 'Content-Type: application/json' \
//     -d '{"action":"pause"}'
//   curl -s -X POST http://localhost:3000/api/debug/long-run \
//     -H 'Content-Type: application/json' \
//     -d '{"action":"resume"}'
//   curl -s -X POST http://localhost:3000/api/debug/long-run \
//     -H 'Content-Type: application/json' \
//     -d '{"action":"checkpoint","reason":"manual"}'
//   curl -s -X POST http://localhost:3000/api/debug/long-run \
//     -H 'Content-Type: application/json' \
//     -d '{"action":"complete"}'

import { NextResponse } from "next/server";
import { longRunManager } from "@/lib/engine/long-run-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/debug/long-run
 *
 * Returns the current run snapshot, recovery candidates, and checkpoint log.
 * If no run is active (server just started, no POST /start yet),
 * currentRun will be null and recoveryCandidates will be empty (the server
 * has no localStorage to read from — recovery candidates are populated
 * client-side via the LongRunManager's lazy-load-on-find flow).
 */
export async function GET() {
  return NextResponse.json({
    currentRun: longRunManager.getCurrentRun(),
    recoveryCandidates: longRunManager.findRecoveryCandidates(),
    checkpoints: longRunManager.getCheckpoints(),
  });
}

/**
 * POST /api/debug/long-run
 *
 * Body:
 *   - action: "start" | "pause" | "resume" | "checkpoint" |
 *             "complete" | "fail" | "recover" | "clear"
 *   - runId?:     string  (for "start" — default `run-${Date.now()}`;
 *                          for "recover" — the runId to recover)
 *   - prompt?:    string  (for "start" — default "CRM app")
 *   - projectId?: string  (for "start" — default "proj-demo")
 *   - reason?:    string  (for "fail" — failure reason;
 *                          for "checkpoint" — accepted but currently unused)
 *
 * Returns:
 *   { action, result, currentRun, recoveryCandidates }
 *
 * The `result` field holds the action-specific return value:
 *   - start/pause/resume/complete/fail/recover → LongRunSnapshot | null
 *   - checkpoint → CheckpointRecord | null
 *   - clear → { ok: true }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      runId?: string;
      prompt?: string;
      projectId?: string;
      reason?: string;
    };
    let result: unknown;

    switch (body.action) {
      case "start":
        result = longRunManager.startRun(
          body.runId || `run-${Date.now()}`,
          body.prompt || "CRM app",
          body.projectId || "proj-demo"
        );
        break;
      case "pause":
        result = longRunManager.pause();
        break;
      case "resume":
        result = longRunManager.resume();
        break;
      case "checkpoint":
        result = longRunManager.checkpoint(
          (body.reason as "periodic" | "manual" | "pre-pause") || "manual"
        );
        break;
      case "complete":
        result = longRunManager.complete();
        break;
      case "fail":
        result = longRunManager.fail(body.reason);
        break;
      case "recover":
        result = longRunManager.recover(body.runId || "");
        break;
      case "clear":
        longRunManager.clear();
        result = { ok: true };
        break;
      default:
        return NextResponse.json(
          { error: `Unknown action: ${body.action}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      action: body.action,
      result,
      currentRun: longRunManager.getCurrentRun(),
      recoveryCandidates: longRunManager.findRecoveryCandidates(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}
