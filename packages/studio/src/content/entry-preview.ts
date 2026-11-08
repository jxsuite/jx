/// <reference lib="dom" />
/**
 * The entry-preview bar: what Edit draws over a collection's page (`specs/studio.md` §22.4).
 *
 * A collection's page (`pages/[slug].json` whose `$paths` names a content type) is one page drawn
 * once for every entry, so on the canvas it is drawn with ONE of them: the entry its route
 * parameter names. The bar says which, by the entry's title, and steps through the rest. Choosing
 * writes the route parameter through `canvas.setRouteParam`, the verb the Context popover's
 * "Preview value for [slug]" picker runs, so the bar and the popover are two views of one value.
 *
 * One bar per pane, mounted into the host the canvas stage draws above Edit's column
 * (`surfaces/canvas-stage.json`'s `entry-preview`); `canvas/canvas-render.ts` hands the host over
 * and repaints it.
 *
 * @docs studio/projects/browse
 */

import { isString } from "@jxsuite/schema/guards";
import { activeRegistry } from "../commands/active-registry";
import { runReported } from "../commands/run-reported";
import { isPagePath } from "../canvas/canvas-page-context";
import { dynamicRouteParams, loadParamLabels, loadParamValues, pagePathsDef } from "../page-params";
import { projectState } from "../store";
import { paneRegion } from "../ui/regions";
import { workspace } from "../workspace/workspace";
import { contentCollection } from "./content-collections";
import { mountEntryPreviewSurface } from "../surfaces/entry-preview";
import type { JxPathsDef } from "@jxsuite/schema/types";
import type { Tab } from "../tabs/tab";
import type { EntryPreviewHandle, EntryPreviewView } from "../surfaces/entry-preview";
import type { SurfaceOption } from "../ui/surface";

/** The route parameter a collection's page is drawn by, and the `$paths` block that names it. */
export interface EntryPreviewTarget {
  /** The content type the page enumerates. */
  contentType: string;
  /** The route parameter that names the entry: `slug` for `pages/[slug].json`. */
  param: string;
  pathsDef: JxPathsDef;
}

/**
 * The entry `tab`'s page is drawn by, or null when it is not a collection's page: not a page, a
 * page with no `$paths`, or a `$paths` block that enumerates something other than a content type.
 */
export function entryPreviewTarget(tab: Tab | null): EntryPreviewTarget | null {
  const path = tab?.documentPath;
  if (!tab || !path || !projectState?.isSiteProject || !isPagePath(path)) {
    return null;
  }
  const pathsDef = pagePathsDef({
    document: tab.doc.document,
    frontmatter: tab.doc.content.frontmatter,
  });
  if (!pathsDef || Array.isArray(pathsDef) || !("contentType" in pathsDef)) {
    return null;
  }
  const { contentType } = pathsDef;
  if (!isString(contentType) || !contentType) {
    return null;
  }
  const param = isString(pathsDef.param) && pathsDef.param ? pathsDef.param : "slug";
  return dynamicRouteParams(path).includes(param) ? { contentType, param, pathsDef } : null;
}

// ─── Entries ─────────────────────────────────────────────────────────────────

/** A collection's entries as the picker lists them, by `$paths` block, once read. */
const _options = new Map<string, SurfaceOption[]>();
const _reading = new Set<string>();

function optionsKey(tab: Tab, target: EntryPreviewTarget): string {
  return `${tab.documentPath ?? ""}::${JSON.stringify(target.pathsDef)}`;
}

/**
 * The entries `target` enumerates, or undefined while they are being read. The first ask starts the
 * read and repaints every bar when it lands.
 */
function optionsFor(tab: Tab, target: EntryPreviewTarget): SurfaceOption[] | undefined {
  const key = optionsKey(tab, target);
  const known = _options.get(key);
  if (known || _reading.has(key)) {
    return known;
  }
  _reading.add(key);
  const { documentPath } = tab;
  void Promise.all([
    loadParamValues(documentPath, target.pathsDef),
    loadParamLabels(documentPath, target.pathsDef),
  ]).then(([values, labels]) => {
    _reading.delete(key);
    const titles = labels[target.param] ?? {};
    _options.set(
      key,
      (values[target.param] ?? []).map((value) => ({ label: titles[value] ?? value, value })),
    );
    repaintAll();
  });
  return undefined;
}

/** Forget every collection's entries: they were added, removed or retitled. */
export function invalidateEntryPreview(): void {
  _options.clear();
  _reading.clear();
}

// ─── The view ────────────────────────────────────────────────────────────────

/** What the bar over `tab` in `paneId` draws. */
export function entryPreviewView(paneId: string, tab: Tab): EntryPreviewView {
  const region = paneRegion(paneId, "entry-preview");
  const target = entryPreviewTarget(tab);
  const options = target ? optionsFor(tab, target) : [];
  const value = target ? (tab.session.ui.previewParams[target.param] ?? "") : "";
  const quiet = { nextDisabled: true, options: [], prevDisabled: true, value };
  if (options === undefined) {
    return { ...quiet, note: "Reading entries…", region, status: "note" };
  }
  if (!target || options.length === 0) {
    const item = (target && contentCollection(target.contentType)?.item) ?? "entry";
    return { ...quiet, note: `No ${item} to preview yet`, region, status: "note" };
  }
  const index = options.findIndex((option) => option.value === value);
  return {
    nextDisabled: index === -1 || index >= options.length - 1,
    note: "",
    options,
    prevDisabled: index <= 0,
    region,
    status: "ready",
    value,
  };
}

/** Draw the page in `paneId` with the entry whose route value is `value`. */
function choose(paneId: string, value: string): void {
  const tab = paneTab(paneId);
  const target = entryPreviewTarget(tab);
  if (!target) {
    return;
  }
  /* Through the registry, like the Context popover's picker: THIS pane named, because a verb that
     defaulted to the focused pane would make a side pane's bar write the foreground document. A
     refusal (a parameter the page stopped declaring) is filed in Problems rather than lost. */
  const registry = activeRegistry();
  if (registry) {
    void runReported(
      registry,
      "canvas.setRouteParam",
      { name: target.param, pane: paneId, value },
      "Entry preview",
    );
  }
}

/** Draw the page in `paneId` with the entry `delta` places along from the one it is drawn with. */
function step(paneId: string, delta: number): void {
  const tab = paneTab(paneId);
  if (!tab) {
    return;
  }
  const { options, value } = entryPreviewView(paneId, tab);
  const next = options[options.findIndex((option) => option.value === value) + delta];
  if (next) {
    choose(paneId, next.value);
  }
}

// ─── Mounting ────────────────────────────────────────────────────────────────

interface StandingBar {
  host: HTMLElement;
  handle: EntryPreviewHandle;
  /** The tab the bar was last drawn for: whose route parameter its controls write. */
  tabId: string | null;
}

const _bars = new Map<string, StandingBar>();

function paneTab(paneId: string): Tab | null {
  const tabId = _bars.get(paneId)?.tabId;
  return (tabId ? workspace.tabs.get(tabId) : undefined) ?? null;
}

/** Repaint every bar: a collection's entries have just been read. */
function repaintAll(): void {
  for (const [paneId, bar] of _bars) {
    const tab = paneTab(paneId);
    if (tab) {
      bar.handle.update(entryPreviewView(paneId, tab));
    }
  }
}

/**
 * Take a pane's bar host, or let it go (`null`).
 *
 * The stage announces the host when it draws the `entry` lead; the same host comes back on every
 * repaint that keeps that lead, so a second announcement of it changes nothing.
 */
export function attachEntryPreview(paneId: string, host: HTMLElement | null): void {
  const held = _bars.get(paneId);
  if (held?.host === host) {
    return;
  }
  if (held) {
    held.handle.dispose();
    _bars.delete(paneId);
  }
  if (!host) {
    return;
  }
  const handle = mountEntryPreviewSurface(
    host,
    {
      nextDisabled: true,
      note: "",
      options: [],
      prevDisabled: true,
      region: paneRegion(paneId, "entry-preview"),
      status: "note",
      value: "",
    },
    {
      choose: (value) => {
        choose(paneId, value);
      },
      step: (delta) => {
        step(paneId, delta);
      },
    },
  );
  _bars.set(paneId, { handle, host, tabId: null });
}

/** Draw a pane's bar for the page it is over. A pane with no bar host is left alone. */
export function renderEntryPreview(paneId: string, tab: Tab): void {
  const bar = _bars.get(paneId);
  if (!bar) {
    return;
  }
  bar.tabId = tab.id;
  bar.handle.update(entryPreviewView(paneId, tab));
}

/** Take a pane's bar down (its lead went away, or the pane did). Idempotent. */
export function detachEntryPreview(paneId: string): void {
  attachEntryPreview(paneId, null);
}

/** Take every bar down and forget every read — tests. */
export function resetEntryPreview(): void {
  for (const paneId of _bars.keys()) {
    detachEntryPreview(paneId);
  }
  invalidateEntryPreview();
}
