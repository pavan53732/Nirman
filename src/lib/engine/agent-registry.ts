// Registry alias — re-exports the Agent Registry from the consolidated
// registries module so consumers can import from a spec-named file.
export { agentRegistry, registries } from "./registries";
export type { Agent, AgentRole, AgentLayer } from "./types";
