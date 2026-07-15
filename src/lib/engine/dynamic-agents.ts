// DynamicAgentRegistry — manages the lifecycle of runtime-spawned sub-agents.
//
// DESIGN (per architectural review):
//   "Dynamic Sub-agents: This is still one of the biggest missing pieces.
//    For example: User requests Authentication → Spawn Authentication
//    Specialist → Finishes → Destroyed."
//
// Unlike the 8 static agents in data/agents.ts (which are always registered),
// dynamic agents are created ON DEMAND when a capability requires a specialist,
// and DESTROYED when their work is done. This prevents agent bloat and models
// the real-world pattern of bringing in a specialist for a specific task.
//
// Spawn triggers (capability → specialist role):
//   "auth"          → "authentication-specialist"
//   "payments"      → "payments-specialist"
//   "realtime"      → "realtime-specialist"
//   "offline-sync"  → "offline-sync-specialist"
//   "encryption"    → "security-specialist"
//   "pdf"           → "document-specialist"
//   "notifications" → "notifications-specialist"
//   "gpu"           → "gpu-specialist"
//
// The registry is intentionally a separate store from the static `agents`
// array in data/agents.ts — the two registries compose (static + dynamic)
// rather than compete. Callers that want a unified view should merge
// `dynamicAgentRegistry.listActive()` with the static `agents` array.

import type {
  AgentExecutionResult,
  AgentExecutionContext,
  AgentHandler,
  DynamicAgent,
  SubAgentSpec,
} from "./agent-contracts";
import type { Capability } from "./types";

/** Display labels for dynamic specialist roles (mirrors the static `name` field). */
const SPECIALIST_LABELS: Record<string, string> = {
  "authentication-specialist": "Sentinel",
  "payments-specialist": "Mint",
  "realtime-specialist": "Pulse",
  "offline-sync-specialist": "Sync",
  "security-specialist": "Aegis",
  "document-specialist": "Quill",
  "notifications-specialist": "Herald",
  "gpu-specialist": "Render",
};

/** Maps a detected capability to the dynamic specialist role to spawn. */
export const CAPABILITY_TO_SPECIALIST: Partial<Record<Capability, string>> = {
  auth: "authentication-specialist",
  payments: "payments-specialist",
  realtime: "realtime-specialist",
  "offline-sync": "offline-sync-specialist",
  encryption: "security-specialist",
  pdf: "document-specialist",
  notifications: "notifications-specialist",
  gpu: "gpu-specialist",
};

/**
 * Determine which dynamic sub-agents should be spawned for a given set of
 * capabilities. Returns the roles to spawn (e.g., ["authentication-specialist"]
 * if "auth" is present).
 *
 * Pure function — same capabilities in always produce the same roles out. This
 * makes it trivially testable and lets the orchestrator plan spawns before
 * actually materializing them.
 */
export function planDynamicSpawns(capabilities: Capability[]): string[] {
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const cap of capabilities) {
    const role = CAPABILITY_TO_SPECIALIST[cap];
    if (role && !seen.has(role)) {
      seen.add(role);
      roles.push(role);
    }
  }
  return roles;
}

/**
 * Build a handler for a dynamic specialist agent. The handler receives the
 * objective and context, and produces a specialist report.
 *
 * In production this would call a generator (e.g., the auth specialist would
 * emit OAuth/OIDC scaffolding). For now we return a structured recommendation
 * report plus memory + shared-context writes — enough to prove the lifecycle
 * (spawn → execute → memory write → destroy) end-to-end.
 */
export function makeSpecialistHandler(role: string): AgentHandler {
  return async (ctx) => {
    const objective =
      (ctx as unknown as { objective?: string }).objective ??
      "assist parent agent";
    const report =
      `[${role}] Specialist report for: ${ctx.task.title}\n` +
      `Objective: ${objective}\n` +
      `Recommendation: Implement ${role.replace("-specialist", "")} ` +
      `using industry-standard patterns.`;
    return {
      status: "success",
      output: report,
      memoryWrites: [
        {
          kind: "architecture" as const,
          title: `${role} report`,
          content: report,
          source: role,
        },
      ],
      sharedWrites: [{ key: `specialist:${role}`, value: report }],
    };
  };
}

/**
 * DynamicAgentRegistry — the lifecycle manager for runtime-spawned sub-agents.
 *
 * Lifecycle:
 *   1. `spawn(role, spec, handler)` materializes a DynamicAgent with a unique
 *      id (`dynamic-<n>-<role>`), records `spawnedAt`, and sets `status="active"`.
 *   2. `executeAndDestroy(id, buildCtx)` runs the agent's handler with a
 *      context built by `buildCtx`, captures the result, then destroys the
 *      agent regardless of success/failure (try/finally).
 *   3. `destroy(id)` marks the agent `destroyedAt` and flips `status` to
 *      "completed" (or "failed" if execution threw). The record is RETAINED
 *      for lineage auditing — `clear()` purges everything for a fresh build.
 */
export class DynamicAgentRegistry {
  private agents = new Map<string, DynamicAgent>();
  private spawnCount = 0;
  private destroyCount = 0;

  /** Spawn a new dynamic sub-agent. Returns the agent. */
  spawn(role: string, spec: SubAgentSpec, handler: AgentHandler): DynamicAgent {
    const id = `dynamic-${++this.spawnCount}-${role}`;
    const agent: DynamicAgent = {
      id,
      role,
      label: SPECIALIST_LABELS[role] ?? role,
      parentAgentId: spec.parentAgentId,
      spawnedAt: Date.now(),
      destroyedAt: null,
      handler,
      objective: spec.objective,
      status: "active",
    };
    this.agents.set(id, agent);
    return agent;
  }

  /** Destroy a dynamic agent after its work is done. No-op if already destroyed. */
  destroy(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent && agent.destroyedAt === null) {
      agent.destroyedAt = Date.now();
      // Preserve a "failed" status set by executeAndDestroy; otherwise mark completed.
      if (agent.status !== "failed") {
        agent.status = "completed";
      }
      this.destroyCount++;
    }
  }

  /** Get a dynamic agent by ID (active or destroyed). */
  get(agentId: string): DynamicAgent | undefined {
    return this.agents.get(agentId);
  }

  /** List all dynamic agents (active + destroyed). */
  list(): DynamicAgent[] {
    return [...this.agents.values()];
  }

  /** List only active (not destroyed) agents. */
  listActive(): DynamicAgent[] {
    return [...this.agents.values()].filter((a) => a.destroyedAt === null);
  }

  /**
   * Execute a dynamic agent's handler, then destroy it. The handler runs with
   * a context built by `buildCtx` (so callers can wire in real memory, skills,
   * shared context, etc.). The agent is ALWAYS destroyed — even on failure —
   * via try/finally, so no agent ever leaks past its execution.
   */
  async executeAndDestroy(
    agentId: string,
    buildCtx: () => Promise<AgentExecutionContext>
  ): Promise<AgentExecutionResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return { status: "failure", error: `Dynamic agent not found: ${agentId}` };
    }
    try {
      const ctx = await buildCtx();
      // Surface the agent's objective on the context so the handler can read it
      // (AgentExecutionContext doesn't carry `objective` natively — SubAgentSpec does).
      (ctx as unknown as { objective?: string }).objective = agent.objective;
      const result = await agent.handler(ctx);
      agent.status = result.status === "success" ? "completed" : "failed";
      return result;
    } catch (err) {
      agent.status = "failed";
      return { status: "failure", error: String(err) };
    } finally {
      this.destroy(agentId);
    }
  }

  /** Summary for debugging / the `/api/debug/dynamic-agents` endpoint. */
  getSummary() {
    const all = this.list();
    return {
      totalSpawned: this.spawnCount,
      totalDestroyed: this.destroyCount,
      currentlyActive: all.filter((a) => a.destroyedAt === null).length,
      agents: all.map((a) => ({
        id: a.id,
        role: a.role,
        label: a.label,
        parent: a.parentAgentId,
        objective: a.objective,
        spawnedAt: a.spawnedAt,
        destroyedAt: a.destroyedAt,
        status: a.status,
      })),
    };
  }

  /** Clear all dynamic agents (for a fresh build). Resets counters too. */
  clear(): void {
    this.agents.clear();
    this.spawnCount = 0;
    this.destroyCount = 0;
  }
}

/** Process-wide singleton registry. Mirrors the pattern of other engine modules. */
export const dynamicAgentRegistry = new DynamicAgentRegistry();
