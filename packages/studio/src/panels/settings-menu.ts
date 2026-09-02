/// <reference lib="dom" />
/**
 * The rail foot's ⚙ Settings menu — a RENDERING of the `settings/menu` placement.
 *
 * The gear used to run one command. That was the right shape for a pinned slot and the wrong shape
 * for the question people bring to it: Studio has two settings families at two containment levels —
 * `app.preferences` (the application, ⌘,) and `settings.open` (this project, ⌘⇧,) — plus a third
 * editor over the same project document, `styles.open`. A slot can hold one of those and must lie
 * about the rest by omission. A menu can hold all three and say what each one is, because it prints
 * every row's own name, chord and gate beside it (§12.3). That is the whole argument for the matrix
 * row `settings/menu` admitting two levels, and for the divider this file draws where the level
 * changes.
 *
 * **Nothing here is a list of actions.** The rows are `registry.forPlacement("settings/menu")`, so
 * a record joins the menu by declaring the placement and leaves by not declaring it. The submenus
 * are the enumeration of each parent command's own `section` ARGUMENT, read from that argument's
 * own definition site — which is state the command already validates, not a second vocabulary
 * (§12.5).
 *
 * **A parent row runs its own command AND owns a submenu.** The APG menu pattern does not describe
 * that and Spectrum's stock submenu forbade it outright; the kit's `jx-menu-item` makes it the rule
 * (`ui.md` §5.1), so the deviation `specs/studio-ui-guidelines.md` §8.4 records is now what the
 * element does rather than what this file hand-rolls around it. Nothing is unreachable by keyboard:
 * Enter runs the row, ArrowRight reaches every child, and every child is also in the settings
 * document's own inner nav.
 *
 * The menu is the `menu` surface (`surfaces/menu.json`, through `surfaces/menu.ts`). What is left
 * here is the projection — which records, which sections, what each row runs — and where the panel
 * hangs: off the gear's right edge, its bottom flush with the rail's, which is also the floor every
 * submenu keeps above the status bar. The section subscription lives for as long as the menu is up:
 * six of Project Settings' sections are contributed by extensions and register a tick after the
 * built-ins (`settings/extension-sections.ts`), so a menu opened in that window would otherwise be
 * permanently short. It deliberately does NOT call the sync itself: opening a menu must not do IO.
 *
 * @docs studio/interface/preferences
 * @docs studio/projects/settings
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { activeRegistry } from "../commands/active-registry";
import { LEVELS } from "../commands/levels";
import { notify } from "../services/notify";
import { onSettingsDocumentChanged, sortedSettingsSections } from "../settings/section-registry";
import { PREFERENCES_SECTIONS } from "../settings/preferences-sections";
import { openMenu } from "../surfaces/menu";
import { REGION_ATTR } from "../ui/regions";
import { rectOf } from "../utils/geometry";

import type { CommandRegistry } from "../commands/registry";
import type { Level } from "../commands/levels";
import type { MenuHandle, MenuRowProjection } from "../surfaces/menu";

/** The placement the rail's gear renders. One definition site for the string. */
export const SETTINGS_MENU_PLACEMENT = "settings/menu" as const;

/** One value a parent command's `section` argument accepts. */
interface MenuSection {
  key: string;
  label: string;
}

let _menu: MenuHandle | null = null;
let _unsubscribe: (() => void) | null = null;
let _rerender: (() => void) | null = null;

// ─── Where a submenu's rows come from ─────────────────────────────────────────

/**
 * A command's `section` argument, enumerated from that argument's OWN definition site.
 *
 * NOT the second list of actions §12.5 forbids: it holds no titles, no handlers and no ordering of
 * its own. Each entry points at the array the command's validation already reads —
 * `app.preferences` refuses anything `isPreferencesSection` rejects, `settings.open` refuses
 * anything absent from `settingsSectionKeys()` — so a submenu row can never name a value its own
 * command would refuse.
 */
const SECTION_SOURCES: Readonly<Record<string, () => readonly MenuSection[]>> = {
  "app.preferences": () =>
    PREFERENCES_SECTIONS.map((section) => ({ key: section.id, label: section.title })),
  "settings.open": () =>
    sortedSettingsSections().map((section) => ({ key: section.key, label: section.label })),
};

/** The sections a row offers, or none. */
function menuSectionsFor(id: string): readonly MenuSection[] {
  return SECTION_SOURCES[id]?.() ?? [];
}

// ─── Running ──────────────────────────────────────────────────────────────────

/**
 * Run a row's command, surfacing a refusal instead of stranding it.
 *
 * `settings.open`'s `run` is async and throws a `RangeError` AFTER awaiting the contributed-section
 * sync, and `registry.run` does not catch. `editor/context-menu.ts`'s bare `void result` is safe
 * only because every element verb is synchronous; here an unknown section would reject into
 * nothing.
 */
function runRow(id: string, args?: Record<string, unknown>): void {
  const registry = activeRegistry();
  if (!registry) {
    return;
  }
  let result: unknown;
  try {
    result = registry.run(id, args as never);
  } catch (error) {
    notify.error(errorMessage(error), { source: id });
    return;
  }
  void Promise.resolve(result).catch((error: unknown) => {
    notify.error(errorMessage(error), { source: id });
  });
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

/**
 * Ask the registry what belongs in the gear right now, ordered level-first, and project each record
 * for the surface.
 *
 * `forPlacement` already filters by `when` and sorts by `group` then title; `toSorted` is stable,
 * so that order survives inside each level group. The divider falls where the LEVEL changes, which
 * is the same boundary the rail's own panel groups draw — and the reason a menu may hold two levels
 * where a pinned slot may not.
 */
function buildSettingsMenuRows(registry: CommandRegistry): MenuRowProjection[] {
  const commands = [...registry.forPlacement(SETTINGS_MENU_PLACEMENT)].toSorted(
    (a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level),
  );
  let level: Level | undefined;
  return commands.map((command, index) => {
    const dividerAbove = index > 0 && command.level !== level;
    ({ level } = command);
    const enabled = registry.isEnabled(command.id);
    const chord = registry.keymap.formatBinding(command.id);
    // A chord that just restates the row's own name teaches nothing and reads as a stutter.
    const taught = chord && chord.toLowerCase() !== command.title.toLowerCase() ? chord : undefined;
    const reason = enabled ? undefined : registry.disabledReason(command.id);
    const { id } = command;
    const row: MenuRowProjection = {
      // A row whose command cannot run offers no sections: every one of them runs that same refusal.
      children: enabled
        ? menuSectionsFor(id).map((section) => ({
            destructive: false,
            disabled: false,
            dividerAbove: false,
            id: `${id}:${section.key}`,
            // Named by the argument value it passes, never by a reworded command title.
            run: () => runRow(id, { section: section.key }),
            title: section.label,
          }))
        : [],
      destructive: command.destructive === true,
      disabled: !enabled,
      dividerAbove,
      id,
      // A row that owns sections still ACTIVATES, with no arguments: "Open Project Settings" opens
      // Project Settings on its default section, and the submenu is a second way in.
      run: () => runRow(id),
      submenuLabel: `Sections of ${command.title}`,
      title: command.title,
    };
    if (taught) {
      row.chord = taught;
    }
    if (reason) {
      row.requires = reason;
    }
    return row;
  });
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

/**
 * The lowest edge any menu in this stack may reach.
 *
 * The trigger's REGION, not the viewport. The gear sits in the rail, whose bottom is the status
 * bar's top — so clamping to the viewport would let a tall submenu run down over the status bar
 * while the root menu sits neatly above it. One floor for both levels is what keeps the stack
 * looking like one surface, and it is expressed through the shell's own addressing grammar rather
 * than a selector into markup — so a menu button in another region would align to that one without
 * this function learning about it.
 */
function menuFloor(anchor: HTMLElement): number {
  const host = anchor.closest<HTMLElement>(`[${REGION_ATTR}]`);
  return host ? rectOf(host).bottom : window.innerHeight;
}

// ─── Public surface ───────────────────────────────────────────────────────────

/** Whether the gear menu is on screen. The rail reads it for `aria-expanded`. */
export function isSettingsMenuOpen(): boolean {
  return _menu !== null;
}

/** Dismiss the menu and any open submenu. Idempotent. */
export function dismissSettingsMenu(): void {
  _menu?.close();
}

/**
 * Open the gear menu anchored to `anchor` — or close it, when it is already open.
 *
 * `rerender` is called on open and on dismiss so the trigger's `aria-expanded` and its open-state
 * class stay lit BINDINGS rather than imperative attribute writes; a stale `aria-expanded` is a
 * defect this app has shipped before. Same seam as `showContextMenu(e, path, { rerender })`.
 *
 * @param anchor The control the menu hangs off — the rail's gear.
 */
export function openSettingsMenu(anchor: HTMLElement, opts: { rerender?: () => void } = {}): void {
  if (_menu) {
    dismissSettingsMenu();
    return;
  }
  const registry = activeRegistry();
  if (!registry) {
    return;
  }
  const rows = buildSettingsMenuRows(registry);
  if (rows.length === 0) {
    return;
  }
  _rerender = opts.rerender ?? null;
  const floor = (): number => menuFloor(anchor);
  const handle = openMenu({
    floor,
    label: "Settings",
    onClosed: (closedHandle) => {
      if (_menu !== closedHandle) {
        return;
      }
      _menu = null;
      _unsubscribe?.();
      _unsubscribe = null;
      const rerender = _rerender;
      _rerender = null;
      // Last, so `aria-expanded` repaints against the cleared state.
      rerender?.();
    },
    opener: anchor,
    /* Hanging off the trigger's right edge, with its BOTTOM flush with the bottom of the region the
       trigger lives in. Not "below the trigger": the gear is the last control in a full-height rail
       whose foot abuts the status bar, so a menu dropped below it would be off-screen, and one
       aligned to the button would float six pixels of `.rail-footer` padding clear of the status
       bar. Floored at 4, because Project Settings has ~16 sections once extensions have contributed
       and a menu taller than the area must keep its FIRST rows on screen. */
    place: (box) => ({ x: rectOf(anchor).right + 4, y: Math.max(4, floor() - box.height) }),
    region: "settings",
    rows,
  });
  _menu = handle;
  _unsubscribe = onSettingsDocumentChanged(() => {
    const live = activeRegistry();
    if (!live || _menu !== handle) {
      return;
    }
    handle.setRows(buildSettingsMenuRows(live));
  });
  _rerender?.();
}
