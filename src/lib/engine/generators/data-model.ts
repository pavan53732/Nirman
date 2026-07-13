// Shared data-model inference — used by the Web, Desktop, and Android
// generators so all targets in a multi-target project share the same entity
// model (e.g. CRM → Contact, inventory → InventoryItem).

export interface DataField {
  name: string;
  type: "string" | "number" | "boolean" | "Date";
  required: boolean;
}

export interface DataModel {
  entityName: string; // PascalCase, e.g. "InventoryItem"
  entityNameLower: string; // camelCase, e.g. "inventoryItem"
  entityNamePlural: string; // e.g. "inventory-items" (web route) / "inventoryItems"
  entityNamePluralLower: string; // e.g. "inventoryitems"
  fields: DataField[];
}

/** PascalCase for type/model names. */
export function pascal(name: string): string {
  const s = name.replace(/[^a-zA-Z0-9]/g, " ");
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

/** camelCase. */
export function camel(name: string): string {
  const p = pascal(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

/**
 * Infer the primary entity + fields from the prompt. Falls back to a generic
 * Item entity. Same logic as the web generator's inferDataModel, extracted so
 * all generators share one source of truth.
 */
export function inferDataModel(prompt: string): DataModel {
  const p = prompt.toLowerCase();

  let entity = "Item";
  if (/\binventory\b/.test(p)) entity = "InventoryItem";
  else if (/\bcrm\b/.test(p) || /\bcontact\b/.test(p)) entity = "Contact";
  else if (/\btask|todo\b/.test(p)) entity = "Task";
  else if (/\bproduct|shop|store\b/.test(p)) entity = "Product";
  else if (/\bpost|blog\b/.test(p)) entity = "Post";
  else if (/\buser\b/.test(p)) entity = "User";
  else if (/\binvoice\b/.test(p)) entity = "Invoice";
  else if (/\bdeal\b/.test(p)) entity = "Deal";

  const fields: DataField[] = [
    { name: "Id", type: "string", required: true },
    { name: "Name", type: "string", required: true },
    { name: "Description", type: "string", required: false },
    { name: "Quantity", type: "number", required: true },
    { name: "Price", type: "number", required: true },
    { name: "CreatedAt", type: "Date", required: true },
    { name: "UpdatedAt", type: "Date", required: true },
  ];

  if (entity === "Contact" || entity === "Invoice") {
    fields.splice(2, 0, { name: "Email", type: "string", required: false });
  }

  const entityName = pascal(entity);
  const entityNameLower = camel(entity);
  const entityNamePlural = entity.toLowerCase() + (entity.endsWith("s") ? "" : "s");
  const entityNamePluralLower = entityNamePlural.replace(/-/g, "");

  return {
    entityName,
    entityNameLower,
    entityNamePlural,
    entityNamePluralLower,
    fields,
  };
}
