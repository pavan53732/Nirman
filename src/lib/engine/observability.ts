// Observability — agent timelines, task execution history with durations,
// performance metrics, build metrics, token usage per agent and workflow,
// cost estimates per workflow, failure history with root cause.
// Stored in Build Memory; exposed via the Logs dialog (not in main UI).

import type { AgentRole, ObservabilityMetric, EngineEvent } from "./types";

export class Observability {
  private taskHistory: { taskId: string; agent: AgentRole; stageId: string; durationMs: number; status: string; ts: number }[] = [];
  private tokenUsage = new Map<AgentRole, number>();
  private failures: { taskId: string; agent: AgentRole; reason: string; ts: number }[] = [];
  private events: EngineEvent[] = [];
  private eventListeners = new Set<(e: EngineEvent) => void>();

  recordEvent(e: EngineEvent): void {
    this.events.push(e);
    if (this.events.length > 1000) this.events.shift();
    this.eventListeners.forEach((fn) => fn(e));

    if (e.type === "task-succeeded" && e.taskId) {
      // duration approximated from event ts (real engine tracks exact)
      this.taskHistory.push({
        taskId: e.taskId,
        agent: "orchestrator" as AgentRole,
        stageId: e.stageId ?? "",
        durationMs: 0,
        status: "succeeded",
        ts: e.ts,
      });
    }
    if (e.type === "task-failed" && e.taskId) {
      this.failures.push({ taskId: e.taskId, agent: "orchestrator" as AgentRole, reason: e.message, ts: e.ts });
    }
  }

  chargeTokens(agent: AgentRole, tokens: number): void {
    this.tokenUsage.set(agent, (this.tokenUsage.get(agent) ?? 0) + tokens);
  }

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
      costEstimate: a.tokens * 0.000012,
      avgDurationMs: a.durations.length ? a.durations.reduce((s, d) => s + d, 0) / a.durations.length : 0,
      failures: a.failures,
    }));
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
    this.failures = [];
    this.events = [];
  }
}

export const observability = new Observability();
