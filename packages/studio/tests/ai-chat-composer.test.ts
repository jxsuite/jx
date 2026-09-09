/**
 * Tests for src/panels/ai-chat/composer.ts — the chat input's STATE: the draft, the empty-send and
 * streaming guards, clear-after-send, the Send↔Stop projection, context-attach chips
 * (page/selection) and the model picker it mounts into the surface's slot.
 *
 * There is no markup in this module any more — `surfaces/ai-chat.json` draws the composer — so the
 * assertions read the projection the surface is handed. What a KEY does (Enter sends, Shift+Enter
 * opens a line) is a property of the document, and it is asserted against the mounted one in
 * `tests/ai-panel.test.ts`.
 *
 * The auto-grow tests went with the code: the textarea takes the height of its text through
 * `field-sizing: content`, so there is no `scrollHeight` write left to assert.
 */
import {
  clearSeededSettings,
  flush,
  installMockPlatform,
  mountOverlayLayers,
  pointer,
  resetWorkspaceWithTab,
  seedSettings,
  stubRect,
} from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createComposer } from "../src/panels/ai-chat/composer";
import { ATTACHED_CONTEXT_DELIMITER } from "../src/panels/ai-chat/attached-context";
import { resetModelCache } from "../src/services/ai-models";
import { clearLayerSlot, initLayers } from "../src/ui/layers";
import type { ComposerOptions } from "../src/panels/ai-chat/composer";

installMockPlatform();

/* Once, at module scope: `getLayerSlot` memoizes the slot it made, so rebuilding the layer hosts
   between tests would leave the menu mounting into a detached one. */
mountOverlayLayers();
initLayers();

// ─── Fetch stub (model listing) ──────────────────────────────────────────────

let fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async () =>
  Response.json({ models: [] }, { status: 200 });
(globalThis as Record<string, unknown>).fetch = (url: string, init?: RequestInit) =>
  fetchImpl(url, init);

// ─── Harness ─────────────────────────────────────────────────────────────────

/** Every host this file has attached, so one test's DOM never outlives it. */
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const node of hosts.splice(0)) {
    node.remove();
  }
  /* Hide, THEN clear. A menu left standing keeps a `toggle` listener whose `finish()` clears the
     slot BY REGION — so a stale one dismissed by the next test's `showPopover` would take that
     test's own menu down with it. In the app the attach button is a toggle and two attach menus
     never coexist, so this is a fixture's state rather than a defect's. */
  for (const el of document.querySelectorAll("#layer-popover jx-menu")) {
    (el as HTMLElement & { hidePopover?: () => void }).hidePopover?.();
  }
  clearLayerSlot("popover", "assistant-attach");
});

function makeComposer(extra: Partial<ComposerOptions> = {}) {
  /* ATTACHED, because the model picker is a mounted Jx document and a kit element renders its own
     template on connection: detached, the picker is a host with nothing in it. */
  const slot = document.createElement("div");
  document.body.append(slot);
  hosts.push(slot);
  const onSend = mock((_text: string) => {});
  let streaming = false;
  let renders = 0;
  const composer = createComposer({
    isStreaming: () => streaming,
    onSend,
    requestRender: () => {
      renders += 1;
    },
    ...extra,
  });
  composer.pickerSlot(slot);
  return {
    composer,
    onSend,
    renders: () => renders,
    setStreaming: (v: boolean) => {
      streaming = v;
    },
    slot,
    view: () => composer.view(),
  };
}

/** The kit menu the attach button opens, wherever the popover layer put it. */
function attachRows(): HTMLElement[] {
  return [...document.querySelectorAll("#layer-popover jx-menu-item")] as HTMLElement[];
}

beforeEach(() => {
  localStorage.clear();
  clearSeededSettings();
  resetModelCache();
  resetWorkspaceWithTab();
  fetchImpl = async () =>
    Response.json({ models: [{ id: "gpt-4o" }, { id: "o3", name: "o3 mini" }] }, { status: 200 });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("the draft", () => {
  test("sends what is typed and empties itself", () => {
    const c = makeComposer();
    c.composer.edit("build a hero section");
    expect(c.view().draft).toBe("build a hero section");
    c.composer.send();
    expect(c.onSend).toHaveBeenCalledWith("build a hero section");
    expect(c.view().draft).toBe("");
  });

  test("whitespace-only drafts never send, and the Send button says so first", () => {
    const c = makeComposer();
    expect(c.view().sendDisabled).toBe(true);
    c.composer.send();
    c.composer.edit("   \n ");
    expect(c.view().sendDisabled).toBe(true);
    c.composer.send();
    expect(c.onSend).not.toHaveBeenCalled();

    c.composer.edit("real text");
    expect(c.view().sendDisabled).toBe(false);
    c.composer.send();
    expect(c.onSend).toHaveBeenCalledWith("real text");
  });

  test("only the empty↔non-empty flip re-projects — typing must stay cheap", () => {
    const c = makeComposer();
    const before = c.renders();
    c.composer.edit("a");
    const afterFirst = c.renders();
    expect(afterFirst).toBe(before + 1);
    c.composer.edit("ab");
    c.composer.edit("abc");
    expect(c.renders()).toBe(afterFirst);
  });

  test("while streaming the send is refused and the button is Stop instead", () => {
    const c = makeComposer();
    c.setStreaming(true);
    c.composer.edit("typed ahead");
    c.composer.send();
    expect(c.onSend).not.toHaveBeenCalled();
    // The draft survives for when the stream finishes.
    expect(c.view().draft).toBe("typed ahead");
    expect(c.view().sendState).toBe("stop");

    c.setStreaming(false);
    expect(c.view().sendState).toBe("send");
  });

  test("a question turns the composer into the answer field, in words", () => {
    const c = makeComposer({ isAwaiting: () => true });
    expect(c.view().awaiting).toBe(true);
    expect(c.view().sendLabel).toBe("Answer");
    expect(c.view().placeholder).toContain("Answer the assistant");

    const plain = makeComposer();
    expect(plain.view().sendLabel).toBe("Send");
    expect(plain.view().placeholder).toContain("Ask the assistant");
  });
});

describe("context attach", () => {
  test("the menu offers the current page and the selected element, by name", async () => {
    const tab = resetWorkspaceWithTab(
      { children: [{ tagName: "h1", textContent: "Welcome to the site" }], tagName: "div" },
      { documentPath: "pages/index.json" },
    );
    tab.session.selection = [["children", 0]];
    const c = makeComposer();
    c.composer.openAttachMenu(null);
    await flush(5);
    const rows = attachRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("pages/index.json");
    expect(rows[1]!.textContent).toContain("<h1>");
    expect(rows[0]!.getAttribute("aria-disabled")).not.toBe("true");
    expect(rows[1]!.getAttribute("aria-disabled")).not.toBe("true");
  });

  test("a row with nothing behind it is refused rather than absent", async () => {
    const tab = resetWorkspaceWithTab();
    tab.documentPath = null;
    tab.session.selection = [];
    const c = makeComposer();
    c.composer.openAttachMenu(null);
    await flush(5);
    const rows = attachRows();
    expect(rows[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(rows[1]!.getAttribute("aria-disabled")).toBe("true");
  });

  test("attaching adds deduped chips and serializes into the sent message", async () => {
    const tab = resetWorkspaceWithTab(
      { children: [{ tagName: "h1", textContent: "Welcome" }], tagName: "div" },
      { documentPath: "pages/index.json" },
    );
    tab.session.selection = [["children", 0]];
    const c = makeComposer();
    c.composer.openAttachMenu(null);
    await flush(5);
    pointer(attachRows()[0]!, "click");
    await flush(3);
    c.composer.openAttachMenu(null);
    await flush(5);
    pointer(attachRows()[1]!, "click");
    await flush(3);
    // Re-attaching the page is still ONE page chip: one chip per kind.
    c.composer.openAttachMenu(null);
    await flush(5);
    pointer(attachRows()[0]!, "click");
    await flush(3);

    expect(c.view().composerChips.map((chip) => chip.key)).toEqual(["selection", "page"]);
    expect(c.view().hasComposerChips).toBe(true);

    c.composer.edit("make the heading bigger");
    c.composer.send();
    const sent = (c.onSend.mock.calls[0] as string[])[0]!;
    expect(sent).toContain("make the heading bigger");
    expect(sent).toContain(ATTACHED_CONTEXT_DELIMITER);
    expect(sent).toContain("Page: pages/index.json");
    expect(sent).toContain('Selected element at ["children",0]: <h1> "Welcome"');
    // Chips clear after sending.
    expect(c.view().composerChips).toHaveLength(0);
  });

  test("attachSelection is the same chip the menu builds, so the command cannot diverge", () => {
    const tab = resetWorkspaceWithTab(
      { children: [{ tagName: "h1", textContent: "Welcome" }], tagName: "div" },
      { documentPath: "pages/index.json" },
    );
    tab.session.selection = [["children", 0]];
    const c = makeComposer();
    expect(c.composer.attachSelection()).toBe(true);
    expect(c.view().composerChips).toHaveLength(1);
    expect(c.view().composerChips[0]!.label).toBe("<h1>");
    expect(c.view().composerChips[0]!.hint).toContain('Selected element at ["children",0]');
  });

  test("nothing selected — attachSelection refuses so a caller can say why", () => {
    const tab = resetWorkspaceWithTab();
    tab.session.selection = [];
    const c = makeComposer();
    expect(c.composer.attachSelection()).toBe(false);
    expect(c.view().composerChips).toHaveLength(0);
  });

  test("chips can be dropped before sending", () => {
    resetWorkspaceWithTab(undefined, { documentPath: "pages/about.json" });
    const c = makeComposer();
    c.composer.attachSelection();
    const tab = resetWorkspaceWithTab(
      { children: [{ tagName: "h1", textContent: "Welcome" }], tagName: "div" },
      { documentPath: "pages/about.json" },
    );
    tab.session.selection = [["children", 0]];
    c.composer.attachSelection();
    expect(c.view().composerChips).toHaveLength(1);

    c.composer.dropChip("selection");
    expect(c.view().composerChips).toHaveLength(0);

    c.composer.edit("no context here");
    c.composer.send();
    expect(c.onSend).toHaveBeenCalledWith("no context here");
  });

  test("the menu hangs off the button that opened it", async () => {
    /* The anchor is the attach button, and the panel's top edge goes just above it — a menu that
       opened at the origin would sit in the corner of the window rather than under the control. */
    resetWorkspaceWithTab(undefined, { documentPath: "pages/about.json" });
    const c = makeComposer();
    const anchor = document.createElement("button");
    document.body.append(anchor);
    hosts.push(anchor);
    stubRect(anchor, { height: 24, left: 120, top: 400, width: 24 });
    c.composer.openAttachMenu(anchor);
    await flush(5);
    const panel = document.querySelector("#layer-popover jx-menu") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.getPropertyValue("--jx-r0-0") || panel.getAttribute("style")).toContain(
      "px",
    );
    expect(attachRows()).toHaveLength(2);
  });

  test("a second press closes the menu instead of opening a second one", async () => {
    resetWorkspaceWithTab(undefined, { documentPath: "pages/about.json" });
    const c = makeComposer();
    c.composer.openAttachMenu(null);
    await flush(5);
    expect(attachRows()).toHaveLength(2);
    c.composer.openAttachMenu(null);
    await flush(5);
    expect(attachRows()).toHaveLength(0);
  });
});

describe("model picker", () => {
  /* One case, not five. The picker itself is `ui/ai-model-picker.ts` and is covered by
     `ai-model-picker.test.ts`; what belongs HERE is that the composer mounts one into the slot the
     surface gives it, and wires its own scheduler to it. */
  test("mounts a picker into the surface's slot, wired to the composer's own scheduler", async () => {
    const c = makeComposer();
    /* The picker is a mounted Jx document, so it is addressed by `part` and it is not there on the
       turn the composer is created. */
    await flush(6);
    expect(c.slot.querySelector('[part="model-picker"]')).not.toBeNull();
    // The fetch settles through requestRender, so the list appears without an explicit re-project.
    c.composer.view();
    await flush();
    expect(c.slot.textContent).toContain("o3 mini");
  });

  test("warns under the picker when the chosen model can't call tools", async () => {
    /* The agent loop a chat-only model silently disables is the whole reason the panel exists, and
       nothing else on screen would have mentioned it. */
    fetchImpl = async () =>
      Response.json({ models: [{ id: "@cf/tiny/chat", toolSupport: false }] }, { status: 200 });
    seedSettings({ "jx.ai.model": "@cf/tiny/chat" });
    const c = makeComposer();
    expect(c.view().noteState).toBe("hidden"); // Nothing known yet.

    await flush(3);
    const view = c.view();
    expect(view.noteState).toBe("shown");
    expect(view.note).toContain("can't use editing tools");
    // Advisory, not a gate: the composer still sends.
    c.composer.edit("explain this page");
    c.composer.send();
    expect(c.onSend).toHaveBeenCalledWith("explain this page");
  });

  test("no warning for a model that supports tools, nor for one the backend said nothing about", async () => {
    fetchImpl = async () =>
      Response.json(
        { models: [{ id: "@cf/meta/llama-4", toolSupport: true }, { id: "gpt-4o" }] },
        { status: 200 },
      );
    seedSettings({ "jx.ai.model": "@cf/meta/llama-4" });
    const withTools = makeComposer();
    await flush(3);
    expect(withTools.view().noteState).toBe("hidden");

    clearSeededSettings();
    seedSettings({ "jx.ai.model": "gpt-4o" });
    const silent = makeComposer();
    await flush(3);
    expect(silent.view().noteState).toBe("hidden");
  });
});
