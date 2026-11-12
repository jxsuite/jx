/**
 * The block action bar's data controls (src/panels/block-action-bar.ts, studio.md §4.4, §4.5,
 * §6.9): one Bound pill per bound property of the selection, the row stepper of the repeater it
 * stands in, and the case picker of a `$switch`.
 *
 * The bar is the real document over the real flow. The canvas frame is a double (it is the one
 * thing that knows how many rows are drawn), and so are the four commands these controls run: each
 * is a record that notes what it was run with, because the commands themselves are tested where
 * they are defined (`canvas-view-commands.test.ts`) and what is under test here is that a press
 * runs the right one with the right arguments.
 */
import { flush, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { dismissSlashMenu, isSlashMenuOpen } from "../src/editor/slash-menu";
import { initLayers } from "../src/ui/layers";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";
import { view } from "../src/view";

import type { JxPath } from "../src/state";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { RowCount } from "../src/canvas/iframe-protocol";
import type { CommandArgValues } from "../src/commands/command-args";
import type { Tab } from "../src/tabs/tab";

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
}));

/** How many rows the frame says each repeater draws, by its serialized path. */
const counts = new Map<string, RowCount>();
const revealed: JxPath[] = [];
const countAsks: JxPath[] = [];

void mock.module("../src/canvas/iframe-host", () => ({
  flushCanvasEdits: () => Promise.resolve(),
  getEditBarAnchorRect: () => ({ height: 20, left: 30, top: 200, width: 100 }),
  getEditSnapshot: () => ({ editing: false, editingProp: null, snapshot: null }),
  postApplyFormat: () => {},
  requestCanvasEval: () => Promise.resolve(null),
  requestTemplateEval: (_tabId: string | null, request: { repeater?: JxPath }) => {
    if (!request.repeater) {
      return Promise.resolve(null);
    }
    countAsks.push(request.repeater);
    return Promise.resolve({
      results: [],
      rows: counts.get(JSON.stringify(request.repeater)) ?? null,
    });
  },
  revealCanvasPath: (path: JxPath) => {
    revealed.push([...path]);
    return Promise.resolve(null);
  },
}));

const { dismissBlockActionBar, initBlockActionBar, isEditChromeTarget, renderBlockActionBar } =
  await import("../src/panels/block-action-bar");
const { getLayerSlot } = await import("../src/ui/layers");

/** What each stand-in command was run with. */
const ran: [string, CommandArgValues][] = [];

const POSTS: JxPath = ["children", 0];
const ROW_ROOT: JxPath = [...POSTS, "map"];
const HEADING: JxPath = [...ROW_ROOT, "children", 0];
const PICTURE: JxPath = [...ROW_ROOT, "children", 1];
const LINK: JxPath = [...ROW_ROOT, "children", 2];
const CARD: JxPath = [...ROW_ROOT, "children", 3];
const TABS: JxPath = ["children", 1];

function page(): JxMutableNode {
  return {
    children: [
      {
        $prototype: "Array",
        items: { $ref: "#/state/posts" },
        map: {
          children: [
            { tagName: "h3", textContent: "${item.data.title} on ${item.data.date}" },
            {
              attributes: { alt: "${item.data.title}" },
              src: "${item.data.featuredImage}",
              style: { borderColor: "${state.brand}", margin: "0" },
              tagName: "img",
            },
            {
              attributes: { href: "${item.data.permalink}" },
              innerHTML: "${item.data.excerpt}",
              tagName: "a",
            },
            { $props: { heading: { $ref: "$map/item/data/title" } }, tagName: "post-card" },
          ],
          tagName: "article",
        },
      },
      {
        $switch: { $ref: "#/state/tab" },
        cases: { closed: { tagName: "p" }, open: { tagName: "p" } },
        tagName: "section",
      },
      { tagName: "p", textContent: "Plain" },
    ],
    state: { brand: "red", posts: { default: [] }, tab: "closed" },
    tagName: "main",
  };
}

let tab: Tab;

function bar(): HTMLElement | null {
  return view.blockActionBarEl?.querySelector<HTMLElement>('[part="bar"]') ?? null;
}

function part(name: string): HTMLElement | null {
  return bar()?.querySelector<HTMLElement>(`[part="${name}"]`) ?? null;
}

/** A kit button's own control: the node a press is dispatched at. */
function control(el: Element | null): HTMLElement | null {
  return el?.querySelector<HTMLElement>('[part="control"]') ?? null;
}

function press(el: Element | null): void {
  (control(el) ?? el)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** Select `path` and draw the bar for it. */
async function select(path: JxPath): Promise<void> {
  tab.session.selection = [path];
  renderBlockActionBar();
  await flush(6);
}

/** The Bound pills, as the words each one shows. */
function pills(): string[] {
  return [...(bar()?.querySelectorAll('[part="pill-text"]') ?? [])].map((el) => el.textContent);
}

/** The rows of the list a control opened. */
async function menuRows(): Promise<HTMLElement[]> {
  await flush(3);
  return [...document.querySelectorAll<HTMLElement>('#layer-popover [part="option"]')];
}

/** A menu row's words. */
function labelOf(row: Element): string {
  return row.querySelector('[part="label"]')?.textContent.trim() ?? "";
}

beforeAll(() => {
  for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
  initLayers();
  initBlockActionBar({ getCanvasMode: () => "edit", navigateToComponent: () => {} });
});

beforeEach(() => {
  resetStudioState({
    projectConfig: {
      content: {
        posts: {
          schema: {
            properties: {
              date: { title: "Post date", type: "string" },
              featuredImage: { title: "Featured image", type: "string" },
              title: { type: "string" },
            },
            type: "object",
          },
          source: "content/posts/*.md",
        },
      },
    },
  });
  tab = resetWorkspaceWithTab(page(), { documentPath: "pages/blog.json" });
  // The collection the repeater reads, so its item's fields have schemas to be named by.
  tab.doc.document.state = {
    ...tab.doc.document.state,
    posts: { $prototype: "ContentCollection", contentType: "posts" },
  };
  counts.clear();
  revealed.length = 0;
  countAsks.length = 0;
  ran.length = 0;
  const registry = createCommandRegistry({
    getContext: () => makeContext({ document: { open: true } }),
  });
  for (const id of [
    "canvas.setActiveRow",
    "canvas.setRepeaterRows",
    "canvas.setSwitchCase",
    "canvas.setTagPopover",
  ]) {
    registry.register({
      category: "View",
      id,
      level: "document",
      run: (_ctx, args: CommandArgValues) => {
        ran.push([id, args]);
      },
      title: id,
    });
  }
  setActiveRegistry(registry);
});

afterEach(() => {
  dismissSlashMenu();
  dismissBlockActionBar();
  setActiveRegistry(null);
});

describe("Bound pills", () => {
  test("one per bound property, naming the property and the value by its schema title", async () => {
    await select(HEADING);
    expect(pills()).toEqual(["Text: Title", "Text: Post date"]);
    await select(PICTURE);
    expect(pills()).toEqual(["Alt text: Title", "Image: Featured image", "Border color: Brand"]);
    await select(LINK);
    expect(pills()).toEqual(["Link: Permalink", "HTML: Excerpt"]);
    await select(CARD);
    expect(pills()).toEqual(["Heading: Title"]);
  });

  test("a block with nothing bound has no pills, and neither does a repeater", async () => {
    await select(["children", 2]);
    expect(part("pills")).toBeNull();
    await select(POSTS);
    expect(part("pills")).toBeNull();
  });

  test("a pill opens its own property's tag, by the command, and says what it is for", async () => {
    await select(PICTURE);
    const [, image] = [...(bar()?.querySelectorAll<HTMLElement>('[part="pill"]') ?? [])];
    expect(image?.dataset.property).toBe("Image");
    expect(control(image ?? null)?.getAttribute("aria-label")).toBe("Image: Featured image");
    press(image ?? null);
    await flush(4);
    expect(ran).toEqual([
      ["canvas.setTagPopover", { tag: { index: 0, path: PICTURE, slot: ["src"] } }],
    ]);
  });

  test("the second tag of one property is its own pill", async () => {
    await select(HEADING);
    const [, date] = [...(bar()?.querySelectorAll<HTMLElement>('[part="pill"]') ?? [])];
    press(date ?? null);
    await flush(4);
    expect(ran).toEqual([
      ["canvas.setTagPopover", { tag: { index: 1, path: HEADING, slot: ["textContent"] } }],
    ]);
  });

  test("at most four are drawn", async () => {
    tab.doc.document.children = [
      {
        attributes: { a: "${state.a}", b: "${state.b}", c: "${state.c}" },
        tagName: "p",
        textContent: "${state.d} ${state.e}",
      },
    ];
    await select(["children", 0]);
    expect(pills()).toHaveLength(4);
  });
});

describe("the row stepper", () => {
  test("is drawn for a node in a repeater and for the repeater, and nowhere else", async () => {
    await select(HEADING);
    expect(part("rows")).not.toBeNull();
    await select(POSTS);
    expect(part("rows")).not.toBeNull();
    await select(["children", 2]);
    expect(part("rows")).toBeNull();
    await select(TABS);
    expect(part("rows")).toBeNull();
  });

  test("says which row of how many, once the frame has said", async () => {
    await select(HEADING);
    // Nothing known yet: the row alone.
    expect(part("row-count")?.querySelector('[part="cmd-label"]')?.textContent).toBe("Row 1");
    expect(countAsks[0]).toEqual(POSTS);
    counts.set(JSON.stringify(POSTS), { active: 2, drawn: 24, total: 512 });
    tab.session.ui.activeRows = { [JSON.stringify(POSTS)]: 2 };
    await select(HEADING);
    await flush(6);
    expect(part("row-count")?.querySelector('[part="cmd-label"]')?.textContent).toBe("Row 3 of 24");
    expect(control(part("row-count"))?.getAttribute("aria-label")).toBe(
      "Row 3 of 24: 24 of 512 rows drawn. Change how many",
    );
  });

  test("an empty list says so, and neither arrow can act", async () => {
    counts.set(JSON.stringify(POSTS), { active: 0, drawn: 0, total: 0 });
    await select(HEADING);
    await flush(6);
    expect(part("row-count")?.querySelector('[part="cmd-label"]')?.textContent).toBe("No rows");
    expect(control(part("row-prev"))?.hasAttribute("disabled")).toBe(true);
    expect(control(part("row-next"))?.hasAttribute("disabled")).toBe(true);
  });

  test("the arrows set the row before and after, and bring the selection on screen", async () => {
    counts.set(JSON.stringify(POSTS), { active: 1, drawn: 3, total: 3 });
    tab.session.ui.activeRows = { [JSON.stringify(POSTS)]: 1 };
    await select(HEADING);
    await flush(6);
    press(part("row-next"));
    await flush(4);
    press(part("row-prev"));
    await flush(4);
    expect(ran).toEqual([
      ["canvas.setActiveRow", { path: POSTS, row: 2 }],
      ["canvas.setActiveRow", { path: POSTS, row: 0 }],
    ]);
    expect(revealed).toEqual([HEADING, HEADING]);
  });

  test("the first row has no row before it and the last none after", async () => {
    counts.set(JSON.stringify(POSTS), { active: 0, drawn: 2, total: 2 });
    await select(HEADING);
    await flush(6);
    expect(control(part("row-prev"))?.hasAttribute("disabled")).toBe(true);
    expect(control(part("row-next"))?.hasAttribute("disabled")).toBe(false);
    tab.session.ui.activeRows = { [JSON.stringify(POSTS)]: 1 };
    await select(HEADING);
    await flush(6);
    expect(control(part("row-next"))?.hasAttribute("disabled")).toBe(true);
    // A row the list no longer has is shown as the last it does have.
    tab.session.ui.activeRows = { [JSON.stringify(POSTS)]: 9 };
    await select(HEADING);
    await flush(6);
    expect(part("row-count")?.querySelector('[part="cmd-label"]')?.textContent).toBe("Row 2 of 2");
  });

  test("the count opens the list of how many rows to draw", async () => {
    await select(HEADING);
    press(part("row-count"));
    expect(isSlashMenuOpen()).toBe(true);
    const rows = await menuRows();
    expect(rows.map((row) => labelOf(row))).toEqual([
      "Draw up to 6 rows",
      "Draw up to 12 rows",
      "Draw up to 24 rows",
      "Draw up to 48 rows",
      "Draw up to 100 rows",
      "Draw up to 1000 rows",
    ]);
    rows[3]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(4);
    expect(ran).toEqual([["canvas.setRepeaterRows", { rows: 48 }]]);
  });
});

describe("the case picker", () => {
  test("is drawn on a $switch alone, and says which case the canvas draws", async () => {
    await select(HEADING);
    expect(part("case")).toBeNull();
    await select(TABS);
    expect(part("case-pick")?.querySelector('[part="cmd-label"]')?.textContent).toBe("Case: live");
    // With the page's state in hand the live case is named.
    tab.session.canvas.scope = { tab: "closed" };
    await select(TABS);
    expect(part("case-pick")?.querySelector('[part="cmd-label"]')?.textContent).toBe(
      "Case: closed (live)",
    );
    // A discriminant that names no case is not a case.
    tab.session.canvas.scope = { tab: "nowhere" };
    await select(TABS);
    expect(part("case-pick")?.querySelector('[part="cmd-label"]')?.textContent).toBe("Case: live");
    tab.session.canvas.scope = null;
    tab.session.ui.switchCases = { [JSON.stringify(TABS)]: "open" };
    await select(TABS);
    expect(part("case-pick")?.querySelector('[part="cmd-label"]')?.textContent).toBe("Case: open");
  });

  test("lists the live case and every declared one, and a pick names it to the command", async () => {
    await select(TABS);
    press(part("case-pick"));
    const rows = await menuRows();
    expect(rows.map((row) => labelOf(row))).toEqual(["Live case", "closed", "open"]);
    rows[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(4);
    press(part("case-pick"));
    const again = await menuRows();
    again[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(4);
    expect(ran).toEqual([
      ["canvas.setSwitchCase", { case: "open", path: TABS }],
      ["canvas.setSwitchCase", { case: null, path: TABS }],
    ]);
  });
});

describe("what the bar's own words do not cover", () => {
  test("a case of a $switch carries its switch's picker, and a pick names the switch", async () => {
    await select([...TABS, "cases", "open"]);
    expect(part("case-pick")).not.toBeNull();
    press(part("case-pick"));
    const rows = await menuRows();
    rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(4);
    expect(ran).toEqual([["canvas.setSwitchCase", { case: "closed", path: TABS }]]);
    // Something inside a case is not the case: the picker is the switch's and its cases'.
    await select([...TABS, "cases", "open", "children", 0]);
    expect(part("case-pick")).toBeNull();
    await select([...TABS, "cases"]);
    expect(part("case-pick")).toBeNull();
  });

  test("a button whose words are on screen carries no tooltip to cover the list it opens", async () => {
    counts.set(JSON.stringify(POSTS), { active: 2, drawn: 24, total: 512 });
    await select(HEADING);
    await flush(6);
    expect(part("row-count")?.querySelector('[part="tip"]')).toBeNull();
    // The name stays whole for a reader.
    expect(control(part("row-count"))?.getAttribute("aria-label")).toContain(
      "24 of 512 rows drawn",
    );
    await select(TABS);
    expect(part("case-pick")?.querySelector('[part="tip"]')).toBeNull();
    expect(control(part("case-pick"))?.getAttribute("aria-label")).toContain(
      "Choose the case the canvas draws",
    );
  });

  test("Insert dynamic tag says why it cannot act on a block whose text is one bound value", async () => {
    tab.doc.document.children = [
      { tagName: "h2", textContent: { $ref: "#/state/title" } },
      { tagName: "p", textContent: "Plain" },
    ];
    await select(["children", 0]);
    const disabled = control(part("insert-data"));
    expect(disabled?.hasAttribute("disabled")).toBe(true);
    expect(part("insert-data")?.querySelector("[title]")?.getAttribute("title")).toContain(
      "one bound value",
    );
    await select(["children", 1]);
    expect(control(part("insert-data"))?.hasAttribute("disabled")).toBe(false);
  });

  test("the Insert list shows what each source holds today beside its name", async () => {
    tab.doc.document.children = [{ tagName: "p", textContent: "Plain" }];
    tab.doc.document.state = { brand: "red" };
    tab.session.canvas.scope = { brand: "red" };
    await select(["children", 0]);
    press(part("insert-data"));
    const rows = await menuRows();
    expect(rows.map((row) => [labelOf(row), row.getAttribute("description")])).toEqual([
      ["Brand", 'string · "red"'],
    ]);
  });

  test("the tag popover is edit chrome, and a press elsewhere is not", async () => {
    const slot = getLayerSlot("popover", "dynamic-tag");
    const inner = document.createElement("button");
    slot.append(inner);
    expect(isEditChromeTarget(inner)).toBe(true);
    expect(isEditChromeTarget(slot)).toBe(true);
    const outside = document.createElement("button");
    document.body.append(outside);
    expect(isEditChromeTarget(outside)).toBe(false);
    expect(isEditChromeTarget(null)).toBe(false);
    inner.remove();
    outside.remove();
  });
});
