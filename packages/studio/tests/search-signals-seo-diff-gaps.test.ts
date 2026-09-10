/**
 * Diff gaps across the jump bar, the State editor's rename field and the Search-appearance command.
 *
 * Three refusals and one no-op that nothing else exercised:
 *
 * - `attachJumpBarHost` handed the host it already has must keep the painted bar rather than tear it
 *   down and build it again — the pane grid re-runs its `ref()` on every cell repaint.
 * - The rename field's "you typed the name it already has" case, which has to CLEAR a standing
 *   refusal instead of reporting the entry as colliding with itself.
 * - `document.openSeo` over no document, which refuses by name rather than opening an empty modal.
 */
import { flush, installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import {
  clearSignalPanels,
  commitText,
  control,
  drawSignals,
  editorFor,
  openEntry,
  settle,
} from "./signals-panel-fixture";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PRIMARY_PANE, activeTab, closeAllTabs } from "../src/workspace/workspace";
import { attachJumpBarHost, renderJumpBar, unmountJumpBar } from "../src/panels/jump-bar";
import { seoCommands } from "../src/panels/seo-modal";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";
import type { JxMutableNode } from "@jxsuite/schema/types";

beforeEach(() => {
  clearSignalPanels();
  resetStudioState({ name: "My Site", projectRoot: "/p" });
  installMockPlatform();
});

afterEach(() => {
  unmountJumpBar();
  clearSignalPanels();
  closeAllTabs();
  setActiveRegistry(null);
});

// ─── The jump bar's host handover ─────────────────────────────────────────────

describe("attachJumpBarHost", () => {
  /**
   * A host inside a pane cell, which is where the grid puts it.
   *
   * The offset variable is written on the host's `.pane` ancestor when it has one, so a bar that is
   * taken away has to give its own cell's band back — not the root's, which the other pane is
   * reading.
   */
  function makeHost(id: string): HTMLElement {
    const pane = document.createElement("div");
    pane.className = "pane jb-pane";
    const el = document.createElement("div");
    el.id = id;
    pane.append(el);
    document.body.append(pane);
    return el;
  }

  function bandOf(el: HTMLElement): string {
    return el.closest<HTMLElement>(".pane")!.style.getPropertyValue("--jump-bar-h");
  }

  /* Parts, not classes: the bar is `src/surfaces/jump-bar.json` now, and a document emits none. */
  function crumbsIn(el: HTMLElement): (string | undefined)[] {
    return [...el.querySelectorAll('[part="crumb"]')].map((c) => c.textContent?.trim());
  }

  beforeEach(() => {
    resetWorkspaceWithTab({ children: [], tagName: "div" } as unknown as JxMutableNode, {
      documentPath: "/p/index.json",
    });
  });

  afterEach(() => {
    for (const el of document.querySelectorAll(".jb-pane")) {
      el.remove();
    }
  });

  test("handed the host it already has, it keeps the painted bar node for node", async () => {
    const host = makeHost("jb-host-a");
    attachJumpBarHost(PRIMARY_PANE, host);
    await flush(3);
    const painted = host.querySelector('nav[part="bar"]');
    expect(crumbsIn(host)).toEqual(["My Site", "index.json"]);

    attachJumpBarHost(PRIMARY_PANE, host);
    await flush(3);
    // The SAME element, not an equal one: the grid re-runs its `ref()` on every cell repaint, so a
    // Re-attach that blanked the host and painted it again would throw the bar's DOM away on every
    // Unrelated repaint of the pane.
    expect(host.querySelector('nav[part="bar"]')).toBe(painted);
    expect(crumbsIn(host)).toEqual(["My Site", "index.json"]);
    expect(bandOf(host)).toBe("24px");
  });

  test("handed a DIFFERENT host, it blanks the old one and paints the new", async () => {
    const first = makeHost("jb-host-a");
    const second = makeHost("jb-host-b");
    attachJumpBarHost(PRIMARY_PANE, first);
    await flush(3);
    expect(crumbsIn(first)).toEqual(["My Site", "index.json"]);

    attachJumpBarHost(PRIMARY_PANE, second);
    await flush(3);
    // The cell being disposed still holds this bar's DOM, and the lit part that owns it is about to
    // Be unreachable — so the handover blanks it and gives its band back.
    expect(first.querySelector('nav[part="bar"]')).toBeNull();
    expect(bandOf(first)).toBe("0px");
    expect(crumbsIn(second)).toEqual(["My Site", "index.json"]);
    expect(bandOf(second)).toBe("24px");
  });

  test("handed null, it detaches the pane and never paints it again", async () => {
    const host = makeHost("jb-host-a");
    attachJumpBarHost(PRIMARY_PANE, host);
    await flush(3);
    expect(crumbsIn(host)).toEqual(["My Site", "index.json"]);

    attachJumpBarHost(PRIMARY_PANE, null);
    expect(host.querySelector('nav[part="bar"]')).toBeNull();
    expect(bandOf(host)).toBe("0px");
    // Detached means forgotten: a later repaint has no host to find.
    renderJumpBar();
    expect(host.querySelector('nav[part="bar"]')).toBeNull();
  });
});

// ─── The Data panel's rename field ──────────────────────────────────────────

describe("the rename field's own name", () => {
  /**
   * Draw the Data panel over two entries and open the first one's editor.
   *
   * The panel is a document now, so the field is `[part="field"][data-prop="Name"]` and a commit is
   * an `input` plus a `change` on the control inside it — which is what leaving the field is.
   */
  async function openRename(): Promise<{ panel: HTMLElement; repaint: () => void }> {
    const drawn = await drawSignals({ $a: { default: 1 }, $b: { default: 2 } });
    await openEntry(drawn.panel, "$a");
    return { panel: drawn.panel, repaint: drawn.repaint };
  }

  /** The refusal under the Name field, if there is one. */
  function alertText(panel: HTMLElement): string | undefined {
    return editorFor(panel, "$a")
      .querySelector('[part="field"][data-prop="Name"] [role="alert"]')
      ?.textContent?.trim();
  }

  async function commitName(panel: HTMLElement, value: string): Promise<void> {
    await commitText(control(editorFor(panel, "$a"), "Name", "text"), value);
  }

  test("re-committing the same name (padded) is accepted, and clears a standing refusal", async () => {
    // The whitespace is what makes this a COMMIT at all — the field only fires when the string
    // Differs from the one it was rendered with. What the author typed still names this entry, so
    // The panel must neither rename anything nor report the entry as colliding with itself.
    const { panel, repaint } = await openRename();
    await commitName(panel, "$b");
    expect(alertText(panel)).toBe('"$b" is already defined by this document.');

    await commitName(panel, "  $a  ");
    // The accepted case commits nothing to the document, so the refusal is cleared in state and
    // The panel shows it on its next paint.
    repaint();
    await settle();
    expect(alertText(panel)).toBeUndefined();
    expect(
      editorFor(panel, "$a").querySelector('[part="field"][data-prop="Name"] [role="alert"]'),
    ).toBeNull();
  });

  test("it leaves the document exactly as it found it — no second entry, no reorder", async () => {
    const { panel, repaint } = await openRename();
    await commitName(panel, " $a ");
    const state = (activeTab.value?.doc.document.state ?? {}) as Record<string, unknown>;
    expect(Object.keys(state)).toEqual(["$a", "$b"]);
    expect(state.$a).toEqual({ default: 1 } as never);
    // And it is not refused either: an entry cannot collide with itself, which is what a fall
    // Through into the collision check would report.
    repaint();
    await settle();
    expect(alertText(panel)).toBeUndefined();
  });
});

// ─── document.openSeo over nothing ───────────────────────────────────────────

describe("document.openSeo with no document", () => {
  test("it refuses by name rather than opening a modal about nothing", () => {
    // The gate says a document is open; the run body does not take its word for it. Without the
    // Guard the modal opens over `null`, paints nothing into it, and reports success.
    const registry = createCommandRegistry({
      getContext: () => makeContext({ document: { open: true } }),
    });
    registry.register(seoCommands()[0]!);
    closeAllTabs();
    expect(() => registry.run("document.openSeo")).toThrow(
      'command "document.openSeo" needs an open document',
    );
    expect(document.querySelector('jx-dialog[part="seo"]')).toBeNull();
  });
});
