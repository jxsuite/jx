/**
 * What a document's `state` says its types are (`spec.md` §23.3), for the two files a checker
 * reads: one body wrapped alone (`virtual-types.ts`) and a whole `.jxn` document
 * (`virtual-document.ts`). Both say the same thing about the same entry because both ask here.
 *
 * **What `State` says is what the document can prove, and no more.** A literal gives its type, an
 * object its shape and an array the types of its items. Anything a document does not determine (a
 * `$prototype` instance, an `$expression`, a template, a `timing: "server"` call, a `null`) is
 * `any`, because an error about code the author cannot fix teaches them to ignore the checker.
 */
import {
  isBoolean,
  isExpressionDef,
  isFunctionDef,
  isJsonObject,
  isNumber,
  isServerFnDef,
  isString,
  paramNames,
  hasSchemaKeywords,
} from "../guards";
import type { JsonValue, JxElement } from "../../types";

/** The most levels of an object's shape written out before it is `any`. */
const MAX_NESTING = 4;

/** The most distinct item types an array's type is built from. */
const MAX_ITEM_TYPES = 6;

/** Whether a key can be written as a bare property name. */
export const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

/** A property name as TypeScript writes it. */
export function propertyName(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/** The type a value's shape gives it, widened the way a mutable binding widens. */
function typeOfValue(value: JsonValue | undefined, depth: number): string {
  if (isString(value)) {
    return "string";
  }
  if (isNumber(value)) {
    return "number";
  }
  if (isBoolean(value)) {
    return "boolean";
  }
  if (Array.isArray(value)) {
    const types = [...new Set(value.map((item) => typeOfValue(item, depth + 1)))];
    if (types.length === 0 || types.length > MAX_ITEM_TYPES || types.includes("any")) {
      return "any[]";
    }
    return types.length === 1 ? `${types[0]}[]` : `(${types.join(" | ")})[]`;
  }
  if (isJsonObject(value) && depth < MAX_NESTING) {
    const members = Object.entries(value).map(
      ([key, item]) => `${propertyName(key)}: ${typeOfValue(item, depth + 1)}`,
    );
    return members.length === 0 ? "Record<string, any>" : `{ ${members.join("; ")} }`;
  }
  return "any";
}

/** The type a JSON Schema `type` keyword names. */
function typeOfKeyword(type: JsonValue | undefined): string {
  switch (type) {
    case "string": {
      return "string";
    }
    case "number":
    case "integer": {
      return "number";
    }
    case "boolean": {
      return "boolean";
    }
    case "array": {
      return "any[]";
    }
    default: {
      return "any";
    }
  }
}

/** The type of one `state` entry, by the shapes of `spec.md` §5. */
export function typeOfEntry(
  entry: JsonValue | undefined,
  role: "computed" | "callable" | undefined,
): string {
  if (isString(entry)) {
    // A template is a computed value of a type the document does not give.
    return entry.includes("${") ? "any" : "string";
  }
  if (!isJsonObject(entry)) {
    return typeOfValue(entry, 0);
  }
  if (isFunctionDef(entry)) {
    return role === "computed" ? "any" : "(...args: any[]) => any";
  }
  if (isString(entry.$prototype) || isExpressionDef(entry) || isServerFnDef(entry)) {
    return "any";
  }
  if ("default" in entry) {
    const { default: initial } = entry;
    return initial === null ? typeOfKeyword(entry.type) : typeOfValue(initial, 0);
  }
  return hasSchemaKeywords(entry) ? typeOfKeyword(entry.type) : typeOfValue(entry, 0);
}

/** The `state` object of an element, when it has one. */
export function stateOf(node: JsonValue | undefined): Record<string, JsonValue> | null {
  return isJsonObject(node) && isJsonObject(node.state) ? node.state : null;
}

/** The names a function is called with: `state` first, then the declared names (`spec.md` §5.3). */
export function parametersOf(definition: JsonValue | undefined): string[] {
  if (!isJsonObject(definition)) {
    return ["state"];
  }
  const declared = Array.isArray(definition.parameters)
    ? // SAFETY: `parameters` holds bare names or CEM parameter objects, the form `paramNames` reads.
      paramNames(definition.parameters as Parameters<typeof paramNames>[0])
    : (Array.isArray(definition.arguments) ? definition.arguments : []).filter(
        (name): name is string => isString(name),
      );
  // A declared `state` is moved to the front, never repeated, as the runtime builds it.
  return ["state", ...declared.filter((name) => name !== "state")];
}

/** What a document is given that it does not say, which only its project knows. */
export interface OutsideState {
  /** The project names a default layout, which wraps a document that names none. */
  layout?: boolean | undefined;
  /** The project has `state` of its own, which every page reads (`site-architecture.md` §3.2). */
  state?: boolean | undefined;
}

/**
 * The index signature that closes `State`.
 *
 * A page with a layout inherits state the page does not name, so its `State` is open, and so is one
 * in a project that has `state` of its own. Otherwise only the `$` members the host adds (`$media`,
 * `$props`) are. `$layout: false` is a page saying it has no layout, the project's default
 * included.
 *
 * @param doc The document.
 * @param outside What its project gives it. Nothing, when the reader knows of no project.
 */
export function stateIndex(doc: JxElement, outside: OutsideState = {}): string {
  const wrapped = doc.$layout === undefined ? outside.layout === true : doc.$layout !== false;
  return outside.state === true || wrapped ? "[key: string]: any;" : "[key: `$${string}`]: any;";
}
