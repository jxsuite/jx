/**
 * A document's own modules (spec.md §23.2): how a `$src` names them, and how that name is given the
 * document it belongs to.
 *
 * A document carries its client and server modules as text in `$script`, and an entry names one
 * with `$src: "#client"` or `$src: "#server"`. Those two strings say nothing about WHICH document,
 * and everything downstream keys a module on the specifier it was spelled with: the interpreter's
 * module cache, the build's bundle table, the site worker's one-route-per-export rule. A page and
 * its layout each naming `#client` would be one module to all of them.
 *
 * So a document is **qualified** once, as it is read and before anything merges it with another:
 * `#client` becomes `jx-script:<path>#client`, where `<path>` is the document's own address. After
 * that a page's module and its layout's are different strings, and nothing downstream needs to know
 * that document scripts exist.
 *
 * Pure string and tree work, with no node imports, so every host can use it.
 *
 * @docs framework/concepts/functions
 */

import { isJsonObject, isString } from "./guards";
import type { JsonValue, JxDocument, JxDocumentValue, JxElement } from "../types";

export type { JxDocumentScripts } from "../types";

/** The two modules a document may carry: one the browser runs, one the server runs. */
export type ScriptSide = "client" | "server";

/** What a qualified script specifier starts with. */
export const SCRIPT_SPECIFIER_PREFIX = "jx-script:";

/** The authored `$src` of an entry naming its own document's client module. */
export const CLIENT_SCRIPT_REF = "#client";

/** The authored `$src` of an entry naming its own document's server module. */
export const SERVER_SCRIPT_REF = "#server";

/** A qualified specifier, read back: the document it names, and which of its modules. */
/** A URL path naming a TypeScript module. */
const TYPESCRIPT_PATH = /\.[cm]?ts$/iu;

/**
 * True when a URL path names a TypeScript module: text a browser cannot import as written, which a
 * page's module loader erases first.
 *
 * @param pathname A URL's path, without its query or fragment.
 */
export function isTypeScriptPath(pathname: string): boolean {
  return TYPESCRIPT_PATH.test(pathname);
}

/**
 * A document as a browser may have it: without its server module. The module is called over the
 * network and never imported by a page, so its text is nothing a reader should be sent.
 *
 * The document given is not changed, and one with no server module is returned as it is. `$script`
 * itself stays, however little is left in it: it is what says the document has modules of its own,
 * which is what has a host qualify the entries that name them.
 *
 * @param doc The document as read.
 */
export function withoutServerScript<T extends JxDocument>(doc: T): T {
  const script = doc.$script;
  if (script?.server === undefined) {
    return doc;
  }
  const { server: _server, ...kept } = script;
  return { ...doc, $script: kept };
}

export interface ScriptSpecifier {
  /** The document's address, as it was qualified: `/`-separated and without a leading `./`. */
  path: string;
  side: ScriptSide;
}

/** The side an authored `$src` names when it names its own document's module, else `null`. */
export function scriptRefSide(src: string): ScriptSide | null {
  if (src === CLIENT_SCRIPT_REF) {
    return "client";
  }
  if (src === SERVER_SCRIPT_REF) {
    return "server";
  }
  return null;
}

/** A document address in the one spelling a specifier uses: `/` separators, no leading `./`. */
function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
}

/**
 * The specifier naming one of a document's modules: `jx-script:components/counter.jxn#client`.
 *
 * @param path The document's address, project-relative in a project.
 * @param side Which module.
 */
export function scriptSpecifier(path: string, side: ScriptSide): string {
  return `${SCRIPT_SPECIFIER_PREFIX}${normalizedPath(path)}#${side}`;
}

/** True when a `$src` is a qualified script specifier. */
export function isScriptSpecifier(src: string): boolean {
  return src.startsWith(SCRIPT_SPECIFIER_PREFIX);
}

/**
 * Read a qualified specifier back into the document it names and the side. `null` for anything
 * else, including a `jx-script:` specifier that names no document or neither side.
 */
export function parseScriptSpecifier(src: string): ScriptSpecifier | null {
  if (!isScriptSpecifier(src)) {
    return null;
  }
  const rest = src.slice(SCRIPT_SPECIFIER_PREFIX.length);
  const hash = rest.lastIndexOf("#");
  if (hash <= 0) {
    return null;
  }
  const side = rest.slice(hash + 1);
  if (side !== "client" && side !== "server") {
    return null;
  }
  return { path: rest.slice(0, hash), side };
}

/**
 * One value of a document with every `$src` naming its own document's module qualified. A value
 * with nothing to qualify is returned as it was given, so an untouched subtree is shared rather
 * than copied.
 */
function qualifiedValue(value: JxDocumentValue, path: string): JxDocumentValue {
  if (Array.isArray(value)) {
    const items = value.map((item) => qualifiedValue(item, path));
    /* SAFETY: `items` holds what `value` held, each member either itself or its qualified copy, so
       it is the same kind of array `value` was. */
    return items.some((item, index) => item !== value[index]) ? (items as JsonValue[]) : value;
  }
  if (!isJsonObject(value)) {
    return value;
  }
  let copy: Record<string, JxDocumentValue> | null = null;
  for (const [key, member] of Object.entries(value)) {
    let next: JxDocumentValue = member;
    if (key === "$src" && isString(member)) {
      const side = scriptRefSide(member);
      next = side === null ? member : scriptSpecifier(path, side);
    } else if (key !== "$script") {
      next = qualifiedValue(member, path);
    }
    if (next !== member) {
      copy ??= { ...value };
      copy[key] = next;
    }
  }
  /* SAFETY: `copy` is `value` with some members replaced by their qualified copies, which are the
     same kinds of value, so it is the kind of object `value` was. */
  return copy === null ? value : (copy as JxDocumentValue);
}

/**
 * A document with every `$src: "#client"` and `$src: "#server"` in it naming THIS document:
 * `jx-script:<path>#client`. Run once as a document is read, before a layout merge or a project
 * state merge, because after either nothing records which file an entry was written in.
 *
 * The document given is not changed, and one with no such entry is returned as it is. `$script`
 * itself is left alone: it is the text the specifier names. Qualifying twice changes nothing.
 *
 * @param doc The document as read.
 * @param path The document's address: project-relative in a project, with either separator.
 */
export function qualifyScripts<T extends JxDocument>(doc: T, path: string): T {
  /* SAFETY: `qualifiedValue` returns its argument or a copy of it with `$src` strings replaced, so
     a document goes in and the same kind of document comes out. */
  return qualifiedValue(doc, path) as T;
}

// ─── Advice ─────────────────────────────────────────────────────────────────────

/** The two things worth saying about how a document names its modules. */
export type ScriptAdviceRule = "relative-src" | "lazy-shares-script";

/**
 * One piece of advice about a `$src`. Advice, not a defect: the document is correct and runs as
 * written everywhere, so nothing that reports one may fail on it.
 */
export interface ScriptAdvice {
  rule: ScriptAdviceRule;
  /** The entry the `$src` is written on, in the segment vocabulary a document path uses. */
  path: (string | number)[];
  /** One sentence naming what was found, in the author's language. */
  message: string;
  /** What to do instead, and what happens when nothing is done. */
  detail: string;
}

/** Matches a `$src` naming a file beside its document: `./counter.js`, `../lib/format.ts`. */
const RELATIVE_SRC = /^\.{1,2}\//u;

/** Matches a `$src` naming a JSON document, which is a class schema and never a script (§12.2). */
const JSON_SRC = /\.json$/iu;

/**
 * True when a `$src` names a script file by a relative path: the one spelling a document's own
 * script can stand in for. An `npm:` package, a kit behaviour (`jx-ui:/…`), an absolute URL and a
 * `.class.json` schema have no other spelling, and `#client` is already the script.
 *
 * @param src An entry's `$src`.
 */
export function isRelativeScriptSrc(src: string): boolean {
  return RELATIVE_SRC.test(src) && !JSON_SRC.test(src);
}

/** True when a `$src` names its document's client module, as authored or once qualified. */
function namesClientScript(src: string): boolean {
  return scriptRefSide(src) === "client" || parseScriptSpecifier(src)?.side === "client";
}

/** An entry carrying a `$src`, as the walk found it. */
interface SrcEntry {
  path: (string | number)[];
  src: string;
  lazy: boolean;
}

/** Every object in a document that carries a string `$src`, in document order. */
function srcEntries(
  value: JxDocumentValue,
  path: (string | number)[],
  found: SrcEntry[],
): SrcEntry[] {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      srcEntries(item, [...path, index], found);
    }
    return found;
  }
  if (!isJsonObject(value)) {
    return found;
  }
  if (isString(value.$src)) {
    found.push({ lazy: value.$lazy === true, path, src: value.$src });
  }
  for (const [key, member] of Object.entries(value)) {
    // `$script` is the modules' text, not entries that name one.
    if (key !== "$script") {
      srcEntries(member, [...path, key], found);
    }
  }
  return found;
}

/** What an entry is called in a sentence: its key, or `this entry` for one in a list. */
function entryName(path: (string | number)[]): string {
  const last = path.at(-1);
  return isString(last) ? `"${last}"` : "this entry";
}

/**
 * What there is to say about how a document names its modules (spec.md §23.2).
 *
 * - **`relative-src`**: an entry imports a file beside the document. A module only that document uses
 *   can be the document's own script, which makes the document one file. A `$lazy` entry is left
 *   alone: a module of its own is exactly what it needs.
 * - **`lazy-shares-script`**: a `$lazy` entry names the client script that another entry loads up
 *   front. A document has one client script, so the deferral defers nothing.
 *
 * `jx validate` and Studio's Problems both report from here, so the two say the same thing about
 * the same document.
 *
 * @param doc The document as written, or as qualified: both spellings of `#client` are read.
 */
export function findScriptAdvice(doc: JxDocument | JxElement): ScriptAdvice[] {
  const entries = srcEntries(doc, [], []);
  const eagerClient = entries.some((entry) => !entry.lazy && namesClientScript(entry.src));
  const advice: ScriptAdvice[] = [];
  for (const entry of entries) {
    const name = entryName(entry.path);
    if (!entry.lazy && isRelativeScriptSrc(entry.src)) {
      advice.push({
        detail:
          "A module only this document uses can be the document's own script: move the code " +
          'into the client script (the server script for a `timing: "server"` entry) and name ' +
          'it with `$src: "#client"` or `$src: "#server"`. A module several documents import ' +
          "stays a file, and this one keeps working as it is.",
        message: `${name} imports ${entry.src}, which the document could carry as its own script`,
        path: entry.path,
        rule: "relative-src",
      });
    } else if (entry.lazy && eagerClient && namesClientScript(entry.src)) {
      advice.push({
        detail:
          "A document has one client script, and another entry imports it as the page loads, " +
          "so `$lazy` defers nothing here. Move this export to a `$src` module of its own to " +
          "load it on its first call.",
        message: `${name} is $lazy, but the script it is in loads with the page`,
        path: entry.path,
        rule: "lazy-shares-script",
      });
    }
  }
  return advice;
}
