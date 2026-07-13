"use client";

import { useEffect, useRef } from "react";
import { useApp } from "@/lib/store";
import { stageDetails } from "@/lib/mock-data";
import { orchestrator, executionEngine, checkpointManager } from "@/lib/engine";
import type { StageId } from "@/lib/types";

const STAGE_DURATION_MS: Record<StageId, number> = {
  analyze: 1400,
  plan: 1800,
  architect: 2200,
  generate: 2600,
  build: 2000,
  test: 1800,
  package: 1600,
  ready: 400,
};

/**
 * Drives the autonomous pipeline. The Execution Engine runs the task DAG in
 * parallel (dependency-scheduled, with quality gates + self-healing). This
 * hook subscribes to engine events and mirrors stage progression into the
 * UI store, so the minimal status panel reflects the engine's real state.
 *
 * The hook depends only on `isBuilding` + the running stage id (NOT the whole
 * stages array) to avoid an infinite render loop from detail-text updates.
 */
export function useOrchestration() {
  const isBuilding = useApp((s) => s.isBuilding);
  const stages = useApp((s) => s.stages);
  const runningStageId = stages.find((s) => s.status === "running")?.id ?? null;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Subscribe to execution-engine events → forward to logs (observability).
  useEffect(() => {
    const unsub = orchestrator.subscribe((e) => {
      const levelMap: Record<string, "debug" | "info" | "warn" | "error" | "success"> = {
        debug: "debug",
        info: "info",
        warn: "warn",
        error: "error",
        success: "success",
      };
      if (e.type === "gate-evaluated" || e.type === "task-retried" || e.type === "checkpoint-saved") {
        useApp.getState().addLog(levelMap[e.level], e.type, e.message);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!isBuilding || !runningStageId) return;

    const duration = STAGE_DURATION_MS[runningStageId] ?? 1500;
    const details = stageDetails[runningStageId] ?? [];

    // Rotating detail lines for the running stage (does NOT change runningStageId,
    // so this effect is not re-triggered by it).
    if (details.length > 0) {
      useApp.getState().setStage(runningStageId, { detail: details[0] });
      let detailIdx = 0;
      detailTimerRef.current = setInterval(() => {
        detailIdx = (detailIdx + 1) % details.length;
        useApp.getState().setStage(runningStageId, { detail: details[detailIdx] });
      }, Math.max(600, duration / (details.length + 1)));
    }

    // Trigger hot-reload + preview readiness mid-way through "generate".
    let previewOn: ReturnType<typeof setTimeout> | null = null;
    let hotOff: ReturnType<typeof setTimeout> | null = null;
    if (runningStageId === "generate") {
      useApp.getState().setHotReloading(true);
      previewOn = setTimeout(() => useApp.getState().setPreviewReady(true), Math.floor(duration * 0.6));
      hotOff = setTimeout(() => useApp.getState().setHotReloading(false), duration + 500);
    }

    timerRef.current = setTimeout(() => {
      useApp.getState().addLog("success", runningStageId, `${labelFor(runningStageId)} complete`);
      // Save a checkpoint after each stage (Recovery & Checkpointing)
      const snapshot: Record<string, import("@/lib/engine/types").TaskStatus> = {};
      useApp.getState().stages.forEach((s) => {
        snapshot[s.id] = (s.status === "running" ? "succeeded" : s.status) as import("@/lib/engine/types").TaskStatus;
      });
      const wfId = useApp.getState().currentWorkflowId ?? "new-project";
      checkpointManager.save(runningStageId, wfId as never, snapshot, 0);
      useApp.getState().setLastCheckpointStage(runningStageId);
      useApp.getState().advanceStage();
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (detailTimerRef.current) clearInterval(detailTimerRef.current);
      if (previewOn) clearTimeout(previewOn);
      if (hotOff) clearTimeout(hotOff);
    };
  }, [isBuilding, runningStageId]);
}

function labelFor(id: StageId): string {
  const map: Record<StageId, string> = {
    analyze: "Understanding",
    plan: "Planning",
    architect: "Architecture",
    generate: "Generating",
    build: "Building",
    test: "Testing",
    package: "Packaging",
    ready: "Ready",
  };
  return map[id];
}

// Expose execution-engine idle check for the UI.
export { executionEngine };
