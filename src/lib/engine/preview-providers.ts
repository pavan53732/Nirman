// Registry alias — re-exports the Preview Provider Registry from the
// consolidated registries module so consumers can import from a spec-named file.
export { previewProviderRegistry, registries } from "./registries";
export type { PreviewProvider, PreviewProviderId } from "./types";
