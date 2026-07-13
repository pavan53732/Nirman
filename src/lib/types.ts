// Domain types for Pavan — autonomous AI software creator

export type ProjectKind =
  | "windows"
  | "web"
  | "android"
  | "api"
  | "service"
  | "library"
  | "cli"
  | "ai-agent"
  | "plugin"
  | "sdk"
  | "game"
  | "automation"
  | "auto";

/** A single generation target within a project (multi-target aware). */
export interface TargetSpec {
  id: string;
  kind: ProjectKind;
  label: string; // e.g. "Desktop App", "Android Companion", "Web Admin Portal"
  role: string; // what this target does in the solution
  stack: string; // chosen toolchain, e.g. "WinUI 3 + .NET 8"
}

export interface ProjectMeta {
  id: string;
  name: string;
  kind: ProjectKind; // primary kind (for badges)
  stack: string; // primary stack (for the header badge)
  description: string;
  createdAt: string;
  prompt: string; // original natural-language requirement
  targets: TargetSpec[]; // one or more generation targets
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  streaming?: boolean;
  activity?: string;
}

export type StageId =
  | "analyze"
  | "plan"
  | "architect"
  | "generate"
  | "build"
  | "test"
  | "package"
  | "ready";

export type StageStatus = "pending" | "running" | "done" | "failed";

export interface PipelineStage {
  id: StageId;
  label: string;
  description: string;
  status: StageStatus;
  detail?: string;
  durationMs?: number;
}

export interface Artifact {
  id: string;
  name: string;
  kind: "app" | "installer" | "package" | "docs" | "source";
  platform: string; // e.g. Windows, Web, Android
  targetId?: string; // which generation target this belongs to
  sizeLabel: string;
  ready: boolean;
  url?: string;
}

export interface LogLine {
  id: string;
  ts: string;
  level: "debug" | "info" | "warn" | "error" | "success";
  source: string;
  message: string;
}

export interface ModelProvider {
  id: string;
  name: string;
  type: "local" | "remote";
  model: string;
  status: "connected" | "disconnected";
}

export interface AISettings {
  providerId: string;
  model: string;
  autonomy: "guided" | "autonomous" | "supervised";
  autoDetectKind: boolean;
  selfHeal: boolean;
  generateTests: boolean;
  generateDocs: boolean;
  offlineFirst: boolean;
}

export type PreviewTarget = "web" | "windows" | "android";

/** ---- Capability domain catalog ---- */

export type AgentRole =
  | "orchestrator"
  | "planner"
  | "architect"
  | "selector"
  | "coder"
  | "reviewer"
  | "tester"
  | "debugger"
  | "builder"
  | "docs";

export interface Agent {
  id: AgentRole;
  name: string; // persona name, e.g. "Atlas"
  role: string; // human label, e.g. "Planner"
  icon: string; // lucide icon key
  color: string; // tailwind tint token
  description: string;
  skills: number; // count of owned skills (derived)
}

export interface Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  agent: AgentRole; // primary owning agent
  tags?: string[];
}

export interface SkillCategory {
  id: string;
  name: string;
  icon: string; // lucide icon key
  description: string;
}
