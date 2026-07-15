// Debug Endpoint — Agent Teams (Wave 1C).
//
// Proves the AgentTeamRegistry works end-to-end:
//   GET  → lists all 6 teams with their specialists + specialist counts
//          (total agents should equal the flat registry size, currently 70).
//   POST → accepts `{ taskDescription: string, preferredAgent?: string }`,
//          routes the task via `agentTeamRegistry.route()`, and returns the
//          selected team + assigned agent + reason.
//
// This is the runtime proof that the 70 flat agents are now grouped into
// 6 specialized teams (Planning, Architecture, Engineering, Quality,
// Delivery, System) — a grouping layer on top of the existing flat registry.
//
// Usage:
//   GET  /api/debug/agent-teams
//   POST /api/debug/agent-teams -d '{"taskDescription":"generate web app code"}'
//   POST /api/debug/agent-teams -d '{"taskDescription":"...","preferredAgent":"code-reviewer"}'

import { NextResponse } from "next/server";
import { agentTeamRegistry } from "@/lib/engine/agent-teams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const summary = agentTeamRegistry.getSummary();
  const totalAgents = summary.reduce((n, t) => n + t.specialistCount, 0);
  return NextResponse.json({
    teams: summary,
    totalTeams: summary.length,
    totalAgents,
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      taskDescription?: string;
      preferredAgent?: string;
    } | null;
    const taskDescription = body?.taskDescription ?? "";
    const preferredAgent = body?.preferredAgent;
    const result = agentTeamRegistry.route(taskDescription, preferredAgent);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: `Agent teams routing failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
