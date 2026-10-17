/**
 * `file.new`, the record — `src/create/add-new-commands.ts`.
 *
 * The flow is doubled with `mock.module`: `run` imports it lazily, so without a double there is
 * nothing to assert against once `run` returns, and two real imports in flight would be the shape
 * that loses a coverage record (AGENTS.md, Testing & Coverage Policy).
 */
import { resetStudioState } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AddNewRequest, AddNewResult } from "../src/create/add-new-flow";

const created: AddNewRequest[] = [];
const openedWith: AddNewRequest[] = [];
let createResult: AddNewResult = {
  kind: "page",
  path: "pages/a.json",
  route: "/a",
  wrote: ["pages/a.json"],
};

void mock.module("../src/create/add-new-flow", () => ({
  createDirect: (request: AddNewRequest) => {
    created.push(request);
    return Promise.resolve(createResult);
  },
  // Never settles: the dialog belongs to the person, and `run` must not wait for it.
  openAddNew: (request: AddNewRequest) => {
    openedWith.push(request);
    return new Promise(() => {});
  },
}));

const {
  addNewCommands,
  describe: describeResult,
  registerAddNewCommands,
  FILE_NEW,
} = await import("../src/create/add-new-commands");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext, makeContext } = await import("../src/commands/context");

function registry() {
  const live = createCommandRegistry({
    getContext: () => makeContext({ project: { open: true } }),
  });
  registerAddNewCommands(live);
  return live;
}

function report() {
  const record = addNewCommands()[0]!;
  /* SAFETY: `AnyCommand` erases the argument type to `never` for storage; this report reads no
     argument at all, so nothing is passed for one to be. */
  return record.aiTool!.report({
    after: emptyContext(),
    args: undefined as never,
    before: emptyContext(),
  });
}

beforeEach(() => {
  created.length = 0;
  openedWith.length = 0;
  createResult = { kind: "page", path: "pages/a.json", route: "/a", wrote: ["pages/a.json"] };
  resetStudioState({
    projectConfig: { content: { posts: { source: "./content/posts" } } },
  });
});

describe("the record", () => {
  test("one record, on ⌘N and the browser-safe ⌘⌥N, in the palette and the overflow", () => {
    const [record] = addNewCommands();
    expect(record!.id).toBe(FILE_NEW);
    expect(record!.keybinding).toEqual(["mod+n", "mod+alt+n"]);
    expect(record!.menus).toEqual(["commandbar/overflow", "palette"]);
    expect(record!.level).toBe("project");
    // A chord runs with `{}`, so a keybound record requires nothing.
    expect(record!.args?.required).toEqual([]);
    expect(record!.args?.properties?.kind?.enum).toEqual([
      "page",
      "collection",
      "template",
      "component",
      "media",
      "entry",
    ]);
    expect(record!.aiTool?.name).toBe("add_new");
  });

  test("the collection enum is read when asked, not when the record was built", () => {
    const [record] = addNewCommands();
    const property = record!.args?.properties?.collection;
    expect(property?.enum).toEqual(["posts"]);
    resetStudioState({ projectConfig: { content: {} } });
    expect(property?.enum).toEqual([]);
  });

  test("hidden with no project open", () => {
    const [record] = addNewCommands();
    expect(record!.when?.(emptyContext())).toBe(false);
    expect(record!.when?.(makeContext({ project: { open: true } }))).toBe(true);
  });
});

describe("running it", () => {
  test("with a name it creates, and the report names what was made", async () => {
    await registry().run(FILE_NEW, {
      collection: "posts",
      kind: "entry",
      name: "Hello",
      template: "base",
    });
    expect(created).toEqual([
      { collection: "posts", kind: "entry", name: "Hello", template: "base" },
    ]);
    expect(openedWith).toEqual([]);
    expect(report()).toEqual({
      summary: "Created the page pages/a.json, which opens at /a, and opened it in Design.",
      wrote: ["pages/a.json"],
    });
  });

  test("without a name it opens the dialog and returns at once, without waiting on it", async () => {
    await registry().run(FILE_NEW, { kind: "template" });
    expect(openedWith).toEqual([{ kind: "template" }]);
    expect(created).toEqual([]);
    expect(report()).toMatchObject({
      summary: expect.stringContaining("Opened Add new on template for the person"),
    });
    await registry().run(FILE_NEW, {});
    expect(report()).toEqual({
      summary:
        "Opened Add new on page for the person; nothing is created until they confirm. Pass a " +
        "name to create without the dialog.",
      wrote: [],
    });
  });

  test("an undeclared kind is refused before run, naming what is declared", () => {
    expect(() => registry().run(FILE_NEW, { kind: "widget" })).toThrow(
      /argument "kind": "widget" is not declared — declared: page, collection/,
    );
  });
});

describe("describe", () => {
  test("one sentence per kind", () => {
    expect(describeResult({ kind: "page", path: "pages/a.json", wrote: [] })).toBe(
      "Created the page pages/a.json, and opened it in Design.",
    );
    expect(
      describeResult({ kind: "component", path: "components/x-a.json", tag: "x-a", wrote: [] }),
    ).toBe(
      "Created <x-a> in components/x-a.json; it is listed under Components in the Site panel and open in Design.",
    );
    expect(describeResult({ kind: "template", path: "layouts/l.json", wrote: [] })).toBe(
      "Created the template layouts/l.json and opened it in Design.",
    );
    expect(describeResult({ kind: "entry", path: "content/p/a.md", wrote: [] })).toBe(
      "Created the entry content/p/a.md and opened it.",
    );
    expect(
      describeResult({ kind: "collection", path: "content/recipes", wrote: ["project.json", "x"] }),
    ).toBe("Created the recipes collection, writing project.json, x.");
    expect(describeResult({ kind: "media", path: "public/media", wrote: ["a"] })).toBe(
      "Uploaded 1 file to public/media/.",
    );
    expect(describeResult({ kind: "media", path: "public/media", wrote: ["a", "b"] })).toBe(
      "Uploaded 2 files to public/media/.",
    );
  });
});
