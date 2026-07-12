import type {
  ProjectMeta,
  PipelineStage,
  Artifact,
  LogLine,
  ModelProvider,
  AISettings,
  ChatMessage,
  StageId,
} from "./types";

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
  "analyze",
  "plan",
  "architect",
  "generate",
  "build",
  "test",
  "package",
  "ready",
];

export const seedProviders: ModelProvider[] = [
  { id: "prov-remote", name: "Pavan Cloud", type: "remote", model: "pavan-orion-1", status: "connected" },
  { id: "prov-local", name: "Local Runtime", type: "local", model: "qwen2.5-coder-32b", status: "connected" },
  { id: "prov-embedded", name: "Offline Nano", type: "local", model: "phi-3.5-mini", status: "disconnected" },
];

export const defaultSettings: AISettings = {
  providerId: "prov-remote",
  model: "pavan-orion-1",
  autonomy: "autonomous",
  autoDetectKind: true,
  selfHeal: true,
  generateTests: true,
  generateDocs: true,
  offlineFirst: true,
};

export const seedProjects: ProjectMeta[] = [
  {
    id: "proj-invoicer",
    name: "Invoicer Desktop",
    kind: "windows",
    stack: "WinUI 3 + .NET 8",
    description: "Offline-first Windows invoicing app with PDF export & recurring invoices.",
    createdAt: "2025-01-12T09:14:00Z",
    prompt: "A Windows desktop invoicing app for small businesses. Offline-first, local encrypted storage, PDF export, multi-currency, recurring invoices, dashboard with charts.",
  },
  {
    id: "proj-pulse",
    name: "Pulse Analytics",
    kind: "web",
    stack: "Next.js + Node.js",
    description: "Real-time web analytics dashboard with event ingestion and cohorts.",
    createdAt: "2025-01-03T11:00:00Z",
    prompt: "Real-time web analytics SaaS. Event ingestion API, live dashboards, funnels, retention cohorts, team management, Stripe billing.",
  },
  {
    id: "proj-trailmate",
    name: "TrailMate",
    kind: "android",
    stack: "Flutter + Kotlin modules",
    description: "Hiking companion with offline maps and on-device AI trail recommendations.",
    createdAt: "2024-12-20T08:30:00Z",
    prompt: "Android hiking app. Offline topo maps, GPS trail recording, elevation profiles, community trails, on-device AI recommendations.",
  },
];

export const seedChat: ChatMessage[] = [
  {
    id: "sys-1",
    role: "system",
    content:
      "Pavan is online. Describe what you want to build in plain language — the engine will plan, architect, generate, build, test, and package it automatically. You never have to touch a code editor.",
    timestamp: Date.now() - 1000 * 60 * 5,
  },
];

export const starterSuggestions: { title: string; prompt: string; icon: string }[] = [
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
  {
    title: "Rust sync CLI",
    prompt:
      "A fast cross-platform CLI in Rust for synchronizing local files with S3-compatible storage, with checksums, retries, and parallel transfers.",
    icon: "terminal",
  },
  {
    title: "AI customer-support agent",
    prompt:
      "An AI customer-support agent service that connects to email and chat, retrieves from a knowledge base, drafts replies, and escalates uncertain cases to humans.",
    icon: "bot",
  },
  {
    title: "Marketing website",
    prompt:
      "A fast marketing website for a developer tools startup with a hero, feature grid, pricing, docs preview, and a blog. SEO-optimized and responsive.",
    icon: "megaphone",
  },
];

// Stage detail snippets shown in the status panel as the pipeline runs
export const stageDetails: Record<StageId, string[]> = {
  analyze: [
    "Detected intent: desktop application",
    "Constraints: offline-first, encrypted storage",
    "Target users: small businesses",
  ],
  plan: [
    "9 tasks across 5 agents",
    "Critical path: model → repository → PDF → tests",
    "Estimated 21h, parallelizable to ~9h",
  ],
  architect: [
    "Layered MVVM, SQLCipher persistence",
    "Modules: Invoicing, Customers, Payments, Dashboard, Sync",
    "Idempotency via composite keys",
  ],
  generate: [
    "WinUI 3 views + ViewModels scaffolded",
    "Domain entities & EF Core migrations",
    "Recurring invoice service implemented",
  ],
  build: [
    "Restored 42 packages",
    "Compiled solution (0 errors after auto-repair)",
    "1 build error auto-fixed by Debugger agent",
  ],
  test: [
    "Generated 38 xUnit cases",
    "37 passed, 1 flaky → re-ran green",
    "Coverage: 86%",
  ],
  package: [
    "MSIX bundle signed",
    "Portable .zip variant produced",
    "Installers staged for release",
  ],
  ready: [
    "Artifacts available for download",
    "Live preview running",
    "Ready to publish"],
};

export const seedLogs: LogLine[] = [
  { id: "l1", ts: "09:14:01", level: "info", source: "engine", message: "Pavan orchestration engine started" },
  { id: "l2", ts: "09:14:02", level: "success", source: "provider", message: "Connected to Pavan Cloud (pavan-orion-1)" },
  { id: "l3", ts: "09:14:03", level: "info", source: "memory", message: "Loaded 6 persistent memory entries" },
];

export function makeArtifacts(projectName: string, kind: string): Artifact[] {
  return [
    { id: "a1", name: `${projectName}-Setup.exe`, kind: "installer", platform: "Windows", sizeLabel: "84.2 MB", ready: false, url: "#" },
    { id: "a2", name: `${projectName}.msix`, kind: "installer", platform: "Windows", sizeLabel: "79.5 MB", ready: false, url: "#" },
    { id: "a3", name: `${projectName}-source.zip`, kind: "source", platform: "All", sizeLabel: "12.4 MB", ready: false, url: "#" },
    { id: "a4", name: `architecture.pdf`, kind: "docs", platform: "All", sizeLabel: "1.1 MB", ready: false, url: "#" },
  ];
}
