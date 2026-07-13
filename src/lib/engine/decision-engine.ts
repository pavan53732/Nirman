// Decision Engine + Capability Detection.
// Capability Detection runs first to infer required capabilities (OpenGL,
// DirectX, GPU, Bluetooth, Camera, Offline Sync). The Decision Engine then
// applies reusable DecisionPolicy rules { when, choose, rationale, confidence }
// and logs decisions to Decision Memory with alternativesRejected.

import type {
  Capability,
  DecisionPolicy,
  DecisionRecord,
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
  policies: DecisionPolicy[];
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

/**
 * Decision Engine — applies policies and logs each decision with the
 * alternatives that were rejected, so reasoning is auditable.
 */
export class DecisionEngine {
  private policies: DecisionPolicy[];

  constructor(policies: DecisionPolicy[] = decisionPolicies) {
    this.policies = policies;
  }

  decide(topic: string, context: string): DecisionRecord {
    const matched = this.matchPolicies(topic, context);
    const chosen = matched[0] ?? {
      id: "fallback",
      when: context,
      choose: "default stack",
      rationale: "No specific policy matched; using the platform default stack.",
      confidence: 0.5,
    };
    const alternativesRejected = matched.slice(1).map((p) => ({
      option: p.choose,
      reason: `Lower confidence (${p.confidence}) than chosen (${chosen.confidence}).`,
    }));

    const record: DecisionRecord = {
      id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      policyId: chosen.id,
      topic,
      chosen: chosen.choose,
      rationale: chosen.rationale,
      confidence: chosen.confidence,
      alternativesRejected,
      createdAt: Date.now(),
    };

    // Log to Decision Memory (versioned)
    projectMemory.write(
      "decision",
      topic,
      JSON.stringify(
        { chosen: record.chosen, rationale: record.rationale, confidence: record.confidence, alternativesRejected },
        null,
        2
      ),
      "decision-engine"
    );

    return record;
  }

  private matchPolicies(topic: string, context: string): DecisionPolicy[] {
    const ctx = context.toLowerCase();
    const t = topic.toLowerCase();
    return this.policies
      .filter((p) => {
        const w = p.when.toLowerCase();
        // crude matching: every token in `when` appears in topic or context
        const tokens = w.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return false;
        return tokens.every((tok) => t.includes(tok) || ctx.includes(tok));
      })
      .sort((a, b) => b.confidence - a.confidence);
  }

  /** Pick a stack for a platform given capabilities + context. */
  pickStack(kind: PlatformKind, prompt: string, caps: Capability[]): { stack: string; decision: DecisionRecord } {
    const ctx = `${kind} ${caps.join(" ")} ${prompt}`;
    let topic: string;
    if (kind === "windows") {
      topic = /\bcross-?platform\b/i.test(prompt) ? "windows cross-platform" : "windows native rich controls";
    } else if (kind === "android") {
      topic = /\bcross-?platform\b/i.test(prompt) ? "android cross-platform" : "android native perf";
    } else if (kind === "web") {
      topic = /\bmarketing|landing|website|blog|portfolio\b/i.test(prompt) ? "web marketing/landing" : "web realtime";
    } else if (kind === "cli") {
      topic = "cli performance/cross-platform";
    } else if (kind === "api") {
      topic = "ai knowledge base";
    } else {
      topic = kind;
    }
    const decision = this.decide(topic, ctx);
    return { stack: decision.chosen, decision };
  }
}

export const decisionEngine = new DecisionEngine();
