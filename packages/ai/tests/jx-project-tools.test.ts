/**
 * Tests for the portable file tools (specs/ai.md §3.14): `list_files`, `read_file`, `write_file`
 * and `search_files` over a `ProjectHost`, the containment check they share, and the in-memory host
 * a test runs them against.
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, test } from "bun:test";
import {
  invalidPathResult,
  normalizeProjectPath,
  projectToolEntries,
} from "../src/jx-tools/index.ts";
import type { ProjectHost, WriteVerdict } from "../src/jx-tools/index.ts";
import { createMemoryHarnessHost } from "../src/testing/index.ts";
import { createLedger, createToolContext, createToolRegistry } from "../src/tools.ts";
import type { ToolArguments, ToolRegistry } from "../src/tools.ts";

const FILES = {
  ".env": "SECRET=1",
  "components/hero.json": '{"tagName":"my-hero"}',
  "node_modules/pkg/index.js": "module.exports = 1",
  "pages/about.json": '{"tagName":"main"}',
  "pages/blog/hero-post.md": "# Post",
  "project.json": "{}",
};

/** The four tools over an in-memory project, and the ledger their calls record into. */
function harness(over: Partial<ProjectHost> = {}, files: Record<string, string> = FILES) {
  const host = createMemoryHarnessHost({ tagName: "div" }, files);
  const registry: ToolRegistry = createToolRegistry();
  for (const entry of projectToolEntries({ ...host.project, ...over })) {
    registry.register(entry);
  }
  const ledger = createLedger();
  const call = (name: string, args: ToolArguments) =>
    registry.execute(name, args, createToolContext({ callId: "c1", ledger }));
  return { call, files: host.files, ledger, registry };
}

describe("normalizeProjectPath", () => {
  test.each<[string, string]>([
    ["pages/about.json", "pages/about.json"],
    ["  ./pages/about.json ", "pages/about.json"],
    ["././a.json", "a.json"],
    [String.raw`pages\about.json`, "pages/about.json"],
  ])("%p is the project-relative path %p", (given, normalized) => {
    expect(normalizeProjectPath(given)).toBe(normalized);
  });

  test.each<[string, ToolArguments[string]]>([
    ["an absolute path", "/etc/passwd"],
    ["a home directory", "~/notes.md"],
    ["a drive letter", String.raw`C:\Users\a.json`],
    ["a parent segment", "pages/../../secret"],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["a number", 7],
    ["nothing", undefined],
  ])("%s escapes the project, or is no path at all", (_label, given) => {
    expect(normalizeProjectPath(given)).toBeNull();
  });

  test("the refusal quotes what was sent", () => {
    expect(invalidPathResult("../x")).toEqual({
      error:
        'Invalid path "../x" — use a path relative to the project root (no leading "/", no "..").',
      success: false,
    });
  });
});

describe("projectToolEntries", () => {
  test("is the four file tools, in the order the model is offered them", () => {
    const { registry } = harness();
    expect(registry.list().map((tool) => tool.name)).toEqual([
      "list_files",
      "read_file",
      "write_file",
      "search_files",
    ]);
    // Reading is marked read-only, and a write as the destructive disk write it is.
    expect(registry.getDefinition("read_file")!.annotations!.readOnlyHint).toBe(true);
    expect(registry.getDefinition("write_file")!.annotations!.destructiveHint).toBe(true);
  });
});

describe("list_files", () => {
  test("lists the project recursively, without build folders or dotfiles", async () => {
    const { call } = harness();
    const result = await call("list_files", {});
    expect(result).toEqual({
      data: {
        entries: [
          { path: "components", type: "directory" },
          { path: "pages", type: "directory" },
          { path: "project.json", size: 2, type: "file" },
          { path: "components/hero.json", size: 21, type: "file" },
          { path: "pages/about.json", size: 18, type: "file" },
          { path: "pages/blog", type: "directory" },
          { path: "pages/blog/hero-post.md", size: 6, type: "file" },
        ],
        truncated: false,
      },
      success: true,
      summary: 'Listed 7 entries under ".".',
    });
  });

  test("lists one directory, and one that cannot be listed as empty", async () => {
    const { call } = harness();
    const pages = await call("list_files", { dir: "./pages" });
    expect(pages.summary).toBe('Listed 3 entries under "pages".');
    expect(await call("list_files", { dir: "missing" })).toMatchObject({
      data: { entries: [], truncated: false },
      success: true,
    });
    expect(await call("list_files", { dir: "" })).toMatchObject({ success: true });
  });

  test("refuses a directory outside the project", async () => {
    const { call } = harness();
    expect(await call("list_files", { dir: "../elsewhere" })).toEqual(
      invalidPathResult("../elsewhere"),
    );
  });

  test("stops at its cap and says so", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 205 }, (_, index) => [`f${String(index)}.md`, "x"]),
    );
    const { call } = harness({}, many);
    const result = await call("list_files", {});
    expect(result.summary).toBe('Listed 200 entries under "." (truncated at 200).');
    expect(result.data).toMatchObject({ truncated: true });
  });

  test("names an entry a host listed with only a path, or only a name", async () => {
    const { call } = harness({
      list: (dir) =>
        Promise.resolve(
          dir === "."
            ? [
                { name: "", path: "docs/readme.md", type: "file" },
                { name: "lone.md", path: "", type: "file" },
                { name: "sub", path: "", type: "directory" },
                { name: "", path: "", type: "file" },
              ]
            : [{ name: "deep.md", path: "", type: "file" }],
        ),
    });
    const result = await call("list_files", {});
    expect(result.data).toMatchObject({
      entries: [
        { path: "docs/readme.md", type: "file" },
        { path: "lone.md", type: "file" },
        { path: "sub", type: "directory" },
        { path: "", type: "file" },
        { path: "sub/deep.md", type: "file" },
      ],
    });
  });
});

describe("read_file", () => {
  test("reads a file by its project-relative path", async () => {
    const { call } = harness();
    expect(await call("read_file", { path: "./pages/about.json" })).toEqual({
      data: { content: '{"tagName":"main"}', truncated: false },
      success: true,
    });
  });

  test("truncates a large file and says how large it was", async () => {
    const { call } = harness({}, { "big.txt": "x".repeat(48 * 1024 + 10) });
    const result = await call("read_file", { path: "big.txt" });
    expect(result.data).toMatchObject({ truncated: true });
    // SAFETY: the tool's own answer for a file it truncated.
    const { content } = result.data as { content: string };
    expect(content.endsWith("… [truncated: file is 49162 bytes, showing first 49152]")).toBe(true);
  });

  test("says why a file could not be read, whatever the host rejected with", async () => {
    const { call } = harness();
    expect(await call("read_file", { path: "pages/missing.json" })).toEqual({
      error: 'Failed to read "pages/missing.json": No such file.',
      success: false,
    });
    // A host that throws something that is not an Error is still quoted, as the text it is.
    const odd = harness({
      read() {
        // oxlint-disable-next-line no-throw-literal -- a host's own code may throw anything
        throw "locked";
      },
    });
    expect(await odd.call("read_file", { path: "a.json" })).toEqual({
      error: 'Failed to read "a.json": locked',
      success: false,
    });
  });

  test("refuses a path outside the project", async () => {
    const { call } = harness();
    expect(await call("read_file", { path: "/etc/passwd" })).toEqual(
      invalidPathResult("/etc/passwd"),
    );
  });
});

describe("write_file", () => {
  test("writes the file and records a disk write", async () => {
    const { call, files, ledger } = harness();
    expect(await call("write_file", { content: "# New", path: "docs/new.md" })).toEqual({
      success: true,
      summary: 'Wrote "docs/new.md" (saved to disk; not undoable with Cmd+Z).',
    });
    expect(files.get("docs/new.md")).toBe("# New");
    expect(ledger.writes).toEqual([
      { disk: true, ok: true, path: "docs/new.md", tool: "write_file" },
    ]);
  });

  test("asks the host first: a refusal writes nothing and records nothing", async () => {
    const asked: string[][] = [];
    const { call, files, ledger } = harness({
      beforeWrite(path, text) {
        asked.push([path, text]);
        return Promise.resolve({ error: "Document has schema errors.", ok: false });
      },
    });
    expect(await call("write_file", { content: "{}", path: "pages/x.json" })).toEqual({
      error: "Document has schema errors.",
      success: false,
    });
    expect(asked).toEqual([["pages/x.json", "{}"]]);
    expect(files.has("pages/x.json")).toBe(false);
    expect(ledger.writes).toEqual([]);
  });

  test("tells the model what the host reconciled and what it advises", async () => {
    const steps: string[] = [];
    const verdict: WriteVerdict = {
      afterWrite() {
        steps.push("reconciled");
        return " and refreshed its open editor tab";
      },
      hints: "Use the project's colour tokens.",
      ok: true,
    };
    const { call, files } = harness({
      beforeWrite: () => Promise.resolve(verdict),
      async write(path, text) {
        steps.push("written");
        files.set(path, text);
      },
    });
    expect(await call("write_file", { content: "{}", path: "pages/x.json" })).toEqual({
      success: true,
      summary:
        'Wrote "pages/x.json" and refreshed its open editor tab (saved to disk; not undoable with Cmd+Z).\n\nUse the project\'s colour tokens.',
    });
    // The host reconciles only once the bytes are on disk.
    expect(steps).toEqual(["written", "reconciled"]);
  });

  test("a host with nothing to reconcile adds nothing to the summary", async () => {
    const { call } = harness({
      beforeWrite: () => Promise.resolve({ afterWrite: () => "", ok: true }),
    });
    const result = await call("write_file", { content: "x", path: "a.md" });
    expect(result.summary).toBe('Wrote "a.md" (saved to disk; not undoable with Cmd+Z).');
  });

  test("a write the host could not make is a failed write on the ledger", async () => {
    const { call, ledger } = harness({ write: () => Promise.reject(new Error("Disk is full.")) });
    expect(await call("write_file", { content: "x", path: "a.md" })).toEqual({
      error: 'Failed to write "a.md": Disk is full.',
      success: false,
    });
    expect(ledger.writes).toEqual([
      { disk: true, error: "Disk is full.", ok: false, path: "a.md", tool: "write_file" },
    ]);
  });

  test("refuses a path outside the project, and content past its cap, before asking the host", async () => {
    let asked = 0;
    const { call } = harness({
      beforeWrite() {
        asked += 1;
        return Promise.resolve({ ok: true });
      },
    });
    expect(await call("write_file", { content: "x", path: "~/a.md" })).toEqual(
      invalidPathResult("~/a.md"),
    );
    const big = "x".repeat(256 * 1024 + 1);
    expect(await call("write_file", { content: big, path: "a.md" })).toEqual({
      error:
        "Content is 262145 bytes — the write cap is 262144. Split the content across smaller files.",
      success: false,
    });
    expect(asked).toBe(0);
  });
});

describe("search_files", () => {
  test("finds files by name, optionally by extension", async () => {
    const { call } = harness();
    expect(await call("search_files", { query: "hero" })).toEqual({
      data: { paths: ["components/hero.json", "pages/blog/hero-post.md"], truncated: false },
      success: true,
      summary: 'Found 2 file(s) matching "hero".',
    });
    expect(await call("search_files", { extensions: [".md"], query: "hero" })).toMatchObject({
      data: { paths: ["pages/blog/hero-post.md"] },
    });
  });

  test("caps its answer and says it was cut", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`hero-${String(index)}.md`, "x"]),
    );
    const { call } = harness({}, many);
    const result = await call("search_files", { query: "hero" });
    expect(result.data).toMatchObject({ truncated: true });
    expect(result.summary).toBe('Found 100 file(s) matching "hero".');
  });

  test("says why a search failed", async () => {
    const { call } = harness({ search: () => Promise.reject(new Error("Index offline.")) });
    expect(await call("search_files", { query: "x" })).toEqual({
      error: "Search failed: Index offline.",
      success: false,
    });
  });
});
