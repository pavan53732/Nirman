import { NextResponse } from "next/server";
import { workspaceReasoning } from "@/lib/engine/workspace-reasoning";
import { workspaceIntelligence } from "@/lib/engine/workspace-intelligence";
import { generateForTarget } from "@/lib/engine/generators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Debug endpoint for the WorkspaceReasoning layer — the 5 deeper reasoning
 * capabilities built on top of the 4-graph WorkspaceIntelligence.
 *
 * GET /api/debug/workspace-reasoning?target=web&query=contact
 *   1. Generates + indexes files for the target (web/windows/android)
 *   2. Runs all 5 reasoning capabilities:
 *      - semanticSearch      → ranked files/symbols matching `query`
 *      - impactAnalysis      → blast radius if "Contact" changes
 *      - architectureValidation → score (0-100) + violations
 *      - dependencyRecommendations → circular deps / refactor hints
 *      - deadCodeReport      → unused symbols/files + dead-code %
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = (url.searchParams.get("target") || "web") as
    | "web"
    | "windows"
    | "android";
  const query = url.searchParams.get("query") || "contact model";

  // Generate + index files. `offline-sync` triggers EF Core (Windows) / Room
  // (Android) so the Data layer appears in the architecture graph.
  const result = generateForTarget(target, "default", "DemoApp", "t1", {
    prompt: "CRM app with contacts",
    capabilities: ["offline-sync"],
    nonFunctionals: [],
  });
  workspaceIntelligence.index(result.files, target);

  // Run all 5 reasoning capabilities
  const report = workspaceReasoning.getFullReport(target);

  // Also run a semantic search with the provided query
  const searchResults = workspaceReasoning.semanticSearch(query, 10);

  return NextResponse.json({
    target,
    query,
    semanticSearch: searchResults,
    impactAnalysis: report.impactAnalysis,
    architectureValidation: {
      score: report.architectureValidation.score,
      layersPresent: report.architectureValidation.layersPresent,
      layersMissing: report.architectureValidation.layersMissing,
      violations: report.architectureValidation.violations,
      summary: report.architectureValidation.summary,
    },
    dependencyRecommendations: report.dependencyRecommendations,
    deadCodeReport: report.deadCodeReport,
  });
}
