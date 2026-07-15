// Debug Endpoint — Sandbox abstraction.
//
// Proves the Sandbox layer works end-to-end:
//   GET /api/debug/sandbox
//     → lists all 7 execution profiles (web, windows, android, cli, api,
//       library, plugin) with their timeoutMs + maxOutputBytes ceilings.
//
//   POST /api/debug/sandbox  body: { profile, toolId, cwd, args?, files?, env?, timeoutMs? }
//     → executes the tool inside the matching sandbox profile and returns
//       the full SandboxResult (stdout, stderr, artifacts, metrics, logs).
//
// This endpoint is the runtime proof that the V2 architecture's "every build
// executes inside a Sandbox" requirement is wired up. The Sandbox delegates
// the actual process spawn to ToolManager.invoke() and wraps the result with
// artifact parsing + metric collection.

import { NextResponse } from "next/server";
import { sandbox } from "@/lib/engine/sandbox";
import { ToolManager } from "@/lib/engine/tool-manager";
import { registries } from "@/lib/engine/registries";
import { skills } from "@/lib/engine/data/skills";
import { tools } from "@/lib/engine/data/tools";
import { agents } from "@/lib/engine/data/agents";
import { platformAdapters, previewProviders, providers } from "@/lib/engine/data/adapters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bootstrap registries server-side (the engine index is client-focused due to
// IndexedDB, so we register server-side here for the tool manager).
registries.skills.registerAll(skills);
registries.tools.registerAll(tools);
registries.agents.registerAll(agents);
registries.platformAdapters.registerAll(platformAdapters);
registries.previewProviders.registerAll(previewProviders);
registries.providers.registerAll(providers);

// Inject a real ToolManager into the singleton Sandbox. We import ToolManager
// directly here (NOT via @/lib/engine) because this is a server-only route —
// importing it through the engine index would pull `child_process` into the
// client bundle and break the browser build.
sandbox.setToolManager(new ToolManager());

export async function GET() {
  const profiles = sandbox.listProfiles();
  const profileEntries = Object.entries(profiles).map(([id, config]) => ({
    id,
    timeoutMs: config.timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
  }));

  return NextResponse.json({
    profileCount: profileEntries.length,
    profiles: profileEntries,
    availableTools: registries.tools.all().map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      timeoutMs: t.timeoutMs,
    })),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const profile = body.profile ?? "web";
    const toolId = body.toolId;

    if (!toolId || typeof toolId !== "string") {
      return NextResponse.json(
        { error: "Missing required field: toolId (string)" },
        { status: 400 },
      );
    }

    const result = await sandbox.execute({
      profile,
      toolId,
      cwd: body.cwd,
      timeoutMs: body.timeoutMs,
      args: body.args,
      files: body.files,
      env: body.env,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
