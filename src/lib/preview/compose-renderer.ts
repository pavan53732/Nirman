// Compose Renderer — parses the Jetpack Compose Kotlin that android-generator.ts
// emits (the <Entity>ListScreen.kt file) and produces an HTML approximation of
// the native Android Material 3 UI.
//
// Supported composables (the ones android-generator.ts actually emits):
//   @Composable fun XxxListScreen(...)  -> screen container
//   @Composable private fun XxxCard(...) -> card (sampled from)
//   Column(...) { ... }                 -> vertical stack
//   Row(...) { ... }                    -> horizontal stack
//   Text(text = "...", style = ...)     -> text / title
//   OutlinedTextField(value=..., label={ Text("...") }) -> input
//   TextField(...)                      -> input (legacy)
//   Button(onClick = ...) { Text("...") }  -> Material 3 button
//   LazyColumn(...) { items(...) { ... } } -> scrollable list
//   Card(...) { Row { Column { ... } IconButton { Icon(...) } } } -> list card
//   TopAppBar(title = { Text("...") })     -> Material 3 app bar (when present)
//   Scaffold(topBar = ...)                 -> scaffold container
//
// The renderer is a SIMULATION — it does not parse Kotlin semantically. It
// recognises the patterns the android-generator emits and emits Material 3
// HTML+CSS that approximates the same UI on the device.

export interface RenderedPreview {
  html: string;
  css: string;
  elementCount: number;
  warnings: string[];
}

export function renderCompose(kotlin: string): RenderedPreview {
  const warnings: string[] = [];
  let elementCount = 0;
  const counter = () => ++elementCount;

  const html = convertComposeToHtml(kotlin, warnings, counter);
  const css = getMaterialCss();

  return { html, css, elementCount, warnings };
}

/* ------------------------------------------------------------------ */

interface CardShape {
  titlePath: string;       // e.g. "item.name"
  subtitles: string[];     // literal subtitle strings + bound paths
  hasIconButton: boolean;  // Card has an IconButton (delete)
  iconContentDescription: string;
}

function convertComposeToHtml(
  kotlin: string,
  warnings: string[],
  counter: () => number,
): string {
  // Find the bounds of the private Card function so we can exclude its inner
  // Texts from the standalone-text collection.
  const cardFnBounds = findFunctionBounds(kotlin, /@Composable\s+private\s+fun\s+\w+Card\s*\(/);

  // 1) Top app bar title — only present if the screen emits TopAppBar.
  //    The android-generator's ListScreen.kt does NOT emit a TopAppBar, but
  //    a hand-edited screen (or future generator revision) might.
  let realTopbarTitle: string | undefined;
  const topAppBarIdx = kotlin.indexOf("TopAppBar(");
  if (topAppBarIdx !== -1) {
    const titleIdx = kotlin.indexOf("title", topAppBarIdx);
    if (titleIdx !== -1) {
      const quoteIdx = kotlin.indexOf('"', titleIdx);
      if (quoteIdx !== -1) {
        const parsed = parseKtString(kotlin, quoteIdx);
        if (parsed) {
          realTopbarTitle = parsed.value;
          counter();
        }
      }
    }
  }

  // 2) Screen function name — used to synthesize a topbar when no real one
  //    exists.
  const screenFn = kotlin.match(/fun\s+(\w+Screen)\s*\(/);
  const screenName = screenFn ? screenFn[1].replace(/Screen$/, "") : undefined;
  if (screenName) counter();

  // 3) In-screen headline — the Text with style = MaterialTheme.typography.headlineMedium.
  let headline: string | undefined;
  const headlineIdx = kotlin.indexOf("headlineMedium");
  if (headlineIdx !== -1) {
    // Walk backwards to find the nearest `text = "..."` before this position.
    const before = kotlin.slice(0, headlineIdx);
    const textEqIdx = before.lastIndexOf("text");
    if (textEqIdx !== -1) {
      const quoteIdx = before.indexOf('"', textEqIdx);
      if (quoteIdx !== -1) {
        const parsed = parseKtString(before, quoteIdx);
        if (parsed) {
          headline = parsed.value;
          counter();
        }
      }
    }
  }

  // 4) OutlinedTextField labels — scan for `label = { Text("X") }`.
  //    This pattern is the universal Material 3 idiom.
  const textFieldLabels: string[] = [];
  {
    const labelRe = /label\s*=\s*\{\s*Text\(\s*(?:text\s*=\s*)?"/g;
    let lm: RegExpExecArray | null;
    while ((lm = labelRe.exec(kotlin)) !== null) {
      const quoteIdx = lm.index + lm[0].length - 1;
      const parsed = parseKtString(kotlin, quoteIdx);
      if (parsed) {
        textFieldLabels.push(parsed.value);
        counter();
      }
    }
  }

  // 5) Buttons — scan for `Button(...) { Text("X") }`.
  const buttonLabels: string[] = [];
  {
    const btnRe = /(?:Button|TextButton|OutlinedButton)\s*\([^)]*\)\s*\{\s*Text\(\s*(?:text\s*=\s*)?"/g;
    let bm: RegExpExecArray | null;
    while ((bm = btnRe.exec(kotlin)) !== null) {
      const quoteIdx = bm.index + bm[0].length - 1;
      const parsed = parseKtString(kotlin, quoteIdx);
      if (parsed) {
        buttonLabels.push(parsed.value);
        counter();
      }
    }
  }

  // 6) Card shape — pulled from the private @Composable Card function.
  const cardShape = cardFnBounds
    ? inferCardShape(kotlin, cardFnBounds, warnings, counter)
    : undefined;
  const hasLazyColumn = /\bLazyColumn\s*\(/.test(kotlin);
  if (hasLazyColumn) counter();

  // 7) Standalone Texts — collect from OUTSIDE the Card function body.
  //    These are the screen-level Texts (headline, body copy, etc.).
  const standaloneTexts: string[] = [];
  {
    const textRe = /Text\(\s*(?:text\s*=\s*)?"/g;
    let tm: RegExpExecArray | null;
    while ((tm = textRe.exec(kotlin)) !== null) {
      const quoteIdx = tm.index + tm[0].length - 1;
      // Skip if inside the Card function body.
      if (
        cardFnBounds &&
        tm.index >= cardFnBounds.start &&
        tm.index <= cardFnBounds.end
      ) {
        continue;
      }
      const parsed = parseKtString(kotlin, quoteIdx);
      if (!parsed) continue;
      const value = parsed.value;
      if (value === headline) continue;
      if (textFieldLabels.includes(value)) continue;
      if (buttonLabels.includes(value)) continue;
      // Skip Kotlin string templates with broken `${...}` — we can't render
      // them meaningfully at the screen level.
      if (value.includes("${")) continue;
      standaloneTexts.push(value);
      counter();
    }
  }

  // ---- Decide topbar rendering ----
  // If we have a real TopAppBar, render it. Otherwise synthesize one from the
  // screen function name. Skip the in-screen headline if it duplicates the
  // topbar text to avoid visual repetition.
  const topbarTitle = realTopbarTitle ?? screenName ?? "App";
  const headlineShouldRender =
    headline !== undefined && headline !== topbarTitle;

  // ---- Render HTML ----
  let html = `<div class="md3-screen">`;

  // Top app bar — Material 3 apps always have one.
  html += `<div class="md3-topbar"><span class="md3-topbar-title">${escapeHtml(topbarTitle)}</span></div>`;

  html += `<div class="md3-content">`;

  // Headline (the in-screen title inside Column) — only if it's not a duplicate.
  if (headlineShouldRender) {
    html += `<h1 class="md3-headline">${escapeHtml(headline!)}</h1>`;
  }

  // Form (Row of OutlinedTextFields + Add button).
  if (textFieldLabels.length > 0) {
    html += `<div class="md3-form-row">`;
    for (const label of textFieldLabels) {
      html += `<label class="md3-field"><span class="md3-field-label">${escapeHtml(label)}</span><input type="text" class="md3-input" placeholder="${escapeHtml(label)}" /></label>`;
    }
    if (buttonLabels.length > 0) {
      html += `<button class="md3-button">${escapeHtml(buttonLabels[0])}</button>`;
    }
    html += `</div>`;
  }

  // LazyColumn as a list of cards.
  if (hasLazyColumn && cardShape) {
    html += `<div class="md3-list">`;
    const samples = sampleCardData(cardShape);
    for (const row of samples) {
      html += renderCard(row, cardShape);
    }
    html += `</div>`;
  } else if (hasLazyColumn && !cardShape) {
    // LazyColumn without a recognizable card shape — render a default list.
    warnings.push("LazyColumn found but Card shape could not be inferred; using generic card.");
    html += `<div class="md3-list">`;
    const fallbackNames = ["John Doe", "Jane Smith", "Bob Wilson"];
    for (const name of fallbackNames) {
      html += `<div class="md3-card"><div class="md3-card-text"><div class="md3-card-title">${escapeHtml(name)}</div><div class="md3-card-subtitle">Sample item</div></div></div>`;
    }
    html += `</div>`;
  }

  // Standalone texts (not in form / list).
  if (standaloneTexts.length > 0) {
    html += `<div class="md3-text-block">`;
    for (const t of standaloneTexts.slice(0, 5)) {
      html += `<p class="md3-text">${escapeHtml(t)}</p>`;
    }
    html += `</div>`;
  }

  // Action buttons (other than the primary Add already in the form).
  if (buttonLabels.length > 1) {
    html += `<div class="md3-actions">`;
    for (const b of buttonLabels.slice(1)) {
      html += `<button class="md3-button md3-button-outlined">${escapeHtml(b)}</button>`;
    }
    html += `</div>`;
  }

  // Empty-state fallback.
  if (
    !headline &&
    textFieldLabels.length === 0 &&
    buttonLabels.length === 0 &&
    !hasLazyColumn &&
    standaloneTexts.length === 0
  ) {
    html += `<p class="md3-text md3-text-muted">[Compose structure — no renderable elements found]</p>`;
    warnings.push("No recognized Compose elements found; showing placeholder.");
  }

  html += `</div></div>`;
  return html;
}

/* ------------------------------------------------------------------ */

/** Find the start and end of a Kotlin function body by matching braces. */
function findFunctionBounds(
  kotlin: string,
  fnHeaderRe: RegExp,
): { start: number; end: number } | undefined {
  const m = kotlin.match(fnHeaderRe);
  if (!m) return undefined;
  // Find the opening `{` of the function body.
  const openIdx = kotlin.indexOf("{", m.index! + m[0].length);
  if (openIdx === -1) return undefined;
  // Walk braces to find the matching close.
  let depth = 1;
  let i = openIdx + 1;
  let inString: string | null = null;
  let templateDepth = 0;
  while (i < kotlin.length && depth > 0) {
    const c = kotlin[i];
    if (inString) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "$" && kotlin[i + 1] === "{" && inString === '"') {
        templateDepth++;
        i += 2;
        continue;
      }
      if (c === "{" && templateDepth > 0) {
        templateDepth++;
        i++;
        continue;
      }
      if (c === "}" && templateDepth > 0) {
        templateDepth--;
        i++;
        continue;
      }
      if (c === inString && templateDepth === 0) {
        inString = null;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  if (depth !== 0) return undefined;
  return { start: openIdx, end: i };
}

/** Parse a Kotlin string literal starting at position `pos` (where src[pos] === '"'). */
function parseKtString(src: string, pos: number): { value: string; end: number } | null {
  if (src[pos] !== '"') return null;
  let i = pos + 1;
  let value = "";
  let templateDepth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      // Escape sequence — copy verbatim.
      value += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "$" && src[i + 1] === "{" && templateDepth === 0) {
      // Template expression begins.
      templateDepth = 1;
      value += "${";
      i += 2;
      continue;
    }
    if (templateDepth > 0) {
      if (c === "{") templateDepth++;
      else if (c === "}") {
        templateDepth--;
        if (templateDepth === 0) {
          value += "}";
          i++;
          continue;
        }
      }
      value += c;
      i++;
      continue;
    }
    if (c === '"') {
      return { value, end: i + 1 };
    }
    value += c;
    i++;
  }
  return null;
}

/* ------------------------------------------------------------------ */

/**
 * Inspect the private @Composable Card function emitted by android-generator
 * and infer the shape we should render each list item with.
 */
function inferCardShape(
  kotlin: string,
  bounds: { start: number; end: number },
  warnings: string[],
  counter: () => number,
): CardShape | undefined {
  const body = kotlin.slice(bounds.start, bounds.end);

  // Title Text — `Text(text = item.name, style = MaterialTheme.typography.titleMedium)`
  let titlePath: string | undefined;
  const titleM = body.match(
    /Text\(\s*text\s*=\s*([a-zA-Z_][\w.]*)\s*,[^)]*titleMedium/,
  );
  if (titleM) {
    titlePath = titleM[1];
    counter();
  } else {
    // Try first Text( in the Card body with a bound path.
    const anyTextM = body.match(/Text\(\s*text\s*=\s*([a-zA-Z_][\w.]*)\s*,/);
    if (anyTextM && anyTextM[1].includes(".")) {
      titlePath = anyTextM[1];
      counter();
    }
  }

  // Subtitle texts — literal `text = "..."` (Kotlin string templates included)
  // OR bound paths like `text = item.description`.
  const subtitles: string[] = [];
  {
    // Bound paths: `text = item.X`
    const boundRe = /Text\(\s*text\s*=\s*([a-zA-Z_][\w.]*)\s*,/g;
    let bm: RegExpExecArray | null;
    while ((bm = boundRe.exec(body)) !== null) {
      const path = bm[1];
      if (path === titlePath) continue;
      subtitles.push(path);
      counter();
    }
    // Literal strings: `text = "..."`
    const litRe = /Text\(\s*text\s*=\s*"/g;
    let lm: RegExpExecArray | null;
    while ((lm = litRe.exec(body)) !== null) {
      const quoteIdx = lm.index + lm[0].length - 1;
      const parsed = parseKtString(body, quoteIdx);
      if (parsed) {
        subtitles.push(parsed.value);
        counter();
      }
    }
  }

  // IconButton presence.
  const hasIconButton = /\bIconButton\s*\(/.test(body);
  if (hasIconButton) {
    counter();
    const iconDesc = body.match(/contentDescription\s*=\s*"([^"]+)"/);
    return {
      titlePath: titlePath ?? "item.name",
      subtitles,
      hasIconButton: true,
      iconContentDescription: iconDesc ? iconDesc[1] : "Action",
    };
  }

  if (!titlePath && subtitles.length === 0) {
    warnings.push("Card function found but its inner Text bindings could not be parsed.");
    return undefined;
  }

  return {
    titlePath: titlePath ?? "item.name",
    subtitles,
    hasIconButton: false,
    iconContentDescription: "",
  };
}

/** Build 3 sample rows for the LazyColumn based on the Card shape. */
function sampleCardData(shape: CardShape): { title: string; subtitles: string[] }[] {
  const names = ["John Doe", "Jane Smith", "Bob Wilson"];
  return names.map((name, idx) => {
    const subtitles = shape.subtitles.map((s) => {
      if (s.startsWith("item.")) {
        const field = s.replace("item.", "");
        if (field === "name") return name;
        if (field === "quantity") return String([12, 3, 47][idx]);
        if (field === "price") return ["$9.99", "$24.50", "$1.20"][idx];
        if (field === "description") return ["Sample record", "Another record", "Third record"][idx];
        if (field === "email") return `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`;
        return "—";
      }
      // Literal subtitle: substitute ${item.x} placeholders with sample values.
      return s
        .replace(/\$\{item\.quantity\}/g, String([12, 3, 47][idx]))
        .replace(/\$\{item\.price\}/g, ["9.99", "24.50", "1.20"][idx])
        .replace(/\$\{item\.name\}/g, name)
        .replace(/\$\{item\.description\}/g, ["Sample record", "Another record", "Third record"][idx])
        // Replace any remaining ${...} (e.g. ${String.format(...)}) with a dash.
        .replace(/\$\{[^}]*\}/g, "—");
    });
    return { title: name, subtitles };
  });
}

function renderCard(row: { title: string; subtitles: string[] }, shape: CardShape): string {
  let html = `<div class="md3-card"><div class="md3-card-row">`;
  html += `<div class="md3-card-text">`;
  html += `<div class="md3-card-title">${escapeHtml(row.title)}</div>`;
  for (const s of row.subtitles) {
    html += `<div class="md3-card-subtitle">${escapeHtml(s)}</div>`;
  }
  html += `</div>`;
  if (shape.hasIconButton) {
    html += `<button class="md3-icon-button" aria-label="${escapeHtml(shape.iconContentDescription)}">${escapeHtml(shape.iconContentDescription === "Delete" ? "🗑" : "⋯")}</button>`;
  }
  html += `</div></div>`;
  return html;
}

/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ------------------------------------------------------------------ */

function getMaterialCss(): string {
  return `
.md3-screen {
  font-family: 'Roboto', system-ui, -apple-system, sans-serif;
  background: #fef7ff;
  max-width: 420px;
  margin: 0 auto;
  min-height: 640px;
  border-radius: 28px;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(0,0,0,0.20), 0 4px 12px rgba(0,0,0,0.10);
  border: 1px solid #cac4d0;
}
.md3-topbar {
  background: #6750a4;
  color: #ffffff;
  padding: 18px 22px;
  font-size: 20px;
  font-weight: 500;
  letter-spacing: 0.01em;
  display: flex;
  align-items: center;
}
.md3-topbar-title { color: #ffffff; }
.md3-content { padding: 18px 16px 24px; display: flex; flex-direction: column; gap: 14px; }
.md3-headline {
  font-size: 28px;
  font-weight: 400;
  color: #1c1b1f;
  margin: 4px 6px 6px;
  letter-spacing: 0;
  line-height: 1.2;
}
.md3-form-row {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 10px;
  padding: 0 4px;
  flex-wrap: wrap;
}
.md3-field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 100px; min-width: 80px; }
.md3-field-label { font-size: 11px; color: #49454f; font-weight: 500; padding-left: 4px; }
.md3-input {
  padding: 10px 12px;
  border: 1px solid #79747e;
  border-radius: 4px;
  font-size: 15px;
  background: #ffffff;
  color: #1c1b1f;
  outline: none;
  min-width: 0;
}
.md3-input:focus { border-color: #6750a4; border-width: 2px; }
.md3-button {
  padding: 10px 24px;
  background: #6750a4;
  color: #ffffff;
  border: none;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  align-self: flex-end;
}
.md3-button:hover { background: #7965b0; }
.md3-button-outlined { background: transparent; color: #6750a4; border: 1px solid #79747e; }
.md3-button-outlined:hover { background: rgba(103, 80, 164, 0.08); }
.md3-list { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
.md3-card {
  background: #ffffff;
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
  border: 1px solid #f3edf7;
}
.md3-card-row { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 12px; }
.md3-card-text { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.md3-card-title { font-size: 16px; font-weight: 500; color: #1c1b1f; }
.md3-card-subtitle { font-size: 13px; color: #49454f; line-height: 1.4; }
.md3-icon-button {
  width: 36px; height: 36px;
  border-radius: 50%;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #49454f;
}
.md3-icon-button:hover { background: rgba(103, 80, 164, 0.10); }
.md3-text-block { padding: 4px 6px; display: flex; flex-direction: column; gap: 6px; }
.md3-text { padding: 0; margin: 0; color: #1c1b1f; font-size: 14px; line-height: 1.4; }
.md3-text-muted { color: #79747e; font-style: italic; }
.md3-actions { display: flex; flex-direction: row; gap: 10px; padding: 4px 6px; flex-wrap: wrap; }
  `;
}
