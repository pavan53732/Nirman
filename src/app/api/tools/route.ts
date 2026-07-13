import { NextRequest, NextResponse } from "next/server";
import { toolManager, type ToolInvocationArgs } from "@/lib/engine/tool-manager";
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

interface ToolRequestBody {
  toolId: string;
  args?: ToolInvocationArgs;
}

export async function POST(req: NextRequest) {
  let body: ToolRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { toolId, args = {} } = body;
  if (!toolId) {
    return NextResponse.json({ error: "toolId is required" }, { status: 400 });
  }

  const tool = registries.tools.get(toolId);
  if (!tool) {
    return NextResponse.json(
      { error: `Tool '${toolId}' not registered` },
      { status: 404 }
    );
  }

  try {
    const result = await toolManager.invoke(toolId, args);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: `Tool invocation failed: ${String(err)}` },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    tools: registries.tools.all().map((t) => ({ id: t.id, name: t.name, category: t.category })),
  });
}
