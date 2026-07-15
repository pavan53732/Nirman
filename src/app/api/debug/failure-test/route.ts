// Debug Endpoint — Failure-path testing.
//
// GET /api/debug/failure-test
//
// Runs 5 failure scenarios that intentionally break engine dependencies and
// verifies Pavan degrades gracefully instead of crashing. Each scenario:
//
//   1. Missing SKILL.md       — empty endorsements to pickStack; must still
//                               return a valid stack (no-boost fallback).
//   2. Invalid Architecture    — garbage in architecture/Database memory;
//       Memory                  readDatabaseFromMemory must return "sqlite".
//   3. Failed Generator        — generateForTarget("unknown", ...) must fall
//                               back to the README path, not crash.
//   4. Empty Prompt            — detectTargets("") must return the default
//                               web target.
//   5. Ambiguity Gate Trigger  — detectAmbiguity("build an app") must score
//                               > threshold and return a question, not
//                               auto-proceed with invented requirements.
//
// Response shape:
//   {
//     results: ScenarioResult[],   // 5 entries, one per scenario
//     summary: { total: 5, passed: N, failed: 5 - N },
//     allGraceful: boolean         // true iff every scenario handledGracefully
//   }
//
// `passed` counts scenarios with `handledGracefully === true`. `allGraceful`
// is the boolean "did every degradation path work" flag.

import { NextResponse } from "next/server";
import { runFailureTests, type ScenarioResult } from "@/lib/engine/failure-tests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const results: ScenarioResult[] = runFailureTests();
    const passed = results.filter((r) => r.handledGracefully).length;
    const failed = results.length - passed;
    const allGraceful = results.length > 0 && results.every((r) => r.handledGracefully);
    return NextResponse.json(
      {
        results,
        summary: {
          total: results.length,
          passed,
          failed,
        },
        allGraceful,
      },
      { status: 200 }
    );
  } catch (err) {
    // The harness itself is supposed to never throw — each scenario is wrapped
    // in try/catch. If we get here, the harness itself is broken, which is a
    // real bug worth surfacing with a 500.
    return NextResponse.json(
      {
        error: `Failure test suite itself failed: ${String(err)}`,
        results: [],
        summary: { total: 0, passed: 0, failed: 0 },
        allGraceful: false,
      },
      { status: 500 }
    );
  }
}
