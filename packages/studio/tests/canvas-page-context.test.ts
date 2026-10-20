/**
 * The `$site` and `$page` the canvas draws a page or an entry with (canvas/canvas-page-context.ts).
 *
 * Without them every `${$page.locale}` on the canvas was undefined: a component handed it as its
 * locale threw and was not rendered, and Preview of a multilingual page drew no list.
 */
import "./with-dom.js";
import { describe, expect, mock, test } from "bun:test";
import type { CollectionPage } from "../src/content/collection-pages";
import type { ProjectConfig } from "@jxsuite/schema/types";

/** The template page the entry tests' collection publishes at, swapped per test. */
let page: CollectionPage | null = null;

void mock.module("../src/content/collection-match", () => ({
  collectionForFile: (path: string) =>
    path.startsWith("content/") ? { name: "exhibitions" } : null,
}));
void mock.module("../src/content/collection-pages", () => ({
  collectionPage: () => Promise.resolve(page),
  entryLocale: (path: string) => (path.includes("/ar/") ? "ar" : "en"),
  entryUrl: (target: CollectionPage | null, path: string) =>
    target ? target.pattern.replace(":slug", path.split("/").pop()!.replace(".md", "")) : null,
}));

const { pageContextFor, routeParams } = await import("../src/canvas/canvas-page-context");

const CONFIG: ProjectConfig = {
  i18n: { defaultLocale: "en", locales: ["en", "fr-CA", "ar"], routing: "prefix-except-default" },
  name: "Atrium",
};

/** A context's `$page`, as the object the injection writes. */
async function pageOf(...args: Parameters<typeof pageContextFor>) {
  const context = await pageContextFor(...args);
  return context?.$page;
}

describe("routeParams", () => {
  test("reads each parameter from its position in the URL", () => {
    expect(routeParams("/ar/exhibitions/:slug", "/ar/exhibitions/clay")).toEqual({ slug: "clay" });
    expect(routeParams("/a/:x/:y", "/a/1")).toEqual({ x: "1" });
  });
});

describe("pageContextFor", () => {
  test("a page gets its route's URL, language and direction, and the site's name", async () => {
    const context = await pageContextFor(
      { documentPath: "pages/ar/about.json", isEntry: false, title: "About" },
      CONFIG,
    );
    expect(context?.$page).toMatchObject({
      dir: "rtl",
      locale: "ar",
      title: "About",
      url: "/ar/about",
    });
    expect(context?.$site).toMatchObject({ defaultLocale: "en", name: "Atrium" });
  });

  test("a document's own $lang wins, and preview params fill the route", async () => {
    expect(
      await pageOf(
        { documentPath: "pages/[slug].json", isEntry: false, lang: "fr-CA", params: { slug: "x" } },
        CONFIG,
      ),
    ).toMatchObject({ locale: "fr-CA", params: { slug: "x" }, url: "/:slug" });
  });

  test("an entry is drawn at its collection page's URL in its own language", async () => {
    page = {
      field: null,
      layout: undefined,
      locale: "ar",
      param: "slug",
      path: "pages/ar/exhibitions/[slug].json",
      pattern: "/ar/exhibitions/:slug",
    };
    expect(
      await pageOf(
        {
          documentPath: "content/exhibitions/ar/clay.md",
          fields: { title: "Clay" },
          isEntry: true,
        },
        CONFIG,
      ),
    ).toMatchObject({
      locale: "ar",
      params: { slug: "clay" },
      title: "Clay",
      url: "/ar/exhibitions/clay",
    });
  });

  test("an entry whose collection has no page is drawn at the site root", async () => {
    page = null;
    expect(
      await pageOf({ documentPath: "content/exhibitions/en/clay.md", isEntry: true }, CONFIG),
    ).toMatchObject({ url: "/" });
  });

  test("no configuration, no context", async () => {
    expect(await pageContextFor({ documentPath: "pages/index.json", isEntry: false }, null)).toBe(
      null,
    );
  });
});
