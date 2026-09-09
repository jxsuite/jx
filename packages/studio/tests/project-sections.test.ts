/**
 * Tests for src/settings/project-sections.ts — the Deploy and Raw JSON sections — and the two
 * documents they mount, `src/surfaces/settings-deploy.{json,ts}` and
 * `src/surfaces/settings-rawjson.{json,ts}`.
 *
 * Both write through `updateSiteConfig`, so what is pinned here is the same contract the rest of
 * the settings tree keeps: the value lands in the live config AND in `project.json`, and a rejected
 * write is shown rather than dropped. Extensions moved to `extensions-section.test.ts` when it grew
 * a catalogue and an install path.
 *
 * Everything is addressed by `part`, because both sections are documents: there is no
 * `.settings-build-adapter`, `.settings-raw-json` or `.settings-field-error` to find any more, and
 * the picker's label and the sentence under it belong to `jx-field` now. A reader's choice is made
 * on the NATIVE `<select>` inside `jx-select` — writing the host's property instead would move a
 * control no reader can move. The mount is asynchronous, because the kit has to be defined before a
 * document can render, so every setup awaits it.
 *
 * **The section's own error is addressed through its slot**, and that is not fussiness: `jx-select`
 * draws a permanent `[part="error"]` region of its own, empty until it has something to say, so a
 * bare `[part="error"]` lookup finds an empty string wherever the section is quiet and never fails
 * the way a missing element would.
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { projectState } from "../src/store";
import { activeTab, openTab } from "../src/workspace/workspace";
import { toRaw } from "../src/reactivity";
import {
  PROJECT_CONFIG_PATH,
  resetProjectConfigDocument,
  serializeProjectConfig,
} from "../src/tabs/project-config";
import {
  BUILD_ADAPTERS,
  renderDeploySection,
  renderRawJsonSection,
} from "../src/settings/project-sections";
import { mountDeploySurface } from "../src/surfaces/settings-deploy";
import { mountRawJsonSurface } from "../src/surfaces/settings-rawjson";
import type { MockPlatformState } from "./harness";
import type { ProjectConfig } from "@jxsuite/schema/types";
import type { StudioPlatform } from "../src/types";

type AnyConfig = Record<string, any>;

/**
 * Draw a section into a fresh container and let its surface mount.
 *
 * The container is in the document because the surface is made of custom elements: a kit element in
 * a detached node is never connected, so its own template never runs.
 */
async function setup(
  cfg: AnyConfig | null,
  render: (container: HTMLElement) => void,
  overrides: Partial<StudioPlatform> = {},
  seed: Record<string, string> = {},
): Promise<{ container: HTMLElement; state: MockPlatformState }> {
  const { state } = installMockPlatform(overrides, seed);
  resetStudioState({ projectConfig: cfg as unknown });
  const container = document.createElement("div");
  document.body.append(container);
  render(container);
  await flush(4);
  return { container, state };
}

function config(): AnyConfig {
  return (projectState as AnyConfig).projectConfig;
}

function written(state: MockPlatformState): AnyConfig {
  return JSON.parse(state.files.get(PROJECT_CONFIG_PATH)!) as AnyConfig;
}

/** The whole-file write failure, said under the section title rather than beside the control. */
function errorText(container: HTMLElement): string | undefined {
  return container.querySelector('[part="error-slot"] > [part="error"]')?.textContent?.trim();
}

/** The adapter picker's native control, which is where a reader chooses. */
function picker(container: HTMLElement): HTMLSelectElement {
  return container.querySelector('[part="adapter"] select') as HTMLSelectElement;
}

/** Choose a platform the way the author does. */
async function choose(container: HTMLElement, value: string): Promise<void> {
  const select = picker(container);
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await flush(4);
}

/** A platform whose every write is refused. */
const failing = {
  writeFile: () => Promise.reject(new Error("EROFS: read-only file system")),
} as unknown as Partial<StudioPlatform>;

beforeEach(() => {
  resetProjectConfigDocument();
  resetWorkspaceWithTab();
});

afterEach(() => {
  resetProjectConfigDocument();
});

// ─── Deploy ──────────────────────────────────────────────────────────────────

describe("the Deploy section", () => {
  test("the adapter picker defaults to static and lists every adapter", async () => {
    const { container } = await setup({}, renderDeploySection);
    const options = [...picker(container).options].map((option) => option.value);
    expect(options).toEqual(BUILD_ADAPTERS.map((a) => a.value));
    expect(picker(container).value).toBe("static");
  });

  test("the row names the picker, so the label is the control's accessible name", async () => {
    const { container } = await setup({}, renderDeploySection);
    const labelledby = picker(container).getAttribute("aria-labelledby");
    expect(labelledby).toBeTruthy();
    expect(container.querySelector(`#${labelledby!}`)?.textContent).toBe("Platform Adapter");
  });

  test("changing it merges into build config and persists", async () => {
    const { container, state } = await setup({ build: { outDir: "dist" } }, renderDeploySection);
    await choose(container, "bun");
    expect(config().build).toEqual({ adapter: "bun", outDir: "dist" });
    expect(written(state).build.adapter).toBe("bun");
  });

  test("a rejected write is shown under the section title", async () => {
    const { container } = await setup(
      { build: { adapter: "static" } },
      renderDeploySection,
      failing,
    );
    await choose(container, "node");
    expect(errorText(container)).toContain("Could not save project.json");
    /* Between the title and the row: the whole file failed to save, not the one control, so the
       sentence is the section's rather than the field's. */
    const section = container.querySelector('[part="deploy"]')!;
    const order = [...section.children].map((el) => el.getAttribute("part"));
    expect(order.indexOf("error-slot")).toBeGreaterThan(order.indexOf("title"));
    expect(order.indexOf("error-slot")).toBeLessThan(order.indexOf("row"));
    expect(
      container.querySelector('[part="error-slot"] > [part="error"]')?.getAttribute("role"),
    ).toBe("alert");
  });

  test("a later success clears the error", async () => {
    const { container } = await setup({ build: {} }, renderDeploySection, failing);
    await choose(container, "node");
    expect(errorText(container)).toBeDefined();
    installMockPlatform();
    await choose(container, "bun");
    expect(errorText(container)).toBeUndefined();
  });

  test("a refused commit puts the picker back to the adapter the project still names", async () => {
    /* The echo, which is the job `live()` did in the template this replaced. The section writes
       what the picker now holds into the scope BEFORE it decides anything, so re-stating the old
       adapter afterwards is a real change the runtime pushes back into the control. Without it the
       scope never said anything but "static", re-stating it moves nothing, and the picker goes on
       claiming a platform the project does not use.

       The refusal that leaves the two disagreeing is the commit chokepoint's, not the disk's: a
       failed WRITE has already put the value into the live configuration, so the file is behind and
       the error line is what says so. `project.json` open with unsaved authoring of its own is the
       case where neither side is applied. */
    const onDisk = serializeProjectConfig({ build: { adapter: "static" } } as ProjectConfig);
    const { container } = await setup(
      { build: { adapter: "static" } },
      renderDeploySection,
      {},
      { [PROJECT_CONFIG_PATH]: onDisk },
    );
    const tab = openTab({
      document: JSON.parse(onDisk) as Record<string, unknown>,
      documentPath: PROJECT_CONFIG_PATH,
      id: PROJECT_CONFIG_PATH,
    });
    (toRaw(tab.doc.document) as unknown as AnyConfig).description = "typed in the source editor";
    tab.doc.dirty = true;

    await choose(container, "node");

    expect(config().build.adapter).toBe("static");
    expect(picker(container).value).toBe("static");
  });

  test("a redraw of a standing section keeps the same document mounted", async () => {
    const { container } = await setup({ build: { adapter: "bun" } }, renderDeploySection);
    const before = container.querySelector('[part="deploy"]');
    renderDeploySection(container);
    await flush(4);
    expect(container.querySelector('[part="deploy"]')).toBe(before!);
  });
});

// ─── Raw JSON ────────────────────────────────────────────────────────────────

describe("the Raw JSON section", () => {
  test("shows the file exactly as the chokepoint serialises it", async () => {
    const { container } = await setup({ extensions: [], name: "Bistro" }, renderRawJsonSection);
    expect(container.querySelector('[part="json"]')?.textContent).toBe(
      '{\n  "extensions": [],\n  "name": "Bistro"\n}',
    );
  });

  test("Edit as code switches the same tab to the Code editor", async () => {
    const { container } = await setup({ name: "Bistro" }, renderRawJsonSection);
    pointer(container.querySelector('[part="edit"]')!, "click");
    expect(activeTab.value?.session.ui.canvasMode).toBe("source");
  });

  test("with no project open it renders an empty object rather than throwing", async () => {
    const { container } = await setup(null, renderRawJsonSection);
    expect(container.querySelector('[part="json"]')?.textContent).toBe("{}");
  });

  test("a redraw re-reads the file into the standing document", async () => {
    const { container } = await setup({ name: "Bistro" }, renderRawJsonSection);
    const before = container.querySelector('[part="rawjson"]');
    (config() as AnyConfig).name = "Trattoria";
    renderRawJsonSection(container);
    await flush(2);
    expect(container.querySelector('[part="rawjson"]')).toBe(before!);
    expect(container.querySelector('[part="json"]')?.textContent).toContain("Trattoria");
  });
});

// ─── The two surfaces, as surfaces ───────────────────────────────────────────

/**
 * What each adapter promises the section beyond drawing: that a container it no longer holds is
 * given up, and that a mount still in flight when the section is torn down never lands.
 *
 * Both matter because a settings section is drawn into the pane's content area and the pane can
 * take that area away between one turn and the next — a nav click while the kit is still being
 * defined is the whole of it. A document that landed afterwards would appear underneath the section
 * the reader actually chose.
 */
describe("the surfaces themselves", () => {
  function host(): HTMLElement {
    installMockPlatform();
    resetStudioState({ projectConfig: {} as unknown });
    const container = document.createElement("div");
    document.body.append(container);
    return container;
  }

  test("a Deploy surface disposed before its mount settles never lands in its container", async () => {
    const container = host();
    const handle = mountDeploySurface(
      container,
      { adapter: "static", adapters: [{ label: "Static", value: "static" }], error: "" },
      { setAdapter: () => {} },
    );
    expect(handle.connected()).toBe(true);
    handle.dispose();
    // Idempotent: the section disposes on its own redraw path as well as at teardown.
    handle.dispose();
    await flush(4);
    expect(handle.connected()).toBe(false);
    expect(container.childNodes).toHaveLength(0);
  });

  test("a Raw JSON surface disposed before its mount settles never lands in its container", async () => {
    const container = host();
    const handle = mountRawJsonSurface(container, { json: "{}" }, { editAsCode: () => {} });
    expect(handle.connected()).toBe(true);
    handle.dispose();
    handle.dispose();
    await flush(4);
    expect(handle.connected()).toBe(false);
    expect(container.childNodes).toHaveLength(0);
  });

  test("a mounted surface gives up a container its document has left", async () => {
    const container = host();
    const handle = mountRawJsonSurface(container, { json: "{}" }, { editAsCode: () => {} });
    await flush(4);
    expect(handle.connected()).toBe(true);
    container.querySelector('[part="rawjson"]')!.remove();
    expect(handle.connected()).toBe(false);
    handle.dispose();
  });
});
