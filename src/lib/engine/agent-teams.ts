// Agent Teams — groups the existing flat agents into 6 specialized teams.
//
// Teams own specialists and coordinate within their domain:
//   - Planning Team:     requirements analysis, project planning, feature decomposition
//   - Architecture Team: system design, data modeling, technology selection
//   - Engineering Team:  code generation, build, tool execution
//   - Quality Team:      testing, review, verification, security
//   - Delivery Team:     packaging, deployment, documentation
//   - System Team:       infrastructure, monitoring, DevOps
//
// Teams are a GROUPING layer — they don't replace the flat agent registry.
// The Agent Runtime can dispatch tasks to a team (which routes to the right
// specialist) or directly to an agent.
//
// This module is ADDITIVE: `data/agents.ts` is unchanged, `agent-runtime.ts`
// is unchanged, `agent-handlers.ts` is unchanged. Wave 1C of the V2 migration.

import { agents } from "./data/agents";
import type { Agent, AgentRole, AgentLayer } from "./types";

export type TeamId =
  | "planning"
  | "architecture"
  | "engineering"
  | "quality"
  | "delivery"
  | "system";

export interface AgentTeam {
  id: TeamId;
  name: string;
  description: string;
  specialists: AgentRole[];
  /** The team's primary agent (used as the default routing target). */
  lead: AgentRole;
  /** The layer this team is most associated with (informational). */
  layer: AgentLayer;
}

export interface TeamRoutingResult {
  team: TeamId;
  assignedAgent: AgentRole;
  reason: string;
}

/**
 * Map every agent role to its team. This covers ALL 70 roles in
 * `data/agents.ts` — anything missing falls back to `inferTeamFromLayer`
 * (defensive; should never trigger for current agents).
 */
const AGENT_TO_TEAM: Partial<Record<AgentRole, TeamId>> = {
  // ---------------- Planning Team (5) ----------------
  planner: "planning",
  "project-manager": "planning",
  "requirements-analyst": "planning",
  "business-analyst": "planning",
  "domain-expert": "planning",

  // ---------------- Architecture Team (10) ----------------
  "solution-architect": "architecture",
  "decision-engine": "architecture",
  "software-architect": "architecture",
  "platform-architect": "architecture",
  "database-architect": "architecture",
  "api-architect": "architecture",
  "uiux-architect": "architecture",
  "security-architect": "architecture",
  "ai-architect": "architecture",
  "infrastructure-architect": "architecture",

  // ---------------- Engineering Team (10 core + 18 dynamic specialists = 28) ----------------
  "frontend-generator": "engineering",
  "desktop-generator": "engineering",
  "android-generator": "engineering",
  "backend-generator": "engineering",
  "database-generator": "engineering",
  "ai-generator": "engineering",
  "build-engineer": "engineering",
  "tool-manager": "engineering",
  "migration-agent": "engineering",
  "refactoring-agent": "engineering",

  // Dynamic specialists → engineering (they generate capability code)
  "auth-specialist": "engineering",
  "payments-specialist": "engineering",
  "notifications-specialist": "engineering",
  "email-specialist": "engineering",
  "ocr-specialist": "engineering",
  "pdf-specialist": "engineering",
  "reporting-specialist": "engineering",
  "charts-specialist": "engineering",
  "filesystem-specialist": "engineering",
  "bluetooth-specialist": "engineering",
  "camera-specialist": "engineering",
  "printing-specialist": "engineering",
  "barcode-specialist": "engineering",
  "localization-specialist": "engineering",
  "theme-specialist": "engineering",
  "offline-sync-specialist": "engineering",
  "search-specialist": "engineering",
  "background-service-specialist": "engineering",

  // ---------------- Quality Team (11) ----------------
  "test-generator": "quality",
  "code-reviewer": "quality",
  "static-analyzer": "quality",
  "security-auditor": "quality",
  "dependency-auditor": "quality",
  "performance-optimizer": "quality",
  "memory-optimizer": "quality",
  "accessibility-auditor": "quality",
  "unit-test-agent": "quality",
  "integration-test-agent": "quality",
  "ui-test-agent": "quality",

  // ---------------- Delivery Team (5) ----------------
  "packaging-engineer": "delivery",
  "documentation-writer": "delivery",
  "release-engineer": "delivery",
  "export-manager": "delivery",
  "installer-specialist": "delivery",

  // ---------------- System Team (11) ----------------
  orchestrator: "system",
  "context-builder": "system",
  "project-memory-manager": "system",
  "knowledge-base-manager": "system",
  "artifact-manager": "system",
  "skill-manager": "system",
  "provider-manager": "system",
  "model-router": "system",
  "cost-optimizer": "system",
  "token-budget-manager": "system",
  "cache-manager": "system",
};

const TEAM_DEFINITIONS: Record<
  TeamId,
  Omit<AgentTeam, "specialists">
> = {
  planning: {
    id: "planning",
    name: "Planning Team",
    description: "Requirements analysis, project planning, feature decomposition",
    lead: "planner",
    layer: "executive",
  },
  architecture: {
    id: "architecture",
    name: "Architecture Team",
    description: "System design, data modeling, technology selection",
    lead: "solution-architect",
    layer: "architecture",
  },
  engineering: {
    id: "engineering",
    name: "Engineering Team",
    description: "Code generation, build, tool execution",
    lead: "frontend-generator",
    layer: "engineering",
  },
  quality: {
    id: "quality",
    name: "Quality Team",
    description: "Testing, review, verification, security",
    lead: "test-generator",
    layer: "quality",
  },
  delivery: {
    id: "delivery",
    name: "Delivery Team",
    description: "Packaging, deployment, documentation",
    lead: "packaging-engineer",
    layer: "quality",
  },
  system: {
    id: "system",
    name: "System Team",
    description: "Infrastructure, monitoring, DevOps",
    lead: "orchestrator",
    layer: "executive",
  },
};

/**
 * Registry of agent teams. Built once at module load by reading the flat
 * `agents` array and bucketing each agent into its team via `AGENT_TO_TEAM`.
 */
export class AgentTeamRegistry {
  private teams = new Map<TeamId, AgentTeam>();
  private agentToTeam = new Map<string, TeamId>();

  constructor() {
    this.buildTeams();
  }

  private buildTeams(): void {
    // 1) Assign every agent in the flat registry to a team.
    for (const agent of agents) {
      const teamId =
        AGENT_TO_TEAM[agent.role] ?? this.inferTeamFromLayer(agent.layer);
      this.agentToTeam.set(agent.role, teamId);
    }

    // 2) Build each team object with its specialist list (in registry order).
    for (const [teamId, def] of Object.entries(TEAM_DEFINITIONS) as [
      TeamId,
      (typeof TEAM_DEFINITIONS)[TeamId],
    ][]) {
      const specialists = agents
        .filter((a) => this.agentToTeam.get(a.role) === teamId)
        .map((a) => a.role);
      this.teams.set(teamId, { ...def, specialists });
    }
  }

  /** Fallback for unmapped roles — derives a team from the agent's layer. */
  private inferTeamFromLayer(layer: AgentLayer): TeamId {
    switch (layer) {
      case "executive":
        return "planning";
      case "architecture":
        return "architecture";
      case "engineering":
        return "engineering";
      case "quality":
        return "quality";
      case "cross-cutting":
        return "system";
      case "dynamic":
        return "engineering";
      default:
        return "system";
    }
  }

  /** Get a team by ID. */
  get(teamId: TeamId): AgentTeam | undefined {
    return this.teams.get(teamId);
  }

  /** Get all teams. */
  all(): AgentTeam[] {
    return [...this.teams.values()];
  }

  /** Get the team for a given agent role. */
  teamForAgent(role: string): TeamId | undefined {
    return this.agentToTeam.get(role);
  }

  /** Get the specialists in a team. */
  specialists(teamId: TeamId): AgentRole[] {
    return this.teams.get(teamId)?.specialists ?? [];
  }

  /**
   * Route a task to the appropriate team + agent.
   *
   * Strategy:
   *   1. If a preferred agent is specified and known → use its team.
   *   2. Otherwise infer the team from the task description via keyword
   *      matching, and assign the team's lead as the default specialist.
   *
   * Returns the team ID + assigned agent + human-readable reason.
   */
  route(taskDescription: string, preferredAgent?: string): TeamRoutingResult {
    // (1) Preferred agent wins if it exists in the registry mapping.
    if (preferredAgent) {
      const team = this.agentToTeam.get(preferredAgent);
      if (team) {
        return {
          team,
          assignedAgent: preferredAgent as AgentRole,
          reason: `Routed to ${team} team via preferred agent`,
        };
      }
    }

    // (2) Infer team from task description keywords.
    const desc = taskDescription.toLowerCase();
    let team: TeamId;
    if (/plan|requirement|feature|decompose|scope|milestone/.test(desc)) {
      team = "planning";
    } else if (/architect|design|model|schema|pattern|data-model/.test(desc)) {
      team = "architecture";
    } else if (/generat|build|code|implement|tool|frontend|backend|api|database/.test(desc)) {
      team = "engineering";
    } else if (/test|review|verif|secur|quality|audit|lint/.test(desc)) {
      team = "quality";
    } else if (/packag|deploy|release|document|export|install/.test(desc)) {
      team = "delivery";
    } else {
      team = "system";
    }

    const teamDef = this.teams.get(team)!;
    return {
      team,
      assignedAgent: teamDef.lead,
      reason: `Routed to ${team} team based on task description (lead: ${teamDef.lead})`,
    };
  }

  /** Get a summary suitable for JSON debug endpoints. */
  getSummary() {
    return this.all().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      lead: t.lead,
      layer: t.layer,
      specialistCount: t.specialists.length,
      specialists: t.specialists,
    }));
  }
}

/** Singleton instance — built once at module load. */
export const agentTeamRegistry = new AgentTeamRegistry();
