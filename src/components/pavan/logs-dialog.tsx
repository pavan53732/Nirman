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
import { checkpointManager } from "@/lib/engine";

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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [open, logs]);

  const checkpointCount = checkpointManager.all().length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Engine Logs & Observability</DialogTitle>
          <DialogDescription>
            Behind-the-scenes activity from the orchestration engine, agents, workflow engine,
            execution engine, and providers.
          </DialogDescription>
        </DialogHeader>

        {/* Observability summary */}
        <div className="grid grid-cols-3 gap-2 text-[11px]">
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
        </div>

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
