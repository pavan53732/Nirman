// Orchestrator — the conductor. Wires the 5 executive agents and all
// subsystems: registries, provider abstraction, execution engine, workflow
// engine, memories, artifact registry, decision engine, self-healing,
// checkpoints, and observability.
//
// The 5 Executive agents (always active):
//   - Orchestrator Agent       -> this class (drives the pipeline)
//   - Project Manager Agent    -> tracks project state & milestones
//   - Planner Agent            -> decomposes requirements into a plan
//   - Decision Engine Agent    -> applies policies, logs decisions
//   - Context Builder Agent    -> minimal prompt packs per agent

import type {
  Workflow,
  WorkflowId,
  Task,
  EngineEvent,
  StageId,
  DecisionRecord,
  Capability,
  PlatformKind,
  AgentRole,
  GateId,
} from "./types";
import { executionEngine, checkpointManager, makeTask } from "./execution-engine";
import { workflowEngine } from "./workflow-engine";
import { projectMemory, contextBuilder } from "./memories";
import { artifactRegistry } from "./artifact-registry";
import { decisionEngine, detectCapabilities, detectNonFunctionals, type DetectedTargets } from "./decision-engine";
import { observability } from "./observability";
import { selfHealController } from "./self-healing";
import { registries } from "./registries";
import { tokenBudgetManager } from "./provider-abstraction";
import { generateForTarget, type DatabaseChoice } from "./generators";
import { askQuestionIfNeeded, detectAmbiguity, AMBIGUITY_THRESHOLD } from "./skills/ambiguity-detector";
import { agentRuntime, initAgentRuntime } from "./agent-runtime";

// Debounced trace sync — POSTs the client-side executionEngine trace + agent
// activations to the server so /api/build/trace and /api/agents/trace return
// real data after a client-side build. The orchestrator runs in the browser
// (Zustand store), so without this sync the server-side trace endpoints would
// always return empty.
let syncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleTraceSync(): void {
  if (typeof window === "undefined") return; // SSR guard
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    try {
      const trace = executionEngine.getTrace();
      await fetch("/api/build/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trace }),
      });
    } catch { /* best-effort */ }
    try {
      const activations = agentRuntime.getActivations();
      const summary = agentRuntime.getSummary();
      await fetch("/api/agents/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, activations }),
      });
    } catch { /* best-effort */ }
  }, 250);
}

export interface OrchestrationResult {
  workflow: Workflow;
  targets: DetectedTargets[];
  decisions: DecisionRecord[];
  capabilities: Capability[];
  generatedFiles: number;
  /** Ambiguity score 0..1 from the autonomy gate. */
  ambiguityScore: number;
  /** Question to ask the user if ambiguity > threshold (null = proceed). */
  pendingQuestion: string | null;
}

/** Detect generation targets (multi-target) from a prompt. */
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

export class Orchestrator {
  /** Bootstrap: register all data into registries and wire the event bus. */
  bootstrap(): void {
    // registries are populated by the index module import side-effects;
    // here we just wire observability to the execution engine event bus.
    initAgentRuntime();
    executionEngine.subscribe((e) => {
      observability.recordEvent(e);
      // Sync trace + agent activations to the server so the debug endpoints
      // return real data after a client-side build. Debounced to avoid
      // flooding the server with one POST per event.
      scheduleTraceSync();
    });
  }

  /**
   * Run a build: select workflow, detect targets + capabilities, write
   * requirements/decision memory, compile the workflow DAG, submit to the
   * execution engine, and return the plan.
   */
  async startBuild(prompt: string, projectId?: string): Promise<OrchestrationResult & { tasks: Task[] }> {
    executionEngine.reset();
    checkpointManager.clear();
    artifactRegistry.clear();

    // Context Builder pulls relevant memory for the planner
    const ctx = contextBuilder.buildForAgent("planner", { kinds: ["requirements", "decision", "conversation"], prompt });

    // Capability Detection (runs first)
    const capabilities = detectCapabilities(prompt);
    observability.recordEvent({
      id: `ev-${Date.now()}`,
      ts: Date.now(),
      type: "capability-detected",
      message: `Detected capabilities: ${capabilities.join(", ") || "none"}`,
      level: "info",
    });

    // Autonomy gate: Ambiguity Detection. If the requirement is too ambiguous
    // (score > AMBIGUITY_THRESHOLD), emit a human-question and pause the
    // workflow instead of inventing business requirements. The engine asks
    // ONLY when information is missing, conflicting, or an external resource
    // is needed without credentials.
    const ambiguity = detectAmbiguity(prompt);
    observability.recordEvent({
      id: `ev-${Date.now()}-amb`,
      ts: Date.now(),
      type: "capability-detected",
      message: `Ambiguity score ${ambiguity.score.toFixed(2)} (threshold ${AMBIGUITY_THRESHOLD})${ambiguity.shouldAsk ? " → asking user" : " → proceeding autonomously"}`,
      level: ambiguity.shouldAsk ? "warn" : "info",
    });
    const pendingQuestion = askQuestionIfNeeded(prompt);

    // Detect multi-targets + decisions
    const targets = detectTargets(prompt);
    const decisions = targets.flatMap((t) => t.policies);

    // Write Requirements Memory + Decision Memory
    projectMemory.write("requirements", "Original Prompt", prompt, "user");
    projectMemory.write("requirements", "Detected Targets", targets.map((t) => `${t.label}: ${t.stack} (${t.role})`).join("\n"), "decision-engine");
    projectMemory.write("decision", "Stack Selection", decisions.map((d) => `${d.topic}: ${d.chosen} (${d.confidence})`).join("\n"), "decision-engine");
    projectMemory.write("architecture", "Capabilities", capabilities.join(", ") || "none", "decision-engine");

    // ---- READ Architecture Memory: database choice drives generator output ----
    // The user (or a future LLM agent) may write "Database: PostgreSQL" to
    // Architecture Memory. Generators branch on this — Prisma provider, EF Core
    // provider, Android persistence note. Reading memory HERE proves memory has
    // real impact on generated output (see /api/debug/memory-impact).
    const database = readDatabaseFromMemory();
    if (database !== "sqlite") {
      // Surface the parsed choice in Decision Memory so the UI + downstream
      // agents can see that the database was overridden by Architecture Memory.
      projectMemory.write(
        "decision",
        "Database Choice (from Architecture Memory)",
        database,
        "orchestrator"
      );
    }

    // Workflow selection
    const workflow = workflowEngine.select(prompt);
    observability.recordEvent({
      id: `ev-${Date.now()}-wf`,
      ts: Date.now(),
      type: "workflow-selected",
      workflowId: workflow.id,
      message: `Selected workflow: ${workflow.name}`,
      level: "info",
    });

    // ---- Real generation: invoke the generator for each detected target ----
    // The Desktop Generator (Anvil) produces WinUI 3 / Tauri scaffolding; the
    // Android Generator (Droid) produces Kotlin+Compose / Flutter; the Web
    // Generator (Forge) produces a REAL compilable Next.js app (Prisma + auth
    // + CRUD pages derived from the requirement's data model). Files are
    // versioned into the Artifact Registry and emitted as artifact-produced
    // events for observability.
    const generationResults = targets.map((t, i) => {
      const result = generateForTarget(t.kind, t.stack, promptToName(prompt) || `App${i + 1}`, `t${i + 1}`, {
        prompt,
        capabilities,
        nonFunctionals: detectNonFunctionals(prompt),
        database,
      });
      observability.recordEvent({
        id: `ev-${Date.now()}-gen-${i}`,
        ts: Date.now(),
        type: "artifact-produced",
        stageId: "generate",
        message: `${t.label}: generated ${result.files.length} files (${result.stack})`,
        level: "success",
      });
      projectMemory.write(
        "code",
        `${t.label} source`,
        result.files.map((f) => `${f.path} (${(f.content.length / 1024).toFixed(1)} KB)`).join("\n"),
        result.producedBy
      );
      return result;
    });
    const totalFiles = generationResults.reduce((n, g) => n + g.files.length, 0);

    // Compile DAG
    const tasks = workflowEngine.compile(workflow, workflow.stages.map((s) => s.id as StageId));

    // Materialize generated files to a real on-disk workspace so the
    // compilation gate can run `tsc --noEmit` against them. Attach the
    // workspace path to the compilation gate task + the build stage task.
    const wsProjectId = projectId ?? `proj-${Date.now()}`;
    const workspacePaths: Record<string, string> = {}; // targetId -> path
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const gen = generationResults[i];
      const folder = t.kind === "windows" ? "desktop" : t.kind === "android" ? "android" : t.kind === "web" ? "web-admin" : t.kind === "cli" ? "cli" : "app";
      try {
        const res = await fetch("/api/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: wsProjectId, targetFolder: folder, files: gen.files }),
        });
        if (res.ok) {
          const { path: wsPath } = await res.json();
          workspacePaths[`t${i + 1}`] = wsPath;
          observability.recordEvent({
            id: `ev-${Date.now()}-ws-${i}`,
            ts: Date.now(),
            type: "artifact-produced",
            stageId: "generate",
            message: `${t.label}: materialized ${gen.files.length} files to ${wsPath}`,
            level: "info",
          });
        }
      } catch {
        // workspace write is best-effort; gates will skip if no workspace
      }
    }
    // Annotate the compilation gate task with the web workspace (runs tsc).
    // For multi-target builds, attach the primary target's workspace + type.
    // Desktop/android static validation happens via their own gate tasks below.
    const webWorkspace = workspacePaths["t1"] ?? Object.values(workspacePaths)[0] ?? undefined;
    const primaryTarget = targets[0];
    const primaryType = primaryTarget?.kind === "windows" ? "desktop" : primaryTarget?.kind === "android" ? "android" : "web";
    for (const task of tasks) {
      // Set gateContext for ALL gate tasks. Structural gates (architecture,
      // security, etc.) need artifactCount to pass. Compilation gates need
      // workspacePath + targetType.
      if (task.gate) {
        (task as Task & { gateContext?: import("./self-healing").GateEvaluationContext }).gateContext = {
          workspacePath: webWorkspace,
          artifactCount: totalFiles,
          targetType: task.gate === "compilation" ? primaryType : undefined,
        };
      }
      // Attach toolId + cwd to the build stage task so it runs npm-build (web only)
      if (task.stageId === "build" && !task.gate && webWorkspace && primaryTarget?.kind === "web") {
        task.toolId = "npm-build";
        (task as Task & { args?: { cwd?: string } }).args = { cwd: webWorkspace };
      }
    }

    // For multi-target builds, add per-target compilation gate tasks for
    // desktop/android so their static validators run too.
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const wsPath = workspacePaths[`t${i + 1}`];
      if (!wsPath) continue;
      const tType = t.kind === "windows" ? "desktop" : t.kind === "android" ? "android" : null;
      if (!tType || tType === primaryType) continue; // skip, already covered
      const extraGate = makeTask({
        workflowId: workflow.id,
        stageId: "build",
        title: `Gate: compilation (${tType})`,
        description: `Static validation for ${t.label}`,
        agent: "orchestrator" as AgentRole,
        dependsOn: [],
        gate: "compilation" as GateId,
      });
      (extraGate as Task & { gateContext?: import("./self-healing").GateEvaluationContext }).gateContext = {
        workspacePath: wsPath,
        artifactCount: totalFiles,
        targetType: tType as "desktop" | "android",
      };
      tasks.push(extraGate);
    }

    // Token budget check
    if (!tokenBudgetManager.withinBudget("planner", workflow.id)) {
      observability.recordEvent({
        id: `ev-${Date.now()}-budget`,
        ts: Date.now(),
        type: "task-failed",
        message: "Token budget exhausted for planner",
        level: "error",
      });
    }
    // Token charging: real tokens come from the z-ai SDK chat response
    // (captured in use-chat.ts via usage.total_tokens). For non-LLM tasks
    // (planner context, generator file production), tokens = 0 — no estimate.
    // The ctx.tokenEstimate is NOT charged — it was only used for budget
    // checking, not for observability metrics.
    tokenBudgetManager.charge("planner", workflow.id, 0);
    // Generator agents produce files via deterministic templates, not LLM
    // calls — no tokens consumed. Real tokens are only from /api/chat.
    for (const g of generationResults) {
      observability.chargeTokens(g.producedBy, 0, workflow.id);
      tokenBudgetManager.charge(g.producedBy, workflow.id, 0);
    }

    // Submit to execution engine (parallel, dependency-scheduled). If the
    // ambiguity gate raised a question, askQuestionIfNeeded already cancelled
    // running tasks; we still return the plan so the UI can surface the question.
    executionEngine.submitAll(tasks);
    if (pendingQuestion) {
      // Pause: cancel anything that just started so the engine waits for the
      // user's clarification before resuming.
      executionEngine.cancelAll();
      projectMemory.write("requirements", "Pending Question", pendingQuestion, "ambiguity-detector");
    }

    return {
      workflow,
      targets,
      decisions,
      capabilities,
      tasks,
      generatedFiles: totalFiles,
      ambiguityScore: ambiguity.score,
      pendingQuestion,
    };
  }

  /** Checkpoint after a stage completes (for recovery). */
  checkpoint(stageId: StageId, workflowId: WorkflowId, snapshot: Record<string, string>): void {
    const cp = checkpointManager.save(stageId, workflowId, snapshot, projectMemory.version());
    observability.recordEvent({
      id: `ev-${Date.now()}-cp`,
      ts: Date.now(),
      type: "checkpoint-saved",
      stageId,
      message: `Checkpoint saved at ${stageId}`,
      level: "debug",
    });
    void cp;
  }

  /** Resume from the last checkpoint after a crash. */
  resume(): { stageId: string; snapshot: Record<string, string> } | null {
    const r = checkpointManager.resume();
    if (r) {
      observability.recordEvent({
        id: `ev-${Date.now()}-cr`,
        ts: Date.now(),
        type: "checkpoint-restored",
        message: `Resumed from checkpoint at ${r.stageId}`,
        level: "info",
      });
    }
    return r;
  }

  /** Subscribe to all engine events (for UI + logs). */
  subscribe(fn: (e: EngineEvent) => void): () => void {
    return executionEngine.subscribe(fn);
  }

  selfHeal() {
    return selfHealController;
  }
}

export const orchestrator = new Orchestrator();

/**
 * Read the configured database choice from Architecture Memory.
 *
 * Generators must branch on the database selected for the project (e.g.
 * SQLite for offline-first vs PostgreSQL for client/server). Architecture
 * Memory is the source of truth — when an LLM agent (or the user) writes
 * "Database: PostgreSQL" there, every subsequent generator run should emit
 * the PostgreSQL flavor of the Prisma schema / EF Core provider / Android
 * note. This helper reads memory and parses the choice.
 *
 * Order matters: PostgreSQL is checked first so a record that says
 * "Database: PostgreSQL" wins even if older records mentioned SQLite.
 * Defaults to "sqlite" when memory is empty or no database record exists.
 *
 * Records are matched on lowercased `content`; the title is ignored so the
 * helper works with any naming convention (e.g. "Database", "Database Choice",
 * "Storage", etc.). Both `database: postgres` and bare `postgresql` match.
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

/** Derive a clean project name from the prompt (shared with the store). */
function promptToName(prompt: string): string {
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
