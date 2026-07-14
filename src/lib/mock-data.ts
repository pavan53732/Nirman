// Mock data has been removed. This file now contains only real structural
// definitions (pipeline stages, starter suggestions, artifact factory) —
// no fake providers, no fake logs, no fake projects, no pre-written text.

import type {
  PipelineStage,
  Artifact,
  LogLine,
  ModelProvider,
  AISettings,
  ChatMessage,
  StageId,
  TargetSpec,
} from "./types";

// 8-stage pipeline (structural — labels are real stage definitions, not mock data)
export const initialStages: PipelineStage[] = [
  { id: "analyze", label: "Understanding", description: "Parsing your requirements", status: "pending" },
  { id: "plan", label: "Planning", description: "Decomposing into an execution plan", status: "pending" },
  { id: "architect", label: "Architecture", description: "Designing modules & data flow", status: "pending" },
  { id: "generate", label: "Generating", description: "Writing the implementation", status: "pending" },
  { id: "build", label: "Building", description: "Compiling & self-healing errors", status: "pending" },
  { id: "test", label: "Testing", description: "Generating & running tests", status: "pending" },
  { id: "package", label: "Packaging", description: "Producing installers & artifacts", status: "pending" },
  { id: "ready", label: "Ready", description: "Deliverables available", status: "pending" },
];

export const stageOrder: StageId[] = [
  "analyze", "plan", "architect", "generate", "build", "test", "package", "ready",
];

// Starter suggestions — real prompt examples shown in the empty state
export const starterSuggestions: { title: string; prompt: string; icon: string }[] = [
  {
    title: "CRM + Android + web",
    prompt:
      "Build me a CRM desktop application with an Android companion app and a web admin portal. Contacts, deals, pipeline, sync, and a dashboard.",
    icon: "layers",
  },
  {
    title: "Windows invoicing app",
    prompt:
      "A Windows desktop invoicing app for small businesses. Offline-first, local encrypted storage, PDF export, multi-currency, recurring invoices, and a dashboard with charts.",
    icon: "monitor",
  },
  {
    title: "Real-time analytics SaaS",
    prompt:
      "A real-time web analytics SaaS with an event ingestion API, live dashboards, funnels, retention cohorts, team workspaces, and Stripe billing.",
    icon: "globe",
  },
  {
    title: "Android hiking companion",
    prompt:
      "An Android hiking app with offline topo maps, GPS trail recording, elevation profiles, community trails, and on-device AI recommendations.",
    icon: "smartphone",
  },
];

// Empty arrays — no fake data. Populated by real engine events.
export const seedProjects: never[] = [];
export const seedLogs: LogLine[] = [];
export const seedProviders: ModelProvider[] = [];
export const seedChat: ChatMessage[] = [
  {
    id: "sys-welcome",
    role: "system",
    content: "Describe what you want to build.",
    timestamp: Date.now(),
  },
];

// Default settings — no fake provider reference. Will be overridden by AI Settings.
export const defaultSettings: AISettings = {
  providerId: "",
  model: "",
  autonomy: "autonomous",
  autoDetectKind: true,
  selfHeal: true,
  generateTests: true,
  generateDocs: true,
  offlineFirst: true,
};

// Stage details — replaced with empty arrays. Real task output comes from
// the ExecutionEngine events, not pre-written strings.
export const stageDetails: Record<StageId, string[]> = {
  analyze: [],
  plan: [],
  architect: [],
  generate: [],
  build: [],
  test: [],
  package: [],
  ready: [],
};

// Artifact factory — real source bundles per target, no hardcoded sizes
export function makeArtifacts(projectName: string, _kind: string, targets: TargetSpec[]): Artifact[] {
  const arts: Artifact[] = [];
  const slug = projectName.replace(/[^a-zA-Z0-9]/g, "");
  for (const t of targets) {
    const folder = t.kind === "windows" ? "desktop" : t.kind === "android" ? "android" : t.kind === "web" ? "web-admin" : t.kind;
    arts.push({
      id: `a-${t.id}-src`,
      name: `${folder}-source.zip`,
      kind: "source",
      platform: t.kind === "windows" ? "Windows" : t.kind === "android" ? "Android" : "Web",
      targetId: t.id,
      sizeLabel: "—",
      ready: false,
      url: "#",
    });
  }
  arts.push({ id: "a-src", name: `${slug}-source.zip`, kind: "source", platform: "All", sizeLabel: "—", ready: false, url: "#" });
  arts.push({ id: "a-decisionlog", name: `DecisionLog.json`, kind: "docs", platform: "All", sizeLabel: "—", ready: false, url: "#" });
  return arts;
}

// Agent skill counts (derived from the engine data, not mock).
// The engine's `Agent` type exposes `consumes?: SkillId[]` (the inverse of
// `Skill.agent`). `engine/index.ts` already bootstraps `consumes` from the
// skill registry at module load; we re-derive it here too so the values are
// populated even when this module is imported before `@/lib/engine`
// bootstraps (e.g. SSR / first paint).
import { skills } from "./engine/data/skills";
import { agents } from "./engine/data/agents";

agents.forEach((a) => {
  a.consumes = skills
    .filter((s) => s.agent === a.role)
    .map((s) => s.id);
});
