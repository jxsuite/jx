/**
 * Tests for Project Settings: `src/settings/settings-document.ts` (the built-in sections, the
 * `project.json` tab's editors and the two commands), `src/settings/section-registry.ts` (sections,
 * groups and which one is current) and the editor flow `src/panels/settings-pane.ts`.
 *
 * What is asserted is the IA (§17.1): the nav in three groups with the sections each one lists,
 * contributed sections landing in Integrations at their declared order, section switching, a
 * failing contribution import, a renderer's failure said where the section would have been, and the
 * deep link surviving a section being refreshed. The dialog itself (open, Escape, focus, Moved) is
 * `settings-dialog.test.ts`'s; `settings.open` reaching it is asserted here.
 */
import { flush, installMockPlatform, pointer, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { html, render } from "lit-html";
import {
  openProjectSettings,
  settingsCommands,
  rememberStylesView,
  settingsSectionsReady,
  showSettingsDocument,
} from "../src/settings/settings-document";
import { DEFAULT_STYLES_HOME_VIEW, shell } from "../src/shell";
import {
  DEFAULT_SETTINGS_GROUP,
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_GROUPS,
  groupedSettingsSections,
  isSettingsGroupId,
  onSettingsDocumentChanged,
  registerSettingsSection,
  resetSettingsDocumentState,
  setSettingsSection,
  settingsDocumentSection,
  settingsSection,
  settingsSectionKeys,
  sortedSettingsSections,
  unregisterSettingsSection,
} from "../src/settings/section-registry";
import { ICON_NAMES } from "@jxsuite/ui/icons";
import { mountSettingsPane } from "../src/panels/settings-pane";
import { closeSettingsDialog, disposeSettingsDialog } from "../src/settings/settings-dialog";
import { resetExtensionSettingsSections } from "../src/settings/extension-sections";
import { refreshFormats, setExtensionCatalog, setExtensions } from "../src/format/format-host";
import { closeAllTabs, activeTab, workspace } from "../src/workspace/workspace";
import { initLayers } from "../src/ui/layers";
import "../src/ui/form-controls";
import { emptyContext } from "../src/commands/context";
import { createCommandRegistry } from "../src/commands/registry";
import { setActiveRegistry } from "../src/commands/active-registry";
import { isString } from "@jxsuite/schema/guards";
import type { AnyCommand } from "../src/commands/registry";
import type { NotifyOptions } from "../src/services/notify";
import type { ProjectConfig } from "@jxsuite/schema/types";
import type { CommandContext } from "../src/commands/context";
import type { ExtensionsInfo } from "../src/types";
import type { CommandArgValues } from "../src/commands/command-args";
import type { SettingsPaneMount } from "../src/panels/settings-pane";

// ─── Environment ─────────────────────────────────────────────────────────────

let host: HTMLElement;
let pane: SettingsPaneMount | null = null;
let movedTo: string[] = [];

/** One of this module's records, BY ID — never by index: a factory grows. */
function commandById(id: string): AnyCommand {
  const command = settingsCommands().find((candidate) => candidate.id === id);
  if (!command) {
    throw new Error(`settingsCommands() no longer holds "${id}"`);
  }
  return command;
}

/** The dialog-opening command. */
function openCommand(): AnyCommand {
  return commandById("settings.open");
}

/** Run `settings.open` and return the message it refused with. */
async function refusal(args: CommandArgValues): Promise<string> {
  try {
    await runOpen(args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("settings.open did not refuse");
}

/**
 * Call a record's `run` the way the registry does: with a context and an argument record, `{}` when
 * the caller passes none (`registry.run`'s own default).
 */
function runRecord(command: AnyCommand, args: CommandArgValues = {}): void | Promise<void> {
  /* SAFETY: `settingsCommands()` stores every record as `Command<never>`, which erases the argument
     type `run` was declared with. Each record here either ignores its arguments or reads them only
     through the `command-args.ts` readers, which take a `CommandArgValues` record — the shape
     `registry.run` hands every `run`. */
  const run = command.run as (ctx: CommandContext, args: CommandArgValues) => void | Promise<void>;
  return run(emptyContext(), args);
}

/** Run `settings.open` the way the registry does. */
function runOpen(args: CommandArgValues = {}): Promise<void> {
  return Promise.resolve(runRecord(openCommand(), args));
}

/** The section rows, in nav order, by the label each one names itself with. */
function navLabels(root: ParentNode = host): (string | undefined)[] {
  return [...root.querySelectorAll('[part="nav-item"]')].map(
    (b) => b.getAttribute("label") ?? undefined,
  );
}

function navButton(label: string, root: ParentNode = host): HTMLElement {
  const button = [...root.querySelectorAll('[part="nav-item"]')].find(
    (b): b is HTMLElement => b instanceof HTMLElement && b.getAttribute("label") === label,
  );
  if (!button) {
    throw new Error(`no nav item "${label}" — have ${navLabels(root).join(", ")}`);
  }
  return button;
}

/** The nav's group headings, in order, by the group id each carries. */
function groupIds(root: ParentNode = host): string[] {
  return [...root.querySelectorAll<HTMLElement>('[part="group"]')].map(
    (group) => group.dataset["group"] ?? "",
  );
}

/** The island a section renders into. */
function body(root: ParentNode = host): HTMLElement {
  const island = root.querySelector('[part="section-host"]');
  if (!(island instanceof HTMLElement)) {
    throw new TypeError("the settings editor has drawn no section island");
  }
  return island;
}

/** The open settings dialog, or null. */
/** The settings dialog that is SHOWING, or null: a closed one stays mounted for the next open. */
function dialog(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('#layer-dialog jx-dialog[part="settings"]')].find(
      (el) => el.querySelector<HTMLDialogElement>('dialog[part="dialog"]')?.open === true,
    ) ?? null
  );
}

/**
 * Mount the editor and let its deferred section render land.
 *
 * TWO turns, not one: a converted section mounts a Jx document, which waits for the kit's elements
 * to be defined before it renders. One turn settles the editor and its nav; the section's own
 * content arrives on the next.
 */
async function mount(): Promise<void> {
  pane?.dispose();
  pane = mountSettingsPane(host, {
    openMoved: (target, inspector) => movedTo.push(inspector ? `${target}:${inspector}` : target),
  });
  await flush();
  await flush();
}

/** A parser-like extensions payload contributing the Content Types section (order 50). */
const parserExtensions: ExtensionsInfo[] = [
  {
    contributions: [
      {
        className: "Content",
        entrySchema: {
          additionalProperties: {
            properties: {
              format: { type: "string" },
              schema: { type: "object" },
              source: { type: "string" },
            },
            type: "object",
          },
          type: "object",
        },
        project: { key: "content", title: "Content Types" },
        studio: {
          settings: {
            entry: {
              newEntry: { schema: { properties: {}, required: [], type: "object" } },
              ui: { schema: { control: "schema-builder" } },
            },
            icon: "grid-four",
            label: "Content Types",
            layout: "map",
            order: 50,
          },
        },
      },
    ],
    name: "@jxsuite/parser",
    specifier: "@jxsuite/parser",
    title: "Content & Markdown",
  },
];

/** The built-in nav, in display order: General, then Integrations, then Advanced. */
const BUILTIN_LABELS = [
  "Overview",
  "Locales",
  "Extensions",
  "Contexts",
  "Site head",
  "Data Shapes",
  "Packages",
  "Raw JSON",
];

beforeEach(() => {
  resetExtensionSettingsSections();
  refreshFormats();
  setExtensions([]);
  setExtensionCatalog([]);
  installMockPlatform();
  closeAllTabs();
  // The Styles home view is session state, and a case that picks Elements must not pick it for the next.
  shell.stylebook.view = DEFAULT_STYLES_HOME_VIEW;
  resetSettingsDocumentState();
  resetStudioState({
    projectConfig: {
      $defs: { Author: { properties: {}, required: [], type: "object" } },
      $media: { "--": "1280px", "--sm": "(max-width: 600px)" },
      content: {},
      extensions: [],
      style: { "--color-primary": "#007acc" },
    },
  });
  document.body.innerHTML = `
    <div id="layer-popover"></div><div id="layer-modal"></div><div id="layer-dialog"></div>
  `;
  initLayers();
  host = document.createElement("div");
  document.body.append(host);
  movedTo = [];
});

afterEach(async () => {
  pane?.dispose();
  pane = null;
  disposeSettingsDialog();
  host.remove();
  closeAllTabs();
  await flush();
});

// ─── The groups ──────────────────────────────────────────────────────────────

describe("the groups", () => {
  test("three, in order, with Advanced marked for developers", () => {
    expect(SETTINGS_GROUPS.map((group) => group.id)).toEqual([
      "general",
      "integrations",
      "advanced",
    ]);
    expect(SETTINGS_GROUPS.find((group) => group.id === "advanced")?.note).toBe("For developers");
    expect(DEFAULT_SETTINGS_GROUP).toBe("integrations");
    expect(isSettingsGroupId("general")).toBe(true);
    expect(isSettingsGroupId("styles")).toBe(false);
    expect(isSettingsGroupId(7)).toBe(false);
  });

  test("each built-in is listed in the group the dialog's IA names for it", () => {
    const groups = Object.fromEntries(
      groupedSettingsSections().map((group) => [
        group.id,
        group.sections.map((section) => section.key),
      ]),
    );
    expect(groups).toEqual({
      advanced: ["contexts", "head", "definitions", "dependencies", "rawJson"],
      general: ["overview", "locales"],
      integrations: ["extensions"],
    });
  });

  /* The dialog keeps its editor across closes, so a closed editor must not keep redrawing on every
     registry change, and a reopened one must catch up on what it missed. */
  test("a suspended editor ignores the registry, and resuming redraws the section once", async () => {
    let renders = 0;
    registerSettingsSection({
      key: "counted",
      label: "Counted",
      order: 1,
      render: () => {
        renders += 1;
      },
    });
    try {
      setSettingsSection("counted");
      await mount();
      const drawn = renders;
      expect(drawn).toBeGreaterThan(0);
      pane!.suspend();
      registerSettingsSection({ key: "late", label: "Late", order: 2, render: () => {} });
      await flush();
      expect(renders).toBe(drawn);
      pane!.resume();
      expect(renders).toBe(drawn + 1);
      // Already following: a second resume draws nothing more.
      pane!.resume();
      expect(renders).toBe(drawn + 1);
      pane!.dispose();
      pane!.resume();
      expect(renders).toBe(drawn + 1);
    } finally {
      unregisterSettingsSection("late");
      unregisterSettingsSection("counted");
    }
  });

  /* A section keeps its form state (a failed save's banner, a half-typed entry) in a WeakMap keyed
     on the host it is given, so a reopen must hand it a new host or the last visit's error comes
     back, including into another project's Settings. */
  test("resuming draws into a fresh host, so the last visit's form state does not come back", async () => {
    const hosts: HTMLElement[] = [];
    const errors = new WeakMap<HTMLElement, string>();
    registerSettingsSection({
      key: "stateful",
      label: "Stateful",
      order: 1,
      render: (target: HTMLElement) => {
        hosts.push(target);
        target.textContent = errors.get(target) ?? "clean";
      },
    });
    try {
      setSettingsSection("stateful");
      await mount();
      const first = hosts.at(-1)!;
      errors.set(first, "Could not save project.json");
      // A redraw while open (a section registering) keeps the host: the caret stays put.
      registerSettingsSection({ key: "late", label: "Late", order: 2, render: () => {} });
      expect(hosts.at(-1)).toBe(first);
      expect(first.textContent).toBe("Could not save project.json");
      pane!.suspend();
      pane!.resume();
      const reopened = hosts.at(-1)!;
      expect(reopened).not.toBe(first);
      expect(reopened.isConnected).toBe(true);
      expect(reopened.textContent).toBe("clean");
    } finally {
      unregisterSettingsSection("late");
      unregisterSettingsSection("stateful");
    }
  });

  test("a section with no group is an Integration, and an empty group draws no heading", () => {
    registerSettingsSection({ key: "loose", label: "Loose", order: 1, render: () => {} });
    const integrations = groupedSettingsSections().find((group) => group.id === "integrations");
    expect(integrations?.sections.map((section) => section.key)).toEqual(["loose", "extensions"]);
    unregisterSettingsSection("loose");
    // Built-ins register once, at import, so the one taken down here is put back as it was.
    const extensions = settingsSection("extensions")!;
    unregisterSettingsSection("extensions");
    try {
      expect(groupedSettingsSections().map((group) => group.id)).toEqual(["general", "advanced"]);
    } finally {
      registerSettingsSection(extensions);
    }
  });

  test("the registered keys are listed in grouped order, which is the order a reader sees", () => {
    expect(settingsSectionKeys()).toEqual([
      "overview",
      "locales",
      "extensions",
      "contexts",
      "head",
      "definitions",
      "dependencies",
      "rawJson",
    ]);
  });

  test("CSS Variables and Deploy are not Project Settings sections any more", () => {
    // They moved to the Styles and Publish workspaces; the dialog's Moved footnote says so.
    const keys = settingsSectionKeys();
    expect(keys).not.toContain("cssVars");
    expect(keys).not.toContain("deploy");
  });
});

// ─── The nav ─────────────────────────────────────────────────────────────────

describe("a section's icon", () => {
  /**
   * The key space, held to its resolver — because nothing draws it yet, and that is the point.
   *
   * `SettingsSection.icon` is documented as reserved: no surface reads it today. A miss here is
   * silent in both directions, so this is the assertion that a name is right before the nav draws
   * it (`studio.md` §13.5).
   */
  test("every built-in names a glyph the kit ships", () => {
    const sections = sortedSettingsSections().filter((section) => section.icon !== undefined);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(ICON_NAMES, `${section.key}: icon "${section.icon!}"`).toContain(section.icon!);
    }
  });
});

describe("the settings editor", () => {
  test("renders its sections in three groups, Overview first and active", async () => {
    await mount();
    expect(groupIds()).toEqual(["general", "integrations", "advanced"]);
    expect(navLabels()).toEqual(BUILTIN_LABELS);
    expect(navButton("Overview").getAttribute("aria-selected")).toBe("true");
    expect(navButton("Contexts").getAttribute("aria-selected")).toBe("false");
    expect(body().querySelector('[part="title"]')?.textContent).toBe("Overview");
  });

  test("the Moved footnote lists Styles, Publish and the Page tab, and its buttons ask the host to go there", async () => {
    await mount();
    const rows = [...host.querySelectorAll<HTMLElement>('[part="moved-row"]')];
    expect(rows.map((row) => row.dataset["moved"])).toEqual(["styles", "publish", "design"]);
    expect(rows[0]?.textContent).toContain("Colors and fonts");
    expect(rows[1]?.textContent).toContain("Hosting and domain");
    // The Page tab is Design's; the button says where, the switch says which workspace.
    expect(rows[2]?.textContent).toContain("Head and SEO defaults");
    expect(rows[2]?.querySelector('[part="moved-link"]')?.textContent).toContain("Page tab");
    pointer(rows[1]!.querySelector('[part="moved-link"]')!, "click");
    await flush();
    expect(movedTo).toEqual(["publish"]);
    // The Page tab row names the Inspector tab it promises, beside its workspace.
    pointer(rows[2]!.querySelector('[part="moved-link"]')!, "click");
    await flush();
    expect(movedTo).toEqual(["publish", "design:page"]);
  });

  test("the body opens with the current group's intro, and General has none", async () => {
    await mount();
    const intro = () => host.querySelector('[part="group-intro"]')?.textContent ?? null;
    expect(intro()).toBe("");
    setSettingsSection("contexts");
    await flush();
    await flush();
    expect(intro()).toBe("Changes here affect every page. Most sites never need them.");
    setSettingsSection("extensions");
    await flush();
    await flush();
    expect(intro()).toBe(
      "Turn on what your site needs. Each one adds its own options where you use it.",
    );
  });

  test("a dispose stops the editor listening, and is idempotent", async () => {
    await mount();
    pane!.dispose();
    // A change notification with nothing mounted must be a no-op rather than a null dereference.
    setSettingsSection("contexts");
    await flush();
    expect(host.querySelector('[part="doc"]')).toBeNull();
    expect(() => pane!.dispose()).not.toThrow();
  });

  test("the Extensions section renders the backend's catalogue through the editor", async () => {
    setExtensionCatalog([
      {
        description: "File-based content collections",
        installed: false,
        name: "@jxsuite/parser",
        sections: [{ key: "content", title: "Content Types" }],
        source: "first-party",
        title: "Content & Markdown",
      },
    ]);
    await mount();
    setSettingsSection("extensions");
    await flush(3);
    expect(body().querySelector('[part="title"]')?.textContent).toBe("Extensions");
    expect(body().querySelector('[part="package"]')?.textContent).toBe("@jxsuite/parser");
    expect(body().querySelector("jx-switch")).not.toBeNull();
  });

  test("a redraw of the section already showing does not rebuild its body", async () => {
    await mount();
    const first = body().querySelector(".settings-section");
    // The registry's own notification: a redraw of what is on screen, not a section change.
    setSettingsSection("overview");
    await flush(2);
    expect(body().querySelector(".settings-section")).toBe(first!);
  });

  test("a nav click switches the section, across groups", async () => {
    await mount();
    pointer(navButton("Data Shapes"), "click");
    await flush();
    expect(navButton("Data Shapes").getAttribute("aria-selected")).toBe("true");
    expect(navButton("Overview").getAttribute("aria-selected")).toBe("false");
    await flush();
    const labels = [...body().querySelectorAll('[part="list"] [part="shape"]')].map((b) =>
      b.textContent.trim(),
    );
    expect(labels.some((l) => l.includes("Author"))).toBe(true);
  });

  test("a $studio.settings contribution lands in Integrations at its declared order", async () => {
    setExtensions(parserExtensions);
    await openProjectSettings();
    await mount();
    expect(navLabels()).toEqual([
      "Overview",
      "Locales",
      "Extensions",
      "Content Types",
      "Contexts",
      "Site head",
      "Data Shapes",
      "Packages",
      "Raw JSON",
    ]);
    pointer(navButton("Content Types"), "click");
    await flush(8);
    expect(body().querySelector('[part="title"]')?.textContent).toBe("Content Types");
  });

  test("a custom section registering while mounted redraws the nav with no re-mount", async () => {
    await mount();
    registerSettingsSection({
      group: "general",
      key: "customSection",
      label: "Custom",
      order: 35,
      render: (container) => {
        render(html`<div class="custom-section-body">Hello custom</div>`, container);
      },
    });
    await flush();
    expect(navLabels().slice(0, 3)).toEqual(["Overview", "Locales", "Custom"]);
    pointer(navButton("Custom"), "click");
    await flush();
    expect(host.querySelector(".custom-section-body")?.textContent).toBe("Hello custom");
    unregisterSettingsSection("customSection");
  });

  test("re-registering a key replaces the section instead of duplicating it", async () => {
    registerSettingsSection({
      key: "customSection",
      label: "Custom v1",
      order: 70,
      render: () => {},
    });
    registerSettingsSection({
      key: "customSection",
      label: "Custom v2",
      order: 70,
      render: (container) => {
        render(html`<div class="custom-v2">v2</div>`, container);
      },
    });
    await mount();
    expect(navLabels().filter((label) => label?.startsWith("Custom"))).toEqual(["Custom v2"]);
    unregisterSettingsSection("customSection");
  });
});

// ─── A section that fails ────────────────────────────────────────────────────

describe("a section whose renderer fails", () => {
  test("a throw is said in the body, naming the section", async () => {
    registerSettingsSection({
      key: "broken",
      label: "Broken",
      order: 1,
      render: () => {
        throw new Error("no such file");
      },
    });
    setSettingsSection("broken");
    await mount();
    await flush();
    const failure = host.querySelector('[part="failure"]');
    expect(failure?.textContent).toBe("Could not show Broken: no such file");
    expect(failure?.getAttribute("role")).toBe("alert");
    // Choosing another section clears it.
    pointer(navButton("Overview"), "click");
    await flush(2);
    expect(host.querySelector('[part="failure"]')).toBeNull();
    unregisterSettingsSection("broken");
  });

  test("a rejected render is said too, once it settles", async () => {
    registerSettingsSection({
      key: "slow",
      label: "Slow",
      order: 1,
      render: () => Promise.reject(new Error("the server went away")),
    });
    setSettingsSection("slow");
    await mount();
    await flush(2);
    expect(host.querySelector('[part="failure"]')?.textContent).toBe(
      "Could not show Slow: the server went away",
    );
    unregisterSettingsSection("slow");
  });

  test("a rejection that lands after the reader moved on says nothing", async () => {
    let reject: (error: Error) => void = () => {};
    registerSettingsSection({
      key: "late",
      label: "Late",
      order: 1,
      render: () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    });
    setSettingsSection("late");
    await mount();
    pointer(navButton("Overview"), "click");
    await flush();
    reject(new Error("too late"));
    await flush(2);
    expect(host.querySelector('[part="failure"]')).toBeNull();
    unregisterSettingsSection("late");
  });
});

// ─── The deep link ───────────────────────────────────────────────────────────

describe("deep links", () => {
  test("a request for a section that has not registered yet is honoured when it does", () => {
    setSettingsSection("connections");
    expect(settingsDocumentSection()).toBe(DEFAULT_SETTINGS_SECTION);
    registerSettingsSection({
      key: "connections",
      label: "Connections",
      order: 90,
      render: () => {},
    });
    expect(settingsDocumentSection()).toBe("connections");
    unregisterSettingsSection("connections");
  });

  test("REGRESSION: a section being refreshed does not throw the deep link back to the default", async () => {
    const connections = {
      key: "connections",
      label: "Connections",
      order: 90,
      render: (container: HTMLElement) => {
        render(html`<div class="connections-body">conn</div>`, container);
      },
    };
    registerSettingsSection(connections);
    setSettingsSection("connections");
    await mount();
    expect(body().querySelector(".connections-body")).not.toBeNull();

    /* Exactly what `syncExtensionSettingsSections` does on every project activation and after every
       `project.json` write: unregister the stale key, then register the fresh one. */
    unregisterSettingsSection("connections");
    registerSettingsSection(connections);
    await flush();

    expect(settingsDocumentSection()).toBe("connections");
    expect(navButton("Connections").getAttribute("aria-selected")).toBe("true");
    unregisterSettingsSection("connections");
  });

  test("a section that goes away for good falls back to a section that exists", async () => {
    registerSettingsSection({ key: "ephemeral", label: "Ephemeral", order: 55, render: () => {} });
    setSettingsSection("ephemeral");
    expect(settingsDocumentSection()).toBe("ephemeral");
    unregisterSettingsSection("ephemeral");
    expect(settingsDocumentSection()).toBe(DEFAULT_SETTINGS_SECTION);
    await flush();
  });

  test("openProjectSettings awaits the contributed sync before it returns", async () => {
    setExtensions(parserExtensions);
    await openProjectSettings("content");
    expect(settingsSectionKeys()).toContain("content");
    expect(settingsDocumentSection()).toBe("content");
    await settingsSectionsReady();
  });
});

// ─── The tab ─────────────────────────────────────────────────────────────────

describe("the configuration tab", () => {
  test("showSettingsDocument opens project.json in the Variables view by default", () => {
    const tab = showSettingsDocument();
    expect(tab?.documentPath).toBe("project.json");
    expect(tab?.id).toBe("project.json");
    expect(tab?.session.ui.canvasMode).toBe("tokens");
    // The Styles workspace's three views (Elements, Variables, Code). Project Settings is a
    // Dialog, not a mode of this tab.
    expect(tab?.capabilities.modes).toEqual(["stylebook", "tokens", "source"]);
  });

  test("the tab's document IS the live project config, so the chokepoint binds it", () => {
    const tab = showSettingsDocument();
    expect(tab?.doc.document).toMatchObject({ content: {} });
  });

  test("a second open reuses the tab rather than rebuilding it (history survives)", () => {
    const first = showSettingsDocument()!;
    first.doc.dirty = true;
    first.session.ui.canvasMode = "source";
    const second = showSettingsDocument()!;
    expect(second.id).toBe(first.id);
    expect(second.doc.dirty).toBe(true);
    expect(second.session.ui.canvasMode).toBe("tokens");
  });

  test("the Styles home view is remembered: the last of Variables and Elements, never Code", () => {
    expect(shell.stylebook.view).toBe("tokens");
    showSettingsDocument("stylebook");
    expect(shell.stylebook.view).toBe("stylebook");
    showSettingsDocument("source");
    expect(shell.stylebook.view).toBe("stylebook");
    closeAllTabs();
    expect(showSettingsDocument()?.session.ui.canvasMode).toBe("stylebook");
    rememberStylesView("tokens");
    expect(shell.stylebook.view).toBe("tokens");
    rememberStylesView("edit");
    expect(shell.stylebook.view).toBe("tokens");
  });

  test("a mode opens a FRESH tab in that editor, not in the first declared one", () => {
    expect(workspace.tabs.get("project.json")).toBeUndefined();
    const tab = showSettingsDocument("source")!;
    expect(tab.session.ui.canvasMode).toBe("source");
    expect(tab.session.ui.preview).toBe(false);
    expect(tab.capabilities.modes).toEqual(["stylebook", "tokens", "source"]);
  });

  test("an already-open project.json tab gains a missing editor in declared order", () => {
    const tab = showSettingsDocument()!;
    tab.capabilities.modes = ["preview"];
    showSettingsDocument();
    expect(tab.capabilities.modes).toEqual(["stylebook", "tokens", "source", "preview"]);
  });

  test("the Variables view is the tokens editor of the same tab", () => {
    const first = showSettingsDocument()!;
    first.doc.dirty = true;
    const tab = showSettingsDocument("tokens")!;
    expect(tab.id).toBe(first.id);
    expect(tab.session.ui.canvasMode).toBe("tokens");
    expect(tab.doc.dirty).toBe(true);
  });

  /*
   * Revealing the configuration tab MOVES THE FOCUS, and moving the focus is four operations:
   * `resetTabCycle`, `promoteMru`, `syncTreeSelection` and the assignment. Rule 5 of
   * `scripts/check-pane-singletons.ts` is the guard.
   */
  test("revealing it in the side pane moves the focus the way `focusPane` does", async () => {
    const { activateTab, focusPane, openTab, splitRight, PRIMARY_PANE, SECONDARY_PANE } =
      await import("../src/workspace/workspace");
    const { projectState } = await import("../src/store");
    const config = showSettingsDocument()!;
    expect(splitRight()?.id).toBe(SECONDARY_PANE);
    focusPane(PRIMARY_PANE);
    const other = openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/other.json",
      id: "pages/other.json",
    });
    activateTab(other.id);
    expect(workspace.activePaneId).toBe(PRIMARY_PANE);
    expect(workspace.mruOrder[0]).toBe(other.id);

    showSettingsDocument();

    expect(workspace.activePaneId).toBe(SECONDARY_PANE);
    expect(workspace.mruOrder[0]).toBe(config.id);
    expect(projectState?.selectedPath).toBe("project.json");
  });

  test("a tab that is in no pane is still returned rather than lost", () => {
    const tab = showSettingsDocument()!;
    for (const each of workspace.panes) {
      each.tabOrder = each.tabOrder.filter((id) => id !== tab.id);
    }
    expect(showSettingsDocument()?.id).toBe(tab.id);
  });

  test("with no project open there is no document to show", async () => {
    const { setProjectState } = await import("../src/state");
    setProjectState(null);
    expect(showSettingsDocument()).toBeNull();
  });

  /*
   * THE TWO WRITERS AGREE. The tab this door opens is built over the configuration OBJECT, with no
   * text behind it, so the chokepoint lends it the layout it read (`tabs/project-config.ts`, issue
   * 308); a settings commit and the ⌘S that follows it write the same bytes.
   */
  test("a ⌘S on the tab writes the bytes a settings commit does, with the file's layout kept", async () => {
    const { commitProjectConfig, resetProjectConfigDocument } =
      await import("../src/tabs/project-config");
    const { saveFile } = await import("../src/files/file-ops");
    const { deriveJsonLayout } = await import("@jxsuite/schema/json-layout");
    const { toRaw } = await import("../src/reactivity");
    const onDisk =
      '{\n  "name": "site",\n  "style": { "--a": "1" },\n  "locales": ["en", "fr"]\n}\n';
    const { state } = installMockPlatform({}, { "project.json": onDisk });
    const seeded: ProjectConfig = JSON.parse(onDisk);
    resetStudioState({ projectConfig: seeded });
    resetProjectConfigDocument();
    try {
      const tab = showSettingsDocument()!;
      await flush();
      expect(toRaw(tab.doc.layout)).toEqual(deriveJsonLayout(onDisk));

      const committed = await commitProjectConfig({ name: "renamed" });
      expect(committed.ok).toBe(true);
      expect(await saveFile(tab)).toBe(true);

      const written = state.calls.flatMap((call) =>
        call[0] === "writeFile" && call[1] === "project.json" && isString(call[2]) ? [call[2]] : [],
      );
      expect(written).toHaveLength(2);
      expect(written[1]).toBe(written[0]);
      expect(written[0]).toBe(onDisk.replace('"name": "site"', '"name": "renamed"'));
    } finally {
      resetProjectConfigDocument();
    }
  });
});

// ─── The command ─────────────────────────────────────────────────────────────

describe("settings.open", () => {
  test("still declares one record, at project level, with section and entry", () => {
    const command = openCommand();
    expect(command.id).toBe("settings.open");
    expect(command.level).toBe("project");
    expect(command.menus).toEqual(["commandbar/overflow", "settings/menu", "palette"]);
    expect(Object.keys(command.args?.properties ?? {}).toSorted()).toEqual(["entry", "section"]);
  });

  test("with no arguments it opens the DIALOG on its default section, and opens no tab", async () => {
    await runOpen();
    await flush(3);
    expect(dialog()).not.toBeNull();
    expect(workspace.tabs.get("project.json")).toBeUndefined();
    expect(settingsDocumentSection()).toBe(DEFAULT_SETTINGS_SECTION);
    expect(navLabels(dialog()!)).toEqual(BUILTIN_LABELS);
  });

  test("it remembers the section it was left on for the rest of the session", async () => {
    await runOpen({ section: "locales" });
    await flush(3);
    closeSettingsDialog();
    await flush();
    expect(dialog()).toBeNull();
    await runOpen();
    await flush(3);
    expect(settingsDocumentSection()).toBe("locales");
    expect(navButton("Locales", dialog()!).getAttribute("aria-selected")).toBe("true");
  });

  test("a section it does not have is refused, naming what it does have", async () => {
    expect(await refusal({ section: "cssVars" })).toContain(
      '"cssVars" is not a registered settings section',
    );
  });

  test("an entry without a section is refused", async () => {
    expect(await refusal({ entry: "posts" })).toContain('argument "entry" needs a "section"');
  });

  test("a section and an entry select that entry, named under the dialog's region", async () => {
    setExtensions(parserExtensions);
    resetStudioState({
      projectConfig: { content: { pages: {}, posts: { format: "md" } } },
    });
    await runOpen({ entry: "posts", section: "content" });
    await flush(8);
    expect(settingsDocumentSection()).toBe("content");
    const root = dialog()!;
    expect(root.querySelector('[data-jx-region="overlay.dialog:settings/editor"]')).not.toBeNull();
    expect(
      root.querySelector('[data-jx-region="overlay.dialog:settings/entry:posts"]'),
    ).not.toBeNull();
  });

  test("an entry the section does not have is refused, naming the entries it does", async () => {
    setExtensions(parserExtensions);
    resetStudioState({ projectConfig: { content: { posts: {} } } });
    expect(await refusal({ entry: "drafts", section: "content" })).toContain(
      '"drafts" is not an entry of settings section "content" — entries: posts',
    );
  });

  test("Raw JSON's Edit as code closes the dialog and opens project.json in its source", async () => {
    await runOpen({ section: "rawJson" });
    await flush(4);
    pointer(dialog()!.querySelector('[part="edit"]')!, "click");
    await flush(2);
    expect(dialog()).toBeNull();
    expect(activeTab.value?.id).toBe("project.json");
    expect(activeTab.value?.session.ui.canvasMode).toBe("source");
  });
});

// ─── The subscription ────────────────────────────────────────────────────────

describe("onSettingsDocumentChanged", () => {
  test("fires for a section change and for a registration, and stops on unsubscribe", () => {
    let count = 0;
    const off = onSettingsDocumentChanged(() => {
      count += 1;
    });
    setSettingsSection("contexts");
    registerSettingsSection({ key: "tmp", label: "Tmp", order: 999, render: () => {} });
    expect(count).toBe(2);
    off();
    unregisterSettingsSection("tmp");
    setSettingsSection("overview");
    expect(count).toBe(2);
  });
});

// ─── Project Styles ──────────────────────────────────────────────────────────

describe("styles.open", () => {
  /** The Project Styles command. */
  function stylesCommand(): AnyCommand {
    return commandById("styles.open");
  }

  test("is a project-level scripted door, in neither the palette nor the gear", () => {
    const command = stylesCommand();
    expect(command.level).toBe("project");
    /* The gear holds Preferences and Project Settings; Styles is a workspace the top bar names,
       and the palette reaches it as `workspace.focus.styles` ("Go to Styles"). A palette row here
       would be the same switch under a second name. */
    expect(command.menus).toEqual(["never"]);
    expect(command.group).toBe("7_settings_styles");
    expect(command.keybinding).toBeUndefined();
    // One optional argument, the view, named by what it edits rather than by its wire mode.
    expect(command.args?.required).toEqual([]);
    expect(command.args?.properties?.["view"]?.enum).toEqual(["elements", "variables", "code"]);
  });

  test("it is NAMED, never spelled from the wire value", () => {
    const { title } = stylesCommand();
    expect(title).toBe("Open Project Styles");
    expect(title.toLowerCase()).not.toContain("stylebook");
  });

  test("two verbs over one document declare ONE availability rule", () => {
    const styles = stylesCommand();
    const open = openCommand();
    expect(styles.requires).toBe(open.requires);
    for (const project of [{ open: true }, { open: false }]) {
      const ctx: CommandContext = {
        ...emptyContext(),
        project: { ...emptyContext().project, ...project },
      };
      expect(styles.enablement?.(ctx)).toBe(open.enablement?.(ctx));
    }
  });

  /** A registry whose `view.setWorkspace` records its arguments and opens the Styles home. */
  function installWorkspaceRegistry(): CommandArgValues[] {
    const ran: CommandArgValues[] = [];
    const registry = createCommandRegistry({ getContext: () => emptyContext(), mac: true });
    registry.register({
      category: "View",
      id: "view.setWorkspace",
      level: "application",
      menus: ["never"],
      run: (_ctx: CommandContext, args: CommandArgValues) => {
        ran.push(args);
        showSettingsDocument();
      },
      title: "Switch Workspace",
    });
    setActiveRegistry(registry);
    return ran;
  }

  afterEach(() => {
    setActiveRegistry(null);
  });

  test("it is an alias: it switches to the Styles workspace, whose home is Variables", async () => {
    const ran = installWorkspaceRegistry();
    await runRecord(stylesCommand());
    expect(ran).toEqual([{ workspace: "styles" }]);
    const tab = workspace.tabs.get("project.json");
    expect(tab?.session.ui.canvasMode).toBe("tokens");
    expect(activeTab.value?.id).toBe("project.json");
  });

  test("a view picks one of the tab's three editors after the switch", async () => {
    installWorkspaceRegistry();
    await runRecord(stylesCommand(), { view: "variables" });
    expect(workspace.tabs.get("project.json")?.session.ui.canvasMode).toBe("tokens");
    await runRecord(stylesCommand(), { view: "code" });
    expect(workspace.tabs.get("project.json")?.session.ui.canvasMode).toBe("source");
    await runRecord(stylesCommand(), { view: "elements" });
    expect(workspace.tabs.get("project.json")?.session.ui.canvasMode).toBe("stylebook");
  });

  test("a view nobody declared is refused by name", async () => {
    installWorkspaceRegistry();
    let message = "";
    try {
      await runRecord(stylesCommand(), { view: "tokens" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("declared: elements, variables, code");
  });

  test("without a registry it says what it is missing", async () => {
    setActiveRegistry(null);
    let message = "";
    try {
      await runRecord(stylesCommand());
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("command registry");
  });
});

/*
 * Last, and in this order deliberately: `mock.module` cannot be undone for the rest of a file, and
 * emptying the registry empties it for every test after. Both belong where nothing follows them.
 */

describe("the ends of the registry", () => {
  test("a contribution import that fails leaves the built-ins rendering, and files a Problem", async () => {
    const warn = mock((_message: string, _options?: NotifyOptions) => {});
    void mock.module("../src/services/notify", () => ({ notify: { warn } }));
    void mock.module("../src/settings/extension-sections", () => ({
      extensionSectionsReady: () => Promise.resolve(),
      syncExtensionSettingsSections: () => Promise.reject(new Error("boom")),
    }));
    const { openProjectSettings: open } = await import("../src/settings/settings-document");
    await open("overview");
    await mount();
    expect(navLabels()).toContain("Overview");
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ tier: "problem" });
  });

  test("with no sections at all it says so rather than going blank", async () => {
    await mount();
    for (const key of settingsSectionKeys().toReversed()) {
      unregisterSettingsSection(key);
    }
    await flush();
    expect(navLabels()).toEqual([]);
    expect(body().textContent).toBe("");
    expect(host.querySelector('[part="empty"]')?.textContent).toContain("No settings sections");
  });
});
