/**
 * The TypeScript a checker reads for one function body (`spec.md` §23.3).
 *
 * A body is the inside of a function, so no checker can read it alone: `return` is not allowed at
 * the top of a file, and `state` is not declared anywhere. This module writes the file around it. A
 * checker is handed {@link VirtualBody.text}, finds its errors there, and {@link bodyOffsetOf} puts
 * each one back at its place in the body the author wrote. The body is copied into the file
 * verbatim, so that mapping is a single shift and cannot drift.
 *
 * It is pure and has no dependency on a compiler, a DOM or Node, so every surface that checks types
 * (Studio's editor, and later a mapper for `tsc`) reads the same file and cannot disagree about
 * what a document's types are.
 *
 * **What `State` says is what the document can prove, and no more.** A literal gives its type, an
 * object its shape and an array the types of its items. Anything a document does not determine (a
 * `$prototype` instance, an `$expression`, a template, a `timing: "server"` call, a `null`) is
 * `any`, because an error about code the author cannot fix teaches them to ignore the checker. What
 * `State` does not declare is an error: `state.nope = 1` is the case this exists to catch.
 *
 * @docs framework/concepts/functions
 */
import { classifyFunctionEntries } from "../function-role";
import { isJsonObject } from "../guards";
import { parametersOf, propertyName, stateIndex, stateOf, typeOfEntry } from "./state-types";
import type { JsonValue, JxElement } from "../../types";

/** Where a body sits in a document. */
export type VirtualTarget =
  | {
      /** A `state` entry of the document root. */
      kind: "state";
      key: string;
    }
  | {
      /** An inline `on*` handler on the element at `path`. */
      kind: "event";
      eventKey: string;
      path: readonly (string | number)[];
    };

/** One body, wrapped for a checker. */
export interface VirtualBody {
  /** The file a checker reads. */
  text: string;
  /** Where the body's first character is in {@link VirtualBody.text}. */
  bodyStart: number;
  /** One past the body's last character in {@link VirtualBody.text}. */
  bodyEnd: number;
  /** The names the function is called with, as the runtime binds them. */
  params: string[];
}

/**
 * Diagnostic codes that say a module could not be found. A body is not a module: it cannot `import`
 * statically, and a dynamic `import("x")` resolves in the browser, not in the checker, so an
 * unresolved specifier is not something the author can fix from here (`studio.md` §16.7).
 */
export const UNRESOLVED_MODULE_CODES: ReadonlySet<number> = new Set([2307, 2792, 7016]);

/**
 * The elements whose `state` a body can read, outermost first: the root, then each element on the
 * way down to the one holding the handler. A nested element's scope extends its parent's.
 */
function scopeChain(doc: JxElement, path: readonly (string | number)[]): JsonValue[] {
  // SAFETY: a document is JSON data; its types name what it holds.
  let current: JsonValue | undefined = doc as JsonValue;
  const chain: JsonValue[] = [current];
  for (const segment of path) {
    current = Array.isArray(current)
      ? current[Number(segment)]
      : isJsonObject(current)
        ? current[String(segment)]
        : undefined;
    if (stateOf(current)) {
      // SAFETY: `stateOf` only answers for an object.
      chain.push(current as JsonValue);
    }
  }
  return chain;
}

/** The function entry a target names. */
function definitionOf(doc: JxElement, target: VirtualTarget): JsonValue | undefined {
  // SAFETY: a document is JSON data; its types name what it holds.
  const root = doc as JsonValue;
  if (target.kind === "state") {
    return stateOf(root)?.[target.key];
  }
  let owner: JsonValue | undefined = root;
  for (const segment of target.path) {
    owner = Array.isArray(owner)
      ? owner[Number(segment)]
      : isJsonObject(owner)
        ? owner[String(segment)]
        : undefined;
  }
  return isJsonObject(owner) ? owner[target.eventKey] : undefined;
}

/** The members of `State`, each from the innermost element that declares it. */
function stateMembers(chain: readonly JsonValue[]): Map<string, string> {
  const members = new Map<string, string>();
  for (const node of chain) {
    // SAFETY: a document is JSON data, and the chain holds only elements that carry state.
    const roles = classifyFunctionEntries(node as JxElement);
    for (const [key, entry] of Object.entries(stateOf(node) ?? {})) {
      members.set(propertyName(key), typeOfEntry(entry, roles.get(key)));
    }
  }
  return members;
}

/**
 * Wrap one body for a checker.
 *
 * @param doc The document the body is in.
 * @param target Which body: a root `state` entry, or an inline handler on an element.
 * @param body The body's text, which need not be the text the document holds yet (an editor's
 *   buffer is checked as typed).
 * @returns The file to check, and where the body sits in it.
 */
export function generateBodyTypes(
  doc: JxElement,
  target: VirtualTarget,
  body: string,
): VirtualBody {
  const params = parametersOf(definitionOf(doc, target));
  const chain = scopeChain(doc, target.kind === "event" ? target.path : []);
  const members = [...stateMembers(chain)].map(([name, type]) => `  ${name}: ${type};`);
  members.push(`  ${stateIndex(doc)}`);
  const signature = params.map((name) => `${name}: ${name === "state" ? "State" : "any"}`);
  /* The event a handler receives is bound to a name only when the entry declares one, though the
     runtime passes it and `window.event` holds it. Not declaring it would call a working handler
     an error, so it is `any` wherever it is not a parameter. */
  const head = [
    "export {};",
    "interface State {",
    ...members,
    "}",
    "declare const event: any;",
    `async function body(${["this: any", ...signature].join(", ")}) {`,
    "",
  ].join("\n");
  return {
    bodyEnd: head.length + body.length,
    bodyStart: head.length,
    params,
    text: `${head}${body}\n}\n`,
  };
}

/**
 * Where a position in {@link VirtualBody.text} is in the body, or null when it is outside it (the
 * wrapper, which the author did not write).
 *
 * @param unit The wrapped body.
 * @param offset An offset in `unit.text`.
 * @returns An offset in the body, or null.
 */
export function bodyOffsetOf(unit: VirtualBody, offset: number): number | null {
  return offset >= unit.bodyStart && offset <= unit.bodyEnd ? offset - unit.bodyStart : null;
}
