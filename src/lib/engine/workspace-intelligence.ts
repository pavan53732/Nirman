// WorkspaceIntelligence — indexes generated files into 4 graphs so agents
// can query the workspace without reading every file.
//
// REVIEWER ASKED FOR:
//   "Workspace intelligence: Build a semantic index, symbol graph, dependency
//    graph, and architecture graph so agents don't need to inspect the whole
//    project."
//
// This module builds four graphs from a set of generated virtual files:
//
//   1. Semantic Index  — file path → { language, framework, purpose, ... }
//                        "What is this file?"
//
//   2. Symbol Graph    — file path → symbols[] (functions, classes, models,
//                        endpoints). "What's defined in this file?"
//
//   3. Dependency Graph — file path → imports[]/depends-on[]
//                        "What does this file need?"
//
//   4. Architecture Graph — target → layers[] → files[]
//                        "How is the project structured?"
//
// Agents query these graphs instead of reading every file. For example, a
// reviewer agent asks: "give me all files that import the Contact model" →
// the dependency graph answers in O(files) instead of grepping 50 files.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileSemanticInfo {
  path: string;
  language:
    | "typescript"
    | "csharp"
    | "kotlin"
    | "xml"
    | "json"
    | "markdown"
    | "yaml"
    | "gradle"
    | "unknown";
  framework: string; // "nextjs" | "winui" | "compose" | "prisma" | "efcore" | etc.
  purpose: string; // "model" | "view" | "viewmodel" | "api-route" | "config" | "schema" | etc.
  targetKey: string; // "web" | "windows" | "android"
  lineCount: number;
  byteSize: number;
}

export interface Symbol {
  name: string;
  kind:
    | "function"
    | "class"
    | "interface"
    | "model"
    | "endpoint"
    | "route"
    | "view"
    | "config";
  file: string;
  line?: number;
  exported: boolean;
}

export interface Dependency {
  from: string; // file path
  to: string; // imported path or symbol
  kind: "import" | "reference" | "model-usage" | "route-handler";
}

export interface ArchitectureLayer {
  name: string; // "Models" | "Views" | "ViewModels" | "API" | "Data" | "Config"
  files: string[];
  targetKey: string;
}

export interface WorkspaceGraph {
  semanticIndex: Map<string, FileSemanticInfo>;
  symbolGraph: Map<string, Symbol[]>;
  dependencyGraph: Map<string, Dependency[]>;
  architecture: Map<string, ArchitectureLayer[]>;
  fileCount: number;
  totalSymbols: number;
  totalDependencies: number;
  indexedAt: number;
}

// ---------------------------------------------------------------------------
// WorkspaceIntelligence
// ---------------------------------------------------------------------------

export class WorkspaceIntelligence {
  private graph: WorkspaceGraph | null = null;

  /**
   * Index a set of files into the 4 graphs.
   *
   * Side-effect: stores the resulting graph in `this.graph` so subsequent
   * query* calls can answer in O(1)/O(files) without re-indexing.
   */
  index(
    files: { path: string; content: string }[],
    targetKey: string
  ): WorkspaceGraph {
    const semanticIndex = new Map<string, FileSemanticInfo>();
    const symbolGraph = new Map<string, Symbol[]>();
    const dependencyGraph = new Map<string, Dependency[]>();

    for (const file of files) {
      const info = this.analyzeSemantic(file, targetKey);
      semanticIndex.set(file.path, info);

      const symbols = this.extractSymbols(file);
      symbolGraph.set(file.path, symbols);

      const deps = this.extractDependencies(file);
      dependencyGraph.set(file.path, deps);
    }

    const architecture = new Map<string, ArchitectureLayer[]>();
    const layers = this.buildLayers(semanticIndex, symbolGraph, targetKey);
    architecture.set(targetKey, layers);

    this.graph = {
      semanticIndex,
      symbolGraph,
      dependencyGraph,
      architecture,
      fileCount: files.length,
      totalSymbols: [...symbolGraph.values()].reduce((n, s) => n + s.length, 0),
      totalDependencies: [...dependencyGraph.values()].reduce(
        (n, d) => n + d.length,
        0
      ),
      indexedAt: Date.now(),
    };
    return this.graph;
  }

  // -------------------------------------------------------------------------
  // Semantic analysis
  // -------------------------------------------------------------------------

  private analyzeSemantic(
    file: { path: string; content: string },
    targetKey: string
  ): FileSemanticInfo {
    const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
    const language: FileSemanticInfo["language"] =
      ext === "ts" || ext === "tsx"
        ? "typescript"
        : ext === "cs"
        ? "csharp"
        : ext === "kt"
        ? "kotlin"
        : ext === "xml" || ext === "xaml"
        ? "xml"
        : ext === "json"
        ? "json"
        : ext === "md"
        ? "markdown"
        : ext === "yml" || ext === "yaml"
        ? "yaml"
        : ext === "gradle" || ext === "kts"
        ? "gradle"
        : "unknown";

    const framework = this.detectFramework(file.path, targetKey);
    const purpose = this.detectPurpose(file.path, language);
    const lineCount = file.content.split("\n").length;

    return {
      path: file.path,
      language,
      framework,
      purpose,
      targetKey,
      lineCount,
      byteSize: file.content.length,
    };
  }

  private detectFramework(path: string, targetKey: string): string {
    if (targetKey === "web") {
      if (path.includes("prisma/")) return "prisma";
      if (path.includes("app/api/")) return "nextjs-api";
      if (path.includes("app/")) return "nextjs";
      if (path.includes("tailwind")) return "tailwind";
      return "nextjs";
    }
    if (targetKey === "windows") {
      if (path.endsWith(".sln")) return "visualstudio";
      if (path.endsWith(".csproj")) return "dotnet";
      if (path.endsWith(".xaml")) return "winui";
      if (path.endsWith(".cs"))
        return path.includes("ViewModel")
          ? "mvvm"
          : path.includes("Data")
          ? "efcore"
          : "dotnet";
      return "dotnet";
    }
    if (targetKey === "android") {
      if (path.endsWith(".kt")) {
        if (path.includes("ui/")) return "compose";
        if (path.includes("data/")) return "room";
        if (path.includes("di/")) return "hilt";
        return "kotlin";
      }
      if (path.endsWith(".gradle.kts")) return "gradle";
      return "android";
    }
    return "unknown";
  }

  private detectPurpose(path: string, language: string): string {
    const base = path.split("/").pop() ?? path;
    if (base.includes("ViewModel")) return "viewmodel";
    if (base.includes("Model") || path.includes("/Models/")) return "model";
    if (
      base.includes("View") ||
      path.includes("/Views/") ||
      path.endsWith(".xaml")
    )
      return "view";
    if (path.includes("/api/")) return "api-route";
    if (path.includes("/Data/") || path.includes("DbContext")) return "data";
    if (path.includes("/di/")) return "di-config";
    if (base === "schema.prisma") return "schema";
    if (base.endsWith(".sln") || base.endsWith(".csproj")) return "project-config";
    if (base === "package.json" || base === "tsconfig.json") return "config";
    if (base === "README.md") return "docs";
    if (language === "kotlin" && path.includes("Screen")) return "screen";
    if (language === "kotlin" && path.includes("Dao")) return "dao";
    if (language === "kotlin" && path.includes("Repository")) return "repository";
    return "source";
  }

  // -------------------------------------------------------------------------
  // Symbol extraction
  // -------------------------------------------------------------------------

  private extractSymbols(file: {
    path: string;
    content: string;
  }): Symbol[] {
    const symbols: Symbol[] = [];
    const lines = file.content.split("\n");

    // TypeScript: export function, export const, export class, export interface, model
    lines.forEach((line, i) => {
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/))) {
        symbols.push({
          name: m[1],
          kind: "function",
          file: file.path,
          line: i + 1,
          exported: true,
        });
      } else if ((m = line.match(/^export\s+default\s+function\s+(\w+)/))) {
        symbols.push({
          name: m[1],
          kind: "function",
          file: file.path,
          line: i + 1,
          exported: true,
        });
      } else if ((m = line.match(/^export\s+class\s+(\w+)/))) {
        symbols.push({
          name: m[1],
          kind: "class",
          file: file.path,
          line: i + 1,
          exported: true,
        });
      } else if ((m = line.match(/^export\s+interface\s+(\w+)/))) {
        symbols.push({
          name: m[1],
          kind: "interface",
          file: file.path,
          line: i + 1,
          exported: true,
        });
      } else if ((m = line.match(/^export\s+const\s+(\w+)/))) {
        symbols.push({
          name: m[1],
          kind: "function",
          file: file.path,
          line: i + 1,
          exported: true,
        });
      } else if ((m = line.match(/^model\s+(\w+)\s*\{/))) {
        symbols.push({
          name: m[1],
          kind: "model",
          file: file.path,
          line: i + 1,
          exported: true,
        });
      }
    });

    // C#: public class, public partial class
    lines.forEach((line, i) => {
      const m = line.match(/public\s+(?:partial\s+)?class\s+(\w+)/);
      if (m)
        symbols.push({
          name: m[1],
          kind: "class",
          file: file.path,
          line: i + 1,
          exported: true,
        });
    });

    // Kotlin: fun, class, object, data class
    lines.forEach((line, i) => {
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^(?:public\s+)?(?:data\s+)?class\s+(\w+)/))) {
        symbols.push({
          name: m[1],
          kind: "class",
          file: file.path,
          line: i + 1,
          exported: true,
        });
      } else if ((m = line.match(/^(?:public\s+)?fun\s+(\w+)/))) {
        symbols.push({
          name: m[1],
          kind: "function",
          file: file.path,
          line: i + 1,
          exported: true,
        });
      } else if ((m = line.match(/^(?:public\s+)?object\s+(\w+)/))) {
        symbols.push({
          name: m[1],
          kind: "class",
          file: file.path,
          line: i + 1,
          exported: true,
        });
      }
    });

    // API endpoints: @GET, @POST, export async function GET/POST
    lines.forEach((line, i) => {
      if (/@(?:GET|POST|PUT|DELETE|PATCH)\s*\(/.test(line)) {
        const m = line.match(/@(GET|POST|PUT|DELETE|PATCH)\(\s*"([^"]*)"/);
        if (m)
          symbols.push({
            name: `${m[1]} ${m[2]}`,
            kind: "endpoint",
            file: file.path,
            line: i + 1,
            exported: true,
          });
      }
      if (/export\s+async\s+function\s+(?:GET|POST|PUT|DELETE|PATCH)/.test(line)) {
        const m = line.match(
          /export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)/
        );
        if (m)
          symbols.push({
            name: m[1],
            kind: "endpoint",
            file: file.path,
            line: i + 1,
            exported: true,
          });
      }
    });

    return symbols;
  }

  // -------------------------------------------------------------------------
  // Dependency extraction
  // -------------------------------------------------------------------------

  private extractDependencies(file: {
    path: string;
    content: string;
  }): Dependency[] {
    const deps: Dependency[] = [];
    const lines = file.content.split("\n");

    lines.forEach((line) => {
      let m: RegExpMatchArray | null;
      // TS imports
      if ((m = line.match(/import\s+.*from\s+["']([^"']+)["']/))) {
        deps.push({ from: file.path, to: m[1], kind: "import" });
      }
      // C# using
      else if ((m = line.match(/^using\s+([\w.]+);/))) {
        deps.push({ from: file.path, to: m[1], kind: "import" });
      }
      // Kotlin import
      else if ((m = line.match(/^import\s+([\w.]+)/))) {
        deps.push({ from: file.path, to: m[1], kind: "import" });
      }
      // Prisma model reference: field Type (e.g., "contact Contact")
      else if (
        file.path.endsWith(".prisma") &&
        (m = line.match(/^\s*\w+\s+(\w+)\s*$/))
      ) {
        if (m[1] && m[1][0] === m[1][0].toUpperCase()) {
          deps.push({ from: file.path, to: m[1], kind: "model-usage" });
        }
      }
    });

    return deps;
  }

  // -------------------------------------------------------------------------
  // Architecture layering
  // -------------------------------------------------------------------------

  private buildLayers(
    semantic: Map<string, FileSemanticInfo>,
    symbolGraph: Map<string, Symbol[]>,
    targetKey: string
  ): ArchitectureLayer[] {
    const byPurpose = new Map<string, string[]>();
    for (const info of semantic.values()) {
      const arr = byPurpose.get(info.purpose) ?? [];
      arr.push(info.path);
      byPurpose.set(info.purpose, arr);
    }

    const layerNames: Record<string, string> = {
      model: "Models",
      view: "Views",
      viewmodel: "ViewModels",
      screen: "Screens",
      "api-route": "API Routes",
      data: "Data Layer",
      dao: "Data Access",
      repository: "Repositories",
      schema: "Database Schema",
      "di-config": "Dependency Injection",
      config: "Configuration",
      "project-config": "Project Files",
      docs: "Documentation",
      source: "Source",
    };

    const layers: ArchitectureLayer[] = [...byPurpose.entries()].map(
      ([purpose, files]) => ({
        name: layerNames[purpose] ?? purpose,
        files: [...files].sort(),
        targetKey,
      })
    );

    // Enhancement: also surface a "Models" layer for files that DEFINE model
    // symbols (e.g. Prisma `model Contact {}` in schema.prisma) but aren't
    // already classified as purpose="model". Without this, web targets —
    // whose models live inside prisma/schema.prisma (purpose="schema") —
    // would never show a "Models" layer in the architecture graph.
    const existingModels = layers.find((l) => l.name === "Models");
    const extraModelFiles: string[] = [];
    for (const [filePath, syms] of symbolGraph.entries()) {
      if (syms.some((s) => s.kind === "model")) {
        if (!existingModels?.files.includes(filePath)) {
          extraModelFiles.push(filePath);
        }
      }
    }
    if (extraModelFiles.length > 0) {
      if (existingModels) {
        existingModels.files = [...existingModels.files, ...extraModelFiles].sort();
      } else {
        layers.push({
          name: "Models",
          files: [...extraModelFiles].sort(),
          targetKey,
        });
      }
    }

    return layers;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getGraph(): WorkspaceGraph | null {
    return this.graph;
  }

  /**
   * Query: which files import/depend on a given symbol or path?
   * Substring match on the dependency `to` field makes this resilient to
   * bare-symbol queries (e.g. "Contact") and full-path queries alike.
   */
  queryDependents(symbolOrPath: string): string[] {
    if (!this.graph) return [];
    const result: string[] = [];
    for (const [from, deps] of this.graph.dependencyGraph.entries()) {
      if (deps.some((d) => d.to.includes(symbolOrPath) || d.to === symbolOrPath)) {
        result.push(from);
      }
    }
    return result;
  }

  /** Query: what symbols are defined in a given file? */
  querySymbols(filePath: string): Symbol[] {
    return this.graph?.symbolGraph.get(filePath) ?? [];
  }

  /** Query: get all symbols of a given kind across all files. */
  querySymbolsByKind(kind: Symbol["kind"]): Symbol[] {
    if (!this.graph) return [];
    const result: Symbol[] = [];
    for (const syms of this.graph.symbolGraph.values()) {
      result.push(...syms.filter((s) => s.kind === kind));
    }
    return result;
  }

  getSummary() {
    if (!this.graph) return { indexed: false };
    return {
      indexed: true,
      fileCount: this.graph.fileCount,
      totalSymbols: this.graph.totalSymbols,
      totalDependencies: this.graph.totalDependencies,
      targets: [...this.graph.architecture.keys()],
      layers: [...this.graph.architecture.values()]
        .flat()
        .map((l) => ({
          target: l.targetKey,
          layer: l.name,
          fileCount: l.files.length,
        })),
      indexedAt: this.graph.indexedAt,
    };
  }

  clear(): void {
    this.graph = null;
  }
}

// Singleton — agents import `workspaceIntelligence` directly.
export const workspaceIntelligence = new WorkspaceIntelligence();
