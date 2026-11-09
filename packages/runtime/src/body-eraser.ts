/**
 * The runtime's seam for TypeScript function bodies (`spec.md` §23.1).
 *
 * A string `body` may use erasable TypeScript, and only JavaScript can run, so every body the
 * runtime compiles goes through {@link compileBody}. The runtime carries no stripper: a host hands
 * it one, eagerly with {@link setBodyEraser} (`eraseBody` from `@jxsuite/erase/browser`), or lazily
 * with {@link setBodyEraserLoader}, which is fetched only when a document has a body that needs it.
 * With neither, a body compiles as written, and one that does not compile says what would fix it.
 *
 * @docs framework/concepts/functions
 */
import { isFunctionEntry, isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue, JxClassDef, JxDocument } from "@jxsuite/schema/types";
import type { JxScopeValue } from "./types.ts";

/** Something erasing found. Only `unsupported` stops a body from running. */
export interface BodyEraserProblem {
  kind: string;
  message: string;
}

/** What `eraseBody` from `@jxsuite/erase/browser` is: TypeScript in, JavaScript out. */
export type BodyEraser = (text: string) => {
  code: string;
  problems: readonly BodyEraserProblem[];
};

/** What importing `@jxsuite/erase/browser` gives. */
export interface BodyEraserModule {
  eraseBody: BodyEraser;
}

/** A compiled body: called with what its caller passes, returning what its body returns. */
export type CompiledBody = (...args: never[]) => JxScopeValue;

/** Fetches the eraser, once, when a document first needs it. */
export type BodyEraserLoader = () => Promise<BodyEraserModule>;

let eraser: BodyEraser | null = null;
let loader: BodyEraserLoader | null = null;
let loading: Promise<void> | null = null;

/** Erased bodies by authored text, so a body erases once however often it compiles. */
const erased = new Map<string, string>();

/**
 * Install (or with `null`, remove) the function that erases TypeScript from a body.
 *
 * @param fn `eraseBody` from `@jxsuite/erase/browser`.
 */
export function setBodyEraser(fn: BodyEraser | null): void {
  eraser = fn;
  erased.clear();
  if (!fn) {
    // Taken away, so a later document that needs one loads it again.
    loading = null;
  }
}

/**
 * Say how to fetch the eraser when a document needs it, so a page with no typed body downloads
 * nothing. The runtime installs what the promise gives.
 *
 * @param load Typically `() => import("/path/to/erase.js")`, or null to take it away.
 */
export function setBodyEraserLoader(load: BodyEraserLoader | null): void {
  loader = load;
  loading = null;
}

/** Whether text parses as a function body, sync or async. Parsed, never called. */
function compiles(text: string): boolean {
  for (const source of [text, `return async function () {\n${text}\n}`]) {
    try {
      Reflect.construct(Function, [source]);
      return true;
    } catch {
      // Not as this kind of function; the other may still take it.
    }
  }
  return false;
}

/** `<…>` followed by a call or a tagged template: a generic call, which JavaScript reads otherwise. */
const GENERIC_CALL = /<[^<>]*>\s*[(`]/u;

/**
 * Whether a body needs the eraser before it can run as meant: it does not compile as JavaScript, or
 * it holds what TypeScript reads as a generic call.
 *
 * @param text The body as authored.
 */
export function bodyNeedsEraser(text: string): boolean {
  return GENERIC_CALL.test(text) || !compiles(text);
}

/**
 * Every function entry's string body in a tree, accessor halves and `string[]` lines included.
 *
 * @param value A document, a class definition, or a part of one.
 * @yields {string} Each body's text.
 */
function* bodiesOf(value: JsonValue): Generator<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* bodiesOf(item);
    }
    return;
  }
  if (!isJsonObject(value)) {
    return;
  }
  const isFunction = isFunctionEntry(value);
  for (const [key, child] of Object.entries(value)) {
    if (isFunction && key === "body") {
      if (isString(child)) {
        yield child;
      } else if (Array.isArray(child) && child.every((line) => isString(line))) {
        yield child.join("\n");
      } else {
        yield* bodiesOf(child);
      }
    } else if (isFunction && (key === "getter" || key === "setter") && isJsonObject(child)) {
      if (isString(child.body)) {
        yield child.body;
      }
    } else {
      yield* bodiesOf(child);
    }
  }
}

/**
 * Load the eraser first when anything in a document needs it. Called where the runtime already
 * waits (a fetched document, a fetched class), so nothing that compiles later has to.
 *
 * @param doc A document or class definition.
 */
export async function prepareBodies(doc: JsonValue | JxDocument | JxClassDef): Promise<void> {
  const load = loader;
  if (eraser || !load) {
    return;
  }
  // SAFETY: a Jx document and a class definition are JSON data; their types name what they hold.
  const tree = doc as JsonValue;
  if (!bodiesOf(tree).some((body) => bodyNeedsEraser(body))) {
    return;
  }
  loading ??= load().then((module) => {
    if (loader === load) {
      setBodyEraser(module.eraseBody);
    }
  });
  await loading;
}

/** A body's JavaScript, through the eraser when one is installed. */
function javaScriptOf(body: string, where: string): string {
  if (!eraser) {
    return body;
  }
  let code = erased.get(body);
  if (code === undefined) {
    const result = eraser(body);
    const refused = result.problems.find((problem) => problem.kind === "unsupported");
    if (refused) {
      throw new SyntaxError(`Jx: ${where} cannot run: ${refused.message}`);
    }
    ({ code } = result);
    erased.set(body, code);
  }
  return code;
}

/**
 * Compile a function body, erasing its TypeScript first when an eraser is installed.
 *
 * @param params The parameter names.
 * @param body The body as authored.
 * @param where Names the body in an error, as `'save'` or `the constructor of Counter`.
 * @throws {SyntaxError} When the body does not compile, naming it, and the call that installs an
 *   eraser when none is.
 */
export function compileBody(params: readonly string[], body: string, where: string): CompiledBody {
  const code = javaScriptOf(body, where);
  try {
    /* SAFETY: `new Function` returns an ordinary function of the named parameters; each caller
       says what it is called with and what it returns. */
    return new Function(...params, code) as CompiledBody;
  } catch (error) {
    if (!(error instanceof SyntaxError) || eraser) {
      throw error;
    }
    throw new SyntaxError(
      `Jx: ${where} does not compile as JavaScript (${error.message}). A function body may be ` +
        `TypeScript: give this page an eraser with setBodyEraser(eraseBody), eraseBody from ` +
        `@jxsuite/erase/browser.`,
      { cause: error },
    );
  }
}
