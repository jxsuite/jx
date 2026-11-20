/**
 * Tests for src/settings/format-section.ts, src/surfaces/settings-format.{json,ts} and the flow in
 * src/format/convert-project-flow.ts: the default notation is one written key, the census and the
 * button follow what is on disk, a refused write is shown, and Convert asks (with the branch
 * warning in it) before it moves a file.
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
  topDialog,
} from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import { problems, resetNotifications, toasts } from "../src/services/notify";
import { setFormats } from "../src/format/format-host";
import { closeAllTabs, openTab, workspace } from "../src/workspace/workspace";
import { projectState } from "../src/store";
import { invalidateUsages } from "../src/services/references";
import { projectConfigPath, resetProjectConfigDocument } from "../src/tabs/project-config";
import { mountFormatSurface } from "../src/surfaces/settings-format";
import { renderFormatSection } from "../src/settings/format-section";
import { convertProject } from "../src/format/convert-project-flow";
import type { MockPlatformState } from "./harness";
import type { ProjectConfig } from "@jxsuite/schema/types";
import type { StudioPlatform } from "../src/types";

void mock.module("../src/services/jx-validate", () => ({
  validateDocOrNull: () => Promise.resolve([]),
}));

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  if (!document.querySelector(`#${id}`)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
}
initLayers();
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(0), 0);
  return 0;
};

const DOC = '{\n  "tagName": "div",\n  "children": [{ "tagName": "p", "textContent": "Hi" }]\n}\n';

const noop = (): void => {};

let state: MockPlatformState;

async function setup(
  cfg: ProjectConfig,
  files: Record<string, string>,
  overrides: Partial<StudioPlatform> = {},
): Promise<HTMLElement> {
  ({ state } = installMockPlatform(overrides, files));
  resetStudioState({ projectConfig: cfg });
  const container = document.createElement("div");
  document.body.append(container);
  renderFormatSection(container);
  await flush(8);
  return container;
}

function part(container: HTMLElement, name: string): HTMLElement | null {
  return container.querySelector(`[part="${name}"]`);
}

async function answerConfirm(confirmed: boolean): Promise<void> {
  for (let i = 0; i < 50 && !topDialog(); i += 1) {
    await flush();
  }
  topDialog()?.dispatchEvent(new Event(confirmed ? "confirm" : "cancel"));
  await flush(4);
}

beforeEach(() => {
  resetProjectConfigDocument();
  resetWorkspaceWithTab();
  resetNotifications();
  toasts.length = 0;
  invalidateUsages();
  closeAllTabs();
  setFormats([]);
});

afterEach(() => {
  resetProjectConfigDocument();
  document.querySelector("#layer-dialog")!.replaceChildren();
});

describe("the Document format section", () => {
  test("shows the census and offers the conversion to the chosen notation", async () => {
    const container = await setup(
      {},
      { "pages/a.json": DOC, "pages/b.json": DOC, "pages/c.jxn": "tagName div\n" },
    );
    expect(part(container, "summary")?.textContent).toBe(
      "2 documents are JSON and 1 is Jx Notation.",
    );
    expect(part(container, "convert")?.textContent).toContain("Convert 2 documents to Jx Notation");
  });

  test("offers nothing when every document is already in the chosen notation", async () => {
    const container = await setup({}, { "pages/c.jxn": "tagName div\n" });
    expect(part(container, "summary")?.textContent).toBe("All 1 documents are Jx Notation.");
    expect(part(container, "convert")).toBeNull();
  });

  test("choosing a default writes defaults.format and keeps the rest of defaults", async () => {
    const container = await setup({ defaults: { lang: "fr" } }, { "pages/a.json": DOC });
    const select = part(container, "default")!.querySelector("select")!;
    select.value = "json";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(8);
    expect(projectState?.projectConfig?.defaults).toEqual({ format: "json", lang: "fr" });
    const saved: ProjectConfig = JSON.parse(state.files.get(projectConfigPath())!);
    expect(saved.defaults?.format).toBe("json");
    // Nothing was converted by choosing.
    expect(state.files.has("pages/a.json")).toBe(true);
  });

  test("a refused write is shown above the row", async () => {
    const container = await setup(
      {},
      {},
      {
        writeFile: () => Promise.reject(new Error("EROFS")),
      },
    );
    const select = part(container, "default")!.querySelector("select")!;
    select.value = "json";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(8);
    expect(part(container, "section-error")?.textContent).toContain("Could not save project.json");
  });

  test("Convert asks, warns about unmerged branches, then converts and makes the target the default", async () => {
    const container = await setup(
      {},
      { "pages/a.json": DOC },
      {
        gitBranches: async () => ({
          branches: ["main", "feat"],
          current: "main",
          unmerged: ["feat"],
        }),
      },
    );
    pointer(part(container, "convert")!, "click");
    for (let i = 0; i < 50 && !topDialog(); i += 1) {
      await flush();
    }
    const text = topDialog()?.textContent ?? "";
    expect(text).toContain("1 other branch holds commits");
    expect(text).toContain("feat");
    await answerConfirm(true);
    await flush(8);
    expect(state.files.has("pages/a.jxn")).toBe(true);
    expect(state.files.has("pages/a.json")).toBe(false);
    expect(projectState?.projectConfig?.defaults?.format).toBe("jxn");
  });
});

describe("the surface and the section's redraw", () => {
  test("a standing section is updated, not remounted, and a disposed surface is not connected", async () => {
    const container = await setup({}, { "pages/a.json": DOC });
    const first = part(container, "default");
    renderFormatSection(container);
    await flush(4);
    expect(part(container, "default")).toBe(first);

    const host = document.createElement("div");
    document.body.append(host);
    const handle = mountFormatSurface(
      host,
      {
        canConvert: false,
        convertLabel: "",
        error: "",
        format: "jxn",
        formats: [{ label: "Jx Notation (.jxn)", value: "jxn" }],
        summary: "",
      },
      { convert: noop, setFormat: noop },
    );
    expect(handle.connected()).toBe(true);
    await flush(8);
    expect(handle.connected()).toBe(true);
    handle.update({ summary: "x", convertLabel: "y", canConvert: true, error: "e" });
    handle.dispose();
    expect(handle.connected()).toBe(false);
    handle.dispose();

    const early = mountFormatSurface(
      document.createElement("div"),
      { canConvert: false, convertLabel: "", error: "", format: "jxn", formats: [], summary: "" },
      { convert: noop, setFormat: noop },
    );
    early.dispose();
    await flush(8);
    expect(early.connected()).toBe(false);
  });
});

describe("convertProject", () => {
  test("a notation it does not know is refused, and nothing moves", async () => {
    await setup({}, { "pages/a.json": DOC });
    expect(await convertProject("yaml")).toBe(false);
    expect(problems.length + toasts.length).toBeGreaterThan(0);
  });

  test("the conversion still succeeds, and the failed default write is reported, when the project file cannot be written", async () => {
    await setup(
      {},
      { "pages/a.json": DOC },
      {
        writeFile: async (path: string) => {
          if (path === projectConfigPath()) {
            throw new Error("EROFS");
          }
        },
      },
    );
    const pending = convertProject("jxn");
    await answerConfirm(true);
    expect(await pending).toBe(true);
    expect([...problems, ...toasts].some((n) => n.message.includes("Could not save"))).toBe(true);
  });

  test("a failed rename is reported as a problem, leaves the default alone, and says how many", async () => {
    await setup(
      {},
      { "pages/a.json": DOC, "pages/b.json": DOC },
      {
        renameFile: async (from: string) => {
          if (from === "pages/a.json") {
            throw new Error("locked");
          }
          /* SAFETY: the converter reads only the optional `references` of a rename's report. */
          return {} as never;
        },
      },
    );
    const pending = convertProject("jxn");
    await answerConfirm(true);
    expect(await pending).toBe(true);
    expect(projectState?.projectConfig?.defaults?.format).toBeUndefined();
    expect(problems.at(-1)?.message).toContain("1 failed");
  });

  test("unsaved tabs stop the run before the dialog", async () => {
    await setup({}, { "pages/a.json": DOC });
    openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/a.json",
      id: "pages/a.json",
    });
    workspace.tabs.get("pages/a.json")!.doc.dirty = true;
    expect(await convertProject("jxn")).toBe(false);
    expect(topDialog()).toBeNull();
    expect(problems.at(-1)?.detail).toContain("pages/a.json");
  });

  test("every document skipped is said, not hidden", async () => {
    await setup({}, { "pages/a.json": DOC, "pages/a.jxn": "tagName div\n" });
    expect(await convertProject("jxn")).toBe(false);
    expect(toasts.at(-1)?.message).toContain("skipped");
  });

  test("declining moves nothing", async () => {
    await setup({}, { "pages/a.json": DOC });
    const pending = convertProject("jxn");
    await answerConfirm(false);
    expect(await pending).toBe(false);
    expect(state.files.has("pages/a.json")).toBe(true);
  });

  test("a project already in the notation says so without a dialog", async () => {
    await setup({}, { "pages/a.jxn": "tagName div\n" });
    expect(await convertProject("jxn")).toBe(false);
    expect(topDialog()).toBeNull();
  });
});
