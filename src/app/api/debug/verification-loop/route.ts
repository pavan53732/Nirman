// Debug Endpoint — Verification Loop inspection + test-task verification.
//
// Proves the generate→build→verify→fix cycle works end-to-end:
//   GET  → returns the verification summary (counts, recent results).
//   POST → accepts { taskId?, agent?, title?, stageId?, gate?, result?,
//                    workspacePath?, targetType? }, constructs a mock Task
//          via `makeTask`, simulates that the task ran (sets `.result` and
//          `.gate` directly — `makeTask` accepts but doesn't propagate
//          `gate`), runs `verificationLoop.verify(task, opts)`, and returns
//          the resulting VerificationResult alongside the live summary.
//
// Usage:
//   GET  /api/debug/verification-loop
//   POST /api/debug/verification-loop \
//        -H 'Content-Type: application/json' \
//        -d '{"agent":"frontend-generator","title":"Generate web app","stageId":"generate","gate":"compilation","result":"24 files generated"}'
//
// Expected POST response:
//   {
//     task:   { id, title, agent },
//     verification: {
//       taskId, status, checks[], retryCount, fixTaskIds[], timestamp
//     },
//     summary: { total, totalVerified, totalFixing, totalFixTasksCreated, ... }
//   }
//
// If `gate` is omitted the loop only runs the output-presence + stage checks.
// If `result` is omitted the output-present check fails with severity=error,
// triggering fix-task creation (up to MAX_RETRIES=3).

import { NextResponse } from "next/server";
import { verificationLoop } from "@/lib/engine/verification-loop";
import { makeTask } from "@/lib/engine/execution-engine";
import type { AgentRole, StageId, GateId, Task } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — return the current verification summary. Useful for polling the
 * loop's progress during a long-running build.
 */
export async function GET() {
  return NextResponse.json(verificationLoop.getSummary());
}

/**
 * POST — verify a mock task and (if verification fails) demonstrate the
 * fix-task creation path. Returns the task, the VerificationResult, and
 * the updated summary.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      taskId?: string;
      agent?: string;
      title?: string;
      stageId?: string;
      gate?: string;
      result?: string;
      workspacePath?: string;
      targetType?: string;
    } | null;

    const stageId = (body?.stageId || "build") as StageId;
    const agent = (body?.agent || "frontend-generator") as AgentRole;
    const title = body?.title || "Demo Task";
    const gate = body?.gate as GateId | undefined;

    // Create the mock task. `makeTask` accepts `gate` in its opts but
    // doesn't currently propagate it onto the Task object — we set it
    // directly here so `runChecks` sees it.
    //
    // `workflowId: "new-project"` is one of the canonical WorkflowId union
    // members (the only valid values are the 8 WorkflowIds defined in
    // types.ts). The mock task is tagged with this workflow so makeTask's
    // opts satisfy the WorkflowId type.
    const task = makeTask({
      workflowId: "new-project",
      stageId,
      title,
      description: "Task for verification-loop demo",
      agent,
      dependsOn: [],
      gate,
    }) as Task & { result?: string; gate?: GateId };

    // Allow the caller to override the generated task id (for deterministic
    // retry-tracking across calls in tests).
    if (body?.taskId) task.id = body.taskId;

    // Simulate that the task ran. `makeTask` does not set `result`, so the
    // output-present check would otherwise fail every time.
    task.result = body?.result ?? "generated output";
    if (gate) task.gate = gate;

    const result = await verificationLoop.verify(task, {
      workspacePath: body?.workspacePath,
      targetType: body?.targetType,
    });

    return NextResponse.json({
      task: { id: task.id, title: task.title, agent: task.agent },
      verification: result,
      summary: verificationLoop.getSummary(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Verification loop debug failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
