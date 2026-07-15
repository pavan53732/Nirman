// Performance profiling harness for Pavan's generators.
//
// Measures build time, memory usage, and file output across 4 benchmark
// scenarios by calling `generateForTarget` directly — bypassing the full
// orchestrator (memory reads, workflow selection, execution-engine scheduling,
// workspace materialization). This isolates GENERATOR performance from the
// rest of the pipeline so the numbers reflect pure template + data-model
// throughput.
//
// Each scenario:
//   1. detectTargets(prompt)  → real target list (no hardcoded kinds)
//   2. snapshot heapUsed + Date.now()
//   3. generateForTarget(...) for each detected target (synchronous)
//   4. snapshot heapUsed + Date.now() again
//   5. compute fileCount, totalBytes, durationMs, heapDelta, files/sec, MB/sec
//
// The harness is server-only (uses process.memoryUsage()). Importing it from
// a route.ts with `runtime = "nodejs"` is the intended usage — see
// /api/debug/perf-profile/route.ts.
//
// Reviewer's recommendation: "Performance profiling: Measure build time,
// memory usage, and scalability with larger projects."

import { detectTargets, generateForTarget } from "@/lib/engine";

/** A single detected target as returned by detectTargets. */
type Target = ReturnType<typeof detectTargets>[number];

export interface PerfResult {
  scenario: string;
  prompt: string;
  targetCount: number;
  fileCount: number;
  totalBytes: number;
  durationMs: number;
  /** process.memoryUsage().heapUsed after the build, in MB. */
  heapUsedMB: number;
  /** heapUsed after - heapUsed before, in MB (clamped to >= 0). */
  heapDeltaMB: number;
  /** fileCount / (durationMs / 1000). */
  filesPerSecond: number;
  /** (totalBytes / 1024 / 1024) / (durationMs / 1000). */
  mbPerSecond: number;
}

/** High-level summary across all scenarios. */
export interface PerfSummary {
  /** Scenario with the smallest durationMs. */
  fastestScenario: string;
  /** Scenario with the largest durationMs. */
  slowestScenario: string;
  /** Mean of per-scenario filesPerSecond. */
  avgFilesPerSecond: number;
  /** Sum of fileCount across all scenarios. */
  totalFiles: number;
  /** Sum of durationMs across all scenarios. */
  totalDurationMs: number;
}

const MB = 1024 * 1024;

interface ScenarioSpec {
  scenario: string;
  prompt: string;
  /**
   * Optional cap on the number of detected targets to actually generate.
   * Used by scenarios 1 and 2 to force a single-target measurement even if
   * the prompt happened to match more than one platform.
   */
  maxTargets?: number;
  /** Force selection of exactly the first web target (scenarios 1 & 2). */
  webOnly?: boolean;
}

// The 4 benchmark scenarios. Prompts are chosen to exercise:
//   (1) minimal single-target — baseline for "how fast can we generate a tiny app?"
//   (2) CRM single-target — measures how a richer data model scales file output
//   (3) multi-target CRM — measures per-target overhead when 3 generators run
//   (4) enterprise stress — large prompt + 3 targets, scalability ceiling
//
// Scenario 4's prompt explicitly mentions desktop/Android/web so detectTargets
// returns 3 targets (the literal reviewer prompt had no platform keywords and
// would have collapsed to a single web target — defeating the "3 targets"
// stress-test intent). The enterprise-CRM domain terms are preserved.
const SCENARIOS: ScenarioSpec[] = [
  {
    scenario: "1. Single-target web (small)",
    prompt: "a simple todo app",
    webOnly: true,
  },
  {
    scenario: "2. Single-target web (CRM)",
    prompt: "a CRM app with contacts, deals, and pipeline",
    webOnly: true,
  },
  {
    scenario: "3. 3-target CRM",
    prompt: "CRM desktop app with Android companion and web admin",
  },
  {
    scenario: "4. Stress — enterprise CRM (3 targets)",
    prompt:
      "enterprise CRM desktop app with Android companion and web admin, with contacts, deals, pipeline, activities, reports, users, roles, permissions, audit log, and integrations",
  },
];

/**
 * Force a GC pass if the runtime was started with --expose-gc. In a normal
 * Next.js dev/prod server `global.gc` is undefined, so this is a no-op — but
 * if the harness is run under `node --expose-gc`, heap-delta measurements
 * become much cleaner (no leftover garbage from prior scenarios).
 */
function maybeGC(): void {
  const g = globalThis as unknown as { gc?: () => void };
  if (typeof g.gc === "function") {
    g.gc();
  }
}

/**
 * Derive a clean project name from the prompt. We deliberately don't import
 * the orchestrator's private `promptToName` helper (that file is owned by
 * another task). The generators sanitize the name via `slug()` anyway, so any
 * reasonable string works.
 */
function deriveProjectName(prompt: string): string {
  const stopwords = new Set([
    "a", "an", "the", "build", "create", "make", "generate", "develop",
    "app", "application", "with", "and", "for", "of", "in", "on", "to",
    "simple", "enterprise", "companion", "desktop", "mobile", "admin",
    "portal", "web", "android", "windows",
  ]);
  const acronyms = new Set(["crm", "api", "sdk", "cli", "ai", "ui", "ux", "ml"]);
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !stopwords.has(w))
    .slice(0, 3);
  if (words.length === 0) return "App";
  return words
    .map((w) => (acronyms.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}

/** Pick the targets to actually generate for a scenario, per its spec. */
function selectTargets(spec: ScenarioSpec, detected: Target[]): Target[] {
  if (spec.webOnly) {
    const web = detected.find((t) => t.kind === "web") ?? detected[0];
    return web ? [web] : [];
  }
  if (spec.maxTargets && detected.length > spec.maxTargets) {
    return detected.slice(0, spec.maxTargets);
  }
  return detected;
}

/** Run a single scenario and return its PerfResult. */
function runScenario(spec: ScenarioSpec): PerfResult {
  const detected = detectTargets(spec.prompt);
  const targets = selectTargets(spec, detected);

  maybeGC();
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = Date.now();

  let fileCount = 0;
  let totalBytes = 0;
  const baseName = deriveProjectName(spec.prompt);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    // Call generateForTarget directly — no orchestrator, no workspace write,
    // no execution-engine scheduling. This isolates generator throughput.
    const result = generateForTarget(
      t.kind,
      t.stack,
      `${baseName}-${t.kind}`,
      `perf-t${i + 1}`,
      {
        prompt: spec.prompt,
        capabilities: [],
        nonFunctionals: [],
      }
    );
    fileCount += result.files.length;
    for (const f of result.files) {
      totalBytes += f.content.length;
    }
  }

  const t1 = Date.now();
  const heapAfter = process.memoryUsage().heapUsed;

  // Guard against sub-millisecond durations causing divide-by-zero. The
  // smallest single-target scenario still generates 10+ files so duration
  // is typically 5-50ms, but on a fast machine a tiny build could complete
  // in <1ms.
  const durationMs = Math.max(1, t1 - t0);
  const heapDelta = Math.max(0, heapAfter - heapBefore);
  const seconds = durationMs / 1000;

  return {
    scenario: spec.scenario,
    prompt: spec.prompt,
    targetCount: targets.length,
    fileCount,
    totalBytes,
    durationMs,
    heapUsedMB: Number((heapAfter / MB).toFixed(3)),
    heapDeltaMB: Number((heapDelta / MB).toFixed(3)),
    filesPerSecond: Number((fileCount / seconds).toFixed(1)),
    mbPerSecond: Number((totalBytes / MB / seconds).toFixed(3)),
  };
}

/**
 * Run all 4 benchmark scenarios and return their results in order.
 *
 * Synchronous: generateForTarget is sync, so the whole profile completes in
 * well under a second on modern hardware. The route handler just awaits the
 * call (or wraps it) to satisfy Next.js's async GET signature.
 */
export function runPerfProfile(): PerfResult[] {
  return SCENARIOS.map(runScenario);
}

/** Compute the summary block for a set of PerfResults. */
export function summarizePerf(results: PerfResult[]): PerfSummary {
  if (results.length === 0) {
    return {
      fastestScenario: "",
      slowestScenario: "",
      avgFilesPerSecond: 0,
      totalFiles: 0,
      totalDurationMs: 0,
    };
  }
  const fastest = results.reduce((a, b) => (b.durationMs < a.durationMs ? b : a));
  const slowest = results.reduce((a, b) => (b.durationMs > a.durationMs ? b : a));
  const totalFiles = results.reduce((n, r) => n + r.fileCount, 0);
  const totalDurationMs = results.reduce((n, r) => n + r.durationMs, 0);
  const avgFilesPerSecond = results.reduce((n, r) => n + r.filesPerSecond, 0) / results.length;
  return {
    fastestScenario: fastest.scenario,
    slowestScenario: slowest.scenario,
    avgFilesPerSecond: Number(avgFilesPerSecond.toFixed(1)),
    totalFiles,
    totalDurationMs,
  };
}
