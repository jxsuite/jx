/**
 * The Navigator rail — the `rail` surface, rendered FROM the panel registry.
 *
 * There is no list of panels here. `railGroups()` returns every rail-able record grouped by level
 * and filtered by its own `when`, and the surface draws whatever that says: two groups with a
 * divider between them, PROJECT above and DOCUMENT below. Adding a panel is a `registerPanel()`
 * call in the module that owns it, and it appears here; there is nothing to update in step.
 *
 * **Every rail button opens the Navigator, and the grouping is by LEVEL.** Every button is a
 * `jx-action-button` in its stacked form, so it carries an 11px text label under its icon — an icon
 * whose only name is a hover tooltip is the accessibility failure §2 principle 6 names — and
 * `aria-pressed` states the toggle-focus semantics honestly: re-picking the open panel collapses
 * its dock, which is a two-state control, not a one-way selection.
 *
 * The foot is the ⚙ **Settings** menu, a menu button rendered from the `settings/menu` placement: a
 * record joins the gear by declaring the placement and there is nothing here to update in step.
 * With no registry, or one that declares nothing for it, there is no foot.
 *
 * What this adapter owns is the projection and the two decisions: which panel a button toggles, and
 * where the gear's menu opens. The scope is reactive, so the surface follows `shell` through one
 * effect that recomputes the projection; nothing repaints.
 *
 * @docs studio/interface
 */
import { activityBar } from "../store";
import { effect, effectScope, reactive } from "../reactivity";
import { requireNavigatorPanelId, shell, toggleActivityTab } from "../shell";
import { refreshGitStatus } from "../panels/git-panel";
import { panelContext, railGroups } from "../panels/panel-registry";
import { registerNavigatorPanels } from "../panels/navigator-panels";
import { activeRegistry } from "../commands/active-registry";
import {
  dismissSettingsMenu,
  isSettingsMenuOpen,
  openSettingsMenu,
  SETTINGS_MENU_PLACEMENT,
} from "../panels/settings-menu";
import { mountSurface, registerSurface } from "../ui/surface";
import railDoc from "./rail.json";

import type { EffectScope } from "@vue/reactivity";
import type { JxDocument } from "@jxsuite/schema/types";
import type { PanelRecord } from "../panels/panel-registry";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("rail", railDoc as unknown as JxDocument);

/** One rail button, as the surface reads it. */
interface RailButton {
  id: string;
  title: string;
  icon: string;
  selected: boolean;
  /** The badge text; empty for none. */
  badge: string;
}

interface RailGroupProjection {
  level: string;
  label: string;
  dividerAbove: boolean;
  panels: RailButton[];
}

interface RailScope extends Record<string, unknown> {
  groups: RailGroupProjection[];
  settingsVisible: boolean;
  settingsOpen: boolean;
  toggle: (id: string) => void;
  openSettings: (anchor: unknown) => void;
}

let _scope: EffectScope | null = null;
let _state: RailScope | null = null;
let _mount: Promise<SurfaceHandle> | null = null;
let _handle: SurfaceHandle | null = null;

/**
 * Whether a rail button is showing what it names — its dock open, on its tab.
 *
 * @param {PanelRecord} panel
 */
export function isRailPanelShowing(panel: PanelRecord): boolean {
  return !shell.docks.left.collapsed && shell.leftTab === panel.id;
}

/**
 * Reveal (or collapse) what a rail button names.
 *
 * There is no per-dock branch, because every rail button opens the Navigator. `PanelRecord.id` is a
 * `string` because the same registry hosts the Bottom dock's panels; the rail only ever draws
 * Navigator ones, and `requireNavigatorPanelId` is the shared lock that says so out loud rather
 * than letting an undeclared id reach `shell.leftTab`.
 *
 * @param {PanelRecord} panel
 */
export function toggleRailPanel(panel: PanelRecord): void {
  toggleActivityTab(requireNavigatorPanelId(panel.id, "the Navigator rail"));
}

/** The rail, as the surface reads it, from the registry and the shell as they stand now. */
function project(): { groups: RailGroupProjection[]; settingsVisible: boolean } {
  const ctx = panelContext();
  const groups = railGroups(ctx).map((group, index) => ({
    dividerAbove: index > 0,
    label: group.label,
    level: group.level,
    panels: group.panels.map((panel) => ({
      badge: String(panel.badge?.(ctx) ?? ""),
      icon: panel.icon,
      id: panel.id,
      selected: isRailPanelShowing(panel),
      title: panel.title,
    })),
  }));
  const registry = activeRegistry();
  const settingsVisible =
    registry !== null && registry.forPlacement(SETTINGS_MENU_PLACEMENT).length > 0;
  return { groups, settingsVisible };
}

/** The reactive scope the surface reads, made once. */
function state(): RailScope {
  _state ??= reactive({
    groups: [],
    openSettings: (anchor: unknown) => {
      if (!(anchor instanceof HTMLElement)) {
        return;
      }
      openSettingsMenu(anchor, {
        rerender: () => {
          if (_state) {
            _state.settingsOpen = isSettingsMenuOpen();
          }
        },
      });
    },
    settingsOpen: false,
    settingsVisible: false,
    toggle: (id: string) => {
      const panel = railGroups(panelContext())
        .flatMap((group) => group.panels)
        .find((candidate) => candidate.id === id);
      if (panel) {
        toggleRailPanel(panel);
      }
    },
  }) as RailScope;
  return _state;
}

/** Recompute the projection from the registry and the shell; the surface follows. */
export function renderActivityBar(): void {
  const scope = state();
  const next = project();
  scope.groups = next.groups;
  scope.settingsVisible = next.settingsVisible;
  scope.settingsOpen = isSettingsMenuOpen();
  ensureMounted();
}

/** Mount the surface into the rail host, once. */
function ensureMounted(): void {
  if (_mount || !activityBar) {
    return;
  }
  _mount = mountSurface("rail", state(), activityBar);
  void _mount.then((handle) => {
    _handle = handle;
  });
}

export function mount(): void {
  // The rail is a rendering of the registry, so the registry has to exist before the first paint.
  // Idempotent, and the Navigator dock calls it too — whichever mounts first wins.
  registerNavigatorPanels();
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      // Source control is PROJECT state, so the badge is fetched and drawn without reference to
      // Any tab. The badge needs a status once. A refresh that already failed must not re-arm this:
      // The effect re-runs on the very state the failure writes, so retrying here spins.
      const { error, loading, status } = shell.git;
      if (!status && !loading && !error) {
        void refreshGitStatus();
      }
      renderActivityBar();
    });
  });
}

export function unmount(): void {
  dismissSettingsMenu();
  _scope?.stop();
  _scope = null;
  const pending = _mount;
  _mount = null;
  if (_handle) {
    _handle.dispose();
    _handle = null;
  } else if (pending) {
    // Mounting still in flight: dispose it the moment it lands.
    void pending.then((handle) => handle.dispose());
  }
  _state = null;
}
