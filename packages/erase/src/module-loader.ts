/**
 * The browser's module loader (`spec.md` §23.2): what lets a page that interprets a document import
 * TypeScript, a `.ts` file a `$src` names or a document's own client script.
 *
 * A browser imports JavaScript from a URL and nothing else, and no interpreting host transpiles
 * what it serves. So this fetches a module's text, erases its types, and imports the result from a
 * `blob:` URL. A `blob:` module has no directory, so every import in it is rewritten first: a
 * relative one to the absolute URL it meant, a `.ts` or `.jxn` one to the `blob:` URL of that
 * module loaded the same way, and a package to wherever the host says packages are served.
 *
 * Two things a bundle can do and this cannot, each a named error:
 *
 * - **A cycle.** A `blob:` URL exists only once its text does, and the text names the URLs it
 *   imports, so two modules that import each other can never both be written.
 * - **A package with no host to serve it.** A bare specifier is the host's to answer.
 *
 * Imports are found by pattern in the erased text with its strings and comments blanked, not in a
 * syntax tree: the stripper keeps its parser to itself, and a second copy of TypeScript's would
 * double a file a page already loads only when it must. An `import()` whose argument is not a
 * string literal is left as written.
 *
 * Like the rest of this package, it imports no runtime: the runtime is handed {@link loadModule}.
 *
 * @docs framework/concepts/functions
 */
import { isNpmSpecifier, NPM_SPECIFIER_PREFIX } from "@jxsuite/schema/asset-paths";
import {
  isTypeScriptPath,
  parseScriptSpecifier,
  SCRIPT_SPECIFIER_PREFIX,
} from "@jxsuite/schema/document-scripts";
import { isJsonObject, isString, maskCode } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";
import { eraseModule } from "./core.ts";

/** What a host tells the loader about the page it is loading for. */
export interface ModuleLoadOptions {
  /**
   * What the specifier resolves against when it is relative, and what a document's project path in
   * a `jx-script:` specifier is relative to. The page's own URL when omitted.
   */
  base?: string | undefined;
  /**
   * Where the host serves a package: a bare specifier in, a URL out. Absent, a package import
   * fails.
   */
  resolveNpm?: ((specifier: string) => string) | null | undefined;
  /**
   * The module's text, when the host already holds it: a document it read has its script in hand,
   * and a document that was never at a URL has nowhere to be fetched from. Absent, the module is
   * fetched.
   */
  text?: string | undefined;
}

/** One import in a module's text: the string literal, quotes included, and what it says. */
interface ModuleImport {
  start: number;
  end: number;
  specifier: string;
}

/** A module fetched and erased, not yet importable. */
interface ModuleSource {
  /** JavaScript, the same length and lines as the authored text. */
  code: string;
  /** The URL its relative imports resolve against. */
  from: string;
  imports: ModuleImport[];
  /** What names it in an error and in a debugger. */
  name: string;
}

/** The options of one load, with its base settled to an absolute URL. */
interface LoadContext {
  base: string;
  resolveNpm: ((specifier: string) => string) | null | undefined;
}

/** What an import leads to: a module this loader loads, or a URL the browser imports itself. */
type ImportTarget = { kind: "load"; id: string } | { kind: "url"; url: string };

/** What the client module of a document is called: its document's URL, then this. */
const CLIENT_SUFFIX = "#client";

/** A specifier that names a place relative to the importer, or to its origin. */
const RELATIVE = /^\.{0,2}\//u;

/** A URL path naming a `.jxn` document. */
const JXN_PATH = /\.jxn$/iu;

const IDENTIFIER = String.raw`[\w$]+`;
const NAMED = String.raw`\{[^{}]*\}`;
const NAMESPACE = String.raw`\*\s*as\s+${IDENTIFIER}`;
const CLAUSE = String.raw`(?:${IDENTIFIER}(?:\s*,\s*(?:${NAMED}|${NAMESPACE}))?|${NAMED}|${NAMESPACE})`;
/** Where a statement can start, in masked code. */
const STATEMENT = String.raw`(?:^|[\n;}])\s*`;

/** `import "x"` and `import … from "x"`, up to the string. */
const STATIC_IMPORT = new RegExp(
  String.raw`${STATEMENT}import\s*(?:${CLAUSE}\s*from\s*)?(?=["'])`,
  "gu",
);

/** `export { … } from "x"` and `export * from "x"`, up to the string. */
const EXPORT_FROM = new RegExp(
  String.raw`${STATEMENT}export\s*(?:${NAMED}|\*(?:\s*as\s+(?:${IDENTIFIER}|"[^"]*"|'[^']*'))?)\s*from\s*(?=["'])`,
  "gu",
);

/** `import("x"`, up to the string. */
const DYNAMIC_IMPORT = /(?<![\w$.])import\s*\(\s*(?=["'])/gu;

/** What may follow the argument of an `import()` that is one string literal. */
const AFTER_ARGUMENT = /^\s*[,)]/u;

/** Modules fetched and erased, by id, so one imported from two places is fetched once. */
const sources = new Map<string, Promise<ModuleSource>>();

/** The `blob:` URL of each module made importable, by id, so it is one module to everything. */
const linked = new Map<string, Promise<string>>();

/** The text a host handed over for a module, by id, read in place of a fetch. */
const handed = new Map<string, string>();

/** The id of a document's client module. */
function scriptId(documentUrl: string): string {
  return `${SCRIPT_SPECIFIER_PREFIX}${documentUrl}${CLIENT_SUFFIX}`;
}

/** The document a script id names, or `null` when the id is a file's URL. */
function scriptDocument(id: string): string | null {
  return id.startsWith(SCRIPT_SPECIFIER_PREFIX)
    ? id.slice(SCRIPT_SPECIFIER_PREFIX.length, -CLIENT_SUFFIX.length)
    : null;
}

/** What names a module to a reader: a file's URL, or the place a document's script stands. */
function moduleName(id: string): string {
  const documentUrl = scriptDocument(id);
  return documentUrl === null ? id : `${documentUrl}.jx-client.ts`;
}

/** What a URL leads to: a module to load when it names TypeScript or a document, else itself. */
function urlTarget(url: URL): ImportTarget {
  if (isTypeScriptPath(url.pathname)) {
    return { id: url.href, kind: "load" };
  }
  if (JXN_PATH.test(url.pathname)) {
    return { id: scriptId(url.href), kind: "load" };
  }
  return { kind: "url", url: url.href };
}

/**
 * What a specifier leads to.
 *
 * @param specifier As the importer wrote it.
 * @param from The URL a relative specifier resolves against.
 * @param importer Names the importing module in an error.
 * @param context The load's base and package resolver.
 * @throws {Error} For a server script, a specifier that names no script, and a package no host
 *   serves.
 */
function importTarget(
  specifier: string,
  from: string,
  importer: string,
  context: LoadContext,
): ImportTarget {
  if (specifier.startsWith(SCRIPT_SPECIFIER_PREFIX)) {
    const script = parseScriptSpecifier(specifier);
    if (script === null) {
      throw new Error(`Jx: "${specifier}" does not name a document's script`);
    }
    if (script.side === "server") {
      throw new Error(
        `Jx: ${script.path}: its server script cannot be imported by code a browser runs`,
      );
    }
    return { id: scriptId(new URL(script.path, context.base).href), kind: "load" };
  }
  if (RELATIVE.test(specifier)) {
    return urlTarget(new URL(specifier, from));
  }
  if (!isNpmSpecifier(specifier) && URL.canParse(specifier)) {
    return urlTarget(new URL(specifier));
  }
  const packageName = isNpmSpecifier(specifier)
    ? specifier.slice(NPM_SPECIFIER_PREFIX.length)
    : specifier;
  if (!context.resolveNpm) {
    throw new Error(
      `Jx: ${importer} imports "${specifier}", a package, and this page has nothing that serves ` +
        `one. The host says where packages are with setNpmModuleResolver; a built site bundles it`,
    );
  }
  return { kind: "url", url: new URL(context.resolveNpm(packageName), context.base).href };
}

/**
 * Every import in a module's JavaScript whose specifier is a string literal, in order.
 *
 * @param code The module, already erased.
 */
export function importsOf(code: string): ModuleImport[] {
  const masked = maskCode(code);
  const found: ModuleImport[] = [];
  for (const pattern of [STATIC_IMPORT, EXPORT_FROM, DYNAMIC_IMPORT]) {
    for (const match of masked.matchAll(pattern)) {
      const start = match.index + match[0].length;
      const end = masked.indexOf(masked.charAt(start), start + 1) + 1;
      // An unclosed string is not JavaScript, and a computed argument is not this loader's to read.
      const literal =
        end > 0 && (pattern !== DYNAMIC_IMPORT || AFTER_ARGUMENT.test(masked.slice(end)));
      if (literal) {
        found.push({ end, specifier: code.slice(start + 1, end - 1), start });
      }
    }
  }
  return found.toSorted((a, b) => a.start - b.start);
}

/** Fetch a module's text, as the response a failure can be named from. */
async function fetched(url: string, what: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Jx: failed to fetch ${what} ${url} (${response.status})`);
  }
  return response;
}

/** A document's client script, fetched from the document. */
async function scriptText(documentUrl: string): Promise<string> {
  const response = await fetched(documentUrl, "the document");
  let document: JsonValue;
  try {
    /* SAFETY: trust boundary. Whatever the host answered parsed as JSON, which is all the type
       says; what it holds is checked below before any of it is used. */
    document = (await response.json()) as JsonValue;
  } catch (error) {
    throw new Error(
      `Jx: ${documentUrl} did not answer with JSON, so its script cannot be read. A Jx site ` +
        `answers a .json or .jxn document as JSON`,
      { cause: error },
    );
  }
  const script = isJsonObject(document) ? document.$script : undefined;
  const text = isJsonObject(script) ? script.client : undefined;
  if (!isString(text)) {
    throw new Error(
      `Jx: ${documentUrl} has no client script: nothing in it is $script.client, but something ` +
        `names its client module`,
    );
  }
  return text;
}

/** A TypeScript file's text. */
async function fileText(url: string): Promise<string> {
  const response = await fetched(url, "the module");
  // A single-page host answers a path it does not have with its shell, at 200.
  if ((response.headers.get("Content-Type") ?? "").includes("text/html")) {
    throw new Error(`Jx: ${url} returned HTML, not a module, so this path is not served`);
  }
  return response.text();
}

/** Erase one module, fetched unless the host handed its text over. */
async function readSource(id: string, given?: string): Promise<ModuleSource> {
  const documentUrl = scriptDocument(id);
  const name = moduleName(id);
  const text = given ?? (documentUrl === null ? await fileText(id) : await scriptText(documentUrl));
  const { code, problems } = eraseModule(text);
  const [refused] = problems;
  if (refused) {
    throw new SyntaxError(
      `Jx: ${name} cannot run: ${refused.message} (line ${refused.line}, column ${refused.column})`,
    );
  }
  return { code, from: documentUrl ?? id, imports: importsOf(code), name };
}

/** One entry of a cache of promises, forgotten when it fails so a later page can try again. */
function once<T>(cache: Map<string, Promise<T>>, id: string, make: () => Promise<T>): Promise<T> {
  let pending = cache.get(id);
  if (pending === undefined) {
    pending = make();
    cache.set(id, pending);
    const made = pending;
    pending.catch(() => {
      // Only its own entry: text handed over since has put another in its place.
      if (cache.get(id) === made) {
        cache.delete(id);
      }
    });
  }
  return pending;
}

/** One module fetched and erased, however many modules and loads ask for it. */
function sourceOf(id: string): Promise<ModuleSource> {
  return once(sources, id, () => readSource(id, handed.get(id)));
}

/**
 * Take a module's text from the host. Text that differs from what the module was last made from
 * replaces it, which is how a document edited and read again on the same page runs what it now
 * says; the same text again changes nothing, so the module and its state stay shared.
 */
function give(id: string, text: string): void {
  if (handed.get(id) === text) {
    return;
  }
  handed.set(id, text);
  sources.delete(id);
  linked.delete(id);
}

/**
 * Read everything a module reaches and refuse a cycle, before any of it is made importable. Done
 * first, so making a module importable only ever waits on modules below it and two loads at once
 * cannot wait on each other; and walked depth first, one branch at a time, which is what makes
 * "already read" mean "already checked".
 *
 * @param id The module.
 * @param path The modules that led here, outermost first.
 * @param visited Modules already read through on this load.
 * @param context The load's base and package resolver.
 */
async function readGraph(
  id: string,
  path: readonly string[],
  visited: Set<string>,
  context: LoadContext,
): Promise<void> {
  if (path.includes(id)) {
    const cycle = [...path.slice(path.indexOf(id)), id].map((member) => moduleName(member));
    throw new Error(
      `Jx: these modules import each other in a cycle, which a page that interprets a document ` +
        `cannot load: ${cycle.join(" → ")}. Break the cycle, or build the site, where it is bundled`,
    );
  }
  if (visited.has(id)) {
    return;
  }
  visited.add(id);
  const source = await sourceOf(id);
  const targets = source.imports
    .map(({ specifier }) => importTarget(specifier, source.from, source.name, context))
    .filter((target) => target.kind === "load");
  // Asked for together, so the walk below waits on fetches already under way and not one by one.
  for (const target of targets) {
    void sourceOf(target.id);
  }
  for (const target of targets) {
    await readGraph(target.id, [...path, id], visited, context);
  }
}

/** A module's `blob:` URL: its JavaScript with every import naming something a browser can import. */
async function link(id: string, context: LoadContext): Promise<string> {
  const source = await sourceOf(id);
  let code = "";
  let at = 0;
  for (const { end, specifier, start } of source.imports) {
    const target = importTarget(specifier, source.from, source.name, context);
    const url =
      target.kind === "load"
        ? await once(linked, target.id, () => link(target.id, context))
        : target.url;
    code += source.code.slice(at, start) + JSON.stringify(url);
    at = end;
  }
  code += `${source.code.slice(at)}\n//# sourceURL=${source.name}`;
  return URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
}

/** Import a URL the browser can import, for the module's namespace: its exports, by name. */
async function importNamespace(url: string): Promise<object> {
  /* SAFETY: `import()` is typed `any`; what it resolves to is a module namespace, an object. */
  return (await import(url)) as object;
}

/**
 * Import a TypeScript module in a browser: a `.ts` file, or a document's client script named by a
 * `jx-script:` specifier.
 *
 * A module is fetched, erased and made importable once however many modules import it, so module
 * state is shared as it is in a bundle. A module is read again only when the page is.
 *
 * @param specifier A `jx-script:<document>#client` specifier, or the URL of a `.ts` file.
 * @param options The host's base and package resolver, and the module's text when it holds it.
 * @returns The module's namespace: its exports, by name.
 * @throws {Error} When a module cannot be fetched, uses TypeScript that cannot be erased, imports
 *   in a cycle, or imports a package the host does not serve.
 */
export async function loadModule(
  specifier: string,
  options: ModuleLoadOptions = {},
): Promise<object> {
  const context: LoadContext = {
    base: new URL(options.base ?? "", globalThis.location.href).href,
    resolveNpm: options.resolveNpm,
  };
  const target = importTarget(specifier, context.base, "a document", context);
  if (target.kind === "url") {
    return importNamespace(target.url);
  }
  if (options.text !== undefined) {
    give(target.id, options.text);
  }
  await readGraph(target.id, [], new Set(), context);
  const url = await once(linked, target.id, () => link(target.id, context));
  return importNamespace(url);
}
