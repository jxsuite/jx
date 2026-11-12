/**
 * Composing one page — routing, layout, `<head>` and context — over a project's working tree.
 *
 * Every rule here belongs to a sibling module in this package, not to this one: a page's URL
 * ({@link ./routes.ts}), the layout it wraps in ({@link ./layout.ts}), the `<head>` those merge
 * into ({@link ./head-merger.ts}) and the `$site`/`$page` state it binds against
 * ({@link ./context.ts}) are each decided in exactly one place, so a live render and `jx build`
 * cannot quietly disagree about what a route is. What is written here is only the assembly, and the
 * IO is injected — the same function reads off a disk, out of a Durable Object's SQLite table, or
 * over `fetch`.
 *
 * Two things the build does are deliberately NOT done:
 *
 * **`$paths` is not expanded.** Expanding a dynamic route means resolving a content collection or
 * running a module. It is also not needed: this serves on demand, so `/blog/hello` MATCHES
 * `pages/blog/[slug].json` and takes `slug` from the URL. What is lost is knowing which concrete
 * pages exist — `/blog/anything` renders — and that is the right trade for a surface whose job is
 * "show me this page".
 *
 * **`imports` are not rebased.** The build rewrites a project-level relative import onto the page's
 * own directory because the output tree has a different shape from the source tree. This serves the
 * source tree at the origin root, where the authored path already means what it says.
 */

import { compareRoutes, fileToRoute, isRoutedPageFile, matchRoute } from "./routes.ts";
import type { FileRoute } from "./routes.ts";
import { resolveLayout } from "./layout.ts";
import { mergeHead, withPageDescription } from "./head-merger.ts";
import type { HeadMergeContext } from "./head-merger.ts";
import { injectContext } from "./context.ts";
import { inheritableFormulas } from "@jxsuite/runtime/expression";
import { qualifyScripts } from "@jxsuite/schema/document-scripts";
import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import { localeDirection, localeOfRoute, resolveI18n } from "@jxsuite/schema/locale";
import { isNativeDocumentPath, parseNativeDocument } from "@jxsuite/schema/jxn";
import type {
  JxDocument,
  JxElement,
  JxHeadEntry,
  JxStateDefinition,
  ProjectConfig,
} from "@jxsuite/schema/types";
import { PROJECT_FILE_NAMES, parseProjectSource } from "@jxsuite/schema/project-file";

/** Everything the composer settled about a page before a renderer sees it. */
export interface ComposedPage {
  doc: JxDocument;
  head: JxHeadEntry[];
  lang: string;
  dir: "ltr" | "rtl";
  /**
   * The project's pure named formulas a component inherits (spec.md §13.4), when it has any. The
   * page has them in its own `state` already; a component's document is fetched as written, so the
   * shell hands these to the runtime before it renders.
   */
  formulas?: Record<string, JxStateDefinition>;
}

/**
 * Turning a non-JSON document's bytes into a document, or null when this host has no parser for it.
 *
 * Named for the same reason {@link ./layout.ts}'s `LayoutLoader` is: it is the seam a host fills,
 * and what it decides is whether non-JSON pages render at all. A host with the project's format
 * registry (a Bun server, the desktop app) supplies one and `pages/index.md` composes; a host
 * without one (a Worker, where a format's parser is not reachable) omits it, and the caller gets a
 * named error instead of a blank page.
 */
export type DocumentParser = (
  path: string,
  text: string,
) => Promise<JxDocument | null> | JxDocument | null;

/** Reading the working tree — the one thing this module cannot do for itself. */
export interface SiteIO {
  /** A project file's text, or null when the tree has no such file. */
  read: (path: string) => Promise<string | null>;
  /** Every non-deleted path in the tree. */
  paths: () => readonly string[];
  /** Parse a non-JSON document through its format. Absent where the host has no format registry. */
  parse?: DocumentParser;
}

/** A page file and the route it answers. */
export interface PageRoute extends FileRoute {
  /** Project path of the page source, e.g. `pages/blog/[slug].json`. */
  sourcePath: string;
}

/** The route table, in match order. Static beats dynamic beats catch-all. */
export function routeTable(paths: readonly string[]): PageRoute[] {
  return paths
    .flatMap((path) =>
      path.startsWith("pages/") && isRoutedPageFile(path)
        ? [Object.assign(fileToRoute(path), { sourcePath: path })]
        : [],
    )
    .toSorted(compareRoutes);
}

/**
 * Read and parse a document, whatever format its extension claims.
 *
 * Every entry naming the document's own script is qualified with the document's path here, as it is
 * read (`spec.md` §23.2): a page is about to be merged onto its layout, and after that nothing
 * records which of the two an entry was written in.
 */
async function readDocument(io: SiteIO, path: string): Promise<JxDocument | null> {
  const text = await io.read(path);
  if (text === null) {
    return null;
  }
  if (isNativeDocumentPath(path)) {
    return qualifyScripts(parseNativeDocument(text, path), path);
  }
  const parsed = io.parse ? await io.parse(path, text) : null;
  return parsed ? qualifyScripts(parsed, path) : null;
}

/**
 * The project's configuration, or an empty one when it has none this host can read.
 *
 * Both names are read, because a host that can only fetch has no other way to know which one a
 * project has. A project with both has neither, as it has everywhere else (`site-architecture.md`
 * §2.3).
 */
export async function readProjectConfig(io: SiteIO): Promise<ProjectConfig> {
  const texts = await Promise.all(PROJECT_FILE_NAMES.map((name) => io.read(name)));
  const found = PROJECT_FILE_NAMES.flatMap((name, index) => {
    const text = texts[index];
    return text === null || text === undefined ? [] : [{ name, text }];
  });
  const [only] = found;
  if (!only || found.length > 1) {
    return {};
  }
  try {
    /* Only the syntax is checked here, deliberately: every ProjectConfig member is optional, and
       shape checking is `validateProject`'s job against the per-project schema, which `jx build`
       runs and a live preview of a half-edited config must not refuse over. */
    return parseProjectSource(only.text, only.name);
  } catch {
    /* A project whose config does not parse still has pages, and refusing to render any of them
       would hide the one error the author can act on behind a blank origin. */
    return {};
  }
}

/**
 * Union two `$elements` lists, keeping declaration order and dropping repeats.
 *
 * An entry is either a bare specifier (a string) or a `{ $ref }`; both are keyed by the thing they
 * name, so a page and its layout declaring the same component register it once.
 */
export function unionElements(
  ...lists: (readonly (string | JxElement)[] | undefined)[]
): (string | JxElement)[] | undefined {
  const seen = new Set<string>();
  const merged: (string | JxElement)[] = [];
  for (const entry of lists.flatMap((list) => list ?? [])) {
    /* An authored list can hold a `null` its type does not admit; it is keyed by its own JSON
       (`"null"`) like any other entry without a `$ref`, rather than throwing. */
    const ref = isNonNullObject(entry) ? entry.$ref : undefined;
    const key = isString(entry) ? entry : (ref ?? JSON.stringify(entry));
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged.length > 0 ? merged : undefined;
}

/** A component file in the project's own library, keyed by the tag it defines. */
const COMPONENT_FILE = /^components\/([^/]+-[^/]*)\.(?:json|jxn)$/;

/**
 * A `$ref`'s project path, so the same file written from two places is one key.
 *
 * A layout says `../components/nav.json` and a page says `./components/nav.json` for one file. Both
 * resolve against the shell's base rather than against the document that wrote them, so both name
 * `/components/nav.json` — and comparing the raw strings would register it twice.
 */
function refPath(ref: string): string {
  return new URL(ref, "file:///").pathname;
}

/**
 * Every custom-element tag a document tree names, root included.
 *
 * Text children are skipped, and so is a `null` an authored children array can still hold.
 */
function collectTagNames(node: JxElement | string, into: Set<string>): void {
  if (!isNonNullObject(node)) {
    return;
  }
  const { children, tagName } = node;
  if (isString(tagName) && tagName.includes("-")) {
    into.add(tagName);
  }
  /* A repeater filling the whole children slot names no tag of its own, and its row template
     (`map`) is not walked, so only an array of children leads anywhere. */
  if (Array.isArray(children)) {
    for (const child of children) {
      collectTagNames(child, into);
    }
  }
}

/**
 * The project components a document USES, as `$elements` entries it never declared.
 *
 * `$elements` is a declaration, and almost nothing declares one: across the shipped starters a
 * layout names the chrome it uses and no page names anything, because in a BUILD it does not have
 * to — the compiler scans the rendered HTML for tags it compiled and emits a module script per tag
 * (`site-build.ts`, `injectComponentScripts`). The studio canvas reaches the same answer a third
 * way, walking the document against its component registry. Only this composer took `$elements`
 * literally, so a page rendered its own components as inert unknown tags while the canvas beside it
 * rendered them correctly — and, as everywhere else in this area, with nothing reported anywhere.
 *
 * The walk is transitive, which the other two auto-discoveries are not: a component's own tags are
 * found by reading it, so `sa-pricing` bringing `sa-check-item` registers both. The build gets that
 * for free by scanning HTML it has already rendered; here the definition has to be opened. It is
 * bounded by the components a page actually reaches, and each is opened once.
 *
 * Only native components are discoverable, because a `$ref` is resolved by the browser: the runtime
 * fetches the file and parses it as a document, so a component in a format needing an extension's
 * parser cannot be registered this way whoever discovers it. A `.jxn` component qualifies because
 * this origin answers it as JSON (`serve.ts`).
 */
async function discoverElements(io: SiteIO, doc: JxDocument): Promise<{ $ref: string }[]> {
  const available = new Map<string, string>();
  for (const path of io.paths()) {
    const tag = COMPONENT_FILE.exec(path)?.[1];
    if (tag !== undefined) {
      available.set(tag, path);
    }
  }
  if (available.size === 0) {
    return [];
  }

  /* What the document already declares, at any level: the union above has run, so this is the
     page's, the layout's and the project's together. A declared entry is still WALKED — it may
     bring components of its own — it is just not declared a second time. */
  const declared = new Set<string>();
  for (const entry of doc.$elements ?? []) {
    const ref = isNonNullObject(entry) ? entry.$ref : undefined;
    if (isString(ref)) {
      declared.add(refPath(ref));
    }
  }

  const discovered: { $ref: string }[] = [];
  const opened = new Set<string>();
  let frontier: JxDocument[] = [doc];
  while (frontier.length > 0) {
    const tags = new Set<string>();
    for (const node of frontier) {
      collectTagNames(node, tags);
    }
    const next: JxDocument[] = [];
    for (const tag of tags) {
      const path = available.get(tag);
      if (path === undefined || opened.has(tag)) {
        continue;
      }
      opened.add(tag);
      const ref = `./${path}`;
      if (!declared.has(refPath(ref))) {
        discovered.push({ $ref: ref });
      }
      const definition = await readDocument(io, path);
      if (definition) {
        next.push(definition);
      }
    }
    frontier = next;
  }
  return discovered;
}

/**
 * Why a route could not be composed — a sentence for the reader, not a stack trace.
 *
 * The constructor is explicit rather than a `name` field initializer, and that is a coverage fact
 * rather than a style one: a class field on a subclass synthesizes a constructor, Bun counts that
 * synthesized function, and `new ComposeError(...)` never marks it entered — V8 attributes the call
 * to `Error`. The file then sits at 14/15 functions forever with every line covered, which reads
 * like an untested branch and is not one. Writing the constructor out is what makes the count
 * true.
 */
export class ComposeError extends Error {
  override readonly name: string;

  constructor(message: string) {
    super(message);
    this.name = "ComposeError";
  }
}

/**
 * Compose the page a URL asks for, or null when no route claims it.
 *
 * @param {SiteIO} io - Reads the working tree
 * @param {readonly PageRoute[]} routes - The table, in match order
 * @param {ProjectConfig} config - The project's configuration
 * @param {string} pathname - The request path, e.g. `/blog/hello/`
 */
export async function composeRoute(
  io: SiteIO,
  routes: readonly PageRoute[],
  config: ProjectConfig,
  pathname: string,
): Promise<ComposedPage | null> {
  const match = matchRoute(routes, pathname);
  if (!match) {
    return null;
  }
  return composePage(io, match.route, config, match.params);
}

/** Compose one known route with known parameters. */
export async function composePage(
  io: SiteIO,
  route: PageRoute,
  config: ProjectConfig,
  params: Record<string, string>,
): Promise<ComposedPage> {
  const pageDoc = await readDocument(io, route.sourcePath);
  if (!pageDoc) {
    throw new ComposeError(
      `${route.sourcePath} could not be read as a page. Only .json and .jxn pages render here; other formats need their extension's parser, which this host does not run.`,
    );
  }

  const merged = await resolveLayout(pageDoc, config, async (ref) => {
    const doc = await readDocument(io, ref.replace(/^\.\//, ""));
    if (!doc) {
      throw new ComposeError(`Layout not found: ${ref}`);
    }
    return doc;
  });

  /*
   * `$elements` is legal on the page AND on the layout, and `resolveLayout` merges neither into the
   * other — so the composed document has only the LAYOUT's, and every custom element a page
   * declared for itself goes unregistered. The compiler reads both documents for exactly this
   * reason (`site-build.ts`, "a page of inert unknown elements with no error anywhere"), and the
   * failure is just as quiet here: the runtime renders `<site-card>` into the DOM, nothing defines
   * it, and the browser reports nothing at all.
   */
  const elements = unionElements(merged.$elements, pageDoc.$elements);
  if (elements) {
    merged.$elements = elements;
  }

  const { i18n } = resolveI18n(config);
  const siteRoute = {
    _pathParams: params,
    sourcePath: route.sourcePath,
    urlPattern: route.urlPattern,
  };
  injectContext(merged, config, siteRoute, null, i18n);

  /* After `injectContext`, because that is what merges the PROJECT's `$elements` in — discovering
     before it would re-declare every component the project already names for every page. */
  const discovered = await discoverElements(io, merged);
  const withDiscovered = unionElements(merged.$elements, discovered);
  if (withDiscovered) {
    merged.$elements = withDiscovered;
  }

  /* SAFETY: `_pageHead` is no authored key; `resolveLayout` is its only writer and stores a page's
     (or a nested layout's) `$head` array in it, which is the `JxHeadEntry[]` asserted here. */
  const pageHead = withPageDescription(
    (pageDoc.$head ?? merged._pageHead ?? []) as JxHeadEntry[],
    pageDoc.description,
  );
  const layoutHead = merged.$head ?? [];
  const siteHead = config.$head ?? [];
  /* SAFETY: `pageDoc.title` and `config.name` are declared strings, and `_pageTitle` is no authored
     key: `resolveLayout` is its only writer and stores a page's (or a nested layout's) `title`. */
  const title = (pageDoc.title ?? merged._pageTitle ?? config.name ?? "") as string;
  const lang =
    (isString(pageDoc.$lang) ? pageDoc.$lang : undefined) ??
    localeOfRoute(route.urlPattern, i18n) ??
    config.defaults?.lang ??
    "en";

  const headContext: HeadMergeContext = { lang, title };
  if (config.name !== undefined) {
    headContext.siteName = config.name;
  }
  const head = mergeHead(siteHead, layoutHead, pageHead, headContext);

  /* `$head` is merged out of the document and rendered into the shell, so leaving it on the
     document would have the runtime inject every entry a second time on mount. */
  delete merged.$head;
  delete merged._pageHead;
  delete merged._pageTitle;
  /* A page merged onto a layout has one `$script` where there were two documents, so the text is
     neither's to speak for; every entry already names its own document, and the page fetches the
     client module from there. The server module is the other reason: a reader is never sent one. */
  delete merged.$script;

  const composed: ComposedPage = { dir: localeDirection(lang), doc: merged, head, lang };
  const formulas = inheritableFormulas(config.state);
  if (Object.keys(formulas).length > 0) {
    composed.formulas = formulas;
  }
  return composed;
}
