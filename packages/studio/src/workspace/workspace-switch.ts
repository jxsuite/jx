/**
 * Switching workspaces — the tab half of `view.setWorkspace`, and the rule that keeps the workspace
 * on screen and the tab on screen in agreement.
 *
 * Two invariants, both stated in `docs/studio/interface.md`, "Workspaces":
 *
 * 1. **Activating a tab enters its workspace.** Whatever activated it — a click in the Files tree,
 *    "Open" on a Content row, a search result, session restore — the workspace follows the tab, so
 *    opening a page from Content lands in Design without anybody asking for Design. This is an
 *    EFFECT over the active tab rather than a line in every opener, so no opener can forget it.
 * 2. **Showing a workspace shows its tabs.** `view.setWorkspace` activates the workspace's most
 *    recently used tab, or opens its home when it has none: the Content, Media and Publish homes,
 *    `project.json` in its stylebook editor for Styles. Design has no home; with no design tab open
 *    its stage is empty, which is the home a canvas has.
 *
 * Every pane follows the switch, the side pane included: a pane shows its own most recent tab of
 * the workspace, or none, and its strip draws only that workspace's tabs (`panels/tab-strip.ts`).
 * Nothing is closed by a switch. A tab of another workspace keeps its place in its pane's strip and
 * comes back when its workspace does.
 *
 * The rule holds for the panes the author is NOT in as well. A read into another pane (a session
 * restore, `pane.compareWith`) can put a tab of another workspace on that pane's stage without
 * activating anything the follow sees, and the pane would draw a document under a strip that hides
 * it. A second effect re-points such a pane at its own tab of the workspace, or clears it
 * ({@link alignHiddenPanes}); `pane.compareWith` asks for the comparison to be SHOWN, so it enters
 * the compared document's workspace instead ({@link revealInPane}).
 *
 * @docs studio/interface
 */

import { effect, effectScope, pauseTracking, resetTracking } from "../reactivity";
import {
  WORKSPACE_PRESETS,
  enterWorkspace,
  presetInspectorOpen,
  setDockCollapsed,
  shell,
} from "../shell";
import {
  activateTab,
  activeTab,
  clearPaneActiveTab,
  paneById,
  paneOfTab,
  setTabScope,
  workspace,
} from "./workspace";
import { isHomeWorkspace } from "./workspace-ids";
import {
  isTabInWorkspace,
  lastTabOfWorkspace,
  paneTabOfWorkspace,
  workspaceOfTab,
  writesOnCanvas,
} from "./tab-workspace";
import type { WorkspaceDeps } from "../shell";
import type { HomeWorkspaceId, WorkspaceId } from "./workspace-ids";
import type { EffectScope } from "@vue/reactivity";

/**
 * What a switch needs that this module may not import: the opener of the home that belongs to
 * another module (the configuration document), the generic homes' opener, and the Inspector's tab
 * writer.
 */
export interface WorkspaceSwitchDeps extends WorkspaceDeps {
  /** Open (or reveal) `project.json` in its stylebook editor: the Styles workspace's home. */
  openStyles: () => void;
  /** Open (or activate) a generic home tab (`workspace/workspace-home.ts`). */
  openHome: (id: HomeWorkspaceId) => void;
}

/**
 * Point every pane except `except` at the workspace: its own most recent tab there, or none.
 *
 * `except` is the pane whose active tab the caller has just chosen, so the pane being switched into
 * is not second-guessed.
 */
function alignPanes(id: WorkspaceId, except: string | null): void {
  for (const pane of workspace.panes) {
    if (pane.id === except || pane.derived) {
      continue;
    }
    const target = paneTabOfWorkspace(pane, id);
    if (target === pane.activeTabId) {
      continue;
    }
    if (target) {
      activateTab(target, { focus: false });
    } else {
      clearPaneActiveTab(pane.id);
    }
  }
}

/**
 * Point every pane the author is not in, whose active tab belongs to another workspace, at its own
 * tab of the workspace on screen, or at none. The focused pane is the follow's: its active tab
 * DECIDES the workspace rather than disagreeing with it. A derived pane follows its source.
 */
function alignHiddenPanes(): void {
  const id = shell.workspace;
  const focused = workspace.activePaneId;
  for (const pane of workspace.panes) {
    const tabId = pane.activeTabId;
    if (pane.id === focused || pane.derived || !tabId || isTabInWorkspace(tabId, id)) {
      continue;
    }
    // The writes below are this effect's own correction, not something it should track.
    pauseTracking();
    try {
      const target = paneTabOfWorkspace(pane, id);
      if (target) {
        activateTab(target, { focus: false });
      } else {
        clearPaneActiveTab(pane.id);
      }
    } finally {
      resetTracking();
    }
  }
}

/**
 * Show what a read put into `paneId` at `path` when it belongs to another workspace: activate it
 * (moving the keyboard there), which enters its workspace through the follow. A tab of the
 * workspace on screen is left exactly as the read left it.
 *
 * `pane.compareWith` is the caller: comparing is a request to SEE the other document, and leaving
 * it hidden in a strip that filters it out would be a command that visibly did nothing.
 */
export function revealInPane(paneId: string, path: string): void {
  const pane = paneById(paneId);
  const tabId = pane?.tabOrder.find((id) => workspace.tabs.get(id)?.documentPath === path);
  if (tabId && !isTabInWorkspace(tabId)) {
    activateTab(tabId);
  }
}

/** The active tab is being written on the canvas: what opens Content's Inspector. */
function activeWritesOnCanvas(): boolean {
  const tab = activeTab.value;
  return tab ? writesOnCanvas(tab) : false;
}

/** The deps a frame is laid out with: the caller's, plus the rule that reads the active tab. */
function frameDeps(deps: WorkspaceDeps): WorkspaceDeps {
  return { ...deps, writingOnCanvas: activeWritesOnCanvas };
}

/** Open a workspace's home. Design has none, and answers `false`. */
function openHome(id: WorkspaceId, deps: WorkspaceSwitchDeps): boolean {
  if (id === "styles") {
    deps.openStyles();
    return true;
  }
  if (isHomeWorkspace(id)) {
    deps.openHome(id);
    return true;
  }
  return false;
}

/**
 * Show a workspace: enter its frame and put its tabs on screen.
 *
 * Idempotent. Showing the workspace already on screen re-activates its most recent tab, which is
 * the tab already showing, so a second ⌘2 changes nothing.
 */
export function switchWorkspace(id: WorkspaceId, deps: WorkspaceSwitchDeps): void {
  /* The TAB first, the frame second. Activating the workspace's tab enters the workspace through
     the follow below, with that tab already active, which is what lets the preset's Inspector tab
     land on the document it is for: entering first would write Styles' "Style" tab onto whatever
     Design document was showing. The explicit entry after it covers the two cases no activation
     reports: a tab that was ALREADY active, and Design with nothing open. */
  const recent = lastTabOfWorkspace(id);
  if (recent) {
    activateTab(recent);
  } else {
    openHome(id, deps);
  }
  enterWorkspace(id, frameDeps(deps));
  const tab = activeTab.value;
  const kept = tab && isTabInWorkspace(tab.id, id) ? (paneOfTab(tab.id)?.id ?? null) : null;
  alignPanes(id, kept);
}

let _scope: EffectScope | null = null;

/**
 * Start the rule that activating a tab enters its workspace. Idempotent; the bootstrap calls it
 * once, after the shell has mounted. Returns the function that stops it again and drops the
 * fallback scope, which a window never needs and a test does.
 *
 * It also scopes the panes' fallback (`workspace.ts`'s `setTabScope`), so closing a workspace's
 * last tab leaves the pane empty rather than switching the workspace under the author.
 */
export function installWorkspaceFollow(deps: WorkspaceDeps): () => void {
  if (_scope) {
    return stopWorkspaceFollow;
  }
  setTabScope((tabId) => isTabInWorkspace(tabId));
  const scope = effectScope();
  _scope = scope;
  const withTab = frameDeps(deps);
  /* Whether the active tab was being written on the canvas at the last run, so a `whileWriting`
     Inspector (Content's) opens and closes on the TRANSITION, from the Content home into an
     entry and back, and an author's own toggle on the same tab is left alone. */
  let writing: boolean | null = null;
  scope.run(() => {
    effect(() => {
      const tab = activeTab.value;
      if (!tab) {
        return;
      }
      // What the tab IS is tracked — its identity, its editor, its path — because `project.json`
      // Moves between Design and Styles with its mode. Nothing else is.
      const id = workspaceOfTab(tab);
      const nowWriting = writesOnCanvas(tab);
      /* The entry runs UNTRACKED. It reads `shell.workspace` and the panes, and an effect that
         depended on them would re-run the moment `switchWorkspace` entered a workspace and, finding
         the OLD tab still active for one more statement, enter the old workspace straight back. */
      pauseTracking();
      try {
        if (enterWorkspace(id, withTab)) {
          alignPanes(id, paneOfTab(tab.id)?.id ?? null);
        } else if (
          writing !== null &&
          nowWriting !== writing &&
          WORKSPACE_PRESETS[id].inspector.whileWriting === true
        ) {
          setDockCollapsed("right", !presetInspectorOpen(id, nowWriting));
        }
      } finally {
        resetTracking();
      }
      writing = nowWriting;
    });
    /* The panes the author is not in. DEFERRED to a microtask, because a switch moves the active
       tab and the focused pane in two writes, and an effect run between them would see the pane
       being switched INTO as a hidden pane showing the wrong workspace, and point it straight
       back. By the microtask every synchronous switch has finished. */
    let queued = false;
    const runner = effect(alignHiddenPanes, {
      scheduler: () => {
        if (queued) {
          return;
        }
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (_scope === scope) {
            runner();
          }
        });
      },
    });
  });
  return stopWorkspaceFollow;
}

/** Stop the follow and drop the fallback scope. */
function stopWorkspaceFollow(): void {
  _scope?.stop();
  _scope = null;
  setTabScope(null);
}
