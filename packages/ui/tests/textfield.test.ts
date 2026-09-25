import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { documentStyleText } from "@jxsuite/runtime";
import { documents } from "../src/documents.ts";
import { iconPath } from "../src/icons.ts";
import { registerUi } from "../src/index.ts";
import { clearField, focusField, mintFieldId, selectValue } from "../src/behaviors/textfield.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxTextfield = HTMLElement & {
  value: string;
  invalid: boolean;
  error: string;
  multiline: boolean;
  clearable: boolean;
  grows: boolean;
};

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

async function field(attrs: Record<string, string> = {}): Promise<JxTextfield> {
  const el = document.createElement("jx-textfield") as JxTextfield;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  document.body.append(el);
  await tick();
  return el;
}
const control = (el: Element) =>
  el.querySelector<HTMLInputElement | HTMLTextAreaElement>('[part="input"]')!;

/** Press a key on the field's own control, and hand back the event so its default can be read. */
function press(el: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
  control(el).dispatchEvent(event);
  return event;
}
const escape = (el: Element) => press(el, "Escape");
const enter = (el: Element) => press(el, "Enter");

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

/** Record which element an event came from, not merely that one arrived. */
function record(el: Element, heard: string[]): void {
  for (const name of ["input", "change"]) {
    el.addEventListener(name, (e) => heard.push(`${name}:${(e.target as Element).localName}`));
  }
}

describe("jx-textfield", () => {
  test("is a named native input whose value the host and the reader both write", async () => {
    const el = await field({ label: "Layout name", placeholder: "Untitled", value: "Draft" });
    expect(control(el).tagName).toBe("INPUT");
    expect(control(el).getAttribute("aria-label")).toBe("Layout name");
    expect(control(el).placeholder).toBe("Untitled");
    expect(control(el).value).toBe("Draft");

    const heard: string[] = [];
    el.addEventListener("input", () => heard.push(el.value));
    control(el).value = "Final";
    control(el).dispatchEvent(new Event("input", { bubbles: true }));
    expect(el.value).toBe("Final");
    expect(heard).toEqual(["Final"]);

    el.value = "Reset";
    await tick();
    expect(control(el).value).toBe("Reset");
  });

  test("invalid reaches the control as aria-invalid, and error text is drawn and announced", async () => {
    const el = await field({ label: "Name", invalid: "", error: "Enter a value." });
    expect(control(el).getAttribute("aria-invalid")).toBe("true");
    expect(el.dataset["invalid"]).toBeDefined();
    const error = el.querySelector('[part="error"]');
    expect(error?.textContent).toBe("Enter a value.");
    expect(error?.getAttribute("aria-live")).toBe("polite");
    el.error = "";
    el.invalid = false;
    await tick();
    expect(el.querySelector('[part="error"]')?.textContent).toBe("");
    expect(control(el).hasAttribute("aria-invalid")).toBe(false);
  });

  test("the error region predates its text, and is the same node across every refusal", async () => {
    const el = await field({ label: "Name" });
    /* A live region announces nothing unless it was in the tree before the text arrived, so the
       region exists and is empty on a field that has never been refused. */
    const region = el.querySelector('[part="error"]')!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.textContent).toBe("");
    expect(region.childNodes.length).toBe(0);

    // Every refusal, and every clearing, writes into that same node rather than minting a new one.
    for (const sentence of ["Enter a value.", "Enter a shorter value.", "", "Enter a value."]) {
      el.error = sentence;
      await tick();
      expect(el.querySelector('[part="error"]')).toBe(region);
      expect(region.textContent).toBe(sentence);
    }
  });

  test("help, type, name, autocomplete, disabled, readonly and mono forward or mark", async () => {
    const el = await field({
      autocomplete: "email",
      disabled: "",
      help: "We never share it.",
      label: "Email",
      mono: "",
      name: "email",
      readonly: "",
      type: "email",
    });
    const input = control(el) as HTMLInputElement;
    expect(input.type).toBe("email");
    expect(input.name).toBe("email");
    expect(input.getAttribute("autocomplete")).toBe("email");
    expect(input.disabled).toBe(true);
    expect(input.readOnly).toBe(true);
    expect(el.dataset["mono"]).toBeDefined();
    expect(el.querySelector('[part="help"]')?.textContent).toBe("We never share it.");
  });

  test("multiline is a textarea that carries the same value and forwarding contract", async () => {
    const el = await field({
      autocomplete: "street-address",
      label: "Notes",
      multiline: "",
      name: "address",
      value: "a\nb",
    });
    expect(control(el).tagName).toBe("TEXTAREA");
    expect(control(el).value).toBe("a\nb");
    expect(control(el).name).toBe("address");
    expect(control(el).getAttribute("autocomplete")).toBe("street-address");
    control(el).value = "c";
    control(el).dispatchEvent(new Event("input", { bubbles: true }));
    expect(el.value).toBe("c");
  });

  test("a form reset leaves the control saying what the field itself still says", async () => {
    // The control carries the field's value as its DEFAULT as well as its current one.
    // So the reset a field cannot hear cannot empty its control behind the state's back.
    for (const multiline of [false, true]) {
      const form = document.createElement("form");
      const el = document.createElement("jx-textfield") as JxTextfield;
      el.setAttribute("label", "Layout name");
      el.setAttribute("name", "title");
      el.setAttribute("value", "Draft");
      if (multiline) {
        el.setAttribute("multiline", "");
      }
      form.append(el);
      document.body.append(form);
      await tick();
      expect(control(el).defaultValue).toBe("Draft");

      control(el).value = "Final";
      control(el).dispatchEvent(new Event("input", { bubbles: true }));
      await tick();
      expect(el.value).toBe("Final");

      form.reset();
      expect(control(el).value).toBe("Final");
      expect(el.value).toBe(control(el).value);
      expect(new FormData(form).get("title")).toBe("Final");
    }
  });

  test("selectValue focuses and selects all, the stem, or nothing; focusField only focuses", async () => {
    const el = await field({ label: "File", value: "about.md" });
    selectValue(el, "stem");
    expect(document.activeElement === control(el)).toBe(true);
    expect(control(el).selectionStart).toBe(0);
    expect(control(el).selectionEnd).toBe(5);
    selectValue(el, "all");
    expect(control(el).selectionEnd).toBe(8);
    control(el).blur();
    selectValue(el, "none");
    expect(document.activeElement === control(el)).toBe(true);
    control(el).blur();
    focusField(el);
    expect(document.activeElement === control(el)).toBe(true);
    // No control, no throw.
    selectValue(document.createElement("div"));
  });

  test("the error and help sentences carry ids the control names as its description", async () => {
    const el = await field({
      error: "Enter a value.",
      help: "Shown in the Library.",
      label: "Name",
    });
    const errorId = el.querySelector('[part="error"]')!.id;
    const helpId = el.querySelector('[part="help"]')!.id;
    expect(errorId).not.toBe("");
    expect(helpId).not.toBe("");
    // The refusal is read before the guidance.
    expect(control(el).getAttribute("aria-describedby")).toBe(`${errorId} ${helpId}`);

    const other = await field({ error: "Enter a value.", label: "Other" });
    expect(other.querySelector('[part="error"]')!.id).not.toBe(errorId);
  });

  test("a host's own labelledby and describedby are forwarded, the description last", async () => {
    const el = await field({
      describedby: "outside-hint",
      error: "Enter a value.",
      labelledby: "outside-label",
    });
    expect(control(el).getAttribute("aria-labelledby")).toBe("outside-label");
    const errorId = el.querySelector('[part="error"]')!.id;
    expect(control(el).getAttribute("aria-describedby")).toBe(`${errorId} outside-hint`);
  });

  test("a field with nothing to say describes nothing", async () => {
    // The error region is there and empty, and an empty region is not a description.
    const el = await field({ label: "Name" });
    expect(control(el).hasAttribute("aria-describedby")).toBe(false);
  });

  test("the multiline textarea is described the same way", async () => {
    const el = await field({
      describedby: "outside-hint",
      error: "Too long.",
      help: "Markdown is fine.",
      label: "Notes",
      labelledby: "outside-label",
      multiline: "",
    });
    expect(control(el).tagName).toBe("TEXTAREA");
    expect(control(el).getAttribute("aria-labelledby")).toBe("outside-label");
    const errorId = el.querySelector('[part="error"]')!.id;
    const helpId = el.querySelector('[part="help"]')!.id;
    expect(control(el).getAttribute("aria-describedby")).toBe(`${errorId} ${helpId} outside-hint`);
  });

  test("clearable draws a button only while there is something to clear", async () => {
    const el = await field({ clearable: "", label: "Search", type: "search" });
    // Nothing to clear, so no affordance offering to.
    expect(el.querySelector('[part="clear"]')).toBeNull();

    el.value = "about";
    await tick();
    const clear = el.querySelector<HTMLButtonElement>('[part="clear"]')!;
    expect(clear.tagName).toBe("BUTTON");
    expect(clear.type).toBe("button");
    // Named, so a screen reader announces a button rather than a glyph.
    expect(clear.getAttribute("aria-label")).toBe("Clear");
    // Out of the tab order: Escape and the pointer reach it, Tab goes to the next field.
    expect(clear.getAttribute("tabindex")).toBe("-1");
    /* The GLYPH, not a node named jx-icon: an unknown name renders an empty `d` and an empty
       16x16 box, which "a jx-icon exists" cannot tell from a drawn cross. */
    expect(clear.querySelector('[part="path"]')!.getAttribute("d")).toBe(iconPath("x", "regular"));
    expect(iconPath("x", "regular")).not.toBe("");
    /* And the icon resolves when this document is loaded on its own, away from registerUi(),
       which is the only thing the $elements block is for. */
    expect(documents["jx-textfield"]!.$elements).toEqual([{ $ref: "./jx-icon.json" }]);

    // A field that is not clearable never draws one, however much text it holds.
    const plain = await field({ label: "Name", value: "about" });
    expect(plain.querySelector('[part="clear"]')).toBeNull();
  });

  test("the clear button empties the field, gives focus back, and says input then change", async () => {
    const el = await field({ clearable: "", label: "Search", value: "about" });
    const input = control(el);
    const heard: string[] = [];
    // The events must come FROM the field: every host reads e.target.value.
    record(el, heard);

    const clear = el.querySelector<HTMLButtonElement>('[part="clear"]')!;
    /* Pressing the button must not move focus off the control: the blur would fire the control's
       own native change carrying the value about to be deleted, and the clear would then fire a
       second one. Two commits, and two undo entries, for one gesture. happy-dom emulates no
       blur-change, so the guard itself is what is pinned. */
    const pressed = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    clear.dispatchEvent(pressed);
    expect(pressed.defaultPrevented).toBe(true);

    clear.click();
    expect(el.value).toBe("");
    expect(heard).toEqual(["input:jx-textfield", "change:jx-textfield"]);
    expect(document.activeElement === input).toBe(true);

    await tick();
    expect(input.value).toBe("");
    // With nothing left to clear, the button goes.
    expect(el.querySelector('[part="clear"]')).toBeNull();
  });

  test("Escape empties a clearable field and is cancelled; otherwise the key is nobody's", async () => {
    const el = await field({ clearable: "", label: "Search", value: "about" });
    const heard: string[] = [];
    // Escape carries the same guarantee the button does: the pair comes FROM the field.
    record(el, heard);

    const cleared = escape(el);
    expect(el.value).toBe("");
    expect(cleared.defaultPrevented).toBe(true);
    expect(heard).toEqual(["input:jx-textfield", "change:jx-textfield"]);

    // Nothing to clear: the key belongs to whatever the field sits in, so it is left alone.
    const empty = escape(el);
    expect(empty.defaultPrevented).toBe(false);
    expect(heard).toEqual(["input:jx-textfield", "change:jx-textfield"]);

    // Not clearable: Escape is never this field's, even with a value in it.
    const plain = await field({ label: "Name", value: "about" });
    const untouched = escape(plain);
    expect(plain.value).toBe("about");
    expect(untouched.defaultPrevented).toBe(false);
  });

  test("Enter is cancelled on a search field and left alone on a text one", async () => {
    // A search input inside a form submits it on Enter, and a search field never means to. The
    // Element owns no form, so the guard lives here rather than at every call site.
    const search = await field({ label: "Search", type: "search", value: "about" });
    const heard: string[] = [];
    for (const name of ["input", "change", "submit"]) {
      search.addEventListener(name, () => heard.push(name));
    }
    expect(enter(search).defaultPrevented).toBe(true);
    expect(heard).toEqual([]);

    const text = await field({ label: "Name", value: "about" });
    expect(enter(text).defaultPrevented).toBe(false);

    /* A textarea never submits on Enter, so the guard's own reason does not reach it and the
       reader keeps the newline — even on `type="search" multiline`, which renders a TEXTAREA. */
    const notes = await field({ label: "Search", multiline: "", type: "search", value: "about" });
    expect(control(notes).tagName).toBe("TEXTAREA");
    expect(enter(notes).defaultPrevented).toBe(false);
  });

  test("grows hands a multiline field's height to field-sizing, and only when asked", async () => {
    const el = await field({ grows: "", label: "Notes", multiline: "", rows: "2" });
    expect(control(el).tagName).toBe("TEXTAREA");
    expect(el.dataset["grows"]).toBe("");
    // The rows attribute is the fallback height on an engine without field-sizing.
    expect(control(el).getAttribute("rows")).toBe("2");
    expect(el.dataset["rows"]).toBe("2");
    const grows = ruleFor(el, "[data-grows] textarea");
    expect(grows).toContain("field-sizing: content");
    expect(grows).toContain("resize: none");
    /* Where the engine HAS field-sizing, nothing floors the growth. The declaration is inside
       @supports rather than in the rule above, so an engine without it keeps a floor. */
    const supported = rules(el).find((line) =>
      line.startsWith("@supports (field-sizing: content)"),
    );
    expect(supported).toContain("[data-grows] textarea");
    expect(supported).toContain("min-height: 0");
    // A field that named its rows is floored by them and by nothing else.
    expect(ruleFor(el, "[data-grows][data-rows] textarea")).toContain("min-height: 0");

    const fixed = await field({ label: "Notes", multiline: "" });
    expect(fixed.dataset["grows"]).toBeUndefined();
    expect(fixed.querySelector("textarea")!.hasAttribute("rows")).toBe(false);
  });

  test("a growing field with no rows is never shorter than a fixed one", async () => {
    /* The default: `rows` forwards as null, so on an engine with no field-sizing there is no
       rows height to fall back to. The fallback is then the fixed field's own three-row box —
       which is why the grows rule must NOT delete min-height outright. Opting into growth that
       made a field SHORTER on exactly the engines the fallback exists for would be backwards. */
    const el = await field({ grows: "", label: "Notes", multiline: "" });
    expect(control(el).hasAttribute("rows")).toBe(false);
    expect(el.dataset["rows"]).toBeUndefined();
    // So `[data-grows][data-rows]` does not match, and no unconditional rule lifts the floor.
    expect(ruleFor(el, 'textarea[part="input"]')).toContain(
      "min-height: calc(var(--jx-textfield-h) * 3)",
    );
    expect(ruleFor(el, "[data-grows] textarea")).not.toContain("min-height");
  });

  test("a disabled or read-only field offers no clearing, by button or by key", async () => {
    /* Clearing is an edit. A dimmed, uneditable field that a single click empties is a lie, and a
       host that switched its control off must not receive events from it. */
    for (const lock of ["disabled", "readonly"]) {
      const el = await field({ [lock]: "", clearable: "", label: "Search", value: "about" });
      const heard: string[] = [];
      record(el, heard);
      expect(el.querySelector('[part="clear"]')).toBeNull();

      const key = escape(el);
      expect(el.value).toBe("about");
      expect(key.defaultPrevented).toBe(false);
      expect(heard).toEqual([]);

      // Unlock it and the affordance is back, on the same value.
      el.removeAttribute(lock);
      await tick();
      expect(el.querySelector('[part="clear"]')).not.toBeNull();
      el.querySelector<HTMLButtonElement>('[part="clear"]')!.click();
      expect(el.value).toBe("");
      expect(heard).toEqual(["input:jx-textfield", "change:jx-textfield"]);
    }
  });

  test("the clear button is drawn inside the field at every size, and on a textarea", async () => {
    const el = await field({ clearable: "", label: "Search", value: "about" });
    // The host mirror the clear rules key on, and the one the multiline branch keys on.
    expect(el.dataset["clearable"]).toBe("");
    expect(el.dataset["multiline"]).toBeUndefined();
    // The button is positioned against the HOST, so the host is the containing block.
    expect(ruleFor(el, '[data-jx="')).toContain("position: relative");

    const clear = ruleFor(el, '[part="clear"]');
    expect(clear).toContain("position: absolute");
    expect(clear).toContain("inset-inline-end: 1px");
    expect(clear).toContain("inset-block-start: 1px");
    /* One custom property is the control's height AND the button's box, so a size can never move
       one without the other: at sm the input is 4px shorter and the button follows it. */
    expect(clear).toContain("width: calc(var(--jx-textfield-h) - 2px)");
    expect(clear).toContain("height: calc(var(--jx-textfield-h) - 2px)");
    expect(ruleFor(el, '[part="input"]')).toContain("min-height: var(--jx-textfield-h)");
    expect(ruleFor(el, '[data-size="sm"]')).toContain("--jx-textfield-h:");
    expect(ruleFor(el, '[data-size="lg"]')).toContain("--jx-textfield-h:");

    /* The room the button sits in is reserved as a custom property on the HOST, not as a
       padding declaration a later same-specificity size rule can overwrite with a shorthand. */
    expect(ruleFor(el, "[data-clearable] {")).toContain(
      "--jx-textfield-pad-end: var(--jx-textfield-h)",
    );
    expect(ruleFor(el, '[part="input"]')).toContain(
      "padding-inline: var(--jx-textfield-pad) var(--jx-textfield-pad-end)",
    );
    for (const rule of rules(el).filter((line) => line.includes("[data-size="))) {
      expect(rule.slice(rule.indexOf("{")), rule).not.toContain("padding");
    }
    // The platform's own cross would sit beside the kit's on a search input.
    expect(ruleFor(el, "::-webkit-search-cancel-button")).toContain("appearance: none");

    // A textarea is taller than one control, so the button drops to its first line instead.
    const notes = await field({ clearable: "", label: "Notes", multiline: "", value: "about" });
    expect(notes.dataset["multiline"]).toBe("");
    expect(ruleFor(notes, '[data-multiline] [part="clear"]')).toContain(
      "inset-block-start: calc(var(--jx-space-2) + 1px)",
    );
  });

  test("clearField with no field around the click does nothing", () => {
    const state: Record<string, unknown> = { value: "about" };
    clearField(state, new Event("click"));
    expect(state["value"]).toBe("about");
  });

  test("mintFieldId gives each scope it touches an id no other has", () => {
    const one: Record<string, unknown> = {};
    const two: Record<string, unknown> = {};
    mintFieldId(one);
    mintFieldId(two);
    expect(one["uid"]).toBeString();
    expect(one["uid"]).not.toBe(two["uid"]);
  });
});
