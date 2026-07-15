// Negotiation Engine — multi-party agent negotiation until consensus.
//
// The reviewer said: "Agent negotiation: Instead of Planner → Architect,
// implement Planner ⇄ Architect ⇄ Security ⇄ Reviewer until consensus."
//
// The existing `agent-collaboration.ts` ships three patterns:
//   - critiqueRefine (producer ↔ critic, 2-party)
//   - peerReview     (two agents review each other, single round)
//   - consensus      (multiple voters pick a discrete option)
//
// None of those is a true MULTI-PARTY NEGOTIATION where 3+ agents each
// review a proposal, raise concerns, and the proposal is refined until
// ALL agents approve (or maxRounds is hit). This module fills that gap.
//
// Flow:
//   Round 1:
//     Producer creates proposal
//     Reviewer A reviews → concerns
//     Reviewer B reviews → concerns
//     Reviewer C reviews → concerns
//     If all approve → done
//     Otherwise: Producer refines based on ALL concerns
//   Round 2:
//     Same cycle with refined proposal
//   ...until consensus or maxRounds
//
// HOW IT HOOKS INTO THE EXISTING RUNTIME WITHOUT MODIFYING IT
//   The NegotiationEngine accepts plain `AgentHandler` functions (the same
//   shape registered in agent-handlers.ts) plus an `AgentExecutionContext`.
//   It invokes the handlers directly — bypassing AgentRuntime.executeTask()
//   — so it does NOT need to modify agent-runtime.ts. Reviewer handlers
//   receive the producer's `AgentExecutionResult` via an extended context
//   field (`(ctx as any).reviewing`) and the producer receives prior
//   concerns via `(ctx as any).concernsToAddress`, mirroring the convention
//   already used in agent-collaboration.ts. agent-contracts.ts stays
//   untouched.
//
// This file is ADDITIVE: it creates a new module and does not modify any
// existing engine file. The only modifications are exports added to
// `index.ts` and the new debug endpoint under `api/debug/negotiation/`.

import type {
  AgentHandler,
  AgentExecutionContext,
  AgentExecutionResult,
} from "./agent-contracts";

/**
 * A participant in a multi-party negotiation. The `producer` is special —
 * it creates the initial proposal and refines it after each round. Every
 * other participant is a `reviewer` that evaluates the proposal from its
 * own perspective (security, architecture, performance, code quality, ...).
 */
export interface NegotiationParticipant {
  /** Human-readable role, e.g. "security-reviewer". */
  role: string;
  /** The agent handler that reviews (or, for the producer, generates). */
  handler: AgentHandler;
  /** What this participant evaluates (e.g. "security", "performance"). */
  perspective: string;
}

/**
 * A single concern a reviewer raised about a proposal.
 *
 * `severity` is the headline signal the engine uses to decide whether a
 * reviewer has approved:
 *   - "approve"  → no concerns, end the round.
 *   - "minor"    → acceptable, still counts as approval.
 *   - "major"    → significant; refine if rounds remain.
 *   - "blocker"  → must be fixed; refine if rounds remain.
 */
export interface NegotiationConcern {
  /** Agent role that raised the concern. */
  raisedBy: string;
  severity: "blocker" | "major" | "minor" | "approve";
  /** Human-readable description of the concern. */
  concern: string;
  /** Optional suggested fix. */
  suggestion?: string;
}

/**
 * A single round of negotiation. Each round records:
 *   - the proposal that was reviewed
 *   - the concerns each reviewer raised
 *   - whether consensus was reached
 *   - any refinements the producer applied before the next round
 */
export interface NegotiationRound {
  round: number;
  /** The proposal that was reviewed this round. */
  proposal: AgentExecutionResult;
  /** Per-reviewer concerns about `proposal`. */
  concernsByParticipant: { participant: string; concerns: NegotiationConcern[] }[];
  /** Did this round reach consensus? */
  consensusReached: boolean;
  /** Refinements the producer applied after this round (empty on the last round). */
  refinementsApplied: string[];
}

/**
 * The end-to-end result of a negotiation run.
 */
export interface NegotiationResult {
  participants: string[];
  rounds: NegotiationRound[];
  finalProposal: AgentExecutionResult;
  consensusReached: boolean;
  totalDurationMs: number;
  summary: string;
}

/**
 * Tunable knobs for a negotiation run.
 */
export interface NegotiationConfig {
  /** Max negotiation rounds. Default 4. */
  maxRounds: number;
  /**
   * If true, ALL reviewers must approve (or only raise "minor"/"approve"
   * concerns) for consensus. If false, a strict majority suffices.
   * Default true.
   */
  requireAllApprove: boolean;
}

const DEFAULT_CONFIG: NegotiationConfig = {
  maxRounds: 4,
  requireAllApprove: true,
};

/**
 * The negotiation engine. Stateless aside from the handlers passed to
 * `negotiate()` — safe to reuse across builds.
 */
export class NegotiationEngine {
  /**
   * Run a multi-party negotiation.
   *
   * @param producer The agent that creates/refines the proposal.
   * @param reviewers The agents that review the proposal each round.
   * @param context The execution context.
   * @param config Negotiation settings (partial — defaults merged in).
   */
  async negotiate(
    producer: AgentHandler,
    reviewers: NegotiationParticipant[],
    context: AgentExecutionContext,
    config: Partial<NegotiationConfig> = {}
  ): Promise<NegotiationResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();
    const rounds: NegotiationRound[] = [];

    // Initial proposal.
    let proposal = await producer(context);
    let finalProposal = proposal;
    let consensusReached = false;

    for (let round = 1; round <= cfg.maxRounds; round++) {
      // Each reviewer evaluates the proposal.
      const concernsByParticipant: {
        participant: string;
        concerns: NegotiationConcern[];
      }[] = [];

      for (const reviewer of reviewers) {
        const reviewContext: AgentExecutionContext = {
          ...context,
          task: {
            ...context.task,
            title: `Negotiation round ${round}: ${reviewer.role} review`,
          },
        };
        (reviewContext as any).reviewing = proposal;
        (reviewContext as any).perspective = reviewer.perspective;

        const reviewResult = await reviewer.handler(reviewContext);
        const concerns = this.parseConcerns(reviewResult, reviewer.role);
        concernsByParticipant.push({ participant: reviewer.role, concerns });
      }

      // Check consensus.
      const isApproving = (pcb: { concerns: NegotiationConcern[] }) =>
        pcb.concerns.length === 0 ||
        pcb.concerns.every(
          (c) => c.severity === "approve" || c.severity === "minor"
        );

      const allApprove = concernsByParticipant.every(isApproving);
      const majorityApprove =
        concernsByParticipant.filter(isApproving).length > reviewers.length / 2;

      consensusReached = cfg.requireAllApprove ? allApprove : majorityApprove;

      if (consensusReached) {
        rounds.push({
          round,
          proposal,
          concernsByParticipant,
          consensusReached: true,
          refinementsApplied: [],
        });
        finalProposal = proposal;
        break;
      }

      // Collect all concerns for the producer to address.
      const allConcerns = concernsByParticipant.flatMap((pcb) => pcb.concerns);
      const blockingConcerns = allConcerns.filter(
        (c) => c.severity === "blocker" || c.severity === "major"
      );

      const refinementsApplied: string[] = [];

      if (round < cfg.maxRounds) {
        // Producer refines based on concerns.
        const refineContext: AgentExecutionContext = {
          ...context,
          task: {
            ...context.task,
            title: `Negotiation round ${round}: refine`,
          },
        };
        (refineContext as any).priorProposal = proposal;
        (refineContext as any).concernsToAddress = blockingConcerns;

        const refinedProposal = await producer(refineContext);
        const uniqueReviewers = new Set(
          blockingConcerns.map((c) => c.raisedBy)
        ).size;
        refinementsApplied.push(
          `Addressed ${blockingConcerns.length} blocking concern(s) from ${uniqueReviewers} reviewer(s)`
        );

        rounds.push({
          round,
          proposal,
          concernsByParticipant,
          consensusReached: false,
          refinementsApplied,
        });

        proposal = refinedProposal;
        finalProposal = refinedProposal;
      } else {
        // Max rounds reached without consensus.
        rounds.push({
          round,
          proposal,
          concernsByParticipant,
          consensusReached: false,
          refinementsApplied: [],
        });
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const summary = this.summarize(rounds, consensusReached, reviewers);

    return {
      participants: ["producer", ...reviewers.map((r) => r.role)],
      rounds,
      finalProposal,
      consensusReached,
      totalDurationMs,
      summary,
    };
  }

  /**
   * Parse a reviewer's text output into a structured list of concerns.
   *
   * Recognises lines prefixed with one of:
   *   concern: | issue: | problem: | blocker: | major: | minor: | approve:
   *
   * The prefix sets the baseline severity; if the body itself contains a
   * stronger severity keyword (e.g. "critical" / "fatal"), the severity is
   * bumped. Lines without a known prefix are ignored.
   *
   * If no concerns are matched and the output is positive ("approve",
   * "no concerns", "looks good", "acceptable"), a single "approve" concern
   * is synthesised so the consensus check sees an explicit approval.
   */
  private parseConcerns(
    result: AgentExecutionResult,
    raisedBy: string
  ): NegotiationConcern[] {
    const output = result.output ?? "";
    const concerns: NegotiationConcern[] = [];

    const prefixRe =
      /(?:concern|issue|problem|blocker|major|minor|approve):\s*(.+?)(?:\n|$)/gi;
    const matches = [...output.matchAll(prefixRe)];

    for (const m of matches) {
      const prefix = m[0].split(":")[0].toLowerCase();
      const body = m[1].trim();

      // Default severity from the prefix, then bump based on body content.
      let severity: NegotiationConcern["severity"] = "minor";
      if (prefix === "blocker") severity = "blocker";
      else if (prefix === "major") severity = "major";
      else if (prefix === "minor") severity = "minor";
      else if (prefix === "approve") severity = "approve";

      // Body content can bump the severity up.
      if (/blocker|critical|fatal/i.test(body)) severity = "blocker";
      else if (/major|significant/i.test(body)) {
        if (severity === "minor") severity = "major";
      }

      // For "approve" prefix, the concern is a positive approval — keep
      // the body as the concern text (e.g. "No security concerns...").
      concerns.push({
        raisedBy,
        severity,
        concern: body,
        suggestion: undefined,
      });
    }

    // If no concerns were matched but the output is positive, synthesise
    // an explicit "approve" concern so the consensus check sees approval.
    if (
      concerns.length === 0 &&
      /approve|no concerns|looks good|acceptable/i.test(output)
    ) {
      concerns.push({
        raisedBy,
        severity: "approve",
        concern: "No concerns — proposal approved",
      });
    }

    return concerns;
  }

  /**
   * Human-readable summary of the negotiation run.
   */
  private summarize(
    rounds: NegotiationRound[],
    consensusReached: boolean,
    reviewers: NegotiationParticipant[]
  ): string {
    const totalConcerns = rounds.reduce(
      (sum, r) =>
        sum + r.concernsByParticipant.reduce((s, p) => s + p.concerns.length, 0),
      0
    );
    const blockingConcerns = rounds.reduce(
      (sum, r) =>
        sum +
        r.concernsByParticipant
          .flatMap((p) => p.concerns)
          .filter((c) => c.severity === "blocker").length,
      0
    );
    const lastRound = rounds[rounds.length - 1];

    return (
      `Negotiation ${consensusReached ? "reached consensus" : "did NOT reach consensus"} ` +
      `after ${rounds.length} round(s). ` +
      `Participants: producer + ${reviewers.map((r) => r.role).join(", ")}. ` +
      `Total concerns raised: ${totalConcerns} (${blockingConcerns} blocker(s)). ` +
      `Status: ${lastRound ? "completed" : "incomplete"}.`
    );
  }
}

/**
 * Process-wide singleton negotiation engine. Stateless, safe to reuse.
 */
export const negotiationEngine = new NegotiationEngine();

/* ------------------------------------------------------------------ */
/* Built-in negotiation participants                                   */
/* ------------------------------------------------------------------ */

/**
 * Built-in negotiation participants for common scenarios. Each helper
 * wraps an `AgentHandler` with a role + perspective so callers don't have
 * to repeat the boilerplate.
 */
export const negotiationParticipants = {
  securityReviewer: (handler: AgentHandler): NegotiationParticipant => ({
    role: "security-reviewer",
    handler,
    perspective: "security",
  }),
  architectureReviewer: (handler: AgentHandler): NegotiationParticipant => ({
    role: "architecture-reviewer",
    handler,
    perspective: "architecture",
  }),
  performanceReviewer: (handler: AgentHandler): NegotiationParticipant => ({
    role: "performance-reviewer",
    handler,
    perspective: "performance",
  }),
  codeReviewer: (handler: AgentHandler): NegotiationParticipant => ({
    role: "code-reviewer",
    handler,
    perspective: "code quality",
  }),
};

/* ------------------------------------------------------------------ */
/* Default negotiation review handlers (deterministic, no LLM)        */
/* ------------------------------------------------------------------ */
//
// These are simple, deterministic reviewer handlers that exercise the
// negotiation loop without requiring an LLM. They read the producer's
// output from `(ctx as any).reviewing` (an AgentExecutionResult) and
// return plain-text output that `parseConcerns` lifts into structured
// `NegotiationConcern[]`.
//
// Output convention (what `parseConcerns` expects):
//   - Each concern line starts with a severity prefix, e.g.
//     "blocker: ...", "major: ...", "minor: ...".
//   - An approval is signalled either by a line starting with
//     "approve: ..." OR by a positive phrase like "looks good" /
//     "no concerns" / "acceptable" with no preceding concern lines.
//
// Real LLM-backed reviewers would have the same signature and use the
// same `(ctx as any).reviewing` convention — they'd just produce richer
// text.
export const negotiationReviewHandlers: Record<string, AgentHandler> = {
  /**
   * Security Reviewer — flags dangerous patterns:
   *   - hardcoded password not loaded via env()
   *   - eval() usage
   *   - insecure http:// URLs (excluding localhost)
   */
  "security-reviewer": async (ctx) => {
    const reviewing = (ctx as any).reviewing as
      | AgentExecutionResult
      | undefined;
    if (!reviewing) {
      return { status: "success", output: "Nothing to review" };
    }

    const concerns: string[] = [];
    for (const artifact of reviewing.artifacts ?? []) {
      if (
        artifact.content.includes("password") &&
        !artifact.content.includes("env(")
      ) {
        concerns.push(
          "blocker: hardcoded password detected — use environment variables"
        );
      }
      if (artifact.content.includes("eval(")) {
        concerns.push("blocker: eval() usage is a security risk");
      }
      if (
        artifact.content.includes("http://") &&
        !artifact.content.includes("localhost")
      ) {
        concerns.push("major: insecure HTTP URL — use HTTPS");
      }
    }

    if (concerns.length === 0) {
      return {
        status: "success",
        output: "approve: No security concerns. Proposal is acceptable.",
      };
    }
    return { status: "success", output: concerns.join("\n") };
  },

  /**
   * Architecture Reviewer — checks the produced artifact set has all three
   * architectural layers: data model, view/UI, and API/service. Used to
   * demonstrate architecture-level review (vs. file-level).
   */
  "architecture-reviewer": async (ctx) => {
    const reviewing = (ctx as any).reviewing as
      | AgentExecutionResult
      | undefined;
    if (!reviewing) {
      return { status: "success", output: "Nothing to review" };
    }

    const artifacts = reviewing.artifacts ?? [];
    const hasModel = artifacts.some((a) =>
      /model|schema|entity/i.test(a.path)
    );
    const hasView = artifacts.some((a) =>
      /view|page|screen|component/i.test(a.path)
    );
    const hasAPI = artifacts.some((a) =>
      /api|route|controller|service/i.test(a.path)
    );

    const concerns: string[] = [];
    if (!hasModel) concerns.push("major: missing data model layer");
    if (!hasView) concerns.push("major: missing UI/view layer");
    if (!hasAPI) concerns.push("minor: missing API/service layer");

    if (concerns.length === 0) {
      return {
        status: "success",
        output: "approve: Architecture is well-structured.",
      };
    }
    return { status: "success", output: concerns.join("\n") };
  },

  /**
   * Performance Reviewer — flags:
   *   - files larger than 50KB (split for performance)
   *   - suspicious N+1 / sequential-await patterns
   */
  "performance-reviewer": async (ctx) => {
    const reviewing = (ctx as any).reviewing as
      | AgentExecutionResult
      | undefined;
    if (!reviewing) {
      return { status: "success", output: "Nothing to review" };
    }

    const concerns: string[] = [];
    for (const artifact of reviewing.artifacts ?? []) {
      if (artifact.content.length > 50000) {
        concerns.push(
          "major: file is very large — consider splitting for performance"
        );
      }
      if (/N\+1|forEach.*await|for.*await/.test(artifact.content)) {
        concerns.push(
          "major: potential N+1 query or sequential await pattern detected"
        );
      }
    }

    if (concerns.length === 0) {
      return {
        status: "success",
        output: "approve: No performance concerns.",
      };
    }
    return { status: "success", output: concerns.join("\n") };
  },

  /**
   * Code Reviewer — flags common code-quality issues:
   *   - `any` type usage in TS files (style)
   *   - files longer than 500 lines (maintainability)
   */
  "code-reviewer": async (ctx) => {
    const reviewing = (ctx as any).reviewing as
      | AgentExecutionResult
      | undefined;
    if (!reviewing) {
      return { status: "success", output: "Nothing to review" };
    }

    const concerns: string[] = [];
    for (const artifact of reviewing.artifacts ?? []) {
      if (artifact.content.includes("any") && artifact.path.endsWith(".ts")) {
        concerns.push("minor: uses 'any' type — consider stronger typing");
      }
      if (artifact.content.split("\n").length > 500) {
        concerns.push("minor: file is long — consider splitting");
      }
    }

    if (concerns.length === 0) {
      return {
        status: "success",
        output: "approve: Code meets quality standards.",
      };
    }
    return { status: "success", output: concerns.join("\n") };
  },
};
