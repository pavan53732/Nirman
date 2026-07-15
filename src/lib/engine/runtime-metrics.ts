// Runtime Metrics — collects diagnostics for optimization.
//
// (Runtime V2 Audit, Phase 3 Step 13: "Add runtime metrics to Observability —
// utilization, latency, cache".)
//
// Metrics are collected PASSIVELY (via explicit `record*()` calls from
// subsystems) and exposed via the `/api/debug/metrics` endpoint for
// diagnostics. They answer questions like:
//   - Which agents were busy during this build, and for how long?
//   - How many tasks ran in parallel? Was parallelism actually achieved?
//   - What was the latency distribution per stage (p50/p95)?
//   - How long did the build take end-to-end?
//   - What's the current heap/RSS usage of the runtime?
//   - How many tokens did each agent consume?
//   - What's the cache hit rate?
//   - How long do workspace-graph queries take, by type?
//   - How often does verification retry (a proxy for self-heal quality)?
//
// This module is ADDITIVE — it does NOT modify observability.ts. The existing
// `observability` singleton continues to be the source of record for events,
// task history, token usage timeline, and workflow aggregates. Runtime
// Metrics is a SEPARATE collector focused on AGGREGATE diagnostics (latency
// percentiles, parallelism ratios, utilization percentages) that are awkward
// to derive from the raw event stream on every request.
//
// Backward compatibility: this module exports a new class
// (`RuntimeMetricsCollector`) + a singleton (`runtimeMetrics`). Nothing in
// the existing engine is modified — orchestrator.ts, execution-engine.ts,
// agent-runtime.ts, verification-loop.ts are all UNTOUCHED. Subsystems that
// want to feed metrics into the collector do so via `runtimeMetrics.record*`
// (and the /api/debug/metrics endpoint is the only consumer today; the
// endpoint's POST handler is the demonstration that the recording path works).
//
// Once a future wave wires `runtimeMetrics.recordTaskStart/Complete` into
// execution-engine.ts (Task lifecycle), `runtimeMetrics.recordBuildStart/End`
// into the orchestrator (build lifecycle), `runtimeMetrics.recordGraphQuery`
// into workspace-intelligence.ts, `runtimeMetrics.recordVerification` into
// verification-loop.ts, and `runtimeMetrics.recordTokens` into the LLM call
// path, the metrics will be populated AUTOMATICALLY on every build. Until
// then, they're populated via explicit calls from the debug endpoint and any
// other ad-hoc caller — the collector itself is fully functional today.

// ---------------------------------------------------------------------------
// Metric record shapes (one per category)
// ---------------------------------------------------------------------------

export interface AgentUtilizationMetric {
  agent: string;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksFailed: number;
  avgDurationMs: number;
  totalDurationMs: number;
  /** % of total build time this agent was active (sum of task durations / build latency). */
  utilizationPercent: number;
}

export interface ParallelismMetric {
  maxConcurrentTasks: number;
  avgConcurrentTasks: number;
  parallelBatches: number;
  totalTasks: number;
  /** maxConcurrent / totalTasks — 1.0 means everything ran in parallel, 0.0 means fully serial. */
  parallelismRatio: number;
}

export interface LatencyMetric {
  stage: string;
  count: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  /** Median (50th percentile). */
  p50Ms: number;
  /** 95th percentile — the "slow tail" of the distribution. */
  p95Ms: number;
}

export interface CacheMetric {
  hits: number;
  misses: number;
  hitRate: number;
  totalRequests: number;
}

export interface GraphQueryMetric {
  queryType: string;
  count: number;
  avgLatencyMs: number;
  totalLatencyMs: number;
}

export interface RuntimeMetrics {
  collectedAt: number;
  buildLatencyMs: number;
  agentUtilization: AgentUtilizationMetric[];
  parallelism: ParallelismMetric;
  taskLatency: LatencyMetric[];
  memoryUsage: { heapUsedMB: number; heapTotalMB: number; rssMB: number };
  contextSize: { agent: string; estimatedTokens: number }[];
  tokenUsage: { totalTokens: number; byAgent: Record<string, number> };
  cacheHitRate: CacheMetric;
  graphQueryLatency: GraphQueryMetric[];
  verificationRetries: {
    totalVerifications: number;
    totalRetries: number;
    avgRetries: number;
    maxRetries: number;
  };
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

interface AgentStat {
  tasks: number;
  completed: number;
  failed: number;
  durations: number[];
}

interface GraphQueryStat {
  count: number;
  totalLatency: number;
}

interface VerificationStat {
  total: number;
  retries: number;
  maxRetries: number;
}

/**
 * RuntimeMetricsCollector — accumulates raw events into aggregate metrics.
 *
 * The collector is intentionally simple: a handful of Maps and counters,
 * mutated by `record*()` methods, summarized by `getMetrics()`. There's no
 * async, no I/O, no persistence — the metrics live in-memory for the
 * lifetime of the process (server: per-route-handler invocation; client:
 * per page session). If you want durable metrics, snapshot `getMetrics()`
 * to disk/IDB at build end (a future wave can add that).
 *
 * Thread-safety: JavaScript is single-threaded, so the Maps are safe. The
 * `currentConcurrent` counter is updated non-atomically (read-modify-write)
 * but that's fine — there are no interleavings.
 */
export class RuntimeMetricsCollector {
  private agentStats = new Map<string, AgentStat>();
  private taskLatencies = new Map<string, number[]>(); // stage → durations
  private graphQueries = new Map<string, GraphQueryStat>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private tokenByAgent = new Map<string, number>();
  private buildStartTime: number | null = null;
  private buildEndTime: number | null = null;
  private maxConcurrent = 0;
  private currentConcurrent = 0;
  private parallelBatches = 0;
  private totalTasks = 0;
  private verificationStats: VerificationStat = { total: 0, retries: 0, maxRetries: 0 };

  // -------------------------------------------------------------------------
  // Recording API (called by subsystems)
  // -------------------------------------------------------------------------

  /** Record a task start. Bumps concurrent counters + agent task count. */
  recordTaskStart(agent: string): void {
    this.totalTasks++;
    this.currentConcurrent++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.currentConcurrent);
    const stats = this.agentStats.get(agent) ?? { tasks: 0, completed: 0, failed: 0, durations: [] };
    stats.tasks++;
    this.agentStats.set(agent, stats);
  }

  /**
   * Record a task completion.
   *
   * @param agent      The agent role that ran the task.
   * @param durationMs Wall-clock duration (start→finish).
   * @param success    true if the task succeeded, false if it failed.
   * @param stage      The stageId (or other stage label) for latency bucketing.
   */
  recordTaskComplete(agent: string, durationMs: number, success: boolean, stage: string): void {
    this.currentConcurrent = Math.max(0, this.currentConcurrent - 1);
    const stats = this.agentStats.get(agent);
    if (stats) {
      if (success) stats.completed++;
      else stats.failed++;
      stats.durations.push(durationMs);
    }
    const latencies = this.taskLatencies.get(stage) ?? [];
    latencies.push(durationMs);
    this.taskLatencies.set(stage, latencies);
  }

  /** Record a build start. Sets the start timestamp; clears any prior end. */
  recordBuildStart(): void {
    this.buildStartTime = Date.now();
    this.buildEndTime = null;
  }

  /** Record a build end. Sets the end timestamp. */
  recordBuildEnd(): void {
    this.buildEndTime = Date.now();
  }

  /** Record a workspace-graph query (semantic search, impact analysis, etc.). */
  recordGraphQuery(queryType: string, latencyMs: number): void {
    const stats = this.graphQueries.get(queryType) ?? { count: 0, totalLatency: 0 };
    stats.count++;
    stats.totalLatency += latencyMs;
    this.graphQueries.set(queryType, stats);
  }

  /** Record a cache hit. */
  recordCacheHit(): void {
    this.cacheHits++;
  }

  /** Record a cache miss. */
  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /** Record token usage by an agent. */
  recordTokens(agent: string, tokens: number): void {
    this.tokenByAgent.set(agent, (this.tokenByAgent.get(agent) ?? 0) + tokens);
  }

  /** Record that a parallel batch was dispatched (incremental counter). */
  recordParallelBatch(): void {
    this.parallelBatches++;
  }

  /**
   * Record verification stats for a single verification round.
   *
   * @param retries The number of fix-retries that were needed before this
   *                verification passed (0 = passed on first try).
   */
  recordVerification(retries: number): void {
    this.verificationStats.total++;
    this.verificationStats.retries += retries;
    this.verificationStats.maxRetries = Math.max(this.verificationStats.maxRetries, retries);
  }

  // -------------------------------------------------------------------------
  // Snapshot API
  // -------------------------------------------------------------------------

  /** Compute the full metrics snapshot (a deep copy — caller can mutate freely). */
  getMetrics(): RuntimeMetrics {
    const buildLatencyMs =
      this.buildStartTime && this.buildEndTime ? this.buildEndTime - this.buildStartTime : 0;

    const agentUtilization: AgentUtilizationMetric[] = [...this.agentStats.entries()].map(
      ([agent, stats]) => {
        const avgDuration =
          stats.durations.length > 0
            ? stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length
            : 0;
        const totalDuration = stats.durations.reduce((a, b) => a + b, 0);
        return {
          agent,
          tasksAssigned: stats.tasks,
          tasksCompleted: stats.completed,
          tasksFailed: stats.failed,
          avgDurationMs: avgDuration,
          totalDurationMs: totalDuration,
          utilizationPercent: buildLatencyMs > 0 ? (totalDuration / buildLatencyMs) * 100 : 0,
        };
      }
    );

    const taskLatency: LatencyMetric[] = [...this.taskLatencies.entries()].map(([stage, durations]) => {
      const sorted = [...durations].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      const count = sorted.length;
      return {
        stage,
        count,
        avgMs: count > 0 ? sum / count : 0,
        minMs: sorted[0] ?? 0,
        maxMs: sorted[count - 1] ?? 0,
        // Percentile lookup: index = floor(count * p). For very small samples
        // (count < 20) this collapses to either min or max, which is fine —
        // the p95 of a 1-sample distribution is just that sample.
        p50Ms: sorted[Math.floor(count * 0.5)] ?? 0,
        p95Ms: sorted[Math.floor(count * 0.95)] ?? 0,
      };
    });

    const graphQueryLatency: GraphQueryMetric[] = [...this.graphQueries.entries()].map(
      ([queryType, stats]) => ({
        queryType,
        count: stats.count,
        avgLatencyMs: stats.count > 0 ? stats.totalLatency / stats.count : 0,
        totalLatencyMs: stats.totalLatency,
      })
    );

    const mem =
      typeof process !== "undefined" && typeof process.memoryUsage === "function"
        ? process.memoryUsage()
        : { heapUsed: 0, heapTotal: 0, rss: 0 };

    const totalRequests = this.cacheHits + this.cacheMisses;

    return {
      collectedAt: Date.now(),
      buildLatencyMs,
      agentUtilization,
      parallelism: {
        maxConcurrentTasks: this.maxConcurrent,
        avgConcurrentTasks: this.totalTasks > 0 ? this.maxConcurrent / this.totalTasks : 0,
        parallelBatches: this.parallelBatches,
        totalTasks: this.totalTasks,
        parallelismRatio: this.totalTasks > 0 ? this.maxConcurrent / this.totalTasks : 0,
      },
      taskLatency,
      memoryUsage: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
      },
      // contextSize would be populated by the UnifiedContextBuilder if it
      // recorded per-agent token estimates during the build. Today it stays
      // empty — a future wave can wire `runtimeMetrics.recordContextSize(agent, tokens)`.
      contextSize: [],
      tokenUsage: {
        totalTokens: [...this.tokenByAgent.values()].reduce((a, b) => a + b, 0),
        byAgent: Object.fromEntries(this.tokenByAgent),
      },
      cacheHitRate: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: totalRequests > 0 ? this.cacheHits / totalRequests : 0,
        totalRequests,
      },
      graphQueryLatency,
      verificationRetries: {
        totalVerifications: this.verificationStats.total,
        totalRetries: this.verificationStats.retries,
        avgRetries:
          this.verificationStats.total > 0
            ? this.verificationStats.retries / this.verificationStats.total
            : 0,
        maxRetries: this.verificationStats.maxRetries,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Reset all metrics (call before a fresh build so the snapshot is clean). */
  reset(): void {
    this.agentStats.clear();
    this.taskLatencies.clear();
    this.graphQueries.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.tokenByAgent.clear();
    this.buildStartTime = null;
    this.buildEndTime = null;
    this.maxConcurrent = 0;
    this.currentConcurrent = 0;
    this.parallelBatches = 0;
    this.totalTasks = 0;
    this.verificationStats = { total: 0, retries: 0, maxRetries: 0 };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * The shared runtime-metrics singleton. Import this (NOT the class) from
 * anywhere in the engine or the API layer.
 *
 * On the SERVER (Next.js route handlers), the singleton is per-process —
 * every request sees the same accumulated metrics. On the CLIENT (Zustand
 * store, debug UI), it's per-page-session.
 */
export const runtimeMetrics = new RuntimeMetricsCollector();
