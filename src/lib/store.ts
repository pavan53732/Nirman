import { create } from "zustand";
import type {
  ProjectMeta,
  ChatMessage,
  PipelineStage,
  Artifact,
  LogLine,
  AISettings,
  PreviewTarget,
  StageId,
  TargetSpec,
  ProjectKind,
} from "./types";
import {
  initialStages,
  seedProviders,
  defaultSettings,
  seedProjects,
  seedChat,
  seedLogs,
  stageOrder,
  stageDetails,
  makeArtifacts,
} from "./mock-data";
import { orchestrator, detectTargets, detectNonFunctionals, executionEngine, checkpointManager } from "./engine";

interface AppState {
  // data
  projects: ProjectMeta[];
  activeProjectId: string;
  chat: ChatMessage[];
  stages: PipelineStage[];
  artifacts: Artifact[];
  logs: LogLine[];
  providers: typeof seedProviders;
  settings: AISettings;
  previewTarget: PreviewTarget;
  previewReady: boolean;
  hotReloading: boolean;

  // ui
  settingsOpen: boolean;
  logsOpen: boolean;
  capabilitiesOpen: boolean;
  exportOpen: boolean;
  isBuilding: boolean;
  input: string;
  streaming: boolean;
  currentWorkflowId: string | null;
  lastCheckpointStage: string | null;

  // actions
  setActiveProject: (id: string) => void;
  setInput: (v: string) => void;
  addMessage: (m: ChatMessage) => void;
  appendToMessage: (id: string, chunk: string) => void;
  finalizeMessage: (id: string) => void;
  setStreaming: (v: boolean) => void;
  startBuild: (prompt: string) => void;
  setStage: (id: StageId, patch: Partial<PipelineStage>) => void;
  resetStages: () => void;
  advanceStage: () => void;
  setArtifactsReady: (ready: boolean) => void;
  setPreviewTarget: (t: PreviewTarget) => void;
  setPreviewReady: (v: boolean) => void;
  setHotReloading: (v: boolean) => void;
  addLog: (level: LogLine["level"], source: string, message: string) => void;
  updateSettings: (patch: Partial<AISettings>) => void;
  setSettingsOpen: (v: boolean) => void;
  setLogsOpen: (v: boolean) => void;
  setCapabilitiesOpen: (v: boolean) => void;
  setExportOpen: (v: boolean) => void;
  setLastCheckpointStage: (s: string | null) => void;
  exportProject: (targetPath: string) => Promise<{ ok: boolean; message: string }>;
  resumeFromCrash: () => Promise<boolean>;
  addProject: (p: ProjectMeta) => void;
  clearChat: () => void;
}

let logCounter = 1000;

function primaryPreviewTarget(targets: TargetSpec[]): PreviewTarget {
  const k = targets[0]?.kind;
  if (k === "android") return "android";
  if (k === "web") return "web";
  return "windows";
}

export const useApp = create<AppState>((set, get) => ({
  projects: [], // No seed projects — starts empty, populated by real builds
  activeProjectId: "",
  chat: seedChat,
  stages: initialStages.map((s) => ({ ...s })),
  artifacts: [], // No fake artifacts — populated by real generation
  logs: seedLogs,
  providers: seedProviders,
  settings: defaultSettings,
  previewTarget: "windows",
  previewReady: false,
  hotReloading: false,

  settingsOpen: false,
  logsOpen: false,
  capabilitiesOpen: false,
  exportOpen: false,
  isBuilding: false,
  input: "",
  streaming: false,
  currentWorkflowId: null,
  lastCheckpointStage: null,

  setActiveProject: (id) =>
    set((s) => {
      const p = s.projects.find((x) => x.id === id);
      if (!p) return {};
      return {
        activeProjectId: id,
        artifacts: makeArtifacts(p.name, p.kind, p.targets),
        previewTarget: primaryPreviewTarget(p.targets),
        previewReady: false,
      };
    }),

  setInput: (v) => set({ input: v }),

  addMessage: (m) => set((s) => ({ chat: [...s.chat, m] })),
  appendToMessage: (id, chunk) =>
    set((s) => ({
      chat: s.chat.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
    })),
  finalizeMessage: (id) =>
    set((s) => ({
      chat: s.chat.map((m) => (m.id === id ? { ...m, streaming: false } : m)),
    })),
  setStreaming: (v) => set({ streaming: v }),

  startBuild: (prompt) => {
    const state = get();
    // Use the orchestrator's requirement reasoning (Decision Engine + Capability
    // Detection). The engine selects a workflow, detects multi-targets, writes
    // Requirements/Decision/Architecture memory, and submits a task DAG to the
    // Execution Engine (parallel, dependency-scheduled, with quality gates).
    const detected = detectTargets(prompt);
    const targets: TargetSpec[] = detected.map((t, i) => ({
      id: `t${i + 1}`,
      kind: t.kind as ProjectKind,
      label: t.label,
      role: t.role,
      stack: t.stack,
    }));
    const primaryKind = (targets[0]?.kind ?? "web") as ProjectKind;
    const primaryStack = targets[0]?.stack ?? "TypeScript";
    const name = inferName(prompt) || "New Project";
    const targetSummary =
      targets.length > 1
        ? `${targets.length} targets: ${targets.map((t) => t.label).join(", ")}`
        : `${primaryStack}`;

    const project: ProjectMeta = {
      id: `proj-${Date.now()}`,
      name,
      kind: state.settings.autoDetectKind ? primaryKind : "auto",
      stack: primaryStack,
      description: prompt.slice(0, 120),
      createdAt: new Date().toISOString(),
      prompt,
      targets,
    };

    // Run the orchestrator (async: submits DAG to execution engine after
    // materializing generated files to the on-disk workspace).
    void (async () => {
      let result;
      try {
        result = await orchestrator.startBuild(prompt, project.id);
      } catch (err) {
        get().addLog("error", "orchestrator", `startBuild failed: ${String(err)}`);
        console.error("[Pavan] orchestrator.startBuild failed:", err);
        return;
      }

      // Autonomy gate: if ambiguous, surface the question and don't start.
      if (result.pendingQuestion) {
        set((s) => ({
          projects: [project, ...s.projects],
          activeProjectId: project.id,
          artifacts: makeArtifacts(name, primaryKind, targets),
          previewReady: false,
          isBuilding: false,
          previewTarget: primaryPreviewTarget(targets),
          currentWorkflowId: result.workflow.id,
        }));
        get().addLog("info", "orchestrator", `New project: ${name} · ${targetSummary}`);
        get().addLog("warn", "ambiguity-detector", `Ambiguity score ${result.ambiguityScore.toFixed(2)} > 0.75 — asking user before proceeding.`);
        get().addMessage({
          id: `sys-q-${Date.now()}`,
          role: "system",
          content: `Clarification needed: ${result.pendingQuestion}`,
          timestamp: Date.now(),
        });
        return;
      }

      set((s) => ({
        projects: [project, ...s.projects],
        activeProjectId: project.id,
        artifacts: makeArtifacts(name, primaryKind, targets),
        previewReady: false,
        isBuilding: true,
        previewTarget: primaryPreviewTarget(targets),
        currentWorkflowId: result.workflow.id,
      }));
      set({
        stages: initialStages.map((st, i) => ({
          ...st,
          status: i === 0 ? "running" : "pending",
          detail: undefined,
          durationMs: undefined,
        })),
      });
      get().addLog("info", "orchestrator", `New project: ${name} · ${targetSummary}`);
      get().addLog("info", "workflow-engine", `Workflow: ${result.workflow.name} · ${result.tasks.length} tasks compiled`);
      get().addLog("info", "ambiguity-detector", `Ambiguity score ${result.ambiguityScore.toFixed(2)} (threshold 0.75) — proceeding autonomously`);
      if (result.capabilities.length > 0) {
        get().addLog("info", "decision-engine", `Capabilities detected: ${result.capabilities.join(", ")}`);
      }
      const nfs = detectNonFunctionals(prompt);
      if (nfs.length > 0) {
        get().addLog("info", "decision-engine", `Non-functionals: ${nfs.join(", ")}`);
      }
      targets.forEach((t) =>
        get().addLog("info", "selector", `Selected ${t.stack} for ${t.label}`)
      );
      result.decisions.slice(0, 6).forEach((d) =>
        get().addLog("info", "decision-engine", `${d.topic} → ${d.chosen} (${Math.round(d.confidence * 100)}%)`)
      );
      if (result.generatedFiles > 0) {
        get().addLog("success", "desktop-generator", `Generated ${result.generatedFiles} source files across ${targets.length} target(s)`);
      }
    })();
  },

  setStage: (id, patch) =>
    set((s) => ({
      stages: s.stages.map((st) => (st.id === id ? { ...st, ...patch } : st)),
    })),

  resetStages: () =>
    set({ stages: initialStages.map((s) => ({ ...s, status: "pending", detail: undefined, durationMs: undefined })) }),

  advanceStage: () => {
    const state = get();
    const stages = state.stages;
    const currentIdx = stages.findIndex((s) => s.status === "running");
    const nextIdx = stages.findIndex((s) => s.status === "pending");

    const updated = stages.map((s) => ({ ...s }));
    if (currentIdx >= 0) {
      updated[currentIdx] = {
        ...updated[currentIdx],
        status: "done",
        // Real duration from engine — no Math.random
        durationMs: executionEngine.getStageTiming?.(updated[currentIdx].id) ?? 0,
        detail: undefined, // real task output comes from engine events
      };
    }
    if (nextIdx >= 0) {
      updated[nextIdx] = { ...updated[nextIdx], status: "running" };
      get().addLog("info", updated[nextIdx].id, `${updated[nextIdx].label}: ${updated[nextIdx].description}`);
    } else {
      get().setArtifactsReady(true);
      get().setPreviewReady(true);
      get().addLog("success", "orchestrator", "All stages complete. Deliverables ready.");
      set({ isBuilding: false });
    }
    set({ stages: updated });
  },

  setArtifactsReady: (ready) =>
    set((s) => ({ artifacts: s.artifacts.map((a) => ({ ...a, ready })) })),

  setPreviewTarget: (t) => set({ previewTarget: t }),
  setPreviewReady: (v) => set({ previewReady: v }),
  setHotReloading: (v) => set({ hotReloading: v }),

  addLog: (level, source, message) =>
    set((s) => ({
      logs: [
        ...s.logs.slice(-150),
        {
          id: `l-${logCounter++}`,
          ts: new Date().toLocaleTimeString("en-GB"),
          level,
          source,
          message,
        },
      ],
    })),

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setLogsOpen: (v) => set({ logsOpen: v }),
  setCapabilitiesOpen: (v) => set({ capabilitiesOpen: v }),
  setExportOpen: (v) => set({ exportOpen: v }),
  setLastCheckpointStage: (s) => set({ lastCheckpointStage: s }),

  exportProject: async (targetPath) => {
    const state = get();
    const active = state.projects.find((p) => p.id === state.activeProjectId);
    if (!active) return { ok: false, message: "No active project." };
    get().addLog("info", "export-manager", `Export workflow started → ${targetPath}`);
    // The Export Manager assembles /backend /desktop /android /web-admin /docs
    // /artifacts + DecisionLog.json from the Artifact Registry and writes to the
    // chosen folder. On web, prefer File System Access API; fall back to zip.
    try {
      const { exportSolution } = await import("./export");
      const result = await exportSolution(active, targetPath);
      get().addLog("success", "export-manager", result.message);
      return result;
    } catch (err) {
      const msg = `Export failed: ${String(err)}`;
      get().addLog("error", "export-manager", msg);
      return { ok: false, message: msg };
    }
  },

  addProject: (p) => set((s) => ({ projects: [p, ...s.projects], activeProjectId: p.id })),
  clearChat: () => set({ chat: seedChat }),

  resumeFromCrash: async () => {
    // Restore the latest checkpoint from IndexedDB (survives crashes/reloads,
    // unlike the in-memory copy). If found, mark stages up to the checkpoint
    // as done and resume from the next stage.
    const r = await checkpointManager.restoreFromIDB();
    if (!r) {
      get().addLog("info", "orchestrator", "No persisted checkpoint found in IndexedDB.");
      return false;
    }
    const stageIds = stageOrder;
    const resumeIdx = stageIds.indexOf(r.stageId as StageId);
    const stages = initialStages.map((st, i) => {
      if (i < resumeIdx) return { ...st, status: "done" as const, durationMs: 1000, detail: undefined };
      if (i === resumeIdx) return { ...st, status: "running" as const, detail: undefined, durationMs: undefined };
      return { ...st, status: "pending" as const, detail: undefined, durationMs: undefined };
    });
    set({ stages, isBuilding: true, lastCheckpointStage: r.stageId });
    get().addLog("success", "orchestrator", `Resumed from IndexedDB checkpoint at "${r.stageId}" — continuing build.`);
    return true;
  },
}));

/* ---------------- Requirement reasoning ---------------- */

/**
 * Detect one or more generation targets from a natural-language prompt.
 * The engine reasons about intent and selects an appropriate toolchain per
 * target rather than hard-coding "Windows", "Web", or "Android".
 */
function inferTargets(prompt: string): TargetSpec[] {
  const p = " " + prompt.toLowerCase() + " ";
  const targets: TargetSpec[] = [];
  let n = 0;
  const next = () => `t${++n}`;

  const wantsWindows = /\b(windows|desktop|winui|wpf|winforms|win32|\.net\s*(desktop|app))\b/.test(p);
  const wantsAndroid = /\b(android|mobile( app)?|kotlin|flutter|play store|companion app|phone app)\b/.test(p);
  const wantsWeb = /\b(web( site| app| admin| portal)?|website|landing|marketing site|saas|portal|browser)\b/.test(p);
  const wantsApi = /\b(api|rest( api)?|graphql|backend service|microservice|endpoints?)\b/.test(p);
  const wantsCli = /\b(cli|command.line|terminal tool|brew install|cargo install)\b/.test(p);
  const wantsAgent = /\b(ai agent|autonomous agent|assistant service|chatbot|support agent)\b/.test(p);
  const wantsLibrary = /\b(library|sdk|npm package|crate|publish a package)\b/.test(p);
  const wantsGame = /\b(game|unity|godot|2d platformer|3d game)\b/.test(p);

  // Label targets by context if multiple
  const multi = [wantsWindows, wantsAndroid, wantsWeb, wantsApi, wantsCli, wantsAgent, wantsLibrary, wantsGame].filter(Boolean).length > 1;

  if (wantsWindows) {
    targets.push({
      id: next(),
      kind: "windows",
      label: multi ? "Desktop App" : "App",
      role: multi ? "Primary desktop workspace" : "Windows desktop application",
      stack: pickWindowsStack(p),
    });
  }
  if (wantsAndroid) {
    targets.push({
      id: next(),
      kind: "android",
      label: multi ? "Android Companion" : "App",
      role: multi ? "Mobile companion app" : "Android application",
      stack: pickAndroidStack(p),
    });
  }
  if (wantsWeb) {
    targets.push({
      id: next(),
      kind: "web",
      label: multi ? "Web Portal" : "App",
      role: multi ? "Web admin portal" : "Web application",
      stack: pickWebStack(p),
    });
  }
  if (wantsApi) {
    targets.push({
      id: next(),
      kind: "api",
      label: "API Service",
      role: "Backend API and data layer",
      stack: pickApiStack(p),
    });
  }
  if (wantsCli) {
    targets.push({
      id: next(),
      kind: "cli",
      label: "CLI Tool",
      role: "Command-line utility",
      stack: pickCliStack(p),
    });
  }
  if (wantsAgent) {
    targets.push({
      id: next(),
      kind: "ai-agent",
      label: "AI Agent",
      role: "Autonomous agent service",
      stack: "Python + LangGraph",
    });
  }
  if (wantsLibrary) {
    targets.push({
      id: next(),
      kind: "library",
      label: "Library",
      role: "Reusable library / SDK",
      stack: /\b(rust|crate)\b/.test(p) ? "Rust crate" : "TypeScript library",
    });
  }
  if (wantsGame) {
    targets.push({
      id: next(),
      kind: "game",
      label: "Game",
      role: "Interactive game",
      stack: "Godot + GDScript",
    });
  }

  if (targets.length === 0) {
    // default: a web application
    targets.push({
      id: next(),
      kind: "web",
      label: "Web App",
      role: "Web application",
      stack: pickWebStack(p),
    });
  }
  return targets;
}

function pickWindowsStack(p: string): string {
  if (/\btauri\b/.test(p)) return "Tauri + Rust";
  if (/\belectron\b/.test(p)) return "Electron + TypeScript";
  if (/\bavalonia\b/.test(p)) return "Avalonia + C#";
  if (/\b(winforms|windows forms)\b/.test(p)) return "WinForms + .NET 8";
  if (/\bwpf\b/.test(p)) return "WPF + .NET 8";
  return "WinUI 3 + .NET 8";
}
function pickAndroidStack(p: string): string {
  if (/\b(flutter|dart)\b/.test(p)) return "Flutter + Kotlin modules";
  if (/\breact native\b/.test(p)) return "React Native + TypeScript";
  return "Kotlin + Jetpack Compose";
}
function pickWebStack(p: string): string {
  if (/\b(wordpress|cms)\b/.test(p)) return "Next.js + Headless CMS";
  if (/\bvue\b/.test(p)) return "Nuxt + Vue";
  return "Next.js + Node.js";
}
function pickApiStack(p: string): string {
  if (/\b(fastapi|python)\b/.test(p)) return "FastAPI + PostgreSQL";
  if (/\b(spring|java|kotlin)\b/.test(p)) return "Spring Boot + PostgreSQL";
  if (/\b(dotnet|c#|asp\.net)\b/.test(p)) return "ASP.NET Core + EF Core";
  return "Node.js + Fastify + Prisma";
}
function pickCliStack(p: string): string {
  if (/\b(rust|cargo)\b/.test(p)) return "Rust + clap";
  if (/\b(go\b|golang)\b/.test(p)) return "Go + cobra";
  return "TypeScript + Commander";
}

function inferName(prompt: string): string {
  let trimmed = prompt.trim().toLowerCase();
  let prev = "";
  while (prev !== trimmed) {
    prev = trimmed;
    trimmed = trimmed.replace(
      /^(build|build me|create|make|generate|develop|i want|i need|please|a|an|the|me|some)\s+/i,
      ""
    );
  }
  const stopwords = new Set([
    "in", "that", "with", "for", "to", "and", "of", "on", "using", "via",
    "which", "from", "into", "where", "when", "app", "application", "as",
    "companion", "portal", "admin", "me",
  ]);
  const words: string[] = [];
  for (const w of trimmed.split(/\s+/).filter(Boolean)) {
    if (stopwords.has(w)) break;
    words.push(w);
    if (words.length >= 3) break;
  }
  if (words.length === 0) return "New Project";
  const acronyms = new Set(["cli", "ai", "api", "sdk", "saas", "ui", "ux", "ios", "ml", "crm", "cms", "erp", "hrm"]);
  const name = words
    .map((w) => (acronyms.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim();
  return name || "New Project";
}

export { stageOrder };
