"use client";

import { useApp } from "@/lib/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Cloud, HardDrive, Cpu, Zap, ShieldCheck, FlaskConical, BookOpen, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen);
  const setOpen = useApp((s) => s.setSettingsOpen);
  const settings = useApp((s) => s.settings);
  const providers = useApp((s) => s.providers);
  const update = useApp((s) => s.updateSettings);

  const activeProvider = providers.find((p) => p.id === settings.providerId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>AI Settings</DialogTitle>
          <DialogDescription>
            Configure the orchestration engine and model provider. The engine handles
            planning, code, builds, tests, and packaging automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2 max-h-[60vh] overflow-y-auto ide-scroll pr-1">
          {/* Provider */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-medium">Model Provider</Label>
            <Select
              value={settings.providerId}
              onValueChange={(v) => {
                const p = providers.find((x) => x.id === v);
                update({ providerId: v, model: p?.model ?? settings.model });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => {
                  const Icon = p.type === "remote" ? Cloud : p.id === "prov-local" ? Cpu : HardDrive;
                  return (
                    <SelectItem key={p.id} value={p.id} disabled={p.status === "disconnected"}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5" />
                        <span>{p.name}</span>
                        <span className="text-[10px] text-muted-foreground">{p.model}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {activeProvider && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    activeProvider.status === "connected" ? "bg-emerald-500" : "bg-zinc-400"
                  )}
                />
                {activeProvider.status === "connected" ? "Connected" : "Disconnected"} ·{" "}
                {activeProvider.type === "remote" ? "Remote inference" : "Local runtime"}
              </div>
            )}
          </div>

          {/* Autonomy */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Autonomy Level</Label>
              <Badge variant="secondary" className="text-[10px] capitalize">
                {settings.autonomy}
              </Badge>
            </div>
            <Select
              value={settings.autonomy}
              onValueChange={(v) => update({ autonomy: v as typeof settings.autonomy })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="guided">Guided — confirm each stage</SelectItem>
                <SelectItem value="autonomous">Autonomous — run end to end</SelectItem>
                <SelectItem value="supervised">Supervised — pause before release</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="h-px bg-border" />

          {/* Toggles */}
          <ToggleRow
            icon={Zap}
            label="Auto-detect project type"
            description="Let the engine choose Windows, web, Android, CLI, etc. from your description."
            checked={settings.autoDetectKind}
            onCheckedChange={(v) => update({ autoDetectKind: v })}
          />
          <ToggleRow
            icon={ShieldCheck}
            label="Self-healing builds"
            description="Automatically diagnose and repair build/test failures."
            checked={settings.selfHeal}
            onCheckedChange={(v) => update({ selfHeal: v })}
          />
          <ToggleRow
            icon={FlaskConical}
            label="Generate tests"
            description="Produce unit, integration, and edge-case tests automatically."
            checked={settings.generateTests}
            onCheckedChange={(v) => update({ generateTests: v })}
          />
          <ToggleRow
            icon={BookOpen}
            label="Generate documentation"
            description="Create READMEs, architecture docs, and API references."
            checked={settings.generateDocs}
            onCheckedChange={(v) => update({ generateDocs: v })}
          />
          <ToggleRow
            icon={WifiOff}
            label="Offline-first output"
            description="Generated apps work fully offline; network is enhancement-only."
            checked={settings.offlineFirst}
            onCheckedChange={(v) => update({ offlineFirst: v })}
          />

          <div className="h-px bg-border" />

          {/* Parallelism slider (cosmetic) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Agent parallelism</Label>
              <span className="text-[11px] tabular-nums text-muted-foreground">5 agents</span>
            </div>
            <Slider defaultValue={[5]} max={9} min={1} step={1} className="py-1" />
            <p className="text-[10px] text-muted-foreground">
              Number of specialist agents that may work concurrently.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  icon: typeof Zap;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium">{label}</span>
          <span className="text-[11px] text-muted-foreground leading-tight">{description}</span>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
