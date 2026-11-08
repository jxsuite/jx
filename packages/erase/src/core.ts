/**
 * Erasing TypeScript from Jx function bodies (`spec.md` §23.1): everything but loading the
 * stripper, which each entry does its own way (`index.ts` on a server, `browser.ts` in a page).
 *
 * A string `body` may use erasable TypeScript in any document format. Every tier that analyses or
 * runs one wants JavaScript, so the types are erased once, as a document is read, and everything
 * after that sees JavaScript: the analysis that classifies a body, every emitter, the interpreter.
 * The stored document keeps the authored text; only the copy that runs is erased.
 *
 * Erasing replaces each type with spaces, so a line and column in a stack trace match the body as
 * written. Only erasable syntax is accepted: `enum`, a value `namespace`, a parameter property and
 * a module `import` or `export` need code generated for them, and a body that needs imports belongs
 * in a module of its own (`spec.md` §23.2).
 *
 * The stripper is `ts-blank-space`, kept behind this package so it can be replaced. This package
 * never imports `@jxsuite/runtime`: a host builds it as a file beside the runtime and hands the
 * runtime the function.
 *
 * @docs framework/concepts/functions
 */
import { isJsonObject, isString, maskCode } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue, JxClassDef, JxDocument } from "@jxsuite/schema/types";

/** Something about a body worth saying, at a place in it. */
export interface EraseProblem {
  /** One-based. */
  column: number;
  /**
   * `unsupported`: TypeScript that cannot be erased, so the body cannot run. `meaning`: the text
   * was already JavaScript, and reading it as TypeScript changed what it does (`a < b > (c)`).
   */
  kind: "meaning" | "unsupported";
  /** One-based. */
  line: number;
  message: string;
  /** Zero-based, into the authored text. */
  offset: number;
}

/** A body's JavaScript, and what erasing it found. */
export interface ErasedBody {
  code: string;
  problems: EraseProblem[];
}

/** A one-based line and column. */
interface Place {
  column: number;
  line: number;
}

/** Line and column of an offset. */
function place(text: string, offset: number): Place {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { column: offset - before.lastIndexOf("\n"), line };
}

/** A problem at an offset. */
function problemAt(
  text: string,
  offset: number,
  kind: EraseProblem["kind"],
  message: string,
): EraseProblem {
  return { ...place(text, offset), kind, message, offset };
}

/** The first non-blank offset at or after `from`. */
function startAt(text: string, from: number): number {
  let offset = from;
  while (offset < text.length && /\s/u.test(text.charAt(offset))) {
    offset += 1;
  }
  return offset;
}

/** A module `import` or `export` at statement position, in masked code. */
const MODULE_STATEMENT = /(^|[\n;{}])(\s*)(import|export)(?=[\s{*"'])/gu;

/**
 * Whether text parses as a JavaScript function body, sync or async. Parsed and never called:
 * whether it parses is the whole question. An `await` needs the body inside an async function,
 * which the second form gives it.
 */
function isJavaScriptBody(text: string): boolean {
  for (const source of [text, `return async function () {\n${text}\n}`]) {
    try {
      const parsed: unknown = Reflect.construct(Function, [source]);
      return parsed !== null;
    } catch {
      // Not as this kind of function; the other may still take it.
    }
  }
  return false;
}

const cache = new Map<string, ErasedBody>();

/** Removes the types from a body, calling back at each node it cannot remove. */
export type Stripper = (text: string, onError: (node: { pos: number }) => void) => string;

let stripper: Stripper | null = null;
let loadStripper: (() => Stripper) | null = null;

/**
 * Say how to get the stripper. It is asked for only when a body could be TypeScript: it is all of
 * TypeScript's parser, and having it loaded made every later compile in the process slower, whether
 * or not a body needed it.
 *
 * @param load Returns the stripper, once.
 */
export function setStripperLoader(load: () => Stripper): void {
  loadStripper = load;
  stripper = null;
}

/** The stripper, loaded the first time a body needs it. */
function strip(text: string, onError: (node: { pos: number }) => void): string {
  if (!stripper) {
    if (!loadStripper) {
      throw new Error("@jxsuite/erase was imported without an entry that loads its stripper");
    }
    stripper = loadStripper();
  }
  return stripper(text, onError);
}

/**
 * Whether a body could read differently as TypeScript. A body that already parses as JavaScript and
 * has no `<` in its code cannot: every other TypeScript form either fails to parse as JavaScript
 * (`x!`, `(a: T)`, `enum`) or, like `as`, `satisfies`, `type` and `declare`, is TypeScript only
 * with no line break before it, where JavaScript would not parse it either. `<` is the exception,
 * as a generic call or arrow, so it always goes to the stripper.
 */
function couldBeTypeScript(text: string): boolean {
  return maskCode(text).includes("<") || !isJavaScriptBody(text);
}

/**
 * Erase the TypeScript from one function body.
 *
 * Erasing twice changes nothing, so a document that crosses two hosts is safe.
 *
 * @param text The body as authored.
 */
export function eraseBody(text: string): ErasedBody {
  const known = cache.get(text);
  if (known) {
    return known;
  }
  if (!couldBeTypeScript(text)) {
    const plain: ErasedBody = { code: text, problems: [] };
    cache.set(text, plain);
    return plain;
  }
  const problems: EraseProblem[] = [];
  const code = strip(text, (node) => {
    const offset = startAt(text, node.pos);
    const [word = "this"] = /^[\w$]+/u.exec(text.slice(offset)) ?? [];
    problems.push(
      problemAt(
        text,
        offset,
        "unsupported",
        `\`${word}\` is TypeScript that has to be compiled rather than erased. A function body may use only types that can be removed: no enum, value namespace or parameter property`,
      ),
    );
  });
  const masked = maskCode(code);
  for (const match of masked.matchAll(MODULE_STATEMENT)) {
    const offset = match.index + (match[1]?.length ?? 0) + (match[2]?.length ?? 0);
    problems.push(
      problemAt(
        text,
        offset,
        "unsupported",
        `A function body cannot ${match[3] ?? "import"}. Move code that needs a module into one of its own, named by $src`,
      ),
    );
  }
  if (code !== text && problems.length === 0 && isJavaScriptBody(text)) {
    const offset = [...text].findIndex((char, index) => char !== code[index]);
    problems.push(
      problemAt(
        text,
        Math.max(offset, 0),
        "meaning",
        "This was already JavaScript, and reading it as TypeScript changes it: `a < b > (c)` is a generic call in TypeScript and two comparisons in JavaScript. Add parentheses if a comparison is meant",
      ),
    );
  }
  const erased: ErasedBody = { code, problems };
  cache.set(text, erased);
  return erased;
}

/** Where a body sits, for a message: the file and the JSON Pointer of the body. */
export interface BodySite {
  path: string;
  pointer: string;
}

/** A body that cannot be erased, named by where it is. */
export class EraseError extends Error {
  readonly problems: readonly EraseProblem[];
  readonly site: BodySite;

  constructor(site: BodySite, problems: readonly [EraseProblem, ...EraseProblem[]]) {
    const [first] = problems;
    super(
      `${site.path}${site.pointer}: ${first.message} (line ${first.line}, column ${first.column})`,
    );
    this.name = "EraseError";
    this.problems = problems;
    this.site = site;
  }
}

/** What erasing a whole document or class found that did not stop it. */
export interface EraseWarning extends BodySite {
  problem: EraseProblem;
}

/** Escape a key for a JSON Pointer. */
function pointerKey(key: string | number): string {
  return String(key).replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Erase one body value, a string or an array of lines, or leave it when it is neither. */
function eraseValue(value: JsonValue, site: BodySite, warnings: EraseWarning[]): JsonValue {
  if (isString(value)) {
    return eraseOne(value, site, warnings);
  }
  if (Array.isArray(value) && value.length > 0 && value.every((line) => isString(line))) {
    /* A class body may be lines. They are erased as one text, because a type can span them, and
       erasing keeps every newline, so the lines come back one for one. */
    return eraseOne(value.join("\n"), site, warnings).split("\n");
  }
  // A structured body (`spec.md` §20) has no text to erase.
  return value;
}

/** Erase one text, throwing when it cannot be and collecting what can be said. */
function eraseOne(text: string, site: BodySite, warnings: EraseWarning[]): string {
  const { code, problems } = eraseBody(text);
  const [first, ...rest] = problems.filter((problem) => problem.kind === "unsupported");
  if (first) {
    throw new EraseError(site, [first, ...rest]);
  }
  for (const problem of problems) {
    warnings.push({ ...site, problem });
  }
  return code;
}

/** Copy a tree, erasing every function body in it. */
function walk(value: JsonValue, site: BodySite, warnings: EraseWarning[]): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      walk(item, { ...site, pointer: `${site.pointer}/${index}` }, warnings),
    );
  }
  if (!isJsonObject(value)) {
    return value;
  }
  const isFunction = value.$prototype === "Function";
  /* Built as entries: assigning `__proto__` would set the copy's prototype, where `JSON.parse`
     made it an own key. */
  const entries: [string, JsonValue][] = [];
  const copy = {
    set: (key: string, child: JsonValue): void => {
      entries.push([key, child]);
    },
  };
  for (const [key, child] of Object.entries(value)) {
    const at = { ...site, pointer: `${site.pointer}/${pointerKey(key)}` };
    if (isFunction && key === "body") {
      copy.set(key, eraseValue(child, at, warnings));
    } else if (isFunction && (key === "getter" || key === "setter") && isJsonObject(child)) {
      // An accessor's halves hold a body of their own, with no `$prototype` to say so.
      const half: JsonObject = { ...child };
      if (child.body !== undefined) {
        half.body = eraseValue(child.body, { ...at, pointer: `${at.pointer}/body` }, warnings);
      }
      copy.set(key, half);
    } else {
      copy.set(key, walk(child, at, warnings));
    }
  }
  return Object.fromEntries(entries);
}

/**
 * An erased copy of a document: every `Function` entry's string body, wherever it sits (state, an
 * inline handler, `$map`, `cases`, a class member), as JavaScript. Any other `body` is left alone,
 * because one may be data (a `Request`'s payload, a component's own state).
 *
 * @param document The document as read.
 * @param path Its path, which names it in an error.
 * @param warnings Collects what erasing found that did not stop it.
 * @throws {EraseError} When a body uses TypeScript that cannot be erased.
 */
export function eraseDocument<T extends JsonValue | JxDocument | JxClassDef>(
  document: T,
  path: string,
  warnings: EraseWarning[] = [],
): T {
  // SAFETY: a Jx document is JSON data; its type says only which members it may hold.
  const tree = document as JsonValue;
  // SAFETY: the walk copies the tree shape for shape, replacing only string bodies with strings.
  return walk(tree, { path, pointer: "" }, warnings) as T;
}

/**
 * An erased copy of a class definition: its constructor's, methods' and accessors' bodies. The same
 * walk as {@link eraseDocument}, because a member is a `Function` entry by the same rule.
 *
 * @param definition The class definition as read.
 * @param path Its path, which names it in an error.
 * @param warnings Collects what erasing found that did not stop it.
 * @throws {EraseError} When a body uses TypeScript that cannot be erased.
 */
export function eraseClass<T extends JsonValue | JxDocument | JxClassDef>(
  definition: T,
  path: string,
  warnings: EraseWarning[] = [],
): T {
  return eraseDocument(definition, path, warnings);
}
