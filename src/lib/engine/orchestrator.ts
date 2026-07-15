// Orchestrator — the conductor. THIN since Wave 2A: only coordination + I/O.
//
// Business logic (capability/ambiguity/target detection, task graph build) is
// DELEGATED to the WorkflowEngine. The orchestrator owns: memory writes,
// SharedContext publication, the generation/materialization loop, workspace
// disk I/O, gate task annotation, token budgeting, and engine lifecycle.
//
// The 5 Executive agents (always active):
//   Orchestrator · Project Manager · Planner · Decision Engine · Context Builder

import type {
  Workflow, WorkflowId, Task, EngineEvent, StageId,
  DecisionRecord, Capability, AgentRole, GateId,
} from "./types";
import { executionEngine, checkpointManager, makeTask } from "./execution-engine";
import { workflowEngine, detectTargets, readDatabaseFromMemory, promptToName, type PromptAnalysis } from "./workflow-engine";
import { projectMemory } from "./memories";
import { artifactRegistry } from "./artifact-registry";
import { detectNonFunctionals, type DetectedTargets } from "./decision-engine";
import { observability } from "./observability";
import { selfHealController } from "./self-healing";
import { tokenBudgetManager } from "./provider-abstraction";
import { generateForTarget } from "./generators";
import { agentRuntime, initAgentRuntime } from "./agent-runtime";
import { sharedContext } from "./shared-context"; // inter-agent blackboard (Task I)
import { taskGraph } from "./task-graph"; // mutable DAG (Wave 1A)

// Debounced trace sync — POSTs the client-side executionEngine trace + agent
// activations to /api/build/trace + /api/agents/trace so the debug endpoints
// return real data after a client-side build (the orchestrator runs in the
// browser via the Zustand store).
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

// Re-export the helpers that moved to the workflow engine in Wave 2A so
// existing imports from "./orchestrator" (failure-tests.ts, perf-harness.ts,
// index.ts) keep working. Their definitions live in workflow-engine.ts.
export { detectTargets, readDatabaseFromMemory };

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

  /** Run a build. THIN orchestrator (Wave 2A): analysis + task-graph build
   *  are DELEGATED to workflowEngine; memory/shared-context writes, generation
   *  loop, workspace materialization, gate annotation, token budgeting, and
   *  engine lifecycle stay here as coordination. Signature + return type +
   *  behavior are IDENTICAL to pre-Wave-2A. */
  async startBuild(prompt: string, projectId?: string): Promise<OrchestrationResult & { tasks: Task[] }> {
    // 1. Reset all subsystems.
    executionEngine.reset();
    checkpointManager.clear();
    artifactRegistry.clear();
    taskGraph.clear();
    sharedContext.clear();

    // 2. Analyze the prompt (capability + ambiguity + target detection, db read).
    const analysis: PromptAnalysis = workflowEngine.analyzePrompt(prompt);
    const { capabilities, targets, decisions, database } = analysis;

    observability.recordEvent({
      id: `ev-${Date.now()}`,
      ts: Date.now(),
      type: "capability-detected",
      message: `Detected capabilities: ${capabilities.join(", ") || "none"}`,
      level: "info",
    });
    observability.recordEvent({
      id: `ev-${Date.now()}-amb`,
      ts: Date.now(),
      type: "capability-detected",
      message: `Ambiguity score ${analysis.ambiguityScore.toFixed(2)} (threshold 0.75)${analysis.pendingQuestion ? " → asking user" : " → proceeding autonomously"}`,
      level: analysis.pendingQuestion ? "warn" : "info",
    });

    // 3. Select a workflow.
    const workflow = workflowEngine.select(prompt);
    observability.recordEvent({
      id: `ev-${Date.now()}-wf`,
      ts: Date.now(),
      type: "workflow-selected",
      workflowId: workflow.id,
      message: `Selected workflow: ${workflow.name}`,
      level: "info",
    });

    // 4. Write Requirements + Decision + Architecture memory.
    projectMemory.write("requirements", "Original Prompt", prompt, "user");
    projectMemory.write(
      "requirements",
      "Detected Targets",
      targets.map((t) => `${t.label}: ${t.stack} (${t.role})`).join("\n"),
      "decision-engine"
    );
    projectMemory.write(
      "decision",
      "Stack Selection",
      decisions.map((d) => `${d.topic}: ${d.chosen} (${d.confidence})`).join("\n"),
      "decision-engine"
    );
    projectMemory.write("architecture", "Capabilities", capabilities.join(", ") || "none", "decision-engine");
    if (database !== "sqlite") {
      // Surface the architecture-memory database override in Decision Memory.
      projectMemory.write(
        "decision",
        "Database Choice (from Architecture Memory)",
        database,
        "orchestrator"
      );
    }

    // 5. Publish the analysis to the SharedContext blackboard. Downstream
    //    agents (Planner, Architect, Generator, Reviewer, Builder) read these.
    sharedContext.write("prompt", prompt);
    sharedContext.write("targets", targets);
    sharedContext.write("capabilities", capabilities);
    sharedContext.write("decisions", decisions);
    sharedContext.write("database", database);
    sharedContext.write("projectId", projectId ?? `proj-${Date.now()}`);
    observability.recordEvent({
      id: `ev-${Date.now()}-shared`,
      ts: Date.now(),
      type: "memory-written",
      message: `SharedContext initialized: ${sharedContext.readAll ? Object.keys(sharedContext.readAll()).length : 0} keys (prompt, targets, capabilities, decisions, database, projectId)`,
      level: "debug",
    });

    // 6. Generation loop — materialize files per detected target. (In a future
    //    wave this moves into agent handlers; for now the orchestrator owns the
    //    materialization I/O.)
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

    // Publish per-target code to SharedContext (key: "code:<kind>").
    for (let i = 0; i < targets.length; i++) {
      sharedContext.write(`code:${targets[i].kind}`, generationResults[i].files);
    }
    sharedContext.write("generatedFilesCount", totalFiles);

    // 7. Build the task DAG — compile workflow + add per-target parallel gen
    //    tasks + extend generate stage's compilation gate deps. (DELEGATED.)
    const tasks = workflowEngine.buildTaskGraph(workflow, analysis, prompt);
    observability.recordEvent({
      id: `ev-${Date.now()}-par-gen`,
      ts: Date.now(),
      type: "task-queued",
      stageId: "generate",
      message: `Created ${targets.length} parallel generation tasks`,
      level: "info",
    });

    // 8. Populate the TaskGraph (Wave 1A) — the mutable DAG observers query.
    taskGraph.addAll(tasks);

    // 9. Materialize generated files to disk so the compilation gate can run
    //    `tsc --noEmit` against them.
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
    // Publish per-target workspace paths to SharedContext ("workspace:<kind>").
    sharedContext.write("workspaces", workspacePaths);
    for (let i = 0; i < targets.length; i++) {
      const ws = workspacePaths[`t${i + 1}`];
      if (ws) sharedContext.write(`workspace:${targets[i].kind}`, ws);
    }

    // 10. Annotate gate tasks with workspacePath + targetType + artifactCount.
    //     Compilation gates run `tsc` (web) or static validators (desktop/android).
    const webWorkspace = workspacePaths["t1"] ?? Object.values(workspacePaths)[0] ?? undefined;
    const primaryTarget = targets[0];
    const primaryType = primaryTarget?.kind === "windows" ? "desktop" : primaryTarget?.kind === "android" ? "android" : "web";
    for (const task of tasks) {
      if (task.gate) {
        (task as Task & { gateContext?: import("./self-healing").GateEvaluationContext }).gateContext = {
          workspacePath: webWorkspace,
          artifactCount: totalFiles,
          targetType: task.gate === "compilation" ? primaryType : undefined,
        };
      }
      // Attach toolId + cwd to the build stage task so it runs npm-build (web only).
      if (task.stageId === "build" && !task.gate && webWorkspace && primaryTarget?.kind === "web") {
        task.toolId = "npm-build";
        (task as Task & { args?: { cwd?: string } }).args = { cwd: webWorkspace };
      }
    }

    // 11. Add per-target compilation gates for non-primary desktop/android
    //     targets so their static validators run too.
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const wsPath = workspacePaths[`t${i + 1}`];
      if (!wsPath) continue;
      const tType = t.kind === "windows" ? "desktop" : t.kind === "android" ? "android" : null;
      if (!tType || tType === primaryType) continue; // skip — primary target already covered
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
      taskGraph.add(extraGate);
    }

    // 12. Token budget. Real tokens come from /api/chat usage; non-LLM tasks
    //     (planner context, generator file production) charge 0.
    if (!tokenBudgetManager.withinBudget("planner", workflow.id)) {
      observability.recordEvent({
        id: `ev-${Date.now()}-budget`,
        ts: Date.now(),
        type: "task-failed",
        message: "Token budget exhausted for planner",
        level: "error",
      });
    }
    tokenBudgetManager.charge("planner", workflow.id, 0);
    for (const g of generationResults) {
      observability.chargeTokens(g.producedBy, 0, workflow.id);
      tokenBudgetManager.charge(g.producedBy, workflow.id, 0);
    }

    // 13. Submit to execution engine. If the autonomy gate raised a question,
    //     cancel anything that just started so the engine waits for the user's
    //     clarification before resuming.
    executionEngine.submitAll(tasks);
    if (analysis.pendingQuestion) {
      executionEngine.cancelAll();
      projectMemory.write("requirements", "Pending Question", analysis.pendingQuestion, "ambiguity-detector");
    }

    return {
      workflow,
      targets,
      decisions,
      capabilities,
      tasks,
      generatedFiles: totalFiles,
      ambiguityScore: analysis.ambiguityScore,
      pendingQuestion: analysis.pendingQuestion,
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
