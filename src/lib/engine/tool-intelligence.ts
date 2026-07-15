// Tool Intelligence — learns tool performance over time and uses it for
// scheduling decisions.
//
// Tracks every tool invocation:
//   - Duration (ms)
//   - Success/failure
//   - Error type (if failed)
//   - Context (project size, platform, file count)
//
// Computes per-tool statistics:
//   - Average duration
//   - Success rate
//   - Failure patterns (most common errors)
//   - Reliability score (0-1)
//
// Provides recommendations:
//   - "tsc is fast for small projects" → schedule first
//   - "npm-build fails 30% of the time" → add retry
//   - "dotnet build is slow" → allow more time
//
// ADDITIVE — does not modify ToolManager, the tool registry, the Sandbox,
// RuntimeMetrics, or the Orchestrator. Tool Intelligence is a SEPARATE
// collector focused on per-tool scheduling recommendations; it sits in front
// of the existing execution path as an advisory layer. Subsystems that want
// to consult it call `toolIntelligence.recommend(toolId)` /
// `toolIntelligence.optimalOrder(toolIds)` before scheduling; nothing is
// forced to consume it.
//
// Persistence: invocations are stored in window.localStorage on the client
// (key: pavan.tool-intelligence.v1). On the server, the collector is
// per-process — invocations are lost on restart unless a future wave adds
// disk persistence. The collector is fully functional either way; the
// /api/debug/tool-intelligence endpoint demonstrates every code path.

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ToolInvocation {
  toolId: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
  /** "timeout" | "compile-error" | "missing-dep" | "permission" | "unknown" */
  errorType?: string;
  errorMessage?: string;
  context?: {
    fileCount?: number;
    projectSize?: "small" | "medium" | "large";
    platform?: string;
  };
}

/**
 * Scheduling recommendation for a single tool, derived from learned
 * statistics. Named `ToolSchedulingRecommendation` (not `ToolRecommendation`)
 * to avoid colliding with the skill-router's same-named type that is already
 * re-exported from `@/lib/engine`. The two interfaces are conceptually
 * different:
 *   - `skill-tool-router.ToolRecommendation`        = "skill S says use tool T"
 *   - `tool-intelligence.ToolSchedulingRecommendation` = "based on past
 *     performance, schedule tool T with priority P, timeout X, retries R"
 */
export interface ToolSchedulingRecommendation {
  /** Scheduling priority — high-priority tools run first. */
  priority: "high" | "medium" | "low";
  /** Expected wall-clock duration (ms) — use for time-budget planning. */
  expectedDurationMs: number;
  /** Whether the scheduler should retry this tool on failure. */
  shouldRetry: boolean;
  /** Maximum retry attempts before giving up. */
  maxRetries: number;
  /** Recommended timeout ceiling (ms). */
  timeoutMs: number;
  /** Human-readable notes (e.g. "Low success rate — consider alternatives"). */
  notes: string;
}

export interface ToolStats {
  toolId: string;
  totalInvocations: number;
  successCount: number;
  failureCount: number;
  /** 0-1. */
  successRate: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  /** Median. */
  p50DurationMs: number;
  /** 95th percentile — the "slow tail". */
  p95DurationMs: number;
  /**
   * 0-1 — successRate * recencyWeight. Recency weight uses exponential decay
   * (half-life ~7 days) so old invocations count for less than recent ones.
   */
  reliabilityScore: number;
  commonErrors: { errorType: string; count: number; lastSeen: number }[];
  lastUsedAt: number;
  recommendation: ToolSchedulingRecommendation;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "pavan.tool-intelligence.v1";
const MAX_INVOCATIONS_PER_TOOL = 100; // keep last 100 invocations per tool
/** Exponential-decay constant for the recency weight (~7-day half-life). */
const RECENCY_DECAY_PER_DAY = 0.1;

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

/**
 * ToolIntelligence — accumulates tool invocations into per-tool statistics
 * and surfaces scheduling recommendations.
 *
 * The collector is intentionally simple: a Map of recent invocations per
 * tool, a stats cache (invalidated on every new record), and a recommendation
 * function. There's no async, no I/O beyond localStorage persistence (client
 * only), and no external dependencies.
 *
 * Thread-safety: JavaScript is single-threaded, so the Maps are safe under
 * normal use. The stats cache is invalidated on every `record()` call so
 * stale recommendations are never served.
 */
export class ToolIntelligence {
  /** toolId → recent invocations (most recent last). */
  private invocations = new Map<string, ToolInvocation[]>();
  /** toolId → cached stats. Invalidated on every `record()`. */
  private statsCache = new Map<string, ToolStats>();
  private loaded = false;

  constructor() {
    this.load();
  }

  // -------------------------------------------------------------------------
  // Recording API
  // -------------------------------------------------------------------------

  /**
   * Record a tool invocation. The invocation is appended to the tool's
   * recent-invocations list (capped at MAX_INVOCATIONS_PER_TOOL — oldest
   * entries are dropped), the stats cache for that tool is invalidated, and
   * the change is persisted to localStorage (client only).
   */
  record(invocation: ToolInvocation): void {
    this.ensureLoaded();

    const list = this.invocations.get(invocation.toolId) ?? [];
    list.push(invocation);

    // Keep only the most recent N invocations.
    if (list.length > MAX_INVOCATIONS_PER_TOOL) {
      list.shift();
    }

    this.invocations.set(invocation.toolId, list);

    // Invalidate stats cache — next getStats() call will recompute.
    this.statsCache.delete(invocation.toolId);

    this.persist();
  }

  // -------------------------------------------------------------------------
  // Query API
  // -------------------------------------------------------------------------

  /** Get statistics for a tool. Returns undefined if no invocations exist. */
  getStats(toolId: string): ToolStats | undefined {
    this.ensureLoaded();

    const cached = this.statsCache.get(toolId);
    if (cached) return cached;

    const invocations = this.invocations.get(toolId);
    if (!invocations || invocations.length === 0) return undefined;

    // Compute raw stats (without recommendation), then attach the
    // recommendation. This two-step approach breaks the circular dependency
    // that would arise if computeStats() called recommend() (which would call
    // getStats() → computeStats() → ...).
    const stats = this.computeStats(toolId, invocations);
    stats.recommendation = this.recommendFromStats(stats);
    this.statsCache.set(toolId, stats);
    return stats;
  }

  /** Get statistics for every tool that has at least one invocation. */
  getAllStats(): ToolStats[] {
    this.ensureLoaded();
    return [...this.invocations.keys()]
      .map((id) => this.getStats(id))
      .filter((s): s is ToolStats => s !== undefined);
  }

  /**
   * Get a scheduling recommendation for a tool. If the tool has no history,
   * sensible defaults are returned (medium priority, 30s expected, 60s
   * timeout, retry up to 2 times).
   */
  recommend(toolId: string): ToolSchedulingRecommendation {
    const stats = this.getStats(toolId);
    if (!stats) {
      return {
        priority: "medium",
        expectedDurationMs: 30_000, // 30s default
        shouldRetry: true,
        maxRetries: 2,
        timeoutMs: 60_000, // 60s default
        notes: "No historical data — using defaults",
      };
    }
    return this.recommendFromStats(stats);
  }

  /**
   * Get the optimal execution order for a set of tools.
   * Reliable + fast tools first, slow/unreliable tools last.
   *
   * Sort key:
   *   1. Priority (high → medium → low)
   *   2. Within the same priority band, faster tools first
   *      (by expectedDurationMs).
   *
   * Tools with no history are treated as medium priority with the default
   * 30s expected duration — they slot between known-fast and known-slow tools.
   */
  optimalOrder(toolIds: string[]): string[] {
    return [...toolIds].sort((a, b) => {
      const ra = this.recommend(a);
      const rb = this.recommend(b);

      // Priority order: high → medium → low.
      const priorityOrder: Record<ToolSchedulingRecommendation["priority"], number> = {
        high: 0,
        medium: 1,
        low: 2,
      };
      if (priorityOrder[ra.priority] !== priorityOrder[rb.priority]) {
        return priorityOrder[ra.priority] - priorityOrder[rb.priority];
      }

      // Same priority band: faster tools first.
      return ra.expectedDurationMs - rb.expectedDurationMs;
    });
  }

  /**
   * Get a summary suitable for debug dashboards. Includes aggregate counts
   * plus a per-tool snapshot (no PII, no raw invocation log).
   */
  getSummary() {
    this.ensureLoaded();
    const allStats = this.getAllStats();

    return {
      totalToolsTracked: allStats.length,
      totalInvocations: allStats.reduce((s, st) => s + st.totalInvocations, 0),
      avgSuccessRate:
        allStats.length > 0
          ? allStats.reduce((s, st) => s + st.successRate, 0) / allStats.length
          : 0,
      tools: allStats.map((s) => ({
        toolId: s.toolId,
        invocations: s.totalInvocations,
        successRate: s.successRate,
        avgDurationMs: s.avgDurationMs,
        reliability: s.reliabilityScore,
        priority: s.recommendation.priority,
        notes: s.recommendation.notes,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Demo / test helpers
  // -------------------------------------------------------------------------

  /**
   * Seed demo data for testing. Adds a realistic spread of invocations for
   * four canonical tools (tsc, npm-build, dotnet-build, gradle-build) so the
   * debug endpoint has something to show before any real builds have run.
   * Idempotent — repeated calls append more invocations.
   */
  seedDemoData(): void {
    this.ensureLoaded();

    // tsc: fast, reliable.
    for (let i = 0; i < 10; i++) {
      this.record({
        toolId: "tsc",
        timestamp: Date.now() - (10 - i) * 60_000,
        durationMs: 2000 + Math.random() * 1000,
        success: Math.random() > 0.1,
        errorType: Math.random() > 0.9 ? "compile-error" : undefined,
        context: { projectSize: "small", platform: "web" },
      });
    }

    // npm-build: slower, sometimes fails.
    for (let i = 0; i < 10; i++) {
      this.record({
        toolId: "npm-build",
        timestamp: Date.now() - (10 - i) * 120_000,
        durationMs: 30_000 + Math.random() * 20_000,
        success: Math.random() > 0.3,
        errorType: Math.random() > 0.7 ? "missing-dep" : undefined,
        context: { projectSize: "medium", platform: "web" },
      });
    }

    // dotnet-build: slow but reliable.
    for (let i = 0; i < 5; i++) {
      this.record({
        toolId: "dotnet-build",
        timestamp: Date.now() - (5 - i) * 180_000,
        durationMs: 60_000 + Math.random() * 30_000,
        success: Math.random() > 0.05,
        context: { projectSize: "medium", platform: "windows" },
      });
    }

    // gradle-build: very slow, moderate reliability.
    for (let i = 0; i < 5; i++) {
      this.record({
        toolId: "gradle-build",
        timestamp: Date.now() - (5 - i) * 300_000,
        durationMs: 120_000 + Math.random() * 60_000,
        success: Math.random() > 0.2,
        errorType: Math.random() > 0.8 ? "timeout" : undefined,
        context: { projectSize: "large", platform: "android" },
      });
    }
  }

  /** Clear all collected invocations and stats. Persists the cleared state. */
  clear(): void {
    this.invocations.clear();
    this.statsCache.clear();
    this.persist();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Compute raw statistics from a list of invocations. Does NOT populate
   * `recommendation` — the caller (`getStats`) attaches it afterwards to
   * break the circular dependency between `computeStats` and `recommend`.
   */
  private computeStats(toolId: string, invocations: ToolInvocation[]): ToolStats {
    const total = invocations.length;
    const successes = invocations.filter((i) => i.success);
    const failures = invocations.filter((i) => !i.success);
    const durations = invocations.map((i) => i.durationMs).sort((a, b) => a - b);

    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const minDuration = durations[0] ?? 0;
    const maxDuration = durations[durations.length - 1] ?? 0;
    const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0;
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;

    const successRate = total > 0 ? successes.length / total : 0;

    // Recency weight: more recent invocations matter more. Exponential decay
    // with ~7-day half-life so a tool that was reliable last month but is
    // failing today shows a depressed reliability score.
    const now = Date.now();
    const recencyWeight =
      invocations.length > 0
        ? invocations.reduce((sum, i) => {
            const age = now - i.timestamp;
            const ageDays = age / (1000 * 60 * 60 * 24);
            return sum + Math.exp(-ageDays * RECENCY_DECAY_PER_DAY);
          }, 0) / invocations.length
        : 0;

    const reliabilityScore = successRate * recencyWeight;

    // Common errors (top 5 by count).
    const errorCounts = new Map<string, { count: number; lastSeen: number }>();
    for (const f of failures) {
      const type = f.errorType ?? "unknown";
      const existing = errorCounts.get(type) ?? { count: 0, lastSeen: 0 };
      existing.count++;
      existing.lastSeen = Math.max(existing.lastSeen, f.timestamp);
      errorCounts.set(type, existing);
    }
    const commonErrors = [...errorCounts.entries()]
      .map(([errorType, data]) => ({ errorType, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const lastUsedAt = Math.max(...invocations.map((i) => i.timestamp));

    return {
      toolId,
      totalInvocations: total,
      successCount: successes.length,
      failureCount: failures.length,
      successRate,
      avgDurationMs: avgDuration,
      minDurationMs: minDuration,
      maxDurationMs: maxDuration,
      p50DurationMs: p50,
      p95DurationMs: p95,
      reliabilityScore,
      commonErrors,
      lastUsedAt,
      // Placeholder — `getStats()` populates this with the real
      // recommendation after this method returns.
      recommendation: {
        priority: "medium",
        expectedDurationMs: avgDuration,
        shouldRetry: false,
        maxRetries: 0,
        timeoutMs: 60_000,
        notes: "",
      },
    };
  }

  /**
   * Derive a scheduling recommendation from already-computed stats. This is
   * the bottom of the call chain — it does NOT call `getStats()` or
   * `computeStats()`, so it can be safely invoked from inside `getStats()`
   * without creating a circular dependency.
   */
  private recommendFromStats(stats: ToolStats): ToolSchedulingRecommendation {
    const priority: ToolSchedulingRecommendation["priority"] =
      stats.successRate > 0.9 ? "high" : stats.successRate > 0.7 ? "medium" : "low";

    const shouldRetry = stats.successRate < 0.8;
    const maxRetries =
      stats.successRate < 0.5 ? 3 : stats.successRate < 0.8 ? 2 : 1;

    // Timeout = 2x p95, with a 30s floor so very fast tools still get a
    // reasonable lower bound.
    const timeoutMs = Math.max(30_000, stats.p95DurationMs * 2);

    const notes: string[] = [];
    if (stats.successRate > 0.9) notes.push("Highly reliable");
    if (stats.successRate < 0.7)
      notes.push(
        `Low success rate (${(stats.successRate * 100).toFixed(0)}%) — consider alternatives`,
      );
    if (stats.avgDurationMs < 5000) notes.push("Fast execution");
    if (stats.avgDurationMs > 60_000) notes.push("Slow execution — allow extra time");
    if (stats.commonErrors.length > 0) {
      notes.push(`Common error: ${stats.commonErrors[0].errorType}`);
    }

    return {
      priority,
      expectedDurationMs: stats.avgDurationMs,
      shouldRetry,
      maxRetries,
      timeoutMs,
      notes: notes.join(". ") || "No specific notes",
    };
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
      this.loaded = true;
    }
  }

  /**
   * Load invocations from localStorage. No-op on the server (window is
   * undefined) — server-side collectors start empty and accumulate
   * invocations for the lifetime of the process.
   */
  private load(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as [string, ToolInvocation[]][];
        this.invocations = new Map(data);
      }
    } catch {
      // Corrupt or missing — start with a clean slate.
      this.invocations = new Map();
    }
  }

  /**
   * Persist invocations to localStorage. No-op on the server. Failures
   * (e.g. quota exceeded) are swallowed — the in-memory state is still
   * authoritative for the current session.
   */
  private persist(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([...this.invocations.entries()]),
      );
    } catch {
      // storage may be full — swallow.
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * The shared tool-intelligence singleton. Import this (NOT the class) from
 * anywhere in the engine or the API layer.
 *
 * On the SERVER (Next.js route handlers), the singleton is per-process —
 * every request sees the same accumulated state, but state is lost on
 * restart. On the CLIENT (Zustand store, debug UI), state persists across
 * page reloads via localStorage.
 */
export const toolIntelligence = new ToolIntelligence();
