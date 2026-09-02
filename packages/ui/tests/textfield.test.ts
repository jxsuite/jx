import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { registerUi } from "../src/index.ts";
import { focusField, selectValue } from "../src/behaviors/textfield.ts";

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
    expect(el.querySelector('[part="error"]')).toBeNull();
    expect(control(el).hasAttribute("aria-invalid")).toBe(false);
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

  test("multiline is a textarea that carries the same value contract", async () => {
    const el = await field({ label: "Notes", multiline: "", value: "a\nb" });
    expect(control(el).tagName).toBe("TEXTAREA");
    expect(control(el).value).toBe("a\nb");
    control(el).value = "c";
    control(el).dispatchEvent(new Event("input", { bubbles: true }));
    expect(el.value).toBe("c");
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
});
