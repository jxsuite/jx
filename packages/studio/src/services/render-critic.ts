/**
 * Render-critic.js — Detached render probe for the AI agent loop
 *
 * After a mutation passes schema validation, this module attempts a lightweight headless render
 * (buildScope → renderNode into a throwaway div) and reports render-time errors back through the
 * same { ok, error } shape that applyAndValidate consumes. The model can then self-correct within
 * the round budget instead of the user discovering a blank canvas.
 *
 * V1 scope: catches render throws only (missing $ref, malformed Function body, bad template
 * expressions). Does NOT detect empty/zero-node output or deep-render custom element internals
 * (connectedCallback doesn't fire on detached nodes).
 *
 * A page is drawn as the build would draw it, so a page that builds is not refused for what only
 * the build supplies: its data is awaited, a dynamic route is drawn with its first entry, and
 * `$page`, `$site` and project state are injected. Live data is the exception. A `timing: "server"`
 * function is never called here and a `Request` is never sent (specs/ai.md §3.1), so both read as
 * placeholders.
 *
 * @license MIT
 * @docs studio/ai/document-assistant
 */

import {
  buildScope,
  lookupsSettled,
  renderNode,
  runScoped,
  setResolveToken,
  setSkipServerFunctions,
  setTemplateErrorHandler,
} from "@jxsuite/runtime";
import { isJsonObject, isServerFnDef, isString } from "@jxsuite/schema/guards";
import { injectContext } from "@jxsuite/site/context";
import { documentUrlPattern } from "@jxsuite/site/routes";
import type { JxScope } from "@jxsuite/runtime/types";
import type { JxDocument, JxMutableNode, JxStateDefinition } from "@jxsuite/schema/types";
import { documentBase, hostResolveToken } from "../canvas/canvas-origin";
import { isPagePath, pageContextFor } from "../canvas/canvas-page-context";
import {
  dynamicRouteParams,
  loadParamValues,
  pagePathsDef,
  paramBoundStateKeys,
  substitutePreviewParams,
} from "../page-params";
import { projectState } from "../store";
import type { RenderSource } from "./ai-write-report";

/**
 * Translate a render-time error into an actionable message the model can fix.
 *
 * @param {unknown} cause What the render threw — an Error in practice; anything else is printed
 *   as-is.
 * @returns {string}
 */
function translateRenderError(cause: unknown): string {
  const msg = (cause instanceof Error && cause.message) || String(cause);

  if (msg.includes("is not defined") || msg.includes("Cannot read properties of")) {
    return `Render error: ${msg}\n  → Fix: A $ref or template expression references a name that doesn't exist in state. Check that all $ref paths and \${...} expressions match entries in the document's "state" object.`;
  }

  if (msg.includes("is not a function")) {
    return `Render error: ${msg}\n  → Fix: An event handler or computed value references something that isn't a function. Check $prototype: "Function" entries have a valid "body" string, and $ref event handlers point to function-typed state entries.`;
  }

  if (msg.includes("is not a constructor")) {
    return `Render error: ${msg}\n  → Fix: A $prototype entry references a class or constructor that couldn't be resolved. Check the import path and $export name.`;
  }

  return `Render error: ${msg}\n  → Fix: The document is schema-valid but fails to render. Review the last change for typos in $ref paths, template expressions, or event handler definitions.`;
}

/** How long a check waits for a document's data before it stops judging its templates. */
const LOOKUP_WAIT_MS = 5000;

/**
 * Wait for the lookups in flight, for at most `waitMs`.
 *
 * @param {number} waitMs
 * @returns {Promise<boolean>} Whether they all settled in time
 */
async function lookupsAnswered(waitMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<boolean>((answer) => {
    timer = setTimeout(answer, waitMs, false);
  });
  const answered = await Promise.race([lookupsSettled().then(() => true), expired]);
  clearTimeout(timer);
  return answered;
}

/**
 * What live data reads as during a check: anything may be read from it or called on it, and it
 * prints as nothing, so a template over live data evaluates and every other template on the page is
 * still judged.
 *
 * `then` and the reactivity library's `__v_` flags read as absent: a truthy `then` would make it a
 * thenable that never settles, and a truthy `__v_raw` sends `toRaw` round in a circle.
 *
 * @returns {() => void}
 */
function liveDataPlaceholder(): () => void {
  const placeholder: () => void = new Proxy(() => placeholder, {
    get(_target, key) {
      if (key === Symbol.toPrimitive) {
        return () => "";
      }
      if (key === Symbol.iterator) {
        return Array.prototype[Symbol.iterator].bind([]);
      }
      return isString(key) && key !== "then" && !key.startsWith("__v_") ? placeholder : undefined;
    },
  });
  return placeholder;
}

/** Whether an entry's value is live data, which only a person's own action may fetch. */
function isLiveData(entry: JxStateDefinition): boolean {
  return (
    isServerFnDef(entry) ||
    (isJsonObject(entry) && entry.$prototype === "Request" && !isString(entry.$src))
  );
}

/**
 * The class entry a template reads that came back with no data, if it reads one. The template is
 * what connects them: an unrelated broken template beside a failed lookup is still its own
 * mistake.
 *
 * @param {JxDocument} built
 * @param {JxScope} state
 * @param {string} template
 * @returns {{ key: string; from: string } | null}
 */
function emptyLookupRead(
  built: JxDocument,
  state: JxScope,
  template: string,
): { key: string; from: string } | null {
  const reads = new Set(template.match(/state\.[\w$]+/g));
  for (const [key, entry] of Object.entries(built.state ?? {})) {
    if (
      reads.has(`state.${key}`) &&
      isJsonObject(entry) &&
      isString(entry.$prototype) &&
      entry.$prototype !== "Function" &&
      (state[key] ?? null) === null
    ) {
      return { from: isString(entry.$src) ? entry.$src : entry.$prototype, key };
    }
  }
  return null;
}

/**
 * The first entry of each route parameter a document declares, as the preview picker opens with.
 *
 * @param {JxDocument} doc
 * @param {RenderSource} source
 * @returns {Promise<Record<string, string>>}
 */
async function sampleRouteParams(
  doc: JxMutableNode,
  { documentPath, frontmatter }: RenderSource,
): Promise<Record<string, string>> {
  const paths = pagePathsDef({ document: doc, frontmatter: frontmatter ?? null });
  const params: Record<string, string> = {};
  for (const [name, values] of Object.entries(await loadParamValues(documentPath, paths))) {
    const [first] = values;
    if (first !== undefined) {
      params[name] = first;
    }
  }
  return params;
}

/**
 * A document as the build would hand it to the renderer. A rebuild: the document may be the live
 * tree of an open tab, which must not gain keys it would then save.
 *
 * @param {JxDocument} doc
 * @param {RenderSource} source
 * @returns {Promise<{ built: JxDocument; sampled: boolean }>} `sampled` is false when a route
 *   parameter has no entry to stand for it, so the data its templates read cannot be looked up
 */
async function asBuilt(
  doc: JxDocument,
  source: RenderSource,
): Promise<{ built: JxDocument; sampled: boolean }> {
  const { documentPath } = source;
  /* SAFETY: a candidate is a JSON tree, and everything below rebuilds it rather than writing to it,
     so the mutable type is only what these shared helpers are declared over. */
  const candidate = doc as JxMutableNode;
  const params = await sampleRouteParams(candidate, source);
  let built = substitutePreviewParams(candidate, params, documentPath);

  const projectConfig = projectState?.projectConfig;
  const drawnAsPage =
    documentPath && (isPagePath(documentPath) || documentPath.startsWith("layouts/"));
  if (drawnAsPage && projectConfig && projectState?.isSiteProject) {
    built = { ...built, state: { ...built.state } };
    if (built.imports) {
      built.imports = { ...built.imports };
    }
    /* SAFETY: as on the canvas: `injectContext` writes `state`, `$media` and `imports`, all of which
       the copy above owns. */
    injectContext(built as JxDocument, projectConfig, {
      urlPattern: documentUrlPattern(documentPath),
    });
    const context = await pageContextFor(
      { documentPath, isEntry: false, lang: doc.$lang, params, title: doc.title },
      projectConfig,
    );
    if (context) {
      built = { ...built, state: { ...built.state, ...context } };
    }
  }

  const sampled =
    dynamicRouteParams(documentPath).every((name) => name in params) &&
    paramBoundStateKeys(built.state ?? null).length === 0;
  /* SAFETY: the same document, rebuilt member for member; its schema has not changed. */
  return { built: built as JxDocument, sampled };
}

/**
 * The URL a document's relative references resolve from, when one can be formed. A check is not
 * failed for lacking one: a document with no relative reference does not need it.
 *
 * @param {RenderSource} source
 * @returns {string | undefined}
 */
function baseOf({ documentPath }: RenderSource): string | undefined {
  const base = documentBase(projectState?.projectRoot);
  return documentPath && URL.canParse(base) ? new URL(documentPath, base).href : undefined;
}

/**
 * Attempt a detached render of a Jx document. Returns { ok: true } on success or { ok: false,
 * error: string } with an actionable message on failure.
 *
 * @param {import("@jxsuite/schema/types").JxDocument} doc
 * @param {RenderSource} [source] - Where the document lives, when it lives anywhere yet
 * @param {number} [waitMs] - How long to wait for the document's data
 * @returns {Promise<{ ok: true } | { ok: false; error: string }>}
 */
export async function renderCheck(
  doc: JxDocument,
  source: RenderSource = {},
  waitMs = LOOKUP_WAIT_MS,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let stopRender: (() => void) | null = null;
  try {
    setSkipServerFunctions(true);
    // The desktop dev proxy refuses a class resolve without the token the canvas carries.
    setResolveToken(hostResolveToken());

    const { built, sampled } = await asBuilt(doc, source);
    const base = baseOf(source) ?? location.href;
    /* This call's own context rather than `setSkipAutoRequests`, which is realm-wide: a Library
       preview draws in this same realm, and would silently stop fetching. */
    const state = await buildScope(built, {}, base, {
      base,
      media: null,
      root: null,
      skipAutoRequests: true,
    });
    for (const [key, entry] of Object.entries(built.state ?? {})) {
      if (isLiveData(entry)) {
        state[key] = liveDataPlaceholder();
      }
    }

    /* The build resolves a page's data before its templates run, and here the data is a lookup that
       has only just started. Rendering now would read `null` and refuse a page that builds. */
    const answered = await lookupsAnswered(waitMs);

    /* A binding that throws no longer unwinds the render (spec.md §6.1) — it renders empty and
       waits for its data — so the throw is collected here instead. The first one is the verdict: a
       page whose template can never evaluate is exactly what this check exists to refuse. Only for
       the synchronous render: anything else this realm draws during the wait is not this document. */
    const bindingErrors: { error: Error; template: string }[] = [];
    setTemplateErrorHandler((error, template) => {
      bindingErrors.push({ error, template });
    });

    const container = document.createElement("div");
    const { stop } = runScoped(() => {
      container.append(renderNode(built, state));
    });
    stopRender = stop;

    /* With a lookup still out, or no entry to look up, a throw may be nothing but the data being
       absent, and refusing would block a valid write. A live binding recovers if that is what it was. */
    const [first] = bindingErrors;
    if (!first || !answered || !sampled) {
      return { ok: true };
    }
    const empty = emptyLookupRead(built, state, first.template);
    return {
      error: empty
        ? `Render error: ${first.error.message}\n  → Fix: state.${empty.key} has no data: its lookup through ${empty.from} failed or came back empty, so this template has nothing to read. Check that $src and the entry's config. If the data can legitimately be empty, guard the read, for example state.${empty.key}?.name.`
        : translateRenderError(first.error),
      ok: false,
    };
  } catch (error) {
    return { ok: false, error: translateRenderError(error) };
  } finally {
    setTemplateErrorHandler(null);
    // Dispose all effects created synchronously by renderNode via the RUNTIME's runScoped — scope
    // Collection is per @vue/reactivity module instance, so a studio effectScope here would collect
    // Nothing. Effects from the async buildScope (prototype/computed setup) still escape the scope;
    // They're GC-eligible once the throwaway state/container are unreferenced. Bounded, acceptable.
    stopRender?.();
  }
}
