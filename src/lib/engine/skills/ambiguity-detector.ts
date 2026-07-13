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
import { executionEngine, observability } from "../index";

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
}

/**
 * Score the clarity of a natural-language requirement.
 * Weighted checks:
 *   - missing entities (0.3): no noun describing what to build
 *   - conflicting requirements (0.3): contradictory signals
 *   - vague adjectives without metrics (0.2): "fast", "nice", "modern"
 *   - external resource mention without credential (0.2): API keys, certs
 */
export function detectAmbiguity(requirements: string): AmbiguityResult {
  const text = requirements.trim();
  const lower = text.toLowerCase();

  // 1. Missing entities (0.3): is there a noun describing what to build?
  const entityWords = /\b(app|application|service|api|website|site|tool|cli|agent|bot|game|library|sdk|dashboard|portal|system|platform|microservice|backend|frontend)\b/i;
  const missingEntities = !entityWords.test(text) || text.length < 15;

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
  const vagueAdjs = /\b(fast|nice|modern|good|beautiful|cool|awesome|great|smooth|snappy)\b/i;
  const hasMetric = /\b(\d+\s*(ms|seconds?|minutes?|hours?|users?|req|requests?|rps|qps|gb|mb|kb|%|percent))\b/i.test(text);
  const vagueWithoutMetric = vagueAdjs.test(text) && !hasMetric;

  // 4. External resource mention without credential (0.2)
  const externalMention = /\b(api key|secret|certificate|cert|oauth|credential|token|password|\.pfx|\.p12)\b/i.test(text);
  const credentialProvided = /\b(provide|provided|here is|use this|key=|secret=|token=)\b/i.test(text);
  const externalWithoutCred = externalMention && !credentialProvided;

  const checks: AmbiguityCheck[] = [
    { id: "missing-entities", weight: 0.3, matched: missingEntities, detail: missingEntities ? "No clear noun describing what to build." : "Entity detected." },
    { id: "conflicting-requirements", weight: 0.3, matched: hasConflict, detail: hasConflict ? `Conflicts: ${conflicts.join("; ")}` : "No conflicts." },
    { id: "vague-without-metric", weight: 0.2, matched: vagueWithoutMetric, detail: vagueWithoutMetric ? "Vague adjectives (fast/nice/modern) without measurable metrics." : "Adjectives backed by metrics or absent." },
    { id: "external-without-credential", weight: 0.2, matched: externalWithoutCred, detail: externalWithoutCred ? "External resource (API key/cert/credential) mentioned without a value." : "No missing external resources." },
  ];

  const score = checks.reduce((sum, c) => sum + (c.matched ? c.weight : 0), 0);
  const shouldAsk = score > AMBIGUITY_THRESHOLD;

  let question: string | undefined;
  if (shouldAsk) {
    const reasons = checks.filter((c) => c.matched).map((c) => c.detail);
    question = `Before I proceed, I need clarification: ${reasons.join(" Also, ")}. Could you provide more detail so I don't guess at your requirements?`;
  }

  return { score, checks, shouldAsk, question };
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
