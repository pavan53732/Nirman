// Agent Collaboration Engine — enables agents to critique and refine each
// other's outputs through structured negotiation rounds.
//
// The reviewer said: "Multi-agent collaboration: Agents should evolve from
// sequential handlers into a collaborative system where they can negotiate,
// critique, and refine each other's outputs."
//
// Currently the pipeline is LINEAR: Generator → Build Engineer → (self-heal
// if fail). Agents hand off work but never look BACK at each other's output.
//
// This module introduces THREE collaboration patterns on top of the existing
// AgentHandler contract (no modification to handlers / runtime / orchestrator):
//
//   1. Critique-Refine — Producer creates → Critic reviews → Producer
//      refines based on the critique → repeat up to N rounds until the
//      Critic approves (or maxRounds is hit).
//   2. Peer Review — Two agents review each other's outputs in parallel
//      and the engine reports whether both passed the "no blocker" bar.
//   3. Consensus — Multiple voters each cast a vote on a discrete set of
//      options; the engine tallies and reports whether a strict majority
//      consensus was reached.
//
// HOW IT HOOKS INTO THE EXISTING RUNTIME WITHOUT MODIFYING IT
//   The collaboration engine accepts `AgentHandler` functions (the same
//   shape registered in agent-handlers.ts) plus an `AgentExecutionContext`.
//   It invokes the handlers directly — bypassing AgentRuntime.executeTask()
//   — so it does NOT need to modify agent-runtime.ts. The critic handlers
//   receive the producer's `AgentExecutionResult` via an extended context
//   field (`(ctx as any).reviewing`) rather than via a new contract field,
//   which keeps agent-contracts.ts untouched.
//
// This file is ADDITIVE: it creates a new module and does not modify any
// existing engine file. The only modifications are exports added to
// `index.ts` and the new debug endpoint under `api/debug/collaboration/`.

import type {
  AgentExecutionResult,
  AgentHandler,
  AgentExecutionContext,
} from "./agent-contracts";

/**
 * Any agent role string (e.g. "frontend-generator", "code-critic").
 * Kept as a string alias so future tightening (a union of known roles)
 * is a one-line change.
 */
export type AgentRole = string;

/**
 * A structured critique produced by a Critic agent reviewing a Producer's
 * output. The Critic returns plain text in `AgentExecutionResult.output`;
 * `parseCritique()` lifts it into this structured shape.
 *
 * `severity` is the headline signal the collaboration engine uses to decide
 * whether to iterate:
 *   - "approve"  → no changes needed, end the loop.
 *   - "minor"    → acceptable, end the loop (default approvable).
 *   - "major"    → significant issues; refine if rounds remain.
 *   - "blocker"  → must be fixed; refine if rounds remain.
 */
export interface Critique {
  /** Agent role that produced the critique (e.g. "code-critic"). */
  reviewer: string;
  /** Agent role being critiqued (e.g. "frontend-generator"). */
  target: string;
  severity: "approve" | "minor" | "major" | "blocker";
  issues: CritiqueIssue[];
  /** Short human-readable summary (first 200 chars of the critic's output). */
  summary: string;
  /** When the critique was produced (ms epoch). */
  timestamp: number;
}

/**
 * A single issue a Critic flagged in the Producer's output.
 */
export interface CritiqueIssue {
  category:
    | "correctness"
    | "security"
    | "performance"
    | "style"
    | "architecture"
    | "completeness";
  description: string;
  /** File path or symbol the issue pertains to (optional). */
  location?: string;
  /** Suggested fix (optional). */
  suggestion?: string;
}

/**
 * A single round of critique-refine. Each round records:
 *   - the producer output that was reviewed
 *   - the critique the critic produced
 *   - whether the producer then refined its output (and the refined result)
 */
export interface CollaborationRound {
  round: number;
  producerOutput: AgentExecutionResult;
  critique: Critique;
  /** Was the output refined based on this critique? */
  refined: boolean;
  /** The refined output (only present when `refined === true`). */
  refinement?: AgentExecutionResult;
}

/**
 * The end-to-end result of a collaboration run.
 */
export interface CollaborationResult {
  pattern: "critique-refine" | "peer-review" | "consensus";
  participants: string[];
  rounds: CollaborationRound[];
  finalOutput: AgentExecutionResult;
  finalCritique: Critique;
  /** Did the critic approve (severity ∈ approvableSeverities)? */
  approved: boolean;
  totalDurationMs: number;
}

/**
 * Tunable knobs for a collaboration run.
 */
export interface CollaborationConfig {
  /** Max critique-refine iterations. Default 3. */
  maxRounds: number;
  /**
   * Severities that count as "approved". When the critic returns one of
   * these, the loop terminates successfully. Default ["approve", "minor"].
   */
  approvableSeverities: Critique["severity"][];
}

const DEFAULT_CONFIG: CollaborationConfig = {
  maxRounds: 3,
  approvableSeverities: ["approve", "minor"],
};

/**
 * The collaboration engine. Stateless aside from the configured handlers
 * passed to each method — safe to reuse across builds.
 */
export class AgentCollaborationEngine {
  /**
   * Critique-Refine pattern:
   *   1. Producer agent creates the initial output.
   *   2. Critic agent reviews the output and produces a Critique.
   *   3. If the critique severity is approvable → done (approved).
   *   4. Otherwise, the producer refines its output based on the critique
   *      (the critique is passed to the producer via an extended context
   *      field `priorCritique`).
   *   5. Repeat up to `maxRounds`.
   *
   * The producer and critic are plain `AgentHandler` functions — they can
   * be the registered handlers from `agent-handlers.ts` or the built-in
   * critic handlers exported from this module.
   */
  async critiqueRefine(
    producerHandler: AgentHandler,
    criticHandler: AgentHandler,
    context: Omit<AgentExecutionContext, "task"> & { task: any },
    config: Partial<CollaborationConfig> = {}
  ): Promise<CollaborationResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();
    const rounds: CollaborationRound[] = [];

    // Round 1 begins with the producer's initial output.
    let producerOutput = await producerHandler(context);
    let finalOutput = producerOutput;
    let finalCritique: Critique = {
      reviewer: "critic",
      target: "producer",
      severity: "blocker",
      issues: [],
      summary: "No critique produced",
      timestamp: Date.now(),
    };
    let approved = false;

    for (let round = 1; round <= cfg.maxRounds; round++) {
      // Critic reviews the current producer output.
      const critique = await this.produceCritique(
        criticHandler,
        context,
        producerOutput,
        round
      );
      finalCritique = critique;

      // Approved? Then we're done — record the round and exit.
      if (cfg.approvableSeverities.includes(critique.severity)) {
        approved = true;
        rounds.push({
          round,
          producerOutput,
          critique,
          refined: false,
        });
        break;
      }

      // Not approved. If we have another round left, the producer refines.
      if (round < cfg.maxRounds) {
        const refinedContext: AgentExecutionContext = {
          ...context,
          task: {
            ...context.task,
            title: `${context.task.title} (refine round ${round})`,
          },
        };
        // Pass the critique to the producer via an extended context field.
        // Handlers that don't read `priorCritique` simply ignore it (the
        // producer will regenerate from the same inputs — useful for the
        // demo even when the producer doesn't actually consume the critique).
        (refinedContext as any).priorCritique = critique;
        const refinement = await producerHandler(refinedContext);
        rounds.push({
          round,
          producerOutput,
          critique,
          refined: true,
          refinement,
        });
        producerOutput = refinement;
        finalOutput = refinement;
      } else {
        // Max rounds reached without approval. Record the final round and
        // exit the loop with approved=false.
        rounds.push({
          round,
          producerOutput,
          critique,
          refined: false,
        });
      }
    }

    return {
      pattern: "critique-refine",
      participants: ["producer", "critic"],
      rounds,
      finalOutput,
      finalCritique,
      approved,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Peer Review pattern: two agents review each other's outputs in parallel.
   * Both agents run once; then each one critiques the other's output. The
   * run is "approved" iff neither critique is a blocker.
   *
   * (This is a single-round pattern — it does not iterate. A future
   * extension could feed each critique back into the opposite agent for a
   * second pass.)
   */
  async peerReview(
    handlerA: AgentHandler,
    handlerB: AgentHandler,
    context: AgentExecutionContext,
    config: Partial<CollaborationConfig> = {}
  ): Promise<CollaborationResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();

    const outputA = await handlerA(context);
    const outputB = await handlerB(context);

    const critiqueBofA = await this.produceCritique(handlerB, context, outputA, 1);
    const critiqueAofB = await this.produceCritique(handlerA, context, outputB, 1);

    const approved =
      critiqueBofA.severity !== "blocker" && critiqueAofB.severity !== "blocker";

    return {
      pattern: "peer-review",
      participants: ["agent-a", "agent-b"],
      rounds: [
        {
          round: 1,
          producerOutput: outputA,
          critique: critiqueBofA,
          refined: false,
        },
        {
          round: 1,
          producerOutput: outputB,
          critique: critiqueAofB,
          refined: false,
        },
      ],
      finalOutput: approved ? outputA : outputB,
      finalCritique: critiqueBofA,
      approved,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Consensus pattern: multiple voters each cast a vote on a discrete set
   * of options. The engine tallies and reports whether a STRICT MAJORITY
   * consensus was reached.
   *
   * Each voter's handler is invoked with `options` injected into the
   * context. The handler returns text containing `vote: <option>` (matched
   * case-insensitively). The first option is used as a fallback when the
   * handler doesn't return a parseable vote.
   *
   * Returns the winning option, the per-voter votes, and a
   * `consensusReached` flag (>50% of voters agreed).
   */
  async consensus(
    voters: { agent: string; handler: AgentHandler }[],
    context: AgentExecutionContext,
    options: string[]
  ): Promise<{
    decision: string;
    votes: Record<string, string>;
    consensusReached: boolean;
  }> {
    const votes: Record<string, string> = {};
    for (const voter of voters) {
      // Each voter handler returns output containing their vote.
      const voteContext: AgentExecutionContext = {
        ...context,
        task: { ...context.task, title: `Vote: ${voter.agent}` },
      };
      (voteContext as any).options = options;
      const result = await voter.handler(voteContext);
      // Parse vote from output: "vote: <word>" (case-insensitive).
      const voteMatch = result.output?.match(/vote:\s*(\w+)/i);
      votes[voter.agent] = voteMatch ? voteMatch[1] : options[0];
    }
    // Majority tally.
    const tally: Record<string, number> = {};
    for (const vote of Object.values(votes)) {
      tally[vote] = (tally[vote] ?? 0) + 1;
    }
    const decision =
      Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? options[0];
    const maxVotes = tally[decision] ?? 0;
    const consensusReached = maxVotes > voters.length / 2;

    return { decision, votes, consensusReached };
  }

  /**
   * Run the critic handler against a producer output and lift the result
   * into a structured `Critique`. The producer output is passed via an
   * extended context field `reviewing` so the critic can read it without
   * requiring a new contract field.
   */
  private async produceCritique(
    criticHandler: AgentHandler,
    context: AgentExecutionContext,
    producerOutput: AgentExecutionResult,
    round: number
  ): Promise<Critique> {
    const criticContext: AgentExecutionContext = {
      ...context,
      task: { ...context.task, title: `Critique round ${round}` },
    };
    (criticContext as any).reviewing = producerOutput;
    const result = await criticHandler(criticContext);
    return this.parseCritique(result, round);
  }

  /**
   * Parse a critic's text output into a structured `Critique`. Recognises:
   *
   *   Severity (matched in this priority order):
   *     - "approve"    — output contains "approve", "approved", "no issues",
   *                      "looks good" (case-insensitive).
   *     - "blocker"    — "blocker", "critical", "fatal".
   *     - "major"      — "major", "significant", "important".
   *     - "minor"      — "minor", "small", "nit", "style".
   *     - (default) "minor" if nothing matches.
   *
   *   Issues — any line matching `issue: ...` or `problem: ...` or
   *   `concern: ...`. The trailing category hint in parens, e.g.
   *   "(security)", is recognised and used to set the issue category;
   *   otherwise the category is inferred from keywords in the description.
   */
  private parseCritique(result: AgentExecutionResult, _round: number): Critique {
    const output = result.output ?? "";

    // Parse severity (priority order matters).
    let severity: Critique["severity"] = "minor";
    if (/approve|approved|no issues|looks good/i.test(output)) severity = "approve";
    else if (/blocker|critical|fatal/i.test(output)) severity = "blocker";
    else if (/major|significant|important/i.test(output)) severity = "major";
    else if (/minor|small|nit|style/i.test(output)) severity = "minor";

    // Parse issues — each `issue:` / `problem:` / `concern:` line becomes one.
    const issues: CritiqueIssue[] = [];
    const issueMatches = [
      ...output.matchAll(/(?:issue|problem|concern):\s*(.+?)(?:\n|$)/gi),
    ];
    for (const m of issueMatches) {
      const raw = m[1].trim();
      // Recognise an explicit "(category)" suffix, e.g. "(security)".
      const catMatch = raw.match(/\((security|performance|style|architecture|completeness|correctness)\)\s*$/i);
      let category: CritiqueIssue["category"];
      let description = raw;
      if (catMatch) {
        category = catMatch[1].toLowerCase() as CritiqueIssue["category"];
        description = raw.slice(0, catMatch.index).trim();
      } else {
        category = /secur/i.test(raw)
          ? "security"
          : /perform/i.test(raw)
          ? "performance"
          : /style|format/i.test(raw)
          ? "style"
          : /architect/i.test(raw)
          ? "architecture"
          : /complete|missing/i.test(raw)
          ? "completeness"
          : "correctness";
      }
      issues.push({ category, description });
    }

    return {
      reviewer: "critic",
      target: "producer",
      severity,
      issues,
      summary: output.substring(0, 200),
      timestamp: Date.now(),
    };
  }
}

/**
 * Process-wide singleton collaboration engine. Stateless, safe to reuse.
 */
export const collaborationEngine = new AgentCollaborationEngine();

/* ------------------------------------------------------------------ */
/* Built-in critic handlers                                           */
/* ------------------------------------------------------------------ */
//
// These are simple, deterministic critic handlers that exercise the
// collaboration patterns without requiring an LLM. They read the producer's
// output from `(ctx as any).reviewing` (an AgentExecutionResult) and return
// plain-text output that `parseCritique` lifts into a structured Critique.
//
// Real LLM-backed critics would have the same signature and use the same
// `(ctx as any).reviewing` convention — they'd just produce richer text.

/**
 * Code Critic — reviews generated source files for common quality issues:
 *   - missing `export` in TS/TSX files (architecture)
 *   - use of `any` type (style)
 *   - suspiciously short files (completeness)
 *   - missing `namespace` in C# files (architecture)
 *   - missing `package` declaration in Kotlin files (architecture)
 *
 * Returns "APPROVED: ..." if no issues were found, otherwise a severity
 * line ("minor" or "major") followed by one `issue:` line per finding.
 */
export const criticHandlers: Record<string, AgentHandler> = {
  "code-critic": async (ctx) => {
    const reviewing = (ctx as any).reviewing as AgentExecutionResult | undefined;
    if (!reviewing) {
      return { status: "success", output: "Nothing to review" };
    }
    const artifacts = reviewing.artifacts ?? [];
    const issues: string[] = [];

    for (const file of artifacts) {
      if (file.path.endsWith(".ts") || file.path.endsWith(".tsx")) {
        if (!file.content.includes("export"))
          issues.push("issue: no exports found (architecture)");
        if (file.content.includes("any"))
          issues.push("issue: uses 'any' type — consider stronger typing (style)");
        if (file.content.length < 50)
          issues.push("issue: file too short — may be incomplete (completeness)");
      }
      if (file.path.endsWith(".cs")) {
        if (!file.content.includes("namespace"))
          issues.push("issue: missing namespace (architecture)");
      }
      if (file.path.endsWith(".kt")) {
        if (!file.content.includes("package"))
          issues.push("issue: missing package declaration (architecture)");
      }
    }

    if (issues.length === 0) {
      return {
        status: "success",
        output: "APPROVED: Code meets quality standards. No issues found.",
      };
    }

    const severity = issues.length > 3 ? "major" : "minor";
    return {
      status: "success",
      output: `Review complete. Severity: ${severity}\n${issues.join("\n")}`,
    };
  },

  /**
   * Architecture Critic — checks that the produced artifact set has all
   * three architectural layers: data model, view/UI, and data access.
   * Used to demonstrate architecture-level critique (vs. file-level).
   */
  "architecture-critic": async (ctx) => {
    const reviewing = (ctx as any).reviewing as AgentExecutionResult | undefined;
    if (!reviewing) return { status: "success", output: "Nothing to review" };

    const artifacts = reviewing.artifacts ?? [];
    const hasModels = artifacts.some(
      (f) =>
        f.path.includes("Model") ||
        f.path.includes("schema") ||
        f.path.includes("Entity")
    );
    const hasViews = artifacts.some(
      (f) =>
        f.path.includes("View") ||
        f.path.includes("Screen") ||
        f.path.includes("page")
    );
    const hasData = artifacts.some(
      (f) =>
        f.path.includes("Data") ||
        f.path.includes("Repository") ||
        f.path.includes("Dao") ||
        f.path.includes("api")
    );

    const issues: string[] = [];
    if (!hasModels) issues.push("issue: no data model layer found (architecture)");
    if (!hasViews) issues.push("issue: no view/UI layer found (architecture)");
    if (!hasData) issues.push("issue: no data access layer found (architecture)");

    if (issues.length === 0) {
      return {
        status: "success",
        output:
          "APPROVED: Architecture is well-structured with all layers present.",
      };
    }
    return {
      status: "success",
      output: `Architecture review. Severity: ${
        issues.length > 1 ? "major" : "minor"
      }\n${issues.join("\n")}`,
    };
  },

  /**
   * Security Critic — flags dangerous patterns: hardcoded passwords, eval(),
   * and SQL-via-string-concatenation. Security issues are always "blocker".
   */
  "security-critic": async (ctx) => {
    const reviewing = (ctx as any).reviewing as AgentExecutionResult | undefined;
    if (!reviewing) return { status: "success", output: "Nothing to review" };

    const artifacts = reviewing.artifacts ?? [];
    const issues: string[] = [];

    for (const file of artifacts) {
      if (file.content.includes("password") && file.content.includes("hardcoded")) {
        issues.push("issue: hardcoded password detected (security)");
      }
      if (file.content.includes("eval(")) {
        issues.push("issue: eval() usage is dangerous (security)");
      }
      if (file.content.includes("SQL") && file.content.includes("concat")) {
        issues.push(
          "issue: potential SQL injection via string concatenation (security)"
        );
      }
    }

    if (issues.length === 0) {
      return { status: "success", output: "APPROVED: No security issues detected." };
    }
    return {
      status: "success",
      output: `Security review. Severity: blocker\n${issues.join("\n")}`,
    };
  },

  /**
   * Vote Handler — a stub voter for the consensus pattern. Returns
   * `vote: <first-option>` so a unanimous consensus is reached when all
   * voters use this handler. Real voters would inspect the context and
   * return a vote based on their specialism.
   */
  "vote-handler": async (ctx) => {
    const options = (ctx as any).options as string[] | undefined;
    if (!options || options.length === 0) {
      return { status: "success", output: "vote: none" };
    }
    // Simple voting: prefer the first option.
    return { status: "success", output: `vote: ${options[0]}` };
  },
};
