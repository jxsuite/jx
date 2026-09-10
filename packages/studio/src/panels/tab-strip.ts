/// <reference lib="dom" />
/**
 * Tab strip — one strip PER PANE, above each pane's editor.
 *
 * A tab belongs to a pane and the pane is what splits (§4.3), so the strip is a rendering of
 * `Pane.tabOrder` / `Pane.activeTabId`, not of a workspace-wide list. The host for each pane is
 * addressed by REGION id — `pane.primary/tabs`, `pane.secondary/tabs` — rather than by element id,
 * so the shell can move or rename the divs without touching this file.
 *
 * **This file is the FLOW; the markup is a document.** `surfaces/tab-strip.json` owns the strip's
 * structure, its ARIA, its keyboard and every value in its style, and `surfaces/tab-strip.ts`
 * mounts one per host (studio-ui-guidelines.md §6, §9.3). What stays here is the part that is a
 * decision: which pane a host is drawing, what each tab is called, what its tooltip says, whether
 * closing it would lose work, and what the two menus offer.
 *
 * **The chip is a `jx-tab` now, and three of the things it used to draw by hand are the kit's**:
 * the selected state (`aria-selected` on a real `tab` inside a real `tablist`, where an `.active`
 * class used to be), the close button, and the dirty dot. The three that are Studio's own live in
 * `jx-tab`'s slots — the drill-in marker in `icon`, the draft pill in `status`, the pin toggle in
 * `actions` — which is the gap that kept this strip out of the tab pattern (`ui.md` §5.4). With it
 * closed the strip is one stop in the tab order, the arrows walk it, Home and End reach its ends,
 * and Delete closes a tab: a keyboard contract the × has never had.
 *
 * Six things the strip owes the author:
 *
 * - **A label that identifies the document.** A realistic Jx session has four tabs whose basename is
 *   `index.md`, so the label is the shortest unique path suffix — and for a page, its ROUTE, which
 *   is the name the author actually thinks in (`/blog/[slug]`, not a fourth `index.md`).
 * - **A way to reach a tab that is off-screen.** The horizontal scrollbar is hidden by design and the
 *   wheel handler below is a mouse affordance, so a trackpad user with fifteen files open had no
 *   way at all. The overflow chevron lists every tab currently out of view.
 * - **A pin**, so the four documents you keep coming back to hold the head of the strip and no
 *   preview open can take their slot.
 * - **Drag reorder**, clamped so a drag can never interleave a pinned tab with an unpinned one.
 * - **Preview tabs.** A single click from the tree or the palette opens ITALIC and replaceable. This
 *   is worth more in Jx than in VS Code, because the palette's `@`/`#` modes make browsing cheap
 *   and browsing must not litter. Committing — an edit, a pin, a double-click — makes the tab
 *   permanent.
 * - **A context menu**, which is `registry.forPlacement("context/tab")` and nothing else. Six records
 *   declare that placement; until this menu existed, right-click — the gesture the placement is FOR
 *   — reached none of them. See {@link placedTabItems}.
 */

import { effect, effectScope } from "../reactivity";
import {
  PRIMARY_PANE,
  activateTab,
  closeTab,
  focusPane,
  isPaneFocused,
  moveTab,
  promoteDirtyPreviewTabs,
  promoteTab,
  setTabPinned,
  workspace,
} from "../workspace/workspace";
import { gridTabLabel } from "../grid/grid-source";
import { entryDraftPill } from "../content/entry-editor";
import { DRAFT_FIELD, isDraftEntry } from "../content/draft-state";
import { entryFields } from "../content/entry-fields";
import { collectionOfPath } from "../content/entry-model";
import { activeRegistry } from "../commands/active-registry";
import { PRESET_LABELS } from "../workspace/pane-derive";
import { localeLabel } from "@jxsuite/schema/locale";
import { tabOfPane } from "../canvas/canvas-surface";
import { mediaDisplayName } from "./shared";
import { mountTabStripSurface } from "../surfaces/tab-strip";
import type { Pane, PaneDerivation } from "../workspace/workspace";
import type { Tab } from "../tabs/tab";
import type {
  TabChipView,
  TabStripActions,
  TabStripSurface,
  TabStripValues,
} from "../surfaces/tab-strip";
import { showConfirmDialog, showSaveDiscardDialog } from "../ui/layers";
import { openMenu } from "../surfaces/menu";
import type { MenuHandle, MenuRowProjection } from "../surfaces/menu";
import { saveFile } from "../files/file-ops";
import { collabReadOnly } from "../collab/collab-session";
import { collabState } from "../collab/collab-state";
import { rectOf } from "../utils/geometry";
import { resolveRegion } from "../ui/regions";
import { commitTabBuffers, tabBufferUnsaved } from "../services/monaco-buffer";
import type { EffectScope } from "@vue/reactivity";

/**
 * The primary pane's host, as handed over by the shell's bootstrap.
 *
 * Every OTHER pane's host is resolved by region id at render time, because a pane can appear and
 * disappear between renders and there is nothing to hand over when it does.
 */
let _primaryHost: HTMLElement | null = null;

let _scope: EffectScope | null = null;

/** Last-rendered active tab per pane — decides when to scroll a chip into view. */
const _lastActive = new Map<string, string | null>();

/** The host each pane last drew into, so a strip can be blanked when the pane stops owning it. */
const _hosts = new Map<string, HTMLElement>();

/**
 * The mounted document in each host. One mount per HOST, not per pane.
 *
 * Two panes can resolve to the same host while the shell has a single strip, and the focused one
 * wins the tie ({@link render}). Keying the mount by pane would then mount twice into one div;
 * keying it by the host makes the hand-over an assignment instead — the same document keeps
 * standing and starts saying the other pane's tabs.
 */
const _strips = new Map<HTMLElement, TabStripSurface>();

/** What each host is drawing right now: the pane, and which of the two shapes it is in. */
const _drawing = new Map<HTMLElement, { paneId: string; mode: TabStripValues["mode"] }>();

/** Whether each pane's strip overflows — decides its chevron. Measured after each render. */
const _overflowing = new Map<string, boolean>();

let _overflowHandle: MenuHandle | null = null;

/** The tab id currently being dragged, or null. */
let _dragging: string | null = null;

/** Region id of a pane's tab strip. `ui/regions.ts` owns the grammar; this is one call site. */
export function paneStripRegion(paneId: string): string {
  return `pane.${paneId}/tabs`;
}

/**
 * Where a pane's strip renders, or null when the shell gives it nowhere.
 *
 * A pane with a region host of its own renders there. A pane WITHOUT one borrows the host the shell
 * handed over — the primary's — because that div is the shell's single strip exactly as
 * `#canvas-wrap` is its single stage. Two panes then name the same element, and {@link render}
 * gives it to the FOCUSED one, the same handover `canvas/canvas-render.ts`'s `handOverCanvasStage`
 * makes with the stage. Without it the strip printed a document that was not on screen: `⌘\` moved
 * the tab into the side pane, the stage showed it, and the strip went on drawing the primary's tabs
 * with the primary's chip marked active.
 *
 * The fallback is also what makes the primary work before `stampShellRegions()` has run — and in
 * the tests, which mount an unstamped node.
 */
function hostFor(pane: Pane): HTMLElement | null {
  return resolveRegion(paneStripRegion(pane.id)) ?? _primaryHost;
}

/**
 * Mount the tab strips. `host` is the PRIMARY pane's strip host.
 *
 * @param {HTMLElement} host
 */
export function mount(host: HTMLElement) {
  unmount();
  _primaryHost = host;
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      void workspace.activePaneId;
      for (const pane of workspace.panes) {
        void pane.id;
        void pane.tabOrder;
        void pane.activeTabId;
        /* NO DERIVATION READS HERE, and the three that were here are the clearest example in the
           package of a tracked input that tracks nothing. `render()` is called from inside this
           effect, synchronously, so every value its projections read IS a dependency —
           `derivationValues` reads `derived.kind`, `derived.preset` and `derived.media` to build
           the chip's label, and `project` reads `pane.derived` to choose the branch. Three
           `void` lines restating them could each be inverted with no test in the suite able to
           tell, because the behaviour they claimed to buy was already bought one function down.
           The loop reads below are a different case and stay: `render()` draws ONE pane per host,
           so a fact about a pane it does not draw — or about a tab in another pane's strip — has
           no reader inside this effect. */
      }
      for (const tab of workspace.tabs.values()) {
        void tab.doc.dirty;
        void tab.documentPath;
        void tab.pinned;
        void tab.preview;
        void tab.session.openedFrom;
        // The draft pill is on the chip, so the chip has to repaint when the flag changes — reading
        // The absent key tracks its ADDITION too, which is the transition that matters most.
        void tab.doc.content?.frontmatter?.[DRAFT_FIELD];
      }
      // An edit is a commitment: a preview tab with unsaved changes is no longer disposable, and
      // The dirty flags this effect already tracks are exactly the signal.
      promoteDirtyPreviewTabs();
      render();
    });
  });
}

export function unmount() {
  dismissOverflowMenu();
  dismissTabContextMenu();
  _scope?.stop();
  _scope = null;
  for (const strip of _strips.values()) {
    strip.dispose();
  }
  _strips.clear();
  _drawing.clear();
  _primaryHost = null;
  _dragging = null;
  _lastActive.clear();
  _overflowing.clear();
  _hosts.clear();
}

function render() {
  /* One host draws ONE pane. While the shell has a single strip, both panes resolve to the same
     div — and the one whose tabs are on screen is the focused one, so it wins the tie. Without
     that rule the answer was render order, which is how the strip came to mark a tab active in a
     pane the stage was not showing. When each pane has a host of its own there are no ties. */
  const claims = new Map<HTMLElement, Pane>();
  for (const pane of workspace.panes) {
    const host = hostFor(pane);
    if (host && (!claims.has(host) || isPaneFocused(pane.id))) {
      claims.set(host, pane);
    }
  }
  const drawn = new Set<string>();
  for (const [host, pane] of claims) {
    paint(pane, host);
    _hosts.set(pane.id, host);
    drawn.add(pane.id);
  }
  // A pane that has gone away — or that has lost the shared host to the pane now focused — leaves
  // Its last host behind. Take the document down, unless someone else has just drawn there, so no
  // Strip outlives the pane it belongs to.
  // Deleting the entry the loop is standing on is defined behaviour for a Map iterator.
  for (const [paneId, host] of _hosts) {
    if (drawn.has(paneId)) {
      continue;
    }
    _hosts.delete(paneId);
    _lastActive.delete(paneId);
    _overflowing.delete(paneId);
    if (!claims.has(host)) {
      _strips.get(host)?.dispose();
      _strips.delete(host);
      _drawing.delete(host);
    }
  }
}

/**
 * Put one pane's projection into one host — mounting the document the first time, assigning every
 * time after that.
 *
 * The assignment is the whole reason a strip survives a repaint: a keyed `$map` over `tabs` keeps
 * the node of every chip whose id survived, so the tab the reader is aiming at does not move under
 * them and the strip's scroll offset stays where they left it.
 */
function paint(pane: Pane, host: HTMLElement): void {
  const values = project(pane);
  _drawing.set(host, { mode: values.mode, paneId: pane.id });
  const standing = _strips.get(host);
  if (standing) {
    standing.update(values);
  } else {
    _strips.set(host, mountTabStripSurface(host, values, actionsFor(host)));
  }

  /* The strip is HELD — `surfaces/tab-strip.ts` takes it as the element is created — so this is an
     imperative USE of a node this module owns rather than a re-find of one it renders
     (studio-ui-guidelines.md §9.4). The chip is asked for by the state the KIT puts on it, which is
     the accessibility tree's own answer to "which tab is current".

     THE REVEAL IS RECORDED ONLY WHEN THERE WAS A STRIP TO REVEAL IT IN. A mount is asynchronous,
     so the first paint into a fresh host has no document yet — and moving `_lastActive` there
     anyway would consume the transition and leave the chip off-screen with nothing left to notice.
     That is exactly the case a derived pane produces: its strip is created the moment its one tab
     comes back. */
  const strip = _strips.get(host)?.strip();
  if (strip && pane.activeTabId !== _lastActive.get(pane.id)) {
    _lastActive.set(pane.id, pane.activeTabId);
    /* Found by the id the DOCUMENT stamped, not by `aria-selected`. The kit is the single writer
       of a tab's selected state and it writes it on a MutationObserver when the tab SET moved — a
       microtask later — so a strip whose one tab has just come back has no tab marked current at
       the instant this runs. The flow already knows which chip it wants; asking the tree instead
       is asking a question we have the answer to, and getting it one tick early. */
    ([...strip.children] as HTMLElement[])
      .find((chip) => chip.dataset.tab === pane.activeTabId)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  syncOverflow(pane, host);
}

/** The pane a host is drawing, or null when it is drawing none. */
function drawnPane(host: HTMLElement): Pane | null {
  const paneId = _drawing.get(host)?.paneId;
  return workspace.panes.find((pane) => pane.id === paneId) ?? null;
}

/**
 * What a gesture on one host's strip asks of the flow.
 *
 * Read ONCE, when that host's document is mounted, so every one of these closes over the host
 * rather than over a pane: the pane a host draws changes, and an action bound to the pane it was
 * mounted for would act on the wrong strip the first time the side pane took the stage.
 */
function actionsFor(host: HTMLElement): TabStripActions {
  return {
    activate: (id) => {
      activateTab(id);
    },
    closeTab: (id) => {
      void requestClose(id);
    },
    context: (id, x, y) => {
      const tab = workspace.tabs.get(id);
      if (tab) {
        openTabContextMenu(tab, x, y);
      }
    },
    dragEnd: onDragEnd,
    dragStart: onDragStart,
    drop: (index, transfer) => {
      onDrop(host, index, transfer);
    },
    focusPane: () => {
      focusPane(drawnPane(host)?.id ?? PRIMARY_PANE);
    },
    openTrailing: (anchor) => {
      openTrailing(host, anchor);
    },
    promote: (id) => {
      promoteTab(id);
    },
    togglePin: (id) => {
      const tab = workspace.tabs.get(id);
      if (tab) {
        setTabPinned(id, !tab.pinned);
      }
    },
    wheel: (_state, event) => {
      onWheel(event);
    },
  };
}

/**
 * What a lens pane's strip says: the projection, and the document it is a projection OF.
 *
 * Not a tab chip, and deliberately not close-able as a tab: a lens owns no document, so the ✕ here
 * runs `pane.unsplit` — the lens's only exit, because Pin is refused for a projection of a document
 * that already has a tab beside it (§14.1).
 */
function derivationValues(pane: Pane, derived: PaneDerivation): TabStripValues {
  const registry = activeRegistry();
  /* For a LENS the first read already hops to the source pane. For an unresolved COMPANION it
     answers null — the pane owns no tab yet — and the chip would say "no document" about a
     derivation that knows perfectly well what it is a projection OF. */
  const of = tabOfPane(pane.id) ?? tabOfPane(derived.sourcePaneId);
  /* THE CHIP FINISHES ITS OWN SENTENCE. Two of the presets are labelled with an unfinished phrase
     — "Same page at", "Same page in" — because the interesting half is the value: a strip reading
     "Same page in" over a French document says nothing the pane beside it did not already say. */
  const label =
    derived.kind === "lens" && derived.preset === "breakpoint"
      ? `${PRESET_LABELS.breakpoint} ${derived.media ? mediaDisplayName(derived.media) : "Base"}`
      : derived.kind === "companion" && derived.preset === "locale"
        ? `${PRESET_LABELS.locale} ${derived.locale ? localeLabel(derived.locale) : "—"}`
        : PRESET_LABELS[derived.preset];
  // A chip whose source pane shows nothing SAYS SO: a sentence with its subject missing, in the
  // One row that says what the pane is, is worse than the sentence it replaces.
  const subject = of ? tabLabel(of) : "no document";
  return {
    active: "",
    chipTitle: `${label} · ${of?.documentPath ?? "no document"}`,
    focused: isPaneFocused(pane.id),
    mode: "derivation",
    preset: label,
    stripLabel: stripLabel(pane),
    subject,
    tabs: [],
    trailing: true,
    trailingGlyph: "✕",
    trailingTitle: registry?.get("pane.unsplit")?.title ?? "Close Side Pane",
  };
}

/**
 * The tablist's accessible name.
 *
 * A `tablist` takes no name from its tabs and no lint can say so, because a bound role switches the
 * naming rules off (`ui.md` §5.4). With two panes on screen there are two tablists, so the name
 * says which — "Open documents" alone would announce the same words over both.
 */
function stripLabel(pane: Pane): string {
  return pane.id === PRIMARY_PANE ? "Open documents" : "Open documents in the side pane";
}

/** A strip with nothing to say: the row is hidden outright rather than left as an empty band. */
function blankValues(pane: Pane): TabStripValues {
  return {
    active: "",
    chipTitle: "",
    focused: isPaneFocused(pane.id),
    mode: "empty",
    preset: "",
    stripLabel: stripLabel(pane),
    subject: "",
    tabs: [],
    trailing: false,
    trailingGlyph: "",
    trailingTitle: "",
  };
}

/** Everything one host's document draws, decided here so the document decides nothing. */
function project(pane: Pane): TabStripValues {
  /* A LENS pane has no tabs and must not have an empty strip: its `tabOrder` is `[]` BY DESIGN, so
     the branch below would blank the one row that says what the pane is. It draws a derivation chip
     instead — the preset, what it is a projection of, and the two exits. A COMPANION owns real tabs
     and draws them, because that is what it is. */
  const { derived } = pane;
  /* ONE condition, not two. This read `derived.kind === "lens" || pane.tabOrder.length === 0`, and
     the first disjunct could be inverted with nothing in the suite able to notice — invariant D2
     says a lens owns no tab, `applyDerivation` hands back anything it finds, and the only writer
     that could put one there (`moveTabToPane`, through `revealOpenTab`) is reached solely by
     `openFileInPane`, which the follow calls for COMPANIONS. So the second disjunct is already
     total over a lens and the first chose nothing. */
  if (derived && pane.tabOrder.length === 0) {
    /* A COMPANION whose rule has not resolved reaches this too, and it has to. Its `tabOrder` is
       empty for a different reason than a lens's — the document it wants is not open YET, or the
       selection has nothing under it — and the branch below drew nothing: a pane with no chip,
       no ✕ and no way out, which `paneIsEmpty` will not collapse because the derivation counts as
       a subject. The chip is the pane's name and its exit.
       NO `_lastActive` / `_overflowing` RESET HERE, and both were, until each was shown to be a
       write nothing can read. `_overflowing` is measured by {@link syncOverflow} at the end of
       every ordinary render, inside the same synchronous call, so a stale `true` carried through a
       derivation is corrected before any frame sees it. `_lastActive` cannot survive the round trip
       either: a tab can only come back through `insertIntoPane` and then `activateTab`, which are
       two reactive writes and therefore two renders, and the first of them lands here with
       `tabOrder` full and `activeTabId` still `null` — which resets the field anyway. Both were
       written as bookkeeping and both were unfalsifiable; the branch below owns the answer. */
    return derivationValues(pane, derived);
  }
  if (pane.tabOrder.length === 0) {
    _lastActive.set(pane.id, null);
    _overflowing.set(pane.id, false);
    return blankValues(pane);
  }

  const labels = tabLabels(pane);
  return {
    active: pane.activeTabId ?? "",
    chipTitle: "",
    focused: isPaneFocused(pane.id),
    mode: "tabs",
    preset: "",
    stripLabel: stripLabel(pane),
    subject: "",
    tabs: pane.tabOrder.flatMap((id, index) => chipView(pane, id, index, labels)),
    trailing: _overflowing.get(pane.id) === true,
    trailingGlyph: "⌄",
    // ONE accessible name (§10): the glyph is hidden, so `title` is both the tooltip and the name
    // — `title` + a matching `aria-label` would announce it twice.
    trailingTitle: "Show hidden tabs",
  };
}

/**
 * One chip, as a value.
 *
 * Every field is already decided: the document asks no question about a tab, and there is no branch
 * in it a projection has not already taken. A tab that has gone between the pane's order and this
 * call contributes no chip at all, which is what the empty array is for.
 *
 * @param {Pane} pane
 * @param {string} id
 * @param {number} index — the chip's slot in the pane's order, which is the drop target index
 * @param {Map<string, string>} labels
 */
function chipView(
  pane: Pane,
  id: string,
  index: number,
  labels: Map<string, string>,
): TabChipView[] {
  const tab = workspace.tabs.get(id);
  if (!tab) {
    return [];
  }
  /* The draft pill (§7.6). On the CHIP, not only inside the entry editor: the mistake this
     prevents — publishing something you believed was private — is made while glancing at a row of
     tabs, and it is made about a document that may not even be the active one. */
  const pill = entryDraftPill(tab);
  return [
    {
      dirty: tab.doc.dirty,
      draft: pill?.draft ?? false,
      dragging: _dragging === id,
      index,
      key: id,
      label: labels.get(id) ?? "Untitled",
      origin: Boolean(tab.session.openedFrom),
      pill: pill?.text ?? "",
      pillTitle: pill?.title ?? "",
      pinGlyph: tab.pinned ? "◉" : "◎",
      pinTitle: tab.pinned ? "Unpin" : "Pin",
      pinned: tab.pinned,
      preview: tab.preview,
      // A control inside a tab is in the tab order only while its tab is the current one, which is
      // What keeps a strip of fifteen documents ONE stop rather than fifteen (`ui.md` §5.4).
      tabindex: id === pane.activeTabId ? "0" : "-1",
      title: tabTooltip(tab),
    },
  ];
}

// ─── Drag reorder ─────────────────────────────────────────────────────────────

function onDragStart(id: string, transfer: DataTransfer | null) {
  _dragging = id;
  transfer?.setData("text/plain", id);
  if (transfer) {
    transfer.effectAllowed = "move";
  }
  // The ghost is chrome state, not model state, so no effect fires for it.
  render();
}

function onDragEnd() {
  _dragging = null;
  render();
}

/**
 * Drop onto the chip at `index`. The model clamps the destination into the region the dragged tab's
 * pinned state allows, so this only has to say where the pointer was.
 */
function onDrop(host: HTMLElement, index: number, transfer: DataTransfer | null) {
  const pane = drawnPane(host);
  const id = _dragging ?? transfer?.getData("text/plain") ?? null;
  _dragging = null;
  if (!pane || !id || !pane.tabOrder.includes(id)) {
    return;
  }
  moveTab(id, index);
}

/**
 * Re-measure a pane's strip and re-project once if the chevron's presence changed.
 *
 * Measurement can only happen after the document has written the DOM, so this runs at the tail of
 * {@link paint} and guards its own re-entry on the boolean actually flipping — the chevron cannot
 * oscillate. Before the mount resolves there is no strip to measure and nothing to correct: the
 * next repaint measures it, and a strip that overflows on its first frame has no hidden tab a
 * reader could be looking for yet.
 */
function syncOverflow(pane: Pane, host: HTMLElement) {
  const surface = _strips.get(host);
  const strip = surface?.strip();
  if (!surface || !strip) {
    return;
  }
  const overflowing = strip.scrollWidth > strip.clientWidth;
  if (overflowing !== (_overflowing.get(pane.id) === true)) {
    _overflowing.set(pane.id, overflowing);
    surface.update(project(pane));
  }
}

/**
 * The trailing button: the overflow chevron, or a derived pane's ✕.
 *
 * One control in one place, so which of the two it is comes from what the host is DRAWING rather
 * than from a second condition re-derived here.
 */
function openTrailing(host: HTMLElement, anchor: HTMLElement | null) {
  const pane = drawnPane(host);
  if (!pane) {
    return;
  }
  if (_drawing.get(host)?.mode === "derivation") {
    const registry = activeRegistry();
    void registry?.run("pane.unsplit");
    return;
  }
  openOverflowMenu(pane, tabLabels(pane), anchor);
}

/**
 * Scroll the strip horizontally from wheel motion so overflowed tabs stay reachable — a plain mouse
 * wheel only emits deltaY, which does nothing in an overflow-x container. The scrollbar is hidden
 * by design; the overflow chevron is the pointer-independent route to the same tabs.
 *
 * @param {WheelEvent} e
 */
function onWheel(e: WheelEvent) {
  if (e.ctrlKey) {
    return;
  }
  const el = e.currentTarget as HTMLElement;
  if (el.scrollWidth <= el.clientWidth) {
    return;
  }
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (!delta) {
    return;
  }
  e.preventDefault();
  el.scrollLeft += delta;
}

// ─── Overflow menu ────────────────────────────────────────────────────────────

/**
 * Tab ids whose chip is wholly or partly outside a pane strip's scroll viewport.
 *
 * @param {string} [paneId] — defaults to the focused pane
 */
export function hiddenTabIds(paneId: string = workspace.activePaneId): string[] {
  const pane = workspace.panes.find((candidate) => candidate.id === paneId);
  // The host the pane actually DREW into, not the one it would resolve: a pane with no strip on
  // Screen has no chips out of view, and measuring another pane's strip would invent some.
  const host = _hosts.get(paneId);
  const strip = host ? (_strips.get(host)?.strip() ?? null) : null;
  if (!pane || !strip) {
    return [];
  }
  const left = strip.scrollLeft;
  const right = left + strip.clientWidth;
  const hidden: string[] = [];
  const chips = [...strip.querySelectorAll('[part="tab"]')] as HTMLElement[];
  for (const [index, chip] of chips.entries()) {
    const id = pane.tabOrder[index];
    if (id && (chip.offsetLeft < left || chip.offsetLeft + chip.offsetWidth > right)) {
      hidden.push(id);
    }
  }
  return hidden;
}

export function dismissOverflowMenu() {
  _overflowHandle?.close();
  _overflowHandle = null;
}

/**
 * List the off-screen tabs. Falls back to every tab when nothing measures as hidden, because an
 * empty menu is a dead control and happy-dom (plus any zero-height layout) measures everything at
 * 0.
 *
 * **The kit menu, not a popover of this strip's own** (guidelines §8.4). `surfaces/menu.ts` owns
 * the panel, the roving caret, the typeahead, Escape and the light dismissal, and it clamps the
 * panel into the viewport once it has been laid out — so the `right:`/`top:` arithmetic that used
 * to sit in a style attribute here is one `place` callback, measured against the panel's real box
 * instead of guessed from the chevron's.
 *
 * A row states whether it is the tab the pane is already showing. The strip's own chips carry that
 * as `aria-selected`, and a menu row cannot: `checked` on every row is the shape this shell already
 * settled on for one-of-N (`panels/pane-context.ts`'s scheme, media and locale menus), and it is
 * what makes the current tab announce itself rather than merely look different.
 *
 * @param {Pane} pane
 * @param {Map<string, string>} labels
 * @param {HTMLElement | null} anchorEl — the chevron that was pressed, as the document hands it
 *   over
 */
function openOverflowMenu(pane: Pane, labels: Map<string, string>, anchorEl: HTMLElement | null) {
  dismissOverflowMenu();
  const hidden = hiddenTabIds(pane.id);
  const ids = hidden.length > 0 ? hidden : [...pane.tabOrder];
  const anchor = rectOf(anchorEl ?? document.body);
  _overflowHandle = openMenu({
    /* The trigger says "Show hidden tabs" and this is the panel it opens, so it takes the same
       words: a control and the panel it opens announcing two different things is a menu the
       reader has to re-identify after opening it. */
    label: "Hidden tabs",
    onClosed: (handle) => {
      if (_overflowHandle === handle) {
        _overflowHandle = null;
      }
    },
    opener: anchorEl,
    /* Right-aligned under the chevron, which is a function of the panel's own WIDTH — so it is a
       `place` callback rather than an `origin`, run once the popover has been laid out. */
    place: (box) => ({ x: Math.max(4, anchor.right - box.width), y: anchor.bottom }),
    region: "tab-overflow",
    rows: ids.map((id) => ({
      checked: (id === pane.activeTabId ? "true" : "false") as "true" | "false",
      destructive: false,
      disabled: false,
      dividerAbove: false,
      id,
      run: () => {
        activateTab(id);
      },
      title: labels.get(id) ?? "Untitled",
    })),
  });
}

// ─── Context menu ─────────────────────────────────────────────────────────────

let _tabCtxHandle: MenuHandle | null = null;

/** Dismiss the tab context menu if open. */
export function dismissTabContextMenu() {
  _tabCtxHandle?.close();
  _tabCtxHandle = null;
}

/**
 * A tab addresses ONE document, and this is everything the chip can say about it — keyed by the
 * ARGUMENT NAME that asks for it.
 *
 * The whole `context/tab` placement asks for exactly one argument today: `content.setDraft
 * {draft}`. The other five records take none, because they read the ACTIVE document — which is why
 * {@link openTabContextMenu} activates the chip before it builds a single row.
 *
 * A fact is stated ONLY when it is true of this tab, and that is what decides whether a command
 * appears at all: `styles/main.css` is an entry of no collection, so it states no `draft`, so "Set
 * Draft" is not offered on it. The condition is `collectionOfPath` — the same question
 * `content.setDraft`'s own `enablement` asks — so the menu never invents a rule the command does
 * not have, and never renders a row into a refusal.
 *
 * The VALUE is the state the row would reach, not the state the tab is in: a setter is named for
 * where it lands (`content/draft-state.ts` says why), so the row offers the flip of what is true
 * now and {@link statedChecked} reads the current state back out of it for the checkmark.
 */
function tabRowFacts(tab: Tab): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  if (collectionOfPath(tab.documentPath)) {
    facts.draft = !isDraftEntry(entryFields(tab));
  }
  return facts;
}

/**
 * The state a row is IN, derived from the state it would reach — `"true"`, `"false"`, or
 * `undefined` when the record says nothing about state.
 *
 * A menu is the one surface that is READ before it is used, so it is the one surface that can show
 * a boolean instead of asking the author to remember it. That is an argument for the SETTER over
 * the toggle, and it is why this is derived from the args rather than from a list of command ids:
 * `content.setDraft {draft}` names the state it reaches, so the row can say which state the tab is
 * in now and still land somewhere definite when clicked. `document.togglePinned` names no state —
 * "Pin / Unpin Document" is a title that admits it does not know which it will do — so it renders
 * as a plain row here. Its idempotent sibling `document.setPinned {pinned}` would state its own
 * value, with no edit to this file, on the day its record declares `context/tab`; that declaration
 * lives in `workspace/workspace.ts`, which is the only place it can be made.
 *
 * **It is a real checkbox row now, which it could not be under Spectrum.** `sp-menu` reassigned
 * every item's role one frame after connect whenever the menu declared no `selects`, so
 * `role="menuitemcheckbox"` did not survive and the state had to be printed as a sentence ("Draft:
 * no") in the description line instead. `jx-menu-item` derives `role` and `aria-checked` from
 * `checked` and nothing rewrites them, so the row states the boolean the way a screen reader
 * already knows how to announce — and the five rows that carry no state stay plain `menuitem`s,
 * which `selects` on the old menu would have made impossible.
 */
function statedChecked(args: Record<string, unknown>): "true" | "false" | undefined {
  const entries = Object.entries(args);
  const only = entries.length === 1 ? entries[0] : undefined;
  if (!only || typeof only[1] !== "boolean") {
    return undefined;
  }
  // The fact is the state the row would REACH, so the state it is in now is the negation.
  return only[1] ? "false" : "true";
}

/**
 * The declared `context/tab` commands this chip can offer.
 *
 * Everything a row prints comes off the record — its title, its position (`forPlacement` sorts by
 * `group`, and a change of group draws the divider), whether it is enabled and the sentence saying
 * why not. Nothing here names a command, so a new `context/tab` record appears in the strip with no
 * edit to this file — and with no registry published there are no rows at all, because every row
 * there has ever been came from one.
 */
function placedTabItems(tab: Tab): MenuRowProjection[] {
  const registry = activeRegistry();
  if (!registry) {
    return [];
  }
  const facts = tabRowFacts(tab);
  const items: MenuRowProjection[] = [];
  let group: string | undefined;
  for (const command of registry.forPlacement("context/tab")) {
    const schema = command.args as
      | { properties?: Record<string, unknown>; required?: readonly string[] }
      | undefined;
    if (!(schema?.required ?? []).every((key) => key in facts)) {
      continue;
    }
    const args: Record<string, unknown> = {};
    for (const key of Object.keys(schema?.properties ?? {})) {
      if (key in facts) {
        args[key] = facts[key];
      }
    }
    const dividerAbove = items.length > 0 && command.group !== group;
    ({ group } = command);
    const reason = registry.disabledReason(command.id);
    const checked = statedChecked(args);
    items.push({
      destructive: command.destructive === true,
      dividerAbove,
      id: command.id,
      title: command.title,
      ...(checked === undefined ? {} : { checked }),
      ...(reason === undefined
        ? {
            disabled: false,
            run: () => {
              void registry.run(command.id, args);
            },
          }
        : { disabled: true, requires: reason }),
    });
  }
  return items;
}

/**
 * Open the menu on a chip.
 *
 * **Activating first is the wiring, not a courtesy.** Five of the six `context/tab` records read
 * `workspace.activeTabId` and the sixth reads `activeTab.value`, and the registry rebuilds its
 * context on every `forPlacement` / `disabledReason` / `run` call. Build the rows without
 * activating and the menu states the OTHER tab's enablement — "Keep Document Open" greyed out over
 * a preview tab — and then acts on the other tab too. Activation makes the tab the author aimed at
 * the one the records are talking about, which is what every list does on right-click anyway.
 *
 * With nothing declared, no menu opens: an empty popover is a dead control, the same judgement the
 * overflow chevron makes one section up.
 *
 * The `preventDefault` and the `stopPropagation` a right-click needs are the DOCUMENT's, written
 * beside the gesture that needs them (`surfaces/tab-strip.json`), so what arrives here is the tab
 * and the point — which is everything a menu is a function of.
 *
 * **The rows go to the kit menu** (`surfaces/menu.ts`, guidelines §12.5), which is why there is no
 * row template in this file any more. Three things that were written here went with it: the clamp
 * that kept a right-click near the screen edge readable — `onMenuToggle` clamps every panel once it
 * has been laid out, against the panel's real box rather than a guessed one — the `Needs …` line a
 * disabled row prints, and the refusal to dismiss when a disabled row is clicked, which is
 * `jx-menu-item`'s own `onClick` guard.
 */
function openTabContextMenu(tab: Tab, clientX: number, clientY: number) {
  dismissTabContextMenu();
  dismissOverflowMenu();
  activateTab(tab.id);

  const rows = placedTabItems(tab);
  if (rows.length === 0) {
    return;
  }

  _tabCtxHandle = openMenu({
    label: "Tab actions",
    onClosed: (handle) => {
      if (_tabCtxHandle === handle) {
        _tabCtxHandle = null;
      }
    },
    origin: { x: clientX, y: clientY },
    region: "tab",
    rows,
  });
}

// ─── Labels ───────────────────────────────────────────────────────────────────

/** One tab as the labeller sees it. */
export interface LabelInput {
  id: string;
  documentPath: string | null;
  /** What to show when there is no path at all (a virtual grid tab, an untitled document). */
  fallback: string;
}

/**
 * A page's route, or null when the path is not a page.
 *
 * `pages/blog/[slug].md` → `/blog/[slug]`, `pages/about/index.md` → `/about`, `pages/index.md` →
 * `/`. The route is what the author named the thing; the file name is an implementation detail of
 * the router, and it is the same word (`index`) for every section of the site.
 *
 * @param {string} path
 * @returns {string | null}
 */
export function pageRoute(path: string): string | null {
  const normalized = path.replace(/^\.\//, "");
  if (!normalized.startsWith("pages/")) {
    return null;
  }
  const withoutExt = normalized.slice("pages/".length).replace(/\.[^./]+$/, "");
  const segments = withoutExt.split("/").filter((segment) => segment !== "");
  if (segments.at(-1) === "index") {
    segments.pop();
  }
  return `/${segments.join("/")}`;
}

/**
 * Give every tab the shortest path suffix that tells it apart from the others.
 *
 * Pages label by route and are exempt from the widening loop — two distinct files cannot produce
 * one route. Everything else starts at its basename and grows one leading segment at a time, but
 * only within the group that actually collides, so one pair of `index.json` files does not push a
 * path onto every other tab in the strip.
 *
 * @param {LabelInput[]} inputs
 * @returns {Map<string, string>} Tab id → label
 */
export function computeTabLabels(inputs: LabelInput[]): Map<string, string> {
  interface Entry {
    id: string;
    parts: string[];
    depth: number;
    label: string;
    fixed: boolean;
  }
  const entries: Entry[] = inputs.map((input) => {
    const path = input.documentPath;
    if (!path) {
      return { depth: 0, fixed: true, id: input.id, label: input.fallback, parts: [] };
    }
    const route = pageRoute(path);
    if (route !== null) {
      return { depth: 0, fixed: true, id: input.id, label: route, parts: [] };
    }
    const parts = path.split("/").filter((segment) => segment !== "" && segment !== ".");
    return {
      depth: 1,
      fixed: false,
      id: input.id,
      label: parts.slice(-1).join("/") || path,
      parts,
    };
  });

  // Each pass widens exactly the entries that still collide. It terminates because every pass
  // Either widens at least one entry (bounded by its segment count) or changes nothing.
  for (;;) {
    const groups = new Map<string, Entry[]>();
    for (const entry of entries) {
      const group = groups.get(entry.label);
      if (group) {
        group.push(entry);
      } else {
        groups.set(entry.label, [entry]);
      }
    }
    let widened = false;
    for (const group of groups.values()) {
      if (group.length < 2) {
        continue;
      }
      for (const entry of group) {
        if (entry.fixed || entry.depth >= entry.parts.length) {
          continue;
        }
        entry.depth += 1;
        entry.label = entry.parts.slice(-entry.depth).join("/");
        widened = true;
      }
    }
    if (!widened) {
      break;
    }
  }

  return new Map(entries.map((entry) => [entry.id, entry.label]));
}

/**
 * Labels for the tabs in one pane, keyed by tab id.
 *
 * Disambiguation is per-pane on purpose: the strip is what has to be readable, and widening a label
 * because a tab in the OTHER pane collides with it would make one strip harder to read to solve a
 * problem nobody can see.
 *
 * @param {Pane} pane
 */
function tabLabels(pane: Pane): Map<string, string> {
  return computeTabLabels(
    pane.tabOrder.flatMap((id) => {
      const tab = workspace.tabs.get(id);
      return tab
        ? [
            {
              documentPath: tab.documentPath,
              fallback: gridTabLabel(tab.id) ?? "Untitled",
              id,
            },
          ]
        : [];
    }),
  );
}

/**
 * The hover text: the full path, plus the document this tab was drilled in from.
 *
 * @param {Tab} tab
 * @returns {string}
 */
function tabTooltip(tab: Tab): string {
  const base = tab.documentPath || gridTabLabel(tab.id) || "Untitled";
  const origin = tab.session.openedFrom;
  const withOrigin = origin?.documentPath ? `${base}\nOpened from ${origin.documentPath}` : base;
  return tab.preview ? `${withOrigin}\nPreview — double-click to keep open` : withOrigin;
}

/**
 * The label a single tab shows. Exported for the close-confirmation copy, which names one tab with
 * no strip to disambiguate it against.
 *
 * @param {Tab} tab
 * @returns {string}
 */
export function tabLabel(tab: Tab): string {
  const path = tab.documentPath;
  if (!path) {
    return gridTabLabel(tab.id) ?? "Untitled";
  }
  return pageRoute(path) ?? path.split("/").at(-1) ?? path;
}

/**
 * True when closing this tab would lose unsaved work the user must be warned about: the tab is
 * dirty AND either it is not co-edited, or this client is the last active collaborator on the doc
 * (no other peer is focused on its path). When peers remain, the shared session lives on and the
 * edits are still on the server, so closing is safe.
 *
 * **`dirty` is not the whole question, because a Monaco buffer can hold work the document has never
 * received.** `requestClose` flushes the armed commit before asking, so ordinary typing IS dirty by
 * the time we get here — but a commit is allowed to fail to land (unparseable source keeps the
 * buffer rather than resyncing over a half-typed heading), and that text exists nowhere else.
 * {@link tabBufferUnsaved} is that residue, and it is the user's own typing by construction.
 *
 * @param {Tab} tab
 */
export function shouldWarnOnClose(tab: Tab): boolean {
  const residue = tabBufferUnsaved(tab);
  if (!tab.doc.dirty && !residue) {
    return false;
  }
  const state = collabState(tab);
  if (!state.active) {
    return true;
  }
  // "Peers remain, so the edits are still on the server" holds only for a client whose edits REACH
  // The server. A read-only client publishes nothing (`collabReadOnly`), so its work is in this
  // Browser and nowhere else, and the room being busy is no comfort at all.
  if (collabReadOnly(tab)) {
    return true;
  }
  /* AND THE FREEZE IS THE SECOND WAY EDITS DO NOT REACH THE SERVER. Buffer residue is by
     construction text `onTransact` never saw — `commitTabBuffers` ran above this gate and the write
     was refused, so nothing was ever published, mirrored or written to disk. It is in this browser
     and nowhere else for EVERY client, not merely for a read-only one, so no peer count can make it
     safe. Worse, the two predicates are the same predicate under the source-canonical freeze: the
     lock holder is by definition a peer focused on this path, so the busier the room got, the
     quieter the close became. Asked before the peer count rather than after, because the peer count
     has no jurisdiction over text the room has never been told about. */
  if (residue) {
    return true;
  }
  const peersHere = state.peers.filter((p) => p.state?.focusedPath === tab.documentPath);
  return peersHere.length === 0;
}

/**
 * Why a save is not one of the ways out of this tab, or `null` when it is.
 *
 * §14.7: a dialog may not offer an answer the app cannot honour. Two states make "Save" a button
 * that would run and still not write what is on screen, and they are different sentences because
 * they are different situations to be in.
 *
 * **The buffer case is the one that was being got wrong.** `requestClose` commits every buffer
 * before it asks anything, so by the time this runs a `typed()` buffer means the commit could not
 * land: unparseable source deliberately keeps the buffer rather than resyncing over a half-typed
 * heading, the collab freeze refuses the dock's body write outright, and a commit that threw is
 * reported and stepped over. In every one of those the document does not contain the text the
 * author is looking at — so `saveFile` would write the file WITHOUT it, stamp "Saved just now", and
 * close the tab. The prompt appeared, the author chose the careful answer, and the work went
 * anyway.
 */
function saveUnavailableReason(tab: Tab): string | null {
  if (collabReadOnly(tab)) {
    return (
      `You have read access to this session, so "${tabLabel(tab)}" has changes that were never ` +
      `published and have nowhere to be saved. Closing discards them.`
    );
  }
  if (tabBufferUnsaved(tab)) {
    return (
      `"${tabLabel(tab)}" has text in its editor that the document could not be given — the ` +
      `source does not parse, or a collaborator holds the source lock. Saving would write the ` +
      `file without it, so it is not offered. Closing discards that text.`
    );
  }
  return null;
}

/**
 * Ask what to do about a tab that is about to close over unsaved work. True means go ahead.
 *
 * **Two dialogs, because there are two situations and only one of them has three answers.** Save /
 * Discard / Cancel is right when a save would do something. When it would not — see
 * {@link saveUnavailableReason} — offering the button anyway would put a control that cannot work
 * on the one dialog whose entire job is to be trusted about unsaved work. Those cases get the
 * honest pair: discard, or keep editing.
 */
async function confirmClose(tab: Tab): Promise<boolean> {
  const cannotSave = saveUnavailableReason(tab);
  if (cannotSave) {
    return showConfirmDialog("Changes Cannot Be Saved", cannotSave, {
      cancelLabel: "Keep Editing",
      confirmLabel: "Close Without Saving",
      destructive: true,
    });
  }
  const answer = await showSaveDiscardDialog(
    "Unsaved Changes",
    `"${tabLabel(tab)}" has unsaved changes.`,
    { discardLabel: "Close Without Saving" },
  );
  if (answer === "cancel") {
    return false;
  }
  // A failed save must not close the tab: treating "Save" as "save and then close regardless" turns
  // A write error the user just watched into the loss the prompt existed to prevent.
  return answer === "discard" || (await saveFile(tab));
}

/**
 * Close a tab, offering to save first when closing would lose unsaved work.
 *
 * **Three ways out, not two.** This asked "Close without saving?" over a two-way confirm, so the
 * only buttons were the one that threw the work away and the one that did nothing — a dialog that
 * cannot do the thing the user most likely wants. §8.7's table assigns "Unsaved-work decisions" to
 * `showSaveDiscardDialog`, and this is that decision — except when a save is not one of the ways
 * out at all, which is {@link confirmClose}'s job to tell apart.
 *
 * **A failed save must not close the tab.** `saveFile` reports its own failures and returns whether
 * the bytes landed; treating "Save" as "save and then close regardless" would turn a write error
 * the user just watched into the loss the prompt existed to prevent. It stays open, still dirty,
 * with the error in Problems.
 *
 * The tab is passed to `saveFile` explicitly: a × is clicked on tabs that are not focused, and the
 * default target is the focused one.
 *
 * Exported because ⌘W is the same action. `editor/shortcuts.ts` used to re-implement it — down to
 * copying the wording out of this file — which is exactly how the two drifted apart the last time.
 *
 * @param {string} id
 */
export async function requestClose(id: string) {
  const tab = workspace.tabs.get(id);
  if (!tab) {
    return;
  }
  /* THE CLOSE IS A WRITE BEFORE IT IS A QUESTION.
     Both unsaved-work gates read `tab.doc.dirty`, and a Monaco buffer's armed commit has not
     dirtied anything yet — so typing the last character of a handler and pressing ⌘W closed the tab
     with no prompt and took the last 500ms (dock) / 600ms (source) of typing with it. A disposer
     cannot cover this: `closeTab` below deletes the tab first, and every commit checks `tabIsLive`
     precisely so it will not write into a tab nobody can read.
     The source view's commit parses through the format host before it assigns, and the next line
     reads the result, so this is awaited. */
  await commitTabBuffers(tab);
  /* AND THE TAB MAY BE GONE, because that await is a window and everything below acts on `tab`.
     `closeAllTabs` (project switch, project close) and the preview slot's replacement both destroy
     a tab synchronously from an event this close is not ordered against, so the flush's own
     duration is enough. Everything below is then addressed to a tab nobody can see: the freeze is a
     prompt about a document that is no longer on screen, and `saveFile(tab)` on its Save button is
     a WRITE — of `tab.documentPath`, which is project-relative, through a `platform.projectRoot`
     that the project switch has already moved. The old project's document, written into the new
     project, at the same relative path.
     Re-read by id rather than trusting the captured object: identity survives destruction, and
     membership of `workspace.tabs` is the fact `tabIsLive` is defined as. */
  if (!workspace.tabs.has(id)) {
    return;
  }
  if (shouldWarnOnClose(tab) && !(await confirmClose(tab))) {
    return;
  }
  closeTab(id);
}

/**
 * Ask about EVERY open tab at once, before something destroys them all. True means go ahead.
 *
 * `workspace.closeAllTabs()` disposes the lot with no gate of any kind, and one caller reaches it
 * from a gesture that loses work: activating another project. Every dirty document went, silently,
 * with no dialog anywhere on the path. It was the last unguarded destroyer in the matrix — ⌘W, the
 * ×, quitting and the preview slot's replacement each acquired one, and this one predates them
 * all.
 *
 * **One prompt, not N.** A project switch is a single decision; walking the author through six
 * dialogs to make it is how a prompt becomes something to click past. The count is in the sentence
 * instead, because "3 documents have unsaved changes" is the fact that decides the answer.
 *
 * **The same three rules as {@link confirmClose}, applied to the set.** {@link shouldWarnOnClose}
 * is the one definition of "closing this loses work" — it already knows about collab peers who
 * still hold the room, read-only sessions and buffers the document never received — so the set is
 * whatever it says yes to.
 *
 * **§14.7 says a dialog may not offer an answer the app cannot honour; it does not say to withdraw
 * one it can.** The blocked check used to be all-or-nothing, so an author with five dirty documents
 * and one unparseable source buffer was offered "Close Without Saving" or "Keep Editing" — and the
 * forward answer threw away four documents that would have written perfectly. The rule the button
 * has to satisfy is that its LABEL is true: "Save All" is a lie when one of them cannot be saved,
 * and `Save 4 of 5` is not. So the split is named in the sentence, the count is on the button, and
 * the only prompt that drops to the honest pair is the one where nothing at all can be written.
 *
 * **A failed save cancels the switch.** Same reason as the single-tab close: an author who watched
 * a write fail must not then watch the document be discarded because they had asked to save it.
 *
 * @param {string} action What the confirmation is for, e.g. "Opening another project".
 * @returns {Promise<boolean>} True to proceed with the destruction.
 */
export async function confirmCloseAll(action: string): Promise<boolean> {
  // The close is a write before it is a question, for a set exactly as for one tab. At most two
  // Monaco buffers are mounted app-wide, so this is a no-op for every tab but theirs. Snapshotted,
  // Because each commit is an await and the map is live.
  const open = [...workspace.tabs.values()];
  for (const tab of open) {
    await commitTabBuffers(tab);
  }
  const unsaved = [...workspace.tabs.values()].filter((tab) => shouldWarnOnClose(tab));
  if (unsaved.length === 0) {
    return true;
  }
  const count =
    unsaved.length === 1
      ? `"${tabLabel(unsaved[0]!)}" has unsaved changes`
      : `${unsaved.length} documents have unsaved changes`;
  const blocked = unsaved.filter((tab) => saveUnavailableReason(tab) !== null);
  const saveable = unsaved.filter((tab) => saveUnavailableReason(tab) === null);
  const blockedNames =
    blocked.length === 1 ? `"${tabLabel(blocked[0]!)}"` : `${blocked.length} of them`;
  if (saveable.length === 0) {
    // Nothing to offer: every dirty document in the set would be written without the text the
    // Author is looking at, so there is no honourable Save and the pair is the whole truth.
    return showConfirmDialog(
      "Changes Cannot Be Saved",
      `${action} closes every open document, and ${count}. ${blockedNames} cannot be ` +
        `saved at all, so saving would leave work behind. Closing discards it.`,
      { cancelLabel: "Keep Editing", confirmLabel: "Close Without Saving", destructive: true },
    );
  }
  const answer = await showSaveDiscardDialog(
    "Unsaved Changes",
    blocked.length === 0
      ? `${action} closes every open document, and ${count}.`
      : `${action} closes every open document, and ${count}. ${blockedNames} cannot be saved at ` +
          `all — saving writes the other ${saveable.length} and discards ` +
          `${blocked.length === 1 ? "that one" : "those"}.`,
    {
      discardLabel: "Close Without Saving",
      saveLabel: blocked.length === 0 ? "Save All" : `Save ${saveable.length} of ${unsaved.length}`,
    },
  );
  if (answer === "cancel") {
    return false;
  }
  if (answer === "discard") {
    return true;
  }
  // The blocked ones are deliberately not attempted: `saveFile` would report success for a write
  // That left the buffer's text behind, which is the whole reason they were named on the button.
  for (const tab of saveable) {
    if (!(await saveFile(tab))) {
      return false;
    }
  }
  return true;
}
