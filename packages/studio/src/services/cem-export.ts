/// <reference lib="dom" />
import type {
  CemParameter,
  JxElementTagName,
  JxMutableNode,
  JxStateDefinition,
  JxStateObject,
  JsonValue,
} from "@jxsuite/schema/types";
import {
  displayTagName,
  isFunctionDef,
  isJsonObject,
  isPrivateStateKey,
  isString,
} from "@jxsuite/schema/guards";

/** A CEM `{ text }` type reference. */
interface CemTypeText {
  text: string;
}

/** A CEM class member: a `method` (function entry) or a `field` (signal / type def). */
interface CemMember {
  kind: "method" | "field";
  name: string;
  type?: CemTypeText;
  default?: string;
  description?: string;
  parameters?: CemParameter[];
  attribute?: string;
  reflects?: true;
  deprecated?: string | true;
}

/** A CEM attribute linked to a field. */
interface CemAttribute {
  name: string;
  type?: CemTypeText;
  fieldName: string;
}

/** A CEM event a method dispatches. */
interface CemManifestEvent {
  name: string;
  type?: JsonValue;
  description?: string;
}

/** A CEM slot; the default slot has an empty name. */
interface CemSlot {
  name: string;
  description?: string;
}

/** A CEM CSS custom property. */
interface CemCssProperty {
  default: string;
  name: string;
}

/** A CEM CSS part. */
interface CemCssPart {
  name: string;
}

/** The single custom-element class declaration the manifest exports. */
interface CemClassDeclaration {
  kind: "class";
  members: CemMember[];
  name: JxElementTagName;
  tagName: JxElementTagName;
  attributes?: CemAttribute[];
  events?: CemManifestEvent[];
  slots?: CemSlot[];
  cssProperties?: CemCssProperty[];
  cssParts?: CemCssPart[];
}

/** Collect slot elements from the document tree. Whitespace-only names count as unnamed. */
export function collectSlots(node?: JxMutableNode | null, slots: string[] = []) {
  if (node?.tagName === "slot") {
    const name = node.attributes?.name;
    slots.push(isString(name) ? name.trim() : "");
  }
  if (Array.isArray(node?.children)) {
    for (const c of node.children) {
      collectSlots(isString(c) ? undefined : c, slots);
    }
  }
  return slots;
}

/**
 * Validate slot usage in a component definition. Returns a warning message or null when valid. Only
 * static children are walked — slots inside $switch cases are mutually exclusive branches and are
 * not counted (v1 limitation).
 */
export function validateComponentSlots(doc: JxMutableNode): string | null {
  const names = collectSlots(doc);
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

/**
 * Generate and download a CEM 2.1.0 manifest for the current document.
 *
 * @param {{ document: JxMutableNode }} S - Studio state
 * @param {{
 *   defCategory: (d: JxStateDefinition) => string;
 *   normParam: (p: string | CemParameter) => CemParameter;
 *   collectCssParts: (node: JxMutableNode) => { name: string }[];
 * }} helpers
 */
export function exportCemManifest(
  S: { document: JxMutableNode },
  helpers: {
    defCategory: (d: JxStateDefinition) => string;
    normParam: (p: string | CemParameter) => CemParameter;
    collectCssParts: (node: JxMutableNode) => { name: string }[];
  },
) {
  const { defCategory, normParam, collectCssParts } = helpers;
  const doc = S.document;
  const { tagName } = doc;
  if (!tagName || !displayTagName(tagName).includes("-")) {
    return;
  }

  const state = doc.state || {};
  const members: CemMember[] = [];
  const attributes: CemAttribute[] = [];
  const events: CemManifestEvent[] = [];
  const seenEvents = new Set<string>();

  for (const [key, d] of Object.entries(state)) {
    if (isPrivateStateKey(key)) {
      continue;
    } // Private (spec.md §5.6)

    const cat = defCategory(d);

    if (cat === "function") {
      if (isFunctionDef(d)) {
        const method: CemMember = { kind: "method", name: key };
        if (d.description) {
          method.description = d.description;
        }
        if (d.parameters) {
          method.parameters = d.parameters.map(normParam);
        }
        if (d.deprecated) {
          method.deprecated = isString(d.deprecated) ? d.deprecated : true;
        }
        members.push(method);
        // Collect emits
        for (const ev of d.emits ?? []) {
          if (ev.name && !seenEvents.has(ev.name)) {
            seenEvents.add(ev.name);
            const event: CemManifestEvent = { name: ev.name };
            if (ev.type !== undefined) {
              event.type = ev.type;
            }
            if (ev.description) {
              event.description = ev.description;
            }
            events.push(event);
          }
        }
      } else if (isJsonObject(d)) {
        // Legacy $handler entry — emit a bare method member
        const { description } = d;
        const method: CemMember = { kind: "method", name: key };
        if (isString(description)) {
          method.description = description;
        }
        members.push(method);
      }
    } else if (cat === "state") {
      // Naked primitive values carry no metadata; object defs are signals/type defs.
      /* SAFETY: defCategory classified this entry as "state", which it only does when the entry
         Carries no $expression, $prototype, $handler or $compute, so an object entry here is an
         Expanded signal or schema type def: the JxStateObject shape. */
      const def: JxStateObject | null = isJsonObject(d) ? (d as JxStateObject) : null;
      const field: CemMember = { kind: "field", name: key };
      if (def?.type) {
        field.type = { text: def.type };
      }
      if (def && def.default !== undefined) {
        field.default = String(def.default);
      }
      if (def?.description) {
        field.description = def.description;
      }
      if (def?.attribute) {
        field.attribute = def.attribute;
      }
      if (def?.reflects) {
        field.reflects = true;
      }
      if (def?.deprecated) {
        field.deprecated = isString(def.deprecated) ? def.deprecated : true;
      }
      members.push(field);
      if (def?.attribute) {
        attributes.push(
          def.type
            ? { name: def.attribute, type: { text: def.type }, fieldName: key }
            : { name: def.attribute, fieldName: key },
        );
      }
    }
  }

  // Slots
  const slotNames = collectSlots(doc);
  const slots = slotNames.map((name: string) => {
    const slot: CemSlot = { name: name || "" };
    if (!name) {
      slot.description = "Default slot";
    }
    return slot;
  });

  // CSS custom properties
  const style = doc.style || {};
  const cssProperties = Object.entries(style)
    .filter(([k]) => k.startsWith("--"))
    .map(([name, val]) => ({ default: String(val), name }));

  // CSS parts
  const cssParts = collectCssParts(doc).map((p) => ({ name: p.name }));

  const declaration: CemClassDeclaration = { kind: "class", members, name: tagName, tagName };
  if (attributes.length > 0) {
    declaration.attributes = attributes;
  }
  if (events.length > 0) {
    declaration.events = events;
  }
  if (slots.length > 0) {
    declaration.slots = slots;
  }
  if (cssProperties.length > 0) {
    declaration.cssProperties = cssProperties;
  }
  if (cssParts.length > 0) {
    declaration.cssParts = cssParts;
  }

  const manifest = {
    modules: [
      {
        declarations: [declaration],
        kind: "javascript-module",
        path: "",
      },
    ],
    schemaVersion: "2.1.0",
  };

  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${tagName}.cem.json`;
  a.click();
  URL.revokeObjectURL(url);
}
