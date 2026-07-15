// WorkspaceReasoning — deeper analysis capabilities built on top of the
// 4-graph WorkspaceIntelligence (semantic index, symbol graph, dependency
// graph, architecture graph).
//
// REVIEWER ASKED FOR:
//   "Workspace intelligence depth: Right now you have the graph
//    infrastructure. Next comes richer reasoning: semantic search, impact
//    analysis, architecture validation, dependency recommendations, dead-code
//    detection."
//
// This module adds 5 reasoning capabilities ON TOP of the existing graphs —
// it does NOT modify WorkspaceIntelligence. Each capability composes the
// existing graph queries:
//
//   1. Semantic Search        — natural-language query → ranked files/symbols
//   2. Impact Analysis        — symbol → blast radius (direct + transitive)
//   3. Architecture Validation — clean-architecture scorecard
//   4. Dependency Recommendations — circular deps, god modules, refactor hints
//   5. Dead-Code Detection    — symbols/files defined but never referenced

import { workspaceIntelligence } from "./workspace-intelligence";
import type { Symbol, Dependency } from "./workspace-intelligence";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SemanticSearchResult {
  file: string;
  symbol?: string;
  score: number; // 0-1 relevance score
  reason: string; // why it matched
}

export interface ImpactAnalysis {
  changedSymbol: string;
  directlyAffected: string[]; // files that directly import/use the symbol
  transitivelyAffected: string[]; // files affected through the dependency chain
  totalImpact: number;
  riskLevel: "low" | "medium" | "high";
}

export interface ArchitectureViolation {
  type:
    | "missing-layer"
    | "circular-dependency"
    | "cross-cutting-concern"
    | "god-class";
  description: string;
  files: string[];
  severity: "warning" | "error";
}

export interface ArchitectureValidation {
  violations: ArchitectureViolation[];
  score: number; // 0-100
  layersPresent: string[];
  layersMissing: string[];
  summary: string;
}

export interface DependencyRecommendation {
  type:
    | "missing-import"
    | "circular-dependency"
    | "unused-dependency"
    | "suggested-refactor";
  description: string;
  from?: string;
  to?: string;
  impact: "low" | "medium" | "high";
}

export interface DeadCodeReport {
  unusedSymbols: { symbol: string; file: string; kind: string }[];
  unusedFiles: string[];
  totalDeadCode: number;
  deadCodePercentage: number;
}

// ---------------------------------------------------------------------------
// WorkspaceReasoning
// ---------------------------------------------------------------------------

export class WorkspaceReasoning {
  /**
   * 1. Semantic Search — find files/symbols by natural-language query.
   * Uses keyword matching + symbol-name similarity.
   */
  semanticSearch(query: string, limit = 10): SemanticSearchResult[] {
    const graph = workspaceIntelligence.getGraph();
    if (!query.trim() || !graph) return [];

    const results: SemanticSearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(Boolean);

    // Search through semantic index
    for (const [path, info] of graph.semanticIndex) {
      let score = 0;
      const reasons: string[] = [];

      // Match on path
      for (const term of queryTerms) {
        if (path.toLowerCase().includes(term)) {
          score += 0.3;
          reasons.push(`path contains "${term}"`);
        }
      }

      // Match on purpose
      if (queryTerms.some((t) => info.purpose.includes(t))) {
        score += 0.4;
        reasons.push(`purpose: ${info.purpose}`);
      }

      // Match on framework
      if (queryTerms.some((t) => info.framework.includes(t))) {
        score += 0.2;
        reasons.push(`framework: ${info.framework}`);
      }

      // Search symbols in this file
      const symbols = graph.symbolGraph.get(path) ?? [];
      for (const sym of symbols) {
        let symScore = score;
        if (queryTerms.some((t) => sym.name.toLowerCase().includes(t))) {
          symScore += 0.5;
          results.push({
            file: path,
            symbol: sym.name,
            score: Math.min(1, symScore),
            reason: `symbol "${sym.name}" (${sym.kind}) matches — ${reasons.join(", ")}`,
          });
        }
      }

      // If no symbol matched but file scored, add file-level result
      if (score > 0 && !results.some((r) => r.file === path)) {
        results.push({
          file: path,
          score: Math.min(1, score),
          reason: reasons.join(", "),
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * 2. Impact Analysis — what files are affected if a symbol changes?
   * Uses the dependency graph to trace direct + transitive impact.
   *
   * Direct impact is computed from three signals:
   *   - dependency `to` field mentions the symbol (explicit import/reference)
   *   - file path mentions the symbol (e.g., app/dashboard/contacts/page.tsx
   *     for "Contact" — files grouped under an entity name are clearly tied
   *     to that entity)
   *   - the file DEFINES a symbol whose name contains the query (e.g.,
   *     `ContactPage` for "Contact")
   *
   * Matching is case-insensitive on the symbol name (Prisma convention is
   * PascalCase `model Contact {}` while route handlers access it via the
   * lowercase `prisma.contact.*` accessor, and pages live under
   * `app/<entity-plural-lower>/`).
   */
  analyzeImpact(symbolName: string): ImpactAnalysis {
    const graph = workspaceIntelligence.getGraph();
    if (!graph) {
      return {
        changedSymbol: symbolName,
        directlyAffected: [],
        transitivelyAffected: [],
        totalImpact: 0,
        riskLevel: "low",
      };
    }

    const symbolLower = symbolName.toLowerCase();

    // Find files that directly depend on / reference the symbol
    const directlyAffected = new Set<string>();
    for (const [from, deps] of graph.dependencyGraph) {
      // Match on import/reference target (case-insensitive on the symbol)
      if (
        deps.some(
          (d) =>
            d.to === symbolName || d.to.toLowerCase().includes(symbolLower)
        )
      ) {
        directlyAffected.add(from);
      }
      // Match on file path — files grouped under the entity name are tied
      // to that entity (e.g., app/dashboard/contacts/page.tsx for "Contact")
      if (from.toLowerCase().includes(symbolLower)) {
        directlyAffected.add(from);
      }
    }
    // Match on symbols defined in the file — if a file defines a symbol
    // whose name contains the query (e.g., ContactPage), it is also affected
    for (const [file, symbols] of graph.symbolGraph) {
      if (symbols.some((s) => s.name.toLowerCase().includes(symbolLower))) {
        directlyAffected.add(file);
      }
    }

    // Trace transitive impact (BFS through dependency graph). A file is
    // transitively affected if it depends (directly) on any already-affected
    // file. We check both the dependency target and the dependent file path.
    const transitivelyAffected = new Set<string>();
    const queue = [...directlyAffected];
    const visited = new Set<string>(directlyAffected);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentLower = current.toLowerCase();
      const currentBase = current.split("/").pop() ?? current;
      for (const [from, deps] of graph.dependencyGraph) {
        if (visited.has(from)) continue;
        const matches =
          deps.some(
            (d) =>
              d.to === current ||
              d.to.toLowerCase().includes(currentLower) ||
              d.to.toLowerCase().includes(currentBase.toLowerCase())
          ) || from.toLowerCase().includes(currentBase.toLowerCase());
        if (matches) {
          visited.add(from);
          transitivelyAffected.add(from);
          queue.push(from);
        }
      }
    }

    const totalImpact = directlyAffected.size + transitivelyAffected.size;
    const riskLevel: ImpactAnalysis["riskLevel"] =
      totalImpact > 10 ? "high" : totalImpact > 3 ? "medium" : "low";

    return {
      changedSymbol: symbolName,
      directlyAffected: [...directlyAffected].sort(),
      transitivelyAffected: [...transitivelyAffected].sort(),
      totalImpact,
      riskLevel,
    };
  }

  /**
   * 3. Architecture Validation — does the project follow clean architecture?
   */
  validateArchitecture(targetKey: string): ArchitectureValidation {
    const graph = workspaceIntelligence.getGraph();
    if (!graph) {
      return {
        violations: [],
        score: 0,
        layersPresent: [],
        layersMissing: [],
        summary: "No graph available",
      };
    }

    const layers = graph.architecture.get(targetKey) ?? [];
    const layerNames = layers.map((l) => l.name);
    const violations: ArchitectureViolation[] = [];

    // Expected layers by target
    const expectedLayers =
      targetKey === "web"
        ? ["Models", "API Routes", "Database Schema", "Configuration"]
        : targetKey === "windows"
        ? ["Models", "Views", "ViewModels", "Data Layer", "Project Files"]
        : targetKey === "android"
        ? [
            "Screens",
            "Models",
            "Data Access",
            "Dependency Injection",
            "Repositories",
          ]
        : [];

    const layersMissing = expectedLayers.filter(
      (l) => !layerNames.some((ln) => ln.includes(l))
    );
    for (const missing of layersMissing) {
      violations.push({
        type: "missing-layer",
        description: `Missing architecture layer: ${missing}`,
        files: [],
        severity: "warning",
      });
    }

    // Check for circular dependencies
    const circular = this.detectCircularDependencies();
    for (const cycle of circular) {
      violations.push({
        type: "circular-dependency",
        description: `Circular dependency detected: ${cycle.join(" → ")}`,
        files: cycle,
        severity: "error",
      });
    }

    // Check for god classes (files with too many symbols)
    for (const [file, symbols] of graph.symbolGraph) {
      if (symbols.length > 10) {
        violations.push({
          type: "god-class",
          description: `File "${file}" has ${symbols.length} symbols — consider splitting`,
          files: [file],
          severity: "warning",
        });
      }
    }

    const errorCount = violations.filter((v) => v.severity === "error").length;
    const warningCount = violations.filter(
      (v) => v.severity === "warning"
    ).length;
    const score = Math.max(
      0,
      100 - violations.length * 10 - errorCount * 20
    );
    const summary = `Architecture score: ${score}/100. ${violations.length} violations found (${errorCount} errors, ${warningCount} warnings).`;

    return {
      violations,
      score,
      layersPresent: layerNames,
      layersMissing,
      summary,
    };
  }

  /**
   * 4. Dependency Recommendations — what's missing? what's circular?
   */
  recommendDependencies(): DependencyRecommendation[] {
    const graph = workspaceIntelligence.getGraph();
    if (!graph) return [];

    const recommendations: DependencyRecommendation[] = [];

    // Note: reliably detecting "unused imports" requires AST parsing of each
    // file's body (the dependency graph records that an import statement
    // exists, but not whether the imported symbol is actually referenced
    // later). That is out of scope for graph-only reasoning, so we skip the
    // unused-dependency check here and rely on dead-code detection instead.

    // Find circular dependencies
    const circular = this.detectCircularDependencies();
    for (const cycle of circular) {
      recommendations.push({
        type: "circular-dependency",
        description: `Circular dependency: ${cycle.join(" → ")}`,
        from: cycle[0],
        to: cycle[cycle.length - 1],
        impact: "high",
      });
    }

    // Suggest refactors for files with many dependencies
    for (const [file, deps] of graph.dependencyGraph) {
      if (deps.length > 8) {
        recommendations.push({
          type: "suggested-refactor",
          description: `File "${file}" has ${deps.length} dependencies — consider splitting into smaller modules`,
          from: file,
          impact: "medium",
        });
      }
    }

    return recommendations;
  }

  /**
   * 5. Dead-Code Detection — what symbols are defined but never used?
   */
  detectDeadCode(): DeadCodeReport {
    const graph = workspaceIntelligence.getGraph();
    if (!graph)
      return {
        unusedSymbols: [],
        unusedFiles: [],
        totalDeadCode: 0,
        deadCodePercentage: 0,
      };

    const unusedSymbols: { symbol: string; file: string; kind: string }[] = [];
    const allDefinedSymbols = new Map<string, { file: string; kind: string }>();

    // Collect all defined symbols
    for (const [file, symbols] of graph.symbolGraph) {
      for (const sym of symbols) {
        allDefinedSymbols.set(sym.name, { file, kind: sym.kind });
      }
    }

    // Collect all referenced symbols (from dependencies + file content hints)
    const referencedSymbols = new Set<string>();
    for (const deps of graph.dependencyGraph.values()) {
      for (const dep of deps) {
        // Check if the dependency target matches any symbol name
        for (const defined of allDefinedSymbols.keys()) {
          // Case-insensitive: Prisma `model Contact {}` is referenced by
          // `prisma.contact.findMany()` (lowercase) and by file paths like
          // `app/dashboard/contacts/route.ts` (lowercase plural).
          if (dep.to.toLowerCase().includes(defined.toLowerCase())) {
            referencedSymbols.add(defined);
          }
        }
      }
    }

    // Also check symbol names against all file paths (case-insensitive).
    // A symbol named "Contact" is referenced if any file path mentions
    // "contact" (e.g., app/dashboard/contacts/page.tsx).
    for (const symName of allDefinedSymbols.keys()) {
      const symLower = symName.toLowerCase();
      for (const path of graph.semanticIndex.keys()) {
        if (path.toLowerCase().includes(symLower)) {
          referencedSymbols.add(symName);
        }
      }
    }

    // Find unused symbols (defined but not referenced)
    for (const [symName, info] of allDefinedSymbols) {
      // Don't flag endpoints as dead (they're entry points)
      if (!referencedSymbols.has(symName) && info.kind !== "endpoint") {
        unusedSymbols.push({
          symbol: symName,
          file: info.file,
          kind: info.kind,
        });
      }
    }

    // Find unused files (files with no incoming dependencies)
    const allFiles = new Set(graph.semanticIndex.keys());
    const referencedFiles = new Set<string>();
    for (const deps of graph.dependencyGraph.values()) {
      for (const dep of deps) {
        // Split on both `/` (file paths) and `.` (namespace segments for
        // C#/Kotlin `using`/`import` statements) so we can resolve e.g.
        // `Demoapp.Models` → `Models` → matches `src/Demoapp/Models/Contact.cs`.
        const lastSegment = dep.to.split(/[/.]/).pop() ?? dep.to;
        for (const file of allFiles) {
          if (file.includes(lastSegment)) {
            referencedFiles.add(file);
          }
        }
      }
    }
    // Entry points and project manifest files are always "used" (consumed by
    // the runtime/toolchain rather than by import statements):
    //   - pages/routes: page.tsx, route.ts (Next.js API), app., main., index.,
    //     App., MainActivity
    //   - desktop entry points: MainWindow, App.xaml
    //   - manifests/configs: package.json, tsconfig.json, next.config.js,
    //     tailwind.config.ts, postcss.config.js, .eslintrc.json, .env,
    //     globals.css, README.md, layout.tsx, schema.prisma, *.sln, *.csproj,
    //     *.gradle, *.pubxml (publish profiles)
    const entryPointPatterns = [
      /page\./,
      /route\./,
      /layout\./,
      /app\./,
      /main\./,
      /index\./,
      /App\./,
      /MainActivity/,
      /MainWindow/,
      /package\.json$/,
      /tsconfig\.json$/,
      /next\.config\./,
      /tailwind\.config\./,
      /postcss\.config\./,
      /eslint/,
      /\.env/,
      /globals\.css$/,
      /README\.md$/,
      /schema\.prisma$/,
      /\.(sln|csproj)$/,
      /\.gradle(?:\.kts)?$/,
      /\.pubxml$/,
      /\.xaml$/,
    ];
    const unusedFiles = [...allFiles].filter(
      (f) =>
        !referencedFiles.has(f) && !entryPointPatterns.some((p) => p.test(f))
    );

    const totalSymbols = allDefinedSymbols.size;
    const totalDeadCode = unusedSymbols.length + unusedFiles.length;
    const deadCodePercentage =
      totalSymbols > 0
        ? Math.round((unusedSymbols.length / totalSymbols) * 100)
        : 0;

    return {
      unusedSymbols,
      unusedFiles,
      totalDeadCode,
      deadCodePercentage,
    };
  }

  /**
   * Detect circular dependencies by building a file-to-file adjacency list
   * from the dependency graph (resolving each import to the file it points
   * at) and running a DFS cycle search.
   */
  private detectCircularDependencies(): string[][] {
    const graph = workspaceIntelligence.getGraph();
    if (!graph) return [];

    // Build adjacency list from file dependencies
    const adj = new Map<string, Set<string>>();
    for (const [from, deps] of graph.dependencyGraph) {
      if (!adj.has(from)) adj.set(from, new Set());
      for (const dep of deps) {
        // Find which file this import resolves to. Split on both `/` (file
        // paths) and `.` (namespace segments for C#/Kotlin `using`/`import`
        // statements) so `Demoapp.Models` resolves to `Models` → matches
        // `src/Demoapp/Models/Contact.cs`.
        const lastSegment = dep.to.split(/[/.]/).pop() ?? dep.to;
        for (const targetFile of graph.semanticIndex.keys()) {
          // Skip self-loops — a file importing its own namespace (common in
          // C#: `using MyApp.Models;` from a file inside the Models folder)
          // is NOT a real circular dependency.
          if (targetFile === from) continue;
          if (targetFile.includes(lastSegment)) {
            adj.get(from)!.add(targetFile);
          }
        }
      }
    }

    // DFS to find cycles
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): void => {
      if (recursionStack.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart >= 0) {
          cycles.push([...path.slice(cycleStart), node]);
        }
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      for (const neighbor of adj.get(node) ?? []) {
        dfs(neighbor);
      }

      path.pop();
      recursionStack.delete(node);
    };

    for (const node of adj.keys()) {
      dfs(node);
    }

    return cycles.slice(0, 5); // limit to 5 cycles
  }

  /**
   * Run all 5 capabilities and return a combined report. Useful for the
   * debug endpoint and for the Reviewer agent to ask "give me everything".
   */
  getFullReport(targetKey: string) {
    return {
      targetKey,
      semanticSearchDemo: this.semanticSearch("contact model", 5),
      impactAnalysis: this.analyzeImpact("Contact"),
      architectureValidation: this.validateArchitecture(targetKey),
      dependencyRecommendations: this.recommendDependencies(),
      deadCodeReport: this.detectDeadCode(),
    };
  }
}

// Singleton — agents import `workspaceReasoning` directly.
export const workspaceReasoning = new WorkspaceReasoning();

// Re-export types from workspace-intelligence so consumers can import
// `Symbol` and `Dependency` from either module.
export type { Symbol, Dependency };
