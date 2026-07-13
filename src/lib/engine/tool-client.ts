"use client";

// Client-side tool invocation — calls the server-side /api/tools endpoint,
// which runs the real toolchain (npm, tsc, eslint, dotnet, cargo, gradle)
// via child_process. The browser cannot spawn processes directly.

import type { ToolInvocationArgs, ToolInvocationResult } from "./tool-manager";

export async function invokeToolClient(
  toolId: string,
  args: ToolInvocationArgs = {}
): Promise<ToolInvocationResult> {
  try {
    const res = await fetch("/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolId, args }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "request failed");
      return {
        exitCode: -1,
        stdout: "",
        stderr: `Tool API error (${res.status}): ${txt}`,
        durationMs: 0,
        success: false,
      };
    }
    const data = (await res.json()) as ToolInvocationResult;
    return data;
  } catch (err) {
    return {
      exitCode: -1,
      stdout: "",
      stderr: `Tool fetch failed: ${String(err)}`,
      durationMs: 0,
      success: false,
    };
  }
}
