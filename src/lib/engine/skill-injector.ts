// SkillInjector — determines which SKILL.md files are relevant to a given
// agent and loads their content for injection into the agent's execution
// context (the `skills: SkillContent[]` field of AgentExecutionContext).
//
// DESIGN (per architectural review):
//   "Skills drive decisions → Decisions activate agents → Agents spawn
//    sub-agents → Sub-agents use tools → Tools feed memory → Memory
//    influences planning."
//
// Before this module existed, skills were LOADED (skills/loader.ts reads
// /skills/<name>/SKILL.md) but never INJECTED — agents ran without seeing
// the endorsed patterns. This module closes that gap: given an agent role
// + platform + detected capabilities, it returns the SkillContent[] the
// agent should receive.
//
// Mapping logic:
//   - planner              → web/data/auth patterns (planning skills)
//   - solution-architect   → cross-platform data modeling skills
//   - frontend-generator   → platform-specific UI skills (web/windows/android)
//   - build-engineer       → build-tool skills (tsc, npm, xml, gradle)
//   - test-generator       → test/validation skills
//   - packaging-engineer   → packaging skills (npm, xml, gradle)
//   - code-reviewer        → validation skills (tsc, xml, gradle)
//
// The injector also filters by capability: if "auth" is detected, the
// next-auth skill is injected into ALL injectable agents that touch auth.
//
// BROWSER-SAFETY: This module is imported transitively through the engine
// index, which is imported by client components (chat-panel.tsx etc.). It
// therefore MUST be browser-safe — no static import of `skills/loader.ts`
// (which uses Node's `fs`). Real SKILL.md content is loaded lazily by
// `enrichSkillsWithLoaderContent()` via a dynamic import that is only
// invoked when `typeof window === "undefined"`.

import type { SkillContent } from "./agent-contracts";
import type { AgentRole, PlatformKind, Capability } from "./types";
import { SKILLS } from "./skills/registry";

/**
 * Agent role → list of skill IDs the agent should receive.
 *
 * Skill IDs come from the engine's skill registry (skills/registry.ts) which
 * enumerates the concrete generator skills per platform (web/windows/android).
 * The SkillInjector resolves each ID to a SkillContent object.
 */
const AGENT_SKILL_MAP: Record<string, string[]> = {
  // Layer 1 — Executive
  planner: ["nextjs-app-router", "prisma-sqlite", "next-auth", "crud-table", "api-routes"],
  orchestrator: [], // gate-keeping; no skill injection needed
  // Layer 2 — Architecture
  "solution-architect": [
    "prisma-sqlite",
    "efcore-sqlite-conditional",
    "room-conditional",
  ],
  // Layer 3 — Engineering (frontend-generator is platform-filtered at runtime)
  "frontend-generator": [
    // web
    "nextjs-app-router",
    "react-server-components",
    "tailwind",
    "crud-table",
    "api-routes",
    // windows
    "winui3-dotnet8",
    "xaml-datagrid-form",
    "observable-object-relaycommand",
    // android
    "kotlin-compose",
    "navigation-compose",
    "hilt-di",
    "lazycolumn-crud",
    "material3",
  ],
  // Layer 4 — Quality & Delivery
  "build-engineer": [
    "tsc-validation",
    "npm-build",
    "xml-validation",
    "gradle-kts-validation",
    "sln-csproj-generation",
  ],
  "test-generator": ["tsc-validation"],
  "packaging-engineer": ["npm-build", "xml-validation", "gradle-kts-validation"],
  "code-reviewer": ["tsc-validation", "xml-validation", "gradle-kts-validation"],
};

/**
 * Capability → additional skill IDs injected into ALL injectable agents.
 * When a capability is detected at runtime (by the Decision Engine), every
 * injectable agent gets these skills added to its context.
 */
const CAPABILITY_SKILL_MAP: Partial<Record<Capability, string[]>> = {
  auth: ["next-auth"],
  "offline-sync": ["efcore-sqlite-conditional", "room-conditional"],
};

/**
 * Some skill IDs map to real /skills/<folder>/SKILL.md files on disk. When
 * such a mapping exists, the injector notes the folder so consumers (or the
 * server-side loader, via `enrichSkillsWithLoaderContent`) can fetch the
 * full markdown. The mapping is optional; the synthesized content stands on
 * its own when no folder matches.
 */
const SKILL_ID_TO_FOLDER: Record<string, string> = {
  "next-auth": "auth",
  // Future: add mappings as new SKILL.md files become available. For
  // example, when a /skills/nextjs-app-router/SKILL.md is added, map
  // "nextjs-app-router" → "nextjs-app-router".
};

/** Agents that participate in skill injection (excludes pure gatekeepers). */
const INJECTABLE_AGENTS = [
  "planner",
  "solution-architect",
  "frontend-generator",
  "build-engineer",
  "test-generator",
  "packaging-engineer",
  "code-reviewer",
] as const;

/**
 * Inject skills for a given agent role + context.
 *
 * Returns the SkillContent[] to pass to the agent's execution context. The
 * agent reads each skill's `content` to learn the endorsed patterns for the
 * platform/capability combination it's about to act on.
 *
 * Sync and browser-safe — does NOT touch the filesystem. The returned
 * SkillContent objects carry a synthesized summary plus a `folder` pointer
 * (encoded inside `content`) to the canonical /skills/<folder>/SKILL.md.
 * Call `enrichSkillsWithLoaderContent()` (server-side, async) to replace
 * the synthesized content with the real SKILL.md markdown.
 */
export function injectSkills(
  agent: string,
  opts: { platform?: PlatformKind; capabilities?: Capability[] } = {}
): SkillContent[] {
  const baseSkillIds = AGENT_SKILL_MAP[agent] ?? [];
  const capSkillIds = (opts.capabilities ?? []).flatMap(
    (c) => CAPABILITY_SKILL_MAP[c] ?? []
  );

  // For frontend-generator, narrow the skill set to the chosen platform so
  // the agent doesn't see irrelevant skills (e.g. winui3 when target is web).
  let platformFiltered = baseSkillIds;
  if (agent === "frontend-generator" && opts.platform) {
    platformFiltered = filterByPlatform(baseSkillIds, opts.platform);
  }

  // Dedupe: a capability skill may overlap with a base skill.
  const allSkillIds = [...new Set([...platformFiltered, ...capSkillIds])];

  return allSkillIds
    .map((id) => loadSkillContent(id, agent as AgentRole))
    .filter((s): s is SkillContent => s !== null);
}

/**
 * Narrow a skill list by platform. Each platform has its own generator
 * family enumerated in skills/registry.ts; the frontend-generator only
 * needs the skills for the target platform.
 *
 * We intersect with the registry's per-platform arrays (rather than regex
 * matching) so skill IDs like "lazycolumn-crud" don't accidentally leak
 * through the web filter via the substring "crud". For platforms without
 * their own skill family (cli, library, api, plugin, ios, …), we default
 * to the web skill set.
 */
function filterByPlatform(skillIds: string[], platform: PlatformKind): string[] {
  const platformSkills: ReadonlySet<string> = (() => {
    if (platform === "windows") return new Set(SKILLS.windows as readonly string[]);
    if (platform === "android") return new Set(SKILLS.android as readonly string[]);
    // web + cli + library + api + plugin + ios + macos + linux-desktop +
    // embedded + game-engine + browser-extension → default to web skills.
    return new Set(SKILLS.web as readonly string[]);
  })();
  return skillIds.filter((id) => platformSkills.has(id));
}

/**
 * Resolve a skill ID to a SkillContent object. Uses the registry metadata
 * to determine the platform; synthesizes a markdown body that tells the
 * agent what the skill does and where the canonical SKILL.md lives.
 *
 * This function is browser-safe and never throws — if a skill ID is
 * unknown (not in the registry and not in SKILL_ID_TO_FOLDER), it returns
 * null so the caller can filter it out.
 */
function loadSkillContent(skillId: string, agentRole: AgentRole): SkillContent | null {
  const platform = getSkillPlatform(skillId);
  const hasFolderOverride = skillId in SKILL_ID_TO_FOLDER;
  if (!platform && !hasFolderOverride) {
    // Unknown skill ID — refuse to inject rather than emit garbage.
    return null;
  }

  const folder = SKILL_ID_TO_FOLDER[skillId] ?? skillId;
  const title = prettify(skillId);
  const category = platform ?? "general";

  return {
    id: skillId,
    title,
    category,
    content: synthesize(skillId, title, platform, folder),
    relevantTo: agentRole,
  };
}

/**
 * Find the platform a skill ID belongs to (web/windows/android), or null if
 * the ID isn't in the registry.
 */
function getSkillPlatform(skillId: string): string | null {
  for (const platform of Object.keys(SKILLS) as Array<keyof typeof SKILLS>) {
    if ((SKILLS[platform] as readonly string[]).includes(skillId)) {
      return platform;
    }
  }
  return null;
}

/** Convert "nextjs-app-router" → "Nextjs App Router". */
function prettify(skillId: string): string {
  return skillId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Build a SkillContent body for skills that don't have a real SKILL.md
 * folder on disk. The synthesized content tells the agent what the skill
 * does and where to look for the canonical SKILL.md if one is later added.
 */
function synthesize(
  skillId: string,
  title: string,
  platform: string | null,
  folder: string
): string {
  return [
    `# Skill: ${title}`,
    ``,
    `- **ID**: \`${skillId}\``,
    `- **Platform**: ${platform ?? "general"}`,
    `- **SKILL.md**: \`/skills/${folder}/SKILL.md\` (loaded by skills/loader.ts when present)`,
    ``,
    `This skill is registered in the engine's skill registry (skills/registry.ts).`,
    `It corresponds to a concrete generator function in src/lib/engine/generators/`,
    `that produces the source artifacts this skill endorses for the ${platform ?? "target"} platform.`,
    ``,
    `When the consuming agent runs, it should treat this skill ID as the`,
    `authoritative identifier and follow the endorsed patterns. If a real`,
    `\`/skills/${folder}/SKILL.md\` file exists on disk, the server-side loader`,
    `(skills/loader.ts) replaces this synthesized body with the full markdown`,
    `endorsement (see \`enrichSkillsWithLoaderContent()\`).`,
  ].join("\n");
}

/**
 * Server-side only: enrich a SkillContent[] with the REAL SKILL.md markdown
 * loaded from /skills/<folder>/SKILL.md. Browser-safe no-op: returns the
 * input unchanged when `typeof window !== "undefined"`.
 *
 * Uses a dynamic `import()` of the loader so this module stays browser-safe.
 * The loader is only loaded when this function is actually called on the
 * server (e.g. from an API route).
 */
export async function enrichSkillsWithLoaderContent(
  skills: SkillContent[]
): Promise<SkillContent[]> {
  if (skills.length === 0) return skills;
  if (typeof window !== "undefined") return skills; // browser no-op
  try {
    const loader = await import("./skills/loader");
    const getSkill = loader.getSkill;
    return skills.map((s) => {
      const folder = SKILL_ID_TO_FOLDER[s.id] ?? s.id;
      const real = getSkill(folder);
      if (!real) return s;
      return {
        ...s,
        title: real.name || s.title,
        category: real.category || s.category,
        content: real.content, // raw SKILL.md markdown
      };
    });
  } catch {
    // Loader unavailable (e.g. fs missing). Return inputs unchanged.
    return skills;
  }
}

/**
 * Get a human-readable summary of which skills would be injected for each
 * agent. Used by the debug endpoint (/api/debug/skill-injection) to inspect
 * the injection plan without running a full build.
 */
export function getInjectionPlan(
  opts: { platform?: PlatformKind; capabilities?: Capability[] } = {}
): Record<string, { skillIds: string[]; count: number }> {
  const plan: Record<string, { skillIds: string[]; count: number }> = {};
  for (const agent of INJECTABLE_AGENTS) {
    const skills = injectSkills(agent, opts);
    plan[agent] = {
      skillIds: skills.map((s) => s.id),
      count: skills.length,
    };
  }
  return plan;
}

/**
 * Read-only accessors for the maps (used by tests + the debug endpoint to
 * explain WHY a skill was injected).
 */
export function getAgentSkillMap(): Record<string, string[]> {
  return { ...AGENT_SKILL_MAP };
}

export function getCapabilitySkillMap(): Partial<Record<Capability, string[]>> {
  return { ...CAPABILITY_SKILL_MAP };
}

export function getSkillFolder(skillId: string): string | undefined {
  return SKILL_ID_TO_FOLDER[skillId] ?? undefined;
}
