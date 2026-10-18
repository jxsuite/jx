/**
 * The Styles workspace's Variables view — `src/style/variables-view.ts` over
 * `src/surfaces/styles-variables.json`, hosting the CSS Variables editor.
 *
 * The view is the `tokens` editor of the `project.json` tab. The cases open that tab the way
 * `styles.open { view: "variables" }` does, draw the view into a stage the way the canvas does, and
 * read the document by `part`. The persistence cases are the ones the view's own sentence makes a
 * promise about: a variable is written as it is changed, and the write carries any element style
 * edit still waiting for Save, so the tab is clean afterwards.
 */
import { flush, installMockPlatform, resetStudioState, surfaceOf } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeAllTabs, workspace } from "../src/workspace/workspace";
import { showSettingsDocument } from "../src/settings/settings-document";
import {
  VARIABLES_SAVING,
  VARIABLES_TITLE,
  detachVariablesView,
  renderVariablesMode,
  variablesView,
  variablesViewMounted,
} from "../src/style/variables-view";
import { selectStylebookVariable } from "../src/panels/stylebook-layers-panel";
import { resetProjectConfigDocument } from "../src/tabs/project-config";
import { transactDoc } from "../src/tabs/transact";
import { createCommandRegistry } from "../src/commands/registry";
import { setActiveRegistry } from "../src/commands/active-registry";
import { EDITOR_KIND_LABELS, editorKindForMode, emptyContext } from "../src/commands/context";
import { mountVariablesSurface } from "../src/surfaces/styles-variables";
import { resetProjectShell, shell } from "../src/shell";
import { workspaceOfTab } from "../src/workspace/tab-workspace";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { CommandArgValues } from "../src/commands/command-args";
import type { MockPlatformState } from "./harness";
import type { Tab } from "../src/tabs/tab";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

/** A stage, in the document, the way a pane hands one to the mode that owns it. */
function stage(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

let state: MockPlatformState;

/** Open `project.json` in its Variables view, over a configuration with these styles. */
function openVariables(style: JsonObject, extra: JsonObject = {}): Tab {
  const projectConfig: JsonObject = { name: "Field Notes", style, ...extra };
  ({ state } = installMockPlatform({}, { "project.json": JSON.stringify(projectConfig, null, 2) }));
  resetStudioState({ projectConfig });
  const tab = showSettingsDocument("tokens");
  if (!tab) {
    throw new Error("no project.json tab");
  }
  return tab;
}

/** Draw the view into a fresh stage and let the editor's document land. */
async function draw(tab: Tab): Promise<HTMLElement> {
  const host = stage();
  renderVariablesMode(surfaceOf(host), tab);
  await flush(6);
  return host;
}

/** The token block for a custom property, by the property it names. */
function token(host: HTMLElement, name: string): HTMLElement {
  const found = [...host.querySelectorAll<HTMLElement>('[part="token"]')].find(
    (el) => el.dataset["token"] === name,
  );
  if (!found) {
    throw new Error(`no token row for ${name}`);
  }
  return found;
}

/** Commit a value into a kit text field's native input, the way a reader does. */
async function commit(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await flush(6);
}

/** The value field of one token row. */
function valueInput(host: HTMLElement, name: string): HTMLInputElement {
  const input = token(host, name).querySelector('[part="value"] [part="input"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError(`no value field for ${name}`);
  }
  return input;
}

/** The `style` block of the `project.json` the platform was last handed. */
function writtenStyle(): JsonObject {
  const text = state.files.get("project.json");
  if (text === undefined) {
    throw new Error("project.json was never written");
  }
  const config: JsonValue = JSON.parse(text);
  if (!isJsonObject(config) || !isJsonObject(config.style)) {
    throw new TypeError("project.json was written without a style object");
  }
  return config.style;
}

beforeEach(() => {
  resetProjectShell();
  resetProjectConfigDocument();
  closeAllTabs();
});

afterEach(() => {
  detachVariablesView("primary");
  setActiveRegistry(null);
  resetProjectConfigDocument();
  closeAllTabs();
  document.body.textContent = "";
});

describe("the view's place", () => {
  test("is the tokens editor of the project.json tab, named Variables, in the Styles workspace", () => {
    const tab = openVariables({ "--accent": "#2448c9" });
    expect(tab.session.ui.canvasMode).toBe("tokens");
    expect(editorKindForMode("tokens")).toBe("tokens");
    expect(EDITOR_KIND_LABELS.tokens).toBe("Variables");
    // The other two views of the same tab are named for what they edit.
    expect(EDITOR_KIND_LABELS[editorKindForMode("stylebook")]).toBe("Elements");
    expect(EDITOR_KIND_LABELS[editorKindForMode("source")]).toBe("Code");
    expect(workspaceOfTab(tab)).toBe("styles");
  });

  test("says what a variable is, when an edit is saved, and where schemes are declared", () => {
    const view = variablesView("primary");
    expect(view.region).toBe("pane.primary/variables");
    expect(view.title).toBe(VARIABLES_TITLE);
    expect(view.lede).toContain("CSS custom properties");
    expect(view.saving).toBe(VARIABLES_SAVING);
    expect(view.saving).toContain("as you make it");
    expect(view.saving).toContain("waiting for Save");
    expect(view.schemes).toContain("Contexts");
    expect(view.manageLabel).toBe("Manage contexts…");
    // An undo is the one change that waits for Save, and the copy names it as the exception
    // Rather than as a second rule that reads like a contradiction of the first.
    expect(view.saving).toContain("Undo is the exception");
    expect(view.schemes).toContain("Add override");
  });
});

describe("drawing the view", () => {
  test("frames the CSS Variables editor, which lists the project's custom properties", async () => {
    const tab = openVariables({ "--accent": "#2448c9", "--gap": "8px" });
    const host = await draw(tab);
    const view = host.querySelector<HTMLElement>('[part="variables-view"]');
    expect(view).not.toBeNull();
    expect(view!.dataset["jxRegion"]).toBe("pane.primary/variables");
    const heading = view!.querySelector('[part="title"]')!;
    expect(heading.textContent).toBe("Variables");
    // The heading names the region it heads.
    expect(view!.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(view!.querySelector('[part="saving"]')?.textContent).toBe(VARIABLES_SAVING);
    // The editor is the island, and it no longer draws a second heading of its own.
    const editor = view!.querySelector('[part="editor"] [part="cssvars"]');
    expect(editor).not.toBeNull();
    expect(editor!.querySelector("h2, h3:not([part='group-title'])")).toBeNull();
    expect(token(host, "--accent")).toBeTruthy();
    expect(token(host, "--gap")).toBeTruthy();
  });

  test("a repaint leaves the standing view alone, and a detach takes it down", async () => {
    const tab = openVariables({ "--accent": "#2448c9" });
    const host = await draw(tab);
    const view = host.querySelector('[part="variables-view"]');
    expect(variablesViewMounted("primary", tab)).toBe(true);
    renderVariablesMode(surfaceOf(host), tab);
    await flush(2);
    expect(host.querySelector('[part="variables-view"]')).toBe(view);
    detachVariablesView("primary");
    detachVariablesView("primary");
    await flush();
    expect(variablesViewMounted("primary", tab)).toBe(false);
    expect(host.querySelector('[part="variables-view"]')).toBeNull();
  });

  test("Manage contexts opens Project Settings on Contexts", async () => {
    const ran: { id: string; args: CommandArgValues | undefined }[] = [];
    const registry = createCommandRegistry({ getContext: emptyContext });
    registry.run = (id, args) => {
      ran.push({ args, id });
      return Promise.resolve();
    };
    setActiveRegistry(registry);
    const host = await draw(openVariables({ "--accent": "#2448c9" }));
    host.querySelector<HTMLElement>('[part="manage-contexts"]')!.click();
    await flush();
    expect(ran).toEqual([{ args: { section: "contexts" }, id: "settings.open" }]);
  });

  test("a mount disposed before it lands leaves nothing behind", async () => {
    const host = stage();
    const handle = mountVariablesSurface(
      host,
      variablesView("primary"),
      {
        manageContexts: () => {},
      },
      { editorSlot: () => {} },
    );
    expect(handle.attached()).toBe(true);
    handle.dispose();
    await handle.ready;
    await flush();
    expect(host.querySelector('[part="variables-view"]')).toBeNull();
    expect(handle.attached()).toBe(false);
  });
});

describe("following the document", () => {
  test("an edit that reaches the tab another way re-projects the editor", async () => {
    const tab = openVariables({ "--accent": "#2448c9" });
    const host = await draw(tab);
    transactDoc(tab, (t) => {
      const { style } = t.doc.document;
      if (isJsonObject(style)) {
        style["--radius"] = "6px";
      }
    });
    await flush(6);
    expect(token(host, "--radius")).toBeTruthy();
  });

  test("choosing a variable in the Outline points the editor at it", async () => {
    const tab = openVariables({ "--accent": "#2448c9", "--gap": "8px" });
    const host = await draw(tab);
    selectStylebookVariable("--gap");
    await flush(4);
    expect(token(host, "--gap").getAttribute("aria-current")).toBe("true");
    expect(token(host, "--accent").getAttribute("aria-current")).toBeNull();
    expect(shell.stylebook.variable).toBe("--gap");
  });

  test("arriving at the view marks the variable the Outline last chose", async () => {
    shell.stylebook.variable = "--accent";
    const host = await draw(openVariables({ "--accent": "#2448c9", "--gap": "8px" }));
    expect(token(host, "--accent").getAttribute("aria-current")).toBe("true");
  });
});

describe("saving is what the view says it is", () => {
  test("a variable is written as it is changed, and the tab is left clean", async () => {
    const tab = openVariables({ "--accent": "#2448c9" });
    const host = await draw(tab);
    await commit(valueInput(host, "--accent"), "#ff0000");
    expect(writtenStyle()["--accent"]).toBe("#ff0000");
    expect(tab.doc.dirty).toBe(false);
  });

  test("the write carries an element style edit that was waiting for Save", async () => {
    const tab = openVariables({ "--accent": "#2448c9" });
    const host = await draw(tab);
    // An Elements-view edit: a transaction on the tab, which only marks it dirty.
    transactDoc(tab, (t) => {
      const { style } = t.doc.document;
      if (isJsonObject(style)) {
        style["h1"] = { color: "var(--accent)" };
      }
    });
    expect(tab.doc.dirty).toBe(true);
    await flush(4);
    await commit(valueInput(host, "--accent"), "#00aa55");
    const written = writtenStyle();
    expect(written["--accent"]).toBe("#00aa55");
    expect(written["h1"]).toEqual({ color: "var(--accent)" });
    expect(tab.doc.dirty).toBe(false);
    expect(workspace.tabs.get("project.json")?.doc.dirty).toBe(false);
  });
});
