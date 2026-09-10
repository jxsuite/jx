/// <reference lib="dom" />
/**
 * Right panel — the Inspector dock: four tabs, one dock, one column.
 *
 * **Content · Style · Logic · Assistant**, text-labelled. Three of those are renames of what was
 * here (Properties→Content, Events→Logic) and the fourth is the assistant, folded in from the fifth
 * grid column it used to own — which is the point of plan §3.2 ⑨: an inspector tab costs zero
 * additional width, so the canvas gets the ~300px back and the assistant is still one key away.
 *
 * **This file no longer draws anything.** The dock's markup, its ARIA and its style are
 * `surfaces/inspector-dock.json`, mounted through `surfaces/inspector-dock.ts`; what is left here
 * is the flow — which tab is selected, what the tab is pointed at, and which of the four seams each
 * body host is handed to. Two things came out of the move:
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

import { getNodeAtPath, nodeLabel, rightPanel } from "../store";
import { effect, effectScope, reactive } from "../reactivity";
import { activeTab } from "../workspace/workspace";
import { primarySelection } from "../tabs/selection";
import { bindLogicPanelHost } from "./events-panel";
import { bindContentHost } from "./properties-panel";

import { DEFAULT_INSPECTOR_TAB, isInspectorTabId, shell } from "../shell";
import { INSPECTOR_TABS } from "../commands/defaults";
import { inspectorTabRegion } from "../ui/regions";
import { bindStyleHost } from "./style-panel";
import { mountInspectorDock } from "../surfaces/inspector-dock";

import type { InspectorDockHandle, InspectorTabView } from "../surfaces/inspector-dock";
import type { InspectorTabId } from "../shell";
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
const _detached = reactive({ tab: DEFAULT_INSPECTOR_TAB as InspectorTabId });

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
 * The four seams, keyed by the tab whose body feeds them.
 *
 * A table rather than a chain of `if`s so that the ONE thing this module still does with a body
 * host is stated in one place. Every entry is a binder another module published: three of them
 * mount a document of their own into the host, and the assistant's arrives from `studio.ts` because
 * a matching import here would be a cycle.
 */
function bindBodyUnguarded(ctx: RightPanelCtx, tabId: string, host: HTMLElement): void {
  switch (tabId) {
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

/** The tab rows the document draws, with the selection resolved onto them. */
function tabViews(selected: InspectorTabId): InspectorTabView[] {
  return INSPECTOR_TABS.map((tab) => ({
    active: tab.id === selected,
    key: tab.id,
    panelId: `inspector-panel-${tab.id}`,
    region: inspectorTabRegion(tab.id),
    tabId: `inspector-tab-${tab.id}`,
    title: tab.title,
  }));
}

/**
 * Mount the right panel.
 *
 * @param {RightPanelCtx} ctx
 */
export function mount(ctx: RightPanelCtx) {
  _dock = mountInspectorDock(
    rightPanel,
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
        // The whole SET, joined — a bare property read would not re-trigger when the selection
        // Changes WITHIN the array, and §6.5's helpers always replace it but nothing enforces that.
        void tab.session.selection.map((path) => path.join("/")).join("|");
        void tab.session.ui.rightTab;
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
  _detached.tab = DEFAULT_INSPECTOR_TAB;
}

/** The whole projection the document reads, built fresh from the state it names. */
function values() {
  const tab = inspectorTab();
  return {
    tab,
    tabs: tabViews(tab),
    target: inspectorTarget(),
    title: INSPECTOR_TABS.find((t) => t.id === tab)?.title ?? tab,
  };
}

/**
 * Bring the dock up to date. Synchronous, and idempotent: the runtime skips a binding whose value
 * did not move, so an explicit caller can never take a control mid-interaction.
 */
export function render() {
  _dock?.update(values());
}

/**
 * The tab showing right now — the stored value, coerced to a declared one.
 *
 * Coercion rather than trust because the value is persisted session state: a build that spelled a
 * tab differently, or an automation step that guessed, must land on Content rather than on a blank
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
  } else {
    _detached.tab = tab;
  }
  render();
}

/**
 * A pick from the strip.
 *
 * The strip states a value and this decides what it means, which is why the document dispatches an
 * id rather than writing one: an id the enum does not declare is refused here rather than becoming
 * a dock with no tab selected.
 */
function selectFromStrip(id: string): void {
  if (id !== "" && id !== inspectorTab() && isInspectorTabId(id)) {
    setInspectorTab(id);
  }
}

/**
 * What the selected tab is pointed AT, in the fewest words that are true.
 *
 * A tag name when a node is selected, the document's own name when nothing is, and "no document"
 * when there is nothing open. The dock spent its whole life unable to answer this — three icon tabs
 * and no statement of target anywhere — which is how "why is this field disabled" became a question
 * with no on-screen answer.
 */
function inspectorTarget(): string {
  const tab = activeTab.value;
  if (!tab) {
    return "no document";
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
  const path = tab.documentPath;
  return path ? (path.split("/").at(-1) ?? "document") : "document";
}
