// Registry alias — re-exports the Skill Registry from the consolidated
// registries module so consumers can import from a spec-named file.
export { skillRegistry, registries } from "./registries";
export type { Skill } from "./types";
