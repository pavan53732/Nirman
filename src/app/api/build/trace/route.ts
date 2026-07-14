// /api/build/trace — runtime task-graph trace endpoint.
//
// PURE STORE: The orchestrator runs CLIENT-SIDE (Zustand store), so the
// client executionEngine singleton owns the live trace. The client POSTs the
// trace here after each event; the GET returns the POSTed trace.
//
// This endpoint intentionally does NOT import the engine — it's a simple
// key-value store to keep the compile footprint small and avoid OOM during
// Turbopack route compilation.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Module-level store for the latest client-posted trace.
let postedTrace: any[] | null = null;

function summarize(trace: any[]) {
  return {
    count: trace.length,
    batches: new Set(trace.map((t: any) => t.parallelBatch).filter((b: number) => b > 0)).size,
    maxParallel: trace.length === 0
      ? 0
      : Math.max(
          ...Object.values(
            trace.reduce<Record<number, number>>((acc: any, t: any) => {
              if (t.parallelBatch > 0) acc[t.parallelBatch] = (acc[t.parallelBatch] ?? 0) + 1;
              return acc;
            }, {})
          )
        ),
    pending: trace.filter((t: any) => t.status === "pending").length,
    running: trace.filter((t: any) => t.status === "running").length,
    completed: trace.filter((t: any) => t.status === "completed").length,
    failed: trace.filter((t: any) => t.status === "failed").length,
  };
}

export async function GET() {
  const trace = postedTrace ?? [];
  return NextResponse.json({ trace, ...summarize(trace), source: postedTrace ? "client" : "empty" });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const incoming = body?.trace;
    if (Array.isArray(incoming)) {
      postedTrace = incoming;
      return NextResponse.json({ ok: true, count: incoming.length });
    }
    return NextResponse.json({ error: "Body must be { trace: TraceEntry[] }" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: `Failed to store build trace: ${String(err)}` }, { status: 500 });
  }
}
