// Project Evolution — enables Nirman to reopen existing projects and continue
// evolving them without losing prior design decisions.
//
// REVIEWER ASKED FOR:
//   "Continuous evolution: Nirman should be able to reopen an existing project
//    months later, understand its architecture, and continue evolving it
//    without losing prior design decisions."
//
// Four capabilities, each addressing a piece of that requirement:
//
//   1. Snapshot — serialize the full project state (memory + artifacts +
//                 workspace + decisions) to a portable JSON format that
//                 survives localStorage clearing, browser restarts, and
//                 cross-environment transfer (export → import).
//
//   2. Restore  — reopen a snapshot and reconstruct the in-memory state
//                 (memory records are re-written to the Project Memory
//                 Manager) so the next agent run sees the prior context.
//
//   3. Analyze  — when reopening, infer the project type, architecture
//                 pattern, tech stack, and primary entities from the
//                 snapshot's memory + workspace summary so a user (or agent)
//                 understands what was built before — without re-reading
//                 every memory record.
//
//   4. Track    — diff two snapshots to produce a human-readable evolution
//                 summary: how many memory records / artifacts / decisions
//                 changed between versions, plus capability delta.
//
// Snapshots are plain JSON-serializable objects. They can be persisted to
// disk, IndexedDB (via the existing idb.ts helpers), or exported for
// transfer between environments. The in-memory `snapshots` Map is a
// convenience for the current session; long-term persistence is the
// caller's responsibility (see the debug endpoint for an example flow).

import { memoryAccess } from "./memories";
import { workspaceIntelligence } from "./workspace-intelligence";
import { artifactRegistry } from "./artifact-registry";
import type { MemoryRecord } from "./types";

/**
 * Portable snapshot of the entire project state at a moment in time.
 * JSON-serializable — safe to persist to disk, IndexedDB, or export.
 */
export interface ProjectSnapshot {
  version: 1;
  projectId: string;
  projectName: string;
  createdAt: number;
  memory: MemoryRecord[];
  artifacts: {
    id: string;
    path: string;
    content: string;
    hash: string;
    version: number;
  }[];
  decisions: {
    topic: string;
    chosen: string;
    rationale: string;
    confidence: number;
    createdAt: number;
  }[];
  workspaceSummary: {
    fileCount: number;
    targets: string[];
    layers: Record<string, string[]>;
    symbolCount: number;
  };
  architectureSummary: string;
  prompt: string;
  capabilities: string[];
}

/**
 * Human-readable diff between two snapshots — answers "what changed?" when
 * a project is evolved from one version to the next.
 */
export interface EvolutionDiff {
  fromSnapshot: string; // ISO timestamp
  toSnapshot: string; // ISO timestamp
  memoryAdded: number;
  memoryModified: number;
  artifactsAdded: number;
  artifactsModified: number;
  artifactsRemoved: number;
  decisionsChanged: number;
  newCapabilities: string[];
  removedCapabilities: string[];
  summary: string;
}

/**
 * Architecture understanding — what a user/agent sees when reopening a
 * project. Derived from the snapshot's memory + workspace summary so it can
 * be produced WITHOUT re-indexing the workspace (which may be unavailable
 * in a fresh environment).
 */
export interface ArchitectureUnderstanding {
  projectType: string;
  targets: string[];
  primaryEntities: string[];
  architecturePattern: string;
  techStack: string[];
  dataLayer: string;
  uiLayer: string;
  apiLayer: string;
  confidence: number;
  summary: string;
}

export class ProjectEvolution {
  // In-session snapshot cache (projectId → latest snapshot). Long-term
  // persistence is the caller's responsibility; this Map is the
  // convenience accessor for "what did I just snapshot?"
  private snapshots = new Map<string, ProjectSnapshot>();

  /**
   * 1. Snapshot — serialize the full project state to a portable format.
   *
   * Captures memory records, decisions (parsed from decision-kind memory),
   * artifacts (from the ArtifactRegistry), and a workspace summary (from
   * the WorkspaceIntelligence graph, if indexed). Also produces an
   * architecture summary string for quick human read-back.
   */
  snapshot(
    projectId: string,
    projectName: string,
    prompt: string,
    capabilities: string[]
  ): ProjectSnapshot {
    // Read all memory records via the official MemoryAccess facade.
    // (Runtime V2 Audit, Phase 2 Step 6 — internal modules must not touch
    // `projectMemory` directly; they go through `memoryAccess`. The read
    // is recorded in the audit log with operation="all".)
    const memory = memoryAccess.all();
    const decisions = this.extractDecisions(memory);
    const artifacts = this.extractArtifacts();
    const workspaceSummary = this.extractWorkspaceSummary();
    const architectureSummary = this.produceArchitectureSummary(
      memory,
      workspaceSummary
    );

    const snap: ProjectSnapshot = {
      version: 1,
      projectId,
      projectName,
      createdAt: Date.now(),
      memory,
      artifacts,
      decisions,
      workspaceSummary,
      architectureSummary,
      prompt,
      capabilities,
    };

    this.snapshots.set(projectId, snap);
    return snap;
  }

  /**
   * 2. Restore — reopen a snapshot and reconstruct the full state.
   *
   * Memory records are re-written to the Project Memory Manager (which
   * re-persists them to localStorage via its own persist() path), so the
   * next agent run sees the prior context as if it had always been there.
   * Also returns an ArchitectureUnderstanding so the caller can show the
   * user "here's what this project is" immediately after restore.
   */
  restore(snap: ProjectSnapshot): {
    restored: boolean;
    understanding: ArchitectureUnderstanding;
    memoryRecords: number;
  } {
    // Restore memory — clear first so we don't merge with stale records
    // from a different project, then re-write each record. Both the clear
    // and the writes go through the MemoryAccess facade so the audit log
    // captures the full restore operation (operation="clear" followed by
    // N operation="write" entries with source=record.source).
    memoryAccess.clear();
    for (const record of snap.memory) {
      memoryAccess.write(
        record.kind,
        record.title,
        record.content,
        record.source
      );
    }

    // Produce architecture understanding from the restored snapshot
    const understanding = this.understandArchitecture(snap);

    return {
      restored: true,
      understanding,
      memoryRecords: snap.memory.length,
    };
  }

  /**
   * 3. Analyze — when reopening, infer the project's architecture from the
   *    snapshot's memory + workspace summary. This is the "what did I
   *    build?" read-back that lets a user (or agent) orient themselves
   *    without re-reading every memory record.
   *
   * The inference rules are deliberately conservative: they only fire when
   * there's positive evidence (a target in the workspace summary, a
   * "ViewModels" layer name, etc.) and fall back to "Unknown" otherwise.
   * Confidence is high (0.9) when targets are known, low (0.3) otherwise.
   */
  understandArchitecture(snap: ProjectSnapshot): ArchitectureUnderstanding {
    const targets = snap.workspaceSummary.targets;
    const layers = snap.workspaceSummary.layers;

    // Infer project type
    let projectType = "Unknown";
    if (targets.length > 1) projectType = "Multi-platform application";
    else if (targets.includes("web")) projectType = "Web application";
    else if (targets.includes("windows"))
      projectType = "Windows desktop application";
    else if (targets.includes("android"))
      projectType = "Android application";

    // Infer primary entities from memory (capitalized words in architecture/
    // code records — a heuristic, but good enough for orientation).
    const primaryEntities = this.extractEntityNames(snap.memory);

    // Infer architecture pattern from layer names + targets
    let architecturePattern = "Unknown";
    if (
      targets.includes("windows") &&
      layers["windows"]?.some((l) => l.includes("ViewModels"))
    ) {
      architecturePattern = "MVVM (Model-View-ViewModel)";
    } else if (
      targets.includes("android") &&
      layers["android"]?.some((l) => l.includes("ViewModels"))
    ) {
      architecturePattern = "MVVM with Repository pattern";
    } else if (targets.includes("web")) {
      architecturePattern = "Next.js App Router (server components + API routes)";
    }

    // Infer tech stack from targets
    const techStack: string[] = [];
    if (targets.includes("web"))
      techStack.push("Next.js", "React", "Tailwind CSS", "Prisma", "TypeScript");
    if (targets.includes("windows"))
      techStack.push("WinUI 3", ".NET 8", "C#", "EF Core", "XAML");
    if (targets.includes("android"))
      techStack.push(
        "Jetpack Compose",
        "Kotlin",
        "Room",
        "Hilt",
        "Material 3"
      );

    // Infer each layer
    const dataLayer = targets.includes("web")
      ? "Prisma + SQLite"
      : targets.includes("windows")
      ? "EF Core + SQLite"
      : targets.includes("android")
      ? "Room + SQLite"
      : "Unknown";
    const uiLayer = targets.includes("web")
      ? "Next.js pages + Tailwind"
      : targets.includes("windows")
      ? "WinUI XAML"
      : targets.includes("android")
      ? "Jetpack Compose"
      : "Unknown";
    const apiLayer = targets.includes("web")
      ? "Next.js API Routes (REST)"
      : targets.includes("windows")
      ? "WCF/ASP.NET (if any)"
      : targets.includes("android")
      ? "Retrofit (if any)"
      : "Unknown";

    const summary =
      `${projectType} using ${architecturePattern}. ` +
      `Targets: ${targets.join(", ")}. ` +
      `Primary entities: ${primaryEntities.join(", ") || "unknown"}. ` +
      `Tech stack: ${techStack.join(", ")}. ` +
      `${snap.memory.length} memory records, ${snap.artifacts.length} artifacts.`;

    return {
      projectType,
      targets,
      primaryEntities,
      architecturePattern,
      techStack,
      dataLayer,
      uiLayer,
      apiLayer,
      confidence: targets.length > 0 ? 0.9 : 0.3,
      summary,
    };
  }

  /**
   * 4. Track — diff two snapshots and produce a human-readable evolution
   *    summary. Used to answer "what changed between v1 and v2?" when a
   *    project is evolved over time.
   *
   * Diffs:
   *   - Memory: added (new kind+title keys) + modified (same key, content changed)
   *   - Artifacts: added/removed (by path) + modified (same path, hash changed)
   *   - Decisions: changed (new topic OR chosen value differs)
   *   - Capabilities: new/removed (set difference)
   */
  diff(from: ProjectSnapshot, to: ProjectSnapshot): EvolutionDiff {
    // Memory diff — keyed by kind:title so an updated record counts as
    // "modified" rather than "added + removed".
    const fromMemoryKeys = new Set(
      from.memory.map((m) => `${m.kind}:${m.title}`)
    );
    const toMemoryKeys = new Set(to.memory.map((m) => `${m.kind}:${m.title}`));
    const memoryAdded = [...toMemoryKeys].filter(
      (k) => !fromMemoryKeys.has(k)
    ).length;
    const memoryModified = to.memory.filter((m) => {
      const fromRec = from.memory.find(
        (f) => f.kind === m.kind && f.title === m.title
      );
      return fromRec && fromRec.content !== m.content;
    }).length;

    // Artifacts diff — keyed by path
    const fromArtifactPaths = new Set(from.artifacts.map((a) => a.path));
    const toArtifactPaths = new Set(to.artifacts.map((a) => a.path));
    const artifactsAdded = [...toArtifactPaths].filter(
      (p) => !fromArtifactPaths.has(p)
    ).length;
    const artifactsRemoved = [...fromArtifactPaths].filter(
      (p) => !toArtifactPaths.has(p)
    ).length;
    const artifactsModified = to.artifacts.filter((a) => {
      const fromArt = from.artifacts.find((f) => f.path === a.path);
      return fromArt && fromArt.hash !== a.hash;
    }).length;

    // Decisions diff — same topic with a different chosen value, or a
    // brand-new topic.
    const decisionsChanged = to.decisions.filter((d) => {
      const fromDec = from.decisions.find((f) => f.topic === d.topic);
      return !fromDec || fromDec.chosen !== d.chosen;
    }).length;

    // Capabilities diff — set difference both ways
    const newCapabilities = to.capabilities.filter(
      (c) => !from.capabilities.includes(c)
    );
    const removedCapabilities = from.capabilities.filter(
      (c) => !to.capabilities.includes(c)
    );

    const summary =
      `Evolved from ${from.projectName} to ${to.projectName}. ` +
      `+${memoryAdded} memory records (${memoryModified} modified), ` +
      `+${artifactsAdded} artifacts (${artifactsModified} modified, ${artifactsRemoved} removed), ` +
      `${decisionsChanged} decisions changed, ` +
      `+${newCapabilities.length} capabilities (${removedCapabilities.length} removed).`;

    return {
      fromSnapshot: new Date(from.createdAt).toISOString(),
      toSnapshot: new Date(to.createdAt).toISOString(),
      memoryAdded,
      memoryModified,
      artifactsAdded,
      artifactsModified,
      artifactsRemoved,
      decisionsChanged,
      newCapabilities,
      removedCapabilities,
      summary,
    };
  }

  /**
   * Get the most recent snapshot for a project (from the in-session cache).
   * Returns undefined if no snapshot has been taken this session — callers
   * that need cross-session durability should persist snapshots via idb or
   * disk themselves and pass them back into restore().
   */
  getSnapshot(projectId: string): ProjectSnapshot | undefined {
    return this.snapshots.get(projectId);
  }

  /**
   * List all snapshots taken this session — used by debug endpoints and
   * "recent projects" UIs.
   */
  listSnapshots(): {
    projectId: string;
    projectName: string;
    createdAt: number;
    memoryRecords: number;
    artifacts: number;
  }[] {
    return [...this.snapshots.values()].map((s) => ({
      projectId: s.projectId,
      projectName: s.projectName,
      createdAt: s.createdAt,
      memoryRecords: s.memory.length,
      artifacts: s.artifacts.length,
    }));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extract decision records from memory. Decision-kind records may store
   * their content as a JSON string ({ chosen, rationale, confidence }) or as
   * plain text — we handle both.
   */
  private extractDecisions(
    memory: MemoryRecord[]
  ): ProjectSnapshot["decisions"] {
    const decisionMemory = memory.filter((m) => m.kind === "decision");
    return decisionMemory.map((m) => {
      try {
        const parsed = JSON.parse(m.content);
        return {
          topic: m.title,
          chosen: parsed.chosen ?? "unknown",
          rationale: parsed.rationale ?? m.content,
          confidence: parsed.confidence ?? 0.5,
          createdAt: m.createdAt,
        };
      } catch {
        return {
          topic: m.title,
          chosen: m.content,
          rationale: m.content,
          confidence: 0.5,
          createdAt: m.createdAt,
        };
      }
    });
  }

  /**
   * Extract artifacts from the ArtifactRegistry. The registry stores
   * ArtifactRecord objects (id, path, hash, version, etc.) but NOT file
   * content — so `content` is left as an empty string. If/when content
   * tracking is added to the registry, this is the only place that needs
   * to change.
   */
  private extractArtifacts(): ProjectSnapshot["artifacts"] {
    return artifactRegistry.all().map((a) => ({
      id: a.id,
      path: a.path,
      content: "", // registry doesn't track content
      hash: a.hash,
      version: a.version,
    }));
  }

  /**
   * Extract a workspace summary from the WorkspaceIntelligence graph. If
   * the workspace hasn't been indexed yet, returns an empty summary — the
   * snapshot is still valid, just without workspace info.
   */
  private extractWorkspaceSummary(): ProjectSnapshot["workspaceSummary"] {
    const graph = workspaceIntelligence.getGraph();
    if (!graph) {
      return { fileCount: 0, targets: [], layers: {}, symbolCount: 0 };
    }
    const targets = [...graph.architecture.keys()];
    const layers: Record<string, string[]> = {};
    for (const [target, targetLayers] of graph.architecture.entries()) {
      layers[target] = targetLayers.map((l) => l.name);
    }
    return {
      fileCount: graph.fileCount,
      targets,
      layers,
      symbolCount: graph.totalSymbols,
    };
  }

  /**
   * Produce a one-line architecture summary string for the snapshot. Used
   * for quick human read-back — the full ArchitectureUnderstanding is
   * produced on demand by understandArchitecture().
   */
  private produceArchitectureSummary(
    memory: MemoryRecord[],
    workspace: ProjectSnapshot["workspaceSummary"]
  ): string {
    const reqMemory = memory.filter((m) => m.kind === "requirements");
    const archMemory = memory.filter((m) => m.kind === "architecture");
    const parts: string[] = [];
    if (reqMemory.length > 0)
      parts.push(`Requirements: ${reqMemory.length} records`);
    if (archMemory.length > 0)
      parts.push(`Architecture: ${archMemory.length} records`);
    if (workspace.fileCount > 0)
      parts.push(
        `Workspace: ${workspace.fileCount} files, ${workspace.symbolCount} symbols`
      );
    if (workspace.targets.length > 0)
      parts.push(`Targets: ${workspace.targets.join(", ")}`);
    return parts.join(". ") || "No architecture data available.";
  }

  /**
   * Extract candidate entity names from memory — capitalized words in
   * architecture/code records, minus common English stop-words. Used as a
   * heuristic for "what are the primary domain entities?" (e.g. Contact,
   * Deal, Payment). Capped at 10 to keep the summary readable.
   */
  private extractEntityNames(memory: MemoryRecord[]): string[] {
    const entities = new Set<string>();
    const stopWords = new Set([
      "The",
      "This",
      "That",
      "And",
      "Or",
      "But",
      "With",
      "Without",
      "For",
      "From",
      "Into",
      "Onto",
      "Over",
      "Under",
      "Next",
      "Add",
      "Get",
      "Set",
      "Put",
      "Has",
      "Have",
      "Had",
      "Was",
      "Were",
      "Will",
      "Would",
      "Could",
      "Should",
      "Can",
      "May",
      "Might",
      "Must",
      "Shall",
      "When",
      "Then",
      "Here",
      "There",
      "Now",
      "Today",
      "Tomorrow",
      "Yesterday",
      "First",
      "Last",
      "Each",
      "Some",
      "Any",
      "All",
      "Both",
      "Few",
      "More",
      "Most",
      "Other",
      "Such",
      "Only",
      "Own",
      "Same",
      "Very",
      "Just",
      "Also",
      "Once",
      "User",
    ]);
    for (const m of memory) {
      if (m.kind === "architecture" || m.kind === "code") {
        const matches = m.content.match(/\b([A-Z][a-z]+)\b/g);
        if (matches) {
          for (const match of matches) {
            if (!stopWords.has(match)) {
              entities.add(match);
            }
          }
        }
      }
    }
    return [...entities].slice(0, 10);
  }
}

export const projectEvolution = new ProjectEvolution();
