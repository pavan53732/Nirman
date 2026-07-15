// Artifact Registry — first-class versioned objects with lineage.
// Each artifact: { id, version, hash, producedBy, workflowId, stage, path,
//                  dependencies[], createdAt, targetId?, sizeLabel }.
// The Artifact Manager tracks lineage and enables rollback and recovery.
//
// Wave 3A — Artifact Store is now QUERYABLE. The original `produce()` / `get()`
// / `all()` / `lineage()` API is unchanged (no breaking modifications). We add:
//   - query(filter)       : filter by type/target/producer/since/pathContains
//   - byType(type)        : convenience wrapper over query
//   - byTarget(target)    : convenience wrapper over query (matches targetId)
//   - lineageGraph(id)    : structured lineage { artifact, parents, children,
//                                                lineageDepth } — distinct
//                           from the existing `lineage(id): ArtifactRecord[]`
//                           which returns a flat ancestor list for rollback.
//   - getQuerySummary()   : counts by type/target/producer + recent artifacts
//
// The structured lineage lives under a NEW name (`lineageGraph`) because the
// existing `lineage(id)` method is preserved per the strict "do NOT change
// existing methods" directive from the Wave 3A brief.

import type {
  ArtifactRecord,
  ArtifactType,
  AgentRole,
  WorkflowId,
} from "./types";

/**
 * Filter options for `ArtifactRegistry.query()`. All fields are optional;
 * omitting a field means "do not filter on this dimension". The `target`
 * field is matched against `ArtifactRecord.targetId` (the runtime field name
 * is `targetId`; we keep `target` in the query interface for ergonomics and
 * URL-param friendliness in the debug endpoint).
 */
export interface ArtifactQuery {
  /** Filter by artifact type (e.g. "source-code", "installer"). */
  type?: ArtifactType;
  /** Filter by target (matched against `ArtifactRecord.targetId`). */
  target?: string;
  /** Filter by the agent role that produced the artifact. */
  producedBy?: AgentRole;
  /** Filter by createdAt — keep only artifacts produced AFTER this ms epoch. */
  since?: number;
  /** Filter by path substring (case-sensitive). */
  pathContains?: string;
}

/**
 * Structured lineage for an artifact — the artifact itself, its direct
 * parents (the artifacts in `dependencies`), the artifacts that directly
 * depend on it (children), and the depth of the ancestor chain.
 *
 * Returned by `ArtifactRegistry.lineageGraph(id)`. Distinct from the
 * existing `ArtifactRegistry.lineage(id): ArtifactRecord[]`, which returns
 * a flat list of ancestors + self (used for rollback/recovery).
 */
export interface ArtifactLineage {
  artifact: ArtifactRecord;
  /** Direct parents — artifacts in `artifact.dependencies`. */
  parents: ArtifactRecord[];
  /** Direct children — artifacts whose `dependencies` include `artifact.id`. */
  children: ArtifactRecord[];
  /** Number of ancestor generations above this artifact (0 = no parents). */
  lineageDepth: number;
}

/** Summary returned by `ArtifactRegistry.getQuerySummary()`. */
export interface ArtifactQuerySummary {
  totalArtifacts: number;
  byType: Record<string, number>;
  byTarget: Record<string, number>;
  byProducer: Record<string, number>;
  recentArtifacts: Array<{
    id: string;
    path: string;
    type: ArtifactType;
    targetId: string | undefined;
    producedBy: AgentRole;
    createdAt: number;
  }>;
}

/**
 * Real SHA-256 hash of file content. Uses the Web Crypto API (available in
 * both browser and Node 18+). Returns first 12 hex chars of the digest.
 */
async function realHash(content: string): Promise<string> {
  const enc = new TextEncoder().encode(content);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

export class ArtifactRegistry {
  private artifacts = new Map<string, ArtifactRecord>();
  private counter = 0;

  async produce(opts: {
    type: ArtifactType;
    name: string;
    producedBy: AgentRole;
    workflowId: WorkflowId;
    stageId: string;
    targetId?: string;
    path: string;
    content?: string; // file content for real SHA-256 hashing
    dependencies?: string[];
    sizeLabel: string;
  }): Promise<ArtifactRecord> {
    const id = `art-${++this.counter}`;
    const existing = [...this.artifacts.values()].find(
      (a) => a.name === opts.name && a.type === opts.type && a.targetId === opts.targetId
    );
    const version = existing ? existing.version + 1 : 1;
    // Real SHA-256 hash from file content, not random hex
    const hashContent = opts.content ?? `${opts.name}:${opts.path}:${version}`;
    const hash = "sha256:" + await realHash(hashContent);
    const rec: ArtifactRecord = {
      id,
      type: opts.type,
      name: opts.name,
      version,
      hash,
      producedBy: opts.producedBy,
      workflowId: opts.workflowId,
      stageId: opts.stageId,
      targetId: opts.targetId,
      path: opts.path,
      dependencies: opts.dependencies ?? [],
      sizeLabel: opts.sizeLabel,
      createdAt: Date.now(),
    };
    this.artifacts.set(id, rec);
    return rec;
  }

  get(id: string): ArtifactRecord | undefined {
    return this.artifacts.get(id);
  }

  all(): ArtifactRecord[] {
    return [...this.artifacts.values()];
  }

  forTarget(targetId: string): ArtifactRecord[] {
    return this.all().filter((a) => a.targetId === targetId);
  }

  forStage(stageId: string): ArtifactRecord[] {
    return this.all().filter((a) => a.stageId === stageId);
  }

  /** Rollback to the latest version produced before a given time. */
  rollbackToBefore(ts: number): ArtifactRecord[] {
    const survivors = this.all().filter((a) => a.createdAt <= ts);
    this.artifacts.clear();
    for (const a of survivors) this.artifacts.set(a.id, a);
    return survivors;
  }

  /** Lineage: trace dependencies backward. */
  lineage(id: string): ArtifactRecord[] {
    const out: ArtifactRecord[] = [];
    const seen = new Set<string>();
    const walk = (aid: string) => {
      const a = this.get(aid);
      if (!a || seen.has(aid)) return;
      seen.add(aid);
      out.push(a);
      for (const dep of a.dependencies) walk(dep);
    };
    walk(id);
    return out;
  }

  // --------------------------------------------------------------------------
  // Wave 3A — Query API (additive; existing methods above are unchanged).
  // --------------------------------------------------------------------------

  /**
   * Query artifacts by filter. All specified fields must match (logical AND).
   * Omitting a field means "do not filter on this dimension". Returns the
   * full `ArtifactRecord[]` for matches — callers that need a lighter
   * projection should map to a slimmer shape.
   *
   * Field-name mapping (filter → record):
   *   filter.type         → ArtifactRecord.type
   *   filter.target       → ArtifactRecord.targetId
   *   filter.producedBy   → ArtifactRecord.producedBy
   *   filter.since        → ArtifactRecord.createdAt (records with
   *                                   createdAt < since are excluded)
   *   filter.pathContains → ArtifactRecord.path (substring match)
   */
  query(filter: ArtifactQuery): ArtifactRecord[] {
    return this.all().filter((a) => {
      if (filter.type && a.type !== filter.type) return false;
      if (filter.target && a.targetId !== filter.target) return false;
      if (filter.producedBy && a.producedBy !== filter.producedBy) return false;
      if (typeof filter.since === "number" && a.createdAt < filter.since)
        return false;
      if (filter.pathContains && !a.path.includes(filter.pathContains))
        return false;
      return true;
    });
  }

  /** Convenience: all artifacts of a given type. Equivalent to `query({type})`. */
  byType(type: ArtifactType): ArtifactRecord[] {
    return this.query({ type });
  }

  /** Convenience: all artifacts for a given targetId. Equivalent to `query({target})`. */
  byTarget(target: string): ArtifactRecord[] {
    return this.query({ target });
  }

  /**
   * Structured lineage for an artifact — the artifact itself, its direct
   * parents (the artifacts named in `dependencies`), the artifacts that
   * directly depend on it (children), and the depth of the ancestor chain.
   *
   * This is DISTINCT from the pre-existing `lineage(id): ArtifactRecord[]`
   * method above, which returns a flat list of ancestors + self for
   * rollback/recovery. `lineageGraph` returns the structured
   * `{ artifact, parents, children, lineageDepth }` object the V2 audit
   * asks for in Step 8. The two methods coexist intentionally — the audit
   * brief prohibits modifying existing methods.
   *
   * Returns `undefined` if the artifact id is not registered.
   *
   * Cycle-safe: the depth walk tracks visited ids and caps at 10 generations
   * to prevent runaway recursion if the dependency graph ever contains a cycle.
   */
  lineageGraph(artifactId: string): ArtifactLineage | undefined {
    const artifact = this.get(artifactId);
    if (!artifact) return undefined;

    // Direct parents: artifacts named in `dependencies` that still exist.
    const parents: ArtifactRecord[] = artifact.dependencies
      .map((id) => this.get(id))
      .filter((a): a is ArtifactRecord => a !== undefined);

    // Direct children: every artifact whose `dependencies` includes this id.
    const children: ArtifactRecord[] = this.all().filter((a) =>
      a.dependencies.includes(artifactId)
    );

    // Depth = number of ancestor generations. Walk parent links upward, one
    // generation at a time, tracking visited ids so cycles can't loop forever.
    let depth = 0;
    const seen = new Set<string>([artifactId]);
    let current = parents;
    while (current.length > 0) {
      depth++;
      if (depth >= 10) break; // cycle guard
      const next: ArtifactRecord[] = [];
      for (const p of current) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        for (const depId of p.dependencies) {
          if (seen.has(depId)) continue;
          const dep = this.get(depId);
          if (dep && !seen.has(dep.id)) {
            seen.add(dep.id);
            next.push(dep);
          }
        }
      }
      current = next;
    }

    return {
      artifact,
      parents,
      children,
      lineageDepth: depth,
    };
  }

  /**
   * Get a query-oriented summary of the registry: total artifact count,
   * counts broken down by type / targetId / producer, and the 10 most
   * recently registered artifacts (lightweight projection — id, path,
   * type, targetId, producedBy, createdAt only). Used by the
   * `/api/debug/artifacts` endpoint to render an at-a-glance view when
   * no filter is supplied.
   */
  getQuerySummary(): ArtifactQuerySummary {
    const all = this.all();
    const byType: Record<string, number> = {};
    const byTarget: Record<string, number> = {};
    const byProducer: Record<string, number> = {};
    for (const a of all) {
      byType[a.type] = (byType[a.type] ?? 0) + 1;
      const targetKey = a.targetId ?? "(global)";
      byTarget[targetKey] = (byTarget[targetKey] ?? 0) + 1;
      byProducer[a.producedBy] = (byProducer[a.producedBy] ?? 0) + 1;
    }
    return {
      totalArtifacts: all.length,
      byType,
      byTarget,
      byProducer,
      recentArtifacts: all.slice(-10).map((a) => ({
        id: a.id,
        path: a.path,
        type: a.type,
        targetId: a.targetId,
        producedBy: a.producedBy,
        createdAt: a.createdAt,
      })),
    };
  }

  clear(): void {
    this.artifacts.clear();
    this.counter = 0;
  }
}

export const artifactRegistry = new ArtifactRegistry();
