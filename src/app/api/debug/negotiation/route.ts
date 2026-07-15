// Debug Endpoint — Negotiation Engine inspection.
//
// Proves the multi-party negotiation layer works end-to-end. The reviewer
// said: "Agent negotiation: Instead of Planner → Architect, implement
// Planner ⇄ Architect ⇄ Security ⇄ Reviewer until consensus."
//
// This endpoint runs ONE live multi-party negotiation against the real
// registered `frontend-generator` handler (no LLM, no mocks of the engine
// itself — only the deterministic built-in reviewers are used):
//
//   Producer:   frontend-generator
//   Reviewers:  security-reviewer, architecture-reviewer, performance-reviewer
//
// Each round:
//   1. Producer (re)generates the proposal.
//   2. Each reviewer inspects the proposal via `(ctx as any).reviewing`
//      and returns severity-prefixed concern lines.
//   3. The engine parses the concerns. If all reviewers approve (or only
//      raise "minor" concerns) → consensus. Otherwise the producer
//      regenerates with the blocking concerns surfaced in
//      `(ctx as any).concernsToAddress`, and the next round begins.
//
// Usage:
//   GET /api/debug/negotiation
//
// Returns a JSON object with participants, round count, consensus flag,
// per-round concern breakdown, and a duration measurement.

import { NextResponse } from "next/server";
import {
  negotiationEngine,
  negotiationReviewHandlers,
} from "@/lib/engine/negotiation-engine";
import { agentHandlers } from "@/lib/engine/agent-handlers";
import { sharedContext } from "@/lib/engine/shared-context";
import type {
  AgentHandler,
  AgentExecutionContext,
} from "@/lib/engine/agent-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — run a demo multi-party negotiation and return a summary.
 *
 * The producer is the real `frontend-generator` handler (which wraps
 * `generateForTarget` and produces Next.js source files). The reviewers
 * are the deterministic built-in handlers from `negotiation-engine.ts`.
 * No LLM is invoked.
 */
export async function GET() {
  // Fresh SharedContext so the demo is reproducible regardless of what
  // upstream runs left in the blackboard.
  sharedContext.clear();
  sharedContext.write("architecture", "Contact entity, REST API, SQLite");

  // Build a minimal-but-valid AgentExecutionContext. The producer handler
  // (frontend-generator) only really needs `task`, `prompt`, `capabilities`,
  // `shared`, and `spawnSubAgent`; the rest is included for completeness.
  const context: any = {
    task: {
      id: "negotiation-demo",
      workflowId: "demo",
      stageId: "generate",
      title: "Generate CRM web app",
      description: "",
      agent: "frontend-generator",
      dependsOn: [],
      status: "pending",
      durationMs: 0,
    },
    prompt: "CRM app with contacts",
    memory: [],
    skills: [],
    capabilities: [],
    platform: "web",
    shared: sharedContext,
    spawnSubAgent: async () => ({ status: "success" }),
    emit: () => {},
  };

  const producer = agentHandlers["frontend-generator"];
  if (!producer) {
    return NextResponse.json(
      { error: "frontend-generator handler not found" },
      { status: 500 }
    );
  }

  const result = await negotiationEngine.negotiate(
    producer as AgentHandler,
    [
      {
        role: "security-reviewer",
        handler: negotiationReviewHandlers["security-reviewer"],
        perspective: "security",
      },
      {
        role: "architecture-reviewer",
        handler: negotiationReviewHandlers["architecture-reviewer"],
        perspective: "architecture",
      },
      {
        role: "performance-reviewer",
        handler: negotiationReviewHandlers["performance-reviewer"],
        perspective: "performance",
      },
    ],
    context as AgentExecutionContext,
    { maxRounds: 4 }
  );

  return NextResponse.json({
    participants: result.participants,
    rounds: result.rounds.length,
    consensusReached: result.consensusReached,
    summary: result.summary,
    durationMs: result.totalDurationMs,
    roundsDetail: result.rounds.map((r) => ({
      round: r.round,
      consensusReached: r.consensusReached,
      concernsByParticipant: r.concernsByParticipant.map((p) => ({
        participant: p.participant,
        concernCount: p.concerns.length,
        concerns: p.concerns.map((c) => ({
          severity: c.severity,
          concern: c.concern.substring(0, 80),
        })),
      })),
      refinementsApplied: r.refinementsApplied,
    })),
  });
}
