"use client";

import { useApp } from "@/lib/store";
import { agents, stageAgentMap } from "@/lib/engine";
import { cn } from "@/lib/utils";
import { Check, Loader2, Circle, AlertCircle } from "lucide-react";
import type { StageStatus, AgentRole } from "@/lib/types";

const agentDot: Record<string, string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  violet: "bg-violet-500",
  sky: "bg-sky-500",
  teal: "bg-teal-500",
  rose: "bg-rose-500",
  orange: "bg-orange-500",
  cyan: "bg-cyan-500",
  indigo: "bg-indigo-500",
};

export function StatusPanel() {
  const stages = useApp((s) => s.stages);
  const isBuilding = useApp((s) => s.isBuilding);
  const doneCount = stages.filter((s) => s.status === "done").length;
  const total = stages.length;
  const pct = Math.round((doneCount / total) * 100);

  const running = stages.find((s) => s.status === "running");
  const failed = stages.find((s) => s.status === "failed");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Current Status
        </span>
        <span className="text-[11px] font-medium tabular-nums">
          {failed ? "Needs attention" : isBuilding ? "Working…" : pct === 100 ? "Ready" : "Idle"}
        </span>
      </div>

      <div className="px-3 pt-2.5">
        <div className="flex items-center justify-between text-[11px] mb-1.5">
          <span className="text-muted-foreground">
            {running ? running.label : pct === 100 ? "Complete" : "Waiting"}
          </span>
          <span className="tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              failed ? "bg-red-500" : "bg-primary"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="ide-scroll flex-1 min-h-0 overflow-y-auto px-3 py-3">
        <ol className="flex flex-col gap-1">
          {stages.map((stage, idx) => {
            const stageAgents = stageAgentMap[stage.id] ?? [];
            const isActive = stage.status === "running";
            return (
              <li
                key={stage.id}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors",
                  isActive && "bg-accent/50"
                )}
              >
                <StageIcon status={stage.status} />
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-[12px] font-medium",
                        stage.status === "pending" && "text-muted-foreground",
                        stage.status === "done" && "text-foreground",
                        stage.status === "running" && "text-foreground",
                        stage.status === "failed" && "text-red-500"
                      )}
                    >
                      {stage.label}
                    </span>
                    {stage.durationMs && (
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {(stage.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    {stage.status === "running" && stage.detail
                      ? stage.detail
                      : stage.description}
                  </span>
                  {/* Agent attribution chips */}
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {stageAgents.map((ar) => (
                      <AgentChip
                        key={ar}
                        role={ar}
                        active={isActive}
                        dim={stage.status === "pending"}
                      />
                    ))}
                  </div>
                </div>
                <span className="text-[10px] tabular-nums text-muted-foreground/70 mt-0.5">
                  {String(idx + 1).padStart(2, "0")}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function AgentChip({
  role,
  active,
  dim,
}: {
  role: AgentRole;
  active: boolean;
  dim: boolean;
}) {
  const a = agents.find((x) => x.id === role);
  if (!a) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0 text-[9px] font-medium leading-[14px] transition",
        active ? "bg-background" : "bg-transparent",
        dim && "opacity-40"
      )}
      title={`${a.role} — ${a.name}: ${a.description}`}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          agentDot[a.color] ?? "bg-muted-foreground",
          active && "animate-pulse-dot"
        )}
      />
      {a.name}
    </span>
  );
}

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "done")
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-3 w-3" />
      </span>
    );
  if (status === "running")
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-primary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    );
  if (status === "failed")
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-500">
        <AlertCircle className="h-3 w-3" />
      </span>
    );
  return (
    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/40">
      <Circle className="h-3 w-3" />
    </span>
  );
}
