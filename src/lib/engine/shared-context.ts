// SharedContext — the inter-agent blackboard.
//
// This is the single in-memory communication channel that Nirman's agents use
// to pass work products to each other. Instead of agents calling each other
// directly (tight coupling), each agent:
//   1. Reads its inputs from the SharedContext by well-known key
//   2. Does its work
//   3. Writes its outputs back to the SharedContext under a well-known key
//
// The AgentRuntime owns the SharedContext instance and passes it to every
// agent handler via AgentExecutionContext.shared. The runtime also persists
// the agent's declared `sharedWrites` after the handler returns — so handlers
// stay pure (they declare what they wrote; the runtime commits it).
//
// KEY NAMING CONVENTION (the contract every agent must follow):
//   "plan"                  → Planner's output (executive layer)
//   "requirements"          → Requirements Analyst's output
//   "architecture"          → Solution Architect's output (architecture layer)
//   "code:<target>"         → Generator's output for a platform target.
//                             <target> ∈ {"web", "windows", "android", "cli", ...}.
//                             Value shape: { path, content, language? }[]
//   "review:<target>"       → Code Reviewer's output for a target.
//                             Value shape: { findings: string[]; approved: boolean }
//   "tests:<target>"        → Test Generator's output for a target.
//                             Value shape: { testCount: number; files?: VirtualFile[] }
//   "build:<target>"        → Build Engineer's output for a target.
//                             Value shape: { success: boolean; fileCount: number; logs?: string }
//   "package:<target>"      → Packaging Engineer's output for a target.
//                             Value shape: { ready: boolean; artifactPath?: string }
//
// This convention makes the data-flow auditable: a downstream agent that
// expects `code:web` can simply `ctx.shared.read("code:web")` and the
// orchestrator can statically verify (by walking the DAG) that some upstream
// agent wrote it.
//
// BLACKBOARD PATTERN NOTE:
//   This implements the classic Blackboard architectural pattern. The
//   SharedContext is the blackboard; agents are knowledge sources; the
//   orchestrator + execution engine are the control shell that decides which
//   agent runs next. No agent knows about any other agent — they only know
//   the keys they read and the keys they write. This is what allows the
//   orchestrator to add new agents (e.g. a "performance-auditor") without
//   modifying the existing agents.

import type { SharedContext } from "./agent-contracts";

/**
 * Concrete implementation of the {@link SharedContext} interface backed by a
 * `Map<string, unknown>`. The map is intentionally process-local — the
 * SharedContext is a build-scoped scratchpad, not a persistence layer. It is
 * cleared at the start of every new build by the orchestrator (or by tests
 * via `sharedContext.clear()`).
 *
 * Why a Map (not a plain object)?
 *   - Map preserves insertion order (readAll returns a stable ordering),
 *     which is useful for debug snapshots and trace UIs.
 *   - Map keys can be any string (including "__proto__") without risk of
 *     prototype pollution.
 *   - Map.has/get/set are O(1) with no inherited property lookups to dodge.
 */
export class SharedContextImpl implements SharedContext {
  private store = new Map<string, unknown>();

  /** @inheritdoc */
  read<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  /** @inheritdoc */
  write<T = unknown>(key: string, value: T): void {
    this.store.set(key, value);
  }

  /** @inheritdoc */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /** @inheritdoc */
  readAll(): Record<string, unknown> {
    return Object.fromEntries(this.store.entries());
  }

  /** @inheritdoc */
  clear(): void {
    this.store.clear();
  }

  /** Number of keys currently in the blackboard (useful for tests/debug). */
  get size(): number {
    return this.store.size;
  }
}

/**
 * Process-wide singleton SharedContext. Every agent handler in
 * `agent-handlers.ts` reads from / writes to this same instance, and the
 * AgentRuntime.executor injects it into every AgentExecutionContext.
 *
 * Callers that need a fresh blackboard (e.g. the orchestrator at the start
 * of a new build, or tests) call `sharedContext.clear()`.
 */
export const sharedContext = new SharedContextImpl();
