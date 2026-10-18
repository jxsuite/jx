/**
 * What a component's live preview is drawn with (src/browse/component-examples.ts): its declared
 * examples, its first literal use in the project, else the first row of a list that draws it.
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { UsageState } from "../src/services/references";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

/* SAFETY: `./harness`, imported first, registers happy-dom's GlobalRegistrator, which copies the
   window's members onto globalThis, `happyDOM` (the DetachedWindowAPI that owns setURL) among them. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (u: string) => void };
};
// An origin for the project's document base, as Studio's window has.
happyDOM.setURL("http://localhost:3000/packages/studio/index.html");

/** The files the reference index answers with, swapped per test. */
let usage: UsageState = { status: "unsupported" };

const references = await import("../src/services/references");
void mock.module("../src/services/references", () => ({
  ...references,
  loadUsages: () => Promise.resolve(usage),
}));

const {
  componentExampleProps,
  componentSampleRow,
  declaredExamples,
  isLiteralProp,
  literalUsageProps,
} = await import("../src/browse/component-examples");
const { invalidateRepeaterSources } = await import("../src/canvas/repeater-sources");
const { setFormats } = await import("../src/format/format-host");

const CARD: JxDocument = {
  state: {
    "#cache": { default: "", examples: ["private"] },
    date: { default: "", examples: ["2026-06-20"], type: "string" },
    hue: 214,
    title: "",
  },
  tagName: "mu-card",
};

/** The files a usage answer lists, in the reference index's shape. */
function usedIn(...paths: string[]): UsageState {
  return {
    result: {
      errors: [],
      files: paths.map((path) => ({ count: 1, path, refs: [] })),
      filesReferencing: paths.length,
      path: null,
      refsTotal: paths.length,
      tagName: "mu-card",
    },
    status: "ready",
  };
}

beforeEach(() => {
  usage = { status: "unsupported" };
  invalidateRepeaterSources();
  resetStudioState({
    projectConfig: {
      i18n: { defaultLocale: "en", locales: ["en", "ar"], routing: "prefix-except-default" },
      name: "Atrium",
    },
  });
});

describe("isLiteralProp", () => {
  test("plain data is literal; a template, a binding or a source is not", () => {
    expect(isLiteralProp("Harbour")).toBe(true);
    expect(isLiteralProp(3)).toBe(true);
    expect(isLiteralProp(["a", { b: 1 }])).toBe(true);
    expect(isLiteralProp("${item.title}")).toBe(false);
    expect(isLiteralProp({ $ref: "#/state/x" })).toBe(false);
    expect(isLiteralProp([{ $expression: { operator: "!", target: true } }])).toBe(false);
    expect(isLiteralProp({ $prototype: "Request" })).toBe(false);
    expect(isLiteralProp(CARD.state?.missing)).toBe(false);
  });
});

describe("declaredExamples", () => {
  test("the first example of each public typed entry", () => {
    expect([...declaredExamples(CARD)]).toEqual([["date", "2026-06-20"]]);
  });
});

describe("literalUsageProps", () => {
  test("the instance passing the most literal props, among the declared ones", () => {
    const tree: JxDocument = {
      children: [
        { $props: { title: "One" }, tagName: "mu-card" },
        {
          $switch: "a",
          cases: { a: { $props: { hue: 10, other: "x", title: "Two" }, tagName: "mu-card" } },
          tagName: "div",
        },
        { $props: { date: "${item.date}", hue: 1, title: "${item.t}" }, tagName: "mu-card" },
      ],
      tagName: "main",
    };
    expect([...literalUsageProps(tree, "mu-card", new Set(["hue", "title"]))]).toEqual([
      ["hue", 10],
      ["title", "Two"],
    ]);
    expect(literalUsageProps(tree, "mu-other", new Set(["title"])).size).toBe(0);
  });
});

describe("componentExampleProps", () => {
  test("a page's literal props, with the definition's own examples winning", async () => {
    installMockPlatform(
      {},
      {
        "pages/ar/index.json": JSON.stringify({
          children: [{ $props: { hue: 1, title: "عربي" }, tagName: "mu-card" }],
          tagName: "main",
        }),
        "pages/index.json": JSON.stringify({
          children: [{ $props: { date: "1999-01-01", title: "Harbour" }, tagName: "mu-card" }],
          tagName: "main",
        }),
        "pages/notes.txt": "not a document",
      },
    );
    // The translation is listed first; the default language is read first.
    usage = usedIn("pages/ar/index.json", "pages/notes.txt", "pages/gone.json", "pages/index.json");
    const props = await componentExampleProps(CARD, "components/mu-card.json");
    expect(Object.fromEntries(props)).toEqual({ date: "2026-06-20", title: "Harbour" });
  });

  test("a page written in a format is read through its parser", async () => {
    setFormats([
      {
        capabilities: {
          parse: { identifier: "parse", timing: ["server"] },
          serialize: { identifier: "serialize", timing: ["server"] },
        },
        documentKinds: ["content", "page"],
        exportTarget: false,
        extensions: [".md"],
        mediaType: "text/markdown",
        name: "Markdown",
        remote: false,
        studio: {},
      },
    ]);
    installMockPlatform(
      {
        formatAction: () =>
          Promise.resolve({
            children: [{ $props: { title: "From Markdown" }, tagName: "mu-card" }],
            tagName: "article",
          }),
      },
      { "pages/about.md": ":::mu-card\n:::" },
    );
    usage = usedIn("pages/about.md");
    const props = await componentExampleProps(CARD, "components/mu-card.json");
    expect(props.get("title")).toBe("From Markdown");
    setFormats([]);
  });

  test("without a reference index, the declared examples alone", async () => {
    expect(Object.fromEntries(await componentExampleProps(CARD, "x.json"))).toEqual({
      date: "2026-06-20",
    });
    const bare = await componentExampleProps({ tagName: "x-bare" }, "x.json");
    expect(bare.size).toBe(0);
  });
});

describe("componentSampleRow", () => {
  const LIST_PAGE = {
    children: [
      {
        $prototype: "Array",
        items: { $ref: "#/state/shows" },
        map: { $props: { title: "${item.data.title}" }, tagName: "mu-card" },
      },
    ],
    state: {
      shows: { $prototype: "ContentCollection", $src: "@x/C.class.json", contentType: "shows" },
    },
    tagName: "main",
  };

  test("the first row of a list that draws the component, with the list's data", async () => {
    installMockPlatform(
      {
        resolveClass: (): Promise<JsonValue> =>
          Promise.resolve([{ data: { title: "Harbour" } }, { data: { title: "Crane" } }]),
      },
      { "pages/exhibitions/index.json": JSON.stringify(LIST_PAGE) },
    );
    usage = usedIn("pages/exhibitions/index.json");
    const sample = await componentSampleRow(CARD, "components/mu-card.json");
    expect(sample?.file).toBe("pages/exhibitions/index.json");
    expect(sample?.doc.state?.shows).toEqual([{ data: { title: "Harbour" } }]);
    expect(sample?.doc.state?.$page).toMatchObject({ locale: "en", url: "/exhibitions" });
  });

  test("no list, an empty list, or no tag: no sample", async () => {
    installMockPlatform(
      { resolveClass: (): Promise<JsonValue> => Promise.resolve([]) },
      {
        "content/x.json": JSON.stringify(LIST_PAGE),
        "pages/flat.json": JSON.stringify({ children: [{ tagName: "mu-card" }], tagName: "main" }),
        // A list whose rows come from somewhere other than the page's own state has no data here.
        "pages/window.json": JSON.stringify({
          children: [
            { $prototype: "Array", items: { $ref: "window#/rows" }, map: { tagName: "mu-card" } },
          ],
          tagName: "main",
        }),
      },
    );
    usage = usedIn("pages/flat.json", "pages/window.json", "content/x.json");
    expect(await componentSampleRow(CARD, "components/mu-card.json")).toBeNull();
    expect(await componentSampleRow({ tagName: "" }, "components/x.json")).toBeNull();
  });
});
