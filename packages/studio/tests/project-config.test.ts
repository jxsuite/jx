/**
 * Tests for src/tabs/project-config.ts — `project.json` as a document under the transaction log.
 *
 * The file that defines the project used to be written from twenty-nine call sites across eight
 * modules, in two serialisations, with no history and — at twenty-one of them — no error path. This
 * suite pins the four properties that replaced that:
 *
 * 1. ONE serialisation. Two-space JSON, byte-identical to what `files/file-ops.ts` writes for every
 *    other `.json` document, so a ⌘S on the open tab and a settings edit cannot fight.
 * 2. A NO-OP EDIT WRITES NOTHING. Driven against every `project.json` committed to this repository,
 *    because that is the only honest fixture: those files are `oxfmt`-formatted (short arrays kept
 *    on one line), so a writer that compared bytes rather than values would rewrite all of them.
 * 3. A TRANSACTION. Every commit is undoable, and undo carries the app's live configuration with it.
 * 4. ONE ERROR PATH. A rejected write is a Problem (§16), the document stays dirty, and the next
 *    commit retries.
 */
import { flush, installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { problems, resetNotifications } from "../src/services/notify";
import { projectState, setProjectState } from "../src/store";
import { canUndo, undo } from "../src/tabs/transact";
import { closeAllTabs, openTab, workspace } from "../src/workspace/workspace";
import { toRaw } from "../src/reactivity";
import { deriveJsonLayout, parseJsonDocument, serializeJson } from "@jxsuite/schema/json-layout";

import type { MockPlatformState } from "./harness";
import type { ProjectConfig } from "@jxsuite/schema/types";

const refreshFormats = mock(() => {});
const loadFormats = mock(async () => {});
const refreshExtensionUi = mock(() => {});
void mock.module("../src/format/format-host.js", () => ({
  formatByName: () => null,
  formatForPath: () => null,
  loadFormats,
  refreshExtensionUi,
  refreshFormats,
}));

const {
  PROJECT_CONFIG_PATH,
  adoptProjectConfig,
  commitProjectConfig,
  projectConfigDocument,
  resetProjectConfigDocument,
  serializeProjectConfig,
} = await import("../src/tabs/project-config");
const { updateSiteConfig } = await import("../src/site-context");

/**
 * Every `project.json` this repository commits — the only fixture with real formatting in it.
 *
 * Resolved from THIS FILE rather than from the working directory. It used to read `cwd: "../.."` on
 * the stated assumption that studio's tests always run from `packages/studio`; run from the repo
 * root, `../..` points above the repository, the glob matches nothing, and the loop below iterates
 * an empty list — passing, vacuously. The count assertion is what catches that, and it should never
 * have had to.
 */
const REPO_ROOT = resolve(import.meta.dir, "../../..");
const COMMITTED_CONFIGS = ["sites", "packages/starters/sites"]
  .flatMap((dir) => globSync(`${dir}/*/project.json`, { cwd: REPO_ROOT }))
  .map((relative) => join(REPO_ROOT, relative))
  .toSorted();

type AnyConfig = Record<string, unknown>;

function config(): AnyConfig {
  return projectState!.projectConfig as unknown as AnyConfig;
}

/** Project.json writes the mock platform saw, newest last. */
function writes(state: MockPlatformState): string[] {
  return state.calls
    .filter((call) => call[0] === "writeFile" && call[1] === PROJECT_CONFIG_PATH)
    .map((call) => call[2] as string);
}

/**
 * Install a platform and a project. `onDisk` seeds `project.json` exactly as a repository holds it,
 * which is what makes the no-op assertions meaningful.
 */
function setup(
  cfg: AnyConfig | null,
  opts: { onDisk?: string; writeFile?: StudioWrite } = {},
): MockPlatformState {
  const overrides = opts.writeFile ? { writeFile: opts.writeFile } : {};
  const { state } = installMockPlatform(
    overrides as never,
    opts.onDisk === undefined ? {} : { [PROJECT_CONFIG_PATH]: opts.onDisk },
  );
  resetStudioState({ projectConfig: cfg as unknown });
  return state;
}

type StudioWrite = (path: string, content: string) => Promise<void>;

beforeEach(() => {
  resetProjectConfigDocument();
  resetNotifications();
  closeAllTabs();
  refreshFormats.mockClear();
  loadFormats.mockClear();
  refreshExtensionUi.mockClear();
});

afterEach(() => {
  resetProjectConfigDocument();
  closeAllTabs();
});

// ─── One serialisation ───────────────────────────────────────────────────────

describe("serializeProjectConfig", () => {
  test("is two-space JSON ending in a newline — the form every project.json in this repo is on disk with", () => {
    const text = serializeProjectConfig({ $defs: { A: {} }, name: "site" } as ProjectConfig);
    expect(text).not.toContain("\t");
    expect(text).toContain('\n  "$defs"');
    expect(text.endsWith("}\n")).toBe(true);
  });

  test("is exactly what files/serialize-document.ts writes for a native JSON document", () => {
    const cfg = { name: "site", style: { "--a": "1" } } as unknown as ProjectConfig;
    expect(serializeProjectConfig(cfg)).toBe(serializeJson(cfg, null));
  });

  test("honours the open project.json tab's layout, so a settings write keeps the file's shape", () => {
    const onDisk =
      '{\n  "name": "site",\n  "style": { "--a": "1" },\n  "locales": ["en", "fr"]\n}\n';
    const { document, layout } = parseJsonDocument(onDisk);
    openTab({ document, documentPath: PROJECT_CONFIG_PATH, id: PROJECT_CONFIG_PATH, layout });
    const cfg = { ...document, name: "renamed" } as unknown as ProjectConfig;
    expect(serializeProjectConfig(cfg)).toBe(onDisk.replace('"site"', '"renamed"'));
  });
});

// ─── The chokepoint ──────────────────────────────────────────────────────────

describe("commitProjectConfig", () => {
  test("writes once, syncs projectState and the workspace", async () => {
    const state = setup({ name: "Old" });
    await updateSiteConfig({ name: "New" } as Partial<ProjectConfig>);

    expect(writes(state)).toHaveLength(1);
    expect(JSON.parse(writes(state)[0]!).name).toBe("New");
    expect(config().name).toBe("New");
    expect((workspace.projectConfig as AnyConfig).name).toBe("New");
  });

  test("an undefined patch value clears the key rather than persisting an empty one", async () => {
    const state = setup({ name: "Site", url: "https://example.com" });
    await updateSiteConfig({ url: undefined } as unknown as Partial<ProjectConfig>);

    expect(JSON.parse(writes(state)[0]!)).toEqual({ name: "Site" });
  });

  test("commits an in-place mutation with no patch — the master-detail editors' shape", async () => {
    const state = setup({ $defs: {}, name: "Site" });
    (config().$defs as AnyConfig).Author = { type: "object" };
    const result = await commitProjectConfig();

    expect(result.ok).toBe(true);
    expect(JSON.parse(writes(state)[0]!).$defs.Author).toEqual({ type: "object" });
  });

  test("leaves the document clean after a successful commit", async () => {
    setup({ name: "Site" });
    await updateSiteConfig({ name: "Other" } as Partial<ProjectConfig>);
    expect(projectConfigDocument().doc.dirty).toBe(false);
  });
});

// ─── A no-op edit writes nothing ─────────────────────────────────────────────

/*
 * The plan's required assertion, run against real bytes. Both calling shapes are exercised for
 * every committed file, which between them is every former writer: `site-context.ts`'s patch door
 * (`updateSiteConfig`, ten sites) and the in-place door the two settings editors use
 * (`contributed-section.ts`, five sites; `defs-editor.ts`, fourteen).
 */

describe("a no-op settings edit produces an empty diff", () => {
  test("the repository has project.json files to check", () => {
    expect(COMMITTED_CONFIGS.length).toBeGreaterThan(5);
  });

  test("a layout-less rendering differs from disk for at least one committed file", () => {
    const differs = COMMITTED_CONFIGS.filter((path) => {
      const onDisk = readFileSync(path, "utf8");
      return serializeJson(JSON.parse(onDisk), null) !== onDisk;
    });
    expect(differs.length).toBeGreaterThan(0);
  });

  test("no writer touches a committed project.json when nothing changed", async () => {
    for (const path of COMMITTED_CONFIGS) {
      const onDisk = readFileSync(path, "utf8");
      const parsed = JSON.parse(onDisk) as AnyConfig;

      /* The premise, asserted rather than assumed: with the layout the file was written in, its
         re-serialisation IS the file — `oxfmt` keeps short objects on one line and ends the file
         with a newline, and `json-layout.ts` reproduces both — and without that layout it is not,
         for at least one of them. A writer that compared TEXT against a layout-less rendering would
         rewrite such a file on every edit; the chokepoint reads the layout once per binding and
         compares like with like. */
      expect(serializeJson(parsed, deriveJsonLayout(onDisk)), path).toBe(onDisk);

      // The patch door: re-commit values the file already holds.
      resetProjectConfigDocument();
      let state = setup(structuredClone(parsed), { onDisk });
      await updateSiteConfig({ name: parsed.name } as Partial<ProjectConfig>);
      expect(writes(state), `${path} rewritten by updateSiteConfig`).toHaveLength(0);
      expect(state.files.get(PROJECT_CONFIG_PATH)).toBe(onDisk);

      // The in-place door: commit without having changed anything.
      resetProjectConfigDocument();
      state = setup(structuredClone(parsed), { onDisk });
      await commitProjectConfig();
      expect(writes(state), `${path} rewritten by commitProjectConfig`).toHaveLength(0);
      expect(state.files.get(PROJECT_CONFIG_PATH)).toBe(onDisk);
    }
  });

  test("a real edit to one of those files still writes — and writes a one-line diff", async () => {
    const path = COMMITTED_CONFIGS[0]!;
    const onDisk = readFileSync(path, "utf8");
    const parsed = JSON.parse(onDisk) as AnyConfig;
    const state = setup(parsed, { onDisk });
    await updateSiteConfig({ name: "Renamed" } as Partial<ProjectConfig>);

    expect(writes(state)).toHaveLength(1);
    const written = state.files.get(PROJECT_CONFIG_PATH)!;
    expect(JSON.parse(written).name).toBe("Renamed");
    /* The file's own layout, read by the chokepoint when it seeded, is what the write honours: the
       only line that differs is the name's. (`project-config.ts`'s header, "A real edit is a
       one-line diff".) */
    const changed = written.split("\n").filter((line, i) => line !== onDisk.split("\n")[i]);
    expect(changed).toEqual([`  "name": "Renamed",`]);
  });

  test("an unparseable project.json is 'unknown', so every commit writes", async () => {
    const state = setup({ name: "Site" }, { onDisk: "{ not json" });
    await updateSiteConfig({ name: "Site" } as Partial<ProjectConfig>);
    expect(writes(state)).toHaveLength(1);
  });
});

// ─── A transaction ───────────────────────────────────────────────────────────

describe("the transaction log", () => {
  test("a commit is undoable, and undo carries the live configuration back with it", async () => {
    setup({ name: "Old" });
    await updateSiteConfig({ name: "New" } as Partial<ProjectConfig>);

    const tab = projectConfigDocument();
    expect(canUndo(tab)).toBe(true);

    undo(tab);
    expect((toRaw(tab.doc.document) as unknown as AnyConfig).name).toBe("Old");
    expect(config().name).toBe("Old");
  });

  test("a commit that changes nothing pushes no history entry", async () => {
    const cfg = { name: "Site" };
    setup(cfg, { onDisk: serializeProjectConfig(cfg as ProjectConfig) });
    await updateSiteConfig({ name: "Site" } as Partial<ProjectConfig>);
    expect(canUndo(projectConfigDocument())).toBe(false);
  });
});

// ─── One error path ──────────────────────────────────────────────────────────

describe("a rejected write", () => {
  test("becomes a Problem, leaves the document dirty, and rethrows through updateSiteConfig", async () => {
    setup(
      { name: "Site" },
      {
        writeFile: async () => {
          throw new Error("EROFS: read-only file system");
        },
      },
    );

    let thrown: unknown;
    try {
      await updateSiteConfig({ name: "Other" } as Partial<ProjectConfig>);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error | undefined)?.message).toContain("EROFS");
    await flush();

    const failure = problems.find((p) => p.message.includes("Could not save project.json"));
    expect(failure?.source).toBe("Settings");
    expect(failure?.path).toBe(PROJECT_CONFIG_PATH);
    expect(projectConfigDocument().doc.dirty).toBe(true);
  });

  test("commitProjectConfig reports rather than throws, and the retry writes", async () => {
    let fail = true;
    const state = setup(
      { name: "Site" },
      {
        writeFile: async (path: string, content: string) => {
          if (fail) {
            throw new Error("EROFS");
          }
          state.files.set(path, content);
        },
      },
    );

    (config() as AnyConfig).name = "Other";
    const first = await commitProjectConfig();
    expect(first.ok).toBe(false);
    expect((first.error as Error).message).toBe("EROFS");

    fail = false;
    const second = await commitProjectConfig();
    expect(second.ok).toBe(true);
    expect(projectConfigDocument().doc.dirty).toBe(false);
  });
});

// ─── The document of record ──────────────────────────────────────────────────

describe("binding", () => {
  test("returns the same document across calls", () => {
    setup({ name: "Site" });
    expect(projectConfigDocument()).toBe(projectConfigDocument());
  });

  test("points projectState at the document even when the project had none", () => {
    setup(null);
    const tab = projectConfigDocument();
    expect(config()).toBe(toRaw(tab.doc.document) as unknown as AnyConfig);
  });

  test("an open project.json tab BECOMES the configuration document", async () => {
    const state = setup({ name: "Site" });
    const detached = projectConfigDocument();

    const opened = openTab({
      document: { name: "Site" } as unknown as Record<string, unknown>,
      documentPath: PROJECT_CONFIG_PATH,
      id: PROJECT_CONFIG_PATH,
    });
    const bound = projectConfigDocument();
    expect(bound).not.toBe(detached);
    expect(bound.id).toBe(opened.id);
    expect(bound.documentPath).toBe(PROJECT_CONFIG_PATH);
    expect(bound.capabilities.modes).toEqual(["stylebook", "source"]);

    await updateSiteConfig({ name: "Edited" } as Partial<ProjectConfig>);
    expect((toRaw(bound.doc.document) as unknown as AnyConfig).name).toBe("Edited");
    expect(JSON.parse(writes(state).at(-1)!).name).toBe("Edited");
  });

  test("closing that tab hands the document back", () => {
    setup({ name: "Site" });
    openTab({
      document: { name: "Site" } as unknown as Record<string, unknown>,
      documentPath: PROJECT_CONFIG_PATH,
      id: PROJECT_CONFIG_PATH,
    });
    const bound = projectConfigDocument();

    closeAllTabs();
    expect(projectConfigDocument()).not.toBe(bound);
  });

  test("a second project rebinds", () => {
    setup({ name: "First" });
    const first = projectConfigDocument();
    resetStudioState({ projectConfig: { name: "Second" } as unknown });
    const second = projectConfigDocument();

    expect(second).not.toBe(first);
    expect((toRaw(second.doc.document) as unknown as AnyConfig).name).toBe("Second");
  });
});

// ─── One configuration object ────────────────────────────────────────────────

/*
 * The handover, reproduced the way an author reaches it. `files/files.ts` opens `project.json` by
 * parsing the file itself, so the tab arrives holding a SECOND configuration object while every
 * settings section is still rendering — and mutating in place — the one the project loaded with.
 * Binding is reached lazily, from inside the commit, so the first commit after that tab appears is
 * the one that has to reconcile them. It used to let the tab's parse win by arriving last, which
 * wrote the author's edit out of memory AND out of the file while reporting success.
 */

/** Open `project.json` the way the Files tree does: a parse of the file, not the live config. */
function openConfigTabWithOwnParse(onDisk: string) {
  return openTab({
    document: JSON.parse(onDisk) as Record<string, unknown>,
    documentPath: PROJECT_CONFIG_PATH,
    id: PROJECT_CONFIG_PATH,
  });
}

describe("the handover from a project.json tab opened beside the settings form", () => {
  test("the first settings edit after that tab appears is committed, not dropped", async () => {
    const cfg = { $defs: {}, name: "Site" };
    const onDisk = serializeProjectConfig(cfg as ProjectConfig);
    const state = setup(structuredClone(cfg), { onDisk });
    const tab = openConfigTabWithOwnParse(onDisk);
    // The premise: two objects with the same content, which is what makes the loss silent.
    expect(toRaw(tab.doc.document) as unknown).not.toBe(config());

    // Defs-editor.ts's shape — mutate the live configuration in place, then commit with no patch.
    (config().$defs as AnyConfig).Author = { type: "object" };
    const result = await commitProjectConfig();

    expect(result.ok).toBe(true);
    expect(JSON.parse(writes(state).at(-1)!).$defs).toEqual({ Author: { type: "object" } });
    expect((toRaw(tab.doc.document) as unknown as AnyConfig).$defs).toEqual({
      Author: { type: "object" },
    });
    expect(config().$defs).toEqual({ Author: { type: "object" } });
  });

  test("a patch lands on the live configuration's content, not on the tab's parse", async () => {
    const cfg = { name: "Site" };
    const onDisk = serializeProjectConfig(cfg as ProjectConfig);
    const state = setup(structuredClone(cfg), { onDisk });
    openConfigTabWithOwnParse(onDisk);

    (config() as AnyConfig).description = "Typed into the form";
    await updateSiteConfig({ name: "Renamed" } as Partial<ProjectConfig>);

    expect(JSON.parse(writes(state).at(-1)!)).toEqual({
      description: "Typed into the form",
      name: "Renamed",
    });
  });

  test("a key the form removed does not come back from the tab's parse", async () => {
    const cfg = { name: "Site", url: "https://example.com" };
    const onDisk = serializeProjectConfig(cfg as ProjectConfig);
    const state = setup(structuredClone(cfg), { onDisk });
    openConfigTabWithOwnParse(onDisk);

    delete (config() as AnyConfig).url;
    await commitProjectConfig();

    expect(JSON.parse(writes(state).at(-1)!)).toEqual({ name: "Site" });
  });

  test("a tab that agrees is no rival: a no-op commit still writes nothing", async () => {
    const cfg = { name: "Site" };
    const onDisk = serializeProjectConfig(cfg as ProjectConfig);
    const state = setup(structuredClone(cfg), { onDisk });
    openConfigTabWithOwnParse(onDisk);

    await commitProjectConfig();
    expect(writes(state)).toHaveLength(0);
  });

  test("every commit after the first is an ordinary one — the objects are the same by then", async () => {
    const cfg = { name: "Site" };
    const onDisk = serializeProjectConfig(cfg as ProjectConfig);
    const state = setup(structuredClone(cfg), { onDisk });
    const tab = openConfigTabWithOwnParse(onDisk);

    (config() as AnyConfig).name = "First";
    await commitProjectConfig();
    expect(config()).toBe(toRaw(tab.doc.document) as unknown as AnyConfig);

    (config() as AnyConfig).name = "Second";
    await commitProjectConfig();
    expect(JSON.parse(writes(state).at(-1)!).name).toBe("Second");
    expect(writes(state)).toHaveLength(2);
  });

  test("unsaved source edits and a settings edit are a Problem, not a silent winner", async () => {
    const cfg = { name: "Site" };
    const onDisk = serializeProjectConfig(cfg as ProjectConfig);
    const state = setup(structuredClone(cfg), { onDisk });
    const tab = openConfigTabWithOwnParse(onDisk);
    (toRaw(tab.doc.document) as unknown as AnyConfig).description = "typed in the source editor";
    tab.doc.dirty = true;

    (config() as AnyConfig).name = "Renamed in Settings";
    const result = await commitProjectConfig();
    await flush();

    expect(result.ok).toBe(false);
    expect(writes(state)).toHaveLength(0);
    const problem = problems.find((p) => p.message.includes("Could not save project.json"));
    expect(problem?.message).toContain("unsaved changes");
    expect(problem?.source).toBe("Settings");
    // Neither side was applied: the author's source edit is still there to save or revert.
    expect((toRaw(tab.doc.document) as unknown as AnyConfig).description).toBe(
      "typed in the source editor",
    );
  });
});

// ─── A configuration that reached disk another way ───────────────────────────

/**
 * Adopt `config` the way the assistant's `write_file` does: the bytes on the platform are the
 * caller's own serialisation, and adopt is told what they were rather than reading them back.
 */
function adopt(written: AnyConfig, text = serializeJson(written, null)): Promise<void> {
  return adoptProjectConfig(written as never, text);
}

describe("adoptProjectConfig", () => {
  test("puts the written config INTO the document, so the next edit builds on it", async () => {
    const cfg = { name: "Site" };
    const state = setup(structuredClone(cfg), { onDisk: serializeProjectConfig(cfg as never) });
    await adopt({ description: "By the assistant", name: "Assistant Site" });

    const tab = projectConfigDocument();
    expect((toRaw(tab.doc.document) as unknown as AnyConfig).name).toBe("Assistant Site");
    expect(config()).toBe(toRaw(tab.doc.document) as unknown as AnyConfig);
    // The bytes are on disk already: no write of our own, and no undo entry offering to take back
    // What the log could not take back from the file.
    expect(writes(state)).toHaveLength(0);
    expect(canUndo(tab)).toBe(false);
    expect(tab.doc.dirty).toBe(false);

    await updateSiteConfig({ name: "Renamed" } as Partial<ProjectConfig>);
    expect(JSON.parse(writes(state).at(-1)!)).toEqual({
      description: "By the assistant",
      name: "Renamed",
    });
  });

  test("the next no-op commit knows the file already says it", async () => {
    const cfg = { name: "Site" };
    const state = setup(structuredClone(cfg), { onDisk: serializeProjectConfig(cfg as never) });
    await adopt({ name: "Assistant Site" });

    await commitProjectConfig();
    expect(writes(state)).toHaveLength(0);
  });

  test("refreshes an open project.json tab without parsing the file a second time", async () => {
    const onDisk = serializeProjectConfig({ name: "Site" } as never);
    setup({ name: "Site" }, { onDisk });
    const tab = openConfigTabWithOwnParse(onDisk);

    await adopt({ name: "Assistant Site" });

    expect((toRaw(tab.doc.document) as unknown as AnyConfig).name).toBe("Assistant Site");
    expect(config()).toBe(toRaw(tab.doc.document) as unknown as AnyConfig);
  });

  test("with no project state there is no document, so only the workspace copy is kept true", async () => {
    setup({ name: "Site" });
    setProjectState(null);

    await adopt({ name: "Assistant Site" });

    expect((workspace.projectConfig as AnyConfig).name).toBe("Assistant Site");
  });

  /* The record the next commit honours is the record of the file as it IS — the assistant's bytes
     — not of the file the chokepoint read before the assistant rewrote it (issue 331). The seed
     reads the OLD file's record first, through the no-op commit, which is what makes the stale
     record available to keep; disk is then left holding the old text on purpose, so an adopt that
     read the file back — the second parse the adoption exists to avoid — would find the wrong
     record there and fail this test too. The only route to the assistant's record is the text
     adopt is handed. */
  test("the record of the written text replaces the seed's, so the next edit keeps the assistant's layout", async () => {
    // The file as first read: every object expanded, which is `JSON.stringify`'s layout.
    const before = { name: "Site", style: { "--a": "1" } };
    const state = setup(structuredClone(before), { onDisk: serializeJson(before, null) });
    expect(state.files.get(PROJECT_CONFIG_PATH)).toContain('"style": {\n');
    // Seed from that file — a commit that changes nothing reads the record and writes nothing.
    await commitProjectConfig();
    expect(writes(state)).toHaveLength(0);

    // The assistant rewrites the file with the style object on one line, and a blank line after
    // The name — two facts only the record can carry.
    const written = '{\n  "name": "Assistant Site",\n\n  "style": { "--a": "1", "--b": "2" }\n}\n';
    await adopt(JSON.parse(written) as AnyConfig, written);

    await updateSiteConfig({ name: "Renamed" } as Partial<ProjectConfig>);
    expect(writes(state).at(-1)).toBe(written.replace('"Assistant Site"', '"Renamed"'));
  });

  /* The record is not the whole of the file's shape: the serializer writes keys in the DOCUMENT's
     order, and a document that kept the previous file's order for the keys the assistant moved
     would re-lay the file on the next commit even with the right record — and call a no-op commit
     a change, because `_committed` is in the assistant's order and the document was not. */
  test("a rewrite that moved a top-level key stays moved: the document takes the written order", async () => {
    const before = { name: "Site", style: { "--a": "1" } };
    const state = setup(structuredClone(before), { onDisk: serializeJson(before, null) });
    await commitProjectConfig();
    expect(writes(state)).toHaveLength(0);

    // `style` first, `name` second — the assistant's order, not the file's.
    const written = '{\n  "style": { "--a": "1" },\n  "name": "Assistant Site"\n}\n';
    await adopt(JSON.parse(written) as AnyConfig, written);
    const document = toRaw(projectConfigDocument().doc.document);
    expect(Object.keys(document)).toEqual(["style", "name"]);

    // A commit that changes nothing still writes nothing: the document and the file agree.
    await commitProjectConfig();
    expect(writes(state)).toHaveLength(0);

    // And a one-field edit is a one-line diff on the file in the order the assistant wrote it.
    await updateSiteConfig({ name: "Renamed" } as Partial<ProjectConfig>);
    expect(writes(state)).toHaveLength(1);
    expect(writes(state).at(-1)).toBe(written.replace('"Assistant Site"', '"Renamed"'));
  });

  test("an open project.json tab is handed the written text's record with the config", async () => {
    const onDisk = serializeJson({ name: "Site", style: { "--a": "1" } }, null);
    const state = setup({ name: "Site", style: { "--a": "1" } }, { onDisk });
    // The tab read the file itself, so it holds the expanded record that the write is replacing.
    const { document, layout } = parseJsonDocument(onDisk);
    const tab = openTab({
      document,
      documentPath: PROJECT_CONFIG_PATH,
      id: PROJECT_CONFIG_PATH,
      layout,
    });
    expect(tab.doc.layout?.inline.get("/style")).toBe(false);

    const written = '{\n  "name": "Assistant Site",\n  "style": { "--a": "1" }\n}\n';
    await adopt(JSON.parse(written) as AnyConfig, written);

    // The tab's own record now says what the file says, so ⌘S on it and a settings commit agree.
    expect(tab.doc.layout?.inline.get("/style")).toBe(true);
    expect(toRaw(tab.doc.layout as object)).toEqual(deriveJsonLayout(written));
    // The contract is what reaches disk, so the write is what is asserted — not the serializer.
    await updateSiteConfig({ name: "Renamed" } as Partial<ProjectConfig>);
    expect(writes(state).at(-1)).toBe(written.replace('"Assistant Site"', '"Renamed"'));
  });
});

// ─── Enabled extensions ──────────────────────────────────────────────────────

describe("the enabled-extension surface", () => {
  test("an extensions change rebuilds formats and the contributed sections", async () => {
    setup({ extensions: [], name: "Site" });
    await updateSiteConfig({ extensions: ["@jxsuite/parser"] } as Partial<ProjectConfig>);

    expect(refreshFormats).toHaveBeenCalled();
    expect(refreshExtensionUi).toHaveBeenCalled();
  });

  test("an unrelated change does not", async () => {
    setup({ extensions: ["@jxsuite/parser"], name: "Site" });
    await updateSiteConfig({ name: "Other" } as Partial<ProjectConfig>);

    expect(refreshFormats).not.toHaveBeenCalled();
  });
});
