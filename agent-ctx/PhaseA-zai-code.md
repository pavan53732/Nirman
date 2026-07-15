# PhaseA — Z.ai Code (main)

**Task ID:** PhaseA
**Agent:** Z.ai Code (main)
**Scope:** Wire the 44 SKILL.md files into the Decision Engine + generators (Phase A1), and feed Architecture + Decision Memory back into the generators (Phase A2).

## Files changed

### Phase A1 — SKILL.md content flows into Decision Engine + generators

1. **`src/app/api/skill-content/route.ts`** (NEW)
   - New API route `GET /api/skill-content?name=<skill-name>` that returns the full SKILL.md content string for a given skill name (or category directory name).
   - Server-only — uses `getSkill()` from `@/lib/engine/skills/loader` (which uses `fs.readFileSync` to read `/skills/<name>/SKILL.md`).
   - Returns `{ name, category, content, length }` on 200, `{ error, name }` on 404, `{ error }` on 500.
   - This is the bridge that lets the client-side orchestrator read server-only SKILL.md files.

2. **`src/lib/engine/decision-engine.ts`** (MODIFIED)
   - `decide()` now accepts an optional `skillContent?: string` parameter.
   - When provided, scans the skill text for mentions of each candidate policy's `choose` value (e.g. "WinUI 3" in windows-native/SKILL.md). Each policy that the skill explicitly endorses gets **+1.5 score boost** (enough to break ties, not enough to override a hard platform mismatch). The boost is logged via `matchedCriteria.push("skill-endorsement")` so the rationale shows in Decision Memory.
   - Token matching uses word-boundary regex on tokens ≥4 chars from the policy's `choose` value (e.g. "winui", ".net", "tauri", "next.js", "kotlin", "flutter") to avoid substring false positives.
   - `pickStack()` now accepts an optional 5th parameter `skillContent?: string` and forwards it to `decide()`.

3. **`src/lib/engine/orchestrator.ts`** (MODIFIED)
   - Added exported `skillForTarget(kind: PlatformKind): string | undefined` — maps target kinds to SKILL.md names:
     - `windows` → `windows-native`
     - `web` → `fullstack-app`
     - `android` → `frontend-setup` (closest match — no android-specific skill exists yet)
     - `cli` → `scaffold`
     - `api` → `backend-api`
   - Added exported `fetchSkillContent(skillName: string): Promise<string | undefined>` — client-side fetch of `/api/skill-content?name=<skill>`. Returns `undefined` on error/404 (skill fetch is best-effort — never blocks the build).
   - Added exported `fetchSkillContentForCandidateKinds(kinds: PlatformKind[]): Promise<Partial<Record<PlatformKind, string>>>` — fetches skill content for multiple kinds in **parallel** via `Promise.all`.
   - `detectTargets(prompt, skillContentMap?)` — added optional second parameter `skillContentMap?: Partial<Record<PlatformKind, string>>`. Every `pickStack()` call inside `detectTargets` now passes `skillContentMap?.[kind]` so the Decision Engine can boost policies the skill endorses. The store's existing call `detectTargets(prompt)` (without the map) still works — no boost, just UI display.
   - `startBuild()` now:
     1. Pre-fetches SKILL.md content for all 5 candidate kinds (`windows`, `android`, `web`, `api`, `cli`) in parallel via `fetchSkillContentForCandidateKinds` BEFORE calling `detectTargets`. The fetched skills are loaded from disk by the API route (real `fs.readFileSync`, no mocks).
     2. Emits an observability event recording how many skills were loaded and which kinds.
     3. Calls `detectTargets(prompt, skillContentMap)` — the Decision Engine's `pickStack → decide` chain now receives the skill content and applies the +1.5 boost.
     4. Passes `skillContent: skillContentMap[t.kind]` to every `generateForTarget()` call so the matching skill content flows into the generator.

4. **`src/lib/engine/generators/web-generator.ts`** (MODIFIED)
   - `WebGenerationContext` now has optional `skillContent?: string` and `memoryContext?: string` fields.
   - Added `buildSkillHeader(skillContent)` — wraps the SKILL.md content in a markdown `<!-- ... -->` comment block (capped at 2 KB) so the skill guidance is preserved verbatim in the generated README without breaking markdown rendering.
   - Added `extractSkillName(skillContent)` — pulls the `name:` field from the SKILL.md YAML frontmatter for the human-readable "Skill guidance" section.
   - Added `buildMemoryHeader(memoryContext)` — wraps the Architecture + Decision memory records in a `<!-- ... -->` comment block (capped at 4 KB).
   - The generated `README.md` now starts with `${skillHeader}${memoryHeader}# ${projectName}` so both headers appear at the very top, followed by the existing README content. Two new sections appear at the bottom (only when the relevant context is provided): "Skill guidance" and "Engine decision history".

5. **`src/lib/engine/generators/desktop-generator.ts`** (MODIFIED)
   - `DesktopGenerationContext` now has optional `skillContent?: string` and `memoryContext?: string` fields.
   - Added the same `buildSkillHeader`, `extractSkillName`, `buildMemoryHeader` helpers.
   - The generated `README.md` now starts with `${skillHeader}${memoryHeader}# ${projectName} — WinUI 3 Desktop App` and includes the "Skill guidance" + "Engine decision history" sections at the bottom (conditional on the optional params being provided).

6. **`src/lib/engine/generators/android-generator.ts`** (MODIFIED)
   - `AndroidGenerationContext` now has optional `skillContent?: string` and `memoryContext?: string` fields.
   - Added the same `buildSkillHeader`, `extractSkillName`, `buildMemoryHeader` helpers.
   - The generated `README.md` now starts with `${skillHeader}${memoryHeader}# ${projectName} — Android App` and includes the "Skill guidance" + "Engine decision history" sections at the bottom.

7. **`src/lib/engine/generators.ts`** (MODIFIED)
   - `generateForTarget()`'s optional `ctx` parameter now also accepts `skillContent?: string` and `memoryContext?: string`.
   - The dispatcher forwards both fields to `generateWinUI3App`, `generateAndroidApp`, and `generateNextjsApp` when `ctx` is provided. The legacy `generateWinUI3`/`generateAndroidCompose`/`generateNextjs` (non-ctx paths) are unchanged.

### Phase A2 — Architecture + Decision Memory fed back into generators

8. **`src/lib/engine/orchestrator.ts`** (MODIFIED — same file as A1)
   - After `detectTargets` returns and the orchestrator writes to Architecture + Decision Memory, the orchestrator **reads those records back** from `projectMemory`:
     ```typescript
     const archMemory = projectMemory.read("architecture");
     const decisionMemory = projectMemory.read("decision");
     const memoryContext = [
       "=== ARCHITECTURE MEMORY ===",
       ...archMemory.map((r) => `[${r.title}] (v${r.version}, source: ${r.source})\n${r.content}`),
       "",
       "=== DECISION MEMORY ===",
       ...decisionMemory.map((r) => `[${r.title}] (v${r.version}, source: ${r.source})\n${r.content}`),
     ].join("\n");
     ```
   - The `memoryContext` string is passed to every `generateForTarget()` call (alongside `skillContent`).
   - The generated README.md files embed `memoryContext` as a markdown comment header (`buildMemoryHeader`), so the generated project now contains the engine's decision history (capabilities detected, stack selection rationale with scores, alternatives rejected).

## Verification

- **`bun run lint`**: clean. Only the 2 pre-existing `src-tauri/target/debug/build/.../__global-api-script.js` warnings (Tauri build artifacts, not project source). 0 errors.
- **API route sanity check** (`getSkill('windows-native')` direct loader test): 44 skills loaded, `windows-native` found, content returned. The route returns the real SKILL.md text — no mocks.
- **Skill boost logic sanity check** (standalone regex test):
  - Policy `choose: "WinUI 3 + .NET 8"` → tokens `['winui', '.net']` → "winui" found in `windows-native/SKILL.md` text → boost +1.5 ✅
  - Policy `choose: "Tauri + Rust"` → tokens `['tauri', 'rust']` → neither found in `windows-native/SKILL.md` → no boost ✅
  - So loading the `windows-native` skill tilts the Decision Engine toward the WinUI 3 policy — exactly the intended behavior.

## What flows through the pipeline now

```
User prompt
   ↓
orchestrator.startBuild(prompt)
   ↓
[NEW] fetchSkillContentForCandidateKinds(["windows","android","web","api","cli"])
       → /api/skill-content?name=windows-native  (server reads /skills/windows-native/SKILL.md via fs)
       → /api/skill-content?name=fullstack-app
       → /api/skill-content?name=frontend-setup
       → /api/skill-content?name=backend-api
       → /api/skill-content?name=scaffold
       → skillContentMap { windows: "...", web: "...", ... }
   ↓
detectTargets(prompt, skillContentMap)
   ↓
   for each target kind:
      decisionEngine.pickStack(kind, prompt, caps, nfs, skillContentMap[kind])
         → decide({ platform, capabilities, nonFunctionals, skillContent })
            → score() → for each policy, +1.5 if skill text mentions policy.choose tokens
            → best policy chosen (skill-endorsed policies win ties)
   ↓
projectMemory.write("requirements", ...) + ("decision", ...) + ("architecture", ...)
   ↓
[NEW] archMemory = projectMemory.read("architecture")
[NEW] decisionMemory = projectMemory.read("decision")
[NEW] memoryContext = archMemory + decisionMemory (concatenated)
   ↓
for each target:
   generateForTarget(kind, stack, name, targetId, {
      prompt, capabilities, nonFunctionals,
      skillContent: skillContentMap[kind],   // [NEW] Phase A1
      memoryContext,                          // [NEW] Phase A2
   })
      → generateWinUI3App / generateAndroidApp / generateNextjsApp
         → README.md starts with:
              <!-- SKILL GUIDANCE (from SKILL.md) ... -->
              <!-- ENGINE MEMORY (Architecture + Decision records) ... -->
              # ProjectName
              ...
            ## Skill guidance
            ## Engine decision history
```

## Constraints honored

- Did NOT touch: `test-generator.ts`, `cicd-generator.ts`, `docker-generator.ts`, `tools/lint-runner.ts`, `export.ts`, `preview-panel.tsx`, `src-tauri/`.
- Did NOT create mock data. All skill content comes from real `/skills/<name>/SKILL.md` files read via `fs.readFileSync` in the server-only loader. The orchestrator fetches them through the new `/api/skill-content` route.
- Used the existing `getSkill` loader — no new skill-loading code duplicated.
- The orchestrator's skill fetch is **best-effort**: if `/api/skill-content` returns 404 or fails, `fetchSkillContent` returns `undefined`, the skill is omitted from the map, and the build proceeds without the boost/header. No crash.
