/**
 * The rail foot's ⚙ Settings menu — `src/panels/settings-menu.ts`, the `menu` surface with a
 * submenu level.
 *
 * A SYNTHETIC registry throughout, holding the three ids by hand. That is the idiom
 * `tests/activity-bar.test.ts` states outright, and here it does a second job: importing the real
 * `app.preferences` record would pull `preferences-dialog.ts`'s graph (ai-models, github-auth,
 * cf-settings, the settings kernel) into a file that is about a popover. What the REAL records
 * declare is proved in `tests/app-commands.test.ts`, where the whole set is already loaded.
 *
 * The menu is a `jx-menu` in a popover slot, so what is asserted is the document's contract — rows,
 * roles, the submenu as a child menu, the keyboard — under the kit's popover shim. Paint, the top
 * layer and the focus ring belong to the browser lane.
 */
import { flush, mountOverlayLayers, pointer, stubRect } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { CommandContext } from "../src/commands/context";
import type { CommandRegistry } from "../src/commands/registry";

const overlayHost = document.createElement("div");
document.body.append(overlayHost);
mountOverlayLayers(overlayHost);

const { initLayers } = await import("../src/ui/layers");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const {
  registerSettingsSection,
  resetSettingsDocumentState,
  unregisterSettingsSection,
  notifySettingsDocument,
} = await import("../src/settings/section-registry");
const { PREFERENCES_SECTIONS } = await import("../src/settings/preferences-sections");
const { problems, resetNotifications, toasts } = await import("../src/services/notify");
const { dismissSettingsMenu, isSettingsMenuOpen, openSettingsMenu, SETTINGS_MENU_PLACEMENT } =
  await import("../src/panels/settings-menu");

initLayers();

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Every argument every run in a case received, in order. */
let ran: { id: string; args: unknown }[] = [];

interface RegistryOpts {
  /** Whether a project is open — the gate both project records read. */
  project?: boolean;
  /** Give `app.preferences` an `enablement` that refuses, to exercise the disabled shape. */
  refusePreferences?: boolean;
  /** Make a run reject asynchronously. */
  reject?: boolean;
  /** Add a fourth record, as an extension contributing to the placement would. */
  contributed?: boolean;
}

function installRegistry(opts: RegistryOpts = {}): CommandRegistry {
  const project = opts.project ?? true;
  const registry = createCommandRegistry({
    getContext: () => ({
      ...emptyContext(),
      project: { ...emptyContext().project, open: project },
    }),
    mac: true,
  });
  const record = (id: string, title: string, level: "application" | "project", extra = {}) => ({
    id,
    title,
    category: "Project" as const,
    level,
    menus: [SETTINGS_MENU_PLACEMENT, "palette"] as const,
    run: (_ctx: CommandContext, args: unknown) => {
      ran.push({ args, id });
      return opts.reject ? Promise.reject(new RangeError(`no such section for ${id}`)) : undefined;
    },
    ...extra,
  });
  registry.registerAll([
    record("app.preferences", "Preferences…", "application", {
      category: "View",
      keybinding: "mod+,",
      group: "7_settings",
      ...(opts.refusePreferences
        ? { enablement: () => false, requires: "a reason of its own" }
        : {}),
    }),
    record("settings.open", "Open Project Settings", "project", {
      keybinding: "mod+shift+,",
      group: "7_settings",
      requires: "an open project",
      enablement: (ctx: CommandContext) => ctx.project.open,
    }),
    record("styles.open", "Open Project Styles", "project", {
      group: "7_settings_styles",
      requires: "an open project",
      enablement: (ctx: CommandContext) => ctx.project.open,
    }),
    /* A fourth record, the shape an extension contributing to the placement takes. It is what
       makes "a command goes away while its submenu is open" expressible: the built-in three never
       leave. `app.preferences` is the only id `SECTION_SOURCES` knows besides `settings.open`, so
       this one gets no submenu, which is the other thing it pins. */
    ...(opts.contributed
      ? [record("ext.configure", "Configure Extension", "project", { group: "8_ext" })]
      : []),
  ] as never);
  setActiveRegistry(registry);
  return registry;
}

/** A stand-in for the rail's gear, measured at the foot of a 56px rail. */
function gear(): HTMLElement {
  const button = document.createElement("button");
  document.body.append(button);
  stubRect(button, { height: 44, left: 0, top: 700, width: 56 });
  return button;
}

type MenuEl = HTMLElement & { open: boolean; x: number; y: number; floor: number };

const rootMenu = () =>
  document.querySelector<MenuEl>('#layer-popover jx-menu[aria-label="Settings"]');
/** The root rows: the ones whose nearest menu is the root. */
const rootItems = () =>
  [...(rootMenu()?.querySelectorAll<HTMLElement>("jx-menu-item[data-command-id]") ?? [])].filter(
    (el) => el.closest("jx-menu") === rootMenu(),
  );
/** The rows of whichever submenu is SHOWING; none when no submenu is. */
const subItems = () =>
  [...(rootMenu()?.querySelectorAll<HTMLElement>("jx-menu jx-menu-item") ?? [])].filter((el) => {
    const sub = el.closest<MenuEl>("jx-menu");
    return sub !== rootMenu() && sub?.open === true;
  });
const rootIds = () => rootItems().map((el) => el.dataset.commandId);
/** A section row's id is `<command>:<section>`; the section is what it names. */
const sectionKeyOf = (el: HTMLElement) => el.dataset.commandId?.split(":").at(-1);
const subKeys = () => subItems().map((el) => sectionKeyOf(el));
const rowFor = (id: string) => rootItems().find((el) => el.dataset.commandId === id)!;
/** The row's own name — its label part, with the chord and reason parts left out. */
const titleOf = (el: HTMLElement) => el.querySelector('[part="label"]')!.textContent!.trim();
/** A chord or a reason the surface left out prints nothing, exactly as it shows nothing. */
const shownText = (el: Element | null) => el?.textContent?.trim() || undefined;
const chordOf = (el: HTMLElement) => shownText(el.querySelector("kbd"));
const reasonOf = (el: HTMLElement) => shownText(el.querySelector('[slot="description"]'));
const isDisabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true";
const submenuOf = (el: HTMLElement) => el.querySelector<MenuEl>('[slot="submenu"] > jx-menu');

/** Press a key where a keyboard would: at the focused row, or on the document when none has focus. */
function menuKey(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
  const active = document.activeElement;
  (active?.closest("#layer-popover") ? active : document).dispatchEvent(event);
  return event;
}

/** The focused row, as `{ commandId, sectionKey }`. */
function focusedKey(): { commandId?: string; sectionKey?: string } {
  const id = (document.activeElement as HTMLElement | null)?.dataset?.commandId;
  if (!id) {
    return {};
  }
  const [commandId = "", sectionKey] = id.split(":");
  return sectionKey ? { commandId, sectionKey } : { commandId };
}

/** Hover a row the way the pointer does: `pointerover` bubbling up to the menu. */
function hover(el: HTMLElement): void {
  el.dispatchEvent(new Event("pointerover", { bubbles: true }));
}

/** Open the gear menu and wait for the surface to mount and show. */
async function open(opts?: Parameters<typeof openSettingsMenu>[1]): Promise<void> {
  openSettingsMenu(anchor, opts);
  await flush();
}

let anchor: HTMLElement;

beforeEach(() => {
  ran = [];
  resetNotifications();
  resetSettingsDocumentState();
  for (const key of ["overview", "contexts", "cssVars"]) {
    unregisterSettingsSection(key);
  }
  registerSettingsSection({ key: "overview", label: "Overview", order: 10, render: () => {} });
  registerSettingsSection({ key: "contexts", label: "Contexts", order: 15, render: () => {} });
  registerSettingsSection({ key: "cssVars", label: "CSS Variables", order: 30, render: () => {} });
  anchor = gear();
});

afterEach(async () => {
  dismissSettingsMenu();
  anchor.remove();
  setActiveRegistry(null);
  resetNotifications();
  await flush();
});

// ─── Rendering ────────────────────────────────────────────────────────────────

describe("rendering", () => {
  test("the rows are the placement, ordered level-first with one divider at the boundary", async () => {
    installRegistry();
    await open();
    expect(rootIds()).toEqual(["app.preferences", "settings.open", "styles.open"]);
    // The divider IS the level boundary — the same thing the rail's own panel groups draw, and
    // The reason a menu may hold two levels where a pinned slot may not.
    const dividers = [...rootMenu()!.querySelectorAll("hr")].filter(
      (hr) => hr.closest("jx-menu") === rootMenu(),
    );
    expect(dividers).toHaveLength(1);
    expect(
      dividers[0]!
        .closest('[role="none"]')!
        .parentElement!.querySelector<HTMLElement>("jx-menu-item")!.dataset.commandId,
    ).toBe("settings.open");
  });

  test("the menu is a native popover with the menu role, named, in the settings region", async () => {
    installRegistry();
    await open();
    const menu = rootMenu()!;
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("popover")).toBe("auto");
    expect(menu.open).toBe(true);
    expect(menu.parentElement!.dataset.jxRegion).toBe("overlay.menu:settings");
  });

  test("every row prints its own title and its own chord, from the record", async () => {
    installRegistry();
    await open();
    expect(titleOf(rowFor("app.preferences"))).toBe("Preferences…");
    expect(chordOf(rowFor("app.preferences"))).toBe("⌘,");
    expect(chordOf(rowFor("settings.open"))).toBe("⌘⇧,");
    // No chord declared, so none printed — not an empty one.
    expect(chordOf(rowFor("styles.open"))).toBeUndefined();
  });

  test("a chord that merely restates the row's own name is not printed", async () => {
    const registry = createCommandRegistry({ getContext: () => emptyContext(), mac: true });
    registry.register({
      id: "app.preferences",
      title: "Delete",
      category: "View",
      level: "application",
      keybinding: "delete",
      menus: [SETTINGS_MENU_PLACEMENT],
      run: () => {},
    } as never);
    setActiveRegistry(registry);
    await open();
    expect(chordOf(rowFor("app.preferences"))).toBeUndefined();
  });

  test("only rows whose command takes a section advertise a submenu", async () => {
    installRegistry();
    await open();
    for (const id of ["app.preferences", "settings.open"]) {
      expect(rowFor(id).getAttribute("aria-haspopup")).toBe("menu");
      expect(rowFor(id).getAttribute("aria-expanded")).toBe("false");
      expect(submenuOf(rowFor(id))).not.toBeNull();
    }
    // `styles.open` has no `section` argument, so the attributes are absent rather than
    // Aria-haspopup="false" — an announced popup that does not exist is worse than none.
    expect(rowFor("styles.open").hasAttribute("aria-haspopup")).toBe(false);
    expect(rowFor("styles.open").hasAttribute("aria-expanded")).toBe(false);
    expect(submenuOf(rowFor("styles.open"))).toBeNull();
  });

  test("with no project open the two project rows are DISABLED, not absent", async () => {
    /* The welcome screen. They used to be hidden — `forPlacement` filters by `when` — which left
       the gear holding a single row and saying nothing about the two things most people open it
       looking for. §12.3: a control that cannot act renders disabled with its reason. The divider
       stays, because the level boundary is still there. */
    installRegistry({ project: false });
    await open();
    expect(rootIds()).toEqual(["app.preferences", "settings.open", "styles.open"]);
    expect(isDisabled(rowFor("app.preferences"))).toBe(false);
    for (const id of ["settings.open", "styles.open"]) {
      expect(isDisabled(rowFor(id))).toBe(true);
      expect(reasonOf(rowFor(id))).toContain("an open project");
      expect(rowFor(id).getAttribute("title")).toBe("an open project");
    }
    // A row that cannot run advertises no submenu: every one of its rows runs that same refusal.
    expect(rowFor("settings.open").hasAttribute("aria-haspopup")).toBe(false);
    expect(submenuOf(rowFor("settings.open"))).toBeNull();
  });

  test("a disabled project row does nothing when clicked, and the menu stays up", async () => {
    installRegistry({ project: false });
    await open();
    pointer(rowFor("settings.open"), "click");
    await flush();
    expect(ran).toEqual([]);
    expect(isSettingsMenuOpen()).toBe(true);
  });

  test("a record refused by `enablement` renders disabled, with its reason, and offers no sections", async () => {
    // §12.3: a control that cannot act explains itself rather than vanishing. And a row that cannot
    // Run offers no submenu, because every one of its rows would run that same refusal.
    installRegistry({ refusePreferences: true });
    await open();
    const row = rowFor("app.preferences");
    expect(isDisabled(row)).toBe(true);
    expect(reasonOf(row)).toContain("a reason of its own");
    expect(row.hasAttribute("aria-haspopup")).toBe(false);
  });
});

// ─── Activation ───────────────────────────────────────────────────────────────

describe("activation", () => {
  /*
   * THE LOAD-BEARING CASE, and the deliberate APG deviation.
   *
   * The pattern gives a parent `menuitem` no action of its own. Here the heading opens Project
   * Settings on its default section and the submenu is a second way in — which is what the kit's
   * row does by design (ui.md §5.1).
   */
  test("clicking a parent runs its OWN command, with no arguments, and dismisses", async () => {
    installRegistry();
    await open();
    pointer(rowFor("settings.open"), "click");
    await flush();
    expect(ran).toEqual([{ args: {}, id: "settings.open" }]);
    expect(isSettingsMenuOpen()).toBe(false);
  });

  test("Enter on a parent runs it rather than opening its submenu", async () => {
    installRegistry();
    await open();
    menuKey("ArrowDown");
    expect(menuKey("Enter").defaultPrevented).toBe(true);
    await flush();
    expect(ran).toEqual([{ args: {}, id: "settings.open" }]);
  });

  test("clicking a disabled row does nothing and leaves the menu up", async () => {
    installRegistry({ refusePreferences: true });
    await open();
    pointer(rowFor("app.preferences"), "click");
    await flush();
    expect(ran).toEqual([]);
    expect(isSettingsMenuOpen()).toBe(true);
  });

  test("a run that throws SYNCHRONOUSLY reaches notify too", async () => {
    // `registry.run` throws `CommandUnavailableError` for a record whose gate has turned false
    // Between the render and the click — a real race with the section-registry repaint.
    const registry = installRegistry();
    await open();
    registry.run = (() => {
      throw new RangeError("gate closed under the pointer");
    }) as typeof registry.run;
    pointer(rowFor("settings.open"), "click");
    await flush();
    expect([...toasts, ...problems].map((n) => n.message)).toContain(
      "gate closed under the pointer",
    );
  });

  test("a rejected async run reaches notify rather than an unhandled rejection", async () => {
    // `settings.open` throws AFTER awaiting the contributed-section sync, and `registry.run` does
    // Not catch — so a bare `void result` would strand it.
    installRegistry({ reject: true });
    await open();
    pointer(rowFor("settings.open"), "click");
    await flush();
    expect([...toasts, ...problems].map((n) => n.message)).toContain(
      "no such section for settings.open",
    );
  });
});

// ─── The submenu ──────────────────────────────────────────────────────────────

describe("the submenu", () => {
  test("hovering a parent opens its sections, named and ordered by the registry", async () => {
    installRegistry();
    await open();
    hover(rowFor("settings.open"));
    await flush();
    expect(subKeys()).toEqual(["overview", "contexts", "cssVars"]);
    expect(subItems().map((el) => titleOf(el))).toEqual(["Overview", "Contexts", "CSS Variables"]);
    expect(rowFor("settings.open").getAttribute("aria-expanded")).toBe("true");
    // Derived, so no surface renames anything.
    expect(submenuOf(rowFor("settings.open"))!.getAttribute("aria-label")).toBe(
      "Sections of Open Project Settings",
    );
    expect(submenuOf(rowFor("settings.open"))!.getAttribute("role")).toBe("menu");
  });

  test("the Preferences submenu is that command's own four sections", async () => {
    installRegistry();
    await open();
    hover(rowFor("app.preferences"));
    await flush();
    expect(subItems().map((el) => titleOf(el))).toEqual(
      PREFERENCES_SECTIONS.map((section) => section.title),
    );
  });

  test("a submenu row runs the PARENT's command with the section it names", async () => {
    installRegistry();
    await open();
    hover(rowFor("settings.open"));
    await flush();
    pointer(
      subItems().find((el) => sectionKeyOf(el) === "cssVars")!,
      "click",
    );
    await flush();
    expect(ran).toEqual([{ args: { section: "cssVars" }, id: "settings.open" }]);
    expect(isSettingsMenuOpen()).toBe(false);
    expect(subItems()).toHaveLength(0);
  });

  test("re-entering the same parent leaves its submenu exactly as it was", async () => {
    /* An ordinary pointer path: crossing a row, leaving and coming back. Rebuilding the submenu
       would reset the caret to row 0 for no reason. */
    installRegistry();
    await open();
    const parent = rowFor("settings.open");
    hover(parent);
    await flush();
    menuKey("ArrowDown");
    menuKey("ArrowRight");
    menuKey("End");
    expect(focusedKey().sectionKey).toBe("cssVars");
    hover(parent);
    await flush();
    expect(subKeys()).toEqual(["overview", "contexts", "cssVars"]);
    expect(focusedKey().sectionKey).toBe("cssVars");
  });

  test("entering a row that takes no section opens nothing", async () => {
    // `styles.open` has no `section` argument, so there is no submenu for it to own.
    installRegistry();
    await open();
    hover(rowFor("styles.open"));
    await flush();
    expect(subItems()).toHaveLength(0);
    expect(rowFor("styles.open").hasAttribute("aria-expanded")).toBe(false);
  });

  test("hovering a sibling closes the open submenu", async () => {
    installRegistry();
    await open();
    hover(rowFor("settings.open"));
    await flush();
    expect(subItems().length).toBeGreaterThan(0);
    hover(rowFor("styles.open"));
    await flush();
    expect(subItems()).toHaveLength(0);
    expect(rowFor("settings.open").getAttribute("aria-expanded")).toBe("false");
  });

  test("a section registered while the submenu is open appears in it, in place", async () => {
    /* Six of Project Settings' sections are contributed by extensions and register a tick after the
       built-ins. A submenu opened in that window would otherwise be permanently short. The rows are
       keyed, so the ones that were there keep their nodes — and the caret. */
    installRegistry();
    await open();
    menuKey("ArrowDown");
    menuKey("ArrowRight");
    menuKey("End");
    await flush();
    const before = subItems();
    expect(subKeys()).not.toContain("locales");
    expect(focusedKey().sectionKey).toBe("cssVars");
    registerSettingsSection({ key: "locales", label: "Locales", order: 25, render: () => {} });
    await flush();
    expect(subKeys()).toEqual(["overview", "contexts", "locales", "cssVars"]);
    expect(subItems()[0]).toBe(before[0]!);
    expect(subItems()[3]).toBe(before[2]!);
    expect(focusedKey().sectionKey).toBe("cssVars");
    expect(isSettingsMenuOpen()).toBe(true);
    unregisterSettingsSection("locales");
  });

  test("a section going away while it is open removes its row and keeps the caret on a row", async () => {
    // Driven by KEYBOARD, not hover: hovering opens a submenu without moving the roving caret (the
    // Pointer and the caret are separate), so ArrowRight would open whichever row the caret is on.
    installRegistry();
    await open();
    menuKey("ArrowDown"); // → settings.open
    menuKey("ArrowRight"); // → its submenu, caret on row 0
    menuKey("End"); // → CSS Variables, the row about to go
    expect(focusedKey().sectionKey).toBe("cssVars");
    unregisterSettingsSection("cssVars");
    await flush();
    expect(subKeys()).toEqual(["overview", "contexts"]);
    // The caret cannot be left on a row that is gone.
    expect(subItems()).toHaveLength(2);
    expect(subItems().includes(document.activeElement as HTMLElement)).toBe(true);
  });

  test("the menu closing unsubscribes — a later registration touches nothing", async () => {
    installRegistry();
    await open();
    hover(rowFor("settings.open"));
    await flush();
    dismissSettingsMenu();
    await flush();
    registerSettingsSection({ key: "locales", label: "Locales", order: 25, render: () => {} });
    notifySettingsDocument();
    await flush();
    expect(rootMenu()).toBeNull();
    unregisterSettingsSection("locales");
  });
});

// ─── Keyboard ─────────────────────────────────────────────────────────────────

describe("keyboard", () => {
  test("it opens with row 0 focused, and the roving tabindex says so", async () => {
    installRegistry();
    await open();
    const [first, second] = rootItems();
    expect(document.activeElement).toBe(first!);
    expect(first?.tabIndex).toBe(0);
    expect(second?.tabIndex).toBe(-1);
  });

  test("Down/Up move and wrap; Home and End jump", async () => {
    installRegistry();
    await open();
    menuKey("ArrowDown");
    expect(focusedKey().commandId).toBe("settings.open");
    menuKey("ArrowUp");
    expect(focusedKey().commandId).toBe("app.preferences");
    // Wrapping at both ends, so a list is a ring rather than a dead end.
    menuKey("ArrowUp");
    expect(focusedKey().commandId).toBe("styles.open");
    menuKey("Home");
    expect(focusedKey().commandId).toBe("app.preferences");
    menuKey("End");
    expect(focusedKey().commandId).toBe("styles.open");
    menuKey("ArrowDown");
    expect(focusedKey().commandId).toBe("app.preferences");
  });

  test("ArrowRight opens a submenu and moves in; ArrowLeft closes it and hands focus back", async () => {
    installRegistry();
    await open();
    menuKey("ArrowDown");
    expect(menuKey("ArrowRight").defaultPrevented).toBe(true);
    await flush();
    expect(subKeys()).toEqual(["overview", "contexts", "cssVars"]);
    expect(focusedKey()).toEqual({ commandId: "settings.open", sectionKey: "overview" });
    expect(rowFor("settings.open").getAttribute("aria-expanded")).toBe("true");
    expect(menuKey("ArrowLeft").defaultPrevented).toBe(true);
    await flush();
    expect(subItems()).toHaveLength(0);
    expect(focusedKey()).toEqual({ commandId: "settings.open" });
    expect(rowFor("settings.open").getAttribute("aria-expanded")).toBe("false");
  });

  test("ArrowRight on a row with no sections is not swallowed", async () => {
    installRegistry();
    await open();
    menuKey("End"); // Lands on styles.open, the last row
    expect(menuKey("ArrowRight").defaultPrevented).toBe(false);
    expect(subItems()).toHaveLength(0);
  });

  test("ArrowLeft on the root is not swallowed either", async () => {
    installRegistry();
    await open();
    expect(menuKey("ArrowLeft").defaultPrevented).toBe(false);
    expect(isSettingsMenuOpen()).toBe(true);
  });

  test("Enter in the submenu runs the parent with that section", async () => {
    installRegistry();
    await open();
    menuKey("ArrowDown");
    menuKey("ArrowRight");
    menuKey("ArrowDown");
    expect(focusedKey().sectionKey).toBe("contexts");
    menuKey("Enter");
    await flush();
    expect(ran).toEqual([{ args: { section: "contexts" }, id: "settings.open" }]);
    expect(isSettingsMenuOpen()).toBe(false);
  });

  test("Escape closes ONE level at a time, and the last one returns focus to the gear", async () => {
    installRegistry();
    anchor.focus();
    await open();
    menuKey("ArrowDown");
    menuKey("ArrowRight");
    await flush();
    expect(subItems().length).toBeGreaterThan(0);
    expect(menuKey("Escape").defaultPrevented).toBe(true);
    await flush();
    expect(subItems()).toHaveLength(0);
    expect(isSettingsMenuOpen()).toBe(true);
    expect(focusedKey()).toEqual({ commandId: "settings.open" });
    menuKey("Escape");
    await flush();
    expect(isSettingsMenuOpen()).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });

  test("Tab dismisses the whole stack", async () => {
    installRegistry();
    await open();
    menuKey("ArrowDown");
    menuKey("ArrowRight");
    await flush();
    menuKey("Tab");
    await flush();
    expect(isSettingsMenuOpen()).toBe(false);
    // Nothing is left listening: a later key must not be swallowed.
    expect(menuKey("ArrowDown").defaultPrevented).toBe(false);
  });

  test("a handled key is prevented and stopped; an unhandled one is neither", async () => {
    installRegistry();
    await open();
    const handled = menuKey("ArrowDown");
    expect(handled.defaultPrevented).toBe(true);
    // No row starts with "z", so typeahead has nothing to say about it either.
    const unhandled = menuKey("z");
    expect(unhandled.defaultPrevented).toBe(false);
  });
});

// ─── Dismissal ────────────────────────────────────────────────────────────────

describe("dismissal", () => {
  function mousedownOn(target: Node): void {
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  }

  test("an outside mousedown dismisses, through the popover's own light dismissal", async () => {
    installRegistry();
    await open();
    mousedownOn(document.body);
    await flush();
    expect(isSettingsMenuOpen()).toBe(false);
  });

  test("a mousedown inside the SUBMENU does not dismiss the root", async () => {
    // A submenu is a child popover of its row, so it is inside the root's hierarchy: what used to
    // Need a hand-rolled handler over two popovers is the platform's own rule now.
    installRegistry();
    await open();
    hover(rowFor("settings.open"));
    await flush();
    mousedownOn(subItems()[0]!);
    await flush();
    expect(isSettingsMenuOpen()).toBe(true);
    expect(subItems().length).toBeGreaterThan(0);
  });

  test("a mousedown on the gear does not dismiss — its own click owns the toggle", async () => {
    // The gear is the popover's INVOKER (`showPopover({ source })`), which the platform does not
    // Count as outside; otherwise every second click would re-open.
    installRegistry();
    await open();
    mousedownOn(anchor);
    await flush();
    expect(isSettingsMenuOpen()).toBe(true);
  });

  test("opening while open closes, and `isSettingsMenuOpen` tracks both edges", async () => {
    installRegistry();
    expect(isSettingsMenuOpen()).toBe(false);
    await open();
    expect(isSettingsMenuOpen()).toBe(true);
    await open();
    expect(isSettingsMenuOpen()).toBe(false);
  });

  test("dismissing is idempotent", async () => {
    installRegistry();
    await open();
    dismissSettingsMenu();
    dismissSettingsMenu();
    expect(isSettingsMenuOpen()).toBe(false);
  });

  test("with no registry, and with an empty placement, opening does nothing", async () => {
    setActiveRegistry(null);
    await open();
    expect(isSettingsMenuOpen()).toBe(false);

    const registry = createCommandRegistry({ getContext: () => emptyContext(), mac: true });
    registry.register({
      id: "app.preferences",
      title: "Preferences…",
      category: "View",
      level: "application",
      menus: ["palette"],
      run: () => {},
    } as never);
    setActiveRegistry(registry);
    await open();
    expect(isSettingsMenuOpen()).toBe(false);
  });

  test("the rerender callback fires on open AND on dismiss", async () => {
    // That is what keeps the trigger's `aria-expanded` a BINDING rather than an imperative write —
    // A stale one is a defect this app has shipped before.
    installRegistry();
    let calls = 0;
    await open({ rerender: () => (calls += 1) });
    expect(calls).toBe(1);
    dismissSettingsMenu();
    expect(calls).toBe(2);
  });
});

// ─── When the world changes underneath an open menu ───────────────────────────

/*
 * A menu is a popover held open across time, and the app does not stop while it is up. Closing a
 * project tears the command registry down and rebuilds it, and an extension being disabled takes
 * its records and its settings sections with it. Every one of these is a real event that can land
 * between the frame that drew a row and the click that runs it.
 */
describe("the world changing underneath it", () => {
  test("a row clicked after the registry went away does nothing", async () => {
    // Closing a project drops the registry. The menu is still on screen, so its rows are still
    // Clickable, and they must decline rather than throw at a caller that no longer exists.
    installRegistry();
    await open();
    setActiveRegistry(null);
    pointer(rowFor("settings.open"), "click");
    await flush();
    expect(ran).toEqual([]);
  });

  test("a section registering after the registry went away redraws nothing", async () => {
    /* The subscription outlives the registry by a moment, and the sections can move for reasons
       that have nothing to do with the menu. Rebuilding rows from a registry that is gone is what
       it must not do. */
    installRegistry();
    await open();
    hover(rowFor("settings.open"));
    await flush();
    expect(subKeys()).toEqual(["overview", "contexts", "cssVars"]);
    setActiveRegistry(null);
    registerSettingsSection({ key: "locales", label: "Locales", order: 25, render: () => {} });
    await flush();
    // Unchanged: the rows are the ones the live registry last gave, not a half-built set.
    expect(subKeys()).toEqual(["overview", "contexts", "cssVars"]);
    unregisterSettingsSection("locales");
  });

  test("the command owning the open submenu going away leaves the menu standing", async () => {
    /* An extension being disabled takes its records with it. The submenu belongs to a row that no
       longer exists; the keyed rows reconcile and the menu stays up. */
    installRegistry({ contributed: true });
    await open();
    expect(rootIds()).toContain("ext.configure");
    hover(rowFor("app.preferences"));
    await flush();
    expect(subItems().length).toBeGreaterThan(0);
    installRegistry();
    notifySettingsDocument();
    await flush();
    expect(rootIds()).not.toContain("ext.configure");
    expect(isSettingsMenuOpen()).toBe(true);
  });

  test("every section going away while the submenu is open closes it and keeps the caret", async () => {
    // A project closing unregisters all of them. The emptied submenu closes and its parent row
    // Takes the caret, so the keyboard still has somewhere to be.
    installRegistry();
    await open();
    menuKey("ArrowDown");
    menuKey("ArrowRight");
    expect(focusedKey().sectionKey).toBe("overview");
    for (const key of ["overview", "contexts", "cssVars"]) {
      unregisterSettingsSection(key);
    }
    await flush();
    expect(subItems()).toHaveLength(0);
    expect(focusedKey()).toEqual({ commandId: "settings.open" });
    expect(menuKey("ArrowDown").defaultPrevented).toBe(true);
    expect(isSettingsMenuOpen()).toBe(true);
  });

  test("a contributed row whose command takes no section offers none", async () => {
    // `SECTION_SOURCES` is keyed by command id, so a record it does not know gets an empty list
    // Rather than a guess. That is what keeps the submenu the ARGUMENT's enumeration.
    installRegistry({ contributed: true });
    await open();
    const row = rowFor("ext.configure");
    expect(row.hasAttribute("aria-haspopup")).toBe(false);
    hover(row);
    await flush();
    expect(subItems()).toHaveLength(0);
  });
});

// ─── Geometry ─────────────────────────────────────────────────────────────────

describe("geometry", () => {
  /*
   * Happy-dom does no layout, so a menu measures 0×0 — and the placement runs inside the show
   * that makes it measurable. The size is stubbed on the prototype for the duration, which is the
   * only way to be measurable at the moment the code under test measures.
   */
  async function withMenuSize<T>(
    size: { height: number; width: number },
    body: () => T | Promise<T>,
  ): Promise<T> {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
      if (this.tagName.toLowerCase() === "jx-menu") {
        const menu = this as MenuEl;
        return {
          ...size,
          bottom: (menu.y ?? 0) + size.height,
          left: menu.x ?? 0,
          right: (menu.x ?? 0) + size.width,
          top: menu.y ?? 0,
          x: menu.x ?? 0,
          y: menu.y ?? 0,
        } as DOMRect;
      }
      return original.call(this);
    };
    try {
      return await body();
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  }

  const frame = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

  test("the menu hangs off the trigger's right edge and ends flush with the floor", async () => {
    /* Not "below the trigger": the gear is the last control in a full-height rail, so a menu
       dropped below it would be off-screen. The BOTTOM edge is the anchored one and the menu grows
       upward from it — flush, with no inset, because the floor is a real edge (the status bar's
       top) rather than an arbitrary margin. */
    installRegistry();
    await withMenuSize({ height: 200, width: 260 }, async () => {
      await open();
      await frame();
    });
    // `x = anchorRect.right + 4` — the gear is 56px wide at left 0.
    expect(rootMenu()!.x).toBe(60);
    // No region ancestor in this fixture, so the floor is the viewport.
    expect(rootMenu()!.y).toBe(window.innerHeight - 200);
  });

  test("it aligns to the REGION the trigger lives in, not to the trigger, and floors its submenus there", async () => {
    /* The rail's foot carries 6px of padding, so the gear's own bottom floats clear of the status
       bar; the rail's bottom IS the status bar's top. Aligning to the region is what puts the menu
       flush with it — and it is the shell's own addressing grammar, so a menu button in another
       region would align to that one without this code learning about it. */
    const rail = document.createElement("div");
    rail.dataset.jxRegion = "rail";
    document.body.append(rail);
    rail.append(anchor);
    stubRect(rail, { height: 760, left: 0, top: 0, width: 56 });
    installRegistry();
    await withMenuSize({ height: 200, width: 260 }, async () => {
      await open();
      await frame();
    });
    // The RAIL's bottom is 760, not the gear's 744, so the menu sits 200 above it.
    expect(rootMenu()!.y).toBe(560);
    // And every submenu keeps above the same floor.
    expect(rootMenu()!.floor).toBe(760);
    dismissSettingsMenu();
    document.body.append(anchor);
    rail.remove();
  });

  test("a menu taller than the viewport floors at 4 rather than going negative", async () => {
    /* Project Settings has ~16 sections once extensions have contributed theirs. Capping only the
       bottom edge would push `top` negative and take the FIRST rows off the top of the window,
       where nothing can reach them — which is why both axes are floored, not just capped. */
    installRegistry();
    await withMenuSize({ height: window.innerHeight + 400, width: 260 }, async () => {
      await open();
      await frame();
    });
    expect(rootMenu()!.y).toBe(4);
  });
});
