/**
 * A JSON Schema, read as far as a completion needs (`spec.md` §22.6).
 *
 * Nothing here validates. A completion asks a schema three things: what members an object may have,
 * what the schema of one of them is, and what values a schema names. Each is answered over every
 * schema the one asked about is made of, because a document's schema says most of what it says
 * through `$ref`, `allOf` and `oneOf`.
 *
 * A schema travels with the document it was read from, since that is what its `$ref`s point into. A
 * project's composed schema keeps the core under `#/$defs/v1`, so nothing here knows a definition
 * by its name.
 */
import { isJsonObject, isJsonPrimitive, isString } from "../guards.ts";
import type { JsonObject, JsonPrimitive, JsonValue } from "../../types.ts";

/** A schema, and the document its `$ref`s point into. */
export interface RootedSchema {
  root: JsonObject;
  schema: JsonObject;
}

/** The keywords whose every member says something of the same value. */
const COMBINERS = ["allOf", "anyOf", "oneOf"];

/** The keywords whose one schema does. */
const BRANCHES = ["then", "else"];

/** What a `$ref` into its own document points at, or null. */
function resolve(root: JsonObject, ref: string): JsonObject | null {
  if (!ref.startsWith("#")) {
    return null;
  }
  let at: JsonValue | undefined = root;
  for (const part of ref.split("/").slice(1)) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(at)) {
      at = at[Number(key)];
    } else if (isJsonObject(at)) {
      at = at[key];
    } else {
      return null;
    }
  }
  return isJsonObject(at) ? at : null;
}

/**
 * Every schema that says something of the value this one describes: itself, what it refers to, and
 * the members of its `allOf`, `anyOf`, `oneOf`, `then` and `else`, each read the same way.
 *
 * @param rooted The schema.
 * @returns Each once, the schema itself first. A schema that refers to itself ends there.
 */
export function leavesOf(rooted: RootedSchema): JsonObject[] {
  const seen = new Set<JsonObject>();
  const visit = (one: JsonValue | undefined): void => {
    if (!isJsonObject(one) || seen.has(one)) {
      return;
    }
    seen.add(one);
    if (isString(one.$ref)) {
      visit(resolve(rooted.root, one.$ref));
    }
    for (const key of COMBINERS) {
      const members = one[key];
      if (Array.isArray(members)) {
        for (const member of members) {
          visit(member);
        }
      }
    }
    for (const key of BRANCHES) {
      visit(one[key]);
    }
  };
  visit(rooted.schema);
  return [...seen];
}

/** Several schemas of one value as one schema, or null where there is none. */
function joined(root: JsonObject, schemas: JsonObject[]): RootedSchema | null {
  const [first] = schemas;
  if (!first) {
    return null;
  }
  return { root, schema: schemas.length === 1 ? first : { anyOf: schemas } };
}

/**
 * The members an object of this schema is declared to have.
 *
 * @param rooted The schema.
 * @returns Each name once with its schema, in the order the schema declares them.
 */
export function namesOf(rooted: RootedSchema): Map<string, RootedSchema> {
  const names = new Map<string, RootedSchema>();
  for (const leaf of leavesOf(rooted)) {
    if (isJsonObject(leaf.properties)) {
      for (const [name, schema] of Object.entries(leaf.properties)) {
        if (!names.has(name) && isJsonObject(schema)) {
          names.set(name, { root: rooted.root, schema });
        }
      }
    }
  }
  return names;
}

/** The schemas a leaf gives a member it does not declare by name. */
function undeclared(leaf: JsonObject, key: string): JsonObject[] {
  const found: JsonObject[] = [];
  if (isJsonObject(leaf.patternProperties)) {
    for (const [pattern, schema] of Object.entries(leaf.patternProperties)) {
      if (isJsonObject(schema) && matches(pattern, key)) {
        found.push(schema);
      }
    }
  }
  if (isJsonObject(leaf.additionalProperties)) {
    found.push(leaf.additionalProperties);
  }
  return found;
}

/** Whether a `patternProperties` pattern matches a name. One that is no pattern matches nothing. */
function matches(pattern: string, key: string): boolean {
  try {
    return new RegExp(pattern, "u").test(key);
  } catch {
    return false;
  }
}

/**
 * The schema of one member of an object of this schema.
 *
 * @param rooted The object's schema.
 * @param key The member's name.
 * @returns Its entry in `properties` wherever one is declared, and otherwise every
 *   `patternProperties` entry the name matches together with `additionalProperties`. Null where the
 *   schema says nothing of it.
 */
export function memberOf(rooted: RootedSchema, key: string): RootedSchema | null {
  const leaves = leavesOf(rooted);
  const declared = leaves.flatMap((leaf) => {
    const schema = isJsonObject(leaf.properties) ? leaf.properties[key] : undefined;
    return isJsonObject(schema) ? [schema] : [];
  });
  return joined(
    rooted.root,
    declared.length > 0 ? declared : leaves.flatMap((leaf) => undeclared(leaf, key)),
  );
}

/**
 * The schema of an item of a list of this schema.
 *
 * @param rooted The list's schema.
 * @returns Its `items`, or null where the schema is of no list.
 */
export function itemsOf(rooted: RootedSchema): RootedSchema | null {
  return joined(
    rooted.root,
    leavesOf(rooted).flatMap((leaf) => (isJsonObject(leaf.items) ? [leaf.items] : [])),
  );
}

/** Whether a schema's `type` is, or includes, the one named. */
function hasType(leaf: JsonObject, type: string): boolean {
  return Array.isArray(leaf.type) ? leaf.type.includes(type) : leaf.type === type;
}

/**
 * The values this schema names.
 *
 * @param rooted The schema.
 * @returns Its `const`, its `enum`, both booleans where it is any boolean, and its `examples`, each
 *   once. Only what one token can hold: an object or a list among them is left out.
 */
export function valuesOf(rooted: RootedSchema): JsonPrimitive[] {
  const values = new Set<JsonPrimitive>();
  const add = (value: JsonValue | undefined): void => {
    if (isJsonPrimitive(value)) {
      values.add(value);
    }
  };
  const leaves = leavesOf(rooted);
  for (const leaf of leaves) {
    add(leaf.const);
    for (const value of Array.isArray(leaf.enum) ? leaf.enum : []) {
      add(value);
    }
    // A boolean held to one value by `const` is not both.
    if (hasType(leaf, "boolean") && leaf.const === undefined && leaf.enum === undefined) {
      values.add(true);
      values.add(false);
    }
  }
  // After everything the schema requires, since an example is only a suggestion.
  for (const leaf of leaves) {
    for (const value of Array.isArray(leaf.examples) ? leaf.examples : []) {
      add(value);
    }
  }
  return [...values];
}

/**
 * What this schema says it is for.
 *
 * @param rooted The schema.
 * @returns The first `description` among the schemas it is made of, or null.
 */
export function descriptionOf(rooted: RootedSchema): string | null {
  for (const leaf of leavesOf(rooted)) {
    if (isString(leaf.description)) {
      return leaf.description;
    }
  }
  return null;
}
