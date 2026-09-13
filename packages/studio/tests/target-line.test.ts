/**
 * The Target Line — the Style tab's edit target as one sentence, and the one axis that tab owns.
 *
 * The line is a Jx document (`surfaces/target-line.json`), so nothing here names a class: a word of
 * the sentence is addressed by its `part` and its axis (`data-seg`), and the selector menu is the
 * kit's, addressed by `jx-menu-item`. What is asserted is the contract the line exists for — every
 * word is a control or an honest readout, the scope chip states the blast radius before the first
 * keystroke, and a count the app cannot make is "unknown" rather than a confident zero.
 */
import { flush } from "./harness";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import {
  BASE_SELECTOR_LABEL,
  attachTargetLine,
  openSelectorMenu,
  resetTargetLine,
  setTargetLine,
} from "../src/surfaces/target-line";
import type { TargetLineModel, TargetScope } from "../src/surfaces/target-line";

beforeAll(() => {
  for (const id of ["layer-popover", "layer-modal", "layer-dialog", "layer-toast"]) {
    const layer = document.createElement("div");
    layer.id = id;
    document.body.append(layer);
  }
  initLayers();
});

function model(over: Partial<TargetLineModel> = {}): TargetLineModel {
  return {
    scope: { kind: "element", label: "this element" },
    segments: [{ key: "element", label: "h1", title: "the element" }],
    selector: {
      declared: new Set<string>(),
      onAddCustom: () => {},
      onSelect: () => {},
      options: [":hover"],
      value: null,
    },
    ...over,
  };
}

/**
 * Render into a CONNECTED host — `openSelectorMenu` asks the button whether it is still live.
 *
 * A mounted document needs more turns than a lit render: the mount resolves, the keyed `$map`
 * reconciles, and the `$switch` inside each word settles after that.
 */
async function renderLine(m: TargetLineModel, connected = true): Promise<HTMLElement> {
  const host = document.createElement("div");
  if (connected) {
    document.body.append(host);
  }
  attachTargetLine(host);
  setTargetLine(m);
  await flush(3);
  return host;
}

/** Every row of the open selector menu, by the value it stands for. */
const menuRow = (value: string) =>
  document.querySelector<HTMLElement>(`#layer-popover jx-menu-item[data-command-id="${value}"]`);

afterEach(async () => {
  resetTargetLine();
  /* oxlint-disable-next-line unicorn/no-useless-undefined -- `attachTargetLine(host: Element |
     undefined)` requires the argument; this is the "no host" call, not a useless literal. */
  attachTargetLine(undefined);
  await flush();
  document.querySelector("#layer-popover")?.replaceChildren();
  for (const el of document.querySelectorAll("body > div:not([id^='layer-'])")) {
    el.remove();
  }
});

describe("segments", () => {
  test("a segment with no action is a span, not a button that does nothing", async () => {
    const c = await renderLine(model());
    const seg = c.querySelector('[data-seg="element"]')!;
    expect(seg.tagName.toLowerCase()).toBe("span");
    expect(seg.getAttribute("part")).toBe("segment");
    expect(seg.getAttribute("title")).toBe("the element");
  });

  test("a segment with an action is a button, and separators sit between segments", async () => {
    let opened = 0;
    const c = await renderLine(
      model({
        segments: [
          { key: "element", label: "h1", onActivate: () => (opened += 1), title: "one" },
          { key: "media", label: "@Md", title: "two" },
        ],
      }),
    );
    const seg = c.querySelector('[data-seg="element"]')!;
    expect(seg.tagName.toLowerCase()).toBe("button");
    seg.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(opened).toBe(1);
    // One separator before the second segment and one before the selector — never a leading one.
    expect(c.querySelectorAll('[part="separator"]').length).toBe(2);
  });

  test("the line is one addressable region, not a CSS selector the camera has to know", async () => {
    const c = await renderLine(model());
    expect(c.querySelector('[data-jx-region="inspector/target"]')).not.toBeNull();
  });
});

describe("the selector segment", () => {
  test("names the base rule when nothing is selected, and marks declared options", async () => {
    const c = await renderLine(
      model({
        selector: {
          declared: new Set([":hover"]),
          onAddCustom: () => {},
          onSelect: () => {},
          options: [":hover", ":focus"],
          value: null,
        },
      }),
    );
    expect(c.querySelector('[data-seg="selector"]')!.textContent).toContain(BASE_SELECTOR_LABEL);
    openSelectorMenu();
    await flush(3);
    // The ● the old menu drew, in the element's own vocabulary: the row states that this element
    // Already DECLARES the rule. Where you are is stated once, by the trigger's label.
    expect(menuRow(":hover")!.getAttribute("aria-checked")).toBe("true");
    expect(menuRow(":focus")!.getAttribute("aria-checked")).toBe("false");
  });

  test("choosing closes the menu and reports the choice; base reports null", async () => {
    const chosen: (string | null)[] = [];
    await renderLine(
      model({
        selector: {
          declared: new Set<string>(),
          onAddCustom: () => {},
          onSelect: (v) => chosen.push(v),
          options: [":hover"],
          value: ":hover",
        },
      }),
    );
    openSelectorMenu();
    await flush(3);
    expect(document.querySelector("#layer-popover jx-menu")).not.toBeNull();

    menuRow(":hover")!.click();
    await flush();
    expect(chosen).toEqual([":hover"]);
    expect(document.querySelector("#layer-popover jx-menu")).toBeNull();

    openSelectorMenu();
    await flush(3);
    menuRow("__base__")!.click();
    await flush();
    expect(chosen).toEqual([":hover", null]);
  });

  test("the trigger opens the same menu the command does", async () => {
    const c = await renderLine(model());
    (c.querySelector('[data-seg="selector"]') as HTMLElement).click();
    await flush(3);
    expect(menuRow("__base__")).not.toBeNull();
  });

  test("+ Add custom… hands off to the dialog owner and closes the menu", async () => {
    let asked = 0;
    await renderLine(
      model({
        selector: {
          declared: new Set<string>(),
          onAddCustom: () => (asked += 1),
          onSelect: () => {},
          options: [],
          value: null,
        },
      }),
    );
    openSelectorMenu();
    await flush(3);
    menuRow("__add_custom__")!.click();
    await flush();
    expect(asked).toBe(1);
    expect(document.querySelector("#layer-popover jx-menu")).toBeNull();
  });

  test("the command refuses when the line is not on screen", async () => {
    await renderLine(model(), false); // Detached host.
    expect(() => openSelectorMenu()).toThrow("selector menu is not in the document");
    resetTargetLine();
    expect(() => openSelectorMenu()).toThrow("needs the Inspector's Style tab rendered");
  });
});

describe("the scope chip", () => {
  test("element scope carries no warning band", async () => {
    const c = await renderLine(model());
    expect(c.querySelector('[part="scope"]')!.textContent!.trim()).toBe("this element");
    expect(c.querySelector('[part="scope"]')!.getAttribute("title")).toBe(
      "These edits apply to the selected element only",
    );
    expect(c.querySelector('[part="warning"]')).toBeNull();
  });

  test("document scope states the tag without warning", async () => {
    const scope: TargetScope = { kind: "document", label: "all <h1> in this document" };
    const c = await renderLine(model({ scope }));
    expect(c.querySelector('[part="scope"][data-scope="document"]')).not.toBeNull();
    expect(c.querySelector('[part="scope"]')!.getAttribute("title")).toBe(
      "These edits apply to all <h1> in this document",
    );
    expect(c.querySelector('[part="warning"]')).toBeNull();
  });

  test("project scope warns, counts, and lists the affected files on demand", async () => {
    let toggled = 0;
    const scope: TargetScope = {
      affected: "12 elements in 3 files",
      affectedFiles: [{ count: 7, path: "pages/index.json" }],
      kind: "project",
      label: "all <h1> in this project",
      onToggleAffected: () => (toggled += 1),
      showAffected: false,
    };
    const c = await renderLine(model({ scope }));
    expect(c.querySelector('[part="warning"]')!.getAttribute("role")).toBe("status");
    expect(c.querySelector('[part="warning-text"]')!.textContent).toContain(
      "12 elements in 3 files",
    );
    const action = c.querySelector('[part="warning-action"]')!;
    expect(action.textContent!.trim()).toBe("Show affected");
    expect(action.getAttribute("aria-expanded")).toBe("false");
    action.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggled).toBe(1);

    setTargetLine(model({ scope: { ...scope, showAffected: true } }));
    await flush(3);
    expect(c.querySelector('[part="warning-action"]')!.textContent!.trim()).toBe("Hide affected");
    expect(c.querySelector('[part="affected-path"]')!.textContent).toBe("pages/index.json");
    expect(c.querySelector('[part="affected-count"]')!.textContent).toBe("7");
  });

  test("no count and no list is 'unknown', never a confident zero", async () => {
    const c = await renderLine(
      model({
        scope: {
          kind: "project",
          label: "all <h1> in this project",
          showAffected: true,
        },
      }),
    );
    expect(c.querySelector('[part="warning-text"]')!.textContent).toContain("unknown");
    // No toggle handler → no action to press, and the disclosure explains its own emptiness.
    expect(c.querySelector('[part="warning-action"]')).toBeNull();
    expect(c.querySelector('[part="affected-empty"]')!.textContent).toContain(
      "could not be searched",
    );
  });
});
