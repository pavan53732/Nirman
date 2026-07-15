// 7 layered Memories + Project Memory Manager (versioned, persisted).
// Memories: requirements, architecture, decision, code, build, artifact, conversation.
// The Project Memory Manager owns persistence with version history; the
// Context Builder pulls only the needed slices per agent.

import type { MemoryKind, MemoryRecord } from "./types";

const STORAGE_KEY = "pavan.memory.v1";

interface PersistedMemory {
  records: MemoryRecord[];
}

function load(): PersistedMemory {
  if (typeof window === "undefined") return { records: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { records: [] };
    return JSON.parse(raw) as PersistedMemory;
  } catch {
    return { records: [] };
  }
}

function save(state: PersistedMemory): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage may be full or disabled */
  }
}

export const MEMORY_KINDS: MemoryKind[] = [
  "requirements",
  "architecture",
  "decision",
  "code",
  "build",
  "artifact",
  "conversation",
];

export const memoryKindLabels: Record<MemoryKind, string> = {
  requirements: "Requirements",
  architecture: "Architecture",
  decision: "Decision",
  code: "Code",
  build: "Build",
  artifact: "Artifact",
  conversation: "Conversation",
};

/**
 * Project Memory Manager — owns the 7 layered memories with version history.
 */
export class ProjectMemoryManager {
  private records: MemoryRecord[] = [];

  constructor() {
    const persisted = load();
    this.records = persisted.records;
  }

  write(kind: MemoryKind, title: string, content: string, source: string): MemoryRecord {
    const existing = this.records.find((r) => r.kind === kind && r.title === title);
    if (existing) {
      existing.version += 1;
      existing.content = content;
      existing.createdAt = Date.now();
      existing.source = source;
      this.persist();
      return existing;
    }
    const rec: MemoryRecord = {
      id: `mem-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      title,
      content,
      version: 1,
      createdAt: Date.now(),
      source,
    };
    this.records.push(rec);
    this.persist();
    return rec;
  }

  read(kind: MemoryKind): MemoryRecord[] {
    return this.records.filter((r) => r.kind === kind);
  }

  get(id: string): MemoryRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  all(): MemoryRecord[] {
    return [...this.records];
  }

  pin(id: string, pinned: boolean): void {
    const r = this.get(id);
    if (r) {
      r.pinned = pinned;
      this.persist();
    }
  }

  /** Context Builder: pull only the needed memory slices for an agent. */
  sliceFor(agent: string, kinds: MemoryKind[]): MemoryRecord[] {
    void agent;
    const want = new Set(kinds);
    return this.records
      .filter((r) => want.has(r.kind))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt - a.createdAt)
      .slice(0, 12);
  }

  version(): number {
    return this.records.reduce((max, r) => Math.max(max, r.version), 0);
  }

  clear(): void {
    this.records = [];
    this.persist();
  }

  private persist(): void {
    save({ records: this.records });
  }
}

export const projectMemory = new ProjectMemoryManager();

/**
 * MemoryAccess — the official facade for reading/writing memory.
 *
 * All non-memory modules should use `memoryAccess` instead of `projectMemory`
 * directly. This centralizes memory access for:
 *   - Audit logging (who wrote what, when)
 *   - Future access control (which agents can write which memory kinds)
 *   - Future caching/memoization
 *
 * `projectMemory` is still exported for backward compatibility (external
 * consumers — debug endpoints, failure-tests harness, the orchestrator while
 * Wave 2A is in flight — still import it from the public API), but INTERNAL
 * engine modules should migrate to `memoryAccess`.
 *
 * Behavior is identical to `projectMemory` — every method delegates to the
 * underlying `ProjectMemoryManager`. The only addition is an in-memory
 * `accessLog` that records every read/write/all/clear operation for
 * debugging and the `/api/debug/memory-readback` audit trail.
 *
 * The V2 architecture contract (Runtime V2 Audit, Phase 2 Step 6):
 *   "Every agent receives context EXCLUSIVELY through Context Builder.
 *    Agents never query memory directly."
 *
 * This facade is the implementation of that contract for WRITES (reads are
 * already centralized through `ContextBuilder.buildRichContext()`). Until
 * Wave 2A migrates the orchestrator, `projectMemory` remains importable;
 * this facade is the target state for all internal modules.
 */
export class MemoryAccess {
  private mem: ProjectMemoryManager;
  private accessLog: {
    operation: "read" | "write" | "all" | "clear";
    kind?: MemoryKind;
    title?: string;
    source?: string;
    timestamp: number;
  }[] = [];

  constructor(mem: ProjectMemoryManager) {
    this.mem = mem;
  }

  /**
   * Write (or update) a memory record. Logs the operation with the source
   * (which agent / module wrote it) so the audit trail is self-explanatory.
   */
  write(kind: MemoryKind, title: string, content: string, source: string): MemoryRecord {
    this.accessLog.push({
      operation: "write",
      kind,
      title,
      source,
      timestamp: Date.now(),
    });
    return this.mem.write(kind, title, content, source);
  }

  /** Read all records of a given kind. Logs the operation (without source — reads are passive). */
  read(kind: MemoryKind): MemoryRecord[] {
    this.accessLog.push({ operation: "read", kind, timestamp: Date.now() });
    return this.mem.read(kind);
  }

  /** Read all records across every kind. Logged as an `all` operation. */
  all(): MemoryRecord[] {
    this.accessLog.push({ operation: "all", timestamp: Date.now() });
    return this.mem.all();
  }

  /** Look up a single record by id. Not logged (point lookups are cheap + frequent). */
  get(id: string): MemoryRecord | undefined {
    return this.mem.get(id);
  }

  /**
   * Clear all memory records. Used by `ProjectEvolution.restore()` to wipe
   * stale records before rehydrating from a snapshot. Logged because it is
   * destructive — the audit trail makes "who cleared memory and when?"
   * answerable.
   */
  clear(): void {
    this.accessLog.push({ operation: "clear", timestamp: Date.now() });
    this.mem.clear();
  }

  /** Pin/unpin a record. Delegates directly (no audit log — admin op). */
  pin(id: string, pinned: boolean): void {
    this.mem.pin(id, pinned);
  }

  /** Pull a role-filtered memory slice for an agent. Delegates directly. */
  sliceFor(agent: string, kinds: MemoryKind[]): MemoryRecord[] {
    return this.mem.sliceFor(agent, kinds);
  }

  /** Highest record version across all memories. Delegates directly. */
  version(): number {
    return this.mem.version();
  }

  /**
   * Get the access log for debugging/auditing. Returns the most recent
   * `limit` entries (default 50). Each entry records the operation, the
   * kind/title/source (for writes), and the timestamp.
   *
   * Used by the `/api/debug/memory-readback` endpoint and (in future) by
   * an observability dashboard to answer "which modules are writing
   * memory, and when?"
   */
  getAccessLog(limit = 50) {
    return this.accessLog.slice(-limit);
  }

  /** Clear the access log (for a fresh build / test run). Does NOT clear memory. */
  clearLog(): void {
    this.accessLog = [];
  }

  /**
   * Convenience for the audit endpoint: summarize the access log by
   * operation type. Returns counts of read/write/all/clear since the log
   * was last cleared.
   */
  summarizeAccessLog(): {
    total: number;
    reads: number;
    writes: number;
    alls: number;
    clears: number;
    bySource: Record<string, number>;
    byKind: Record<string, number>;
  } {
    const bySource: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    let reads = 0;
    let writes = 0;
    let alls = 0;
    let clears = 0;
    for (const e of this.accessLog) {
      if (e.operation === "read") reads++;
      else if (e.operation === "write") writes++;
      else if (e.operation === "all") alls++;
      else if (e.operation === "clear") clears++;
      if (e.source) bySource[e.source] = (bySource[e.source] ?? 0) + 1;
      if (e.kind) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    }
    return {
      total: this.accessLog.length,
      reads,
      writes,
      alls,
      clears,
      bySource,
      byKind,
    };
  }
}

/**
 * Process-wide singleton `MemoryAccess` wrapping the shared `projectMemory`.
 *
 * This is the OFFICIAL entry point for memory reads/writes from non-memory
 * engine modules. `projectMemory` remains exported for external consumers
 * (debug endpoints, the failure-test harness, the orchestrator during the
 * Wave 2A transition) — internal modules should migrate to `memoryAccess`.
 */
export const memoryAccess = new MemoryAccess(projectMemory);

/**
 * AgentContextBundle — the full context package an agent receives.
 *
 * The legacy `buildForAgent()` only returned the memory slice + a placeholder
 * token estimate. `buildRichContext()` returns this richer bundle so callers
 * (the agent runtime, debug endpoints, observability) can introspect WHICH
 * memory kinds were pulled, how many records were pinned, and a human-readable
 * summary for logs / trace UI.
 */
export interface AgentContextBundle {
  /** The agent role this context was built for. */
  agent: string;
  /** The memory slice (sorted: pinned first, then newest-first; capped at 12). */
  memorySlice: MemoryRecord[];
  /** Which memory kinds were pulled (either explicit opts.kinds or defaultKindsFor(agent)). */
  kinds: MemoryKind[];
  /** Human-readable multi-line summary (for debugging / log output). */
  summary: string;
  /** How many pinned records are in the slice. */
  pinCount: number;
  /** Total records in the slice. */
  recordCount: number;
  /** Echo of the optional prompt passed in (for traceability). */
  prompt?: string;
}

/**
 * Context Builder — builds a minimal prompt pack per agent from indexes & memory.
 * Pulls only relevant memory slices to keep token usage low.
 *
 * Two entry points:
 *   - buildForAgent()  : legacy, backward-compatible — returns just the slice.
 *   - buildRichContext(): new — returns the full AgentContextBundle (kinds,
 *                        summary, pinCount, recordCount) for debugging + the
 *                        agent runtime.
 */
export class ContextBuilder {
  constructor(private mem: ProjectMemoryManager) {}

  /**
   * Legacy entry point — kept for backward compatibility. Returns just the
   * memory slice + a zero token estimate (real tokens come from the z-ai SDK
   * usage response, not from context building). Delegates to buildRichContext()
   * so the slicing logic has ONE home.
   */
  buildForAgent(
    agent: string,
    opts: { kinds?: MemoryKind[]; prompt?: string } = {}
  ): { memorySlice: MemoryRecord[]; tokenEstimate: number } {
    const bundle = this.buildRichContext(agent, opts);
    // No token estimate — real tokens come from the z-ai SDK usage response.
    // For non-LLM tasks (context building), tokens = 0.
    return { memorySlice: bundle.memorySlice, tokenEstimate: 0 };
  }

  /**
   * Build a full AgentContextBundle for an agent. This is the entry point the
   * agent runtime SHOULD use: it returns the memory slice PLUS the kinds
   * pulled, a human-readable summary, and pin/record counts. The summary is
   * cheap to log and makes memory readback visible in the trace UI.
   */
  buildRichContext(
    agent: string,
    opts: { kinds?: MemoryKind[]; prompt?: string } = {}
  ): AgentContextBundle {
    const kinds = opts.kinds ?? this.defaultKindsFor(agent);
    const memorySlice = this.mem.sliceFor(agent, kinds);
    const pinCount = memorySlice.filter((r) => r.pinned).length;
    const summary = this.summarize(agent, kinds, memorySlice);
    return {
      agent,
      memorySlice,
      kinds,
      summary,
      pinCount,
      recordCount: memorySlice.length,
      prompt: opts.prompt,
    };
  }

  /**
   * Build a multi-line human-readable summary of the context bundle. Used by
   * the debug endpoint and (optionally) the agent runtime's logging. Shows the
   * agent role, the kinds pulled, total + pinned counts, and the first 5
   * record titles (kind + title + version + content length).
   */
  private summarize(agent: string, kinds: MemoryKind[], slice: MemoryRecord[]): string {
    const pinnedCount = slice.filter((r) => r.pinned).length;
    const parts: string[] = [
      `Agent: ${agent}`,
      `Memory kinds: ${kinds.join(", ")}`,
      `Records: ${slice.length}`,
      `Pinned: ${pinnedCount}`,
    ];
    if (slice.length > 0) {
      parts.push("Contents:");
      for (const r of slice.slice(0, 5)) {
        parts.push(`  [${r.kind}] ${r.title} (v${r.version}, ${r.content.length} chars)`);
      }
      if (slice.length > 5) parts.push(`  ... and ${slice.length - 5} more`);
    } else {
      parts.push("Contents: (empty — no memory records matched the requested kinds)");
    }
    return parts.join("\n");
  }

  private defaultKindsFor(agent: string): MemoryKind[] {
    if (agent.includes("requirements") || agent === "planner") return ["requirements", "decision", "conversation"];
    if (agent.includes("architect")) return ["architecture", "decision", "requirements"];
    if (agent.includes("generator")) return ["code", "architecture", "decision"];
    if (agent.includes("review") || agent.includes("test")) return ["code", "build", "decision"];
    if (agent.includes("build") || agent.includes("packaging")) return ["build", "artifact", "code"];
    if (agent === "decision-engine") return ["decision", "requirements", "architecture"];
    return ["conversation", "decision"];
  }
}

export const contextBuilder = new ContextBuilder(projectMemory);
