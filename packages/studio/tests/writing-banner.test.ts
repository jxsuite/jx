/**
 * The writing-mode banner (`src/content/writing-banner.ts` over `src/surfaces/writing-banner.*`,
 * specs/studio.md §22.5): one line over the canvas while an entry is written inside its template's
 * layout, with the door to that template in Design.
 */
import { flush, installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { DirEntry } from "../src/types";

const opened: string[] = [];
void mock.module("../src/files/files.js", () => ({
  openFileInTab: (path: string) => {
    opened.push(path);
    return Promise.resolve();
  },
}));

const {
  WRITING_MODE_TEXT,
  attachWritingBanner,
  bannerTarget,
  detachWritingBanner,
  renderWritingBanner,
  resetWritingBanners,
  writingBannerView,
} = await import("../src/content/writing-banner");
const { collectionPages, invalidateCollectionPages } =
  await import("../src/content/collection-pages");
const { closeAllTabs, openTab } = await import("../src/workspace/workspace");

const BLOG = { posts: { format: "markdown", source: "./content/posts/" } };

function project(withPage: boolean, defaults?: { layout: string }) {
  const listing = (path: string): DirEntry[] =>
    withPage && path === "pages"
      ? [{ name: "[slug].json", path: "pages/[slug].json", type: "file" }]
      : [];
  installMockPlatform(
    { listDirectory: (path: string) => Promise.resolve(listing(path)) },
    {
      "pages/[slug].json": JSON.stringify({
        $paths: { contentType: "posts", param: "slug" },
        tagName: "article",
      }),
    },
  );
  resetStudioState({
    isSiteProject: true,
    projectConfig: defaults ? { content: BLOG, defaults } : { content: BLOG },
  });
  invalidateCollectionPages();
}

function entryTab(path = "content/posts/hello.md") {
  return openTab({ document: { tagName: "div" }, documentPath: path, id: path });
}

let host: HTMLElement;

beforeEach(() => {
  opened.length = 0;
  closeAllTabs();
  resetWritingBanners();
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  resetWritingBanners();
});

describe("what the banner opens", () => {
  test("the collection's template page when the project has one", async () => {
    project(true);
    await collectionPages();
    expect(bannerTarget(entryTab())).toEqual({
      actionLabel: "Design the post page",
      path: "pages/[slug].json",
    });
  });

  test("else the layout the entry is drawn in", async () => {
    project(false, { layout: "./layouts/base.json" });
    await collectionPages();
    expect(bannerTarget(entryTab())).toEqual({
      actionLabel: "Edit the Base template in Design",
      path: "layouts/base.json",
    });
  });

  test("nothing, when there is neither, and for a file in no collection", async () => {
    project(false);
    await collectionPages();
    expect(bannerTarget(entryTab())).toBeNull();
    expect(bannerTarget(entryTab("pages/about.md"))).toBeNull();
  });

  test("the view always says the arrangement, and draws the door only when there is one", async () => {
    project(false);
    await collectionPages();
    expect(writingBannerView("primary", entryTab())).toEqual({
      actionLabel: "",
      actionState: "hidden",
      region: "pane.primary/writing-banner",
      text: WRITING_MODE_TEXT,
    });
  });
});

describe("the mounted banner", () => {
  test("draws the sentence, and its button opens the template", async () => {
    project(true);
    await collectionPages();
    attachWritingBanner("primary", host);
    renderWritingBanner("primary", entryTab());
    await flush(6);
    const root = host.querySelector<HTMLElement>('[part="banner"]')!;
    expect(root.dataset.jxRegion).toBe("pane.primary/writing-banner");
    expect(root.textContent).toContain(WRITING_MODE_TEXT);
    const button = host.querySelector<HTMLElement>('[part="edit-template"]')!;
    expect(button.textContent).toContain("Design the post page");
    button.click();
    await flush(4);
    expect(opened).toEqual(["pages/[slug].json"]);
  });

  test("repaints when the collection pages it asked for land", async () => {
    project(true);
    attachWritingBanner("primary", host);
    // Drawn before the index is read: the draw asks for it, and nothing else does.
    renderWritingBanner("primary", entryTab());
    await flush(10);
    expect(host.querySelector('[part="edit-template"]')?.textContent).toContain(
      "Design the post page",
    );
  });

  test("a second announcement of the same host changes nothing; a new one replaces it", async () => {
    project(false);
    attachWritingBanner("primary", host);
    await flush(4);
    const first = host.firstElementChild;
    attachWritingBanner("primary", host);
    expect(host.firstElementChild).toBe(first);
    const other = document.createElement("div");
    document.body.append(other);
    attachWritingBanner("primary", other);
    await flush(4);
    expect(other.querySelector('[part="banner"]')).not.toBeNull();
  });

  test("a pane with no host is left alone, and detaching is idempotent", async () => {
    project(false);
    renderWritingBanner("secondary", entryTab());
    detachWritingBanner("primary");
    detachWritingBanner("primary");
    await flush(2);
    expect(host.childElementCount).toBe(0);
  });

  test("a button pressed after its tab closed opens nothing", async () => {
    project(true);
    await collectionPages();
    attachWritingBanner("primary", host);
    renderWritingBanner("primary", entryTab());
    await flush(6);
    closeAllTabs();
    host.querySelector<HTMLElement>('[part="edit-template"]')!.click();
    await flush(4);
    expect(opened).toEqual([]);
  });
});
