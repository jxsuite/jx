/// <reference lib="dom" />
/**
 * The Document Header card (§3.2 ⑧) — the artefact's own header, drawn IN the stage.
 *
 * It replaces the old "Properties" bar, which was a fourth full-width band that **appeared and
 * vanished as a side effect of the canvas mode** with no control to summon it, and which showed
 * nothing at all unless `findContentTypeSchema` matched the document to a content collection — so
 * it never appeared on the default home page, the one document every new author opens first.
 *
 * Three gates are gone, and each was a lie about what the card is for:
 *
 * - The **collection gate** (`if (!fieldSet?.collection)`) — a page's `title` is frontmatter whether
 *   or not a collection schema describes it;
 * - The **mode gate** (`getCanvasMode() === "edit"`) — the header is part of the document, not a view
 *   of it, so switching to Design must not delete it;
 * - The **document-mode gate** (`doc.mode === "content"`) — a JSON page carries `title` and `$head`
 *   directly on the root node, and it has a header for exactly the same reason.
 *
 * What it renders instead: **any** document with frontmatter or `$head`, in every named layout and
 * in both authoring views of the stage — Title, Route, the layout picker, the
 * schema-and-frontmatter field list, the door to Search appearance and a "Raw head tags"
 * disclosure. `hasDocumentHeader` is the whole predicate, and it is a fact about the DOCUMENT.
 *
 * **One reserved-key policy, one `collectFmFields` call.** The two field sets this card merges used
 * to disagree: this module passed an empty reserved set and `head-panel.ts` passed `{title}`, so
 * `title` could render twice with two different commit paths. `RESERVED_FM_KEYS` wins and is
 * imported, not restated — see the note on its declaration.
 *
 * **The card has no host of its own.** `#frontmatter-panel` — the grid row, the `hidden` div, the
 * `frontmatterPanelEl` ref and the 40vh cap that came with them — is deleted. The STAGE renders the
 * host now ({@link attachDocumentHeaderHost}, called from the stage document's `onNodeCreated` in
 * `canvas/canvas-render.ts`), so the card sits inside the artefact rather than in a band above it.
 *
 * **The card is a Jx document now** (`src/surfaces/doc-header.json`), and this module is the flow
 * behind it: it decides which document a pane's card is drawn for, which rows that document has,
 * what each row commits into and where a media or reference row gets its choices, then hands the
 * surface a projection whose every field is already a string. Three things follow.
 *
 * **The focus-aware scheduler is gone, and nothing replaced it.** `panels/panel-scheduler.ts`
 * existed to withhold a repaint while a text input in the card had focus, because a lit re-render
 * rebuilt every control and truncated whatever was being typed into one. A document binds each
 * value on its own runtime effect and skips a write equal to what the control already holds
 * (specs/studio-ui-guidelines.md §9.3), so a projection that changed one field repaints one field
 * and a projection that changed nothing repaints nothing. There is no window left to withhold.
 *
 * **ONE row vocabulary.** Title, the Layout picker and every schema-driven frontmatter field are
 * the same row, told apart by which control they draw; what makes them different is what they
 * WRITE, and that is this module's business rather than the document's. {@link RowCommit} is that
 * table, rebuilt with each projection and reached by the row's `key` — which is why a row's key and
 * its `data-prop` are two different strings: a collection whose schema declares a `layout` property
 * would otherwise collide with the Layout picker.
 *
 * **Two widgets are borrowed as BEHAVIOUR rather than as markup.** The media browser
 * (`ui/media-picker.ts`) renders into the popover layer rather than into the field, and the entry
 * ids behind a `#/content/<type>` reference are a read (`ui/form-controls.ts`), so the card draws
 * its own control for each and calls the owner for the part that is not markup. Neither module's
 * lit template is interpolated here — a document and a lit template cannot share a container, and
 * §9.4 forbids the mix outright.
 *
 * @docs studio/editing/frontmatter
 */

import { projectState } from "../store";
import { workspace } from "../workspace/workspace";
import { tabOfPane } from "../canvas/canvas-surface";
import { paneRegion } from "../ui/regions";
import { effect, effectScope } from "../reactivity";
import { collectFmFields, projectFmField } from "./frontmatter-fields";
import { LIVE_PREVIEW } from "../ui/timing";
import { mutateUpdateFrontmatter, transact, transactDoc } from "../tabs/transact";
import { pageRoute } from "./tab-strip";
import {
  RESERVED_FM_KEYS,
  applyContentMutation,
  buildHeadDoc,
  entryLabel,
  entryValue,
  isPageDocument,
  isManagedEntry,
  layoutPickerEntries,
} from "./head-panel";
import { isGoogleFontEntry, isGoogleFontPreconnect } from "../utils/google-fonts";
import { activeRegistry } from "../commands/active-registry";
import { invalidateLayoutCache } from "../site-context";
import { mountDocHeaderSurface } from "../surfaces/doc-header";

import type { JxHeadEntry, JxMutableNode } from "@jxsuite/schema/types";
import type { Tab } from "../tabs/tab";
import type { FmSchemaEntry } from "./frontmatter-fields";
import type * as MediaPickerModule from "../ui/media-picker";
import type {
  DocHeaderActions,
  DocHeaderChoice,
  DocHeaderRawEntry,
  DocHeaderRow,
  DocHeaderSurface,
  DocHeaderView,
} from "../surfaces/doc-header";

/** What one row of the card writes. The document knows the control; this knows the document. */
interface RowCommit {
  /** Remove the value this row shows. */
  clear: () => void;
  /** Commit what the control settled on — a string from every kind but the checkbox. */
  commit: (raw: string | boolean) => void;
}

/**
 * One pane's card: the node the stage gave it, the mounted surface, its commit table and the
 * actions the surface was handed.
 *
 * A single `_host` was the same singleton every other stage-content module had, and it produced a
 * subtler failure than most: the stage hands the host over from a lit `ref`, so with two stages
 * drawing a header the second `ref` to fire silently took the card away from the first, leaving one
 * pane's Document Header frozen on the frontmatter of the moment it lost the handle.
 */
interface HeaderCard {
  /** The pane this card is drawn for. Held rather than looked up: an action has to answer it. */
  paneId: string;
  el: HTMLElement;
  /** `null` until the pane's document first has a header to draw. */
  surface: DocHeaderSurface | null;
  /** This pane's rows, by key. Rebuilt with each projection. */
  commits: Map<string, RowCommit>;
  /** Handed to the surface once, when it is mounted; every one of them reads `commits`. */
  actions: DocHeaderActions;
  /** Text edits waiting out {@link LIVE_PREVIEW}, one per row key. */
  pending: Map<string, { commit: () => void; timer: ReturnType<typeof setTimeout> }>;
}

const _hosts = new Map<string, HeaderCard>();
let _scope: { stop: () => void; run: <T>(fn: () => T) => T | undefined } | null = null;

/** Per-document disclosure state, keyed by tab id — not stored on the document. */
const _rawOpen = new Set<string>();

/**
 * The element the stage has made available for the card, or `null` while no stage hosts it.
 *
 * Called from a lit `ref` in `canvas/canvas-render.ts`, so the host's lifetime is the stage's: the
 * canvas creates it when it draws a document that has a header and drops it otherwise.
 *
 * @param {HTMLElement | null} el
 */
export function attachDocumentHeaderHost(paneId: string, el: HTMLElement | null): void {
  const held = _hosts.get(paneId);
  if (held?.el === el) {
    return;
  }
  if (held) {
    takeDown(held);
    _hosts.delete(paneId);
  }
  if (!el) {
    return;
  }
  const card: HeaderCard = {
    actions: {} as DocHeaderActions,
    commits: new Map(),
    el,
    paneId,
    pending: new Map(),
    surface: null,
  };
  card.actions = makeActions(card);
  _hosts.set(paneId, card);
  paint(paneId, card);
}

/* There is no `documentHeaderHost` getter any more, and its absence is the point.
   It existed for ONE caller: the stage's lit `ref`, which was told about a removal WITHOUT being
   told which node had gone, so it had to read the host back and ask whether it was still connected
   before deciding the report was about the host it held. `surfaces/canvas-stage.json` states both
   placements as a view, so a frame that draws no card simply announces none and `renderCanvasImpl`
   releases the slot in one place — there is nothing left to settle after the fact, and a getter
   whose only reader is gone is a fact about the module nobody is entitled to. */

/**
 * Mount the Document Header card: subscribe to the tab / document / frontmatter reads it renders
 * from, so a change repaints the card without repainting the canvas around it.
 *
 * The card takes no context. It used to take `getCanvasMode()` purely to decide whether to exist,
 * and that predicate is the thing this change deletes.
 */
export function mount() {
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      // Every pane's tab, not the focused one's: two stages can each be drawing a header, and a
      // Card that only tracked `activeTab` stopped repainting the moment focus moved away from it.
      for (const tab of paneTabs()) {
        // Track everything the card reads: the document root (title / `$head` / `$layout` live
        // There for a JSON page) plus the frontmatter object AND its entries — field commits mutate
        // Keys in place while the source-mode round-trip swaps the whole object, and both must
        // Re-fire this effect.
        void tab.doc.mode;
        void tab.documentPath;
        void tab.doc.document;
        void tab.doc.document?.title;
        void tab.doc.document?.$head;
        void tab.doc.document?.$layout;
        const fm = tab.doc.content?.frontmatter;
        if (fm) {
          for (const key of Object.keys(fm)) {
            void fm[key];
          }
        }
      }
      render();
    });
  });
}

export function unmount() {
  _scope?.stop();
  _scope = null;
  for (const card of _hosts.values()) {
    takeDown(card);
  }
  _hosts.clear();
  _rawOpen.clear();
}

/** Take one pane's card down: cancel its waiting edits and dispose the document it mounted. */
function takeDown(card: HeaderCard): void {
  for (const { timer } of card.pending.values()) {
    clearTimeout(timer);
  }
  card.pending.clear();
  card.surface?.dispose();
  card.surface = null;
  card.commits.clear();
}

/** Each pane's tab, deduplicated — the set of documents a header could be drawn for. */
function paneTabs(): Tab[] {
  const tabs: Tab[] = [];
  for (const pane of workspace.panes) {
    const tab = tabOfPane(pane.id);
    if (tab && !tabs.includes(tab)) {
      tabs.push(tab);
    }
  }
  return tabs;
}

/**
 * Repaint every card.
 *
 * Coalescing is the runtime's now: a projection assigns to a standing scope and each binding
 * re-runs only where the value it reads has changed, so calling this twice in one tick costs one
 * comparison per binding rather than two renders.
 */
export function render() {
  for (const [paneId, card] of _hosts) {
    paint(paneId, card);
  }
}

/**
 * Whether a document has a header to show.
 *
 * The one remaining gate, and it is a fact about the document rather than about the view: a
 * component definition with no frontmatter, no title and no `$head` has no header, and printing an
 * empty card over its canvas would be chrome pretending to be content.
 *
 * @param {Tab} tab
 * @returns {boolean}
 */
export function hasDocumentHeader(tab: Tab): boolean {
  const fm = tab.doc.content?.frontmatter ?? {};
  const doc = tab.doc.document;
  if (Object.keys(fm).length > 0) {
    return true;
  }
  if (typeof doc?.title === "string" || (doc?.$head?.length ?? 0) > 0) {
    return true;
  }
  // A page always has one, even an empty one: Title and Route are the two facts it must state.
  // THIS tab's page-ness. `isPageDocument()` was zero-argument and answered about the focused
  // Pane's document, so a predicate whose every other line reads `tab` finished by asking about a
  // Different one: a page in the side pane lost its header whenever a component was focused, and a
  // Bare component in the side pane grew one whenever a page was.
  return isPageDocument(tab);
}

/**
 * Draw (or take down) one pane's card.
 *
 * The surface is only ever mounted ONCE per host and assigned to afterwards. Rebuilding it on a
 * repaint would take a field out from under a reader mid-edit, which is the failure the scheduler
 * this conversion deletes was built to prevent; `connected()` answers the one case assignment
 * cannot, a stage that redrew and took the card's root away.
 */
function paint(paneId: string, card: HeaderCard): void {
  const tab = tabOfPane(paneId);
  if (!tab || !hasDocumentHeader(tab)) {
    /* The stage decides whether the host exists; this only covers the window between a document
       losing its header and the canvas noticing. */
    takeDown(card);
    card.el.replaceChildren();
    card.el.hidden = true;
    return;
  }
  const view = viewFor(tab, paneId, card);
  card.el.hidden = false;
  if (card.surface?.connected()) {
    card.surface.update(view);
    return;
  }
  card.surface?.dispose();
  card.surface = mountDocHeaderSurface(card.el, view, card.actions);
}

// ─── The projection ──────────────────────────────────────────────────────────

/**
 * Everything the card says about one document, and the commit table behind it.
 *
 * `tab`, not `activeTab` — the card is drawn for the pane that mounted it. Both branches of the
 * commit path resolved through FOCUS once, so with two panes the visible card's controls edited
 * whichever document happened to be focused: click "Clear title" on the card in the left pane and
 * the field disappeared from the right pane's document instead.
 *
 * @param {Tab} tab
 * @returns {DocHeaderView}
 */
function viewFor(tab: Tab, paneId: string, card: HeaderCard): DocHeaderView {
  const isContent = tab.doc.mode === "content";
  const fm = (tab.doc.content?.frontmatter ?? {}) as Record<string, unknown>;
  // ONE view of the document's head material, whichever realm it lives in: frontmatter keys for a
  // Markdown page, root properties for a JSON one.
  const headDoc = isContent ? buildHeadDoc(tab.doc.document, fm) : tab.doc.document;
  const applyMutation = isContent
    ? (fn: (doc: JxMutableNode) => void) => applyContentMutation(tab, render, fn)
    : (fn: (doc: JxMutableNode) => void) => {
        transact(tab, fn);
      };

  const commits = new Map<string, RowCommit>();
  const rows: DocHeaderRow[] = [titleRow(headDoc, applyMutation, commits)];
  const layout = layoutRow(tab, headDoc, applyMutation, commits);
  if (layout) {
    rows.push(layout);
  }

  // ONE call. The old pair of surfaces made two, with two different reserved-key policies.
  const { collection, fields, requiredFields } = collectFmFields(
    tab,
    projectState?.projectConfig,
    RESERVED_FM_KEYS,
  );
  for (const f of fields) {
    rows.push(fieldRow(tab, f.field, f.entry, f.value, requiredFields, commits));
  }
  card.commits = commits;

  const route = tab.documentPath ? pageRoute(tab.documentPath) : null;
  const raw = rawEntries(headDoc.$head ?? []);
  return {
    collection: collection ? collection.name : "Document",
    hasRoute: route !== null,
    /* The stage's two placements, read off the host it handed over. In Edit the card is a block of
       the document's own column; in Design it is pinned above a pan/zoom surface at 1:1, and only
       that one wants the band's edge rather than the card's. `surfaces/canvas-stage.json` says the
       same thing from the STAGE's side, which a document's own scoped style block cannot answer —
       and it says it on `data-placement` rather than on a class, because the stage emits none. */
    placement: card.el.dataset["placement"] === "pinned" ? "pinned" : "in-column",
    rawEntries: raw,
    rawOpen: _rawOpen.has(tab.id),
    rawState: raw.length === 0 ? "empty" : "list",
    region: paneRegion(paneId, "frontmatter"),
    route: route ?? "",
    rows,
  };
}

/** A blank row, so every kind carries every field the document's bindings read. */
function blankRow(key: string, prop: string, label: string): DocHeaderRow {
  return {
    checked: false,
    clearLabel: `Clear ${prop}`,
    hasNote: false,
    hasThumb: false,
    isSet: false,
    key,
    kind: "text",
    label,
    note: "",
    options: [],
    placeholder: "",
    prop,
    thumb: "",
    value: "",
  };
}

/** The one head value you type while writing, in both realms. */
function titleRow(
  headDoc: JxMutableNode,
  applyMutation: (fn: (doc: JxMutableNode) => void) => void,
  commits: Map<string, RowCommit>,
): DocHeaderRow {
  const title = typeof headDoc.title === "string" ? headDoc.title : "";
  commits.set("title", {
    clear: () =>
      applyMutation((d) => {
        delete d.title;
      }),
    commit: (raw) =>
      applyMutation((d) => {
        const val = String(raw).trim();
        if (val) {
          d.title = val;
        } else {
          delete d.title;
        }
      }),
  });
  return {
    ...blankRow("title", "title", "Title"),
    clearLabel: "Clear title",
    isSet: Boolean(title),
    placeholder: "Untitled",
    value: title,
  };
}

/**
 * The layout picker, or `null` when this document takes none — a component has no layout, and a
 * page whose layouts directory is still being listed has nothing to offer yet.
 *
 * The listing is `head-panel.ts`'s, asked for as data: the Page panel draws the same choices from
 * the same cache, so creating a layout invalidates one thing rather than two.
 */
function layoutRow(
  tab: Tab,
  headDoc: JxMutableNode,
  applyMutation: (fn: (doc: JxMutableNode) => void) => void,
  commits: Map<string, RowCommit>,
): DocHeaderRow | null {
  if (!isPageDocument(tab)) {
    return null;
  }
  const entries = layoutPickerEntries();
  if (entries === null) {
    return null;
  }
  const current = headDoc.$layout;
  const defaultPath = projectState?.projectConfig?.defaults?.layout;
  const defaultLabel = defaultPath ? layoutName(defaultPath) : "";
  const options: DocHeaderChoice[] = [
    { label: defaultLabel ? `Default (${defaultLabel})` : "Default", value: "__default__" },
    { label: "None", value: "__none__" },
    ...entries.map((l) => ({ label: l.name, value: l.path })),
  ];
  commits.set("__layout", {
    clear: () =>
      applyMutation((d) => {
        delete d.$layout;
      }),
    commit: (raw) => {
      const val = String(raw);
      applyMutation((d) => {
        if (val === "__default__") {
          delete d.$layout;
        } else if (val === "__none__") {
          d.$layout = false;
        } else {
          d.$layout = val;
        }
      });
      invalidateLayoutCache();
    },
  });
  return {
    ...blankRow("__layout", "layout", "Layout"),
    isSet: current !== undefined,
    kind: "select",
    options,
    value: current === false ? "__none__" : current || "__default__",
  };
}

/** `./layouts/blog-post.json` → `Blog Post`. */
function layoutName(path: string): string {
  return path
    .replace(/^\.\/layouts\//, "")
    .replace(/\.json$/, "")
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\b\w/g, (c: string) => c.toUpperCase());
}

/**
 * One schema-driven frontmatter field, as the row that draws it and the write that commits it.
 *
 * **What the row LOOKS like is `panels/frontmatter-fields.ts`'s answer, not this module's.** The
 * Navigator's Page panel draws the same field set from the same schemas, and the two surfaces
 * deciding independently that a `$ref` is a picker, that `"uri-reference"` is a media format or
 * that an array is a comma-separated line is exactly how they came to disagree about `title`. What
 * stays here is what the card COMMITS INTO — this tab's frontmatter, through its transaction log.
 *
 * `tab` is a parameter because this used to commit to `activeTab.value` at each of seven widgets,
 * which is right for the Navigator's Document panel and wrong for a card drawn once per pane: a
 * collection field edited on the card in one pane wrote into whichever document had the keyboard.
 */
function fieldRow(
  tab: Tab,
  field: string,
  entry: FmSchemaEntry,
  value: unknown,
  requiredFields: Set<string>,
  commits: Map<string, RowCommit>,
): DocHeaderRow {
  const key = `fm:${field}`;
  const { parse, row } = projectFmField(field, entry, value, requiredFields, { rerender: render });
  commits.set(key, {
    clear: () => transactDoc(tab, (t) => mutateUpdateFrontmatter(t, field)),
    commit: (raw) => transactDoc(tab, (t) => mutateUpdateFrontmatter(t, field, parse(raw))),
  });
  return { ...blankRow(key, field, row.label), ...row, clearLabel: `Clear ${field}` };
}

/**
 * The `$head` entries no structured control owns, listed read-only.
 *
 * Read-only on purpose: the card discloses what is there so the author is never surprised by a tag
 * they cannot see, and the Page panel remains the surface that adds and removes them.
 */
function rawEntries(head: JxHeadEntry[]): DocHeaderRawEntry[] {
  return head
    .filter(
      (e: JxHeadEntry) => !isManagedEntry(e) && !isGoogleFontEntry(e) && !isGoogleFontPreconnect(e),
    )
    .map((entry, index) => ({
      key: `raw:${index}`,
      label: entryLabel(entry),
      value: entryValue(entry),
    }));
}

// ─── The actions ─────────────────────────────────────────────────────────────

/**
 * What the reader can do on one pane's card.
 *
 * Made once per host and handed to the surface at mount, so every one of them reads the CURRENT
 * commit table rather than closing over the projection that was standing when the card was drawn.
 */
function makeActions(card: HeaderCard): DocHeaderActions {
  const flush = (key: string): void => {
    const waiting = card.pending.get(key);
    if (waiting) {
      clearTimeout(waiting.timer);
      card.pending.delete(key);
    }
  };
  const now = (key: string, raw: string | boolean): void => {
    flush(key);
    card.commits.get(key)?.commit(raw);
  };
  return {
    browse: (key, anchor) => {
      flush(key);
      void mediaPicker().then((m) => {
        if (anchor instanceof HTMLElement) {
          m.showMediaPickerPopover(anchor, (val: string) => {
            card.commits.get(key)?.commit(val);
          });
        }
      });
    },
    clear: (key) => {
      flush(key);
      card.commits.get(key)?.clear();
    },
    commitText: (key, value) => now(key, value),
    /* Debounced, so the canvas follows the typing without a document write per keystroke. The
       control is NOT reset in the meantime: the projection this commit causes resolves to the text
       already in the field, and a document binding skips a write equal to what the element holds. */
    editText: (key, value) => {
      flush(key);
      const commit = () => {
        card.pending.delete(key);
        card.commits.get(key)?.commit(value);
      };
      card.pending.set(key, { commit, timer: setTimeout(commit, LIVE_PREVIEW) });
    },
    openSeo: () => {
      // The COMMAND, not a local open() — the Page panel offers the same door and neither of them
      // Owns it.
      void activeRegistry()?.run("document.openSeo");
    },
    setBoolean: (key, checked) => now(key, checked),
    setChoice: (key, value) => now(key, value),
    setNumber: (key, value) => now(key, value),
    setRawOpen: (open) => {
      // Per DOCUMENT rather than per pane: the same file open in two stages discloses the same
      // Tags, and a flag on the pane would make the two cards disagree about one document.
      const tab = tabOfPane(card.paneId);
      if (!tab) {
        return;
      }
      if (open) {
        _rawOpen.add(tab.id);
      } else {
        _rawOpen.delete(tab.id);
      }
    },
    upload: (key) => {
      flush(key);
      void mediaPicker().then((m) => {
        m.pickAndUpload((val: string) => {
          card.commits.get(key)?.commit(val);
        });
      });
    },
  };
}

/**
 * The media picker's two behaviours, imported on the first press.
 *
 * ONE cached promise, deliberately: two dynamic imports of a module in flight at once is the shape
 * that loses its coverage record (see the note in the repository's agent guide), and the file also
 * pulls in the upload pipeline and the media metadata cache — neither of which a card that draws no
 * media field should ever load.
 */
let _mediaPicker: Promise<typeof MediaPickerModule> | null = null;

function mediaPicker(): Promise<typeof MediaPickerModule> {
  _mediaPicker ??= import("../ui/media-picker");
  return _mediaPicker;
}
