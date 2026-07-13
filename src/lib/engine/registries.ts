// Generic, plugin-ready registry. All registries support runtime registration
// so plugins (skills, tools, agents, adapters, preview providers, providers,
// workflows) can be added without recompiling the core.

import type {
  Skill,
  Tool,
  Agent,
  PlatformAdapter,
  PreviewProvider,
  Provider,
} from "./types";

class Registry<T extends { id: string }> {
  private items = new Map<string, T>();
  private listeners = new Set<(items: T[]) => void>();

  register(item: T): void {
    this.items.set(item.id, item);
    this.emit();
  }

  registerAll(items: T[]): void {
    for (const i of items) this.items.set(i.id, i);
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

export const skillRegistry = new Registry<Skill>();
export const toolRegistry = new Registry<Tool>();
export const agentRegistry = new Registry<Agent>();
export const platformAdapterRegistry = new Registry<PlatformAdapter>();
export const previewProviderRegistry = new Registry<PreviewProvider>();
export const providerRegistry = new Registry<Provider>();

// Re-export registries as a single namespace for the orchestrator.
export const registries = {
  skills: skillRegistry,
  tools: toolRegistry,
  agents: agentRegistry,
  platformAdapters: platformAdapterRegistry,
  previewProviders: previewProviderRegistry,
  providers: providerRegistry,
};
