// Debug Endpoint — Workflows (Wave 4A).
//
// Proves the WorkflowEngine routes natural-language prompts to the correct
// one of the 8 registered workflows (new-project, continue-existing, bug-fix,
// refactor, add-feature, upgrade-framework, package-project, export-project).
//
//   GET  → lists every workflow with its stages (id, label, agents, gates),
//          agent + gate counts, and total stage count. The response is the
//          authoritative source of truth for "which workflows exist?"
//   POST → accepts `{ prompt: string }`, runs `workflowEngine.select(prompt)`
//          (regex pre-pass + signal-based fallback), and returns the selected
//          workflow with its stages + a `selection` block describing which
//          routing branch fired (regex-pre-pass vs. signal-scoring vs.
//          default-new-project).
//
// Verification (per Wave 4A task spec):
//   curl /api/debug/workflows                                  → 8 workflows
//   curl -X POST /api/debug/workflows -d '{"prompt":"fix the login bug"}'
//                                                               → bug-fix
//   curl -X POST /api/debug/workflows -d '{"prompt":"refactor the auth module"}'
//                                                               → refactor
//
// Backward compatibility: this endpoint is purely additive — it reads from
// the existing `workflowEngine` singleton and does not modify any state.

import { NextResponse } from "next/server";
import { workflowEngine } from "@/lib/engine/workflow-engine";
import type { Workflow } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shape of a single workflow entry in the GET response. */
interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  stageCount: number;
  agentCount: number;
  gateCount: number;
  signals: string[];
  stages: Array<{
    id: string;
    label: string;
    description: string;
    agents: string[];
    gates: string[];
  }>;
}

/** Shape of the POST response. */
interface SelectionResponse {
  prompt: string;
  matchedBy: "regex-pre-pass" | "signal-scoring" | "default-new-project";
  matchedPattern?: string;
  signalScore?: number;
  selectedWorkflow: {
    id: string;
    name: string;
    description: string;
  };
  stages: Array<{
    id: string;
    label: string;
    description: string;
    agents: string[];
    gates: string[];
  }>;
  /** All workflows scored (for debugging the signal-based fallback). */
  allScores?: Array<{ id: string; score: number }>;
}

/**
 * Replicates `WorkflowEngine.select()`'s decision tree so the debug endpoint
 * can report WHICH branch fired (regex vs. signal vs. default). The actual
 * selection still delegates to `workflowEngine.select(prompt)` — this helper
 * only exists to surface the routing metadata for debugging.
 */
function describeSelection(
  prompt: string
): {
  matchedBy: "regex-pre-pass" | "signal-scoring" | "default-new-project";
  matchedPattern?: string;
  signalScore?: number;
  allScores?: Array<{ id: string; score: number }>;
} {
  const p = prompt.toLowerCase();

  // Mirror the regex pre-pass in workflow-engine.ts (same order, same patterns).
  const regexBranches: Array<{ id: string; pattern: RegExp; label: string }> = [
    { id: "continue-existing", pattern: /\b(continue|reopen|resume|evolve)\b/, label: "continue|reopen|resume|evolve" },
    { id: "refactor", pattern: /\b(refactor|restructure)\b/, label: "refactor|restructure|clean up" },
    { id: "refactor", pattern: /clean\s+up/, label: "refactor|restructure|clean up" },
    { id: "upgrade-framework", pattern: /\b(upgrade|migrate|migration)\b/, label: "upgrade|migrate|migration" },
    { id: "package-project", pattern: /\b(package|bundle|distribute)\b/, label: "package|bundle|distribute" },
    { id: "export-project", pattern: /\b(export|zip|download)\b/, label: "export|zip|download" },
    { id: "bug-fix", pattern: /\b(bug|broken|crash)\b/, label: "bug|fix|broken|error|crash" },
    { id: "bug-fix", pattern: /\b(fix|error)\b/, label: "bug|fix|broken|error|crash" },
  ];
  for (const branch of regexBranches) {
    if (branch.pattern.test(p)) {
      return { matchedBy: "regex-pre-pass", matchedPattern: branch.label };
    }
  }

  // Mirror the signal-based scoring.
  const all = workflowEngine.all();
  const allScores: Array<{ id: string; score: number }> = [];
  let bestScore = 0;
  for (const w of all) {
    let score = 0;
    for (const sig of w.signals) {
      if (p.includes(sig)) score += sig.length;
    }
    allScores.push({ id: w.id, score });
    if (score > bestScore) bestScore = score;
  }
  if (bestScore === 0) {
    return { matchedBy: "default-new-project", signalScore: 0, allScores };
  }
  return { matchedBy: "signal-scoring", signalScore: bestScore, allScores };
}

/** Map a Workflow to its summary shape (used by GET + POST). */
function summarize(w: Workflow): WorkflowSummary {
  const stages = w.stages.map((s) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    agents: s.agents,
    gates: s.gates ?? [],
  }));
  const agentCount = new Set(stages.flatMap((s) => s.agents)).size;
  const gateCount = new Set(stages.flatMap((s) => s.gates)).size;
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    stageCount: stages.length,
    agentCount,
    gateCount,
    signals: w.signals,
    stages,
  };
}

export async function GET() {
  const all = workflowEngine.all();
  const summaries = all.map(summarize);
  return NextResponse.json({
    totalWorkflows: summaries.length,
    workflows: summaries,
    // Convenience: which workflow is the default when no signals match?
    defaultWorkflowId: "new-project",
    // Convenience: the routing logic summary (mirrors WorkflowEngine.select)
    routing: {
      order: ["regex-pre-pass", "signal-scoring", "default-new-project"],
      regexPrePass: [
        { workflowId: "continue-existing", pattern: "\\b(continue|reopen|resume|evolve)\\b" },
        { workflowId: "refactor", pattern: "\\b(refactor|restructure)\\b | /clean\\s+up/" },
        { workflowId: "upgrade-framework", pattern: "\\b(upgrade|migrate|migration)\\b" },
        { workflowId: "package-project", pattern: "\\b(package|bundle|distribute)\\b" },
        { workflowId: "export-project", pattern: "\\b(export|zip|download)\\b" },
        { workflowId: "bug-fix", pattern: "\\b(bug|broken|crash|fix|error)\\b" },
      ],
      signalScoring: "sum of signal-string lengths for each workflow's `signals` array; highest total wins; ties resolve to insertion order (new-project first)",
      defaultFallback: "new-project",
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { prompt?: string } | null;
    const prompt = body?.prompt ?? "";
    const workflow = workflowEngine.select(prompt);
    const description = describeSelection(prompt);
    const summary = summarize(workflow);
    const response: SelectionResponse = {
      prompt,
      matchedBy: description.matchedBy,
      matchedPattern: description.matchedPattern,
      signalScore: description.signalScore,
      selectedWorkflow: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
      },
      stages: summary.stages,
    };
    if (description.allScores) response.allScores = description.allScores;
    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: `Workflow selection failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
