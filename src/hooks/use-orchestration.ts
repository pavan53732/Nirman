"use client";

import { useEffect, useRef } from "react";
import { useApp } from "@/lib/store";
import { stageDetails } from "@/lib/mock-data";
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
 * Drives the autonomous pipeline behind the scenes.
 * When isBuilding is true, stages advance on their own timers,
 * simulating the orchestration engine working without user input.
 *
 * IMPORTANT: this effect depends only on `isBuilding` and the
 * currently-running stage id (a stable string), NOT on the whole
 * `stages` array — otherwise rotating detail text via setStage would
 * mutate stages and re-trigger the effect into an infinite loop.
 */
export function useOrchestration() {
  const isBuilding = useApp((s) => s.isBuilding);
  const stages = useApp((s) => s.stages);
  const runningStageId = stages.find((s) => s.status === "running")?.id ?? null;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isBuilding || !runningStageId) return;

    const duration = STAGE_DURATION_MS[runningStageId] ?? 1500;
    const details = stageDetails[runningStageId] ?? [];

    // surface rotating detail lines for the running stage (does NOT change
    // runningStageId, so this effect is not re-triggered by it)
    if (details.length > 0) {
      useApp.getState().setStage(runningStageId, { detail: details[0] });
      let detailIdx = 0;
      detailTimerRef.current = setInterval(() => {
        detailIdx = (detailIdx + 1) % details.length;
        useApp.getState().setStage(runningStageId, { detail: details[detailIdx] });
      }, Math.max(600, duration / (details.length + 1)));
    }

    // trigger hot-reload + preview readiness mid-way through "generate"
    let previewOn: ReturnType<typeof setTimeout> | null = null;
    let hotOff: ReturnType<typeof setTimeout> | null = null;
    if (runningStageId === "generate") {
      useApp.getState().setHotReloading(true);
      previewOn = setTimeout(() => useApp.getState().setPreviewReady(true), Math.floor(duration * 0.6));
      hotOff = setTimeout(() => useApp.getState().setHotReloading(false), duration + 500);
    }

    timerRef.current = setTimeout(() => {
      useApp.getState().addLog("success", runningStageId, `${labelFor(runningStageId)} complete`);
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
