/**
 * The Site panel (`src/panels/site-panel.ts` over `src/surfaces/site-panel.{json,ts}`,
 * specs/studio.md §5.7): the project by route, its templates, components and media, one filter over
 * all four, the `+`, the Open Media link, and the drags a card and a thumbnail start.
 *
 * Everything is addressed by `part` and `data-*`, because the panel is a document. The two lazily
 * imported implementations a click reaches — `files.ts`'s opener and the Library's New menu — are
 * DOUBLED, per AGENTS.md: a double is the witness an un-awaited import needs, and it keeps two real
 * imports of one module from ever overlapping. The preview cache is doubled too, so a card's island
 * is filled by something this suite controls rather than by a live component render.
 */
import { flush, installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReferencesResult, StudioPlatform } from "../src/types";
import { SITE_CARD } from "./shared-fixtures";
import type { ComponentEntry } from "../src/files/components";
import type { NavigatorPanelDeps } from "../src/panels/panel-registry";
import type { BlockDragData } from "../src/panels/site-panel";
import type { CommandArgValues } from "../src/commands/command-args";

const openFileInTab = mock(async (_path: string) => {});
void mock.module("../src/files/files", () => ({ openFileInTab }));

const previewFor = mock(async (path: string) => {
  const element = document.createElement("span");
  element.dataset.preview = path;
  return element;
});
void mock.module("../src/browse/library-preview", () => ({
  createPreviewCache: () => ({ clear: () => {} }),
  createPreviewObserver: (onVisible: (element: Element) => void) => ({
    destroy: () => {},
    observe: (element: Element) => onVisible(element),
    releaseDetached: () => 0,
  }),
  previewFor,
}));

/** Every drag source the panel registers, with what it was registered with. */
interface DraggableArgs {
  element: HTMLElement;
  getInitialData: () => BlockDragData | Record<string, never>;
  onGenerateDragPreview: (args: { nativeSetDragImage: (() => void) | null }) => void;
}
const sources: DraggableArgs[] = [];
const released = mock(() => {});
void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: (args: DraggableArgs) => {
    sources.push(args);
    args.element.setAttribute("draggable", "true");
    return released;
  },
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

const { registerRenderer, setProjectState } = await import("../src/store");
const { getPanel, resetPanels } = await import("../src/panels/panel-registry");
const { loadComponentRegistry } = await import("../src/files/components");
const { refreshFormats } = await import("../src/format/format-host");
const { invalidateMediaCache } = await import("../src/ui/media-picker");
const { closeAllTabs } = await import("../src/workspace/workspace");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const {
  componentDragData,
  mayDefineComponent,
  invalidateSiteIndex,
  mediaDragData,
  mediaMoreLabel,
  SITE_MEDIA_LIMIT,
  registerSitePanel,
  resetSitePanel,
  sitePanelValues,
} = await import("../src/panels/site-panel");

const FILES = {
  "content/posts/first.json": "{}",
  "content/posts/second.json": "{}",
  "layouts/base.json": '{"tagName":"div"}',
  "layouts/notes.md": "# not a layout",
  "pages/about.json": '{"tagName":"main"}',
  "pages/blog/[slug].json": '{"tagName":"article","$paths":{"contentType":"posts"}}',
  "pages/index.json": '{"tagName":"main"}',
  "public/brochure.pdf": "%PDF",
  "public/hero.png": "png",
} satisfies Record<string, string>;

const CARD = SITE_CARD;
const PACKAGE: ComponentEntry = {
  package: "@acme/widgets",
  props: [],
  source: "npm",
  tagName: "acme-button",
};

let host: HTMLElement;

/* SAFETY: the Site panel's afterRender reads neither `deps` nor `doc` (`registerSitePanel` mounts
   against the host alone), so an empty object stands in for the Navigator's deps. */
const NO_DEPS = {} as NavigatorPanelDeps;

/** Install a project whose `content` declares one JSON collection, over the fixture files. */
async function project(
  overrides: Partial<StudioPlatform> = {},
  extraFiles: Record<string, string> = {},
): Promise<void> {
  /* SAFETY: the registry keeps this answer as `ComponentEntry[]`; the package entry mirrors the
     server's npm discovery, which sends `package` with no `path`, a shape `ComponentMeta` cannot
     express but the registry reads (the same cast `tests/elements-panel.test.ts` makes). */
  const discoverComponents = (async () => [CARD, PACKAGE]) as StudioPlatform["discoverComponents"];
  installMockPlatform({ discoverComponents, ...overrides }, { ...FILES, ...extraFiles });
  setProjectState({
    dirs: new Map(),
    expanded: new Set(),
    isSiteProject: true,
    name: "Blog",
    projectConfig: {
      content: { posts: { format: "json", source: "./content/posts" } },
      name: "Blog",
    },
    projectDirs: ["pages", "layouts", "public"],
    projectRoot: ".",
    searchQuery: "",
    selectedPath: null,
  });
  await loadComponentRegistry();
}

/** A page format that claims `.md` and can parse nothing, as a registry entry states it. */
const MARKDOWN_PAGES = {
  capabilities: {},
  documentKinds: ["page"],
  exportTarget: false,
  extensions: [".md"],
  mediaType: "text/markdown",
  name: "Markdown",
  remote: false,
  studio: null,
};

/** Paint the panel the way the Navigator does, and repaint whenever the flow asks it to. */
async function paint(): Promise<void> {
  const record = getPanel("site")!;
  const draw = () => {
    record.afterRender!({ deps: NO_DEPS, doc: null, rerender: draw }, host);
  };
  registerRenderer("leftPanel", draw);
  draw();
  await flush(10);
}

const part = (name: string): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>(`[part="${name}"]`),
];
const texts = (name: string): string[] => part(name).map((el) => el.textContent.trim());
const section = (key: string): HTMLElement =>
  host.querySelector<HTMLElement>(`[part="section"][data-section="${key}"]`)!;
const rowLabels = (key: string): string[] =>
  [...section(key).querySelectorAll('[part="row-label"]')].map((el) => el.textContent.trim());

async function typeFilter(value: string): Promise<void> {
  const field = host.querySelector<HTMLElement & { value: string }>('[part="filter"]')!;
  const input = field.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush(6);
}

beforeEach(async () => {
  resetStudioState();
  resetSitePanel();
  resetPanels();
  registerSitePanel();
  invalidateMediaCache();
  openFileInTab.mockClear();
  sources.length = 0;
  released.mockClear();
  previewFor.mockClear();
  document.body.innerHTML = '<div id="host"><div class="panel-content"></div></div>';
  host = document.querySelector<HTMLElement>(".panel-content")!;
  await project();
});

afterEach(() => {
  resetSitePanel();
  setActiveRegistry(null);
  closeAllTabs();
});

describe("the record", () => {
  test("is the project-level Site panel, on the rail, drawing a kit glyph", () => {
    const record = getPanel("site");
    expect(record).toMatchObject({ dock: "navigator", icon: "browser", level: "project" });
    expect(record?.rail).toBeUndefined();
  });
});

describe("Pages — by route, home first, a collection's page nested under it", () => {
  test("rows follow the router, and the dynamic page sits under its collection", async () => {
    await paint();
    expect(rowLabels("pages")).toEqual(["Home", "About", "Posts", "Post page"]);
    expect(
      [...section("pages").querySelectorAll('[part="row-detail"]')].map((el) => el.textContent),
    ).toEqual(["/", "/about", "2 entries", "/blog/:slug"]);
    expect(section("pages").querySelector('[part="collection-row"]')).not.toBeNull();
    expect(section("pages").querySelector<HTMLElement>('[data-nested="true"]')?.dataset.path).toBe(
      "pages/blog/[slug].json",
    );
    // Three pages, counted without the heading.
    expect(section("pages").querySelector('[part="section-count"]')?.textContent).toBe("3");
  });

  test("a row opens its page, and the focused page's row is selected", async () => {
    resetWorkspaceWithTab(undefined, { documentPath: "pages/about.json" });
    await paint();
    const about = host.querySelector<HTMLElement>(
      '[part="page-row"][data-path="pages/about.json"]',
    )!;
    expect(about.dataset.selected).toBe("true");
    // The selection is announced, not only drawn: the open document's row is the current one.
    expect(about.getAttribute("aria-current")).toBe("true");
    expect(
      host
        .querySelector('[part="page-row"][data-path="pages/index.json"]')
        ?.hasAttribute("aria-current"),
    ).toBe(false);
    about.click();
    await flush(4);
    expect(openFileInTab).toHaveBeenCalledWith("pages/about.json");
  });

  test("an unreadable listing reads as an empty project rather than a broken panel", async () => {
    await project({
      listDirectory: async () => {
        throw new Error("the disk said no");
      },
    });
    await paint();
    expect(section("pages").querySelector('[part="note"]')?.textContent).toBe(
      "No pages yet. Add one with +.",
    );
  });
});

describe("Templates", () => {
  test("lists the JSON layouts with no usage count", async () => {
    await paint();
    expect(rowLabels("templates")).toEqual(["Base"]);
    expect(section("templates").querySelector('[part="row-detail"]')?.textContent).toBe("");
  });

  test("never asks the reference index, even when the host can answer", async () => {
    const findReferences = mock(async (): Promise<ReferencesResult> => ({
      errors: [],
      files: [],
      filesReferencing: 0,
      path: null,
      refsTotal: 0,
      tagName: null,
    }));
    await project({ findReferences });
    await paint();
    await flush(10);
    expect(section("templates").querySelector('[part="row-detail"]')?.textContent).toBe("");
    // Nothing on this panel sweeps the project: not the templates, not the component previews.
    expect(findReferences).not.toHaveBeenCalled();
    host.querySelector<HTMLElement>('[part="template-row"]')!.click();
    await flush(4);
    expect(openFileInTab).toHaveBeenCalledWith("layouts/base.json");
  });
});

describe("Components", () => {
  test("the project's components are cards with live previews, then package ones by tag", async () => {
    await paint();
    expect(texts("card-label")).toEqual(["Site card", "Acme button"]);
    // Only the project component has a definition to render, so only it is previewed.
    expect(previewFor).toHaveBeenCalledTimes(1);
    const previews = part("card-preview");
    // The render is in the island's own shadow root, so its ids never join the chrome's.
    expect(previews[0]?.shadowRoot?.querySelector("[data-preview]")).not.toBeNull();
    expect(previews[0]?.querySelector("[data-preview]")).toBeNull();
    expect(previews[0]?.hasAttribute("inert")).toBe(true);
    expect(previews[1]?.shadowRoot ?? null).toBeNull();
    const cards = part("component-card");
    expect(cards[0]?.title).toBe("Open <site-card>, or drag it onto the canvas");
    expect(cards[1]?.title).toBe(
      "<acme-button> from @acme/widgets: open Packages, or drag it onto the canvas",
    );
  });

  test("a package card drags an instance, and its click opens the Packages panel", async () => {
    const run = mock((_args: CommandArgValues | undefined) => {});
    const registry = createCommandRegistry({ getContext: emptyContext, mac: true });
    registry.register({
      category: "View",
      id: "view.setActivity",
      level: "application",
      run: (_ctx, args: CommandArgValues | undefined) => {
        run(args);
      },
      title: "Show Panel",
    });
    setActiveRegistry(registry);
    await paint();
    const card = part("component-card")[1]!;
    expect(card.getAttribute("draggable")).toBe("true");
    expect(componentDragData("acme-button")).toEqual({
      fragment: { $props: {}, tagName: "acme-button" },
      type: "block",
    });
    card.click();
    await flush(2);
    expect(run).toHaveBeenCalledWith({ tab: "packages" });
    expect(openFileInTab).not.toHaveBeenCalled();
  });

  test("the filter matches a package card by its package", async () => {
    await paint();
    await typeFilter("acme/widgets");
    expect(texts("card-label")).toEqual(["Acme button"]);
  });

  test("a card opens its definition, and drags an instance of the component", async () => {
    await paint();
    const card = host.querySelector<HTMLElement>('[part="component-card"]')!;
    // The drag source is registered on the node the document announced.
    expect(card.getAttribute("draggable")).toBe("true");
    card.click();
    await flush(4);
    expect(openFileInTab).toHaveBeenCalledWith("components/site-card.json");
    expect(componentDragData("site-card")).toEqual({
      fragment: { $props: { heading: "Hi" }, tagName: "site-card" },
      type: "block",
    });
    expect(componentDragData("gone-away")).toBeNull();
  });
});

describe("Media", () => {
  test("thumbnails of the project's media, an image as an image and a file by its name", async () => {
    await paint();
    const thumbs = part("media-thumb");
    expect(thumbs.map((el) => el.dataset.path)).toEqual(["public/brochure.pdf", "public/hero.png"]);
    expect(thumbs[1]?.querySelector('[part="thumb-image"]')).not.toBeNull();
    expect(thumbs[0]?.querySelector('[part="thumb-name"]')?.textContent).toBe("brochure.pdf");
    expect(thumbs[1]?.getAttribute("draggable")).toBe("true");
  });

  test("a thumbnail drags the element that references the file", async () => {
    await paint();
    expect(mediaDragData("public/hero.png")).toEqual({
      fragment: { attributes: { src: "/hero.png" }, tagName: "img" },
      type: "block",
    });
    expect(mediaDragData("public/brochure.pdf")?.fragment.tagName).toBe("a");
    expect(mediaDragData("public/missing.png")).toBeNull();
  });

  test("a strip of the first few, and the rest one click away in Media", async () => {
    // Two fixture files: every one is shown and there is no "more" line.
    await paint();
    expect(sitePanelValues().mediaMore).toBe("");
    expect(section("media").querySelector('[part="media-more"]')?.hasAttribute("hidden")).toBe(
      true,
    );
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        `public/media/p${String(i).padStart(2, "0")}.png`,
        "png",
      ]),
    );
    await project({}, many);
    invalidateMediaCache();
    await paint();
    expect(part("media-thumb")).toHaveLength(SITE_MEDIA_LIMIT);
    expect(section("media").querySelector('[part="section-count"]')?.textContent).toBe("32");
    const more = section("media").querySelector<HTMLElement>('[part="media-more"]')!;
    expect(more.hasAttribute("hidden")).toBe(false);
    expect(more.textContent.trim()).toBe("Show all 32 in Media");
    // A filter narrows what "all" is.
    await typeFilter("p1");
    expect(sitePanelValues().mediaMore).toBe("Show all 10 in Media");
    expect(mediaMoreLabel(3, 3)).toBe("");
  });

  test("Open Media switches to the Media workspace", async () => {
    const run = mock((_args: CommandArgValues | undefined) => {});
    const registry = createCommandRegistry({ getContext: emptyContext, mac: true });
    registry.register({
      category: "View",
      id: "view.setWorkspace",
      level: "application",
      run: (_ctx, args: CommandArgValues | undefined) => {
        run(args);
      },
      title: "Switch Workspace",
    });
    setActiveRegistry(registry);
    await paint();
    host.querySelector<HTMLElement>('[part="open-media"]')!.click();
    await flush(2);
    expect(run).toHaveBeenCalledWith({ workspace: "media" });
  });
});

describe("the header", () => {
  test("the filter narrows every section, and an emptied section keeps its heading", async () => {
    await paint();
    await typeFilter("about");
    expect(rowLabels("pages")).toEqual(["About"]);
    expect(section("pages").querySelector('[part="section-count"]')?.textContent).toBe("1 of 3");
    for (const key of ["templates", "components", "media"]) {
      expect(section(key).querySelector('[part="section-title"]')).not.toBeNull();
      expect(section(key).querySelector('[part="note"]')?.textContent).toBe(
        "Nothing here matches the filter.",
      );
    }
    await typeFilter("hero");
    expect(part("media-thumb").map((el) => el.dataset.path)).toEqual(["public/hero.png"]);
    expect(sitePanelValues().filter).toBe("hero");
  });

  test("+ opens Add new through file.new, the same door as the palette and the chord", async () => {
    const run = mock((_args: CommandArgValues | undefined) => {});
    const registry = createCommandRegistry({ getContext: emptyContext, mac: true });
    registry.register({
      category: "File",
      id: "file.new",
      level: "project",
      run: (_ctx, args: CommandArgValues | undefined) => {
        run(args);
      },
      title: "Add New…",
    });
    setActiveRegistry(registry);
    await paint();
    const add = host.querySelector<HTMLElement>('[part="add"]')!;
    // A dialog opener says so.
    expect(add.querySelector("button")?.getAttribute("aria-haspopup")).toBe("dialog");
    add.querySelector<HTMLElement>("button")!.click();
    await flush(4);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("the drag sources", () => {
  test("a card's and a thumbnail's drag carry the block payload, with no native preview", async () => {
    await paint();
    const card = sources.find((source) => source.element.matches('[part="component-card"]'))!;
    expect(card.getInitialData()).toEqual({
      fragment: { $props: { heading: "Hi" }, tagName: "site-card" },
      type: "block",
    });
    const hero = sources.find((source) => source.element.dataset.path === "public/hero.png")!;
    expect(hero.getInitialData()).toMatchObject({ type: "block" });
    // The canvas draws its own ghost, so the browser's preview is suppressed.
    expect(() => card.onGenerateDragPreview({ nativeSetDragImage: null })).not.toThrow();
  });

  test("a tag that leaves the registry drags nothing rather than a stale instance", async () => {
    await paint();
    const card = sources.find((source) => source.element.matches('[part="component-card"]'))!;
    await project({ discoverComponents: async () => [] });
    expect(card.getInitialData()).toEqual({});
  });

  test("a remount into another box releases every source the first one registered", async () => {
    await paint();
    const count = sources.length;
    expect(count).toBeGreaterThan(0);
    const other = document.createElement("div");
    document.body.append(other);
    getPanel("site")!.afterRender!({ deps: NO_DEPS, doc: null, rerender: () => {} }, other);
    expect(released).toHaveBeenCalledTimes(count);
  });

  test("a source whose node the document dropped is released on the next paint", async () => {
    await paint();
    await typeFilter("zzz");
    // Every node the filter took away was a drag source, and each was released exactly once.
    const dropped = sources.filter((source) => !source.element.isConnected).length;
    expect(dropped).toBeGreaterThan(0);
    expect(released.mock.calls.length).toBe(dropped);
  });
});

describe("reading each dynamic page's collection", () => {
  test("a page with no $paths, broken JSON, or a format with no parser nests under nothing", async () => {
    // Markdown is a page format here, so its page is routed, but the format has no parser.
    refreshFormats();
    await project(
      { listFormats: () => Promise.resolve([MARKDOWN_PAGES]) },
      {
        "pages/broken/[id].json": "{not json",
        "pages/news/[slug].md": "---\n$paths:\n  contentType: posts\n---\n",
        "pages/plain/[id].json": '{"tagName":"main"}',
      },
    );
    await paint();
    const kinds = new Map(
      [...section("pages").querySelectorAll<HTMLElement>('[part="page-item"]')].map((el) => [
        el.querySelector<HTMLElement>("[data-path]")?.dataset.path ?? "",
        el.dataset.kind,
      ]),
    );
    expect(kinds.get("pages/plain/[id].json")).toBe("page");
    expect(kinds.get("pages/broken/[id].json")).toBe("page");
    expect(kinds.get("pages/news/[slug].md")).toBe("page");
    expect(kinds.get("pages/blog/[slug].json")).toBe("entry-page");
  });

  test("only the files the build routes are pages: a backup and an unclaimed extension are not", async () => {
    refreshFormats();
    await project(
      { listFormats: () => Promise.resolve([]) },
      {
        "pages/index.json.bak": '{"tagName":"main"}',
        "pages/notes.md": "# Not a page in a project with no Markdown format",
      },
    );
    await paint();
    const paths = [...section("pages").querySelectorAll<HTMLElement>("[data-path]")].map(
      (el) => el.dataset.path,
    );
    expect(paths).toContain("pages/index.json");
    expect(paths).not.toContain("pages/index.json.bak");
    expect(paths).not.toContain("pages/notes.md");
  });
});

describe("staying current", () => {
  test("an invalidation mid-read discards the read that was in flight", async () => {
    const record = getPanel("site")!;
    registerRenderer("leftPanel", () => {
      record.afterRender!({ deps: NO_DEPS, doc: null, rerender: () => {} }, host);
    });
    record.afterRender!({ deps: NO_DEPS, doc: null, rerender: () => {} }, host);
    await getPlatform().writeFile("pages/late.json", '{"tagName":"main"}');
    invalidateSiteIndex();
    await flush(10);
    expect(rowLabels("pages")).toContain("Late");
  });

  test("a re-read keeps the rows it had on screen until it lands", async () => {
    await paint();
    const before = section("pages").querySelector('[part="page-row"]');
    invalidateSiteIndex(["pages/about.json"]);
    // Synchronously after the invalidation: still listed, no "Reading the project…".
    expect(sitePanelValues().pagesState).toBe("listed");
    expect(sitePanelValues().templatesState).toBe("listed");
    expect(rowLabels("pages")).toEqual(["Home", "About", "Posts", "Post page"]);
    await flush(10);
    expect(rowLabels("pages")).toEqual(["Home", "About", "Posts", "Post page"]);
    // The keyed rows survived the re-read rather than being torn down and rebuilt.
    expect(section("pages").querySelector('[part="page-row"]') === before).toBe(true);
  });

  test("a component definition can be anywhere but a page, layout, entry or media tree", () => {
    expect(mayDefineComponent("components/card.json")).toBe(true);
    expect(mayDefineComponent("components/card.css")).toBe(true);
    expect(mayDefineComponent("widgets/hero.json")).toBe(true);
    expect(mayDefineComponent("pages/about.json")).toBe(false);
    expect(mayDefineComponent("layouts/base.json")).toBe(false);
    expect(mayDefineComponent("content/posts/first.json")).toBe(false);
    expect(mayDefineComponent("public/data.json")).toBe(false);
    expect(mayDefineComponent("project.json")).toBe(false);
    expect(mayDefineComponent("notes/readme.md")).toBe(false);
  });

  test("only a batch that could hold a component definition re-scans the registry", async () => {
    let scans = 0;
    await project({
      /* SAFETY: the same cast `project()` makes: the registry keeps this answer as
         `ComponentEntry[]`, and the fixture card is one. */
      discoverComponents: (async () => {
        scans += 1;
        return [CARD];
      }) as StudioPlatform["discoverComponents"],
    });
    await paint();
    const settled = scans;
    invalidateSiteIndex(["pages/about.json", "content/posts/first.json", "public/hero.png"]);
    await flush(10);
    expect(scans).toBe(settled);
    invalidateSiteIndex(["components/new-card.json"]);
    await flush(10);
    expect(scans).toBe(settled + 1);
    // An invalidation that cannot say what changed (a gap in the stream) re-scans too.
    invalidateSiteIndex();
    await flush(10);
    expect(scans).toBe(settled + 2);
  });

  test("an invalidation re-reads the project, so a new page appears", async () => {
    await paint();
    expect(rowLabels("pages")).not.toContain("Contact");
    await getPlatform().writeFile("pages/contact.json", '{"tagName":"main"}');
    invalidateSiteIndex();
    await flush(10);
    expect(rowLabels("pages")).toContain("Contact");
  });

  test("with no project the panel asks for one and reads nothing on its behalf", async () => {
    setProjectState(null);
    resetSitePanel();
    expect(sitePanelValues().body).toBe("none");
    await paint();
    expect(host.querySelector('[part="no-project"]')?.textContent).toBe(
      "Open a project to see its pages, templates, components and media.",
    );
    expect(host.querySelector('[part="section"]')).toBeNull();
  });
});

const { getPlatform } = await import("../src/platform");
