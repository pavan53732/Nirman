import { NextResponse } from "next/server";
import { workspaceIntelligence } from "@/lib/engine/workspace-intelligence";
import { generateForTarget } from "@/lib/engine/generators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Debug endpoint for the WorkspaceIntelligence indexer.
 *
 * GET /api/debug/workspace-graph?target=web
 *   Indexes the generated files for the given target and returns:
 *     - the summary (fileCount, totalSymbols, totalDependencies, layers)
 *     - a 10-file sample of the semantic index
 *     - the result of an optional query
 *
 * Supported queries:
 *   ?query=dependents&symbol=Contact      → files that import/reference Contact
 *   ?query=symbols&file=prisma/schema.prisma → symbols defined in that file
 *   ?query=kind&kind=model                 → all model symbols across files
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = (url.searchParams.get("target") || "web") as
    | "web"
    | "windows"
    | "android";
  const query = url.searchParams.get("query");
  const symbol = url.searchParams.get("symbol");
  const file = url.searchParams.get("file");
  const kind = url.searchParams.get("kind");

  // Generate sample files for the target and index them. We pass a ctx so the
  // real generators (Next.js + Prisma, WinUI 3 + EF Core, Compose + Room) run.
  // `offline-sync` capability triggers EF Core on Windows (so the Data layer
  // is produced) and Room on Android (so the DAO/Repository layers appear).
  const result = generateForTarget(target, "default", "DemoApp", "t1", {
    prompt: "CRM app with contacts",
    capabilities: ["offline-sync"],
    nonFunctionals: [],
  });

  workspaceIntelligence.index(result.files, target);
  const summary = workspaceIntelligence.getSummary();

  // Handle specific queries
  let queryResult: unknown = null;
  if (query === "dependents" && symbol) {
    queryResult = workspaceIntelligence.queryDependents(symbol);
  } else if (query === "symbols" && file) {
    queryResult = workspaceIntelligence.querySymbols(file);
  } else if (query === "kind" && kind) {
    queryResult = workspaceIntelligence.querySymbolsByKind(
      kind as
        | "function"
        | "class"
        | "interface"
        | "model"
        | "endpoint"
        | "route"
        | "view"
        | "config"
    );
  }

  return NextResponse.json({
    target,
    summary,
    query: query
      ? { type: query, params: { symbol, file, kind }, result: queryResult }
      : null,
    // Include a sample of the semantic index
    sampleFiles: [...workspaceIntelligence.getGraph()!.semanticIndex.values()]
      .slice(0, 10)
      .map((info) => ({
        path: info.path,
        language: info.language,
        framework: info.framework,
        purpose: info.purpose,
        lineCount: info.lineCount,
      })),
  });
}
