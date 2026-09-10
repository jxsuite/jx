/**
 * The Tag row's WRITE path — the two callbacks `src/panels/properties-panel.ts` hands the shared
 * Value Source slot for an element's `tagName`.
 *
 * `tests/properties-panel.test.ts` proves what the row DRAWS at each rung. What it never exercises
 * is the moment the rung changes: the position-specific `seedFor`, and the `onChange` that commits
 * whatever the slot produced.
 *
 * The seed is the whole point of the pair. The generic expression seed is `{ operator: "??" }`, and
 * a `TagExpression` is `?:` or `switch` and nothing else — so a generic seed would drop a document
 * that fails its own validator the instant the chip is clicked. These tests assert the shape that
 * actually lands, not merely that something did.
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import {
  bindContentHost,
  invalidatePageRouteCache,
  renderPropertiesPanel,
} from "../src/panels/properties-panel";
import { componentRegistry } from "../src/files/components";
import { resetSlotModeMemory } from "../src/ui/dynamic-slot";
import { activeTab } from "../src/workspace/workspace";
import type { JxMutableNode } from "@jxsuite/schema/types";

// ─── Local helpers (same shape as tests/properties-panel.test.ts) ─────────────

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  if (!document.querySelector(`#${id}`)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
}
initLayers();

let host: HTMLElement | null = null;

async function renderPanel(): Promise<HTMLElement> {
  if (!host) {
    host = document.createElement("div");
    document.body.append(host);
    bindContentHost(host);
  }
  renderPropertiesPanel();
  await flush(6);
  return host;
}

/** A `<x-card>` root holding one child element, with that child selected. */
function openWithChildTag(tagName: unknown) {
  const tab = resetWorkspaceWithTab({
    children: [{ children: [], tagName }],
    tagName: "x-card",
  } as unknown as JxMutableNode);
  tab.session.selection = [["children", 0]] as never;
  return tab;
}

function docNow(): JxMutableNode {
  return activeTab.value!.doc.document as JxMutableNode;
}

function selectedNode(): JxMutableNode {
  return (docNow().children as JxMutableNode[])[0]!;
}

const tagRow = (c: HTMLElement) => c.querySelector('[data-prop="tagName"]') as HTMLElement;

/** The rung the Tag row is currently at, in the ladder's own words. */
const rungLabel = (c: HTMLElement) =>
  tagRow(c).querySelector('[part="source"]')!.textContent!.trim();

/**
 * Pick a rung on the Tag row's Value Source picker — `elementTag` offers exactly these two.
 *
 * The rungs are a kit menu in the popover layer now, not an `sp-overlay` inside the row: the ladder
 * is one answer shared with every other bindable position (studio-ui-guidelines.md §6.3).
 */
async function chooseValueSource(c: HTMLElement, mode: "literal" | "expression"): Promise<void> {
  pointer(tagRow(c).querySelector('[part="source"] [part="control"]')!, "click");
  await flush(6);
  const menu = document.querySelector('[data-jx-region="overlay.menu:value-source"] jx-menu');
  if (!menu) {
    throw new Error("the value-source menu did not open for the Tag row");
  }
  menu.querySelector<HTMLElement>(`[data-command-id="${mode}"]`)!.click();
  await flush(4);
}

afterEach(() => {
  bindContentHost(null);
  host?.remove();
  host = null;
});

beforeEach(() => {
  componentRegistry.length = 0;
  invalidatePageRouteCache();
  resetSlotModeMemory();
  resetStudioState();
  installMockPlatform();
});

describe("the Tag row commits what the rung change produced", () => {
  test("choosing Formula seeds a valid TagExpression around the name it replaced", async () => {
    openWithChildTag("section");
    const c = await renderPanel();

    await chooseValueSource(c, "expression");

    /* `?:` with both arms holding the outgoing name — NOT the generic `{ operator: "??",
       target: null, value: null }`, which `TagExpression` does not admit. */
    expect(selectedNode().tagName).toEqual({
      $expression: { initial: "section", operator: "?:", target: null, value: "section" },
    } as never);
  });

  test("the write lands on the selected node, not on the document root", async () => {
    openWithChildTag("section");
    const c = await renderPanel();

    await chooseValueSource(c, "expression");

    expect(docNow().tagName).toBe("x-card");
  });

  test("the seeded formula reads back as Formula, and never as [object Object]", async () => {
    openWithChildTag("section");
    const c = await renderPanel();
    await chooseValueSource(c, "expression");

    await renderPanel();
    expect(rungLabel(c)).toBe("Formula");
    expect(tagRow(c).textContent).not.toContain("[object Object]");
  });

  test("dropping back to Fixed value writes the name the formula was seeded from", async () => {
    openWithChildTag("section");
    const c = await renderPanel();
    await chooseValueSource(c, "expression");
    expect(typeof selectedNode().tagName).toBe("object");

    await renderPanel();
    await chooseValueSource(c, "literal");

    expect(selectedNode().tagName).toBe("section");
  });

  test("a formula the user never seeded here clears the tag rather than seeding one", async () => {
    /* The seed is expression-only: de-escalating asks for a literal, gets `undefined`, and the
       property is removed — the row falls back to the default tag for the user to type over. A seed
       offered at this rung would write a `$expression` object while the chip says "Fixed value". */
    openWithChildTag({
      $expression: { initial: "div", operator: "?:", target: { $ref: "#/state/href" }, value: "a" },
    });
    const c = await renderPanel();
    expect(rungLabel(c)).toBe("Formula");

    await chooseValueSource(c, "literal");
    expect(selectedNode().tagName).toBeUndefined();

    await renderPanel();
    expect(rungLabel(c)).toBe("Fixed value");
  });
});
