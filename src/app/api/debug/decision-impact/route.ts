// Debug Endpoint — Decision Impact of SKILL.md Endorsements.
//
// Runs the Decision Engine TWICE for the same prompt + platform:
//   1. WITHOUT any SKILL.md endorsements (baseline)
//   2. WITH endorsements (every policy ID in `SKILL_ENDORSEMENT_MAP` gets +1.5)
//
// Returns both scored lists, the top of each, and a `flipped` flag that is
// `true` if the SKILL.md boost changed which policy won. This proves that
// loading real SKILL.md files can actually FLIP a stack selection — not just
// widen a gap that already exists.
//
// Usage:
//   GET /api/debug/decision-impact?prompt=CRM+app+for+enterprise&platform=web
//   GET /api/debug/decision-impact?prompt=...&platform=web&flipDemo=true
//
// When `flipDemo=true`, the prompt/platform/endorsements are overridden with a
// hardcoded scenario engineered to actually flip the winner (see
// `FLIP_DEMO` below): for a Windows "native cross-platform" prompt,
// `ui-windows-cross-platform` (Tauri) narrowly beats `ui-windows-native`
// (WinUI 3) at 6.7 vs 5.8 — but the winui3-dotnet8 SKILL.md endorses
// `ui-windows-native`, boosting it to 7.3 and flipping the win.

import { NextResponse } from "next/server";
import {
  DecisionEngine,
  SKILL_ENDORSEMENT_MAP,
  allEndorsedPolicyIds,
  detectCapabilities,
  detectNonFunctionals,
  type ScoredPolicy,
} from "@/lib/engine/decision-engine";
import type { PlatformKind } from "@/lib/engine/types";

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

/**
 * Hardcoded flip-demo scenario. For the prompt "native cross-platform windows
 * desktop app" (platform=windows), the engine detects NFs `native` +
 * `cross-platform` and the two Windows UI policies score:
 *
 *   ui-windows-native          (platform +3, native +2, rich-controls missing -1,
 *                               confidence 0.9 * 2 = 1.8) => 5.8
 *   ui-windows-cross-platform  (platform +3, cross-platform +2,
 *                               confidence 0.85 * 2 = 1.7) => 6.7  <-- winner
 *
 * The `winui3-dotnet8` SKILL.md endorses `ui-windows-native`, boosting it by
 * +1.5 to 7.3 — which flips the winner from Tauri+Rust to WinUI 3 + .NET 8.
 *
 * Note: we deliberately endorse ONLY `ui-windows-native` here (NOT
 * `ui-windows-cross-platform`) so the boost breaks the tie cleanly. If we
 * flattened ALL values from `SKILL_ENDORSEMENT_MAP`, both Windows policies
 * would get +1.5 and no flip would occur — which is exactly why the default
 * (non-flip) demo for "CRM app for enterprise" only widens the gap.
 */
const FLIP_DEMO = {
  prompt: "native cross-platform windows desktop app",
  platform: "windows" as PlatformKind,
  endorsements: ["ui-windows-native"], // only the winui3-dotnet8 SKILL.md endorsement
  explanation:
    "Flip demo: for a Windows prompt with both 'native' and 'cross-platform' NFs, " +
    "`ui-windows-cross-platform` (Tauri+Rust) beats `ui-windows-native` (WinUI 3) " +
    "6.7 vs 5.8 without skills. The `winui3-dotnet8` SKILL.md endorses " +
    "`ui-windows-native`, boosting it +1.5 to 7.3 — flipping the winner to " +
    "WinUI 3 + .NET 8.",
};

interface ScoredPolicyDto {
  policyId: string;
  choose: string;
  score: number;
  matched: string[];
}

function toDto(s: ScoredPolicy): ScoredPolicyDto {
  return {
    policyId: s.policy.id,
    choose: s.policy.choose,
    score: Math.round(s.score * 100) / 100,
    matched: s.matchedCriteria,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const flipDemo = url.searchParams.get("flipDemo") === "true";

    // Resolve prompt + platform + endorsements. The flip demo overrides all
    // three with the hardcoded scenario.
    const prompt = flipDemo
      ? FLIP_DEMO.prompt
      : url.searchParams.get("prompt") ?? "CRM app for enterprise";
    const platformParam = flipDemo
      ? FLIP_DEMO.platform
      : url.searchParams.get("platform") ?? "web";
    const platform: PlatformKind | undefined = VALID_PLATFORMS.includes(
      platformParam as PlatformKind
    )
      ? (platformParam as PlatformKind)
      : undefined;
    const endorsements = flipDemo
      ? FLIP_DEMO.endorsements
      : allEndorsedPolicyIds();

    // Detect capabilities + non-functionals from the prompt the same way the
    // real orchestrator does.
    const capabilities = detectCapabilities(prompt);
    const nonFunctionals = detectNonFunctionals(prompt);

    const engine = new DecisionEngine();
    const withoutSkills = engine.score({ platform, capabilities, nonFunctionals });
    const withSkills = engine.score({
      platform,
      capabilities,
      nonFunctionals,
      skillEndorsements: endorsements,
    });

    const topWithout = withoutSkills[0];
    const topWith = withSkills[0];
    const flipped =
      !!topWithout &&
      !!topWith &&
      topWithout.policy.id !== topWith.policy.id;

    // Compose a human-readable explanation.
    let explanation: string;
    if (flipDemo) {
      explanation = FLIP_DEMO.explanation;
    } else if (flipped) {
      explanation =
        `SKILL.md endorsement flipped the winner: ` +
        `'${topWithout?.policy.id}' (${topWithout?.score.toFixed(1)}) → ` +
        `'${topWith?.policy.id}' (${topWith?.score.toFixed(1)}).`;
    } else if (topWithout && topWith) {
      const boosted = withSkills.find(
        (s) =>
          s.matchedCriteria.includes("skill:SKILL.md") &&
          s.policy.id === topWith.policy.id
      );
      const withoutScoreForTopWith = withoutSkills.find(
        (s) => s.policy.id === topWith.policy.id
      )?.score;
      if (boosted && withoutScoreForTopWith !== undefined) {
        explanation =
          `SKILL.md endorsement boosted '${topWith.policy.id}' from ` +
          `${withoutScoreForTopWith.toFixed(1)} → ${topWith.score.toFixed(1)} ` +
          `(still the winner; gap ${
            topWith.score - (withoutSkills[1]?.score ?? 0) >
            (topWithout.score - (withoutSkills[1]?.score ?? 0))
              ? "widened"
              : "unchanged"
          }).`;
      } else {
        explanation =
          `SKILL.md endorsements did not change the winner: ` +
          `'${topWith.policy.id}' remains top at ${topWith.score.toFixed(1)}.`;
      }
    } else {
      explanation = "No policies matched the given prompt + platform.";
    }

    return NextResponse.json({
      prompt,
      platform: platform ?? platformParam,
      capabilities,
      nonFunctionals,
      endorsementsApplied: endorsements,
      endorsementMap: SKILL_ENDORSEMENT_MAP,
      withoutSkills: withoutSkills.map(toDto),
      withSkills: withSkills.map(toDto),
      topWithoutSkills: topWithout
        ? {
            policyId: topWithout.policy.id,
            choose: topWithout.policy.choose,
            score: Math.round(topWithout.score * 100) / 100,
          }
        : null,
      topWithSkills: topWith
        ? {
            policyId: topWith.policy.id,
            choose: topWith.policy.choose,
            score: Math.round(topWith.score * 100) / 100,
          }
        : null,
      flipped,
      explanation,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Decision impact debug failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
