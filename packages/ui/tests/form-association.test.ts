/**
 * The kit's form controls are form-associated (specs/ui.md §3.2, spec.md §16.11).
 *
 * The test DOM implements neither `attachInternals` nor a form's handling of a form-associated
 * custom element, so each control is given recording internals and the platform's callbacks
 * (`formResetCallback`, `formDisabledCallback`) and a label's activation click are invoked by hand.
 * What is proven is that every control declares the association and that its own state follows the
 * callbacks; that a browser calls them is the platform's contract and is not exercised here.
 */
import "./with-dom.ts";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/** The seven controls that carry a value under a `name`. */
const CONTROLS = [
  "jx-textfield",
  "jx-number-field",
  "jx-checkbox",
  "jx-switch",
  "jx-slider",
  "jx-select",
  "jx-combobox",
] as const;

/** A kit control as the platform sees it once it is form-associated. */
interface FormControl extends HTMLElement {
  formResetCallback: () => void;
  formDisabledCallback: (disabled: boolean) => void;
}

function isFormControl(el: HTMLElement): el is FormControl {
  return "formResetCallback" in el && "formDisabledCallback" in el;
}

/** What each control's internals were told, by host. */
interface Recorded {
  submitted: number;
  validity: boolean[];
  labels: Element[];
}

const recorded = new Map<HTMLElement, Recorded>();

beforeAll(async () => {
  await registerUi();
});

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "attachInternals", {
    configurable: true,
    value(this: HTMLElement) {
      const entry: Recorded = { labels: [], submitted: 0, validity: [] };
      recorded.set(this, entry);
      return {
        labels: entry.labels,
        setFormValue: () => {
          entry.submitted += 1;
        },
        setValidity: (flags?: ValidityStateFlags) => {
          entry.validity.push(flags?.valueMissing !== true);
        },
        shadowRoot: null,
      };
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "attachInternals");
  recorded.clear();
  document.body.replaceChildren();
});

async function mount(
  tag: string,
  attrs: Record<string, string> = {},
  props: Record<string, string | boolean | number> = {},
): Promise<FormControl> {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  Object.assign(el, props);
  document.body.append(el);
  await tick();
  await tick();
  if (!isFormControl(el)) {
    throw new TypeError(`<${tag}> carries no form callbacks`);
  }
  return el;
}

/** The control's first native control: the one a label reaches and validity is anchored at. */
function native(el: HTMLElement): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const found = el.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input, textarea, select",
  );
  if (!found) {
    throw new Error(`<${el.localName}> rendered no native control`);
  }
  return found;
}

describe("every value-carrying control declares the association", () => {
  for (const tag of CONTROLS) {
    test(`${tag} is form-associated and submits through its own named control`, async () => {
      expect(documents[tag].formAssociated).toBe(true);
      // No `formValue`: the inner native control carries `name` and is in the form's own tree.
      expect(documents[tag].formValue).toBeUndefined();
      const ctor = customElements.get(tag);
      expect(ctor !== undefined && "formAssociated" in ctor && ctor.formAssociated).toBe(true);

      const el = await mount(tag, { name: "field" });
      expect(native(el).getAttribute("name")).toBe("field");
      expect(recorded.get(el)?.submitted).toBe(0);
    });

    test(`${tag} follows a disabled fieldset and gets its own state back`, async () => {
      const el = await mount(tag);
      expect(native(el).disabled).toBe(false);
      el.formDisabledCallback(true);
      await tick();
      expect(native(el).disabled).toBe(true);
      el.formDisabledCallback(false);
      await tick();
      expect(native(el).disabled).toBe(false);
    });
  }

  test("no other kit element is form-associated", () => {
    const associated = Object.entries(documents)
      .filter(([, doc]) => doc.formAssociated === true)
      .map(([tag]) => tag)
      .toSorted();
    expect(associated).toEqual([...CONTROLS].toSorted());
  });
});

describe("reset returns a control to the value it first connected with", () => {
  test("a text field", async () => {
    const el = await mount("jx-textfield", { value: "first" });
    Object.assign(el, { value: "typed" });
    await tick();
    expect(native(el).value).toBe("typed");
    el.formResetCallback();
    await tick();
    expect(native(el).value).toBe("first");
    // The mirror moves with it, so the control's default and the element agree again.
    expect(native(el).getAttribute("value")).toBe("first");
  });

  test("a number field, a slider and a select", async () => {
    const number = await mount("jx-number-field", { value: "3" });
    Object.assign(number, { value: "9" });
    number.formResetCallback();
    await tick();
    expect(native(number).value).toBe("3");

    const slider = await mount("jx-slider", {}, { value: 40 });
    Object.assign(slider, { value: 75 });
    slider.formResetCallback();
    await tick();
    expect(native(slider).value).toBe("40");
  });

  test("a checkbox and a switch return to their first checked state", async () => {
    for (const tag of ["jx-checkbox", "jx-switch"]) {
      const el = await mount(tag, {}, { checked: true });
      const box = native(el);
      Object.assign(el, { checked: false });
      await tick();
      el.formResetCallback();
      await tick();
      expect([tag, "checked" in box && box.checked]).toEqual([tag, true]);
    }
  });
});

describe("validity and a label", () => {
  test("a required control with no value is reported missing, and valid once it has one", async () => {
    const el = await mount("jx-textfield", {}, { required: true });
    expect(recorded.get(el)?.validity.at(-1)).toBe(false);
    Object.assign(el, { value: "x" });
    expect(recorded.get(el)?.validity.at(-1)).toBe(true);

    const box = await mount("jx-checkbox", {}, { required: true });
    expect(recorded.get(box)?.validity.at(-1)).toBe(false);
    Object.assign(box, { checked: true });
    expect(recorded.get(box)?.validity.at(-1)).toBe(true);
  });

  test("a label's click on the host focuses the field's control", async () => {
    const el = await mount("jx-textfield");
    el.dispatchEvent(new Event("click", { bubbles: true }));
    expect(document.activeElement).toBe(native(el));
  });

  test("a label's click on a checkbox host ticks it, once", async () => {
    const el = await mount("jx-checkbox");
    el.dispatchEvent(new Event("click", { bubbles: true }));
    await tick();
    const box = native(el);
    expect("checked" in box && box.checked).toBe(true);
  });
});
