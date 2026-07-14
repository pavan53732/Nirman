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
 * Context Builder — builds a minimal prompt pack per agent from indexes & memory.
 * Pulls only relevant memory slices to keep token usage low.
 */
export class ContextBuilder {
  constructor(private mem: ProjectMemoryManager) {}

  buildForAgent(
    agent: string,
    opts: { kinds?: MemoryKind[]; prompt?: string } = {}
  ): { memorySlice: MemoryRecord[]; tokenEstimate: number } {
    const kinds = opts.kinds ?? this.defaultKindsFor(agent);
    const memorySlice = this.mem.sliceFor(agent, kinds);
    // No token estimate — real tokens come from the z-ai SDK usage response.
    // For non-LLM tasks (context building), tokens = 0.
    const tokenEstimate = 0;
    void memorySlice; void opts;
    return { memorySlice, tokenEstimate };
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
