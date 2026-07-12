// Minimal domain types for Pavan — autonomous AI software creator

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

export interface ProjectMeta {
  id: string;
  name: string;
  kind: ProjectKind;
  stack: string; // chosen by the engine, e.g. "WinUI 3 + .NET 8"
  description: string;
  createdAt: string;
  prompt: string; // original natural-language requirement
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  streaming?: boolean;
  // lightweight structured "behind the scenes" note attached to assistant turns
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
