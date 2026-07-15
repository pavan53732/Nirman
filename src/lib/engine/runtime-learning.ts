/**
 * Runtime Learning — cross-project knowledge that improves future builds.
 *
 * Unlike Memory (which is per-project — see `memories.ts`), Learning stores
 * patterns that span projects:
 *   - Successful architectural patterns (reused across projects)
 *   - Failed repair/build strategies (avoided in future)
 *   - Preferred stack choices (based on past success rates)
 *   - Reusable implementation plans (templates for common requests)
 *   - Tool insights (how tools behave across runs)
 *   - Agent insights (which agent patterns work best)
 *
 * Memory stores WHAT happened. Learning stores WHAT WORKED and WHAT DIDN'T,
 * so future projects can benefit. This is cross-project knowledge (not
 * per-project like Memory).
 *
 * Learning is persisted to localStorage (browser) and accumulates over time.
 * On the server (Next.js API routes) the records live in-process for the
 * lifetime of the module — sufficient for the debug endpoint's seed → query
 * demo flow. Each learning record has a confidence score that increases with
 * repeated success and decreases with failure.
 */

export type LearningKind =
  | "successful-pattern" // an architectural pattern that worked well
  | "failed-strategy" // a repair/build strategy that failed
  | "preferred-stack" // a stack choice with above-average success
  | "reusable-plan" // an implementation plan template
  | "tool-insight" // learning about tool behavior
  | "agent-insight"; // learning about agent performance

export interface LearningRecord {
  id: string;
  kind: LearningKind;
  title: string;
  content: string;
  confidence: number; // 0-1, increases with success, decreases with failure
  occurrences: number; // how many times this pattern has been encountered
  successCount: number;
  failureCount: number;
  lastUsedAt: number;
  createdAt: number;
  tags: string[]; // for searchability (e.g., ["web", "auth", "prisma"])
  context?: {
    platform?: string;
    capabilities?: string[];
    promptFragment?: string;
  };
}

export interface LearningQuery {
  kind?: LearningKind;
  tags?: string[];
  minConfidence?: number;
  platform?: string;
  limit?: number;
}

const STORAGE_KEY = "pavan.learning.v1";

/**
 * RuntimeLearning — the cross-project learning store.
 *
 * Lifecycle mirrors `ProjectMemoryManager`: constructor eagerly loads from
 * localStorage (no-op on the server), and every mutation re-persists. The
 * singleton `runtimeLearning` is the public entry point; the class is
 * exported so callers (e.g. tests, plugins) can construct fresh instances
 * with isolated state.
 */
export class RuntimeLearning {
  private records: LearningRecord[] = [];
  private loaded = false;

  constructor() {
    this.load();
  }

  /**
   * Record a learning. If a matching record exists (same kind + title),
   * update its confidence and occurrence count. Otherwise, create a new
   * record.
   *
   * Confidence update on an existing record:
   *   confidence = successCount / (successCount + failureCount)
   *
   * New records start at:
   *   - 0.7 if outcome === "success"
   *   - 0.3 if outcome === "failure"
   *   - 0.5 if outcome === "neutral"
   *
   * Tags are unioned (deduped) into the existing record's tags so the
   * record becomes more searchable as it's seen in more contexts.
   */
  record(
    kind: LearningKind,
    title: string,
    content: string,
    outcome: "success" | "failure" | "neutral",
    tags: string[] = [],
    context?: LearningRecord["context"]
  ): LearningRecord {
    this.ensureLoaded();

    // Find existing record with same kind + title
    const existing = this.records.find(
      (r) => r.kind === kind && r.title === title
    );

    if (existing) {
      existing.occurrences++;
      if (outcome === "success") existing.successCount++;
      if (outcome === "failure") existing.failureCount++;

      // Update confidence: success increases, failure decreases
      const total = existing.successCount + existing.failureCount;
      if (total > 0) {
        existing.confidence = existing.successCount / total;
      }

      existing.lastUsedAt = Date.now();
      if (tags.length > 0) {
        existing.tags = [...new Set([...existing.tags, ...tags])];
      }
      // If new context was provided, merge it into the existing record
      // (don't overwrite — preserve prior platform/capabilities data).
      if (context) {
        existing.context = {
          ...(existing.context ?? {}),
          ...context,
          capabilities: context.capabilities
            ? [
                ...new Set([
                  ...(existing.context?.capabilities ?? []),
                  ...context.capabilities,
                ]),
              ]
            : existing.context?.capabilities,
        };
      }
      this.persist();
      return existing;
    }

    // Create new record
    const record: LearningRecord = {
      id: `learn-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      title,
      content,
      confidence:
        outcome === "success" ? 0.7 : outcome === "failure" ? 0.3 : 0.5,
      occurrences: 1,
      successCount: outcome === "success" ? 1 : 0,
      failureCount: outcome === "failure" ? 1 : 0,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
      tags,
      context,
    };

    this.records.push(record);
    this.persist();
    return record;
  }

  /**
   * Query learnings by kind, tags, confidence, or platform.
   *
   * Results are sorted by confidence (descending) then by lastUsedAt (most
   * recent first) so the most relevant learnings surface at the top. The
   * default limit is 50; callers can pass a smaller `limit` for top-N
   * recommendations.
   */
  query(q: LearningQuery): LearningRecord[] {
    this.ensureLoaded();

    let results = [...this.records];

    if (q.kind) results = results.filter((r) => r.kind === q.kind);
    if (q.tags && q.tags.length > 0) {
      results = results.filter((r) => q.tags!.some((t) => r.tags.includes(t)));
    }
    if (q.minConfidence !== undefined) {
      results = results.filter((r) => r.confidence >= q.minConfidence!);
    }
    if (q.platform) {
      results = results.filter((r) => r.context?.platform === q.platform);
    }

    // Sort by confidence (descending) then by lastUsedAt (most recent first)
    results.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.lastUsedAt - a.lastUsedAt;
    });

    return results.slice(0, q.limit ?? 50);
  }

  /**
   * Get the most confident learnings for a given context.
   * Used by the decision engine to prefer stacks/patterns that worked before.
   *
   * Only returns learnings with confidence >= 0.6 — i.e. patterns that have
   * historically succeeded more often than not. Top 5 by confidence.
   */
  recommend(
    kind: LearningKind,
    context?: { platform?: string; tags?: string[] }
  ): LearningRecord[] {
    return this.query({
      kind,
      platform: context?.platform,
      tags: context?.tags,
      minConfidence: 0.6, // only recommend learnings with >60% confidence
      limit: 5,
    });
  }

  /**
   * Get learnings about what FAILED — used to avoid repeating mistakes.
   *
   * Filters to records where failureCount > successCount (i.e. the pattern
   * has failed more often than it has succeeded). Top 5 by recency.
   */
  avoid(
    kind: LearningKind,
    context?: { platform?: string; tags?: string[] }
  ): LearningRecord[] {
    return this
      .query({
        kind,
        platform: context?.platform,
        tags: context?.tags,
        minConfidence: 0, // include low-confidence (failed) learnings
        limit: 5,
      })
      .filter((r) => r.failureCount > r.successCount);
  }

  /**
   * Get a summary of all learnings for debugging.
   *
   * Returns:
   *   - totalLearnings: count of all records
   *   - byKind: counts grouped by LearningKind
   *   - byTag: counts grouped by tag
   *   - totalSuccessOutcomes / totalFailureOutcomes: aggregate outcome counts
   *   - avgConfidence: mean confidence across all records
   *   - topLearnings: 10 highest-confidence records (kind, title, confidence,
   *     occurrences, successRate)
   */
  getSummary() {
    this.ensureLoaded();
    const byKind: Record<string, number> = {};
    const byTag: Record<string, number> = {};
    let totalSuccess = 0;
    let totalFailure = 0;

    for (const r of this.records) {
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
      for (const tag of r.tags) {
        byTag[tag] = (byTag[tag] ?? 0) + 1;
      }
      totalSuccess += r.successCount;
      totalFailure += r.failureCount;
    }

    return {
      totalLearnings: this.records.length,
      byKind,
      byTag,
      totalSuccessOutcomes: totalSuccess,
      totalFailureOutcomes: totalFailure,
      avgConfidence:
        this.records.length > 0
          ? this.records.reduce((s, r) => s + r.confidence, 0) /
            this.records.length
          : 0,
      topLearnings: [...this.records]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10)
        .map((r) => ({
          kind: r.kind,
          title: r.title,
          confidence: r.confidence,
          occurrences: r.occurrences,
          successRate: r.successCount / Math.max(1, r.occurrences),
        })),
    };
  }

  /**
   * Seed demo learnings for testing.
   *
   * Idempotent: calling it twice will increment the occurrence counts on
   * the existing records (since `record()` matches by kind+title) rather
   * than creating duplicates. The confidence of success-seeded records
   * will rise toward 1.0 as the seed is called repeatedly; failure-seeded
   * records' confidence will fall toward 0.0.
   *
   * Seeds 9 records across every LearningKind so the debug endpoint's
   * GET summary, GET ?kind=preferred-stack&platform=web (recommend), and
   * GET ?kind=failed-strategy (avoid) flows all have data to return.
   */
  seedDemoLearnings(): void {
    this.ensureLoaded();

    // Successful patterns
    this.record(
      "successful-pattern",
      "Multi-target CRM with Prisma + EF Core + Room",
      "3-target CRM with shared Contact entity, SQLite default, Prisma (web) + EF Core (windows) + Room (android). Success rate high.",
      "success",
      ["crm", "multi-target", "sqlite"],
      { platform: "web" }
    );

    this.record(
      "successful-pattern",
      "Auth via NextAuth.js",
      "NextAuth with credentials + Google providers, JWT sessions, HTTP-only cookies. Proven secure pattern.",
      "success",
      ["auth", "nextjs", "nextauth"],
      { platform: "web" }
    );

    // Preferred stacks
    this.record(
      "preferred-stack",
      "Web: Next.js + Tailwind + Prisma",
      "Next.js App Router + Tailwind CSS + Prisma SQLite. High success rate (95%+).",
      "success",
      ["web", "nextjs", "tailwind", "prisma"],
      { platform: "web" }
    );

    this.record(
      "preferred-stack",
      "Windows: WinUI 3 + .NET 8 + EF Core",
      "WinUI 3 + .NET 8 + EF Core SQLite. MVVM pattern. Good for offline-first desktop.",
      "success",
      ["windows", "winui", "dotnet", "efcore"],
      { platform: "windows" }
    );

    // Failed strategies
    this.record(
      "failed-strategy",
      "Direct PostgreSQL from Android",
      "Attempted direct PG connection from Android via Room. Failed — Room is local-only. Use backend API instead.",
      "failure",
      ["android", "postgresql", "room"],
      { platform: "android" }
    );

    this.record(
      "failed-strategy",
      "Eval-based code generation",
      "Used eval() for dynamic code generation. Security vulnerability. Use AST transformation instead.",
      "failure",
      ["security", "eval"]
    );

    // Reusable plans
    this.record(
      "reusable-plan",
      "CRUD app template",
      "Standard CRUD: model + API routes (list/create/update/delete) + list view + form view + detail view. Works for any entity.",
      "success",
      ["crud", "template"]
    );

    // Tool insights
    this.record(
      "tool-insight",
      "tsc is fast for small projects",
      "tsc --noEmit completes in <5s for projects <50 files. Slower for larger projects.",
      "success",
      ["tsc", "performance"]
    );

    this.record(
      "tool-insight",
      "npm-build can fail on missing peer deps",
      "npm build fails when peer dependencies are missing. Always run npm install first.",
      "failure",
      ["npm", "build", "dependencies"]
    );
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
      this.loaded = true;
    }
  }

  private load(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.records = JSON.parse(raw) as LearningRecord[];
      }
    } catch {
      this.records = [];
    }
  }

  private persist(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch {
      // storage may be full
    }
  }

  clear(): void {
    this.records = [];
    this.persist();
  }
}

export const runtimeLearning = new RuntimeLearning();
