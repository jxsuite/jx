/**
 * Search appearance — the surface (plan §9.2, §14).
 *
 * It was a `<details>` inside the Document Header card, then a lit modal, and it is a Jx document
 * over the kit now. Everything asserted here was asserted through both: two previews of the MERGED
 * head, the resolved-field list with its counters and provenance chips, the named warnings, and the
 * editable rows below them. What is new is the SEAM — a `jx-dialog` in the dialog layer, so the
 * box, the backdrop, Escape and the way out all belong to the platform rather than to a fixed card
 * with a `z-index` of its own.
 *
 * Everything is addressed by `part`, `role` or `data-*`: there is no `.seo-modal` to find any more,
 * no `.provenance-chip` and no `.set-dot` — the chip vocabulary travels with the surface as parts,
 * and the row's clear affordance is `jx-textfield`'s own.
 *
 * The merge itself is asserted in `head-panel.test.ts`; these are about what the surface SHOWS, and
 * about the one property the plan states as a prohibition — nothing here renders a score.
 */
import {
  flush,
  installMockPlatform,
  registerPrimaryStage,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initShellRefs, registerRenderer } from "../src/store";
import { initLayers } from "../src/ui/layers";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import { problems, resetNotifications } from "../src/services/notify";
import { invalidateLayoutHeadCache } from "../src/panels/head-panel";
import { invalidateLayoutCache } from "../src/site-context";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext, makeContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";

const { closeSeoModal, openSeoModal, renderSeoModal, seoCommands } =
  await import("../src/panels/seo-modal");

/** The dialog itself, which is the surface's root. */
function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#layer-dialog jx-dialog[part="seo"]');
}

/**
 * Is it up?
 *
 * The DOM, not an exported predicate. `seoModalOpen()` existed for exactly these assertions and for
 * a pressed state on the two buttons — which cannot exist, because both buttons are behind the
 * modal while it is open. `tests/reachability.test.ts` calls that shape out by name, and it is
 * right: what the reader wants to know is whether the surface is on screen.
 */
function seoModalOpen(): boolean {
  return dialog() !== null;
}

// Panel scheduler coalesces via requestAnimationFrame; make it synchronous-ish.
(globalThis as unknown as Record<string, unknown>).requestAnimationFrame = (
  cb: FrameRequestCallback,
) => setTimeout(() => cb(0), 0) as unknown as number;

/** The surface's own element. It mounts into a dialog-layer slot, not into a panel. */
function host(): HTMLElement {
  const el = dialog();
  if (!el) {
    throw new Error("the Search appearance surface is not open");
  }
  return el;
}

function d<T extends Element = HTMLElement>(sel: string): T | null {
  return host().querySelector<T>(sel) as T | null;
}

function all<T extends Element = HTMLElement>(sel: string): T[] {
  return [...host().querySelectorAll<T>(sel)];
}

function setShell() {
  // The overlay layers are part of the shell here, not an afterthought: the surface mounts into
  // `#layer-dialog`, and `setShell` replaces `document.body.innerHTML` before every test.
  document.body.innerHTML = `<div id="app">
    <div id="toolbar"></div>
    <div id="activity-bar"></div><div id="left-panel"></div>
    <div class="pane-stage" data-jx-region="pane.primary"></div>
    <div id="right-panel"></div>
    <div id="statusbar"></div>
  </div>
  <div id="layer-popover"></div><div id="layer-modal"></div>
  <div id="layer-dialog"></div><div id="layer-toast"></div>`;
  initShellRefs();
  initLayers();
  registerPrimaryStage();
}

const FM_SCHEMA = {
  properties: { title: { type: "string" } },
  required: ["title"],
};

function setupContentTab(
  frontmatter: Record<string, unknown>,
  opts: { documentPath?: string; id?: string } = {},
) {
  resetStudioState({
    isSiteProject: false,
    projectConfig: { content: { posts: { format: "json", schema: FM_SCHEMA, source: "./posts" } } },
  });
  const tab = resetWorkspaceWithTab(undefined, {
    documentPath: opts.documentPath ?? "posts/hello.json",
    id: opts.id ?? "seo-fm-tab",
  }) as any;
  tab.doc.mode = "content";
  tab.doc.content.frontmatter = frontmatter;
  return tab;
}

/** The `<input>`/`<textarea>` inside one row's field — `jx-textfield`'s own control. */
function control(prop: string): HTMLInputElement {
  const el = d<HTMLInputElement>(`[data-prop="${prop}"] [part="entry"] [part="input"]`);
  if (!el) {
    throw new Error(`row not found: ${prop}`);
  }
  return el;
}

/** Commit a row the way losing focus does. */
function fireChange(prop: string, value: string): void {
  const el = control(prop);
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function row(prop: string): HTMLElement {
  const el = d(`[data-prop="${prop}"]`);
  if (!el) {
    throw new Error(`row not found: ${prop}`);
  }
  return el;
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** Open it over whatever tab the test just set up — what both buttons and the command all do. */
async function mountAndFlush() {
  openSeoModal(activeTab.value!);
  await flush(6);
}

/** Re-paint, standing in for the commit path's own `renderSeoModal`. */
function render(): void {
  renderSeoModal();
}

beforeEach(() => {
  setShell();
  installMockPlatform();
  // The layout layer of the merged head arrives asynchronously and repaints through this name.
  // Registered for EVERY test rather than inside the one that first needed it: a suite where
  // `--test-name-pattern` changes the result is a suite that is asserting test order.
  registerRenderer("seoModal", renderSeoModal);
  invalidateLayoutCache();
  invalidateLayoutHeadCache();
});

afterEach(() => {
  closeSeoModal();
  closeAllTabs();
  setActiveRegistry(null);
});

describe("the surface itself", () => {
  test("it opens over the tab it was given, and names that document in its header", async () => {
    setupContentTab({ title: "Hello" }, { documentPath: "posts/hello.json" });
    expect(seoModalOpen()).toBe(false);
    await mountAndFlush();
    expect(seoModalOpen()).toBe(true);
    // The headline belongs to `jx-dialog`, so it is one `connectedCallback` past the mount.
    expect(d('[part="headline"]')?.textContent).toBe("Search appearance");
    // A modal covers the tab strip, so it has to say which document it is about itself.
    expect(d('[part="doc"]')?.textContent).toBe("posts/hello.json");
  });

  test("the box, the backdrop and the way out are the platform's — nothing here draws one", async () => {
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    // No fixed card, no scrim of its own, and no hand-drawn close button.
    expect(document.querySelector(".seo-modal")).toBeNull();
    expect(document.querySelector("#layer-dialog sp-underlay")).toBeNull();
    expect(document.querySelector("#layer-dialog sp-dialog-wrapper")).toBeNull();
    expect(d('[part="cancel-label"]')?.textContent).toBe("Close");
    // The region the screenshot pipeline photographs rides on the element with a box.
    expect(host().dataset.jxRegion).toBe("overlay.dialog:seo");
  });

  test("opening it twice is one dialog, re-pointed at the current document", async () => {
    setupContentTab({ title: "First" }, { documentPath: "posts/first.json", id: "seo-a" });
    await mountAndFlush();
    const second = setupContentTab(
      { title: "Second" },
      {
        documentPath: "posts/second.json",
        id: "seo-b",
      },
    );
    openSeoModal(second);
    await flush(6);
    expect(document.querySelectorAll('jx-dialog[part="seo"]').length).toBe(1);
    expect(d('[part="doc"]')?.textContent).toBe("posts/second.json");
  });

  test("closing it removes it, and closing twice is not a throw", async () => {
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    closeSeoModal();
    expect(dialog()).toBeNull();
    expect(seoModalOpen()).toBe(false);
    closeSeoModal();
  });

  test("the platform's own dismissal takes it down too", async () => {
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    // What Escape raises on a native `<dialog>`, and what the kit's Close button dispatches.
    host().dispatchEvent(new Event("cancel", { bubbles: true }));
    await flush(2);
    expect(seoModalOpen()).toBe(false);
  });

  test("a repaint with nothing open is a no-op, not a throw", () => {
    renderSeoModal();
    expect(seoModalOpen()).toBe(false);
  });

  test("the form is grouped by the preview card each half feeds", async () => {
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    // Open Graph has its OWN Title, Description and Image: ungrouped, "Description" named two
    // Different fields eight rows apart.
    expect(all('[part="group-title"]').map((h) => h.textContent)).toEqual([
      "Search result",
      "Social card",
    ]);
    expect(all('[part="group"]').map((g) => g.dataset.group)).toEqual(["page", "og"]);
  });
});

describe("document.openSeo", () => {
  test("it is a document-level record the palette can reach, and the assistant can call", () => {
    const [command] = seoCommands();
    expect(command!.id).toBe("document.openSeo");
    expect(command!.level).toBe("document");
    expect(command!.menus).toContain("palette");
    expect(command!.aiTool?.name).toBe("open_seo");
  });

  test("it needs an open document, and opens the surface over the active one", async () => {
    const [command] = seoCommands();
    const registry = createCommandRegistry({
      getContext: () => makeContext({ document: { open: true } }),
    });
    registry.register(command!);
    // Gated, and the gate is the reason: with no document there is no head to preview.
    expect(command!.when!(emptyContext())).toBe(false);

    setupContentTab({ title: "Hello" }, { documentPath: "posts/hello.json" });
    await registry.run("document.openSeo");
    await flush(6);
    expect(seoModalOpen()).toBe(true);
    expect(d('[part="doc"]')?.textContent).toBe("posts/hello.json");
  });
});

describe("the favicon row", () => {
  test("committing a path writes a link entry; the field's clear button removes it", async () => {
    const tab = setupContentTab({ title: "Hello" });
    await mountAndFlush();
    const field = control("icon");
    field.value = "/favicon.png";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    // Typing commits on a debounce; losing focus does not have to wait for it.
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
    await flush(4);
    expect(tab.doc.content.frontmatter.$head).toEqual([
      { attributes: { href: "/favicon.png", rel: "icon" }, tagName: "link" },
    ]);

    render();
    await flush(4);
    /* The set dot became the control's own clear button: one affordance, drawn by the kit, shown
       only while there is something to clear. */
    click(row("icon").querySelector('[part="clear"]')!);
    await flush(4);
    expect(tab.doc.content.frontmatter.$head).toBeUndefined();
  });

  test("a media row carries Upload and Browse; a text row carries neither", async () => {
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    expect(row("icon").querySelector('[part="upload"]')).not.toBeNull();
    expect(row("icon").querySelector('[part="browse"]')).not.toBeNull();
    expect(row("og:image").querySelector('[part="browse"]')).not.toBeNull();
    expect(row("description").querySelector('[part="browse"]')).toBeNull();
  });

  test("Browse offers the project's media in a kit menu, and picking one commits it", async () => {
    const tab = setupContentTab({ title: "Hello" });
    installMockPlatform({
      listDirectory: async (dir: string) =>
        dir === "public"
          ? [{ name: "hero.jpg", path: "public/hero.jpg", size: 12, type: "file" }]
          : [],
    });
    await mountAndFlush();
    /* A kit menu, not the Spectrum popover the inspector's media picker draws: a modal `<dialog>`
       is in the top layer, so an overlay painted into a layer div renders underneath the dialog
       that opened it and is inert besides. */
    click(row("og:image").querySelector('[part="browse"]')!);
    await flush(8);
    const item = document.querySelector<HTMLElement>(
      "#layer-popover jx-menu-item[data-command-id]",
    );
    expect(item?.textContent).toContain("hero.jpg");
    click(item!);
    await flush(4);
    expect(tab.doc.content.frontmatter.$head).toEqual([
      { attributes: { content: "/hero.jpg", property: "og:image" }, tagName: "meta" },
    ]);
  });
});

function seoRow(key: string): HTMLElement {
  const el = d(`[data-seo-field="${key}"]`);
  if (!el) {
    throw new Error(`no SEO field row: ${key}`);
  }
  return el;
}

function seoWarningIds(): string[] {
  return all("[data-seo-warning]").map((el) => el.dataset.seoWarning!);
}

/** A site page whose layout and project config both contribute head material. */
function setupSeoPage(
  frontmatter: Record<string, unknown>,
  config: Record<string, unknown> = {},
): void {
  installMockPlatform(
    {},
    {
      "layouts/base.json": JSON.stringify({
        $head: [
          { attributes: { content: "the layout's summary", name: "description" }, tagName: "meta" },
        ],
        tagName: "div",
      }),
    },
  );
  resetStudioState({
    isSiteProject: true,
    projectConfig: {
      defaults: { layout: "./layouts/base.json" },
      name: "Acme",
      url: "https://acme.test",
      ...config,
    },
  });
  const tab = resetWorkspaceWithTab(undefined, {
    documentPath: "pages/about.json",
    id: "seo-tab",
  }) as any;
  tab.doc.mode = "content";
  tab.doc.content.frontmatter = frontmatter;
}

describe("the surface previews the merged head", () => {
  test("the search-result card prints the canonical breadcrumb, the title and the description", async () => {
    setupSeoPage({ title: "About Us" });
    await mountAndFlush();
    await flush(4);
    const serp = d('[part="card"][data-card="serp"]')!;
    expect(serp.getAttribute("aria-label")).toBe("Search result preview");
    expect(serp.querySelector('[part="serp-url"]')?.textContent).toBe("acme.test › about");
    expect(serp.querySelector('[part="serp-title"]')?.textContent).toBe("About Us");
    expect(serp.querySelector('[part="serp-desc"]')?.textContent?.trim()).toBe(
      "the layout's summary",
    );
  });

  test("the social card shows the og:image, and says so plainly when there is none", async () => {
    setupSeoPage({ title: "About Us" });
    await mountAndFlush();
    await flush(4);
    const social = d('[part="card"][data-card="social"]')!;
    expect(social.querySelector('[part="social-domain"]')?.textContent).toBe("acme.test");
    expect(social.querySelector('[part="social-media"] [part="unset"]')?.textContent).toBe(
      "No image",
    );
    expect(social.querySelector('[part="social-title"] [part="unset"]')?.textContent).toBe(
      "No social title",
    );

    setupSeoPage({
      $head: [{ attributes: { content: "/card.png", property: "og:image" }, tagName: "meta" }],
      title: "About Us",
    });
    // A fresh tab, so RE-OPEN rather than re-render: the surface draws the document it was opened
    // Over, and repainting would faithfully redraw the previous one.
    await mountAndFlush();
    expect(d<HTMLImageElement>('[part="social-image"]')?.getAttribute("src")).toBe("/card.png");
  });

  test("a document with no route and no site URL previews without inventing one", async () => {
    setupContentTab({ title: "Post" }, { documentPath: "posts/hello.json" });
    await mountAndFlush();
    expect(d('[part="serp-url"]')?.textContent).toBe("/");
    expect(d('[part="social-domain"] [part="unset"]')?.textContent).toBe("No site URL");
    expect(seoWarningIds()).toContain("site-url-missing");
  });
});

describe("the resolved-field list marks where each value came from", () => {
  test("a page-authored value is a set dot; a layout value names the layout it came from", async () => {
    setupSeoPage({ title: "About Us" });
    await mountAndFlush();
    await flush(4);

    const title = seoRow("title").querySelector<HTMLElement>('[part="chip"]')!;
    expect(title.dataset.state).toBe("set");
    // A 6px disc, not a control: the kit's own dot, and it has nowhere to go.
    expect(title.tagName).toBe("JX-DOT");

    const description = seoRow("description").querySelector<HTMLElement>('[part="chip"]')!;
    expect(description.dataset.state).toBe("inherited");
    expect(description.textContent?.trim()).toBe("from Base");
    // The layout donor has nowhere to go either, so it is not drawn as something pressable.
    expect(description.tagName).toBe("SPAN");
  });

  test("an unset field shows no chip at all — absence IS the ghost", async () => {
    setupSeoPage({ title: "About Us" });
    await mountAndFlush();
    await flush(4);
    expect(seoRow("og:type").querySelector('[part="chip"]')).toBeNull();
    expect(seoRow("og:type").querySelector('[part="unset"]')?.textContent).toBe("No social type");
  });

  test("a title inherited from the project name jumps to the setting that defines it", async () => {
    const ran: { id: string; args: unknown }[] = [];
    const registry = createCommandRegistry({ getContext: () => emptyContext() });
    registry.register({
      id: "settings.open",
      title: "Open Settings",
      category: "Project",
      level: "application",
      args: { properties: { section: { type: "string" } }, required: [], type: "object" },
      run: (_c, args: unknown) => {
        ran.push({ args, id: "settings.open" });
      },
    });
    setActiveRegistry(registry);

    setupSeoPage({ subtitle: "no title here" });
    await mountAndFlush();
    await flush(4);
    const chip = seoRow("title").querySelector('[part="chip"]') as HTMLButtonElement;
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.textContent?.trim()).toBe("from Site name");
    click(chip);
    expect(ran).toEqual([{ args: { section: "overview" }, id: "settings.open" }]);
    setActiveRegistry(null);
  });

  test("a value from the site's own $head jumps to Site head instead", async () => {
    const ran: unknown[] = [];
    const registry = createCommandRegistry({ getContext: () => emptyContext() });
    registry.register({
      id: "settings.open",
      title: "Open Settings",
      category: "Project",
      level: "application",
      args: { properties: { section: { type: "string" } }, required: [], type: "object" },
      run: (_c, args: unknown) => {
        ran.push(args);
      },
    });
    setActiveRegistry(registry);

    setupSeoPage(
      { title: "About Us" },
      {
        $head: [{ attributes: { content: "/site.png", property: "og:image" }, tagName: "meta" }],
      },
    );
    await mountAndFlush();
    await flush(4);
    const chip = seoRow("og:image").querySelector('[part="chip"]') as HTMLButtonElement;
    expect(chip.textContent?.trim()).toBe("from Site head");
    click(chip);
    expect(ran).toEqual([{ section: "head" }]);
    setActiveRegistry(null);
  });

  test("with no registry the chip still renders and clicking it is inert", async () => {
    setActiveRegistry(null);
    setupSeoPage({ subtitle: "no title here" });
    await mountAndFlush();
    await flush(4);
    const chip = seoRow("title").querySelector('[part="chip"]') as HTMLButtonElement;
    click(chip);
    expect(chip.textContent?.trim()).toBe("from Site name");
  });
});

describe("the two realms a document can keep its head material in", () => {
  test("a JSON document commits straight onto the document root, not into frontmatter", async () => {
    // The markdown path (`applyContentMutation`) is what every other case here exercises. A
    // Component or a JSON page has no frontmatter at all: it goes through `transact`, and the
    // Surface has to pick the right one from the tab it was opened over rather than from the
    // Focused pane.
    setupContentTab({ title: "Hello" });
    const tab = activeTab.value as any;
    tab.doc.mode = "component";
    tab.doc.document.title = "Root Title";
    await mountAndFlush();
    fireChange("description", "Written onto the root");
    expect(tab.doc.document.$head).toEqual([
      { attributes: { content: "Written onto the root", name: "description" }, tagName: "meta" },
    ]);
    expect("$head" in tab.doc.content.frontmatter).toBe(false);
  });

  test("a page with neither a title nor a site name is told the BUILD supplies one", async () => {
    // The last rung of the title cascade. Nothing in the project declares it, so the preview shows
    // What the build will actually emit — and names the build as the donor rather than showing a
    // Blank and letting the author think the page has no title at all.
    setupSeoPage({ subtitle: "no title anywhere" }, { name: "" });
    await mountAndFlush();
    await flush(4);
    expect(seoRow("title").textContent).toContain("Jx Site");
    const chip = seoRow("title").querySelector<HTMLElement>('[part="chip"]')!;
    expect(chip.dataset.state).toBe("inherited");
    expect(chip.textContent?.trim()).toBe("from the build");
    // Inherited from the build is not a setting you can open: the chip has nowhere to go.
    expect(chip.tagName).toBe("SPAN");
  });
});

describe("counters and warnings, and the absence of a score", () => {
  test("counted fields print length over budget; uncounted ones print nothing", async () => {
    setupSeoPage({ title: "About Us" });
    await mountAndFlush();
    await flush(4);
    expect(seoRow("title").querySelector('[part="count"]')?.textContent).toBe("8/60");
    expect(seoRow("description").querySelector('[part="count"]')?.textContent).toBe("20/160");
    expect(seoRow("og:image").querySelector('[part="count"]')).toBeNull();
    expect(all('[part="count"][data-over]').length).toBe(0);
  });

  test("over budget is marked on the counter and named in the list — never summed", async () => {
    setupSeoPage({ title: "T".repeat(61) });
    await mountAndFlush();
    await flush(4);
    expect(seoRow("title").querySelector('[part="count"][data-over]')?.textContent).toBe("61/60");
    expect(seoWarningIds()).toContain("title-long");
    // The prohibition, asserted: no element in the surface carries a total or a grade.
    const text = host().textContent ?? "";
    expect(text).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
    expect(text.toLowerCase()).not.toContain("score");
  });

  test("a page that inherits its description is never told it has none", async () => {
    setupSeoPage({ title: "About Us" });
    await mountAndFlush();
    await flush(4);
    expect(seoWarningIds()).not.toContain("description-missing");
    expect(seoRow("description").textContent).toContain("the layout's summary");
  });

  test("each named warning renders once, with the head key it is about", async () => {
    setupSeoPage({ title: "About Us" });
    await mountAndFlush();
    await flush(4);
    expect(seoWarningIds()).toEqual([
      "og-title-missing",
      "og-description-missing",
      "og-image-missing",
    ]);
    const first = d('[part="warning"]')!;
    expect(first.querySelector('[part="warning-field"]')?.textContent).toBe("og:title");
  });

  test("a fully-described page says so rather than printing an empty list", async () => {
    setupSeoPage({
      $head: [
        { attributes: { content: "Card", property: "og:title" }, tagName: "meta" },
        { attributes: { content: "Summary", property: "og:description" }, tagName: "meta" },
        { attributes: { content: "/card.png", property: "og:image" }, tagName: "meta" },
      ],
      title: "About Us",
    });
    await mountAndFlush();
    await flush(4);
    expect(d('[part="warnings"]')).toBeNull();
    expect(d('[part="empty"]')?.textContent?.trim()).toBe(
      "Nothing to flag — every previewed field resolves to a value.",
    );
  });

  test("the editable fields still sit below the previews, and still commit", async () => {
    setupSeoPage({ title: "About Us" });
    await mountAndFlush();
    await flush(4);
    const order = all('[part="previews"], [part="fields"], [data-prop="description"]').map(
      (el) => el.dataset.prop ?? el.getAttribute("part"),
    );
    expect(order).toEqual(["previews", "fields", "description"]);
    fireChange("description", "Written here");
    await flush(4);
    expect(seoRow("description").querySelector<HTMLElement>('[part="chip"]')?.dataset.state).toBe(
      "set",
    );
    expect(seoRow("description").textContent).toContain("Written here");
  });
});

// ─── The warnings also reach Problems ────────────────────────────────────────

describe("SEO warnings are Problems too", () => {
  test("opening the surface files one Problem per warning, and a re-open replaces them", async () => {
    /*
     * A window someone has to open is not where a fact should live alone. Problems is where this
     * app keeps the records that outlive the frame you were not watching.
     */
    setupContentTab({ title: "Hello" }, { documentPath: "posts/hello.json" });
    resetNotifications();
    await mountAndFlush();
    const filed = problems.filter((p) => p.source === "Search appearance");
    expect(filed.length).toBeGreaterThan(0);
    expect(filed.every((p) => p.tier === "problem")).toBe(true);
    // Every row leads back to the window that fixes it.
    expect(filed.every((p) => p.action === "document.openSeo")).toBe(true);

    const before = filed.length;
    openSeoModal(activeTab.value!);
    expect(problems.filter((p) => p.source === "Search appearance")).toHaveLength(before);
  });
});
