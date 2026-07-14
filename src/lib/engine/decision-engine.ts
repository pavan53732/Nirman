// Decision Engine + Capability Detection.
// Capability Detection runs first to infer required capabilities (OpenGL,
// DirectX, GPU, Bluetooth, Camera, Offline Sync). The Decision Engine then
// scores reusable DecisionPolicy rules against the request's actual platform
// + capabilities + non-functionals and picks the highest-scoring one, logging
// the chosen option and alternatives rejected to Decision Memory.

import type {
  Capability,
  DecisionPolicy,
  DecisionRecord,
  NonFunctional,
  PlatformKind,
} from "./types";
import { decisionPolicies } from "./data/workflows";
import { projectMemory } from "./memories";

export interface DetectedTargets {
  kind: PlatformKind;
  label: string;
  role: string;
  stack: string;
  capabilities: Capability[];
  /**
   * Decision records produced by `pickStack` for this target. These are
   * `DecisionRecord`s (the logged outcome of a decision) — NOT
   * `DecisionPolicy`s (which are the reusable match rules). The field is
   * named `policies` for historical reasons; consumers read `.topic`,
   * `.chosen`, and `.confidence` off each entry, which only exist on
   * `DecisionRecord`.
   */
  policies: DecisionRecord[];
}

const KEYWORDS: { cap: Capability; re: RegExp }[] = [
  { cap: "camera", re: /\b(camera|photo|capture|webcam|scan)\b/i },
  { cap: "bluetooth", re: /\b(bluetooth|ble|ble peripheral)\b/i },
  { cap: "location", re: /\b(gps|location|map|geo|trail|hiking|navigation)\b/i },
  { cap: "offline-sync", re: /\b(offline(?!-first)|sync|synchronization|background sync)\b/i },
  { cap: "realtime", re: /\b(real-?time|live|streaming|websocket|push)\b/i },
  { cap: "pdf", re: /\b(pdf|invoice|report|document export)\b/i },
  { cap: "printing", re: /\b(print|printer|printing)\b/i },
  { cap: "notifications", re: /\b(notification|notify|alert|push notification)\b/i },
  { cap: "payments", re: /\b(payment|billing|stripe|checkout|subscription)\b/i },
  { cap: "auth", re: /\b(auth|login|sign in|oauth|identity|account)\b/i },
  { cap: "encryption", re: /\b(encrypt|encryption|secure storage|sqlcipher)\b/i },
  { cap: "barcode", re: /\b(barcode|qr|qr code|scanning)\b/i },
  { cap: "gpu", re: /\b(opengl|directx|direct3d|vulkan|metal|cuda|gpu|3d|rendering|cad|autocad|modeling|shader)\b/i },
];

export function detectCapabilities(prompt: string): Capability[] {
  const caps = new Set<Capability>();
  for (const { cap, re } of KEYWORDS) {
    if (re.test(prompt)) caps.add(cap);
  }
  // Offline-first implies offline-sync
  if (/\boffline-first\b/i.test(prompt)) caps.add("offline-sync");
  return [...caps];
}

/** Infer non-functional requirements from the prompt. */
const NF_KEYWORDS: { nf: NonFunctional; re: RegExp }[] = [
  { nf: "offline-first", re: /\b(offline-first|offline first|works offline|local-first|local first)\b/i },
  { nf: "cross-platform", re: /\b(cross-?platform|multi-?platform|also on (mac|linux)|mac and windows|windows and mac)\b/i },
  { nf: "enterprise", re: /\b(enterprise|corporate|organization|organisation|b2b|scale to \d+)\b/i },
  { nf: "multi-tenant", re: /\b(multi-?tenant|multiple tenants|tenants|workspaces|per-customer isolation)\b/i },
  { nf: "embedded", re: /\b(embedded|firmware|microcontroller|mcu|no_std|bare metal)\b/i },
  { nf: "low-memory", re: /\b(low memory|constrained|resource-?limited|small footprint)\b/i },
  { nf: "performance", re: /\b(performance|fast|high-?performance|low latency|throughput|optimized|optimised)\b/i },
  { nf: "realtime", re: /\b(real-?time|live|streaming|websocket|push updates)\b/i },
  { nf: "marketing", re: /\b(marketing|landing|website|blog|portfolio|hero|seo)\b/i },
  { nf: "native", re: /\b(native|win32|system api|platform integration|native look)\b/i },
  { nf: "rich-controls", re: /\b(rich controls|data grid|datagrid|charts|dashboard|complex ui|mvvm|data binding)\b/i },
];

export function detectNonFunctionals(prompt: string): NonFunctional[] {
  const nfs = new Set<NonFunctional>();
  for (const { nf, re } of NF_KEYWORDS) {
    if (re.test(prompt)) nfs.add(nf);
  }
  return [...nfs];
}

export interface ScoredPolicy {
  policy: DecisionPolicy;
  score: number;
  matchedCriteria: string[];
}

/**
 * Map of skillId → policy IDs that the corresponding SKILL.md file endorses.
 *
 * The keys are skill IDs from the Skills Registry (e.g. `nextjs-app-router`,
 * `winui3-dotnet8`). The values are REAL policy IDs from `decisionPolicies`
 * in `data/workflows.ts` — verified against the live array, so any policy ID
 * that does not exist is omitted (per the spec: "If a policy ID doesn't
 * exist, omit the mapping").
 *
 * When the Decision Engine scores policies, any policy ID listed here that is
 * ALSO backed by a real SKILL.md file on disk receives a +1.5 endorsement
 * boost (see `score()`).
 */
export const SKILL_ENDORSEMENT_MAP: Record<string, string[]> = {
  // Web — the nextjs-app-router SKILL.md (frontend-setup / fullstack-dev
  // generator) endorses both web policies.
  "nextjs-app-router": ["web-marketing", "web-realtime"],
  // Windows — the winui3-dotnet8 SKILL.md endorses the native WinUI 3 policy.
  "winui3-dotnet8": ["ui-windows-native"],
  // Android — the kotlin-compose SKILL.md endorses the native Compose policy.
  "kotlin-compose": ["ui-android-native"],
  // Windows cross-platform — the tauri-app SKILL.md endorses the Tauri policy.
  "tauri-app": ["ui-windows-cross-platform"],
  // Android cross-platform — the flutter-app SKILL.md endorses the Flutter policy.
  "flutter-app": ["ui-android-cross-platform"],
};

/**
 * Flatten every endorsed policy ID across all SKILL.md entries. Used by the
 * debug endpoint to simulate "all loaded SKILL.md files are endorsing their
 * respective policies" in a single shot.
 */
export function allEndorsedPolicyIds(): string[] {
  return [...new Set(Object.values(SKILL_ENDORSEMENT_MAP).flat())];
}

/**
 * Decision Engine — scores policies against the request's platform +
 * capabilities + non-functionals and picks the highest-scoring one. Each
 * decision is logged to Decision Memory with alternatives rejected.
 *
 * Scoring:
 *   +3  platform matches
 *   +2  per overlapping non-functional
 *   +1  per overlapping capability
 *   -1  per policy non-functional absent from request (over-specification penalty)
 *   -2  per policy capability absent from request (over-specification penalty)
 *   +policy.confidence * 2  base weight (so a high-confidence policy still wins ties)
 * A policy only qualifies if it has at least one positive criterion match
 * (platform OR a non-functional OR a capability) — this prevents a generic
 * policy from winning when a specific one should.
 */
export class DecisionEngine {
  private policies: DecisionPolicy[];

  constructor(policies: DecisionPolicy[] = decisionPolicies) {
    this.policies = policies;
  }

  /** Score all policies for a given request context. */
  score(opts: {
    platform?: PlatformKind;
    capabilities?: Capability[];
    nonFunctionals?: NonFunctional[];
    /**
     * Policy IDs endorsed by loaded SKILL.md files. Each endorsed policy
     * receives a +1.5 boost (see `SKILL_ENDORSEMENT_MAP`).
     */
    skillEndorsements?: string[];
  }): ScoredPolicy[] {
    const caps = new Set(opts.capabilities ?? []);
    const nfs = new Set(opts.nonFunctionals ?? []);
    const platform = opts.platform;
    const endorsements = new Set(opts.skillEndorsements ?? []);

    const scored: ScoredPolicy[] = this.policies.map((policy) => {
      let score = 0;
      const matched: string[] = [];

      // Platform
      if (policy.match.platform) {
        if (platform && policy.match.platform === platform) {
          score += 3;
          matched.push(`platform:${platform}`);
        } else {
          // platform mismatch is a hard negative — this policy is for a different platform
          score -= 5;
        }
      }

      // Non-functionals
      for (const nf of policy.match.nonFunctionals ?? []) {
        if (nfs.has(nf)) {
          score += 2;
          matched.push(`nf:${nf}`);
        } else {
          score -= 1; // over-specification penalty
        }
      }

      // Capabilities
      for (const cap of policy.match.capabilities ?? []) {
        if (caps.has(cap)) {
          score += 1;
          matched.push(`cap:${cap}`);
        } else {
          score -= 2; // capability over-specification is a stronger penalty
        }
      }

      // Base weight from declared confidence
      score += policy.confidence * 2;

      // SKILL.md endorsement boost — a real SKILL.md file on disk endorses
      // this policy, so it gets +1.5. This is enough to break close ties or
      // flip a near-tie, but not enough to override a strong platform/NF
      // mismatch. See `SKILL_ENDORSEMENT_MAP` for the source of truth.
      if (endorsements.has(policy.id)) {
        score += 1.5;
        matched.push(`skill:SKILL.md`);
      }

      return { policy, score, matchedCriteria: matched };
    });

    // Only qualify policies with at least one positive criterion match
    // (platform OR a non-functional OR a capability). A `skill:SKILL.md`
    // endorsement alone does NOT qualify a policy — otherwise a Windows
    // policy would leak into a web query just because a SKILL.md endorses
    // it. The skill boost only applies to policies that already qualify.
    return scored
      .filter((s) => s.matchedCriteria.some((m) => !m.startsWith("skill:")))
      .sort((a, b) => b.score - a.score);
  }

  decide(opts: {
    topic: string;
    platform?: PlatformKind;
    capabilities?: Capability[];
    nonFunctionals?: NonFunctional[];
    /** Policy IDs endorsed by loaded SKILL.md files (forwarded to `score`). */
    skillEndorsements?: string[];
  }): DecisionRecord {
    const scored = this.score(opts);
    const best = scored[0];
    const chosen = best?.policy ?? {
      id: "fallback",
      when: opts.topic,
      match: {},
      choose: "default stack",
      rationale: "No specific policy matched; using the platform default stack.",
      confidence: 0.5,
    };

    const alternativesRejected = scored.slice(1, 4).map((s) => ({
      option: s.policy.choose,
      reason: `Score ${s.score.toFixed(1)} vs chosen ${best?.score.toFixed(1) ?? "n/a"} (matched: ${s.matchedCriteria.join(", ") || "none"}).`,
    }));

    const record: DecisionRecord = {
      id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      policyId: chosen.id,
      topic: opts.topic,
      chosen: chosen.choose,
      rationale: best
        ? `${chosen.rationale} (score ${best.score.toFixed(1)}, matched: ${best.matchedCriteria.join(", ")})`
        : chosen.rationale,
      confidence: chosen.confidence,
      alternativesRejected,
      createdAt: Date.now(),
    };

    // Log to Decision Memory (versioned)
    projectMemory.write(
      "decision",
      opts.topic,
      JSON.stringify(
        {
          chosen: record.chosen,
          rationale: record.rationale,
          confidence: record.confidence,
          platform: opts.platform,
          capabilities: opts.capabilities,
          nonFunctionals: opts.nonFunctionals,
          alternativesRejected,
        },
        null,
        2
      ),
      "decision-engine"
    );

    return record;
  }

  /** Pick a stack for a platform given capabilities + non-functionals. */
  pickStack(
    kind: PlatformKind,
    prompt: string,
    caps: Capability[],
    nfs?: NonFunctional[],
    /** Policy IDs endorsed by loaded SKILL.md files (forwarded to `decide`). */
    skillEndorsements?: string[]
  ): { stack: string; decision: DecisionRecord } {
    const nonFunctionals = nfs ?? detectNonFunctionals(prompt);
    const topic = `${kind} stack`;
    const decision = this.decide({
      topic,
      platform: kind,
      capabilities: caps,
      nonFunctionals,
      skillEndorsements,
    });
    return { stack: decision.chosen, decision };
  }
}

/**
 * Run the Decision Engine twice — once without any SKILL.md endorsements and
 * once with — and report whether the top policy flipped. Used by the
 * `/api/debug/decision-impact` endpoint to prove that loading real SKILL.md
 * files can actually change which stack the engine picks.
 */
export function scoreWithAndWithoutSkills(
  opts: {
    platform?: PlatformKind;
    capabilities?: Capability[];
    nonFunctionals?: NonFunctional[];
  },
  endorsements: string[]
): {
  withoutSkills: ScoredPolicy[];
  withSkills: ScoredPolicy[];
  flipped: boolean;
} {
  const engine = new DecisionEngine();
  const withoutSkills = engine.score(opts);
  const withSkills = engine.score({ ...opts, skillEndorsements: endorsements });
  const topWithout = withoutSkills[0]?.policy.id;
  const topWith = withSkills[0]?.policy.id;
  const flipped =
    !!topWithout && !!topWith && topWithout !== topWith;
  return { withoutSkills, withSkills, flipped };
}

export const decisionEngine = new DecisionEngine();
