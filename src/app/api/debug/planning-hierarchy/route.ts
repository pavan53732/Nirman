// Debug Endpoint — Planning Hierarchy (Task V).
//
// Proves the 4-level planning hierarchy works end-to-end:
//   Level 1 — Project Planner   (prompt  -> features)
//   Level 2 — Feature Planner   (feature -> modules)
//   Level 3 — Module Planner    (module  -> tasks)
//   Level 4 — Task Planner      (task    -> concrete TaskSpec)
//
// The reviewer said: "Planning hierarchy: Introduce planning at multiple
// levels: Project planner, Feature planner, Module planner, Task planner.
// That will make large projects much easier to manage."
//
// Usage:
//   GET /api/debug/planning-hierarchy
//        ?prompt=CRM+app+with+contacts,+deals,+pipeline,+activities,+reports
//        &targets=web,windows,android
//
// Returns the full hierarchy summary plus top-level stats (feature / module /
// task counts + estimated complexity). For the default CRM prompt this yields
// 5+ features, 15+ modules, 40+ tasks, complexity="high".

import { NextResponse } from "next/server";
import { planningHierarchy } from "@/lib/engine/planning-hierarchy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const prompt =
    url.searchParams.get("prompt") ||
    "CRM app with contacts, deals, pipeline, activities, and reports";
  const targetsStr = url.searchParams.get("targets") || "web,windows,android";
  const targets = targetsStr.split(",").filter(Boolean);

  const plan = planningHierarchy.planFullHierarchy(prompt, targets);
  const summary = planningHierarchy.getSummary(plan);

  return NextResponse.json({
    prompt,
    targets,
    summary,
    levels: {
      1: "Project Planner",
      2: "Feature Planner",
      3: "Module Planner",
      4: "Task Planner",
    },
    stats: {
      features: summary.featureCount,
      modules: summary.moduleCount,
      tasks: summary.taskCount,
      complexity: summary.complexity,
    },
  });
}
