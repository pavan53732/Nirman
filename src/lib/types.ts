// Core domain types for Pavan Full Stack App Builder

export type ProjectType =
  | "web"
  | "windows"
  | "android"
  | "library"
  | "cli"
  | "desktop-utility"
  | "ai-agent"
  | "local-service"
  | "plugin"
  | "sdk"
  | "game"
  | "installer"
  | "automation";

export type ProjectStack =
  | "WinUI 3"
  | "WPF"
  | "WinForms"
  | "Avalonia"
  | "Tauri"
  | "Electron"
  | "Win32"
  | ".NET"
  | "Rust"
  | "C++"
  | "C#"
  | "React"
  | "Next.js"
  | "Node.js"
  | "Kotlin"
  | "Flutter"
  | "Python"
  | "Go"
  | "TypeScript";

export type AgentRole =
  | "planner"
  | "architect"
  | "coder"
  | "reviewer"
  | "tester"
  | "debugger"
  | "security"
  | "docs"
  | "release";

export type AgentStatus = "idle" | "thinking" | "working" | "waiting" | "done" | "error";

export type TaskStatus = "backlog" | "planning" | "in-progress" | "review" | "testing" | "done";

export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  stacks: ProjectStack[];
  description: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  status: "initialized" | "planning" | "implementing" | "testing" | "ready" | "deployed";
  progress: number;
  requirements: string;
  repository?: string;
  branch: string;
  targetPlatform: string;
}

export interface Agent {
  id: string;
  role: AgentRole;
  name: string;
  status: AgentStatus;
  model: string;
  currentTask?: string;
  tokensUsed: number;
  tasksCompleted: number;
  lastActive: string;
  description: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedAgent?: AgentRole;
  projectId: string;
  subtasks?: { id: string; title: string; done: boolean }[];
  createdAt: string;
  estimateHours: number;
  tags: string[];
}

export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  path: string;
  language?: string;
  children?: FileNode[];
  status?: "clean" | "modified" | "added" | "staged";
  size?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "agent" | "system";
  agentRole?: AgentRole;
  content: string;
  timestamp: string;
  streaming?: boolean;
  actions?: { label: string; type: string }[];
}

export interface MemoryEntry {
  id: string;
  category: "architecture" | "decision" | "preference" | "context" | "pattern" | "constraint";
  title: string;
  content: string;
  confidence: number;
  createdAt: string;
  source: "user" | "agent" | "inferred";
  pinned: boolean;
}

export interface Diagnostic {
  id: string;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  file: string;
  line: number;
  column: number;
  code: string;
  rule?: string;
}

export interface LogEntry {
  id: string;
  level: "debug" | "info" | "warn" | "error" | "success";
  source: string;
  message: string;
  timestamp: string;
}

export interface BuildStep {
  id: string;
  label: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  duration?: number;
  log?: string;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  enabled: boolean;
  category: "provider" | "tool" | "mcp" | "template" | "integration";
  icon: string;
}

export interface ModelProvider {
  id: string;
  name: string;
  type: "local" | "remote";
  models: { id: string; name: string; context: string; capabilities: string[] }[];
  status: "connected" | "disconnected" | "error";
  endpoint?: string;
}
