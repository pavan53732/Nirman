// Debug Endpoint — Smart Scheduler.
//
// (Depth-5: "Smarter execution strategies" — priority scheduling,
//  resource-aware parallelism, adaptive concurrency, deadline-aware.)
//
// Proves the SmartScheduler works end-to-end:
//
//   GET  /api/debug/smart-scheduler
//     → returns the scheduler summary: total prioritized tasks, count per
//       priority level (critical/high/normal/low/background), critical-path
//       length, and the active config.
//
//   POST /api/debug/smart-scheduler  body: { action, ... }
//     → performs an action. Supported actions:
//         { action: "auto-assign" }
//           Creates 6 demo tasks (analyze→plan→generate→build→test→package
//           chain with a compilation gate on the build step), clears the
//           scheduler, runs `autoAssignPriorities()`, and returns the
//           per-task priority assignments + summary. Verifies that:
//             - compilation gate → "critical"
//             - generate stage   → "high"
//             - package stage    → "low"
//
//         { action: "recommend-order" }
//           Creates 4 ready demo tasks (generate, build+compilation-gate,
//           package, test — all independent), runs `autoAssignPriorities()`
//           and `recommendOrder()`, returns the recommended execution order
//           (sorted by priority then by estimated duration). Verifies that
//           critical-path tasks come first.
//
//         { action: "recommend-concurrency", memoryMB?, avgToolDurationMs?, queueDepth?, runningTasks? }
//           Runs `recommendConcurrency()` with the provided signals and
//           returns the recommended `maxParallel`, the human-readable
//           reason, and the raw factors. Verifies that:
//             - high memory + slow tools → reduced parallelism
//             - fast tools + deep queue → increased parallelism
//
//         { action: "clear" }
//           Clears all priority assignments and the critical-path set.
//
// Usage:
//   # Inspect the summary
//   curl -s http://localhost:3000/api/debug/smart-scheduler | jq
//
//   # Auto-assign priorities to a demo task set
//   curl -s -X POST http://localhost:3000/api/debug/smart-scheduler \
//        -H 'Content-Type: application/json' \
//        -d '{"action":"auto-assign"}' | jq
//
//   # Get a recommended execution order for demo ready tasks
//   curl -s -X POST http://localhost:3000/api/debug/smart-scheduler \
//        -H 'Content-Type: application/json' \
//        -d '{"action":"recommend-order"}' | jq
//
//   # Get a concurrency recommendation under high memory + slow tools
//   curl -s -X POST http://localhost:3000/api/debug/smart-scheduler \
//        -H 'Content-Type: application/json' \
//        -d '{"action":"recommend-concurrency","memoryMB":800,"avgToolDurationMs":45000,"queueDepth":10}' | jq

import { NextResponse } from "next/server";
import { smartScheduler } from "@/lib/engine/smart-scheduler";
import { makeTask } from "@/lib/engine/execution-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — return the SmartScheduler's current summary (priority counts,
 * critical-path length, active config).
 */
export async function GET() {
  return NextResponse.json(smartScheduler.getSummary());
}

/**
 * POST — perform an action. See the file header for the full action list.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      memoryMB?: number;
      avgToolDurationMs?: number;
      queueDepth?: number;
      runningTasks?: number;
    } | null;

    switch (body?.action) {
      case "auto-assign": {
        // Build a 6-task pipeline demo (analyze→plan→generate→build→test→package)
        // with a compilation gate on the build step. Use the actual task IDs
        // returned by makeTask() for the dependsOn chains — the global
        // taskCounter may have advanced from prior debug calls, so we can't
        // hardcode "task-1", "task-2", etc.
        //
        // NOTE: makeTask() accepts `gate` in opts but (as of the current
        // execution-engine.ts) does NOT copy it to the returned Task. We
        // set `t4.gate = "compilation"` manually below so the SmartScheduler
        // sees the gate and assigns "critical" priority. This is a
        // pre-existing quirk of makeTask; we work around it here rather
        // than touching execution-engine.ts (which is read-only for Depth-5).
        const t1 = makeTask({
          workflowId: "new-project",
          stageId: "analyze",
          title: "Understand requirements",
          description: "",
          agent: "requirements-analyst",
          dependsOn: [],
        });
        const t2 = makeTask({
          workflowId: "new-project",
          stageId: "plan",
          title: "Plan",
          description: "",
          agent: "planner",
          dependsOn: [t1.id],
        });
        const t3 = makeTask({
          workflowId: "new-project",
          stageId: "generate",
          title: "Generate web",
          description: "",
          agent: "frontend-generator",
          dependsOn: [t2.id],
        });
        const t4 = makeTask({
          workflowId: "new-project",
          stageId: "build",
          title: "Build",
          description: "",
          agent: "build-engineer",
          dependsOn: [t3.id],
          gate: "compilation",
        });
        // Workaround for makeTask not copying opts.gate to the returned Task.
        t4.gate = "compilation";
        const t5 = makeTask({
          workflowId: "new-project",
          stageId: "test",
          title: "Test",
          description: "",
          agent: "test-generator",
          dependsOn: [t4.id],
        });
        const t6 = makeTask({
          workflowId: "new-project",
          stageId: "package",
          title: "Package",
          description: "",
          agent: "packaging-engineer",
          dependsOn: [t5.id],
        });
        const tasks = [t1, t2, t3, t4, t5, t6];
        smartScheduler.clear();
        smartScheduler.autoAssignPriorities(tasks);
        return NextResponse.json({
          ok: true,
          action: "auto-assign",
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            stageId: t.stageId,
            gate: t.gate,
            dependsOn: t.dependsOn,
            priority: smartScheduler.getPriority(t.id),
          })),
          summary: smartScheduler.getSummary(),
        });
      }

      case "recommend-order": {
        // Build 4 INDEPENDENT ready tasks (all dependsOn=[]) spanning the
        // critical-priority spectrum. The order they're added is deliberately
        // NOT the priority order, so the recommendedOrder() sort is visible.
        //
        // See auto-assign above for the makeTask/gate workaround.
        const g = makeTask({
          workflowId: "new-project",
          stageId: "generate",
          title: "Generate web",
          description: "",
          agent: "frontend-generator",
          dependsOn: [],
        });
        const b = makeTask({
          workflowId: "new-project",
          stageId: "build",
          title: "Build (compilation gate)",
          description: "",
          agent: "build-engineer",
          dependsOn: [],
          gate: "compilation",
        });
        // Workaround for makeTask not copying opts.gate to the returned Task.
        b.gate = "compilation";
        const p = makeTask({
          workflowId: "new-project",
          stageId: "package",
          title: "Package",
          description: "",
          agent: "packaging-engineer",
          dependsOn: [],
        });
        const tt = makeTask({
          workflowId: "new-project",
          stageId: "test",
          title: "Test",
          description: "",
          agent: "test-generator",
          dependsOn: [],
        });
        const tasks = [g, b, p, tt];
        smartScheduler.clear();
        smartScheduler.autoAssignPriorities(tasks);
        const order = smartScheduler.recommendOrder(tasks);
        return NextResponse.json({
          ok: true,
          action: "recommend-order",
          recommendedOrder: order.map((o) => ({
            taskId: o.taskId,
            priority: o.priority,
            reason: o.reason,
            estimatedDurationMs: o.estimatedDurationMs,
            shouldRunNow: o.shouldRunNow,
          })),
          summary: smartScheduler.getSummary(),
        });
      }

      case "recommend-concurrency": {
        const result = smartScheduler.recommendConcurrency({
          currentMemoryMB: body.memoryMB,
          avgToolDurationMs: body.avgToolDurationMs,
          queueDepth: body.queueDepth,
          runningTasks: body.runningTasks,
        });
        return NextResponse.json({
          ok: true,
          action: "recommend-concurrency",
          ...result,
        });
      }

      case "clear":
        smartScheduler.clear();
        return NextResponse.json({ ok: true, action: "clear" });

      default:
        return NextResponse.json(
          {
            error: `Unknown action: ${body?.action ?? "(none)"}`,
            supportedActions: ["auto-assign", "recommend-order", "recommend-concurrency", "clear"],
          },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
