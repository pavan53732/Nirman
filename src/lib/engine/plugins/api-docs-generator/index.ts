// Plugin: api-docs-generator
//
// Self-contained plugin that contributes:
//   - An "api-docs-generator" agent handler (produces an OpenAPI 3.0 spec)
//   - An "openapi-generation" skill (markdown guidance for the agent)
//
// Demonstrates that plugins can register agents for roles that are NOT in
// the strict AgentRole union — the plugin system stores handlers by string
// role, so new specialists can be added without editing types.ts.

import type { PluginManifest, PluginRegistry } from "../../plugin-system";
import { loadPlugin } from "../../plugin-system";

const manifest: PluginManifest = {
  name: "api-docs-generator",
  version: "1.0.0",
  description: "Adds an API Documentation Generator agent that produces OpenAPI specs from generated routes",
  author: "Nirman Plugin Team",
  apiVersion: 1,
};

function register(registry: PluginRegistry): void {
  registry.registerAgent(
    "api-docs-generator",
    async (ctx) => {
      const spec =
        `openapi: 3.0.0\n` +
        `info:\n` +
        `  title: ${ctx.prompt}\n` +
        `  version: 1.0.0\n` +
        `paths:\n` +
        `  /api/contacts:\n` +
        `    get:\n` +
        `      summary: List contacts\n` +
        `    post:\n` +
        `      summary: Create contact\n` +
        `  /api/contacts/{id}:\n` +
        `    get:\n` +
        `      summary: Get contact\n` +
        `    put:\n` +
        `      summary: Update contact\n` +
        `    delete:\n` +
        `      summary: Delete contact`;
      return {
        status: "success",
        output: `Generated OpenAPI spec for ${ctx.prompt}`,
        artifacts: [{ path: "openapi.yaml", content: spec }],
        memoryWrites: [
          {
            kind: "artifact" as const,
            title: "OpenAPI Spec",
            content: spec,
          },
        ],
      };
    },
    { label: "Scribe", layer: "Layer 6: Dynamic" }
  );

  registry.registerSkill({
    id: "openapi-generation",
    title: "OpenAPI Generation",
    category: "documentation",
    content:
      "# OpenAPI Generation\n\n" +
      "Generate OpenAPI 3.0 specs from Next.js API routes.\n\n" +
      "## Pattern\n" +
      "- Parse route.ts files\n" +
      "- Extract HTTP methods (GET, POST, PUT, DELETE)\n" +
      "- Generate path entries\n" +
      "- Include request/response schemas from Prisma models",
    relevantTo: "api-docs-generator",
  });
}

// Side-effecting registration — runs on import.
loadPlugin(manifest, register);
