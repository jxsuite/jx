import { collectSlotDefs } from "@jxsuite/schema/component-meta";
import type { JsonValue, JxMutableNode } from "@jxsuite/schema/types";

/**
 * Validate slot usage in a component definition. Returns a warning message or null when valid. Only
 * static children are walked — slots inside $switch cases are mutually exclusive branches and are
 * not counted (v1 limitation). The walk is `collectSlotDefs`, the one every backend's component
 * discovery and the build's Custom Elements Manifest make (spec.md §16.8), so a slot Studio warns
 * about is a slot the manifest lists.
 */
export function validateComponentSlots(doc: JxMutableNode): string | null {
  /* SAFETY: a Studio document is JSON data; its type names what it holds. */
  const names = collectSlotDefs(doc as JsonValue).map((slot) => slot.name);
  const unnamed = names.filter((n) => n === "").length;
  if (unnamed > 1) {
    return `Component has ${unnamed} unnamed <slot> elements — only one default slot is allowed. Give extra slots a name attribute.`;
  }
  const seen = new Set<string>();
  for (const n of names) {
    if (n && seen.has(n)) {
      return `Duplicate slot name "${n}" — slot names must be unique within a component.`;
    }
    seen.add(n);
  }
  return null;
}
