/**
 * Class-backed state resolved before a canvas render (canvas/repeater-sources.ts): the collections
 * a repeater reads in Edit and Design, and the extension classes a bare `$prototype` names.
 */
import { installMockPlatform } from "./harness";
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  bakeRepeaterSources,
  extensionClassKeys,
  invalidateRepeaterSources,
  repeaterSourceKeys,
} from "../src/canvas/repeater-sources";
import type { JsonObject, JsonValue, JxMutableNode } from "@jxsuite/schema/types";

const SHOWS = {
  $prototype: "ContentCollection",
  $src: "@x/ContentCollection.class.json",
  contentType: "shows",
};

const PAGE: JxMutableNode = {
  children: [
    { $prototype: "Array", items: { $ref: "#/state/shows" }, map: { tagName: "li" } },
    {
      cases: {
        a: { $prototype: "Array", items: { $ref: "#/state/live" }, map: { tagName: "li" } },
      },
      $switch: "a",
      tagName: "div",
    },
    { $prototype: "Array", items: { $ref: "#/state/literal" }, map: { tagName: "li" } },
    { $prototype: "Array", items: { $ref: "$map/item/x" }, map: { tagName: "li" } },
  ],
  state: {
    literal: [1, 2],
    live: {
      $prototype: "ContentCollection",
      $src: "@x/C.class.json",
      filter: [{ field: "lang", value: "${state.q}" }],
    },
    nav: { $prototype: "ContentEntry", id: "nav" },
    shows: SHOWS,
  },
  tagName: "main",
};

/** The bodies the backend was asked to resolve, newest last. */
let asked: JsonObject[] = [];

beforeEach(() => {
  invalidateRepeaterSources();
  asked = [];
  installMockPlatform({
    resolveClass: (body: JsonObject): Promise<JsonValue> => {
      asked.push(body);
      return body.contentType === "broken"
        ? Promise.reject(new Error("no such collection"))
        : Promise.resolve([{ id: "first" }]);
    },
  });
});

describe("repeaterSourceKeys", () => {
  test("names the static class entries a repeater reads, anywhere in the tree", () => {
    // `live` holds a template (re-resolved by the runtime), `literal` is data, `$map/…` is a row.
    expect(repeaterSourceKeys(PAGE)).toEqual(["shows"]);
  });
});

describe("extensionClassKeys", () => {
  test("names a bare $prototype an enabled extension declares", () => {
    expect(extensionClassKeys(PAGE, { ContentEntry: "/ext/ContentEntry.class.json" })).toEqual([
      "nav",
    ]);
    expect(extensionClassKeys(PAGE, {})).toEqual([]);
  });
});

describe("bakeRepeaterSources", () => {
  test("replaces each entry with what the backend resolved, as a rebuild", async () => {
    const baked = await bakeRepeaterSources(PAGE, ["shows"], "http://x/pages/a.json");
    expect(baked.state?.shows).toEqual([{ id: "first" }]);
    expect(PAGE.state?.shows).toBe(SHOWS);
    expect(asked.at(-1)).toMatchObject({ $base: "http://x/pages/a.json", contentType: "shows" });
  });

  test("fills a bare extension class's $src from the registry", async () => {
    const classes = { ContentEntry: "/ext/ContentEntry.class.json" };
    const baked = await bakeRepeaterSources(PAGE, ["nav"], undefined, classes);
    expect(baked.state?.nav).toEqual([{ id: "first" }]);
    expect(asked.at(-1)).toMatchObject({ $src: "/ext/ContentEntry.class.json", id: "nav" });
  });

  test("asks once per configuration until the content changes", async () => {
    await bakeRepeaterSources(PAGE, ["shows"]);
    await bakeRepeaterSources(PAGE, ["shows"]);
    expect(asked).toHaveLength(1);
    invalidateRepeaterSources();
    await bakeRepeaterSources(PAGE, ["shows"]);
    expect(asked).toHaveLength(2);
  });

  test("an entry the backend cannot resolve is left as written, and asked again next time", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => null);
    const doc: JxMutableNode = {
      state: { shows: { ...SHOWS, contentType: "broken" } },
      tagName: "main",
    };
    const baked = await bakeRepeaterSources(doc, ["shows"]);
    expect(baked.state?.shows).toEqual(doc.state?.shows);
    await bakeRepeaterSources(doc, ["shows"]);
    expect(asked).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("nothing to resolve, or no way to, hands the document back", async () => {
    expect(await bakeRepeaterSources(PAGE, [])).toBe(PAGE);
    expect(await bakeRepeaterSources({ tagName: "p" }, ["shows"])).toEqual({ tagName: "p" });
    // A key whose entry is not a static class entry is skipped.
    const skipped = await bakeRepeaterSources(PAGE, ["literal"]);
    expect(skipped.state?.literal).toEqual([1, 2]);
    installMockPlatform({});
    expect(await bakeRepeaterSources(PAGE, ["shows"])).toBe(PAGE);
  });
});
