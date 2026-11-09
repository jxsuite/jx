/**
 * One verdict per `$prototype: "Function"` entry: is it a **computed** value, read reactively, or a
 * **callable**, invoked by an event, a call site or the host?
 *
 * Every tier reads this one classifier (the interpreter's `buildScope`, both compiled targets and
 * the build-time scope), so a document means the same thing in Studio and in production. It reads
 * the document, never an imported function's arity or source: a compiler has only the document, and
 * `fn.toString()` of a bundled import is not a stable input (spec.md §5.3 4b, 4d).
 *
 * @docs framework/concepts/functions
 */
import {
  bodyReturnsValue,
  hasStructuredBody,
  isFunctionDef,
  isJsonObject,
  isRef,
  isString,
  paramNames,
} from "./guards";
import type { JsonValue, JxElement, JxFunctionDef } from "../types";

/** What a Function entry is to the tiers that read it. */
export type FunctionRole = "computed" | "callable";

/** Lifecycle hooks the generated element calls itself, so they are never `$ref`'d (spec.md §16.4). */
export const LIFECYCLE_KEYS: ReadonlySet<string> = new Set(["onMount", "onUnmount", "onAdopted"]);

/**
 * The state keys a document uses as a _callable_, at any depth: bound to an `on*` event (a
 * definition's root-level handlers included, §16.1), invoked by an `$expression` `call` node
 * (§19.4c), called as `state.key(…)` from a template string or another function's body, or named as
 * a lifecycle hook (§16.4). `$defs` holds JSON Schema, not usage, and is skipped.
 *
 * Anything not used as a callable has its return value read reactively. Defaulting the other way
 * round would turn a called helper into a value and break its call site.
 */
function collectCallableKeys(doc: JxElement): Set<string> {
  const keys = new Set<string>();
  const seen = new Set<object>();

  const addStateRef = (ref: string): void => {
    if (ref.startsWith("#/state/")) {
      /* SAFETY: `String.prototype.split` always returns at least one element (the whole string
         when the separator is absent), so index 0 is present. */
      keys.add(ref.slice("#/state/".length).split("/")[0] as string);
    }
  };

  const visit = (node: JsonValue | undefined): void => {
    if (isString(node)) {
      // `${state.formatDate(d)}` in a template, or `state.helper(x)` in another function's body.
      for (const call of node.matchAll(/\bstate\.([A-Za-z_$][\w$]*)\s*\(/gu)) {
        /* SAFETY: the pattern's one capture group is not optional, so every match fills index 1
           with the called member's name. */
        keys.add(call[1] as string);
      }
      return;
    }
    if (Array.isArray(node)) {
      if (!seen.has(node)) {
        seen.add(node);
        for (const item of node) {
          visit(item);
        }
      }
      return;
    }
    if (!isJsonObject(node) || seen.has(node)) {
      return;
    }
    seen.add(node);
    // An `$expression` `call` node names its callee in `target` (spec.md §19.4c).
    if (node.operator === "call" && isRef(node.target)) {
      addStateRef(node.target.$ref);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "$defs") {
        continue;
      }
      if (key.startsWith("on") && isRef(value)) {
        addStateRef(value.$ref);
      }
      visit(value);
    }
  };

  // SAFETY: a Jx element is JSON data; its type names what it holds.
  visit(doc as JsonValue);
  for (const hook of LIFECYCLE_KEYS) {
    if (isJsonObject(doc.state) && hook in doc.state) {
      keys.add(hook);
    }
  }
  return keys;
}

/** The rules in order: the first that applies decides. */
function functionEntryRole(
  key: string,
  def: JxFunctionDef,
  callableKeys: () => Set<string>,
): FunctionRole {
  if (hasStructuredBody(def)) {
    return "callable";
  }
  // Declared parameters or arguments make an entry callable wherever it is used (§19.4c).
  if (paramNames(def.parameters ?? def.arguments).length > 0) {
    return "callable";
  }
  if (isString(def.body)) {
    return bodyReturnsValue(def.body) ? "computed" : "callable";
  }
  if (def.$src) {
    return callableKeys().has(key) ? "callable" : "computed";
  }
  return "callable";
}

/**
 * Classify every Function entry in a document's `state`. Other state shapes get no verdict. The
 * document is the one a tier builds, after the project-state merge, so a project-global entry one
 * page calls and another only reads is a function on the first and a computed on the second.
 *
 * The walk for usage runs at most once, and only when a bodyless `$src` entry reaches it.
 *
 * @param doc The document (or just `{ state }`) being built.
 */
export function classifyFunctionEntries(doc: JxElement): Map<string, FunctionRole> {
  const roles = new Map<string, FunctionRole>();
  let callable: Set<string> | null = null;
  const callableKeys = (): Set<string> => (callable ??= collectCallableKeys(doc));
  for (const [key, def] of Object.entries(doc.state ?? {})) {
    if (isFunctionDef(def)) {
      roles.set(key, functionEntryRole(key, def, callableKeys));
    }
  }
  return roles;
}
