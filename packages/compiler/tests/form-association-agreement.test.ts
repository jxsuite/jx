/**
 * One form-association rule, two tiers (spec.md §16.11): the interpreter's `associateForm` and the
 * copy a compiled component module inlines (`formAssociationHelperSource`). Each scenario runs
 * through both against the same recording internals and must leave the same log, which is what "a
 * compiled element is form-associated as the interpreter makes it" means as a check.
 *
 * The second half loads a compiled module and drives the element itself.
 *
 * Happy-dom implements neither `attachInternals` nor a form's handling of a form-associated custom
 * element, so the internals are a recording stand-in and the platform's callbacks are invoked by
 * hand. What a browser does with the association is the platform's contract and is not exercised.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { associateForm, formStateKeys } from "@jxsuite/runtime";
import type { FormAssociation, FormInternals, FormStateKeys } from "@jxsuite/runtime";
import type { JxDocument } from "@jxsuite/schema/types";
import { formAssociationHelperSource } from "../src/shared";
import { compileElement } from "../src/targets/compile-element";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

/** The control state a scenario reads and writes, under HTML's own names. */
type ControlState = Record<string, string | boolean | null>;

/** The inlined helper's signature: `associateForm`'s, with its options spread positionally. */
type InlinedAssociate = (
  host: HTMLElement,
  internals: FormInternals,
  state: ControlState,
  keys: FormStateKeys,
  root: () => ParentNode,
  formValue: (() => string | boolean | null) | null,
  watch: (fn: () => void) => void,
) => FormAssociation;

const dir = mkdtempSync(join(tmpdir(), "jx-form-helper-"));
const helperFile = join(dir, "helper.js");
writeFileSync(
  helperFile,
  `${formAssociationHelperSource()}\nexport { __jxAssociateForm };\n`,
  "utf8",
);
/* SAFETY: the module written above exports exactly this function, from the source the compiler
   emits into every form-associated component module. */
const { __jxAssociateForm: inlined } = (await import(helperFile)) as {
  __jxAssociateForm: InlinedAssociate;
};

/** Where compiled modules are written: inside the package, so their bare imports resolve. */
const MODULES = resolve(import.meta.dir, "__test-form-association__");
rmSync(MODULES, { force: true, recursive: true });
mkdirSync(MODULES, { recursive: true });

afterAll(() => {
  rmSync(dir, { force: true, recursive: true });
  rmSync(MODULES, { force: true, recursive: true });
});

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(HTMLElement.prototype, "attachInternals");
  Reflect.deleteProperty(HTMLInputElement.prototype, "ariaLabelledByElements");
});

/** One scenario: the control it renders, its state, and the steps driven against the binding. */
interface Scenario {
  name: string;
  markup: string;
  state: ControlState;
  keys: FormStateKeys;
  /** A state key whose value is the submitted one, when the definition declares a `formValue`. */
  submits?: string;
  labels?: number;
  steps: (drive: Driver) => void;
}

/** What a scenario may do to a bound element. */
interface Driver {
  set: (key: string, value: string | boolean | null) => void;
  reset: () => void;
  disabled: (flag: boolean) => void;
  /** Add or remove the host's own `disabled` attribute. */
  attribute: (on: boolean) => void;
  clickHost: () => void;
  clickControl: () => void;
  focusIn: () => void;
  note: (label: string) => void;
}

const ALL: FormStateKeys = { checked: false, disabled: true, required: true, value: true };

const SCENARIOS: readonly Scenario[] = [
  {
    keys: ALL,
    markup: "<input>",
    name: "a text control: value, validity, reset, a disabled fieldset",
    state: { disabled: false, required: true, value: "" },
    steps: (drive) => {
      drive.set("value", "typed");
      drive.set("required", false);
      drive.set("value", "");
      drive.reset();
      drive.disabled(true);
      drive.disabled(true);
      drive.disabled(false);
      drive.disabled(false);
    },
    submits: "value",
  },
  {
    keys: ALL,
    markup: "<input>",
    name: "a control disabled in its own right keeps it when the fieldset lets go",
    state: { disabled: true, required: false, value: "v" },
    steps: (drive) => {
      drive.disabled(true);
      drive.disabled(false);
    },
  },
  {
    keys: ALL,
    markup: "<input>",
    name: "the host's own disabled attribute is its own state, and removing it enables",
    state: { disabled: false, required: false, value: "v" },
    steps: (drive) => {
      // As the platform orders it: the attribute is observed first, then the form callback.
      drive.attribute(true);
      drive.set("disabled", true);
      drive.disabled(true);
      drive.attribute(false);
      drive.set("disabled", false);
      drive.disabled(false);
    },
  },
  {
    keys: { checked: true, disabled: false, required: true, value: true },
    markup: '<input type="checkbox">',
    name: "a checkable control: missing while unchecked, toggled by a label's click",
    state: { checked: false, required: true, value: "on" },
    steps: (drive) => {
      drive.clickHost();
      drive.clickControl();
      drive.set("checked", true);
      drive.disabled(true);
      drive.set("checked", false);
      drive.reset();
    },
  },
  {
    keys: { checked: false, disabled: false, required: false, value: false },
    markup: "<span>no control</span>",
    name: "an element that declares none of the keys and renders no control",
    state: {},
    steps: (drive) => {
      drive.clickHost();
      drive.reset();
      drive.disabled(true);
      drive.focusIn();
    },
  },
  {
    keys: ALL,
    labels: 2,
    markup: "<input><textarea></textarea>",
    name: "labels name the first control, and a click focuses it",
    state: { disabled: false, required: false, value: null },
    steps: (drive) => {
      drive.clickHost();
      drive.note("focused");
      drive.focusIn();
    },
    submits: "value",
  },
  {
    keys: ALL,
    labels: 1,
    markup: '<input aria-label="Own" disabled>',
    name: "a control with a name of its own keeps it, and a disabled one is not focused",
    state: { disabled: false, required: true, value: "" },
    steps: (drive) => {
      drive.clickHost();
      drive.note("focused");
    },
  },
];

/** Run one scenario against one implementation and answer everything it did, in order. */
function run(
  scenario: Scenario,
  bind: (
    host: HTMLElement,
    internals: FormInternals,
    state: ControlState,
    watch: (fn: () => void) => void,
  ) => FormAssociation,
): string[] {
  const log: string[] = [];
  const host = document.createElement("div");
  host.innerHTML = scenario.markup;
  document.body.append(host);
  const control = host.querySelector<HTMLInputElement>("input");
  /* Happy-dom does not reflect ARIA element references; give the control the property, so the
     naming branch runs in both implementations. */
  Object.defineProperty(HTMLInputElement.prototype, "ariaLabelledByElements", {
    configurable: true,
    value: null,
    writable: true,
  });
  // A label names a host by `for`, and the binding reads its label list only for such a host.
  const labels = Array.from({ length: scenario.labels ?? 0 }, () => {
    const label = document.createElement("label");
    label.htmlFor = "labelled";
    document.body.append(label);
    return label;
  });
  if (labels.length > 0) {
    host.id = "labelled";
  }
  const internals: FormInternals = {
    labels,
    setFormValue: (value) => {
      log.push(`value ${JSON.stringify(value)}`);
    },
    setValidity: (flags, message, anchor) => {
      const missing = flags?.valueMissing === true;
      log.push(
        missing
          ? `invalid message=${message !== undefined && message !== ""} anchor=${anchor?.localName ?? "none"}`
          : "valid",
      );
    },
  };
  const state = { ...scenario.state };
  const watched: (() => void)[] = [];
  const association = bind(host, internals, state, (fn) => {
    watched.push(fn);
    fn();
  });
  association.start();
  const snapshot = () => log.push(`state ${JSON.stringify(state)}`);
  scenario.steps({
    attribute: (on) => {
      host.toggleAttribute("disabled", on);
    },
    clickControl: () => {
      control?.dispatchEvent(new Event("click", { bubbles: true }));
      log.push(`checked ${control?.checked}`);
    },
    clickHost: () => {
      host.dispatchEvent(new Event("click", { bubbles: true }));
      log.push(`checked ${control?.checked}`);
    },
    disabled: (flag) => {
      association.disabled(flag);
      snapshot();
    },
    focusIn: () => {
      host.dispatchEvent(new Event("focusin", { bubbles: true }));
    },
    note: (label) => {
      log.push(`${label} ${document.activeElement === control}`);
    },
    reset: () => {
      association.reset();
      snapshot();
    },
    set: (key, value) => {
      state[key] = value;
      for (const fn of watched) {
        fn();
      }
    },
  });
  log.push(`named ${control?.ariaLabelledByElements?.length ?? 0}`);
  return log;
}

describe("form association: the interpreter and the inlined helper agree (spec.md §16.11)", () => {
  for (const scenario of SCENARIOS) {
    test(scenario.name, () => {
      const { keys, submits } = scenario;
      const interpreted = run(scenario, (host, internals, state, watch) =>
        associateForm(host, internals, state, {
          formValue: submits === undefined ? undefined : () => state[submits],
          keys,
          root: () => host,
          watch,
        }),
      );
      const compiled = run(scenario, (host, internals, state, watch) =>
        inlined(
          host,
          internals,
          state,
          keys,
          () => host,
          submits === undefined ? null : () => state[submits] ?? null,
          watch,
        ),
      );
      expect(compiled).toEqual(interpreted);
      expect(interpreted.length).toBeGreaterThan(0);
    });
  }

  test("the first scenario's log is what the section says, not merely the same twice", () => {
    const [text] = SCENARIOS;
    const log = run(text!, (host, internals, state, watch) =>
      inlined(
        host,
        internals,
        state,
        text!.keys,
        () => host,
        () => state["value"] ?? null,
        watch,
      ),
    );
    expect(log).toEqual([
      'value ""',
      "invalid message=true anchor=input",
      'value "typed"',
      "valid",
      'value "typed"',
      "valid",
      'value ""',
      "valid",
      'state {"disabled":false,"required":false,"value":""}',
      'state {"disabled":true,"required":false,"value":""}',
      'state {"disabled":true,"required":false,"value":""}',
      'state {"disabled":false,"required":false,"value":""}',
      'state {"disabled":false,"required":false,"value":""}',
      "named 0",
    ]);
  });
});

// ─── A compiled module, executed ─────────────────────────────────────────────

/** Internals the executed element is given, recording what it submits. */
interface ElementInternalsDouble {
  labels: Element[];
  submitted: (string | null)[];
  validity: boolean[];
  setFormValue: (value: string | null) => void;
  setValidity: (flags: { valueMissing?: boolean }) => void;
  shadowRoot: ShadowRoot | null;
}

/** The compiled element as the platform sees it. */
interface CompiledFormElement extends HTMLElement {
  formResetCallback: () => void;
  formDisabledCallback: (disabled: boolean) => void;
}

function isCompiledFormElement(el: HTMLElement): el is CompiledFormElement {
  return "formResetCallback" in el && "formDisabledCallback" in el;
}

const doubles = new Map<HTMLElement, ElementInternalsDouble>();
let attachCalls = 0;

function installInternals(): void {
  Object.defineProperty(HTMLElement.prototype, "attachInternals", {
    configurable: true,
    value(this: HTMLElement) {
      attachCalls += 1;
      const double: ElementInternalsDouble = {
        labels: [],
        setFormValue(value) {
          this.submitted.push(value);
        },
        setValidity(flags) {
          this.validity.push(flags.valueMissing !== true);
        },
        shadowRoot: null,
        submitted: [],
        validity: [],
      };
      doubles.set(this, double);
      return double;
    },
  });
}

const FIELD = (tagName: string, extra: JxDocument = {}): JxDocument => ({
  children: [
    {
      attributes: { disabled: { $ref: "#/state/disabled" } },
      tagName: "input",
      value: { $ref: "#/state/value" },
    },
  ],
  formAssociated: true,
  formValue: { $ref: "#/state/value" },
  state: { disabled: false, required: false, value: "" },
  tagName,
  ...extra,
});

let moduleCount = 0;

/** Compile a definition, load its module and answer its source. */
async function load(doc: JxDocument): Promise<string> {
  const { files } = await compileElement(doc);
  const source = files[0]!.content;
  moduleCount += 1;
  const file = join(MODULES, `element-${moduleCount}.js`);
  writeFileSync(file, source, "utf8");
  await import(file);
  return source;
}

function connect(tagName: string, props: Record<string, string | boolean> = {}) {
  const el = document.createElement(tagName);
  Object.assign(el, props);
  document.body.append(el);
  if (!isCompiledFormElement(el)) {
    throw new TypeError("the compiled class carries no form callbacks");
  }
  return el;
}

describe("a compiled form-associated element (spec.md §16.11)", () => {
  test("the class is form-associated and the instance submits its formValue", async () => {
    installInternals();
    const source = await load(FIELD("cf-field"));
    expect(source).toContain("static formAssociated = true;");
    const ctor = customElements.get("cf-field");
    expect(ctor !== undefined && "formAssociated" in ctor && ctor.formAssociated).toBe(true);

    const el = connect("cf-field", { value: "abc" });
    const double = doubles.get(el)!;
    expect(double.submitted).toEqual(["abc"]);
    Object.assign(el, { value: "abcd" });
    expect(double.submitted.at(-1)).toBe("abcd");
  });

  test("reset, a disabled fieldset and validity reach the element's state", async () => {
    installInternals();
    await load(FIELD("cf-callbacks"));
    const el = connect("cf-callbacks", { required: true, value: "initial" });
    const control = el.querySelector("input")!;
    const double = doubles.get(el)!;
    expect(double.validity.at(-1)).toBe(true);

    Object.assign(el, { value: "" });
    expect(double.validity.at(-1)).toBe(false);
    el.formResetCallback();
    expect(control.value).toBe("initial");
    expect(double.validity.at(-1)).toBe(true);

    el.formDisabledCallback(true);
    expect(control.disabled).toBe(true);
    el.formDisabledCallback(false);
    expect(control.disabled).toBe(false);
  });

  test("a reconnected element goes on submitting, with one attachInternals call", async () => {
    installInternals();
    await load(FIELD("cf-reconnect"));
    attachCalls = 0;
    const el = connect("cf-reconnect", { value: "a" });
    el.remove();
    Object.assign(el, { value: "detached" });
    const double = doubles.get(el)!;
    // Its effects stopped with the removal, and start again when it is put back.
    expect(double.submitted.at(-1)).toBe("a");
    document.body.append(el);
    expect(double.submitted.at(-1)).toBe("detached");
    expect(attachCalls).toBe(1);
  });

  test("a template formValue submits nothing while it throws, and a literal is passed as it is", async () => {
    installInternals();
    await load(FIELD("cf-template", { formValue: "${state.value.toUpperCase()}" }));
    const upper = connect("cf-template", { value: "abc" });
    expect(doubles.get(upper)!.submitted.at(-1)).toBe("ABC");
    Object.assign(upper, { value: null });
    expect(doubles.get(upper)!.submitted.at(-1)).toBeNull();

    await load(FIELD("cf-mixed", { formValue: "v:${state.value}" }));
    expect(doubles.get(connect("cf-mixed", { value: "x" }))!.submitted).toEqual(["v:x"]);

    await load(FIELD("cf-literal", { formValue: "fixed" }));
    expect(doubles.get(connect("cf-literal"))!.submitted).toEqual(["fixed"]);
  });

  test("without ElementInternals the element renders and its callbacks are inert", async () => {
    await load(FIELD("cf-bare"));
    const el = connect("cf-bare", { value: "kept" });
    el.formResetCallback();
    el.formDisabledCallback(true);
    expect(el.querySelector("input")?.value).toBe("kept");
    expect(el.querySelector("input")?.disabled).toBe(false);
  });

  test("an element with no formValue submits nothing itself", async () => {
    installInternals();
    const doc = FIELD("cf-silent");
    delete doc.formValue;
    const source = await load(doc);
    expect(source).toContain(`${JSON.stringify(formStateKeys(doc))}, () => this, null,`);
    expect(doubles.get(connect("cf-silent", { value: "x" }))!.submitted).toEqual([]);
  });

  test("a closed root shares the one attachInternals call, and finds its control in the root", async () => {
    installInternals();
    const source = await load(FIELD("cf-closed", { $shadow: "closed" }));
    expect(source).toContain("const _a = this.#attach()?.shadowRoot ?? null;");
    expect(source).not.toContain("this.attachInternals().shadowRoot");
    attachCalls = 0;
    const el = connect("cf-closed", { required: true });
    expect(attachCalls).toBe(1);
    // The control is in the closed root: validity was computed, and anchored there or nowhere.
    expect(doubles.get(el)!.validity).toEqual([false]);
  });

  test("a definition that is not form-associated compiles to the module it always did", async () => {
    const doc = FIELD("cf-plain");
    delete doc.formAssociated;
    delete doc.formValue;
    const { files } = await compileElement(doc);
    const source = files[0]!.content;
    for (const added of ["__jxAssociateForm", "formAssociated", "#attach", "formResetCallback"]) {
      expect([added, source.includes(added)]).toEqual([added, false]);
    }
  });
});
