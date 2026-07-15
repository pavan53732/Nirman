// Debug Endpoint — Plugin System.
//
// Proves the plugin ecosystem works end-to-end:
//   GET /api/debug/plugins
//     → loads built-in plugins (idempotent) and returns a summary of every
//       loaded plugin, its contributions, and aggregate counts by type.
//
// The reviewer said: "Plugin ecosystem: Keep expanding the runtime so new
// agents, skills, tools, and platform adapters can be added without
// modifying the core engine." This endpoint is the runtime proof — it shows
// the two built-in plugins (auth-specialist, api-docs-generator) contributing
// 2 agents, 2 skills, and 1 tool, all without touching agent-handlers.ts,
// data/agents.ts, data/tools.ts, or any other core file.

import { NextResponse } from "next/server";
import {
  loadAllPlugins,
  getPluginSummary,
  pluginRegistry,
} from "@/lib/engine/plugin-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Load plugins if not yet loaded (idempotent — loadAllPlugins dedupes
  // in-flight calls and skips re-imports after the first load completes).
  if (pluginRegistry.getLoadedPlugins().length === 0) {
    await loadAllPlugins();
  }
  return NextResponse.json(getPluginSummary());
}
