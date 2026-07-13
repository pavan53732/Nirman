// Provider Abstraction Layer.
// Abstract interfaces for LLM, Embedding, Speech, Image, OCR, Vector providers.
// Provider Manager + Model Router + Cost Optimizer + Token Budget Manager
// select the implementation per agent and task, keeping AI integrations modular.

import type { Provider, ProviderCapability, ProviderModel, AgentRole } from "./types";

export interface LLMRequest {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  stream?: boolean;
  maxTokens?: number;
}
export interface LLMResponse {
  content: string;
  tokensUsed: number;
  model: string;
}

export interface ProviderInterfaces {
  llm: {
    complete(req: LLMRequest): Promise<LLMResponse>;
    stream(req: LLMRequest): Promise<ReadableStream<Uint8Array>>;
  };
  embedding: { embed(texts: string[]): Promise<number[][]> };
  speech: { tts(text: string, voice?: string): Promise<Uint8Array>; asr(audio: Uint8Array): Promise<string> };
  image: { generate(prompt: string): Promise<string> };
  ocr: { recognize(image: Uint8Array): Promise<string> };
  vector: { upsert(id: string, vec: number[]): Promise<void>; query(vec: number[], k: number): Promise<string[]> };
}

/**
 * Provider Manager — tracks all providers and their connection status.
 */
export class ProviderManager {
  private providers = new Map<string, Provider>();

  register(p: Provider): void {
    this.providers.set(p.id, p);
  }
  registerAll(ps: Provider[]): void {
    for (const p of ps) this.providers.set(p.id, p);
  }
  all(): Provider[] {
    return [...this.providers.values()];
  }
  connected(): Provider[] {
    return this.all().filter((p) => p.status === "connected");
  }
  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }
}

/**
 * Model Router — selects the optimal model for a given capability and agent.
 * Strategy: prefer remote for high-stakes agents (architect/coder), local for
 * high-volume low-stakes (tester/docs). Falls back to any connected model.
 */
export class ModelRouter {
  constructor(private pm: ProviderManager) {}

  select(capability: ProviderCapability, agent: AgentRole): { provider: Provider; model: ProviderModel } | null {
    const connected = this.pm.connected();
    if (connected.length === 0) return null;

    const agentPrefersRemote = [
      "solution-architect",
      "frontend-generator",
      "backend-generator",
      "desktop-generator",
      "android-generator",
      "code-reviewer",
      "decision-engine",
    ].includes(agent);

    const ordered = agentPrefersRemote
      ? [...connected].sort((a, b) => (a.type === "remote" ? -1 : 1) - (b.type === "remote" ? -1 : 1))
      : [...connected].sort((a, b) => (a.type === "local" ? -1 : 1) - (b.type === "local" ? -1 : 1));

    for (const p of ordered) {
      const model = p.models.find((m) => m.capabilities.includes(capability));
      if (model) return { provider: p, model };
    }
    // fallback: any model with the capability across all providers
    for (const p of this.pm.all()) {
      const model = p.models.find((m) => m.capabilities.includes(capability));
      if (model) return { provider: p, model };
    }
    return null;
  }
}

/**
 * Cost Optimizer — prefers cheaper models for low-stakes tasks within budget.
 */
export class CostOptimizer {
  constructor(private pm: ProviderManager) {}
  cheapestFor(capability: ProviderCapability): { provider: Provider; model: ProviderModel } | null {
    let best: { provider: Provider; model: ProviderModel } | null = null;
    let bestCost = Infinity;
    for (const p of this.pm.connected()) {
      for (const m of p.models) {
        if (!m.capabilities.includes(capability)) continue;
        const cost = m.costPer1kTokens ?? 0;
        if (cost < bestCost) {
          bestCost = cost;
          best = { provider: p, model: m };
        }
      }
    }
    return best;
  }
}

/**
 * Token Budget Manager — enforces per-agent and per-workflow token budgets.
 */
export class TokenBudgetManager {
  private spent = new Map<string, number>(); // key: `${agent}|${workflowId}`
  constructor(
    private perAgentBudget = 200000,
    private perWorkflowBudget = 2000000
  ) {}

  charge(agent: AgentRole, workflowId: string, tokens: number): void {
    const aKey = `${agent}|*`;
    const wKey = `*|${workflowId}`;
    this.spent.set(aKey, (this.spent.get(aKey) ?? 0) + tokens);
    this.spent.set(wKey, (this.spent.get(wKey) ?? 0) + tokens);
  }

  remainingAgent(agent: AgentRole): number {
    return Math.max(0, this.perAgentBudget - (this.spent.get(`${agent}|*`) ?? 0));
  }
  remainingWorkflow(workflowId: string): number {
    return Math.max(0, this.perWorkflowBudget - (this.spent.get(`*|${workflowId}`) ?? 0));
  }
  withinBudget(agent: AgentRole, workflowId: string): boolean {
    return this.remainingAgent(agent) > 0 && this.remainingWorkflow(workflowId) > 0;
  }
  usage(): { agent: string; tokens: number }[] {
    return [...this.spent.entries()]
      .filter(([k]) => k.endsWith("|*"))
      .map(([k, v]) => ({ agent: k.split("|")[0], tokens: v }));
  }
}

// Singletons
import { providers as seedProviders } from "./data/adapters";
export const providerManager = new ProviderManager();
providerManager.registerAll(seedProviders);
export const modelRouter = new ModelRouter(providerManager);
export const costOptimizer = new CostOptimizer(providerManager);
export const tokenBudgetManager = new TokenBudgetManager();
