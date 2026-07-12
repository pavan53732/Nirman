import { create } from "zustand";
import type {
  Project,
  Agent,
  Task,
  FileNode,
  ChatMessage,
  MemoryEntry,
  Diagnostic,
  LogEntry,
  BuildStep,
  Plugin,
  ModelProvider,
  AgentRole,
  TaskStatus,
} from "./types";
import {
  seedProjects,
  seedAgents,
  seedTasks,
  seedFileTree,
  seedChat,
  seedMemory,
  seedDiagnostics,
  seedLogs,
  seedBuildSteps,
  seedPlugins,
  seedProviders,
} from "./mock-data";

export type ActivityView =
  | "explorer"
  | "search"
  | "git"
  | "agents"
  | "memory"
  | "architecture"
  | "plugins"
  | "prompt"
  | "providers"
  | "settings";

export type MainTab =
  | "code"
  | "architecture"
  | "tasks"
  | "preview"
  | "monitor"
  | "performance";

export type BottomTab = "terminal" | "build" | "diagnostics" | "logs";

interface IDEState {
  // Data
  projects: Project[];
  agents: Agent[];
  tasks: Task[];
  fileTree: FileNode[];
  chat: ChatMessage[];
  memory: MemoryEntry[];
  diagnostics: Diagnostic[];
  logs: LogEntry[];
  buildSteps: BuildStep[];
  plugins: Plugin[];
  providers: ModelProvider[];

  // UI state
  activeProjectId: string;
  activityView: ActivityView;
  mainTab: MainTab;
  bottomTab: BottomTab;
  activeFile: string;
  openFiles: string[];
  sidebarCollapsed: boolean;
  chatCollapsed: boolean;
  bottomCollapsed: boolean;
  selectedTaskId: string | null;
  isRunning: boolean;
  commandPaletteOpen: boolean;
  newProjectOpen: boolean;
  theme: "dark" | "light";
  previewTarget: "web" | "windows" | "android";

  // Actions
  setActiveProject: (id: string) => void;
  setActivityView: (v: ActivityView) => void;
  setMainTab: (t: MainTab) => void;
  setBottomTab: (t: BottomTab) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  toggleBottom: () => void;
  selectTask: (id: string | null) => void;
  addChatMessage: (m: ChatMessage) => void;
  appendToMessage: (id: string, chunk: string) => void;
  setMessageContent: (id: string, content: string) => void;
  moveTask: (taskId: string, status: TaskStatus) => void;
  addTask: (t: Task) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  togglePlugin: (id: string) => void;
  toggleMemoryPin: (id: string) => void;
  addMemory: (m: MemoryEntry) => void;
  setRunning: (v: boolean) => void;
  advanceBuild: () => void;
  resetBuild: () => void;
  setCommandPaletteOpen: (v: boolean) => void;
  setNewProjectOpen: (v: boolean) => void;
  setTheme: (t: "dark" | "light") => void;
  setPreviewTarget: (t: "web" | "windows" | "android") => void;
  addProject: (p: Project) => void;
  log: (level: LogEntry["level"], source: string, message: string) => void;
}

export const useIDE = create<IDEState>((set) => ({
  projects: seedProjects,
  agents: seedAgents,
  tasks: seedTasks,
  fileTree: seedFileTree,
  chat: seedChat,
  memory: seedMemory,
  diagnostics: seedDiagnostics,
  logs: seedLogs,
  buildSteps: seedBuildSteps,
  plugins: seedPlugins,
  providers: seedProviders,

  activeProjectId: "proj-1",
  activityView: "explorer",
  mainTab: "code",
  bottomTab: "build",
  activeFile: "src/Invoicing/RecurringInvoiceService.cs",
  openFiles: [
    "src/Invoicing/RecurringInvoiceService.cs",
    "src/Invoicing/InvoiceGenerator.cs",
    "tests/RecurringInvoiceServiceTests.cs",
    "docs/architecture.md",
  ],
  sidebarCollapsed: false,
  chatCollapsed: false,
  bottomCollapsed: false,
  selectedTaskId: null,
  isRunning: false,
  commandPaletteOpen: false,
  newProjectOpen: false,
  theme: "dark",
  previewTarget: "windows",

  setActiveProject: (id) =>
    set({ activeProjectId: id }),
  setActivityView: (v) =>
    set((s) => ({ activityView: s.activityView === v && !s.sidebarCollapsed ? s.activityView : v, sidebarCollapsed: false })),
  setMainTab: (t) => set({ mainTab: t }),
  setBottomTab: (t) => set({ bottomTab: t, bottomCollapsed: false }),
  openFile: (path) =>
    set((s) => ({
      activeFile: path,
      openFiles: s.openFiles.includes(path) ? s.openFiles : [...s.openFiles, path],
    })),
  closeFile: (path) =>
    set((s) => {
      const openFiles = s.openFiles.filter((p) => p !== path);
      const activeFile = s.activeFile === path ? openFiles[openFiles.length - 1] ?? "" : s.activeFile;
      return { openFiles, activeFile };
    }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleChat: () => set((s) => ({ chatCollapsed: !s.chatCollapsed })),
  toggleBottom: () => set((s) => ({ bottomCollapsed: !s.bottomCollapsed })),
  selectTask: (id) => set({ selectedTaskId: id }),
  addChatMessage: (m) => set((s) => ({ chat: [...s.chat, m] })),
  appendToMessage: (id, chunk) =>
    set((s) => ({
      chat: s.chat.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
    })),
  setMessageContent: (id, content) =>
    set((s) => ({
      chat: s.chat.map((m) => (m.id === id ? { ...m, content } : m)),
    })),
  moveTask: (taskId, status) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)) })),
  addTask: (t) => set((s) => ({ tasks: [...s.tasks, t] })),
  updateTask: (id, patch) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  togglePlugin: (id) =>
    set((s) => ({
      plugins: s.plugins.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    })),
  toggleMemoryPin: (id) =>
    set((s) => ({
      memory: s.memory.map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m)),
    })),
  addMemory: (m) => set((s) => ({ memory: [m, ...s.memory] })),
  setRunning: (v) => set({ isRunning: v }),
  advanceBuild: () =>
    set((s) => {
      const steps = [...s.buildSteps];
      const runningIdx = steps.findIndex((st) => st.status === "running");
      const pendingIdx = steps.findIndex((st) => st.status === "pending");
      if (runningIdx >= 0) {
        steps[runningIdx] = { ...steps[runningIdx], status: "success", duration: 3 + Math.random() * 5 };
      }
      if (pendingIdx >= 0) {
        steps[pendingIdx] = { ...steps[pendingIdx], status: "running" };
      }
      return { buildSteps: steps };
    }),
  resetBuild: () =>
    set((s) => ({
      buildSteps: s.buildSteps.map((st, i) => ({
        ...st,
        status: i === 0 ? "running" : "pending",
        duration: undefined,
      })),
      isRunning: true,
    })),
  setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
  setNewProjectOpen: (v) => set({ newProjectOpen: v }),
  setTheme: (t) => set({ theme: t }),
  setPreviewTarget: (t) => set({ previewTarget: t }),
  addProject: (p) => set((s) => ({ projects: [...s.projects, p], activeProjectId: p.id })),
  log: (level, source, message) =>
    set((s) => ({
      logs: [
        ...s.logs.slice(-200),
        {
          id: `l-${Date.now()}`,
          level,
          source,
          message,
          timestamp: new Date().toLocaleTimeString("en-GB"),
        },
      ],
    })),
}));

// Selectors / helpers
export const agentRoleMeta: Record<AgentRole, { label: string; icon: string; color: string }> = {
  planner: { label: "Planner", icon: "list-checks", color: "amber" },
  architect: { label: "Architect", icon: "drafting-compass", color: "emerald" },
  coder: { label: "Coder", icon: "code", color: "sky" },
  reviewer: { label: "Reviewer", icon: "scan-search", color: "violet" },
  tester: { label: "Tester", icon: "flask-conical", color: "rose" },
  debugger: { label: "Debugger", icon: "bug", color: "orange" },
  security: { label: "Security", icon: "shield-check", color: "red" },
  docs: { label: "Docs", icon: "book-open", color: "teal" },
  release: { label: "Release", icon: "package", color: "cyan" },
};

export const taskColumns: { id: TaskStatus; label: string; tint: string }[] = [
  { id: "backlog", label: "Backlog", tint: "zinc" },
  { id: "planning", label: "Planning", tint: "amber" },
  { id: "in-progress", label: "In Progress", tint: "emerald" },
  { id: "review", label: "Review", tint: "violet" },
  { id: "testing", label: "Testing", tint: "rose" },
  { id: "done", label: "Done", tint: "teal" },
];
