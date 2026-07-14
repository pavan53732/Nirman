// Domain types for Pavan — autonomous AI software creator.
//
// The engine (`./engine/types.ts`) is the single source of truth for shared
// registry/pipeline types: AgentRole, StageId, StageStatus, SkillCategory,
// Skill, Agent, Capability, PlatformKind, TaskStatus, etc. This file
// re-exports those shared types so existing `@/lib/types` imports keep
// working, and defines the UI-only types that don't belong in the engine
// layer (ProjectMeta, ChatMessage, Artifact, LogLine, AISettings, …).

// Import the shared types locally so they can be referenced by the UI-only
// interfaces below (e.g. PipelineStage uses StageId + StageStatus), and
// re-export them so existing `@/lib/types` callers see no breakage.
import type {
  AgentRole,
  AgentLayer,
  Agent,
  StageId,
  StageStatus,
  SkillCategory,
  Skill,
  SkillId,
  Capability,
  PlatformKind,
  TaskStatus,
  GateId,
  WorkflowId,
} from "./engine/types";

export type {
  AgentRole,
  AgentLayer,
  Agent,
  StageId,
  StageStatus,
  SkillCategory,
  Skill,
  SkillId,
  Capability,
  PlatformKind,
  TaskStatus,
  GateId,
  WorkflowId,
} from "./engine/types";

/* ---------------- Project / UI domain ---------------- */

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
