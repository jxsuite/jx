/**
 * Project Settings as a dialog: `src/settings/settings-dialog.ts` (the flow) and
 * `src/surfaces/settings-dialog.{json,ts}` (the frame).
 *
 * What is pinned is the dialog contract of §17.1: a `jx-dialog` in the dialog layer carrying the
 * `overlay.dialog:settings` region on the box that has one, never stacked twice, dismissed by
 * Escape's `close` and by the Close button's `cancel`, with the keyboard on the current section's
 * row, and Moved buttons that leave for the named workspace through the command, after closing.
 */
import { flush, installMockPlatform, pointer, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeSettingsDialog, openSettingsDialog } from "../src/settings/settings-dialog";
import { openSettingsDialogSurface, SETTINGS_DIALOG_REGION } from "../src/surfaces/settings-dialog";
import { resetSettingsDocumentState, setSettingsSection } from "../src/settings/section-registry";
import { initLayers, layerHost } from "../src/ui/layers";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";
import { mountsOf } from "../src/services/surface-registry";
import { isString } from "@jxsuite/schema/guards";
import "../src/settings/settings-document";
import type { CommandArgValues } from "../src/commands/command-args";

/** Every settings dialog in the layer: the tests below assert there is never more than one. */
function dialogs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('#layer-dialog jx-dialog[part="settings"]')];
}

function dialog(): HTMLElement | null {
  return dialogs()[0] ?? null;
}

/** The section the focused row names, or `""` when the focus is not on a row. */
function focusedSection(): string {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.getAttribute("part") === "nav-item"
    ? (active.dataset["section"] ?? "")
    : "";
}

/** The `view.setWorkspace` calls a stub registry has received. */
let switched: string[];

/** Every command the stub registry ran after a workspace switch, in order, with its argument. */
let followed: string[];

/** Whether the stub's `view.setRightTab` is enabled: it is gated on an open document. */
let documentOpen: boolean;

beforeEach(() => {
  closeSettingsDialog();
  installMockPlatform();
  resetSettingsDocumentState();
  resetStudioState({ projectConfig: { name: "Field Notes" } });
  document.body.innerHTML = `
    <div id="layer-popover"></div><div id="layer-modal"></div><div id="layer-dialog"></div>
  `;
  initLayers();
  switched = [];
  followed = [];
  documentOpen = true;
  const registry = createCommandRegistry({ getContext: emptyContext });
  registry.registerAll([
    {
      args: {
        additionalProperties: false,
        properties: { workspace: { type: "string" } },
        required: ["workspace"],
        type: "object",
      },
      category: "View",
      id: "view.setWorkspace",
      level: "application",
      menus: ["palette"],
      run: (_ctx, args?: CommandArgValues) => {
        const target = args?.workspace;
        switched.push(isString(target) ? target : "");
      },
      title: "Show Workspace",
    },
    {
      args: {
        additionalProperties: false,
        properties: { view: { type: "string" } },
        required: [],
        type: "object",
      },
      category: "Project",
      id: "styles.open",
      level: "project",
      menus: ["palette"],
      run: (_ctx, args?: CommandArgValues) => {
        const view = args?.view;
        switched.push(`styles:${isString(view) ? view : ""}`);
      },
      title: "Open Project Styles",
    },
    {
      args: {
        additionalProperties: false,
        properties: { open: { type: "boolean" } },
        required: ["open"],
        type: "object",
      },
      category: "View",
      id: "view.setRightPanel",
      level: "application",
      menus: ["palette"],
      run: (_ctx, args?: CommandArgValues) => {
        followed.push(`dock:${String(args?.open)}`);
      },
      title: "Show Inspector Dock",
    },
    {
      args: {
        additionalProperties: false,
        properties: { tab: { type: "string" } },
        required: ["tab"],
        type: "object",
      },
      category: "View",
      id: "view.setRightTab",
      level: "document",
      menus: ["palette"],
      requires: "an open document",
      run: (_ctx, args?: CommandArgValues) => {
        followed.push(`tab:${String(args?.tab)}`);
      },
      title: "Show Inspector Tab",
      when: () => documentOpen,
    },
  ]);
  setActiveRegistry(registry);
});

afterEach(async () => {
  closeSettingsDialog();
  setActiveRegistry(null);
  await flush();
});

describe("opening", () => {
  test("opens one platform dialog in the dialog layer, with the editor inside it", async () => {
    await openSettingsDialog();
    await flush(2);
    const root = dialog()!;
    expect(root).not.toBeNull();
    expect(root.querySelector('[part="headline"]')?.textContent).toBe("Project settings");
    const box = root.querySelector<HTMLElement>('dialog[part="dialog"]')!;
    // The region is on the box that HAS one: `jx-dialog` is `display: contents`.
    expect(box.dataset["jxRegion"]).toBe(SETTINGS_DIALOG_REGION);
    expect(SETTINGS_DIALOG_REGION).toBe("overlay.dialog:settings");
    expect(box.querySelector('[part="doc"]')).not.toBeNull();
    expect(box.querySelectorAll('[part="group"]').length).toBe(3);
  });

  test("opening again while it is up does not stack a second dialog", async () => {
    await openSettingsDialog();
    await openSettingsDialog();
    await flush(2);
    expect(dialogs()).toHaveLength(1);
  });

  test("the keyboard lands on the current section's row, not on the first one", async () => {
    setSettingsSection("rawJson");
    await openSettingsDialog();
    await flush();
    expect(focusedSection()).toBe("rawJson");
  });

  test("a section requested while it is up moves the editor that is showing", async () => {
    await openSettingsDialog();
    await flush(2);
    setSettingsSection("locales");
    await flush(3);
    const selected = dialog()!.querySelector<HTMLElement>(
      '[part="nav-item"][aria-selected="true"]',
    );
    expect(selected?.dataset["section"]).toBe("locales");
  });
});

describe("closing", () => {
  test("Escape's `close` event closes it and takes the editor down", async () => {
    await openSettingsDialog();
    await flush(2);
    dialog()!.dispatchEvent(new Event("close", { bubbles: true }));
    await flush(2);
    expect(dialog()).toBeNull();
    expect(mountsOf("settings-pane")).toHaveLength(0);
  });

  test("the Close button's `cancel` closes it too", async () => {
    await openSettingsDialog();
    await flush(2);
    dialog()!.dispatchEvent(new Event("cancel", { bubbles: true }));
    await flush(2);
    expect(dialog()).toBeNull();
  });

  test("closing is idempotent, and closing before it has shown leaves nothing behind", async () => {
    const opening = openSettingsDialog();
    closeSettingsDialog();
    closeSettingsDialog();
    await opening;
    await flush(3);
    expect(dialog()).toBeNull();
    expect(layerHost("dialog").childElementCount).toBe(0);
  });

  test("it can be opened again after it was closed", async () => {
    await openSettingsDialog();
    closeSettingsDialog();
    await openSettingsDialog();
    await flush(2);
    expect(dialogs()).toHaveLength(1);
  });
});

describe("the Moved footnote", () => {
  test("the Colors and fonts row closes the dialog and opens the Styles workspace's Variables view", async () => {
    await openSettingsDialog();
    await flush(2);
    const link = dialog()!.querySelector<HTMLElement>(
      '[part="moved-row"][data-moved="styles"] [part="moved-link"]',
    )!;
    expect(link.textContent).toContain("Styles › Variables");
    pointer(link, "click");
    await flush(2);
    expect(dialog()).toBeNull();
    // `styles.open { view }` is the workspace switch followed by the view, in one record.
    expect(switched).toEqual(["styles:variables"]);
    expect(followed).toEqual([]);
  });

  test("the Page tab row switches to Design, then shows the Inspector on its Page tab", async () => {
    await openSettingsDialog();
    await flush(2);
    pointer(
      dialog()!.querySelector<HTMLElement>(
        '[part="moved-row"][data-moved="design"] [part="moved-link"]',
      )!,
      "click",
    );
    await flush(3);
    expect(dialog()).toBeNull();
    expect(switched).toEqual(["design"]);
    // AFTER the switch: entering a workspace applies its preset, which would undo an earlier ask.
    expect(followed).toEqual(["dock:true", "tab:page"]);
  });

  test("with no document open the Page tab row opens the dock and asks for no tab", async () => {
    documentOpen = false;
    await openSettingsDialog();
    await flush(2);
    pointer(
      dialog()!.querySelector<HTMLElement>(
        '[part="moved-row"][data-moved="design"] [part="moved-link"]',
      )!,
      "click",
    );
    await flush(3);
    expect(switched).toEqual(["design"]);
    expect(followed).toEqual(["dock:true"]);
  });

  test("a row naming no Inspector tab runs only the switch", async () => {
    await openSettingsDialog();
    await flush(2);
    pointer(
      dialog()!.querySelector<HTMLElement>(
        '[part="moved-row"][data-moved="publish"] [part="moved-link"]',
      )!,
      "click",
    );
    await flush(3);
    expect(switched).toEqual(["publish"]);
    expect(followed).toEqual([]);
  });

  test("with no registry it still closes, and nothing throws", async () => {
    setActiveRegistry(null);
    await openSettingsDialog();
    await flush(2);
    pointer(
      dialog()!.querySelector<HTMLElement>(
        '[part="moved-row"][data-moved="publish"] [part="moved-link"]',
      )!,
      "click",
    );
    await flush(2);
    expect(dialog()).toBeNull();
    expect(switched).toEqual([]);
  });
});

describe("the frame", () => {
  test("a close before the mount lands disposes the document it was building", async () => {
    let built = 0;
    let closed = 0;
    const handle = openSettingsDialogSurface({
      body: () => {
        built += 1;
      },
      closed: () => {
        closed += 1;
      },
      layer: layerHost("dialog"),
    });
    handle.close();
    handle.close();
    await handle.ready;
    await flush(2);
    expect(closed).toBe(1);
    expect(built).toBe(0);
    expect(mountsOf("settings-dialog")).toHaveLength(0);
    expect(handle.host.isConnected).toBe(false);
  });
});
