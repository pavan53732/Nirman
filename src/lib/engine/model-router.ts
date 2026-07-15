// Model Router — the single point of model selection for all agents.
//
// This is a thin facade that re-exports the ModelRouter from
// provider-abstraction.ts. It exists as a separate file for DISCOVERABILITY
// so reviewers and developers can find the model routing logic by name.
//
// No subsystem chooses models directly. All model selection goes through:
//   modelRouter.select(capability, agent) → { provider, model } | null
//
// Capabilities:
//   - "llm":       general reasoning / text generation
//   - "coding":    code generation / refinement
//   - "analysis":  code review / analysis
//   - "cheap":     fast, low-cost operations
//   - "local":     local model (if available)
//   - "cloud":     cloud model (if available)

export {
  ModelRouter,
  modelRouter,
} from "./provider-abstraction";

export type { Provider, ProviderModel, ProviderCapability } from "./types";
