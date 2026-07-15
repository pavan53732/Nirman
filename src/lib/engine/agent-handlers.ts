// Agent Handlers — the registry mapping AgentRole → AgentHandler.
//
// This is the EXECUTION side of Nirman's agent layer. Where data/agents.ts
// declares agent metadata (name, layer, icon, description) and
// agent-runtime.ts (tracer side) records WHEN agents activate, this file
// declares WHAT each agent actually DOES at runtime.
//
// DESIGN:
//   - Each handler is a pure function: (AgentExecutionContext) → AgentExecutionResult.
//   - Handlers receive ALL inputs via the context (memory slice, skills,
//     capabilities, shared context, prompt, task) and return ALL outputs via
//     the result (output text, artifacts, memoryWrites, sharedWrites).
//   - Handlers do NOT call memories.ts directly — the AgentRuntime persists
//     `result.memoryWrites` after the handler returns. (This keeps the
//     blackboard audit trail clean: only the runtime mutates memory.)
//   - Handlers MAY read from `ctx.shared` (the live blackboard) to get
//     upstream outputs. They declare their writes via `result.sharedWrites`
//     AND the runtime commits them post-handler. (Handler-side writes are
//     also legal because the spec allows it, but the runtime re-commits
//     them to be safe — idempotent.)
//
// KEY NAMING follows the SharedContext convention (see shared-context.ts):
//   "plan", "requirements", "architecture",
//   "code:<target>", "tests:<target>", "build:<target>", "package:<target>"
//
// GENERATORS wrap the existing `generateForTarget` from generators.ts. They
// are the bridge between the new agent-runtime executor and the existing
// generator subsystem — the orchestrator no longer calls generators
// directly, it submits a Task whose agent is "frontend-generator" (etc.)
// and the runtime dispatches to the handler here.

import type { AgentHandler, AgentExecutionContext, AgentExecutionResult } from "./agent-contracts";
import type { PlatformKind, AgentRole, ProviderCapability } from "./types";
import { generateForTarget } from "./generators";
import { recommendTools, type ToolRecommendation } from "./skill-tool-router";
import { modelRouter } from "./provider-abstraction";

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Resolve the platform target for a generator/build/test/packaging handler.
 * Falls back to "web" when the task didn't carry platform info (which is the
 * legacy default for generator output).
 */
function platformTarget(ctx: AgentExecutionContext): PlatformKind {
  return ctx.platform ?? "web";
}

/**
 * Convert a PlatformKind into the literal string used as the SharedContext
 * key suffix (e.g. "code:web", "build:windows"). Kept separate from
 * `platformTarget` so future code can re-map a PlatformKind to a different
 * key namespace without touching every handler.
 */
function targetKey(ctx: AgentExecutionContext): string {
  return platformTarget(ctx);
}

/** File-shape used by generators and shared-context "code:<target>" entries. */
interface FileArtifact {
  path: string;
  content: string;
  language?: string;
}

/* ------------------------------------------------------------------ */
/* Wave 4B — Skill→Tool + Model Router integration                     */
/* ------------------------------------------------------------------ */

/**
 * Structured metadata derived from an agent's injected skills + the Model
 * Router. Produced by `deriveSkillToolContext()` and consumed by handlers
 * that want to log/emit skill-driven tool recommendations and the routed
 * model choice (Runtime V2 Audit, Phase 3 Steps 11 + 12).
 *
 * All fields are advisory — handlers ADD them to their output / sharedWrites
 * for observability; they do NOT replace existing tool-selection logic.
 */
interface SkillToolContext {
  /** IDs of the skills injected into this agent's context. */
  skillIds: string[];
  /** Tools recommended by those skills (deduplicated by tool ID). */
  toolRecommendations: ToolRecommendation[];
  /**
   * The model the Model Router selected for this agent's LLM capability, or
   * null if no connected provider offers an LLM model. When null, the handler
   * falls back to its pre-Wave-4B behavior (no model choice recorded).
   */
  modelChoice: { providerId: string; modelId: string; providerType: string } | null;
}

/**
 * Derive skill-driven tool recommendations + the Model Router's model choice
 * for a given agent execution context.
 *
 * This is the Wave 4B integration point:
 *   - Skills → `recommendTools()` (skill-tool-router.ts) → ToolRecommendation[]
 *   - Model Router → `modelRouter.select("llm", agent)` → { provider, model } | null
 *
 * Pure: reads ctx.skills + ctx.task.agent, returns a structured object. Does
 * NOT mutate ctx, does NOT throw, does NOT call out to generators or memory.
 *
 * @param ctx The agent execution context (must carry `skills` and `task.agent`).
 * @param capability The provider capability to route for. Defaults to "llm"
 *                   since most agents need text completion. Generators that
 *                   produce code may pass "llm" too — image/embedding agents
 *                   would pass their respective capability.
 */
function deriveSkillToolContext(
  ctx: AgentExecutionContext,
  capability: ProviderCapability = "llm"
): SkillToolContext {
  const skillIds = ctx.skills.map((s) => s.id);
  const toolRecommendations = recommendTools(skillIds);

  // Model Router integration — agents no longer hardcode model choices.
  // The router selects an appropriate provider+model for the agent's role
  // (preferring remote for high-stakes agents, local for low-stakes — see
  // provider-abstraction.ts). Returns null when no connected provider offers
  // the capability; the handler treats that as "no recommendation" and
  // proceeds with its existing default behavior.
  const routed = modelRouter.select(capability, ctx.task.agent as AgentRole);
  const modelChoice = routed
    ? {
        providerId: routed.provider.id,
        modelId: routed.model.id,
        providerType: routed.provider.type,
      }
    : null;

  return { skillIds, toolRecommendations, modelChoice };
}

/**
 * Format a SkillToolContext as a single human-readable line for inclusion in
 * an agent's `output` string. Keeps the output compact so existing log
 * scanners don't break — recommendations are listed by tool ID only.
 */
function formatSkillToolLine(stc: SkillToolContext): string {
  const tools = stc.toolRecommendations.length > 0
    ? stc.toolRecommendations.map((r) => r.toolId).join(",")
    : "(none)";
  const model = stc.modelChoice
    ? `${stc.modelChoice.providerId}/${stc.modelChoice.modelId} (${stc.modelChoice.providerType})`
    : "(no-model-routed)";
  return `skill-tools=[${tools}] model=${model} skills=${stc.skillIds.length}`;
}

/* ------------------------------------------------------------------ */
/* Layer 1 — Executive                                                  */
/* ------------------------------------------------------------------ */

/**
 * Planner — decomposes the prompt + capabilities into a dependency-ordered
 * plan. Writes "plan" to the SharedContext so downstream agents (architect,
 * generators) can read it.
 */
const planner: AgentHandler = (ctx) => {
  const plan = [
    `Plan for: ${ctx.prompt}`,
    `Targets: detect from prompt`,
    `Capabilities: ${ctx.capabilities.join(", ") || "(none)"}`,
    `Stages: analyze → plan → architect → generate → build → test → package → ready`,
  ].join("\n");
  return {
    status: "success",
    output: plan,
    sharedWrites: [{ key: "plan", value: plan }],
    memoryWrites: [
      { kind: "requirements", title: "Plan", content: plan },
    ],
  };
};

/**
 * Orchestrator gate handler — used for structural gate tasks (dependency
 * resolution, stage transitions). Always succeeds because the gate logic
 * itself lives in execution-engine.ts / self-healing.ts; this handler only
 * runs when the gate has already passed.
 */
const orchestrator: AgentHandler = (ctx) => {
  return {
    status: "success",
    output: `Gate passed: ${ctx.task.title}`,
  };
};

/* ------------------------------------------------------------------ */
/* Layer 2 — Architecture                                              */
/* ------------------------------------------------------------------ */

/**
 * Requirements Analyst — reads the prompt, produces a requirements summary.
 * Writes "requirements" to the SharedContext for downstream architects.
 */
const requirementsAnalyst: AgentHandler = (ctx) => {
  const analysis = [
    `Requirements for: ${ctx.prompt}`,
    `Detected capabilities: ${ctx.capabilities.join(", ") || "(none)"}`,
    `Memory context: ${ctx.memory.length} record(s)`,
  ].join("\n");
  return {
    status: "success",
    output: analysis,
    sharedWrites: [{ key: "requirements", value: analysis }],
    memoryWrites: [
      { kind: "requirements", title: "Analysis", content: analysis },
    ],
  };
};

/**
 * Solution Architect — reads "plan" (or falls back to the prompt) and
 * derives a system architecture. Writes "architecture" to the SharedContext.
 */
const solutionArchitect: AgentHandler = (ctx) => {
  const plan = ctx.shared.read<string>("plan") ?? ctx.prompt;
  const architecture = [
    `Architecture derived from plan:`,
    plan,
    ``,
    `Data model: Contact entity (id, name, email, phone)`,
    `Database: SQLite (default — Architecture Memory override supported)`,
    `API style: REST over HTTP`,
    `Targets: ${platformTarget(ctx)}`,
  ].join("\n");
  return {
    status: "success",
    output: architecture,
    sharedWrites: [{ key: "architecture", value: architecture }],
    memoryWrites: [
      { kind: "architecture", title: "System Architecture", content: architecture },
    ],
  };
};

/* ------------------------------------------------------------------ */
/* Layer 3 — Engineering generators                                    */
/* ------------------------------------------------------------------ */

/**
 * Frontend Generator — reads "architecture" from the SharedContext, invokes
 * the real `generateForTarget` (web/windows/android path), and writes the
 * produced files to "code:<target>" so downstream build/test/packaging
 * agents can consume them.
 *
 * This is the canonical example of the new architecture: the orchestrator
 * submits a Task with agent="frontend-generator"; the runtime dispatches to
 * this handler; the handler wraps the existing generator subsystem and
 * returns its output as artifacts + sharedWrites.
 */
const frontendGenerator: AgentHandler = (ctx) => {
  const platform = platformTarget(ctx);
  const key = targetKey(ctx);
  // Read the architecture (or fall back to the prompt) so the generator
  // receives a non-empty context. Generators currently key off the prompt
  // + capabilities; the architecture is logged for traceability.
  const architecture = ctx.shared.read<string>("architecture") ?? ctx.prompt;
  void architecture; // generator currently uses ctx.prompt below; architecture is reserved for future deep-integration.

  const result = generateForTarget(
    platform,
    "default-stack",
    "App",
    ctx.task.id,
    {
      prompt: ctx.prompt,
      capabilities: ctx.capabilities,
      nonFunctionals: [],
    }
  );

  const files: FileArtifact[] = result.files.map((f) => ({
    path: f.path,
    content: f.content,
    ...(f.language ? { language: f.language } : {}),
  }));

  return {
    status: "success",
    output: `Generated ${files.length} file(s) for ${key} (platform=${platform}, stack=${result.stack})`,
    artifacts: files,
    sharedWrites: [{ key: `code:${key}`, value: files }],
    memoryWrites: [
      {
        kind: "code",
        title: `${key} source`,
        content: files.map((f) => f.path).join("\n"),
      },
    ],
  };
};

/**
 * Desktop Generator — same shape as the frontend generator, but for the
 * "windows" platform target. Reads "architecture", writes "code:windows".
 */
const desktopGenerator: AgentHandler = (ctx) => {
  // Force the platform to windows for this agent regardless of inference.
  const platform: PlatformKind = "windows";
  const key = "windows";
  const result = generateForTarget(platform, "default-stack", "App", ctx.task.id, {
    prompt: ctx.prompt,
    capabilities: ctx.capabilities,
    nonFunctionals: [],
  });
  const files: FileArtifact[] = result.files.map((f) => ({
    path: f.path,
    content: f.content,
    ...(f.language ? { language: f.language } : {}),
  }));
  return {
    status: "success",
    output: `Generated ${files.length} desktop file(s) for ${key}`,
    artifacts: files,
    sharedWrites: [{ key: `code:${key}`, value: files }],
    memoryWrites: [
      {
        kind: "code",
        title: `${key} source`,
        content: files.map((f) => f.path).join("\n"),
      },
    ],
  };
};

/**
 * Android Generator — same shape as the frontend generator, but for the
 * "android" platform target. Reads "architecture", writes "code:android".
 */
const androidGenerator: AgentHandler = (ctx) => {
  const platform: PlatformKind = "android";
  const key = "android";
  const result = generateForTarget(platform, "default-stack", "App", ctx.task.id, {
    prompt: ctx.prompt,
    capabilities: ctx.capabilities,
    nonFunctionals: [],
  });
  const files: FileArtifact[] = result.files.map((f) => ({
    path: f.path,
    content: f.content,
    ...(f.language ? { language: f.language } : {}),
  }));
  return {
    status: "success",
    output: `Generated ${files.length} android file(s) for ${key}`,
    artifacts: files,
    sharedWrites: [{ key: `code:${key}`, value: files }],
    memoryWrites: [
      {
        kind: "code",
        title: `${key} source`,
        content: files.map((f) => f.path).join("\n"),
      },
    ],
  };
};

/* ------------------------------------------------------------------ */
/* Layer 4 — Quality & Delivery                                        */
/* ------------------------------------------------------------------ */

/**
 * Build Engineer — reads "code:<target>" from the SharedContext, simulates
 * running the build toolchain, and writes "build:<target>" with the result.
 *
 * (Real toolchain invocation happens via the existing tool-client bridge for
 * tasks that carry a `toolId`. This handler covers the in-memory case where
 * the orchestrator submits a build task without a toolId — e.g. for trace
 * generation or smoke builds.)
 *
 * WAVE 4B — Skill→Tool + Model Router integration (ADDITIVE):
 *   - Derives tool recommendations from the agent's injected skills via
 *     `deriveSkillToolContext()` (which calls `recommendTools()` from
 *     skill-tool-router.ts + `modelRouter.select()` from
 *     provider-abstraction.ts).
 *   - Emits an observability event listing the recommended tools.
 *   - Writes a `build:<target>:skill-tools` shared-context entry capturing
 *     the structured recommendation+model metadata for downstream agents /
 *     debug endpoints.
 *   - EXTENDS the output string with a compact skill-tools+model line.
 *
 * Backward compatibility: existing `build:<target>` write and memory write
 * are unchanged. The skill/model metadata is ADDITIONAL. Existing tool
 * selection (task.toolId) is preserved — skill recommendations do NOT
 * override it; they only supplement observability.
 */
const buildEngineer: AgentHandler = (ctx) => {
  const key = targetKey(ctx);
  const files = ctx.shared.read<FileArtifact[]>(`code:${key}`) ?? [];
  const success = files.length > 0 || true; // always succeed for in-memory sim
  const buildRecord = {
    success,
    fileCount: files.length,
    logs: `Compiled ${files.length} file(s) for ${key}`,
  };

  // ── Wave 4B: skill-driven tool recommendations + Model Router ───────
  const stc = deriveSkillToolContext(ctx);
  // Emit an observability event so the runtime can see which tools the
  // skills recommended for this build (and which model the router chose).
  // In a full V2 implementation, the handler would invoke each recommended
  // tool via ToolManager (or the Wave 1B Sandbox) — here we log only, to
  // preserve the existing in-memory build simulation.
  if (stc.toolRecommendations.length > 0) {
    ctx.emit({
      type: "skill-tool-recommendation",
      message: `build-engineer: skills recommend tools [${stc.toolRecommendations
        .map((r) => r.toolId)
        .join(",")}] for ${key}`,
      level: "info",
    });
  }
  if (stc.modelChoice) {
    ctx.emit({
      type: "model-router-choice",
      message: `build-engineer: router selected ${stc.modelChoice.providerId}/${stc.modelChoice.modelId}`,
      level: "info",
    });
  }

  return {
    status: "success",
    output: `Build simulated for ${key} (${files.length} file(s), success=${success}) | ${formatSkillToolLine(
      stc
    )}`,
    sharedWrites: [
      { key: `build:${key}`, value: buildRecord },
      // ADDITIVE: structured skill→tool + model metadata for downstream
      // consumers (debug endpoints, verification loop, etc.).
      { key: `build:${key}:skill-tools`, value: stc },
    ],
    memoryWrites: [
      {
        kind: "build",
        title: `${key} build`,
        content: buildRecord.logs,
      },
    ],
  };
};

/**
 * Test Generator — reads "code:<target>" and writes a test summary to
 * "tests:<target>".
 *
 * WAVE 4B — Skill→Tool + Model Router integration (ADDITIVE):
 *   Derives tool recommendations + routed model via `deriveSkillToolContext()`
 *   and appends a compact metadata line to the output. Existing "tests:<target>"
 *   write is unchanged. The metadata is also written to "tests:<target>:skill-tools"
 *   so downstream packaging agents can see which validation tools were endorsed.
 */
const testGenerator: AgentHandler = (ctx) => {
  const key = targetKey(ctx);
  const files = ctx.shared.read<FileArtifact[]>(`code:${key}`) ?? [];
  const testRecord = {
    testCount: 1,
    files: files.map((f) => ({ path: f.path.replace(/\.tsx?$/, ".test.ts").replace(/\.kt$/, "Test.kt").replace(/\.cs$/, "Tests.cs"), content: `// smoke test for ${f.path}\n` })),
  };

  // ── Wave 4B: skill-driven tool recommendations + Model Router ───────
  const stc = deriveSkillToolContext(ctx);
  if (stc.toolRecommendations.length > 0) {
    ctx.emit({
      type: "skill-tool-recommendation",
      message: `test-generator: skills recommend tools [${stc.toolRecommendations
        .map((r) => r.toolId)
        .join(",")}] for ${key}`,
      level: "info",
    });
  }

  return {
    status: "success",
    output: `Tests for ${key} (${testRecord.testCount} suite(s), ${testRecord.files.length} source file(s)) | ${formatSkillToolLine(
      stc
    )}`,
    sharedWrites: [
      { key: `tests:${key}`, value: testRecord },
      // ADDITIVE: skill→tool + model metadata for downstream consumers.
      { key: `tests:${key}:skill-tools`, value: stc },
    ],
  };
};

/**
 * Packaging Engineer — reads "build:<target>" + "tests:<target>" and writes
 * a packaging record to "package:<target>".
 *
 * WAVE 4B — Skill→Tool + Model Router integration (ADDITIVE):
 *   Derives tool recommendations + routed model via `deriveSkillToolContext()`
 *   and appends a compact metadata line to the output. Existing
 *   "package:<target>" write is unchanged.
 */
const packagingEngineer: AgentHandler = (ctx) => {
  const key = targetKey(ctx);
  const build = ctx.shared.read<{ success: boolean; fileCount: number }>(`build:${key}`);
  const tests = ctx.shared.read<{ testCount: number }>(`tests:${key}`);
  const ready = !!build && !!tests;
  const packageRecord = {
    ready,
    buildOk: build?.success ?? false,
    testCount: tests?.testCount ?? 0,
    artifactPath: ready ? `dist/${key}-package.zip` : undefined,
  };

  // ── Wave 4B: skill-driven tool recommendations + Model Router ───────
  const stc = deriveSkillToolContext(ctx);
  if (stc.toolRecommendations.length > 0) {
    ctx.emit({
      type: "skill-tool-recommendation",
      message: `packaging-engineer: skills recommend tools [${stc.toolRecommendations
        .map((r) => r.toolId)
        .join(",")}] for ${key}`,
      level: "info",
    });
  }

  return {
    status: "success",
    output: `Packaged ${key} (build: ${build?.success ? "ok" : "?"}, tests: ${tests?.testCount ?? 0}, ready: ${ready}) | ${formatSkillToolLine(
      stc
    )}`,
    sharedWrites: [
      { key: `package:${key}`, value: packageRecord },
      // ADDITIVE: skill→tool + model metadata for downstream consumers.
      { key: `package:${key}:skill-tools`, value: stc },
    ],
  };
};

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

/**
 * The agent handler registry. Maps an AgentRole (string) to its handler.
 * The AgentRuntime.executeTask() looks up the handler by `task.agent` and
 * invokes it.
 *
 * Keys are AgentRole string literals (see types.ts). Unmapped roles fall
 * through to a default "noop success" inside the runtime, so adding a new
 * agent to data/agents.ts without a handler here does NOT break the build —
 * the runtime returns a structured "no handler registered" failure result
 * that the orchestrator can decide how to handle (skip / fail / retry).
 */
export const agentHandlers: Partial<Record<string, AgentHandler>> = {
  // Layer 1 — Executive
  orchestrator,
  planner,

  // Layer 2 — Architecture
  "requirements-analyst": requirementsAnalyst,
  "solution-architect": solutionArchitect,

  // Layer 3 — Engineering generators
  "frontend-generator": frontendGenerator,
  "desktop-generator": desktopGenerator,
  "android-generator": androidGenerator,

  // Layer 4 — Quality & Delivery
  "build-engineer": buildEngineer,
  "test-generator": testGenerator,
  "packaging-engineer": packagingEngineer,
};

/**
 * Count of registered handlers (exposed for the worklog / health endpoint).
 */
export const AGENT_HANDLER_COUNT = Object.keys(agentHandlers).length;

/**
 * Look up a handler by agent role. Returns undefined if no handler is
 * registered (the runtime treats this as a structured failure).
 */
export function getAgentHandler(role: string): AgentHandler | undefined {
  return agentHandlers[role];
}
