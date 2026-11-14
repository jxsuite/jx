/**
 * Form-association.test.ts — an element that declares `formAssociated: true` binds its state to
 * `ElementInternals` (spec.md §16.11).
 *
 * Happy-dom implements neither `attachInternals` nor `ElementInternals`, nor a form's handling of a
 * form-associated custom element. So what runs here is the interpreter's half only: the internals
 * are a recording stand-in installed on `HTMLElement.prototype`, and the platform's callbacks
 * (`formResetCallback`, `formDisabledCallback`) and a label's activation click are invoked by hand,
 * as the platform would invoke them. That a browser calls them, submits the value and blocks an
 * invalid form is the platform's contract and is not exercised by this file.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { toRaw } from "@vue/reactivity";

import { defineElement, formStateKeys, resetDocumentStyles } from "../src/runtime";

import type { JxDocument } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

let uid = 0;
const uniqueTag = () => `fa-test-${(uid += 1)}`;

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 20);
  });

/** The recording stand-in for one element's `ElementInternals`. */
interface FakeInternals {
  labels: Element[];
  setFormValue: ReturnType<typeof mock>;
  setValidity: ReturnType<typeof mock>;
  shadowRoot: ShadowRoot | null;
}

/** The element class as the platform sees it: its static flag and its form callbacks. */
interface FormAssociatedElement extends HTMLElement {
  formResetCallback: () => void;
  formDisabledCallback: (disabled: boolean) => void;
}

function isFormAssociated(el: HTMLElement): el is FormAssociatedElement {
  return "formResetCallback" in el && "formDisabledCallback" in el;
}

const internalsByHost = new Map<HTMLElement, FakeInternals>();
let attachCalls = 0;

/** Give every element internals, as a browser does. Labels may be supplied before connection. */
function installInternals(): void {
  Object.defineProperty(HTMLElement.prototype, "attachInternals", {
    configurable: true,
    value(this: HTMLElement) {
      attachCalls += 1;
      return internalsFor(this);
    },
  });
}

/** Take them away again: the test DOM's own state, and an older engine's. */
function removeInternals(): void {
  Reflect.deleteProperty(HTMLElement.prototype, "attachInternals");
}

function internalsFor(host: HTMLElement): FakeInternals {
  let internals = internalsByHost.get(host);
  if (!internals) {
    internals = { labels: [], setFormValue: mock(), setValidity: mock(), shadowRoot: null };
    internalsByHost.set(host, internals);
  }
  return internals;
}

beforeEach(() => {
  attachCalls = 0;
  installInternals();
});

afterEach(() => {
  removeInternals();
  internalsByHost.clear();
  document.body.replaceChildren();
  resetDocumentStyles();
});

/** A text control: the shape of the kit's fields, with its own named native input. */
const field = (extra: JxDocument = {}): JxDocument => ({
  children: [
    {
      attributes: { disabled: { $ref: "#/state/disabled" }, name: "${state.name || null}" },
      tagName: "input",
      value: { $ref: "#/state/value" },
    },
  ],
  formAssociated: true,
  state: { disabled: false, name: "", required: false, value: "" },
  tagName: uniqueTag(),
  ...extra,
});

/** A checkable control. */
const toggle = (extra: JxDocument = {}): JxDocument => ({
  children: [
    {
      attributes: { type: "checkbox" },
      checked: { $ref: "#/state/checked" },
      tagName: "input",
    },
  ],
  formAssociated: true,
  state: { checked: false, required: false, value: "on" },
  tagName: uniqueTag(),
  ...extra,
});

async function connect(
  doc: JxDocument,
  props: Record<string, string | boolean | number | null | FormData> = {},
  before?: (el: HTMLElement) => void,
): Promise<FormAssociatedElement> {
  await defineElement(doc);
  const el = document.createElement(String(doc.tagName));
  Object.assign(el, props);
  before?.(el);
  document.body.append(el);
  await settle();
  if (!isFormAssociated(el)) {
    throw new TypeError("the element class carries no form callbacks");
  }
  return el;
}

const input = (el: HTMLElement): HTMLInputElement => {
  const found = el.querySelector("input") ?? el.shadowRoot?.querySelector("input");
  if (!found) {
    throw new Error("the element rendered no input");
  }
  return found;
};

describe("the class (spec.md §16.11)", () => {
  test("formAssociated is the definition's, read by the platform from the class", async () => {
    const associated = field();
    const plain = field({ formAssociated: false });
    const silent: JxDocument = { children: [], tagName: uniqueTag() };
    await defineElement(associated);
    await defineElement(plain);
    await defineElement(silent);
    const flag = (doc: JxDocument): boolean => {
      const ctor = customElements.get(String(doc.tagName));
      return ctor !== undefined && "formAssociated" in ctor && ctor.formAssociated === true;
    };
    expect(flag(associated)).toBe(true);
    expect(flag(plain)).toBe(false);
    expect(flag(silent)).toBe(false);
  });

  test("without ElementInternals the element renders as it always has and the callbacks are inert", async () => {
    removeInternals();
    const el = await connect(field(), { value: "kept" });
    expect(input(el).value).toBe("kept");
    el.formResetCallback();
    el.formDisabledCallback(true);
    expect(input(el).value).toBe("kept");
    expect(input(el).disabled).toBe(false);
  });

  test("an element that is not form-associated attaches no internals", async () => {
    await connect(field({ formAssociated: false }));
    expect(attachCalls).toBe(0);
  });

  test("formStateKeys names the declared, writable form state", () => {
    expect(formStateKeys(field())).toEqual({
      checked: false,
      disabled: true,
      required: true,
      value: true,
    });
    // A derived key cannot be written, so the callbacks leave it alone.
    expect(formStateKeys({ state: { checked: "${state.value === 'on'}", value: "on" } })).toEqual({
      checked: false,
      disabled: false,
      required: false,
      value: true,
    });
    expect(formStateKeys({})).toEqual({
      checked: false,
      disabled: false,
      required: false,
      value: false,
    });
  });
});

describe("the submitted value (spec.md §16.11)", () => {
  test("an element with no formValue submits nothing itself", async () => {
    // Its own named input is in the form's tree and submits: a second entry would double it.
    const el = await connect(field(), { name: "q", value: "abc" });
    expect(internalsFor(el).setFormValue).not.toHaveBeenCalled();
    expect(input(el).getAttribute("name")).toBe("q");
  });

  test("a formValue $ref is submitted and follows state", async () => {
    const el = await connect(field({ formValue: { $ref: "#/state/value" } }), { value: "abc" });
    const { setFormValue } = internalsFor(el);
    expect(setFormValue).toHaveBeenLastCalledWith("abc");
    Object.assign(el, { value: 7 });
    expect(setFormValue).toHaveBeenLastCalledWith("7");
    Object.assign(el, { value: null });
    expect(setFormValue).toHaveBeenLastCalledWith(null);
  });

  test("a template formValue is evaluated, and one that throws submits nothing yet", async () => {
    const checked = await connect(toggle({ formValue: "${state.checked ? state.value : null}" }), {
      checked: true,
    });
    expect(internalsFor(checked).setFormValue).toHaveBeenLastCalledWith("on");
    Object.assign(checked, { checked: false });
    expect(internalsFor(checked).setFormValue).toHaveBeenLastCalledWith(null);

    const throwing = await connect(field({ formValue: "${state.missing.deep}" }));
    expect(internalsFor(throwing).setFormValue).toHaveBeenLastCalledWith(null);
  });

  test("a literal formValue, and a FormData one, are passed as they are", async () => {
    const literal = await connect(field({ formValue: "fixed" }));
    expect(internalsFor(literal).setFormValue).toHaveBeenLastCalledWith("fixed");

    const data = new FormData();
    data.append("a", "1");
    const entries = await connect(field({ formValue: { $ref: "#/state/value" } }), {
      value: data,
    });
    /* Passed as the object it is, not as its text. happy-dom's FormData reads as a plain object
       to the reactive scope, which hands back a proxy of it; a browser's is never proxied. */
    expect(toRaw(internalsFor(entries).setFormValue.mock.calls.at(-1)?.[0])).toBe(data);
  });
});

describe("validity (spec.md §16.11)", () => {
  test("required with an empty value is valueMissing, anchored at the control", async () => {
    const el = await connect(field(), { required: true });
    const { setValidity } = internalsFor(el);
    const [flags, message, anchor] = setValidity.mock.calls.at(-1) ?? [];
    expect(flags).toEqual({ valueMissing: true });
    expect(message).not.toBe("");
    expect(anchor).toBe(input(el));

    Object.assign(el, { value: "x" });
    expect(setValidity.mock.calls.at(-1)).toEqual([{}]);
    Object.assign(el, { required: false, value: "" });
    expect(setValidity.mock.calls.at(-1)).toEqual([{}]);
  });

  test("a checkable control is missing while it is unchecked", async () => {
    const el = await connect(toggle(), { required: true });
    const { setValidity } = internalsFor(el);
    expect(setValidity.mock.calls.at(-1)?.[0]).toEqual({ valueMissing: true });
    Object.assign(el, { checked: true });
    expect(setValidity.mock.calls.at(-1)).toEqual([{}]);
  });

  test("an element that renders no control reports with no anchor", async () => {
    const el = await connect(
      { formAssociated: true, state: { required: true, value: null }, tagName: uniqueTag() },
      {},
    );
    const call = internalsFor(el).setValidity.mock.calls.at(-1) ?? [];
    expect(call[0]).toEqual({ valueMissing: true });
    expect(call[2]).toBeUndefined();
  });

  test("an element that declares no required reports no validity", async () => {
    const el = await connect({
      children: [{ tagName: "input" }],
      formAssociated: true,
      state: { value: "" },
      tagName: uniqueTag(),
    });
    expect(internalsFor(el).setValidity.mock.calls).toEqual([]);
  });
});

describe("reset and a disabled fieldset (spec.md §16.11)", () => {
  test("reset returns value to what the instance first connected with", async () => {
    const el = await connect(field(), { value: "initial" });
    Object.assign(el, { value: "typed" });
    expect(input(el).value).toBe("typed");
    el.formResetCallback();
    expect(input(el).value).toBe("initial");
  });

  test("reset returns checked too", async () => {
    const el = await connect(toggle(), { checked: true });
    Object.assign(el, { checked: false });
    el.formResetCallback();
    expect(input(el).checked).toBe(true);
  });

  test("a disabled fieldset disables the element, and re-enabling restores its own state", async () => {
    const enabled = await connect(field());
    enabled.formDisabledCallback(true);
    enabled.formDisabledCallback(true);
    expect(input(enabled).disabled).toBe(true);
    enabled.formDisabledCallback(false);
    expect(input(enabled).disabled).toBe(false);

    // One that was disabled in its own right stays so when the fieldset lets go.
    const own = await connect(field(), { disabled: true });
    own.formDisabledCallback(true);
    own.formDisabledCallback(false);
    expect(input(own).disabled).toBe(true);
    // An enable the platform never preceded with a disable changes nothing.
    own.formDisabledCallback(false);
    expect(input(own).disabled).toBe(true);
  });

  test("the host's own disabled attribute is its own state: removing it enables", async () => {
    // The platform reports the effective state, so the callback fires for the attribute too.
    const el = await connect(field({ observedAttributes: ["disabled"] }));
    el.setAttribute("disabled", "");
    el.formDisabledCallback(true);
    expect(input(el).disabled).toBe(true);
    el.removeAttribute("disabled");
    el.formDisabledCallback(false);
    expect(input(el).disabled).toBe(false);
  });

  test("an element that declares neither key is left as it is", async () => {
    const el = await connect({
      children: [{ tagName: "input" }],
      formAssociated: true,
      state: { label: "x" },
      tagName: uniqueTag(),
    });
    el.formDisabledCallback(true);
    el.formResetCallback();
    expect(input(el).disabled).toBe(false);
  });
});

describe("a label names the host (spec.md §16.11)", () => {
  test("a click on the host focuses its control", async () => {
    const el = await connect(field());
    el.dispatchEvent(new Event("click", { bubbles: true }));
    expect(document.activeElement).toBe(input(el));
  });

  test("a click on the host toggles a checkbox, and one from inside is the control's own", async () => {
    const el = await connect(toggle());
    el.dispatchEvent(new Event("click", { bubbles: true }));
    expect(input(el).checked).toBe(true);
    // A click that bubbled up from the control itself is not forwarded back to it.
    input(el).dispatchEvent(new Event("click", { bubbles: true }));
    expect(input(el).checked).toBe(true);
  });

  test("a disabled control, and an element with no control, are left alone", async () => {
    const disabled = await connect(field(), { disabled: true });
    disabled.dispatchEvent(new Event("click", { bubbles: true }));
    expect(document.activeElement).not.toBe(input(disabled));

    const bare = await connect({ formAssociated: true, state: {}, tagName: uniqueTag() });
    expect(() => bare.dispatchEvent(new Event("click", { bubbles: true }))).not.toThrow();
  });

  describe("naming the control by element reference", () => {
    const reflection: { ariaLabelledByElements?: readonly Element[] | null } =
      HTMLInputElement.prototype;

    beforeEach(() => {
      // Happy-dom does not reflect ARIA element references; give the control the property.
      reflection.ariaLabelledByElements = null;
    });
    afterEach(() => {
      delete reflection.ariaLabelledByElements;
    });

    const label = (): HTMLLabelElement => {
      const node = document.createElement("label");
      node.textContent = "Name";
      document.body.append(node);
      return node;
    };

    test("the host's labels name its control, at first render and again on focus", async () => {
      const first = label();
      const el = await connect(field(), {}, (host) => {
        internalsFor(host).labels.push(first);
      });
      expect(input(el).ariaLabelledByElements).toHaveLength(1);
      expect(input(el).ariaLabelledByElements?.[0]).toBe(first);

      const second = label();
      internalsFor(el).labels.push(second);
      el.dispatchEvent(new Event("focusin", { bubbles: true }));
      expect(input(el).ariaLabelledByElements).toHaveLength(2);
    });

    test("a control that already carries a name keeps it, and no labels names nothing", async () => {
      const named = await connect(
        field({
          children: [{ attributes: { "aria-label": "Own" }, tagName: "input" }],
        }),
        {},
        (host) => {
          internalsFor(host).labels.push(label());
        },
      );
      expect(input(named).ariaLabelledByElements).toBeNull();

      const unlabelled = await connect(field());
      expect(input(unlabelled).ariaLabelledByElements).toBeNull();
    });
  });

  test("an engine without the reflection names nothing and does not throw", async () => {
    const node = document.createElement("label");
    const el = await connect(field(), {}, (host) => {
      internalsFor(host).labels.push(node);
    });
    expect("ariaLabelledByElements" in input(el)).toBe(false);
  });
});

describe("with a shadow root (spec.md §16.6, §16.11)", () => {
  test("a closed root and form association share one attachInternals call", async () => {
    const el = await connect(field({ $shadow: "closed", formValue: { $ref: "#/state/value" } }), {
      value: "v",
    });
    expect(attachCalls).toBe(1);
    expect(internalsFor(el).setFormValue).toHaveBeenLastCalledWith("v");
  });

  test("the control is found in the root the element renders into", async () => {
    const el = await connect(field({ $shadow: "open" }), { required: true });
    const anchor = internalsFor(el).setValidity.mock.calls.at(-1)?.[2];
    expect(anchor).toBe(input(el));
    expect(el.querySelector("input")).toBeNull();
  });
});
