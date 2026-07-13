// Self-healing policy (configurable) + 8 Quality Gates.
// Levels: FastFix -> IncrementalPatch -> ModuleRewrite -> ArchitectureReevaluation -> HumanQuestion.
// Model Router escalates model strength per level. Token Budget Manager enforces limits.

import type { SelfHealLevel, SelfHealPolicy, GateId, GateResult } from "./types";

export const DEFAULT_SELF_HEAL_POLICY: SelfHealPolicy = {
  retryLimitsPerLevel: {
    fastfix: 3,
    "incremental-patch": 2,
    "module-rewrite": 1,
    "architecture-reevaluation": 1,
    "human-question": 0,
  },
  escalationThreshold: 3, // failures at a level before escalating
  patchStrategy: "minimal-diff",
  rollbackBehavior: "auto",
};

export const SELF_HEAL_LEVELS: { id: SelfHealLevel; label: string; modelStrength: "light" | "standard" | "strong" }[] = [
  { id: "fastfix", label: "Fast Fix", modelStrength: "light" },
  { id: "incremental-patch", label: "Incremental Patch", modelStrength: "light" },
  { id: "module-rewrite", label: "Module Rewrite", modelStrength: "standard" },
  { id: "architecture-reevaluation", label: "Architecture Reevaluation", modelStrength: "strong" },
  { id: "human-question", label: "Human Question", modelStrength: "strong" },
];

export class SelfHealController {
  policy: SelfHealPolicy;
  private attempts = new Map<string, number>(); // key: taskId|level

  constructor(policy: SelfHealPolicy = DEFAULT_SELF_HEAL_POLICY) {
    this.policy = policy;
  }

  /** Given a task's failure count, return the next level or null (escalate to human). */
  nextLevel(taskId: string, currentLevel: SelfHealLevel): SelfHealLevel | null {
    const key = `${taskId}|${currentLevel}`;
    const attempts = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempts);
    const limit = this.policy.retryLimitsPerLevel[currentLevel];
    if (attempts < limit) return currentLevel; // retry same level
    // escalate
    const idx = SELF_HEAL_LEVELS.findIndex((l) => l.id === currentLevel);
    const next = SELF_HEAL_LEVELS[idx + 1];
    return next ? next.id : null; // null => give up / human
  }

  reset(taskId: string): void {
    for (const k of [...this.attempts.keys()]) {
      if (k.startsWith(`${taskId}|`)) this.attempts.delete(k);
    }
  }
}

export const selfHealController = new SelfHealController();

/* ---------------- Quality Gates ---------------- */
// 8 gates that must all pass before Ready. Each gate is a skill using a tool,
// evaluated by the Execution Engine before stage transition.

export const GATE_META: Record<GateId, { label: string; target: string; agent: string }> = {
  architecture: { label: "Architecture Gate", target: "Design reviewed", agent: "solution-architect" },
  compilation: { label: "Compilation Gate", target: "0 errors", agent: "build-engineer" },
  security: { label: "Security Gate", target: "0 critical advisories", agent: "security-auditor" },
  performance: { label: "Performance Gate", target: "No hot-path regressions", agent: "performance-optimizer" },
  accessibility: { label: "Accessibility Gate", target: "WCAG AA", agent: "accessibility-auditor" },
  documentation: { label: "Documentation Gate", target: "README + API docs", agent: "documentation-writer" },
  packaging: { label: "Packaging Gate", target: "Installers build & sign", agent: "packaging-engineer" },
  regression: { label: "Regression Gate", target: "No regressions", agent: "integration-test-agent" },
  "unit-test": { label: "Unit Test Gate", target: "≥ 80% pass", agent: "unit-test-agent" },
};

/**
 * Evaluate a gate. In this simulated engine, gates pass deterministically with
 * a small chance of a recoverable failure (to exercise self-healing paths).
 */
export function evaluateGate(gate: GateId): GateResult {
  // ~88% pass on first attempt; failures are recoverable by self-healing.
  const pass = Math.random() > 0.12;
  const meta = GATE_META[gate];
  if (pass) {
    return { gate, passed: true, detail: `${meta.label}: ${meta.target} satisfied.`, metric: meta.target };
  }
  return {
    gate,
    passed: false,
    detail: `${meta.label}: ${meta.target} not yet met — attempting self-heal.`,
    metric: "pending",
  };
}
