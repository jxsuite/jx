/**
 * The type a JSON Schema says, as TypeScript writes it (`spec.md` §5.2, §23.3).
 *
 * A document's `$defs` holds its type definitions, and a `state` entry names one or carries a
 * schema of its own (§5.3). Both readers of a document's types ask here, through `state-types.ts`,
 * so the two say the same thing about the same schema.
 *
 * **A type is written as parts**, because two kinds of name in one are names the author wrote: a
 * property of an object, and the definition a `$ref` ends in. The whole-document reader maps each
 * to its token, which is what lets an editor rename one and find where it was declared, and the
 * reader of one body joins them.
 *
 * **What a schema does not say is `any`, and never an error**: a keyword that is not read here, a
 * `$ref` that leaves the document, a definition whose name is no identifier. A schema with no
 * `type` constrains nothing, as JSON Schema has it, so `properties` alone does not make an object.
 *
 * @docs framework/concepts/type-checking
 */
import { isBoolean, isJsonObject, isNumber, isString } from "../guards";
import type { JsonObject, JsonValue } from "../../types";

/** Whether a key can be written as a bare property name. */
export const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

/** The namespace a document's definitions are written in. */
export const DEFINITIONS = "$defs";

/** A reference to one definition of the document it is written in. */
const LOCAL_DEFINITION = /^#\/\$defs\/([^/]+)$/u;

/** A property name as TypeScript writes it. */
export function propertyName(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/** A JSON Pointer one step down. */
export function pointerInto(pointer: string, key: string | number): string {
  return `${pointer}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

/** A name in a type that the document wrote. */
export interface WrittenName {
  /**
   * Which name it is: a `member` is the name of the property or definition at `pointer`, and a
   * `ref` is the definition that the `$ref` at `pointer` ends in.
   */
  kind: "member" | "ref";
  /** The name as the document holds it. */
  name: string;
  pointer: string;
  /** The name as TypeScript writes it here. */
  written: string;
}

/** One stretch of a type: text the author did not write, or a name they did. */
export type TypePart = string | WrittenName;

/** Where a schema is, and what its document gives it. */
export interface SchemaSite {
  /** Whether the document has `$defs`, without which a `$ref` into it names nothing. */
  defs: boolean;
  /** The schema's JSON Pointer. */
  pointer: string;
}

/** What joins a type's members at its outermost level, which decides where it needs brackets. */
type Joins = "&" | "|" | null;

/** A type being written. */
interface Typed {
  joins: Joins;
  parts: TypePart[];
}

/** A type as text. */
export function written(parts: readonly TypePart[]): string {
  return parts.map((part) => (isString(part) ? part : part.written)).join("");
}

/** A type that is one word. */
function plain(text: string): Typed {
  return { joins: null, parts: [text] };
}

/** A type as a member of another, in brackets where it would otherwise be read apart. */
function within(typed: Typed, around: "&" | "|" | "[]"): TypePart[] {
  // `&` binds tighter than `|`, so only a union inside an intersection, or either in a list, needs them.
  const apart =
    typed.joins !== null && (around === "[]" || (around === "&" && typed.joins === "|"));
  return apart ? ["(", ...typed.parts, ")"] : typed.parts;
}

/**
 * Several types as one. A member that is only words is said once. One that holds a name the
 * document wrote is said each time it is written, because each is a place a rename has to reach.
 */
function joined(members: readonly Typed[], by: "&" | "|"): Typed {
  const seen = new Set<string>();
  const kept: Typed[] = [];
  for (const member of members) {
    const text = written(member.parts);
    if (!member.parts.every(isString) || !seen.has(text)) {
      kept.push(member);
      seen.add(text);
    }
  }
  const [only = plain("any"), ...rest] = kept;
  const parts = [...within(only, by)];
  for (const member of rest) {
    parts.push(` ${by} `, ...within(member, by));
  }
  return rest.length > 0 ? { joins: by, parts } : only;
}

/** The type of a list of values that are each a type themselves, or null when one is not. */
function literals(values: JsonValue | undefined): Typed | null {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const members: Typed[] = [];
  for (const value of values) {
    if (!(isString(value) || isNumber(value) || isBoolean(value) || value === null)) {
      return null;
    }
    members.push(plain(JSON.stringify(value)));
  }
  return joined(members, "|");
}

/** The definition a `$ref` names, when the schema is one. */
function referenced(schema: JsonObject, site: SchemaSite): Typed | null {
  if (!isString(schema.$ref)) {
    return null;
  }
  const name = LOCAL_DEFINITION.exec(schema.$ref)?.[1];
  if (!site.defs || name === undefined || !IDENTIFIER.test(name)) {
    return plain("any");
  }
  const { pointer } = site;
  return {
    joins: null,
    parts: [`${DEFINITIONS}.`, { kind: "ref", name, pointer, written: name }],
  };
}

/** The type `anyOf`, `oneOf` or `allOf` says, when the schema has it. */
function combined(
  schema: JsonObject,
  site: SchemaSite,
  keyword: "allOf" | "anyOf" | "oneOf",
): Typed | null {
  const members = schema[keyword];
  if (!Array.isArray(members) || members.length === 0) {
    return null;
  }
  const at = pointerInto(site.pointer, keyword);
  const typed = members.map((member, index) =>
    typeOf(member, { ...site, pointer: pointerInto(at, index) }),
  );
  return joined(typed, keyword === "allOf" ? "&" : "|");
}

/** An object: each property it names, optional unless `required`, and whether it holds others. */
function objectType(schema: JsonObject, site: SchemaSite): Typed {
  const properties = isJsonObject(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const others = schema.additionalProperties;
  const at = pointerInto(site.pointer, "properties");
  const parts: TypePart[] = ["{"];
  for (const [key, member] of Object.entries(properties)) {
    const pointer = pointerInto(at, key);
    parts.push(
      " ",
      { kind: "member", name: key, pointer, written: propertyName(key) },
      required.has(key) ? ": " : "?: ",
      ...typeOf(member, { ...site, pointer }).parts,
      ";",
    );
  }
  const named = parts.length > 1;
  if (!named) {
    // An object that names no property is a map, of what `additionalProperties` says when it does.
    const held = typeOf(others, {
      ...site,
      pointer: pointerInto(site.pointer, "additionalProperties"),
    });
    parts.push(" [key: string]: ", ...held.parts, ";");
  } else if (others === true || isJsonObject(others)) {
    // Beside named properties an index must admit every one of them, and only `any` always does.
    parts.push(" [key: string]: any;");
  }
  return { joins: null, parts: [...parts, " }"] };
}

/** A list of what `items` says. */
function listType(schema: JsonObject, site: SchemaSite): Typed {
  if (!isJsonObject(schema.items)) {
    return plain("any[]");
  }
  const item = typeOf(schema.items, { ...site, pointer: pointerInto(site.pointer, "items") });
  return { joins: null, parts: [...within(item, "[]"), "[]"] };
}

/** The type one `type` keyword names. */
function keywordType(keyword: JsonValue | undefined, schema: JsonObject, site: SchemaSite): Typed {
  switch (keyword) {
    case "array": {
      return listType(schema, site);
    }
    case "boolean": {
      return plain("boolean");
    }
    case "integer":
    case "number": {
      return plain("number");
    }
    case "null": {
      return plain("null");
    }
    case "object": {
      return objectType(schema, site);
    }
    case "string": {
      return plain("string");
    }
    default: {
      return plain("any");
    }
  }
}

/** The type a schema says. */
function typeOf(schema: JsonValue | undefined, site: SchemaSite): Typed {
  if (!isJsonObject(schema)) {
    return plain("any");
  }
  const { type } = schema;
  const narrowed =
    referenced(schema, site) ??
    literals("const" in schema ? [schema.const ?? null] : schema.enum) ??
    combined(schema, site, "anyOf") ??
    combined(schema, site, "oneOf") ??
    combined(schema, site, "allOf");
  if (narrowed) {
    return narrowed;
  }
  return Array.isArray(type)
    ? joined(
        type.map((keyword) => keywordType(keyword, schema, site)),
        "|",
      )
    : keywordType(type, schema, site);
}

/**
 * The type a JSON Schema says.
 *
 * @param schema The schema.
 * @param site Where it is, and whether its document has `$defs`.
 * @returns The type, in parts.
 */
export function schemaParts(schema: JsonValue | undefined, site: SchemaSite): TypePart[] {
  return typeOf(schema, site).parts;
}

/** The definitions a document holds, or null when it has no `$defs`. */
export function definitionsOf(doc: JsonValue | undefined): JsonObject | null {
  return isJsonObject(doc) && isJsonObject(doc.$defs) ? doc.$defs : null;
}

/**
 * The namespace that holds a document's definitions, each a type under its own name.
 *
 * A namespace, because a definition is then named in every message and every hover as the author
 * named it (`$defs.TodoItem`), which an interface's member is not. One whose name is not an
 * identifier cannot be declared in one and is left out, and a `$ref` to it is `any`.
 *
 * @param defs The document's `$defs`.
 * @param exported Whether the namespace is exported, as it is from a document's module.
 * @returns The declaration, in parts, with no line break after it.
 */
export function definitionParts(defs: JsonObject, exported: boolean): TypePart[] {
  const parts: TypePart[] = [`${exported ? "export " : ""}namespace ${DEFINITIONS} {\n`];
  const site: SchemaSite = { defs: true, pointer: `/${DEFINITIONS}` };
  for (const [name, schema] of Object.entries(defs)) {
    if (IDENTIFIER.test(name)) {
      const pointer = pointerInto(site.pointer, name);
      parts.push(
        "  export type ",
        { kind: "member", name, pointer, written: name },
        " = ",
        ...schemaParts(schema, { ...site, pointer }),
        ";\n",
      );
    }
  }
  return [...parts, "}"];
}
