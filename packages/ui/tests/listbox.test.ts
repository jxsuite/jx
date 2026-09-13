/**
 * `jx-listbox` and `jx-option` — the shared popup of the combobox and the palette.
 *
 * The pair exists to close ONE duplication and to close it mechanically: three Studio palettes each
 * carried the same `aria-selected="${$map.index === state.activeIndex ? 'true' : 'false'}"` beside
 * the same `data-selected`, in three files, with nothing keeping the three in agreement. Here the
 * consumer writes ONE string — the listbox's `active`, which is the id its owning field already
 * points `aria-activedescendant` at — and the sidecar is the single writer of every row's flag, the
 * way `jx-tabs` is of every tab's.
 *
 * Two claims below are about what the element deliberately does NOT do, and both are load-bearing
 * rather than incidental. A `jx-listbox` has no tab stop and never calls `focus()`: one of its two
 * owners is a field that must keep the caret, and the other is nothing at all — Studio's slash menu
 * filters for a caret sitting in the canvas, often in another realm, so the panel must never take
 * DOM focus. And a `jx-option` is never legal inside a `<select>`; that is now a lint rather than
 * an absence, and `packages/schema/tests/a11y.test.ts` is where it is held.
 */
import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText } from "@jxsuite/runtime";
import { findA11yDefects } from "@jxsuite/schema/a11y";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";
import { mountListbox, optionsOf, syncListbox } from "../src/behaviors/listbox.ts";

/** Let the runtime's queued render and the sidecar's observer settle. */
const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type OptionEl = HTMLElement & {
  value: string;
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  face: string;
  swatch: string;
  line: string;
  weight: string;
  slant: string;
  variant: string;
  transform: string;
  decoration: string;
};
type ListboxEl = HTMLElement & { label: string; labelledby: string; active: string };

interface RowSpec {
  value: string;
  label?: string;
  description?: string;
  disabled?: boolean;
  face?: string;
  swatch?: string;
  line?: string;
  weight?: string;
  slant?: string;
  variant?: string;
  transform?: string;
  decoration?: string;
}

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

/** A listbox holding the given rows, rendered, with its sidecar settled. */
async function listbox(rows: RowSpec[], props: Record<string, unknown> = {}): Promise<ListboxEl> {
  const list = document.createElement("jx-listbox") as ListboxEl;
  list.setAttribute("id", "lb");
  Object.assign(list, { label: "Results", ...props });
  document.body.append(list);
  await tick();
  fill(list, rows);
  await tick();
  return list;
}

/** Replace a listbox's rows, the way a filter re-run does. */
function fill(list: HTMLElement, rows: RowSpec[]): OptionEl[] {
  const made = rows.map((row, index) => {
    const option = document.createElement("jx-option") as OptionEl;
    option.id = `lb-o${index}`;
    Object.assign(option, { label: row.value, ...row });
    return option;
  });
  list.replaceChildren(...made);
  return made;
}

const rowsOf = (list: Element) => [...list.querySelectorAll<OptionEl>("jx-option")];
const flags = (list: Element) => rowsOf(list).map((row) => row.getAttribute("aria-selected"));

/** Every emitted CSS rule scoped to this element's own document, in source order. */
function rules(el: Element): string[] {
  const scope = `[data-jx="${(el as HTMLElement).dataset["jx"]}"]`;
  return documentStyleText()
    .split("\n")
    .filter((line) => line.startsWith(scope) || line.includes(`{ ${scope}`));
}
/** The first emitted rule whose selector carries `selector`. */
const ruleFor = (el: Element, selector: string) =>
  rules(el).find((line) => line.slice(0, line.indexOf("{") + 1).includes(selector)) ?? "";

describe("jx-listbox", () => {
  test("is a named listbox that can never take focus", async () => {
    const list = await listbox([{ value: "a" }], { labelledby: "heading" });
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.getAttribute("aria-label")).toBe("Results");
    expect(list.getAttribute("aria-labelledby")).toBe("heading");
    /* No tab stop, on the element or in its definition. A listbox operated from a field it does not
       contain — or from a caret in another realm — is what aria-activedescendant is for, and a tab
       stop here would put the reader somewhere the keyboard contract does not live. */
    expect(list.hasAttribute("tabindex")).toBe(false);
    const written = Object.keys(documents["jx-listbox"]?.attributes ?? {});
    expect(written).not.toContain("tabindex");
    expect(written).not.toContain("aria-activedescendant");
  });

  test("names a row through one id, and moving that id moves the flag", async () => {
    const list = await listbox([{ value: "a" }, { value: "b" }, { value: "c" }]);
    expect(flags(list)).toEqual(["false", "false", "false"]);
    list.active = "lb-o1";
    await tick();
    expect(flags(list)).toEqual(["false", "true", "false"]);
    expect(list.dataset["active"]).toBe("lb-o1");
    /* The previously active row is cleared by the same write, so two rows can never both claim it. */
    list.active = "lb-o2";
    await tick();
    expect(flags(list)).toEqual(["false", "false", "true"]);
    list.active = "";
    await tick();
    expect(flags(list)).toEqual(["false", "false", "false"]);
  });

  test("re-asserts the flag when the ROWS change under it", async () => {
    /* The filter re-runs and the row carrying the active id is a DIFFERENT element. Nothing about
       `active` changed, so an implementation watching only the id would leave the list with no
       highlight at all — which is the failure this observer exists for. */
    const list = await listbox([{ value: "a" }, { value: "b" }]);
    list.active = "lb-o1";
    await tick();
    expect(flags(list)).toEqual(["false", "true"]);
    fill(list, [{ value: "x" }, { value: "y" }, { value: "z" }]);
    await tick();
    expect(flags(list)).toEqual(["false", "true", "false"]);
    expect(rowsOf(list)[1]!.value).toBe("y");
  });

  test("scrolls a newly active row into view, and leaves one that was already active alone", async () => {
    const list = await listbox([{ value: "a" }, { value: "b" }]);
    const calls: unknown[] = [];
    for (const row of rowsOf(list)) {
      row.scrollIntoView = (options?: unknown) => {
        calls.push([row.id, options]);
      };
    }
    expect(syncListbox(list, "lb-o1")?.id).toBe("lb-o1");
    expect(calls).toEqual([["lb-o1", { block: "nearest" }]]);
    /* `block: "nearest"` does nothing when the row is already visible, so a re-sync provoked by a
       pointer moving over the list must not scroll it under the pointer. */
    syncListbox(list, "lb-o1");
    expect(calls).toHaveLength(1);
    expect(syncListbox(list, "")).toBeNull();
  });

  test("owns its own rows and not a nested listbox's", async () => {
    const outer = await listbox([{ value: "a" }]);
    const inner = document.createElement("jx-listbox") as ListboxEl;
    inner.label = "Inner";
    outer.append(inner);
    await tick();
    fill(inner, [{ value: "deep" }]);
    await tick();
    expect(optionsOf(outer).map((row) => row.value)).toEqual(["a"]);
    expect(optionsOf(inner).map((row) => row.value)).toEqual(["deep"]);
    /* And the inner list's row is untouched by the outer list's id, even sharing one. */
    rowsOf(inner)[0]!.id = "lb-o0";
    syncListbox(outer, "lb-o0");
    expect(rowsOf(inner)[0]!.selected).toBe(false);
  });

  test("an element with no rows and a sidecar with no element are both quiet", async () => {
    const list = await listbox([]);
    expect(optionsOf(list)).toEqual([]);
    expect(() => {
      mountListbox({}, list);
    }).not.toThrow();
  });

  test("styles the two furniture parts a consumer writes", async () => {
    const list = await listbox([{ value: "a" }]);
    /* A grouped list is the consumer's own `role="group"` wrapper, and the heading inside it is a
       node the consumer writes carrying `part="group-heading"`. In a light DOM the container's own
       rule reaches it with no class, which is what a single cascade buys. */
    expect(ruleFor(list, '[part="group-heading"]')).toContain("text-transform: uppercase");
    expect(ruleFor(list, '[part="empty"]')).toContain("text-align: center");
    expect(ruleFor(list, "[hidden]")).toContain("display: none");
  });
});

describe("jx-option", () => {
  test("is an option with the row's words as its name", async () => {
    const list = await listbox([{ description: "openai", label: "GPT-4o", value: "gpt-4o" }]);
    const [row] = rowsOf(list);
    expect(row!.getAttribute("role")).toBe("option");
    expect(row!.querySelector('[part="label"]')?.textContent).toBe("GPT-4o");
    expect(row!.querySelector('[part="description"]')?.textContent).toBe("openai");
    /* The description is TEXT rather than a slot, so it is part of the row's name: a reader hears
       what a reader can see. There is no default slot at all, which is jx-tab's answer to the same
       question — unnamed content in a content-named row joins its name. */
    expect(JSON.stringify(documents["jx-option"])).not.toContain('"aria-label"');
  });

  test("draws the three preview channels, and pays no box for the ones it was not given", async () => {
    const list = await listbox([
      { face: '"Courier New", monospace', value: "mono" },
      { swatch: "var(--jx-danger)", value: "danger" },
      { line: "dashed", value: "dashed" },
    ]);
    const [face, swatch, line] = rowsOf(list);
    expect(face!.querySelector('[part="label"]')?.getAttribute("style")).toContain(
      '--jx-row-face: "Courier New", monospace',
    );
    expect(swatch!.querySelector('[part="swatch"]')?.hasAttribute("hidden")).toBe(false);
    expect(line!.querySelector('[part="line"]')?.getAttribute("style")).toContain(
      "--jx-row-line: dashed",
    );
    /* A row that is not about a colour draws no chip. `[hidden]` alone would not do it: the parts
       declare a display of their own and an author declaration beats the UA's `[hidden]` rule. */
    expect(face!.querySelector('[part="swatch"]')?.hasAttribute("hidden")).toBe(true);
    expect(face!.querySelector('[part="description"]')?.hasAttribute("hidden")).toBe(true);
    expect(ruleFor(face!, '[part="swatch"][hidden]')).toContain("display: none");
  });

  test("the five typographic channels set the label in the value the row offers", async () => {
    /* A weight row's `700` is set in 700 and an italic row's `Italic` leans: the row IS its own
       preview, which is what the Style tab's typography rows are made of. Each channel reaches the
       LABEL span as a custom property, as `face` does, so nine weights intern one rule — and the
       words are unchanged, so a reader hears the row's name and sees what choosing it would do. */
    const list = await listbox([
      { label: "Bold", value: "700", weight: "700" },
      { label: "Italic", slant: "italic", value: "italic" },
      { label: "Small caps", value: "small-caps", variant: "small-caps" },
      { label: "Uppercase", transform: "uppercase", value: "uppercase" },
      { decoration: "underline wavy", label: "Wavy", value: "underline wavy" },
      { label: "Plain", value: "plain" },
    ]);
    const [bold, italic, caps, upper, wavy, plain] = rowsOf(list);
    const styleOf = (row: HTMLElement | undefined) =>
      row!.querySelector('[part="label"]')?.getAttribute("style") ?? "";
    expect(styleOf(bold)).toContain("--jx-row-weight: 700");
    expect(styleOf(italic)).toContain("--jx-row-slant: italic");
    expect(styleOf(caps)).toContain("--jx-row-variant: small-caps");
    expect(styleOf(upper)).toContain("--jx-row-transform: uppercase");
    expect(styleOf(wavy)).toContain("--jx-row-decoration: underline wavy");
    /* A channel the row was not given falls back to the row's own, never to a value of its own. */
    expect(styleOf(plain)).toContain("--jx-row-weight: inherit");
    expect(styleOf(plain)).toContain("--jx-row-decoration: inherit");
    expect(upper!.querySelector('[part="label"]')?.textContent).toBe("Uppercase");
    const rule = ruleFor(bold!, '[part="label"]');
    expect(rule).toContain("font-weight: var(--jx-row-weight, inherit)");
    expect(rule).toContain("font-style: var(--jx-row-slant, inherit)");
    expect(rule).toContain("font-variant: var(--jx-row-variant, inherit)");
    expect(rule).toContain("text-transform: var(--jx-row-transform, inherit)");
    expect(rule).toContain("text-decoration: var(--jx-row-decoration, inherit)");
  });

  test("a click picks the row and a disabled row picks nothing", async () => {
    const list = await listbox([{ value: "a" }, { disabled: true, value: "b" }]);
    const heard: unknown[] = [];
    list.addEventListener("select", (event) => {
      heard.push((event as CustomEvent<unknown>).detail);
    });
    const [a, b] = rowsOf(list);
    a!.click();
    expect(heard).toEqual(["a"]);
    expect(b!.getAttribute("aria-disabled")).toBe("true");
    b!.click();
    expect(heard).toEqual(["a"]);
  });

  test("a press on a row keeps the caret where it was", async () => {
    /* A listbox row is not focusable, so the press would otherwise move focus to the nearest
       focusable ancestor — off the field that owns the keyboard, and out of the canvas the slash
       menu is filtering for. The same cancellation jx-textfield's clear button makes. */
    const list = await listbox([{ value: "a" }]);
    const press = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    rowsOf(list)[0]!.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  test("the highlight is keyed on aria-selected, so what is heard and what is seen are one", async () => {
    const list = await listbox([{ value: "a" }]);
    const [row] = rowsOf(list);
    expect(ruleFor(row!, '[aria-selected="true"]')).toContain("background: var(--jx-accent-solid)");
    /* And every muted channel takes the row's ink on the accent, because a grey on an accent fails
       SC 1.4.3. */
    expect(rules(row!).join("\n")).toContain('[aria-selected="true"]');
  });

  test("a row inside a listbox is clean under the accessibility lint", () => {
    expect(
      findA11yDefects({
        attributes: { "aria-label": "Results", role: "listbox" },
        children: [{ attributes: { label: "Alpha", value: "a" }, tagName: "jx-option" }],
        tagName: "div",
      } as never),
    ).toEqual([]);
  });
});
