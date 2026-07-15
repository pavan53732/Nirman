// Interactive Renderer — produces HTML with `data-action` attributes that the
// frontend can wire up to event handlers via delegation. Unlike the static
// renderers (xaml-renderer.ts, compose-renderer.ts) which produce a SINGLE
// snapshot of the generated UI, this produces DIFFERENT HTML based on the
// current preview state (current screen, form values, selected entity, etc.).
//
// The renderer is a pure function of PreviewState -> HTML. It does not mutate
// state; that's the job of reducePreviewState() in preview-state.ts.
//
// Clickable elements carry one of these data-* attributes:
//   data-action="add"                        — open the add/create form
//   data-action="select" data-entity-id="X"  — open detail view for entity X
//   data-action="delete" data-entity-id="X"  — delete entity X
//   data-action="save"                       — persist the current form
//   data-action="back"                       — pop the navigation history
//   data-action="navigate" data-screen="X"   — push a screen onto the history
//   data-input="fieldName"                   — input element; emits input events

import type { PreviewState, PreviewEntity, PreviewScreen } from "./preview-state";

export interface InteractiveAvailableAction {
  action: string;
  label: string;
  elementId: string;
}

export interface InteractivePreview {
  html: string;
  css: string;
  state: PreviewState;
  availableActions: InteractiveAvailableAction[];
}

export function renderInteractive(state: PreviewState): InteractivePreview {
  const isWindows = state.target === "windows";
  const html = isWindows
    ? renderWindowsInteractive(state)
    : renderAndroidInteractive(state);
  const css = isWindows ? getWindowsCss() : getMaterialCss();

  const availableActions = getAvailableActions(state);

  return { html, css, state, availableActions };
}

/* ============================ Windows (Win11) ============================ */

function renderWindowsInteractive(state: PreviewState): string {
  const title = "Contact Manager";
  let html = `<div class="win11-window">`;
  html += `<div class="win11-titlebar"><span class="win11-titlebar-title">${escapeHtml(
    title,
  )}</span></div>`;
  html += `<div class="win11-body">`;

  switch (state.currentScreen) {
    case "list":
      html += renderWindowsList(state);
      break;
    case "detail":
      html += renderWindowsDetail(state);
      break;
    case "form":
      html += renderWindowsForm(state);
      break;
    case "dashboard":
      html += renderWindowsDashboard(state);
      break;
  }

  html += `</div></div>`;
  return html;
}

function renderWindowsList(state: PreviewState): string {
  let html = `<div class="win11-toolbar">`;
  html += `<button class="win11-button win11-button-accent" data-action="add" id="add-btn">+ Add Contact</button>`;
  html += `</div>`;
  html += `<div class="win11-datagrid">`;
  html += `<div class="win11-datagrid-header">Contacts list</div>`;
  html += `<table class="win11-table"><thead><tr>`;
  html += `<th>Name</th><th>Email</th><th>Quantity</th><th>Price</th><th class="win11-table-actions">Actions</th>`;
  html += `</tr></thead><tbody>`;
  if (state.entities.length === 0) {
    html += `<tr><td colspan="5" class="win11-empty">No contacts yet — click “+ Add Contact”.</td></tr>`;
  } else {
    for (const e of state.entities) {
      html += `<tr>
        <td><a class="win11-link" data-action="select" data-entity-id="${escapeAttr(e.id)}">${escapeHtml(e.name)}</a></td>
        <td>${escapeHtml(e.email ?? "—")}</td>
        <td>${String(e.quantity ?? 0)}</td>
        <td>$${(e.price ?? 0).toFixed(2)}</td>
        <td class="win11-table-actions"><button class="win11-button-sm" data-action="delete" data-entity-id="${escapeAttr(
          e.id,
        )}">Delete</button></td>
      </tr>`;
    }
  }
  html += `</tbody></table></div>`;
  return html;
}

function renderWindowsDetail(state: PreviewState): string {
  const entity = state.entities.find((e) => e.id === state.selectedEntityId);
  if (!entity) {
    return `<div class="win11-content"><p>Contact not found.</p>`;
  }
  return `<div class="win11-content">
    <div class="win11-detail-header">
      <button class="win11-button" data-action="back" id="back-btn">← Back</button>
      <h2 class="win11-title">${escapeHtml(entity.name)}</h2>
    </div>
    <div class="win11-detail-body">
      <p class="win11-text"><strong>Email:</strong> ${escapeHtml(entity.email ?? "—")}</p>
      <p class="win11-text"><strong>Description:</strong> ${escapeHtml(entity.description ?? "—")}</p>
      <p class="win11-text"><strong>Quantity:</strong> ${String(entity.quantity ?? 0)}</p>
      <p class="win11-text"><strong>Price:</strong> $${(entity.price ?? 0).toFixed(2)}</p>
    </div>
    <div class="win11-detail-actions">
      <button class="win11-button win11-button-accent" data-action="add">Edit</button>
    </div>
  </div>`;
}

function renderWindowsForm(state: PreviewState): string {
  const isEdit = state.selectedEntityId !== null;
  const entity = state.entities.find((e) => e.id === state.selectedEntityId);
  return `<div class="win11-content">
    <div class="win11-detail-header">
      <button class="win11-button" data-action="back">← Back</button>
      <h2 class="win11-title">${isEdit ? "Edit Contact" : "Add Contact"}</h2>
    </div>
    <div class="win11-form">
      ${renderWinField("Name", "name", "text", state, entity)}
      ${renderWinField("Email", "email", "text", state, entity)}
      ${renderWinField("Description", "description", "text", state, entity)}
      ${renderWinField("Quantity", "quantity", "number", state, entity)}
      ${renderWinField("Price", "price", "number", state, entity)}
    </div>
    <div class="win11-form-actions">
      <button class="win11-button win11-button-accent" data-action="save" id="save-btn">${isEdit ? "Update" : "Create"}</button>
      <button class="win11-button" data-action="back" id="cancel-btn">Cancel</button>
    </div>
  </div>`;
}

function renderWinField(
  label: string,
  field: string,
  type: string,
  state: PreviewState,
  entity: PreviewEntity | undefined,
): string {
  const value = state.formValues[field] ?? (entity as PreviewEntity | undefined)?.[field as keyof PreviewEntity]?.toString() ?? "";
  return `<label class="win11-field"><span class="win11-field-label">${escapeHtml(
    label,
  )}</span><input type="${type}" class="win11-input" data-input="${escapeAttr(
    field,
  )}" value="${escapeAttr(value)}" /></label>`;
}

function renderWindowsDashboard(state: PreviewState): string {
  const total = state.entities.length;
  const totalValue = state.entities.reduce(
    (s, e) => s + (e.price ?? 0) * (e.quantity ?? 0),
    0,
  );
  return `<div class="win11-content win11-dashboard">
    <h2 class="win11-title">Dashboard</h2>
    <div class="win11-stats">
      <div class="win11-stat"><span class="win11-stat-value">${total}</span><span class="win11-stat-label">Contacts</span></div>
      <div class="win11-stat"><span class="win11-stat-value">$${totalValue.toFixed(2)}</span><span class="win11-stat-label">Total Value</span></div>
    </div>
    <button class="win11-button win11-button-accent" data-action="navigate" data-screen="list">View Contacts</button>
  </div>`;
}

/* ========================= Android (Material 3) ========================= */

function renderAndroidInteractive(state: PreviewState): string {
  const screenTitle =
    state.currentScreen === "list"
      ? "Contacts"
      : state.currentScreen === "detail"
        ? "Detail"
        : state.currentScreen === "form"
          ? "Form"
          : "Dashboard";
  let html = `<div class="md3-screen">`;
  html += `<div class="md3-topbar"><span>${escapeHtml(screenTitle)}</span></div>`;
  html += `<div class="md3-content">`;

  switch (state.currentScreen) {
    case "list":
      html += renderAndroidList(state);
      break;
    case "detail":
      html += renderAndroidDetail(state);
      break;
    case "form":
      html += renderAndroidForm(state);
      break;
    case "dashboard":
      html += renderAndroidDashboard(state);
      break;
  }

  html += `</div></div>`;
  return html;
}

function renderAndroidList(state: PreviewState): string {
  let html = `<div class="md3-list">`;
  if (state.entities.length === 0) {
    html += `<p class="md3-text">No contacts yet. Tap + to add one.</p>`;
  } else {
    for (const e of state.entities) {
      html += `<div class="md3-card" data-action="select" data-entity-id="${escapeAttr(e.id)}">
        <div class="md3-card-content">
          <div class="md3-card-title">${escapeHtml(e.name)}</div>
          <div class="md3-card-subtitle">${escapeHtml(e.email ?? "—")}</div>
        </div>
        <button class="md3-icon-button" data-action="delete" data-entity-id="${escapeAttr(
          e.id,
        )}" aria-label="Delete">🗑</button>
      </div>`;
    }
  }
  html += `</div>`;
  html += `<button class="md3-fab" data-action="add" id="add-btn" aria-label="Add contact">+</button>`;
  return html;
}

function renderAndroidDetail(state: PreviewState): string {
  const entity = state.entities.find((e) => e.id === state.selectedEntityId);
  if (!entity) {
    return `<p class="md3-text">Contact not found.</p>`;
  }
  return `<button class="md3-button md3-button-text" data-action="back" id="back-btn">← Back</button>
    <div class="md3-detail-card">
      <h2 class="md3-headline">${escapeHtml(entity.name)}</h2>
      <p class="md3-text">Email: ${escapeHtml(entity.email ?? "—")}</p>
      <p class="md3-text">Description: ${escapeHtml(entity.description ?? "—")}</p>
      <p class="md3-text">Quantity: ${String(entity.quantity ?? 0)}</p>
      <p class="md3-text">Price: $${(entity.price ?? 0).toFixed(2)}</p>
    </div>
    <button class="md3-button" data-action="add">Edit</button>`;
}

function renderAndroidForm(state: PreviewState): string {
  const isEdit = state.selectedEntityId !== null;
  const entity = state.entities.find((e) => e.id === state.selectedEntityId);
  return `<button class="md3-button md3-button-text" data-action="back">← Back</button>
    <h2 class="md3-headline">${isEdit ? "Edit" : "Add"} Contact</h2>
    <div class="md3-form">
      ${renderMd3Field("Name", "name", "text", state, entity)}
      ${renderMd3Field("Email", "email", "text", state, entity)}
      ${renderMd3Field("Description", "description", "text", state, entity)}
      ${renderMd3Field("Quantity", "quantity", "number", state, entity)}
      ${renderMd3Field("Price", "price", "number", state, entity)}
    </div>
    <div class="md3-actions">
      <button class="md3-button" data-action="save" id="save-btn">${isEdit ? "Update" : "Create"}</button>
      <button class="md3-button md3-button-text" data-action="back" id="cancel-btn">Cancel</button>
    </div>`;
}

function renderMd3Field(
  label: string,
  field: string,
  type: string,
  state: PreviewState,
  entity: PreviewEntity | undefined,
): string {
  const value =
    state.formValues[field] ??
    (entity as PreviewEntity | undefined)?.[field as keyof PreviewEntity]?.toString() ??
    "";
  return `<label class="md3-field"><span>${escapeHtml(label)}</span><input type="${type}" data-input="${escapeAttr(
    field,
  )}" value="${escapeAttr(value)}" /></label>`;
}

function renderAndroidDashboard(state: PreviewState): string {
  const total = state.entities.length;
  const totalValue = state.entities.reduce(
    (s, e) => s + (e.price ?? 0) * (e.quantity ?? 0),
    0,
  );
  return `<h2 class="md3-headline">Dashboard</h2>
    <div class="md3-stats">
      <div class="md3-stat"><span class="md3-stat-value">${total}</span><span class="md3-stat-label">Contacts</span></div>
      <div class="md3-stat"><span class="md3-stat-value">$${totalValue.toFixed(2)}</span><span class="md3-stat-label">Total Value</span></div>
    </div>
    <button class="md3-button" data-action="navigate" data-screen="list">View Contacts</button>`;
}

/* ============================ Helpers / CSS ============================= */

function getAvailableActions(
  state: PreviewState,
): InteractiveAvailableAction[] {
  const actions: InteractiveAvailableAction[] = [];
  switch (state.currentScreen) {
    case "list":
      actions.push({ action: "add", label: "Add Contact", elementId: "add-btn" });
      break;
    case "detail":
      actions.push({ action: "back", label: "Back", elementId: "back-btn" });
      break;
    case "form":
      actions.push({ action: "save", label: "Save", elementId: "save-btn" });
      actions.push({ action: "back", label: "Cancel", elementId: "cancel-btn" });
      break;
  }
  return actions;
}

/** HTML-escape a string for safe insertion into text nodes. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** HTML-escape a string for safe insertion into an attribute value. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Hint used by callers that need to know the screen label without rendering. */
export function screenLabel(screen: PreviewScreen): string {
  switch (screen) {
    case "list":
      return "List";
    case "detail":
      return "Detail";
    case "form":
      return "Form";
    case "dashboard":
      return "Dashboard";
  }
}

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
  font-weight: 600;
  font-size: 13px;
}
.win11-titlebar-title { color: #1a1a1a; }
.win11-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
.win11-content { display: flex; flex-direction: column; gap: 16px; }
.win11-toolbar { display: flex; gap: 8px; }
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
.win11-empty { color: #616161; font-style: italic; text-align: center; }
.win11-link { color: #0078d4; cursor: pointer; text-decoration: underline; }
.win11-link:hover { color: #106ebe; }
.win11-title { font-size: 24px; font-weight: 600; margin: 0; padding: 0; color: #1a1a1a; letter-spacing: -0.01em; }
.win11-text { padding: 0; margin: 0; color: #1a1a1a; font-size: 14px; line-height: 1.4; }
.win11-detail-header { display: flex; align-items: center; gap: 12px; }
.win11-detail-body { background: #fff; padding: 16px; border-radius: 6px; border: 1px solid #e5e5e5; display: flex; flex-direction: column; gap: 6px; }
.win11-detail-actions { display: flex; gap: 8px; }
.win11-form { background: #fff; padding: 16px; border-radius: 6px; border: 1px solid #e5e5e5; display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
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
.win11-form-actions { display: flex; gap: 8px; }
.win11-dashboard { text-align: center; align-items: center; }
.win11-stats { display: flex; gap: 24px; justify-content: center; margin: 24px 0; }
.win11-stat { display: flex; flex-direction: column; background: #fff; padding: 20px 32px; border-radius: 8px; border: 1px solid #e5e5e5; }
.win11-stat-value { font-size: 28px; font-weight: 700; color: #0078d4; }
.win11-stat-label { font-size: 13px; color: #616161; }
  `;
}

function getMaterialCss(): string {
  return `
.md3-screen {
  font-family: 'Roboto', system-ui, sans-serif;
  background: #fef7ff;
  max-width: 420px;
  margin: 0 auto;
  min-height: 600px;
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  position: relative;
  color: #1c1b1f;
}
.md3-topbar { background: #6750a4; color: white; padding: 16px 20px; font-size: 20px; font-weight: 500; }
.md3-content { padding: 16px 20px; display: flex; flex-direction: column; gap: 16px; }
.md3-list { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.md3-card { background: white; border-radius: 12px; padding: 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.md3-card:hover { background: #f3edf7; }
.md3-card-content { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.md3-card-title { font-size: 16px; font-weight: 500; color: #1c1b1f; }
.md3-card-subtitle { font-size: 14px; color: #49454f; }
.md3-icon-button { background: none; border: none; padding: 8px; cursor: pointer; font-size: 18px; border-radius: 50%; }
.md3-icon-button:hover { background: #e8def8; }
.md3-fab { position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px; border-radius: 50%; background: #6750a4; color: white; border: none; font-size: 24px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
.md3-fab:hover { background: #7965b0; }
.md3-button { padding: 10px 24px; background: #6750a4; color: white; border: none; border-radius: 20px; font-size: 14px; font-weight: 500; cursor: pointer; align-self: flex-start; }
.md3-button:hover { background: #7965b0; }
.md3-button-text { background: transparent; color: #6750a4; }
.md3-button-text:hover { background: #e8def8; }
.md3-form { display: flex; flex-direction: column; gap: 16px; }
.md3-field { display: flex; flex-direction: column; gap: 4px; }
.md3-field span { font-size: 12px; color: #49454f; }
.md3-field input { padding: 12px 16px; border: 1px solid #79747e; border-radius: 4px; font-size: 16px; background: #fff; color: #1c1b1f; outline: none; }
.md3-field input:focus { border-color: #6750a4; border-width: 2px; }
.md3-actions { display: flex; gap: 12px; }
.md3-headline { font-size: 24px; font-weight: 400; color: #1c1b1f; margin: 0; }
.md3-text { color: #1c1b1f; margin: 4px 0; }
.md3-detail-card { background: white; border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 4px; }
.md3-stats { display: flex; gap: 16px; justify-content: center; }
.md3-stat { display: flex; flex-direction: column; align-items: center; background: white; padding: 16px 24px; border-radius: 16px; }
.md3-stat-value { font-size: 28px; font-weight: 700; color: #6750a4; }
.md3-stat-label { font-size: 12px; color: #49454f; }
  `;
}
