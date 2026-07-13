"use client";

import { useEffect, useRef } from "react";
import { useApp } from "@/lib/store";
import { stageDetails } from "@/lib/mock-data";
import { orchestrator, executionEngine, checkpointManager } from "@/lib/engine";
import type { StageId } from "@/lib/types";

/**
 * TRUE AUTONOMY LOOP — drives the pipeline UI entirely from execution engine
 * events. NO setTimeout for stage advancement. Stage status is derived from
 * the engine's real task states via getStageStatuses().
 *
 * Flow:
 *   1. orchestrator.startBuild() submits tasks to executionEngine
 *   2. executionEngine runs tasks (real tools / gates / self-healing)
 *   3. executionEngine emits task-succeeded / task-failed / gate-evaluated events
 *   4. This hook listens, calls executionEngine.getStageStatuses() + getProgress()
 *   5. Updates the UI store stages + progress from real engine state
 *   6. When all tasks done → set isBuilding=false, artifacts ready, preview ready
 *
 * Zero manual clicks. Zero timers. Engine events drive everything.
 */
export function useOrchestration() {
  const isBuilding = useApp((s) => s.isBuilding);
  const detailTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncedRef = useRef(false);

  // Subscribe to execution-engine events → drive UI + logs.
  useEffect(() => {
    const levelMap: Record<string, "debug" | "info" | "warn" | "error" | "success"> = {
      debug: "debug",
      info: "info",
      warn: "warn",
      error: "error",
      success: "success",
    };

    const syncStagesFromEngine = () => {
      const statuses = executionEngine.getStageStatuses();
      const progress = executionEngine.getProgress();
      const stages = useApp.getState().stages;

      // Update each stage's status from the engine's real task states
      let changed = false;
      const updatedStages = stages.map((st) => {
        const engineStatus = statuses[st.id];
        const newStatus =
          engineStatus === "done" ? "done" as const :
          engineStatus === "running" ? "running" as const :
          engineStatus === "failed" ? "failed" as const :
          "pending" as const;
        if (st.status !== newStatus) {
          changed = true;
          return { ...st, status: newStatus };
        }
        return st;
      });

      if (changed) {
        useApp.setState({ stages: updatedStages });
      }

      // Find the running stage and set rotating detail text
      const runningStage = updatedStages.find((s) => s.status === "running");
      if (runningStage) {
        const details = stageDetails[runningStage.id as StageId] ?? [];
        if (details.length > 0 && !runningStage.detail) {
          useApp.getState().setStage(runningStage.id, { detail: details[0] });
        }
      }

      // Check if the engine is idle (all tasks done) → finalize
      if (executionEngine.isIdle() && useApp.getState().isBuilding) {
        const allDone = Object.values(statuses).every((s) => s === "done" || s === "pending");
        const anyFailed = Object.values(statuses).some((s) => s === "failed");
        if (allDone && !anyFailed) {
          // All stages complete — finalize
          useApp.getState().setArtifactsReady(true);
          useApp.getState().setPreviewReady(true);
          useApp.getState().setHotReloading(false);
          useApp.getState().addLog("success", "orchestrator", "All stages complete. Deliverables ready.");

          // Save a final checkpoint
          const snapshot: Record<string, string> = {};
          updatedStages.forEach((s) => {
            snapshot[s.id] = s.status;
          });
          const wfId = useApp.getState().currentWorkflowId ?? "new-project";
          checkpointManager.save("ready", wfId as never, snapshot, 0);
          useApp.getState().setLastCheckpointStage("ready");
          useApp.setState({ isBuilding: false });
        }
      }
    };

    const unsub = orchestrator.subscribe((e) => {
      // Forward engine events to logs
      if (e.type === "gate-evaluated" || e.type === "task-retried" || e.type === "checkpoint-saved" || e.type === "artifact-produced" || e.type === "task-queued") {
        useApp.getState().addLog(levelMap[e.level] ?? "info", e.type, e.message);
      }

      // On task-succeeded or task-failed → re-sync stages from engine state
      if (e.type === "task-succeeded" || e.type === "task-failed" || e.type === "gate-evaluated") {
        syncStagesFromEngine();
      }

      // On artifact-produced during generate → trigger hot reload + preview
      if (e.type === "artifact-produced" && e.stageId === "generate") {
        useApp.getState().setHotReloading(true);
        setTimeout(() => {
          useApp.getState().setPreviewReady(true);
          useApp.getState().setHotReloading(false);
        }, 800);
      }

      // Log task completion with stage info
      if (e.type === "task-succeeded" && e.stageId) {
        useApp.getState().addLog("success", e.stageId, e.message);
      }
    });

    return unsub;
  }, []);

  // On mount, check IndexedDB for a persisted checkpoint (crash recovery).
  useEffect(() => {
    if (typeof window === "undefined") return;
    checkpointManager.hasPersistedState().then((has) => {
      if (has && !useApp.getState().isBuilding) {
        useApp.getState().addLog("info", "orchestrator", "Crash recovery: a persisted checkpoint was found in IndexedDB. Open Logs → Resume to continue the interrupted build.");
      }
    });
  }, []);

  // When isBuilding becomes true, do an initial sync + set up a polling
  // fallback that syncs UI state from the engine every 2 seconds. This is NOT
  // a stage-advancement timer — it only reads the engine's real state and
  // mirrors it to the UI. It catches cases where events fire before the
  // listener is set up (timing issue with async orchestrator.startBuild).
  useEffect(() => {
    if (!isBuilding) {
      syncedRef.current = false;
      return;
    }

    // Sync function — reads engine state, updates UI
    const syncFromEngine = () => {
      const statuses = executionEngine.getStageStatuses();
      const stages = useApp.getState().stages;
      let changed = false;
      const updated = stages.map((st) => {
        const es = statuses[st.id];
        const newStatus = (es === "done" ? "done" : es === "running" ? "running" : es === "failed" ? "failed" : "pending") as "pending" | "running" | "done" | "failed";
        if (st.status !== newStatus) {
          changed = true;
          return { ...st, status: newStatus };
        }
        return st;
      });
      if (changed) useApp.setState({ stages: updated });

      // Check for completion
      if (executionEngine.isIdle()) {
        const allDone = Object.values(statuses).every((s) => s === "done" || s === "pending");
        const anyFailed = Object.values(statuses).some((s) => s === "failed");
        if (!allDone) {
          // Debug: log why we're not done
          const notDone = Object.entries(statuses).filter(([, s]) => s !== "done" && s !== "pending").map(([k, v]) => `${k}=${v}`);
          if (notDone.length > 0) {
            useApp.getState().addLog("debug", "orchestrator", `Engine idle but stages not all done: ${notDone.join(", ")}`);
          }
        }
        if (allDone && !anyFailed && useApp.getState().isBuilding) {
          useApp.getState().setArtifactsReady(true);
          useApp.getState().setPreviewReady(true);
          useApp.getState().setHotReloading(false);
          useApp.getState().addLog("success", "orchestrator", "All stages complete. Deliverables ready.");
          const snapshot: Record<string, string> = {};
          updated.forEach((s) => { snapshot[s.id] = s.status; });
          const wfId = useApp.getState().currentWorkflowId ?? "new-project";
          checkpointManager.save("ready", wfId as never, snapshot, 0);
          useApp.getState().setLastCheckpointStage("ready");
          useApp.setState({ isBuilding: false });
        }
      }
    };

    // Initial sync
    syncFromEngine();

    // Polling fallback every 2 seconds (UI sync only, not stage advancement)
    const pollInterval = setInterval(() => {
      const tasks = executionEngine.allTasks();
      const running = tasks.filter((t) => t.status === "running").length;
      const queued = tasks.filter((t) => t.status === "queued" || t.status === "ready").length;
      const failed = tasks.filter((t) => t.status === "failed").length;
      const succeeded = tasks.filter((t) => t.status === "succeeded").length;
      const idle = executionEngine.isIdle();
      if (running > 0 || queued > 0 || (idle && useApp.getState().isBuilding)) {
        useApp.getState().addLog("debug", "engine-poll", `tasks: ${tasks.length} total, ${succeeded} done, ${running} running, ${queued} queued, ${failed} failed, idle=${idle}`);
      }
      syncFromEngine();
    }, 2000);

    return () => {
      clearInterval(pollInterval);
      if (detailTimerRef.current) {
        clearInterval(detailTimerRef.current);
        detailTimerRef.current = null;
      }
    };
  }, [isBuilding]);
}

// Expose execution-engine for the UI.
export { executionEngine };
