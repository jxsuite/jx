/// <reference lib="dom" />
/**
 * Left panel — the Navigator dock's host.
 *
 * It no longer knows what a panel is. The eight-branch `if (tab === …)` chain, the eight-key
 * no-document copy table and the two post-render special cases are gone: this file resolves ONE
 * record from the panel registry, hands the document its name and its level, renders its `render`
 * into the content island, and calls its `afterRender`. Everything a panel is — its name, its
 * level, its empty state, its drag registrations — is declared beside the state it writes (plan §2
 * principle 1).
 *
 * **The box is `surfaces/navigator-dock.json` now, and the body is still lit.** A `PanelRecord`'s
 * `render` returns a lit template, so the panel body cannot be a document; the dock draws the
 * header and one empty `[part="content"]`, and this paints into it (studio-ui-guidelines.md §9.4).
 * The content box is a keyed `$map` row whose key is the PANEL, so switching panels destroys the
 * box the previous panel's own mounted document was appended into — which is the property the old
 * lit template bought by rebuilding its markup, and which four panels depend on.
 *
 * **The focus-aware scheduler went with the markup.** It existed because a lit repaint replaces the
 * node a reader is typing into; the header and the region are bindings now, and a binding whose
 * value did not move writes nothing. The body is still repainted by lit — that is unchanged — and
 * it was never what the guard was protecting: every field it ever withheld a paint for was in a
 * panel that has since become a document of its own.
 *
 * What stays here is what genuinely belongs to the host: the record lookup, the error boundary, and
 * the level the header states.
 */

import { render as litRender } from "lit-html";
import { leftPanel } from "../store";
import { effect, effectScope } from "../reactivity";
import { activeTab } from "../workspace/workspace";
import { shell } from "../shell";

import { navigatorPanelRegion } from "../ui/regions";
import { openPageAction } from "./empty-state";
import { emptyState } from "../surfaces/empty-state";
import { getPanel, isPanelVisible, panelContext } from "./panel-registry";
import { registerNavigatorPanels } from "./navigator-panels";
import { mountNavigatorDock } from "../surfaces/navigator-dock";
import type { NavigatorDockHandle, NavigatorPanelView } from "../surfaces/navigator-dock";
import type {
  NavigatorDocument,
  NavigatorPanelContext,
  NavigatorPanelDeps,
  PanelRecord,
} from "./panel-registry";
import type { EffectScope } from "@vue/reactivity";

let _deps: NavigatorPanelDeps | null = null;

let _scope: EffectScope | null = null;

let _dock: NavigatorDockHandle | null = null;

/**
 * The content box the document last announced, and the panel it belongs to.
 *
 * Held rather than re-queried, and the panel id is held WITH it: an `update` that changes the panel
 * reconciles one microtask later, so between the write and the announcement this still points at
 * the outgoing panel's box. Painting the new panel into it would draw the Outline inside the file
 * tree's body for one frame, and then leak it — the box is about to be removed with its contents.
 */
let _content: { panelId: string; host: HTMLElement } | null = null;

/**
 * Mount the Navigator dock.
 *
 * @param {NavigatorPanelDeps} deps
 */
export function mount(deps: NavigatorPanelDeps) {
  _deps = deps;
  registerNavigatorPanels();
  _dock = mountNavigatorDock(
    leftPanel,
    { panels: [panelView()] },
    {
      onContent: (panelId, host) => {
        _content = { host, panelId };
        /* A MICROTASK, not this call. `onNodeCreated` fires the moment the element is CONSTRUCTED
           and the runtime applies its attributes on the next line, so a panel's `afterRender` run
           from here would be handed a content box with no `part` on it — and several panels find
           their own container by attribute. By the time a microtask runs, the synchronous render
           that created this node has finished. */
        queueMicrotask(() => {
          if (_content?.host === host) {
            paintContent();
          }
        });
      },
    },
  );
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      // Shell state is tracked with no tab open — which panel is showing, and the project-level
      // State the project-level panels draw from. A document-less rail tab still repaints.
      void shell.leftTab;
      void shell.settingsTab;
      void shell.git.status;
      void shell.git.loading;
      void shell.git.error;
      void shell.git.subTab;
      void shell.git.logEntries;
      const tab = activeTab.value;
      if (tab) {
        // Track properties the Navigator's panels read
        void tab.doc.document;
        void tab.doc.mode;
        // The whole SET, joined — a bare property read would not re-trigger when the selection
        // Changes WITHIN the array, and §6.5's helpers always replace it but nothing enforces that.
        void tab.session.selection.map((path) => path.join("/")).join("|");
      }
      render();
    });
  });
}

export function unmount() {
  _scope?.stop();
  _scope = null;
  _deps = null;
  _dock?.dispose();
  _dock = null;
  _content = null;
}

/**
 * Repaint the Navigator.
 *
 * Synchronous and idempotent. It was coalesced onto an animation frame and deferred while a text
 * input in the panel had focus; the header is a binding now and the body is the same lit render it
 * always was, so an explicit caller — `renderOnly("leftPanel")`, a tab switch — costs one paint and
 * takes nothing from the caret.
 */
export function render() {
  if (!_dock) {
    return;
  }
  _dock.update({ panels: [panelView()] });
  paintContent();
}

/** The record `shell.leftTab` names, or null when it names nothing this context admits. */
function currentPanel(): PanelRecord | null {
  const panel = getPanel(shell.leftTab);
  return panel && isPanelVisible(panel, panelContext()) ? panel : null;
}

/**
 * What the dock's header says, and what the content box is keyed on.
 *
 * The key is the panel id either way, including for an id the registry does not declare: two
 * unknown ids in a row are two different mistakes, and rebuilding the box is what stops the second
 * one being reported under the first one's message.
 */
function panelView(): NavigatorPanelView {
  const panel = currentPanel();
  if (!panel) {
    return { hasHeader: false, key: shell.leftTab, level: "", region: "", title: "" };
  }
  return {
    hasHeader: true,
    key: panel.id,
    level: panel.level,
    region: navigatorPanelRegion(panel.id),
    title: panel.title,
  };
}

/**
 * The document as the panels read it, or null when nothing is open.
 *
 * A projection rather than the tab itself: a panel is handed the facts about the focused document
 * and never the tab, which is what keeps a Navigator panel from writing into the workspace.
 */
function navigatorDocument(): NavigatorDocument | null {
  const aTab = activeTab.value;
  if (!aTab) {
    return null;
  }
  return {
    canvas: aTab.session.canvas as Record<string, unknown> | null,
    content: aTab.doc.content,
    document: aTab.doc.document,
    documentPath: aTab.documentPath,
    mode: aTab.doc.mode,
    selection: aTab.session.selection,
    ui: aTab.session.ui,
  };
}

/**
 * Paint the panel into the box the document announced, and run its `afterRender` against it.
 *
 * The hook is handed the CONTENT box rather than the body around it, which is where every panel
 * that mounts a document of its own was already reaching (`host.querySelector(".panel-content") ??
 * host`). It runs only when the panel has what it needs: a panel showing its `requiresDocument`
 * sentence has not drawn its own markup, so an `afterRender` against it would mount a surface into
 * an empty state.
 *
 * **Two attempts, and the second one clears lit's markers first.** Four panels append a mounted
 * document past lit's range inside this box and one of them clears to the end of the parent, so
 * lit's own part markers can be removed from underneath it — after which every subsequent render
 * throws against comment nodes that are gone. Emptying the box and rendering again is the recovery,
 * and it is the whole reason a first failure is not the last word.
 */
function paintContent(): void {
  const deps = _deps;
  const content = _content;
  if (!deps || !content) {
    return;
  }
  const panel = currentPanel();
  /* A panel switch reconciles one microtask after the projection, so this is the outgoing panel's
     box: it is about to be removed, and anything painted into it now goes with it. The
     announcement of the new box is what paints. */
  if ((panel?.id ?? shell.leftTab) !== content.panelId) {
    return;
  }
  try {
    paintInto(deps, panel, content.host);
  } catch (error) {
    console.error("left-panel render error:", error);
    try {
      content.host.textContent = "";
      // @ts-expect-error — clear Lit's internal state to recover from marker corruption
      delete content.host["_$litPart$"];
      paintInto(deps, panel, content.host);
    } catch (retryError) {
      console.error("left-panel retry failed:", retryError);
    }
  }
}

/**
 * One attempt: draw the panel, or the sentence it renders instead, and hand it the box.
 *
 * @param deps The Navigator's injections
 * @param panel The record, or null for an id the registry does not declare
 * @param host The content box
 */
function paintInto(deps: NavigatorPanelDeps, panel: PanelRecord | null, host: HTMLElement): void {
  if (!panel) {
    litRender(
      emptyState(host, { message: `No Navigator panel is registered as "${shell.leftTab}".` }),
      host,
    );
    return;
  }
  const doc = navigatorDocument();
  const ctx: NavigatorPanelContext = { deps, doc, rerender: render };
  // A panel that declares what it needs renders the sentence instead of an empty box.
  const needed = doc === null ? panel.requiresDocument : undefined;
  litRender(
    needed === undefined
      ? panel.render(ctx)
      : emptyState(host, { actions: [openPageAction()], message: needed }),
    host,
  );
  if (needed === undefined) {
    panel.afterRender?.(ctx, host);
  }
}
