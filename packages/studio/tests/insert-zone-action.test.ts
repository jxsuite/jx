/**
 * Tests for src/editor/insert-zone-action.ts — the cross-origin insertion "+" click handler.
 *
 * The module under test never touches `document`, and every heavy collaborator is mocked, so no DOM
 * harness is needed. The slash-menu mock captures the passed `opts` so the test can drive the inner
 * `onSelect` directly; the transact mock builds a fake transaction `t`, runs the mutation fn
 * against it, and exposes it so the test can assert the recorded selection + insert call.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { InsertZone } from "../src/canvas/iframe-protocol";
import type { SlashCommand } from "../src/editor/inline-edit";
import type { SlashMenuCallbacks } from "../src/editor/slash-menu";
import type { JxPath } from "../src/state";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** The one part of a Tab the handler's transaction writes: the session selection. */
interface FakeTab {
  session: { selection?: JxPath[] | null };
}

/** The reactive ref the handler reads its tab from. */
interface FakeActiveTab {
  value: FakeTab;
}

/** The arguments the handler hands `mutateInsertNode`, as recorded by its spy. */
interface InsertCall {
  def: JxMutableNode;
  index: number;
  parentPath: JxPath;
  t: FakeTab;
}

// Capture the opts passed to showSlashMenu so we can invoke its onSelect.
let capturedAnchor: HTMLElement | null = null;
let capturedOpts: SlashMenuCallbacks | null = null;
void mock.module("../src/editor/slash-menu", () => ({
  showSlashMenu: (anchorEl: HTMLElement, _filter: string, opts: SlashMenuCallbacks) => {
    capturedAnchor = anchorEl;
    capturedOpts = opts;
  },
}));

// The defaultDef mock returns a minimal def keyed by the tag so the test can assert it flowed through.
const defaultDefCalls: string[] = [];
void mock.module("../src/panels/shared", () => ({
  defaultDef: (tag: string) => {
    defaultDefCalls.push(tag);
    return { tagName: tag };
  },
}));

// The transactDoc mock builds a fake t and runs the mutation fn against it; mutateInsertNode is a spy.
let lastT: FakeTab | null = null;
let lastTab: FakeTab | null = null;
const insertCalls: InsertCall[] = [];
void mock.module("../src/tabs/transact", () => ({
  transactDoc: (tab: FakeTab, fn: (t: FakeTab) => void) => {
    lastTab = tab;
    const t: FakeTab = { session: { selection: null } };
    lastT = t;
    fn(t);
  },
  mutateInsertNode: (t: FakeTab, parentPath: JxPath, index: number, def: JxMutableNode) => {
    insertCalls.push({ def, index, parentPath, t });
  },
}));

// The component half of an insert (§5.7): an instance for a registered tag, and the import after.
const imported: string[] = [];
void mock.module("../src/editor/insert-component", () => ({
  componentInstance: (tag: string): JxMutableNode | null =>
    tag === "site-card" ? { $props: { heading: "Hi" }, tagName: tag } : null,
  importComponentInto: (_tab: FakeTab, tag: string) => {
    imported.push(tag);
  },
}));

// The activeTab mock is the reactive ref the handler reads.
const activeTab: FakeActiveTab = { value: { session: {} } };
void mock.module("../src/workspace/workspace", () => ({ activeTab }));

const { runInsertZoneAction } = await import("../src/editor/insert-zone-action");

/**
 * An anchor for the "+" button. `showSlashMenu` is mocked, so the handler only forwards this object
 * and the test compares it by identity; nothing reads it as an element.
 */
function anchorStub(): HTMLElement {
  /* SAFETY: the only consumer is the mocked showSlashMenu above, which stores the reference for
     an identity check and never touches an HTMLElement member (this file runs without a DOM). */
  return {} as HTMLElement;
}

const paragraph: SlashCommand = { description: "", label: "Paragraph", tag: "p" };

const zone: InsertZone = {
  edge: "top",
  index: 2,
  insertParentPath: ["children", 0],
  rect: { height: 0, width: 0, x: 0, y: 0 },
};

beforeEach(() => {
  capturedAnchor = null;
  capturedOpts = null;
  defaultDefCalls.length = 0;
  insertCalls.length = 0;
  lastT = null;
  lastTab = null;
  imported.length = 0;
});

describe("runInsertZoneAction", () => {
  test("opens the slash menu anchored to the button with showFilter:true", () => {
    const btn = anchorStub();
    runInsertZoneAction(btn, zone);

    expect(capturedAnchor).toBe(btn);
    expect(capturedOpts!.showFilter).toBe(true);
    expect(capturedOpts!.onSelect).toBeInstanceOf(Function);
  });

  test("onSelect inserts the chosen tag's def and selects the new node's path", () => {
    runInsertZoneAction(anchorStub(), zone);

    capturedOpts!.onSelect(paragraph);

    // The chosen tag was resolved through defaultDef.
    expect(defaultDefCalls).toEqual(["p"]);

    // The transaction ran against the active tab.
    expect(lastTab).toBe(activeTab.value);

    // The insert got (t, insertParentPath, index, def).
    expect(insertCalls.length).toBe(1);
    const call = insertCalls[0]!;
    expect(lastT).toBe(call.t);
    expect(call.parentPath).toEqual(zone.insertParentPath);
    expect(call.index).toBe(zone.index);
    expect(call.def).toEqual({ tagName: "p" });

    // The new node is selected at [...insertParentPath, "children", index].
    expect(lastT!.session.selection).toEqual([[...zone.insertParentPath, "children", zone.index]]);
    // An HTML element imports nothing.
    expect(imported).toEqual([]);
  });

  test("a Components pick inserts an instance and imports the component", () => {
    runInsertZoneAction(anchorStub(), zone);
    capturedOpts!.onSelect({
      component: true,
      description: "components/site-card.json",
      group: "Components",
      label: "<site-card>",
      tag: "site-card",
    });
    expect(defaultDefCalls).toEqual([]);
    expect(insertCalls[0]?.def).toEqual({ $props: { heading: "Hi" }, tagName: "site-card" });
    expect(imported).toEqual(["site-card"]);
  });

  test("a component the registry no longer knows inserts the element's default", () => {
    runInsertZoneAction(anchorStub(), zone);
    capturedOpts!.onSelect({ component: true, description: "", label: "x", tag: "gone-away" });
    expect(defaultDefCalls).toEqual(["gone-away"]);
    expect(imported).toEqual([]);
  });
});
