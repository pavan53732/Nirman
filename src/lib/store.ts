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
  StageStatus,
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
  isBuilding: boolean;
  input: string;
  streaming: boolean;

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
  addProject: (p: ProjectMeta) => void;
  clearChat: () => void;
}

let logCounter = 1000;

export const useApp = create<AppState>((set, get) => ({
  projects: seedProjects,
  activeProjectId: seedProjects[0].id,
  chat: seedChat,
  stages: initialStages.map((s) => ({ ...s })),
  artifacts: makeArtifacts(seedProjects[0].name, seedProjects[0].kind),
  logs: seedLogs,
  providers: seedProviders,
  settings: defaultSettings,
  previewTarget: "windows",
  previewReady: false,
  hotReloading: false,

  settingsOpen: false,
  logsOpen: false,
  isBuilding: false,
  input: "",
  streaming: false,

  setActiveProject: (id) =>
    set((s) => {
      const p = s.projects.find((x) => x.id === id);
      return {
        activeProjectId: id,
        artifacts: p ? makeArtifacts(p.name, p.kind) : s.artifacts,
        previewTarget: p?.kind === "android" ? "android" : p?.kind === "web" ? "web" : "windows",
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
    const kind = inferKind(prompt);
    const stack = inferStack(kind, prompt);
    const name = inferName(prompt) || "New Project";
    const project: ProjectMeta = {
      id: `proj-${Date.now()}`,
      name,
      kind: state.settings.autoDetectKind ? kind : "auto",
      stack,
      description: prompt.slice(0, 120),
      createdAt: new Date().toISOString(),
      prompt,
    };
    set((s) => ({
      projects: [project, ...s.projects],
      activeProjectId: project.id,
      artifacts: makeArtifacts(name, kind),
      previewReady: false,
      isBuilding: true,
      previewTarget: kind === "android" ? "android" : kind === "web" ? "web" : "windows",
    }));
    // reset stages and immediately start the first one
    set({ stages: initialStages.map((st, i) => ({ ...st, status: i === 0 ? "running" : "pending", detail: undefined, durationMs: undefined })) });
    get().addLog("info", "engine", `New project: ${name} · ${stack}`);
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
        durationMs: 800 + Math.floor(Math.random() * 1600),
        detail: stageDetails[updated[currentIdx].id]?.[0],
      };
    }
    if (nextIdx >= 0) {
      updated[nextIdx] = { ...updated[nextIdx], status: "running" };
      get().addLog("info", updated[nextIdx].id, `${updated[nextIdx].label}: ${updated[nextIdx].description}`);
    } else {
      // all done
      get().setArtifactsReady(true);
      get().setPreviewReady(true);
      get().addLog("success", "engine", "All stages complete. Deliverables ready.");
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

  addProject: (p) => set((s) => ({ projects: [p, ...s.projects], activeProjectId: p.id })),
  clearChat: () => set({ chat: seedChat }),
}));

// Lightweight requirement reasoning — the engine picks a generator + toolchain.
function inferKind(prompt: string): ProjectMeta["kind"] {
  const p = prompt.toLowerCase();
  if (/(windows|desktop|winui|wpf|winforms|\.net\s*(desktop|app)|win32)/.test(p)) return "windows";
  if (/(android|mobile app|kotlin|flutter|play store)/.test(p)) return "android";
  if (/(cli|command.line|terminal tool|brew install|cargo install)/.test(p)) return "cli";
  if (/(api|rest|graphql|backend service|microservice)/.test(p)) return "api";
  if (/(library|sdk|package for|npm package|crate)/.test(p)) return "library";
  if (/(ai agent|autonomous agent|assistant service|chatbot)/.test(p)) return "ai-agent";
  if (/(game|unity|godot|2d platformer|3d)/.test(p)) return "game";
  if (/(automation|workflow|cron|batch|scrape)/.test(p)) return "automation";
  if (/(marketing site|landing page|website|blog|portfolio|saas)/.test(p)) return "web";
  return "web";
}

function inferStack(kind: ProjectMeta["kind"], prompt: string): string {
  const p = prompt.toLowerCase();
  switch (kind) {
    case "windows":
      if (/tauri/.test(p)) return "Tauri + Rust";
      if (/electron/.test(p)) return "Electron + TypeScript";
      if (/avalonia/.test(p)) return "Avalonia + C#";
      if (/(winforms|windows forms)/.test(p)) return "WinForms + .NET 8";
      if (/(wpf)/.test(p)) return "WPF + .NET 8";
      return "WinUI 3 + .NET 8";
    case "android":
      if (/(flutter|dart)/.test(p)) return "Flutter + Kotlin modules";
      return "Kotlin + Jetpack Compose";
    case "web":
      if (/(wordpress|cms)/.test(p)) return "Next.js + Headless CMS";
      return "Next.js + Node.js";
    case "cli":
      if (/(rust|cargo)/.test(p)) return "Rust + clap";
      if (/(go\b|golang)/.test(p)) return "Go + cobra";
      return "TypeScript + Commander";
    case "api":
      return "Node.js + Fastify + Prisma";
    case "library":
      if (/(rust|crate)/.test(p)) return "Rust crate";
      return "TypeScript library";
    case "ai-agent":
      return "Python + LangGraph";
    case "game":
      return "Godot + GDScript";
    case "automation":
      return "Node.js + Playwright";
    default:
      return "TypeScript";
  }
}

function inferName(prompt: string): string {
  // Strip leading filler words repeatedly (build, create, make, a, an, the, i want, i need)
  let trimmed = prompt.trim().toLowerCase();
  let prev = "";
  while (prev !== trimmed) {
    prev = trimmed;
    trimmed = trimmed.replace(
      /^(build|create|make|generate|develop|i want|i need|please|a|an|the|me|some)\s+/i,
      ""
    );
  }
  // Collect up to 3 meaningful words, stopping at common stopwords/prepositions
  const stopwords = new Set([
    "in", "that", "with", "for", "to", "and", "of", "on", "using", "via",
    "which", "from", "into", "where", "when", "app", "application", "as",
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
    .map((w) =>
      acronyms.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(" ")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim();
  return name || "New Project";
}

export { stageOrder };
