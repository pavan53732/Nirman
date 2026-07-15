// Nirman Plugin System — allows adding agents, skills, tools, and platform
// adapters WITHOUT modifying the core engine.
//
// A plugin is a module that exports a PluginManifest and a register() function.
// The core engine calls register() at startup, passing the PluginRegistry.
// The plugin then calls registry.registerAgent(), registerSkill(), etc.
//
// Plugin discovery: plugins live in src/lib/engine/plugins/*/index.ts. Each
// plugin module calls `loadPlugin(manifest, register)` at import time, which
// pushes the manifest + contributions into the shared `pluginRegistry`. The
// loader (`loadAllPlugins`) simply imports each plugin module to trigger its
// side-effect registration.
//
// OWNERSHIP: this file owns the plugin subsystem. It does NOT modify the core
// registries in registries.ts — plugin contributions live in a parallel
// registry here. Future integrations (e.g., the AgentRuntime dispatching to
// plugin-registered handlers) can read from `pluginRegistry.getAgentHandler()`
// without modifying the core engine files.

import type { AgentHandler, SkillContent } from "./agent-contracts";
import type { AgentRole } from "./types";

/**
 * Manifest declared by every plugin. The `apiVersion` field lets the loader
 * reject plugins that target an incompatible plugin API.
 */
export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  /** Which plugin API version this targets. Currently always 1. */
  apiVersion: 1;
}

/**
 * The kinds of contributions a plugin can make. Each contribution is tracked
 * so the debug endpoint can report "which plugin provided what".
 */
export type PluginContributionType = "agent" | "skill" | "tool" | "platform-adapter";

/**
 * A single contribution record — what was registered, by which plugin.
 */
export interface PluginContribution {
  type: PluginContributionType;
  id: string;
  plugin: string;
}

/**
 * Metadata optionally attached when registering an agent (mirror of the Agent
 * record's label/layer fields — purely informational for plugin-contributed
 * agents, since the plugin system does not modify the core Agent registry).
 */
export interface PluginAgentMetadata {
  label?: string;
  layer?: string;
}

/**
 * Shape accepted when registering a skill via the plugin API. Mirrors
 * SkillContent but uses a loose `relevantTo: string` so plugins can target
 * roles that are not yet in the strict AgentRole union.
 */
export interface PluginSkillInput {
  id: string;
  title: string;
  category: string;
  content: string;
  relevantTo: string;
}

/**
 * Shape accepted when registering a tool via the plugin API. Tools are stored
 * separately from the core toolRegistry so the plugin system is self-contained.
 */
export interface PluginToolInput {
  id: string;
  name: string;
  description: string;
  command: string;
}

/**
 * Shape accepted when registering a platform adapter via the plugin API.
 */
export interface PluginPlatformAdapterInput {
  kind: string;
  label: string;
  generators: string[];
  packagingTools: string[];
}

/**
 * The registry surface handed to a plugin's `register()` function. Plugins
 * call these methods to declare their contributions.
 */
export interface PluginRegistry {
  /** Register a new agent handler. */
  registerAgent(role: string, handler: AgentHandler, metadata?: PluginAgentMetadata): void;
  /** Register a new skill. */
  registerSkill(skill: PluginSkillInput): void;
  /** Register a new tool. */
  registerTool(tool: PluginToolInput): void;
  /** Register a new platform adapter. */
  registerPlatformAdapter(adapter: PluginPlatformAdapterInput): void;
  /** List all contributions from all plugins. */
  getContributions(): PluginContribution[];
}

/**
 * A plugin that has been loaded — its manifest plus its contribution list.
 */
export interface LoadedPlugin {
  manifest: PluginManifest;
  contributions: PluginContribution[];
  loadedAt: number;
}

/**
 * Internal registry state. Stores all plugin-contributed items in parallel
 * Maps so lookups (by role / id / kind) are O(1) and the debug endpoint can
 * enumerate them without scanning.
 */
class PluginRegistryImpl implements PluginRegistry {
  private contributions: PluginContribution[] = [];
  private agents = new Map<string, { handler: AgentHandler; metadata?: PluginAgentMetadata }>();
  private skills = new Map<string, SkillContent>();
  private tools = new Map<string, PluginToolInput>();
  private adapters = new Map<string, PluginPlatformAdapterInput>();
  private loadedPlugins: LoadedPlugin[] = [];
  private currentPlugin: string | null = null;

  registerAgent(role: string, handler: AgentHandler, metadata?: PluginAgentMetadata): void {
    this.agents.set(role, { handler, metadata });
    if (this.currentPlugin) {
      this.contributions.push({ type: "agent", id: role, plugin: this.currentPlugin });
    }
  }

  registerSkill(skill: PluginSkillInput): void {
    this.skills.set(skill.id, {
      id: skill.id,
      title: skill.title,
      category: skill.category,
      content: skill.content,
      // Loose cast: plugins may target roles not yet in the strict union.
      relevantTo: skill.relevantTo as unknown as AgentRole,
    });
    if (this.currentPlugin) {
      this.contributions.push({ type: "skill", id: skill.id, plugin: this.currentPlugin });
    }
  }

  registerTool(tool: PluginToolInput): void {
    this.tools.set(tool.id, tool);
    if (this.currentPlugin) {
      this.contributions.push({ type: "tool", id: tool.id, plugin: this.currentPlugin });
    }
  }

  registerPlatformAdapter(adapter: PluginPlatformAdapterInput): void {
    this.adapters.set(adapter.kind, adapter);
    if (this.currentPlugin) {
      this.contributions.push({ type: "platform-adapter", id: adapter.kind, plugin: this.currentPlugin });
    }
  }

  getContributions(): PluginContribution[] {
    return [...this.contributions];
  }

  // ---- Read accessors (used by the debug endpoint + future integrations) ----

  getAgentHandler(role: string): AgentHandler | undefined {
    return this.agents.get(role)?.handler;
  }

  getAgentMetadata(role: string): PluginAgentMetadata | undefined {
    return this.agents.get(role)?.metadata;
  }

  getSkills(): SkillContent[] {
    return [...this.skills.values()];
  }

  getTools(): PluginToolInput[] {
    return [...this.tools.values()];
  }

  getAdapters(): PluginPlatformAdapterInput[] {
    return [...this.adapters.values()];
  }

  getLoadedPlugins(): LoadedPlugin[] {
    return [...this.loadedPlugins];
  }

  // ---- Loader hooks (called by loadPlugin / loadAllPlugins) ----

  /**
   * Mark the start of a plugin load. Subsequent register* calls attribute
   * their contributions to this plugin until `_endPlugin()` is called.
   */
  _beginPlugin(manifest: PluginManifest): void {
    this.currentPlugin = manifest.name;
    this.loadedPlugins.push({
      manifest,
      contributions: [],
      loadedAt: Date.now(),
    });
  }

  /**
   * Mark the end of a plugin load. Snapshot the contributions made during
   * this plugin's register() call onto its LoadedPlugin record.
   */
  _endPlugin(): void {
    const plugin = this.loadedPlugins[this.loadedPlugins.length - 1];
    if (plugin) {
      plugin.contributions = this.contributions.filter((c) => c.plugin === plugin.manifest.name);
    }
    this.currentPlugin = null;
  }

  /** Test hook: reset all state (used by future unit tests). */
  _reset(): void {
    this.contributions = [];
    this.agents.clear();
    this.skills.clear();
    this.tools.clear();
    this.adapters.clear();
    this.loadedPlugins = [];
    this.currentPlugin = null;
  }
}

/**
 * The singleton plugin registry. Plugins write to it via `loadPlugin()`;
 * consumers (debug endpoint, future AgentRuntime integration) read from it
 * via the accessor methods.
 */
export const pluginRegistry = new PluginRegistryImpl();

/**
 * Load a single plugin by invoking its register() function. Errors inside
 * register() are caught and logged — one bad plugin cannot take down the
 * engine.
 */
export function loadPlugin(manifest: PluginManifest, register: (registry: PluginRegistry) => void): void {
  if (manifest.apiVersion !== 1) {
    console.error(`[PluginSystem] Plugin ${manifest.name} targets apiVersion ${manifest.apiVersion}, expected 1 — skipped.`);
    return;
  }
  pluginRegistry._beginPlugin(manifest);
  try {
    register(pluginRegistry);
  } catch (err) {
    console.error(`[PluginSystem] Failed to load plugin ${manifest.name}:`, err);
  }
  pluginRegistry._endPlugin();
}

/**
 * Track loadAllPlugins invocations so we don't re-run discovery on every
 * debug-endpoint hit. The debug endpoint checks `getLoadedPlugins().length`
 * first as an additional guard, but this flag prevents overlapping
 * in-flight loads.
 */
let loadAllPromise: Promise<void> | null = null;

/**
 * Discover and load all built-in plugins. Each plugin module's top-level
 * code calls `loadPlugin(manifest, register)`, so importing the module is
 * sufficient to register its contributions.
 *
 * Safe to call multiple times — subsequent calls return the same in-flight
 * promise (or a resolved one if loading has already completed).
 */
export async function loadAllPlugins(): Promise<void> {
  if (loadAllPromise) return loadAllPromise;
  loadAllPromise = (async () => {
    // Built-in plugins. Each is a self-contained module; importing it runs
    // its `loadPlugin(manifest, register)` side effect.
    const imports: Array<Promise<unknown>> = [];
    try {
      imports.push(import("./plugins/auth-specialist"));
    } catch (e) {
      console.warn("[PluginSystem] Could not import auth-specialist:", e);
    }
    try {
      imports.push(import("./plugins/api-docs-generator"));
    } catch (e) {
      console.warn("[PluginSystem] Could not import api-docs-generator:", e);
    }
    await Promise.all(imports);
  })();
  return loadAllPromise;
}

/**
 * Build the JSON-friendly summary returned by the /api/debug/plugins
 * endpoint. Includes per-plugin metadata, contribution lists, and aggregate
 * counts by contribution type.
 */
export function getPluginSummary() {
  const contributions = pluginRegistry.getContributions();
  return {
    loadedPlugins: pluginRegistry.getLoadedPlugins().map((p) => ({
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      author: p.manifest.author ?? null,
      apiVersion: p.manifest.apiVersion,
      contributionCount: p.contributions.length,
      contributions: p.contributions,
      loadedAt: p.loadedAt,
    })),
    totalContributions: contributions.length,
    contributionsByType: {
      agent: contributions.filter((c) => c.type === "agent").length,
      skill: contributions.filter((c) => c.type === "skill").length,
      tool: contributions.filter((c) => c.type === "tool").length,
      "platform-adapter": contributions.filter((c) => c.type === "platform-adapter").length,
    },
    registeredAgents: [...new Set(contributions.filter((c) => c.type === "agent").map((c) => c.id))],
    registeredSkills: [...new Set(contributions.filter((c) => c.type === "skill").map((c) => c.id))],
    registeredTools: [...new Set(contributions.filter((c) => c.type === "tool").map((c) => c.id))],
    registeredAdapters: [...new Set(contributions.filter((c) => c.type === "platform-adapter").map((c) => c.id))],
  };
}
