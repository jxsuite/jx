/**
 * Tests for src/i18n/i18n-commands.ts — the four translation verbs.
 *
 * They are exercised through a LIVE registry (`registry.run(id, args)`) rather than by calling
 * `record.run` directly, so registration's own placement and duplicate checks run, and so the
 * refusals a record's `when` owns are asserted where the app would meet them.
 */
import { flush, installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { closeAllTabs, openTab, workspace } from "../src/workspace/workspace";

const opened: string[] = [];
const created: Record<string, unknown>[] = [];
let createResult: string | null = "pages/fr/about.json";

function mockFiles(): void {
  void mock.module("../src/files/files", () => ({
    createFileIn: (request: Record<string, unknown>) => {
      created.push(request);
      return Promise.resolve(createResult);
    },
    openFileInTab: (path: string) => {
      opened.push(path);
      return Promise.resolve();
    },
  }));
}
mockFiles();

const { i18nCommands, registerI18nCommands } = await import("../src/i18n/i18n-commands");
const { createCommandRegistry } = await import("../src/commands/registry");
const { makeContext } = await import("../src/commands/context");
const { problems, toasts } = await import("../src/services/notify");
const { setActivityTab, shell } = await import("../src/shell");

const EN_FR = { defaultLocale: "en", locales: ["en", "fr"] };

/** A live registry over the records, so registration's own checks run too. */
function liveRegistry(multilingual = true) {
  const registry = createCommandRegistry({
    getContext: () =>
      makeContext({
        document: { open: true },
        project: { isMultilingual: multilingual, open: true },
      }),
  });
  registerI18nCommands(registry);
  return registry;
}

function command(id: string) {
  const record = i18nCommands().find((c) => c.id === id);
  if (!record) {
    throw new Error(`no command ${id}`);
  }
  return record;
}

/** The one message the last run produced, whichever store it landed in. */
function said(): string {
  return [...problems, ...toasts].map((record) => record.message).join(" | ");
}

beforeEach(() => {
  opened.length = 0;
  created.length = 0;
  createResult = "pages/fr/about.json";
  problems.length = 0;
  toasts.length = 0;
  mockFiles();
  closeAllTabs();
  resetWorkspaceWithTab(undefined, { documentPath: "pages/about.json" });
  resetStudioState({ projectConfig: { i18n: EN_FR } });
  installMockPlatform({}, { "pages/about.json": '{"tagName":"div"}' });
});

describe("the records", () => {
  test("declares four, each with a requires sentence", () => {
    expect(i18nCommands().map((c) => c.id)).toEqual([
      "i18n.openTranslation",
      "i18n.createTranslation",
      "i18n.showParity",
      "i18n.addLocale",
    ]);
    for (const record of i18nCommands()) {
      expect(record.requires, `${record.id} has no requires sentence`).toBeTruthy();
    }
  });

  test("only i18n.addLocale is reachable in a project with one language", () => {
    const registry = liveRegistry(false);
    const visible = i18nCommands()
      .filter((c) => registry.isVisible(c.id))
      .map((c) => c.id);
    // The whole point of Add Language is to be there BEFORE the project is multilingual.
    expect(visible).toEqual(["i18n.addLocale"]);
  });

  test("the locale enum is a getter, so it is not frozen at boot", () => {
    // The records are built here with a project open, then read again after the project changes —
    // A snapshot taken at record-construction time cannot pass both halves.
    const schema = command("i18n.openTranslation").args as {
      properties: { locale: { enum: string[] } };
    };
    expect(schema.properties.locale.enum).toEqual(["en", "fr"]);
    resetStudioState({ projectConfig: { i18n: { locales: ["en", "de", "ja"] } } });
    expect(schema.properties.locale.enum).toEqual(["en", "de", "ja"]);
  });
});

describe("i18n.openTranslation", () => {
  test("opens the sibling file for the locale", async () => {
    installMockPlatform({}, { "pages/about.json": "{}", "pages/fr/about.json": "{}" });
    await liveRegistry().run("i18n.openTranslation", { locale: "fr" });
    expect(opened).toEqual(["pages/fr/about.json"]);
  });

  test("addresses a named pane rather than the focus", async () => {
    installMockPlatform({}, { "pages/fr/contact.json": "{}" });
    const tab = openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/contact.json",
      id: "pages/contact.json",
    });
    const pane = workspace.panes.find((p) => p.tabOrder.includes(tab.id))!;
    await liveRegistry().run("i18n.openTranslation", { locale: "fr", pane: pane.id });
    expect(opened).toEqual(["pages/fr/contact.json"]);
  });

  test("a pane holding no document is refused by name", () => {
    expect(() =>
      liveRegistry().run("i18n.openTranslation", { locale: "fr", pane: "no-such-pane" }),
    ).toThrow(/no document is open in pane/);
  });

  test("addresses a named file rather than the focus — the Languages panel's row", async () => {
    // The focused tab is `pages/about.json`; the row the panel clicked is another file entirely,
    // And it need not be open in any pane.
    installMockPlatform({}, { "pages/fr/contact.json": "{}" });
    await liveRegistry().run("i18n.openTranslation", { locale: "fr", path: "pages/contact.json" });
    expect(opened).toEqual(["pages/fr/contact.json"]);
  });

  test("a file AND a pane is two addresses, and is refused rather than picked between", () => {
    const pane = workspace.activePaneId;
    expect(() =>
      liveRegistry().run("i18n.openTranslation", {
        locale: "fr",
        pane,
        path: "pages/contact.json",
      }),
    ).toThrow(
      'command "i18n.openTranslation" argument "path": names a file while "pane" names a pane',
    );
    expect(opened).toEqual([]);
  });

  test("a missing translation names the verb that would create it, and opens nothing", async () => {
    await liveRegistry().run("i18n.openTranslation", { locale: "fr" });
    expect(opened).toEqual([]);
    expect(said()).toContain("no français translation");
    // `warn`, so it rests and fades: a translation that does not exist yet is not a fault to fix.
    // The action carries the whole address: `locale` is required, and the toast may be clicked
    // After the author has moved to another document.
    expect(toasts.find((t) => t.action === "i18n.createTranslation")?.actionArgs).toEqual({
      locale: "fr",
      path: "pages/about.json",
    });
  });

  test("a locale the project does not declare is refused, not silently defaulted", () => {
    // The schema's refusal, before `run`: `locale` is a derived enum over the declared locales and
    // `registry.run` coerces against it, so the sentence names what the project DOES declare — the
    // Toast `siblingPath` raises remains for a caller that reaches the body directly.
    expect(() => liveRegistry().run("i18n.openTranslation", { locale: "de" })).toThrow(
      'command "i18n.openTranslation" argument "locale": "de" is not declared — declared: en, fr',
    );
    expect(opened).toEqual([]);
  });

  test("a file that cannot carry a locale says so rather than inventing a path", async () => {
    resetWorkspaceWithTab(undefined, { documentPath: "project.json" });
    await liveRegistry().run("i18n.openTranslation", { locale: "fr" });
    expect(opened).toEqual([]);
    expect(said()).toContain("cannot have a translation");
  });

  test("asking for the locale the open file already is, is a statement not a navigation", async () => {
    await liveRegistry().run("i18n.openTranslation", { locale: "en" });
    expect(opened).toEqual([]);
    expect(said()).toContain("already the English copy");
  });

  test("no document at all is refused before any path arithmetic happens", () => {
    closeAllTabs();
    expect(() => liveRegistry().run("i18n.openTranslation", { locale: "fr" })).toThrow(
      /needs a document open/,
    );
  });

  test("a document that was never saved is refused", () => {
    closeAllTabs();
    openTab({ document: { children: [], tagName: "div" }, id: "untitled" });
    expect(() => liveRegistry().run("i18n.openTranslation", { locale: "fr" })).toThrow(
      /saved to a file/,
    );
  });
});

describe("i18n.createTranslation", () => {
  test("creates the sibling seeded from the source file, then opens it", async () => {
    installMockPlatform({}, { "pages/about.json": '{"tagName":"main"}' });
    await liveRegistry().run("i18n.createTranslation", { locale: "fr" });
    expect(created).toEqual([
      {
        content: '{"tagName":"main"}',
        dir: "pages/fr",
        source: "Languages",
        suggestedName: "about.json",
        title: "New français translation",
      },
    ]);
    expect(opened).toEqual(["pages/fr/about.json"]);
  });

  test("a cancelled name field opens nothing", async () => {
    createResult = null;
    await liveRegistry().run("i18n.createTranslation", { locale: "fr" });
    expect(opened).toEqual([]);
  });

  test("refuses when the translation already exists, naming the verb that opens it", async () => {
    installMockPlatform({}, { "pages/about.json": "{}", "pages/fr/about.json": "{}" });
    await liveRegistry().run("i18n.createTranslation", { locale: "fr" });
    expect(created).toEqual([]);
    expect(said()).toContain("already exists");
    expect(toasts.find((t) => t.action === "i18n.openTranslation")?.actionArgs).toEqual({
      locale: "fr",
      path: "pages/about.json",
    });
  });

  test("seeds from the file `path` names, whatever document has the focus", async () => {
    // What the Languages panel's "+" cell sends: the ROW's file, which is not the focused tab.
    installMockPlatform({}, { "pages/contact.json": '{"tagName":"section"}' });
    createResult = "pages/fr/contact.json";
    await liveRegistry().run("i18n.createTranslation", {
      locale: "fr",
      path: "pages/contact.json",
    });
    expect(created).toEqual([
      {
        content: '{"tagName":"section"}',
        dir: "pages/fr",
        source: "Languages",
        suggestedName: "contact.json",
        title: "New français translation",
      },
    ]);
    expect(opened).toEqual(["pages/fr/contact.json"]);
  });

  test("an unreadable source is reported with its path and creates nothing", async () => {
    installMockPlatform({});
    await liveRegistry().run("i18n.createTranslation", { locale: "fr" });
    expect(created).toEqual([]);
    expect(said()).toContain("Could not read pages/about.json");
  });

  test("a source at the project root creates into the root, not into an empty directory", async () => {
    resetStudioState({
      projectConfig: { i18n: { locales: ["en", "fr"], routing: "prefix-always" } },
    });
    resetWorkspaceWithTab(undefined, { documentPath: "en/index.json" });
    installMockPlatform({}, { "en/index.json": "{}" });
    createResult = "fr/index.json";
    await liveRegistry().run("i18n.createTranslation", { locale: "fr" });
    expect(created[0]).toMatchObject({ dir: "fr", suggestedName: "index.json" });
  });
});

describe("i18n.showParity", () => {
  test("reveals the Languages panel — the only door to it, since it is off the rail", async () => {
    setActivityTab("files");
    await liveRegistry().run("i18n.showParity");
    expect(shell.leftTab).toBe("i18n");
    expect(shell.docks.left.collapsed).toBe(false);
  });
});

describe("i18n.addLocale", () => {
  test("declares the tag through the section's own write", async () => {
    const { state } = installMockPlatform();
    resetStudioState({ projectConfig: { i18n: { defaultLocale: "en", locales: ["en"] } } });
    await liveRegistry().run("i18n.addLocale", { locale: "ja" });
    await flush(2);
    const written = JSON.parse(state.files.get("project.json")!) as {
      i18n: { defaultLocale: string; locales: string[] };
    };
    expect(written.i18n).toEqual({ defaultLocale: "en", locales: ["en", "ja"] });
  });

  test("a malformed tag is refused with words and writes nothing", async () => {
    const { state } = installMockPlatform();
    resetStudioState({ projectConfig: { i18n: { locales: ["en"] } } });
    await liveRegistry().run("i18n.addLocale", { locale: "en_US" });
    await flush(2);
    expect(state.files.has("project.json")).toBe(false);
    expect(said()).toContain("not a well-formed language tag");
  });

  test("is reachable in a project that declares nothing at all", async () => {
    const { state } = installMockPlatform();
    resetStudioState({ projectConfig: {} });
    const registry = liveRegistry(false);
    expect(registry.isEnabled("i18n.addLocale")).toBe(true);
    await registry.run("i18n.addLocale", { locale: "fr" });
    await flush(2);
    expect((JSON.parse(state.files.get("project.json")!) as { i18n: unknown }).i18n).toEqual({
      locales: ["fr"],
    });
  });
});
