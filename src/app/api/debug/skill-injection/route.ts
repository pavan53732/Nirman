// Debug Endpoint — Skill Injection Plan.
//
// GET /api/debug/skill-injection?platform=web&capabilities=auth,payments
//
// Returns the skill injection plan: which SKILL.md files get injected into
// which agent's execution context, given a target platform and detected
// capabilities. Also returns a sample (frontend-generator) with the full
// SkillContent body so the caller can inspect what each agent actually
// receives.
//
// Response shape:
//   {
//     platform: "web" | "windows" | "android" | undefined,
//     capabilities: Capability[],
//     injectionPlan: { [agent]: { skillIds: string[], count: number } },
//     sample: {
//       agent: "frontend-generator",
//       skills: [{ id, title, category, contentLength, contentSource }]
//     },
//     maps: {
//       agentSkillMap,      // explanatory: agent → base skill IDs
//       capabilitySkillMap  // explanatory: capability → injected skill IDs
//     }
//   }
//
// `contentSource` is "real-skills-md" when the server-side loader found a
// real /skills/<folder>/SKILL.md file, otherwise "synthesized".

import { NextResponse } from "next/server";
import {
  injectSkills,
  getInjectionPlan,
  enrichSkillsWithLoaderContent,
  getAgentSkillMap,
  getCapabilitySkillMap,
  getSkillFolder,
} from "@/lib/engine/skill-injector";
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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // Resolve ?platform=
    const platformParam = url.searchParams.get("platform") ?? undefined;
    const platform: PlatformKind | undefined =
      platformParam && VALID_PLATFORMS.includes(platformParam as PlatformKind)
        ? (platformParam as PlatformKind)
        : undefined;

    // Resolve ?capabilities=auth,payments
    const capsStr = url.searchParams.get("capabilities") ?? "";
    const capabilities: Capability[] = capsStr
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is Capability =>
        s.length > 0 && (VALID_CAPABILITIES as string[]).includes(s)
      );

    // Build the per-agent injection plan.
    const injectionPlan = getInjectionPlan({ platform, capabilities });

    // Build a sample for frontend-generator with the full SkillContent body.
    const sampleAgent = "frontend-generator";
    const sampleSkillsRaw = injectSkills(sampleAgent, { platform, capabilities });
    const sampleSkills = await enrichSkillsWithLoaderContent(sampleSkillsRaw);

    return NextResponse.json(
      {
        platform,
        capabilities,
        injectionPlan,
        sample: {
          agent: sampleAgent,
          skills: sampleSkills.map((s) => {
            const folder = getSkillFolder(s.id);
            const isReal =
              !!folder &&
              s.content.length > 0 &&
              // The synthesized body starts with `# Skill:`. Real SKILL.md
              // files have YAML frontmatter (`---`) or a different H1.
              !s.content.startsWith("# Skill:");
            return {
              id: s.id,
              title: s.title,
              category: s.category,
              contentLength: s.content.length,
              contentSource: isReal ? "real-skills-md" : "synthesized",
              contentPreview: s.content.slice(0, 240),
            };
          }),
        },
        maps: {
          agentSkillMap: getAgentSkillMap(),
          capabilitySkillMap: getCapabilitySkillMap(),
        },
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Skill injection debug failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
