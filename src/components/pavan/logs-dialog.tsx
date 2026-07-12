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
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { LogLine } from "@/lib/types";

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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [open, logs]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Engine Logs</DialogTitle>
          <DialogDescription>
            Behind-the-scenes activity from the orchestration engine, agents, and providers.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={scrollRef}
          className="ide-scroll h-[50vh] overflow-y-auto rounded-lg border border-border bg-zinc-950/80 p-3 font-mono text-[11px] leading-relaxed"
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
