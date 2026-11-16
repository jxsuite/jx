/**
 * Type references: how a document's `#/$defs/<Name>` reference finds its definition.
 *
 * A state entry's type is a JSON Schema, and a shared shape is written once and referenced (`{
 * "$ref": "#/$defs/Count" }`, spec.md §5.2 and §5.3). A reference resolves against the document's
 * own `$defs` first and then against the project's `project.json` `$defs`, by definition name
 * (site-architecture.md §3.1). Nothing is copied into a page: `$defs` is tooling only (spec.md
 * §5.1), so `jx validate` and Studio's Data panel ask this module and the output never carries a
 * definition.
 *
 * Pure functions with no platform import, so the Studio bundle can import this module.
 *
 * @docs framework/site/project-json
 */

import type { JsonObject, JsonValue } from "../types";
import { isJsonObject, isString } from "./guards";

/** What a type reference starts with: a pointer to one definition of the document's `$defs`. */
export const DEFS_POINTER_PREFIX = "#/$defs/";

/** A `$defs` table as a caller holds it: definition names to JSON Schema values. */
export type TypeDefinitions = Readonly<JsonObject> | undefined;

/** Which table answered a reference. */
export type TypeDefinitionScope = "document" | "project";

/** A reference that resolved. */
export interface ResolvedTypeRef {
  name: string;
  scope: TypeDefinitionScope;
  schema: JsonValue;
}

/** A type reference found in a value, and where in it (an RFC 6901 pointer to the `$ref`). */
export interface TypeRefSite {
  ref: string;
  at: string;
}

/** Keywords whose values map names to subschemas. */
export const MAP_SUBSCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  "$defs",
  "definitions",
  "dependencies",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);

/** Every keyword position a subschema can occupy (see {@link MAP_SUBSCHEMA_KEYWORDS} for maps). */
export const SUBSCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  ...MAP_SUBSCHEMA_KEYWORDS,
  "additionalItems",
  "additionalProperties",
  "allOf",
  "anyOf",
  "contains",
  "contentSchema",
  "else",
  "if",
  "items",
  "not",
  "oneOf",
  "prefixItems",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);

/** A decimal array index with no sign, fraction or leading zero. */
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

/** RFC 6901 §3: `~` is `~0` and `/` is `~1`, in that order. */
function escapeSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** RFC 6901 §4: `~1` is `/` and `~0` is `~`, in that order. */
function decodeSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Whether `defs` holds `name` itself, so `#/$defs/constructor` names nothing. */
function holds(defs: TypeDefinitions, name: string): defs is Readonly<JsonObject> {
  return defs !== undefined && Object.hasOwn(defs, name);
}

/**
 * The reference to one definition, name escaped.
 *
 * @param {string} name - The definition's name
 * @returns {string} `#/$defs/<name>`
 */
export function typeRefFor(name: string): string {
  return `${DEFS_POINTER_PREFIX}${escapeSegment(name)}`;
}

/**
 * The definition a type names when it is exactly a reference to one: an object whose `$ref` is
 * `#/$defs/<Name>`. Other keys on the object are annotations. A longer pointer names a part of a
 * definition and is not a name.
 *
 * @param {JsonValue | undefined} type - A state entry's `type`
 * @returns {string | null} The decoded name, or null
 */
export function typeRefName(type: JsonValue | undefined): string | null {
  if (!isJsonObject(type)) {
    return null;
  }
  const ref = type.$ref;
  if (!isString(ref) || !ref.startsWith(DEFS_POINTER_PREFIX)) {
    return null;
  }
  const rest = ref.slice(DEFS_POINTER_PREFIX.length);
  if (rest === "" || rest.includes("/")) {
    return null;
  }
  return decodeSegment(rest);
}

/**
 * Resolve a `#/$defs/<Name>/…` reference in the scope of the file that carries it: the document's
 * `$defs`, then the project's. The first segment picks the table, and the rest is walked inside the
 * definition it chose and never falls through to the other table, because a half-shadowed
 * definition would be two schemas answering for one name.
 *
 * @param {string} ref - The `$ref` value
 * @param {TypeDefinitions} [documentDefs] - The carrying document's `$defs`
 * @param {TypeDefinitions} [projectDefs] - `project.json`'s `$defs`
 * @returns {ResolvedTypeRef | null} The definition (or part of it), or null when it resolves
 *   nowhere
 */
export function resolveTypeRef(
  ref: string,
  documentDefs?: TypeDefinitions,
  projectDefs?: TypeDefinitions,
): ResolvedTypeRef | null {
  if (!ref.startsWith(DEFS_POINTER_PREFIX)) {
    return null;
  }
  const [head = "", ...path] = ref
    .slice(DEFS_POINTER_PREFIX.length)
    .split("/")
    .map((segment) => decodeSegment(segment));
  if (head === "") {
    return null;
  }
  let scope: TypeDefinitionScope;
  let table: Readonly<JsonObject>;
  if (holds(documentDefs, head)) {
    scope = "document";
    table = documentDefs;
  } else if (holds(projectDefs, head)) {
    scope = "project";
    table = projectDefs;
  } else {
    return null;
  }
  let schema: JsonValue = table[head] ?? null;
  for (const segment of path) {
    if (Array.isArray(schema)) {
      if (!ARRAY_INDEX.test(segment) || Number(segment) >= schema.length) {
        return null;
      }
      schema = schema[Number(segment)] ?? null;
    } else if (isJsonObject(schema) && Object.hasOwn(schema, segment)) {
      schema = schema[segment] ?? null;
    } else {
      return null;
    }
  }
  return { name: head, schema, scope };
}

/**
 * Every type reference under a value, in key order, with the RFC 6901 pointer to its `$ref`. Only
 * subschema keyword positions are walked: `examples`, `default`, `const` and `enum` hold instance
 * data, which may carry `$ref` strings of its own.
 *
 * @param {JsonValue | undefined} value - A JSON Schema value
 * @param {string} [at] - The pointer to `value`, for a value that is itself part of a document
 * @returns {TypeRefSite[]} One entry per `#/$defs/` reference
 */
export function collectTypeRefs(value: JsonValue | undefined, at = ""): TypeRefSite[] {
  const found: TypeRefSite[] = [];
  const walk = (node: JsonValue | undefined, pointer: string): void => {
    if (!isJsonObject(node)) {
      return;
    }
    const ref = node.$ref;
    if (isString(ref) && ref.startsWith(DEFS_POINTER_PREFIX)) {
      found.push({ at: `${pointer}/$ref`, ref });
    }
    for (const [keyword, child] of Object.entries(node)) {
      if (!SUBSCHEMA_KEYWORDS.has(keyword)) {
        continue;
      }
      const base = `${pointer}/${escapeSegment(keyword)}`;
      if (Array.isArray(child)) {
        for (const [index, item] of child.entries()) {
          walk(item, `${base}/${index}`);
        }
      } else if (MAP_SUBSCHEMA_KEYWORDS.has(keyword)) {
        if (isJsonObject(child)) {
          for (const [key, member] of Object.entries(child)) {
            walk(member, `${base}/${escapeSegment(key)}`);
          }
        }
      } else {
        walk(child, base);
      }
    }
  };
  walk(value, at);
  return found;
}

/**
 * The type references in a document that resolve nowhere. A document carries them in its state
 * entries' `type` and in its own `$defs`; a `$defs` entry with a `$prototype` is a class
 * definition, whose `#/$defs/parameters/…` pointers are relative to the class and not judged.
 *
 * @param {{ state?: object; $defs?: object }} doc - A document, or `project.json` as a `{ $defs }`
 *   document whose own definitions are the only scope
 * @param {TypeDefinitions} [projectDefs] - `project.json`'s `$defs`
 * @returns {TypeRefSite[]} The unresolved references, in document order
 */
export function findDanglingTypeRefs(
  doc: { state?: object; $defs?: object },
  projectDefs?: TypeDefinitions,
): TypeRefSite[] {
  const found: TypeRefSite[] = [];
  if (isJsonObject(doc.state)) {
    for (const [name, entry] of Object.entries(doc.state)) {
      if (isJsonObject(entry) && isJsonObject(entry.type)) {
        found.push(...collectTypeRefs(entry.type, `/state/${escapeSegment(name)}/type`));
      }
    }
  }
  if (isJsonObject(doc.$defs)) {
    for (const [name, entry] of Object.entries(doc.$defs)) {
      if (isJsonObject(entry) && !Object.hasOwn(entry, "$prototype")) {
        found.push(...collectTypeRefs(entry, `/$defs/${escapeSegment(name)}`));
      }
    }
  }
  return found.filter(
    ({ ref }) =>
      resolveTypeRef(ref, isJsonObject(doc.$defs) ? doc.$defs : undefined, projectDefs) === null,
  );
}

/**
 * The type definitions a document can name: its own sorted, then the project's it does not shadow,
 * sorted. A definition that is not an object, or that carries `$prototype`, is not a value type.
 *
 * @param {TypeDefinitions} [documentDefs] - The document's `$defs`
 * @param {TypeDefinitions} [projectDefs] - `project.json`'s `$defs`
 * @returns {{ name: string; scope: TypeDefinitionScope }[]} The names with the table each is in
 */
export function typeDefinitionNames(
  documentDefs?: TypeDefinitions,
  projectDefs?: TypeDefinitions,
): { name: string; scope: TypeDefinitionScope }[] {
  const names = (defs: TypeDefinitions): string[] =>
    Object.entries(defs ?? {})
      .filter(([, entry]) => isJsonObject(entry) && !Object.hasOwn(entry, "$prototype"))
      .map(([name]) => name)
      .toSorted();
  return [
    ...names(documentDefs).map((name) => ({ name, scope: "document" as const })),
    ...names(projectDefs)
      .filter((name) => !holds(documentDefs, name))
      .map((name) => ({ name, scope: "project" as const })),
  ];
}
