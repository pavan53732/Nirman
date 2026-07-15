// Debug Endpoint — Unified Context Builder.
//
// GET /api/debug/unified-context?platform=web&capabilities=auth
//
// Returns the unified, per-agent context bundle that UnifiedContextBuilder
// produces for each of the 8 canonical agent roles. This proves the
// "every agent receives only the information it needs" contract:
//   - requirements-analyst / planner       → no shared context, no graph queries
//   - solution-architect                     → reads plan + requirements
//   - frontend-generator                     → reads architecture + plan; queries models
//   - build-engineer                         → reads code:* targets; queries dependents
//   - test-generator                         → reads code:* + architecture; queries endpoints
//   - packaging-engineer                     → reads build:* + tests:web
//   - code-reviewer                          → reads code:* + architecture; queries functions + classes
//
// Response shape:
//   {
//     platform, capabilities,
//     declarations:  { [agent]: { sharedKeys, graphQueries } },
//     contexts:      [{ agent, memoryCount, skillCount, sharedKeys, graphQueries,
//                        estimatedTokens, summary }],
//     summary:       { totalAgents, totalEstimatedTokens, avgTokensPerAgent,
//                      minTokens, maxTokens }
//   }
//
// The endpoint seeds the SharedContext blackboard + ProjectMemory with
// representative build data (plan, architecture, code:web/windows/android,
// build:web, tests:web, memory records) so the per-agent slices are
// non-empty. The estimatedTokens values will DIFFER per agent — that
// difference is the proof that minimality is working (a context-bloated
// implementation would give every agent roughly the same token count).

import { NextResponse } from "next/server";
// Import through the engine index — this triggers orchestrator.bootstrap()
// AFTER orchestrator.ts has fully evaluated, avoiding a TDZ circular-dep crash.
import {
  unifiedContextBuilder,
  sharedContext,
  projectMemory,
} from "@/lib/engine";
import type { PlatformKind, Capability } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Valid platform kinds (used to safely coerce the `?platform=` query). */
const VALID_PLATFORMS: PlatformKind[] = [
  "windows",
  "web",
  "android",
  "cli",
  "library",
  "api",
  "plugin",
  "ios",
  "macos",
  "linux-desktop",
  "embedded",
  "game-engine",
  "browser-extension",
];

/** Valid capabilities (used to safely coerce `?capabilities=` values). */
const VALID_CAPABILITIES: Capability[] = [
  "opengl",
  "directx",
  "gpu",
  "bluetooth",
  "camera",
  "microphone",
  "location",
  "offline-sync",
  "realtime",
  "pdf",
  "printing",
  "barcode",
  "notifications",
  "payments",
  "auth",
  "encryption",
];

/** The 8 canonical agent roles (matches the declarations in unified-context.ts). */
const AGENTS = [
  "requirements-analyst",
  "planner",
  "solution-architect",
  "frontend-generator",
  "build-engineer",
  "test-generator",
  "packaging-engineer",
  "code-reviewer",
] as const;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // Resolve ?platform= (default: web)
    const platformParam = url.searchParams.get("platform") ?? "web";
    const platform: PlatformKind = VALID_PLATFORMS.includes(platformParam as PlatformKind)
      ? (platformParam as PlatformKind)
      : "web";

    // Resolve ?capabilities=auth,payments (default: [])
    const capsStr = url.searchParams.get("capabilities") ?? "";
    const capabilities: Capability[] = capsStr
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is Capability =>
        s.length > 0 && (VALID_CAPABILITIES as string[]).includes(s)
      );

    // -------------------------------------------------------------------
    // Step 1: Seed SharedContext + ProjectMemory with representative
    // build data so the per-agent slices are non-empty. This mirrors what
    // a real build would have written by the time each agent runs.
    // -------------------------------------------------------------------
    sharedContext.clear();
    sharedContext.write(
      "plan",
      "3-target CRM: Desktop (WinUI), Web (Next.js), Android (Compose)"
    );
    sharedContext.write(
      "architecture",
      "Contact entity, SQLite database, REST API"
    );
    sharedContext.write("code:web", [
      { path: "schema.prisma", content: "model Contact {...}" },
    ]);
    sharedContext.write("code:windows", [
      { path: "Contact.cs", content: "public class Contact {...}" },
    ]);
    sharedContext.write("code:android", [
      { path: "ContactEntity.kt", content: "@Entity data class Contact(...)" },
    ]);
    sharedContext.write("build:web", { success: true, fileCount: 19 });
    sharedContext.write("tests:web", { testCount: 5 });

    projectMemory.write("requirements", "Original Prompt", "CRM app", "user");
    projectMemory.write("architecture", "Database", "SQLite", "decision-engine");
    projectMemory.write("decision", "Stack", "Next.js + Prisma", "decision-engine");

    // -------------------------------------------------------------------
    // Step 2: Build a unified context for each agent. Each call pulls
    // ONLY that agent's declared slices (memory kinds from
    // ContextBuilder.defaultKindsFor, skills from injectSkills, shared
    // keys from AGENT_SHARED_KEYS, graph queries from
    // AGENT_GRAPH_QUERIES).
    // -------------------------------------------------------------------
    const contexts = AGENTS.map((agent) => {
      const ctx = unifiedContextBuilder.build(agent, {
        prompt: "CRM app with contacts",
        platform,
        capabilities,
      });
      return {
        agent,
        memoryCount: ctx.memory.length,
        skillCount: ctx.skills.length,
        sharedKeys: Object.keys(ctx.sharedContextSlice),
        graphQueries: Object.keys(ctx.graphQueries),
        estimatedTokens: ctx.estimatedTokens,
        summary: ctx.summary,
      };
    });

    // -------------------------------------------------------------------
    // Step 3: Build the roll-up summary. The key proof of minimality is
    // that estimatedTokens DIFFERS per agent — if every agent had the
    // same token count, it would mean the builder isn't actually
    // filtering. We also include min/max/avg for quick scanning.
    // -------------------------------------------------------------------
    const totalTokens = contexts.reduce((s, c) => s + c.estimatedTokens, 0);
    const tokenValues = contexts.map((c) => c.estimatedTokens);

    return NextResponse.json(
      {
        endpoint: "/api/debug/unified-context",
        description:
          "Shows the unified, per-agent context bundle that UnifiedContextBuilder produces. Each agent receives ONLY its declared slices — memory, skills, shared-context keys, and graph queries. The per-agent estimatedTokens values will DIFFER, proving minimality.",
        platform,
        capabilities,
        declarations: unifiedContextBuilder.getAllDeclarations(),
        contexts,
        summary: {
          totalAgents: contexts.length,
          totalEstimatedTokens: totalTokens,
          avgTokensPerAgent:
            contexts.length > 0
              ? Math.round(totalTokens / contexts.length)
              : 0,
          minTokens: tokenValues.length > 0 ? Math.min(...tokenValues) : 0,
          maxTokens: tokenValues.length > 0 ? Math.max(...tokenValues) : 0,
          // Minimality proof: distinct token counts across agents.
          distinctTokenCounts: new Set(tokenValues).size,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Unified context debug failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
