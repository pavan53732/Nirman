"use client";

import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Download,
  Play,
  Rocket,
  ScrollText,
  FileArchive,
  FileText,
  Package,
  Monitor,
  Globe,
  Smartphone,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function ArtifactsPanel() {
  const artifacts = useApp((s) => s.artifacts);
  const setLogsOpen = useApp((s) => s.setLogsOpen);
  const isBuilding = useApp((s) => s.isBuilding);
  const previewReady = useApp((s) => s.previewReady);
  const activeProjectId = useApp((s) => s.activeProjectId);
  const projects = useApp((s) => s.projects);
  const active = projects.find((p) => p.id === activeProjectId) ?? projects[0];

  const readyArtifacts = artifacts.filter((a) => a.ready);

  const handleDownload = (name: string) => {
    toast.success(`Preparing ${name}`, {
      description: "Your download will start momentarily.",
    });
  };

  const handleRun = () => {
    toast.info("Launching preview", {
      description: `Running ${active?.name} in the live preview above.`,
    });
  };

  const handlePublish = () => {
    toast.success("Publishing started", {
      description: "Pavan is preparing a release and will publish when ready.",
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Artifacts
        </span>
        <span className="text-[10px] text-muted-foreground">
          {readyArtifacts.length}/{artifacts.length} ready
        </span>
      </div>

      <div className="ide-scroll flex-1 min-h-0 overflow-y-auto px-3 py-3">
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <ActionButton
            icon={Play}
            label="Run"
            onClick={handleRun}
            disabled={isBuilding || !previewReady}
          />
          <ActionButton
            icon={Rocket}
            label="Publish"
            onClick={handlePublish}
            disabled={isBuilding || !previewReady}
            accent
          />
          <ActionButton
            icon={ScrollText}
            label="Logs"
            onClick={() => setLogsOpen(true)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          {artifacts.map((a) => (
            <button
              key={a.id}
              onClick={() => a.ready && handleDownload(a.name)}
              disabled={!a.ready}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition",
                a.ready
                  ? "border-border bg-card hover:border-primary/40 hover:bg-accent/50 cursor-pointer"
                  : "border-dashed border-border/60 bg-muted/30 opacity-60 cursor-not-allowed"
              )}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
                {a.ready ? (
                  <ArtifactIcon kind={a.kind} platform={a.platform} />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-[11px] font-medium">{a.name}</div>
                <div className="text-[9px] text-muted-foreground">
                  {a.platform} · {a.sizeLabel}
                </div>
              </div>
              {a.ready && <Download className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  accent,
}: {
  icon: typeof Download;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <Button
      variant={accent ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 flex-col gap-0.5 py-1 text-[10px]"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

function ArtifactIcon({ kind, platform }: { kind: string; platform: string }) {
  if (kind === "docs") return <FileText className="h-3.5 w-3.5 text-amber-500" />;
  if (kind === "source") return <FileArchive className="h-3.5 w-3.5 text-sky-500" />;
  if (platform === "Windows") return <Monitor className="h-3.5 w-3.5 text-violet-500" />;
  if (platform === "Web") return <Globe className="h-3.5 w-3.5 text-emerald-500" />;
  if (platform === "Android") return <Smartphone className="h-3.5 w-3.5 text-green-500" />;
  return <Package className="h-3.5 w-3.5 text-muted-foreground" />;
}
