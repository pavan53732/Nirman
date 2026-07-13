// Workflow Engine — reusable workflows, not hardcoded in the orchestrator.
// The orchestrator selects a workflow based on user intent and Project Memory
// state, then hands it to the Execution Engine as a DAG of tasks.

import type { Workflow, WorkflowId, Task, StageId, GateId, AgentRole } from "./types";
import { workflows } from "./data/workflows";
import { makeTask } from "./execution-engine";

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
      // Only include stages the UI surface expects (map workflow stages to the
      // 8-stage pipeline where applicable; unknown stages still run).
      const stageTask = makeTask({
        workflowId: workflow.id,
        stageId,
        title: stage.label,
        description: stage.description,
        agent: stage.agents[0] ?? "orchestrator" as AgentRole,
        dependsOn: prevStageTaskIds,
        durationMs: 900 + Math.floor(Math.random() * 1400),
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
          dependsOn: stageTaskIds,
          durationMs: 300 + Math.floor(Math.random() * 400),
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
}

export const workflowEngine = new WorkflowEngine();
