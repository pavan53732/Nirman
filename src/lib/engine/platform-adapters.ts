// Registry alias — re-exports the Platform Adapter Registry from the
// consolidated registries module so consumers can import from a spec-named file.
export { platformAdapterRegistry, registries } from "./registries";
export type { PlatformAdapter, PlatformKind } from "./types";
