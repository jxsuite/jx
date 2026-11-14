/// <reference lib="dom" />
/**
 * Jx — JSON-native reactive web component runtime
 *
 * Four-step pipeline:
 *
 * 1. `resolve` — fetch JSON source (or accept raw object)
 * 2. `buildScope` — state detection + reactive proxy construction
 * 3. `render` — walk resolved tree, build DOM, wire reactive effects
 * 4. `output` — append to target
 *
 * @module jx
 * @license MIT
 * @version 3.0.0
 */

import {
  computed,
  effect,
  effectScope,
  isReactive,
  isRef,
  onEffectCleanup,
  onScopeDispose,
  pauseTracking,
  reactive,
  ref,
  resetTracking,
  shallowReactive,
  toRaw,
} from "@vue/reactivity";
import {
  buildStyleRules,
  cssPropertyName,
  hashCss,
  isNestedSelectorKey,
  transposeCanvasOverlaySelector,
} from "./css.ts";
import {
  evaluateExpression,
  evaluateOperand,
  inheritableFormulas,
  isMutating,
} from "./expression.ts";
import { readPath } from "./pointer.ts";
import type {
  JxContext,
  JxEventHandler,
  JxHostScope,
  JxMount,
  JxMountOptions,
  JxPath,
  JxRenderOptions,
  JxRowContext,
  JxScope,
  JxScopeFunction,
  JxScopeValue,
} from "./types.ts";
import {
  hasStructuredBody,
  isBoolean,
  isExpressionDef,
  isFunction,
  isFunctionDef,
  isJsonObject,
  isMappedArray,
  isNamedFormulaDef,
  isNestedStyle,
  isNonNullObject,
  isNumber,
  isPrivateStateKey,
  isPrototypeDef,
  isRef as isRefValue,
  isServerFnDef,
  isString,
  isTagExpression,
  isTemplateString,
  templateExpressions,
} from "@jxsuite/schema/guards";
import type { TagNameSlot } from "@jxsuite/schema/guards";
import {
  classifyFunctionEntries,
  declaresBodyAndSrc,
  handlerParamNames,
} from "@jxsuite/schema/function-role";
import type { FunctionRole } from "@jxsuite/schema/function-role";
import { formatSrcset, parseSrcset } from "@jxsuite/schema/asset-paths";
import { runStatements } from "./statements.ts";
import { canLoadModules, compileBody, moduleLoaderFor, prepareBodies } from "./body-eraser.ts";
import {
  isScriptSpecifier,
  isTypeScriptPath,
  parseScriptSpecifier,
  qualifyScripts,
  scriptRefSide,
  scriptSpecifier,
} from "@jxsuite/schema/document-scripts";

import { readCookie, serializeCookie } from "./cookie.ts";
import type {
  CemParameter,
  JsonObject,
  JsonValue,
  JxAttributeValue,
  JxClassCtorDef,
  JxClassDef,
  JxDocument,
  JxDocumentValue,
  JxElement,
  JxFunctionDef,
  JxHeadEntry,
  JxMappedArray,
  JxPrototypeDef,
  JxRef,
  JxServerFnDef,
  JxStateDefinition,
  JxStyle,
} from "@jxsuite/schema/types";
import type { EffectScope, Ref } from "@vue/reactivity";

export {
  bodyNeedsEraser,
  prepareBodies,
  setBodyEraser,
  setBodyEraserLoader,
  setModuleLoader,
} from "./body-eraser.ts";
export type {
  BodyEraser,
  BodyEraserLoader,
  BodyEraserModule,
  ModuleLoader,
  ModuleLoadOptions,
} from "./body-eraser.ts";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Mount a Jx document into a DOM container.
 *
 * @example
 *   import { Jx } from "@jxsuite/runtime";
 *   const state = await Jx("./counter.json", document.getElementById("app"));
 *
 * @param {string | JxDocument} source - Path to .json file, URL, or raw document object
 * @param {HTMLElement} [target] Default is `document.body`
 * @param {JxRenderOptions} [options]
 * @returns {Promise<JxScope>} Resolves with the live component scope (state reactive
 * proxy)
 */
/** The document-schema version this runtime understands (the `/schema/vN` in a hosted `$schema`). */
export const SUPPORTED_SCHEMA_VERSION = 1;
let _schemaVersionWarned = false;

/**
 * Warn once when a document declares a hosted `$schema` whose version differs from the one this
 * runtime supports. A relative or non-hosted `$schema` (local dev schema paths) is ignored. This is
 * a diagnostic only — there is no document-format migration story yet (see spec §3.2 / §21.4).
 */
function checkSchemaVersion($schema: JxDocumentValue | undefined): void {
  if (_schemaVersionWarned || !isString($schema)) {
    return;
  }
  const match = $schema.match(/\/schema\/v(\d+)\b/);
  if (match && Number(match[1]) !== SUPPORTED_SCHEMA_VERSION) {
    _schemaVersionWarned = true;
    console.warn(
      `Jx: document $schema is version v${match[1]} but this runtime supports ` +
        `v${SUPPORTED_SCHEMA_VERSION}. Behavior may be undefined; there is no format migrator yet.`,
    );
  }
}

export async function Jx(
  source: string | JxDocument,
  target: HTMLElement = document.body,
  options?: JxRenderOptions,
) {
  const base = options?.base
    ? new URL(options.base, location.href).href
    : isString(source)
      ? new URL(source, location.href).href
      : location.href;
  const doc = await resolve(source);

  /* The module-level fallback is still written here, on purpose: a component defined LATER with
     `@--name` blocks and no own `$media` reads it (setRootMedia). `mount()` never writes it — a
     mount's `$media` travels in its context, which is the whole point of having one. */
  if (doc.$media) {
    _rootMedia = doc.$media;
  }

  const mountOptions: JxMountOptions = { base };
  if (options?.onNodeCreated) {
    mountOptions.onNodeCreated = options.onNodeCreated;
  }
  if (options?.signal) {
    mountOptions.signal = options.signal;
  }
  const mounted = await mount(doc, target, mountOptions);
  return mounted.scope;
}

/**
 * A lifecycle hook a document's state supplies (`onMount`, `onUnmount`, `onAdopted`) as the runtime
 * calls it: with the scope, plus the host element for a defined element's `onMount`, which also
 * receives the host as `this`.
 */
type ScopeHook = (
  this: HTMLElement | JxScope | undefined,
  scope: JxScope,
  host?: HTMLElement,
) => void;

/**
 * Whether a scope member can be called as a {@link ScopeHook}. Being a function is the whole
 * contract: JavaScript checks neither the arguments a call passes nor what it returns, so every
 * function accepts this call, and the runtime discards whatever it returns.
 */
function isScopeHook(value: unknown): value is ScopeHook {
  return isFunction(value);
}

/** Host-scope keys the runtime owns: `$media`, `$map`, the `$`-locals and `#`-private entries. */
const HOST_SCOPE_RESERVED = /^[$#]/;

/**
 * A host's scope as the runtime merges it: the host's own record, typed as the {@link JxScope} it
 * joins.
 *
 * @param {S} scope - The host's scope, held to `JxScopeValue` member by member by its type
 * @returns {JxScope}
 */
function hostScopeOf<S extends JxHostScope<S>>(scope: S): JxScope {
  /* SAFETY: `JxHostScope<S>` has already held every member of `S` to `JxScopeValue`, recursively
     through arrays, records and function results. What TypeScript cannot conclude from that is an
     index signature, which an interface never has implicitly, so a host's own interface is not
     assignable to `JxScope` however its members are typed. Nothing is copied or converted: this is
     the host's record, read by member name like every other scope. */
  return scope as JxScope;
}

function assertHostScope(scope: JxScope): void {
  for (const key of Object.keys(scope)) {
    if (HOST_SCOPE_RESERVED.test(key)) {
      throw new TypeError(
        `Jx mount: host scope key "${key}" is reserved — names beginning with "$" or "#" are ` +
          `runtime vocabulary`,
      );
    }
  }
}

/**
 * Mount a document into a host-owned node and hand back the live scope with a disposer.
 *
 * This is the embedding contract (specs/embedding.md): the host supplies its own reactive records
 * and functions as `options.scope`, a per-mount base, `$media` and document resolver, and gets a
 * root it can remove and a `dispose()` that stops every effect the render created. Nothing here
 * writes a module global, so a shell can hold many roots with different needs at once.
 *
 * @param {JxDocument} source - The document to render (already an object; use {@link resolve} for a
 *   URL)
 * @param {ParentNode} target - Where the rendered root is appended
 * @param {JxMountOptions} [options]
 * @returns {Promise<JxMount>}
 * @docs extending/embedding/runtime-host
 */
export async function mount<S extends JxHostScope<S> = JxScope>(
  source: JxDocument,
  target: ParentNode,
  options: JxMountOptions<S> = {},
): Promise<JxMount> {
  const hostScope: JxScope = options.scope ? hostScopeOf(options.scope) : {};
  assertHostScope(hostScope);
  const base = options.base ? new URL(options.base, location.href).href : location.href;
  const doc = inlineDocument(source, base);
  const ctx: JxContext = {
    base,
    media: options.media ?? doc.$media ?? null,
    root: null,
  };
  if (options.resolver) {
    ctx.resolver = options.resolver;
  }
  if (options.skipServerFunctions !== undefined) {
    ctx.skipServerFunctions = options.skipServerFunctions;
  }
  if (options.skipAutoRequests !== undefined) {
    ctx.skipAutoRequests = options.skipAutoRequests;
  }
  checkSchemaVersion(doc.$schema);

  // Register custom elements declared in $elements (depth-first)
  if (doc.$elements) {
    await registerElements(doc.$elements, base, ctx);
  }

  // Inject <head> elements declared in $head (link, meta, script, etc.)
  if (doc.$head) {
    injectHead(doc.$head, base);
  }

  const scope = await buildScope(doc, hostScope, base, ctx);

  const elements = new Set<string>();
  const renderOptions: JxRenderOptions = {
    _ctx: ctx,
    onNodeCreated: (el, path, def, state) => {
      if (el instanceof Element && el.tagName.includes("-")) {
        elements.add(el.tagName.toLowerCase());
      }
      options.onNodeCreated?.(el, path, def, state);
    },
  };
  if (options.onNodeMoved) {
    renderOptions.onNodeMoved = options.onNodeMoved;
  }
  // The authoring hooks (off unless a host names them): see `JxRenderOptions`.
  if (options.rowLimit !== undefined) {
    renderOptions.rowLimit = options.rowLimit;
  }
  if (options.emptyRow) {
    renderOptions.emptyRow = options.emptyRow;
  }
  if (options.onListReconciled) {
    renderOptions.onListReconciled = options.onListReconciled;
  }
  const { result: root, stop } = runScoped(() => renderNode(doc, scope, renderOptions));
  ctx.root = root;

  let mounted = false;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    options.signal?.removeEventListener("abort", dispose);
    /* The root leaves the document BEFORE its effects stop (embedding.md §2.2). Stopping releases
       each element's styles, and on a connected subtree every one of those inline-property and
       `data-jx` writes schedules a style invalidation for a node that is leaving anyway: a
       Publish tab switch spent 22 ms there, and a dialog's close forced a recalculation of the
       subtree it was removing. It is also the order a custom element's own `onUnmount` sees,
       which runs from `disconnectedCallback` (spec.md §16.4). */
    root.remove();
    stop();
    // Called as a method, so a hook that reads `this` sees the scope, as it always has.
    if (mounted && isScopeHook(scope.onUnmount)) {
      scope.onUnmount(scope);
    }
  };

  if (options.signal?.aborted) {
    // Aborted before it could be attached: tear the effects down and attach nothing.
    dispose();
  } else {
    options.signal?.addEventListener("abort", dispose, { once: true });
    target.append(root);
    mounted = true;
    if (isScopeHook(scope.onMount)) {
      scope.onMount(scope);
    }
  }
  return { scope, root, elements, dispose };
}

// ─── Step 1: Resolve ──────────────────────────────────────────────────────────

const _resolveCache = new Map<string, Promise<JxDocument>>();

/**
 * Seed the resolve cache with a document a host already holds, under the URL its references use.
 *
 * A bundled document — one imported as JSON rather than fetched — still names its dependencies by
 * URL: an `$elements` entry, a `$switch` case. Preloading those under the same URLs lets every such
 * reference resolve with no network, and lets `defineElement("<url>")` dedupe on the source it
 * would otherwise have fetched. The key is stored as given and, when it parses as a URL, in its
 * absolute form too, because the two lookup paths spell it differently.
 *
 * @param {string} url - The URL the document is known by
 * @param {JxDocument} doc
 */
export function preloadDocument(url: string, doc: JxDocument): void {
  const settled = Promise.resolve(doc);
  _resolveCache.set(url, settled);
  try {
    _resolveCache.set(new URL(url, location.href).href, settled);
  } catch {
    // Not a URL at all — the raw key still serves the lookup that uses it.
  }
}

/**
 * A response's Content-Type, or `""` when it carries no headers at all. A response we have no
 * EVIDENCE about is one we proceed with rather than guess. Every real `Response` has headers; a
 * host's or a test's `fetch` stand-in may not, which is what the parameter type admits.
 *
 * @param res The response, or a stand-in for one
 * @returns {string}
 */
function responseContentType(res: Partial<Pick<Response, "headers">>): string {
  return res.headers?.get("Content-Type") ?? "";
}

export async function resolve(source: string | JxDocument, ctx?: JxContext): Promise<JxDocument> {
  if (!isString(source)) {
    await prepareBodies(source);
    return source;
  }
  // A mount's resolver answers for THIS mount and its hit never enters the shared cache.
  const served = ctx?.resolver?.(source);
  if (served) {
    return withOwnScripts(await served, source);
  }
  if (_resolveCache.has(source)) {
    return _resolveCache.get(source)!;
  }
  const fetched = fetch(source).then(async (res) => {
    if (!res.ok) {
      throw new Error(`Jx: failed to fetch ${source} (${res.status})`);
    }
    /*
     * `res.ok` is not enough on a single-page host. A static host configured with an SPA fallback
     * answers a path it does not have with the APPLICATION SHELL at HTTP 200, so a missing document
     * arrives looking like a successful fetch and dies inside `res.json()` as
     * `Unexpected token '<', "<!doctype "... is not valid JSON` — a parser error for what is
     * actually a 404. Jx Cloud did this to every component `$ref` in the canvas.
     *
     * Checked on the content type rather than by sniffing the body: a host that says `text/html`
     * has told us plainly, and saying so costs nothing.
     */
    const contentType = responseContentType(res);
    if (contentType.includes("text/html")) {
      throw new Error(
        `Jx: ${source} returned HTML, not a document — the host answered a missing file with its ` +
          `app shell (a single-page fallback), so this path is not served.`,
      );
    }
    /* A site origin answers `.jxn` as JSON, so only an editing server or a bare file host gets here
       with KDL, and the parser is the host's to supply: a lazy import here would be inlined by any
       host that bundles the runtime into one file, and ship the parser to every reader. */
    if (JXN_URL.test(source) && !contentType.includes("json")) {
      if (!_documentParser) {
        throw new Error(
          `Jx: ${source} is a .jxn file and this page has no parser for it. Serve it from a Jx ` +
            `site, which answers JSON, or call setDocumentParser(parseJxn) with parseJxn from ` +
            `@jxsuite/schema/jxn.`,
        );
      }
      return _documentParser(await res.text(), source);
    }
    /* SAFETY: trust boundary. `resolve` fetches only URLs that name a Jx document (a `Jx()` source,
       an `$elements` entry, a `$switch` case), and the host answered 2xx with a non-HTML body, so
       the JSON is that document; the runtime does not schema-validate documents by design. */
    return (await res.json()) as JxDocument;
  });
  // A body that needs the eraser has it before anything compiles, which happens synchronously.
  const p = fetched.then(async (read) => {
    const doc = withOwnScripts(read, source);
    await prepareBodies(doc);
    return doc;
  });
  _resolveCache.set(source, p);
  return p;
}

// ─── Step 2: Build scope ──────────────────────────────────────────────────────

/** The path part of a URL naming a `.jxn` file. */
const JXN_URL = /\.jxn(?:[?#]|$)/iu;

/** What reads a `.jxn` file's text. Absent, the runtime refuses one rather than guessing. */
let _documentParser: ((text: string, source: string) => JxDocument | Promise<JxDocument>) | null =
  null;

/**
 * Supply what reads a `.jxn` file, for a host that serves one as its text.
 *
 * A compiled site never needs this, and a `$ref` from a Jx site origin does not: both get JSON.
 * Studio's canvas does, because an editing server answers a file as it is.
 *
 * @param parser `parseJxn` from `@jxsuite/schema/jxn`, or a function that loads it first, or null
 *   to take it away again.
 */
export function setDocumentParser(
  parser: ((text: string, source: string) => JxDocument | Promise<JxDocument>) | null,
): void {
  _documentParser = parser;
}

/** JSON Schema keywords used to identify pure type definitions (Shape 2b). */
const SCHEMA_KEYWORDS = new Set([
  "type",
  "properties",
  "items",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "required",
  "examples",
]);

/** /** @type {{ skip: boolean }} */
const _serverFnConfig = { skip: false };
/** Set to true to suppress timing: "server" resolution (used by Studio edit mode). */
export function setSkipServerFunctions(v: boolean) {
  _serverFnConfig.skip = v;
}

/** @type {{ skip: boolean }} */
const _autoRequestConfig = { skip: false };
/**
 * Set to true to suppress AUTOMATIC `$prototype: "Request"` fetches — the sibling of
 * {@link setSkipServerFunctions}, and used by Studio for the same reason.
 *
 * `buildScope` re-resolves every `state` entry on each full canvas render, so an auto-request
 * re-issued its HTTP call every time the canvas rebuilt. In edit/design mode that meant authoring
 * actions — a signal edit, or pressing Enter inside component-wrapped content, both of which force
 * a full render — fired network requests. Live data belongs to preview and to the deployed site.
 *
 * Only non-`manual` requests are gated: a `manual` one fires from an event handler, and edit mode
 * strips handlers before rendering. The returned ref is unchanged either way — it simply stays at
 * its initial `null`, which is the same state bindings observe before any fetch resolves.
 */
export function setSkipAutoRequests(v: boolean) {
  _autoRequestConfig.skip = v;
}

/**
 * One remote lookup the runtime is about to start: an automatic `Request` fetch, or a call of a
 * `timing: "server"` function (embedding.md §5.2).
 */
export interface RemoteLookup {
  kind: "request" | "server";
  /** The state key the entry is declared under. */
  key: string;
  /** The scope the entry belongs to: a document's, or a component instance's. */
  scope: JxScope;
  /**
   * What the lookup asks for, with every binding in it resolved. A request: `method`, `url`, and
   * `headers` and `body` where the entry declares them. A server function: `$src`, `$export`,
   * `arguments`, and `$base` where the document has one. Two lookups that ask for the same thing
   * hold equal values here, which is what a host keys a cache on.
   */
  request: JsonObject;
}

/**
 * A host's answer to a {@link RemoteLookup}. `{ value }` is written to the entry at once and nothing
 * is in flight; a promise stands for the lookup (its answer is written when it settles, and a
 * rejection is the entry's failure, as the lookup's own would be); `null` starts nothing, and the
 * entry keeps the value it has.
 */
export type RemoteLookupAnswer = { value: JsonValue } | Promise<JsonValue> | null;

/**
 * What a host installs with {@link setRemoteLookupHandler}. `run` starts the lookup itself and
 * answers with its promise; a handler that never calls it has kept the lookup from happening.
 */
export type RemoteLookupHandler = (
  lookup: RemoteLookup,
  run: () => Promise<JsonValue>,
) => RemoteLookupAnswer;

let _remoteLookupHandler: RemoteLookupHandler | null = null;

/**
 * Put `handler` between the runtime and every remote lookup it starts, or take it away with `null`
 * (embedding.md §5.2).
 *
 * The two skip switches above are all or nothing, and a host that draws a document over and over
 * (Studio's canvas renders on every structural edit) needs a third answer: run this lookup once and
 * hand every later render what it answered. The handler is asked each time a lookup would start,
 * after the skip switches have had their say, and decides per lookup: let it run, answer it from
 * what it holds, or leave it alone.
 *
 * A lookup started through `run` is the handler's. It is not aborted when the binding that asked
 * for it is torn down, because the handler may be keeping the answer for the next one that asks;
 * the runtime only declines to write an answer that arrives for a binding no longer there.
 *
 * @param {RemoteLookupHandler | null} handler
 */
export function setRemoteLookupHandler(handler: RemoteLookupHandler | null): void {
  _remoteLookupHandler = handler;
}

// ─── Dev-proxy auth token (Studio cross-origin canvas) ────────────────────────
// The Studio canvas iframe is served from a token-gated loopback origin (createProjectServer): its
// POST /__jx_resolve__ + /__jx_server__ routes 403 without ?token=<rpcToken>. The iframe boot reads
// The token from its URL and calls setResolveToken so these dev-proxy fetches authenticate. Unset by
// Default, leaving production + same-origin dev untouched (bare path, no query appended).
let _resolveToken: string | null = null;
export function setResolveToken(token: string | null) {
  _resolveToken = token || null;
}
/** Append the dev-proxy auth token to a privileged resolve path when one is configured. */
function resolveProxyPath(path: string): string {
  return _resolveToken ? `${path}?token=${encodeURIComponent(_resolveToken)}` : path;
}

/**
 * Observe runtime-created reactive values: runs `fn` immediately inside a reactive effect and
 * re-runs it whenever a tracked value changes; returns a disposer. Dep tracking in @vue/reactivity
 * is per module INSTANCE, so an effect created from another copy of the package (e.g. the studio's
 * own pin) can never track a ref/reactive created here — consumers that want to observe
 * runtime-resolved scope values (the Studio canvas iframe's dataScope re-post) must use this.
 *
 * @param {() => void} fn - Read the reactive values to observe inside this callback.
 * @returns {() => void} Disposer — stops the effect and its scope.
 */
export function observeScope(fn: () => void): () => void {
  const scope = effectScope(true);
  scope.run(() => {
    effect(fn);
  });
  return () => scope.stop();
}

/** What {@link runScoped} hands back: the callback's result, and the disposer for its effects. */
export interface ScopedRun<T> {
  result: T;
  stop: () => void;
}

/**
 * Run `fn` inside a detached reactive scope of THIS module's reactivity instance, returning its
 * result plus a disposer that stops every effect `fn` created. Callers that render via
 * {@link renderNode} and later tear the render down (the Studio canvas full render and its surgical
 * subtree re-renders) MUST use this instead of their own effectScope: scope collection is per
 * vue-reactivity module instance, so a scope from another copy of the package collects NOTHING and
 * its stop() silently leaks every binding effect of the superseded render.
 *
 * @param {() => T} fn - Work that may create reactive effects (typically a renderNode call).
 * @returns {ScopedRun<T>} The callback result and the scope disposer.
 */
export function runScoped<T>(fn: () => T): ScopedRun<T> {
  const scope = effectScope(true);
  try {
    /* SAFETY: `run` answers undefined only for a scope that was already stopped, and this one was
       created on the line above, so it is active and `run` returns what `fn` returned. */
    const result = scope.run(fn) as T;
    return { result, stop: () => scope.stop() };
  } catch (error) {
    // A throwing fn would otherwise leak the effects it created before failing.
    scope.stop();
    throw error;
  }
}

/**
 * Studio-canvas viewport-unit transpose. The canvas iframe is sized to its document's height, so
 * any viewport unit (`vh`/`vw`/`vmin`/`vmax`/`svh`/…) — which resolves against the iframe ELEMENT —
 * would feed back into an ever-growing height. When this is on, the runtime transposes them to
 * CONTAINER units (`cqh`/`cqw`/…) that resolve against the canvas's fixed-size query container (see
 * `canvas.html`): a predictable, feedback-free stand-in for the viewport. Off (the default) leaves
 * CSS untouched for real production rendering.
 */
let _canvasViewportTranspose = false;
export function setCanvasViewportTranspose(on: boolean) {
  _canvasViewportTranspose = on;
}

const VIEWPORT_UNIT_RE = /(-?\d*\.?\d+)(?:s|l|d)?v(h|w|min|max|i|b)\b/gi;
const VIEWPORT_UNIT_MAP = new Map([
  ["b", "cqb"],
  ["h", "cqh"],
  ["i", "cqi"],
  ["max", "cqmax"],
  ["min", "cqmin"],
  ["w", "cqw"],
]);

/**
 * Transpose CSS viewport units → container-query units in a value string, but only when the
 * studio-canvas flag is set (otherwise the value is returned untouched). `100vh` → `100cqh`,
 * `50svw` → `50cqw`, `10vmin` → `10cqmin`, etc.
 */
export function transposeCanvasUnits(value: string): string {
  if (!_canvasViewportTranspose || !value.includes("v")) {
    return value;
  }
  return value.replaceAll(
    VIEWPORT_UNIT_RE,
    (_m, num: string, dim: string) =>
      `${num}${VIEWPORT_UNIT_MAP.get(dim.toLowerCase()) ?? `cq${dim}`}`,
  );
}

/**
 * Studio-canvas anchor de-linking. In the editor canvas a rendered `<a href>` would navigate the
 * iframe when clicked, fighting element selection. When this is on, the runtime stamps the value on
 * `data-jx-href` instead of `href` so the anchor is inert (selectable, not a live link) while the
 * original target stays recoverable for richer link handling later. Off (the default) leaves
 * production rendering untouched; the studio sets it for design/edit (not preview — see
 * iframe-render).
 */
let _canvasDelinkAnchors = false;
export function setCanvasDelinkAnchors(on: boolean) {
  _canvasDelinkAnchors = on;
}

/**
 * Studio-canvas popover de-linking — `setCanvasDelinkAnchors`'s rule applied to `popover`.
 *
 * An OPEN popover is in the top layer, and CSS Position 4 §3.1 gives a top-layer element the
 * VIEWPORT as its containing block whatever its ancestors say. In the editor canvas that viewport
 * is a fiction: the frame is sized to its own content height, so a drawer pinned with `inset: 0`
 * lands halfway down a 6000px page, and a panel taller than a short component frame is clipped by
 * the `overflow: hidden` the canvas document needs. Worse, a top-layer box contributes nothing to
 * any ancestor's scrollable overflow, so the artboard can never grow to fit one.
 *
 * When this is on, the runtime stamps `popover` on `data-jx-popover` for nodes the studio can
 * ADDRESS — those carrying a stamped `data-jx-path`. That drops every `[popover]` UA rule at once,
 * and the one that matters most is `position: fixed`: with it gone the panel lays out in NORMAL
 * FLOW at its document position, which is what makes it contribute to `#jx-canvas-root`'s
 * scrollHeight so the host can grow the artboard to fit it. Leaving the top layer is necessary but
 * not sufficient — a fixed box contributes nothing to an ancestor's overflow either.
 *
 * It is worth saying what does NOT rescue this, because it is the intuitive answer and it is wrong:
 * `container-type: size` on the canvas's query container does NOT make it a containing block for
 * fixed descendants. Measured in Chrome 151 — `getComputedStyle(container).contain` is `none`, and
 * a `position: fixed` child inside it measures the WINDOW, not the container. So a panel that stays
 * fixed stays laid out against the frame's own viewport, which in an editable mode is the
 * document's full height. `iframe-render.ts` therefore FORCES `position` on the open panel rather
 * than relying on any containment.
 *
 * The studio re-supplies the one UA rule that matters — `display: none` while closed — inside a
 * cascade LAYER, so author declarations still beat it exactly as they beat the real UA rule on the
 * shipped page. That is deliberate: a popover whose base rule sets `display` is broken in
 * production, and the canvas has to show that rather than paper over it.
 *
 * The gate on `data-jx-path` is what keeps this out of documents the studio does not own: a popover
 * rendered inside a component's own template is never stamped, so it keeps its native behaviour.
 *
 * It also drives {@link transposeCanvasPopoverSelector}. The two are one transform — an attribute
 * renamed without its selectors transposed is a popover that can never be styled open.
 *
 * @docs framework/concepts/overlays
 */
let _canvasDelinkPopovers = false;
export function setCanvasDelinkPopovers(on: boolean) {
  _canvasDelinkPopovers = on;
}

/**
 * Studio-canvas de-linking of invoker commands, `inert` and a dialog's `open` — the dialog half of
 * {@link setCanvasDelinkPopovers}.
 *
 * A `<button command="show-modal" commandfor="…">` is the platform's own invoker: clicking it calls
 * `showModal()` on its target, which puts the dialog in the top layer and makes the rest of the
 * page INERT — the two things an editable canvas can least afford, since the first is the geometry
 * the popover comment above describes and the second makes every other element unclickable. So on a
 * stamped node `commandfor` is renamed to `data-jx-commandfor`: a button with `command` and no
 * target does nothing, and the studio's frame reports the click instead, so the host's single
 * writer of open state can answer it. `popovertarget` is left alone on purpose — its target has no
 * `popover` attribute on the canvas, so the platform already does nothing with it.
 *
 * `inert` becomes `data-jx-inert` for the same reason: an author's inert region is a region the
 * editor could not select into. And a `<dialog open>` becomes `<dialog data-jx-open>`, so the UA's
 * `dialog:not([open]) { display: none }` keeps every dialog closed until the canvas opens ONE with
 * `data-jx-dialog-open`, exactly as it opens one popover. `<details open>` is untouched: its `open`
 * is content, not an overlay state.
 *
 * Gated on `data-jx-path` like the popover rewrite, and driving
 * {@link transposeCanvasOverlaySelector} with it: an attribute renamed without its selectors
 * transposed is a dialog that can never be styled open, or a region that can never be styled inert.
 * Both renames travel with their selectors there — `[open]` on a dialog's own rules, `[inert]`
 * wherever it appears.
 *
 * @docs framework/concepts/overlays
 */
let _canvasDelinkCommands = false;
export function setCanvasDelinkCommands(on: boolean) {
  _canvasDelinkCommands = on;
}

/**
 * Raised while a defined element renders its own children, so the canvas de-link reaches them.
 *
 * The de-link rules gate on `data-jx-path`, which a document node carries and an element's INTERNAL
 * node never can: the internals belong to the definition, not to the page being edited, so the
 * studio's stamper never sees them. Without this a kit element that declares `popover` on a panel
 * inside itself opens a genuine top-layer popover inside an editable canvas, while Studio's single
 * writer of open state learns nothing about it.
 *
 * A module-scoped flag is sound here because `canvasAttrName` is called once per attribute OUTSIDE
 * the effect that binds it, and a definition renders its children synchronously — so the flag is
 * never read across a suspension point.
 */
let _canvasInsideStampedHost = false;

/**
 * Run a later redraw (a `$switch` case that flips, a `$map` row that arrives) as inside a stamped
 * host or not, the way its first render was.
 *
 * The flag is true only while a stamped instance draws, and a redraw comes from an effect with
 * nothing on the stack (a list's from a microtask), so without this a case or a row drawn after the
 * first paint kept its native `popover`, `inert` and `commandfor` inside the canvas.
 *
 * @param {boolean} inside - What the flag was when the list or switch was first rendered.
 * @param {() => T} fn - The redraw.
 * @returns {T}
 */
function insideStampedHost<T>(inside: boolean, fn: () => T): T {
  const was = _canvasInsideStampedHost;
  _canvasInsideStampedHost = inside;
  try {
    return fn();
  } finally {
    _canvasInsideStampedHost = was;
  }
}

/** Whether the node being rendered is inside a stamped host, and so part of the edited page. */
function canvasStamped(el: HTMLElement): boolean {
  return _canvasInsideStampedHost || carriesCanvasStamp(el);
}

/**
 * Whether the studio stamped this element as part of the page being edited: with its document path
 * (`data-jx-path`), or, for a mapped row that is not the one being edited, with the path it echoes
 * (`data-jx-echo-path`). An echo row draws the same document nodes as the active one, so it is
 * de-linked like it: left out, every row but one would keep live popovers, dialogs and commands in
 * an editable canvas.
 */
function carriesCanvasStamp(el: HTMLElement): boolean {
  return el.dataset.jxPath !== undefined || el.dataset.jxEchoPath !== undefined;
}

/** The attribute name to stamp `key` on `el` under — `href` → `data-jx-href` on de-linked anchors. */
function canvasAttrName(el: HTMLElement, key: string): string {
  if (_canvasDelinkAnchors && key === "href" && (el.tagName === "A" || el.tagName === "AREA")) {
    return "data-jx-href";
  }
  /* `dataset.jxPath` is already stamped here: `onNodeCreated` fires before `applyAttributes` in
     `renderNode`, and the studio's stamper writes the attribute synchronously inside it. That
     ordering is an unwritten contract between two packages, so `runtime-canvas.test.ts` asserts it
     directly rather than trusting it. */
  if (_canvasDelinkPopovers && key === "popover" && canvasStamped(el)) {
    return "data-jx-popover";
  }
  if (_canvasDelinkCommands && canvasStamped(el)) {
    if (key === "commandfor") {
      return "data-jx-commandfor";
    }
    if (key === "inert") {
      return "data-jx-inert";
    }
    if (key === "open" && el.tagName === "DIALOG") {
      return "data-jx-open";
    }
  }
  return key;
}

/**
 * Rewrite one asset reference for a host that does not serve the site's own URL space.
 *
 * The runtime writes a reference VERBATIM — `el.src = "/hero.jpg"` — so the browser resolves it
 * against the document, and the document is whatever page the renderer happens to be running in. On
 * a real site and on an editing server that serves the project tree, that is correct and this hook
 * stays null. On a multi-tenant editor origin it is not: `/hero.jpg` resolves against the editor,
 * misses, and — behind a single-page-app fallback — comes back as HTML at HTTP 200, so the image
 * renders broken and nothing is logged.
 *
 * A function rather than data because it cannot be one: the values it must fix are produced INSIDE
 * reactive effects (`{"$ref": "#/state/hero"}` is not a string until the effect runs), so no
 * document walk can see them. The Studio canvas iframe sets this at render time.
 *
 * Returning null leaves the value exactly as written, and a null resolver makes every call site
 * below the identity — so production rendering is byte-identical.
 *
 * @param {CanvasAssetResolver | null} fn - The resolver, or null to restore verbatim rendering
 */
export type CanvasAssetResolver = (value: string, key: string) => string | null;

let _canvasAssetResolver: CanvasAssetResolver | null = null;
export function setCanvasAssetResolver(fn: CanvasAssetResolver | null) {
  _canvasAssetResolver = fn;
}

/** Attribute/property names whose value is an asset reference, on any element. */
const ASSET_KEYS = new Set(["src", "poster", "data"]);

/** Names whose value is a `srcset`-shaped candidate list rather than one reference. */
const SRCSET_KEYS = new Set(["srcset", "imagesrcset"]);

/**
 * Elements on which `href` names an ASSET rather than a destination.
 *
 * `<a href>` and `<area href>` are places to go, not files to load; rewriting one would send a
 * click at the file that backs the page instead of at the page. `<link href>` is the opposite — a
 * stylesheet, an icon, a preload — and is the reason `$head` needs this at all.
 */
const HREF_ASSET_TAGS = new Set(["LINK"]);

/** True when writing `key` on a `<tagName>` writes an asset reference. */
function isAssetKey(tagName: string, key: string): boolean {
  return ASSET_KEYS.has(key) || (key === "href" && HREF_ASSET_TAGS.has(tagName));
}

/**
 * The value to actually write for `key` on a `<tagName>` — resolved when it is an asset reference,
 * and the input itself in every other case, including whenever no resolver is installed.
 *
 * `srcset` is split into its candidates and resolved one at a time, because it is N references in
 * one attribute and a resolver handed the whole string would have to re-implement HTML's parser to
 * find them.
 */
function canvasAssetValue(tagName: string, key: string, value: string): string {
  if (!_canvasAssetResolver || value === "") {
    return value;
  }
  const name = key.toLowerCase();
  if (SRCSET_KEYS.has(name)) {
    const candidates = parseSrcset(value);
    const next = candidates.map((candidate) => {
      const resolved = _canvasAssetResolver?.(candidate.url, name) ?? null;
      if (resolved === null || resolved === candidate.url) {
        return candidate;
      }
      return { descriptor: candidate.descriptor, url: resolved };
    });
    // A rewritten candidate is a new object, so identity says whether anything changed.
    const changed = next.some((candidate, index) => candidate !== candidates[index]);
    return changed ? formatSrcset(next) : value;
  }
  if (!isAssetKey(tagName, name)) {
    return value;
  }
  return _canvasAssetResolver(value, name) ?? value;
}

/** Every `url(...)` inside a CSS value, unquoted or quoted with either quote. */
const CSS_URL_RE = /\burl\(\s*(?<q>["']?)(?<u>[^"')]*)\k<q>\s*\)/g;

/**
 * Resolve every `url()` inside a CSS value.
 *
 * Applied to CSS rather than to a list of properties because in CSS a `url()` is ALWAYS a resource
 * reference — `background-image`, `mask`, `cursor`, `@font-face src`, `list-style-image` and every
 * shorthand that contains them — so enumerating the properties would be a list that goes stale
 * while the syntax does not.
 */
function canvasStyleUrls(value: string): string {
  if (!_canvasAssetResolver || !value.includes("url(")) {
    return value;
  }
  return value.replaceAll(CSS_URL_RE, (whole, quote: string, url: string) => {
    const resolved = url === "" ? null : (_canvasAssetResolver?.(url, "url()") ?? null);
    return resolved === null ? whole : `url(${quote}${resolved}${quote})`;
  });
}

/**
 * A style scalar as the canvas wants it written: assets resolved, then viewport units transposed.
 *
 * Exported because the canvas emits some CSS itself — the site-level `style` block, which never
 * passes through {@link applyStyle} — and a second implementation of "what the canvas does to a
 * style value" is a second thing to keep in step.
 *
 * @param {string} value - A CSS declaration value
 * @returns {string} The value as the canvas should write it
 */
export function canvasStyleValue(value: string): string {
  return transposeCanvasUnits(canvasStyleUrls(value));
}

/**
 * Studio-canvas prop-binding markers. When on, `bindProperty` stamps `data-jx-bound-prop="<key>"`
 * on elements whose `textContent` is an invertible single-key state binding — the pure template
 * `"${state.key}"` or `{ "$ref": "#/state/key" }`. The studio canvas uses the marker to offer
 * inline editing of component-instance prop values; the rendered text must BE the prop value
 * verbatim, so mixed templates and deep paths are never stamped. Off (the default) leaves
 * production rendering untouched; the studio sets it for design/edit (not preview — see
 * iframe-render).
 */
let _stampPropBindings = false;
export function setStampPropBindings(on: boolean) {
  _stampPropBindings = on;
}

/** The single invertible template form: the whole string is exactly one `${state.key}` access. */
const PURE_STATE_TEMPLATE = /^\s*\$\{\s*state\.(\w+)\s*\}\s*$/;

/** The state key of an invertible `textContent` binding, or null (mixed template, deep path). */
function boundPropKey(
  key: string,
  val: JxDocumentValue | undefined,
  state: JxScope,
): string | null {
  if (!_stampPropBindings || key !== "textContent") {
    return null;
  }
  let sub: string | null = null;
  if (isRefValue(val)) {
    if (!val.$ref.startsWith("#/state/")) {
      return null;
    }
    const rest = val.$ref.slice("#/state/".length);
    sub = rest && !rest.includes("/") ? rest : null;
  } else if (isString(val)) {
    sub = PURE_STATE_TEMPLATE.exec(val)?.[1] ?? null;
  }
  if (!sub) {
    return null;
  }
  // Only plain writable data entries are per-instance props. Computed/signal entries live as refs
  // In the raw scope (auto-unwrapped by the reactive proxy), and function/object entries (handlers,
  // $prototype instances) are not prop-overridable either — an instance $props write against any of
  // Them would clobber the definition's behavior, so their bindings are never marked editable.
  const stored = toRaw(state)[sub];
  if (isRef(stored) || isFunction(stored)) {
    return null;
  }
  if (isNonNullObject(stored)) {
    return null;
  }
  return sub;
}

/**
 * Build the reactive scope (state) from the document using the five-shape detection algorithm.
 *
 * @param {JxDocument} source - The document
 * @param {JxScope} [parentScope] Default is `{}`
 * @param {string} [base] Base URL for resolving $src imports. Default is `location.href`
 * @param {JxContext} [ctx] The mount context; absent on the legacy direct path
 * @returns {Promise<JxScope>} Reactive proxy (state)
 */
export async function buildScope(
  source: JxDocument,
  parentScope: JxScope = {},
  base: string = location.href,
  ctx?: JxContext,
) {
  // Already done for a document that was mounted or read from a URL; this is for one handed in raw.
  const doc = inlineDocument(source, base);
  // A body run without an event dispatches from the mount's root, read when it fires.
  const dispatchRoot = (): EventTarget | null => ctx?.root ?? null;
  const raw: JxScope = {};
  const defs = doc.state ?? {};

  /* Merge parent scope properties. A REACTIVE parent stays live: its members are read through
     accessors rather than copied, so a host that hands in a reactive record as the scope sees the
     document follow every field of it, not a snapshot of the primitives it held at mount time. A
     member the document declares itself is copied instead, so the document's own entry can still
     overwrite it — the document wins (embedding.md §3). */
  const linked = isReactive(parentScope);
  for (const key of Object.keys(parentScope)) {
    if (linked && !(key in defs)) {
      Object.defineProperty(raw, key, {
        configurable: true,
        enumerable: true,
        get: () => parentScope[key],
        set: (value: JxScopeValue) => {
          parentScope[key] = value;
        },
      });
    } else {
      raw[key] = parentScope[key];
    }
  }

  // Pass 0: resolve bare $prototype names via import map
  const imports = doc.imports ?? {};
  for (const [, def] of Object.entries(defs)) {
    if (isPrototypeDef(def) && !def.$src) {
      const mapped = imports[def.$prototype];
      if (mapped) {
        if (!mapped.endsWith(".class.json")) {
          console.warn(
            `Jx: import "${def.$prototype}" must map to a .class.json path, got "${mapped}"`,
          );
          continue;
        }
        def.$src = mapped;
      }
    }
  }

  // First pass: collect naked values, expanded defaults, plain objects
  for (const [key, def] of Object.entries(defs)) {
    // 1. String value
    if (isString(def)) {
      if (!def.includes("${")) {
        raw[key] = def;
      } // Shape 1: naked string
      continue; // Template strings handled in second pass
    }

    // 2. Number, boolean, null
    if (isNumber(def) || isBoolean(def) || def === null) {
      raw[key] = def;
      continue;
    }

    // 3. Array
    if (Array.isArray(def)) {
      raw[key] = def;
      continue;
    }

    // 4. Object
    if (isNonNullObject(def)) {
      if (def.$prototype) {
        continue;
      } // Handled in later passes
      if (isExpressionDef(def)) {
        continue;
      } // Handled in pass 2.5
      if (isServerFnDef(def)) {
        continue;
      } // Handled in fifth pass
      if ("default" in def) {
        raw[key] = def.default;
        continue;
      } // Shape 2: expanded signal
      if (hasSchemaKeywords(def)) {
        continue;
      } // Shape 2b: pure type def
      raw[key] = def; // Shape 1: plain object
    }
  }

  // Wrap in Vue reactive proxy — deep reactivity from this point on
  const state = reactive(raw);

  // Second pass: template strings → computed, a single expression keeping its own type (§5.3)
  for (const [key, def] of Object.entries(defs)) {
    if (isString(def) && def.includes("${")) {
      state[key] = computed(() => evaluateValueTemplate(def, state));
    }
  }

  // Pass 2.5: $expression entries (Shape 5)
  for (const [key, def] of Object.entries(defs)) {
    if (isExpressionDef(def)) {
      const node = def.$expression;
      if (isNamedFormulaDef(def)) {
        // A named formula: callable with positional args mapped onto its declared parameters.
        const params = def.parameters;
        state[key] = (...argValues: JxScopeValue[]) =>
          evaluateExpression(node, state, null, { args: bindPositionalArgs(params, argValues) });
      } else if (isMutating(node.operator)) {
        const handler: JxEventHandler = (s, event) => evaluateExpression(node, s, event);
        state[key] = handler;
      } else {
        state[key] = computed(() => evaluateExpression(node, state, null));
      }
    }
  }

  // Third pass: $prototype: "Function" entries. One verdict per entry, from the document: the same
  // One every compiled target reads (spec.md §5.3 4b, 4d).
  const roles = classifyFunctionEntries(doc);
  for (const [key, def] of Object.entries(defs)) {
    /* Refused ahead of the structured-body branch, so a structured body beside a `$src` is caught
       too, and by presence, so `body: ""` is (spec.md §5.3 4d). */
    if (isFunctionDef(def) && declaresBodyAndSrc(def)) {
      throw new Error(`Jx: '${key}' declares both body and $src — these are mutually exclusive`);
    }
    if (hasStructuredBody(def)) {
      // Structured body (spec §20): with parameters → a callable mapping positional args onto
      // $args names (invoked via the call operator); without → an event handler.
      const { body } = def;
      if (Array.isArray(def.parameters) && def.parameters.length > 0) {
        const params = def.parameters;
        state[key] = (...argValues: JxScopeValue[]) =>
          runStatements(body, state, null, {
            args: bindPositionalArgs(params, argValues),
            target: dispatchRoot,
          });
      } else {
        /* The event is optional in fact: a `call` operator or a host invokes a handler with the
           scope alone, and the body then runs with no event rather than an undefined one. */
        const handler = (s: JxScope, event?: Event | null): void => {
          void runStatements(body, s, event ?? null, { target: dispatchRoot });
        };
        state[key] = handler;
      }
    } else if (isFunctionDef(def)) {
      state[key] = await resolveFunction(def, state, key, roles.get(key) ?? "callable", base);
    }
  }

  // Fourth pass: other $prototype entries (Request, Set, Map, etc.)
  for (const [key, def] of Object.entries(defs)) {
    if (isPrototypeDef(def)) {
      state[key] = await resolvePrototype(def, state, key, base, ctx);
    }
  }

  /* Fifth pass: timing: "server" entries, each called through the host's /__jx_server__ proxy, or
     in process only when the host registered the module itself (spec.md §11.4) */
  if (!(ctx?.skipServerFunctions ?? _serverFnConfig.skip)) {
    for (const [key, def] of Object.entries(defs)) {
      if (isServerFnDef(def)) {
        state[key] = await resolveServerFunction(def, state, key, base);
      }
    }
  }

  const rootMedia = ctx?.media ?? _rootMedia;
  if (doc.$media) {
    state["$media"] = doc.$media;
  } else if (!state["$media"] && Object.keys(rootMedia).length > 0) {
    state["$media"] = rootMedia;
  }

  return state;
}

/**
 * Map a call's positional arguments onto a definition's declared parameter names, as `$args/<name>`
 * refs read them. A parameter given as an object supplies its `default` for a position the call
 * left undefined. Parameters come from a document that is not schema-validated at runtime, so an
 * entry that names nothing (null, or an object without a `name`) binds nothing.
 *
 * @param parameters The declared parameters, in call order
 * @param argValues The values the call passed, in the same order
 * @returns {JxScope} Name to value, for the body's `$args` refs
 */
function bindPositionalArgs(
  parameters: readonly (string | CemParameter | null)[],
  argValues: readonly JxScopeValue[],
): JxScope {
  const args: JxScope = {};
  for (const [i, p] of parameters.entries()) {
    const name = isString(p) ? p : (p?.name ?? "");
    if (!name) {
      continue;
    }
    args[name] =
      argValues[i] === undefined && p !== null && !isString(p) && "default" in p
        ? p.default
        : argValues[i];
  }
  return args;
}

/**
 * Check whether an object contains any JSON Schema keywords. Used to discriminate Shape 2b (pure
 * type definition) from Shape 1 (naked object).
 *
 * @param obj A state entry object, as the document wrote it
 * @returns {boolean}
 */
function hasSchemaKeywords(obj: Readonly<Record<string, JxDocumentValue | undefined>>) {
  for (const k of Object.keys(obj)) {
    if (SCHEMA_KEYWORDS.has(k)) {
      return true;
    }
  }
  return false;
}
export { hasSchemaKeywords };

/**
 * The names a template may read without a `state.` prefix, in the order {@link templateArgs}
 * supplies them.
 *
 * `$site` and `$page` are here for the reason `evaluateStaticTemplate` in the compiler binds them:
 * every example in site-architecture.md §8.2 and §13.4 writes the bare `${$page.locale}`, and
 * `injectContext` (or the Studio canvas) puts the two on the document's state, not in the
 * template's lexical scope. Without them the live runtime threw `ReferenceError: $page is not
 * defined` on a template the build renders, so a page that prerendered correctly drew nothing where
 * it hydrated or rendered live.
 */
const TEMPLATE_PARAMS = ["state", "$map", "item", "index", "$site", "$page"] as const;

/** The values {@link TEMPLATE_PARAMS} name, read from one scope. */
function templateArgs(state: JxScope): Parameters<TemplateFn<unknown>> {
  const $map = rowContext(state);
  return [state, $map, $map?.item, $map?.index, state.$site, state.$page];
}

/**
 * Evaluate a template string in the context of state and optional $map. Templates use
 * `state.varName`, `$map.item` (or `item`) and the page context `$page` / `$site`.
 *
 * @param {string} str
 * @param {JxScope} state
 * @returns {string}
 */
function evaluateTemplate(str: string, state: JxScope): string {
  let fn = textTemplates.get(str);
  if (!fn) {
    /* SAFETY: `new Function` compiles exactly the TEMPLATE_PARAMS, and its body returns a template
       literal, so every call answers a string (or throws, which the caller sees). */
    fn = new Function(...TEMPLATE_PARAMS, `return \`${str}\``) as TemplateFn<string>;
    remember(textTemplates, str, fn);
  }
  return fn(...templateArgs(state));
}

/**
 * Compiled templates, by source. A compiled template closes over nothing — everything it reads
 * arrives as one of its TEMPLATE_PARAMS — so one function per distinct source serves every binding
 * that spells it. Compiling is the expensive half: a `$map` row re-bound to a fresh item re-runs
 * each of its template effects, and a 40-row window re-binding on every scroll step spent seconds
 * in `new Function` alone. A source that fails to compile throws before it is stored, so it throws
 * again on the next evaluation exactly as it did before the cache existed.
 */
const textTemplates = new Map<string, TemplateFn<string>>();

/** {@link textTemplates}, for single-expression templates compiled to keep their own type. */
const valueTemplates = new Map<string, TemplateFn<JxScopeValue>>();

/**
 * How many sources a template cache holds before it starts over. Editing mints a new source per
 * keystroke, so the cache is bounded; clearing it wholesale costs one recompile per live binding,
 * which is what every evaluation cost before there was a cache.
 */
const TEMPLATE_CACHE_MAX = 4096;

/**
 * Store a compiled template, emptying the cache first when it is full.
 *
 * @param {Map<string, F>} cache
 * @param {string} source
 * @param {F} fn
 */
function remember<F>(cache: Map<string, F>, source: string, fn: F): void {
  if (cache.size >= TEMPLATE_CACHE_MAX) {
    cache.clear();
  }
  cache.set(source, fn);
}

/** Template sources already reported as throwing, so a binding re-run per keystroke warns once. */
const reportedTemplates = new Set<string>();

/** Who hears a throwing template binding, when a host asked to; otherwise the console does. */
let _templateErrorHandler: ((error: Error, source: string) => void) | null = null;

/**
 * Route throwing template bindings to `handler` instead of a console warning, or back with `null`.
 *
 * A binding survives its expression throwing (§6.1), which is right for a page and wrong for a host
 * whose question IS whether the document renders: Studio's render critic must still refuse a page
 * whose `${nonExistent}` can never evaluate. Every throw is delivered, not only the first.
 *
 * @param {((error: Error, source: string) => void) | null} handler
 */
export function setTemplateErrorHandler(
  handler: ((error: Error, source: string) => void) | null,
): void {
  _templateErrorHandler = handler;
}

/** Warn about a throwing template, once per source. */
function warnTemplateError(source: string, error: Error): void {
  if (!reportedTemplates.has(source)) {
    reportedTemplates.add(source);
    console.warn(`jx: template ${JSON.stringify(source)} threw:`, error);
  }
}

/** Lookups in flight whose answers can make a throwing template valid (§6.1). */
let pendingLookups = 0;

/** Each binding still throwing while a lookup is in flight, by its `run`, with its latest throw. */
const heldTemplateErrors = new Map<() => void, { error: Error; source: string }>();

/** Who {@link lookupsSettled} has yet to answer. */
const lookupWaiters: (() => void)[] = [];

/**
 * Hold template warnings until `lookup` and every other lookup in flight have settled.
 *
 * `lookup` must write its answer to state before it settles: the write re-runs the bindings waiting
 * on it, so whatever is still held when the last one settles is a template the data did not fix,
 * and only that is reported. A lookup its own answer starts is counted before this one is
 * released.
 *
 * @param {Promise<void>} lookup - Never rejects: it reports its own failure
 */
function holdTemplateErrorsFor(lookup: Promise<void>): void {
  pendingLookups += 1;
  void lookup.finally(() => {
    pendingLookups -= 1;
    if (pendingLookups === 0) {
      /* The console, even if a handler was installed meanwhile: these throws happened outside that
         handler's render, and Studio's render critic would refuse its page for them. */
      for (const { error, source } of heldTemplateErrors.values()) {
        warnTemplateError(source, error);
      }
      heldTemplateErrors.clear();
      for (const wake of lookupWaiters.splice(0)) {
        wake();
      }
    }
  });
}

/**
 * Answers once no lookup the runtime started is in flight (embedding.md §5.2).
 *
 * A host whose question is whether a document renders awaits this between `buildScope` and
 * `renderNode`, so its templates read the data rather than the `null` before it. A lookup can hang,
 * and this waits for it, so bounding the wait is the host's job.
 *
 * @returns {Promise<void>}
 */
export function lookupsSettled(): Promise<void> {
  if (pendingLookups === 0) {
    return Promise.resolve();
  }
  return new Promise((wake) => {
    lookupWaiters.push(wake);
  });
}

/**
 * Run a template binding as an effect that survives its expression throwing.
 *
 * A binding is live: `${state.posts.length}` over a collection that resolves asynchronously reads
 * `null` first and an array a moment later. Unguarded, the first run's TypeError escaped `effect()`
 * — which stops the effect before rethrowing — so the binding never re-ran when the data arrived,
 * and the throw unwound the whole `renderNode` above it: one early read blanked the page. Caught
 * INSIDE the effect, every dependency read before the throw stays tracked, so the binding re-runs
 * on the change that makes it valid. Until then it shows `fallback`'s answer (nothing written, by
 * default), and the error is reported once per source, after any lookup in flight has settled: a
 * template that only needed that lookup's answer is not reported at all.
 *
 * @param {string} source - The template, for the report
 * @param {() => void} run - Evaluates the template and writes it
 * @param {() => void} [fallback] - What a throwing evaluation writes instead
 */
function bindTemplate(source: string, run: () => void, fallback?: () => void): void {
  effect(() => {
    try {
      run();
      heldTemplateErrors.delete(run);
    } catch (error) {
      _templateThrows += 1;
      const thrown = error instanceof Error ? error : new Error(String(error));
      if (_templateErrorHandler) {
        _templateErrorHandler(thrown, source);
      } else if (pendingLookups > 0) {
        heldTemplateErrors.set(run, { error: thrown, source });
      } else {
        warnTemplateError(source, thrown);
      }
      fallback?.();
    }
  });
}

/**
 * How many template evaluations have thrown and been survived. {@link updateInstanceProps} reads it
 * around its writes: a binding that throws keeps what it last drew, which a fresh render of the
 * same values never drew.
 */
let _templateThrows = 0;

/**
 * How many times a mapped list has been asked to redraw. A list redraws in a later microtask, so
 * {@link updateInstanceProps} cannot answer for what that draws (a row that throws, for one) and
 * reads this around its writes instead.
 */
let _listRedraws = 0;

/** A compiled template: the scope, the row context, its item and index, and the page context. */
type TemplateFn<R> = (
  state: JxScope,
  $map: JxRowContext | undefined,
  item: JxRowContext["item"],
  index: JxRowContext["index"] | undefined,
  $site: JxScopeValue,
  $page: JxScopeValue,
) => R;

/**
 * The row context a scope carries, or undefined outside a mapped row.
 *
 * @param {JxScope} state
 * @returns {JxRowContext | undefined}
 */
function rowContext(state: JxScope): JxRowContext | undefined {
  /* SAFETY: `$map` is runtime vocabulary. A host scope may not supply it (`assertHostScope`), a
     node never binds it as a `$`-local (it is in RESERVED_KEYS), and the one writer is
     `renderMappedArrayInto`, which binds the `{ index, item }` row record; elsewhere it is absent. */
  return state.$map as JxRowContext | undefined;
}

/**
 * Whether a template is ONE expression end to end — `"${a.b}"` rather than `"a ${b}"` or
 * `"${a}${b}"`.
 *
 * Scanned rather than pattern-matched. A greedy `/^\$\{(.+)\}$/` also matched `"${a} / ${b}"`,
 * spliced the interior into `return (a} / ${b)`, and the SyntaxError became a silent null: the node
 * rendered empty and a `$head` entry shipped its own template text. A scan is exact where a
 * tightened regex is not — `"${`${a}-x`}"` is still one expression, and must keep its raw value.
 *
 * The scan is `templateExpressions`, the one every reader of a template shares, so a `}` inside a
 * string does not end the expression: a brace count read `"${a ? '}' : b}"` as text around an
 * expression, and its value arrived as a string where the same expression without the quoted brace
 * kept its type.
 *
 * Lives here rather than in the compiler because both renderers must draw the line in the same
 * place. It is what decides whether a value keeps its own type, and a value that is a boolean in
 * one renderer and the string `"false"` in the other is a page that changes meaning as it
 * hydrates.
 *
 * @param {string} str - Template source
 * @returns {boolean} True when the whole string is a single `${…}`
 */
export function isSingleExpression(str: string): boolean {
  if (!str.startsWith("${") || !str.endsWith("}")) {
    return false;
  }
  const [only, ...more] = templateExpressions(str);
  return only !== undefined && more.length === 0 && only.start === 0 && only.end === str.length;
}

/**
 * Evaluate a template as a VALUE — a state entry (Shape 3) or an attribute — keeping the
 * expression's own type.
 *
 * `evaluateTemplate` interpolates into a string, which is what text wants and what a value cannot
 * afford: `"${state.expanded}"` has to arrive as the boolean `false`, or `booleanAttrValue` never
 * sees a boolean, `open="false"` is written, and HTML reads that as open. A state entry is the same
 * case one step removed: `"isBrand": "${state.name === 'github'}"` held the string `"false"`, which
 * is truthy, so every `state.isBrand ? … : …` took the wrong branch in Studio and in a hydrated
 * component while the prerendered page took the right one. Only a single expression can carry a
 * type at all — `"a ${b}"` is text by construction — which is the same line
 * `evaluateStaticTemplate` draws in the compiler, and drawing it identically is what keeps a
 * prerendered page and the same document rendered live in agreement.
 *
 * @param {string} str - Template source
 * @param {JxScope} state - Reactive scope
 * @returns {JxScopeValue} The expression's value, or the interpolated string
 */
function evaluateValueTemplate(str: string, state: JxScope): JxScopeValue {
  if (!isSingleExpression(str)) {
    return evaluateTemplate(str, state);
  }
  let fn = valueTemplates.get(str);
  if (!fn) {
    /* SAFETY: `new Function` compiles exactly the TEMPLATE_PARAMS; the body returns one
       expression's value, which is whatever the scope it reads holds, so it is typed as a scope
       member and narrowed by the attribute writer. */
    fn = new Function(
      ...TEMPLATE_PARAMS,
      `return (${str.slice(2, -1)})`,
    ) as TemplateFn<JxScopeValue>;
    remember(valueTemplates, str, fn);
  }
  return fn(...templateArgs(state));
}

/**
 * Evaluate a template against a scope, for editor tooling: the value a binding would write.
 *
 * It is the runtime's own reading, so a tool that shows a template's live value cannot disagree
 * with the render beside it. A template that is one whole `${…}` answers the expression's own value
 * (an array, a boolean, a record); anything else answers the interpolated string. The expression
 * sees exactly the names a rendered template does: `state` (the scope), `$map`, `item` and `index`
 * (the scope's row context, undefined outside a mapped row), and `$site` and `$page` (read off the
 * scope). Nothing is caught: an expression that throws, or a source that does not compile, throws
 * here, and reads made during the call are tracked by whatever effect is running.
 *
 * @param {string} str - Template source
 * @param {JxScope} scope - The scope to read, a row's own scope for a template inside a `map`
 * @returns {JxScopeValue} The expression's value, or the interpolated string
 * @docs extending/embedding/runtime-host
 */
export function evaluateTemplateValue(str: string, scope: JxScope): JxScopeValue {
  return evaluateValueTemplate(str, scope);
}

// ─── Step 2b: Function resolution (Shape 4) ─────────────────────────────────

/**
 * A module namespace as the runtime reads it: exports looked up by name, then under `default` (the
 * shape a CommonJS module takes when imported). An export is whatever the module exported, so each
 * lookup checks what it found before using it.
 */
interface ImportedModule {
  readonly [exportName: string]: JxScopeValue;
  readonly default?: ImportedModule;
}

/**
 * Import a module namespace by specifier.
 *
 * Not `async`: the import's own promise is handed back, so awaiting this costs exactly the ticks
 * awaiting `import()` did, and scope construction keeps its order against its siblings'.
 *
 * @param {string} specifier
 * @returns {Promise<ImportedModule>}
 */
/**
 * How the host serves the package an `npm:` specifier names, or null for none.
 *
 * `npm:@jxsuite/search/client` is a package specifier (spec.md §5.3, 4c), and the build bundles it
 * (`compiler/src/site/bundler.ts`). The interpreter had no answer for it: `new URL()` reads `npm:`
 * as a URL scheme, so it was handed to `import()` verbatim and the browser refused it as a
 * cross-origin request to a scheme it does not fetch. A host that renders documents live knows
 * where its packages are served (the dev server bundles `/node_modules/<package>/<subpath>` on
 * demand), so it says so here. With no resolver the bare specifier is imported, which an import map
 * can answer.
 */
let _npmModuleResolver: ((specifier: string) => string) | null = null;

/**
 * Install (or with `null`, remove) the host's resolver for `npm:` specifiers.
 *
 * @param {((specifier: string) => string) | null} resolver - Package specifier → importable URL
 */
export function setNpmModuleResolver(resolver: ((specifier: string) => string) | null): void {
  _npmModuleResolver = resolver;
}

/** The scheme a package specifier is written with. */
const NPM_SCHEME = "npm:";

/**
 * Import a module a document names by `$src`: an `npm:` package through the host's resolver, and
 * anything else from the document's base (then as written).
 *
 * @param {string} src - The `$src` as the document spells it
 * @param {string} [base] - The document's URL
 * @returns {Promise<ImportedModule>}
 */
async function importSource(src: string, base?: string): Promise<ImportedModule> {
  if (src.startsWith(NPM_SCHEME)) {
    const specifier = src.slice(NPM_SCHEME.length);
    return importModule(_npmModuleResolver?.(specifier) ?? specifier);
  }
  const typed = typeScriptSource(src, base);
  // Asked only where an answer is possible, so a page with no loader waits no longer than it did.
  if (typed !== null && (canLoadModules() || isScriptSpecifier(src))) {
    const loaded = await importTypeScript(typed, src, base);
    if (loaded) {
      return loaded;
    }
  }
  if (base) {
    try {
      return await importModule(new URL(src, base).href);
    } catch {
      return importModule(src);
    }
  }
  return importModule(src);
}

/** The schemes a page can fetch a module's text from. */
const FETCHED_SCHEMES = new Set(["http:", "https:"]);

/**
 * What the module loader is asked for when a `$src` names TypeScript (spec.md §23.2): a document
 * script's specifier as it is, or the URL of a `.ts` file a page can fetch. Null for anything a
 * browser imports as it is.
 *
 * @param {string} src - The `$src`, qualified if it named its document's script
 * @param {string} [base] - The document's URL
 * @returns {string | null}
 * @throws {Error} For `#client` or `#server` in a document with no `$script`
 */
function typeScriptSource(src: string, base?: string): string | null {
  if (isScriptSpecifier(src)) {
    return src;
  }
  if (scriptRefSide(src) !== null) {
    throw new Error(
      `Jx: $src "${src}" names the script of the document it is written in, and that document ` +
        `has no $script`,
    );
  }
  const from = base ?? location.href;
  if (!URL.canParse(src, from)) {
    return null;
  }
  const url = new URL(src, from);
  // A `file:` path is a test runner's, which imports TypeScript itself; a seeded scheme never gets here.
  return FETCHED_SCHEMES.has(url.protocol) && isTypeScriptPath(url.pathname) ? url.href : null;
}

/**
 * Import a module written in TypeScript through the host's module loader. Null when the page has
 * none and the module is a `.ts` file, which is then imported as written: a host that transpiles
 * what it serves still answers that. A document's script has no URL to fall back to, so it says
 * what is missing.
 *
 * @param {string} specifier - What {@link typeScriptSource} gave
 * @param {string} src - The `$src` as the document holds it
 * @param {string} [base] - The document's URL
 * @returns {Promise<ImportedModule | null>}
 * @throws {Error} For a document's script on a page with no module loader
 */
async function importTypeScript(
  specifier: string,
  src: string,
  base?: string,
): Promise<ImportedModule | null> {
  const load = await moduleLoaderFor();
  if (load) {
    const module = await load(specifier, {
      base,
      resolveNpm: _npmModuleResolver,
      text: _documentScripts.get(src),
    });
    /* SAFETY: trust boundary, the same one as `importModule` below: the loader hands back the
       module namespace `import()` gave it, read by export name and checked at each use. */
    return module as ImportedModule;
  }
  if (isScriptSpecifier(src)) {
    throw new Error(
      `Jx: ${parseScriptSpecifier(src)?.path ?? src} has a script, and this page has nothing ` +
        `that can load one. Give it a module loader with setModuleLoader(loadModule), loadModule ` +
        `from @jxsuite/erase/browser, or let setBodyEraserLoader fetch that file when it is needed.`,
    );
  }
  return null;
}

/**
 * The text of each document's client script the runtime has read, by the qualified specifier that
 * names it, so importing one fetches nothing.
 */
const _documentScripts = new Map<string, string>();

/**
 * A document as the runtime uses it: every `$src` naming its own script qualified with the
 * document's address (spec.md §23.2), and its client script kept for the module loader.
 *
 * @param {JxDocument} doc - The document as read
 * @param {string} source - Where it was read from: a URL, or a key a host serves it under
 * @returns {JxDocument}
 */
function withOwnScripts(doc: JxDocument, source: string): JxDocument {
  if (!doc.$script) {
    return doc;
  }
  // Its absolute URL, so one document is one module however each reference to it was spelled.
  const address = URL.canParse(source, location.href)
    ? new URL(source, location.href).href
    : source;
  const { client } = doc.$script;
  const specifier = scriptSpecifier(address, "client");
  if (isString(client) && _documentScripts.get(specifier) !== client) {
    /* Read again with its script edited, which an editing host does on every change: the module
       made from the old text is not this document's any more. One the host seeded stays, because
       the host is then what says what the module is. */
    if (_documentScripts.has(specifier) && !_hostSeeded.has(specifier)) {
      _moduleCache.delete(specifier);
    }
    _documentScripts.set(specifier, client);
  }
  const own = qualifyScripts(doc, address);
  _addressed.set(own, own);
  return own;
}

/**
 * Each document that has a script, with the copy that names it: itself for one read from an
 * address, so mounting what `resolve()` gave does not address it a second time.
 */
const _addressed = new WeakMap<JxDocument, JxDocument>();
let _inlineCount = 0;

/**
 * A document handed over as an object, with every `$src` naming its own script qualified. It has no
 * URL of its own, so it stands at its base, and under a name no other document on the page has: two
 * documents mounted from one page are still two modules, and one mounted twice is one.
 *
 * @param {JxDocument} doc - The document as given
 * @param {string} base - What its relative references resolve against
 * @returns {JxDocument}
 */
function inlineDocument(doc: JxDocument, base: string): JxDocument {
  if (!doc.$script) {
    return doc;
  }
  let own = _addressed.get(doc);
  if (!own) {
    _inlineCount += 1;
    const address = new URL(base, location.href);
    address.hash = `jx-inline-${_inlineCount}`;
    own = withOwnScripts(doc, address.href);
    _addressed.set(doc, own);
  }
  return own;
}

function importModule(specifier: string): Promise<ImportedModule> {
  /* SAFETY: trust boundary — a module exports whatever it exports. `import()` resolves to the
     module namespace object, whose keys are its export names, and every export is typed as the scope
     member it becomes: the runtime uses one only after `isFunction` has accepted it (a Function
     entry's `$src`, a server function, a `$implementation` class) or after testing it for
     presence, and both tests are defined for any value a module can export. `default` is only ever
     read through optional property access. */
  return import(specifier) as Promise<ImportedModule>;
}

/**
 * An external class's instance as the runtime uses it (spec.md §12.3): a record read by member
 * name, three members of which are its contract with the runtime — a `value`, a `resolve()` that
 * produces one (possibly a promise), and a `subscribe()` that pushes later ones. Each is optional
 * and checked before it is used.
 */
interface ExternalClassInstance extends JxScope {
  value?: JxScopeValue;
  resolve?: () => JxScopeValue | Promise<JxScopeValue>;
  subscribe?: (callback: (value: JxScopeValue) => void) => void;
}

/** Module cache for $src imports (shared with external class resolution). */
const _moduleCache = new Map<string, ImportedModule>();

/** A module the host will import on first use, keyed as the document spells its `$src`. */
type ModuleLoader = () => Promise<ImportedModule>;

/**
 * Lazy registrations: a loader until it runs, then the in-flight load, so two entries resolving the
 * same sidecar in one tick share one import rather than racing two.
 */
const _moduleLoaders = new Map<string, ModuleLoader | Promise<ImportedModule>>();

/**
 * The specifiers a host registered through `preloadModule`, in either form. Kept apart from
 * `_moduleCache` because that cache is shared: a Function entry's `$src` import lands there too,
 * and a `timing: "server"` entry naming the same specifier must still not run in the browser
 * (spec.md §11.4). Only the host's own registration admits a server module in process.
 */
const _hostSeeded = new Set<string>();

/**
 * Seed the `$src` module cache with a module the host already imported, under the specifier the
 * document spells. A bundled document cannot have its sidecar fetched by URL — the bundler saw
 * neither the string nor the file — so the host imports the sidecar itself and registers it here,
 * and `$src` then resolves exactly as it would have from the network.
 *
 * Given a FUNCTION instead of a namespace, the registration is lazy: nothing is imported until a
 * document names the specifier, and the loader runs once. That is the shape for a host that can
 * bundle a sidecar as its own chunk but should not pay for it until something renders — Studio's
 * canvas frame registers every kit behaviour this way, so a page that uses no kit element loads
 * none of them (embedding.md §6).
 *
 * A registered module is also how a host runs a `timing: "server"` entry in process; for any
 * specifier not registered here, the runtime calls the host's `/__jx_server__` proxy instead.
 *
 * @param {string} specifier - The `$src` value as written in the document
 * @param {ImportedModule | ModuleLoader} mod - The imported module namespace, or a loader that
 *   imports it on first use
 */
export function preloadModule(specifier: string, mod: ImportedModule | ModuleLoader): void {
  _hostSeeded.add(specifier);
  if (isFunction(mod)) {
    _moduleCache.delete(specifier);
    _moduleLoaders.set(specifier, mod);
    return;
  }
  _moduleLoaders.delete(specifier);
  _moduleCache.set(specifier, mod);
}

/**
 * The module a specifier was seeded with — imported, or lazily registered — or undefined when the
 * host said nothing about it and the network is the answer.
 *
 * SYNCHRONOUS for a namespace the host imported, and that is load-bearing rather than tidy: a cache
 * hit used to be a `Map#has` on the way through `resolveFunction`, and an `await` there — even of a
 * value that is not a promise — defers one microtask, which reorders every element's scope
 * construction against its siblings'. The kit's field naming its slotted control is one thing that
 * order decides. Only a loader is a promise, because only a loader has to be.
 *
 * @param {string} src
 * @returns {ImportedModule | Promise<ImportedModule> | undefined}
 */
function seededModule(src: string): ImportedModule | Promise<ImportedModule> | undefined {
  const cached = _moduleCache.get(src);
  if (cached) {
    return cached;
  }
  const pending = _moduleLoaders.get(src);
  if (!pending) {
    return undefined;
  }
  if (!isFunction(pending)) {
    return pending;
  }
  /* Started here, outside the async body, so a loader that throws synchronously still throws to
     the caller. The async body turns a thenable from a host's loader into a Promise the call sites
     can tell from a namespace. */
  const started = pending();
  const load = (async () => {
    try {
      const mod = await started;
      _moduleCache.set(src, mod);
      _moduleLoaders.delete(src);
      return mod;
    } catch (error) {
      /* A failed load — a chunk the network dropped — puts the loader back, so the next document to
         name the specifier tries again rather than inheriting this rejection for good. */
      _moduleLoaders.set(src, pending);
      throw error;
    }
  })();
  _moduleLoaders.set(src, load);
  return load;
}

/**
 * A Function entry's implementation as the runtime calls it — a compiled `body` or a `$src` export
 * — with the scope as its first argument. JavaScript checks none of the arguments, and what the
 * call returns is bound into the scope like any other member.
 */
type ScopeFunction = (...args: JxScopeValue[]) => JxScopeValue;

/**
 * The module a `$src` names: the host's seeded copy, the cached one, or a fetch that is cached when
 * it settles. Returned as it comes, a module or a promise of one, so an eager caller adds no
 * microtask of its own: a kit element's scope is ready a fixed number of ticks after it connects,
 * and `jx-field` names the control it slots at the end of them.
 *
 * @param {string} src - The specifier
 * @param {string} [base] - Base URL for resolving relative specifiers
 */
function acquireModule(src: string, base?: string): ImportedModule | Promise<ImportedModule> {
  const seeded = seededModule(src);
  if (seeded) {
    return seeded;
  }
  const loading = importSource(src, base);
  // A side branch: it caches the module without delaying what the caller awaits.
  loading.then(
    (mod) => {
      _moduleCache.set(src, mod);
    },
    () => {},
  );
  return loading;
}

/**
 * The function a `$src` Function entry names, out of its module.
 *
 * @param {JxFunctionDef} def
 * @param {string} key - Def key name
 * @param {string} src - The specifier the module came from
 * @param {ImportedModule} mod
 */
function exportedFunction(
  def: JxFunctionDef,
  key: string,
  src: string,
  mod: ImportedModule,
): ScopeFunction {
  const exportName = def.$export ?? key;
  const candidate = mod[exportName] ?? mod.default?.[exportName];
  if (!isFunction(candidate)) {
    throw new TypeError(`Jx: export "${exportName}" not found or not a function in "${src}"`);
  }
  /* SAFETY: the guard proved a function, and a function accepts any call: the runtime passes the
     scope first, as a Function entry's contract says, and binds the result as a scope member. */
  return candidate as ScopeFunction;
}

/**
 * Import the function a `$src` Function entry names, for a caller that can wait for it: a `$lazy`
 * entry's first call. An eager entry does the same two steps inline, in `resolveFunction`.
 *
 * @param {JxFunctionDef} def
 * @param {string} key - Def key name
 * @param {string} src - The entry's `$src`
 * @param {string} [base] - Base URL for resolving relative specifiers
 */
async function importFunctionExport(
  def: JxFunctionDef,
  key: string,
  src: string,
  base?: string,
): Promise<ScopeFunction> {
  return exportedFunction(def, key, src, await acquireModule(src, base));
}

/**
 * Resolve a $prototype: "Function" entry into a function or computed.
 *
 * Functions receive state as their first parameter at call time. A `computed` role (decided by
 * `classifyFunctionEntries` from the document) is wrapped in computed() for reactive evaluation.
 *
 * @param {JxFunctionDef} def - State entry with $prototype: "Function"
 * @param {JxScope} state - Reactive scope proxy
 * @param {string} key - Def key name
 * @param {FunctionRole} role - The document's verdict for this entry
 * @param {string} [base] - Base URL for resolving $src imports
 * @returns {Promise<JxScopeValue>}
 */
async function resolveFunction(
  def: JxFunctionDef,
  state: JxScope,
  key: string,
  role: FunctionRole,
  base?: string,
) {
  if (!def.body && !def.$src) {
    const params = handlerParamNames(def);
    const noop = new Function(...params, "");
    Object.defineProperty(noop, "name", {
      configurable: true,
      value: def.name ?? key,
    });
    return noop;
  }

  let fn: ScopeFunction;

  if (isString(def.body)) {
    const params = handlerParamNames(def);
    /* SAFETY: `new Function` returns an ordinary function of the named parameters, `state` first.
       A call never checks its arguments, and what the body returns is one more scope member. */
    fn = compileBody(params, def.body, `'${key}'`) as ScopeFunction;
    Object.defineProperty(fn, "name", {
      configurable: true,
      value: def.name ?? key,
    });
  } else if (def.$lazy === true && def.$src) {
    const { $src: src } = def;
    /* Loaded on the first call, not here (spec.md §5.3 4d), as a compiled page does. The first call
       starts the import and every call waits on it, so the module loads once and a call returns a
       promise from then on. A computed reads its value now, which a promise cannot give, so the
       document is refused at build rather than rendering one. */
    if (role === "computed") {
      throw new Error(
        `Jx: "${key}" declares "$lazy": true but is used as a computed value, not called. ` +
          `A lazily loaded function resolves to a promise; a computed must resolve now. ` +
          `Remove "$lazy", or call ${key}() from a handler instead of binding its value.`,
      );
    }
    let loaded: Promise<ScopeFunction> | undefined;
    const load = (): Promise<ScopeFunction> =>
      (loaded ??= importFunctionExport(def, key, src, base));
    fn = (...args: JxScopeValue[]) => load().then((target) => target(...args));
    Object.defineProperty(fn, "name", {
      configurable: true,
      value: def.name ?? key,
    });
    return fn;
  } else {
    // $src: dynamic import (the body/$src dichotomy was validated above)
    if (!def.$src) {
      throw new Error(`Jx: '${key}' has neither body nor $src`);
    }
    const acquired = acquireModule(def.$src, base);
    fn = exportedFunction(
      def,
      key,
      def.$src,
      acquired instanceof Promise ? await acquired : acquired,
    );
  }

  // The role comes from the document (spec.md §5.3 4b, 4d), never from the import's arity or source.
  if (role === "computed") {
    return computed(() => fn(state));
  }

  return fn;
}

// ─── Step 3: Render ───────────────────────────────────────────────────────────

/**
 * Reserved Jx keys — never set as DOM properties.
 *
 * @type {Set<string>}
 */
export const RESERVED_KEYS = new Set([
  "$schema",
  "$id",
  "$defs",
  "state",
  "$ref",
  "$props",
  "$elements",
  "$title",
  "$description",
  "$switch",
  "$prototype",
  "$src",
  "$export",
  "$script",
  "$media",
  "$map",
  "timing",
  "default",
  "description",
  "body",
  "parameters",
  "arguments",
  "name",
  "tagName",
  "children",
  "style",
  "attributes",
  "items",
  "map",
  "filter",
  "sort",
  "cases",
  "observedAttributes",
]);

/**
 * A child scope: a `$map` row, or a node carrying `$`-prefixed local bindings or `$props`. Reads
 * fall through to `parent`, and so does a write to any key the chain above already holds.
 *
 * The write is the half a bare `Object.create(parent)` gets wrong, and it gets it wrong silently.
 * An assignment that reaches the reactive proxy through a prototype chain arrives with the child as
 * its receiver, so the proxy defines the value on the child and triggers nothing: the handler's
 * `count += 1` shadows `count`, the root never changes, and the bindings reading it never re-run. A
 * compiled document assigns to the root directly, so the same document counted there and sat still
 * here. A value this scope owns is declared with {@link bindLocal}, which is what shadows.
 *
 * @param {JxScope} parent
 * @returns {JxScope}
 */
function inheritScope(parent: JxScope): JxScope {
  /* SAFETY: `Object.create` is typed `any`, but what it returns is a plain object whose prototype
     is `parent`, so it is keyed by string exactly as the scope it extends is. */
  const local = Object.create(parent) as JxScope;
  return new Proxy(local, {
    set(target, key: string, value: JxScopeValue) {
      if (Object.hasOwn(target, key)) {
        return Reflect.set(target, key, value);
      }
      if (key in parent) {
        return Reflect.set(parent, key, value);
      }
      bindLocal(target, key, value);
      return true;
    },
  });
}

/**
 * Declare `key` on a child scope itself, shadowing whatever its parents hold under that name.
 *
 * @param {JxScope} scope
 * @param {string} key
 * @param {JxScopeValue} value
 */
function bindLocal(scope: JxScope, key: string, value: JxScopeValue): void {
  Object.defineProperty(scope, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * The named breakpoints a scope carries, or none.
 *
 * @param {JxScope} state
 * @returns {Record<string, string>}
 */
function scopeMedia(state: JxScope): Record<string, string> {
  /* SAFETY: `$media` is runtime vocabulary a host scope may not supply (`assertHostScope`); the one
     writer is `buildScope`, which stores a document's or the mount's `$media` map, a record of
     breakpoint name to media query. */
  return (state["$media"] as Record<string, string> | undefined) ?? {};
}

/**
 * An element as the property bag a Jx key writes into, `el[key] = value`. Reading or writing a key
 * the element does not define is an ordinary expando, as it is in JavaScript.
 */
type ElementProperties = HTMLElement & Record<string, JxScopeValue>;

/**
 * View an element as its property bag.
 *
 * @param {HTMLElement} el
 * @returns {ElementProperties}
 */
function elementProperties(el: HTMLElement): ElementProperties {
  /* SAFETY: every element is an ordinary extensible object, so any string key can be read (a
     missing one is undefined) and written; the added index signature claims nothing more. */
  return el as ElementProperties;
}

/**
 * The reactive state a connected Jx instance renders from, or null for any other element (and for
 * an instance that has not connected yet).
 *
 * @param {HTMLElement} el
 * @returns {JxScope | null}
 */
function instanceStateOf(el: HTMLElement): JxScope | null {
  const state = elementProperties(el)._state;
  /* SAFETY: `_state` is written by one writer, the Jx element class's `connectedCallback`, which
     stores the scope `buildScope` answered; on any other element the expando is absent, and a
     non-object is refused below. */
  return isNonNullObject(state) ? (state as JxScope) : null;
}

/**
 * Whether a scope member can be called as an event handler, `(scope, event)`. Being a function is
 * the whole contract, for the reason {@link isScopeHook} gives.
 */
function isEventHandler(value: unknown): value is JxEventHandler {
  return isFunction(value);
}

/**
 * Recursively render a Jx element definition into a DOM element.
 *
 * @param {JxElement | string | number | boolean} def
 * @param {JxScope} state - Reactive scope proxy (or child scope via Object.create)
 * @param {JxRenderOptions} [options]
 * @returns {HTMLElement | Text}
 */
/** Refs already warned about, so the §13 diagnostic fires once per distinct target. */
const warnedRefChildren = new Set<string>();

/** Foreign-content namespaces the HTML parser switches into, and the runtime must too. */
const SVG_NS = "http://www.w3.org/2000/svg";
const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

/**
 * The namespace an element belongs in, given the one its parent established.
 *
 * The static build emits markup text, so the HTML parser applied foreign-content rules for it and
 * SVG worked there. The runtime built every node with `document.createElement`, which is HTML-only,
 * so the same document rendered blank in the Studio canvas and in any hydrated component — the
 * editor and the deployed site disagreeing, with only the editor wrong.
 *
 * @param {string} tagName
 * @param {string | null | undefined} inherited - The namespace the parent element established
 * @returns {string | null} Null means HTML
 */
function elementNamespace(tagName: string, inherited: string | null | undefined): string | null {
  if (tagName === "svg") {
    return SVG_NS;
  }
  if (tagName === "math") {
    return MATHML_NS;
  }
  return inherited ?? null;
}

export function renderNode(
  def: JxElement | string | number | boolean,
  state: JxScope,
  options?: JxRenderOptions,
): HTMLElement | Text {
  const path = options?._path ?? [];

  // Text node children: bare strings/numbers/booleans produce DOM Text nodes
  if (isString(def) || isNumber(def) || isBoolean(def)) {
    const textNode = document.createTextNode(String(def));
    if (isTemplateString(def)) {
      bindTemplate(
        def,
        () => {
          textNode.textContent = evaluateTemplate(def, state);
        },
        () => {
          textNode.textContent = "";
        },
      );
    }
    return textNode;
  }

  // Extend scope with any $-prefixed local bindings declared on this node
  let localState: JxScope = state;
  for (const [key, val] of Object.entries(def)) {
    if (key.startsWith("$") && !RESERVED_KEYS.has(key)) {
      if (localState === state) {
        localState = inheritScope(state);
      }
      bindLocal(localState, key, isRefValue(val) ? resolveRef(val.$ref, state) : val);
    }
  }

  /*
   * §13 diagnostic: a node-level external `$ref` (the withdrawn component-instance syntax) has no
   * tagName and silently renders an empty <div>. Warn once per target instead of failing silently —
   * the supported mechanism is $elements + a custom-element tag (see spec §13).
   */
  if ("$ref" in def && !def.tagName) {
    const refTarget = String(def.$ref ?? "");
    if (!warnedRefChildren.has(refTarget)) {
      warnedRefChildren.add(refTarget);
      console.warn(
        `Jx: a $ref child ("${refTarget}") is not a supported component instance; register the ` +
          `component in $elements and use its custom-element tag instead (spec §13).`,
      );
    }
  }

  /* RESOLVED ONCE, HERE, before anything branches on it.
     A tag may be a name or a choice between names (`ElementTagName`). Resolving at the top means
     every test below — the hyphen check that routes to the custom-element path, `customElements.get`,
     `createElement` itself — sees a literal, exactly as it did when a tag could only be written out.

     It is not tracked. `tagName` is in RESERVED_KEYS so no binding sweep reaches it, and a tag that
     changed after mount would mean replacing the node: the subtree's listeners, its focus, its typed
     input values and its component instances all go with it, and this runtime has no dispose walk to
     pay that bill (renderSwitch, two hundred lines up, still leaks its previous case's effects).
     `jx validate` warns when a tag discriminant is also an assignment target, so the case where this
     rule bites is caught before it ships rather than found as a `<div>` that never became an `<a>`. */
  const tagName = resolveTagName(def.tagName, localState);
  const isCustomEl = tagName.includes("-") && customElements.get(tagName);

  if (def.$props && isCustomEl) {
    return renderCustomElementWithProps(def, localState, options, path);
  }

  if (def.$props) {
    // A hyphenated tag carrying $props is a component instance whose definition has not finished
    // Registering yet (async defineElement — e.g. the Studio desktop canvas, where the component
    // Fetch can land after this node renders). Render via the property-first path anyway: it sets
    // The instance props as JS properties on the bare element, which the eventual upgrade's
    // ConnectedCallback reads back off `this` (see the def.state merge below), so the instance's
    // Props win. The old branch stripped the props here, so a late upgrade painted the component's
    // State DEFAULTS instead ("0"/"DESCRIPTION" for every instance). A non-custom tag can never
    // Upgrade, so it keeps the historical mergeProps-into-scope behavior.
    if (tagName.includes("-")) {
      return renderCustomElementWithProps(def, localState, options, path);
    }
    const { $props: _$props, ...rest } = def;
    return renderNode(rest, mergeProps(def, localState), options);
  }
  if (def.$switch) {
    return renderSwitch(def, localState, options);
  }

  const ns = elementNamespace(tagName, options?._ns);
  /*
   * `foreignObject` is itself an SVG element, and is the documented way back into HTML: its
   * DESCENDANTS are HTML, so the element and its children carry different namespaces.
   */
  const childNs = tagName === "foreignObject" ? null : ns;
  /* SAFETY: a namespaced node is an Element, not an HTMLElement, but every apply* helper below
     touches only members SVG and MathML elements share with HTML ones (style, dataset,
     setAttribute, append), and `bindProperty` writes `className` as an attribute on them. */
  const el = ns
    ? (document.createElementNS(ns, tagName) as HTMLElement)
    : document.createElement(tagName);

  if (options?.onNodeCreated) {
    options.onNodeCreated(el, path, def, localState);
  }

  applyProperties(el, def, localState);
  /* A custom element's own definition applies its style at connection, through the same interning
     path — which releases whatever is already on the element. So the call site's style is
     remembered here and merged there; see {@link callSiteStyles}. */
  if (def.style && tagName.includes("-")) {
    callSiteStyles.set(el, def.style);
  }
  applyStyle(el, def.style ?? {}, scopeMedia(localState), localState);
  applyAttributes(el, def.attributes ?? {}, localState);

  const kids = def.children;
  if (isMappedArray(kids)) {
    // Legacy whole-children repeater: the items render directly into `el` (which keeps its own
    // TagName, e.g. <ul>), with no extra wrapper element.
    const arrOpts =
      options || childNs ? { ...options, _ns: childNs, _path: [...path, "children"] } : undefined;
    renderMappedArrayInto(el, kids, localState, arrOpts);
  } else if (Array.isArray(kids)) {
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i]!;
      const childOpts =
        options || childNs
          ? { ...options, _ns: childNs, _path: [...path, "children", i] }
          : undefined;
      if (isMappedArray(child)) {
        // Array pseudo-element among siblings: expand inline, no wrapper.
        renderMappedArrayInto(el, child, localState, childOpts);
      } else if (isString(child) && isSingleExpression(child)) {
        renderTemplatedChild(el, child, localState, childOpts);
      } else {
        el.append(renderNode(child, localState, childOpts));
      }
    }
  } else if (isTemplateString(kids)) {
    renderComputedChildren(el, kids, localState, {
      ...options,
      _ns: childNs,
      _path: [...path, "children"],
    });
  }

  return el;
}

/**
 * Draw a whole-`children` template, the way the site build's template pass expands one (spec.md
 * §8.4). This is what an item's or an entry's parsed body looks like to something that renders the
 * source document rather than the build's output: Studio's editing canvas, chiefly.
 *
 * A result that is not an array draws nothing, because a plain string is not a `children` value.
 * The children are rendered in a detached scope of their own, replaced when the template's value
 * changes (a collection that was still loading), and with tracking paused for the reason
 * {@link renderSwitch} gives: the bindings inside track for themselves.
 *
 * @param {Element} el - The element whose children these are
 * @param {string} template - The `children` value
 * @param {JxScope} state
 * @param {JxRenderOptions} options - `_path` is the `children` position of `el`
 */
function renderComputedChildren(
  el: Element,
  template: string,
  state: JxScope,
  options: JxRenderOptions,
): void {
  let live: EffectScope | null = null;
  const retire = (): void => {
    // Detached before it is stopped, for the reason `teardown` in `renderMappedArray` gives.
    el.replaceChildren();
    live?.stop();
    live = null;
  };
  bindTemplate(
    template,
    () => {
      const nodes = evaluateValueTemplate(template, state);
      retire();
      if (!Array.isArray(nodes)) {
        return;
      }
      live = effectScope(true);
      drawTemplateNodes(live, nodes, state, options, (node) => {
        el.append(node);
      });
    },
    retire,
  );
  onScopeDispose(() => live?.stop(), true);
}

/**
 * Render the members of a template's array value, each handed to `place` as it is made.
 *
 * The members render in `scope`, a detached scope the caller owns and stops when the value changes,
 * and with tracking paused for the reason {@link renderSwitch} gives: the bindings inside track for
 * themselves. A member is rendered as a child definition whatever it is, the reading the site
 * build's template pass gives it: an object is an element, anything else is text. A member that is
 * itself a template string is bound as text and never spliced a second time, which is also what the
 * build does (it steps over what it spliced in).
 *
 * Each member renders at `[…options._path, index]`: the template's own position, then the member's
 * place in the value. That is not a path into the document, which holds a string there; it is what
 * `onNodeCreated` reports for the member, and it cannot collide with a sibling's path.
 *
 * @param {EffectScope} scope - Owns every effect the members create
 * @param {readonly JxScopeValue[]} nodes - The template's value
 * @param {JxScope} state
 * @param {JxRenderOptions | undefined} options - `_path` is the template's own position
 * @param {(node: HTMLElement | Text) => void} place - Puts a rendered member in the DOM
 */
function drawTemplateNodes(
  scope: EffectScope,
  nodes: readonly JxScopeValue[],
  state: JxScope,
  options: JxRenderOptions | undefined,
  place: (node: HTMLElement | Text) => void,
): void {
  const path = options?._path ?? [];
  /* Read HERE, tracked, before tracking is paused: the template's own read reaches the array and
     no further, so an array changed in place (a `push`, an index write, a `length` of zero) would
     otherwise leave what was drawn standing. The same string as text read every member when it
     joined them, and a list that stopped following its array would be a regression against that.
     SAFETY: a template that yields an array stands for the children themselves, the same reading
     the site build's template pass gives it. */
  const members = [...(nodes as readonly (JxElement | string)[])];
  pauseTracking();
  try {
    scope.run(() => {
      for (const [i, child] of members.entries()) {
        place(renderNode(child, state, options ? { ...options, _path: [...path, i] } : undefined));
      }
    });
  } finally {
    resetTracking();
  }
}

/**
 * Render a string member of a `children` array that is one whole `${…}` (spec.md §8.4).
 *
 * Such a member is text unless its value is an array, and then it stands for the nodes the array
 * holds: the site build's template pass (`resolveDocTemplates`) splices them in where the string
 * stood, and this draws the same thing so a document reads alike prerendered and rendered live. The
 * build's rule is the whole rule: ANY array is spliced, every member of it (an object as an
 * element, anything else as text, mixed freely, an empty array as nothing), and a value that is not
 * an array leaves the string a text child. Only a single-expression template can yield an array at
 * all, so every other string child takes the plain text path in {@link renderNode} untouched.
 *
 * One Text node is always appended, exactly as before, and it is the stable anchor. While the value
 * is text it holds the text. While the value is an array it is empty and the spliced nodes stand
 * immediately before it, so a change replaces that range and nothing else: siblings on either side
 * are never touched, and a value that turns from an array into text (or back) needs no second
 * anchor. The spliced nodes own a detached scope that is stopped when the value changes.
 *
 * @param {Element} parent
 * @param {string} template - A single-expression template
 * @param {JxScope} state
 * @param {JxRenderOptions | undefined} options - `_path` is the string's own `children` position
 */
function renderTemplatedChild(
  parent: Element,
  template: string,
  state: JxScope,
  options: JxRenderOptions | undefined,
): void {
  const anchor = document.createTextNode(template);
  parent.append(anchor);
  let live: EffectScope | null = null;
  let drawn: (HTMLElement | Text)[] = [];
  const retire = (): void => {
    // Detached before it is stopped, for the reason `teardown` in `renderMappedArray` gives.
    for (const node of drawn) {
      node.remove();
    }
    drawn = [];
    live?.stop();
    live = null;
  };
  bindTemplate(
    template,
    () => {
      const value = evaluateValueTemplate(template, state);
      retire();
      if (!Array.isArray(value)) {
        anchor.textContent = templateText(value);
        return;
      }
      anchor.textContent = "";
      live = effectScope(true);
      drawTemplateNodes(live, value, state, options, (node) => {
        drawn.push(node);
        anchor.before(node);
      });
    },
    () => {
      retire();
      anchor.textContent = "";
    },
  );
  onScopeDispose(() => live?.stop(), true);
}

/**
 * A single expression's value as the text its template interpolates to: a template literal's own
 * conversion, so a Symbol still throws where `String()` would print it.
 */
function templateText(value: JxScopeValue): string {
  /* SAFETY: not a claim that the value is a string. A template literal converts whatever it is
     handed, and the cast only names a type the literal accepts without a lint exemption. */
  return `${value as string}`;
}

// ─── Template string utilities ────────────────────────────────────────────────

/**
 * Check if a value is a template string (contains ${}).
 *
 * @param {unknown} val
 * @returns {boolean}
 */
// ─── Property / style / attribute application ─────────────────────────────────

/**
 * @param {HTMLElement} el
 * @param {JxElement} def
 * @param {JxScope} state
 */
function applyProperties(el: HTMLElement, def: JxElement, state: JxScope) {
  for (const [key, val] of Object.entries(def)) {
    if (RESERVED_KEYS.has(key)) {
      continue;
    }
    if (key.startsWith("$")) {
      continue;
    } // Scope bindings — handled in renderNode

    if (key.startsWith("on") && bindHandler(el, key, val, state)) {
      continue;
    }

    bindProperty(el, key, val, state);
  }
}

/**
 * Attach an `on*` key as an event listener, in any of the four spellings a handler has: a `$ref` to
 * a function, a structured body (spec §20), a string body, or an `$expression`. Returns false for a
 * value that is none of those, which the caller then writes as a plain property.
 *
 * @param {HTMLElement} el
 * @param {string} key The `on`-prefixed key
 * @param {JxDocumentValue | undefined} val
 * @param {JxScope} state
 * @returns {boolean} Whether a listener was attached
 */
function bindHandler(
  el: HTMLElement,
  key: string,
  val: JxDocumentValue | undefined,
  state: JxScope,
): boolean {
  const type = key.slice(2);
  const scope = state;
  if (isRefValue(val)) {
    const handler = resolveRef(val.$ref, state);
    if (isEventHandler(handler)) {
      el.addEventListener(type, (e) => handler(scope, e));
    }
    return true;
  }
  if (isFunctionDef(val) && declaresBodyAndSrc(val)) {
    throw new Error(
      `Jx: inline '${key}' handler declares both body and $src — these are mutually exclusive`,
    );
  }
  if (hasStructuredBody(val)) {
    const { body } = val;
    el.addEventListener(type, (e) => {
      void runStatements(body, scope, e);
    });
    return true;
  }
  if (isFunctionDef(val) && isString(val.body)) {
    const params = handlerParamNames(val);
    /* SAFETY: `new Function` returns an ordinary function of the named parameters, `state` first;
       the listener calls it with the scope and the event, and discards what it returns. */
    const fn = compileBody(params, val.body, `the ${type} handler`) as JxEventHandler;
    el.addEventListener(type, (e) => fn(scope, e));
    return true;
  }
  if (isExpressionDef(val)) {
    const node = val.$expression;
    el.addEventListener(type, (e) => evaluateExpression(node, scope, e));
    return true;
  }
  return false;
}

/**
 * A definition's root-level `on*` keys listen on the HOST element, exactly as they would on an
 * element in a document. Only handler keys are read here: the rest of a definition's root —
 * `observedAttributes`, `emits`, `description` — describes the element rather than styling an
 * instance, and is not written onto it.
 *
 * @param {HTMLElement} host
 * @param {JxElement} def
 * @param {JxScope} state
 */
function bindDefinitionHandlers(host: HTMLElement, def: JxElement, state: JxScope) {
  for (const [key, val] of Object.entries(def)) {
    if (key.startsWith("on") && !RESERVED_KEYS.has(key)) {
      bindHandler(host, key, val, state);
    }
  }
}

/**
 * @param {HTMLElement} el
 * @param {string} key
 * @param {JxDocumentValue | undefined} val
 * @param {JxScope} state
 */
function bindProperty(
  el: HTMLElement,
  key: string,
  val: JxDocumentValue | undefined,
  state: JxScope,
) {
  const target = elementProperties(el);
  const boundProp = boundPropKey(key, val, state);
  if (boundProp) {
    el.dataset.jxBoundProp = boundProp;
  }
  /* An `<img>` in a document says `{"tagName": "img", "src": "/hero.jpg"}`, so `src` arrives HERE
     as a top-level key and is written as a DOM PROPERTY — `attributes: { src }` is the rarer
     spelling. Both are the same reference and both need the same resolution. */
  const asAsset = (resolved: JxScopeValue): JxScopeValue =>
    isString(resolved) ? canvasAssetValue(el.tagName, key, resolved) : resolved;
  /*
   * `className` on an SVGElement is a read-only SVGAnimatedString, so assigning it throws in the
   * strict mode an ES module always runs under. It is the most common Jx element property, so the
   * attribute form is the only one that works on both.
   */
  const write = (resolved: JxScopeValue): void => {
    // Widened to Element: a namespaced node is typed HTMLElement here but is not one at runtime.
    const node: Element = el;
    if (key === "className" && !(node instanceof HTMLElement)) {
      node.setAttribute("class", resolved == null ? "" : String(resolved));
      return;
    }
    /* An equal write is skipped. A binding re-runs whenever anything it read changes, not only
       when its own result does, and re-setting `value` on a focused control is not free: it can
       move the caret and collapse the selection. A control that already holds the value has
       nothing to learn from being told again. */
    if (target[key] === resolved) {
      return;
    }
    target[key] = resolved;
  };
  if (isRefValue(val)) {
    const refVal = val;
    if (key === "id") {
      /* SAFETY: the `id` setter is a WebIDL DOMString attribute, which converts whatever it is
         given to a string itself; the cast only lets the bound value reach that conversion. */
      target[key] = resolveRef(refVal.$ref, state) as string;
      return;
    }
    effect(() => {
      write(asAsset(resolveRef(refVal.$ref, state)));
    });
    return;
  }

  // Universal ${} reactivity — template strings in element properties
  if (isTemplateString(val)) {
    const template = val;
    bindTemplate(template, () => {
      write(asAsset(evaluateTemplate(template, state)));
    });
    return;
  }

  write(asAsset(val));
}

/*
 * ─── The Stylesheet Engine ───────────────────────────────────────────────────
 *
 * An authored `style` object becomes REAL CSS RULES, delivered through the document's
 * `adoptedStyleSheets`. Everything below exists to make that true, and the reason it has to be
 * true is a cascade inversion rather than a missing feature.
 *
 * `applyStyle` used to split one style object across two cascade ORIGINS: a top-level scalar went
 * inline (`el.style.color = …`) while an object-valued key became a per-element `<style>` tag. An
 * inline declaration beats any non-`!important` rule, so
 *
 *     { "backgroundColor": "#6e0303", ":hover": { "backgroundColor": "#15164a" } }
 *
 * emitted a perfectly correct `:hover` rule that could never win. Nesting was not missing; it was
 * outranked. The one existing defence, `mediaOverriddenProps`, moved a base property out of inline
 * when an `@`-block overrode it — one level deep, `@`-keys only, never `:hover` — which is the
 * shape of the bug rather than a fix for it. Every style assertion in the suite read the `<style>`
 * tag's text, so the inversion was invisible to all of them.
 *
 * With every declaration in a rule, `:hover` versus base is an ordinary equal-specificity pair and
 * source order decides, exactly as it does on the compiled page.
 *
 * **Three sheet roles, because mutation cost scales with sheet size.** Measured in Chrome 152 over
 * 500 styled elements: 500 `<style>` tags cost 86.0ms to build, one adopted sheet with hash dedup
 * costs 1.7ms, and 500 separate adopted sheets cost 6.2ms to build but 84.1ms per style recalc
 * because each one is walked. On the update path (300 value edits, the Style-panel hot path)
 * mutating a rule inside one big shared sheet costs 295.7ms, because Chrome rebuilds the whole
 * sheet's RuleSet on any mutation. So:
 *
 *   - the SHARED sheet holds every static, interned rule set and is grown but never rewritten;
 *   - a reactive declaration is indirected through a custom property, so the rule is static text
 *     and the update writes `el.style.setProperty("--jx-r0-0", v)` — 12.4ms, and independent of
 *     sheet size (the same mechanism that makes `${…}` work inside a nested block at all);
 *   - the SCRATCH sheet takes the elements under live Studio edit and is rewritten with
 *     `replaceSync`, 7.5ms per 100 structural edits against 76.9ms for delete+insert in the big one.
 *
 * **The handle stays `data-jx`, and its value becomes a content hash.** Not a generated class:
 * `applyAttributes` runs after `applyStyle`, so a static `attributes: { class: … }` would wipe a
 * class handle. `data-jx` is already there, is specificity (0,1,0), and is not author-writable.
 * Hashing the built rule text rather than calling `Math.random()` is what gives dedup and SSR
 * stability, and it covers everything that varies per call site by construction — the authored
 * object, the resolved `$media` map and the canvas transposer state are all inputs to that text.
 *
 * **Jx emits no cascade layer of its own.** Third-party CSS arrives through `$head` unlayered, and
 * an unlayered rule beats a layered one at any specificity — so layering Jx's own rules would hand
 * every page's `$head` a win it does not have today. It is also what keeps the canvas's
 * `@layer jx-canvas-ua` UA emulation working now that base declarations are unlayered rules rather
 * than inline styles: unlayered still beats layered, which is the same direction author origin
 * beats UA origin on the shipped page.
 */

/** A rule set as it was written into a sheet: the texts, plus the live rules when there are any. */
interface InsertedRules {
  texts: readonly string[];
  rules: CSSRule[];
}

/** A place rules can be written. Two implementations: the CSSOM, and `<style>` text. */
interface StyleSink {
  insert: (texts: readonly string[]) => InsertedRules;
  remove: (inserted: InsertedRules) => void;
  /** Rewrite the whole sink. Used only by the scratch sheet. */
  replaceAll: (texts: readonly string[]) => void;
  /** Everything written, in sheet order. See {@link documentStyleText}. */
  text: () => string;
  detach: () => void;
}

/**
 * A sink over a real `CSSStyleSheet` — constructable and adopted, or a `<style>` element's own.
 *
 * @param {CSSStyleSheet} sheet
 * @param {() => void} detach
 * @returns {StyleSink}
 */
function cssomSink(sheet: CSSStyleSheet, detach: () => void): StyleSink {
  const entries: InsertedRules[] = [];
  return {
    detach,
    insert(texts) {
      const rules: CSSRule[] = [];
      for (const text of texts) {
        const index = sheet.cssRules.length;
        try {
          sheet.insertRule(text, index);
        } catch {
          /* One unparseable rule must not take the other twenty with it. A `<style>` element drops
             exactly the offending rule and keeps going; `insertRule` throws, so this restores the
             tolerance an author's stylesheet has always had. */
          continue;
        }
        const rule = sheet.cssRules[index];
        if (rule) {
          rules.push(rule);
        }
      }
      const inserted: InsertedRules = { rules, texts };
      entries.push(inserted);
      return inserted;
    },
    remove(inserted) {
      const at = entries.indexOf(inserted);
      if (at !== -1) {
        entries.splice(at, 1);
      }
      if (inserted.rules.length === 0) {
        return;
      }
      /* An index scan of a 302-rule sheet measures 0.04ms, so finding the rules costs nothing next
         to the RuleSet rebuild the deletion itself forces. Descending, or each deletion shifts the
         indices still to be removed. */
      const list = [...sheet.cssRules];
      const indices = inserted.rules
        .map((rule) => list.indexOf(rule))
        .filter((index) => index >= 0)
        .toSorted((a, b) => b - a);
      for (const index of indices) {
        sheet.deleteRule(index);
      }
      inserted.rules.length = 0;
    },
    replaceAll(texts) {
      entries.length = 0;
      entries.push({ rules: [], texts });
      sheet.replaceSync(texts.join("\n"));
    },
    text() {
      return entries.flatMap((entry) => entry.texts.join("\n")).join("\n");
    },
  };
}

/**
 * The last resort: a `<style>` element whose text is rewritten. No CSSOM required.
 *
 * @param {HTMLStyleElement} tag
 * @returns {StyleSink}
 */
function textSink(tag: HTMLStyleElement): StyleSink {
  const entries: InsertedRules[] = [];
  const write = () => {
    tag.textContent = entries.map((entry) => entry.texts.join("\n")).join("\n");
  };
  return {
    detach() {
      tag.remove();
    },
    insert(texts) {
      const inserted: InsertedRules = { rules: [], texts };
      entries.push(inserted);
      write();
      return inserted;
    },
    remove(inserted) {
      const index = entries.indexOf(inserted);
      if (index !== -1) {
        entries.splice(index, 1);
        write();
      }
    },
    replaceAll(texts) {
      entries.length = 0;
      entries.push({ rules: [], texts });
      write();
    },
    text() {
      return tag.textContent;
    },
  };
}

/**
 * Open a sheet on `doc`, preferring a constructable one.
 *
 * A constructable stylesheet cannot be adopted into another document, which is why the registry
 * below is keyed on the document and never cached at module scope: the Studio iframe, the live
 * preview tab and the parent page each open their own.
 *
 * @param {Document} doc
 * @returns {StyleSink}
 */
function openSink(doc: Document): StyleSink {
  // A window without constructable stylesheets (an older engine, a test DOM) lacks the global.
  const view: (Window & { CSSStyleSheet?: typeof CSSStyleSheet }) | null = doc.defaultView;
  const SheetConstructor = view?.CSSStyleSheet;
  if (isFunction(SheetConstructor) && Array.isArray(doc.adoptedStyleSheets)) {
    try {
      const sheet = new SheetConstructor();
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      return cssomSink(sheet, () => {
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
      });
    } catch {
      // No constructable stylesheets, or a frozen adoptedStyleSheets. Fall through to a tag.
    }
  }
  const tag = doc.createElement("style");
  tag.dataset.jxSheet = "";
  (documentHead(doc) ?? doc.documentElement).append(tag);
  return tag.sheet ? cssomSink(tag.sheet, () => tag.remove()) : textSink(tag);
}

/**
 * A document's `<head>`, or null when it has none. HTML defines `document.head` as nullable (a
 * document whose root element has no `head` child), though the DOM typings declare it non-null.
 *
 * @param {Document} doc
 * @returns {HTMLHeadElement | null}
 */
function documentHead(doc: Document): HTMLHeadElement | null {
  return doc.head;
}

/** One interned rule set: the rules as written, and how many elements point at them. */
interface InternEntry {
  inserted: InsertedRules;
  refs: number;
}

/** Everything one document's rules are kept in. */
interface SheetState {
  shared: StyleSink;
  /** Opened on the first live edit, and only then — most documents never have one. */
  scratch: StyleSink | null;
  /** Elements living on the scratch sheet, in the order their rules are written. */
  scratchOwners: Map<HTMLElement, readonly string[]>;
  /** Scope handle to the rule set it names. */
  interned: Map<string, InternEntry>;
  /** Declaration-body at-rule text to the one copy of it. */
  hoisted: Map<string, InternEntry>;
  /** Distinguishes `--jx-r<serial>-<n>` variables between elements. */
  serial: number;
}

/**
 * The per-document registry. A `WeakMap` rather than a module-level singleton because one process
 * renders into several documents (canvas iframe, preview tab, parent) and a constructable sheet
 * belongs to exactly one of them.
 */
const sheetStates = new WeakMap<Document, SheetState>();

/**
 * @param {Document} doc
 * @returns {SheetState}
 */
function sheetStateFor(doc: Document): SheetState {
  const existing = sheetStates.get(doc);
  if (existing) {
    return existing;
  }
  const created: SheetState = {
    hoisted: new Map(),
    interned: new Map(),
    scratch: null,
    scratchOwners: new Map(),
    serial: 0,
    shared: openSink(doc),
  };
  sheetStates.set(doc, created);
  return created;
}

/** What one element holds, so that releasing it is exact rather than approximate. */
interface ElementStyleEntry {
  doc: Document;
  /** The state this entry's handles belong to; a reset replaces it and orphans them. */
  state: SheetState;
  uid: string;
  /** The interning key in the shared sheet, or null when the element is on the scratch sheet. */
  interned: string | null;
  /** Hoisted declaration at-rules this element holds a reference to. */
  hoisted: readonly string[];
  /** The `--jx-r…` custom properties its effects write inline. */
  vars: readonly string[];
  /** Stops those effects. */
  stop: (() => void) | null;
}

/**
 * Per-element style bookkeeping. The replacement for the old `elementStyleTags`, which exported a
 * `<style>` element and let its importers remove it by hand; {@link releaseElementStyles} is the
 * documented teardown in its place, because a rule set is now refcounted and dropping one by hand
 * would either leak it or take it away from another element that shares it.
 */
const elementStyles = new WeakMap<HTMLElement, ElementStyleEntry>();

/** The scope handle `buildStyleRules` writes, before the hash of its own output replaces it. */
const SCOPE_TOKEN = "jx-scope";

/**
 * Rewrite the scratch sheet from its owners.
 *
 * `scratchOwners` is a STRONG map — it has to be, since the sheet's whole text is rebuilt from it —
 * so an element only leaves it through {@link releaseElementStyles}. That is not a hole: every way
 * an edited element can go away calls it. `applyStyle` registers it with the enclosing reactive
 * scope, Studio's `disposeSubtree` calls it per element, and `resetDocumentStyles` drops the map
 * wholesale. Sweeping on `isConnected` instead would be wrong rather than merely redundant: an
 * element is routinely styled before it is inserted.
 *
 * Both call sites reach this only once an element is already IN `scratchOwners`, and the only place
 * that happens (`scratchOwners.set`, below) always opens `scratch` first — so it is never still
 * null here.
 *
 * @param {SheetState} state
 */
function rewriteScratch(state: SheetState) {
  state.scratch!.replaceAll([...state.scratchOwners.values()].flat());
}

/**
 * Drop one reference to an interned rule set, removing its rules when the last one goes.
 *
 * `key` always names an entry `retainInterned` already created: {@link releaseElementStyles}'s two
 * call sites pass back exactly the `entry.interned`/`entry.hoisted` keys it was handed at
 * `retainInterned` time, and a stale `state` (one `resetDocumentStyles` already replaced) is turned
 * away before either call site is reached.
 *
 * @param {SheetState} state
 * @param {Map<string, InternEntry>} table
 * @param {string} key
 */
function releaseInterned(state: SheetState, table: Map<string, InternEntry>, key: string) {
  const entry = table.get(key)!;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    table.delete(key);
    state.shared.remove(entry.inserted);
  }
}

/**
 * Take one reference to a rule set, inserting it the first time it is asked for.
 *
 * @param {SheetState} state
 * @param {Map<string, InternEntry>} table
 * @param {string} key
 * @param {readonly string[]} texts
 */
function retainInterned(
  state: SheetState,
  table: Map<string, InternEntry>,
  key: string,
  texts: readonly string[],
) {
  const existing = table.get(key);
  if (existing) {
    existing.refs += 1;
    return;
  }
  table.set(key, { inserted: state.shared.insert(texts), refs: 1 });
}

/**
 * Release everything {@link applyStyle} gave an element: its rules, its scope handle, and the inline
 * custom properties and effects behind its reactive declarations.
 *
 * This is the teardown API `elementStyleTags` used to stand in for, and it is exported because
 * removing a rule set by hand is no longer possible: sets are shared between elements that style
 * alike, so the only safe removal is a refcounted one. Calling it on an element that has no styles
 * is a no-op, which is what makes `applyStyle` safe to call twice.
 *
 * Callers rarely need it. `applyStyle` registers it with the enclosing reactive scope, so an
 * element discarded by a re-rendering mapped array or a disposed Studio subtree releases itself.
 *
 * @param {HTMLElement} el
 * @param {ElementStyleEntry} [only] - Release only if this is still the element's current entry
 */
export function releaseElementStyles(el: HTMLElement, only?: ElementStyleEntry): void {
  const entry = elementStyles.get(el);
  if (!entry || (only !== undefined && entry !== only)) {
    return;
  }
  elementStyles.delete(el);
  entry.stop?.();
  for (const name of entry.vars) {
    el.style.removeProperty(name);
  }
  delete el.dataset.jx;
  /* A `resetDocumentStyles` between the two replaces the state, and its sheets are already gone —
     so the element-local half above always runs and the sheet half is skipped as already done. */
  if (sheetStates.get(entry.doc) !== entry.state) {
    return;
  }
  const { state } = entry;
  if (entry.interned === null) {
    if (state.scratchOwners.delete(el)) {
      rewriteScratch(state);
    }
  } else {
    releaseInterned(state, state.interned, entry.interned);
  }
  for (const key of entry.hoisted) {
    releaseInterned(state, state.hoisted, key);
  }
}

/**
 * Discard every sheet this runtime opened on a document, and orphan the element entries that point
 * into them.
 *
 * A full re-render replaces the whole tree, so the alternative is a shared sheet that only ever
 * grows. The element `WeakMap` cannot be enumerated to be cleared, so entries are invalidated
 * instead: each one records the `SheetState` it was written into, and a release that finds a
 * different state registered for the document does the element-local half only. That is what stops
 * a surviving element from later handing `deleteRule` an index into a sheet nobody is reading.
 *
 * @param {Document} [doc] - Defaults to the ambient document
 */
export function resetDocumentStyles(doc: Document = document): void {
  const state = sheetStates.get(doc);
  if (!state) {
    return;
  }
  sheetStates.delete(doc);
  for (const el of state.scratchOwners.keys()) {
    elementStyles.delete(el);
    delete el.dataset.jx;
  }
  state.scratchOwners.clear();
  state.interned.clear();
  state.hoisted.clear();
  state.shared.detach();
  state.scratch?.detach();
}

/**
 * The CSS this engine has written into a document, in sheet order.
 *
 * It reports what the engine ASKED the document to adopt, not what the document managed to parse,
 * and the difference is the point: `insertRule` throws on a rule the host cannot parse, and the
 * sink swallows that so one bad rule cannot take the rest of an element's set with it. The test DOM
 * rejects `@position-try` outright, so reading it back off `cssRules` there would report a block
 * that a browser adopts perfectly well as missing.
 *
 * It is also the honest answer to "what CSS did my style object become", which is a question the
 * Studio style inspector asks and, before this, nothing could answer without scraping `<style>`
 * tags out of the head.
 *
 * @param {Document} [doc] - Defaults to the ambient document
 * @returns {string} One rule per line, shared sheet first
 * @docs framework/concepts/styling
 */
export function documentStyleText(doc: Document = document): string {
  const state = sheetStates.get(doc);
  if (!state) {
    return "";
  }
  return [state.shared.text(), state.scratch?.text() ?? ""].filter(Boolean).join("\n");
}

/**
 * Whether a style object declares `display` anywhere in it.
 *
 * `defineElement` gives a custom element `display: block` because a custom element defaults to
 * `inline` and Jx containers behave like `<div>`. It used to test `this.style.display`, which was a
 * correct test only while the author's own `display` was written inline — the moment it became a
 * rule the guard stopped seeing it and the default started overriding the author. The test is now
 * on the source rather than on the element, and it is a deep one on purpose: an inline default
 * would beat a `:hover` or `@media` `display` just as surely as a base one.
 *
 * A `@keyframes` block is the one thing the walk does NOT descend into. A `display` in a keyframe
 * stop is a point on a timeline, not a declaration on this element — animating `display` is the
 * ordinary shape of an `allow-discrete` reveal — so counting one as the author's own left the
 * element with no `display` at all, and a custom element with no `display` is `inline`. The element
 * laid out wrongly whenever it was still, which is most of the time.
 *
 * @param {JxStyle | undefined} style
 * @returns {boolean}
 */
function declaresDisplay(style: JxStyle | undefined): boolean {
  /* The BASE block only. A deep walk read a `display` that exists solely inside `&:hover` or an
     `@media` block as "the author supplied one", so the element stayed `inline` at rest and
     became a block on hover — a live trap rather than a subtlety. An author who wants the
     platform's own default writes `display: revert` in the base block, which this sees. */
  return isNonNullObject(style) && "display" in style;
}

/**
 * The `style` object a USAGE SITE wrote on a custom element, kept until the element connects.
 *
 * Weak in the element, so an instance that is never connected is collected with its entry.
 */
const callSiteStyles = new WeakMap<HTMLElement, JxStyle>();

/**
 * Merge two style objects, `over` winning.
 *
 * Deep, because a nested selector block is a rule of its own: a call site that declares `&:hover`
 * must not delete the definition's `&:hover`, only the declarations it repeats inside it. A scalar
 * always replaces, which is what "the call site wins" means.
 *
 * @param base The definition's style.
 * @param over The usage site's, if any.
 * @returns {JxStyle} A new object; neither argument is mutated.
 */
function mergeStyle(base: JxStyle, over: JxStyle | undefined): JxStyle {
  if (!over) {
    return base;
  }
  const out: JxStyle = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const prior = out[key];
    /* A block merges into whatever object the definition holds there. A repeated-block list is
       spread to its index keys first, which is what spreading it as a style object always did. */
    out[key] =
      isNestedStyle(value) && isNonNullObject(prior)
        ? mergeStyle(
            Array.isArray(prior) ? Object.fromEntries(Object.entries(prior)) : prior,
            value,
          )
        : value;
  }
  return out;
}

/**
 * Turn an element's `style` object into CSS rules and adopt them.
 *
 * Nothing is written inline except the `--jx-r…` custom properties that carry reactive values, so
 * an authored `:hover`, `@media` or `@supports` block overrides its own base declaration by
 * ordinary cascade rules — which is what the emitted CSS always said and the inline write always
 * prevented. See the engine essay above for the sheet roles and the measurements behind them.
 *
 * Calling it twice on one element is safe: the first call's rules are released first.
 *
 * @param {HTMLElement} el
 * @param {JxStyle} styleDef
 * @param {Record<string, string>} [mediaQueries] Named breakpoints from root $media. Default is
 *   `{}`
 * @param {JxScope} [state] Component scope for template string evaluation. Default is `{}`
 * @docs framework/concepts/styling
 */
export function applyStyle(
  el: HTMLElement,
  styleDef: JxStyle,
  mediaQueries: Record<string, string> = {},
  state: JxScope = {},
) {
  applyStyleInto(el, styleDef, mediaQueries, state, false);
}

/**
 * Re-apply an element's style definition in place.
 *
 * The Studio Style panel calls this per keystroke, so its rules go to the SCRATCH sheet, which is
 * rewritten whole with `replaceSync` rather than edited rule by rule inside the shared one: 7.5ms
 * per 100 structural edits against 76.9ms. The previous rule set is released first — without that
 * this would leak a set into the shared sheet on every keypress, which is the opposite of the
 * `<style>`-tag leak it replaced.
 *
 * Inline styles are NOT cleared wholesale any more. `el.style.cssText = ""` also destroyed an
 * author's own `attributes: { style: "…" }` and would now take the custom-element `display` default
 * with it; only the `--jx-r…` properties this engine wrote are removed.
 *
 * @param {HTMLElement} el
 * @param {JxStyle | undefined} styleDef
 * @param {Record<string, string>} [mediaQueries]
 * @param {JxScope} [state]
 */
export function reapplyStyle(
  el: HTMLElement,
  styleDef: JxStyle | undefined,
  mediaQueries: Record<string, string> = {},
  state: JxScope = {},
) {
  applyStyleInto(el, styleDef ?? {}, mediaQueries, state, true);
}

/**
 * @param {HTMLElement} el
 * @param {JxStyle} styleDef
 * @param {Record<string, string>} mediaQueries
 * @param {JxScope} state
 * @param {boolean} live - Write to the scratch sheet (the Studio edit path) rather than intern
 */
function applyStyleInto(
  el: HTMLElement,
  styleDef: JxStyle,
  mediaQueries: Record<string, string>,
  state: JxScope,
  live: boolean,
) {
  releaseElementStyles(el);
  const doc = el.ownerDocument;
  const sheetState = sheetStateFor(doc);

  /* One gate for the whole call, so every recursion answers alike. Off in production and in
     preview, where the selector is written exactly as authored.

     The SAME predicate the attribute rename uses, and it has to be: an attribute renamed without
     its selectors transposed is a panel that can never be styled open. They disagreed while the
     rename learned to reach inside a defined element and this did not, so a kit popover rendered
     within another definition's template would have been de-linked and then left with a
     `:popover-open` rule that could no longer match. */
  const transposeSelector =
    (_canvasDelinkPopovers || _canvasDelinkCommands) && canvasStamped(el)
      ? (selector: string) =>
          transposeCanvasOverlaySelector(selector, {
            dialog: el.tagName === "DIALOG",
          })
      : (selector: string) => selector;

  /* Reactive declarations become `var()` reads of a custom property this element sets inline. The
     variable inherits, which is correct, and the declaration stays in the rule where `:hover` can
     override it. The serial keeps two elements' variables apart: a descendant rule reads `var()`
     from the nearest ancestor that set it, and without it a styled child would shadow its parent's
     `--jx-r0` with its own. Only a DESCENDANT rule needs that: a self-target declaration reads the
     variable the element itself sets, so it is named by position alone (`--jx-s<n>`) and elements
     that style alike keep sharing one rule set. */
  let serial = -1;
  let indirect = 0;
  const sources: { name: string; value: string | JxRef }[] = [];
  const rules = buildStyleRules(styleDef, {
    mediaQueries,
    resolveValue: (property, value, target) => {
      /* A reactive value on a CUSTOM PROPERTY, in a rule targeting the element itself, is written
         inline under the AUTHOR'S OWN NAME and contributes no declaration. That keeps the rule
         text free of anything per-element, so every row of a repeater interns ONE rule instead of
         one each: the serial below is in the rule text, the interning handle is a hash of that
         text, and so no two reactive elements could ever share a rule set. Measured before this:
         three font rows produced three handles and three rules.
         The declaration that READS the variable — `font-family: var(--row-face, inherit)` — lives
         in the owning element's own style, is identical across rows, and interns once.
         Only a SELF-target rule qualifies. A descendant rule keeps the indirection, because its
         variable must not be set on the element that carries the rule: a `var()` resolves from the
         nearest ancestor that set it, and a shared descendant rule would read the wrong one. */
      if (target === "self" && property.startsWith("--")) {
        sources.push({ name: property, value });
        return null;
      }
      /* Counted separately from `sources`, so an inline custom property before it cannot shift the
         name of an indirected one. The name is IN the rule text, and the interning handle is a
         hash of that text — a number that moved with unrelated declarations would give two
         otherwise identical styles two rules. */
      let name: string;
      if (target === "self") {
        /* A SELF-target rule reads its variable from the element that sets it inline, which is
           this element — no ancestor's value can reach it — so the name needs no serial, only its
           position. Without this, every instance of a definition with one reactive declaration
           (the kit's tree row binds its indent) interned a rule set of its own: an Outline
           scrolling through a long page minted fifteen rules per row and grew the shared sheet
           past fourteen thousand, slowing every insert and every style recalculation after. */
        name = `--jx-s${indirect}`;
      } else {
        if (serial < 0) {
          ({ serial } = sheetState);
          sheetState.serial += 1;
        }
        name = `--jx-r${serial}-${indirect}`;
      }
      indirect += 1;
      sources.push({ name, value });
      return `var(${name})`;
    },
    scope: SCOPE_TOKEN,
    transposeSelector,
    transposeValue: canvasStyleValue,
  });
  /* `sources.length` too, not `rules.length` alone: a style whose ONLY reactive declaration is a
     custom property on the element itself emits no rule at all, and returning here would install
     no effect, so the variable would be written once and never track its source again. */
  if (rules.length === 0 && sources.length === 0) {
    return;
  }

  /* Declaration-body at-rules declare a document-global NAME — `@position-try --flip`,
     `@font-face` — so they are written once for the whole document and refcounted, rather than
     once per element that mentions them. */
  const scoped = rules.filter((rule) => rule.target !== "unscoped");
  const unscoped = rules.filter((rule) => rule.target === "unscoped");
  for (const rule of unscoped) {
    retainInterned(sheetState, sheetState.hoisted, rule.text, [rule.text]);
  }

  const uid = `jx-${hashCss(scoped.map((rule) => rule.key).join("|"))}`;
  const texts = scoped.map((rule) => rule.text.replaceAll(SCOPE_TOKEN, `[data-jx="${uid}"]`));
  if (texts.length > 0) {
    el.dataset.jx = uid;
    if (live) {
      sheetState.scratch ??= openSink(doc);
      sheetState.scratchOwners.set(el, texts);
      rewriteScratch(sheetState);
    } else {
      retainInterned(sheetState, sheetState.interned, uid, texts);
    }
  }

  const entry: ElementStyleEntry = {
    doc,
    hoisted: unscoped.map((rule) => rule.text),
    interned: texts.length > 0 && !live ? uid : null,
    state: sheetState,
    stop: null,
    uid,
    vars: sources.map((source) => source.name),
  };
  if (sources.length > 0) {
    const scope = effectScope();
    scope.run(() => {
      for (const { name, value } of sources) {
        const write = (resolved: JxScopeValue): void => {
          el.style.setProperty(name, canvasStyleValue(String(resolved ?? "")));
        };
        if (isRefValue(value)) {
          effect(() => write(resolveRef(value.$ref, state)));
        } else {
          /* Survives its expression throwing, as every other template binding does (§6.1): the
             variable is left unwritten, so the declaration that reads it has no value and the
             cascade answers, and the binding re-runs when what it read changes. Unguarded, one
             `${state.theme.accent}` read before `theme` arrived, or one `${item.data.tint}` on a
             row with no `data`, threw out of the render and left the page blank. */
          bindTemplate(value, () => write(evaluateTemplate(value, state)));
        }
      }
    });
    entry.stop = () => scope.stop();
  }
  elementStyles.set(el, entry);
  /* Ties the rules to the render that made them: a mapped array's discarded generation, or a
     Studio subtree being replaced, stops its scope and the rule set goes with it. Guarded on the
     entry so a later `reapplyStyle` is not undone by an older scope disposing after it. */
  onScopeDispose(() => releaseElementStyles(el, entry), true);
}

/*
 * HTML carries a boolean two incompatible ways, and writing one as the other inverts it in silence.
 *
 * A *boolean attribute* — `open`, `disabled`, `hidden`, `required` — is read by PRESENCE. Any value
 * at all counts as true, `"false"` included, so `<details open="false">` is an OPEN `<details>`.
 * The value must never be written; absence is the only way to say false.
 *
 * An *enumerated* attribute carries the word in its own text and reads an empty value as unset, so
 * the presence form is the broken one here: bare `aria-hidden` is NOT hidden, and a dropped
 * `contenteditable` means "inherit from the parent" rather than `false`. Every `aria-*` is in this
 * family — ARIA has no presence attributes at all — along with the three HTML attributes below.
 *
 * **`popover` is enumerated and is deliberately NOT in this set**, which looks like an oversight
 * and is not. Its keywords are `auto`, `manual` and `hint`; its MISSING-value default is `auto`, so
 * a bare `popover` and `popover=""` are both auto popovers — which is what the presence branch
 * below already produces for `true`, correctly. Its INVALID-value default is `manual`, so moving it
 * here would emit `popover="true"`, which is not a keyword, and every popover written as a boolean
 * would silently stop light-dismissing and stop answering Escape. The right answer to a boolean
 * `popover` is not a different emission, it is not writing one: `@jxsuite/schema/overlays` reports
 * it as `invalid-mode`, and the house spelling is `"auto"`.
 *
 * That also corrects the paragraph above for this one attribute: a presence attribute counts any
 * value as true, but `popover="false"` is a *manual* popover rather than a true-ish one, because it
 * is enumerated even though it is emitted through the presence branch.
 *
 * @docs framework/concepts/elements
 */
const ENUMERATED_ATTRS = new Set(["contenteditable", "draggable", "spellcheck"]);

/**
 * The enumerated-attribute names, for a code generator that cannot import this module.
 *
 * The compiler's element and client targets emit standalone ES modules that a built site loads
 * without `@jxsuite/runtime`, so they inline the boolean decision instead of calling it. They
 * serialize THIS array into that inlined helper, and `compile-element.test.ts` asserts the emitted
 * literal still equals it — which is what keeps the four writers of the rule one decision rather
 * than four, in the one place a shared function could not reach.
 *
 * @returns {string[]} The names, sorted, so the emitted output is stable.
 */
export function enumeratedAttrNames(): string[] {
  return [...ENUMERATED_ATTRS].toSorted();
}

/**
 * The text an attribute's boolean value must be written with, or `null` when saying it means
 * removing the attribute instead.
 *
 * An empty string is the bare form: `setAttribute(name, "")` is how the DOM spells the `open` that
 * HTML source writes with no `=`.
 *
 * Shared rather than restated because two renderers must agree. The compiler writes attributes into
 * a string of HTML and this file writes them onto live elements; were they to disagree about which
 * family an attribute belongs to, a prerendered page would change meaning as it hydrated.
 *
 * @param {string} name - Attribute name, already resolved to what will be written
 * @param {boolean} value - The resolved boolean
 * @returns {string | null} Text to write, or null to omit the attribute
 */
export function booleanAttrValue(name: string, value: boolean): string | null {
  const lower = name.toLowerCase();
  if (lower.startsWith("aria-") || ENUMERATED_ATTRS.has(lower)) {
    return String(value);
  }
  return value ? "" : null;
}

/**
 * @param {HTMLElement} el
 * @param {Record<string, import("@jxsuite/schema/types").JxAttributeValue>} attrs
 * @param {JxScope} state
 */
function applyAttributes(el: HTMLElement, attrs: Record<string, JxAttributeValue>, state: JxScope) {
  for (const [k, v] of Object.entries(attrs)) {
    const attr = canvasAttrName(el, k);
    /* Inside the effects, not before them. A `$ref` or `${…}` value is not a string until the
       effect runs — which is exactly why the document walk this replaced could never see it. */
    const write = (resolved: JxScopeValue) => {
      if (resolved === null || resolved === undefined) {
        /* Nothing is an attribute the element does not have. A binding that resolves to `null`
           has to take the attribute WITH it, for the same reason a `false` does below — and an
           `aria-checked=""` or `title=""` left behind is not absence, it is a wrong value. */
        el.removeAttribute(attr);
        return;
      }
      if (isBoolean(resolved)) {
        const text = booleanAttrValue(attr, resolved);
        /* `removeAttribute`, not `setAttribute(attr, "false")`. A binding that flips back has to
           take the attribute WITH it: the element is being re-used, so anything left behind is the
           state the page just said it had left. Asset rewriting is skipped because a boolean names
           no asset — `canvasAssetValue` reads `src`/`href` values, which are never booleans. */
        if (text === null) {
          el.removeAttribute(attr);
        } else {
          el.setAttribute(attr, text);
        }
        return;
      }
      el.setAttribute(attr, canvasAssetValue(el.tagName, k, String(resolved)));
    };
    if (isRefValue(v)) {
      effect(() => write(resolveRef(v.$ref, state)));
    } else if (isTemplateString(v)) {
      bindTemplate(v, () => write(evaluateValueTemplate(v, state)));
    } else {
      write(v);
    }
  }
}

// ─── Array mapping ────────────────────────────────────────────────────────────

/**
 * Render a mapped array (repeater) wrapper-less: its item instances are inserted directly into
 * `parentEl`, in place, ahead of an anchor comment that marks the array's position among the
 * parent's other children.
 *
 * Rows are RECONCILED, not rebuilt. Each row is keyed — by the `key` pointer the array declares,
 * else by its index — and owns a detached effect scope and a reactive `$map` context. When `items`
 * (or the filter/sort sources, or a key) change, a row whose key survives keeps its node and its
 * effects: a reorder moves the node, an insertion creates only the new rows, a removal stops only
 * the removed ones, and a moved row's `$map.index` is updated in place. That is what lets focus,
 * scroll position and a half-typed value survive a change to the list.
 *
 * Reads made while a row is constructed are made with tracking PAUSED. `effectScope.run()` does not
 * reset the active subscriber, so without this every top-level read a row performs — a `$props`
 * write, a tag discriminant, a `$`-local — subscribed the LIST effect, and one row's data changing
 * rebuilt the whole list. The bindings inside a row are effects of their own and re-enable tracking
 * when they run, so a row still updates itself.
 *
 * `options._path` is the array node's own document path (`[…, "children", i]`, or `[…, "children"]`
 * for a legacy whole-children repeater); item instances render at `[…that…, "map", index]`, and a
 * row that moves reports its new path through `options.onNodeMoved`: once, for the row's root. The
 * nodes inside the row are not reported, though each one's path begins with the row's and so
 * changed with it.
 *
 * Three options exist for an editor and do nothing unless a host sets them (`JxRenderOptions`):
 * `rowLimit` caps the rows drawn, `emptyRow` supplies one row for a list with none, and
 * `onListReconciled` reports what each reconciliation drew.
 *
 * @param {HTMLElement} parentEl
 * @param {import("@jxsuite/schema/types").JxMappedArray} arrayDef
 * @param {JxScope} state
 * @param {JxRenderOptions} [options]
 */
function renderMappedArrayInto(
  parentEl: HTMLElement,
  arrayDef: JxMappedArray,
  state: JxScope,
  options?: JxRenderOptions,
) {
  const path = options?._path ?? [];
  const anchor = document.createComment("jx-array");
  parentEl.append(anchor);
  const { items: itemsSrc, map: mapDef, filter: filterRef, sort: sortRef, key: keyRef } = arrayDef;
  const keyPointer = isRefValue(keyRef) ? keyRef.$ref : null;
  /* The instantiation chain the list belongs to (spec.md §16.9), for the same reason
     {@link renderSwitch} keeps one: a row that arrives with new data is inserted from an effect
     re-run, and the instance it holds must connect under the chain of the definition that drew
     the list. */
  const instancePath = _instancePath;
  // And whether it is drawn inside a stamped host, which a later row must be drawn as too.
  const insideStamped = _canvasInsideStampedHost;

  let warned = false;
  const warnOnce = (message: string): void => {
    if (!warned) {
      warned = true;
      console.warn(`Jx $map: ${message}`);
    }
  };

  /** The rows currently rendered, in DOM order. */
  let rows: MappedRow[] = [];

  /* Out of the document FIRST, then stopped: stopping releases every element's styles
     (`releaseElementStyles`), and on a connected node each of those inline-property and `data-jx`
     writes schedules a style invalidation for a node that is about to leave. Detached, they are
     plain writes. See `dispose` in `mount`. */
  const teardown = (row: MappedRow): void => {
    row.node.remove();
    row.scope.stop();
  };

  const createRow = (
    key: MappedRow["key"],
    item: MappedRow["map"]["item"],
    index: number,
  ): MappedRow => {
    const map = shallowReactive({ index, item });
    const child = inheritScope(state);
    bindLocal(child, "$map", map);
    // The flat aliases stay readable by legacy readers, and follow the reactive context.
    Object.defineProperty(child, "$map/item", { enumerable: true, get: () => map.item });
    Object.defineProperty(child, "$map/index", { enumerable: true, get: () => map.index });
    const scope = effectScope(true);
    const childOpts = options ? { ...options, _path: [...path, "map", index] } : undefined;
    const node = scope.run(() => renderNode(mapDef!, child, childOpts))!;
    const row: MappedRow = { key, map, node, scope };
    listRows.set(node, row);
    return row;
  };

  const reconcile = (list: readonly JxScopeValue[], keys: readonly MappedRow["key"][]): void => {
    const previous = new Map<MappedRow["key"], MappedRow>();
    for (const row of rows) {
      previous.set(row.key, row);
    }
    const next: MappedRow[] = [];
    for (let index = 0; index < list.length; index++) {
      const key = keys[index];
      const item = list[index];
      const existing = previous.get(key);
      if (existing) {
        previous.delete(key);
        if (existing.map.item !== item) {
          existing.map.item = item;
        }
        if (existing.map.index !== index) {
          existing.map.index = index;
          options?.onNodeMoved?.(existing.node, [...path, "map", index]);
        }
        next.push(existing);
      } else {
        next.push(createRow(key, item, index));
      }
    }
    // Whatever was not claimed is gone.
    for (const row of previous.values()) {
      teardown(row);
    }
    /* Order in one forward pass. The cursor walks the kept nodes in their current order; a row
       already under the cursor is in place, anything else is inserted before it — a new node, or
       a kept node moved forward. Only rows that are out of place move, and a move is the one thing
       that can cost a focused element its focus. */
    let cursor: ChildNode = rows.find((row) => !previous.has(row.key))?.node ?? anchor;
    for (const row of next) {
      if (row.node === cursor) {
        cursor = cursor.nextSibling ?? anchor;
        continue;
      }
      cursor.before(row.node);
    }
    rows = next;
  };

  const update = (): void => {
    let items: JxScopeValue = isRefValue(itemsSrc) ? resolveRef(itemsSrc.$ref, state) : itemsSrc;
    if (Array.isArray(items) && isRefValue(filterRef)) {
      const fn = resolveRef(filterRef.$ref, state);
      if (isFunction(fn)) {
        /* SAFETY: the guard proved a function, and a function accepts any call: `Array#filter`
           passes each item (with its index and the list) and reads only the result's truthiness. */
        items = items.filter(fn as (item: MappedRow["map"]["item"]) => boolean);
      }
    }
    if (Array.isArray(items) && isRefValue(sortRef)) {
      const fn = resolveRef(sortRef.$ref, state);
      if (isFunction(fn)) {
        /* SAFETY: the guard proved a function, and a function accepts any call: `toSorted` passes
           two items and orders by the sign of the number the comparator returns. */
        const compare = fn as (a: MappedRow["map"]["item"], b: MappedRow["map"]["item"]) => number;
        const unsorted: readonly JxScopeValue[] = items;
        items = [...unsorted].toSorted(compare);
      }
    }
    let list: readonly JxScopeValue[] = Array.isArray(items) && mapDef ? items : [];
    const count = list.length;

    /* The authoring hooks (`JxRenderOptions`), both absent unless a host names them. A list with
       nothing to draw may be given one row to stand for it, and a long one may be cut short. The
       placeholder is keyed by a value no item can be, so it is never taken for a real row: it is
       torn down when the list fills and rebuilt when it empties. */
    const placeholder = count === 0 && mapDef ? options?.emptyRow?.(arrayDef, path) : undefined;
    if (placeholder !== undefined) {
      list = [placeholder];
    }
    const limit = options?.rowLimit;
    if (isNumber(limit) && limit >= 0 && list.length > limit) {
      list = list.slice(0, Math.floor(limit));
    }

    // Keys are read HERE, tracked, so a key that changes reconciles the list.
    const keys =
      placeholder === undefined
        ? list.map((item, index) => mappedRowKey(keyPointer, item, index, warnOnce))
        : list.map(() => EMPTY_ROW_KEY);
    const seen = new Set<MappedRow["key"]>();
    for (let i = 0; i < keys.length; i++) {
      if (seen.has(keys[i])) {
        warnOnce(
          `duplicate key ${String(keys[i])} — every occurrence after the first is rebuilt on each change`,
        );
        keys[i] = { duplicate: i };
      } else {
        seen.add(keys[i]);
      }
    }

    pauseTracking();
    try {
      underInstancePath(reexpand(instancePath), () =>
        insideStampedHost(insideStamped, () => reconcile(list, keys)),
      );
      options?.onListReconciled?.(path, {
        count,
        empty: count === 0,
        nodes: rows.map((row) => row.node),
        rendered: rows.length,
      });
    } finally {
      resetTracking();
    }
  };

  /* The first render is synchronous; every re-render is coalesced into ONE microtask. A reactive
     array mutated in place — `reverse()`, `sort()`, an index write — triggers once per element it
     touches, and an effect run between two of those writes sees an array that is half of each
     state: a row that is transiently absent would be torn down and then rebuilt, which is exactly
     the identity loss keys exist to prevent. Deferring to a microtask is what a framework scheduler
     does for the same reason; a row's own bindings stay synchronous. */
  let queued = false;
  let stopped = false;
  const runner = effect(update, {
    scheduler: () => {
      _listRedraws += 1;
      if (queued) {
        return;
      }
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!stopped) {
          runner();
        }
      });
    },
  });

  onScopeDispose(() => {
    stopped = true;
    for (const row of rows) {
      teardown(row);
    }
    rows = [];
  }, true);
}

/** The key of the one row `emptyRow` supplies: an object, so no item's key can equal it. */
const EMPTY_ROW_KEY: MappedRow["key"] = Object.freeze({ emptyRow: true });

/** A rendered row of a mapped array. */
interface MappedRow {
  key: JxScopeValue;
  /** The row's `$map` context; `item` and `index` are written in place when the row is reused. */
  map: JxRowContext;
  node: HTMLElement | Text;
  /** What stops the row's effects: its own scope, or the disposer a host handed over with a node. */
  scope: Pick<EffectScope, "stop">;
}

/** The row each rendered row node stands for, so a host can hand its list another node for it. */
const listRows = new WeakMap<Node, MappedRow>();

/**
 * Put `next` where the mapped-list row `current` stands, and make it that row's node from now on.
 * Answers whether `current` was a row's node; when it was not, nothing is touched.
 *
 * An authoring interface, beside {@link updateInstanceProps}: a host that edits a document draws a
 * changed template again for a row that is already on screen, with the row's own scope (the one
 * `onNodeCreated` reported for the old node). The list holds each row by its node, moves that node
 * when the row is reused at another index and removes it when the row goes, so a node swapped in
 * behind its back would be left standing when the list next redrew and the old one put back. Told
 * here, the list moves and removes the new node instead. The row keeps its key and its `$map`
 * record, so nothing is reconciled and no other row is touched.
 *
 * The old node's effects are stopped, after it has left the document for the reason `teardown` in
 * {@link renderMappedArrayInto} gives. `stop` is what ends the new node's effects when the row is
 * dropped or the list is torn down; the host created them, so only it can say how.
 *
 * @param current A node the list drew as a row's root.
 * @param next The node to stand there instead, rendered by the host.
 * @param [stop] Called once when the row is removed.
 */
export function replaceListRow(
  current: Node,
  next: HTMLElement | Text,
  stop?: () => void,
): boolean {
  const row = listRows.get(current);
  if (!row || row.node !== current) {
    return false;
  }
  row.node.replaceWith(next);
  row.scope.stop();
  listRows.delete(current);
  row.node = next;
  row.scope = { stop: () => stop?.() };
  listRows.set(next, row);
  return true;
}

/**
 * The identity a `key` pointer names for one item: the item itself for `$map/item`, a value read
 * off it for `$map/item/<path>`. Anything else is not a key — an index names a position, not a row
 * — and a key that evaluates to nothing cannot tell rows apart, so both fall back to the index.
 */
function mappedRowKey(
  pointer: string | null,
  item: MappedRow["map"]["item"],
  index: number,
  warnOnce: (message: string) => void,
): MappedRow["key"] {
  if (pointer === null) {
    return index;
  }
  if (pointer === "$map/item") {
    return item;
  }
  if (pointer.startsWith("$map/item/")) {
    const key = readPath(item, pointer.slice("$map/item/".length));
    if (key === undefined || key === null) {
      warnOnce(`key "${pointer}" is empty for some items — those rows fall back to their index`);
      return index;
    }
    return key;
  }
  warnOnce(`key "${pointer}" is not a $map/item pointer — rows fall back to their index`);
  return index;
}

/**
 * An element's tag: a name, or the branch of a {@link JxTagExpression} the state selects.
 *
 * Every branch of the expression is itself a `TagName`, so this can only ever return something the
 * schema already held to the tag-name pattern — the property that lets the compiler enumerate the
 * candidates and lets `createElement` be called without a second thought here.
 *
 * @param {TagNameSlot} tagName The element's declared tag.
 * @param {JxScope} scope The state the discriminant reads.
 * @returns {string} A literal tag name; `"div"` when nothing is declared.
 */
export function resolveTagName(tagName: TagNameSlot, scope: JxScope): string {
  if (isString(tagName)) {
    return tagName;
  }
  if (!isTagExpression(tagName)) {
    return "div";
  }
  const expression = tagName.$expression;
  if (expression.operator === "?:") {
    // `evaluateOperand`, not `evaluateExpression`: the discriminant is an OPERAND — a pointer, a
    // Literal or a nested node — exactly as it is for a `$switch`, whose docstring names this.
    return evaluateOperand(expression.target, scope, null) ? expression.value : expression.initial;
  }
  const key = evaluateOperand(expression.target, scope, null);
  return expression.cases[String(key)] ?? expression.default;
}

// ─── $switch ──────────────────────────────────────────────────────────────────

/**
 * @param {JxElement} def
 * @param {JxScope} state
 * @param {JxRenderOptions} [options]
 * @returns {HTMLElement}
 */
function renderSwitch(def: JxElement, state: JxScope, options?: JxRenderOptions) {
  const path = options?._path ?? [];
  const container = document.createElement(resolveTagName(def.tagName, state));
  /* The instantiation chain this switch belongs to (spec.md §16.9), read now because the effect
     below re-runs with nothing on the stack. A case that flips after the first paint puts it back
     around the insertion, so an instance the new case creates connects under the chain of the
     definition that drew the switch rather than under none. See {@link _instancePath}. */
  const instancePath = _instancePath;
  // And whether it is drawn inside a stamped host, which a later case must be drawn as too.
  const insideStamped = _canvasInsideStampedHost;

  if (options?.onNodeCreated) {
    options.onNodeCreated(container, path, def, state);
  }

  applyProperties(container, def, state);
  applyStyle(container, def.style ?? {}, scopeMedia(state), state);
  applyAttributes(container, def.attributes ?? {}, state);
  /* Every case renders in a detached scope of its own, stopped before the next case renders and
     when the container's own scope stops. A generation counter names the case a pending external
     load belongs to; it moves on EVERY change — an inline case included — so a load that resolves
     after the discriminant moved on cannot paint over what replaced it. */
  let generation = 0;
  let live: EffectScope | null = null;
  /* The key the rendered case was chosen by. A discriminant that re-resolves to the SAME key keeps
     its case: the subtree, its effects and its state — an open submenu, a half-typed value —
     survive. Without this a mapped row whose item was replaced by an equal one (a host rebuilding
     its projection) rebuilt every switch inside it, and the popover the case rendered closed. */
  let renderedKey: string | null = null;
  const retire = (): void => {
    live?.stop();
    live = null;
  };

  effect(() => {
    if (!isRefValue(def.$switch)) {
      // Detached before it is stopped, for the reason `teardown` in `renderMappedArray` gives.
      container.replaceChildren();
      retire();
      generation += 1;
      return;
    }
    const key = String(resolveRef(def.$switch.$ref, state));
    if (key === renderedKey) {
      return;
    }
    renderedKey = key;
    /* `replaceChildren()` rather than `innerHTML = ""`: identical semantics, and it is not a
       Trusted Types injection sink — under `require-trusted-types-for 'script'` an innerHTML write
       needs a policy even when the string is empty. Four sinks that were never injecting anything
       is four fewer things a policy has to be permissive about. Detached BEFORE the case is
       stopped, for the reason `teardown` in `renderMappedArray` gives. */
    container.replaceChildren();
    retire();
    generation += 1;
    const caseDef = def.cases?.[key];
    if (!caseDef) {
      return;
    }
    const gen = generation;
    const scope = effectScope(true);
    live = scope;
    const childOpts = options ? { ...options, _path: [...path, "cases", key] } : undefined;

    if (isRefValue(caseDef)) {
      // External $ref — fetch and render asynchronously, against the mount's base so a bundled
      // Document need not live at the page URL.
      const { href } = new URL(caseDef.$ref, options?._ctx?.base ?? location.href);
      resolve(href, options?._ctx)
        .then(async (doc) => {
          if (gen !== generation) {
            return;
          }
          // An external case is a component boundary, so it inherits what a component does (§13.4).
          const childScope = await buildScope(withProjectFormulas(doc), {}, href, options?._ctx);
          if (gen !== generation) {
            return;
          }
          container.replaceChildren();
          underInstancePath(reexpand(instancePath), () =>
            insideStampedHost(insideStamped, () =>
              scope.run(() => container.append(renderNode(doc, childScope, childOpts))),
            ),
          );
        })
        .catch((error) =>
          console.error("Jx $switch: failed to load external case", caseDef.$ref, error),
        );
      return;
    }

    // Tracking is paused for the same reason it is for a mapped row: a top-level read the case
    // Makes while it renders must not subscribe THIS effect, or the case re-renders on every
    // Change to anything it read. The bindings inside it track for themselves.
    pauseTracking();
    try {
      underInstancePath(reexpand(instancePath), () =>
        insideStampedHost(insideStamped, () =>
          scope.run(() => container.append(renderNode(caseDef, state, childOpts))),
        ),
      );
    } finally {
      resetTracking();
    }
  });
  onScopeDispose(retire, true);

  return container;
}

// ─── Prototype namespaces (Shape 5) ──────────────────────────────────────────

/**
 * `ref()`, for a value that is one scope member: the same function, under a signature that says so.
 *
 * `ref`'s own return type unwraps its argument's type recursively, and over the recursive
 * `JxScopeValue` union (an array of scope values holds scope values) that unwrapping never
 * terminates (TS2589). The value goes in as it is, so the ref is typed as holding a scope member.
 */
const scopeRef: (value: JxScopeValue) => Ref<JxScopeValue> = ref;

/**
 * Resolve a $prototype definition into a value for the reactive scope.
 *
 * Returns a ref() for async/persistent entries (Request, Storage, Cookie, IndexedDB), or a plain
 * value for simple entries (Set, Map, FormData, Blob).
 *
 * @param {JxPrototypeDef} def - State entry with $prototype
 * @param {JxScope} state - Reactive scope proxy
 * @param {string} key - Def key (for diagnostics)
 * @param {string} [base] - Base URL for resolving $src imports
 * @returns {Promise<JxScopeValue>}
 */
export async function resolvePrototype(
  def: JxPrototypeDef,
  state: JxScope,
  key: string,
  base?: string,
  ctx?: JxContext,
) {
  // ── External class via $src ─────────────────────────────────────────────────
  if (def.$src) {
    return resolveExternalPrototype(def, state, key, base);
  }

  switch (def.$prototype) {
    case "Request": {
      const s: Ref<JxScopeValue> = ref(null);
      const debounceMs = def.debounce ?? 0;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      if (!def.manual && !(ctx?.skipAutoRequests ?? _autoRequestConfig.skip)) {
        effect(() => {
          let url: string | undefined;
          if (isTemplateString(def.url)) {
            url = evaluateTemplate(def.url, state);
          } else {
            ({ url } = def);
          }
          if (!url || url === "undefined" || url.includes("undefined")) {
            return;
          }

          const controller = new AbortController();
          onEffectCleanup(() => {
            controller.abort();
            if (debounceTimer !== null) {
              clearTimeout(debounceTimer);
            }
          });

          /** The fetch itself. With a signal it dies with this binding; without, it is a host's. */
          const request = (signal?: AbortSignal): Promise<JsonValue> =>
            fetch(url, {
              method: def.method ?? "GET",
              ...(signal && { signal }),
              ...(def.headers && { headers: def.headers }),
              ...(def.body && {
                body: isNonNullObject(def.body) ? JSON.stringify(def.body) : def.body,
              }),
            }).then((r): Promise<JsonValue> => (r.ok ? r.json() : Promise.reject(r.statusText)));

          const doFetch = () => {
            const handler = _remoteLookupHandler;
            let lookup: Promise<JsonValue>;
            if (handler) {
              const answer = handler(
                {
                  key,
                  kind: "request",
                  request: {
                    method: def.method ?? "GET",
                    url,
                    ...(def.headers && { headers: def.headers }),
                    ...(def.body !== undefined && { body: def.body }),
                  },
                  scope: state,
                },
                () => request(),
              );
              if (answer === null) {
                return;
              }
              if (!(answer instanceof Promise)) {
                s.value = answer.value;
                return;
              }
              lookup = answer;
            } else {
              lookup = request(controller.signal);
            }
            holdTemplateErrorsFor(
              lookup
                .then((d) => {
                  // An answer a host kept may arrive for a binding that is gone: not written.
                  if (!controller.signal.aborted) {
                    s.value = d;
                  }
                })
                .catch((error) => {
                  if (
                    !controller.signal.aborted &&
                    !(error instanceof Error && error.name === "AbortError")
                  ) {
                    s.value = { error: String(error) };
                  }
                }),
            );
          };

          if (debounceMs > 0) {
            debounceTimer = setTimeout(doFetch, debounceMs);
          } else {
            doFetch();
          }
        });
      }

      return s;
    }

    case "URLSearchParams": {
      return computed(() => {
        const p: Record<string, string> = {};
        for (const [k, v] of Object.entries(def)) {
          if (k !== "$prototype") {
            /* SAFETY: the record goes straight to `URLSearchParams`, whose WebIDL record<USVString,
               USVString> conversion stringifies every value itself; a bound number or boolean
               reaches that conversion exactly as it always has. */
            p[k] = (
              isRefValue(v)
                ? resolveRef(v.$ref, state)
                : isTemplateString(v)
                  ? evaluateTemplate(v, state)
                  : v
            ) as string;
          }
        }
        return new URLSearchParams(p).toString();
      });
    }

    case "LocalStorage":
    case "SessionStorage": {
      const store = def.$prototype === "LocalStorage" ? localStorage : sessionStorage;
      const k = def.key ?? key;
      let init: JxScopeValue;
      try {
        const s = store.getItem(k);
        /* SAFETY: `JSON.parse` answers the JSON value the stored text encodes, or throws, which the
           catch below answers with the entry's default. */
        init = s !== null ? (JSON.parse(s) as JsonValue) : (def.default ?? null);
      } catch {
        init = def.default ?? null;
      }
      const storageState = scopeRef(init);
      // Persist on change
      effect(() => {
        const v = storageState.value;
        if (v === null) {
          try {
            store.removeItem(k);
          } catch {}
        } else {
          try {
            store.setItem(k, JSON.stringify(v));
          } catch {}
        }
      });
      return storageState;
    }

    case "Cookie": {
      const name = def.name ?? key;
      const read = (): JsonValue => {
        const raw = readCookie(document.cookie, name);
        if (raw === null) {
          return null;
        }
        try {
          /* SAFETY: `JSON.parse` answers the JSON value the cookie encodes, or throws, which the
             catch below answers with the raw text. */
          return JSON.parse(decodeURIComponent(raw)) as JsonValue;
        } catch {
          return raw;
        }
      };
      const cookieState = scopeRef(read() ?? def.default ?? null);
      // Persist on change
      effect(() => {
        /* SAFETY: the store is seeded with JSON (`read` parses it, `default` is JSON) and holds
           what the page writes back; `serializeCookie` reads it only through `JSON.stringify`,
           which is defined for any value and keeps exactly the JSON a cookie can carry. */
        // oxlint-disable-next-line unicorn/no-document-cookie -- the Cookie $prototype IS the cookie store binding
        document.cookie = serializeCookie(name, cookieState.value as JsonValue, def);
      });
      return cookieState;
    }

    case "IndexedDB": {
      const idbState: Ref<JxScopeValue> = ref(null);
      const {
        database,
        store,
        version = 1,
        keyPath = "id",
        autoIncrement = true,
        indexes = [],
      } = def;
      if (!database || !store) {
        throw new Error(`Jx: IndexedDB entry '${key}' requires database and store`);
      }
      const req = indexedDB.open(database, version);
      req.addEventListener("upgradeneeded", (e) => {
        // SAFETY: an open request's events are dispatched at the request itself.
        const db: IDBDatabase = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(store)) {
          const os = db.createObjectStore(store, { autoIncrement, keyPath });
          for (const i of indexes) {
            os.createIndex(i.name, i.keyPath, { unique: i.unique ?? false });
          }
        }
      });
      req.addEventListener("success", (e) => {
        // SAFETY: an open request's events are dispatched at the request itself.
        const db: IDBDatabase = (e.target as IDBOpenDBRequest).result;
        idbState.value = {
          database,
          getStore: (mode: IDBTransactionMode = "readwrite") =>
            Promise.resolve(db.transaction(store, mode).objectStore(store)),
          isReady: true,
          store,
          version,
        };
      });
      req.addEventListener("error", () => {
        idbState.value = { error: req.error?.message };
      });
      return idbState;
    }

    case "Set": {
      return new Set(Array.isArray(def.default) ? def.default : []);
    }

    case "Map": {
      return new Map(Object.entries(isJsonObject(def.default) ? def.default : {}));
    }

    case "FormData": {
      const fd = new FormData();
      for (const [k, v] of Object.entries(def.fields ?? {})) {
        /* SAFETY: `append(name, value)` converts a non-Blob value to a USVString itself, so a JSON
           number or boolean field reaches that conversion exactly as it always has. */
        fd.append(k, v as string);
      }
      return fd;
    }

    case "Blob": {
      /* SAFETY: a Blob entry's `parts` is the BlobPart list its document declares; anything else
         reaches the Blob constructor, whose own WebIDL sequence check refuses it as before. */
      const parts = def.parts as BlobPart[] | null | undefined;
      return new Blob(parts ?? [], {
        type: isString(def.type) ? def.type : "text/plain",
      });
    }

    case "ReadableStream": {
      return null;
    }

    default: {
      console.warn(
        `Jx: unknown $prototype "${def.$prototype}" for "${key}". Did you mean to add '$src'?`,
      );
      return ref(null);
    }
  }
}

// ─── External class resolution ────────────────────────────────────────────────

/** Reserved keys stripped from the config object passed to external class constructors. */
const EXTERNAL_RESERVED = new Set([
  "$prototype",
  "$src",
  "$export",
  "timing",
  "default",
  "description",
  "body",
  "parameters",
  "arguments",
  "name",
]);

/**
 * The config an external class is constructed with: the entry's own keys, minus the runtime's.
 *
 * @param {JxPrototypeDef} def
 * @returns {JxScope}
 */
function externalConfig(def: JxPrototypeDef): JxScope {
  const config: JxScope = {};
  for (const [k, v] of Object.entries(def)) {
    if (!EXTERNAL_RESERVED.has(k)) {
      config[k] = v;
    }
  }
  return config;
}

/**
 * A class an external module exports, as the runtime uses it: a function, which is what `typeof`
 * says of every class, constructed with the entry's config.
 */
type ExternalClass = JxScopeFunction & (new (config: JxScope) => ExternalClassInstance);

/**
 * Resolve an external class prototype via $src.
 *
 * @param {JxPrototypeDef} def
 * @param {JxScope} state
 * @param {string} key
 * @param {string} [base]
 * @returns {Promise<Ref<JxScopeValue>>}
 */
async function resolveExternalPrototype(
  def: JxPrototypeDef,
  state: JxScope,
  key: string,
  base?: string,
) {
  const src = def.$src;

  // Non-Function $prototype must use .class.json as entrypoint
  if (!src || !src.endsWith(".class.json")) {
    throw new Error(
      `Jx: $prototype "${def.$prototype}" requires a .class.json $src, got "${src}". ` +
        `Wrap the class in a .class.json schema with $implementation.`,
    );
  }

  return resolveClassJson(def, state, key, base);
}

/**
 * Import a JS module and instantiate a class from it. Internal helper used by resolveClassJson for
 * $implementation.
 *
 * @param {JxPrototypeDef} def - Original state entry (for config extraction)
 * @param {string} src - JS module URL to import
 * @param {string} exportName - Export name to look up
 * @param {string} [base] - Base URL for resolution
 * @returns {Promise<Ref<JxScopeValue>>}
 */
async function importAndInstantiate(
  def: JxPrototypeDef,
  src: string,
  exportName: string,
  base?: string,
) {
  let mod: ImportedModule;
  const seeded = seededModule(src);
  if (seeded instanceof Promise) {
    mod = await seeded;
  } else if (seeded) {
    mod = seeded;
  } else {
    try {
      mod = await importModule(src);
    } catch {
      if (base) {
        const resolvedSrc = new URL(src, base).href;
        mod = await importModule(resolvedSrc);
      } else {
        throw new Error(`Failed to import "${src}"`);
      }
    }
    _moduleCache.set(src, mod);
  }

  const ExportedClass = mod[exportName] ?? mod.default?.[exportName];
  if (!ExportedClass) {
    throw new Error(`Jx: export "${exportName}" not found in "${src}"`);
  }
  if (!isFunction(ExportedClass)) {
    throw new TypeError(`Jx: "${exportName}" from "${src}" is not a class`);
  }

  /* SAFETY: trust boundary — the external class contract, spec.md §12.3. A `$implementation`
     module's export is written as a class constructed with the entry's config; `isFunction` is all
     that can be checked before `new`, and a function that is not constructible throws its own
     TypeError there, as it always has. The instance is read only through `ExternalClassInstance`'s
     optional members, each checked before it is used, and the one it offers is the entry's value. */
  const instance = new (ExportedClass as ExternalClass)(externalConfig(def));

  const value = isFunction(instance.resolve)
    ? await instance.resolve()
    : "value" in instance
      ? instance.value
      : instance;

  // Always wrap in ref for reactivity with external classes
  const s = scopeRef(value);
  if (isFunction(instance.subscribe)) {
    instance.subscribe((newVal) => {
      s.value = newVal;
    });
  }
  return s;
}

/**
 * Resolve a .class.json schema-defined class. Fetches the schema, follows $implementation if
 * hybrid, or constructs dynamically if self-contained.
 *
 * Its one caller, {@link resolveExternalPrototype}, already rejects a missing `$src` before this
 * runs, so `def.$src` is never empty here.
 *
 * @param {JxPrototypeDef} def
 * @param {JxScope} state
 * @param {string} key
 * @param {string} [base]
 * @returns {Promise<Ref<JxScopeValue>>}
 */
async function resolveClassJson(def: JxPrototypeDef, state: JxScope, key: string, base?: string) {
  const src = def.$src!;
  let classDef: JxClassDef;

  // Bare specifiers (package references like @scope/pkg/file) can't be fetched directly —
  // Go straight to dev proxy which can resolve them via node_modules.
  const isBareSpecifier =
    !src.startsWith(".") &&
    !src.startsWith("/") &&
    !src.startsWith("http") &&
    !src.startsWith("file:");
  if (isBareSpecifier) {
    return resolveViaDevProxy(def, state, key, base);
  }

  // Try fetching the .class.json file directly
  try {
    const url = base ? new URL(src, base).href : src;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    /* SAFETY: trust boundary. Only a `$src` ending in `.class.json` reaches this fetch
       (`resolveExternalPrototype` refuses anything else), and a 2xx answer for one is a class
       definition document; the runtime does not schema-validate documents by design. */
    classDef = (await res.json()) as JxClassDef;
  } catch {
    // Fall back to dev proxy (server will handle .class.json resolution)
    return resolveViaDevProxy(def, state, key, base);
  }
  await prepareBodies(classDef);

  // Hybrid mode: $implementation points to the real JS module
  if (classDef.$implementation) {
    // If the schema references $context (e.g. content types), the browser cannot provide
    // The required server-side context — go directly to dev proxy.
    const schemaStr = JSON.stringify(classDef);
    if (schemaStr.includes('"#/$context/')) {
      return resolveViaDevProxy(def, state, key, base);
    }
    const schemaUrl = base ? new URL(src, base).href : new URL(src, location.href).href;
    const implSrc = new URL(classDef.$implementation, schemaUrl).href;
    const exportName = def.$export ?? classDef.title ?? def.$prototype;
    try {
      return await importAndInstantiate(def, implSrc, exportName, base);
    } catch {
      return resolveViaDevProxy(def, state, key, base);
    }
  }

  // Self-contained: construct class dynamically from schema
  const DynClass = classFromSchema(classDef);
  /* SAFETY: every member of ExternalClassInstance is optional, and each is checked below before it
     is used, so any constructed object satisfies it; a schema class that defines `resolve`,
     `value` or `subscribe` methods or fields is the shape it names. */
  const instance = new DynClass(externalConfig(def)) as ExternalClassInstance;

  const value = isFunction(instance.resolve)
    ? await instance.resolve()
    : "value" in instance
      ? instance.value
      : instance;

  // Always wrap in ref for reactivity
  const s = scopeRef(value);
  if (isFunction(instance.subscribe)) {
    instance.subscribe((newVal) => {
      s.value = newVal;
    });
  }
  return s;
}

/**
 * Whether a class document's `$defs.constructor` is its own constructor definition, rather than the
 * `Object.prototype.constructor` function every object parsed from JSON inherits.
 *
 * @param rawCtor What `$defs.constructor` reads as
 */
function isCtorDef(
  rawCtor: NonNullable<JxClassDef["$defs"]>["constructor"],
): rawCtor is JxClassCtorDef {
  return isNonNullObject(rawCtor);
}

/**
 * Dynamically construct a class from a .class.json schema definition. Browser-side: maps private
 * fields to _-prefixed public fields.
 *
 * @param {import("@jxsuite/schema/types").JxClassDef} classDef
 * @returns {typeof DynClass} A class whose instances hold the schema's fields by name
 */
function classFromSchema(classDef: JxClassDef) {
  const fields = classDef.$defs?.fields ?? {};
  // JSON objects inherit Object.prototype.constructor — only an own object value counts.
  const rawCtor = classDef.$defs?.constructor;
  const ctor = isCtorDef(rawCtor) ? rawCtor : undefined;
  const methods = classDef.$defs?.methods ?? {};
  const className = classDef.title ?? "a class";

  // oxlint-disable-next-line typescript/no-extraneous-class -- methods are attached to the prototype dynamically below
  class DynClass {
    /** Static methods, attached by name below. */
    static [member: string]: JxScopeValue;
    /** An instance holds its fields, and reaches its methods, by the names the schema gives. */
    [member: string]: JxScopeValue;

    constructor(config: JxScope = {}) {
      for (const [key, typedField] of Object.entries(fields)) {
        const id = typedField.identifier ?? key;
        const propName = typedField.access === "private" ? `_${id}` : id;
        if (config[id] !== undefined) {
          this[propName] = config[id];
        } else if (typedField.initializer !== undefined) {
          this[propName] = typedField.initializer;
        } else if (typedField.default !== undefined) {
          this[propName] = structuredClone(typedField.default);
        } else {
          this[propName] = null;
        }
      }
      if (ctor?.body) {
        const bodyStr = Array.isArray(ctor.body) ? ctor.body.join("\n") : ctor.body;
        /* SAFETY: `new Function` returns an ordinary function of the one named parameter; `call`
           runs it with the instance under construction as `this`, which is the constructor
           body's contract. */
        const init = compileBody(["config"], bodyStr, `the constructor of ${className}`) as (
          this: DynClass,
          config: JxScope,
        ) => void;
        init.call(this, config);
      }
    }
  }

  for (const [key, typedMethod] of Object.entries(methods)) {
    const name = typedMethod.identifier ?? key;
    const params = (typedMethod.parameters ?? []).map((p) => {
      if (p.$ref) {
        // `split` always yields at least one segment, so `pop` always finds one.
        return p.$ref.split("/").pop() ?? "";
      }
      const n = p.identifier ?? p.name;
      return isString(n) ? n : "arg";
    });
    const bodyStr = Array.isArray(typedMethod.body)
      ? typedMethod.body.join("\n")
      : (typedMethod.body ?? "");

    if (typedMethod.role === "accessor") {
      const descriptor: PropertyDescriptor = {};
      if (typedMethod.getter) {
        /* SAFETY: `new Function` returns an ordinary function; as a getter it is called with no
           arguments and the instance as `this`, and what it returns is the property's value. */
        descriptor.get = compileBody(
          [],
          typedMethod.getter.body ?? "",
          `the getter ${name} of ${className}`,
        ) as () => JxScopeValue;
      }
      if (typedMethod.setter) {
        const sp = (typedMethod.setter.parameters ?? []).map(
          (p) => p.$ref?.split("/").pop() ?? "v",
        );
        /* SAFETY: `new Function` returns an ordinary function of the named parameters; as a setter
           it receives the assigned value as its one argument, and its return is discarded. */
        descriptor.set = compileBody(
          sp,
          typedMethod.setter.body ?? "",
          `the setter ${name} of ${className}`,
        ) as (v: JxScopeValue) => void;
      }
      Object.defineProperty(DynClass.prototype, name, {
        ...descriptor,
        configurable: true,
      });
    } else if (typedMethod.scope === "static") {
      DynClass[name] = compileBody(params, bodyStr, `${name} of ${className}`);
    } else {
      DynClass.prototype[name] = compileBody(params, bodyStr, `${name} of ${className}`);
    }
  }

  Object.defineProperty(DynClass, "name", {
    configurable: true,
    value: classDef.title,
  });
  return DynClass;
}

/**
 * Dev-mode fallback: when an $src module cannot run in the browser, proxy the resolve() call
 * through the Jx dev server (POST /**jx_resolve**). Supports reactive template strings in config
 * values via Vue effect().
 *
 * @param {JxPrototypeDef} def
 * @param {JxScope} state
 * @param {string} key
 * @param {string} [base]
 * @returns {Promise<Ref<JxScopeValue>>}
 */
async function resolveViaDevProxy(def: JxPrototypeDef, state: JxScope, key: string, base?: string) {
  const config = externalConfig(def);

  const hasTemplates = Object.values(config).some((v) => isTemplateString(v));

  /** @param {JxScope} resolvedConfig */
  const doResolve = (resolvedConfig: JxScope) =>
    fetch(resolveProxyPath("/__jx_resolve__"), {
      body: JSON.stringify({
        $base: base,
        $export: def.$export,
        $prototype: def.$prototype,
        $src: def.$src,
        ...resolvedConfig,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).then((r): Promise<JsonValue> => {
      if (!r.ok) {
        throw new Error(`Jx dev proxy ${r.status} for "${key}"`);
      }
      // The dev proxy answers with the resolved value serialized as JSON.
      return r.json();
    });

  // Always wrap in ref for reactivity
  const s: Ref<JxScopeValue> = ref(null);
  const resolveInto = (resolvedConfig: JxScope) => {
    holdTemplateErrorsFor(
      doResolve(resolvedConfig)
        .then((value) => {
          s.value = value;
        })
        .catch((error) => console.error("Jx dev proxy:", error)),
    );
  };
  if (hasTemplates) {
    effect(() => {
      const resolvedConfig: JxScope = {};
      for (const [k, v] of Object.entries(config)) {
        resolvedConfig[k] = isTemplateString(v) ? evaluateTemplate(v, state) : v;
      }
      resolveInto(resolvedConfig);
    });
  } else {
    resolveInto(config);
  }
  return s;
}

// ─── Server function resolution ───────────────────────────────────────────────

/**
 * Start one `timing: "server"` entry's calls, wherever they run. Each call takes the next number,
 * and only the latest may write the entry or report a failure: the answer to a call whose arguments
 * have since changed is dropped whenever it arrives, and a failed call keeps the entry's last
 * value. A call that throws before it returns a promise (an argument the proxy cannot serialize, or
 * a host function that throws synchronously) fails the same way, rather than out of whichever state
 * write started it. The proxy and a host-registered module share it, so a reactive entry's calls
 * are ordered and reported the same way on either path.
 *
 * @param {Ref<JxScopeValue>} s - The entry's value
 * @param {ServerCall} invoke - One call, with resolved arguments: it may return a value or a
 *   promise, or throw
 * @param {string} label - The `console.error` prefix a failed call is reported under
 * @returns {(args: JxScope) => void} Starts a call
 */
function latestServerCall(
  s: Ref<JxScopeValue>,
  invoke: ServerCall,
  label: string,
  describe: (args: JxScope) => RemoteLookup,
): (args: JxScope) => void {
  let seq = 0;
  return (args: JxScope) => {
    seq += 1;
    const n = seq;
    /* The executor runs before the constructor returns, so the call still starts synchronously,
       and a throw inside it rejects this promise instead of escaping to the caller. */
    const run = (): Promise<JsonValue> =>
      new Promise<JsonValue>((settle) => {
        settle(invoke(args));
      });
    const answer = _remoteLookupHandler ? _remoteLookupHandler(describe(args), run) : run();
    if (answer === null) {
      return;
    }
    if (!(answer instanceof Promise)) {
      s.value = answer.value;
      return;
    }
    holdTemplateErrorsFor(
      answer
        .then((result) => {
          if (n === seq) {
            s.value = result;
          }
        })
        .catch((error) => {
          /* An abort is not a failure: it is how a host that stood for the lookup says nobody is
             waiting for it any more (a wait it ended), as it is for a request (embedding.md §5.2). */
          if (n === seq && !(error instanceof Error && error.name === "AbortError")) {
            console.error(label, error);
          }
        }),
    );
  };
}

/**
 * What one call of a `timing: "server"` entry asks for, as a host's {@link RemoteLookupHandler} is
 * told it.
 */
function serverLookup(
  def: JxServerFnDef,
  state: JxScope,
  key: string,
  args: JxScope,
  base?: string,
): RemoteLookup {
  return {
    key,
    kind: "server",
    /* SAFETY: the arguments cross the proxy as JSON, so a server function's are JSON by contract;
       a value that is not is the call's own failure when it is serialized, as it always was. */
    request: {
      $export: def.$export,
      $src: def.$src,
      arguments: args,
      ...(base !== undefined && { $base: base }),
    } as JsonObject,
    scope: state,
  };
}

/**
 * One call of a `timing: "server"` function, with its resolved arguments. Its answer is JSON, or a
 * promise of JSON: on the proxy path the answer crosses the wire as JSON, and a host-registered
 * module honours the same contract so the two paths are interchangeable.
 */
type ServerCall = (args: JxScope) => JsonValue | Promise<JsonValue>;

/**
 * Resolve a timing: "server" entry. The runtime never imports a server module itself: every call is
 * a POST to the host's `/__jx_server__` proxy, which runs the function server-side with `env`, so
 * the runtime never requests the module's source (spec.md §11.4). A host may still serve that file
 * at its URL, which is why a secret belongs in `env` and never in the module body. The one
 * exception is the host's own act: a module it registered with `preloadModule` (embedding.md §6) is
 * called in process, and a reactive entry's calls are ordered there as the proxy orders them.
 *
 * @param {JxServerFnDef} def
 * @param {JxScope} state
 * @param {string} key
 * @param {string} [base]
 * @returns {Promise<Ref<JxScopeValue>>}
 */
async function resolveServerFunction(
  def: JxServerFnDef,
  state: JxScope,
  key: string,
  base?: string,
) {
  const src = def.$src;
  const exportName = def.$export;

  /* The host-seeded set, not the module cache: a Function entry's own `$src` import lands in that
     cache too, and reusing it here would put a server module in the browser after all. */
  const seeded = _hostSeeded.has(src) ? seededModule(src) : undefined;
  if (!seeded) {
    return resolveServerFunctionViaProxy(def, state, key, base);
  }
  const mod = seeded instanceof Promise ? await seeded : seeded;

  const candidate = mod[exportName] ?? mod.default?.[exportName];
  if (!candidate) {
    throw new Error(`Jx: export "${exportName}" not found in "${src}" for "${key}"`);
  }
  if (!isFunction(candidate)) {
    throw new TypeError(`Jx: "${exportName}" from "${src}" is not a function`);
  }
  /* SAFETY: the guard proved a function, and a function accepts any call. A `timing: "server"`
     export is written to be called through the proxy, which hands it one arguments object and
     sends its answer back as JSON, so that is the contract it is held to in process too. */
  const fn = candidate as ServerCall;

  const rawArgs = def.arguments ?? {};
  const hasReactiveArg = Object.values(rawArgs).some((v) => isRefValue(v));
  const resolveArgs = () => {
    const args: JxScope = {};
    for (const [k, v] of Object.entries(rawArgs)) {
      args[k] = isRefValue(v) ? resolveRef(v.$ref, state) : v;
    }
    return args;
  };

  // Always wrap in ref for reactivity
  const s: Ref<JxScopeValue> = ref(null);
  if (hasReactiveArg) {
    const call = latestServerCall(s, fn, "Jx server function:", (args) =>
      serverLookup(def, state, key, args, base),
    );
    effect(() => {
      const args = resolveArgs();
      onEffectCleanup(() => {});
      call(args);
    });
  } else {
    s.value = await fn(resolveArgs());
  }
  return s;
}

/**
 * Call a timing: "server" entry through the host's `/__jx_server__` proxy, which imports the module
 * server-side and calls the export with `env` (server.md §3.3). This is the only path an
 * interpreting runtime takes for a module the host did not register. A `$ref` argument makes the
 * call reactive: it re-posts from an `effect()` when the reference changes. A failed call leaves
 * the entry's last value and logs, and the answer to a superseded call is dropped, so a slow answer
 * to an earlier call can never overwrite a later one (`latestServerCall`).
 *
 * @param {JxServerFnDef} def
 * @param {JxScope} state
 * @param {string} key
 * @param {string} [base]
 * @returns {Promise<Ref<JxScopeValue>>}
 */
async function resolveServerFunctionViaProxy(
  def: JxServerFnDef,
  state: JxScope,
  key: string,
  base?: string,
) {
  const rawArgs = def.arguments ?? {};
  const hasReactiveArg = Object.values(rawArgs).some((v) => isRefValue(v));

  const resolveArgs = () => {
    const args: JxScope = {};
    for (const [k, v] of Object.entries(rawArgs)) {
      args[k] = isRefValue(v) ? resolveRef(v.$ref, state) : v;
    }
    return args;
  };

  /** @param {JxScope} args */
  const doResolve = (args: JxScope) =>
    fetch(resolveProxyPath("/__jx_server__"), {
      body: JSON.stringify({
        $base: base,
        $export: def.$export,
        $src: def.$src,
        arguments: args,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).then((r): Promise<JsonValue> => {
      if (!r.ok) {
        throw new Error(`Jx server proxy ${r.status} for "${key}"`);
      }
      // The proxy answers with the function's result serialized as JSON.
      return r.json();
    });

  // Always wrap in ref for reactivity
  const s: Ref<JxScopeValue> = ref(null);
  const call = latestServerCall(s, doResolve, "Jx server proxy:", (args) =>
    serverLookup(def, state, key, args, base),
  );
  if (hasReactiveArg) {
    effect(() => {
      const args = resolveArgs();
      onEffectCleanup(() => {});
      call(args);
    });
  } else {
    call(resolveArgs());
  }
  return s;
}

/**
 * Resolve a $ref string to a value in scope.
 *
 * With Vue reactivity, this reads directly from the reactive proxy. When called inside a effect or
 * computed, the read is tracked.
 *
 * @param {string} ref
 * @param {JxScope} state - Reactive scope proxy (or child scope)
 * @returns {JxScopeValue}
 */
export function resolveRef(refPath: string, state: JxScope) {
  // A `$ref` read from a document is not schema-validated, so a non-string one passes through.
  if (!isString(refPath)) {
    return refPath;
  }
  if (refPath.startsWith("$map/") || refPath.startsWith("#/$map/")) {
    /* Both spellings. `#/` is the documented JSON Pointer prefix everywhere else in the schema,
       so a `#/$map/item/x` fell through to `readPath`, returned null, and a `$map` over it
       rendered ZERO rows with no warning. */
    const parts = (refPath.startsWith("#/") ? refPath.slice(2) : refPath).split("/");
    const [, key] = parts; // "item" or "index"
    /* SAFETY: `$map` holds only the row record `renderMappedArrayInto` binds (see `rowContext`), an
       ordinary object read here by whichever member the ref names. */
    const map = state.$map as Record<string, JxScopeValue> | undefined;
    const base = map?.[key!] ?? state[`$map/${key}`];
    return parts.length > 2 ? readPath(base, parts.slice(2).join("/")) : base;
  }
  if (refPath.startsWith("#/state/")) {
    // One call, not a hand-split leading token: slicing at the first `/` skipped unescaping it, so
    // `#/state/a~1b/c` looked for a member called `a~1b` rather than `a/b`.
    return readPath(state, refPath.slice("#/state/".length));
  }
  if (refPath.startsWith("parent#/")) {
    /*
     * A prop name may be a path into the prop. This read the whole path as one key and returned
     * undefined for `parent#/user/name`, while the compiler lowered it to a walk.
     */
    return readPath(state, refPath.slice("parent#/".length));
  }
  if (refPath.startsWith("window#/")) {
    return readPath(globalThis.window, refPath.slice("window#/".length));
  }
  if (refPath.startsWith("document#/")) {
    return readPath(globalThis.document, refPath.slice("document#/".length));
  }
  return readPath(state, refPath) ?? null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Check if v is a Vue ref (including computed).
 *
 * @param {unknown} v
 * @returns {v is Ref<unknown>}
 */
export function isSignal(v: unknown): v is Ref<unknown> {
  return isRef(v);
}

/**
 * Write an observed attribute into element state, coerced by the type the state entry already holds
 * (spec §16.5): a number parses, a boolean is presence (`"false"` counts as absent), and anything
 * else is the string. Shared by connection and `attributeChangedCallback` so the two cannot
 * disagree.
 *
 * REMOVING an attribute restores the entry's DECLARED DEFAULT rather than writing the absence
 * through. `attributeChangedCallback` reports a removal as `null`, and writing that through gave a
 * `type: "string"` entry the value `null` and a `type: "number"` entry `Number(null)`, which is 0 —
 * so a numeric prop could never express "unset" and a string prop stopped matching its own declared
 * type. The default is the value the entry had before anyone set the attribute, which is what the
 * removal is asking to go back to.
 *
 * A COMPUTED entry is never written, by a change or by a removal: its value is produced, and
 * attribute text replacing a `$prototype` or `$src` entry's function or record is not something a
 * removal could give back. `declaredDefaults` records such an entry as present with the value
 * `undefined`, which is what this reads.
 *
 * Exported for the compiler, which inlines the rule into generated modules and calls it for the
 * prerender; `observed-attr-agreement.test.ts` there proves the copy agrees.
 *
 * @param defaults The declared defaults by state key; a key absent from it has none, and a key
 *   present with `undefined` is computed.
 */
export function absorbAttribute(
  state: JxScope,
  name: string,
  value: string | null,
  defaults?: ReadonlyMap<string, JxScopeValue>,
): void {
  const camelKey = name.replaceAll(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
  if (defaults?.has(camelKey) && defaults.get(camelKey) === undefined) {
    return;
  }
  const current = state[camelKey];
  if (isBoolean(current)) {
    // Presence IS the value for a boolean, so a removal is already spelled by the same rule.
    state[camelKey] = value !== null && value !== "false";
    return;
  }
  if (value === null) {
    const declared = defaults?.get(camelKey);
    state[camelKey] = declared === undefined ? (isNumber(current) ? 0 : "") : declared;
    return;
  }
  state[camelKey] = isNumber(current) ? Number(value) : value;
}

/**
 * The declared default of every state entry, by state key, read the way `buildScope` reads the
 * entry's shape:
 *
 * - An object with `default` declares that value.
 * - A computed entry (a marker of {@link COMPUTED_STATE_KEYS}, or a `${…}` template string) is
 *   recorded as PRESENT with the value `undefined`: its value is produced, so it has no default and
 *   an observed attribute never writes it ({@link absorbAttribute}).
 * - A pure type definition (`{ "type": "number" }`), which `buildScope` leaves out of state, is
 *   absent: it declares no default, and recording the schema object as one wrote that object into
 *   state when its attribute was removed.
 * - Anything else is its own default: the shorthand `{ "label": "none" }`, a plain object, an array.
 *
 * Exported for the compiler, which serializes the observed keys' defaults into generated modules;
 * `observed-attr-agreement.test.ts` there proves the emitted map equals this function's output.
 *
 * @param def The element definition
 * @returns {Map<string, JxScopeValue>} Key → default
 */
export function declaredDefaults(def: JxElement): Map<string, JxScopeValue> {
  const out = new Map<string, JxScopeValue>();
  for (const [key, entry] of Object.entries(def.state ?? {})) {
    if (isString(entry) && isTemplateString(entry)) {
      out.set(key, undefined);
      continue;
    }
    if (isNonNullObject(entry) && !Array.isArray(entry)) {
      if ("default" in entry) {
        out.set(key, entry.default);
        continue;
      }
      if (COMPUTED_STATE_KEYS.some((marker) => marker in entry)) {
        out.set(key, undefined);
        continue;
      }
      if (hasSchemaKeywords(entry)) {
        continue;
      }
    }
    out.set(key, entry);
  }
  return out;
}

/** The markers that make a state entry produced rather than authored. */
const COMPUTED_STATE_KEYS = ["$expression", "$prototype", "$ref", "$src"] as const;

/** Keys already reported, so a component rendered in a loop warns once rather than per instance. */
const _privatePropWarned = new Set<string>();

/**
 * Refuse a `$props` write against a private (`#`) state key — `spec.md` §5.6.
 *
 * Ignored rather than thrown. A `$props` block naming a private entry is an authoring mistake, not
 * a broken document: the rest of the instance is well-formed and refusing to render it would turn a
 * typo into a blank page. But silence was the previous behavior and it is the wrong kind — the
 * author sees a prop that looks accepted and does nothing — so the write is dropped and named.
 *
 * @param {string} key
 * @param {string} [where] - The site refusing it, for a message that points somewhere
 * @returns {boolean} True when the key is private and the caller must skip it
 */
/**
 * Whether the instance genuinely CARRIES `key`, rather than the prototype merely having an accessor
 * for it.
 *
 * `key in el` cannot tell those apart, and for a REFLECTED DOM property — `title`, `role`, `id`,
 * `lang`, `dir`, `slot`, `hidden` — the accessor answers `""` when nothing is set. `"" !==
 * undefined`, so a component declaring `state.title` never rendered its own default: the empty
 * string won. `quote` next to it kept its default, which is what made the bug look like bad
 * content.
 *
 * The test is NOT `Object.hasOwn` alone, and that distinction is the whole subtlety. Assigning a
 * reflected name goes through the prototype accessor and creates no own property, so a legitimate
 * `$props.title` would be discarded by an own-property test — silently, for every component that
 * declares one. What the accessor DOES do is write the attribute, so the attribute is the evidence
 * that somebody set it, whether that was `$props` before connection or the author in the document.
 *
 * Exported for the compiler, which inlines the rule into generated modules; a compiler test proves
 * the copy agrees.
 *
 * @param {HTMLElement} el - The instance being connected.
 * @param {string} key - A state key declared by the component definition.
 * @returns {boolean}
 */
export function instanceSupplies(el: HTMLElement, key: string): boolean {
  if (Object.hasOwn(el, key)) {
    return true;
  }
  if (el.hasAttribute(key)) {
    return true;
  }
  // ARIA-style reflections carry a kebab attribute for a camelCase property (`ariaLabel` →
  // `aria-label`), so the direct name lookup above would miss a value that really was set.
  const kebab = key.replaceAll(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`);
  return kebab !== key && el.hasAttribute(kebab);
}

/**
 * The platform's setter for `key` on an element, when the name is one the platform already owns.
 *
 * @param {HTMLElement} el
 * @param {string} key
 * @returns {((value: JxScopeValue) => void) | undefined}
 */
function nativeSetter(el: HTMLElement, key: string): ((value: JxScopeValue) => void) | undefined {
  for (
    let proto: object | null = Reflect.getPrototypeOf(el);
    proto;
    proto = Reflect.getPrototypeOf(proto)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor) {
      return descriptor.set;
    }
  }
  return undefined;
}

function refusePrivateProp(key: string, where?: string): boolean {
  if (!isPrivateStateKey(key)) {
    return false;
  }
  const seen = where === undefined ? key : `${where}:${key}`;
  if (!_privatePropWarned.has(seen)) {
    _privatePropWarned.add(seen);
    console.warn(
      `Jx: "${key}" is private state (spec.md §5.6) and cannot be set through $props` +
        `${where === undefined ? "" : ` (${where})`}. The write was ignored; rename the entry ` +
        "without the leading # to make it part of the component's interface.",
    );
  }
  return true;
}

/** Tests only — the warn-once set outlives a single render by design. */
export function _resetPrivatePropWarnings(): void {
  _privatePropWarned.clear();
}

/**
 * @param {JxElement} def
 * @param {JxScope} parentState
 * @returns {JxScope}
 */
function mergeProps(def: JxElement, parentState: JxScope): JxScope {
  const child = inheritScope(parentState);
  for (const [k, v] of Object.entries(def.$props ?? {})) {
    if (refusePrivateProp(k, "$props")) {
      continue;
    }
    bindLocal(child, k, isRefValue(v) ? resolveRef(v.$ref, parentState) : v);
  }
  return child;
}

/*
 * The CSS-authoring rules live in `./css.ts`, whose only import is a pair of type guards. They are
 * re-exported
 * here because they always were part of this module's surface and moving them must not break a
 * consumer; a host that cannot afford the DOM runtime imports `@jxsuite/runtime/css` instead.
 */
export {
  buildStyleRules,
  camelToKebab,
  COLOR_SCHEME_ATTR,
  COLOR_SCHEME_STORAGE_KEY,
  commentedRuleText,
  cssPropertyName,
  cssRuleText,
  hashCss,
  isDeclarationAtRule,
  isKeyframesAtRule,
  isNestedSelectorKey,
  pureSchemeOf,
  resolveAtQuery,
  resolveNestedSelector,
  schemeSelectors,
  spliceNestingSelector,
  splitSelectorList,
  transposeCanvasOverlaySelector,
  transposeCanvasPopoverSelector,
} from "./css.ts";
export type { CssBuildOptions, CssKeyframeBlock, CssRule, CssRuleTarget } from "./css.ts";

/**
 * Convert a style rules object to a CSS text string (skipping nested selectors).
 *
 * Kept for consumers; nothing in this repository composes a rule this way any more, because
 * `buildStyleRules` answers the same question for a whole style object rather than one flat level
 * of it. It shares that function's property spelling — `cssPropertyName`, not `camelToKebab` — so a
 * custom property survives it: `--fooBar` and `--foo-bar` are two different properties, and
 * kebab-casing one renames it out from under the `var()` that reads it.
 *
 * @param {JxStyle} rules
 * @returns {string}
 */
export function toCSSText(rules: JxStyle) {
  return Object.entries(rules)
    .filter(([k, v]) => !isNestedSelectorKey(k) && !isNonNullObject(v))
    .map(([p, v]) => `${cssPropertyName(p)}: ${canvasStyleValue(String(v))}`)
    .join("; ");
}

// ─── Custom Element Registration ──────────────────────────────────────────────

let _rootMedia: Record<string, string> = {};
/**
 * Every defined element's CURRENT definition, read at connection — which is what lets a definition
 * be replaced.
 */
const _elementDefs = new Map<string, { base: string; doc: JxDocument }>();

/**
 * The definition an element tag renders from, as most recently defined or redefined.
 *
 * @param {string} tagName
 * @returns {{ base: string; doc: JxDocument } | undefined}
 */
export function elementDefinition(tagName: string): { base: string; doc: JxDocument } | undefined {
  return _elementDefs.get(tagName);
}

/**
 * Replace an element's definition (embedding.md §7). `customElements.define` is one-shot, so the
 * generated class reads its definition through the registry at connection time: an instance
 * connected after this call renders the new document; one already on the page keeps the definition
 * it rendered until it is re-mounted. `observedAttributes` is the one thing the platform freezes at
 * first definition, so a changed list is reported and takes effect only in a fresh realm. A tag not
 * yet defined is simply defined.
 *
 * @param {JxDocument} doc
 * @param {string} [baseUrl]
 * @returns {Promise<void>}
 */
export async function redefineElement(doc: JxDocument, baseUrl?: string): Promise<void> {
  const base = baseUrl ?? location.href;
  const { tagName } = doc;
  if (!tagName || !tagName.includes("-")) {
    throw new Error(`Jx redefineElement: tagName "${tagName}" must contain a hyphen`);
  }
  if (!customElements.get(tagName)) {
    await defineElement(doc, base);
    return;
  }
  if (doc.$elements) {
    await registerElements(doc.$elements, base);
  }
  const before = _elementDefs.get(tagName)?.doc.observedAttributes ?? [];
  const after = doc.observedAttributes ?? [];
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    console.warn(
      `Jx redefineElement: <${tagName}> keeps observedAttributes [${before.join(", ")}] as first defined; [${after.join(", ")}] takes effect only in a fresh realm`,
    );
  }
  _elementDefs.set(tagName, { base, doc });
}

/** The project formulas every component scope in this realm inherits (spec.md §13.4). */
let _projectFormulas: Record<string, JxStateDefinition> = {};
/** A definition with the inherited formulas merged in, built once per definition. */
let _withFormulas = new WeakMap<JxDocument, JxDocument>();

/**
 * Give this realm its project's `state`, from which a component inherits the pure named formulas
 * (spec.md §13.4, §19.4c).
 *
 * A page receives project state merged into its own document, but a component's document is its own
 * scope and is fetched as written, so the host that knows the project says so once: the site shell
 * before it renders the page, Studio before it draws a canvas. Only closed pure formulas are taken
 * (`inheritableFormulas`); data state never crosses. Realm-wide because the custom element registry
 * is: one tag has one definition per realm, whatever mounted it.
 *
 * @param {Record<string, JxStateDefinition> | null} [projectState] - `project.json` `state`; absent
 *   or null clears it, and a component is then exactly its own document
 */
export function setProjectFormulas(projectState?: Record<string, JxStateDefinition> | null): void {
  _projectFormulas = inheritableFormulas(projectState);
  _withFormulas = new WeakMap();
}

/**
 * A component document as its scope is built: the inherited formulas first, then its own `state`,
 * so an entry the component declares shadows a project formula of that name. The document itself
 * when the project gives it nothing.
 *
 * @param {JxDocument} doc
 * @returns {JxDocument}
 */
function withProjectFormulas(doc: JxDocument): JxDocument {
  const cached = _withFormulas.get(doc);
  if (cached) {
    return cached;
  }
  const own = doc.state ?? {};
  const added = Object.entries(_projectFormulas).filter(([key]) => !(key in own));
  const merged =
    added.length > 0 ? { ...doc, state: { ...Object.fromEntries(added), ...own } } : doc;
  _withFormulas.set(doc, merged);
  return merged;
}

/**
 * Seed the module-level root `$media` map used as the fallback for components that declare their
 * own `@--name` style blocks but carry no own `$media` (buildScope ~279-280). `Jx()` sets this from
 * the document during a full top-level render, but the Studio iframe canvas calls `buildScope`/
 * `renderNode` directly (never `Jx()`), so without seeding it a component's `@--md` would resolve
 * to the invalid `@media md`. Callers on the direct path MUST set it (with the merged `$media`)
 * before `buildScope`, and re-set it every render so a stale map from a previous document cannot
 * leak.
 *
 * @param {Record<string, string> | null} [map] - Absent or null clears it
 */
export function setRootMedia(map?: Record<string, string> | null): void {
  _rootMedia = map ?? {};
}

/**
 * Resolve and register $elements entries (depth-first).
 *
 * @param {JxDocument["$elements"]} elements
 * @param {string} base
 * @returns {Promise<void>}
 */
async function registerElements(
  elements: NonNullable<JxDocument["$elements"]>,
  base: string,
  ctx?: JxContext,
) {
  for (const entry of elements) {
    // Bare string: npm package side-effect import (registers custom elements)
    if (isString(entry)) {
      try {
        // Bare specifiers need a URL path for the browser; the dev server resolves
        // /node_modules/<pkg> to the package entry point via exports/module/main.
        const specifier =
          entry.startsWith("/") || entry.startsWith(".") ? entry : `/node_modules/${entry}`;
        await import(specifier);
      } catch (error) {
        console.warn(`Jx: failed to import package "${entry}"`, error);
      }
      continue;
    }
    if (!isRefValue(entry)) {
      continue;
    }
    const { href } = new URL(entry.$ref, base);
    const doc = await resolve(href, ctx);
    if (!doc.tagName || !doc.tagName.includes("-")) {
      continue;
    }
    if (customElements.get(doc.tagName)) {
      continue;
    }

    // Depth-first: register sub-dependencies first
    if (doc.$elements) {
      await registerElements(doc.$elements, href, ctx);
    }

    await defineElement(doc, href);
  }
}

/**
 * Inject head elements from $head declarations. Each entry is { tagName, attributes } — bare npm
 * specifiers in href/src are rewritten to /node_modules/ paths for the dev server.
 *
 * @param {import("@jxsuite/schema/types").JxHeadEntry[]} entries
 * @param {string} _base - Document base URL for resolving relative paths
 */
function injectHead(entries: readonly (JxHeadEntry | null | undefined)[], _base: string) {
  for (const entry of entries) {
    if (!entry || !entry.tagName) {
      continue;
    }
    const tag = entry.tagName.toLowerCase();
    const attrs = { ...entry.attributes };
    // Resolve href/src: bare npm specifiers -> /node_modules/ path
    for (const key of ["href", "src"] as const) {
      const v = attrs[key];
      if (!isString(v) || v === "") {
        continue;
      }
      if (!v.startsWith("/") && !v.startsWith(".") && !v.startsWith("http")) {
        /* The bare-specifier lane owns `/node_modules/<pkg>`, which is the HOST's URL space and
           not the project's. A canvas resolver must never claim it: the file is not in the
           repository, so there is nothing for it to resolve to. */
        attrs[key] = `/node_modules/${v}`;
        continue;
      }
      attrs[key] = canvasAssetValue(tag.toUpperCase(), key, v);
    }

    // Deduplicate: skip if an identical element already exists
    const selector = `${tag}${attrs.href ? `[href="${attrs.href}"]` : ""}${attrs.src ? `[src="${attrs.src}"]` : ""}`;
    if (selector !== tag && document.head.querySelector(selector)) {
      continue;
    }

    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, String(v));
    }
    if (entry.textContent) {
      // An object is a structured data block (JSON-LD, site-architecture.md §8.5). The compiler
      // Serializes it the same way, so the interpreted page and the built page agree.
      el.textContent = isNonNullObject(entry.textContent)
        ? JSON.stringify(entry.textContent, null, 2)
        : entry.textContent;
    }
    document.head.append(el);
  }
}

// ─── Instantiation chain (spec.md §16.9) ─────────────────────────────────────

/**
 * How deep component nesting may go before an instance refuses to render, and before the compiler
 * (`@jxsuite/compiler`, `shared.ts`, which imports this export) refuses to continue a build.
 *
 * The cycle check in {@link extendInstancePath} catches a definition that renders ITSELF — same tag,
 * same props — which is the only shape that can never terminate, while a self-reference whose props
 * change at every level (`depth: "${state.depth + 1}"`) is data-driven recursion that a `$switch`
 * may or may not bottom out. The seen-set cannot tell those apart, so this cap is what turns a
 * forgotten stop into a diagnostic instead of a page that never settles or a build that overflows
 * its stack. Thirty-two is far beyond any component library's real depth and far below the call
 * stack's. It lives here because the compiler depends on the runtime and not the other way round,
 * so one declaration serves both sides of spec.md §16.9: a page that builds is a page that
 * renders.
 */
export const MAX_COMPONENT_NESTING = 32;

/** One instance on the chain: its tag, and the props it was given, as an identity. */
interface InstanceFrame {
  tag: string;
  /** Every value the instance supplied that its definition's state read (§16.9). */
  props: JxScope;
}

/**
 * The chain an instance is created under, and where on it the current expansion began.
 *
 * `frames` is every instance from the page-level one down, outermost first. `expansion` is the
 * index of the first frame that belongs to the SAME synchronous pass as the instance being created:
 * the cycle check (§16.9 rule 1) looks back no further than that, while the cap (rule 2) counts
 * every frame. The distinction is what an effect re-run does to certainty. Along one pass a
 * repeated frame is a render that repeats itself, deterministically, forever. Across a re-run it is
 * not: the frames above the boundary rendered to completion once, and whether the page asks for one
 * of them again is its data — an `onMount` that flips a `$switch` into the same tag every time, or
 * a click that opens one more level of a node that starts closed — which the runtime cannot tell
 * apart. So the cycle check is not asked across the boundary, and the loop that lives in re-runs is
 * ended by the cap instead: thirty-three empty hosts and a diagnostic, not a page that never
 * settles.
 */
interface InstancePath {
  frames: readonly InstanceFrame[];
  expansion: number;
}

/** The chain a page-level render runs under: nothing above it. */
const ROOT_INSTANCE_PATH: InstancePath = { expansion: 0, frames: [] };

/**
 * The chain of instances whose definitions are being rendered RIGHT NOW.
 *
 * A module-level stack rather than a WeakMap from element to chain, and it is worth saying why that
 * survives `connectedCallback` being async. The callback awaits `buildScope` before it touches the
 * DOM, and by the time it resumes, whatever the enclosing instance pushed here has long been popped
 * — so the stack alone would be empty for every instance and catch nothing. What saves it is WHEN
 * an instance connects: `this.append(child)` in the enclosing render runs the child's
 * `connectedCallback` synchronously, and every way a definition brings an instance into being —
 * `renderCustomElementWithProps`, the bare-tag branch of `renderNode`, a nested element inside
 * either, and a prerendered host drawing its children again as it upgrades — appends it inside that
 * same synchronous stretch. So the callback reads the stack ONCE, before its first `await`, and
 * carries the copy across the gap. A WeakMap would need a write at each of those creation sites to
 * say the same thing.
 *
 * A subtree an effect renders LATER — a `$switch` case that flips after the first paint, a `$map`
 * row that arrives with new data — connects with nothing on the stack, because no enclosing render
 * is running when the effect re-runs; a write from `onMount` or a click is what triggered it. So
 * the two renderers that create nodes from an effect each capture the stack when they are first
 * rendered (which is inside the enclosing pass) and put it back, re-expanded, around every later
 * insertion ({@link underInstancePath}). That is the one thing this stack needs beyond the
 * synchronous stretch, and it is what makes the `onMount`-flip shape a diagnostic rather than a
 * hang. Reading `@vue/reactivity`'s `getCurrentScope()` there instead would find nothing: an effect
 * re-run restores no scope, and a case or a row renders in a DETACHED scope with no parent.
 */
let _instancePath: InstancePath = ROOT_INSTANCE_PATH;

/**
 * Say that an instance was not rendered, on the two surfaces a host can reach (spec §16.4, §16.9):
 * the console, and a bubbling, composed `jx-error` `ErrorEvent` from the element carrying the
 * error. Nothing is said for a host no longer in the document, whose replacement reports for it.
 *
 * @param {HTMLElement} host - The instance
 * @param {string} tagName - Its tag, for the console line
 * @param {Error} error - Why
 */
function reportUnrendered(host: HTMLElement, tagName: string, error: Error): void {
  if (!host.isConnected) {
    return;
  }
  console.error(`Jx: <${tagName}> was not rendered:`, error);
  host.dispatchEvent(
    new ErrorEvent("jx-error", {
      bubbles: true,
      composed: true,
      error,
      message: error.message,
    }),
  );
}

/**
 * Run `fn` with `path` as the chain, so every instance that CONNECTS during it reads that chain.
 *
 * Restored rather than cleared afterwards: the enclosing render's chain is what was there, and a
 * restore needs no argument about whether anything was.
 *
 * @param {InstancePath} path - The chain the instances `fn` connects are created under
 * @param {() => T} fn - The render, or the insertion that connects what a render made
 * @returns {T} What `fn` returned
 */
function underInstancePath<T>(path: InstancePath, fn: () => T): T {
  const was = _instancePath;
  _instancePath = path;
  try {
    return fn();
  } finally {
    _instancePath = was;
  }
}

/**
 * The chain a later insertion runs under: the same frames, with the expansion beginning now.
 *
 * Called on EVERY run of a `$switch` case or a `$map` reconcile, the first one included — harmless
 * there, because a first run builds into a detached container and nothing connects until the
 * enclosing pass appends it, under the enclosing pass's own chain.
 *
 * @param {InstancePath} path - The chain captured when the renderer was first rendered
 * @returns {InstancePath}
 */
function reexpand(path: InstancePath): InstancePath {
  return { expansion: path.frames.length, frames: path.frames };
}

/**
 * Whether two prop values are the same input to a definition.
 *
 * Reference equality first — a `$ref` into the parent's state forwards the same primitive, the same
 * reactive proxy or the same function to the next level — and structural equality for plain data
 * rebuilt at each level (`data-jx-props` parsed twice is two objects with one meaning). Plain data
 * is what JSON can describe: an array, or an object with no prototype but `Object`'s, reactive or
 * raw. Anything else — a `Map`, a `Set`, a class instance, a circular object — is different from
 * everything but itself, because its JSON form would not say what it holds and two different values
 * that serialise alike would close a cycle that was never there. The cost of that policy is a loop
 * the depth cap catches instead; the alternative is a false diagnostic on a page that would have
 * ended. Inside plain data the comparison IS the JSON form, so a member JSON cannot see (a
 * function, a `Map` two levels down) is not seen here either; §16.9 says so.
 *
 * @param {JxScopeValue} a
 * @param {JxScopeValue} b
 * @returns {boolean}
 */
function samePropValue(a: JxScopeValue, b: JxScopeValue): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (!isPlainData(a) || !isPlainData(b)) {
    return false;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Whether a value is an array or a plain object — the shapes whose JSON form is the whole value.
 *
 * @param {JxScopeValue} value
 * @returns {boolean}
 */
function isPlainData(value: JxScopeValue): boolean {
  if (!isNonNullObject(value)) {
    return false;
  }
  const raw: unknown = toRaw(value);
  if (Array.isArray(raw)) {
    return true;
  }
  const proto: unknown = Object.getPrototypeOf(raw);
  return proto === Object.prototype || proto === null;
}

/**
 * Whether two frames are the same instance: one tag, one set of prop names, equal values.
 *
 * @param {InstanceFrame} a
 * @param {InstanceFrame} b
 * @returns {boolean}
 */
function sameFrame(a: InstanceFrame, b: InstanceFrame): boolean {
  if (a.tag !== b.tag) {
    return false;
  }
  const keys = Object.keys(a.props);
  if (keys.length !== Object.keys(b.props).length) {
    return false;
  }
  return keys.every(
    (key) => Object.hasOwn(b.props, key) && samePropValue(a.props[key], b.props[key]),
  );
}

/**
 * The chain an instance's own render runs under: the enclosing chain plus itself — or the
 * diagnostic that says why it must not render at all.
 *
 * The two messages are the compiler's, word for word (`renderComponentInstance` in
 * `@jxsuite/compiler`), so a page that fails to build and a canvas that fails to paint say the same
 * thing about the same definition. Meeting a frame already on the chain, within the current
 * expansion, is the instance rendering itself with the same props, which never ends; a chain at the
 * cap is a self-reference whose props change — or whose repeats live in re-runs, where the cycle
 * check is not asked ({@link InstancePath}) — and whose stop case never came.
 *
 * @param {InstancePath} path - The chain the instance was created under
 * @param {InstanceFrame} frame - The instance about to render
 * @returns {InstancePath} The chain its children render under
 * @throws {Error} The named diagnostic — never a stack overflow, never a hang
 * @docs framework/concepts/components
 */
function extendInstancePath(path: InstancePath, frame: InstanceFrame): InstancePath {
  const chain = [...path.frames.map((f) => f.tag), frame.tag].join(" → ");
  if (path.frames.slice(path.expansion).some((f) => sameFrame(f, frame))) {
    throw new Error(
      `Component <${frame.tag}> renders itself: ${chain}. A component cannot appear inside its own ` +
        `definition with the same props — the expansion would never end.`,
    );
  }
  if (path.frames.length >= MAX_COMPONENT_NESTING) {
    throw new Error(
      `Component nesting exceeds ${MAX_COMPONENT_NESTING} levels: ${chain}. A component that ` +
        `renders itself with changing props needs a case that stops.`,
    );
  }
  return { expansion: path.expansion, frames: [...path.frames, frame] };
}

/**
 * Register a custom element from a Jx document.
 *
 * @param {string | JxDocument} source - URL to .json file, or raw document object
 * @param {string} [base] - Base URL for resolving $src imports
 * @returns {Promise<void>}
 */
const _definedSources = new Set<string>();

export async function defineElement(source: string | JxDocument, baseUrl?: string) {
  let base = baseUrl;
  let source_: JxDocument;
  if (isString(source)) {
    base = new URL(source, base ?? location.href).href;
    if (_definedSources.has(base)) {
      return;
    }
    _definedSources.add(base);
    source_ = await resolve(source);
  } else {
    source_ = inlineDocument(source, new URL(base ?? location.href, location.href).href);
  }
  base ??= location.href;

  const { tagName } = source_;
  if (!tagName || !tagName.includes("-")) {
    throw new Error(`Jx defineElement: tagName "${tagName}" must contain a hyphen`);
  }
  if (customElements.get(tagName)) {
    return;
  }

  // Register sub-dependencies first
  if (source_.$elements) {
    await registerElements(source_.$elements, base);
  }

  _elementDefs.set(tagName, { base, doc: source_ });

  // The definition as first given. The class reads the CURRENT one at connection (see
  // `redefineElement`); only `observedAttributes` is frozen here, because the platform freezes it.
  const initialDef = source_;
  const initialBase = base;
  const observedAttrs = initialDef.observedAttributes ?? [];
  _observedAttributes.set(tagName, observedAttrs);

  const ElementClass = class extends HTMLElement {
    _jxInitialized = false;
    _state: JxScope | null = null;

    static get observedAttributes() {
      return observedAttrs;
    }

    async connectedCallback() {
      // An element carrying `data-jx-definition-root` IS the definition being rendered by an
      // External renderer (the studio canvas editing this component's own document) — its subtree
      // Is authored DOM, not an instantiation site. Self-initializing here would wipe that tree
      // And re-render it with default state (the "component editor shows a live instance" bug).
      if (this.dataset.jxDefinitionRoot !== undefined) {
        return;
      }
      if (this._jxInitialized) {
        /* Put back in a document (moved to another parent, or removed and inserted). Everything
           below happens to an instance once, `onMount` included (§16.4): a sidecar wires up what it
           was handed at the first insertion and is not handed it twice, which is what lets a
           slotted element, moved by its parent's slot distribution straight after it rendered,
           mount once. `onUnmount` still runs on every removal. */
        return;
      }
      this._jxInitialized = true;

      /* The chain this instance was created under, read BEFORE the first `await`: the enclosing
         render is still on the stack now and will not be when this callback resumes. See
         {@link _instancePath} for why that ordering is the whole mechanism. */
      const enclosingPath = _instancePath;
      /* What this instance was given, recorded beside each write into state below. It is the
         instance's identity on the chain (§16.9): two nested instances of one tag that were given
         the same values render the same thing, forever. Only a value the definition's state READS
         is recorded — a `$props` key no state entry declares changes nothing about the render, so
         a definition that "varies" one at each level is still rendering itself. */
      const supplied: JxScope = {};

      // The definition as it stands NOW — a redefinition since this class was made is honoured.
      const live = _elementDefs.get(tagName) ?? { base: initialBase, doc: initialDef };
      _connectedDefs.set(this, live.doc);
      // With the project's formulas under its own state (§13.4): the scope, and what a prop may set.
      const def = withProjectFormulas(live.doc);
      const defBase = live.base;

      // The element is its own dispatch root: a body run without an event emits from the host.
      const state = await buildScope(def, {}, defBase, { base: defBase, media: null, root: this });

      // Read properties from the data-jx-props payload the site build writes on a
      // Non-static instance, so an upgrade re-renders with the authored props, not the defaults.
      /* Observed attributes already on the element are read now. `attributeChangedCallback` fires
         for an attribute set before connection too — but on an instance with no state yet, so it
         had nothing to write into, and `<jx-icon name="plus">` rendered with the default. Before
         the `$props` merges below, so a property a parent set still wins (spec §16.2). */
      const connectDefaults = declaredDefaults(def);
      for (const attr of observedAttrs) {
        if (this.hasAttribute(attr)) {
          absorbAttribute(state, attr, this.getAttribute(attr), connectDefaults);
          // The raw string, not the coerced value: coercion is a function of it, so two equal
          // Strings are one input.
          supplied[attr] = this.getAttribute(attr);
        }
      }

      const propsAttr = this.dataset.jxProps;
      if (propsAttr) {
        try {
          /* SAFETY: `JSON.parse` answers the JSON value the attribute encodes, or throws, which the
             catch below ignores as it always has. */
          const props = JSON.parse(propsAttr) as JsonValue;
          /* The site build writes an object. An array or string payload still yields its index
             keys, and a number, boolean or null yields none, as `Object.entries` always gave. */
          const entries = isNonNullObject(props) || isString(props) ? Object.entries(props) : [];
          for (const [key, val] of entries) {
            if (refusePrivateProp(key, "data-jx-props")) {
              continue;
            }
            if (key in (def.state ?? {})) {
              state[key] = val;
              supplied[key] = val;
            }
          }
        } catch {}
        delete this.dataset.jxProps;
      }

      // Read literal `props.*` attributes (JSON-authored instances pass props this way; the
      // Compiler lifts them into $props at build, and this is the live-render mirror). String
      // Values only — HTML lowercases attribute names, so state keys must be lowercase to match.
      // Collect first: removing while iterating the live NamedNodeMap skips entries.
      const propAttrNames = this.getAttributeNames().filter(
        (name) => name.startsWith("props.") && name.length > "props.".length,
      );
      for (const name of propAttrNames) {
        const key = name.slice("props.".length);
        if (refusePrivateProp(key, "props.* attribute")) {
          this.removeAttribute(name);
          continue;
        }
        if (key in (def.state ?? {})) {
          state[key] = this.getAttribute(name);
          supplied[key] = this.getAttribute(name);
          this.removeAttribute(name);
        }
      }

      // Merge $props set as JS properties by parent before connection
      for (const key of Object.keys(def.state ?? {})) {
        if (isPrivateStateKey(key)) {
          continue;
        }
        const own = elementProperties(this);
        if (key in this && own[key] !== undefined && instanceSupplies(this, key)) {
          state[key] = own[key];
          supplied[key] = own[key];
        }
      }

      /* Every input is known now, so this is where an instance that would never finish is
         refused (§16.9): before it has a state, a style or a child, so a refused host is an empty
         element the page renders around — emptied of what the definition wrote into it for its
         slots too, since nothing will distribute that. The diagnostic is REPORTED rather than
         thrown onward: a throw from an async `connectedCallback` is an unhandled rejection that
         names no element and stops nothing. It goes two ways. The console is the runtime's
         surface for a render that fails after the page has settled (`$switch` external cases and
         the dev proxies report there too). The `jx-error` event is the surface a HOST can hold:
         it bubbles from the refused element with the error on it, so a page, or the studio canvas
         wrapping one, can collect it where a console line inside an iframe reaches nobody. The
         rest of the page keeps rendering, which is the point.

         Neither surface is used for a host that is no longer in the document. A refused instance
         was connected when this callback began, and one that is not by the time the verdict is in
         belongs to a subtree the page discarded during the `await` above: a prerendered host of the
         same tag that was parsed INSIDE another and re-rendered from the definition by the outer
         one's upgrade, which captures it as slot content and empties itself. Its replacement is
         the instance that reports, on the chain the outer upgrade draws; reporting from the
         discarded copy too said one defect twice. The refusal itself still stands, so a host
         re-attached later is an empty element and not a hang. */
      let ownPath: InstancePath;
      try {
        ownPath = extendInstancePath(enclosingPath, { props: supplied, tag: tagName });
      } catch (error) {
        this.replaceChildren();
        reportUnrendered(this, tagName, error instanceof Error ? error : new Error(String(error)));
        return;
      }
      /*
       * Set up property getters/setters that forward into reactive state. Private entries get NO
       * accessor: the property-first interface IS the props mechanism, so defining one would leave
       * `el["#cache"] = x` writing straight through everything above.
       */
      const declared = live.doc.state ?? {};
      for (const key of Object.keys(def.state ?? {})) {
        if (isPrivateStateKey(key)) {
          continue;
        }
        /* An inherited project formula (§13.4) is a function in the scope, not part of the
           element's interface: the component's author never chose its name. An accessor for one
           would put a project formula called `append`, `remove` or `title` over the host's own
           member of that name, on every component in the realm, and the render below then calls
           the formula instead of the DOM method. Only an instance that was GIVEN the name as a prop
           gets the accessor, so a live `$props` binding of that name still reaches state. */
        if (!(key in declared) && !(key in supplied)) {
          continue;
        }
        /* A name the platform already owns (`title`, `lang`, `hidden`) keeps its native setter, so
           the attribute still reflects — and ALSO reaches state. Skipping it entirely meant a prop
           delivered after connection (a template over data that resolves asynchronously) wrote
           only the attribute: the instance kept the empty value it connected with, and a card's
           `title` never rendered. */
        const native = nativeSetter(this, key);
        Object.defineProperty(this, key, {
          configurable: true,
          get: () => state[key],
          set: (v: JxScopeValue) => {
            native?.call(this, v);
            state[key] = v;
          },
        });
      }

      this._state = state;

      // Capture light DOM children (for slot distribution) before rendering
      const slottedChildren = captureSlotted(this);
      this.replaceChildren();

      /* Custom elements default to `display: inline`; a Jx container behaves like a `<div>`, so
         one is supplied. It goes in the element's OWN RULE rather than inline: an inline
         declaration is beaten only by `!important`, so a consumer could not override the default
         without one. At (0,1,0) a consumer's rule, a cascade layer or a parent's descendant rule
         all win normally, and the definition's own `display` still wins because it is written into
         the same rule after this. */
      const ownStyle = def.style;
      const defStyle =
        ownStyle && declaresDisplay(ownStyle) ? ownStyle : { display: "block", ...ownStyle };
      /* Definition first, call site second, so the call site wins at equal specificity by source
         order — the promise §9.2 already makes for base-before-nested. Merged into ONE call
         because each `applyStyle` releases what the last one interned. */
      const hostStyle = mergeStyle(defStyle, callSiteStyles.get(this));

      // Render template into light DOM (once, not in effect — inner effects handle reactivity)
      applyStyle(this, hostStyle, scopeMedia(state), state);
      applyAttributes(this, def.attributes ?? {}, state);
      bindDefinitionHandlers(this, def, state);

      /*
       * Root-level `textContent` is a definition's content just as much as `children` is — it is
       * the shape spec.md §17.2 recommends when every child would be a bare string — and it was
       * dropped here, so such a component rendered empty everywhere the interpreter runs.
       */
      if (!Array.isArray(def.children) && def.textContent !== undefined) {
        bindProperty(this, "textContent", def.textContent, state);
      }
      const children = Array.isArray(def.children) ? def.children : [];
      /* A render that throws is reported the way a refusal is (§16.4), for the same reason: thrown
         onward from this async callback it is an unhandled rejection naming no element. The
         children drawn before the throw stay; the one that threw, its later siblings and `onMount`
         do not happen, and slot content is still distributed into the slots that were drawn. */
      const draw = (): Error | null => {
        /* An instance the studio stamped is part of the page being edited, so everything the
           definition draws inside it is too — and the de-link rules cannot see that from the nodes
           themselves. Restored rather than cleared, because one definition may render another. */
        const wasInside = _canvasInsideStampedHost;
        _canvasInsideStampedHost ||= carriesCanvasStamp(this);
        /* And the chain, for the same span: an instance this definition draws connects inside
           `this.append` below and reads it there ({@link underInstancePath}). */
        let failure: Error | null = null;
        try {
          underInstancePath(ownPath, () => {
            for (const childDef of children) {
              this.append(renderNode(childDef, state));
            }
          });
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
        } finally {
          _canvasInsideStampedHost = wasInside;
        }
        // Slot distribution (light DOM)
        distributeSlots(this, slottedChildren);
        return failure;
      };

      /* Lifecycle: onMount, with the HOST as its second argument.
         A sidecar that must reach the element it belongs to had no way to: the runtime handed it
         the scope alone, so elements resorted to dispatching a `jx-ready` event at themselves and
         catching it with a root handler purely to learn `currentTarget`. The host is what the
         callback needed; the event round trip was the workaround.
         And with the host as its RECEIVER, which is how the compiled element calls it: there a
         state function is an arrow inside the element class, so a body's `this` is the element.
         Called bare here, a body written for the built site (jxsuite.com's search reads
         `const host = this`) read the window instead, and threw on every page that drew it live. */
      const mounted = (): void => {
        const { onMount } = state;
        if (isScopeHook(onMount)) {
          queueMicrotask(() => onMount.call(this, state, this));
        }
      };

      let attempt = runScoped(draw);
      const failure = attempt.result;
      if (!failure) {
        mounted();
        return;
      }
      reportUnrendered(this, tagName, failure);
      /* …and it is drawn again when what it was given changes (§16.4). A prop bound to data that
         arrives later (a collection the page resolves after its first render, a row a list fills
         in) reaches the instance AFTER it connected, so the render that threw was a render of
         the empty values, not of the instance. Without a retry it stayed blank for good even once
         every value it needed was there. The watch reads the definition's authored entries only,
         the ones a prop can write: a computed entry is what threw, and reading it here would
         throw again. Writes are coalesced into one microtask, because a parent sets its props one
         at a time. The same error is reported once, not once per attempt. */
      const inputs = Object.keys(def.state ?? {}).filter(
        (key) =>
          !isPrivateStateKey(key) &&
          !(connectDefaults.has(key) && connectDefaults.get(key) === undefined),
      );
      let lastMessage = failure.message;
      let queued = false;
      const watch = effect(
        () => {
          for (const key of inputs) {
            void state[key];
          }
        },
        {
          scheduler: () => {
            if (queued) {
              return;
            }
            queued = true;
            queueMicrotask(() => {
              queued = false;
              if (!this.isConnected) {
                watch.effect.stop();
                return;
              }
              watch();
              attempt.stop();
              this.replaceChildren();
              pauseTracking();
              try {
                attempt = runScoped(draw);
              } finally {
                resetTracking();
              }
              const again = attempt.result;
              if (!again) {
                watch.effect.stop();
                mounted();
              } else if (again.message !== lastMessage) {
                lastMessage = again.message;
                reportUnrendered(this, tagName, again);
              }
            });
          },
        },
      );
    }

    disconnectedCallback() {
      // Called as a method, so a hook that reads `this` sees the scope.
      const state = this._state;
      if (state && isScopeHook(state.onUnmount)) {
        state.onUnmount(state);
      }
    }

    adoptedCallback() {
      const state = this._state;
      if (state && isScopeHook(state.onAdopted)) {
        state.onAdopted(state);
      }
    }

    attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null) {
      if (!this._state || oldVal === newVal) {
        return;
      }
      // The CURRENT definition's defaults, so a redefinition (embedding.md §7) that changes one
      // Reaches an instance that is already connected.
      absorbAttribute(
        this._state,
        name,
        newVal,
        declaredDefaults(_elementDefs.get(tagName)?.doc ?? initialDef),
      );
    }
  };

  customElements.define(tagName, ElementClass);
}

/**
 * Write one `$props` value onto an instance, before or after it connected.
 *
 * The same resolution `bindProperty` gives an ordinary element. A `$props: { src }` on a custom
 * element is an asset reference authored at the USAGE site, so it belongs to the document that
 * wrote it; a media prop the component forwards into its own `<img>` is resolved separately, inside
 * the component's render, against the same context.
 *
 * @param {HTMLElement} el - The instance.
 * @param {string} key - The prop's name.
 * @param {JxScopeValue} resolved - Its value, already resolved from any binding.
 */
function writeInstanceProp(el: HTMLElement, key: string, resolved: JxScopeValue): void {
  const value = isString(resolved) ? canvasAssetValue(el.tagName, key, resolved) : resolved;
  elementProperties(el)[key] = value;
  /* A prop that shares its name with an `HTMLElement` property (`title`, `lang`) is forwarded
     like any other once the instance has connected (§16.2): its accessor calls the platform's
     setter, then writes state, so the write above already reaches state there. The write below
     covers the instance that holds the name in its state with NO accessor for it, which is a
     name its live definition does not declare and it was not given at connection (an inherited
     project formula, §13.4). There the write above lands on the platform's property alone, and
     the instance would go on drawing the value it connected with. The binding is the parent's
     `$props`, addressed to the instance's state, so it writes that state. */
  const instanceState = instanceStateOf(el);
  if (instanceState && key in HTMLElement.prototype && Object.hasOwn(toRaw(instanceState), key)) {
    instanceState[key] = value;
  }
}

/**
 * The attributes each tag observes, as first defined: the list the platform froze, which a
 * redefinition does not change ({@link redefineElement}).
 */
const _observedAttributes = new Map<string, readonly string[]>();

/**
 * The definition each instance connected with. A redefinition leaves a connected instance drawing
 * the old one (embedding.md §7), and nothing read from the new one describes it.
 */
const _connectedDefs = new WeakMap<HTMLElement, JxDocument>();

/** Whether an instance is still drawn by the definition its tag has now. */
function drawnByCurrent(el: HTMLElement): boolean {
  const drawn = _connectedDefs.get(el);
  return drawn !== undefined && drawn === _elementDefs.get(el.localName)?.doc;
}

/** The markers of a state entry whose value is produced asynchronously or kept outside the scope. */
function producedElsewhere(entry: JxDocumentValue | undefined): boolean {
  if (!isJsonObject(entry)) {
    return false;
  }
  const { $prototype: prototype } = entry;
  if (prototype !== undefined) {
    return prototype !== "Function";
  }
  return "$src" in entry || "timing" in entry;
}

/** Whether a `$props` value is a scalar written as it stands: no binding, no object, no `null`. */
function isScalarProp(value: JxScopeValue | undefined): value is string | number | boolean {
  return (isString(value) && !isTemplateString(value)) || isNumber(value) || isBoolean(value);
}

/**
 * The platform's own properties that reflect a string to an attribute and read it back unchanged,
 * so a declared prop of that name holds after a write exactly what connection would have read.
 */
const VERBATIM_PROPS: ReadonlySet<string> = new Set(["id", "lang", "role", "slot", "title"]);

/** Whether a document value is drawn through a binding (a `$ref` or a `${…}` template). */
function isBoundProp(value: JxDocumentValue | undefined): boolean {
  return isRefValue(value) || isTemplateString(value);
}

/**
 * Whether a definition, or one it draws, reads something ONCE when it renders, so that a later
 * write to its state would not reach what it drew, or would undo it:
 *
 * - A tag expression. The tag is chosen at creation and is not tracked (§19.6).
 * - A `$`-local bound to a `$ref`, which is a copy of the value taken at render, on a node or in the
 *   `$props` of an element that is not a component; and an `id` bound to a `$ref`, written once.
 * - A `<slot>` a write can redraw (under a `$switch` case or a `$map` template, or with a `$switch`
 *   of its own) or re-address (a bound `name`), or whose fallback is bound text. Slots are
 *   distributed once, at connection (§8.5): the redrawn one is empty, and a replaced one is gone.
 * - A component it draws being handed a value by a route that component reads only when it connects
 *   ({@link handsOverOnce}): bound `textContent`, slot content that is bound text, a mapped array
 *   or a child with a bound `slot`, a bound `props.*` attribute, a bound attribute for a prop it
 *   declares and does not observe (§16.5), or a bound prop or property the platform owns.
 * - An `onMount` in its state (§16.4), which runs once with the values it had then.
 * - A definition that can draw itself, whose instances are admitted against the props each connected
 *   with (§16.9).
 * - Children or `innerHTML` drawn from a binding: what they draw is not in the document, so nothing
 *   can be said about it.
 * - A state entry produced asynchronously or kept outside the scope (a `$prototype` other than
 *   `Function`, a `$src`, a `timing`): a request, a class or a store answers for the value it was
 *   built with, and a stored value outlives the write.
 *
 * The answer belongs to the definition, not to the instance: it is asked of the document, so a
 * `$switch` case that is not drawn yet counts. It is not remembered, because it depends on every
 * definition this one draws and any of them can be redefined (embedding.md §7).
 *
 * @param {JxDocument} def
 * @param {Set<JxDocument>} [drawing] - The definitions this walk is inside.
 * @returns {boolean}
 */
function rendersOnce(def: JxDocument, drawing = new Set<JxDocument>()): boolean {
  const declared = def.state ?? {};
  if ("onMount" in declared || Object.values(declared).some((entry) => producedElsewhere(entry))) {
    return true;
  }
  drawing.add(def);
  const walk = (value: JxDocumentValue | undefined, isRoot: boolean, redrawn: boolean): boolean => {
    if (Array.isArray(value)) {
      return value.some((item) => walk(item, false, redrawn));
    }
    if (!isNonNullObject(value)) {
      return false;
    }
    /* SAFETY: a definition is a JSON document, so every member of every object in it is a document
       value; `Object.entries` on the union of node shapes says `any` only because it cannot name
       one type for them all. */
    const node = Object.fromEntries(Object.entries(value)) as Record<string, JxDocumentValue>;
    const { attributes, tagName } = node;
    if (tagName !== undefined && !isString(tagName)) {
      return true;
    }
    const attrs: Record<string, JxDocumentValue> = isJsonObject(attributes) ? attributes : {};
    if (
      tagName === "slot" &&
      (redrawn ||
        isBoundProp(attrs.name) ||
        isBoundProp(node.name) ||
        isBoundProp(node.textContent) ||
        node.$switch !== undefined)
    ) {
      return true;
    }
    if (isBoundProp(node.innerHTML) || (!isRoot && isBoundProp(node.children))) {
      return true;
    }
    const isInstance = !isRoot && isString(tagName) && tagName.includes("-");
    const inner = isInstance ? _elementDefs.get(tagName)?.doc : undefined;
    if (isInstance && handsOverOnce(node, attrs, inner)) {
      return true;
    }
    if (inner && (drawing.has(inner) || rendersOnce(inner, drawing))) {
      return true;
    }
    for (const [key, entry] of Object.entries(node)) {
      // State is the scope a write reaches, not something drawn; the root's `$props` are defaults.
      if (isRoot && (key === "state" || key === "$props")) {
        continue;
      }
      if (key === "$props") {
        if (!isInstance && isJsonObject(entry) && Object.values(entry).some((v) => isRefValue(v))) {
          return true;
        }
        continue;
      }
      if ((key === "id" || (key.startsWith("$") && !RESERVED_KEYS.has(key))) && isRefValue(entry)) {
        return true;
      }
      // `cases` is a map of nodes by name, not a node: a case may be called `state`.
      const drawn = key === "cases" && isJsonObject(entry) ? Object.values(entry) : entry;
      if (walk(drawn, false, redrawn || key === "cases" || key === "map")) {
        return true;
      }
    }
    return false;
  };
  const answer = walk(def, true, false);
  drawing.delete(def);
  return answer;
}

/**
 * Whether a component a definition draws is handed a bound value by a route it reads only when it
 * connects ({@link rendersOnce}).
 *
 * @param node - The node that draws the component.
 * @param attrs - That node's `attributes`.
 * @param inner - The component's definition, when it is registered.
 * @returns {boolean}
 */
function handsOverOnce(
  node: Record<string, JxDocumentValue>,
  attrs: Record<string, JxDocumentValue>,
  inner: JxDocument | undefined,
): boolean {
  if (isBoundProp(node.textContent)) {
    return true;
  }
  /* Its slot content is grouped, and tested for being empty, once (§8.5): text that fills in later,
     a row that arrives later and a child that changes group are not distributed again. */
  const kids = Array.isArray(node.children) ? node.children : [];
  if (
    kids.some(
      (kid) =>
        isBoundProp(kid) ||
        isMappedArray(kid) ||
        (isJsonObject(kid) &&
          (isBoundProp(kid.slot) ||
            (isJsonObject(kid.attributes) && isBoundProp(kid.attributes.slot)))),
    )
  ) {
    return true;
  }
  /* A platform-named prop is read back through the platform's accessor at connection, which
     coerces it; forwarded later, as a prop or as a property of the node, it reaches the
     component's state as given. */
  const coerced = (given: Record<string, JxDocumentValue>): boolean =>
    Object.entries(given).some(
      ([key, value]) => isBoundProp(value) && key in HTMLElement.prototype && key !== "textContent",
    );
  if (coerced(node) || (isJsonObject(node.$props) && coerced(node.$props))) {
    return true;
  }
  const observed = isString(node.tagName) ? (_observedAttributes.get(node.tagName) ?? []) : [];
  return Object.entries(attrs).some(([name, given]) => {
    if (!isBoundProp(given)) {
      return false;
    }
    if (name.startsWith("props.")) {
      return true;
    }
    const prop = name.replaceAll(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
    // An unregistered component is one whose declarations cannot be read: assume it reads this.
    return !inner || (prop in (inner.state ?? {}) && !observed.includes(name));
  });
}

/**
 * Whether anything the instance's own definition drew has an `onMount` that already ran: the
 * instance itself, or an instance inside it that no document node stands between.
 *
 * `onMount` runs once (§16.4), and what it read then it does not read again. An instance the
 * DOCUMENT placed inside this one (slot content, stamped `data-jx-path` by the canvas) takes
 * nothing from this instance's props, so it does not count.
 *
 * @param {HTMLElement} host
 * @param {JxScope} state
 * @returns {boolean}
 */
function mountedFromProps(host: HTMLElement, state: JxScope): boolean {
  if (isScopeHook(state.onMount) || !drawnByCurrent(host)) {
    return true;
  }
  for (const inner of host.querySelectorAll<HTMLElement>("*")) {
    const innerState = instanceStateOf(inner);
    if (!innerState || (!isScopeHook(innerState.onMount) && drawnByCurrent(inner))) {
      continue;
    }
    let owner: HTMLElement | null = inner;
    while (owner && owner !== host && owner.dataset.jxPath === undefined) {
      owner = owner.parentElement;
    }
    if (owner === host) {
      return true;
    }
  }
  return false;
}

/**
 * Write a changed `$props` block into an instance that is already connected, in place, and answer
 * whether that was done. `false` means the caller draws the instance again; nothing was written
 * unless the refusal is the last case below.
 *
 * This is the property-first interface (§16.2) used by an editor: the Studio canvas calls it when
 * an author edits a prop, so the instance's own bindings redraw what reads that prop and nothing
 * else in it is rebuilt. It refuses whenever writing the properties could leave the instance
 * showing something a fresh render of it would not:
 *
 * - The element is not a connected Jx instance, or its definition is gone.
 * - Nothing changed. A block equal to the last one is a request to draw again, not a write.
 * - A changed prop is not a scalar on both sides: a string, a number or a boolean, as it stands. A
 *   `$ref` or a template is an effect the render that created the instance owns, and it would go on
 *   writing the old source. An object, an array or `null` is refused because too much reads one
 *   once: a list redraws its rows in a later microtask, where a throw can no longer be answered
 *   for; a binding that reads a member survives `null` by keeping its last drawing; and the
 *   canvas's inline-edit marker is stamped by the type the value had at render.
 * - A changed prop overrides a state entry that is produced elsewhere (a store, a request).
 * - A changed prop is named for a property the platform owns (`hidden`, `tabIndex`, `textContent`):
 *   connection reads such a value back through the platform's accessor, which coerces it, reflects
 *   it to an attribute, or for `textContent` makes it slot content, and a later write does none of
 *   that the same way. The exception is a declared prop the platform reflects verbatim
 *   ({@link VERBATIM_PROPS}) being given a string, which reads back as written.
 * - A removed prop has no scalar declared default to go back to, or its attribute is observed and on
 *   the host, where a fresh instance would read it instead of the default.
 * - The definition, or one it draws, declares an `onMount`, or an instance already drawn has one: it
 *   ran once with the old values.
 * - The instance, or one its definition drew, connected with a definition since replaced
 *   (embedding.md §7), and still draws the old one.
 * - The definition, or one it draws, reads something once at render ({@link rendersOnce}): a tag
 *   expression, a copied `$ref`, a slot a write would redraw, a nested component handed a value it
 *   reads only at connection, or a definition that can draw itself.
 * - A write throws, a template binding throws on the new value and is survived (§6.1), or a write
 *   reaches a mapped list. The first is a render that throws, which the fresh render reports
 *   (§16.4); the second keeps what it last drew, which a fresh render never drew; the third redraws
 *   in a later microtask, where nothing can answer for what it draws. All three are known only
 *   after the fact: the props are written, and the caller's redraw discards them with the
 *   instance.
 *
 * What it does not put back is state the instance changed itself (a counter its own handler moved):
 * the write changes the props that changed and leaves the rest of the scope as it stands.
 *
 * @param {HTMLElement} el - The instance host.
 * @param {JxElement["$props"]} before - The `$props` block it was drawn with.
 * @param {JxElement["$props"]} after - The block it should show now.
 * @returns {boolean}
 */
export function updateInstanceProps(
  el: HTMLElement,
  before: JxElement["$props"],
  after: JxElement["$props"],
): boolean {
  const state = instanceStateOf(el);
  const registered = _elementDefs.get(el.localName)?.doc;
  if (!state || !registered) {
    return false;
  }
  // As the instance's scope was built: with the project's formulas under its own state (§13.4).
  const def = withProjectFormulas(registered);
  const defaults = declaredDefaults(def);
  const declared = def.state ?? {};
  const observed = _observedAttributes.get(el.localName) ?? [];
  const writes: (() => void)[] = [];
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    const was = before?.[key];
    const now = after?.[key];
    // A private key was refused when the instance was drawn and is refused now: nothing to write.
    if (isPrivateStateKey(key) || JSON.stringify(was) === JSON.stringify(now)) {
      continue;
    }
    if (
      (was !== undefined && !isScalarProp(was)) ||
      (now !== undefined && !isScalarProp(now)) ||
      producedElsewhere(declared[key]) ||
      // What the instance holds now decided things at render too (a marker, a handler).
      (key in declared && !isScalarProp(toRaw(state)[key])) ||
      // The element class's own fields, which a property write would overwrite.
      key === "_state" ||
      key === "_jxInitialized"
    ) {
      return false;
    }
    if (
      key in HTMLElement.prototype &&
      !(VERBATIM_PROPS.has(key) && key in declared && isString(now))
    ) {
      return false;
    }
    if (now !== undefined) {
      writes.push(() => {
        writeInstanceProp(el, key, now);
      });
      continue;
    }
    if (!(key in declared)) {
      // Nothing reads an undeclared prop: a fresh instance simply would not carry it.
      writes.push(() => {
        Reflect.deleteProperty(el, key);
      });
      continue;
    }
    const fallback = defaults.get(key);
    const attribute = key.replaceAll(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`);
    if (!isScalarProp(fallback) || (observed.includes(attribute) && el.hasAttribute(attribute))) {
      return false;
    }
    writes.push(() => {
      state[key] = fallback;
    });
  }
  if (writes.length === 0 || mountedFromProps(el, state) || rendersOnce(def)) {
    return false;
  }
  const thrown = _templateThrows;
  const redraws = _listRedraws;
  try {
    for (const write of writes) {
      write();
    }
  } catch {
    return false;
  }
  return _templateThrows === thrown && _listRedraws === redraws;
}

/**
 * Render a registered custom element with $props (property-first interface).
 *
 * @param {JxElement} def
 * @param {JxScope} state
 * @param {JxRenderOptions} [options]
 * @param {JxPath} [path]
 * @returns {HTMLElement}
 */
function renderCustomElementWithProps(
  def: JxElement,
  state: JxScope,
  options?: JxRenderOptions,
  path?: JxPath,
) {
  const el = document.createElement(resolveTagName(def.tagName, state));

  if (options?.onNodeCreated) {
    options.onNodeCreated(el, path ?? [], def, state);
  }

  // Set JS properties from $props (before connection)
  for (const [key, val] of Object.entries(def.$props ?? {})) {
    if (refusePrivateProp(key, "$props")) {
      continue;
    }
    const write = (resolved: JxScopeValue): void => {
      writeInstanceProp(el, key, resolved);
    };
    if (isRefValue(val)) {
      const refVal = val;
      write(resolveRef(refVal.$ref, state));
      // Reactive forwarding: re-set the property when the source changes
      effect(() => {
        write(resolveRef(refVal.$ref, state));
      });
    } else if (isTemplateString(val)) {
      bindTemplate(val, () => {
        write(evaluateTemplate(val, state));
      });
    } else {
      write(val);
    }
  }

  /* Apply host-level style and attributes from the usage site.
     Also REMEMBERED, because `connectedCallback` applies the definition's style through the same
     interning path and `applyStyleInto` releases the element's existing rules first — so without
     this the call site's declarations were written here and deleted a moment later, and a document
     could not style an element instance at all. See {@link callSiteStyles}. */
  if (def.style) {
    callSiteStyles.set(el, def.style);
  }
  applyStyle(el, def.style ?? {}, scopeMedia(state), state);
  applyAttributes(el, def.attributes ?? {}, state);
  /* And its ordinary properties and handlers — `id`, `hidden`, `className`, an `onselect` — exactly
     as an ordinary element gets them. A custom element used in a document is still an element in
     that document; only `$props` are the definition's to absorb. */
  applyProperties(el, def, state);

  // Append slotted children. A mapped array is not a node: its rows are rendered in place, ahead of
  // Their anchor, exactly as they are under an ordinary element — so a `$map` of menu rows inside a
  // `jx-menu` is a list of rows, not one `<div>` standing where the list should be.
  const children = Array.isArray(def.children) ? def.children : [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const childOpts = options && path ? { ...options, _path: [...path, "children", i] } : undefined;
    if (isMappedArray(child)) {
      renderMappedArrayInto(el, child, state, childOpts);
    } else if (isString(child) && isSingleExpression(child)) {
      renderTemplatedChild(el, child, state, childOpts);
    } else {
      el.append(renderNode(child, state, childOpts));
    }
  }

  return el;
}

/**
 * Whether a node is an element, by its `nodeType` (which, unlike `instanceof`, holds across
 * realms).
 *
 * @param {Node} node
 * @returns {node is Element}
 */
function isElementNode(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

/**
 * Whether a node is a text node, by its `nodeType`.
 *
 * @param {Node} node
 * @returns {node is Text}
 */
function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

/**
 * Whether a node is a comment, by its `nodeType`.
 *
 * @param {Node} node
 * @returns {node is Comment}
 */
function isCommentNode(node: Node): node is Comment {
  return node.nodeType === Node.COMMENT_NODE;
}

// ─── Slot distribution (spec.md §8.5) ─────────────────────────────────────────

/**
 * Text that is only HTML whitespace (space, tab, line feed, form feed, carriage return): never slot
 * content. A non-breaking space is not in the set, and `+` keeps an empty text node out of it, so
 * the text node a binding is about to write stays with its group.
 */
export const SLOT_WHITESPACE = /^[\t\n\f\r ]+$/u;

/** The word that opens a prerendered slot group's comment bracket: `<!--jx-slot n name-->`. */
export const SLOT_MARK = "jx-slot";

/** The attribute a prerendered instance carries when its slot groups are bracketed by `n`. */
export const SLOT_ATTR = "data-jx-slots";

/**
 * The `Symbol.for` key of the shared group record: node → the slot group it belongs to.
 *
 * Shared through `globalThis` because each compiled component module carries its own copy of the
 * distribution helper, and a record one of them (or this runtime) writes has to be read by
 * whichever element captures the node next.
 */
export const SLOT_RECORD_KEY = "jx.slot.group";

/** The record itself; read before a node's own `slot` attribute, and deleted once read. */
const slotRecord: WeakMap<Node, string> = (() => {
  const key = Symbol.for(SLOT_RECORD_KEY);
  /* SAFETY: the one value ever stored under this registered symbol is this WeakMap, written by
     this runtime or by a compiled module's inlined helper (`slotHelperSource` in the compiler). */
  const holder = globalThis as typeof globalThis & Record<symbol, WeakMap<Node, string>>;
  holder[key] ??= new WeakMap<Node, string>();
  return holder[key];
})();

/**
 * The children an element distributes into its slots, taken before its template renders.
 *
 * A prerendered instance is the exception, and the reason this is a function. Its children are the
 * prerendered markup, and re-rendering would capture the component's own template as slot content.
 * The prerender therefore stamps it `data-jx-slots="n"` and brackets every group it placed with
 * `<!--jx-slot n name-->` … `<!--/jx-slot n-->`; this returns exactly the nodes inside this host's
 * brackets, recording each one's group name, and removes the attribute. The id is needed because a
 * forwarded group sits inside a nested instance's own brackets, and the name because a nested
 * instance that upgrades first must not regroup the enclosing instance's nodes.
 *
 * @param {Element} host
 * @returns {ChildNode[]}
 */
export function captureSlotted(host: Element): ChildNode[] {
  const id = host.getAttribute(SLOT_ATTR);
  if (id === null) {
    return [...host.childNodes];
  }
  host.removeAttribute(SLOT_ATTR);
  const opener = `${SLOT_MARK} ${id} `;
  const closer = `/${SLOT_MARK} ${id}`;
  const openers: Comment[] = [];
  const walker = host.ownerDocument.createTreeWalker(host, NodeFilter.SHOW_COMMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (isCommentNode(n) && n.data.startsWith(opener)) {
      openers.push(n);
    }
  }
  const captured: ChildNode[] = [];
  for (const open of openers) {
    const name = decodeURIComponent(open.data.slice(opener.length));
    for (let n = open.nextSibling; n; n = n.nextSibling) {
      if (isCommentNode(n) && n.data === closer) {
        break;
      }
      slotRecord.set(n, name);
      captured.push(n);
    }
  }
  return captured;
}

/**
 * Whether a group holds content: an element, or a text node that is not empty. A comment (a lit
 * part marker, a repeater's anchor) travels with its group but does not stop the fallback showing.
 *
 * @param {readonly ChildNode[]} group
 * @returns {boolean}
 */
function slotGroupHasContent(group: readonly ChildNode[]): boolean {
  return group.some((n) => isElementNode(n) || (isTextNode(n) && n.data !== ""));
}

/**
 * Light-DOM slot distribution: replace each `<slot>` under `host` with the captured children of its
 * group, or with its own fallback children when that group has no content (spec.md §8.5).
 *
 * - **Group.** A node's group is its record when it has one, else an element's `slot` attribute, else
 *   the unnamed group (`""`). Whitespace-only text is discarded: compiled hosts are parsed HTML
 *   full of formatting whitespace, and whitespace placed in a part makes its `:empty` false.
 * - **Place.** Slots are taken in tree order and the FIRST of a name takes its group; a later one of
 *   the same name shows its fallback. That is the DOM's "find a slot", so the answer does not
 *   change when a component moves to a shadow root. A slot inside a fallback that was not shown
 *   still takes its name, which keeps the static prerender's answer the same as this one.
 * - **Forward.** A slot written directly inside ANOTHER custom element's children is that element's
 *   child. What it places there is recorded with the slot's own group (its record, else its `slot`
 *   attribute), so the nested element distributes it by that name whether it captures before or
 *   after this runs.
 *
 * No early return when nothing was slotted: a slot leaves no node either way, and a surviving slot
 * made `[part="label"]:empty` false for a control with no label. A slot is replaced, not filled:
 * the selector tree is what a definition's `& > x` rules match, and a slot left as a wrapper turned
 * every slotted child into a grandchild (§16.6).
 *
 * @param {ParentNode} host
 * @param {readonly ChildNode[]} captured
 */
export function distributeSlots(host: ParentNode, captured: readonly ChildNode[]): void {
  const slots = [...host.querySelectorAll("slot")];
  if (slots.length === 0) {
    return;
  }
  const groups = new Map<string, ChildNode[]>();
  for (const n of captured) {
    if (isTextNode(n) && SLOT_WHITESPACE.test(n.data)) {
      continue;
    }
    const recorded = slotRecord.get(n);
    slotRecord.delete(n);
    const name = recorded ?? (isElementNode(n) ? (n.getAttribute("slot") ?? "") : "");
    let group = groups.get(name);
    if (!group) {
      group = [];
      groups.set(name, group);
    }
    group.push(n);
  }
  const taken = new Set<string>();
  for (const slot of slots) {
    const name = slot.getAttribute("name") ?? "";
    let group: ChildNode[] = [];
    if (!taken.has(name)) {
      taken.add(name);
      group = groups.get(name) ?? [];
    }
    const placed = slotGroupHasContent(group) ? group : [...group, ...slot.childNodes];
    const parent = slot.parentElement;
    if (parent && parent !== host && parent.localName.includes("-")) {
      const forwarded = slotRecord.get(slot) ?? slot.getAttribute("slot") ?? "";
      for (const n of placed) {
        slotRecord.set(n, forwarded);
      }
    }
    slot.replaceWith(...placed);
  }
}
