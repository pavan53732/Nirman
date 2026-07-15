// Workflow Engine — reusable workflows + prompt analysis + task graph build.
//
// In the V2 architecture the Workflow Engine owns the BUSINESS LOGIC that
// decides what to build and how to decompose it:
//   - analyzePrompt()     : capability detection, ambiguity detection,
//                           target detection, decision collection,
//                           database memory read. Side-effect free — returns
//                           the analysis as a value, the orchestrator persists
//                           it to memory + shared context.
//   - buildTaskGraph()    : compile the workflow DAG into tasks, augment it
//                           with one parallel generation task per detected
//                           target, and extend the compilation gate's
//                           dependencies so the gate waits for every
//                           per-target generation task.
//
// The orchestrator is now THIN: it accepts the request, asks the workflow
// engine to analyze + build, persists results to memory + shared context,
// materializes generated files to the workspace, annotates gate tasks with
// the workspace paths, and submits the task list to the execution engine.
//
// Wave 2A — moved out of the orchestrator (originally ~150 lines of inline
// capability/target detection + task compilation). The orchestrator's
// `startBuild()` shrunk from ~374 lines to ~180.

import type {
  Workflow,
  WorkflowId,
  Task,
  StageId,
  GateId,
  AgentRole,
  Capability,
  PlatformKind,
  DecisionRecord,
} from "./types";
import { workflows } from "./data/workflows";
import { makeTask } from "./execution-engine";
import {
  decisionEngine,
  detectCapabilities,
  detectNonFunctionals,
  type DetectedTargets,
} from "./decision-engine";
import {
  askQuestionIfNeeded,
  detectAmbiguity,
  AMBIGUITY_THRESHOLD,
} from "./skills/ambiguity-detector";
import { projectMemory } from "./memories";
import type { DatabaseChoice } from "./generators";

/**
 * The result of analyzing a prompt — produced by `WorkflowEngine.analyzePrompt`.
 *
 * This is a VALUE: it carries everything the orchestrator needs to (a) write
 * the initial memory + shared context, (b) build a task graph, and (c) drive
 * the generation loop. No memory/shared-context side effects are performed
 * inside `analyzePrompt()` — the orchestrator persists these.
 */
export interface PromptAnalysis {
  capabilities: Capability[];
  targets: DetectedTargets[];
  decisions: DecisionRecord[];
  /** Ambiguity score 0..1 from the autonomy gate. */
  ambiguityScore: number;
  /** Question to ask the user if ambiguity > threshold (null = proceed). */
  pendingQuestion: string | null;
  /** Database choice read from Architecture Memory (PostgreSQL | SQLite). */
  database: DatabaseChoice;
}

export class WorkflowEngine {
  private workflows = new Map<WorkflowId, Workflow>();

  constructor(all: Workflow[] = workflows) {
    for (const w of all) this.workflows.set(w.id, w);
  }

  /** Select a workflow from the user's natural-language intent. */
  select(prompt: string): Workflow {
    const p = prompt.toLowerCase();
    let best: Workflow | undefined;
    let bestScore = 0;
    for (const w of this.workflows.values()) {
      let score = 0;
      for (const sig of w.signals) {
        if (p.includes(sig)) score += sig.length;
      }
      if (score > bestScore) {
        bestScore = score;
        best = w;
      }
    }
    // default to new-project
    return best ?? this.workflows.get("new-project")!;
  }

  get(id: WorkflowId): Workflow | undefined {
    return this.workflows.get(id);
  }

  all(): Workflow[] {
    return [...this.workflows.values()];
  }

  /**
   * Compile a workflow into a DAG of tasks. Stages become task groups with
   * dependency edges between consecutive stages; gates become gate tasks that
   * must pass before the next stage's tasks become ready.
   */
  compile(
    workflow: Workflow,
    stageIds: StageId[]
  ): Task[] {
    const tasks: Task[] = [];
    let prevStageTaskIds: string[] = [];

    for (const stage of workflow.stages) {
      const stageId = stage.id as StageId;
      const stageTask = makeTask({
        workflowId: workflow.id,
        stageId,
        title: stage.label,
        description: stage.description,
        agent: stage.agents[0] ?? ("orchestrator" as AgentRole),
        dependsOn: [...prevStageTaskIds], // copy to avoid shared-reference bug
      });
      tasks.push(stageTask);
      const stageTaskIds = [stageTask.id];

      // Gate tasks (must pass before next stage)
      for (const gate of stage.gates ?? []) {
        const gateTask = makeTask({
          workflowId: workflow.id,
          stageId,
          title: `Gate: ${gate}`,
          description: `Evaluate ${gate} gate`,
          agent: "orchestrator" as AgentRole,
          dependsOn: [...stageTaskIds], // copy — NOT the same array reference
          gate: gate as GateId,
        });
        tasks.push(gateTask);
        stageTaskIds.push(gateTask.id);
      }

      prevStageTaskIds = stageTaskIds;
      void stageIds;
    }

    return tasks;
  }

  /**
   * Analyze a prompt and produce the initial task-graph inputs.
   *
   * This MOVES the capability/ambiguity/target detection that previously lived
   * inline in `Orchestrator.startBuild()` into the WorkflowEngine. It is
   * SIDE-EFFECT FREE: it returns a `PromptAnalysis` value but does NOT write
   * to Project Memory, SharedContext, or the Observability log. The
   * orchestrator is responsible for persisting the analysis (so it remains
   * the single coordinator of memory + shared context state).
   *
   * Reads:
   *   - Architecture Memory (for the database choice — generators branch on it)
   *
   * Computes:
   *   - capabilities (Capability Detection)
   *   - ambiguity score + pending question (Autonomy Gate)
   *   - targets (multi-target detection — see `detectTargets`)
   *   - decisions (collected from each target's `policies`)
   */
  analyzePrompt(prompt: string): PromptAnalysis {
    // Capability Detection (runs first)
    const capabilities = detectCapabilities(prompt);

    // Autonomy gate: Ambiguity Detection. If the requirement is too ambiguous
    // (score > AMBIGUITY_THRESHOLD), the engine asks the user a clarifying
    // question before proceeding. We compute the score + question here; the
    // orchestrator decides whether to pause (cancelAll + write to memory).
    const ambiguity = detectAmbiguity(prompt);
    const pendingQuestion = askQuestionIfNeeded(prompt);

    // Detect multi-targets + decisions
    const targets = detectTargets(prompt);
    const decisions = targets.flatMap((t) => t.policies);

    // Read Architecture Memory: database choice drives generator output.
    // (PostgreSQL vs SQLite — Prisma provider, EF Core provider, Android
    // persistence note all branch on this.)
    const database = readDatabaseFromMemory();

    return {
      capabilities,
      targets,
      decisions,
      ambiguityScore: ambiguity.score,
      pendingQuestion,
      database,
    };
  }

  /**
   * Build the task list for a workflow + prompt analysis.
   *
   * This MOVES the task-graph construction that previously lived inline in
   * `Orchestrator.startBuild()` into the WorkflowEngine:
   *   1. Compile the workflow stages into the base DAG (this.compile).
   *   2. Find the generate stage task + its architecture predecessors.
   *   3. Create one parallel generation task per detected target. These
   *      tasks share the architecture predecessors so the ExecutionEngine
   *      dispatches them in the SAME parallelBatch (maxParallel=4).
   *   4. Insert the per-target tasks right after the generate stage task.
   *   5. Extend the generate stage's compilation gate to depend on every
   *      per-target task — otherwise the gate would fire as soon as the
   *      generate stage task completes, racing the parallel tasks.
   *
   * Per-target compilation gate tasks for desktop/android (lines 479-502 in
   * the original orchestrator) are NOT created here because they depend on
   * the workspace materialization results (computed later in the orchestrator
   * after the generation loop). The orchestrator adds them after the workspace
   * is materialized.
   *
   * @param workflow  The selected workflow (from `select()`).
   * @param analysis  The prompt analysis (from `analyzePrompt()`).
   * @param prompt    The original user prompt (used to derive the project name
   *                  via `promptToName` for the per-target task descriptions).
   */
  buildTaskGraph(
    workflow: Workflow,
    analysis: PromptAnalysis,
    prompt: string
  ): Task[] {
    const { targets, database } = analysis;

    // Compile the base DAG from the workflow stages.
    const tasks = this.compile(
      workflow,
      workflow.stages.map((s) => s.id as StageId)
    );

    // ---- Find the generate stage task + architecture predecessors --------
    // The per-target generation tasks share the generate stage task's
    // `dependsOn` (the architect stage task + architect gate) so they become
    // ready in the SAME scheduler tick → same parallelBatch.
    const generateStageTask = tasks.find(
      (t) => t.stageId === "generate" && !t.gate
    );
    let archDeps: string[] = generateStageTask?.dependsOn ?? [];
    if (archDeps.length === 0) {
      // Fallback for workflows without an explicit generate stage task:
      // depend on the architect gate (or architect stage task) directly.
      const archGate = tasks.find(
        (t) => t.stageId === "architect" && t.gate === "architecture"
      );
      const archStage = tasks.find(
        (t) => t.stageId === "architect" && !t.gate
      );
      archDeps = archGate?.id ? [archGate.id] : archStage?.id ? [archStage.id] : [];
    }

    // Map each platform kind to its specialist generator agent.
    const targetAgent: Partial<Record<PlatformKind, AgentRole>> = {
      windows: "desktop-generator",
      android: "android-generator",
      web: "frontend-generator",
      api: "backend-generator",
      cli: "backend-generator",
      library: "backend-generator",
    };

    // ---- Create one parallel generation task per detected target ---------
    // Each task carries the target spec in its description (JSON-encoded) so
    // the AgentRuntime handler can read it and call generateForTarget with
    // the right arguments.
    const perTargetGenTasks: Task[] = targets.map((t, i) => {
      const targetId = `t${i + 1}`;
      const name = promptToName(prompt) || `App${i + 1}`;
      return makeTask({
        workflowId: workflow.id,
        stageId: "generate",
        title: `Generating (${t.label})`,
        description: JSON.stringify({
          kind: t.kind,
          stack: t.stack,
          name,
          targetId,
          label: t.label,
          role: t.role,
          capabilities: t.capabilities,
          database,
        }),
        agent: targetAgent[t.kind] ?? "frontend-generator",
        dependsOn: [...archDeps], // copy — same as generate stage task → parallel
      });
    });

    // Insert the per-target tasks right after the generate stage task so the
    // trace's scheduledAt ordering is stable + readable. If no generate stage
    // task exists, append them at the end.
    if (generateStageTask) {
      const idx = tasks.indexOf(generateStageTask);
      tasks.splice(idx + 1, 0, ...perTargetGenTasks);
    } else {
      tasks.push(...perTargetGenTasks);
    }

    // ---- Extend the generate stage's compilation gate --------------------
    // Otherwise the gate would fire as soon as the (no-op) generate stage
    // task completes, racing the parallel tasks. Now the gate waits for ALL
    // parallel generation tasks to finish.
    for (const t of tasks) {
      if (t.stageId === "generate" && t.gate === "compilation") {
        for (const pt of perTargetGenTasks) {
          if (!t.dependsOn.includes(pt.id)) t.dependsOn.push(pt.id);
        }
      }
    }

    return tasks;
  }
}

export const workflowEngine = new WorkflowEngine();

/* ------------------------------------------------------------------ */
/* MOVED FROM orchestrator.ts (Wave 2A)                                */
/* ------------------------------------------------------------------ */
/* The three helpers below were previously private to orchestrator.ts. */
/* They are now defined here so the WorkflowEngine can call them       */
/* inside analyzePrompt() / buildTaskGraph() without an import cycle.  */
/* The orchestrator re-exports detectTargets + readDatabaseFromMemory  */
/* for backward compatibility (other modules import them from          */
/* "./orchestrator" — see failure-tests.ts, perf-harness.ts, index.ts). */
/* ------------------------------------------------------------------ */

/**
 * Detect generation targets (multi-target) from a prompt.
 *
 * Moved from orchestrator.ts in Wave 2A — the workflow engine now owns this
 * analysis. The orchestrator re-exports it from "./orchestrator" for
 * backward compatibility (failure-tests.ts, perf-harness.ts, and index.ts
 * import it from there).
 */
export function detectTargets(prompt: string): DetectedTargets[] {
  const caps = detectCapabilities(prompt);
  const nfs = detectNonFunctionals(prompt);
  const p = " " + prompt.toLowerCase() + " ";
  const out: DetectedTargets[] = [];
  const wants = (re: RegExp) => re.test(p);

  // Domain inference: if the prompt mentions CAD/3D/GPU/game but no explicit
  // platform keyword, infer windows/native (not the default web). This prevents
  // "Build CAD software" from falling through to a generic Next.js app.
  const isCAD = /\b(cad|autocad|3d modeling|opengl|directx|vulkan|rendering)\b/.test(p);
  const isGame = /\b(game|unity|godot|2d platformer|3d game)\b/.test(p);
  const domainInferredWindows = isCAD && !wants(/\b(web|android|cli|api)\b/);
  const domainInferredGame = isGame && !wants(/\b(web|windows|android|cli|api)\b/);

  const multi =
    [
      wants(/\b(windows|desktop|winui|wpf|winforms|win32)\b/) || domainInferredWindows,
      wants(/\b(android|mobile( app)?|kotlin|flutter|companion app|phone app)\b/),
      wants(/\b(web( site| app| admin| portal)?|website|landing|marketing site|saas|portal)\b/),
      wants(/\b(api|rest|backend service|microservice)\b/),
      wants(/\b(cli|command.line|terminal tool)\b/),
    ].filter(Boolean).length > 1;

  if (wants(/\b(windows|desktop|winui|wpf|winforms|win32|\.net\s*(desktop|app))\b/) || domainInferredWindows) {
    const kind = "windows" as PlatformKind;
    const { stack, decision } = decisionEngine.pickStack(kind, prompt, caps, nfs);
    out.push({ kind, label: multi ? "Desktop App" : "App", role: multi ? "Primary desktop workspace" : "Windows desktop application", stack, capabilities: caps, policies: [decision] });
  }
  if (wants(/\b(android|mobile( app)?|kotlin|flutter|companion app|phone app)\b/)) {
    const kind = "android" as PlatformKind;
    const { stack, decision } = decisionEngine.pickStack(kind, prompt, caps, nfs);
    out.push({ kind, label: multi ? "Android Companion" : "App", role: multi ? "Mobile companion app" : "Android application", stack, capabilities: caps, policies: [decision] });
  }
  if (wants(/\b(web( site| app| admin| portal)?|website|landing|marketing site|saas|portal|browser)\b/)) {
    const kind = "web" as PlatformKind;
    const { stack, decision } = decisionEngine.pickStack(kind, prompt, caps, nfs);
    out.push({ kind, label: multi ? "Web Portal" : "App", role: multi ? "Web admin portal" : "Web application", stack, capabilities: caps, policies: [decision] });
  }
  if (wants(/\b(api|rest( api)?|graphql|backend service|microservice)\b/)) {
    const kind = "api" as PlatformKind;
    const { stack, decision } = decisionEngine.pickStack(kind, prompt, caps, nfs);
    out.push({ kind, label: "API Service", role: "Backend API and data layer", stack, capabilities: caps, policies: [decision] });
  }
  if (wants(/\b(cli|command.line|terminal tool|brew install|cargo install)\b/)) {
    const kind = "cli" as PlatformKind;
    const { stack, decision } = decisionEngine.pickStack(kind, prompt, caps, nfs);
    out.push({ kind, label: "CLI Tool", role: "Command-line utility", stack, capabilities: caps, policies: [decision] });
  }
  if (wants(/\b(ai agent|autonomous agent|assistant service|chatbot|support agent)\b/)) {
    out.push({ kind: "api" as PlatformKind, label: "AI Agent", role: "Autonomous agent service", stack: "Python + LangGraph", capabilities: caps, policies: [decisionEngine.pickStack("api", prompt, caps, nfs).decision] });
  }
  if (wants(/\b(library|sdk|npm package|crate)\b/)) {
    out.push({ kind: "library" as PlatformKind, label: "Library", role: "Reusable library / SDK", stack: /\b(rust|crate)\b/.test(p) ? "Rust crate" : "TypeScript library", capabilities: caps, policies: [] });
  }
  if (domainInferredGame) {
    out.push({ kind: "library" as PlatformKind, label: "Game", role: "Interactive game", stack: "Godot + GDScript", capabilities: caps, policies: [] });
  }
  if (out.length === 0) {
    const kind = "web" as PlatformKind;
    const { stack, decision } = decisionEngine.pickStack(kind, prompt, caps, nfs);
    out.push({ kind, label: "Web App", role: "Web application", stack, capabilities: caps, policies: [decision] });
  }
  return out;
}

/**
 * Read the configured database choice from Architecture Memory.
 *
 * Moved from orchestrator.ts in Wave 2A — the workflow engine's analyzePrompt
 * calls this to populate `analysis.database`. The orchestrator re-exports it
 * from "./orchestrator" for backward compatibility (failure-tests.ts and
 * index.ts import it from there).
 *
 * Generators branch on the database selected for the project (e.g. SQLite for
 * offline-first vs PostgreSQL for client/server). Architecture Memory is the
 * source of truth — when an LLM agent (or the user) writes "Database:
 * PostgreSQL" there, every subsequent generator run emits the PostgreSQL
 * flavor of the Prisma schema / EF Core provider / Android note.
 *
 * Order matters: PostgreSQL is checked first so a record that says "Database:
 * PostgreSQL" wins even if older records mentioned SQLite. Defaults to
 * "sqlite" when memory is empty or no database record exists.
 */
export function readDatabaseFromMemory(): DatabaseChoice {
  const records = projectMemory.read("architecture");
  // Scan newest-first so the latest database decision wins.
  for (const r of [...records].sort((a, b) => b.createdAt - a.createdAt)) {
    const content = r.content.toLowerCase();
    if (/database\s*[:=]?\s*postgres/.test(content) || /\bpostgresql\b/.test(content)) {
      return "postgresql";
    }
    if (/database\s*[:=]?\s*sqlite/.test(content) || /\bsqlite\b/.test(content)) {
      return "sqlite";
    }
  }
  return "sqlite"; // default — matches the existing offline-first behavior
}

/**
 * Derive a clean project name from the prompt.
 *
 * Moved from orchestrator.ts in Wave 2A — the workflow engine's buildTaskGraph
 * calls this to populate the per-target generation task description, and the
 * orchestrator's generation loop calls it to name the generated project. The
 * `perf-harness.ts` module has its own private copy of this logic that is
 * intentionally not shared (it lives in a separate ownership domain).
 */
export function promptToName(prompt: string): string {
  let trimmed = prompt.trim().toLowerCase();
  let prev = "";
  while (prev !== trimmed) {
    prev = trimmed;
    trimmed = trimmed.replace(
      /^(build|build me|create|make|generate|develop|i want|i need|please|a|an|the|me|some)\s+/i,
      ""
    );
  }
  const stopwords = new Set([
    "in", "that", "with", "for", "to", "and", "of", "on", "using", "via",
    "which", "from", "into", "where", "when", "app", "application", "as",
    "companion", "portal", "admin", "me",
  ]);
  const acronyms = new Set(["cli", "ai", "api", "sdk", "saas", "ui", "ux", "ios", "ml", "crm", "cms", "erp", "hrm"]);
  const words: string[] = [];
  for (const w of trimmed.split(/\s+/).filter(Boolean)) {
    if (stopwords.has(w)) break;
    words.push(w);
    if (words.length >= 3) break;
  }
  if (words.length === 0) return "App";
  return words
    .map((w) => (acronyms.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim();
}

// Re-export the threshold so callers that previously imported it from
// "./orchestrator" (none in the engine today, but the public surface in
// index.ts re-exports it) can still reach it via the workflow engine.
export { AMBIGUITY_THRESHOLD };
