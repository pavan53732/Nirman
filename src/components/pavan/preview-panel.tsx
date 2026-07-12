"use client";

import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Monitor, Smartphone, Globe, RefreshCw, ExternalLink, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PreviewTarget, ProjectMeta } from "@/lib/types";

export function PreviewPanel() {
  const activeProjectId = useApp((s) => s.activeProjectId);
  const projects = useApp((s) => s.projects);
  const previewTarget = useApp((s) => s.previewTarget);
  const setPreviewTarget = useApp((s) => s.setPreviewTarget);
  const previewReady = useApp((s) => s.previewReady);
  const hotReloading = useApp((s) => s.hotReloading);

  const active = projects.find((p) => p.id === activeProjectId) ?? projects[0];

  const tabs: { id: PreviewTarget; label: string; icon: typeof Monitor; show: boolean }[] = [
    { id: "web", label: "Web", icon: Globe, show: true },
    { id: "windows", label: "Windows", icon: Monitor, show: active?.kind !== "android" },
    { id: "android", label: "Android", icon: Smartphone, show: true },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Live Preview
          </span>
          {hotReloading && (
            <span className="flex items-center gap-1 text-[10px] text-primary">
              <Zap className="h-3 w-3" /> hot reload
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {tabs
            .filter((t) => t.show)
            .map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setPreviewTarget(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition",
                    previewTarget === t.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              );
            })}
        </div>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden bg-muted/30 p-3">
        {previewReady ? (
          <PreviewFrame target={previewTarget} project={active} />
        ) : (
          <PreviewBuilding target={previewTarget} project={active} />
        )}
      </div>
    </div>
  );
}

function PreviewBuilding({
  target,
  project,
}: {
  target: PreviewTarget;
  project: ProjectMeta | undefined;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-primary/10 animate-ping" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            <RefreshCw className="h-6 w-6 text-primary animate-spin" />
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Building preview…</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-[220px]">
            {project?.name} · {labelFor(target)} preview will appear here once generation completes.
          </p>
        </div>
      </div>
    </div>
  );
}

function PreviewFrame({ target, project }: { target: PreviewTarget; project: ProjectMeta | undefined }) {
  if (target === "web") return <WebFrame project={project} />;
  if (target === "android") return <AndroidFrame project={project} />;
  return <WindowsFrame project={project} />;
}

function labelFor(t: PreviewTarget) {
  return t === "web" ? "Web" : t === "android" ? "Android" : "Windows desktop";
}

function WebFrame({ project }: { project: ProjectMeta | undefined }) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-lg">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-red-400/80" />
          <span className="h-3 w-3 rounded-full bg-yellow-400/80" />
          <span className="h-3 w-3 rounded-full bg-green-400/80" />
        </div>
        <div className="mx-auto flex h-6 w-full max-w-sm items-center rounded-md border border-border bg-background px-2 text-[10px] text-muted-foreground">
          {project?.name?.toLowerCase().replace(/\s+/g, "")}.preview.local
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="ide-scroll flex-1 overflow-y-auto">
        <MockWebApp project={project} />
      </div>
    </div>
  );
}

function WindowsFrame({ project }: { project: ProjectMeta | undefined }) {
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-lg">
      <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/15">
            <Monitor className="h-3 w-3 text-primary" />
          </div>
          <span className="text-xs font-medium">{project?.name ?? "App"}</span>
        </div>
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground/40" />
          <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground/40" />
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
        </div>
      </div>
      <div className="ide-scroll flex-1 overflow-y-auto">
        <MockWindowsApp project={project} />
      </div>
    </div>
  );
}

function AndroidFrame({ project }: { project: ProjectMeta | undefined }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex h-full max-h-[460px] w-[230px] flex-col overflow-hidden rounded-[28px] border-[6px] border-zinc-800 bg-background shadow-2xl">
        <div className="flex items-center justify-between bg-zinc-900 px-4 py-1 text-[9px] text-zinc-400">
          <span>9:41</span>
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>5G</span>
          </div>
        </div>
        <div className="notch absolute left-1/2 top-[18px] h-4 w-16 -translate-x-1/2 rounded-b-2xl bg-zinc-800" />
        <div className="ide-scroll flex-1 overflow-y-auto">
          <MockAndroidApp project={project} />
        </div>
      </div>
    </div>
  );
}

/* ---- Mock app contents ---- */

function MockWebApp({ project }: { project: ProjectMeta | undefined }) {
  return (
    <div className="flex flex-col">
      <div className="grid-bg border-b border-border bg-gradient-to-b from-primary/5 to-transparent px-6 py-10 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Zap className="h-5 w-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{project?.name ?? "Your App"}</h1>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          {project?.description ?? "Generated by Pavan"}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <span className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground">
            Get started
          </span>
          <span className="rounded-md border border-border px-3 py-1.5 text-[11px]">Docs</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 p-5">
        {["Fast", "Offline", "Secure"].map((f, i) => (
          <div key={f} className="rounded-lg border border-border bg-card p-3 text-center">
            <div className="mx-auto mb-1.5 h-6 w-6 rounded-md bg-primary/15" />
            <div className="text-[11px] font-medium">{f}</div>
            <div className="mt-0.5 text-[9px] text-muted-foreground">Feature {i + 1}</div>
          </div>
        ))}
      </div>
      <div className="px-5 pb-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 text-[11px] font-medium">Recent activity</div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between border-t border-border py-1.5 text-[10px]">
              <span className="text-muted-foreground">Item #{i}</span>
              <span className="font-medium text-emerald-600">+$120</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MockWindowsApp({ project }: { project: ProjectMeta | undefined }) {
  return (
    <div className="flex h-full">
      <div className="hidden sm:flex w-36 shrink-0 flex-col gap-1 border-r border-border bg-muted/30 p-2">
        <div className="px-2 py-1 text-[9px] font-semibold uppercase text-muted-foreground">Menu</div>
        {["Dashboard", "Invoices", "Customers", "Reports", "Settings"].map((m, i) => (
          <div
            key={m}
            className={cn(
              "rounded-md px-2 py-1.5 text-[11px]",
              i === 0 ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground"
            )}
          >
            {m}
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Dashboard</h2>
          <span className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground">
            + New
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { l: "Revenue", v: "$24,580", d: "+12%" },
            { l: "Outstanding", v: "$3,210", d: "-4%" },
            { l: "Paid", v: "142", d: "+8%" },
          ].map((s) => (
            <div key={s.l} className="rounded-lg border border-border bg-card p-2.5">
              <div className="text-[9px] uppercase text-muted-foreground">{s.l}</div>
              <div className="mt-0.5 text-sm font-semibold">{s.v}</div>
              <div className="text-[9px] text-emerald-600">{s.d}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg border border-border bg-card p-3">
          <div className="mb-2 text-[10px] font-medium text-muted-foreground">Monthly revenue</div>
          <div className="flex h-20 items-end gap-1.5">
            {[40, 55, 48, 70, 62, 85, 78, 92, 88, 100, 84, 96].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm bg-primary/70"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium">Recent invoices</span>
            <span className="text-[9px] text-muted-foreground">{project?.stack}</span>
          </div>
          {["Acme Inc", "Globex", "Initech"].map((c, i) => (
            <div key={c} className="flex items-center justify-between border-t border-border py-1.5 text-[10px]">
              <span>{c}</span>
              <span className="text-muted-foreground">INV-{1024 + i}</span>
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] text-emerald-600">Paid</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MockAndroidApp({ project }: { project: ProjectMeta | undefined }) {
  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-primary/15 to-transparent px-4 pt-4 pb-3">
        <div className="text-[10px] text-muted-foreground">{project?.stack}</div>
        <div className="text-base font-semibold">{project?.name ?? "App"}</div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-16">
        <div className="mb-2 rounded-xl border border-border bg-card p-2.5">
          <div className="text-[9px] text-muted-foreground">Today</div>
          <div className="mt-0.5 text-sm font-semibold">12.4 km</div>
          <div className="mt-2 flex h-12 items-end gap-1">
            {[30, 50, 70, 90, 60, 80, 100].map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-primary/60" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
        <div className="space-y-2">
          {["Forest Loop", "Ridge Trail", "Lake Path"].map((t, i) => (
            <div key={t} className="flex items-center gap-2 rounded-xl border border-border bg-card p-2">
              <div className="h-8 w-8 rounded-lg bg-primary/15" />
              <div className="flex-1 min-w-0">
                <div className="truncate text-[10px] font-medium">{t}</div>
                <div className="text-[8px] text-muted-foreground">{4.2 + i} km · {["Easy", "Mod", "Hard"][i]}</div>
              </div>
              <span className="text-[8px] text-emerald-600">★ {4.5 + i * 0.1}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-around border-t border-border bg-card py-2">
        {["Home", "Maps", "Trails", "Me"].map((t, i) => (
          <div key={t} className={cn("text-[9px]", i === 0 ? "text-primary font-medium" : "text-muted-foreground")}>
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}
