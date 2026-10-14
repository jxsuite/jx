/**
 * Layout resolution — slot distribution and property merging, over an in-memory loader.
 *
 * The compiler's own suite drives the same rules through a real directory; this one drives them
 * through the injected loader, which is the seam the studio and the cloud preview use. A rule that
 * only held when the layout came off a disk would pass there and fail here.
 */
import { describe, expect, test } from "bun:test";
import { resolveLayout } from "../src/layout.ts";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

/** A fixture that breaks the JxDocument contract on purpose, to reach one of resolveLayout's guards. */
function offContract(json: JsonValue): JxDocument {
  /* SAFETY: resolveLayout's input comes off a disk, a SQLite row or `fetch`, so its own guards
     accept JSON that breaks the JxDocument contract (a numeric or string `children`, a null child, a
     bare string where a document belongs). Every caller passes such a shape on purpose to reach one
     of those guards, and the suite only compares what comes back by value, never trusting it to
     have the shape the type claims. */
  return json as JxDocument;
}

/** A loader over a plain map, recording the refs it was asked for. */
function loaderFor(layouts: Record<string, JxDocument>) {
  const asked: string[] = [];
  const load = (ref: string) => {
    asked.push(ref);
    const doc = layouts[ref];
    if (!doc) {
      throw new Error(`Layout not found: ${ref}`);
    }
    return structuredClone(doc);
  };
  return { asked, load };
}

describe("resolveLayout", () => {
  test("a page with no layout is returned as it was", async () => {
    const page: JxDocument = { children: [{ tagName: "p" }], tagName: "div" };
    const { asked, load } = loaderFor({});
    expect(await resolveLayout(page, {}, load)).toBe(page);
    expect(asked).toEqual([]);
  });

  test("the project default supplies the layout when the page names none", async () => {
    const { asked, load } = loaderFor({
      "./layouts/base.json": { children: [{ tagName: "slot" }], tagName: "body" },
    });
    const page: JxDocument = { children: ["hi"] };
    const result = await resolveLayout(page, { defaults: { layout: "./layouts/base.json" } }, load);
    expect(asked).toEqual(["./layouts/base.json"]);
    expect(result.children).toEqual(["hi"]);
  });

  test("the page's own $layout wins over the project default", async () => {
    const { asked, load } = loaderFor({
      "./layouts/base.json": { children: [{ tagName: "slot" }], tagName: "body" },
      "./layouts/post.json": { children: [{ tagName: "slot" }], tagName: "article" },
    });
    const page: JxDocument = { $layout: "./layouts/post.json", children: ["hi"] };
    const result = await resolveLayout(page, { defaults: { layout: "./layouts/base.json" } }, load);
    expect(asked).toEqual(["./layouts/post.json"]);
    expect(result.tagName).toBe("article");
  });

  test("a loader failure is the caller's error, not swallowed", async () => {
    const { load } = loaderFor({});
    const page: JxDocument = { $layout: "./layouts/missing.json" };
    const failure = await resolveLayout(page, {}, load).then(
      () => null,
      (error: Error) => error,
    );
    expect(failure).toEqual(new Error("Layout not found: ./layouts/missing.json"));
  });

  test("named children go to their slot and the rest to the default one", async () => {
    const { load } = loaderFor({
      "./l.json": {
        children: [
          { attributes: { name: "header" }, tagName: "slot" },
          { children: [{ tagName: "slot" }], tagName: "main" },
        ],
        tagName: "body",
      },
    });
    const page: JxDocument = {
      $layout: "./l.json",
      children: [{ attributes: { slot: "header" }, tagName: "h1" }, { tagName: "p" }],
    };
    const result = await resolveLayout(page, {}, load);
    expect(result.children).toEqual([
      { attributes: { slot: "header" }, tagName: "h1" },
      { children: [{ tagName: "p" }], tagName: "main" },
    ]);
  });

  test("an unmatched slot keeps its own fallback children", async () => {
    const { load } = loaderFor({
      "./l.json": {
        children: [
          { attributes: { name: "aside" }, children: [{ tagName: "nav" }], tagName: "slot" },
          { tagName: "slot" },
        ],
        tagName: "body",
      },
    });
    const page: JxDocument = { $layout: "./l.json", children: [{ tagName: "p" }] };
    const result = await resolveLayout(page, {}, load);
    expect(result.children).toEqual([{ tagName: "nav" }, { tagName: "p" }]);
  });

  test("a string children value is distributed as one text child", async () => {
    const { load } = loaderFor({
      "./l.json": { children: [{ tagName: "slot" }], tagName: "body" },
    });
    const page = offContract({ $layout: "./l.json", children: "hello" });
    const result = await resolveLayout(page, {}, load);
    expect(result.children).toEqual(["hello"]);
  });

  test("a nested layout is resolved before the page lands in it", async () => {
    const { asked, load } = loaderFor({
      "./inner.json": {
        $layout: "./outer.json",
        children: [
          { attributes: { slot: "body" }, children: [{ tagName: "slot" }], tagName: "main" },
        ],
        tagName: "div",
      },
      "./outer.json": {
        children: [{ attributes: { name: "body" }, tagName: "slot" }],
        tagName: "body",
      },
    });
    const page: JxDocument = { $layout: "./inner.json", children: [{ tagName: "p" }] };
    const result = await resolveLayout(page, {}, load);
    expect(asked).toEqual(["./inner.json", "./outer.json"]);
    expect(result.tagName).toBe("body");
    expect(result.children).toEqual([
      { attributes: { slot: "body" }, children: [{ tagName: "p" }], tagName: "main" },
    ]);
  });

  test("page state, style, $media and attributes extend the layout's", async () => {
    const { load } = loaderFor({
      "./l.json": {
        attributes: { class: "layout" },
        $media: { wide: "(min-width: 60rem)" },
        children: [{ tagName: "slot" }],
        state: { a: 1, b: 1 },
        style: { color: "red", margin: "0" },
        tagName: "body",
      },
    });
    const page: JxDocument = {
      attributes: { id: "page" },
      $layout: "./l.json",
      $media: { tall: "(min-height: 60rem)" },
      children: [],
      state: { b: 2 },
      style: { color: "blue" },
    };
    const result = await resolveLayout(page, {}, load);
    expect(result.state).toEqual({ a: 1, b: 2 });
    expect(result.style).toEqual({ color: "blue", margin: "0" });
    expect(result.$media).toEqual({ tall: "(min-height: 60rem)", wide: "(min-width: 60rem)" });
    expect(result.attributes).toEqual({ class: "layout", id: "page" });
  });

  test("the page's own head and title survive the merge, and $layout does not", async () => {
    const { load } = loaderFor({
      "./l.json": { children: [{ tagName: "slot" }], tagName: "body" },
    });
    const page: JxDocument = {
      $head: [{ attributes: { content: "x", name: "d" }, tagName: "meta" }],
      $layout: "./l.json",
      children: [],
      title: "Hello",
    };
    const result = await resolveLayout(page, {}, load);
    expect(result._pageTitle).toBe("Hello");
    expect(result._pageHead).toEqual([
      { attributes: { content: "x", name: "d" }, tagName: "meta" },
    ]);
    expect(result.$layout).toBeUndefined();
  });

  test("the layout document the loader returned is not mutated for the next page", async () => {
    const layouts = { "./l.json": { children: [{ tagName: "slot" }], tagName: "body" } };
    const { load } = loaderFor(layouts);
    const first: JxDocument = { $layout: "./l.json", children: ["one"] };
    const second: JxDocument = { $layout: "./l.json", children: ["two"] };
    const firstResult = await resolveLayout(first, {}, load);
    const secondResult = await resolveLayout(second, {}, load);
    expect(firstResult.children).toEqual(["one"]);
    expect(secondResult.children).toEqual(["two"]);
  });

  test("a layout that is not an element tree distributes nothing", async () => {
    const { load } = loaderFor({ "./l.json": { tagName: "body" } });
    const page: JxDocument = { $layout: "./l.json", children: [{ tagName: "p" }] };
    const result = await resolveLayout(page, {}, load);
    expect(result.children).toBeUndefined();
  });

  test("page children that are not an array or string distribute as nothing", async () => {
    const { load } = loaderFor({
      "./l.json": { children: [{ children: ["fallback"], tagName: "slot" }], tagName: "body" },
    });
    const page = offContract({ $layout: "./l.json", children: 42 });
    const result = await resolveLayout(page, {}, load);
    expect(result.children).toEqual(["fallback"]);
  });

  test("text and null children in the layout are walked past, not into", async () => {
    const { load } = loaderFor({
      "./l.json": offContract({
        children: ["lead text", null, { children: [{ tagName: "slot" }], tagName: "main" }],
        tagName: "body",
      }),
    });
    const page: JxDocument = { $layout: "./l.json", children: [{ tagName: "p" }] };
    const result = await resolveLayout(page, {}, load);
    expect(result).toEqual(
      offContract({
        children: ["lead text", null, { children: [{ tagName: "p" }], tagName: "main" }],
        tagName: "body",
      }),
    );
  });

  test("a childless element in the layout is left alone", async () => {
    const { load } = loaderFor({
      "./l.json": { children: [{ tagName: "hr" }, { tagName: "slot" }], tagName: "body" },
    });
    const page: JxDocument = { $layout: "./l.json", children: [{ tagName: "p" }] };
    const result = await resolveLayout(page, {}, load);
    expect(result.children).toEqual([{ tagName: "hr" }, { tagName: "p" }]);
  });

  test("a layout document that is not an object distributes nothing and does not throw", async () => {
    const notADocument = offContract("not a document");
    const { load } = loaderFor({ "./l.json": notADocument });
    const page: JxDocument = { $layout: "./l.json", children: [{ tagName: "p" }] };
    const result = await resolveLayout(page, {}, load);
    expect(result).toBe(notADocument);
  });
});
