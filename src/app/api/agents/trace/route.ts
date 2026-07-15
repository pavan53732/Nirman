// /api/agents/trace — sub-agent activation trace endpoint.
//
// PURE STORE: The orchestrator runs CLIENT-SIDE, so the client agentRuntime
// singleton owns the live activations. The client POSTs them here after each
// event; the GET returns the POSTed data.
//
// This endpoint intentionally does NOT import the engine — it's a simple
// key-value store to keep the compile footprint small.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let postedActivations: any[] | null = null;
let postedSummary: any = null;

const EMPTY_SUMMARY = { totalAgents: 0, activeAgents: 0, completedAgents: 0, totalTasks: 0 };

export async function GET() {
  return NextResponse.json({
    summary: postedSummary ?? EMPTY_SUMMARY,
    activations: postedActivations ?? [],
    source: postedActivations ? "client" : "empty",
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const incoming = body?.activations;
    if (Array.isArray(incoming)) {
      postedActivations = incoming;
      postedSummary = body.summary ?? null;
      return NextResponse.json({ ok: true, count: incoming.length });
    }
    return NextResponse.json({ error: "Body must be { summary, activations }" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: `Failed to store agent trace: ${String(err)}` }, { status: 500 });
  }
}
