/**
 * Tests for src/browse/library-commands.ts — the Content home's verbs, run for real.
 *
 * Running each one must reach the state it names, because the point of making them records is that
 * the palette, `__jxAutomation`, the Collections panel's rows and the home's own controls all get
 * the same behaviour. And each view setter writes the SHOWN collection's own view.
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { CommandContext } from "../src/commands/context";
import type { CommandRegistry } from "../src/commands/registry";
import type { DirEntry } from "../src/types";

void mock.module("../src/files/files.js", () => ({
  loadDirectory: () => Promise.resolve(),
  openFileInTab: () => Promise.resolve(),
}));
/* `content.showCollection` lazily imports the home's opener; doubling it gives the test a witness
   and keeps two real imports of it from ever overlapping (AGENTS.md, the coverage note). */
const homesOpened: string[] = [];
void mock.module("../src/workspace/workspace-home.js", () => ({
  openWorkspaceHome: (id: string) => {
    homesOpened.push(id);
  },
}));

const { LIBRARY_LAYOUTS } = await import("../src/browse/library-model");
const { contentViewCommands, registerContentViewCommands, showCollection } =
  await import("../src/browse/library-commands");
const { collectionView, contentView, detachLibraryPane, librarySource, resetContentView } =
  await import("../src/browse/library-pane");
const { createCommandRegistry } = await import("../src/commands/registry");
const { makeContext } = await import("../src/commands/context");
const { closeAllTabs } = await import("../src/workspace/workspace");

let ctx: CommandContext;
let registry: CommandRegistry;
let listed: string[];

beforeEach(() => {
  listed = [];
  homesOpened.length = 0;
  installMockPlatform({
    listDirectory: (path: string) => {
      listed.push(path);
      const entries: DirEntry[] = [{ name: "a.md", path: `${path}/a.md`, type: "file" }];
      return Promise.resolve(entries);
    },
  });
  resetStudioState({
    projectConfig: { content: { posts: { source: "./content/posts" } } },
    projectDirs: ["pages"],
  });
  closeAllTabs();
  detachLibraryPane("primary");
  resetContentView();
  ctx = makeContext({ project: { isSite: true, open: true } });
  registry = createCommandRegistry({ getContext: () => ctx });
  registerContentViewCommands(registry);
});

describe("running the verbs", () => {
  test("content.showCollection shows the collection and opens the Content home", async () => {
    await registry.run("content.showCollection", { collection: "posts" });
    expect(contentView.collection).toBe("posts");
    expect(homesOpened).toEqual(["content"]);
  });

  test("content.showCollection names Pages and every declared collection, and refuses others", async () => {
    const record = contentViewCommands().find((c) => c.id === "content.showCollection")!;
    expect(record.args?.properties?.collection?.enum).toEqual(["pages", "posts"]);
    let refusal = "";
    try {
      await Promise.resolve(registry.run("content.showCollection", { collection: "nope" }));
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    expect(refusal).toContain("pages, posts");
    expect(contentView.collection).toBe("pages");
  });

  test("showCollection is the same path the command runs", async () => {
    await showCollection("pages");
    expect(contentView.collection).toBe("pages");
    expect(homesOpened).toEqual(["content"]);
  });

  test("content.setLayout names each of the four views, on the shown collection only", async () => {
    for (const layout of LIBRARY_LAYOUTS) {
      await registry.run("content.setLayout", { layout });
      expect(collectionView().layout).toBe(layout);
    }
    expect(collectionView("posts").layout).toBe("table");
  });

  test("content.setSearch sets the filter, and an omitted query CLEARS it", async () => {
    await registry.run("content.setSearch", { query: "hero" });
    expect(collectionView().query).toBe("hero");
    await registry.run("content.setSearch");
    expect(collectionView().query).toBe("");
  });

  test('content.setLocale names a language, and "all" clears it', async () => {
    resetStudioState({
      projectConfig: { i18n: { defaultLocale: "en", locales: ["en", "fr"] } },
      projectDirs: ["pages"],
    });
    ctx = makeContext({ project: { isMultilingual: true, isSite: true, open: true } });
    await registry.run("content.setLocale", { locale: "fr" });
    expect(collectionView().locale).toBe("fr");
    await registry.run("content.setLocale", { locale: "all" });
    expect(collectionView().locale).toBe("");
  });

  test("content.setLocale refuses a language the project does not declare, naming the set", async () => {
    resetStudioState({
      projectConfig: { i18n: { defaultLocale: "en", locales: ["en", "fr"] } },
      projectDirs: ["pages"],
    });
    ctx = makeContext({ project: { isMultilingual: true, isSite: true, open: true } });
    let refusal = "";
    try {
      await Promise.resolve(registry.run("content.setLocale", { locale: "de" }));
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    expect(refusal).toContain("all, en, fr");
    expect(collectionView().locale).toBe("");
  });

  test("content.refresh re-reads the project", async () => {
    await registry.run("content.refresh");
    // The declared collection's source is walked too, though the project's own list lacks it.
    expect(listed).toEqual(["pages", "content/posts"]);
    await registry.run("content.refresh");
    expect(listed).toEqual(["pages", "content/posts", "pages", "content/posts"]);
    expect(librarySource().files().length).toBe(2);
  });
});

describe("the records", () => {
  /*
   * The enums are GETTERS: these records are built at module scope, before any project exists, so
   * a snapshot would freeze at the empty project's answer forever after.
   */
  test("the locale enum is read when the palette asks, not when the record is built", () => {
    const record = contentViewCommands().find((c) => c.id === "content.setLocale")!;
    const property = record.args?.properties?.locale;
    resetStudioState({ projectConfig: {} });
    expect(property?.enum).toEqual(["all"]);
    resetStudioState({
      projectConfig: { i18n: { defaultLocale: "EN-us", locales: ["fr"] } },
    });
    expect(property?.enum).toEqual(["all", "en-US", "fr"]);
  });

  test("content.setLocale is the only one a monolingual project hides", () => {
    ctx = makeContext({ project: { isMultilingual: false, isSite: true, open: true } });
    const hidden = contentViewCommands()
      .map((c) => c.id)
      .filter((id) => !registry.isVisible(id));
    expect(hidden).toEqual(["content.setLocale"]);
  });

  test("every one is project-level, palette-only, and none is offered to the assistant", () => {
    for (const command of contentViewCommands()) {
      expect(command.level).toBe("project");
      expect([command.id, command.aiTool]).toEqual([command.id, undefined]);
      expect([command.id, command.menus]).toEqual([command.id, ["palette"]]);
      expect(command.category).toBe("Project");
      expect(command.id).not.toMatch(/\.toggle[A-Z]/);
    }
  });

  test("every one is hidden with no project open", () => {
    ctx = makeContext();
    for (const command of contentViewCommands()) {
      expect([command.id, registry.isVisible(command.id)]).toEqual([command.id, false]);
    }
  });
});
