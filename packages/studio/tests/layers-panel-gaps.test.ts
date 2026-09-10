/**
 * The Outline's rows: what each badge says, which nodes get a row at all, the move verbs, collapse,
 * inline rename, and the empty state.
 *
 * The panel's body is a Jx document (`src/surfaces/panel-outline.json`), so every question here is
 * asked of a `part`, a `role` or a `data-*` — there is no `.layer-row`, no `.layer-tag` and no
 * `sp-action-button`. The two assertions that named Spectrum attributes are re-asked of the kit's
 * own `[part="control"]`, which is where a `jx-action-button` puts `disabled` and its tooltip, and
 * the one that read `label.style.display` is re-asked as "the label is gone and the input is there"
 * — the drawing is a `$switch` case now, not a hidden node beside a created one.
 */
import { flush, resetWorkspaceWithTab } from "./harness";
import {
  allRows,
  click,
  control,
  isRefusing,
  mountOutline,
  needRow,
  outlineHost,
  resetOutline,
  row,
  rowActions,
  textOf,
  treeItems,
} from "./outline-fixture";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import { pathKey } from "../src/store";
import { view } from "../src/view";
import { NAVIGATOR_PANEL_IDS, shell } from "../src/shell";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { JxPath } from "../src/state";
import type { OutlineActions } from "../src/surfaces/panel-outline";

void mock.module("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}));

const { startLayerTitleEdit } = await import("../src/panels/layers-panel");
const { mountOutlineSurface } = await import("../src/surfaces/panel-outline");

/** Every action the surface can call, as a no-op: these tests are about the MOUNT, not the flow. */
function outlineActionSpies(): OutlineActions {
  return {
    activate: () => {},
    contextMenu: () => {},
    editCancel: () => {},
    editCommit: () => {},
    editInput: () => {},
    editReady: () => {},
    emptyAction: () => {},
    hover: () => {},
    hoverOut: () => {},
    overflowRow: () => {},
    rename: () => {},
    runRow: () => {},
    toggle: () => {},
    treeReady: () => {},
    walk: () => {},
  };
}

const LONG_TEXT = "this is a very long text node well beyond forty characters of content";

function makeDoc(): JxMutableNode {
  return {
    children: [
      {
        children: [
          { tagName: "h2", textContent: "Title" },
          { children: [LONG_TEXT, { tagName: "span", textContent: "inline" }], tagName: "p" },
        ],
        tagName: "section",
      },
      { tagName: "p", textContent: "First" },
      {
        children: {
          $prototype: "Array",
          items: { $ref: "#/state/things" },
          map: { tagName: "li", textContent: "item" },
        } as unknown as JxMutableNode[],
        tagName: "ul",
      },
      {
        $switch: "${mode}",
        cases: {
          alpha: { tagName: "p", textContent: "A" },
          beta: { $ref: "./beta.json" },
        },
        tagName: "div",
      } as unknown as JxMutableNode,
      { tagName: "img" },
    ],
    tagName: "div",
  };
}

let host: HTMLElement;
const log = { dnd: 0, rerenders: 0 };

async function draw(): Promise<HTMLElement> {
  return mountOutline(host, log);
}

function at(path: JxPath): HTMLElement {
  return needRow(host, pathKey(path));
}

/** A row's badge, which carries both its text and which of the six drawings it gets. */
function badgeOf(el: HTMLElement): HTMLElement {
  return el.querySelector('[part="badge"]') as HTMLElement;
}

/** A row's name. */
function labelOf(el: HTMLElement): HTMLElement {
  return el.querySelector('[part="label"]') as HTMLElement;
}

function maybe(path: JxPath): HTMLElement | null {
  return row(host, pathKey(path));
}

/** Select a row, draw, and collect its verb buttons by command id. */
async function buttons(path: JxPath): Promise<Record<string, HTMLElement>> {
  activeTab.value!.session.selection = [path];
  await draw();
  return rowActions(at(path));
}

/** The kit menu the `⋮` button opens. */
function overflowItems(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>("#layer-popover jx-menu-item[data-command-id]"),
  ];
}

beforeEach(() => {
  host = outlineHost();
  log.dnd = 0;
  log.rerenders = 0;
  resetWorkspaceWithTab(makeDoc());
});

afterEach(() => {
  resetOutline();
  closeAllTabs();
});

describe("the rows and their badges", () => {
  test("an element row wears its tag as a badge", async () => {
    await draw();
    expect(textOf(at([]), "badge")).toBe("div");
    expect(badgeOf(at([])).dataset.kind).toBe("tag");
    expect(textOf(at(["children", 0]), "badge")).toBe("section");
  });

  test("a text node gets a line of its own, previewed and marked as text", async () => {
    await draw();
    const text = allRows(host).find((r) => r.dataset.kind === "text");
    expect(text).toBeDefined();
    const preview = textOf(text!, "label");
    expect(preview.length).toBe(41); // 40 chars + ellipsis
    expect(preview.startsWith(LONG_TEXT.slice(0, 40))).toBe(true);
    expect(badgeOf(text!).dataset.kind).toBe("text");
  });

  test("inline elements (span inside p) are skipped", async () => {
    await draw();
    expect(maybe(["children", 0, "children", 1, "children", 1])).toBeNull();
  });

  test("a repeater wears the repeat badge, is draggable, and shows its template", async () => {
    await draw();
    // The repeater is a first-class member of the <ul>'s children (normalized on load).
    const mapRow = at(["children", 2, "children", 0]);
    expect(textOf(mapRow, "badge")).toBe("↻");
    expect(badgeOf(mapRow).dataset.kind).toBe("map");
    expect(textOf(mapRow, "label")).toContain("Repeater");
    expect(mapRow.dataset.dndRow).toBe(pathKey(["children", 2, "children", 0]));
    expect(mapRow.querySelector('[part="drag"]')).not.toBeNull();
    // A repeater cannot take a dropped child: its content is the single template.
    expect(mapRow.dataset.dndVoid).toBe("");
    expect(maybe(["children", 2, "children", 0, "map"])).not.toBeNull();
  });

  test("a $switch node and its cases each get their own badge kind", async () => {
    await draw();
    const switchRow = at(["children", 3]);
    expect(textOf(switchRow, "badge")).toBe("⇄");
    expect(badgeOf(switchRow).dataset.kind).toBe("switch");

    const caseRow = at(["children", 3, "cases", "alpha"]);
    expect(textOf(caseRow, "badge")).toBe("alpha");
    expect(badgeOf(caseRow).dataset.kind).toBe("case");

    const refRow = at(["children", 3, "cases", "beta"]);
    expect(textOf(refRow, "badge")).toBe("beta");
    expect(textOf(refRow, "label")).toBe("./beta.json");
    // An external case names a file rather than describing a node, so it is set in italic.
    expect(labelOf(refRow).dataset.italic).toBe("true");
  });

  test("a slot says which slot it is, on the badge that names no tag", async () => {
    resetWorkspaceWithTab({
      children: [{ attributes: { name: "footer" }, tagName: "slot" }],
      tagName: "div",
    } as JxMutableNode);
    await draw();
    const slot = badgeOf(at(["children", 0]));
    expect(slot.dataset.kind).toBe("slot");
    expect(slot.getAttribute("title")).toBe('Slot "footer"');
  });

  test("content mode skips the root row", async () => {
    activeTab.value!.doc.mode = "content";
    await draw();
    expect(maybe([])).toBeNull();
    expect(maybe(["children", 0])).not.toBeNull();
  });

  test("the root row has no cluster and no grab handle", async () => {
    await draw();
    expect(at([]).querySelectorAll("jx-action-button")).toHaveLength(0);
    expect(at([]).querySelector('[part="drag"]')).toBeNull();
    expect(at([]).dataset.dndRow).toBeUndefined();
  });
});

describe("selection and collapse", () => {
  test("clicking a row selects its path", async () => {
    await draw();
    click(at(["children", 1]));
    await flush();
    expect(activeTab.value!.session.selection).toEqual([["children", 1]]);
  });

  test("the selected row announces itself rather than wearing a class", async () => {
    activeTab.value!.session.selection = [["children", 0]];
    await draw();
    expect(at(["children", 0]).getAttribute("aria-selected")).toBe("true");
    expect(at(["children", 1]).getAttribute("aria-selected")).toBe("false");
    expect(at(["children", 0]).className).toBe("");
  });

  test("clicking the chevron collapses, hides descendants, and turns the glyph", async () => {
    await draw();
    const toggle = () => at(["children", 0]).querySelector('[part="toggle"]') as HTMLElement;
    expect(toggle().querySelector("jx-icon")).not.toBeNull();

    click(toggle());
    await flush();
    expect(view._layersCollapsed!.has("children/0")).toBe(true);
    expect(maybe(["children", 0, "children", 0])).toBeNull();
    expect(at(["children", 0]).getAttribute("aria-expanded")).toBe("false");

    click(toggle());
    await flush();
    expect(view._layersCollapsed!.has("children/0")).toBe(false);
    expect(maybe(["children", 0, "children", 0])).not.toBeNull();
  });

  test("a row with nothing under it draws no chevron", async () => {
    await draw();
    const toggle = at(["children", 4]).querySelector('[part="toggle"]') as HTMLElement;
    expect(toggle.children).toHaveLength(0);
  });

  test("clicking the label is not a collapse", async () => {
    await draw();
    click(at(["children", 0]).querySelector('[part="label"]') as HTMLElement);
    await flush();
    expect(view._layersCollapsed!.size).toBe(0);
  });

  test("a right-click on a row selects it and opens the element menu", async () => {
    await draw();
    at(["children", 1]).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
    await flush(3);
    expect(activeTab.value!.session.selection).toEqual([["children", 1]]);
    expect(overflowItems().length).toBeGreaterThan(0);
  });
});

describe("the move verbs", () => {
  test("verbs are built only for the selected row", async () => {
    activeTab.value!.session.selection = [["children", 1]];
    await draw();
    expect(at(["children", 1]).querySelectorAll("jx-action-button").length).toBeGreaterThan(0);
    expect(at(["children", 0]).querySelectorAll("jx-action-button")).toHaveLength(0);
    expect(at(["children", 4]).querySelectorAll("jx-action-button")).toHaveLength(0);
  });

  test("first child cannot move up, last cannot move down — disabled, not removed", async () => {
    const first = await buttons(["children", 0]);
    expect(isRefusing(first, "selection.moveUp")).toBe(true);
    expect(isRefusing(first, "selection.moveDown")).toBe(false);
    // The refusal is the record's own sentence, printed once.
    expect(control(first["selection.moveUp"]!).getAttribute("title")).toBe(
      "Move Up — requires an element with a sibling above it",
    );
    const last = await buttons(["children", 4]);
    expect(isRefusing(last, "selection.moveDown")).toBe(true);
    expect(isRefusing(last, "selection.moveUp")).toBe(false);
  });

  test("move down reorders siblings", async () => {
    const acts = await buttons(["children", 0]);
    acts["selection.moveDown"]!.click();
    await flush();
    const children = activeTab.value!.doc.document.children as JxMutableNode[];
    expect(children[0]!.tagName).toBe("p");
    expect(children[1]!.tagName).toBe("section");
  });

  test("move up reorders siblings", async () => {
    const acts = await buttons(["children", 1]);
    acts["selection.moveUp"]!.click();
    await flush();
    const children = activeTab.value!.doc.document.children as JxMutableNode[];
    expect(children[0]!.tagName).toBe("p");
    expect(children[1]!.tagName).toBe("section");
  });

  test("move into previous sibling appends the node to that sibling's children", async () => {
    const acts = await buttons(["children", 1]);
    expect(isRefusing(acts, "selection.moveIn")).toBe(false);
    acts["selection.moveIn"]!.click();
    await flush();
    const children = activeTab.value!.doc.document.children as JxMutableNode[];
    expect(children.length).toBe(4);
    const sectionChildren = (children[0] as JxMutableNode).children as JxMutableNode[];
    expect(sectionChildren.length).toBe(3);
    expect(sectionChildren[2]!.textContent).toBe("First");
    expect(children.map((c) => c.textContent)).not.toContain("First");
  });

  test("move-in is unavailable when the previous sibling is not a container", async () => {
    // Children[2] (ul with $map children) follows children[1] (p with no children array)
    const acts = await buttons(["children", 2]);
    expect(isRefusing(acts, "selection.moveIn")).toBe(true);
  });

  test("move out of parent lifts the node after its parent", async () => {
    const acts = await buttons(["children", 0, "children", 0]);
    expect(isRefusing(acts, "selection.moveOut")).toBe(false);
    acts["selection.moveOut"]!.click();
    await flush();
    const children = activeTab.value!.doc.document.children as JxMutableNode[];
    expect(children[1]!.tagName).toBe("h2");
    expect(((children[0] as JxMutableNode).children as JxMutableNode[]).length).toBe(1);
  });

  test("the row's inline cluster is the four moves; Duplicate and Delete ride in ⋮", async () => {
    const acts = await buttons(["children", 1]);
    expect(Object.keys(acts)).toEqual([
      "selection.moveUp",
      "selection.moveDown",
      "selection.moveIn",
      "selection.moveOut",
    ]);
    expect(at(["children", 1]).querySelector('[part="overflow"]')).not.toBeNull();
  });

  test("delete removes the node, from the ⋮ menu", async () => {
    await buttons(["children", 1]);
    (at(["children", 1]).querySelector('[part="overflow"]') as HTMLElement).click();
    await flush(3);
    expect(overflowItems().map((el) => el.dataset.commandId)).toEqual([
      "selection.duplicate",
      "selection.delete",
    ]);
    overflowItems()[1]!.click();
    await flush(3);

    const children = activeTab.value!.doc.document.children as JxMutableNode[];
    expect(children.length).toBe(4);
    expect(children.map((c) => c.tagName)).not.toContain("p");
    // The menu closes behind the verb it ran.
    expect(overflowItems()).toHaveLength(0);
  });

  test("every draw takes down the drag registrations the last one made", async () => {
    const cleanup = mock(() => {});
    await draw();
    view.dndCleanups = [cleanup];
    await draw();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(view.dndCleanups).toEqual([]);
    expect(log.dnd).toBeGreaterThan(0);
  });
});

describe("inline rename", () => {
  test("a double-click opens the input; Enter and blur write $title", async () => {
    await draw();
    at(["children", 1]).dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
    );
    await flush(2);

    const input = at(["children", 1]).querySelector('[part="title-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    // The label is a `$switch` case, so it is GONE while the input stands — never hidden beside it.
    expect(at(["children", 1]).querySelector('[part="label"]')).toBeNull();
    expect(document.activeElement).toBe(input);

    input.value = "Hero paragraph";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur"));
    await flush(2);

    const node = (activeTab.value!.doc.document.children as JxMutableNode[])[1]!;
    expect(node.$title).toBe("Hero paragraph");
    expect(at(["children", 1]).querySelector('[part="title-input"]')).toBeNull();
    expect(textOf(at(["children", 1]), "label")).toBe("Hero paragraph");
  });

  test("an empty value clears $title, and the placeholder says what the row falls back to", async () => {
    const node = (activeTab.value!.doc.document.children as JxMutableNode[])[1]!;
    node.$title = "Old";
    await draw();
    startLayerTitleEdit(["children", 1], () => {});
    await flush(2);
    const input = at(["children", 1]).querySelector('[part="title-input"]') as HTMLInputElement;
    expect(input.value).toBe("Old");
    // What the row would say with no title of its own: its own text.
    expect(input.getAttribute("placeholder")).toBe("First");

    input.value = "   ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur"));
    await flush(2);
    expect(node.$title).toBeUndefined();
  });

  test("Escape cancels without mutating, and a late blur is a no-op", async () => {
    const rerender = mock(() => {});
    await draw();
    startLayerTitleEdit(["children", 1], rerender);
    await flush(2);
    const input = at(["children", 1]).querySelector('[part="title-input"]') as HTMLInputElement;
    input.value = "Should not stick";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
    await flush(2);

    const node = (activeTab.value!.doc.document.children as JxMutableNode[])[1]!;
    expect(node.$title).toBeUndefined();
    expect(rerender).toHaveBeenCalledTimes(1);
    expect(at(["children", 1]).querySelector('[part="title-input"]')).toBeNull();

    input.dispatchEvent(new Event("blur"));
    await flush(2);
    expect(node.$title).toBeUndefined();
  });

  test("a rename on a path with no row draws nothing rather than throwing", async () => {
    await draw();
    expect(() => {
      startLayerTitleEdit(["children", 99], () => {});
    }).not.toThrow();
    await flush(2);
    expect(host.querySelector('[part="title-input"]')).toBeNull();
  });

  test("a rename with no open document draws nothing rather than throwing", async () => {
    await draw();
    closeAllTabs();
    expect(() => {
      startLayerTitleEdit(["children", 1], () => {});
    }).not.toThrow();
    await flush(2);
    expect(host.querySelector('[part="title-input"]')).toBeNull();
  });

  test("the cluster stands aside while the row is being renamed", async () => {
    await buttons(["children", 1]);
    expect(at(["children", 1]).querySelectorAll("jx-action-button").length).toBeGreaterThan(0);
    startLayerTitleEdit(["children", 1], () => {});
    await flush(2);
    // The input owns the row's whole width; verbs on top of its right edge is what this prevents.
    expect(at(["children", 1]).querySelectorAll("jx-action-button")).toHaveLength(0);
  });
});

describe("keyed rows", () => {
  test("a structural move re-uses the row whose key did not change", async () => {
    // Mirrors the real bug: dragging a repeater into a sibling left `display:none` on the dragged
    // Subtree, which — under positional (unkeyed) reuse — leaked onto the sibling's own row.
    resetWorkspaceWithTab({
      children: [
        {
          $props: {},
          children: [
            {
              $prototype: "Array",
              items: { $ref: "#/state/things" },
              map: { tagName: "li", textContent: "item" },
            },
          ],
          tagName: "wrap",
        },
        { $props: {}, children: [{ tagName: "p", textContent: "keep me" }], tagName: "target" },
      ],
      tagName: "div",
    } as unknown as JxMutableNode);

    await draw();
    const stable = at(["children", 1, "children", 0]);
    // What a drag leaves behind on the row it was dragging.
    const template = at(["children", 0, "children", 0, "map"]);
    template.style.display = "none";

    const doc = activeTab.value!.doc.document as unknown as { children: { children: unknown[] }[] };
    const arr = doc.children[0]!.children.splice(0, 1)[0]!;
    doc.children[1]!.children.push(arr);
    await draw();

    const after = at(["children", 1, "children", 0]);
    expect(after).toBe(stable); // The same DOM node: its key never moved.
    expect(after.style.display).not.toBe("none");
    expect(textOf(after, "label")).toBe("keep me");
  });
});

describe("the empty state", () => {
  test("a page with nothing on it teaches what the Outline lists, and opens Insert", async () => {
    shell.leftTab = "layers";
    resetWorkspaceWithTab({ children: [], tagName: "div" } as JxMutableNode, {
      id: "empty-doc-tab",
    });
    // Content mode drops the root row, so the tree really is empty.
    activeTab.value!.doc.mode = "content";
    await draw();
    expect(treeItems(host)).toHaveLength(0);
    expect(host.querySelector('[part="empty-message"]')?.textContent).toBe(
      "This page is empty. Everything you add to it is listed here, in order.",
    );

    (host.querySelector('[part="empty-action"]') as HTMLElement).click();
    await flush();
    /* `"insert"` — and the second assertion is the one that matters.
       This test asserted `"blocks"` while its own title said "opens Insert", so it PASSED for three
       phases over an action that put the Navigator into "No Navigator panel is registered as
       blocks": P3.1 renamed the panel, migrated the persisted id, and left this live caller behind.
       Naming the id alone would only re-encode whatever the code does, so the id is also checked
       against the declared set — that is the assertion a rename cannot satisfy by accident. */
    expect(shell.leftTab).toBe("insert");
    expect([...NAVIGATOR_PANEL_IDS] as string[]).toContain(shell.leftTab);
  });
});

describe("the mounted surface", () => {
  test("a dispose while the mount is still in flight leaves nothing standing", async () => {
    /* The panel takes its own body down when the pane switches to Project Styles, and that can
       land in the same turn as the mount it is cancelling — the kit has to be defined before a
       document can render, so a first mount is genuinely asynchronous. Whichever half wins, the
       container must end up empty; a mount that settled after its handle was disposed would leave
       an Outline standing under whatever the Navigator painted next. */
    const content = host.querySelector(".panel-content") as HTMLElement;
    const handle = mountOutlineSurface(
      content,
      { emptyLabel: "", emptyMessage: "", padBottom: "", padTop: "", rows: [], view: "empty" },
      outlineActionSpies(),
    );
    handle.dispose();
    await handle.ready;
    await flush(3);
    expect(content.querySelector('[part="outline"]')).toBeNull();
    expect(handle.connected()).toBe(false);
    // And a second dispose is not a second teardown.
    expect(() => {
      handle.dispose();
    }).not.toThrow();
  });

  test("the Navigator painting a new box replaces the standing Outline rather than adding one", async () => {
    await draw();
    const first = host.querySelector('[part="outline"]');
    expect(first).not.toBeNull();

    // A panel switch and back gives the record a DIFFERENT content box; the surface standing in the
    // Old one is the one being replaced, and holding both would leave the first one's effects
    // Running against a scope nobody writes any more.
    const second = outlineHost();
    host = second;
    await draw();
    expect(second.querySelectorAll('[part="outline"]')).toHaveLength(1);
    expect(first!.isConnected).toBe(false);
  });

  test("a mount that outlives its container reports itself disconnected", async () => {
    const content = host.querySelector(".panel-content") as HTMLElement;
    const handle = mountOutlineSurface(
      content,
      { emptyLabel: "", emptyMessage: "", padBottom: "", padTop: "", rows: [], view: "empty" },
      outlineActionSpies(),
    );
    await handle.ready;
    expect(handle.connected()).toBe(true);
    // What the stylebook's own catalogue does to this box when it takes it over.
    content.replaceChildren();
    expect(handle.connected()).toBe(false);
    handle.dispose();
  });
});
