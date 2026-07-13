// Registry alias — re-exports the Tool Registry from the consolidated
// registries module so consumers can import from a spec-named file.
export { toolRegistry, registries } from "./registries";
export type { Tool } from "./types";
