/**
 * The Custom Elements Manifest of a set of compiled Jx definitions (spec.md §16.8).
 *
 * A definition already says what its element takes and gives: observed attributes, public state,
 * functions, the events they emit, slots, custom properties and parts. This module writes that down
 * in the Custom Elements Manifest format, schema version 2.1.0, so an editor, a documentation tool
 * or another Jx project's package scan (imports.md §2) can read a compiled component without
 * running it.
 *
 * One generator, pure and browser-safe, because more than one host writes a manifest: the site
 * build writes one beside the modules it compiles, and `compileElementPack` writes one beside a
 * pack. The caller supplies what only it knows: the tag, the class the compiled module defines, the
 * module's path and whether the definition renders into a shadow root.
 *
 * **The manifest says what the element does.** Its `attributes` are exactly the root
 * `observedAttributes`, because those are the attributes the element reads (spec.md §16.5). A state
 * entry's own `attribute` annotation that no observed attribute writes into it is left out and
 * reported, since a manifest that promises an attribute the element never reads misleads every
 * consumer of it.
 *
 * @license MIT
 * @docs framework/build
 */

import { collectSlotDefs } from "./component-meta";
import { LIFECYCLE_KEYS, classifyFunctionEntries } from "./function-role";
import {
  attributeStateKey,
  hasSchemaKeywords,
  isBoolean,
  isExpandedSignal,
  isFunctionDef,
  isJsonObject,
  isNumber,
  isPrivateStateKey,
  isString,
  isTemplateString,
} from "./guards";
import type { JsonObject, JsonValue, JxDocument, JxElement, JxFunctionDef } from "../types";

/** A CEM type reference: the type as source text. */
export interface CemTypeOut {
  text: string;
}

/** An attribute the element observes, linked to the field it writes when there is one. */
export interface CemAttributeOut {
  name: string;
  fieldName?: string;
  type?: CemTypeOut;
  /** The default as source text. */
  default?: string;
  description?: string;
  deprecated?: string | boolean;
}

/** A public state entry a consumer can set. */
export interface CemFieldOut {
  kind: "field";
  name: string;
  type?: CemTypeOut;
  /** The default as source text. */
  default?: string;
  description?: string;
  deprecated?: string | boolean;
  /** The observed attribute that writes this field. */
  attribute?: string;
  reflects?: true;
}

/** One parameter of a method. */
export interface CemParameterOut {
  name: string;
  type?: CemTypeOut;
  description?: string;
  optional?: boolean;
  /** The default as source text. */
  default?: string;
}

/** A public callable state entry. */
export interface CemMethodOut {
  kind: "method";
  name: string;
  description?: string;
  parameters?: CemParameterOut[];
  return?: { type: CemTypeOut };
}

/** An event the element dispatches. */
export interface CemEventOut {
  name: string;
  type: CemTypeOut;
  description?: string;
  deprecated?: string | boolean;
}

/** A slot the definition draws; the unnamed slot has an empty name. */
export interface CemSlotOut {
  name: string;
}

/** A custom property the definition's root style declares. */
export interface CemCssPropertyOut {
  name: string;
  default: string;
}

/** A part a shadow-root definition exposes. */
export interface CemCssPartOut {
  name: string;
}

/** The one custom-element class declaration of a compiled module. */
export interface CemElementDeclarationOut {
  kind: "class";
  customElement: true;
  /** The class the compiled module defines. */
  name: string;
  tagName: string;
  description?: string;
  members: (CemFieldOut | CemMethodOut)[];
  attributes?: CemAttributeOut[];
  events?: CemEventOut[];
  slots?: CemSlotOut[];
  cssProperties?: CemCssPropertyOut[];
  cssParts?: CemCssPartOut[];
}

/** One compiled module: its declaration and the `customElements.define` it performs. */
export interface CemModuleOut {
  kind: "javascript-module";
  path: string;
  declarations: [CemElementDeclarationOut];
  exports: [{ kind: "custom-element-definition"; name: string; declaration: { name: string } }];
}

/** A package's manifest. */
export interface CemPackageOut {
  schemaVersion: "2.1.0";
  modules: CemModuleOut[];
}

/** One compiled definition, as the host that compiled it describes it. */
export interface CemDefinition {
  /** The component document. */
  doc: JxElement | JxDocument;
  tagName: string;
  /** The class name the compiled module defines. */
  className: string;
  /** The module's path, relative to the package root the manifest's paths are read against. */
  modulePath: string;
  /** Whether the definition renders into a shadow root (spec.md §16.6). */
  shadow: boolean;
}

/** One definition's module, and a warning per `attribute` annotation the element does not observe. */
export interface CemModuleResult {
  module: CemModuleOut;
  warnings: string[];
}

/** A manifest, and every generator warning in module order. */
export interface CemManifestResult {
  manifest: CemPackageOut;
  warnings: string[];
}

/** The JSON type name of a value, as a field's fallback type. */
function jsonTypeName(value: JsonValue | undefined): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (isString(value)) {
    return "string";
  }
  if (isNumber(value)) {
    return "number";
  }
  return isBoolean(value) ? "boolean" : "object";
}

/**
 * A type annotation as text: a string as written, a CEM `{ text }` object's text, a JSON Schema
 * object's `type` (several names joined as a union) or the last segment of its `$ref`. Anything
 * else names no type.
 */
function typeText(type: JsonValue | undefined): string | undefined {
  if (isString(type)) {
    return type;
  }
  if (!isJsonObject(type)) {
    return undefined;
  }
  if (isString(type.text)) {
    return type.text;
  }
  if (isString(type.type)) {
    return type.type;
  }
  if (Array.isArray(type.type)) {
    return type.type.filter((name) => isString(name)).join(" | ");
  }
  return isString(type.$ref) ? type.$ref.slice(type.$ref.lastIndexOf("/") + 1) : undefined;
}

/** A `{ text }` type, or nothing when the annotation names none. */
function typeOut(type: JsonValue | undefined): CemTypeOut | undefined {
  const text = typeText(type);
  return text === undefined || text === "" ? undefined : { text };
}

/** A `deprecated` annotation as CEM carries it: a reason, or `true`. */
function deprecation(value: JsonValue | undefined): string | true | undefined {
  if (isString(value) && value !== "") {
    return value;
  }
  return value === true ? true : undefined;
}

/**
 * The field a public state entry is, or null when it is not one: a Shape 1 value (a string that is
 * no template, a number, a boolean, `null`, an array, or a plain object with no `$`-prefixed key
 * that carries no JSON Schema keyword, so `{}` counts) or a Shape 2 typed entry (spec.md §5.7).
 */
function fieldOf(name: string, def: JsonValue): CemFieldOut | null {
  const field: CemFieldOut = { kind: "field", name };
  if (isExpandedSignal(def)) {
    const type = typeOut(def.type) ?? typeOut(isString(def.$ref) ? { $ref: def.$ref } : undefined);
    field.type = type ?? { text: jsonTypeName(def.default) };
    field.default = JSON.stringify(def.default);
    if (isString(def.description)) {
      field.description = def.description;
    }
    const deprecated = deprecation(def.deprecated);
    if (deprecated !== undefined) {
      field.deprecated = deprecated;
    }
    return field;
  }
  if (isJsonObject(def)) {
    const computed = Object.keys(def).some((key) => key.startsWith("$"));
    if (computed || hasSchemaKeywords(def)) {
      return null;
    }
  } else if (isTemplateString(def)) {
    return null;
  }
  field.type = { text: jsonTypeName(def) };
  field.default = JSON.stringify(def);
  return field;
}

/** One declared parameter, bare or annotated, as CEM carries it. */
function parameterOut(parameter: JsonValue): CemParameterOut | null {
  if (isString(parameter)) {
    return { name: parameter };
  }
  if (!isJsonObject(parameter) || !isString(parameter.name)) {
    return null;
  }
  const out: CemParameterOut = { name: parameter.name };
  const type = typeOut(parameter.type);
  if (type) {
    out.type = type;
  }
  if (isString(parameter.description)) {
    out.description = parameter.description;
  }
  if (isBoolean(parameter.optional)) {
    out.optional = parameter.optional;
  }
  if (parameter.default !== undefined) {
    out.default = JSON.stringify(parameter.default);
  }
  return out;
}

/** The method a public, callable Function entry is. `state` is the implicit first parameter. */
function methodOf(name: string, def: JxFunctionDef): CemMethodOut {
  const method: CemMethodOut = { kind: "method", name };
  if (isString(def.description)) {
    method.description = def.description;
  }
  /* SAFETY: a document is JSON, so a declared parameter list is a list of JSON values. */
  const declared = (def.parameters ?? def.arguments ?? []) as JsonValue[];
  const parameters = declared
    .map((parameter) => parameterOut(parameter))
    .filter((parameter) => parameter !== null && parameter.name !== "state");
  if (parameters.length > 0) {
    /* SAFETY: the filter above removed every null. */
    method.parameters = parameters as CemParameterOut[];
  }
  /* SAFETY: a Function entry's members are document values, which are JSON. */
  const returns = typeOut(def.type as JsonValue | undefined);
  if (returns) {
    method.return = { type: returns };
  }
  return method;
}

/** Add the events an `emits` list names, first name winning. */
function addEvents(emits: JsonValue | undefined, events: Map<string, CemEventOut>): void {
  if (!Array.isArray(emits)) {
    return;
  }
  for (const entry of emits) {
    if (!isJsonObject(entry) || !isString(entry.name) || events.has(entry.name)) {
      continue;
    }
    // CEM requires an event's type, and every dispatched event is an `Event`.
    const event: CemEventOut = { name: entry.name, type: typeOut(entry.type) ?? { text: "Event" } };
    if (isString(entry.description)) {
      event.description = entry.description;
    }
    const deprecated = deprecation(entry.deprecated);
    if (deprecated !== undefined) {
      event.deprecated = deprecated;
    }
    events.set(entry.name, event);
  }
}

/**
 * The `part` names a definition's own tree exposes, in first-seen order: each whitespace-separated
 * name of a string `attributes.part`, over the static `children` walk `collectSlotDefs` makes. The
 * walk starts at the root's `children`: a `part` on the root names the host in the tree around it,
 * not a part of its own shadow tree.
 *
 * @param doc The component document
 */
export function cssPartNames(doc: JxElement | JxDocument): string[] {
  const names = new Set<string>();
  const visit = (node: JsonValue | undefined): void => {
    if (!isJsonObject(node)) {
      return;
    }
    const part = isJsonObject(node.attributes) ? node.attributes.part : undefined;
    if (isString(part)) {
      for (const name of part.split(/\s+/u)) {
        if (name !== "") {
          names.add(name);
        }
      }
    }
    visitChildren(node);
  };
  const visitChildren = (node: JsonObject): void => {
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  /* SAFETY: a Jx element is JSON data; its type names what it holds. */
  visitChildren(doc as JsonObject);
  return [...names];
}

/**
 * The manifest module of one compiled definition, and what the generator has to say about it.
 *
 * @param def The definition, as the host that compiled it describes it
 * @returns The module, and a warning for every `attribute` annotation the element does not observe
 */
export function cemModule(def: CemDefinition): CemModuleResult {
  /* SAFETY: a Jx element is JSON data; its type names what it holds. */
  const doc = def.doc as JsonObject;
  const state = isJsonObject(doc.state) ? doc.state : {};
  const roles = classifyFunctionEntries(def.doc);
  const warnings: string[] = [];
  const members: (CemFieldOut | CemMethodOut)[] = [];
  const fields = new Map<string, CemFieldOut>();
  const events = new Map<string, CemEventOut>();
  addEvents(doc.emits, events);

  for (const [key, entry] of Object.entries(state)) {
    if (isPrivateStateKey(key)) {
      continue;
    }
    if (isFunctionDef(entry)) {
      // An event is heard outside the element whichever function dispatches it.
      /* SAFETY: a Function entry's members are document values, which are JSON. */
      addEvents(entry.emits as JsonValue | undefined, events);
      if (!LIFECYCLE_KEYS.has(key) && roles.get(key) !== "computed") {
        members.push(methodOf(key, entry));
      }
      continue;
    }
    const field = fieldOf(key, entry);
    if (field) {
      members.push(field);
      fields.set(key, field);
    }
  }

  const attributes: CemAttributeOut[] = [];
  const linked = new Set<string>();
  const observed = Array.isArray(doc.observedAttributes) ? doc.observedAttributes : [];
  for (const name of new Set(observed.filter((entry) => isString(entry)))) {
    const attribute: CemAttributeOut = { name };
    const key = attributeStateKey(name);
    const field = fields.get(key);
    if (field) {
      attribute.fieldName = key;
      for (const member of ["type", "default", "description", "deprecated"] as const) {
        if (field[member] !== undefined) {
          Object.assign(attribute, { [member]: field[member] });
        }
      }
      // The first observed attribute that writes a field is the one the field names.
      if (!linked.has(key)) {
        linked.add(key);
        field.attribute = name;
        const entry = state[key];
        if (isJsonObject(entry) && entry.reflects === true) {
          field.reflects = true;
        }
      }
    }
    attributes.push(attribute);
  }
  for (const [key, entry] of Object.entries(state)) {
    if (isPrivateStateKey(key) || !isJsonObject(entry) || !isString(entry.attribute)) {
      continue;
    }
    if (fields.get(key)?.attribute !== entry.attribute) {
      warnings.push(
        `${def.tagName}: state entry "${key}" declares attribute "${entry.attribute}", but the ` +
          "element does not observe it into that entry (spec.md §16.5); add it to " +
          "observedAttributes or remove it",
      );
    }
  }

  const declaration: CemElementDeclarationOut = {
    customElement: true,
    kind: "class",
    members,
    name: def.className,
    tagName: def.tagName,
  };
  const description = isString(doc.description) ? doc.description : doc.$description;
  if (isString(description)) {
    declaration.description = description;
  }
  if (attributes.length > 0) {
    declaration.attributes = attributes;
  }
  if (events.size > 0) {
    declaration.events = [...events.values()];
  }
  const slots = collectSlotDefs(doc).map((slot) => ({ name: slot.name }));
  if (slots.length > 0) {
    declaration.slots = slots;
  }
  const style = isJsonObject(doc.style) ? doc.style : {};
  const cssProperties = Object.entries(style)
    .filter(([name]) => name.startsWith("--"))
    .map(([name, value]) => ({ default: String(value), name }));
  if (cssProperties.length > 0) {
    declaration.cssProperties = cssProperties;
  }
  // Light DOM has no `::part` (spec.md §16.6), so only a shadow definition lists any.
  const cssParts = def.shadow ? cssPartNames(def.doc).map((name) => ({ name })) : [];
  if (cssParts.length > 0) {
    declaration.cssParts = cssParts;
  }

  return {
    module: {
      declarations: [declaration],
      exports: [
        {
          declaration: { name: def.className },
          kind: "custom-element-definition",
          name: def.tagName,
        },
      ],
      kind: "javascript-module",
      path: def.modulePath,
    },
    warnings,
  };
}

/**
 * The manifest of a set of compiled definitions: one module each, sorted by tag name so the file is
 * the same whatever order a build compiled them in, with every generator warning in that order.
 *
 * @param defs The definitions a build compiled
 */
export function cemManifest(defs: readonly CemDefinition[]): CemManifestResult {
  const sorted = defs.toSorted((a, b) => (a.tagName < b.tagName ? -1 : 1));
  const built = sorted.map((def) => cemModule(def));
  return {
    manifest: { modules: built.map((entry) => entry.module), schemaVersion: "2.1.0" },
    warnings: built.flatMap((entry) => entry.warnings),
  };
}

/**
 * A manifest as the file a build writes: two-space JSON and a trailing newline, so the artifact
 * diffs.
 *
 * @param manifest
 */
export function cemManifestText(manifest: CemPackageOut): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
