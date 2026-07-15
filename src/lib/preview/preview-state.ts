// Preview State — the runtime state of the interactive preview.
//
// The preview is a simulated native app. It has:
//   - Current screen (list view, detail view, form view, dashboard)
//   - Form input values
//   - Selected item
//   - Data list (sample entities that can be added/edited/deleted)
//   - Navigation history
//
// This module is the single source of truth for the interactive preview's
// state. The interactive renderer (interactive-renderer.ts) is a PURE function
// of PreviewState -> HTML, and the interaction endpoint
// (api/preview/interact/route.ts) reduces actions against PreviewState using
// reducePreviewState(). State is held in a module-level store keyed by
// `${projectId}:${target}` so different projects / platforms don't collide.

export type PreviewScreen = "list" | "detail" | "form" | "dashboard";

export type PreviewTarget = "windows" | "android";

export interface PreviewEntity {
  id: string;
  name: string;
  email?: string;
  description?: string;
  quantity?: number;
  price?: number;
}

export interface PreviewState {
  target: PreviewTarget;
  currentScreen: PreviewScreen;
  entities: PreviewEntity[];
  selectedEntityId: string | null;
  formValues: Record<string, string>;
  navigationHistory: PreviewScreen[];
  lastAction: string | null;
  updatedAt: number;
}

/**
 * Create the initial preview state with sample data.
 */
export function createInitialState(target: PreviewTarget): PreviewState {
  return {
    target,
    currentScreen: "list",
    entities: [
      {
        id: "1",
        name: "John Doe",
        email: "john@example.com",
        description: "Sample contact",
        quantity: 1,
        price: 99.99,
      },
      {
        id: "2",
        name: "Jane Smith",
        email: "jane@example.com",
        description: "Another contact",
        quantity: 3,
        price: 49.99,
      },
      {
        id: "3",
        name: "Bob Wilson",
        email: "bob@example.com",
        description: "Third contact",
        quantity: 2,
        price: 149.99,
      },
    ],
    selectedEntityId: null,
    formValues: {},
    navigationHistory: ["list"],
    lastAction: null,
    updatedAt: Date.now(),
  };
}

export type PreviewAction =
  | { type: "navigate"; screen: PreviewScreen }
  | { type: "select"; entityId: string }
  | { type: "input"; field: string; value: string }
  | { type: "add" }
  | { type: "delete"; entityId: string }
  | { type: "save" }
  | { type: "back" };

/**
 * Reduce the preview state based on an action. Pure function — same input
 * always produces the same output, no side effects.
 */
export function reducePreviewState(
  state: PreviewState,
  action: PreviewAction,
): PreviewState {
  switch (action.type) {
    case "navigate":
      return {
        ...state,
        currentScreen: action.screen,
        navigationHistory: [...state.navigationHistory, action.screen],
        lastAction: `navigate:${action.screen}`,
        updatedAt: Date.now(),
      };

    case "select":
      return {
        ...state,
        selectedEntityId: action.entityId,
        currentScreen: "detail",
        navigationHistory: [...state.navigationHistory, "detail"],
        lastAction: `select:${action.entityId}`,
        updatedAt: Date.now(),
      };

    case "input":
      return {
        ...state,
        formValues: { ...state.formValues, [action.field]: action.value },
        lastAction: `input:${action.field}`,
        updatedAt: Date.now(),
      };

    case "add":
      return {
        ...state,
        currentScreen: "form",
        formValues: {},
        selectedEntityId: null,
        navigationHistory: [...state.navigationHistory, "form"],
        lastAction: "add",
        updatedAt: Date.now(),
      };

    case "delete": {
      const entities = state.entities.filter((e) => e.id !== action.entityId);
      return {
        ...state,
        entities,
        currentScreen: "list",
        selectedEntityId: null,
        lastAction: `delete:${action.entityId}`,
        updatedAt: Date.now(),
      };
    }

    case "save": {
      // Use the existing selected id (edit) or generate a new one (create).
      // The id generator uses max+1 so deletions don't collide with prior ids.
      const existingId = state.selectedEntityId;
      const id =
        existingId ??
        String(
          state.entities.reduce((max, e) => Math.max(max, parseInt(e.id, 10) || 0), 0) + 1,
        );
      const existing = state.entities.find((e) => e.id === id);
      const entity: PreviewEntity = {
        id,
        name: state.formValues.name || "Untitled",
        email: state.formValues.email,
        description: state.formValues.description,
        quantity: parseInt(state.formValues.quantity || "0", 10),
        price: parseFloat(state.formValues.price || "0"),
      };
      const entities = existing
        ? state.entities.map((e) => (e.id === id ? entity : e))
        : [...state.entities, entity];
      return {
        ...state,
        entities,
        currentScreen: "list",
        formValues: {},
        selectedEntityId: null,
        lastAction: "save",
        updatedAt: Date.now(),
      };
    }

    case "back": {
      const history = [...state.navigationHistory];
      history.pop(); // remove current
      const previous = history[history.length - 1] ?? "list";
      return {
        ...state,
        currentScreen: previous,
        navigationHistory: history,
        lastAction: "back",
        updatedAt: Date.now(),
      };
    }

    default:
      return state;
  }
}
