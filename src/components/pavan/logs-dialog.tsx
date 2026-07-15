"use client";

import { useEffect, useRef } from "react";
import { useApp } from "@/lib/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { LogLine } from "@/lib/types";
import { checkpointManager, isIndexedDBAvailable, observability } from "@/lib/engine/client";
import { Button } from "@/components/ui/button";
import { RotateCcw, Database, Coins, Zap } from "lucide-react";

const levelColor: Record<LogLine["level"], string> = {
  debug: "text-zinc-400",
  info: "text-sky-400",
  warn: "text-amber-400",
  error: "text-red-400",
  success: "text-emerald-400",
};

const levelLabel: Record<LogLine["level"], string> = {
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
  success: "OK ",
};

export function LogsDialog() {
  const open = useApp((s) => s.logsOpen);
  const setOpen = useApp((s) => s.setLogsOpen);
  const logs = useApp((s) => s.logs);
  const currentWorkflowId = useApp((s) => s.currentWorkflowId);
  const lastCheckpointStage = useApp((s) => s.lastCheckpointStage);
  const isBuilding = useApp((s) => s.isBuilding);
  const resumeFromCrash = useApp((s) => s.resumeFromCrash);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [open, logs]);

  const checkpointCount = checkpointManager.all().length;
  const idbAvailable = isIndexedDBAvailable();

  const handleResume = async () => {
    const ok = await resumeFromCrash();
    if (!ok) {
      useApp.getState().addLog("warn", "orchestrator", "No persisted checkpoint to resume from.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Engine Logs & Observability</DialogTitle>
          <DialogDescription>
            Behind-the-scenes activity from the orchestration engine, agents, workflow engine,
            execution engine, and providers. Checkpoints persist to IndexedDB for crash recovery.
          </DialogDescription>
        </DialogHeader>

        {/* Observability summary */}
        <div className="grid grid-cols-4 gap-2 text-[11px]">
          <div className="rounded-lg border border-border bg-muted/30 p-2">
            <div className="text-[9px] uppercase text-muted-foreground">Workflow</div>
            <div className="font-medium truncate">{currentWorkflowId ?? "—"}</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-2">
            <div className="text-[9px] uppercase text-muted-foreground">Last checkpoint</div>
            <div className="font-medium truncate">{lastCheckpointStage ?? "—"}</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-2">
            <div className="text-[9px] uppercase text-muted-foreground">Checkpoints</div>
            <div className="font-medium tabular-nums">{checkpointCount}</div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-2 flex flex-col">
            <div className="text-[9px] uppercase text-muted-foreground flex items-center gap-1">
              <Database className="h-2.5 w-2.5" /> IndexedDB
            </div>
            <div className={cn("font-medium", idbAvailable ? "text-emerald-500" : "text-zinc-500")}>
              {idbAvailable ? "active" : "unavailable"}
            </div>
          </div>
        </div>

        {/* Crash recovery resume button */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground">
            Checkpoints are persisted to IndexedDB so long builds resume after a crash or reload.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            disabled={isBuilding}
            onClick={handleResume}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Resume from checkpoint
          </Button>
        </div>

        {/* Cost + token timeline (observability aggregate) */}
        <CostTokenPanel />

        <div
          ref={scrollRef}
          className="ide-scroll h-[44vh] overflow-y-auto rounded-lg border border-border bg-zinc-950/80 p-3 font-mono text-[11px] leading-relaxed"
        >
          {logs.map((l) => (
            <div key={l.id} className="flex gap-2 hover:bg-white/5 px-1 -mx-1 rounded">
              <span className="text-zinc-600 tabular-nums shrink-0">{l.ts}</span>
              <span className={cn("shrink-0 font-semibold", levelColor[l.level])}>
                {levelLabel[l.level]}
              </span>
              <span className="text-zinc-500 shrink-0">[{l.source}]</span>
              <span className="text-zinc-300 break-all">{l.message}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Cost + token timeline panel — aggregate per workflow + cumulative totals. */
function CostTokenPanel() {
  const totals = observability.totals();
  const aggregates = observability.workflowAggregates_();
  const timeline = observability.tokenTimeline_();
  const agentMetrics = observability.metrics().filter((m) => m.tokensUsed > 0);

  // Build a simple sparkline from the timeline's cumulative tokens
  const maxTokens = timeline.length > 0 ? timeline[timeline.length - 1].cumulativeTokens : 0;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Coins className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-[11px] font-medium">Cost & Token Timeline</span>
        <span className="text-[9px] text-muted-foreground ml-auto">aggregate per workflow</span>
      </div>

      {/* Cumulative totals */}
      <div className="grid grid-cols-4 gap-2 text-[11px]">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
          <Zap className="h-3 w-3 text-sky-500" />
          <div className="flex flex-col">
            <span className="text-[9px] uppercase text-muted-foreground">Tokens</span>
            <span className="font-medium tabular-nums">{totals.tokens.toLocaleString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
          <Coins className="h-3 w-3 text-amber-500" />
          <div className="flex flex-col">
            <span className="text-[9px] uppercase text-muted-foreground">Cost</span>
            <span className="font-medium tabular-nums">${totals.cost.toFixed(4)}</span>
          </div>
        </div>
        <div className="rounded-md border border-border bg-background px-2 py-1.5">
          <span className="text-[9px] uppercase text-muted-foreground">Tasks</span>
          <div className="font-medium tabular-nums">{totals.tasks}</div>
        </div>
        <div className="rounded-md border border-border bg-background px-2 py-1.5">
          <span className="text-[9px] uppercase text-muted-foreground">Failures</span>
          <div className="font-medium tabular-nums">{totals.failures}</div>
        </div>
      </div>

      {/* Token timeline sparkline */}
      {timeline.length > 1 && (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] uppercase text-muted-foreground">Token accumulation</span>
          <div className="flex h-8 items-end gap-px">
            {timeline.slice(-60).map((p, i) => {
              const h = maxTokens > 0 ? (p.cumulativeTokens / maxTokens) * 100 : 0;
              return (
                <div
                  key={i}
                  className="flex-1 bg-sky-500/60 rounded-t-sm min-w-[2px]"
                  style={{ height: `${Math.max(4, h)}%` }}
                  title={`${p.tokens} tokens @ ${new Date(p.ts).toLocaleTimeString()} (${p.agent})`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Per-workflow aggregates */}
      {aggregates.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] uppercase text-muted-foreground">Per workflow</span>
          <div className="flex flex-col gap-1">
            {aggregates.map((a) => (
              <div key={a.workflowId} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1 text-[10px]">
                <span className="font-medium truncate">{a.workflowId}</span>
                <span className="tabular-nums text-sky-500">{a.totalTokens.toLocaleString()} tok</span>
                <span className="tabular-nums text-amber-500">${a.totalCost.toFixed(4)}</span>
                <span className="tabular-nums text-muted-foreground">{a.taskCount} tasks</span>
                <span className="tabular-nums text-muted-foreground">{(a.durationMs / 1000).toFixed(1)}s</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-agent token breakdown */}
      {agentMetrics.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] uppercase text-muted-foreground">Per agent (tokens)</span>
          <div className="flex flex-wrap gap-1">
            {agentMetrics.map((m) => (
              <span
                key={m.agent}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 text-[9px]"
                title={`${m.tasksCompleted} tasks · $${m.costEstimate.toFixed(4)}`}
              >
                <span className="font-medium">{m.agent}</span>
                <span className="tabular-nums text-muted-foreground">{m.tokensUsed.toLocaleString()}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {totals.tokens === 0 && (
        <p className="text-[10px] text-muted-foreground italic">
          No token usage recorded yet. Run a build to populate the timeline.
        </p>
      )}
    </div>
  );
}
