/**
 * `jx-combobox` — the composed half of the pair, and the APG's editable-combobox contract over a
 * list it reaches only through id references.
 *
 * Every keyboard claim below is driven with a real `KeyboardEvent` through the element's own input,
 * because the contract is about what the FIELD does with a key while the list has no focus at all —
 * which is the whole reason the element exists rather than being a `jx-select` with a text box.
 *
 * Four of these tests hold decisions rather than behaviour, and each names the thing a second
 * answer would break: the element filters nothing (`options` is what will be drawn); a keystroke
 * highlights nothing, so Enter commits what the reader typed until they arrow onto a row; Home and
 * End belong to the text caret; and a refused value is refused ON THE COMMIT with the control's own
 * `change` stopped, so one edit is one `change` rather than two.
 */
import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";
import {
  closeList,
  landingIndex,
  nextIndex,
  onComboboxCommit,
  onComboboxInput,
  openList,
  rowFor,
} from "../src/behaviors/combobox.ts";
import type { ComboboxRow } from "../src/behaviors/combobox.ts";

/** Let the runtime's queued render and the popover shim's toggle microtask settle. */
const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type ComboboxEl = HTMLElement & {
  value: string;
  options: ComboboxRow[];
  open: boolean;
  activeIndex: number;
  committed: string;
  label: string;
  allowsCustomValue: boolean;
  disabled: boolean;
  readonly: boolean;
};

const MODELS: ComboboxRow[] = [
  { description: "openai", label: "GPT-4o", value: "gpt-4o" },
  { disabled: true, label: "Retired", value: "davinci" },
  { label: "Claude", value: "claude" },
];

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

/** A rendered combobox with its id stem minted and its rows built. */
async function combobox(props: Partial<ComboboxEl> = {}): Promise<ComboboxEl> {
  const el = document.createElement("jx-combobox") as ComboboxEl;
  Object.assign(el, { label: "Model", options: MODELS }, props);
  document.body.append(el);
  await tick();
  return el;
}

const inputOf = (el: Element) => el.querySelector<HTMLInputElement>('input[part="input"]')!;
const rowsOf = (el: Element) => [...el.querySelectorAll<HTMLElement>("jx-option")];

/** Press a key on the field, the way a reader does, and hand back the event. */
function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init });
  inputOf(el).dispatchEvent(event);
  return event;
}

/** Type into the field, the way a reader does. */
function type(el: Element, text: string): void {
  inputOf(el).value = text;
  inputOf(el).dispatchEvent(new Event("input", { bubbles: true }));
}

/** Finish the edit, the way blur and Enter both do. */
function commit(el: Element): void {
  inputOf(el).dispatchEvent(new Event("change", { bubbles: true }));
}

/** Record every `input` and `change` that escapes the element, and who said it. */
function listen(el: HTMLElement): string[] {
  const heard: string[] = [];
  for (const name of ["input", "change"]) {
    el.addEventListener(name, (event) => {
      const from = event.target === el ? "element" : "control";
      heard.push(`${name}:${from}:${(event.target as HTMLInputElement).value}`);
    });
  }
  return heard;
}

describe("jx-combobox", () => {
  test("is an editable combobox pointing at a listbox it does not contain the keyboard for", async () => {
    const el = await combobox();
    const input = inputOf(el);
    const list = el.querySelector("jx-listbox")!;
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    /* Closed, and with nothing highlighted, there IS no active descendant — the APG is explicit
       that the attribute names a row rather than standing empty. */
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.getAttribute("aria-label")).toBe("Model");
  });

  test("ArrowDown opens the list, highlights the first row, and says which one", async () => {
    const el = await combobox();
    press(el, "ArrowDown");
    await tick();
    expect(el.open).toBe(true);
    expect(el.activeIndex).toBe(0);
    const input = inputOf(el);
    const [first] = rowsOf(el);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    /* One id, two readers: the field names it in aria-activedescendant and the listbox turns the
       same string into the row's own aria-selected. That is the duplication this pair closes. */
    expect(input.getAttribute("aria-activedescendant")).toBe(first!.id);
    expect(first!.getAttribute("aria-selected")).toBe("true");
  });

  test("the arrows wrap and step over a disabled row", async () => {
    const el = await combobox();
    press(el, "ArrowDown");
    await tick();
    press(el, "ArrowDown");
    expect(el.activeIndex).toBe(2);
    press(el, "ArrowDown");
    expect(el.activeIndex).toBe(0);
    press(el, "ArrowUp");
    expect(el.activeIndex).toBe(2);
  });

  test("ArrowUp on a closed list opens it at the LAST row", async () => {
    const el = await combobox();
    press(el, "ArrowUp");
    await tick();
    expect(el.open).toBe(true);
    expect(el.activeIndex).toBe(2);
  });

  test("Alt+ArrowDown opens without choosing, and Alt+ArrowUp closes", async () => {
    const el = await combobox();
    press(el, "ArrowDown", { altKey: true });
    await tick();
    expect(el.open).toBe(true);
    expect(el.activeIndex).toBe(-1);
    expect(inputOf(el).hasAttribute("aria-activedescendant")).toBe(false);
    /* Already open, Alt+ArrowDown is not a move either. */
    press(el, "ArrowDown", { altKey: true });
    expect(el.activeIndex).toBe(-1);
    press(el, "ArrowUp", { altKey: true });
    await tick();
    expect(el.open).toBe(false);
  });

  test("typing highlights NOTHING, so Enter commits what the reader typed", async () => {
    const el = await combobox({ allowsCustomValue: true });
    press(el, "ArrowDown");
    await tick();
    expect(el.activeIndex).toBe(0);
    type(el, "gpt");
    await tick();
    expect(el.value).toBe("gpt");
    expect(el.open).toBe(true);
    /* The caret is off every row again, so Enter is the platform's Enter: not cancelled, no row
       taken. Anything else would answer a different question from the one the reader asked. */
    expect(el.activeIndex).toBe(-1);
    const enter = press(el, "Enter");
    expect(enter.defaultPrevented).toBe(false);
    expect(el.value).toBe("gpt");
    /* But the list is closed by it: the reader has committed, and a list left standing over the
       fields below was what a browser pass found. */
    await tick();
    expect(el.open).toBe(false);
    /* And the commit itself closes the list, however it arrived. */
    type(el, "gpt-4");
    await tick();
    expect(el.open).toBe(true);
    commit(el);
    await tick();
    expect(el.open).toBe(false);
    expect(el.committed).toBe("gpt-4");
  });

  test("Enter on a highlighted row takes it, once", async () => {
    const el = await combobox();
    const heard = listen(el);
    press(el, "ArrowDown");
    await tick();
    press(el, "ArrowDown");
    const enter = press(el, "Enter");
    await tick();
    expect(enter.defaultPrevented).toBe(true);
    expect(el.value).toBe("claude");
    expect(el.open).toBe(false);
    expect(el.activeIndex).toBe(-1);
    expect(inputOf(el).value).toBe("claude");
    /* From the ELEMENT, so a host reading `e.target.value` reads the value that stands — and once
       each, because two changes for one gesture are two undo entries for one gesture. */
    expect(heard).toEqual(["input:element:claude", "change:element:claude"]);
  });

  test("Tab takes the highlighted row on the way out, and is never cancelled", async () => {
    const el = await combobox();
    press(el, "ArrowDown");
    await tick();
    const tab = press(el, "Tab");
    await tick();
    expect(tab.defaultPrevented).toBe(false);
    expect(el.value).toBe("gpt-4o");
    /* With nothing highlighted it is the platform's Tab and nothing else. */
    const plain = await combobox();
    const key = press(plain, "Tab");
    expect(key.defaultPrevented).toBe(false);
    expect(plain.value).toBe("");
    /* ...except that the list it leaves behind is closed. Typing opened it with nothing
       highlighted; a Tab out of the field must not leave it standing over the fields below, which
       light dismissal — a press OUTSIDE — would never have caught. */
    const typed = await combobox({ allowsCustomValue: true });
    type(typed, "gpt");
    await tick();
    expect(typed.open).toBe(true);
    const leave = press(typed, "Tab");
    await tick();
    expect(leave.defaultPrevented).toBe(false);
    expect(typed.open).toBe(false);
    expect(typed.value).toBe("gpt");
  });

  test("Escape closes the list and stops there", async () => {
    const el = await combobox();
    const outer = document.createElement("div");
    el.before(outer);
    outer.append(el);
    const escapes: string[] = [];
    outer.addEventListener("keydown", (event) => {
      escapes.push((event as KeyboardEvent).key);
    });
    press(el, "ArrowDown");
    await tick();
    const closed = press(el, "Escape");
    await tick();
    expect(el.open).toBe(false);
    expect(closed.defaultPrevented).toBe(true);
    /* A combobox inside a dialog must not close the dialog with the press that closed its list. */
    expect(escapes).toEqual(["ArrowDown"]);
    /* With the list already closed the key belongs to whatever is around the field. */
    const through = press(el, "Escape");
    expect(through.defaultPrevented).toBe(false);
    expect(escapes).toEqual(["ArrowDown", "Escape"]);
  });

  test("Home and End are left to the text caret", async () => {
    const el = await combobox();
    press(el, "ArrowDown");
    await tick();
    for (const key of ["Home", "End"]) {
      const event = press(el, key);
      expect(event.defaultPrevented, key).toBe(false);
    }
    expect(el.activeIndex).toBe(0);
  });

  test("a modified key is somebody else's", async () => {
    const el = await combobox();
    for (const init of [{ ctrlKey: true }, { metaKey: true }]) {
      const event = press(el, "ArrowDown", init);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(el.open).toBe(false);
  });

  test("clicking a row commits it", async () => {
    const el = await combobox();
    press(el, "ArrowDown");
    await tick();
    const heard = listen(el);
    rowsOf(el)[2]!.click();
    await tick();
    expect(el.value).toBe("claude");
    expect(el.open).toBe(false);
    expect(heard).toEqual(["input:element:claude", "change:element:claude"]);
    /* A row the element does not list cannot commit through the same door. */
    rowsOf(el)[0]!.dispatchEvent(
      new CustomEvent("select", { bubbles: true, detail: "not-a-model" }),
    );
    expect(el.value).toBe("claude");
  });

  test("the chevron opens and closes, and says nothing about expansion itself", async () => {
    const el = await combobox();
    const toggle = el.querySelector<HTMLButtonElement>('[part="toggle"]')!;
    expect(toggle.getAttribute("tabindex")).toBe("-1");
    expect(toggle.getAttribute("aria-label")).toBe("Show suggestions");
    /* The INPUT carries aria-expanded; a second control announcing it would be two answers. */
    expect(toggle.hasAttribute("aria-expanded")).toBe(false);
    toggle.click();
    await tick();
    expect(el.open).toBe(true);
    toggle.click();
    await tick();
    expect(el.open).toBe(false);
  });

  test("a list opened by a gesture lands on the row the field already holds", async () => {
    /* The catalogue case: the reader typed `claude`, the rows arrived after, and the chevron shows
       it as THEIR row rather than a list with nothing chosen. */
    const el = await combobox({ value: "claude" });
    el.querySelector<HTMLButtonElement>('[part="toggle"]')!.click();
    await tick();
    expect(el.open).toBe(true);
    expect(el.activeIndex).toBe(2);
    const claude = rowsOf(el)[2]!;
    expect(inputOf(el).getAttribute("aria-activedescendant")).toBe(claude.id);
    expect(claude.getAttribute("aria-selected")).toBe("true");
    /* Alt+ArrowDown is the chevron's keyboard, and the match is the row's own case-blind one. */
    const typed = await combobox({ value: "GPT-4O" });
    press(typed, "ArrowDown", { altKey: true });
    await tick();
    expect(typed.activeIndex).toBe(0);
    /* A value no row holds, and a row that could not be arrowed onto, are both nowhere. */
    const custom = await combobox({ allowsCustomValue: true, value: "made-up" });
    custom.querySelector<HTMLButtonElement>('[part="toggle"]')!.click();
    await tick();
    expect(custom.open).toBe(true);
    expect(custom.activeIndex).toBe(-1);
    const retired = await combobox({ value: "davinci" });
    retired.querySelector<HTMLButtonElement>('[part="toggle"]')!.click();
    await tick();
    expect(retired.activeIndex).toBe(-1);
    /* And a plain arrow still enters at an end, whatever the field holds (decision 2's cousin: the
       arrow is a MOVE, and the first move from a closed list is to the first row). */
    const arrowed = await combobox({ value: "claude" });
    press(arrowed, "ArrowDown");
    await tick();
    expect(arrowed.activeIndex).toBe(0);
  });

  test("an empty list is not shown, and the field is a text field until rows arrive", async () => {
    const el = await combobox({ allowsCustomValue: true, options: [] });
    expect(el.matches("[data-empty]")).toBe(true);
    /* Typing opens nothing, the arrows are the platform's own, and Escape reaches whatever is
       around the field — a dialog, say — rather than closing a panel nobody could see. */
    type(el, "my-model");
    await tick();
    expect(el.open).toBe(false);
    expect(inputOf(el).getAttribute("aria-expanded")).toBe("false");
    const down = press(el, "ArrowDown");
    const up = press(el, "ArrowUp");
    const escape = press(el, "Escape");
    await tick();
    expect(el.open).toBe(false);
    expect([down, up, escape].map((event) => event.defaultPrevented)).toEqual([
      false,
      false,
      false,
    ]);
    el.querySelector<HTMLButtonElement>('[part="toggle"]')!.click();
    await tick();
    expect(el.open).toBe(false);
    expect(el.value).toBe("my-model");
    /* Rows arriving change nothing about the value, and everything about the chevron. */
    el.options = MODELS;
    await tick();
    expect(el.matches("[data-empty]")).toBe(false);
    expect(el.value).toBe("my-model");
    expect(inputOf(el).value).toBe("my-model");
    type(el, "gpt");
    await tick();
    expect(el.open).toBe(true);
  });

  test("a closed list refuses a value no row holds, with ONE change and no revert loop", async () => {
    const el = await combobox();
    type(el, "gpt-4o");
    await tick();
    commit(el);
    await tick();
    expect(el.value).toBe("gpt-4o");
    expect(el.committed).toBe("gpt-4o");

    const heard = listen(el);
    type(el, "made-up");
    await tick();
    commit(el);
    await tick();
    expect(el.value).toBe("gpt-4o");
    /* The control's own change is stopped at the control and the element says one of its own, so a
       host hears exactly one committed edit and reads the value that actually stands. */
    expect(heard.filter((entry) => entry.startsWith("change"))).toEqual(["change:element:gpt-4o"]);
  });

  test("allows-custom-value keeps anything, and a listed value commits in the row's spelling", async () => {
    const free = await combobox({ allowsCustomValue: true });
    type(free, "my/own:model");
    await tick();
    commit(free);
    await tick();
    expect(free.value).toBe("my/own:model");
    expect(free.committed).toBe("my/own:model");

    const closed = await combobox();
    type(closed, "GPT-4O");
    await tick();
    commit(closed);
    await tick();
    /* The row is what the value means, so the casing is not the reader's to decide. */
    expect(closed.value).toBe("gpt-4o");
    /* And the empty string is emptying the field rather than a value no row holds. */
    type(closed, "");
    await tick();
    commit(closed);
    await tick();
    expect(closed.value).toBe("");
  });

  test("a change with no input before it commits the CONTROL's text, not the scope's", async () => {
    /* Every keystroke and every paste says `input` first, so the scope and the control agree by
       the time `change` arrives. A `change` on its own — an engine or a host that set the control
       and reported only the commit — is still the reader's text, and the element must not commit
       the value it last heard instead. */
    const free = await combobox({ allowsCustomValue: true });
    const heard = listen(free);
    inputOf(free).value = "full-width";
    commit(free);
    await tick();
    expect(free.value).toBe("full-width");
    expect(free.committed).toBe("full-width");
    expect(heard).toEqual(["change:control:full-width"]);

    /* And a closed list still refuses it, reading the same text. */
    const closed = await combobox();
    inputOf(closed).value = "GPT-4O";
    commit(closed);
    await tick();
    expect(closed.value).toBe("gpt-4o");
    inputOf(closed).value = "made-up";
    commit(closed);
    await tick();
    expect(closed.value).toBe("gpt-4o");
  });

  test("a disabled or read-only field never opens", async () => {
    for (const props of [{ disabled: true }, { readonly: true }]) {
      const el = await combobox(props);
      press(el, "ArrowDown");
      await tick();
      expect(el.open, JSON.stringify(props)).toBe(false);
      type(el, "gpt");
      await tick();
      expect(el.open, JSON.stringify(props)).toBe(false);
      el.querySelector<HTMLButtonElement>('[part="toggle"]')!.click();
      await tick();
      expect(el.open, JSON.stringify(props)).toBe(false);
    }
  });

  test("the element filters nothing: options is what will be drawn", async () => {
    const el = await combobox();
    type(el, "zzzz");
    await tick();
    /* Every row is still there. Matching belongs to the host, which re-answers `options` on the
       `input` event this element lets bubble — a ranker that knows about modes and recents, or a
       catalogue fetched from a provider, and never a second opinion built in here. */
    expect(rowsOf(el)).toHaveLength(3);
    el.options = [MODELS[0]!];
    await tick();
    expect(rowsOf(el).map((row) => row.getAttribute("value"))).toEqual(["gpt-4o"]);
  });

  test("the rows carry the preview channels and their own ids", async () => {
    const el = await combobox({
      options: [{ face: "Georgia, serif", label: "Georgia", swatch: "red", value: "georgia" }],
    });
    const [row] = rowsOf(el);
    expect(row!.id).toMatch(/^jx-combobox-\d+-o0$/);
    expect(row!.getAttribute("face")).toBe("Georgia, serif");
    expect(row!.getAttribute("swatch")).toBe("red");
    expect(row!.querySelector('[part="label"]')?.textContent).toBe("Georgia");
    /* A row with no label of its own draws its value, which is what a suggestion list is. */
    el.options = [{ value: "bare" }];
    await tick();
    expect(rowsOf(el)[0]?.querySelector('[part="label"]')?.textContent).toBe("bare");
  });

  test("a press in the panel's gutter keeps the caret in the field", async () => {
    const el = await combobox();
    const list = el.querySelector("jx-listbox")!;
    const gutter = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    list.dispatchEvent(gutter);
    expect(gutter.defaultPrevented).toBe(true);
  });

  test("the definition mints every id from one stem and writes none of them twice", () => {
    const doc = JSON.stringify(documents["jx-combobox"]);
    expect(doc).toContain("state.uid + '-list'");
    expect(doc).toContain("state.uid + '-panel'");
    expect(doc).toContain("state.uid + '-o'");
    /* `autocomplete` is off rather than absent: the UA's own dropdown over a listbox the element is
       already drawing is two panels answering one question. */
    expect(documents["jx-combobox"]?.state?.["autocomplete"]).toMatchObject({ default: "off" });
    /* The panel matches the FIELD's width, which is why the sidecar names the host as the source.
       A browser found the list at the popover's 180px floor under a 320px field: the attribute
       had never been asked for. happy-dom lays nothing out, so the definition is what is held. */
    const children = (documents["jx-combobox"]?.children ?? []) as {
      attributes?: Record<string, string>;
    }[];
    const popup = children.find((child) => child.attributes?.["part"] === "popup");
    expect(popup?.attributes?.["match-width"]).toBe("");
  });
});

describe("the two pure helpers", () => {
  test("nextIndex answers -1 for an empty list and for one nothing can land on", () => {
    expect(nextIndex([], -1, 1)).toBe(-1);
    expect(nextIndex([{ disabled: true, value: "a" }], -1, 1)).toBe(-1);
    expect(nextIndex([{ disabled: true, value: "a" }, { value: "b" }], -1, 1)).toBe(1);
    expect(nextIndex([{ value: "a" }, { value: "b" }], 1, 1)).toBe(0);
    expect(nextIndex([{ value: "a" }, { value: "b" }], 0, -1)).toBe(1);
  });

  test("landingIndex is the row the value names, and never a disabled one", () => {
    const rows: ComboboxRow[] = [
      { label: "Sonnet", value: "claude-sonnet" },
      { disabled: true, value: "davinci" },
    ];
    /* A label is what a row draws, so it is no more a landing than it is a commit. */
    expect(landingIndex({ options: rows, value: "Sonnet" })).toBe(-1);
    expect(landingIndex({ options: rows, value: "CLAUDE-SONNET" })).toBe(0);
    expect(landingIndex({ options: rows, value: "davinci" })).toBe(-1);
    expect(landingIndex({ options: rows, value: "" })).toBe(-1);
    expect(landingIndex({ value: "claude-sonnet" })).toBe(-1);
  });

  test("rowFor compares the VALUE and only the value", () => {
    const rows: ComboboxRow[] = [{ label: "Claude", value: "claude-3" }];
    expect(rowFor(rows, "CLAUDE-3")?.value).toBe("claude-3");
    /* A label is what a row DRAWS. Accepting it too would make two strings commit one row, and
       neither of them what is stored. */
    expect(rowFor(rows, "Claude")).toBeNull();
  });

  test("a handler reached from outside a combobox does nothing at all", () => {
    /* Every exported handler starts from `event.currentTarget.closest("jx-combobox")`, so one bound
       by mistake to a node that is not inside one has no element to write and must be silent rather
       than throw in the middle of a render. */
    const stray = document.createElement("div");
    const state: Record<string, unknown> = { value: "kept" };
    const event = new Event("change");
    Object.defineProperty(event, "currentTarget", { value: stray });
    expect(() => {
      onComboboxCommit(state, event);
      onComboboxInput(state, event);
    }).not.toThrow();
    expect(state["value"]).toBe("kept");
  });

  test("opening and closing a combobox that has no panel is quiet", () => {
    const bare = document.createElement("div");
    expect(() => {
      openList(bare);
      closeList(bare);
    }).not.toThrow();
  });
});
