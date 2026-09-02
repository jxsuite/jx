import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { registerUi } from "../src/index.ts";
import { focusField, mintFieldId, selectValue } from "../src/behaviors/textfield.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxTextfield = HTMLElement & {
  value: string;
  invalid: boolean;
  error: string;
  multiline: boolean;
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

  test("mintFieldId gives each scope it touches an id no other has", () => {
    const one: Record<string, unknown> = {};
    const two: Record<string, unknown> = {};
    mintFieldId(one);
    mintFieldId(two);
    expect(one["uid"]).toBeString();
    expect(one["uid"]).not.toBe(two["uid"]);
  });
});
