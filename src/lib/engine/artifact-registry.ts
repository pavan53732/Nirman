// Artifact Registry — first-class versioned objects with lineage.
// Each artifact: { id, version, hash, producedBy, workflowId, stage, path,
//                  dependencies[], createdAt, targetId?, sizeLabel }.
// The Artifact Manager tracks lineage and enables rollback and recovery.

import type { ArtifactRecord, ArtifactType, AgentRole, WorkflowId } from "./types";

function shortHash(): string {
  return Array.from({ length: 12 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)]
  ).join("");
}

export class ArtifactRegistry {
  private artifacts = new Map<string, ArtifactRecord>();
  private counter = 0;

  produce(opts: {
    type: ArtifactType;
    name: string;
    producedBy: AgentRole;
    workflowId: WorkflowId;
    stageId: string;
    targetId?: string;
    path: string;
    dependencies?: string[];
    sizeLabel: string;
  }): ArtifactRecord {
    const id = `art-${++this.counter}`;
    const existing = [...this.artifacts.values()].find(
      (a) => a.name === opts.name && a.type === opts.type && a.targetId === opts.targetId
    );
    const version = existing ? existing.version + 1 : 1;
    const rec: ArtifactRecord = {
      id,
      type: opts.type,
      name: opts.name,
      version,
      hash: "sha256:" + shortHash(),
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

  clear(): void {
    this.artifacts.clear();
    this.counter = 0;
  }
}

export const artifactRegistry = new ArtifactRegistry();
