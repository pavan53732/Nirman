// Generic, plugin-ready registry. All registries support runtime registration
// so plugins (skills, tools, agents, adapters, preview providers, providers,
// workflows) can be added without recompiling the core.
//
// The registry is keyed by a string extracted from each item via the `keyOf`
// callback passed at construction. Most entries use `id`, but `PlatformAdapter`
// uses `kind` as its unique key — supporting both without forcing adapters to
// add a redundant `id` field.

import type {
  Skill,
  Tool,
  Agent,
  PlatformAdapter,
  PreviewProvider,
  Provider,
} from "./types";

class Registry<T> {
  private items = new Map<string, T>();
  private listeners = new Set<(items: T[]) => void>();

  constructor(private readonly keyOf: (item: T) => string) {}

  register(item: T): void {
    this.items.set(this.keyOf(item), item);
    this.emit();
  }

  registerAll(items: T[]): void {
    for (const i of items) this.items.set(this.keyOf(i), i);
    this.emit();
  }

  unregister(id: string): void {
    this.items.delete(id);
    this.emit();
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  all(): T[] {
    return [...this.items.values()];
  }

  count(): number {
    return this.items.size;
  }

  filter(pred: (item: T) => boolean): T[] {
    return this.all().filter(pred);
  }

  subscribe(fn: (items: T[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snapshot = this.all();
    this.listeners.forEach((fn) => fn(snapshot));
  }
}

export const skillRegistry = new Registry<Skill>((s) => s.id);
export const toolRegistry = new Registry<Tool>((t) => t.id);
export const agentRegistry = new Registry<Agent>((a) => a.id);
export const platformAdapterRegistry = new Registry<PlatformAdapter>((a) => a.kind);
export const previewProviderRegistry = new Registry<PreviewProvider>((p) => p.id);
export const providerRegistry = new Registry<Provider>((p) => p.id);

// Re-export registries as a single namespace for the orchestrator.
export const registries = {
  skills: skillRegistry,
  tools: toolRegistry,
  agents: agentRegistry,
  platformAdapters: platformAdapterRegistry,
  previewProviders: previewProviderRegistry,
  providers: providerRegistry,
};
