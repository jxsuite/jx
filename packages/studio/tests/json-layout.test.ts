/**
 * `@jxsuite/schema/json-layout` — the layout-preserving JSON serializer behind every save (issue
 * 308).
 *
 * The oracle is the repository itself: every surface under `packages/studio/src/surfaces/` and
 * every kit component under `packages/ui/components/` is kept in `oxfmt`'s layout by the pre-commit
 * hook, so reading one, parsing it, deriving its layout and serializing it again must give the file
 * back byte for byte. The tab-level cases prove the layout rides along from the file read to the
 * save. The rules an edit exercises — a changed value in an inline object, an object grown past the
 * width, a new key, a removed one — are pinned beside the serializer, in
 * `packages/schema/tests/json-layout.test.ts`.
 */
import { flush, installMockPlatform } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonDocument, serializeJson } from "@jxsuite/schema/json-layout";
import { serializeDocument } from "../src/files/serialize-document";
import { parseCollabSource, saveFile } from "../src/files/file-ops";
import { openFileInTab, reloadFileInTab } from "../src/files/files";
import { activeTab, closeAllTabs, openTab } from "../src/workspace/workspace";
import { setProjectState } from "../src/store";
import { setFormats } from "../src/format/format-host";
import { MARKDOWN_FORMAT, mockFormatAction, seedMarkdownFormat } from "./format-fixture";
import type { StudioPlatform } from "../src/types";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/** Every document the formatter keeps: the oracle for byte identity. */
const FORMATTED_DOCUMENTS = ["packages/studio/src/surfaces", "packages/ui/components"]
  .flatMap((dir) => globSync(`${dir}/*.json`, { cwd: REPO_ROOT }))
  .map((relative) => join(REPO_ROOT, relative))
  .toSorted();

/** Derive, serialize, and hand back the text — the round trip a save performs. */
function roundTrip(text: string, edit?: (doc: Record<string, unknown>) => void): string {
  const { document, layout } = parseJsonDocument(text);
  edit?.(document);
  return serializeJson(document, layout);
}

// ─── The oracle ───────────────────────────────────────────────────────────────

describe("byte identity with the formatted repository", () => {
  test("the corpus is there to be checked", () => {
    expect(FORMATTED_DOCUMENTS.length).toBeGreaterThan(100);
    expect(FORMATTED_DOCUMENTS.some((p) => p.endsWith("/statusbar.json"))).toBe(true);
    expect(FORMATTED_DOCUMENTS.some((p) => p.endsWith("/jx-kbd.json"))).toBe(true);
  });

  test("every surface and every kit component round-trips byte for byte", () => {
    const mismatches: string[] = [];
    for (const path of FORMATTED_DOCUMENTS) {
      const text = readFileSync(path, "utf8");
      if (roundTrip(text) !== text) {
        mismatches.push(path.slice(REPO_ROOT.length + 1));
      }
    }
    expect(mismatches).toEqual([]);
  });

  test("the files that spell non-ASCII as escapes come back spelt that way", () => {
    // `shell.json` writes `§` and `—`; `JSON.stringify` alone would have made them
    // Literal, and touched every line they sit on.
    const path = join(REPO_ROOT, "packages/studio/src/surfaces/shell.json");
    const text = readFileSync(path, "utf8");
    expect(text).toContain(String.raw`\u00a7`);
    expect(roundTrip(text)).toBe(text);
  });
});

// ─── The tab: from the file read to the save ──────────────────────────────────

const SURFACE = readFileSync(
  join(REPO_ROOT, "packages/studio/src/surfaces/statusbar.json"),
  "utf8",
);

function siteState() {
  setProjectState({
    dirs: new Map(),
    expanded: new Set(),
    isSiteProject: true,
    name: "Demo",
    projectConfig: { name: "Demo" },
    projectDirs: [],
    projectRoot: ".",
    searchQuery: "",
    selectedPath: null,
  } as never);
}

function installPlatform(seed: Record<string, string>) {
  return installMockPlatform(
    {
      formatAction: mockFormatAction,
      listFormats: async () => [MARKDOWN_FORMAT],
    } as Partial<StudioPlatform>,
    seed,
  );
}

beforeEach(() => {
  closeAllTabs();
  setProjectState(null);
  seedMarkdownFormat();
});

describe("a JSON tab carries its file's layout", () => {
  test("opening a file records it, and a one-value save is a one-line diff", async () => {
    const { state } = installPlatform({ "surfaces/statusbar.json": SURFACE });
    siteState();
    await openFileInTab("surfaces/statusbar.json");
    const tab = activeTab.value!;
    expect(tab.doc.layout?.inline.get("/attributes")).toBe(true);

    // The measured case from issue 308: one style change turned `{ "part": "bar" }` into three lines.
    (tab.doc.document.style as Record<string, unknown>).flex = "2";
    tab.doc.dirty = true;
    expect(await saveFile(tab)).toBe(true);

    const written = state.files.get("surfaces/statusbar.json")!;
    expect(written).toBe(SURFACE.replace('"flex": "1"', '"flex": "2"'));
    expect(written).toContain('"attributes": { "part": "bar" },');
  });

  test("a tab opened without a file has no layout, and its save is the formatter's fresh layout", async () => {
    installPlatform({});
    const tab = openTab({
      document: { attributes: { part: "x" }, children: ["a", "b"], tagName: "div" },
      id: "fresh",
    });
    expect(tab.doc.layout).toBeNull();
    expect(await serializeDocument(tab)).toBe(
      '{\n  "attributes": {\n    "part": "x"\n  },\n  "children": ["a", "b"],\n  "tagName": "div"\n}\n',
    );
  });

  test("a reload from disk replaces the layout with the new text's", async () => {
    const { state } = installPlatform({
      "pages/a.json": '{ "tagName": "div", "attributes": { "part": "a" } }\n',
    });
    siteState();
    await openFileInTab("pages/a.json");
    const tab = activeTab.value!;
    expect(tab.doc.layout?.inline.get("")).toBe(true);

    state.files.set(
      "pages/a.json",
      '{\n  "tagName": "div",\n  "attributes": {\n    "part": "b"\n  }\n}\n',
    );
    await reloadFileInTab("pages/a.json");

    expect(tab.doc.layout?.inline.get("")).toBe(false);
    expect(tab.doc.layout?.inline.get("/attributes")).toBe(false);
    expect(await serializeDocument(tab)).toBe(state.files.get("pages/a.json")!);
  });

  test("the layout survives an edit that replaces the document object", async () => {
    installPlatform({});
    const { document, layout } = parseJsonDocument(
      '{ "tagName": "div", "attributes": { "part": "a" } }\n',
    );
    const tab = openTab({ document, id: "kept", layout });
    // What transact does: a new root reference with the same shape.
    tab.doc.document = { ...tab.doc.document, tagName: "section" } as typeof tab.doc.document;
    expect(await serializeDocument(tab)).toBe(
      '{ "tagName": "section", "attributes": { "part": "a" } }\n',
    );
  });

  test("a format tab still takes its format's serializer, layout or not", async () => {
    installPlatform({ "post.md": "# Hello\n" });
    siteState();
    await openFileInTab("post.md");
    const tab = activeTab.value!;
    expect(tab.doc.sourceFormat).toBe("Markdown");
    expect(tab.doc.layout).toBeNull();
    const out = await serializeDocument(tab);
    expect(out).toContain("# Hello");
    expect(out.startsWith("{")).toBe(false);
  });

  /*
   * THE COLLAB PARSER. `src/studio.ts` hands `parseCollabSource` to the source reconciler, which
   * feeds it a peer's shared text and puts the document it returns into the structure tree. For a
   * JSON file the text a peer typed is also the layout this client will save in, so the parser
   * writes the record onto the tab as it parses — spec §9.4's "a collaborator's shared text".
   */
  test("the collab parser records a peer's JSON text's layout on the tab", async () => {
    installPlatform({});
    const tab = openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/shared.json",
      id: "pages/shared.json",
    });
    expect(tab.doc.layout).toBeNull();
    const peerText = '{ "tagName": "main", "attributes": { "part": "a" } }\n';
    const parsed = await parseCollabSource(tab, peerText);
    expect(parsed.document).toEqual({ attributes: { part: "a" }, tagName: "main" } as never);
    expect(tab.doc.layout?.inline.get("")).toBe(true);
    expect(tab.doc.layout?.inline.get("/attributes")).toBe(true);
    // The next mirror writes the peer's layout back, not the formatter's fresh one.
    tab.doc.document = parsed.document;
    expect(await serializeDocument(tab)).toBe(peerText);
    // A second parse replaces the record: the file is whatever the text says now.
    await parseCollabSource(tab, '{\n  "tagName": "main"\n}\n');
    expect(tab.doc.layout?.inline.get("")).toBe(false);
  });

  test("the collab parser hands a format file to its format's parser and leaves the layout alone", async () => {
    installPlatform({});
    siteState();
    const tab = openTab({
      document: { children: [] },
      documentPath: "post.md",
      id: "post.md",
      sourceFormat: "Markdown",
    });
    const parsed = await parseCollabSource(tab, "# From a peer\n");
    expect(JSON.stringify(parsed.document)).toContain("From a peer");
    expect(tab.doc.layout).toBeNull();
  });

  test("with no content format registered a content-mode tab falls back to layout JSON", async () => {
    installPlatform({});
    setFormats([]);
    const { document, layout } = parseJsonDocument('{ "children": [], "tagName": "div" }\n');
    const tab = openTab({ document, id: "content-json", layout });
    tab.doc.mode = "content";
    expect(await serializeDocument(tab)).toBe('{ "children": [], "tagName": "div" }\n');
    await flush();
  });
});
