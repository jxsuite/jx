/**
 * Add new end to end — `src/create/add-new-flow.ts` driving `src/surfaces/add-new.json` over the
 * in-memory platform (`specs/studio.md` §9.1.1).
 *
 * Everything is addressed by `part` and by the native controls inside the kit elements, because the
 * dialog is a document. The box, the backdrop, Escape and the two buttons belong to `jx-dialog`; a
 * confirm is the `confirm` event the element dispatches, which is what its primary button sends.
 */
import {
  flush,
  installMockPlatform,
  resetStudioState,
  resetWorkspaceWithTab,
  topDialog,
} from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { isJsonObject } from "@jxsuite/schema/guards";
import { mockFormatAction, seedMarkdownFormat } from "./format-fixture";
import type { InstalledMockPlatform } from "./harness";
import type { StudioPlatform } from "../src/types";
import type { CommandArgValues } from "../src/commands/command-args";
import type { JsonObject } from "@jxsuite/schema/types";

void mock.module("monaco-editor/editor", () => ({
  MarkerSeverity: { Error: 8, Warning: 4 },
  Uri: { parse: (url: string) => ({ toString: () => url }) },
  editor: { setModelMarkers: mock(() => {}) },
  languages: { registerCompletionItemProvider: mock(() => {}) },
}));

const flow = await import("../src/create/add-new-flow");
const { initLayers } = await import("../src/ui/layers");
/* The module namespaces, not destructured bindings: the registry and the project state are
   `export let`s their modules reassign, and a destructured name keeps the value it was read at. */
const components = await import("../src/files/components");
const store = await import("../src/store");
const { workspace, activeTab } = await import("../src/workspace/workspace");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { problems, resetNotifications, toasts } = await import("../src/services/notify");
const { setFormats } = await import("../src/format/format-host");

// ─── Environment ──────────────────────────────────────────────────────────────

globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(0), 0);
  return 0;
};

let platform: InstalledMockPlatform;
const workspaceRuns: (CommandArgValues | undefined)[] = [];
const mediaRuns: (CommandArgValues | undefined)[] = [];

const BASE_LAYOUT = JSON.stringify({
  children: [{ children: [{ tagName: "slot" }], tagName: "main" }],
  tagName: "div",
});

/** Components the mock platform's scan discovers. */
let discovered: { path: string; tagName: string }[] = [];

async function withComponents(list: { path: string; tagName: string }[]) {
  discovered = list;
  await components.loadComponentRegistry();
}

function setup(
  files: Record<string, string> = {},
  config: JsonObject = {},
  overrides: Partial<StudioPlatform> = {},
) {
  document.body.innerHTML = "";
  for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
    const layer = document.createElement("div");
    layer.id = id;
    document.body.append(layer);
  }
  initLayers();
  resetNotifications();
  setFormats([]);
  resetStudioState({
    projectConfig: { defaults: { layout: "./layouts/base.json" }, name: "Demo", ...config },
    projectRoot: "/project",
  });
  discovered = [];
  platform = installMockPlatform(
    { discoverComponents: () => Promise.resolve(discovered), ...overrides },
    {
      "layouts/base.json": BASE_LAYOUT,
      "layouts/post.json": BASE_LAYOUT,
      "project.json": JSON.stringify({ name: "Demo" }),
      ...files,
    },
  );
  components.componentRegistry.length = 0;
  workspaceRuns.length = 0;
  mediaRuns.length = 0;
  const registry = createCommandRegistry({ getContext: emptyContext, mac: true });
  registry.register({
    category: "View",
    id: "view.setWorkspace",
    level: "application",
    run: (_ctx, args: CommandArgValues | undefined) => {
      workspaceRuns.push(args);
    },
    title: "Workspace",
  });
  /* A new collection opens the Content workspace ON it: the Content home's own verb, which opens
     the home and, through it, the workspace. */
  registry.register({
    category: "Project",
    id: "content.showCollection",
    level: "project",
    run: (_ctx, args: CommandArgValues | undefined) => {
      workspaceRuns.push(args);
    },
    title: "Show Collection",
  });
  registry.register({
    category: "Project",
    id: "media.browse",
    level: "project",
    run: (_ctx, args: CommandArgValues | undefined) => {
      mediaRuns.push(args);
    },
    title: "Browse Media",
  });
  registry.register({
    category: "File",
    id: "file.new",
    keybinding: ["mod+n", "mod+alt+n"],
    level: "project",
    run: () => {},
    title: "Add New…",
  });
  setActiveRegistry(registry);
  resetWorkspaceWithTab();
}

beforeEach(() => {
  setup();
});

afterEach(() => {
  topDialog()?.dispatchEvent(new Event("cancel"));
  setActiveRegistry(null);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dialog(): HTMLElement {
  const found = topDialog();
  if (!found) {
    throw new Error("Add new is not open");
  }
  return found;
}

function part<T extends HTMLElement = HTMLElement>(name: string): T | null {
  return topDialog()?.querySelector<T>(`[part="${name}"]`) ?? null;
}

function parts(name: string): HTMLElement[] {
  return [...(topDialog()?.querySelectorAll<HTMLElement>(`[part="${name}"]`) ?? [])];
}

/** Let the flow, the mount and the kit's own upgrades run out. */
async function settle(until: () => boolean = () => false, turns = 40): Promise<void> {
  for (let turn = 0; turn < turns && !until(); turn++) {
    await flush();
  }
}

/**
 * Open the dialog and wait until it is showing. The promise it resolves with is boxed: an async
 * function that returned it bare would adopt it, and waiting for "open" would wait for "closed".
 */
async function open(
  request: Parameters<typeof flow.openAddNew>[0] = {},
): Promise<{ done: ReturnType<typeof flow.openAddNew> }> {
  const done = flow.openAddNew(request);
  await settle(() => (topDialog()?.querySelector('[part="kind"]') ?? null) !== null);
  await settle(undefined, 6);
  return { done };
}

async function typeName(value: string) {
  const input = dialog().querySelector<HTMLInputElement>('[part="name"] [part="input"]')!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle(undefined, 10);
}

async function pickKind(kind: string) {
  dialog().querySelector<HTMLElement>(`[part="kind"][data-kind="${kind}"]`)!.click();
  await settle(undefined, 10);
}

async function pickCard(group: string, value: string) {
  dialog().querySelector<HTMLElement>(`[part="${group}"] [data-value="${value}"]`)!.click();
  await settle(undefined, 10);
}

async function confirm() {
  dialog().dispatchEvent(new Event("confirm"));
  await settle(undefined, 30);
}

function saved(): string {
  return part("saved")?.textContent.trim() ?? "";
}

function fieldError(): string {
  return part("name")?.querySelector('[part="error"]')?.textContent.trim() ?? "";
}

function fileJson(path: string): JsonObject {
  const text = platform.state.files.get(path);
  if (text === undefined) {
    throw new Error(`nothing was written at ${path}`);
  }
  const parsed: unknown = JSON.parse(text);
  if (!isJsonObject(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return parsed;
}

// ─── The dialog ───────────────────────────────────────────────────────────────

describe("the dialog", () => {
  test("opens on Page in the dialog layer, with the kinds down the left", async () => {
    await open();
    const element = dialog();
    expect(element.closest('[data-jx-region="overlay.dialog:add-new"]')).not.toBeNull();
    expect(parts("kind").map((el) => el.dataset.kind)).toEqual([
      "page",
      "collection",
      "template",
      "component",
      "media",
    ]);
    expect(element.dataset.kind).toBe("page");
    // ⌘N reaches only the desktop app; a browser keeps it for a new window.
    expect(part("chord-note")?.textContent).toBe("⌘N opens this in the desktop app, ⌘⌥N anywhere.");
  });

  test("an Entry kind appears once there is a collection to put one in", async () => {
    setup({}, { content: { posts: { schema: { properties: {} }, source: "./content/posts" } } });
    await open();
    expect(parts("kind").map((el) => el.dataset.kind)).toContain("entry");
  });

  test("the hint derives live from the name, and the button waits for one", async () => {
    await open();
    expect(saved()).toBe("");
    const primary = () => dialog().querySelector<HTMLButtonElement>('[part="confirm"] button')!;
    expect(primary().disabled).toBe(true);
    expect(primary().textContent.trim()).toBe("Create page");
    await typeName("Our Pricing");
    expect(saved()).toBe("Saved as pages/our-pricing.json · opens at /our-pricing");
    expect(part("route")?.textContent).toBe("/our-pricing");
    expect(primary().disabled).toBe(false);
  });

  test("a refusal waits for the reader to type, then says itself in the field", async () => {
    setup({ "pages/about.json": "{}" });
    await open();
    expect(fieldError()).toBe("");
    await typeName("About");
    expect(fieldError()).toBe("about.json already exists in pages/.");
    await confirm();
    // Still open, nothing written over the existing page.
    expect(topDialog()).not.toBeNull();
    expect(platform.state.files.get("pages/about.json")).toBe("{}");
  });

  test("Cancel resolves with nothing and writes nothing", async () => {
    const { done } = await open();
    dialog().dispatchEvent(new Event("cancel"));
    expect(await done).toBeNull();
    expect([...platform.state.files.keys()].some((path) => path.startsWith("pages/"))).toBe(false);
  });

  test("switching kinds keeps the name and re-derives everything from it", async () => {
    await open();
    await typeName("Recipes");
    await pickKind("collection");
    expect(dialog().dataset.kind).toBe("collection");
    expect(part<HTMLInputElement>("name")?.querySelector("input")?.value).toBe("Recipes");
    expect(saved()).toContain("Adds a “recipes” collection to project.json");
    expect(part("confirm")?.textContent.trim()).toBe("Create collection");
    await pickKind("template");
    expect(saved()).toBe("Saved as layouts/recipes.json with one slot.");
  });

  test("a second open while one is showing is the same dialog", async () => {
    const { done: first } = await open();
    const second = flow.openAddNew({ kind: "template" });
    await settle(undefined, 10);
    expect(document.querySelectorAll("#layer-dialog jx-dialog").length).toBe(1);
    dialog().dispatchEvent(new Event("cancel"));
    expect(await first).toBeNull();
    expect(await second).toBeNull();
  });

  test("Enter in the name field creates", async () => {
    const { done } = await open();
    await typeName("Contact");
    const input = dialog().querySelector<HTMLInputElement>('[part="name"] [part="input"]')!;
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    const result = await done;
    expect(result?.path).toBe("pages/contact.json");
  });
});

// ─── Pages ────────────────────────────────────────────────────────────────────

describe("a page", () => {
  test("is written on the default template, opened, and its tab is the active one", async () => {
    const { done } = await open();
    await typeName("Pricing");
    await confirm();
    const result = await done;
    expect(result).toEqual({
      kind: "page",
      path: "pages/pricing.json",
      route: "/pricing",
      wrote: ["pages/pricing.json"],
    });
    expect(fileJson("pages/pricing.json")).toEqual({
      children: [{ tagName: "h1", textContent: "Pricing" }],
      tagName: "main",
      title: "Pricing",
    });
    expect(activeTab.value?.documentPath).toBe("pages/pricing.json");
  });

  test("Start from offers every template, then Blank, and Blank opts out of the default", async () => {
    const { done } = await open();
    expect(parts("choice-card").map((el) => el.dataset.value)).toEqual([
      "./layouts/base.json",
      "./layouts/post.json",
      "blank",
    ]);
    await pickCard("start-from", "blank");
    await typeName("Bare");
    await confirm();
    await done;
    expect(fileJson("pages/bare.json").$layout).toBe(false);
  });

  test("Edit reveals the URL, which then places the file", async () => {
    const { done } = await open();
    await typeName("Getting started");
    dialog().querySelector<HTMLElement>('[part="edit-url"] [part="control"]')!.click();
    await settle(undefined, 10);
    const url = dialog().querySelector<HTMLInputElement>('[part="url"] [part="input"]')!;
    expect(url.value).toBe("/getting-started");
    url.value = "/docs/start";
    url.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(undefined, 10);
    expect(saved()).toBe("Saved as pages/docs/start.json · opens at /docs/start");
    await confirm();
    const result = await done;
    expect(result?.path).toBe("pages/docs/start.json");
  });
});

// ─── Templates, components ────────────────────────────────────────────────────

describe("a template", () => {
  test("is a JSON layout with one slot, wrapped in the template chosen", async () => {
    const { done } = await open({ kind: "template" });
    await pickCard("wrap-in", "./layouts/base.json");
    await typeName("Landing");
    expect(saved()).toBe("Saved as layouts/landing.json with one slot.");
    await confirm();
    await done;
    expect(fileJson("layouts/landing.json")).toEqual({
      $layout: "./layouts/base.json",
      children: [{ children: [{ tagName: "slot" }], tagName: "main" }],
      tagName: "div",
    });
  });
});

describe("a component", () => {
  test("Blank writes its tag, registers it, and opens it", async () => {
    const { done } = await open({ kind: "component" });
    await typeName("Hero");
    expect(saved()).toBe("Saved as components/site-hero.json with tag <site-hero>.");
    await confirm();
    const result = await done;
    expect(result?.tag).toBe("site-hero");
    expect(fileJson("components/site-hero.json")).toEqual({ children: [], tagName: "site-hero" });
    expect(components.componentRegistry.map((entry) => entry.tagName)).toContain("site-hero");
    expect(activeTab.value?.documentPath).toBe("components/site-hero.json");
  });

  test("Current selection is disabled, with its reason, when nothing is selected", async () => {
    await open({ kind: "component" });
    const card = dialog().querySelector<HTMLElement>(
      '[part="component-start"] [data-value="selection"]',
    )!;
    expect(card.querySelector("button")?.disabled).toBe(true);
    expect(card.querySelector("button")?.title).toBe("Select an element on the canvas first.");
  });

  test("Current selection lifts the element out, reference first, file after", async () => {
    const tab = resetWorkspaceWithTab(
      { children: [{ $id: "Hero", tagName: "section" }], tagName: "div" },
      { documentPath: "pages/index.json", id: "pages/index.json" },
    );
    tab.session.selection = [["children", 0]];
    const { done } = await open({ kind: "component" });
    expect(
      part("component-start")?.querySelector('[data-value="selection"]')?.textContent,
    ).toContain("1 element");
    // A selection never makes Current selection the default: converting edits the open page.
    expect(isChosen("component-start", "blank")).toBe(true);
    await pickCard("component-start", "selection");
    await typeName("Hero banner");
    await confirm();
    await done;
    expect(tab.doc.document.children).toEqual([{ tagName: "hero-banner" }]);
    expect(tab.doc.document.$elements).toEqual([{ $ref: "../components/hero-banner.json" }]);
    // The lifted subtree, minus the page-only `$id`, under the tag the name derived.
    expect(fileJson("components/hero-banner.json")).toEqual({ tagName: "hero-banner" });
    // Then the new component opens, as every other component start does.
    await settle(() => activeTab.value?.documentPath === "components/hero-banner.json");
    expect(activeTab.value?.documentPath).toBe("components/hero-banner.json");
  });

  test("Copy of… copies an existing component under the new tag", async () => {
    setup({
      "components/site-card.json": JSON.stringify({
        $id: "c",
        children: [{ tagName: "slot" }],
        tagName: "site-card",
      }),
    });
    await withComponents([{ path: "components/site-card.json", tagName: "site-card" }]);
    const { done } = await open({ kind: "component" });
    await pickCard("component-start", "copy");
    await settle(undefined, 10);
    expect(part("copy-of")?.querySelector("select")?.value).toBe("site-card");
    await typeName("Card two");
    await confirm();
    await done;
    expect(fileJson("components/card-two.json")).toEqual({
      children: [{ tagName: "slot" }],
      tagName: "card-two",
    });
  });

  test("a taken tag is refused before anything is written", async () => {
    await withComponents([{ path: "components/site-hero.json", tagName: "site-hero" }]);
    await open({ kind: "component" });
    await typeName("Hero");
    expect(fieldError()).toBe("A component named <site-hero> already exists.");
  });
});

// ─── Collections and entries ──────────────────────────────────────────────────

describe("a collection", () => {
  test("adds its project.json entry, a first entry and its own page, then shows Content", async () => {
    const { done } = await open({ kind: "collection" });
    expect(parts("preset").map((el) => el.dataset.preset)).toEqual([
      "title",
      "image",
      "date",
      "tags",
      "number",
      "link",
    ]);
    dialog()
      .querySelector<HTMLElement>('[part="preset"][data-preset="date"] [part="control"]')!
      .click();
    await settle(undefined, 10);
    await typeName("Recipes");
    expect(part("pattern")?.textContent).toBe("/recipes/:slug");
    await confirm();
    const result = await done;
    expect(result?.wrote).toEqual([
      "project.json",
      "content/recipes/first-recipe.json",
      "pages/recipes/[slug].json",
    ]);
    expect(store.projectState?.projectConfig?.content).toEqual({
      recipes: {
        format: "json",
        schema: {
          properties: {
            cover: { format: "image", type: "string" },
            date: { format: "date", type: "string" },
            title: { type: "string" },
          },
          required: ["title"],
          type: "object",
        },
        source: "./content/recipes",
      },
    });
    expect(fileJson("project.json").content).toBeDefined();
    expect(fileJson("content/recipes/first-recipe.json")).toEqual({ title: "First recipe" });
    expect(fileJson("pages/recipes/[slug].json").$paths).toEqual({
      contentType: "recipes",
      field: "id",
      param: "slug",
    });
    expect(workspaceRuns).toEqual([{ collection: "recipes" }]);
  });

  test("own page off writes no page", async () => {
    const { done } = await open({ kind: "collection" });
    const box = dialog().querySelector<HTMLInputElement>('[part="own-page"] input')!;
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(undefined, 10);
    expect(part("pattern")).toBeNull();
    await typeName("Team");
    await confirm();
    const result = await done;
    expect(result?.wrote).toEqual(["project.json", "content/team/first-team.json"]);
  });
});

describe("an entry", () => {
  test("is seeded in its collection's folder and opened in the entry form", async () => {
    setup(
      {},
      {
        content: {
          posts: {
            schema: { properties: { title: { type: "string" } }, required: ["title"] },
            source: "./content/posts",
          },
        },
      },
    );
    const { done } = await open({ collection: "posts", kind: "entry" });
    expect(part("collection")?.querySelector("select")?.value).toBe("posts");
    await typeName("Hello World");
    expect(saved()).toBe("Saved as content/posts/hello-world.json in posts.");
    await confirm();
    await done;
    expect(fileJson("content/posts/hello-world.json")).toEqual({ title: "Hello World" });
    expect(activeTab.value?.documentPath).toBe("content/posts/hello-world.json");
    expect(activeTab.value?.session.ui.canvasMode).toBe("entry");
  });

  test("an Entry request in a project with no collection opens on Page", async () => {
    await open({ kind: "entry" });
    expect(dialog().dataset.kind).toBe("page");
  });
});

// ─── Media ────────────────────────────────────────────────────────────────────

describe("media", () => {
  test("drop, then Upload, into public/media/", async () => {
    const { done } = await open({ kind: "media" });
    expect(part("name")).toBeNull();
    expect(saved()).toBe("Saved under public/media/. No folder to choose.");
    const drop = part("drop")!;
    drop.dispatchEvent(new Event("dragover", { bubbles: true }));
    await settle(undefined, 10);
    expect(drop.dataset.drop).toBe("true");
    const event = new Event("drop", { bubbles: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [new File(["x"], "hero.png", { type: "image/png" })] },
    });
    drop.dispatchEvent(event);
    await settle(undefined, 10);
    expect(part("drop-summary")?.textContent).toBe("hero.png");
    expect(saved()).toBe("1 file will be saved under public/media/.");
    await confirm();
    const result = await done;
    expect(result).toEqual({
      kind: "media",
      path: "public/media",
      wrote: ["public/media/hero.png"],
    });
    expect(
      platform.state.calls.some(
        ([name, path]) => name === "uploadFile" && path === "public/media/hero.png",
      ),
    ).toBe(true);
    // Then: the Media workspace, with the upload selected (studio.md §9.1.1).
    await settle(undefined, 4);
    expect(mediaRuns).toEqual([{ select: "public/media/hero.png" }]);
  });

  test("the browse input adds its files and is cleared for the next pick", async () => {
    await open({ kind: "media" });
    const input = part<HTMLInputElement>("browse-input")!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["a"], "a.pdf"), new File(["b"], "b.mp4")],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(undefined, 10);
    expect(part("drop-summary")?.textContent).toBe("a.pdf, b.mp4");
  });
});

// ─── Without the dialog ───────────────────────────────────────────────────────

describe("createDirect", () => {
  test("creates from a kind and a name, with the same bytes the dialog writes", async () => {
    const result = await flow.createDirect({ kind: "page", name: "Pricing", template: "post" });
    expect(result.path).toBe("pages/pricing.json");
    expect(fileJson("pages/pricing.json").$layout).toBe("./layouts/post.json");
    expect(topDialog()).toBeNull();
  });

  test("an entry in the only collection needs no collection argument", async () => {
    setup({}, { content: { posts: { schema: { properties: {} }, source: "./content/posts" } } });
    const result = await flow.createDirect({ kind: "entry", name: "One" });
    expect(result.path).toBe("content/posts/one.json");
  });

  test("refuses by throwing the sentence the dialog would print", async () => {
    setup({ "pages/about.json": "{}" });
    let caught: unknown;
    try {
      await flow.createDirect({ kind: "page", name: "About" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RangeError);
    expect(String(caught)).toContain("about.json already exists in pages/.");
  });

  test("a template argument that names nothing lists what there is", async () => {
    let caught: unknown;
    try {
      await flow.createDirect({ kind: "page", name: "X", template: "nope" });
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).toContain(
      "declared: blank, article, layouts/base.json, layouts/post.json",
    );
  });

  test("media is refused: an upload needs files", async () => {
    let caught: unknown;
    try {
      await flow.createDirect({ kind: "media", name: "x" });
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).toContain("Media is uploaded, not named");
  });

  test("a failed write is a Problem and a throw, never a success", async () => {
    installMockPlatform({ writeFile: () => Promise.reject(new Error("disk full")) });
    let caught: unknown;
    try {
      await flow.createDirect({ kind: "template", name: "Broken" });
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).toContain("could not create layouts/broken.json");
    expect(problems.some((problem) => problem.path === "layouts/broken.json")).toBe(true);
  });

  test("a template argument resolves by path, by stem and by name", () => {
    const layouts = [{ name: "Blog Post", ref: "./layouts/blog-post.json" }];
    expect(flow.resolveTemplateArg("layouts/blog-post.json", layouts)).toBe(
      "./layouts/blog-post.json",
    );
    expect(flow.resolveTemplateArg("blog-post", layouts)).toBe("./layouts/blog-post.json");
    expect(flow.resolveTemplateArg("Blog Post", layouts)).toBe("./layouts/blog-post.json");
    expect(flow.resolveTemplateArg("none", layouts)).toBe("blank");
    expect(flow.resolveTemplateArg("article", layouts)).toBe("article");
    expect(flow.resolveTemplateArg("other", layouts)).toBeNull();
  });
});

describe("the context", () => {
  test("reads layouts, collections and components off the project", async () => {
    setup(
      { "components/x-card.json": "{}" },
      { content: { posts: { schema: { properties: {} }, source: "./content/posts" } } },
    );
    await withComponents([{ path: "components/x-card.json", tagName: "x-card" }]);
    const ctx = await flow.readCreationContext();
    expect(ctx.layouts).toEqual([
      { name: "Base", ref: "./layouts/base.json" },
      { name: "Post", ref: "./layouts/post.json" },
    ]);
    expect(ctx.collections.map((c) => c.name)).toEqual(["posts"]);
    expect(ctx.componentTags).toEqual(["x-card"]);
    expect(ctx.defaultLayout).toBe("./layouts/base.json");
    expect(ctx.article).toBeNull();
    expect(workspace.tabs.size).toBeGreaterThan(0);
  });
});

// ─── Edges ────────────────────────────────────────────────────────────────────

describe("with a prose format", () => {
  test("Article is offered, and writes Markdown through the format's own serializer", async () => {
    setup({}, {}, { formatAction: mockFormatAction });
    seedMarkdownFormat();
    const { done } = await open({ template: "article" });
    expect(parts("choice-card").map((el) => el.dataset.value)).toContain("article");
    await typeName("Field Notes");
    expect(saved()).toBe("Saved as pages/field-notes.md · opens at /field-notes");
    await confirm();
    await done;
    const text = platform.state.files.get("pages/field-notes.md") ?? "";
    expect(text).toContain("title: Field Notes");
    expect(text).toContain("# Field Notes");
  });

  test("a collection's entries are Markdown, with Rich text bound in its page", async () => {
    setup({}, {}, { formatAction: mockFormatAction });
    seedMarkdownFormat();
    const { done } = await open({ kind: "collection" });
    expect(parts("preset").map((el) => el.dataset.preset)).toContain("richText");
    await typeName("Notes");
    await confirm();
    await done;
    expect(platform.state.files.get("content/notes/first-note.md")).toContain("title: First note");
    expect(JSON.stringify(fileJson("pages/notes/[slug].json").children)).toContain(
      "${state.entry.$children}",
    );
  });

  test("a serializer that fails is a Problem naming the path, and the dialog stays", async () => {
    setup({}, {}, { formatAction: () => Promise.reject(new Error("no serializer")) });
    seedMarkdownFormat();
    await open({ template: "article" });
    await typeName("Broken");
    await confirm();
    expect(topDialog()).not.toBeNull();
    expect(problems.some((problem) => problem.path === "pages/broken.md")).toBe(true);
  });
});

describe("the dialog's other controls", () => {
  test("a template request starts every kind on that template", async () => {
    const { done } = await open({ kind: "collection", template: "post" });
    expect(part("page-template")?.querySelector("select")?.value).toBe("./layouts/post.json");
    const select = part("page-template")!.querySelector("select")!;
    select.value = "blank";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(undefined, 10);
    await typeName("Events");
    await confirm();
    await done;
    expect(fileJson("pages/events/[slug].json").$layout).toBe(false);
  });

  test("the entry collection picker, the drag-out and Edit twice", async () => {
    setup(
      {},
      {
        content: {
          a: { schema: { properties: {} }, source: "./content/a" },
          b: { schema: { properties: {} }, source: "./content/b" },
        },
      },
    );
    await open({ kind: "entry" });
    const select = part("collection")!.querySelector("select")!;
    select.value = "b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(undefined, 10);
    await typeName("One");
    expect(saved()).toBe("Saved as content/b/one.json in b.");
    await pickKind("media");
    const drop = part("drop")!;
    drop.dispatchEvent(new Event("dragover", { bubbles: true }));
    drop.dispatchEvent(new Event("dragover", { bubbles: true }));
    await settle(undefined, 6);
    drop.dispatchEvent(new Event("dragleave", { bubbles: true }));
    await settle(undefined, 6);
    expect(drop.dataset.drop).toBe("false");
    await pickKind("page");
    const edit = dialog().querySelector<HTMLElement>('[part="edit-url"] [part="control"]')!;
    edit.click();
    await settle(undefined, 6);
    expect(part("url")).not.toBeNull();
    edit.click();
    await settle(undefined, 6);
    expect(part("url")).toBeNull();
  });

  test("a preset toggles off, and Current selection counts what it lifts", async () => {
    const tab = resetWorkspaceWithTab(
      {
        children: [{ children: [{ tagName: "h2" }, { tagName: "p" }], tagName: "section" }],
        tagName: "div",
      },
      { documentPath: "pages/index.json", id: "pages/index.json" },
    );
    tab.session.selection = [["children", 0]];
    await open({ kind: "collection" });
    dialog()
      .querySelector<HTMLElement>('[part="preset"][data-preset="image"] [part="control"]')!
      .click();
    await settle(undefined, 10);
    await typeName("Places");
    expect(saved()).not.toContain("undefined");
    await pickKind("component");
    expect(
      part("component-start")?.querySelector('[data-value="selection"]')?.textContent,
    ).toContain("3 elements");
  });

  test("a failed upload leaves the dialog up", async () => {
    setup({}, {}, { uploadFile: () => Promise.reject(new Error("quota")) });
    await open({ kind: "media" });
    const event = new Event("drop", { bubbles: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [new File(["x"], "a.png")] } });
    part("drop")!.dispatchEvent(event);
    await settle(undefined, 6);
    await confirm();
    expect(topDialog()).not.toBeNull();
  });

  test("a configuration that cannot be saved creates no collection", async () => {
    setup(
      {},
      {},
      {
        writeFile: (path: string) =>
          path === "project.json" ? Promise.reject(new Error("read-only")) : Promise.resolve(),
      },
    );
    await open({ kind: "collection" });
    await typeName("Recipes");
    await confirm();
    expect(topDialog()).not.toBeNull();
    expect(workspaceRuns).toEqual([]);
  });

  test("no registry, no chord note; no layouts directory, no templates", async () => {
    setup(
      {},
      {},
      {
        listDirectory: (dir: string) =>
          dir === "layouts" ? Promise.reject(new Error("absent")) : Promise.resolve([]),
      },
    );
    setActiveRegistry(null);
    await open();
    expect(part("chord-note")?.textContent).toBe("");
    expect(parts("choice-card").map((el) => el.dataset.value)).toEqual(["blank"]);
  });
});

// ─── Review fixes ─────────────────────────────────────────────────────────────

/** Whether a card in a radiogroup is the chosen one, however the kit reflects it. */
function isChosen(group: string, value: string): boolean {
  const card = part(group)?.querySelector(`[data-value="${value}"]`);
  return card !== null && card !== undefined && "checked" in card && card.checked === "true";
}

describe("dismissal", () => {
  test("Cancel takes the slot out of the dialog layer, so a reopen is the only one", async () => {
    const { done } = await open();
    dialog().dispatchEvent(new Event("cancel"));
    expect(await done).toBeNull();
    expect(document.querySelector("#layer-dialog")?.childElementCount).toBe(0);
    await open({ kind: "template" });
    expect(document.querySelectorAll('[data-jx-region="overlay.dialog:add-new"]').length).toBe(1);
  });
});

describe("defaults", () => {
  test("a template starts wrapped in the site's default template", async () => {
    await open({ kind: "template" });
    expect(isChosen("wrap-in", "./layouts/base.json")).toBe(true);
    expect(isChosen("wrap-in", "")).toBe(false);
  });

  test("a template with no template to wrap in starts on Nothing", async () => {
    setup({}, { defaults: {} });
    platform.state.files.delete("layouts/base.json");
    platform.state.files.delete("layouts/post.json");
    await open({ kind: "template" });
    expect(isChosen("wrap-in", "")).toBe(true);
  });

  test("Copy of… is disabled when every component comes from a package", async () => {
    await withComponents([{ path: "node_modules/kit/card.json", tagName: "kit-card" }]);
    for (const component of components.componentRegistry) {
      component.source = "npm";
    }
    await open({ kind: "component" });
    const copy = part("component-start")?.querySelector('[data-value="copy"]');
    expect(copy !== null && copy !== undefined && "disabled" in copy && copy.disabled).toBe(true);
  });
});

describe("a page's URL", () => {
  test("is refused when another page file already opens there", async () => {
    setup({ "pages/about.md": "# About" });
    await open();
    await typeName("About");
    expect(fieldError()).toBe("pages/about.md already opens at /about.");
  });

  test("is refused when a folder's index page already opens there", async () => {
    setup({ "pages/about/index.json": "{}" });
    await open();
    await typeName("About");
    expect(fieldError()).toBe("pages/about/index.json already opens at /about.");
  });

  test("is free beside a collection's own pages, which open one level down", async () => {
    setup({ "pages/blog/[slug].json": "{}" });
    await open();
    await typeName("Blog");
    expect(fieldError()).toBe("");
  });
});

describe("media, dropped", () => {
  test("a file dropped anywhere on the dialog is an upload, never a navigation", async () => {
    await open();
    expect(dialog().dataset.kind).toBe("page");
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [new File(["x"], "hero.png", { type: "image/png" })] },
    });
    part("kinds")!.dispatchEvent(event);
    await settle(undefined, 10);
    expect(event.defaultPrevented).toBe(true);
    expect(dialog().dataset.kind).toBe("media");
    expect(part("drop-summary")?.textContent).toBe("hero.png");
  });

  test("before anything is chosen, only the saved line names the folder", async () => {
    await open({ kind: "media" });
    expect(part("drop-summary")?.textContent ?? "").toBe("");
    expect(saved()).toBe("Saved under public/media/. No folder to choose.");
  });
});

describe("a collection that half lands", () => {
  test("warns, naming what was not written, instead of claiming success", async () => {
    setup(
      {},
      {},
      {
        writeFile: (path: string) =>
          path.startsWith("pages/") ? Promise.reject(new Error("disk full")) : Promise.resolve(),
      },
    );
    const { done } = await open({ kind: "collection" });
    await typeName("Recipes");
    await confirm();
    const result = await done;
    expect(result?.wrote).not.toContain("pages/recipes/[slug].json");
    expect(
      toasts.some(
        (toast) =>
          toast.severity === "warn" &&
          toast.message.includes("pages/recipes/[slug].json could not be written"),
      ),
    ).toBe(true);
  });
});

describe("a page for a collection that has none", () => {
  const RECIPES = {
    recipes: {
      format: "json",
      schema: {
        properties: { cover: { type: "string" }, title: { type: "string" } },
        type: "object",
      },
      source: "./content/recipes",
    },
  };

  test("writes the page Add new writes for a new collection, in the default template", async () => {
    setup({}, { content: RECIPES });
    const path = await flow.addCollectionPage("recipes");
    expect(path).toBe("pages/recipes/[slug].json");
    const page = fileJson("pages/recipes/[slug].json");
    expect(page.$paths).toEqual({ contentType: "recipes", field: "id", param: "slug" });
    // The default template already applies, so the page says nothing about it.
    expect(page.$layout).toBeUndefined();
    expect(page.title).toBe("${state.entry.data.title}");
    const children = Array.isArray(page.children) ? page.children : [];
    expect(children.map((child) => (isJsonObject(child) ? child.tagName : null))).toEqual([
      "h1",
      "img",
    ]);
  });

  test("refuses a collection the project does not declare, and one that already has the page", async () => {
    setup({ "pages/recipes/[slug].json": "{}" }, { content: RECIPES });
    expect(await flow.addCollectionPage("gone")).toBeNull();
    expect(problems.at(-1)?.message).toContain('"gone" is not a collection');
    expect(await flow.addCollectionPage("recipes")).toBeNull();
    expect(problems.at(-1)?.message).toBe("pages/recipes/[slug].json already exists.");
    expect(platform.state.files.get("pages/recipes/[slug].json")).toBe("{}");
  });

  test("a write that fails answers null", async () => {
    setup({}, { content: RECIPES }, { writeFile: () => Promise.reject(new Error("disk full")) });
    expect(await flow.addCollectionPage("recipes")).toBeNull();
  });
});
