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
  getInjectionPlan,
  enrichSkillsWithLoaderContent,
  getAgentSkillMap,
  getCapabilitySkillMap,
  getSkillFolder,
} from "./skill-injector";
