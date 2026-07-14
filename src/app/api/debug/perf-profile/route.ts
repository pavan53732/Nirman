// Performance profiling endpoint — runs 4 benchmark scenarios against the
// generators and returns build time, memory usage, and file output metrics.
//
// GET /api/debug/perf-profile            → all 4 scenarios
// GET /api/debug/perf-profile?scenario=3 → only scenario 3 (for benchmark loops)
//
// Each result captures one scenario:
//   - Single-target web (small): "a simple todo app"
//   - Single-target web (CRM): "a CRM app with contacts, deals, and pipeline"
//   - 3-target CRM: "CRM desktop app with Android companion and web admin"
//   - Stress — enterprise CRM (3 targets): big prompt + 3 platforms
//
// IMPORTANT — "files" definition:
//   "files" = in-memory generated string artifacts (VirtualFile[]), where each
//   VirtualFile = { path: string, content: string }. These are template-generated
//   strings returned by generateForTarget(). They are NOT filesystem writes.
//   The workspace API (/api/workspace) would later persist these to disk.
//   The "files/s" metric measures GENERATION throughput, not disk I/O.
//
// The harness calls `generateForTarget` directly (no orchestrator) so the
// numbers reflect pure generator throughput. See
// `src/lib/engine/perf-harness.ts` for the implementation.

import { NextResponse } from "next/server";
import { runPerfProfile, summarizePerf, type PerfResult, type PerfSummary } from "@/lib/engine/perf-harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PerfProfileResponse {
  endpoint: string;
  timestamp: string;
  results: PerfResult[];
  summary: PerfSummary;
  /** Clarifies what "files" means for reproducibility. */
  fileDefinition: string;
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const scenarioFilter = url.searchParams.get("scenario");

  const allResults = runPerfProfile();
  const results = scenarioFilter
    ? allResults.filter((r) => r.scenario.startsWith(`${scenarioFilter}.`))
    : allResults;
  const summary = summarizePerf(allResults);
  const body: PerfProfileResponse = {
    endpoint: "/api/debug/perf-profile",
    timestamp: new Date().toISOString(),
    results,
    summary,
    fileDefinition: "VirtualFile[] = { path: string, content: string }. In-memory generated strings, NOT filesystem writes. files/s measures generation throughput.",
  };
  return NextResponse.json(body, { status: 200 });
}
