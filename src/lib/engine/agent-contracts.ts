// Agent Runtime Contracts — the integration layer that wires Nirman's
// subsystems into a cohesive autonomous runtime.
//
// DESIGN (per architectural review):
//   Skills drive decisions → Decisions activate agents → Agents spawn
//   sub-agents → Sub-agents use tools → Tools feed memory → Memory
//   influences planning.
//
// This file defines the INTERFACES only. Implementations live in:
//   - shared-context.ts     (SharedContext blackboard)
//   - agent-runtime.ts      (AgentRuntime executor — refactored from tracer)
//   - dynamic-agents.ts     (DynamicAgentRegistry — spawn/destroy lifecycle)
//   - skill-injector.ts     (injectSkills — SKILL.md → agent context)
//
// The orchestrator no longer calls generators directly. Instead it submits
// tasks to the ExecutionEngine; the AgentRuntime executes each task by:
//   1. Building an AgentExecutionContext (memory + skills + shared context)
//   2. Looking up the agent's handler
//   3. Executing the handler
//   4. Writing the result to memory + shared context
//   5. Emitting completion events

import type { Task, AgentRole, MemoryKind, MemoryRecord, PlatformKind, Capability } from "./types";

// ---------------------------------------------------------------------------
// SharedContext — the blackboard agents use to communicate.
// ---------------------------------------------------------------------------

/**
 * SharedContext is the inter-agent communication channel. Instead of agents
 * calling each other directly, they write their outputs to the shared context
 * and downstream agents read from it.
 *
 * Example flow:
 *   Planner writes "plan" → Architect reads "plan", writes "architecture"
 *   → Generator reads "architecture", writes "code:<target>"
 *   → Reviewer reads "code:<target>", writes "review:<target>"
 *
 * This decouples agents: the Planner doesn't know about the Generator; it
 * just writes its plan and the orchestrator schedules the Generator to read it.
 */
export interface SharedContext {
  /** Read a value by key. Returns undefined if not present. */
  read<T = unknown>(key: string): T | undefined;
  /** Write a value. Overwrites if key exists. */
  write<T = unknown>(key: string, value: T): void;
  /** Check if a key exists. */
  has(key: string): boolean;
  /** Read all key-value pairs (for debugging / serialization). */
  readAll(): Record<string, unknown>;
  /** Clear all entries (called at the start of a new build). */
  clear(): void;
}

// ---------------------------------------------------------------------------
// SkillContent — a loaded SKILL.md file relevant to an agent.
// ---------------------------------------------------------------------------

/**
 * A SKILL.md file loaded and made available to an agent. The skill content
 * is the raw markdown; agents read it to learn endorsed patterns, quality
 * criteria, and tool usage.
 */
export interface SkillContent {
  id: string;
  title: string;
  category: string;
  content: string; // raw SKILL.md markdown
  /** Which agent role this skill is most relevant to. */
  relevantTo: AgentRole;
}

// ---------------------------------------------------------------------------
// AgentExecutionContext — everything an agent needs to do its job.
// ---------------------------------------------------------------------------

/**
 * The context bundle passed to every agent handler. This is how agents
 * receive memory, skills, shared context, and the ability to spawn
 * sub-agents.
 */
export interface AgentExecutionContext {
  /** The task being executed (id, stageId, agent, title, etc.). */
  task: Task;
  /** The original user prompt. */
  prompt: string;
  /** Memory slice relevant to this agent (from ContextBuilder). */
  memory: MemoryRecord[];
  /** SKILL.md files relevant to this agent (from SkillInjector). */
  skills: SkillContent[];
  /** Detected capabilities (auth, payments, offline-sync, etc.). */
  capabilities: Capability[];
  /** The platform target (web/windows/android) if applicable. */
  platform?: PlatformKind;
  /** The shared context blackboard for inter-agent communication. */
  shared: SharedContext;
  /**
   * Spawn a dynamic sub-agent. Used when a specialist is needed (e.g.,
   * "Authentication Specialist" when capability "auth" is detected).
   * The sub-agent runs to completion and returns its result.
   */
  spawnSubAgent: (
    role: string,
    spec: SubAgentSpec
  ) => Promise<AgentExecutionResult>;
  /** Emit an event to the execution engine event bus. */
  emit: (event: { type: string; message: string; level?: string }) => void;
}

/**
 * Spec for spawning a dynamic sub-agent.
 */
export interface SubAgentSpec {
  /** What the sub-agent should do (natural language). */
  objective: string;
  /** The parent agent's ID (for lineage tracking). */
  parentAgentId: string;
  /** Additional context to pass to the sub-agent. */
  context?: Record<string, unknown>;
  /** Skills to inject (optional — usually auto-selected). */
  skillIds?: string[];
}

// ---------------------------------------------------------------------------
// AgentExecutionResult — what an agent produces.
// ---------------------------------------------------------------------------

/**
 * The result of executing an agent handler. Agents produce output (text),
 * artifacts (generated files), and memory writes. The runtime handles
 * persisting these to the appropriate stores.
 */
export interface AgentExecutionResult {
  status: "success" | "failure";
  /** Human-readable output / summary. */
  output?: string;
  /** Generated files (for generator agents). */
  artifacts?: { path: string; content: string }[];
  /** Memory records to write (kind, title, content). */
  memoryWrites?: { kind: MemoryKind; title: string; content: string }[];
  /** Keys to write to the shared context (for downstream agents). */
  sharedWrites?: { key: string; value: unknown }[];
  /** Error message if status is "failure". */
  error?: string;
  /** Duration in ms (set by the runtime, not the handler). */
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// AgentHandler — the function signature every agent implements.
// ---------------------------------------------------------------------------

/**
 * Every agent (whether static from data/agents.ts or dynamically spawned)
 * implements this handler. The AgentRuntime looks up the handler by agent
 * role and invokes it with the execution context.
 *
 * Handlers should be PURE: they receive all inputs via the context and
 * return all outputs via the result. They should NOT call generators
 * directly or write to memory directly — the runtime handles persistence.
 */
export type AgentHandler = (ctx: AgentExecutionContext) => Promise<AgentExecutionResult> | AgentExecutionResult;

// ---------------------------------------------------------------------------
// DynamicAgent — a runtime-spawned specialist agent.
// ---------------------------------------------------------------------------

/**
 * A dynamically spawned sub-agent. Unlike the static agents in data/agents.ts
 * (which are always registered), dynamic agents are created on demand when a
 * capability requires a specialist, and destroyed when their work is done.
 */
export interface DynamicAgent {
  id: string;
  role: string;
  label: string;
  /** The parent agent that spawned this one. */
  parentAgentId: string;
  /** When the agent was spawned (ms timestamp). */
  spawnedAt: number;
  /** When the agent was destroyed (ms timestamp, null if still active). */
  destroyedAt: number | null;
  /** The handler this agent will execute. */
  handler: AgentHandler;
  /** The objective this agent was spawned to achieve. */
  objective: string;
  status: "active" | "completed" | "failed";
}
