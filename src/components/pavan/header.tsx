"use client";

import { useState } from "react";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Settings, ChevronDown, Plus, Bot, Sun, Moon, Layers, FolderOutput } from "lucide-react";
import { AISettingsDialog } from "@/components/pavan/ai-settings-dialog";
import { Badge } from "@/components/ui/badge";

const kindLabel: Record<string, string> = {
  windows: "Windows",
  web: "Web",
  android: "Android",
  api: "API",
  service: "Service",
  library: "Library",
  cli: "CLI",
  "ai-agent": "AI Agent",
  plugin: "Plugin",
  sdk: "SDK",
  game: "Game",
  automation: "Automation",
  auto: "Auto-detect",
};

export function Header() {
  const projects = useApp((s) => s.projects);
  const activeProjectId = useApp((s) => s.activeProjectId);
  const setActiveProject = useApp((s) => s.setActiveProject);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const settings = useApp((s) => s.settings);
  const providers = useApp((s) => s.providers);
  const setLogsOpen = useApp((s) => s.setLogsOpen);
  const setCapabilitiesOpen = useApp((s) => s.setCapabilitiesOpen);
  const setExportOpen = useApp((s) => s.setExportOpen);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);

  const active = projects.find((p) => p.id === activeProjectId) ?? projects[0];
  const activeProvider = providers.find((p) => p.id === settings.providerId);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/60 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Bot className="h-5 w-5" />
        </div>
        <div className="hidden sm:flex flex-col leading-tight">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Pavan
          </span>
          <span className="text-xs text-muted-foreground">Autonomous Software Creator</span>
        </div>

        <div className="mx-1 h-6 w-px bg-border hidden sm:block" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 px-2 font-medium">
              <span className="truncate max-w-[160px] sm:max-w-[240px]">{active?.name}</span>
              <ChevronDown className="h-4 w-4 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Projects
            </DropdownMenuLabel>
            {projects.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => setActiveProject(p.id)}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge variant="secondary" className="text-[10px] capitalize">
                    {kindLabel[p.kind] ?? p.kind}
                  </Badge>
                </div>
                <span className="text-[11px] text-muted-foreground">{p.stack}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                document.getElementById("chat-input")?.focus();
              }}
              className="gap-2 text-muted-foreground"
            >
              <Plus className="h-4 w-4" /> Start a new build from chat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Badge variant="outline" className="hidden md:inline-flex text-[11px] font-normal">
          {active?.stack}
        </Badge>
        {active && active.targets.length > 1 && (
          <Badge
            variant="secondary"
            className="hidden lg:inline-flex text-[10px] font-normal gap-1"
          >
            <Layers className="h-3 w-3" />
            {active.targets.length} targets
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 hidden md:flex"
          onClick={() => setCapabilitiesOpen(true)}
        >
          <Layers className="h-4 w-4" />
          <span className="text-xs">Capabilities</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 hidden sm:flex"
          onClick={() => setLogsOpen(true)}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
          <span className="text-xs text-muted-foreground">{activeProvider?.name}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            const next = theme === "dark" ? "light" : "dark";
            setTheme(next);
            document.documentElement.classList.toggle("dark", next === "dark");
          }}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setExportOpen(true)}
        >
          <FolderOutput className="h-4 w-4" />
          <span className="hidden sm:inline">Export</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setAiSettingsOpen(true)}
        >
          <Settings className="h-4 w-4" />
          <span className="hidden sm:inline">AI Settings</span>
        </Button>
      </div>
      <AISettingsDialog open={aiSettingsOpen} onOpenChange={setAiSettingsOpen} />
    </header>
  );
}
