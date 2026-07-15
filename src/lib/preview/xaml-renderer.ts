// XAML Renderer — parses the WinUI XAML that desktop-generator.ts emits
// (MainWindow.xaml + MainWindow.xaml.cs) and produces an HTML approximation
// of the native Windows 11 UI.
//
// Supported elements (the ones desktop-generator.ts actually emits):
//   <Window>            -> full-screen container (title from code-behind if absent)
//   <Grid>              -> grid container (RowDefinitions honoured)
//   <StackPanel>        -> flex column / row container
//   <GridView>          -> card grid (the desktop-gen CRUD list)
//   <DataGrid>          -> HTML table with Windows styling (legacy/alt)
//   <DataTemplate>      -> used to infer card shape for GridView
//   <TextBlock>         -> <p> / <span> / <h2> (title style auto-detected)
//   <TextBox>           -> <input type="text">
//   <NumberBox>         -> <input type="number">
//   <Button>            -> <button>
//   <AppBar>            -> top app bar
//   <NavigationView>    -> sidebar nav
//
// Supported attributes:
//   Text="..."                   -> inner text (literal or x:Bind)
//   Header="..."                 -> label / heading
//   Content="..."                -> button label
//   Margin="10,5,10,5"           -> CSS margin
//   Padding="10"                 -> CSS padding
//   Background="..."             -> CSS background
//   Foreground="..."             -> CSS color
//   FontSize="14"                -> CSS font-size
//   FontWeight="Bold|SemiBold"   -> CSS font-weight
//   Opacity="0.5"                -> CSS opacity
//   Orientation="Horizontal"     -> flex-direction
//   Spacing="8"                  -> gap
//   Width / Height               -> CSS width / height
//   RowDefinitions="Auto,*,Auto" -> grid-template-rows
//   ColumnDefinitions            -> grid-template-columns
//   Grid.Row / Grid.Column       -> grid placement
//   ItemsSource="{x:Bind ...}"   -> placeholder data list
//   Style="{StaticResource X}"   -> hints (TitleTextBlockStyle / AccentButtonStyle)

export interface RenderedPreview {
  html: string;
  css: string;
  elementCount: number;
  warnings: string[];
}

export function renderXaml(xaml: string): RenderedPreview {
  const warnings: string[] = [];
  let elementCount = 0;
  const counter = () => ++elementCount;

  const html = convertXamlToHtml(xaml, warnings, counter);
  const css = getWindowsCss();

  return { html, css, elementCount, warnings };
}

/* ------------------------------------------------------------------ */

interface XamlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XamlNode[];
  selfClosing: boolean;
}

/** Very small XAML/XML tag scanner. Handles the subset desktop-gen emits. */
function parseXaml(src: string): XamlNode[] {
  const nodes: XamlNode[] = [];
  const stack: XamlNode[] = [];
  let i = 0;
  // Skip XML prolog / comments / PIs and walk tags.
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) break;
    // Skip comments <?xml ... ?>, <!-- ... -->, and PIs.
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith("<?", lt) || src.startsWith("<!", lt)) {
      const end = src.indexOf(">", lt);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    // Closing tag.
    if (src[lt + 1] === "/") {
      const end = src.indexOf(">", lt);
      if (end === -1) break;
      if (stack.length > 0) stack.pop();
      i = end + 1;
      continue;
    }
    // Opening tag — read until matching ">" that is NOT inside a quoted attr.
    const end = findTagEnd(src, lt + 1);
    if (end === -1) break;
    const tagSrc = src.slice(lt + 1, end);
    const selfClosing = tagSrc.endsWith("/");
    const body = selfClosing ? tagSrc.slice(0, -1) : tagSrc;
    const { tag, attrs } = parseTagBody(body);
    const node: XamlNode = { tag, attrs, children: [], selfClosing };
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      nodes.push(node);
    }
    if (!selfClosing) stack.push(node);
    i = end + 1;
  }
  return nodes;
}

function findTagEnd(src: string, from: number): number {
  let i = from;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
    i++;
  }
  return -1;
}

function parseTagBody(body: string): { tag: string; attrs: Record<string, string> } {
  const attrs: Record<string, string> = {};
  // tag name = first token
  const m = body.match(/^\s*([a-zA-Z0-9_.:-]+)/);
  const tag = m ? m[1] : "unknown";
  // attributes: Name="..." or Name='...' (single token attrs also tolerated)
  const attrRe = /([a-zA-Z0-9_.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(body)) !== null) {
    attrs[am[1]] = am[2] ?? am[3] ?? am[4] ?? "";
  }
  return { tag, attrs };
}

/* ------------------------------------------------------------------ */

/** Walk parsed nodes and emit HTML. */
function convertXamlToHtml(
  xaml: string,
  warnings: string[],
  counter: () => number,
): string {
  // Pull Window title: try <Window Title="...">, then x:Bind ViewModel.Title,
  // then MainWindow.xaml.cs `Title = "..."` if the source is concatenated.
  let title = extractAttr(xaml, /<Window[^>]*\sTitle="([^"]*)"/);
  if (!title) {
    const bind = xaml.match(/Text="\{x:Bind\s+ViewModel\.Title[^}]*\}"/);
    if (bind) {
      // Try to resolve from code-behind: Title = "projectName";
      const csTitle = xaml.match(/Title\s*=\s*"([^"]+)"/);
      title = csTitle ? csTitle[1] : "WinUI App";
    }
  }
  if (!title) title = "WinUI App";
  counter();

  const root = parseXaml(xaml);
  const windowNode = findNode(root, "Window") ?? root[0];

  const bodyHtml = windowNode ? renderNode(windowNode, warnings, counter, { title }) : "";

  return `<div class="win11-window">
  <div class="win11-titlebar">
    <span class="win11-titlebar-title">${escapeHtml(title)}</span>
    <span class="win11-titlebar-controls"><span class="win11-tc min"></span><span class="win11-tc max"></span><span class="win11-tc close"></span></span>
  </div>
  <div class="win11-body">${bodyHtml}</div>
</div>`;
}

function findNode(nodes: XamlNode[], tag: string): XamlNode | undefined {
  for (const n of nodes) {
    if (n.tag === tag) return n;
    const f = findNode(n.children, tag);
    if (f) return f;
  }
  return undefined;
}

function renderNode(
  node: XamlNode,
  warnings: string[],
  counter: () => number,
  ctx: { title: string },
): string {
  counter();
  switch (node.tag) {
    case "Window":
      return node.children.map((c) => renderNode(c, warnings, counter, ctx)).join("");
    case "Grid": {
      const rows = node.attrs.RowDefinitions;
      const cols = node.attrs.ColumnDefinitions;
      const styleParts: string[] = [];
      if (rows) {
        styleParts.push(
          `grid-template-rows: ${rows
            .split(",")
            .map((r) => (r.trim() === "*" ? "1fr" : r.trim() === "Auto" ? "auto" : r.trim()))
            .join(" ")};`,
        );
      }
      if (cols) {
        styleParts.push(
          `grid-template-columns: ${cols
            .split(",")
            .map((r) => (r.trim() === "*" ? "1fr" : r.trim() === "Auto" ? "auto" : r.trim()))
            .join(" ")};`,
        );
      }
      const padding = node.attrs.Padding;
      if (padding) styleParts.push(`padding: ${thicknessToCss(padding)};`);
      const style = styleParts.length ? ` style="${styleParts.join(" ")}"` : "";
      const inner = node.children
        .map((c) => renderNode(c, warnings, counter, ctx))
        .join("");
      return `<div class="win11-grid"${style}>${inner}</div>`;
    }
    case "StackPanel": {
      const horizontal = /Horizontal/i.test(node.attrs.Orientation ?? "");
      const spacing = node.attrs.Spacing ? `${node.attrs.Spacing}px` : "8px";
      const margin = node.attrs.Margin ? `margin: ${thicknessToCss(node.attrs.Margin)};` : "";
      const style = ` style="flex-direction:${horizontal ? "row" : "column"};gap:${spacing};${margin}"`;
      const inner = node.children
        .map((c) => renderNode(c, warnings, counter, ctx))
        .join("");
      return `<div class="win11-stack"${style}>${inner}</div>`;
    }
    case "GridView":
    case "DataGrid": {
      // Pull the DataTemplate to infer the columns.
      const tmpl = findNode(node.children, "DataTemplate");
      const bindings = tmpl ? collectBindings(tmpl) : [];
      const bindingSource = (node.attrs.ItemsSource ?? "")
        .replace(/\{x:Bind\s+/i, "")
        .replace(/[}].*$/, "")
        .split(",")[0]
        .trim() || "Items";
      return renderDataGrid(bindingSource, bindings, warnings, counter);
    }
    case "TextBlock": {
      return renderTextBlock(node, ctx);
    }
    case "TextBox":
    case "NumberBox": {
      const header = node.attrs.Header ?? "";
      const placeholder = header || "Enter value";
      const type = node.tag === "NumberBox" ? "number" : "text";
      const width = node.attrs.Width ? `style="width:${node.attrs.Width}px"` : "";
      return `<label class="win11-field">${header ? `<span class="win11-field-label">${escapeHtml(header)}</span>` : ""}<input type="${type}" class="win11-input" placeholder="${escapeHtml(placeholder)}" ${width} /></label>`;
    }
    case "Button": {
      const content = node.attrs.Content ?? "Button";
      const accent = /Accent/i.test(node.attrs.Style ?? "");
      const cls = accent ? "win11-button win11-button-accent" : "win11-button";
      return `<button class="${cls}">${escapeHtml(content)}</button>`;
    }
    case "AppBar": {
      const inner = node.children
        .map((c) => renderNode(c, warnings, counter, ctx))
        .join("");
      return `<div class="win11-appbar">${inner}</div>`;
    }
    case "NavigationView": {
      const inner = node.children
        .map((c) => renderNode(c, warnings, counter, ctx))
        .join("");
      return `<div class="win11-nav">${inner}</div>`;
    }
    case "DataTemplate":
      // Rendered inline by GridView; ignore standalone.
      return "";
    default:
      // Unknown leaf — emit nothing but count it.
      warnings.push(`Unrecognized XAML element: <${node.tag}>`);
      return "";
  }
}

function renderTextBlock(node: XamlNode, ctx: { title: string }): string {
  const text = resolveBoundText(node.attrs.Text ?? "", ctx);
  const style = node.attrs.Style ?? "";
  const isTitle = /Title|Heading|Header/i.test(style);
  const weight = node.attrs.FontWeight;
  const opacity = node.attrs.Opacity;
  const fontSize = node.attrs.FontSize;
  const styles: string[] = [];
  if (weight) styles.push(`font-weight:${weight.toLowerCase()}`);
  if (opacity) styles.push(`opacity:${opacity}`);
  if (fontSize) styles.push(`font-size:${fontSize}px`);
  const styleAttr = styles.length ? ` style="${styles.join(";")}"` : "";
  if (isTitle) {
    return `<h2 class="win11-title"${styleAttr}>${escapeHtml(text)}</h2>`;
  }
  return `<p class="win11-text"${styleAttr}>${escapeHtml(text)}</p>`;
}

/** Pull literal Text="..." or fall back to a friendly placeholder for x:Bind. */
function resolveBoundText(raw: string, ctx: { title: string }): string {
  if (!raw) return "";
  const bind = raw.match(/^\{x:Bind\s+([^}]+)\}/);
  if (bind) {
    // x:Bind Name            -> "Name"
    // x:Bind ViewModel.Title -> use the resolved screen title (project name)
    const tail = bind[1].split(",")[0].trim();
    const last = tail.split(".").pop() ?? tail;
    if (/^Title$/i.test(last)) return ctx.title || "App Title";
    return last;
  }
  return raw;
}

/** Walk a DataTemplate and pull out x:Bind paths + any Delete button. */
function collectBindings(tmpl: XamlNode): { path: string; weight?: string }[] {
  const out: { path: string; weight?: string }[] = [];
  const walk = (n: XamlNode) => {
    if (n.tag === "TextBlock") {
      const m = (n.attrs.Text ?? "").match(/^\{x:Bind\s+([^}]+)\}/);
      if (m) {
        out.push({ path: m[1].split(",")[0].trim(), weight: n.attrs.FontWeight });
      }
    }
    if (n.tag === "Button" && n.attrs.Content) {
      out.push({ path: `__button:${n.attrs.Content}` });
    }
    n.children.forEach(walk);
  };
  walk(tmpl);
  return out;
}

function renderDataGrid(
  bindingSource: string,
  bindings: { path: string; weight?: string }[],
  warnings: string[],
  counter: () => number,
): string {
  counter();
  // The desktop generator binds to ViewModel.Items — entity name from the
  // DataTemplate x:DataType="models:Contact" if present. Fall back to a guess.
  const entity = bindingSource.replace(/s$/, "").replace(/^.*\./, "") || "Item";

  // Separate display bindings from action buttons.
  const displayBindings = bindings.filter((b) => !b.path.startsWith("__button:"));
  const actionButtons = bindings
    .filter((b) => b.path.startsWith("__button:"))
    .map((b) => b.path.replace("__button:", ""));

  // Build column headers — fall back to a sensible default set.
  const cols = displayBindings.length
    ? displayBindings.map((b) => b.path)
    : ["Name", "Quantity", "Price", "Description"];

  // Sample rows (3 rows, each col gets a sample value).
  const sampleRows: string[][] = [];
  const samples: Record<string, string[]> = {
    Name: ["John Doe", "Jane Smith", "Bob Wilson"],
    Quantity: ["12", "3", "47"],
    Price: ["$9.99", "$24.50", "$1.20"],
    Description: ["Sample record", "Another record", "Third record"],
    Email: ["john@example.com", "jane@example.com", "bob@example.com"],
    Title: ["Manager", "Engineer", "Designer"],
    CreatedAt: ["2024-01-15", "2024-02-03", "2024-03-22"],
  };
  for (let r = 0; r < 3; r++) {
    sampleRows.push(cols.map((c) => samples[c]?.[r] ?? `Sample ${r + 1}`));
  }

  const hasActions = actionButtons.length > 0;

  let html = `<div class="win11-datagrid">`;
  html += `<div class="win11-datagrid-header">${escapeHtml(entity)} list</div>`;
  html += `<table class="win11-table"><thead><tr>`;
  for (const c of cols) html += `<th>${escapeHtml(c)}</th>`;
  if (hasActions) html += `<th class="win11-table-actions">Actions</th>`;
  html += `</tr></thead><tbody>`;
  for (const row of sampleRows) {
    html += `<tr>`;
    for (const cell of row) html += `<td>${escapeHtml(cell)}</td>`;
    if (hasActions) {
      html += `<td class="win11-table-actions">`;
      for (const b of actionButtons) {
        html += `<button class="win11-button-sm">${escapeHtml(b)}</button>`;
      }
      html += `</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;

  if (cols.length === 0) {
    warnings.push("GridView had no DataTemplate bindings; using default columns.");
  }
  return html;
}

/* ------------------------------------------------------------------ */

function extractAttr(src: string, re: RegExp): string | undefined {
  const m = src.match(re);
  return m ? m[1] : undefined;
}

function thicknessToCss(t: string): string {
  const parts = t.split(",").map((s) => s.trim());
  if (parts.length === 1) return `${parts[0]}px`;
  if (parts.length === 2) return `${parts[0]}px ${parts[1]}px`;
  if (parts.length === 4) return `${parts[0]}px ${parts[1]}px ${parts[2]}px ${parts[3]}px`;
  return t;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ------------------------------------------------------------------ */

function getWindowsCss(): string {
  return `
.win11-window {
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: #f3f3f3;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08);
  max-width: 920px;
  margin: 0 auto;
  color: #1a1a1a;
  border: 1px solid #e5e5e5;
}
.win11-titlebar {
  background: #ffffff;
  padding: 10px 16px;
  border-bottom: 1px solid #e5e5e5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 13px;
}
.win11-titlebar-title { color: #1a1a1a; }
.win11-titlebar-controls { display: inline-flex; gap: 8px; }
.win11-tc { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
.win11-tc.min { background: #fbbf24; }
.win11-tc.max { background: #34d399; }
.win11-tc.close { background: #f87171; }
.win11-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
.win11-grid { display: grid; gap: 12px; }
.win11-stack { display: flex; align-items: flex-start; }
.win11-title { font-size: 24px; font-weight: 600; margin: 0; padding: 0; color: #1a1a1a; letter-spacing: -0.01em; }
.win11-text { padding: 0; margin: 0; color: #1a1a1a; font-size: 14px; line-height: 1.4; }
.win11-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #616161; }
.win11-field-label { font-weight: 500; }
.win11-input {
  padding: 8px 12px;
  border: 1px solid #d1d1d1;
  border-bottom: 1px solid #0078d4;
  border-radius: 4px;
  font-size: 14px;
  background: #fff;
  color: #1a1a1a;
  outline: none;
  min-width: 80px;
}
.win11-input:focus { border-color: #0078d4; box-shadow: 0 0 0 1px #0078d4; }
.win11-button {
  padding: 8px 18px;
  background: #fff;
  color: #1a1a1a;
  border: 1px solid #d1d1d1;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}
.win11-button:hover { background: #f5f5f5; }
.win11-button-accent { background: #0078d4; color: #fff; border-color: #0078d4; }
.win11-button-accent:hover { background: #106ebe; border-color: #106ebe; }
.win11-button-sm { padding: 4px 10px; font-size: 12px; background: #fff; border: 1px solid #d1d1d1; border-radius: 4px; cursor: pointer; color: #c50f1f; }
.win11-button-sm:hover { background: #fef2f2; border-color: #c50f1f; }
.win11-datagrid { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; overflow: hidden; }
.win11-datagrid-header { padding: 10px 14px; background: #fafafa; border-bottom: 1px solid #e5e5e5; font-size: 13px; font-weight: 600; color: #424242; }
.win11-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.win11-table th { text-align: left; padding: 9px 14px; background: #fafafa; border-bottom: 1px solid #e5e5e5; font-weight: 600; color: #424242; }
.win11-table td { padding: 9px 14px; border-bottom: 1px solid #f0f0f0; color: #1a1a1a; }
.win11-table tr:last-child td { border-bottom: none; }
.win11-table tr:hover td { background: #f9f9f9; }
.win11-table-actions { text-align: right; white-space: nowrap; }
.win11-appbar { background: #fff; border-bottom: 1px solid #e5e5e5; padding: 8px 16px; display: flex; gap: 8px; }
.win11-nav { display: flex; gap: 4px; padding: 8px 0; }
  `;
}
