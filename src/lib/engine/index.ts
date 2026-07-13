// Pavan engine — public API. Importing this module bootstraps all registries.
//
// Registry layering:
//   Skill -> Tool -> Agent -> PlatformAdapter -> PreviewProvider
//   -> Provider Abstraction -> Workflow Engine -> Execution Engine -> Orchestrator

import { registries } from "./registries";
import { skills } from "./data/skills";
import { tools } from "./data/tools";
import { agents } from "./data/agents";
import { platformAdapters, previewProviders, providers } from "./data/adapters";

import { orchestrator } from "./orchestrator";
import { executionEngine, checkpointManager, makeTask } from "./execution-engine";
import { workflowEngine } from "./workflow-engine";
import { projectMemory, contextBuilder } from "./memories";
import { artifactRegistry } from "./artifact-registry";
import { decisionEngine, detectCapabilities } from "./decision-engine";
import { detectTargets } from "./orchestrator";
import { selfHealController, evaluateGate, GATE_META, DEFAULT_SELF_HEAL_POLICY } from "./self-healing";
import { observability } from "./observability";
import { providerManager, modelRouter, costOptimizer, tokenBudgetManager } from "./provider-abstraction";

// Bootstrap registries (idempotent)
registries.skills.registerAll(skills);
registries.tools.registerAll(tools);
registries.agents.registerAll(agents);
registries.platformAdapters.registerAll(platformAdapters);
registries.previewProviders.registerAll(previewProviders);
registries.providers.registerAll(providers);

// Bootstrap orchestrator (wire event bus to observability)
orchestrator.bootstrap();

export {
  registries,
  orchestrator,
  executionEngine,
  checkpointManager,
  makeTask,
  workflowEngine,
  projectMemory,
  contextBuilder,
  artifactRegistry,
  decisionEngine,
  detectCapabilities,
  detectTargets,
  selfHealController,
  evaluateGate,
  GATE_META,
  DEFAULT_SELF_HEAL_POLICY,
  observability,
  providerManager,
  modelRouter,
  costOptimizer,
  tokenBudgetManager,
};

export * from "./types";
