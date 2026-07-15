// Pavan engine — public API. Importing this module bootstraps all registries.
//
// Registry layering:
//   Skill -> Tool -> Agent -> PlatformAdapter -> PreviewProvider
//   -> Provider Abstraction -> Workflow Engine -> Execution Engine -> Orchestrator

import { registries } from "./registries";
import { skills, skillCategories, stageAgentMap } from "./data/skills";
import { tools } from "./data/tools";
import { agents } from "./data/agents";
import { platformAdapters, previewProviders, providers } from "./data/adapters";

import { orchestrator, readDatabaseFromMemory } from "./orchestrator";
import { executionEngine, checkpointManager, makeTask } from "./execution-engine";
import { workflowEngine } from "./workflow-engine";
import { projectMemory, contextBuilder, MEMORY_KINDS } from "./memories";
import { artifactRegistry } from "./artifact-registry";
import { decisionEngine, detectCapabilities, detectNonFunctionals } from "./decision-engine";
import { detectTargets } from "./orchestrator";
import { selfHealController, evaluateGate, GATE_META, DEFAULT_SELF_HEAL_POLICY } from "./self-healing";
import { observability } from "./observability";
import { agentRuntime, initAgentRuntime, AGENT_LABELS, AGENT_LAYERS } from "./agent-runtime";
import { providerManager, modelRouter, costOptimizer, tokenBudgetManager } from "./provider-abstraction";
import {
  generateForTarget,
  generateWinUI3,
  generateAndroidCompose,
  generateNextjs,
  generateTauri,
  generateFlutter,
  generateRustCli,
  type GenerationResult,
} from "./generators";

// Bootstrap registries (idempotent)
registries.skills.registerAll(skills);
registries.tools.registerAll(tools);
registries.agents.registerAll(agents);
registries.platformAdapters.registerAll(platformAdapters);
registries.previewProviders.registerAll(previewProviders);
registries.providers.registerAll(providers);

// Derive Agent.consumes (inverse of Skill.agent): each agent consumes the
// skills whose `agent` field matches its role. Both directions now exist.
for (const agent of registries.agents.all()) {
  agent.consumes = registries.skills
    .filter((s) => s.agent === agent.role)
    .map((s) => s.id);
}

// Bootstrap orchestrator (wire event bus to observability)
orchestrator.bootstrap();

export {
  registries,
  skills,
  skillCategories,
  stageAgentMap,
  agents,
  orchestrator,
  readDatabaseFromMemory,
  executionEngine,
  checkpointManager,
  makeTask,
  workflowEngine,
  projectMemory,
  contextBuilder,
  MEMORY_KINDS,
  artifactRegistry,
  decisionEngine,
  detectCapabilities,
  detectNonFunctionals,
  detectTargets,
  selfHealController,
  evaluateGate,
  GATE_META,
  DEFAULT_SELF_HEAL_POLICY,
  observability,
  agentRuntime,
  initAgentRuntime,
  AGENT_LABELS,
  AGENT_LAYERS,
  providerManager,
  modelRouter,
  costOptimizer,
  tokenBudgetManager,
  generateForTarget,
  generateWinUI3,
  generateAndroidCompose,
  generateNextjs,
  generateTauri,
  generateFlutter,
  generateRustCli,
};
export type { GenerationResult, DatabaseChoice, VirtualFile } from "./generators";
export {
  detectAmbiguity,
  askQuestionIfNeeded,
  AMBIGUITY_THRESHOLD,
  type AmbiguityResult,
  type AmbiguityCheck,
} from "./skills/ambiguity-detector";
export {
  SKILLS,
  TOTAL_SKILLS,
  getSkillsForPlatform,
  hasSkill,
  type SkillPlatform,
  type SkillId,
} from "./skills/registry";
export {
  idbSaveCheckpoint,
  idbLoadCheckpoints,
  idbLoadLatestCheckpoint,
  idbClearCheckpoints,
  idbSaveMemory,
  idbLoadLatestMemory,
  isIndexedDBAvailable,
  type PersistedCheckpoint,
  type PersistedMemory,
} from "./idb";

export * from "./types";
export type { AgentContextBundle } from "./memories";
// MemoryAccess (Wave 2B) — the official facade for reading/writing memory
// from internal engine modules. Direct `projectMemory` access is
// deprecated for engine internals (Runtime V2 Audit, Phase 2 Step 6:
// "Every agent receives context EXCLUSIVELY through Context Builder.
// Agents never query memory directly."). `projectMemory` remains
// exported above for external consumers (debug endpoints, the
// failure-test harness, the orchestrator during the Wave 2A transition).
// ADDITIVE — does not modify the existing `projectMemory` export.
export { MemoryAccess, memoryAccess } from "./memories";
export type { AgentActivation } from "./agent-runtime";

// Dynamic sub-agent registry (Task J) — capability-based spawn/destroy
// lifecycle for specialist agents. These exports are ADDITIVE and do not
// modify any Task I / Task L symbols above.
export {
  DynamicAgentRegistry,
  dynamicAgentRegistry,
  planDynamicSpawns,
  makeSpecialistHandler,
  CAPABILITY_TO_SPECIALIST,
} from "./dynamic-agents";
export type { DynamicAgent, SubAgentSpec } from "./agent-contracts";

// SharedContext blackboard + agent handler registry + executor contracts (Task I).
// These exports wire the new execution gateway: AgentRuntime.executeTask()
// dispatches to handlers in agent-handlers.ts, which read/write the
// sharedContext blackboard to pass work products between agents.
export { SharedContextImpl, sharedContext } from "./shared-context";
export {
  agentHandlers,
  getAgentHandler,
  AGENT_HANDLER_COUNT,
} from "./agent-handlers";
export type {
  SharedContext,
  AgentHandler,
  AgentExecutionContext,
  AgentExecutionResult,
  SkillContent,
} from "./agent-contracts";

// SkillInjector (Task K) — resolves which SKILL.md files are relevant to each
// agent role and loads their content for injection into the agent's execution
// context. These exports are ADDITIVE and do not modify any Task I / Task J /
// Task L symbols above.
export {
  injectSkills,
  injectSkillsWithTools,
  getInjectionPlan,
  enrichSkillsWithLoaderContent,
  getAgentSkillMap,
  getCapabilitySkillMap,
  getSkillFolder,
} from "./skill-injector";

// SkillToolRouter (Wave 4B) — maps injected skills to recommended tools. When
// a skill is injected into an agent's context, it may recommend specific
// tools the agent should use. This module provides that mapping plus a
// `recommendTools()` function that deduplicates recommendations by tool ID.
// Used by the agent handlers (agent-handlers.ts) to drive tool selection
// based on the agent's injected skills. ADDITIVE — does not modify the
// SkillInjector or any existing tool selection logic; recommendations are
// advisory and supplement (not replace) existing tool selection.
export {
  recommendTools,
  getSkillToolMap,
} from "./skill-tool-router";
export type { ToolRecommendation } from "./skill-tool-router";

// WorkspaceIntelligence (Task P) — indexes generated files into 4 graphs
// (semantic index, symbol graph, dependency graph, architecture graph) so
// agents can query "what symbols are in this file?" / "what depends on what?"
// without reading every file. ADDITIVE — does not modify earlier exports.
export { WorkspaceIntelligence, workspaceIntelligence } from "./workspace-intelligence";
export type {
  FileSemanticInfo,
  Symbol,
  Dependency,
  ArchitectureLayer,
  WorkspaceGraph,
} from "./workspace-intelligence";

// WorkspaceReasoning (Task W) — deeper analysis capabilities built on top of
// the 4-graph workspace intelligence: semantic search, impact analysis,
// architecture validation, dependency recommendations, dead-code detection.
// These exports are ADDITIVE and do not modify any earlier symbols.
export { WorkspaceReasoning, workspaceReasoning } from "./workspace-reasoning";
export type {
  SemanticSearchResult,
  ImpactAnalysis,
  ArchitectureValidation,
  ArchitectureViolation,
  DependencyRecommendation,
  DeadCodeReport,
} from "./workspace-reasoning";

// UnifiedContextBuilder (Task Q) — assembles a MINIMAL, complete context
// bundle per agent by unifying the four context sources (memory, skills,
// shared context, workspace graph). Each agent receives ONLY its declared
// slices — no more, no less. These exports are ADDITIVE.
export { UnifiedContextBuilder, unifiedContextBuilder } from "./unified-context";
export type { UnifiedContext } from "./unified-context";

// AgentEventBus (Task O) — a pub/sub event bus for reactive agent scheduling.
// Agents publish events when they produce work; other agents subscribe to
// event types and are notified asynchronously. This complements the
// SharedContext blackboard (synchronous data plane) with an asynchronous
// control plane so the orchestrator doesn't have to hardcode every
// inter-agent dependency — the Reviewer simply subscribes to "code-generated"
// and auto-activates when code is ready. These exports are ADDITIVE and do
// not modify any Task I / Task J / Task K / Task L symbols above.
export { AgentEventBus, agentEventBus, registerDefaultSubscriptions } from "./event-bus";
export type { AgentEvent, AgentEventHandler, AgentSubscription } from "./event-bus";

// Plugin System (Task S) — allows adding agents, skills, tools, and platform
// adapters WITHOUT modifying the core engine. A plugin is a self-contained
// module under src/lib/engine/plugins/*/index.ts that calls
// `loadPlugin(manifest, register)` at import time. `loadAllPlugins()` discovers
// and imports every built-in plugin, triggering their side-effecting
// registration against the shared `pluginRegistry`. These exports are
// ADDITIVE and do not modify any core engine file (orchestrator, runtime,
// handlers, generators, etc.).
export type {
  PluginRegistry,
  PluginManifest,
  PluginContribution,
  PluginContributionType,
  PluginAgentMetadata,
  PluginSkillInput,
  PluginToolInput,
  PluginPlatformAdapterInput,
  LoadedPlugin,
} from "./plugin-system";
export {
  pluginRegistry,
  loadPlugin,
  loadAllPlugins,
  getPluginSummary,
} from "./plugin-system";
import { loadAllPlugins } from "./plugin-system";

// Agent Collaboration Engine (Task U) — enables agents to critique and
// refine each other's outputs through structured negotiation rounds. Three
// patterns: critique-refine (producer ↔ critic, up to N rounds), peer
// review (two agents review each other), and consensus (multiple voters
// choose between discrete options). These exports are ADDITIVE and do not
// modify any core engine file (orchestrator, runtime, handlers,
// generators, memories, shared-context, etc.).
export {
  AgentCollaborationEngine,
  collaborationEngine,
  criticHandlers,
} from "./agent-collaboration";
export type {
  Critique,
  CritiqueIssue,
  CollaborationRound,
  CollaborationResult,
  CollaborationConfig,
} from "./agent-collaboration";

// Project Evolution (Task Y) — snapshot/restore/analyze/track for continuous
// evolution. Enables Nirman to reopen an existing project months later,
// understand its architecture, and continue evolving it without losing prior
// design decisions. ADDITIVE — does not modify any earlier exports.
export { ProjectEvolution, projectEvolution } from "./project-evolution";
export type {
  ProjectSnapshot,
  EvolutionDiff,
  ArchitectureUnderstanding,
} from "./project-evolution";

// Eagerly load built-in plugins on the CLIENT at module init (non-blocking).
// On the SERVER, plugin loading is deferred to the /api/debug/plugins
// endpoint (and any future orchestrator integration that consumes
// plugin-contributed handlers) so module import stays cheap and side
// effects only run when needed.
if (typeof window !== "undefined") {
  loadAllPlugins().catch(() => {
    // Plugin load failures are non-fatal — the core engine still works
    // without plugin contributions.
  });
}

// Planning Hierarchy (Task V) — 4-level hierarchical planning
// (Project -> Feature -> Module -> Task). Makes large multi-feature projects
// (e.g. "CRM with contacts, deals, pipeline, activities, reports") manageable
// by systematically decomposing them into a structured DAG. ADDITIVE — does
// not modify the existing single-level planner agent in agent-handlers.ts.
export { PlanningHierarchy, planningHierarchy } from "./planning-hierarchy";
export type { ProjectPlan, FeaturePlan, ModulePlan, TaskSpec } from "./planning-hierarchy";

// Agent Teams (Wave 1C) — groups the existing 70 flat agents into 6
// specialized teams (Planning, Architecture, Engineering, Quality, Delivery,
// System). Teams are a GROUPING layer on top of the flat registry: they don't
// replace `data/agents.ts` and don't modify the agent runtime/handlers. The
// registry provides team lookups (teamForAgent, specialists) and task routing
// (route(taskDescription, preferredAgent?) → { team, assignedAgent, reason }).
// ADDITIVE — does not modify any earlier exports.
export { AgentTeamRegistry, agentTeamRegistry } from "./agent-teams";
export type { AgentTeam, TeamId, TeamRoutingResult } from "./agent-teams";

// Verification Loop (Wave 1D) — generate→build→verify→fix cycle. When a task
// completes, the loop runs verification checks; on failure it creates fix
// tasks and inserts them into the TaskGraph (Wave 1A). Tracks retry counts
// per task to prevent infinite cycles (MAX_RETRIES=3). If Wave 1A's
// task-graph.ts is not yet present, the loop degrades gracefully: fix tasks
// are still recorded against the VerificationResult, and live insertion
// kicks in the moment Wave 1A ships. ADDITIVE — does not modify the existing
// gate evaluation in self-healing.ts (verification is layered on top).
export { VerificationLoop, verificationLoop } from "./verification-loop";
export type {
  VerificationResult,
  VerificationCheck,
  VerificationStatus,
  FixTaskSpec,
  TaskGraphInsertable,
} from "./verification-loop";

// TaskGraph (Wave 1A, Runtime V2 Migration) — a mutable DAG of tasks that
// can be updated DURING execution. Pairs with `ExecutionEngine.insertTask()`
// to enable verification-driven fix tasks: when verification fails, a fix
// task is inserted into the running graph and scheduled immediately if its
// dependencies are satisfied. ADDITIVE — does not modify any existing
// exports; `submitAll()` and the rest of the ExecutionEngine API are
// unchanged.
export { TaskGraph, taskGraph } from "./task-graph";
export type { TaskGraphMutation } from "./task-graph";

// Sandbox (Wave 1B) — wraps ToolManager execution with 7 isolation profiles
// (web, windows, android, cli, api, library, plugin). Every V2 build executes
// inside a Sandbox: the Sandbox delegates the actual process spawn to
// ToolManager.invoke() and wraps the result with artifact parsing + metric
// collection (peak memory, cpu time, output bytes, error/warning counts) +
// structured logs. ADDITIVE — does not modify ToolManager, orchestrator,
// execution-engine, agent-runtime, or agent-handlers.
export { Sandbox, sandbox } from "./sandbox";
export type {
  SandboxProfile,
  SandboxResult,
  SandboxArtifact,
  SandboxMetrics,
  SandboxLog,
  SandboxOptions,
} from "./sandbox";

// Artifact Store Query API (Wave 3A, Runtime V2 Migration Step 8) — makes the
// ArtifactRegistry queryable. The registry already had `produce()` / `get()`
// / `all()` / `lineage()` (flat ancestor list); Wave 3A adds `query(filter)`,
// `byType(type)`, `byTarget(target)`, `lineageGraph(id)` (structured
// `{ artifact, parents, children, lineageDepth }`), and `getQuerySummary()`.
// Existing methods are UNCHANGED (no breaking modifications) — the new
// structured-lineage method lives under a new name to avoid colliding with
// the pre-existing flat-list `lineage(id)` method. ADDITIVE — does not modify
// any other engine file (orchestrator, agent-runtime, preview, generators).
export type {
  ArtifactQuery,
  ArtifactLineage,
  ArtifactQuerySummary,
} from "./artifact-registry";

// Runtime Metrics (Wave 4C) — collects AGGREGATE diagnostics for optimization:
// agent utilization (% of build time each agent was active), parallelism
// (max/avg concurrent tasks, parallelism ratio), task latency percentiles
// (p50/p95 per stage), build latency end-to-end, memory usage (heap/rss),
// token usage by agent, cache hit rate, workspace-graph query latency, and
// verification retry counts. ADDITIVE — does NOT modify observability.ts
// (the existing event recorder / token timeline / workflow aggregates are
// the source of record for raw events; RuntimeMetrics is a separate
// collector focused on aggregate dashboards). Exposed via the
// /api/debug/metrics endpoint. Today metrics are populated via explicit
// `runtimeMetrics.record*()` calls from the debug endpoint; a future wave
// can wire these calls into execution-engine / orchestrator / workspace-
// intelligence / verification-loop so they populate automatically on every
// build.
export { RuntimeMetricsCollector, runtimeMetrics } from "./runtime-metrics";
export type {
  RuntimeMetrics,
  AgentUtilizationMetric,
  ParallelismMetric,
  LatencyMetric,
  CacheMetric,
  GraphQueryMetric,
} from "./runtime-metrics";
