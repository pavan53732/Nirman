"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { skills, skillCategories, stageAgentMap } from "@/lib/engine/data/skills";
import { agents } from "@/lib/engine/data/agents";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentRole } from "@/lib/types";

const agentColorTint: Record<string, string> = {
  emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-violet-500/20",
  sky: "bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-sky-500/20",
  teal: "bg-teal-500/15 text-teal-600 dark:text-teal-400 ring-teal-500/20",
  rose: "bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-rose-500/20",
  orange: "bg-orange-500/15 text-orange-600 dark:text-orange-400 ring-orange-500/20",
  cyan: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 ring-cyan-500/20",
  indigo: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 ring-indigo-500/20",
};

export function CapabilitiesDialog() {
  const open = useApp((s) => s.capabilitiesOpen);
  const setOpen = useApp((s) => s.setCapabilitiesOpen);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((s) => {
      if (activeCat !== "all" && s.category !== activeCat) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    });
  }, [query, activeCat]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof skills>();
    for (const s of filtered) {
      const arr = map.get(s.category) ?? [];
      arr.push(s);
      map.set(s.category, arr);
    }
    return map;
  }, [filtered]);

  const totalSkills = skills.length;
  const totalCats = skillCategories.length;
  const totalAgents = agents.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            Capability Domains
            <Badge variant="secondary" className="text-[10px] font-normal">
              {totalSkills} skills · {totalCats} domains · {totalAgents} agents
            </Badge>
          </DialogTitle>
          <DialogDescription>
            The orchestration engine's specialist skills, organized by domain and owned by
            dedicated agents. The Planner, Architect, Technology Selector, Coder, Reviewer,
            Tester, Debugger, Build, Docs, and Orchestrator agents coordinate automatically.
          </DialogDescription>
        </DialogHeader>

        {/* Agents strip */}
        <div className="flex flex-wrap gap-1.5 px-5 py-2.5 border-b border-border bg-muted/30">
          {agents.map((a) => (
            <span
              key={a.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                agentColorTint[a.color] ?? "bg-muted text-muted-foreground ring-border"
              )}
              title={a.description}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {a.role}
              <span className="opacity-60">·{a.consumes?.length ?? 0}</span>
            </span>
          ))}
        </div>

        {/* Search + category filter */}
        <div className="px-5 py-3 border-b border-border space-y-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills…"
              className="h-8 pl-8 pr-8 text-xs"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            <CatChip id="all" label="All" active={activeCat === "all"} onClick={() => setActiveCat("all")} />
            {skillCategories.map((c) => (
              <CatChip
                key={c.id}
                id={c.id}
                label={c.name}
                active={activeCat === c.id}
                onClick={() => setActiveCat(c.id)}
              />
            ))}
          </div>
        </div>

        {/* Skills list grouped by category */}
        <ScrollArea className="h-[52vh]">
          <div className="px-5 py-4 flex flex-col gap-5">
            {grouped.size === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">
                No skills match "{query}".
              </p>
            )}
            {skillCategories
              .filter((c) => grouped.has(c.id))
              .map((cat) => {
                const items = grouped.get(cat.id)!;
                return (
                  <section key={cat.id} className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {cat.name}
                      </h3>
                      <span className="text-[10px] text-muted-foreground">
                        {items.length} skill{items.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {items.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-start gap-2 rounded-lg border border-border bg-card px-2.5 py-2"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium leading-tight">{s.name}</div>
                            <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                              {s.description}
                            </div>
                          </div>
                          <AgentTag agent={s.agent} />
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function CatChip({
  label,
  active,
  onClick,
}: {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[10px] font-medium transition",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:text-foreground hover:bg-accent"
      )}
    >
      {label}
    </button>
  );
}

function AgentTag({ agent }: { agent: AgentRole }) {
  const a = agents.find((x) => x.id === agent);
  if (!a) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ring-1",
        agentColorTint[a.color] ?? "bg-muted text-muted-foreground ring-border"
      )}
      title={`${a.role} (${a.name})`}
    >
      {a.role}
    </span>
  );
}

export { stageAgentMap };
