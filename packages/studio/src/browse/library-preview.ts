/// <reference lib="dom" />
/**
 * Library previews — a live document render is expensive, so it is capped, lazy, and evictable.
 *
 * Four limits, each answering a different way the old Manage view fell over on a large project:
 *
 * 1. **Lazy.** A preview is built when its card INTERSECTS the viewport, not when the card is created.
 *    Scrolling a 300-item Library therefore builds a preview per card actually looked at.
 * 2. **Capped.** {@link createPreviewCache} is an LRU with a hard limit. The predecessor's
 *    `_previewCache` was an unbounded `Map<string, HTMLElement>` of live runtime subtrees, so a
 *    long browse leaked every document it had ever shown until the tab closed.
 * 3. **Cancellable.** A preview whose card left the window before its read resolved is dropped on
 *    arrival rather than appended to a detached node.
 * 4. **Released.** The visibility gate keeps a set too, and it is the same leak one level down: a card
 *    observed and then scrolled past before it ever intersected was retained for the life of the
 *    pane. {@link PreviewObserver.releaseDetached} is how the window gives those back.
 *
 * The renders themselves go through `platform.readFile`, which the PAL counts, so `probe.idle()`
 * already knows a preview is in flight without this module declaring an idle source of its own.
 */

import {
  buildScope,
  renderNode,
  runScoped,
  setCanvasAssetResolver,
  setNpmModuleResolver,
  setResolveToken,
  setSkipServerFunctions,
  setTemplateErrorHandler,
} from "@jxsuite/runtime";
import { isFunction, isNonNullObject } from "@jxsuite/schema/guards";
import { assetContextFor, hostAssetDeclarations, resolveAssetRef } from "../canvas/asset-refs";
import { canvasBaseOrigin, documentBase, hostResolveToken } from "../canvas/canvas-origin";
import { npmModuleUrl } from "../canvas/npm-modules";
import { projectState } from "../store";
import { assetVersionsSnapshot } from "../files/asset-versions";
import { componentRegistry } from "../files/components";
import { getPlatform } from "../platform";
import { loadFormats, formatForPath } from "../format/format-host";
import { parseSourceForPath } from "../files/file-ops";
import { renderComponentPreview } from "../panels/component-preview";
import { componentExampleProps } from "./component-examples";
import { loadProjectPreviewSheets } from "./preview-style";
import type { ComponentEntry } from "../files/components";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

/**
 * How many rendered previews stay alive at once.
 *
 * **The cap must exceed one window, or it thrashes against itself.** The first value tried here was
 * 48, and the 300-page measurement caught it immediately: a 1180×700 pane of cards renders 55 items
 * (11 rows of 5, overscan included), so the cache evicted documents that were still on screen and
 * re-rendered them on the next repaint — 560 reads for 300 documents. 150 clears a nine-column,
 * twelve-row window on a wide display with room to spare, so eviction is only ever reached by
 * SCROLLING, which is what an LRU is for.
 *
 * It remains a fixed cost rather than a function of project size, which is the whole point: the
 * predecessor's cache was unbounded, so a long browse retained every document it had ever shown.
 */
export const PREVIEW_CACHE_LIMIT = 150;

export interface PreviewCache {
  /** Fetch and mark as most-recently-used. */
  get: (key: string) => HTMLElement | undefined;
  /** Insert, evicting the least-recently-used entry when over the limit. */
  set: (key: string, value: HTMLElement) => void;
  has: (key: string) => boolean;
  /** Live entry count — what the perf test asserts stays bounded. */
  size: () => number;
  /** Keys, least-recently-used first. */
  keys: () => string[];
  clear: () => void;
}

/**
 * A least-recently-used cache over rendered previews.
 *
 * `Map` iterates in insertion order, so re-inserting on read is the whole LRU: the oldest key is
 * always the first one the iterator yields. Evicted subtrees are removed from the DOM as they go —
 * an evicted preview that stayed attached would keep its runtime alive and defeat the cap.
 */
export function createPreviewCache(limit: number = PREVIEW_CACHE_LIMIT): PreviewCache {
  const entries = new Map<string, HTMLElement>();

  function evict() {
    // Insertion order is LRU order, and deleting the entry being visited is safe mid-iteration.
    for (const [oldest, stale] of entries) {
      if (entries.size <= limit) {
        break;
      }
      entries.delete(oldest);
      stale.remove();
    }
  }

  return {
    clear() {
      for (const element of entries.values()) {
        element.remove();
      }
      entries.clear();
    },
    get(key) {
      const value = entries.get(key);
      if (value !== undefined) {
        entries.delete(key);
        entries.set(key, value);
      }
      return value;
    },
    has: (key) => entries.has(key),
    keys: () => [...entries.keys()],
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      evict();
    },
    size: () => entries.size,
  };
}

// ─── Rendering one preview ───────────────────────────────────────────────────

/**
 * The URL a previewed document's relative refs resolve against: the file's own URL under the
 * project, as the canvas spells it. A shell with an opaque origin (a custom-scheme shell such as
 * `views://`) has no such URL to build, and keeps the shell's own address.
 */
function previewBase(filePath: string): string {
  const base = documentBase(projectState?.projectRoot);
  return URL.canParse(base) ? new URL(filePath, base).href : location.href;
}

/**
 * Render a page/layout/content document to a detached element, or null when it cannot be rendered.
 *
 * Returning null rather than throwing is deliberate: a document that fails to parse is a real state
 * of the project, and the card shows a document glyph for it. The Problems list is for failures the
 * author must ACT on; an in-progress file that does not parse yet is not one.
 */
export async function renderDocPreview(filePath: string): Promise<HTMLElement | null> {
  try {
    const content = await getPlatform().readFile(filePath);
    setSkipServerFunctions(true);
    const context = assetContextFor(filePath, hostAssetDeclarations());
    await loadFormats();
    let document_: JxDocument;
    if (formatForPath(filePath)) {
      const parsed = await parseSourceForPath(filePath, content);
      /* SAFETY: a format class's parser returns its file as a Jx element tree (the format contract),
         and the split hands that same tree back as `document`; a tree renderNode cannot draw throws
         into the catch below, which is "no preview". */
      document_ = parsed.document as JxDocument;
    } else {
      /* SAFETY: a `.json` file in the Library is a project document by the project layout; malformed
         JSON or a shape renderNode cannot draw throws into the catch below, which is "no preview". */
      document_ = JSON.parse(content) as JxDocument;
    }
    return await renderDocument(document_, filePath, context);
  } catch {
    return null;
  }
}

/**
 * Render a document as the file `filePath` holds it would be drawn: its refs resolved from that
 * file's URL, its media through the canvas's resolver. Throws what the render throws.
 */
async function renderDocument(
  document_: JxDocument,
  filePath: string,
  context: ReturnType<typeof assetContextFor>,
): Promise<HTMLElement | null> {
  setSkipServerFunctions(true);
  /* The document's own URL, as the canvas spells it, and the canvas's dev-proxy token. With the
     shell's `location.href` as base, a page's `"$src": "../../scripts/x.class.json"` resolved
     against `/__studio__/`, and without the token the proxy refused it before reading it. */
  setResolveToken(hostResolveToken());
  const scope = await buildScope(document_, {}, previewBase(filePath));
  /* This render lands in the PARENT document, so an `<img src="/hero.jpg">` inside it resolves
     against `index.html` — which is the shell, not the site. Same hook the canvas installs, same
     context, restored afterwards because the next preview is a different document and a stale
     `documentDir` would resolve its relative refs against the wrong entry. The version map is
     read as the render starts, after the reads above: the Library is the many-images screen,
     and a versioned src is what lets its cards repaint from the browser cache. */
  const assets = context && { ...context, versions: assetVersionsSnapshot() };
  setCanvasAssetResolver((value) => resolveAssetRef(value, assets));
  try {
    const element = renderNode(document_, scope);
    return element instanceof HTMLElement ? element : null;
  } finally {
    setCanvasAssetResolver(null);
  }
}

/**
 * A project component's preview: an instance given its declared sample props
 * (`component-examples.ts`), or none when the definition does not render with them.
 */
async function projectComponentPreview(
  component: ComponentEntry,
  path: string,
): Promise<HTMLElement | null> {
  const definition = await readDefinition(path);
  if (!definition) {
    return null;
  }
  const props = componentExampleProps(definition);
  return (await rendersWith(definition, path, props))
    ? renderComponentPreview(component, props)
    : null;
}

/** A project component's definition, or null when its file is not one. */
export async function readDefinition(path: string): Promise<JxDocument | null> {
  try {
    const parsed: unknown = JSON.parse(await getPlatform().readFile(path));
    /* SAFETY: a project component's `.json` is its definition, a Jx element document; a shape
       renderNode cannot draw throws into `rendersWith`'s catch, which is "does not render". */
    return isNonNullObject(parsed) && !Array.isArray(parsed) ? (parsed as JxDocument) : null;
  } catch {
    return null;
  }
}

/**
 * Whether `definition` renders given `props` (its sample props, `component-examples.ts`), tried on
 * a detached copy before a live instance is made.
 *
 * A definition may not render with the values it is given: the museum starter's
 * `<mu-exhibition-card>` formats a `date` that defaults to `""`, and `Intl/formatDate` of an empty
 * date is a `RangeError`, exactly as `new Intl.DateTimeFormat().format(new Date(""))` is (`spec.md`
 * §19.4c). An instance renders in its own async `connectedCallback`, where the throw is reported on
 * the console once per card per paint. The same render, made here synchronously into an element
 * nobody sees, can be caught, and a definition that cannot render gets no instance preview.
 */
export async function rendersWith(
  definition: JxDocument,
  path: string,
  props: ReadonlyMap<string, JsonValue>,
): Promise<boolean> {
  let stopRender: (() => void) | null = null;
  try {
    setSkipServerFunctions(true);
    setResolveToken(hostResolveToken());
    const scope = await buildScope(definition, {}, previewBase(path));
    for (const [name, value] of props) {
      scope[name] = value;
    }
    /* A template binding that throws no longer unwinds the render (spec.md §6.1): it draws nothing
       and waits for its data. The trial still has to see it, so the throw is collected for the one
       synchronous render, as the render critic collects it. */
    let bindingThrew = false;
    setTemplateErrorHandler(() => {
      bindingThrew = true;
    });
    // Its own tag would make an instance, and the instance's render is the one that cannot be caught.
    const { stop } = runScoped(() => renderNode({ ...definition, tagName: "div" }, scope));
    stopRender = stop;
    return !bindingThrew;
  } catch {
    return false;
  } finally {
    setTemplateErrorHandler(null);
    stopRender?.();
  }
}

/** A component whose definition is a JSON file in the project, which is what can be tried first. */
function isProjectDefinition(component: ComponentEntry): boolean {
  return component.source !== "npm" && (component.path?.endsWith(".json") ?? false);
}

/**
 * The preview for one file — a registered component's own preview when there is one, the document
 * render otherwise. Cached; a cache hit does no work at all.
 */
export async function previewFor(
  path: string,
  cache: PreviewCache,
): Promise<HTMLElement | undefined> {
  const cached = cache.get(path);
  if (cached) {
    return cached;
  }
  let rendered: HTMLElement | null | undefined;
  try {
    /* A component's `npm:` sidecar, from where the project's packages are served: a preview is a
       live render in this window, and the runtime would otherwise hand `import()` the `npm:` URL. */
    setNpmModuleResolver((specifier) => npmModuleUrl(specifier, `${canvasBaseOrigin()}/`));
    // The project's stylesheet, ready for the box this preview is shown in (`preview-style.ts`).
    await loadProjectPreviewSheets();
    const component = componentRegistry.find((c: ComponentEntry) => c.path === path);
    if (component && isProjectDefinition(component)) {
      rendered = await projectComponentPreview(component, path);
    } else {
      rendered = component ? await renderComponentPreview(component) : await renderDocPreview(path);
    }
  } catch {
    return undefined;
  }
  if (!rendered) {
    return undefined;
  }
  cache.set(path, rendered);
  return rendered;
}

// ─── Visibility ──────────────────────────────────────────────────────────────

export interface PreviewObserver {
  /** Start watching a card. Safe to call repeatedly for the same element. */
  observe: (element: Element) => void;
  /**
   * Stop watching every card the document no longer contains; answers how many went.
   *
   * The caller is whoever re-renders the window: once lit has committed, a card outside the new
   * window is detached, and an observation of a detached node can never fire again. It is pure cost
   * — the browser still walks it on every scroll frame — and it is unreachable garbage that pins
   * the card's whole subtree.
   *
   * **The one release path, deliberately.** There is no per-element `unobserve` here: the previous
   * shape had one, nothing ever called it, and "a card left the window" is a fact the WINDOW knows
   * and an individual card never does. One caller, at one moment, over the whole set.
   */
  releaseDetached: () => number;
  destroy: () => void;
}

/**
 * Watch cards for viewport entry and report each one ONCE.
 *
 * **Every observation is owned here, not by the caller.** The first version of this module let the
 * intersect callback be the only release path, which is only ever taken by a card that actually
 * came into view: scroll fast enough that the callback never runs and nothing is ever released.
 * Four sweeps of the same 300-page list retained 805 → 1310 → 1815 → 2320 cards with zero
 * `unobserve` calls, every one of them a node no longer in the document — the very leak the LRU
 * above was written to end, one level down. So the `watched` set is kept here, and
 * {@link PreviewObserver.releaseDetached} sweeps it; `tests/library-observer-leak.test.ts` is the
 * measurement, and it fails on the shape this replaced.
 *
 * Where `IntersectionObserver` is unavailable — happy-dom, and any host that has not implemented it
 * — every observed element is reported immediately. That is the honest degradation: the window
 * already bounds how many cards exist, so "all of them" is at most one screen plus the overscan,
 * and a Library that silently showed no previews would look broken rather than slow. Nothing is
 * retained on that path, so there is nothing for the sweep to find.
 */
export function createPreviewObserver(onVisible: (element: Element) => void): PreviewObserver {
  if (!isFunction(globalThis.IntersectionObserver)) {
    return {
      destroy() {
        /* Nothing to disconnect. */
      },
      observe: (element) => onVisible(element),
      releaseDetached: () => 0,
    };
  }
  const watched = new Set<Element>();
  const observer = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (record.isIntersecting) {
          watched.delete(record.target);
          observer.unobserve(record.target);
          onVisible(record.target);
        }
      }
    },
    // One card-height of lead-in, so a preview is usually ready by the time it is looked at.
    { rootMargin: "200px" },
  );
  return {
    destroy() {
      observer.disconnect();
      watched.clear();
    },
    observe(element) {
      // Re-observing is a no-op in the browser, but the repaint that follows every scroll frame
      // Hands the same slot back, and a call per card per frame is work nobody needs.
      if (watched.has(element)) {
        return;
      }
      watched.add(element);
      observer.observe(element);
    },
    releaseDetached() {
      let released = 0;
      // Deleting the current key during a `Set` iteration is defined; later keys are still visited.
      for (const element of watched) {
        if (!element.isConnected) {
          watched.delete(element);
          observer.unobserve(element);
          released += 1;
        }
      }
      return released;
    },
  };
}
