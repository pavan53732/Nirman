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
} from "./types";
import { executionEngine, checkpointManager, makeTask } from "./execution-engine";
import { workflowEngine } from "./workflow-engine";
import { projectMemory, contextBuilder } from "./memories";
import { artifactRegistry } from "./artifact-registry";
import { decisionEngine, detectCapabilities, type DetectedTargets } from "./decision-engine";
import { observability } from "./observability";
import { selfHealController } from "./self-healing";
import { registries } from "./registries";
import { tokenBudgetManager } from "./provider-abstraction";

export interface OrchestrationResult {
  workflow: Workflow;
  targets: DetectedTargets[];
  decisions: DecisionRecord[];
  capabilities: Capability[];
}

/** Detect generation targets (multi-target) from a prompt. */
export function detectTargets(prompt: string): DetectedTargets[] {
  const caps = detectCapabilities(prompt);
  const p = " " + prompt.toLowerCase() + " ";
  const out: DetectedTargets[] = [];
  const wants = (re: RegExp) => re.test(p);

  const multi =
    [
      wants(/\b(windows|desktop|winui|wpf|winforms|win32)\b/),
      wants(/\b(android|mobile( app)?|kotlin|flutter|companion app|phone app)\b/),
      wants(/\b(web( site| app| admin| portal)?|website|landing|marketing site|saas|portal)\b/),
      wants(/\b(api|rest|backend service|microservice)\b/),
      wants(/\b(cli|command.line|terminal tool)\b/),
    ].filter(Boolean).length > 1;

  if (wants(/\b(windows|desktop|winui|wpf|winforms|win32|\.net\s*(desktop|app))\b/)) {
    const kind = "windows" as PlatformKind;
    const { stack, decision } = decisionEngine.pickStack(kind, prompt, caps);
    out.push({ kind, label: multi ? "Desktop App" : "App", role: multi ? "Primary desktop workspace" : "Windows desktop application", stack, capabilities: caps, policies: [decisionEngine.decide("windows native rich controls", prompt)] });
  }
  if (wants(/\b(android|mobile( app)?|kotlin|flutter|companion app|phone app)\b/)) {
    const kind = "android" as PlatformKind;
    const { stack, decision } = decisionEngine.pickStack(kind, prompt, caps);
    out.push({ kind, label: multi ? "Android Companion" : "App", role: multi ? "Mobile companion app" : "Android application", stack, capabilities: caps, policies: [decisionEngine.decide("android native perf", prompt)] });
  }
  if (wants(/\b(web( site| app| admin| portal)?|website|landing|marketing site|saas|portal|browser)\b/)) {
    const kind = "web" as PlatformKind;
    const { stack, decision } = decisionEngine.pickStack(kind, prompt, caps);
    out.push({ kind, label: multi ? "Web Portal" : "App", role: multi ? "Web admin portal" : "Web application", stack, capabilities: caps, policies: [decisionEngine.decide("web marketing/landing", prompt)] });
  }
  if (wants(/\b(api|rest( api)?|graphql|backend service|microservice)\b/)) {
    const kind = "api" as PlatformKind;
    const { stack, decision } = decisionEngine.pickStack(kind, prompt, caps);
    out.push({ kind, label: "API Service", role: "Backend API and data layer", stack, capabilities: caps, policies: [decisionEngine.decide("ai knowledge base", prompt)] });
  }
  if (wants(/\b(cli|command.line|terminal tool|brew install|cargo install)\b/)) {
    const kind = "cli" as PlatformKind;
    const { stack, decision } = decisionEngine.pickStack(kind, prompt, caps);
    out.push({ kind, label: "CLI Tool", role: "Command-line utility", stack, capabilities: caps, policies: [decisionEngine.decide("cli performance/cross-platform", prompt)] });
  }
  if (wants(/\b(ai agent|autonomous agent|assistant service|chatbot|support agent)\b/)) {
    out.push({ kind: "api" as PlatformKind, label: "AI Agent", role: "Autonomous agent service", stack: "Python + LangGraph", capabilities: caps, policies: [decisionEngine.decide("ai knowledge base", prompt)] });
  }
  if (wants(/\b(library|sdk|npm package|crate)\b/)) {
    out.push({ kind: "library" as PlatformKind, label: "Library", role: "Reusable library / SDK", stack: /\b(rust|crate)\b/.test(p) ? "Rust crate" : "TypeScript library", capabilities: caps, policies: [] });
  }
  if (out.length === 0) {
    const kind = "web" as PlatformKind;
    const { stack, decision } = decisionEngine.pickStack(kind, prompt, caps);
    out.push({ kind, label: "Web App", role: "Web application", stack, capabilities: caps, policies: [decision] });
  }
  return out;
}

export class Orchestrator {
  /** Bootstrap: register all data into registries and wire the event bus. */
  bootstrap(): void {
    // registries are populated by the index module import side-effects;
    // here we just wire observability to the execution engine event bus.
    executionEngine.subscribe((e) => {
      observability.recordEvent(e);
    });
  }

  /**
   * Run a build: select workflow, detect targets + capabilities, write
   * requirements/decision memory, compile the workflow DAG, submit to the
   * execution engine, and return the plan.
   */
  startBuild(prompt: string): OrchestrationResult & { tasks: Task[] } {
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

    // Detect multi-targets + decisions
    const targets = detectTargets(prompt);
    const decisions = targets.flatMap((t) => t.policies);

    // Write Requirements Memory + Decision Memory
    projectMemory.write("requirements", "Original Prompt", prompt, "user");
    projectMemory.write("requirements", "Detected Targets", targets.map((t) => `${t.label}: ${t.stack} (${t.role})`).join("\n"), "decision-engine");
    projectMemory.write("decision", "Stack Selection", decisions.map((d) => `${d.topic}: ${d.chosen} (${d.confidence})`).join("\n"), "decision-engine");
    projectMemory.write("architecture", "Capabilities", capabilities.join(", ") || "none", "decision-engine");

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

    // Compile DAG
    const tasks = workflowEngine.compile(workflow, workflow.stages.map((s) => s.id as StageId));

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
    tokenBudgetManager.charge("planner", workflow.id, ctx.tokenEstimate);
    observability.chargeTokens("planner", ctx.tokenEstimate);

    // Submit to execution engine (parallel, dependency-scheduled)
    executionEngine.submitAll(tasks);

    return { workflow, targets, decisions, capabilities, tasks };
  }

  /** Checkpoint after a stage completes (for recovery). */
  checkpoint(stageId: StageId, workflowId: WorkflowId, snapshot: Record<string, import("./types").TaskStatus>): void {
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
  resume(): { stageId: string; snapshot: Record<string, import("./types").TaskStatus> } | null {
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
