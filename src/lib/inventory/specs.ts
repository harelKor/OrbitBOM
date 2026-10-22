// Checks an item's part-type details against the built-in part types (config/partTypes.ts): only
// the type's own fields, and a field with options takes one of them.

import { getPartType } from "@/config/partTypes";

export function checkSpecs(typeId: string, specs: Record<string, string>): { values: Record<string, string> } | { error: string } {
  const type = getPartType(typeId);
  if (!type) return { error: `Unknown part type "${typeId}".` };
  const values: Record<string, string> = {};
  for (const [key, raw] of Object.entries(specs)) {
    const field = type.fields.find((f) => f.id === key || f.label.toLowerCase() === key.toLowerCase());
    if (!field) return { error: `${type.name} has no field "${key}". Its fields: ${type.fields.map((f) => f.id).join(", ")}.` };
    const value = String(raw).trim();
    if (!value) continue;
    if (field.options && !field.options.includes(value)) return { error: `${type.name} ${field.label} is one of: ${field.options.join(", ")}.` };
    values[field.id] = value;
  }
  return { values };
}
