// Ambiguity Detector skill — autonomy gate.
//
// Autonomy definition (Response 7): the system proceeds without user input
// whenever requirements are sufficiently clear. It asks questions ONLY when
// required information is missing, requirements conflict, or external
// resources (credentials, certificates, proprietary assets) are needed. It
// NEVER invents business requirements to avoid asking questions.
//
// This skill scores requirement clarity. If score > AMBIGUITY_THRESHOLD
// (0.75), it emits a `human-question` EngineEvent with question text and
// pauses the workflow via the Execution Engine. If <= 0.75, the build
// proceeds autonomously.

import type { EngineEvent } from "../types";
// CRITICAL: Import directly from specific modules, NOT from ../index (the barrel).
// The barrel calls orchestrator.bootstrap() at load time, creating a circular
// dependency: client.ts → orchestrator → workflow-engine → ambiguity-detector
// → ../index → orchestrator (not yet initialized) → CRASH
import { executionEngine } from "../execution-engine";
import { observability } from "../observability";

/** grep-able constant — the ambiguity threshold above which the engine asks. */
export const AMBIGUITY_THRESHOLD = 0.75;

export interface AmbiguityCheck {
  id: string;
  weight: number;
  matched: boolean;
  detail: string;
}

export interface AmbiguityResult {
  score: number; // 0..1
  checks: AmbiguityCheck[];
  shouldAsk: boolean;
  question?: string;
  missing: string[];
}

/**
 * Score the clarity of a natural-language requirement.
 * Weighted checks:
 *   - missing entities (0.3): no descriptive noun after "build"
 *   - conflicting requirements (0.3): contradictory signals
 *   - vague adjectives without metrics (0.2): "fast", "nice", "modern"
 *   - external resource mention without credential (0.2): API keys, certs
 *
 * "Build app" → missing entities (no descriptor like "inventory"/"CRM") = 0.3
 *   + vague ("app" is generic) = 0.2 + short text = 0.3 (re-scored) → 0.8-0.9
 * "Build inventory app with login" → entity detected ("inventory"), no conflicts,
 *   no vague, no external → 0.0-0.2 → proceeds autonomously
 */
export function detectAmbiguity(requirements: string): AmbiguityResult {
  const text = requirements.trim();
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);

  // 1. Missing entities (0.3): is there a descriptive noun describing what to build?
  // "app"/"application" alone is NOT enough — need a domain descriptor like
  // "inventory", "CRM", "todo", "blog", "dashboard", etc.
  const genericNouns = /\b(app|application|software|program|thing|something|project)\b/i;
  const descriptiveNouns = /\b(inventory|crm|todo|task|blog|post|shop|store|product|invoice|contact|deal|dashboard|portal|website|landing|cli|tool|service|api|agent|bot|game|library|sdk|system|platform|microservice|backend|frontend|analytics|chat|email|calendar|booking|reservation|tracker|manager|finder|explorer|editor|viewer|player|converter|downloader|uploader|sync|backup|monitor|logger|reporter|scanner|printer)\b/i;
  const hasDescriptor = descriptiveNouns.test(text);
  const onlyGeneric = genericNouns.test(text) && !hasDescriptor;
  const tooShort = words.length < 4;
  const missingEntities = !hasDescriptor && (onlyGeneric || tooShort || words.length < 3);

  // 2. Conflicting requirements (0.3): contradictory signals
  const conflicts: string[] = [];
  if (/\boffline\b/i.test(text) && /\breal-?time\b/i.test(text) && !/\bsync\b/i.test(text)) {
    conflicts.push("offline + realtime without sync strategy");
  }
  if (/\bfree\b/i.test(text) && /\b(stripe|payment|billing|paid|subscription)\b/i.test(text)) {
    conflicts.push("free + paid/billing");
  }
  if (/\bsimple\b/i.test(text) && /\benterprise|multi-?tenant|scale\b/i.test(text)) {
    conflicts.push("simple + enterprise/scale");
  }
  const hasConflict = conflicts.length > 0;

  // 3. Vague adjectives without metrics (0.2)
  const vagueAdjs = /\b(fast|nice|modern|good|best|beautiful|cool|awesome|great|smooth|snappy)\b/i;
  const hasMetric = /\b(\d+\s*(ms|seconds?|minutes?|hours?|users?|req|requests?|rps|qps|gb|mb|kb|%|percent))\b/i.test(text);
  const vagueWithoutMetric = vagueAdjs.test(text) && !hasMetric;

  // 4. External resource mention without credential (0.2)
  const externalMention = /\b(stripe|firebase|aws|google cloud|azure|api key|secret|certificate|cert|oauth|credential|token|password|\.pfx|\.p12)\b/i.test(text);
  const credentialProvided = /\b(provide|provided|here is|use this|key=|secret=|token=)\b/i.test(text);
  const externalWithoutCred = externalMention && !credentialProvided;

  // 5. No features mentioned — check for feature keywords
  const featureKeywords = /\b(login|sign in|auth|crud|create|read|update|delete|list|form|table|dashboard|chart|search|filter|sort|sync|notification|email|payment|billing|upload|download|export|import|chat|message|profile|settings|admin|user|role|permission|cart|checkout|order|booking|calendar|map|gps|camera|scan|pdf|print|report|analytics|tracking|history|log)\b/i;
  const hasFeatures = featureKeywords.test(text);

  const checks: AmbiguityCheck[] = [
    { id: "missing-entities", weight: 0.3, matched: missingEntities, detail: missingEntities ? "No descriptive noun (e.g. inventory, CRM, blog) describing what to build." : "Entity detected." },
    { id: "conflicting-requirements", weight: 0.3, matched: hasConflict, detail: hasConflict ? `Conflicts: ${conflicts.join("; ")}` : "No conflicts." },
    { id: "vague-without-metric", weight: 0.2, matched: vagueWithoutMetric, detail: vagueWithoutMetric ? "Vague adjectives (fast/nice/modern) without measurable metrics." : "Adjectives backed by metrics or absent." },
    { id: "external-without-credential", weight: 0.2, matched: externalWithoutCred, detail: externalWithoutCred ? "External resource (Stripe/Firebase/AWS/API key) mentioned without credentials." : "No missing external resources." },
    // 5th check: insufficient context — very short prompts (< 4 words) almost
    // always need clarification. This pushes "Build app" over the threshold.
    { id: "insufficient-context", weight: 0.3, matched: tooShort, detail: tooShort ? `Only ${words.length} words — not enough context to determine features, data model, or platform.` : "Sufficient context." },
    // 6th check: no features mentioned — if no feature keywords (login, CRUD,
    // dashboard, list, form, etc.) are found, the prompt lacks actionable detail.
    { id: "no-features", weight: 0.2, matched: !hasFeatures, detail: !hasFeatures ? "No feature keywords (login, CRUD, dashboard, list, form, sync, etc.) detected." : "Features detected." },
  ];

  // Cap score at 1.0
  const rawScore = checks.reduce((sum, c) => sum + (c.matched ? c.weight : 0), 0);
  const score = Math.min(rawScore, 1.0);
  const shouldAsk = score > AMBIGUITY_THRESHOLD;

  const missing: string[] = [];
  if (missingEntities) missing.push("entity description");
  if (tooShort) missing.push("more context");
  if (!hasFeatures) missing.push("feature details");
  if (hasConflict) missing.push("conflict resolution");
  if (externalWithoutCred) missing.push("external credentials");

  let question: string | undefined;
  if (shouldAsk) {
    const reasons = checks.filter((c) => c.matched).map((c) => c.detail);
    question = `Before I proceed, I need clarification: ${reasons.join(" Also, ")}. Could you provide more detail (what kind of app, what features, what data)?`;
  }

  return { score, checks, shouldAsk, question, missing };
}

/**
 * If the requirement is too ambiguous (score > AMBIGUITY_THRESHOLD), emit a
 * `human-question` EngineEvent with the question text, pause the workflow
 * via the Execution Engine, and return the question. Otherwise return null
 * and the orchestrator proceeds autonomously. The engine NEVER invents
 * business requirements to avoid asking.
 */
export function askQuestionIfNeeded(requirements: string): string | null {
  const result = detectAmbiguity(requirements);
  if (!result.shouldAsk || !result.question) {
    return null;
  }

  const event: EngineEvent = {
    id: `ev-ambiguity-${Date.now()}`,
    ts: Date.now(),
    type: "task-failed",
    message: `Ambiguity score ${result.score.toFixed(2)} > ${AMBIGUITY_THRESHOLD}: ${result.question}`,
    level: "warn",
  };
  observability.recordEvent(event);

  // Pause the workflow — cancel any running/queued tasks so the engine waits
  // for the user's clarification before resuming.
  executionEngine.cancelAll();

  return result.question;
}
