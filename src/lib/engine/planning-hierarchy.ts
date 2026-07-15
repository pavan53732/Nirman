// Planning Hierarchy — 4-level hierarchical planning for large projects.
//
// The reviewer said: "Planning hierarchy: Introduce planning at multiple
// levels: Project planner, Feature planner, Module planner, Task planner.
// That will make large projects much easier to manage."
//
// The existing single-level "planner" agent in `agent-handlers.ts` produces
// one flat plan string — too coarse for large multi-feature projects (e.g.
// "CRM with contacts, deals, pipeline, activities, reports"). This module
// introduces a systematic decomposition:
//
//   Level 1 — Project Planner : prompt → FEATURES
//   Level 2 — Feature Planner : feature → MODULES
//   Level 3 — Module Planner  : module → TASKS
//   Level 4 — Task Planner    : task → concrete TaskSpec (agent, deps, duration)
//
// Each level produces a plan that feeds the next level. The orchestrator can
// later consume `planFullHierarchy` to replace the single string plan with a
// structured DAG that maps directly onto Task records in the ExecutionEngine.
// For now this module is additive (no orchestrator/generator edits) — it
// exposes the hierarchy via `/api/debug/planning-hierarchy` so it can be
// validated independently before being wired into the executive layer.

/* ------------------------------------------------------------------ */
/* Plan node types — one per level                                     */
/* ------------------------------------------------------------------ */

export interface ProjectPlan {
  level: 1;
  projectName: string;
  prompt: string;
  features: FeaturePlan[];
  detectedTargets: string[];
  estimatedComplexity: "low" | "medium" | "high";
  createdAt: number;
}

export interface FeaturePlan {
  level: 2;
  featureName: string;
  description: string;
  parentProject: string;
  modules: ModulePlan[];
  estimatedTasks: number;
}

export interface ModulePlan {
  level: 3;
  moduleName: string;
  description: string;
  parentFeature: string;
  tasks: TaskSpec[];
}

export interface TaskSpec {
  level: 4;
  taskName: string;
  description: string;
  parentModule: string;
  agent: string; // which agent should execute this
  targetKey?: string; // web | windows | android
  dependencies: string[]; // other task names this depends on
  estimatedDurationMs: number;
}

/* ------------------------------------------------------------------ */
/* PlanningHierarchy — drives all 4 levels                             */
/* ------------------------------------------------------------------ */

export class PlanningHierarchy {
  /**
   * Level 1: Project Planner — decompose a project prompt into features.
   */
  planProject(prompt: string, targets: string[]): ProjectPlan {
    const features = this.decomposeIntoFeatures(prompt);
    const complexity = this.estimateComplexity(features.length, targets.length);
    const projectName = this.extractProjectName(prompt);
    // Stamp parentProject so the hierarchy is self-describing downstream.
    for (const f of features) f.parentProject = projectName;
    return {
      level: 1,
      projectName,
      prompt,
      features,
      detectedTargets: targets,
      estimatedComplexity: complexity,
      createdAt: Date.now(),
    };
  }

  /**
   * Level 2: Feature Planner — decompose a feature into modules.
   */
  planFeature(feature: FeaturePlan): FeaturePlan {
    feature.modules = this.decomposeIntoModules(feature.featureName, feature.description);
    feature.estimatedTasks = feature.modules.reduce((n, m) => n + m.tasks.length, 0);
    return feature;
  }

  /**
   * Level 3: Module Planner — decompose a module into tasks.
   */
  planModule(modulePlan: ModulePlan): ModulePlan {
    modulePlan.tasks = this.decomposeIntoTasks(modulePlan.moduleName, modulePlan.description);
    return modulePlan;
  }

  /**
   * Level 4: Task Planner — generate the concrete task spec.
   */
  planTask(task: TaskSpec): TaskSpec {
    task.agent = this.assignAgent(task.taskName);
    task.targetKey = this.inferTarget(task.taskName);
    task.estimatedDurationMs = this.estimateDuration(task.taskName);
    return task;
  }

  /**
   * Run the full hierarchy: Project → Features → Modules → Tasks.
   */
  planFullHierarchy(prompt: string, targets: string[]): ProjectPlan {
    const project = this.planProject(prompt, targets);
    for (const feature of project.features) {
      this.planFeature(feature);
      for (const modulePlan of feature.modules) {
        this.planModule(modulePlan);
        for (const task of modulePlan.tasks) {
          this.planTask(task);
        }
      }
    }
    return project;
  }

  /* ---------------------------------------------------------------- */
  /* Level 1 — feature detection (regex-driven, CRM-aware)            */
  /* ---------------------------------------------------------------- */

  private decomposeIntoFeatures(prompt: string): FeaturePlan[] {
    const features: FeaturePlan[] = [];
    const p = prompt.toLowerCase();

    // CRM domain features
    if (/contact/.test(p)) {
      features.push({
        level: 2,
        featureName: "Contact Management",
        description: "CRUD operations for contacts with name, email, phone",
        parentProject: "",
        modules: [],
        estimatedTasks: 0,
      });
    }
    if (/\bdeals?\b|opportunit(y|ies)/.test(p)) {
      features.push({
        level: 2,
        featureName: "Deal Tracking",
        description: "Sales pipeline with deal stages and values",
        parentProject: "",
        modules: [],
        estimatedTasks: 0,
      });
    }
    if (/pipeline/.test(p)) {
      features.push({
        level: 2,
        featureName: "Pipeline Management",
        description: "Visual sales pipeline with drag-and-drop stages",
        parentProject: "",
        modules: [],
        estimatedTasks: 0,
      });
    }
    if (/activit/.test(p)) {
      features.push({
        level: 2,
        featureName: "Activity Logging",
        description: "Track calls, emails, meetings per contact/deal",
        parentProject: "",
        modules: [],
        estimatedTasks: 0,
      });
    }
    if (/report|dashboard|analytics/.test(p)) {
      features.push({
        level: 2,
        featureName: "Reporting & Analytics",
        description: "Dashboard with KPIs, charts, and exportable reports",
        parentProject: "",
        modules: [],
        estimatedTasks: 0,
      });
    }
    if (/user|auth|login|account/.test(p)) {
      features.push({
        level: 2,
        featureName: "User Management & Auth",
        description: "User accounts, roles, permissions, authentication",
        parentProject: "",
        modules: [],
        estimatedTasks: 0,
      });
    }
    if (/invoice|billing|payment|subscription/.test(p)) {
      features.push({
        level: 2,
        featureName: "Billing & Invoicing",
        description: "Invoice generation, payment processing, subscriptions",
        parentProject: "",
        modules: [],
        estimatedTasks: 0,
      });
    }
    if (/notification|alert/.test(p)) {
      features.push({
        level: 2,
        featureName: "Notifications",
        description: "Email and push notifications for events",
        parentProject: "",
        modules: [],
        estimatedTasks: 0,
      });
    }

    // If no features detected, create a default CRUD feature
    if (features.length === 0) {
      features.push({
        level: 2,
        featureName: "Core CRUD",
        description: "Basic create-read-update-delete operations for the primary entity",
        parentProject: "",
        modules: [],
        estimatedTasks: 0,
      });
    }

    return features;
  }

  /* ---------------------------------------------------------------- */
  /* Level 2 — module decomposition (Model + API + UI + Auth)         */
  /* ---------------------------------------------------------------- */

  private decomposeIntoModules(featureName: string, description: string): ModulePlan[] {
    // Every feature gets: Model, API/Service, UI
    const modules: ModulePlan[] = [
      {
        level: 3,
        moduleName: `${featureName} - Data Model`,
        description: `Database schema and entity definitions for ${featureName}`,
        parentFeature: featureName,
        tasks: [],
      },
      {
        level: 3,
        moduleName: `${featureName} - API/Service Layer`,
        description: `Business logic and API endpoints for ${featureName}`,
        parentFeature: featureName,
        tasks: [],
      },
      {
        level: 3,
        moduleName: `${featureName} - UI Layer`,
        description: `User interface components and screens for ${featureName}`,
        parentFeature: featureName,
        tasks: [],
      },
    ];

    // Add auth module if feature is auth-related
    if (/auth|user|login/i.test(featureName)) {
      modules.push({
        level: 3,
        moduleName: `${featureName} - Auth Module`,
        description: `Authentication and authorization for ${featureName}`,
        parentFeature: featureName,
        tasks: [],
      });
    }

    void description; // reserved for future LLM-driven decomposition
    return modules;
  }

  /* ---------------------------------------------------------------- */
  /* Level 3 — task decomposition (per module kind)                   */
  /* ---------------------------------------------------------------- */

  private decomposeIntoTasks(moduleName: string, description: string): TaskSpec[] {
    const tasks: TaskSpec[] = [];
    const isDataModel = /Data Model/.test(moduleName);
    const isAPI = /API|Service/.test(moduleName);
    const isUI = /UI/.test(moduleName);
    const isAuth = /Auth/.test(moduleName);

    if (isDataModel) {
      tasks.push({
        level: 4,
        taskName: "Define entity schema",
        description: "Create the database model with fields and relationships",
        parentModule: moduleName,
        agent: "",
        dependencies: [],
        estimatedDurationMs: 0,
      });
      tasks.push({
        level: 4,
        taskName: "Create migration",
        description: "Generate database migration from schema",
        parentModule: moduleName,
        agent: "",
        dependencies: ["Define entity schema"],
        estimatedDurationMs: 0,
      });
    }
    if (isAPI) {
      tasks.push({
        level: 4,
        taskName: "Implement list endpoint",
        description: "GET /api/items - list all items with pagination",
        parentModule: moduleName,
        agent: "",
        dependencies: [],
        estimatedDurationMs: 0,
      });
      tasks.push({
        level: 4,
        taskName: "Implement create endpoint",
        description: "POST /api/items - create a new item",
        parentModule: moduleName,
        agent: "",
        dependencies: [],
        estimatedDurationMs: 0,
      });
      tasks.push({
        level: 4,
        taskName: "Implement update endpoint",
        description: "PUT /api/items/:id - update an item",
        parentModule: moduleName,
        agent: "",
        dependencies: [],
        estimatedDurationMs: 0,
      });
      tasks.push({
        level: 4,
        taskName: "Implement delete endpoint",
        description: "DELETE /api/items/:id - delete an item",
        parentModule: moduleName,
        agent: "",
        dependencies: [],
        estimatedDurationMs: 0,
      });
    }
    if (isUI) {
      tasks.push({
        level: 4,
        taskName: "Create list view",
        description: "List view with table/cards showing all items",
        parentModule: moduleName,
        agent: "",
        dependencies: [],
        estimatedDurationMs: 0,
      });
      tasks.push({
        level: 4,
        taskName: "Create detail view",
        description: "Detail view showing a single item",
        parentModule: moduleName,
        agent: "",
        dependencies: [],
        estimatedDurationMs: 0,
      });
      tasks.push({
        level: 4,
        taskName: "Create form view",
        description: "Create/edit form for the entity",
        parentModule: moduleName,
        agent: "",
        dependencies: [],
        estimatedDurationMs: 0,
      });
    }
    if (isAuth) {
      tasks.push({
        level: 4,
        taskName: "Implement login flow",
        description: "Login page and authentication logic",
        parentModule: moduleName,
        agent: "",
        dependencies: [],
        estimatedDurationMs: 0,
      });
      tasks.push({
        level: 4,
        taskName: "Implement session management",
        description: "JWT/session cookie management",
        parentModule: moduleName,
        agent: "",
        dependencies: [],
        estimatedDurationMs: 0,
      });
      tasks.push({
        level: 4,
        taskName: "Implement role-based access",
        description: "Role and permission checking",
        parentModule: moduleName,
        agent: "",
        dependencies: [],
        estimatedDurationMs: 0,
      });
    }

    void description; // reserved for future LLM-driven decomposition
    return tasks;
  }

  /* ---------------------------------------------------------------- */
  /* Level 4 — per-task agent / target / duration assignment           */
  /* ---------------------------------------------------------------- */

  private assignAgent(taskName: string): string {
    if (/schema|model|migration|entity/i.test(taskName)) return "frontend-generator";
    if (/endpoint|api|service/i.test(taskName)) return "frontend-generator";
    if (/view|form|page|screen|ui/i.test(taskName)) return "frontend-generator";
    if (/login|session|auth|role/i.test(taskName)) return "frontend-generator";
    if (/test/i.test(taskName)) return "test-generator";
    if (/build|compile/i.test(taskName)) return "build-engineer";
    return "frontend-generator";
  }

  private inferTarget(taskName: string): string | undefined {
    void taskName; // target is determined by the orchestrator, not the task
    return undefined;
  }

  private estimateDuration(taskName: string): number {
    if (/schema|model/i.test(taskName)) return 100;
    if (/endpoint|api/i.test(taskName)) return 200;
    if (/view|form|page|screen/i.test(taskName)) return 300;
    if (/login|auth/i.test(taskName)) return 400;
    return 150;
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                          */
  /* ---------------------------------------------------------------- */

  private extractProjectName(prompt: string): string {
    // Extract a project name from the prompt
    const match = prompt.match(
      /(?:build|create|make)\s+(?:me\s+)?(?:a\s+)?([\w\s]+?)(?:\s+app|\s+application|\s+system|\.|$)/i
    );
    if (match) return match[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
    return "Untitled Project";
  }

  private estimateComplexity(
    featureCount: number,
    targetCount: number
  ): "low" | "medium" | "high" {
    const score = featureCount * 2 + targetCount;
    if (score > 10) return "high";
    if (score > 5) return "medium";
    return "low";
  }

  /**
   * Get a summary of the full hierarchy for debugging.
   */
  getSummary(plan: ProjectPlan) {
    return {
      projectName: plan.projectName,
      complexity: plan.estimatedComplexity,
      targets: plan.detectedTargets,
      featureCount: plan.features.length,
      moduleCount: plan.features.reduce((n, f) => n + f.modules.length, 0),
      taskCount: plan.features.reduce(
        (n, f) => n + f.modules.reduce((m, mod) => m + mod.tasks.length, 0),
        0
      ),
      features: plan.features.map((f) => ({
        name: f.featureName,
        moduleCount: f.modules.length,
        taskCount: f.modules.reduce((n, m) => n + m.tasks.length, 0),
        modules: f.modules.map((m) => ({
          name: m.moduleName,
          taskCount: m.tasks.length,
          tasks: m.tasks.map((t) => t.taskName),
        })),
      })),
    };
  }
}

export const planningHierarchy = new PlanningHierarchy();
