// Debug Endpoint — TaskGraph + ExecutionEngine.insertTask() (Wave 1A).
//
// Proves the V2 mutable task graph works end-to-end:
//   - GET  /api/debug/task-graph
//        → returns the live TaskGraph summary (counts by status, mutation
//          log rollup, recent insertions). Empty if no build has run.
//   - POST /api/debug/task-graph  { taskId?, agent?, title?, dependsOn?, ... }
//        → constructs a Task via `makeTask`, inserts it into the live
//          TaskGraph (recording an `insert` mutation with the supplied
//          reason), and schedules it via `executionEngine.insertTask()`.
//          Returns `{ inserted: true, task, summary }`.
//
// The POST handler is the canonical demo of the V2 dynamic task insertion
// capability: it exercises the exact call sequence the future Verification
// Loop (Wave 1C) will use to add fix tasks on verification failure.
//
// Usage:
//   curl -s http://localhost:3000/api/debug/task-graph
//   curl -s -X POST http://localhost:3000/api/debug/task-graph \
//     -H 'Content-Type: application/json' \
//     -d '{"agent":"frontend-generator","title":"Fix: missing export","dependsOn":[]}'

import { NextResponse } from "next/server";
import { taskGraph } from "@/lib/engine/task-graph";
import { executionEngine, makeTask } from "@/lib/engine/execution-engine";
import type { AgentRole, StageId, WorkflowId } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/debug/task-graph
 *
 * Returns the live TaskGraph summary. If no build has run, the summary will
 * show zero tasks and zero mutations — that itself is a valid result
 * (proves the singleton exists and is queryable).
 */
export async function GET() {
  return NextResponse.json({
    summary: taskGraph.getSummary(),
    mutations: taskGraph.getMutations(),
  });
}

/**
 * POST /api/debug/task-graph
 *
 * Body (all optional — defaults supplied):
 *   - workflowId?: WorkflowId   (default "new-project")
 *   - stageId?:    StageId      (default "build")
 *   - title?:      string       (default "Dynamic Task")
 *   - description?: string      (default "")
 *   - agent?:      AgentRole    (default "orchestrator")
 *   - dependsOn?:  string[]     (default [])
 *   - reason?:     string       (default "dynamic insertion")
 *
 * Constructs a Task via `makeTask`, inserts it into the live TaskGraph
 * (recording an `insert` mutation), and schedules it via
 * `executionEngine.insertTask()`. Returns the inserted task plus the
 * updated graph summary.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      workflowId?: string;
      stageId?: string;
      title?: string;
      description?: string;
      agent?: string;
      dependsOn?: string[];
      reason?: string;
    };

    const task = makeTask({
      workflowId: (body.workflowId || "new-project") as WorkflowId,
      stageId: (body.stageId || "build") as StageId,
      title: body.title || "Dynamic Task",
      description: body.description || "",
      agent: (body.agent || "orchestrator") as AgentRole,
      dependsOn: Array.isArray(body.dependsOn) ? body.dependsOn : [],
    });

    const reason = body.reason || "dynamic insertion via /api/debug/task-graph";
    // Step 1: record the insertion in the mutable TaskGraph (observability).
    taskGraph.insert(task, reason);
    // Step 2: hand the task to the ExecutionEngine so it actually gets
    // scheduled (deps permitting) and run. This is the call the future
    // Verification Loop will make when verification fails.
    executionEngine.insertTask(task);

    return NextResponse.json({
      inserted: true,
      task,
      reason,
      summary: taskGraph.getSummary(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), stack: err instanceof Error ? err.stack : undefined },
      { status: 500 }
    );
  }
}
