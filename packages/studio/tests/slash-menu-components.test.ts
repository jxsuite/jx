/**
 * The slash menu's and the canvas `+`'s Components group (specs/studio.md §5.7): the project's
 * components are offered under their own heading, and a pick inserts an instance and imports it —
 * from the canvas `+` (`editor/insert-zone-action.ts`) and from a "/" typed in a block
 * (`editor/inline-edit-apply.ts`, the host side of the iframe's insert).
 */
import {
  flush,
  installMockPlatform,
  mountOverlayLayers,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import { loadComponentRegistry } from "../src/files/components";
import { dismissSlashMenu, handleSlashMenuKey, showSlashMenu } from "../src/editor/slash-menu";
import { runInsertZoneAction } from "../src/editor/insert-zone-action";
import { applyInlineInsert } from "../src/editor/inline-edit-apply";
import { SITE_CARD } from "./shared-fixtures";
import type { SlashCommand } from "../src/editor/inline-edit";
import type { Tab } from "../src/tabs/tab";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { StudioPlatform } from "../src/types";

const CARD = SITE_CARD;

/** One child of the tab's root, by index. The fixtures here are plain arrays, never a `$map`. */
function childAt(tab: Tab, index: number): JxMutableNode | string | undefined {
  const { children } = tab.doc.document;
  return Array.isArray(children) ? children[index] : undefined;
}

const SITE_CARD_OFFER: SlashCommand = {
  component: true,
  description: "components/site-card.json",
  group: "Components",
  label: "<site-card>",
  tag: "site-card",
};

beforeAll(() => {
  mountOverlayLayers();
  initLayers();
});

beforeEach(async () => {
  resetStudioState();
  /* SAFETY: the registry keeps this answer as `ComponentEntry[]`, the shape every backend's
     discovery returns for a project component. */
  const discoverComponents = (async () => [CARD]) as StudioPlatform["discoverComponents"];
  installMockPlatform({ discoverComponents });
  await loadComponentRegistry();
});

afterEach(async () => {
  dismissSlashMenu();
  await flush();
});

/** Every offered row, in order. */
async function rows(): Promise<HTMLElement[]> {
  await flush(4);
  return [...document.querySelectorAll<HTMLElement>('#layer-popover [part="option"]')];
}

describe("the slash menu's Components group", () => {
  test("follows the HTML elements, under its own heading, with ids unique across groups", async () => {
    const anchor = document.createElement("p");
    document.body.append(anchor);
    showSlashMenu(anchor, "", { onSelect: () => {}, showFilter: true });
    const list = await rows();
    const ids = list.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(list.at(-1)?.getAttribute("value")).toBe("site-card");
    const groups = [...document.querySelectorAll('#layer-popover [part="group"]')];
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Elements",
      "Components",
    ]);
    expect(groups[1]?.querySelector('[part="group-heading"]')?.textContent).toBe("Components");
    // The unheaded first group draws no heading at all.
    expect(groups[0]?.querySelector('[part="group-heading"]')).toBeNull();
    anchor.remove();
  });

  test("the filter reaches components, and a pick hands back the component offer", async () => {
    const anchor = document.createElement("p");
    document.body.append(anchor);
    const picked: SlashCommand[] = [];
    showSlashMenu(anchor, "card", { onSelect: (cmd) => picked.push(cmd) });
    const offered = await rows();
    expect(offered.map((row) => row.getAttribute("value"))).toEqual(["site-card"]);
    handleSlashMenuKey("Enter");
    expect(picked).toEqual([SITE_CARD_OFFER]);
    anchor.remove();
  });
});

describe("the canvas + inserts an instance and imports it", () => {
  test("a Components pick", async () => {
    const tab = resetWorkspaceWithTab(
      { children: [{ tagName: "p", textContent: "x" }], tagName: "div" },
      { documentPath: "pages/index.json" },
    );
    const button = document.createElement("button");
    document.body.append(button);
    runInsertZoneAction(button, {
      edge: "bottom",
      index: 1,
      insertParentPath: [],
      rect: { height: 0, width: 0, x: 0, y: 0 },
    });
    await rows();
    handleSlashMenuKey("ArrowUp");
    handleSlashMenuKey("Enter");
    expect(childAt(tab, 1)).toEqual({
      $props: { heading: "Hi" },
      tagName: "site-card",
    });
    expect(tab.doc.document.$elements).toEqual([{ $ref: "../components/site-card.json" }]);
    expect(tab.session.selection).toEqual([["children", 1]]);
    button.remove();
  });
});

describe("a slash pick from a block inserts an instance and imports it", () => {
  test("an empty block is replaced by the instance", () => {
    const tab = resetWorkspaceWithTab(
      { children: [{ tagName: "p", textContent: "" }], tagName: "div" },
      { documentPath: "pages/index.json" },
    );
    const next = applyInlineInsert(tab, ["children", 0], SITE_CARD_OFFER, { textContent: "" });
    expect(next).toEqual(["children", 0]);
    expect(tab.doc.document.children).toEqual([
      { $props: { heading: "Hi" }, tagName: "site-card" },
    ]);
    expect(tab.doc.document.$elements).toEqual([{ $ref: "../components/site-card.json" }]);
  });

  test("a block with content keeps it and gets the instance after it", () => {
    const tab = resetWorkspaceWithTab(
      { children: [{ tagName: "p", textContent: "old" }], tagName: "div" },
      { documentPath: "pages/index.json" },
    );
    const next = applyInlineInsert(tab, ["children", 0], SITE_CARD_OFFER, { textContent: "Kept" });
    expect(next).toEqual(["children", 1]);
    expect(tab.doc.document.children).toEqual([
      { tagName: "p", textContent: "Kept" },
      { $props: { heading: "Hi" }, tagName: "site-card" },
    ]);
  });

  test("rich content is committed as children", () => {
    const tab = resetWorkspaceWithTab(
      { children: [{ tagName: "p", textContent: "old" }], tagName: "div" },
      { documentPath: "pages/index.json" },
    );
    const children = [{ tagName: "strong", textContent: "B" }];
    applyInlineInsert(tab, ["children", 0], SITE_CARD_OFFER, { children });
    expect(childAt(tab, 0)).toEqual({ children, tagName: "p" });
  });

  test("with no tab it computes the path and writes nothing", () => {
    expect(applyInlineInsert(null, ["children", 2], SITE_CARD_OFFER, { textContent: "a" })).toEqual(
      ["children", 3],
    );
  });

  test("a component tag the registry no longer knows falls back to the element path", () => {
    const tab = resetWorkspaceWithTab(
      { children: [{ tagName: "p", textContent: "" }], tagName: "div" },
      { documentPath: "pages/index.json" },
    );
    applyInlineInsert(
      tab,
      ["children", 0],
      { ...SITE_CARD_OFFER, tag: "gone-away" },
      { textContent: "" },
    );
    expect(childAt(tab, 0)).toMatchObject({ tagName: "gone-away" });
    expect(tab.doc.document.$elements).toBeUndefined();
  });
});
