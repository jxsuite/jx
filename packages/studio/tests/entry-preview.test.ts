/**
 * The entry-preview bar (`src/content/entry-preview.ts` over `src/surfaces/entry-preview.*`,
 * specs/studio.md §22.4): over a collection's page in Edit, which entry the page is drawn with, by
 * title, and a step through the rest.
 */
import { flush, installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CommandArgValues } from "../src/commands/command-args";
import type { JsonValue, JxPathsDef } from "@jxsuite/schema/types";

/** Every command the bar ran, as `[id, args]`. */
const ran: [string, CommandArgValues | undefined][] = [];
void mock.module("../src/commands/active-registry.js", () => ({
  activeRegistry: () => ({
    run: (id: string, args?: CommandArgValues) => {
      ran.push([id, args]);
      return Promise.resolve();
    },
  }),
}));

const {
  attachEntryPreview,
  detachEntryPreview,
  entryPreviewTarget,
  entryPreviewView,
  invalidateEntryPreview,
  renderEntryPreview,
  resetEntryPreview,
} = await import("../src/content/entry-preview");
const { invalidateParamValues } = await import("../src/page-params");
const { closeAllTabs, openTab } = await import("../src/workspace/workspace");

const POSTS: JsonValue[] = [
  { data: { title: "Designing for Slowness" }, id: "designing" },
  { data: { title: "Notes from a Long Walk" }, id: "notes" },
  { data: {}, id: "untitled" },
];

/** A blog project whose `posts` collection resolves to `entries`. */
function project(entries: JsonValue[] = POSTS, site = true) {
  installMockPlatform({ resolveClass: () => Promise.resolve(entries) });
  resetStudioState({
    isSiteProject: site,
    projectConfig: { content: { posts: { source: "./content/posts/" } } },
  });
  invalidateParamValues();
  invalidateEntryPreview();
}

/** The collection's page's `$paths`: one page for every post, by its slug. */
const POST_PATHS: JxPathsDef = { contentType: "posts", param: "slug" };

/** A page tab: the collection's page by default, and a page with no `$paths` given `null`. */
function pageTab(path = "pages/[slug].json", $paths: JxPathsDef | null = POST_PATHS) {
  return openTab({
    document: $paths ? { $paths, tagName: "article" } : { tagName: "article" },
    documentPath: path,
    id: path,
  });
}

let host: HTMLElement;

beforeEach(() => {
  ran.length = 0;
  closeAllTabs();
  resetEntryPreview();
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  resetEntryPreview();
});

describe("which pages carry the bar", () => {
  test("a page whose $paths enumerates a content type, by the param its route names", () => {
    project();
    expect(entryPreviewTarget(pageTab())).toEqual({
      contentType: "posts",
      param: "slug",
      pathsDef: { contentType: "posts", param: "slug" },
    });
    // The param defaults to `slug`, as the compiler's does.
    expect(
      entryPreviewTarget(pageTab("pages/blog/[slug].json", { contentType: "posts" }))?.param,
    ).toBe("slug");
  });

  test("nothing for any other page, file or project", () => {
    project();
    expect(entryPreviewTarget(null)).toBeNull();
    expect(entryPreviewTarget(pageTab("pages/[slug].json", null))).toBeNull();
    expect(
      entryPreviewTarget(pageTab("pages/[lang].json", { param: "lang", values: ["en"] })),
    ).toBeNull();
    expect(entryPreviewTarget(pageTab("pages/[x].json", [{ x: "a" }]))).toBeNull();
    expect(entryPreviewTarget(pageTab("pages/[slug].json", { contentType: "" }))).toBeNull();
    // A param the route does not name cannot be previewed by it.
    expect(entryPreviewTarget(pageTab("pages/[id].json", { contentType: "posts" }))).toBeNull();
    expect(entryPreviewTarget(pageTab("components/card.json"))).toBeNull();
    project(POSTS, false);
    expect(entryPreviewTarget(pageTab())).toBeNull();
  });
});

describe("what the bar says", () => {
  test("reading, then every entry by title, with the stepper bounded by the ends", async () => {
    project();
    const tab = pageTab();
    expect(entryPreviewView("primary", tab)).toMatchObject({
      note: "Reading entries…",
      region: "pane.primary/entry-preview",
      status: "note",
    });
    await flush(6);
    tab.session.ui.previewParams = { slug: "designing" };
    expect(entryPreviewView("primary", tab)).toEqual({
      nextDisabled: false,
      note: "",
      options: [
        { label: "Designing for Slowness", value: "designing" },
        { label: "Notes from a Long Walk", value: "notes" },
        { label: "untitled", value: "untitled" },
      ],
      prevDisabled: true,
      region: "pane.primary/entry-preview",
      status: "ready",
      value: "designing",
    });
    tab.session.ui.previewParams = { slug: "untitled" };
    expect(entryPreviewView("primary", tab)).toMatchObject({
      nextDisabled: true,
      prevDisabled: false,
    });
    // A value the list does not hold steps nowhere.
    tab.session.ui.previewParams = {};
    expect(entryPreviewView("primary", tab)).toMatchObject({
      nextDisabled: true,
      prevDisabled: true,
      value: "",
    });
  });

  test("an empty collection says so, by its item's name", async () => {
    project([]);
    const tab = pageTab();
    entryPreviewView("primary", tab);
    await flush(6);
    expect(entryPreviewView("primary", tab)).toMatchObject({
      note: "No post to preview yet",
      status: "note",
    });
  });

  test("a page that is not a collection's says there is nothing to preview", () => {
    project();
    expect(entryPreviewView("primary", pageTab("pages/[slug].json", null))).toMatchObject({
      note: "No entry to preview yet",
      status: "note",
    });
  });
});

describe("the mounted bar", () => {
  test("draws the entries, and choosing or stepping writes the route parameter", async () => {
    project();
    const tab = pageTab();
    tab.session.ui.previewParams = { slug: "notes" };
    attachEntryPreview("primary", host);
    renderEntryPreview("primary", tab);
    await flush(12);
    const root = host.querySelector<HTMLElement>('[part="entry-preview"]')!;
    expect(root.dataset.jxRegion).toBe("pane.primary/entry-preview");
    expect(root.textContent).toContain("Previewing entry");
    const select = host.querySelector<HTMLElement & { value: string }>('[part="entry"]')!;
    expect(select.value).toBe("notes");

    host.querySelector<HTMLElement>('[part="next"]')!.click();
    host.querySelector<HTMLElement>('[part="previous"]')!.click();
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(2);
    expect(ran).toEqual([
      ["canvas.setRouteParam", { name: "slug", pane: "primary", value: "untitled" }],
      ["canvas.setRouteParam", { name: "slug", pane: "primary", value: "designing" }],
      ["canvas.setRouteParam", { name: "slug", pane: "primary", value: "notes" }],
    ]);
  });

  test("a step past either end, and a gesture with no page under it, writes nothing", async () => {
    project();
    const tab = pageTab();
    tab.session.ui.previewParams = { slug: "designing" };
    attachEntryPreview("primary", host);
    renderEntryPreview("primary", tab);
    await flush(12);
    host.querySelector<HTMLElement>('[part="previous"]')!.click();
    closeAllTabs();
    host.querySelector<HTMLElement>('[part="next"]')!.click();
    host.querySelector('[part="entry"]')!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(2);
    expect(ran).toEqual([]);
  });

  test("a second announcement of the same host changes nothing; a new one replaces it", async () => {
    project();
    attachEntryPreview("primary", host);
    attachEntryPreview("primary", host);
    await flush(6);
    expect(host.querySelectorAll('[part="entry-preview"]')).toHaveLength(1);
    const other = document.createElement("div");
    document.body.append(other);
    attachEntryPreview("primary", other);
    await flush(6);
    expect(host.querySelector('[part="entry-preview"]')).toBeNull();
    expect(other.querySelector('[part="entry-preview"]')).not.toBeNull();
    detachEntryPreview("primary");
    await flush(2);
    expect(other.querySelector('[part="entry-preview"]')).toBeNull();
  });

  test("a pane with no host is left alone, and a disposal before the mount settles holds", async () => {
    project();
    renderEntryPreview("primary", pageTab());
    expect(host.childElementCount).toBe(0);
    attachEntryPreview("primary", host);
    detachEntryPreview("primary");
    await flush(6);
    expect(host.querySelector('[part="entry-preview"]')).toBeNull();
  });
});
