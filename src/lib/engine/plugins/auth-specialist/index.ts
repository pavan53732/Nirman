// Plugin: auth-specialist
//
// Self-contained plugin that contributes:
//   - An "auth-specialist" agent handler (produces an auth implementation plan)
//   - An "auth-implementation" skill (SKILL.md-style markdown content)
//   - An "auth-linter" tool (CLI command for linting auth patterns)
//
// Importing this module is sufficient to register the contributions — the
// call to `loadPlugin(manifest, register)` at the bottom performs the
// side-effecting registration against the shared `pluginRegistry`.

import type { PluginManifest, PluginRegistry } from "../../plugin-system";
import { loadPlugin } from "../../plugin-system";

const manifest: PluginManifest = {
  name: "auth-specialist",
  version: "1.0.0",
  description: "Adds an Authentication Specialist agent that provides auth implementation guidance",
  author: "Nirman Plugin Team",
  apiVersion: 1,
};

function register(registry: PluginRegistry): void {
  // Register a new agent handler. The handler mirrors the AgentHandler
  // contract: pure function (ctx) -> AgentExecutionResult.
  registry.registerAgent(
    "auth-specialist",
    async (ctx) => {
      const report =
        `[Auth Specialist] Authentication implementation report\n\n` +
        `For: ${ctx.prompt}\n` +
        `Recommended approach: NextAuth.js with JWT sessions\n` +
        `Providers: Credentials, Google, GitHub\n` +
        `Session storage: HTTP-only cookies\n` +
        `CSRF protection: enabled by default`;
      return {
        status: "success",
        output: report,
        memoryWrites: [
          {
            kind: "architecture" as const,
            title: "Auth Implementation Plan",
            content: report,
          },
        ],
        sharedWrites: [{ key: "specialist:auth", value: report }],
      };
    },
    { label: "Sentinel", layer: "Layer 6: Dynamic" }
  );

  // Register a related skill. The content is the raw SKILL.md markdown that
  // would be injected into the auth-specialist agent's execution context.
  registry.registerSkill({
    id: "auth-implementation",
    title: "Authentication Implementation",
    category: "security",
    content:
      "# Authentication Implementation\n\n" +
      "Use NextAuth.js for web, ASP.NET Core Identity for Windows, and Firebase Auth for Android.\n\n" +
      "## Key patterns\n- JWT sessions\n- HTTP-only cookies\n- CSRF tokens\n- Rate limiting",
    relevantTo: "auth-specialist",
  });

  // Register a tool. Tools are exposed as CLI commands the orchestrator can
  // invoke via the existing tool-client bridge.
  registry.registerTool({
    id: "auth-linter",
    name: "Auth Linter",
    description: "Checks authentication patterns in generated code",
    command: "npx auth-linter",
  });
}

// Side-effecting registration — runs on import.
loadPlugin(manifest, register);
