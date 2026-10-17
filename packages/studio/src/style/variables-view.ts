/// <reference lib="dom" />
/**
 * The Variables view: the Styles workspace's editor for the project's CSS custom properties
 * (studio.md §7.1).
 *
 * It is the `tokens` editor of the `project.json` tab, beside Elements (the `stylebook` specimens)
 * and Code (`source`), so the pane's Editor control switches between the three over one document,
 * one history and one dirty flag. What it draws is the CSS Variables editor that used to be a
 * Project Settings section (`settings/css-vars-editor.ts`), unchanged, inside a frame of its own
 * (`surfaces/styles-variables.json`) that says what a variable is, when an edit reaches the file
 * and where colour schemes are declared.
 *
 * **Saving is stated, not implied.** The editor commits every edit through the configuration
 * chokepoint as it is made (`updateSiteConfig` → `commitProjectConfig`), which writes the whole
 * document and leaves the tab clean, while an edit in the Elements view is a transaction on the tab
 * that waits for ⌘S. Both models are kept; what is not allowed is the author learning the
 * difference from the Save button, so the view says it in a sentence ({@link VARIABLES_SAVING}).
 *
 * **One configuration object.** Before the editor draws, the open `project.json` tab is made the
 * configuration document of record (`projectConfigDocument`), so the object the editor mutates is
 * the tab's own and an element style edit made a moment ago in Elements is not a rival the commit
 * would refuse (`tabs/project-config.ts`).
 *
 * **It follows the document.** An edit that reaches the tab another way (an undo, the Code view, an
 * element style edit that wrote a custom property) re-projects the editor, and choosing a variable
 * in the Outline (`selectStylebookVariable`) points the editor at it.
 *
 * Mounted per pane, keyed by pane id, for the reason `media/media-pane.ts` gives: two panes can
 * each show a view at once.
 *
 * @docs studio/design/tokens
 */

import { effect, effectScope, pauseTracking, resetTracking } from "../reactivity";
import { projectState } from "../store";
import { shell } from "../shell";
import { runActiveReported } from "../commands/run-reported";
import { projectConfigDocument } from "../tabs/project-config";
import { PROJECT_CONFIG_PATH } from "../tabs/tab";
import { paneRegion } from "../ui/regions";
import { focusCssVar, renderCssVarsEditor } from "../settings/css-vars-editor";
import { variableRequests } from "../panels/stylebook-layers-panel";
import { mountVariablesSurface } from "../surfaces/styles-variables";
import type { VariablesSurfaceHandle, VariablesView } from "../surfaces/styles-variables";
import type { Tab } from "../tabs/tab";
import type { CanvasSurface } from "../canvas/canvas-surface";

/** The view's heading: the name its Editor control row gives it too. */
export const VARIABLES_TITLE = "Variables";

/** What a variable is, in the words of the platform feature it is. */
export const VARIABLES_LEDE =
  "Your site's CSS custom properties: the --names in the root style block of project.json. " +
  "Every page and component inherits them, and any style value can use one as var(--name).";

/** When an edit here reaches the file, which is not when an Elements edit does. */
export const VARIABLES_SAVING =
  "A change here is saved to project.json as you make it, together with any element style " +
  "change still waiting for Save. Undo takes a change back in the document, and Save writes " +
  "the undone value to the file.";

/** Where color schemes and breakpoints are declared, which is not here. */
export const VARIABLES_SCHEMES =
  "Color schemes and breakpoints are declared in Project settings, under Contexts. A variable " +
  "takes a different value in one through its Add override picker.";

/** What the view draws in `paneId`. Pure: every word is a constant. */
export function variablesView(paneId: string): VariablesView {
  return {
    lede: VARIABLES_LEDE,
    // The label every door to Contexts wears: the pane context bar's footer and the Colors group's notice.
    manageLabel: "Manage contexts…",
    region: paneRegion(paneId, "variables"),
    saving: VARIABLES_SAVING,
    schemes: VARIABLES_SCHEMES,
    title: VARIABLES_TITLE,
  };
}

// ─── Mounting ────────────────────────────────────────────────────────────────

interface ActiveVariablesView {
  paneId: string;
  tabId: string;
  wrap: HTMLElement;
  surface: VariablesSurfaceHandle;
  scope: { stop: () => void; run: <T>(fn: () => T) => T | undefined };
}

const _active = new Map<string, ActiveVariablesView>();

/** Whether this tab's view is already mounted in this pane and still in the document. */
export function variablesViewMounted(paneId: string, tab: Tab): boolean {
  const view = _active.get(paneId);
  return (
    view !== undefined && view.tabId === tab.id && view.wrap.isConnected && view.surface.attached()
  );
}

/** Tear one pane's view down (mode change, tab switch, project close). Idempotent. */
export function detachVariablesView(paneId: string): void {
  const view = _active.get(paneId);
  if (!view) {
    return;
  }
  view.scope.stop();
  view.surface.dispose();
  _active.delete(paneId);
}

/** Open Project Settings on Contexts. A refusal is filed under this view's workspace. */
function manageContexts(): void {
  void runActiveReported("settings.open", { section: "contexts" }, "Styles");
}

/**
 * Make the open `project.json` tab the configuration document, so the object the editor mutates in
 * place is the tab's own. A no-op with no project, and for any other document.
 */
function bindConfiguration(tab: Tab): void {
  if (projectState && tab.documentPath === PROJECT_CONFIG_PATH) {
    projectConfigDocument();
  }
}

/** Run `fn` without the calling effect tracking what it reads. */
function untracked(fn: () => void): void {
  pauseTracking();
  try {
    fn();
  } finally {
    resetTracking();
  }
}

/**
 * Draw the Variables view into a pane's stage.
 *
 * @param {CanvasSurface} surface
 * @param {Tab} tab The `project.json` tab, in its `tokens` editor
 */
export function renderVariablesMode(surface: CanvasSurface, tab: Tab): void {
  const { paneId, wrap } = surface;
  if (variablesViewMounted(paneId, tab)) {
    return;
  }
  detachVariablesView(paneId);
  bindConfiguration(tab);

  /** The editor island, once the document has created it. */
  let editorHost: HTMLElement | null = null;

  const mounted = mountVariablesSurface(
    wrap,
    variablesView(paneId),
    { manageContexts },
    {
      editorSlot: (host) => {
        editorHost = host;
        renderCssVarsEditor(host);
        // Marked, not revealed: arriving at the view is not a request to move the keyboard.
        if (shell.stylebook.variable !== null) {
          focusCssVar(host, shell.stylebook.variable, { reveal: false });
        }
      },
    },
  );
  const scope = effectScope();
  _active.set(paneId, { paneId, scope, surface: mounted, tabId: tab.id, wrap });

  scope.run(() => {
    /* What the editor shows, read off the TAB so an undo, a Code edit or a transaction that
       replaced the root re-projects it. Serialised, because a property nested in an `@` block is
       a change the editor draws and a shallow read would not see. */
    let seen: string | null = null;
    effect(() => {
      const { document } = tab.doc;
      const key = JSON.stringify([document.style ?? null, document.$media ?? null]);
      if (key === seen) {
        return;
      }
      const first = seen === null;
      seen = key;
      const host = editorHost;
      if (!first && host) {
        untracked(() => {
          bindConfiguration(tab);
          renderCssVarsEditor(host);
        });
      }
    });
    /* The Outline's variable rows. The request count is read beside the name so choosing the
       same property again, after scrolling away from it, brings it back again. */
    let requests: number | null = null;
    effect(() => {
      const name = shell.stylebook.variable;
      const count = variableRequests.value;
      const first = requests === null;
      requests = count;
      const host = editorHost;
      if (!first && host) {
        untracked(() => {
          focusCssVar(host, name);
        });
      }
    });
  });
}
