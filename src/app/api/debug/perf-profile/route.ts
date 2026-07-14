// Performance profiling endpoint — runs 4 benchmark scenarios against the
// generators and returns build time, memory usage, and file output metrics.
//
// GET /api/debug/perf-profile
//   → 200 { results: PerfResult[], summary: PerfSummary }
//
// Each result captures one scenario:
//   - Single-target web (small): "a simple todo app"
//   - Single-target web (CRM): "a CRM app with contacts, deals, and pipeline"
//   - 3-target CRM: "CRM desktop app with Android companion and web admin"
//   - Stress — enterprise CRM (3 targets): big prompt + 3 platforms
//
// The harness calls `generateForTarget` directly (no orchestrator) so the
// numbers reflect pure generator throughput. See
// `src/lib/engine/perf-harness.ts` for the implementation.
//
// Reviewer's recommendation: "Performance profiling: Measure build time,
// memory usage, and scalability with larger projects."

import { NextResponse } from "next/server";
import { runPerfProfile, summarizePerf, type PerfResult, type PerfSummary } from "@/lib/engine/perf-harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PerfProfileResponse {
  endpoint: string;
  timestamp: string;
  results: PerfResult[];
  summary: PerfSummary;
}

export async function GET(): Promise<NextResponse> {
  const results = runPerfProfile();
  const summary = summarizePerf(results);
  const body: PerfProfileResponse = {
    endpoint: "/api/debug/perf-profile",
    timestamp: new Date().toISOString(),
    results,
    summary,
  };
  return NextResponse.json(body, { status: 200 });
}
