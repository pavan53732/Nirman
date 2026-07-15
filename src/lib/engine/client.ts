// engine/client.ts — Client-safe barrel for browser code.
//
// This barrel exports ONLY modules that are safe to run in the browser:
//   - No `fs`, `path`, `child_process`, or other Node-only builtins
//   - No static or dynamic imports of server-only modules
//
// ENFORCEMENT: scripts/check-boundaries.mjs automatically verifies that
// no client-side file (src/components/**, src/hooks/**, src/lib/store.ts,
// src/lib/export.ts, src/app/**/page.tsx, src/app/**/layout.tsx) imports
// from the full barrel (@/lib/engine or ./engine). Client code MUST import
// from @/lib/engine/client. This is enforced, not just convention.
//
// ┌──────────────────────────────────────────────────────────────────┐
// │                   RUNTIME BOUNDARY ARCHITECTURE                   │
// ├──────────────────────────────────────────────────────────────────┤
// │                                                                  │
// │  engine/client.ts     ← Browser-safe only (this file)           │
// │     ↑                                                            │
// │     │  client components import from here                        │
// │  ───┼───────────────────────────────────────────────────────     │
// │     │                                                            │
// │  engine/index.ts      ← Full barrel (includes server-only)      │
// │     ↑                                                            │
// │     │  server-side code (API routes) imports from here           │
// │                                                                  │
// │  Server-only modules (NEVER in client barrel):                   │
// │    - skills/loader.ts     (uses fs, path)                       │
// │    - tool-manager.ts      (uses child_process)                   │
// │    - sandbox.ts           (references tool-manager)              │
// │    - skill-injector.ts    (dynamic import of skills/loader)      │
// │    - unified-context.ts   (globalThis.require for workspace-int) │
// │    - failure-tests.ts     (imports skills/loader directly)       │
// │    - runtime-metrics.ts   (process.memoryUsage)                  │
// └──────────────────────────────────────────────────────────────────┘

// ─── Execution & Scheduling ──────────────────────────────────────────
export { executionEngine, checkpointManager, makeTask } from "./execution-engine";
export type { Task, TaskStatus, EngineEvent } from "./types";

// ─── Orchestrator & Workflow ─────────────────────────────────────────
export { orchestrator, detectTargets, readDatabaseFromMemory } from "./orchestrator";
export type { OrchestrationResult } from "./orchestrator";
export { workflowEngine } from "./workflow-engine";
export type { Workflow, WorkflowId } from "./types";

// ─── Decision Engine ────────────────────────────────────────────────
export {
  decisionEngine,
  detectCapabilities,
  detectNonFunctionals,
} from "./decision-engine";
export type { DetectedTargets } from "./decision-engine";

// ─── Memory ─────────────────────────────────────────────────────────
export { projectMemory, contextBuilder, memoryAccess } from "./memories";
export type { MemoryRecord, MemoryKind } from "./types";

// ─── Observability ──────────────────────────────────────────────────
export { observability } from "./observability";

// ─── Provider Abstraction (Model Router, Token Budget) ──────────────
export {
  providerManager,
  modelRouter,
  costOptimizer,
  tokenBudgetManager,
} from "./provider-abstraction";

// ─── Artifact Registry ──────────────────────────────────────────────
export { artifactRegistry } from "./artifact-registry";

// ─── Generators ─────────────────────────────────────────────────────
export { generateForTarget } from "./generators";
export type { GenerationResult, DatabaseChoice, VirtualFile } from "./generators";

// ─── Shared Context ─────────────────────────────────────────────────
export { sharedContext } from "./shared-context";

// ─── Task Graph ─────────────────────────────────────────────────────
export { taskGraph } from "./task-graph";

// ─── Agent Runtime ──────────────────────────────────────────────────
export { agentRuntime } from "./agent-runtime";
export type { AgentActivation } from "./agent-runtime";

// ─── Event Bus ──────────────────────────────────────────────────────
export { agentEventBus, registerDefaultSubscriptions } from "./event-bus";
export type { AgentEvent } from "./event-bus";

// ─── Dynamic Agents ─────────────────────────────────────────────────
export {
  dynamicAgentRegistry,
  planDynamicSpawns,
  makeSpecialistHandler,
} from "./dynamic-agents";
export type { DynamicAgent, SubAgentSpec } from "./agent-contracts";

// ─── Agent Teams ────────────────────────────────────────────────────
export { agentTeamRegistry } from "./agent-teams";
export type { AgentTeam, TeamId } from "./agent-teams";

// ─── Verification Loop ──────────────────────────────────────────────
export { verificationLoop } from "./verification-loop";
export type { VerificationResult } from "./verification-loop";

// ─── Long-Run Manager ───────────────────────────────────────────────
export { longRunManager } from "./long-run-manager";
export type { LongRunSnapshot } from "./long-run-manager";

// ─── Runtime Learning ───────────────────────────────────────────────
export { runtimeLearning } from "./runtime-learning";
export type { LearningRecord, LearningKind } from "./runtime-learning";

// ─── Negotiation Engine ─────────────────────────────────────────────
export { negotiationEngine, negotiationReviewHandlers } from "./negotiation-engine";
export type { NegotiationResult } from "./negotiation-engine";

// ─── Skill Tool Router ──────────────────────────────────────────────
export { recommendTools } from "./skill-tool-router";
export type { ToolRecommendation } from "./skill-tool-router";

// ─── Smart Scheduler ────────────────────────────────────────────────
export { smartScheduler } from "./smart-scheduler";
export type { TaskPriority } from "./smart-scheduler";

// ─── Ambiguity Detection ────────────────────────────────────────────
export {
  detectAmbiguity,
  askQuestionIfNeeded,
  AMBIGUITY_THRESHOLD,
} from "./skills/ambiguity-detector";

// ─── IndexedDB ──────────────────────────────────────────────────────
export { isIndexedDBAvailable } from "./idb";

// ─── Static Data (Registries) ───────────────────────────────────────
export { skills, skillCategories, stageAgentMap } from "./data/skills";
export { agents } from "./data/agents";
export { registries } from "./registries";

// ─── Plugin System ──────────────────────────────────────────────────
export { pluginRegistry } from "./plugin-system";

// ─── Project Evolution ──────────────────────────────────────────────
export { projectEvolution } from "./project-evolution";
export type { ProjectSnapshot } from "./project-evolution";

// ─── Self-Healing ───────────────────────────────────────────────────
export { selfHealController } from "./self-healing";

// ─── Types (re-exported for convenience) ────────────────────────────
export type {
  AgentRole,
  AgentLayer,
  StageId,
  GateId,
  Capability,
  NonFunctional,
  PlatformKind,
  ArtifactType,
} from "./types";

// ─── Agent Contracts (types only) ───────────────────────────────────
export type {
  AgentHandler,
  AgentExecutionContext,
  AgentExecutionResult,
  SharedContext,
  SkillContent,
} from "./agent-contracts";

// ─── Workspace Intelligence (client-safe — pure logic) ──────────────
export { workspaceIntelligence } from "./workspace-intelligence";
export type { WorkspaceGraph, Symbol, Dependency } from "./workspace-intelligence";

// ─── Collaboration Engine ───────────────────────────────────────────
export { collaborationEngine, criticHandlers } from "./agent-collaboration";
export type { CollaborationResult } from "./agent-collaboration";

// ─── Planning Hierarchy ─────────────────────────────────────────────
export { planningHierarchy } from "./planning-hierarchy";
export type { ProjectPlan, FeaturePlan, ModulePlan, TaskSpec } from "./planning-hierarchy";

// ─── Performance Harness ────────────────────────────────────────────
export { runPerfProfile, summarizePerf } from "./perf-harness";
export type { PerfResult } from "./perf-harness";

// ─── Platform Adapters ──────────────────────────────────────────────
export { platformAdapterRegistry } from "./platform-adapters";

// ─── Static Validators ──────────────────────────────────────────────
export {
  validateXmlCsproj,
  validateSln,
  validateKotlinSyntax,
  validateGradleKts,
} from "./static-validators";

// ─── Preview Providers ──────────────────────────────────────────────
export type { PreviewProvider } from "./preview-providers";

// ─── Skill & Tool Registries ────────────────────────────────────────
export { skillRegistry } from "./skill-registry";
export { toolRegistry } from "./tool-registry";
