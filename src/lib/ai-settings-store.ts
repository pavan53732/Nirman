"use client";

import { create } from "zustand";

// ---- Types ----

export type ApiFormat = "openai-compatible" | "anthropic-compatible";
export type ConnectionStatus = "idle" | "testing" | "connected" | "failed";

export interface ProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  apiFormat: ApiFormat;
  baseUrl: string;
  modelName: string;
  apiKey: string; // stored base64 in localStorage, plaintext in memory
  costPer1kInput: number;
  costPer1kOutput: number;
  // Runtime state (not persisted)
  status?: ConnectionStatus;
  latencyMs?: number;
  lastError?: string;
  models?: string[]; // available models for dropdown
}

export interface ModelRouterEntry {
  layer: string;
  providerId: string;
  modelName: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  fallbackModel?: string;
}

export interface AutonomyConfig {
  ambiguityThreshold: number;
  allowQuestions: boolean;
  autoProceed: boolean;
  confidenceLevel: "low" | "medium" | "high";
  maxRetries: number;
}

export interface SelfHealingConfig {
  retryLimits: Record<string, number>;
  escalationThreshold: number;
  patchStrategy: "minimal-diff" | "module-rewrite";
  rollbackBehavior: "auto" | "manual";
}

export interface CostConfig {
  monthlyBudget: number;
  dailyLimit: number;
  perTaskLimit: number;
  pauseWhenExceeded: boolean;
  useCheaperFallback: boolean;
}

export interface ExecutionConfig {
  toolMode: "local-node" | "tauri-shell" | "docker";
  offlineMode: boolean;
  allowFsWritesOutside: boolean;
  workspaceRoot: string;
  autoCheckpoints: boolean;
}

export interface AISettingsState {
  providers: ProviderConfig[];
  modelRouter: ModelRouterEntry[];
  autonomy: AutonomyConfig;
  selfHealing: SelfHealingConfig;
  cost: CostConfig;
  execution: ExecutionConfig;
  activeTab: string;
  dirty: boolean;
  // actions
  setProvider: (id: string, patch: Partial<ProviderConfig>) => void;
  setModelRouter: (layer: string, patch: Partial<ModelRouterEntry>) => void;
  setAutonomy: (patch: Partial<AutonomyConfig>) => void;
  setSelfHealing: (patch: Partial<SelfHealingConfig>) => void;
  setCost: (patch: Partial<CostConfig>) => void;
  setExecution: (patch: Partial<ExecutionConfig>) => void;
  setActiveTab: (t: string) => void;
  load: () => void;
  saveAll: () => Promise<{ connected: number; total: number; avgMs: number }>;
  setProviderStatus: (id: string, status: ConnectionStatus, latencyMs?: number, error?: string) => void;
}

// ---- Defaults ----

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "z-ai",
    name: "Z.AI",
    enabled: true,
    apiFormat: "openai-compatible",
    baseUrl: "https://api.z.ai/api/paas/v4/",
    modelName: "glm-4.5",
    apiKey: "",
    costPer1kInput: 0.002,
    costPer1kOutput: 0.008,
    models: ["glm-4.5", "glm-4.5-air", "glm-4", "glm-4-flash"],
  },
  {
    id: "openai",
    name: "OpenAI",
    enabled: false,
    apiFormat: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    modelName: "gpt-4o-mini",
    apiKey: "",
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-mini"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    enabled: false,
    apiFormat: "anthropic-compatible",
    baseUrl: "https://api.anthropic.com",
    modelName: "claude-3-5-sonnet-20241022",
    apiKey: "",
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    enabled: false,
    apiFormat: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    modelName: "llama3.1:8b",
    apiKey: "",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    models: ["llama3.1:8b", "mistral:7b", "qwen2.5-coder:7b", "codellama:13b"],
  },
  {
    id: "groq",
    name: "Groq",
    enabled: false,
    apiFormat: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    modelName: "llama-3.3-70b-versatile",
    apiKey: "",
    costPer1kInput: 0.00059,
    costPer1kOutput: 0.00079,
    models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"],
  },
  {
    id: "openrouter",
    name: "OpenRouter / Custom",
    enabled: false,
    apiFormat: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    modelName: "anthropic/claude-3.5-sonnet",
    apiKey: "",
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    models: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "meta-llama/llama-3.1-70b"],
  },
];

const DEFAULT_MODEL_ROUTER: ModelRouterEntry[] = [
  { layer: "Executive L1", providerId: "z-ai", modelName: "glm-4.5", costPer1kInput: 0.002, costPer1kOutput: 0.008, fallbackModel: "glm-4-flash" },
  { layer: "Architecture L2", providerId: "z-ai", modelName: "glm-4.5", costPer1kInput: 0.002, costPer1kOutput: 0.008, fallbackModel: "glm-4" },
  { layer: "Engineering L3", providerId: "openai", modelName: "gpt-4o-mini", costPer1kInput: 0.00015, costPer1kOutput: 0.0006, fallbackModel: "glm-4-flash" },
  { layer: "Quality L4", providerId: "groq", modelName: "llama-3.3-70b-versatile", costPer1kInput: 0.00059, costPer1kOutput: 0.00079 },
  { layer: "Cross-cutting L5", providerId: "z-ai", modelName: "glm-4-flash", costPer1kInput: 0.002, costPer1kOutput: 0.008 },
  { layer: "Dynamic L6", providerId: "z-ai", modelName: "glm-4-flash", costPer1kInput: 0.002, costPer1kOutput: 0.008 },
];

const DEFAULT_AUTONOMY: AutonomyConfig = {
  ambiguityThreshold: 0.75,
  allowQuestions: true,
  autoProceed: true,
  confidenceLevel: "high",
  maxRetries: 3,
};

const DEFAULT_SELF_HEALING: SelfHealingConfig = {
  retryLimits: { fastfix: 3, "incremental-patch": 2, "module-rewrite": 1, "architecture-reevaluation": 1, "human-question": 0 },
  escalationThreshold: 3,
  patchStrategy: "minimal-diff",
  rollbackBehavior: "auto",
};

const DEFAULT_COST: CostConfig = {
  monthlyBudget: 50,
  dailyLimit: 5,
  perTaskLimit: 0.5,
  pauseWhenExceeded: true,
  useCheaperFallback: true,
};

const DEFAULT_EXECUTION: ExecutionConfig = {
  toolMode: "local-node",
  offlineMode: false,
  allowFsWritesOutside: false,
  workspaceRoot: "/tmp/pavan",
  autoCheckpoints: true,
};

const STORAGE_KEY = "pavan:ai-settings";
const SETTINGS_VERSION = 1;

// ---- Store ----

export const useAISettings = create<AISettingsState>((set, get) => ({
  providers: DEFAULT_PROVIDERS,
  modelRouter: DEFAULT_MODEL_ROUTER,
  autonomy: DEFAULT_AUTONOMY,
  selfHealing: DEFAULT_SELF_HEALING,
  cost: DEFAULT_COST,
  execution: DEFAULT_EXECUTION,
  activeTab: "providers",
  dirty: false,

  setProvider: (id, patch) =>
    set((s) => ({
      providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      dirty: true,
    })),

  setModelRouter: (layer, patch) =>
    set((s) => ({
      modelRouter: s.modelRouter.map((m) => (m.layer === layer ? { ...m, ...patch } : m)),
      dirty: true,
    })),

  setAutonomy: (patch) => set((s) => ({ autonomy: { ...s.autonomy, ...patch }, dirty: true })),
  setSelfHealing: (patch) => set((s) => ({ selfHealing: { ...s.selfHealing, ...patch }, dirty: true })),
  setCost: (patch) => set((s) => ({ cost: { ...s.cost, ...patch }, dirty: true })),
  setExecution: (patch) => set((s) => ({ execution: { ...s.execution, ...patch }, dirty: true })),
  setActiveTab: (t) => set({ activeTab: t }),

  load: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.version !== SETTINGS_VERSION) return;
      set({
        providers: saved.providers?.map((p: ProviderConfig) => ({ ...p, status: "idle" as ConnectionStatus })) ?? DEFAULT_PROVIDERS,
        modelRouter: saved.modelRouter ?? DEFAULT_MODEL_ROUTER,
        autonomy: saved.autonomy ?? DEFAULT_AUTONOMY,
        selfHealing: saved.selfHealing ?? DEFAULT_SELF_HEALING,
        cost: saved.cost ?? DEFAULT_COST,
        execution: saved.execution ?? DEFAULT_EXECUTION,
        dirty: false,
      });
    } catch {
      /* corrupt storage — use defaults */
    }
  },

  saveAll: async () => {
    const state = get();
    // Validate enabled providers
    const enabled = state.providers.filter((p) => p.enabled);
    for (const p of enabled) {
      if (!p.baseUrl || !/^https?:\/\/.+/.test(p.baseUrl)) {
        throw new Error(`${p.name}: Base URL must start with http:// or https://`);
      }
      if (!p.modelName) {
        throw new Error(`${p.name}: Model name is required`);
      }
      if (p.id !== "ollama" && !p.apiKey) {
        throw new Error(`${p.name}: API key is required (except for Ollama)`);
      }
    }

    // Test all enabled providers
    const results = await Promise.all(
      enabled.map(async (p) => {
        try {
          const res = await fetch("/api/ai/test-connection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              providerId: p.id,
              apiFormat: p.apiFormat,
              baseUrl: p.baseUrl,
              apiKey: p.apiKey,
              modelName: p.modelName,
            }),
          });
          const data = await res.json();
          get().setProviderStatus(p.id, data.success ? "connected" : "failed", data.latencyMs, data.error);
          return data;
        } catch {
          get().setProviderStatus(p.id, "failed", 0, "Network error");
          return { success: false, latencyMs: 0 };
        }
      })
    );

    const connected = results.filter((r: { success: boolean }) => r.success).length;
    const latencies = results.filter((r: { success: boolean; latencyMs: number }) => r.success).map((r: { latencyMs: number }) => r.latencyMs);
    const avgMs = latencies.length > 0 ? Math.round(latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length) : 0;

    // Persist to localStorage (encode API keys as base64)
    if (typeof window !== "undefined") {
      const toSave = {
        version: SETTINGS_VERSION,
        providers: state.providers.map((p) => ({
          ...p,
          apiKey: p.apiKey ? btoa(p.apiKey) : "",
          status: undefined,
          latencyMs: undefined,
          lastError: undefined,
        })),
        modelRouter: state.modelRouter,
        autonomy: state.autonomy,
        selfHealing: state.selfHealing,
        cost: state.cost,
        execution: state.execution,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    }

    set({ dirty: false });
    return { connected, total: enabled.length, avgMs };
  },

  setProviderStatus: (id, status, latencyMs, error) =>
    set((s) => ({
      providers: s.providers.map((p) =>
        p.id === id ? { ...p, status, latencyMs, lastError: error } : p
      ),
    })),
}));

// ---- Client-side connection test helper ----

export async function testProviderConnection(
  provider: ProviderConfig,
  onResult: (success: boolean, latencyMs: number, error?: string) => void
): Promise<void> {
  useAISettings.getState().setProviderStatus(provider.id, "testing");

  try {
    const res = await fetch("/api/ai/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: provider.id,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        modelName: provider.modelName,
      }),
    });
    const data = await res.json();
    useAISettings.getState().setProviderStatus(
      provider.id,
      data.success ? "connected" : "failed",
      data.latencyMs,
      data.error
    );
    onResult(data.success, data.latencyMs ?? 0, data.error);
  } catch (err) {
    useAISettings.getState().setProviderStatus(provider.id, "failed", 0, String(err));
    onResult(false, 0, String(err));
  }
}
