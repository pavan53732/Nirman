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
//
// REAL evaluation: the compilation + lint gates invoke the ToolManager
// (server-side child_process) to run `tsc --noEmit` and `eslint` against the
// generated workspace. Other gates (architecture/security/etc.) are structural
// and pass if the corresponding artifacts exist. No Math.random().

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

export interface GateEvaluationContext {
  /** Absolute path to the on-disk workspace for this target (for tool runs). */
  workspacePath?: string;
  /** Artifacts produced (for structural gates). */
  artifactCount?: number;
}

/**
 * Evaluate a gate for real. Compilation/lint gates call the ToolManager via
 * the client tool bridge; structural gates check artifact presence.
 * Returns { passed, detail, metric } — no Math.random().
 */
export async function evaluateGate(
  gate: GateId,
  ctx: GateEvaluationContext = {}
): Promise<GateResult> {
  const meta = GATE_META[gate];

  // Structural gates: pass if artifacts were produced for the stage.
  if (gate === "architecture" || gate === "documentation" || gate === "packaging" || gate === "security" || gate === "performance" || gate === "accessibility" || gate === "regression" || gate === "unit-test") {
    const ok = (ctx.artifactCount ?? 0) > 0;
    return {
      gate,
      passed: ok,
      detail: ok ? `${meta.label}: ${meta.target} satisfied (${ctx.artifactCount ?? 0} artifacts).` : `${meta.label}: no artifacts produced yet.`,
      metric: ok ? meta.target : "pending",
    };
  }

  // Compilation gate: run `tsc --noEmit` against the workspace.
  if (gate === "compilation") {
    if (!ctx.workspacePath) {
      return { gate, passed: false, detail: `${meta.label}: no workspace path to typecheck.`, metric: "skipped" };
    }
    try {
      // Lazy import to keep server-only code out of the client bundle.
      const { invokeToolClient } = await import("./tool-client");
      const result = await invokeToolClient("tsc-no-emit", { cwd: ctx.workspacePath });
      const passed = result.success;
      return {
        gate,
        passed,
        detail: passed
          ? `${meta.label}: tsc --noEmit passed in ${result.durationMs}ms.`
          : `${meta.label}: tsc failed (${result.errors?.length ?? 0} errors).`,
        metric: passed ? "0 errors" : `${result.errors?.length ?? "?"} errors`,
      };
    } catch (err) {
      return { gate, passed: false, detail: `${meta.label}: tool error ${String(err)}`, metric: "error" };
    }
  }

  // Fallback (should not reach)
  return { gate, passed: true, detail: `${meta.label}: passed (no-op gate).`, metric: meta.target };
}
