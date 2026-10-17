/// <reference lib="dom" />
/**
 * Right panel — the Inspector dock: three tabs, five views, one column (§6).
 *
 * **Page · Element · Assistant**, text-labelled. Page is the open document's own settings (the
 * former Navigator Page panel, re-hosted), titled for what the document is: Page, Template,
 * Component, Entry or Document. Element is the selected node, and keeps the three views the strip
 * used to spend three tabs on — Content, Style, Logic — behind a sub-switch in its body. The
 * Assistant is folded in from the grid column it used to own, which is the point of §3.1's "no
 * assistant column": an inspector tab costs zero additional width.
 *
 * The five LEAVES stay addressable (`shell.ts`'s `INSPECTOR_TAB_IDS`): `view.setRightTab { tab:
 * "style" }` shows Element with Style chosen, and ⌘⇧1–5 follow the leaves left to right.
 *
 * **The strip follows the selection, and yields to the author.** When the selection goes from empty
 * to non-empty while Page is showing, the strip switches to Element on the leaf last used there;
 * when it becomes empty while Element is showing, it switches to Page. Only the TRANSITION
 * switches: a tab the author clicks is kept until the selection next crosses empty, and the
 * Assistant is never switched away from.
 *
 * **This file no longer draws anything.** The dock's markup, its ARIA and its style are
 * `surfaces/inspector-dock.json`, mounted through `surfaces/inspector-dock.ts`; what is left here
 * is the flow — which leaf is selected, what the tab is pointed at, and which of the five seams
 * each body host is handed to. Two things came out of the move:
 *
 * - **The strip is a real `tablist`.** It was `sp-tabs` with no `tabpanel` on the other end, so the
 *   four bodies were anonymous scrolling divs: a screen reader was told a tab was selected and
 *   never told what it controlled. `jx-tabs` / `jx-tab` / `jx-tab-panel` pair `aria-controls` with
 *   `aria-labelledby` from one key, which is what closes `gap:apg-coverage` for this strip.
 * - **The containers are permanent by construction.** They were hand-built once and remembered in a
 *   module `Map`, because a repaint that rebuilt them would drop the Assistant's transcript and
 *   composer draft. They are now rows of a keyed `$map` over a CONSTANT list, so nothing can
 *   rebuild them — see `surfaces/inspector-dock.ts`.
 *
 * **And the panel scheduler went with it.** Its focus guard existed because a lit repaint takes the
 * node a reader is typing into; a document skips a write that resolved to the value the control
 * already holds, so there is nothing to withhold.
 */

import { getNodeAtPath, nodeLabel, requireShellRef, rightPanel } from "../store";
import { effect, effectScope, reactive } from "../reactivity";
import { activeTab } from "../workspace/workspace";
import { primarySelection } from "../tabs/selection";
import { bindLogicPanelHost } from "./events-panel";
import { bindContentHost } from "./properties-panel";

import {
  DEFAULT_ELEMENT_TAB,
  DEFAULT_INSPECTOR_TAB,
  isElementTabId,
  isInspectorTabId,
  shell,
} from "../shell";
import { INSPECTOR_STRIP, INSPECTOR_TABS } from "../commands/defaults";
import { bindPageHost, PAGE_TAB_EMPTY, pageTabTitle, renderPageTab } from "./head-panel";
import { inspectorTabRegion } from "../ui/regions";
import { bindStyleHost } from "./style-panel";
import { mountInspectorDock } from "../surfaces/inspector-dock";

import type { InspectorDockHandle, InspectorTabView } from "../surfaces/inspector-dock";
import type { ElementTabId, InspectorTabId } from "../shell";
import type { InspectorStripId } from "../commands/defaults";
import type { Tab } from "../tabs/tab";
import type { EffectScope } from "@vue/reactivity";

interface RightPanelCtx {
  navigateToComponent: (path: string) => void;
  getCanvasMode: () => string;
  renderCanvas: () => void;
  /**
   * Hand the Assistant tab's body to whoever owns the assistant, once.
   *
   * Injected rather than imported so the dependency runs one way: `chat-panel.ts` reaches back into
   * this module to SELECT its tab, and a matching import here would be a cycle between the host and
   * its tenant. `studio.ts` already composes both, so it is the natural place to join them.
   */
  mountAssistant: (host: HTMLElement) => void;
}

let _scope: EffectScope | null = null;

let _dock: InspectorDockHandle | null = null;

/**
 * The selected tab while NO document is open.
 *
 * `session.ui.rightTab` is per-document — the tab you were on comes back with the file — and with
 * no file there is nowhere per-document to put it. The Assistant is usable in exactly that state
 * (the New Project flow hands it a brief before any document exists), so the selection falls back
 * here rather than being refused.
 *
 * Reactive, because it is read by surfaces outside this module: the Command Bar's assistant toggle
 * reports whether the assistant is showing, and a plain field would leave that button lying on the
 * welcome screen — which is the whole class of bug `shell.ts` was split out to end.
 */
const _detached = reactive<{ tab: InspectorTabId; element: ElementTabId }>({
  element: DEFAULT_ELEMENT_TAB,
  tab: DEFAULT_INSPECTOR_TAB,
});

/**
 * Whether each document had a selection the last time the dock looked, so the strip switches on a
 * TRANSITION through empty rather than on every repaint (§6). Keyed on the tab, so focusing another
 * document is not mistaken for its selection appearing.
 */
const _hadSelection = new WeakMap<Tab, boolean>();

/**
 * Hand one tab's body host to its owner, once, and never let that stop the dock.
 *
 * **The boundary is load-bearing, and it moved.** The dock used to build its containers inside its
 * own render, under a `try` that had already painted the header and the strip — so a tab whose bind
 * threw left a dock that was still navigable and the reader could leave the tab that failed. A
 * binder now runs inside `onNodeCreated`, which is the runtime building the document: an error
 * there rejects the whole mount, and the dock that could not draw ONE tab would draw NO chrome at
 * all. So the boundary is here, around exactly the call that is somebody else's code.
 */
function bindBody(ctx: RightPanelCtx, tabId: string, host: HTMLElement): void {
  try {
    bindBodyUnguarded(ctx, tabId, host);
  } catch (error) {
    console.error(`right-panel: the ${tabId} tab could not take its body:`, error);
  }
}

/**
 * The five seams, keyed by the leaf whose body feeds them.
 *
 * A table rather than a chain of `if`s so that the ONE thing this module still does with a body
 * host is stated in one place. Every entry is a binder another module published: four of them mount
 * a document of their own into the host, and the assistant's arrives from `studio.ts` because a
 * matching import here would be a cycle.
 */
function bindBodyUnguarded(ctx: RightPanelCtx, tabId: string, host: HTMLElement): void {
  switch (tabId) {
    case "page": {
      /* The former Navigator Page panel, re-hosted unchanged: `head-panel.ts` draws it against the
         focused document and empties it when nothing is open. */
      bindPageHost(host);
      break;
    }
    case "assistant": {
      /* The assistant owns its container for the life of the window: it is the mount point for the
         Assistant's own Jx document, and rebuilding it would drop the transcript and the composer
         draft. */
      ctx.mountAssistant(host);
      break;
    }
    case "events": {
      /* Logic is a mounted document too (`surfaces/logic-panel.json`), and it watches its own facts
         and re-projects — this dock never paints over it. */
      bindLogicPanelHost(host);
      break;
    }
    case "properties": {
      /* Content needs one thing from the dock that the others do not: the way to open a component's
         definition, which is `studio.ts`'s and reaches this module as ctx. */
      bindContentHost(host, { navigateToComponent: ctx.navigateToComponent });
      break;
    }
    case "style": {
      /* The canvas mode is what the tab cannot read for itself — Stylebook edits a tag catalogue
         entry and Edit edits the selection — so it comes in from `studio.ts` the same way the
         Content tab's navigation door does. */
      bindStyleHost(host, { getCanvasMode: ctx.getCanvasMode });
      break;
    }
    default: {
      /* A tab id the document drew but no seam claims. Unreachable while `INSPECTOR_TABS` is what
         both this and the document read, and stated rather than assumed: a fifth tab arriving with
         no binder must leave an empty body, not throw inside a mount callback. */
      break;
    }
  }
}

/** Which strip tab hosts a leaf. */
export function stripOf(leaf: InspectorTabId): InspectorStripId {
  return INSPECTOR_TABS.find((tab) => tab.id === leaf)?.strip ?? "page";
}

/** The Page tab's title for the focused document (§6), or "Page" with nothing open. */
function pageTitle(): string {
  const tab = activeTab.value;
  return tab ? pageTabTitle(tab.documentPath) : "Page";
}

/** What a strip tab is called on screen: Page's title is the document's kind. */
function stripTitle(id: InspectorStripId): string {
  return id === "page" ? pageTitle() : (INSPECTOR_STRIP.find((tab) => tab.id === id)?.title ?? id);
}

/** The tab rows the document draws, with the selected leaf resolved onto them. */
function tabViews(selected: InspectorTabId): InspectorTabView[] {
  const strip = stripOf(selected);
  const noDocument = activeTab.value === null;
  return INSPECTOR_STRIP.map((tab) => {
    const leaves = INSPECTOR_TABS.filter((leaf) => leaf.strip === tab.id).map((leaf) => {
      const empty = leaf.id === "page" && noDocument ? PAGE_TAB_EMPTY : "";
      return {
        active: leaf.id === selected,
        empty,
        hasEmpty: empty !== "",
        key: leaf.id,
        region: inspectorTabRegion(leaf.id),
        shown: leaf.id === selected ? ("true" as const) : ("false" as const),
        title: leaf.title,
      };
    });
    return {
      active: tab.id === strip,
      hasLeaves: leaves.length > 1,
      key: tab.id,
      leaves,
      panelId: `inspector-panel-${tab.id}`,
      tabId: `inspector-tab-${tab.id}`,
      title: stripTitle(tab.id),
    };
  });
}

/**
 * Mount the right panel.
 *
 * @param {RightPanelCtx} ctx
 */
export function mount(ctx: RightPanelCtx) {
  _dock = mountInspectorDock(
    requireShellRef(rightPanel, "right-panel"),
    values(),
    { selectTab: (id) => selectFromStrip(id) },
    { onBody: (tabId, host) => bindBody(ctx, tabId, host) },
  );
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      const tab = activeTab.value;
      // Layout chrome is not IN the document, so nothing per-tab changes when the canvas reports a
      // `layoutHit` — and the panel that answers it (the Content tab's Layout Element card) spent a
      // Release cycle repainting only because the canvas host happened to call `renderOnly` too.
      // Reading it here makes the dock's dependency on it real.
      void shell.layoutSelection;
      // No tab is a state the inspector renders (its no-document empty state), not one it skips.
      if (tab) {
        // Track properties the right panel reads
        void tab.doc.document;
        // The Page tab reads the realm a content page keeps its head in, and its kind.
        void tab.doc.mode;
        void tab.doc.content;
        void tab.documentPath;
        // The whole SET, joined — a bare property read would not re-trigger when the selection
        // Changes WITHIN the array, and §6.7's helpers always replace it but nothing enforces that.
        void tab.session.selection.map((path) => path.join("/")).join("|");
        void tab.session.ui.rightTab;
        followSelection(tab);
      }
      void _detached.tab;
      render();
    });
  });
}

export function unmount() {
  _scope?.stop();
  _scope = null;
  _dock?.dispose();
  _dock = null;
  // The Logic and Content tabs' documents and their watchers belong to the hosts being dropped;
  // Nothing else hears about that, because the dock simply stops rendering.
  bindLogicPanelHost(null);
  bindContentHost(null);
  bindStyleHost(null);
  bindPageHost(null);
  _detached.tab = DEFAULT_INSPECTOR_TAB;
  _detached.element = DEFAULT_ELEMENT_TAB;
}

/**
 * Switch the strip on a selection transition through empty (§6), and only then.
 *
 * Empty → non-empty while Page shows: Element, on the leaf last used there. Non-empty → empty while
 * an Element leaf shows: Page. The first look at a document records its state and switches nothing,
 * so focusing another tab is not a transition, and the Assistant is never left by this. Layout
 * chrome counts as a selection: the Content view is what explains it.
 */
function followSelection(tab: Tab): void {
  const has = tab.session.selection.length > 0 || shell.layoutSelection !== null;
  const had = _hadSelection.get(tab);
  _hadSelection.set(tab, has);
  if (had === undefined || had === has) {
    return;
  }
  const current = inspectorTab();
  if (has && current === "page") {
    setInspectorTab(lastElementTab());
  } else if (!has && isElementTabId(current)) {
    setInspectorTab("page");
  }
}

/**
 * The tab the strip rests on when nothing chose one (§6): Page with nothing selected, otherwise the
 * Element leaf last used. What closing the Assistant steps onto.
 */
export function restingInspectorTab(): InspectorTabId {
  const tab = activeTab.value;
  const has = tab !== null && (tab.session.selection.length > 0 || shell.layoutSelection !== null);
  return has ? lastElementTab() : "page";
}

/** The Element leaf last shown for the focused document, or with nothing open. */
function lastElementTab(): ElementTabId {
  const tab = activeTab.value;
  const stored: unknown = tab ? tab.session.ui.elementTab : _detached.element;
  return isElementTabId(stored) ? stored : DEFAULT_ELEMENT_TAB;
}

/** The whole projection the document reads, built fresh from the state it names. */
function values() {
  const tab = inspectorTab();
  const strip = stripOf(tab);
  return {
    tab: strip,
    tabs: tabViews(tab),
    target: inspectorTarget(tab),
    title: stripTitle(strip),
  };
}

/**
 * Bring the dock up to date. Synchronous, and idempotent: the runtime skips a binding whose value
 * did not move, so an explicit caller can never take a control mid-interaction.
 *
 * The Page body is redrawn only while it is the leaf showing: it builds a merged-head preview per
 * paint, and a hidden one would pay for that on every selection change. Showing it draws it.
 */
export function render() {
  const view = values();
  _dock?.update(view);
  if (inspectorTab() === "page") {
    renderPageTab();
  }
}

/**
 * The leaf showing right now — the stored value, coerced to a declared one.
 *
 * Coercion rather than trust because the value is persisted session state: a build that spelled a
 * tab differently, or an automation step that guessed, must land on Page rather than on a blank
 * dock with no tab selected.
 */
export function inspectorTab(): InspectorTabId {
  const tab = activeTab.value;
  if (!tab) {
    return _detached.tab;
  }
  const stored: unknown = tab.session.ui.rightTab;
  return isInspectorTabId(stored) ? stored : DEFAULT_INSPECTOR_TAB;
}

/**
 * Select a tab. The ONE writer — the strip, `view.setRightTab`, `view.setAssistant` and the
 * assistant's own pending-prompt hand-off all come through here.
 */
export function setInspectorTab(tab: InspectorTabId): void {
  const aTab = activeTab.value;
  if (aTab) {
    aTab.session.ui.rightTab = tab;
    if (isElementTabId(tab)) {
      aTab.session.ui.elementTab = tab;
    }
  } else {
    _detached.tab = tab;
    if (isElementTabId(tab)) {
      _detached.element = tab;
    }
  }
  render();
}

/**
 * A pick from the strip, or from Element's sub-switch.
 *
 * The strip states a value and this decides what it means, which is why the document dispatches an
 * id rather than writing one. `element` is a strip id with no leaf of its own: it means "the
 * Element view I last used". Any other id must be a declared leaf, so an id the enum does not
 * declare is refused here rather than becoming a dock with no tab selected.
 */
function selectFromStrip(id: string): void {
  const leaf = id === "element" ? lastElementTab() : id;
  if (leaf !== "" && leaf !== inspectorTab() && isInspectorTabId(leaf)) {
    setInspectorTab(leaf);
  }
}

/**
 * What the selected tab is pointed AT, in the fewest words that are true.
 *
 * A tag name when a node is selected, the document's own name when nothing is or when the Page tab
 * is showing (it edits the document, whatever is selected), and "no document" when there is nothing
 * open. The dock spent its whole life unable to answer this — three icon tabs and no statement of
 * target anywhere — which is how "why is this field disabled" became a question with no on-screen
 * answer.
 */
function inspectorTarget(showing: InspectorTabId): string {
  const tab = activeTab.value;
  if (!tab) {
    return "no document";
  }
  // The Page tab edits the document whatever is selected, so it is pointed at the document.
  if (showing === "page") {
    return documentName(tab.documentPath);
  }
  // Layout chrome first: it is mutually exclusive with a document selection, and it is the one
  // Target whose name has to say where it came FROM — "<header> in layouts/base.json" is the whole
  // Answer to "why can I not edit this".
  const layout = shell.layoutSelection;
  if (layout) {
    return `<${layout.tagName || "element"}> in ${layout.layoutFile || "the layout"}`;
  }
  const paths = tab.session.selection;
  const selection = primarySelection(paths);
  if (selection) {
    // The inspector's title names the batch when there is one — it edits all of them, and titling
    // It after the primary alone is how a Mixed field ends up looking like a plain value.
    return paths.length > 1
      ? `${paths.length} elements`
      : nodeLabel(getNodeAtPath(tab.doc.document, selection));
  }
  return documentName(tab.documentPath);
}

/** A document's own name in the header: its file name, or "document" for an unsaved one. */
function documentName(path: string | null | undefined): string {
  return path ? (path.split("/").at(-1) ?? "document") : "document";
}
