// Debug Endpoint — Skill→Tool Recommendations + Model Router demo.
//
// GET /api/debug/skill-tools?platform=web&capabilities=auth
//
// Returns, per agent:
//   - the skills that would be injected (via SkillInjector)
//   - the tools those skills recommend (via SkillToolRouter.recommendTools)
//   - the model the Model Router would select for that agent's LLM capability
//
// This endpoint is the Wave 4B demo (Runtime V2 Audit, Phase 3 Steps 11+12):
//   "Skills become executable reasoning assets. Agent reads Skills → reasons
//    → chooses Tool → executes Tool."
//   "No subsystem chooses models directly — all go through Model Router."
//
// Response shape:
//   {
//     platform: "web" | "windows" | "android" | ...,
//     capabilities: Capability[],
//     skillToolMap: { [skillId]: toolId[] },
//     agentRecommendations: [
//       {
//         agent: "build-engineer",
//         skills: ["tsc-validation", "npm-build", ...],
//         toolRecommendations: [
//           { toolId: "tsc", reason: "...", recommendedBy: "tsc-validation" },
//           ...
//         ],
//         modelChoice: {
//           providerId: "openai", modelId: "gpt-4o", providerType: "remote"
//         } | null
//       },
//       ...
//     ]
//   }

import { NextResponse } from "next/server";
import { injectSkills } from "@/lib/engine/skill-injector";
import {
  recommendTools,
  getSkillToolMap,
} from "@/lib/engine/skill-tool-router";
import { modelRouter } from "@/lib/engine/provider-abstraction";
import type {
  PlatformKind,
  Capability,
  AgentRole,
  ProviderCapability,
} from "@/lib/engine/types";

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

/**
 * The agents whose skill→tool recommendations + model routing we surface.
 * Mirrors the injectable agents in skill-injector.ts plus the build/test/
 * packaging handlers (which are the primary Wave 4B integration points).
 */
const AGENTS: AgentRole[] = [
  "planner",
  "solution-architect",
  "frontend-generator",
  "build-engineer",
  "test-generator",
  "packaging-engineer",
];

/** The provider capability most agents need (text completion). */
const DEFAULT_CAPABILITY: ProviderCapability = "llm";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // Resolve ?platform=
    const platformParam = url.searchParams.get("platform") ?? "web";
    const platform: PlatformKind = VALID_PLATFORMS.includes(
      platformParam as PlatformKind
    )
      ? (platformParam as PlatformKind)
      : "web";

    // Resolve ?capabilities=auth,payments
    const capsStr = url.searchParams.get("capabilities") ?? "";
    const capabilities: Capability[] = capsStr
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is Capability =>
        s.length > 0 && (VALID_CAPABILITIES as string[]).includes(s)
      );

    // Resolve ?capability=llm (the provider capability to route for; defaults
    // to "llm" since most agents do text completion).
    const capParam = url.searchParams.get("capability") ?? DEFAULT_CAPABILITY;
    const providerCapability: ProviderCapability = (
      [
        "llm",
        "embedding",
        "speech-tts",
        "speech-asr",
        "image-generation",
        "ocr",
        "vector-db",
      ] as ProviderCapability[]
    ).includes(capParam as ProviderCapability)
      ? (capParam as ProviderCapability)
      : DEFAULT_CAPABILITY;

    // Build per-agent recommendations + model routing.
    const agentRecommendations = AGENTS.map((agent) => {
      const skills = injectSkills(agent, { platform, capabilities });
      const skillIds = skills.map((s) => s.id);
      const toolRecommendations = recommendTools(skillIds);

      // Model Router integration — same call the agent handlers now make via
      // deriveSkillToolContext(). Returns null when no connected provider
      // offers the requested capability.
      const routed = modelRouter.select(providerCapability, agent);
      const modelChoice = routed
        ? {
            providerId: routed.provider.id,
            modelId: routed.model.id,
            providerType: routed.provider.type,
          }
        : null;

      return {
        agent,
        skills: skillIds,
        toolRecommendations,
        modelChoice,
      };
    });

    return NextResponse.json(
      {
        platform,
        capabilities,
        providerCapability,
        skillToolMap: getSkillToolMap(),
        agentRecommendations,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Skill-tools debug failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
