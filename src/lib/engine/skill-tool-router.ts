// SkillToolRouter — maps injected skills to recommended tools.
//
// DESIGN (per Runtime V2 Audit, Phase 3 Step 11):
//   "Skills become executable reasoning assets. Agent reads Skills → reasons
//    → chooses Tool → executes Tool."
//
// Before this module existed, the SkillInjector (skill-injector.ts) injected
// SKILL.md content into an agent's execution context (the `skills:
// SkillContent[]` field of AgentExecutionContext), but agents had no way to
// translate those skills into concrete tool choices. The build-engineer would
// see "tsc-validation" in its context and… do nothing differently.
//
// This module closes that gap. Given a list of skill IDs (typically the IDs
// of the SkillContent[] an agent received), it returns ToolRecommendation[]
// — a list of tool IDs the agent should consider invoking, each annotated
// with the skill that recommended it and a human-readable reason.
//
// The recommendations are ADDITIVE: the agent handler may already have its
// own tool selection logic (e.g. from a task's `toolId` field). Skill-driven
// recommendations do NOT replace that — they supplement it. The handler is
// free to use either source, or merge them, with skill recommendations
// winning only when the handler has no other source of truth.
//
// BACKWARD COMPATIBILITY:
//   - The map is a pure data structure. No existing module is modified to
//     create it.
//   - `recommendTools()` is pure and never throws — unknown skill IDs simply
//     contribute no recommendations.
//   - The tool IDs returned are *advisory*. The agent handler is expected
//     to verify the tool is registered (via data/tools.ts) before actually
//     invoking it. A recommendation for an unregistered tool (e.g. "tsc"
//     when only "npm-build" is registered) is logged but not executed.
//
// BROWSER-SAFETY: This module is imported transitively through the engine
// index, which is imported by client components (chat-panel.tsx etc.). It
// therefore MUST be browser-safe — no Node `fs`, no dynamic imports of
// server-only modules. Pure data + pure functions.

/**
 * Mapping: skill ID → list of tool IDs the skill endorses.
 *
 * Tool IDs are the `id` field of the Tool interface (see types.ts / tools.ts).
 * A skill may recommend multiple tools (e.g. "nextjs-app-router" endorses both
 * "tsc" for type-checking and "npm-build" for bundling).
 *
 * The map is intentionally permissive: it MAY recommend tool IDs that aren't
 * in the static registry yet (e.g. "tsc", "xml-validate", "gradle-validate").
 * Those recommendations serve as forward-looking hints — when the registry is
 * later extended to include them, the recommendations become immediately
 * actionable without any change here.
 */
const SKILL_TO_TOOL_MAP: Record<string, string[]> = {
  // ── Web skills → web tools ──────────────────────────────────────────
  "tsc-validation": ["tsc"],
  "npm-build": ["npm-build"],
  "nextjs-app-router": ["tsc", "npm-build"],
  "prisma-sqlite": ["npm-build"],
  "next-auth": ["tsc"],
  "crud-table": ["tsc"],
  "api-routes": ["tsc"],
  "tailwind": ["tsc"],
  "react-server-components": ["tsc"],

  // ── Windows skills → windows tools ──────────────────────────────────
  "xml-validation": ["xml-validate"],
  "sln-csproj-generation": ["xml-validate"],
  "winui3-dotnet8": ["xml-validate"],
  "efcore-sqlite-conditional": ["xml-validate"],
  "xaml-datagrid-form": ["xml-validate"],
  "observable-object-relaycommand": ["xml-validate"],

  // ── Android skills → android tools ──────────────────────────────────
  "gradle-kts-validation": ["gradle-validate"],
  "kotlin-compose": ["gradle-validate"],
  "room-conditional": ["gradle-validate"],
  "hilt-di": ["gradle-validate"],
  "navigation-compose": ["gradle-validate"],
  "lazycolumn-crud": ["gradle-validate"],
  "material3": ["gradle-validate"],
};

/**
 * A single tool recommendation — the tool ID, why it was recommended, and
 * which skill recommended it.
 */
export interface ToolRecommendation {
  /** The tool ID (matches `Tool.id` in data/tools.ts when registered). */
  toolId: string;
  /** Human-readable explanation (used in logs + debug output). */
  reason: string;
  /** The skill ID that recommended this tool. */
  recommendedBy: string;
}

/**
 * Get tool recommendations based on injected skills.
 *
 * Deduplicates by tool ID — if multiple skills recommend the same tool, only
 * the first recommendation (in skill-list order) is kept. The recommendation
 * retains the *first* skill that suggested it; the others are implicitly
 * folded in (the dedupe key is the tool ID, not the (skill,tool) pair).
 *
 * Pure and total — never throws. Unknown skill IDs contribute nothing.
 *
 * @example
 *   recommendTools(["tsc-validation", "npm-build"])
 *   // → [
 *   //     { toolId: "tsc", reason: "Recommended by skill \"tsc-validation\"",
 *   //       recommendedBy: "tsc-validation" },
 *   //     { toolId: "npm-build", reason: "Recommended by skill \"npm-build\"",
 *   //       recommendedBy: "npm-build" },
 *   //   ]
 */
export function recommendTools(skillIds: string[]): ToolRecommendation[] {
  const recommendations: ToolRecommendation[] = [];
  const seen = new Set<string>();

  for (const skillId of skillIds) {
    const toolIds = SKILL_TO_TOOL_MAP[skillId] ?? [];
    for (const toolId of toolIds) {
      if (!seen.has(toolId)) {
        seen.add(toolId);
        recommendations.push({
          toolId,
          reason: `Recommended by skill "${skillId}"`,
          recommendedBy: skillId,
        });
      }
    }
  }

  return recommendations;
}

/**
 * Get the full skill → tool mapping (for debugging + the /api/debug/skill-tools
 * endpoint). Returns a shallow copy so callers can't mutate the internal map.
 */
export function getSkillToolMap(): Record<string, string[]> {
  return { ...SKILL_TO_TOOL_MAP };
}
