// Observability — agent timelines, task execution history with durations,
// performance metrics, build metrics, token usage per agent and workflow,
// cost estimates per workflow, failure history with root cause.
// Stored in Build Memory; exposed via the Logs dialog (not in main UI).
//
// Token + cost timeline: every chargeTokens() call appends a timeline point
// { ts, agent, workflowId, tokens, cumulativeTokens, cumulativeCost } so the
// UI can render a per-workflow aggregate timeline and a per-agent breakdown.

import type { AgentRole, ObservabilityMetric, EngineEvent, WorkflowId } from "./types";

export interface TokenTimelinePoint {
  ts: number;
  agent: AgentRole;
  workflowId: WorkflowId;
  tokens: number;
  cumulativeTokens: number;
  cumulativeCost: number;
}

export interface WorkflowAggregate {
  workflowId: WorkflowId;
  totalTokens: number;
  totalCost: number;
  taskCount: number;
  failureCount: number;
  durationMs: number;
  startedAt: number;
  lastActivityAt: number;
}

const COST_PER_1K = 0; // real cost comes from provider config costPer1kInput

export class Observability {
  private taskHistory: { taskId: string; agent: AgentRole; stageId: string; durationMs: number; status: string; ts: number; workflowId: WorkflowId }[] = [];
  private tokenUsage = new Map<AgentRole, number>();
  private tokenTimeline: TokenTimelinePoint[] = [];
  private cumulativeTokens = 0;
  private cumulativeCost = 0;
  private failures: { taskId: string; agent: AgentRole; reason: string; ts: number; workflowId: WorkflowId }[] = [];
  private events: EngineEvent[] = [];
  private eventListeners = new Set<(e: EngineEvent) => void>();
  private workflowAggregates = new Map<WorkflowId, WorkflowAggregate>();

  recordEvent(e: EngineEvent): void {
    this.events.push(e);
    if (this.events.length > 1000) this.events.shift();
    this.eventListeners.forEach((fn) => fn(e));

    if (e.type === "task-succeeded" && e.taskId) {
      const wf = (e.workflowId ?? "new-project") as WorkflowId;
      this.taskHistory.push({
        taskId: e.taskId,
        agent: "orchestrator" as AgentRole,
        stageId: e.stageId ?? "",
        durationMs: 0,
        status: "succeeded",
        ts: e.ts,
        workflowId: wf,
      });
      this.bumpWorkflow(wf, e.ts, 1, 0);
    }
    if (e.type === "task-failed" && e.taskId) {
      const wf = (e.workflowId ?? "new-project") as WorkflowId;
      this.failures.push({ taskId: e.taskId, agent: "orchestrator" as AgentRole, reason: e.message, ts: e.ts, workflowId: wf });
      this.bumpWorkflow(wf, e.ts, 0, 1);
    }
  }

  /**
   * Charge tokens to an agent within a workflow. Appends a timeline point and
   * updates per-workflow + cumulative aggregates.
   */
  chargeTokens(agent: AgentRole, tokens: number, workflowId: WorkflowId = "new-project"): void {
    this.tokenUsage.set(agent, (this.tokenUsage.get(agent) ?? 0) + tokens);
    this.cumulativeTokens += tokens;
    this.cumulativeCost += (tokens / 1000) * COST_PER_1K;
    this.tokenTimeline.push({
      ts: Date.now(),
      agent,
      workflowId,
      tokens,
      cumulativeTokens: this.cumulativeTokens,
      cumulativeCost: this.cumulativeCost,
    });
    if (this.tokenTimeline.length > 500) this.tokenTimeline.shift();
    // aggregate
    const agg = this.workflowAggregates.get(workflowId) ?? this.emptyAggregate(workflowId);
    agg.totalTokens += tokens;
    agg.totalCost += (tokens / 1000) * COST_PER_1K;
    agg.lastActivityAt = Date.now();
    this.workflowAggregates.set(workflowId, agg);
  }

  private emptyAggregate(workflowId: WorkflowId): WorkflowAggregate {
    return {
      workflowId,
      totalTokens: 0,
      totalCost: 0,
      taskCount: 0,
      failureCount: 0,
      durationMs: 0,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    };
  }

  private bumpWorkflow(wf: WorkflowId, ts: number, tasks: number, failures: number): void {
    const agg = this.workflowAggregates.get(wf) ?? this.emptyAggregate(wf);
    agg.taskCount += tasks;
    agg.failureCount += failures;
    agg.lastActivityAt = ts;
    agg.durationMs = agg.lastActivityAt - agg.startedAt;
    this.workflowAggregates.set(wf, agg);
  }

  /** Per-agent metrics (tasks, tokens, cost, avg duration, failures). */
  metrics(): ObservabilityMetric[] {
    const byAgent = new Map<AgentRole, { tasks: number; tokens: number; failures: number; durations: number[] }>();
    for (const h of this.taskHistory) {
      const a = byAgent.get(h.agent) ?? { tasks: 0, tokens: 0, failures: 0, durations: [] };
      a.tasks++;
      a.durations.push(h.durationMs);
      byAgent.set(h.agent, a);
    }
    for (const [agent, tokens] of this.tokenUsage) {
      const a = byAgent.get(agent) ?? { tasks: 0, tokens: 0, failures: 0, durations: [] };
      a.tokens = tokens;
      byAgent.set(agent, a);
    }
    for (const f of this.failures) {
      const a = byAgent.get(f.agent) ?? { tasks: 0, tokens: 0, failures: 0, durations: [] };
      a.failures++;
      byAgent.set(f.agent, a);
    }
    return [...byAgent.entries()].map(([agent, a]) => ({
      agent,
      tasksCompleted: a.tasks,
      tokensUsed: a.tokens,
      costEstimate: (a.tokens / 1000) * COST_PER_1K,
      avgDurationMs: a.durations.length ? a.durations.reduce((s, d) => s + d, 0) / a.durations.length : 0,
      failures: a.failures,
    }));
  }

  /** Token + cost timeline (time-series), optionally filtered by workflow. */
  tokenTimeline_(workflowId?: WorkflowId): TokenTimelinePoint[] {
    const pts = workflowId ? this.tokenTimeline.filter((p) => p.workflowId === workflowId) : [...this.tokenTimeline];
    return pts;
  }

  /** Per-workflow aggregates (tokens, cost, tasks, failures, duration). */
  workflowAggregates_(): WorkflowAggregate[] {
    return [...this.workflowAggregates.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  /** Cumulative totals across all workflows. */
  totals(): { tokens: number; cost: number; tasks: number; failures: number } {
    return {
      tokens: this.cumulativeTokens,
      cost: this.cumulativeCost,
      tasks: this.taskHistory.length,
      failures: this.failures.length,
    };
  }

  events_(): EngineEvent[] {
    return [...this.events];
  }

  failuresList() {
    return [...this.failures];
  }

  subscribe(fn: (e: EngineEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  clear(): void {
    this.taskHistory = [];
    this.tokenUsage.clear();
    this.tokenTimeline = [];
    this.cumulativeTokens = 0;
    this.cumulativeCost = 0;
    this.failures = [];
    this.events = [];
    this.workflowAggregates.clear();
  }
}

export const observability = new Observability();
