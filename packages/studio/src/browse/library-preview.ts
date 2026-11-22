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
 * The renders themselves happen in the preview realm (`preview-realm/`, `project-state.md` §11.2):
 * this module reads a document from the content store, hands it to the realm by `DocId`, and keeps
 * the snapshot the realm answers. Nothing a project defines is ever registered in this window. The
 * read goes through `platform.readFile`, which the PAL counts, and the realm's answer is counted by
 * the realm's own idle source, so `probe.idle()` knows a preview is in flight.
 */

import { isFunction } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import { assetContextFor, hostAssetDeclarations } from "../canvas/asset-refs";
import { projectState } from "../store";
import { assetVersionsSnapshot, localRevisionsSnapshot } from "../files/asset-versions";
import { componentRegistry } from "../files/components";
import { loadFormats, formatForPath } from "../format/format-host";
import { parseSourceForPath } from "../files/file-ops";
import {
  onPreviewRealmReplaced,
  previewComponentsChanged,
  previewDefinitionsChanged,
  previewRealm,
  previewRealmGeneration,
  storedText,
} from "../preview-realm/client";
import {
  componentPreview,
  realmTarget,
  reportPreviewFailure,
  snapshotOf,
} from "../preview-realm/ask";
import type { PreviewSnapshot } from "../preview-realm/host";
import { loadProjectPreviewSheets } from "./preview-style";
import { unmountPreview } from "./preview-root";
import type { ComponentEntry } from "../files/components";
import type { JxDocument } from "@jxsuite/schema/types";

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
  get: (key: string) => PreviewSnapshot | undefined;
  /** Insert, evicting the least-recently-used entry when over the limit. */
  set: (key: string, value: PreviewSnapshot) => void;
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
 * always the first one the iterator yields. An evicted snapshot is taken out of every card still
 * showing it (`preview-root.ts`), so a card is never left drawing something no cache vouches for:
 * its next paint asks again.
 */
export function createPreviewCache(limit: number = PREVIEW_CACHE_LIMIT): PreviewCache {
  const entries = new Map<string, PreviewSnapshot>();
  liveCaches.add(new WeakRef(entries));

  function evict() {
    // Insertion order is LRU order, and deleting the entry being visited is safe mid-iteration.
    for (const [oldest, stale] of entries) {
      if (entries.size <= limit) {
        break;
      }
      entries.delete(oldest);
      unmountPreview(stale);
    }
  }

  return {
    clear() {
      for (const snapshot of entries.values()) {
        unmountPreview(snapshot);
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

// ─── Retrying a failed preview ───────────────────────────────────────────────

/** Bumped by {@link invalidatePreviews}: a preview that failed before the bump may succeed now. */
let _invalidations = 0;
/** A stable number per object, so an identity can be part of {@link previewEpoch}. */
const _identities = new WeakMap<object, number>();
let _nextIdentity = 0;

/** The inputs whose identity the epoch tracks: the open project and the registry array. */
type EpochInput = NonNullable<typeof projectState> | ComponentEntry[];

function identityOf(value: EpochInput | null): number {
  if (value === null) {
    return 0;
  }
  let id = _identities.get(value);
  if (id === undefined) {
    _nextIdentity += 1;
    id = _nextIdentity;
    _identities.set(value, id);
  }
  return id;
}

/**
 * What a preview's outcome depends on beyond its own file, as one comparable key.
 *
 * A preview that failed is not retried on every repaint (a document that does not render would be
 * read once per scroll frame); it is retried once this key moves. It moves when the project is
 * replaced, when the component registry is rescanned or gains or loses an entry, when the preview
 * realm is replaced, and whenever a caller says the inputs moved ({@link invalidatePreviews}: a
 * finished scan, a saved file).
 */
export function previewEpoch(): string {
  return `${_invalidations}:${identityOf(projectState)}:${identityOf(componentRegistry)}:${componentRegistry.length}:${previewRealmGeneration()}`;
}

/**
 * The definitions of `tags` changed (the live component lane, `services/live-components.ts`): the
 * preview realm is replaced if it holds one (`project-state.md` §11.2), now or when a reply in
 * flight shows it defined one, and then every failed preview is worth asking again, since a new
 * realm can draw what the old one could not (the listener below).
 */
export function previewDefinitionsMoved(tags: readonly string[]): void {
  previewDefinitionsChanged(tags);
}

/**
 * The project's set of components changed (`componentsChanged`): a realm that defines any project
 * tag is replaced, because the tag may now be defined by another file or by none.
 */
export function previewComponentSetMoved(): void {
  previewComponentsChanged();
}

/** Who repaints when the inputs move: each mounted view that draws previews. */
const _invalidationListeners = new Set<() => void>();

/* A replaced realm failed every request it had in flight, and the next realm may draw what the
   last could not: either way every failed preview is worth asking again. */
onPreviewRealmReplaced(() => {
  invalidatePreviews();
});

/**
 * Say that every failed preview is worth trying again, and tell each view that draws previews.
 *
 * Whatever changes what a preview renders from calls this: a finished scan, a rescanned component
 * registry, a written dependency. A view that only waited for its next repaint would wait forever
 * when nothing else on it changed, which is how a card stayed blank after the project had settled.
 */
export function invalidatePreviews(): void {
  _invalidations += 1;
  for (const listener of _invalidationListeners) {
    listener();
  }
}

/**
 * Be told when {@link invalidatePreviews} runs. Answers the function that stops listening.
 *
 * @param listener Called synchronously, after the epoch has moved.
 */
export function onPreviewsInvalidated(listener: () => void): () => void {
  _invalidationListeners.add(listener);
  return () => {
    _invalidationListeners.delete(listener);
  };
}

// ─── Rendering one preview ───────────────────────────────────────────────────

/**
 * Render a page/layout/content document in the preview realm, or null when it cannot be rendered.
 *
 * Returning null rather than throwing is deliberate: a document that fails to parse is a real state
 * of the project, and the card shows a document glyph for it. The Problems list is for failures the
 * author must ACT on; an in-progress file that does not parse yet is not one.
 */
export async function renderDocPreview(filePath: string): Promise<PreviewSnapshot | null> {
  try {
    const content = await storedText(filePath);
    await loadFormats();
    let document_: JxDocument;
    if (formatForPath(filePath)) {
      const parsed = await parseSourceForPath(filePath, content);
      /* SAFETY: a format class's parser returns its file as a Jx element tree (the format contract),
         and the split hands that same tree back as `document`; a tree the realm cannot draw is
         answered `failed`, which is "no preview". */
      document_ = parsed.document as JxDocument;
    } else {
      /* SAFETY: a `.json` file in the Library is a project document by the project layout; malformed
         JSON throws into the catch below, and a shape the realm cannot draw is answered `failed`,
         which is "no preview". */
      document_ = JSON.parse(content) as JxDocument;
    }
    /* The document's media resolve as the canvas resolves them, with the version map as it stands
       when the request is made: the Library is the many-images screen, and a versioned src is what
       lets its cards repaint from the browser cache. */
    const context = assetContextFor(filePath, hostAssetDeclarations());
    const assets = context && {
      ...context,
      revisions: localRevisionsSnapshot(),
      versions: assetVersionsSnapshot(),
    };
    return snapshotOf(
      await previewRealm().ask({
        assets,
        kind: "document",
        target: realmTarget(filePath, document_),
      }),
    );
  } catch {
    return null;
  }
}

/**
 * The preview for one file — a registered component's own preview when there is one, the document
 * render otherwise. Cached; a cache hit does no work at all.
 *
 * `undefined` is never cached: the caller decides when to ask again (see {@link previewEpoch} and
 * {@link PreviewObserver.observeAgain}), so a preview that failed while the project was still
 * settling is drawn once it can be.
 */
export async function previewFor(
  path: string,
  cache: PreviewCache,
): Promise<PreviewSnapshot | undefined> {
  const cached = cache.get(path);
  if (cached) {
    return cached;
  }
  let rendered: PreviewSnapshot | null;
  try {
    // The project's stylesheet, ready for the box this preview is shown in (`preview-style.ts`).
    await loadProjectPreviewSheets();
    const component = componentRegistry.find((c: ComponentEntry) => c.path === path);
    if (component) {
      const answer = await componentPreview(component);
      // A realm that went away mid-request is no failure of this file: it is asked again.
      if (answer.kind === "failed" && answer.lost !== true) {
        reportPreviewFailure(path, answer.message);
      }
      rendered = snapshotOf(answer);
    } else {
      rendered = await renderDocPreview(path);
    }
  } catch (error) {
    reportPreviewFailure(path, errorMessage(error));
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
  /**
   * Start watching a card. Safe to call repeatedly for the same element. A card parked by
   * {@link PreviewObserver.observeAgain} is asked for afresh: its next record counts even if it
   * never left view, because the caller only does this once the inputs it failed under have moved.
   */
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
  /**
   * Watch a card whose preview failed, and report it the next time it ENTERS view.
   *
   * Not `observe`: a card on screen would be reported at once, fail again, and loop. This one waits
   * for the card to leave first, so scrolling a card away and back is a retry and sitting still is
   * not. A no-op where there is no `IntersectionObserver`, since there is no "entering" to wait
   * for.
   */
  observeAgain: (element: Element) => void;
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
      observeAgain() {
        /* Nothing can enter view here; a retry waits for the inputs to move instead. */
      },
      releaseDetached: () => 0,
    };
  }
  const watched = new Set<Element>();
  /** Cards that must be seen OUT of view before an entry counts (`observeAgain`). */
  const awaitingExit = new WeakSet<Element>();
  const observer = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (awaitingExit.has(record.target)) {
          if (!record.isIntersecting) {
            awaitingExit.delete(record.target);
          }
          continue;
        }
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
      /* A card parked by `observeAgain` is being asked for NOW: the inputs it failed under have
         moved, so its next record counts whether or not it ever left view. Re-observing is a no-op
         in the browser while it is still observed, so it is let go and observed afresh, which is
         what makes the observer deliver an initial record for it. */
      if (awaitingExit.has(element)) {
        awaitingExit.delete(element);
        observer.unobserve(element);
        observer.observe(element);
        return;
      }
      // Re-observing is a no-op in the browser, but the repaint that follows every scroll frame
      // Hands the same slot back, and a call per card per frame is work nobody needs.
      if (watched.has(element)) {
        return;
      }
      watched.add(element);
      observer.observe(element);
    },
    observeAgain(element) {
      if (watched.has(element)) {
        return;
      }
      awaitingExit.add(element);
      watched.add(element);
      observer.observe(element);
    },
    releaseDetached() {
      let released = 0;
      // Deleting the current key during a `Set` iteration is defined; later keys are still visited.
      for (const element of watched) {
        if (!element.isConnected) {
          watched.delete(element);
          awaitingExit.delete(element);
          observer.unobserve(element);
          released += 1;
        }
      }
      return released;
    },
  };
}

// ─── Eviction by path ────────────────────────────────────────────────────────

/**
 * Every preview cache's entries, held weakly: a cache lives as long as the panel that made it, and
 * a panel that was torn down must not be kept alive by this list.
 */
const liveCaches = new Set<WeakRef<Map<string, PreviewSnapshot>>>();

/**
 * Drop one path's rendered preview from every cache, taking it out of the card it was in, so the
 * next paint renders the file again (`services/live-components.ts`, when a component definition
 * changes). The card's box is left empty, and the previews are invalidated ({@link
 * invalidatePreviews}) so every pane that subscribed repaints and its settle pass refills it,
 * rather than waiting for something else to repaint the Library.
 */
export function evictPreview(path: string): void {
  let evicted = false;
  for (const ref of liveCaches) {
    const entries = ref.deref();
    if (!entries) {
      liveCaches.delete(ref);
      continue;
    }
    const stale = entries.get(path);
    if (stale) {
      entries.delete(path);
      unmountPreview(stale);
      evicted = true;
    }
  }
  if (evicted) {
    invalidatePreviews();
  }
}
