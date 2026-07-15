// UnifiedContextBuilder — assembles a MINIMAL, complete context bundle per
// agent. Every agent receives ONLY what it needs — no more, no less.
//
// BACKGROUND (per architectural review):
//   The reviewer said: "Unified context builder: Whether it stays as
//   shared-context.ts or becomes a dedicated context builder, make sure every
//   agent receives only the information it needs."
//
//   Before this module existed, the context for an agent was assembled in
//   pieces by separate subsystems:
//     - memories.ts          → memory slices (ContextBuilder.buildRichContext)
//     - skill-injector.ts    → skills (injectSkills)
//     - shared-context.ts    → the blackboard
//     - workspace-intelligence.ts (Task P) → file/symbol graph queries
//
//   Nothing UNIFIED these into a single, minimal context bundle per agent.
//   This module is that unifier. Given an agent role + task, it pulls each of
//   those four slices and returns ONE bundle the runtime can hand to the
//   agent handler.
//
// MINIMALITY CONTRACT:
//   The "reads" and "queries" maps below are the DECLARED dependencies of each
//   agent. They are the contract that makes the context minimal and auditable:
//     - AGENT_SHARED_KEYS  : which SharedContext keys each agent reads
//     - AGENT_GRAPH_QUERIES: which workspace graph queries each agent needs
//
//   Memory and skills are already role-filtered by ContextBuilder and
//   SkillInjector respectively, so we delegate to them unchanged. The new
//   minimality work happens in the SharedContext + graph slices: instead of
//   handing the agent the whole blackboard (which is what
//   AgentExecutionContext.shared does today), we hand it ONLY the keys it
//   declared.
//
// IMPORT-SAFETY (Task P dependency):
//   workspace-intelligence.ts is owned by Task P and may not exist yet. To
//   keep this module import-safe whether or not Task P has landed, the graph
//   queries access `require` via `globalThis` (cast to bypass TypeScript's
//   static module resolution). If the module is absent, every graph query
//   gracefully returns `{ error: "workspace-intelligence not available" }`.
//   When Task P lands, no change is required here — the runtime require will
//   start resolving and the queries will return real data.

import type { SkillContent } from "./agent-contracts";
import type { Capability, MemoryRecord, PlatformKind, Task } from "./types";
import { contextBuilder } from "./memories";
import { injectSkills } from "./skill-injector";
import { sharedContext } from "./shared-context";

/**
 * Which SharedContext keys does each agent read?
 *
 * This is the minimality contract for the blackboard slice. Agents not listed
 * here (or with an empty array) receive NO shared context — they read only
 * their memory slice + skills. This is intentional: gate-keeping agents
 * (orchestrator) and prompt-only agents (requirements-analyst, planner) don't
 * need to see what other agents have written.
 *
 * The keys correspond to the SharedContext naming convention documented in
 * shared-context.ts ("plan", "architecture", "code:<target>", "build:<target>",
 * "tests:<target>", etc.).
 */
const AGENT_SHARED_KEYS: Record<string, string[]> = {
  "requirements-analyst": [], // reads only prompt
  planner: [], // reads only prompt + memory
  "solution-architect": ["plan", "requirements"], // reads the plan
  "frontend-generator": ["architecture", "plan"], // reads architecture to generate code
  "build-engineer": ["code:web", "code:windows", "code:android"], // reads generated code
  "test-generator": ["code:web", "code:windows", "code:android", "architecture"], // reads code to test
  "packaging-engineer": ["build:web", "build:windows", "build:android", "tests:web"], // reads build+test results
  "code-reviewer": ["code:web", "code:windows", "code:android", "architecture"], // reads code to review
  orchestrator: [], // gate tasks need nothing
};

/**
 * Which workspace graph queries does each agent need?
 *
 * Query spec format:  "<type>:<key>=<value>"
 *   - "symbols:kind=model"      → all symbols of kind "model"
 *   - "symbols:kind=endpoint"   → all symbols of kind "endpoint"
 *   - "dependents:symbol=Contact" → everything that depends on the "Contact" symbol
 *
 * Queries are delegated to workspace-intelligence (Task P). When that module
 * isn't available (Task P hasn't landed), the query gracefully returns an
 * "unavailable" marker — the agent still receives its other slices.
 */
const AGENT_GRAPH_QUERIES: Record<string, string[]> = {
  "requirements-analyst": [],
  planner: [],
  "solution-architect": [],
  "frontend-generator": ["symbols:kind=model"], // needs to know the data model
  "build-engineer": ["dependents:symbol=Contact"], // needs to know what depends on the model
  "test-generator": ["symbols:kind=endpoint"], // needs to know API endpoints to test
  "packaging-engineer": [],
  "code-reviewer": ["symbols:kind=function", "symbols:kind=class"], // reviews functions + classes
  orchestrator: [],
};

/**
 * The output of UnifiedContextBuilder.build() — a single, minimal, complete
 * context bundle for an agent. The agent handler receives this (or a
 * derivative of it packed into AgentExecutionContext) and nothing else.
 */
export interface UnifiedContext {
  /** The agent role this context was built for. */
  agent: string;
  /** Memory slice (role-filtered via ContextBuilder.buildRichContext). */
  memory: MemoryRecord[];
  /** Skill files (platform + capability filtered via injectSkills). */
  skills: SkillContent[];
  /**
   * SharedContext slice — only the keys this agent declared in
   * AGENT_SHARED_KEYS. Agents that declared no keys get an empty object.
   */
  sharedContextSlice: Record<string, unknown>;
  /**
   * Workspace graph query results — only the queries this agent declared in
   * AGENT_GRAPH_QUERIES. Each key is the query spec; the value is the result
   * (or an `{ error: ... }` marker if the graph isn't available).
   */
  graphQueries: Record<string, unknown>;
  /** Total estimated token count for this context (for budget tracking). */
  estimatedTokens: number;
  /** Human-readable multi-line summary of what was included (for logs / trace UI). */
  summary: string;
}

/**
 * UnifiedContextBuilder — the single entry point that assembles a per-agent
 * context bundle from all four context sources (memory, skills, shared
 * context, workspace graph).
 *
 * Usage:
 *   const ctx = unifiedContextBuilder.build("frontend-generator", {
 *     prompt: "CRM app",
 *     platform: "web",
 *     capabilities: ["auth"],
 *   });
 *   // ctx.memory            → MemoryRecord[]
 *   // ctx.skills            → SkillContent[]
 *   // ctx.sharedContextSlice → { architecture, plan }
 *   // ctx.graphQueries      → { "symbols:kind=model": [...] }
 *   // ctx.estimatedTokens   → number
 *
 * Singleton instance exported as `unifiedContextBuilder`.
 */
export class UnifiedContextBuilder {
  /**
   * Build a minimal, complete context bundle for an agent.
   *
   * The agent receives EXACTLY what it needs — nothing more. The minimality
   * contract is enforced by AGENT_SHARED_KEYS and AGENT_GRAPH_QUERIES above;
   * memory and skills are already filtered by their respective builders.
   */
  build(
    agent: string,
    opts: {
      task?: Task;
      prompt: string;
      platform?: PlatformKind;
      capabilities?: Capability[];
    }
  ): UnifiedContext {
    // 1. Memory slice (role-filtered via ContextBuilder.defaultKindsFor)
    const memoryBundle = contextBuilder.buildRichContext(agent, { prompt: opts.prompt });
    const memory = memoryBundle.memorySlice;

    // 2. Skills (platform + capability filtered via SkillInjector)
    const skills = injectSkills(agent, {
      platform: opts.platform,
      capabilities: opts.capabilities ?? [],
    });

    // 3. SharedContext slice (ONLY the declared keys for this agent)
    const sharedKeys = AGENT_SHARED_KEYS[agent] ?? [];
    const sharedContextSlice: Record<string, unknown> = {};
    for (const key of sharedKeys) {
      if (sharedContext.has(key)) {
        sharedContextSlice[key] = sharedContext.read(key);
      }
    }

    // 4. Workspace graph queries (ONLY the declared queries for this agent)
    const graphQueries: Record<string, unknown> = {};
    const querySpecs = AGENT_GRAPH_QUERIES[agent] ?? [];
    for (const spec of querySpecs) {
      graphQueries[spec] = this.executeGraphQuery(spec);
    }

    // 5. Estimate tokens (rough heuristic: 4 chars ≈ 1 token). This is for
    //    budget tracking and debug visibility only — real token counts come
    //    from the z-ai SDK usage response after the LLM call.
    const memoryChars = memory.reduce((n, r) => n + r.content.length, 0);
    const skillChars = skills.reduce((n, s) => n + s.content.length, 0);
    const sharedChars = JSON.stringify(sharedContextSlice).length;
    const graphChars = JSON.stringify(graphQueries).length;
    const estimatedTokens = Math.ceil(
      (memoryChars + skillChars + sharedChars + graphChars) / 4
    );

    // 6. Human-readable summary (for logs / trace UI / debug endpoint)
    const summary = this.summarize(
      agent,
      memory,
      skills,
      sharedContextSlice,
      graphQueries,
      estimatedTokens
    );

    return {
      agent,
      memory,
      skills,
      sharedContextSlice,
      graphQueries,
      estimatedTokens,
      summary,
    };
  }

  /**
   * Execute a workspace graph query spec against workspace-intelligence
   * (Task P). Import-safe: if the module isn't present (Task P hasn't
   * landed) or the workspace isn't indexed, returns an error marker.
   *
   * Spec format: "<type>:<key>=<value>"
   *   - "symbols:kind=model"        → querySymbolsByKind("model")
   *   - "symbols:kind=endpoint"     → querySymbolsByKind("endpoint")
   *   - "dependents:symbol=Contact" → queryDependents("Contact")
   *
   * Implementation note: we access `require` via `globalThis` (cast to
   * bypass TypeScript's static module resolution) so this module compiles
   * whether or not workspace-intelligence.ts exists on disk. This is the
   * only safe way to express an optional runtime dependency in a bundled
   * ESM environment — a literal `require("./workspace-intelligence")`
   * would fail both TypeScript (TS2307) and the bundler at build time.
   */
  private executeGraphQuery(spec: string): unknown {
    try {
      const maybeRequire = (globalThis as Record<string, unknown>).require as
        | ((m: string) => unknown)
        | undefined;
      if (typeof maybeRequire !== "function") {
        return { error: "workspace-intelligence not available (require unavailable)" };
      }
      const mod = maybeRequire("./workspace-intelligence") as {
        workspaceIntelligence?: {
          getGraph?: () => unknown;
          querySymbolsByKind?: (kind: string) => unknown;
          queryDependents?: (symbol: string) => unknown;
        };
      };
      if (!mod?.workspaceIntelligence) {
        return { error: "workspace-intelligence not available" };
      }
      const wi = mod.workspaceIntelligence;
      const graph = typeof wi.getGraph === "function" ? wi.getGraph() : null;
      if (!graph) return { error: "workspace not indexed" };

      const [type, filter] = spec.split(":");
      if (!filter) return null;
      const [key, value] = filter.split("=");
      if (type === "symbols" && key === "kind") {
        return typeof wi.querySymbolsByKind === "function"
          ? wi.querySymbolsByKind(value)
          : null;
      }
      if (type === "dependents" && key === "symbol") {
        return typeof wi.queryDependents === "function"
          ? wi.queryDependents(value)
          : null;
      }
      return null;
    } catch {
      return { error: "workspace-intelligence not available" };
    }
  }

  /**
   * Build a multi-line human-readable summary of the unified context. Used
   * by the debug endpoint and (optionally) the agent runtime's logging.
   * Shows counts + char-lengths for each slice so context bloat is visible
   * at a glance.
   */
  private summarize(
    agent: string,
    memory: MemoryRecord[],
    skills: SkillContent[],
    shared: Record<string, unknown>,
    graphs: Record<string, unknown>,
    tokens: number
  ): string {
    const memoryChars = memory.reduce((n, r) => n + r.content.length, 0);
    const skillChars = skills.reduce((n, s) => n + s.content.length, 0);
    const sharedChars = JSON.stringify(shared).length;
    const graphChars = JSON.stringify(graphs).length;
    const lines: string[] = [
      `Unified Context for: ${agent}`,
      `  Memory records: ${memory.length} (${memoryChars} chars)`,
      `  Skills: ${skills.length} (${skillChars} chars)`,
      `  SharedContext keys: ${Object.keys(shared).length} (${sharedChars} chars)`,
      `  Graph queries: ${Object.keys(graphs).length} (${graphChars} chars)`,
      `  Estimated tokens: ${tokens}`,
    ];
    if (memory.length > 0) {
      lines.push(`  Memory titles: ${memory.map((m) => m.title).join(", ")}`);
    }
    if (skills.length > 0) {
      lines.push(`  Skill IDs: ${skills.map((s) => s.id).join(", ")}`);
    }
    if (Object.keys(shared).length > 0) {
      lines.push(`  Shared keys: ${Object.keys(shared).join(", ")}`);
    }
    if (Object.keys(graphs).length > 0) {
      lines.push(`  Graph specs: ${Object.keys(graphs).join(", ")}`);
    }
    return lines.join("\n");
  }

  /**
   * Get the declared dependencies for an agent (for debugging / auditing).
   * Returns the SharedContext keys and graph queries this agent will
   * receive when build() is called.
   */
  getDeclaredDependencies(agent: string): {
    sharedKeys: string[];
    graphQueries: string[];
  } {
    return {
      sharedKeys: AGENT_SHARED_KEYS[agent] ?? [],
      graphQueries: AGENT_GRAPH_QUERIES[agent] ?? [],
    };
  }

  /**
   * Get all agent dependency declarations (for the debug endpoint). Returns
   * a map of agent → { sharedKeys, graphQueries } for every agent that has
   * a declaration in either map.
   */
  getAllDeclarations(): Record<
    string,
    { sharedKeys: string[]; graphQueries: string[] }
  > {
    const result: Record<string, { sharedKeys: string[]; graphQueries: string[] }> = {};
    const allAgents = new Set([
      ...Object.keys(AGENT_SHARED_KEYS),
      ...Object.keys(AGENT_GRAPH_QUERIES),
    ]);
    for (const agent of allAgents) {
      result[agent] = this.getDeclaredDependencies(agent);
    }
    return result;
  }
}

/**
 * Process-wide singleton UnifiedContextBuilder. The agent runtime and debug
 * endpoints import this directly; there's no per-build state to reset
 * (SharedContext and ProjectMemory have their own clear() methods).
 */
export const unifiedContextBuilder = new UnifiedContextBuilder();
