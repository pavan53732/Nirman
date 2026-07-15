# Task ID: X — preview-fidelity

Agent: Task-X (preview-fidelity)
Task: Add state, navigation, and interactions to the native preview engine

## Work Log

### Read (mandatory first steps)
- Read `/home/z/my-project/worklog.md` — full history. Confirmed Task R landed the static XAML + Compose renderers, native-preview.tsx, and the /api/preview/render endpoint. Reviewer asked for state + navigation + interactions on top of that static foundation.
- Read `/home/z/my-project/src/lib/preview/xaml-renderer.ts` — static WinUI→HTML renderer with its own mini XML parser. Left untouched per strict ownership rules.
- Read `/home/z/my-project/src/lib/preview/compose-renderer.ts` — static Compose→HTML renderer with Kotlin string-literal parser. Left untouched.
- Read `/home/z/my-project/src/components/pavan/native-preview.tsx` — was a one-shot fetch-and-render of the static preview. Replaced with an interactive version (kept the same props interface `target, projectId, refreshKey` so preview-panel.tsx needed no changes).
- Read `/home/z/my-project/src/app/api/preview/render/route.ts` — static render endpoint. Left untouched.
- Read `/home/z/my-project/src/lib/engine/index.ts` — confirmed no preview-related exports needed adding (preview-state and interactive-renderer live in `src/lib/preview/`, not `src/lib/engine/`).

### Created: `src/lib/preview/preview-state.ts`
- `PreviewScreen = "list" | "detail" | "form" | "dashboard"`
- `PreviewTarget = "windows" | "android"`
- `PreviewEntity` interface (id, name, email, description, quantity, price)
- `PreviewState` interface (target, currentScreen, entities, selectedEntityId, formValues, navigationHistory, lastAction, updatedAt)
- `createInitialState(target)` — 3 sample contacts (John/Jane/Bob)
- `PreviewAction` discriminated union: navigate, select, input, add, delete, save, back
- `reducePreviewState(state, action)` — pure reducer. Save generates id via `max(existing ids) + 1` so deletions don't collide with prior ids.

### Created: `src/lib/preview/interactive-renderer.ts`
- `renderInteractive(state)` → `{ html, css, state, availableActions }`
- Windows path: `win11-*` classes — list (toolbar + datagrid table with select links + delete buttons), detail (header + body card + edit button), form (2-col grid of fields with save/cancel), dashboard (stats + view-contacts button)
- Android path: `md3-*` classes — list (cards + FAB), detail (back button + detail card), form (5 fields + actions), dashboard (stats)
- All clickable elements carry `data-action` (and `data-entity-id` / `data-screen` / `data-input` where relevant) so the frontend can wire them via event delegation
- `escapeHtml` + `escapeAttr` helpers — form values are user-entered, so they MUST be escaped to prevent XSS when re-rendered (e.g. typing `<script>` in the name field and saving would otherwise inject script)
- `getAvailableActions(state)` — surface the named actions per screen (used by header strip + for testing)

### Created: `src/app/api/preview/interact/route.ts`
- `runtime = "nodejs"`, `dynamic = "force-dynamic"`
- Module-level `stateStore: Map<string, PreviewState>` keyed by `${projectId}:${target}` so different projects + platforms have independent state
- `GET ?target=X&projectId=Y[&reset=1]` — returns current rendered preview. `reset=1` re-initializes the state (used when refreshKey changes / project rebuilt)
- `POST { target, projectId?, action }` — validates target + action shape, reduces action against current state, stores new state, returns new rendered preview
- Type-narrowed `isPreviewTarget()` guard instead of unsafe cast
- Returns 400 for missing/invalid target or action shape, 500 for unexpected errors

### Modified: `src/components/pavan/native-preview.tsx`
- Kept the existing props interface (`target, projectId, refreshKey`) — preview-panel.tsx needs no changes
- Replaced one-shot fetch with: initial GET on mount + on `refreshKey` change (with `reset=1` so a rebuild re-initializes the preview state)
- Added `dispatchAction(action, isInput)` — POSTs to `/api/preview/interact` and merges response
- Added an `actionQueueRef` (Promise chain) so all action POSTs are SERIALIZED — prevents the race where a fast "type then save" interleaves with stale responses
- For INPUT actions: do NOT replace the HTML body (preserves user focus + cursor position); only refresh `state` + `availableActions` so the header strip stays live
- For CLICK actions: replace the HTML to reflect the new screen (list→detail→form→dashboard)
- Event delegation on the preview container:
  - `click` → `closest('[data-action]')` → reads `data-action`, `data-entity-id`, `data-screen` and dispatches the matching PreviewAction
  - `input` → if target has `data-input` → reads `data-input` (field name) + element value → dispatches `{ type: "input", field, value }`
- Header strip now shows live state: current screen + item count + `last: <action>` (e.g. `last: input:name`, `last: save`, `last: select:2`)
- Preserved the loading spinner + error alert visual states from the original component

### Verification

#### TypeScript
```
npx tsc --noEmit 2>&1 | grep "error TS" | grep "src/" | grep -v "skills/" | grep -v "examples/" | wc -l
→ 0
```

#### ESLint (my files only — see Blockers note about a pre-existing error in planning-hierarchy.ts)
```
npx eslint src/lib/preview/preview-state.ts src/lib/preview/interactive-renderer.ts src/app/api/preview/interact/route.ts src/components/pavan/native-preview.tsx
→ exit 0
```

#### Curl flow: list → add → input → save
```
GET  /api/preview/interact?target=windows                              → screen=list, 3 entities (John/Jane/Bob), data-action="add"+"select"+"delete" present
POST /api/preview/interact  {target, action:{type:"add"}}              → screen=form, selectedEntityId=null, formValues={}, lastAction=add
POST /api/preview/interact  {target, action:{type:"input",field:"name",value:"Test User"}} → formValues={name:"Test User"}, lastAction=input:name
POST /api/preview/interact  {target, action:{type:"input",field:"email",value:"test@example.com"}} → formValues={name:"Test User",email:"test@example.com"}
POST /api/preview/interact  {target, action:{type:"save"}}             → screen=list, 4 entities (last: {id:4, name:"Test User", email:"test@example.com"}), formValues={}, lastAction=save
```

#### Curl flow: select → back → delete → reset
```
POST {type:"select", entityId:"2"}    → screen=detail, selectedEntityId=2, lastAction=select:2
POST {type:"back"}                    → screen=list, history=[list] (popped detail)
POST {type:"delete", entityId:"4"}    → screen=list, entities count back to 3
GET  ?reset=1                         → screen=list, 3 default entities, lastAction=null
```

#### Curl: dashboard navigation
```
POST {type:"navigate", screen:"dashboard"} → screen=dashboard, HTML contains win11-stat (Contact count + Total Value), data-action="navigate" data-screen="list" (View Contacts button)
```

#### Curl: Android preview
```
GET ?target=android → screen=list, HTML contains md3-fab (FAB +), data-action="select" (cards), data-action="delete" (icon buttons)
```

#### Dev log
All requests returned 200 (one 500 was from a malformed curl test command — not a real bug). No compile errors.

## Stage Summary
- **Files created**: `src/lib/preview/preview-state.ts`, `src/lib/preview/interactive-renderer.ts`, `src/app/api/preview/interact/route.ts`
- **Files modified**: `src/components/pavan/native-preview.tsx` (made interactive with event delegation + serialized action queue + focus-preserving input handling)
- **Files NOT touched**: xaml-renderer.ts, compose-renderer.ts, orchestrator.ts, execution-engine.ts, preview-panel.tsx (no changes needed — props interface preserved)
- **engine/index.ts**: not modified — preview modules live in `src/lib/preview/`, not `src/lib/engine/`, so no re-export was needed
- **tsc**: 0 errors in src/ (excluding pre-existing skills/ + examples/)
- **lint**: clean for all 4 files I created/modified (see Blockers for one pre-existing error in another agent's file)
- **Screens**: list, detail, form, dashboard — all rendered for both Windows (win11-*) and Android (md3-*)
- **Actions supported**: navigate, select, input, add, delete, save, back — all reducible + rendered
- **State management**: module-level store keyed by `${projectId}:${target}`, reducer pattern, reset on rebuild
- **UX details**: input events preserve focus (no HTML re-render on typing), click events replace HTML, action POSTs are serialized to prevent race conditions, all user-entered values are HTML-escaped on render

## Blockers
None. One observation: `bun run lint` reports an error in `src/lib/engine/planning-hierarchy.ts` (`@next/next/no-assign-module-variable`) — that file is untracked and was created by another concurrent agent (Task Y), NOT me. My 4 files all lint cleanly. The error is outside my strict file ownership scope.
