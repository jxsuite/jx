/**
 * Tests for the shared schema→form engine: `src/ui/schema-form.ts`, the flow, and
 * `src/surfaces/schema-form.json`, the document it mounts.
 *
 * Everything is addressed by `part`, by `data-prop` and by role, because the form is a document:
 * there is no `sp-textfield`, no `sp-picker` and no `.array-object-row` to find any more. Every
 * mount is awaited — `mountSurface` settles when the document has rendered, and a kit element's own
 * template is one `connectedCallback` after that, so a synchronous assertion finds nothing at all.
 *
 * The engine hands back a HOST ELEMENT rather than a template, so each form is placed in an
 * ATTACHED container of its own and the standing mount is what a repaint updates.
 */
import { flush, installMockPlatform, pointer } from "./harness";
import { printedOf } from "./kit-readers";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import {
  mountSchemaForm,
  parseNumericField,
  registerFormControl,
  resetSchemaForms,
  resolveFormEnum,
  validateFieldValue,
} from "../src/ui/schema-form";
import { resolveContextPointer } from "../src/services/context-resolver";
import { resetSlotModeMemory } from "../src/ui/dynamic-slot";
import type {
  JsonSchema,
  RenderFormOptions,
  SchemaFormContext,
  SchemaFormControlArgs,
  SchemaFormMountedControl,
  SchemaFormPatch,
} from "../src/ui/schema-form";
import type { JsonObject, ProjectConfig } from "@jxsuite/schema/types";

/**
 * A registered control the test drives, as the registry now holds one: a MOUNT that owns its host.
 *
 * `update` is the half worth stubbing. A standing control is brought up to date rather than
 * rebuilt, so a stub that only drew on `mount` would report the same thing whether or not the
 * engine ever told it the value had moved.
 */
function stubControl(
  mark: string,
  draw: (args: SchemaFormControlArgs) => string,
): SchemaFormMountedControl {
  return {
    mount(host, args) {
      host.dataset["stub"] = mark;
      const paint = (next: SchemaFormControlArgs): void => {
        host.textContent = draw(next);
      };
      paint(args);
      return { dispose: () => host.replaceChildren(), update: paint };
    },
  };
}

/** The node a {@link stubControl} drew, by the mark it carries. */
function stub(root: ParentNode, mark: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-stub="${mark}"]`);
}

installMockPlatform();

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  const el = document.createElement("div");
  el.id = id;
  document.body.append(el);
}
initLayers();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const settle = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Every container this file has attached, so one test's DOM never outlives it. */
const containers: HTMLElement[] = [];

interface Mount {
  container: HTMLElement;
  patches: SchemaFormPatch[];
  renders: { count: number };
  /** Re-run the engine over a new value, the way a host's repaint does. */
  repaint: (value: JsonObject) => Promise<void>;
}

type Opts = Omit<RenderFormOptions, "onChange"> & { withRerender?: boolean };

/**
 * Mount a form into an attached container of its own, recording every patch.
 *
 * The form key is unique per mount, so two forms in one test never share a standing mount.
 */
async function mountForm(schema: JsonSchema, value: JsonObject, opts: Opts = {}): Promise<Mount> {
  const { withRerender, ...rest } = opts;
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const patches: SchemaFormPatch[] = [];
  const renders = { count: 0 };
  const key = `test:${containers.length}`;
  const build = (next: JsonObject) =>
    mountSchemaForm(key, schema, next, {
      onChange: (patch) => patches.push(patch),
      ...rest,
      ...(withRerender && {
        rerender: () => {
          renders.count += 1;
        },
      }),
    });
  container.append(build(value));
  await flush(6);
  return {
    container,
    patches,
    renders,
    async repaint(next) {
      build(next);
      await flush(4);
    },
  };
}

/** One row of the form, by the property it edits. */
function row(m: Mount, prop: string): HTMLElement {
  const el = m.container.querySelector(`[data-prop="${prop}"]`);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`no field row ${prop}`);
  }
  return el;
}

/** A named part inside a row. */
function part(m: Mount, prop: string, name: string): Element {
  const el = row(m, prop).querySelector(`[part="${name}"]`);
  if (!el) {
    throw new Error(`no [part="${name}"] in row ${prop}`);
  }
  return el;
}

/** The native elements a kit field reads and writes its value through. */
type NativeControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** `el` as the native control it must be; anything else means the field drew no control. */
function asNativeControl(el: Element | null, where: string): NativeControl {
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return el;
  }
  throw new Error(`no native control ${where}`);
}

/** The native control a kit field is made of. */
function control(m: Mount, prop: string, widget: string): NativeControl {
  return asNativeControl(
    part(m, prop, widget).querySelector('[part="input"], [part="control"]'),
    `in [part="${widget}"] of row ${prop}`,
  );
}

/** Type into a control the way a reader does: it reports, and the event bubbles. */
function type(el: Element, value: string): void {
  const target = asNativeControl(el, "to type into");
  target.value = value;
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Commit a control: the value is set and `change` fires, as a blur or a pick does. */
function commit(el: Element, value: string): void {
  const target = asNativeControl(el, "to commit");
  target.value = value;
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Toggle a kit checkbox the way a reader does: through its native box, whose `change` bubbles to
 * the `jx-checkbox` host the form listens on.
 */
function check(m: Mount, prop: string, next: boolean): void {
  const box = part(m, prop, "checkbox").querySelector('[part="input"]');
  if (!(box instanceof HTMLInputElement)) {
    throw new Error(`no native checkbox in row ${prop}`);
  }
  box.checked = next;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The values a select offers, in order. */
function options(el: Element): (string | null)[] {
  return [...el.querySelectorAll('[part="option"]')].map((o) => o.getAttribute("value"));
}

/** The rung picker the Value Source chip opens. */
async function openSourceMenu(m: Mount, prop: string): Promise<HTMLElement> {
  pointer(part(m, prop, "source").querySelector('[part="control"]')!, "click");
  await flush(6);
  const menu = document.querySelector('[data-jx-region="overlay.menu:value-source"] jx-menu');
  if (!(menu instanceof HTMLElement)) {
    throw new Error("the value-source menu did not open");
  }
  return menu;
}

const ctxOver = (projectConfig: ProjectConfig): SchemaFormContext => ({
  resolvePointer: (ptr, scope) =>
    resolveContextPointer(ptr, { projectConfig, ...(scope !== undefined && { scope }) }),
});

beforeEach(() => {
  resetSchemaForms();
  resetSlotModeMemory();
});

afterEach(() => {
  resetSchemaForms();
  for (const node of containers.splice(0)) {
    node.remove();
  }
});

// ─── parseNumericField / resolveFormEnum ─────────────────────────────────────

describe("parseNumericField", () => {
  test("parses integers, floats, and blank input", () => {
    expect(parseNumericField("7.9", true)).toBe(7);
    expect(parseNumericField("7.9", false)).toBe(7.9);
    expect(Number.isNaN(parseNumericField("  ", true))).toBe(true);
  });
});

describe("resolveFormEnum", () => {
  const ctx = ctxOver({ content: { page: {}, post: {} } });

  test("plain arrays pass through", () => {
    expect(resolveFormEnum(["a", "b"], ctx)).toEqual(["a", "b"]);
  });

  test("$ref objects resolve through the context (object → keys)", () => {
    expect(resolveFormEnum({ $ref: "#/$context/content" }, ctx)).toEqual(["page", "post"]);
  });

  test("string-array resolutions map to strings", () => {
    const listCtx: SchemaFormContext = { resolvePointer: () => ["x", 1] };
    expect(resolveFormEnum({ $ref: "#/$context/anything" }, listCtx)).toEqual(["x", "1"]);
  });

  test("sentinel strings route through the resolver", () => {
    const sentinelCtx: SchemaFormContext = {
      resolvePointer: (ptr) => (ptr === "$contentTypes" ? { doc: {} } : undefined),
    };
    expect(resolveFormEnum("$contentTypes", sentinelCtx)).toEqual(["doc"]);
  });

  test("unresolvable shapes and missing context yield undefined", () => {
    expect(resolveFormEnum({ $ref: "#/$context/nope" }, ctx)).toBeUndefined();
    expect(resolveFormEnum({}, ctx)).toBeUndefined();
    expect(resolveFormEnum({ $ref: 5 }, ctx)).toBeUndefined();
    expect(resolveFormEnum(42, ctx)).toBeUndefined();
    expect(resolveFormEnum("$contentTypes")).toBeUndefined();
  });
});

// ─── validateFieldValue ──────────────────────────────────────────────────────

describe("validateFieldValue", () => {
  test("a binding is never judged, and an empty optional field is not an error", () => {
    expect(validateFieldValue({ type: "number" }, { $ref: "#/state/n" }, true)).toBe("");
    expect(validateFieldValue({ type: "string" }, "", false)).toBe("");
    expect(validateFieldValue({ type: "string" }, "", true)).toBe("Required.");
  });

  test("the checks a property schema can make on its own", () => {
    expect(validateFieldValue({ enum: ["a"] }, "b", false)).toBe("Choose one of: a.");
    expect(validateFieldValue({ type: "number" }, "nope", false)).toBe("Enter a number.");
    expect(validateFieldValue({ type: "integer" }, 1.5, false)).toBe("Enter a whole number.");
    expect(validateFieldValue({ minimum: 2, type: "number" }, 1, false)).toBe("Must be 2 or more.");
    expect(validateFieldValue({ maximum: 2, type: "number" }, 3, false)).toBe("Must be 2 or less.");
    expect(validateFieldValue({ type: "boolean" }, "yes", false)).toBe("Must be true or false.");
    expect(validateFieldValue({ type: "array" }, {}, false)).toBe("Must be a list.");
    expect(validateFieldValue({ type: "object" }, [], false)).toBe("Must be an object.");
    expect(validateFieldValue({ type: "object" }, {}, false)).toBe("");
  });
});

// ─── Basic dispatch and patch semantics ──────────────────────────────────────

describe("form dispatch", () => {
  test("required props are marked; ps.name overrides the row's identity", async () => {
    const m = await mountForm(
      {
        properties: {
          renamed: { name: "customProp", type: "string" },
          title: { type: "string" },
        },
        required: ["title"],
      },
      {},
    );
    expect(row(m, "title").dataset["required"]).toBeDefined();
    expect(part(m, "title", "label").textContent).toBe("title");
    expect(m.container.querySelector('[data-prop="customProp"]')).not.toBeNull();
  });

  /* An entry's `date` was a free textbox with the raw key as its label. A `format: "date"` field is
     a date input, and a host can title a row in words. */
  test("a date field is a date input showing its day; a ui label titles the row", async () => {
    const m = await mountForm(
      {
        properties: {
          link: { format: "uri", type: "string" },
          publishedAt: { format: "date", type: "string" },
          stamp: { format: "date", type: "string" },
          title: { type: "string" },
        },
      },
      { link: "https://x.test", publishedAt: "2026-09-30", stamp: "2026-10-01T08:00:00.000Z" },
      { ui: { publishedAt: { label: "Published at" } } },
    );
    const typeOf = (prop: string) => control(m, prop, "text").type;
    expect([typeOf("publishedAt"), typeOf("stamp"), typeOf("link"), typeOf("title")]).toEqual([
      "date",
      "date",
      "url",
      "text",
    ]);
    expect(control(m, "stamp", "text").value).toBe("2026-10-01");
    expect(part(m, "publishedAt", "label").textContent).toBe("Published at");
    expect(part(m, "title", "label").textContent).toBe("title");
  });

  test("string fields commit debounced patches; blank clears to undefined", async () => {
    const m = await mountForm(
      { properties: { empty: { type: "string" }, source: { type: "string" } } },
      { empty: "remove-me" },
    );
    type(control(m, "source", "text"), "posts");
    type(control(m, "empty", "text"), "");
    await settle(460);
    expect(m.patches).toContainEqual({ source: "posts" });
    expect(m.patches).toContainEqual({ empty: undefined });
  });

  test("string placeholder prefers default, falls back to examples", async () => {
    const m = await mountForm(
      {
        properties: {
          a: { default: "dflt", type: "string" },
          b: { examples: ["ex1"], type: "string" },
        },
      },
      {},
    );
    expect(control(m, "a", "text").getAttribute("placeholder")).toBe("dflt");
    expect(control(m, "b", "text").getAttribute("placeholder")).toBe("ex1");
  });

  test("a description becomes the row's help sentence", async () => {
    const m = await mountForm(
      { properties: { host: { description: "Where the API lives.", type: "string" } } },
      {},
    );
    expect(part(m, "host", "help").textContent).toContain("Where the API lives.");
  });

  test("enum fields commit values, clear via —, and hide — when required", async () => {
    const m = await mountForm(
      {
        properties: {
          kind: { enum: ["x", "y"] },
          layout: { default: "grid", enum: ["grid", "list"] },
        },
        required: ["kind"],
      },
      {},
    );
    const layout = control(m, "layout", "select");
    expect(layout.value).toBe("grid");
    commit(layout, "list");
    commit(layout, "__none__");
    expect(m.patches).toEqual([{ layout: "list" }, { layout: undefined }]);
    expect(options(control(m, "kind", "select"))).toEqual(["x", "y"]);
  });

  test("boolean renders a checkbox committing checked state", async () => {
    const m = await mountForm({ properties: { live: { type: "boolean" } } }, {});
    check(m, "live", true);
    expect(m.patches).toEqual([{ live: true }]);
  });

  test("integer/number fields carry their bounds, parse on commit, and clear on blank", async () => {
    const m = await mountForm(
      {
        properties: {
          limit: { maximum: 100, minimum: 1, type: "integer" },
          old: { type: "integer" },
          ratio: { type: "number" },
        },
      },
      { old: 3 },
    );
    const limit = control(m, "limit", "number");
    expect(limit.getAttribute("min")).toBe("1");
    expect(limit.getAttribute("max")).toBe("100");
    commit(limit, "7");
    commit(control(m, "ratio", "number"), "2.5");
    commit(control(m, "old", "number"), "");
    expect(m.patches).toContainEqual({ limit: 7 });
    expect(m.patches).toContainEqual({ ratio: 2.5 });
    expect(m.patches).toContainEqual({ old: undefined });
  });

  test("array/object props are edited as JSON, and only parsable text commits", async () => {
    const m = await mountForm(
      { properties: { bad: { type: "object" }, tags: { default: [], type: "array" } } },
      { bad: { keep: true } },
    );
    expect(control(m, "tags", "json-text").getAttribute("placeholder")).toBe("[]");
    type(control(m, "tags", "json-text"), '["a","b"]');
    type(control(m, "bad", "json-text"), "{nope");
    await settle(560);
    expect(m.patches).toEqual([{ tags: ["a", "b"] }]);
  });

  test("a union with an object in it is edited as JSON, so false and a map both commit as what they are", async () => {
    const m = await mountForm(
      { properties: { alerts: { type: ["object", "boolean"] } } },
      { alerts: { NOTE: "doc-note" } },
    );
    expect(control(m, "alerts", "json-text").value).toContain('"NOTE": "doc-note"');
    type(control(m, "alerts", "json-text"), "false");
    await settle(560);
    type(control(m, "alerts", "json-text"), '{"INFO":true}');
    await settle(560);
    expect(m.patches).toEqual([{ alerts: false }, { alerts: { INFO: true } }]);
  });

  test("a json-schema field names the shape it holds and commits parsed JSON", async () => {
    const m = await mountForm(
      { properties: { itemSchema: { format: "json-schema", type: "object" } } },
      { itemSchema: { properties: { count: { type: "number" }, name: {} }, type: "object" } },
    );
    const chips = [...row(m, "itemSchema").querySelectorAll('[part="chip"]')].map((el) =>
      el.textContent.trim(),
    );
    expect(chips).toEqual(["count: number", "name: any"]);

    type(control(m, "itemSchema", "json-text"), '{"type":"object"}');
    await settle(560);
    type(control(m, "itemSchema", "json-text"), "{broken");
    await settle(560);
    // The invalid text is ignored; only the parsed JSON committed.
    expect(m.patches).toEqual([{ itemSchema: { type: "object" } }]);
  });

  test("a json-schema field holding a $ref keeps the editor and names no shape", async () => {
    const m = await mountForm(
      { properties: { itemSchema: { format: "json-schema", type: "object" } } },
      { itemSchema: { $ref: "#/defs/thing" } },
    );
    expect(part(m, "itemSchema", "json-text")).not.toBeNull();
    expect(row(m, "itemSchema").querySelectorAll('[part="chip"]')).toHaveLength(0);
  });
});

// ─── The Value Source ladder (§6.6) ──────────────────────────────────────────

describe("binding a config field", () => {
  const schema: JsonSchema = { properties: { id: { type: "string" } } };
  const sourced = (over: Partial<SchemaFormContext> = {}): SchemaFormContext => ({
    fieldKeyPrefix: "cfg",
    params: ["sku"],
    resolvePointer: () => {
      // No context data in this test
    },
    ...over,
  });

  test("a host that names no source draws no chip — settings forms edit fixed values", async () => {
    const m = await mountForm(schema, { id: "abc" });
    expect(m.container.querySelector('[part="source"]')).toBeNull();
    expect(part(m, "id", "text")).not.toBeNull();
  });

  test("without a source, a ref left in the record is edited as the pointer string it is", async () => {
    const m = await mountForm(schema, { id: { $ref: "#/$params/sku" } });
    const tf = control(m, "id", "text");
    expect(tf.value).toBe("#/$params/sku");
    commit(tf, "#/other/path");
    commit(tf, "  ");
    expect(m.patches).toEqual([{ id: { $ref: "#/other/path" } }, { id: undefined }]);
  });

  test("a plain string field offers the whole ladder — the way IN to a binding", async () => {
    const m = await mountForm(schema, { id: "abc" }, { context: sourced() });
    // What the chip PRINTS: its label part, since an enabled hint is a tip child of the host.
    expect(printedOf(part(m, "id", "source"))).toBe("Fixed value");
    const menu = await openSourceMenu(m, "id");
    const rungs = [...menu.querySelectorAll<HTMLElement>("jx-menu-item")];
    expect(rungs.map((r) => r.dataset["commandId"])).toEqual(["literal", "ref", "template"]);
    expect(rungs.map((r) => r.textContent!.trim())).toEqual([
      "Fixed value",
      "From data…",
      "Mixed text",
    ]);
  });

  test("choosing From data… binds to the first source the host named", async () => {
    const m = await mountForm(schema, { id: "abc" }, { context: sourced() });
    const menu = await openSourceMenu(m, "id");
    menu.querySelector<HTMLElement>('[data-command-id="ref"]')!.click();
    await flush(2);
    expect(m.patches).toEqual([{ id: { $ref: "#/$params/sku" } }]);
  });

  test("signals and route params are both offered, and a pointer off the list is accepted", async () => {
    const m = await mountForm(
      schema,
      { id: { $ref: "#/$params/sku" } },
      { context: sourced({ signals: ["query"] }) },
    );
    const pick = control(m, "id", "pointer-pick");
    expect(options(pick)).toEqual(["#/state/query", "#/$params/sku"]);
    expect(pick.value).toBe("#/$params/sku");

    /* The kit has no combobox, so the rung is two controls over one value: the select offers what
       the host named and the field takes anything. */
    const free = control(m, "id", "pointer");
    expect(free.value).toBe("#/$params/sku");
    commit(free, "#/state/query/id");
    expect(m.patches).toEqual([{ id: { $ref: "#/state/query/id" } }]);
  });

  test("an enum field is never offered Mixed text, because its schema forbids one", async () => {
    const m = await mountForm(
      { properties: { method: { enum: ["GET", "POST"] } } },
      {},
      { context: sourced() },
    );
    const menu = await openSourceMenu(m, "method");
    expect(
      [...menu.querySelectorAll<HTMLElement>("jx-menu-item")].map((r) => r.dataset["commandId"]),
    ).toEqual(["literal", "ref"]);
  });

  test("fields edited as raw JSON, and fields a ui control owns, keep their whole widget", async () => {
    registerFormControl(
      "owns-it",
      stubControl("owns-it", ({ key }) => key),
    );
    const m = await mountForm(
      {
        properties: {
          fields: { type: "object" },
          itemSchema: { format: "json-schema", type: "object" },
          token: { type: "string" },
        },
      },
      {},
      { context: sourced(), ui: { token: { control: "owns-it" } } },
    );
    for (const prop of ["fields", "itemSchema", "token"]) {
      expect(row(m, prop).querySelector('[part="source"]')).toBeNull();
    }
    expect(stub(m.container, "owns-it")).not.toBeNull();
  });

  test("the chip states a rung it cannot leave rather than going quiet", async () => {
    const m = await mountForm(
      { properties: { pick: { type: "string" } } },
      { pick: "x" },
      {
        context: {
          fieldKeyPrefix: "cfg",
          resolvePointer: () => {
            // Nothing to resolve here
          },
          signals: [],
        },
      },
    );
    // No source named at all: no ladder, and therefore no chip.
    expect(m.container.querySelector('[part="source"]')).toBeNull();
  });
});

// ─── Image objects ───────────────────────────────────────────────────────────

describe("an image object field", () => {
  const IMAGE = {
    properties: {
      featuredImage: {
        properties: {
          alt: { type: "string" },
          height: { type: "number" },
          src: { type: "string" },
          width: { type: "number" },
        },
        type: "object",
      },
      seo: { properties: { title: { type: "string" } }, type: "object" },
    },
  };

  test("is the media field over its src, and its alt text is a row of its own", async () => {
    const seen: SchemaFormControlArgs[] = [];
    registerFormControl("media", {
      mount(host, args) {
        let latest = args;
        seen.push(args);
        const button = document.createElement("button");
        button.dataset["stub"] = "media";
        button.textContent = String(args.value);
        button.addEventListener("click", () => latest.onChange(button.dataset["next"]));
        host.replaceChildren(button);
        return {
          dispose: () => host.replaceChildren(),
          update: (next) => {
            latest = next;
            seen.push(next);
          },
        };
      },
    });
    const value = { featuredImage: { alt: "A barn", height: 5, src: "/a.jpg", width: 10 } };
    const m = await mountForm(IMAGE, value);
    const media = stub(m.container, "media")!;
    // The media field is handed the picture's path, not the object.
    expect(media.textContent).toBe("/a.jpg");
    // An object that is no image stays the JSON it is.
    expect(row(m, "seo").querySelector('[part="json"], textarea')).not.toBeNull();

    // A new picture keeps its alt text and drops the old picture's size.
    media.dataset["next"] = "/b.jpg";
    media.click();
    // The same picture again is no change; clearing the picture clears the image.
    media.dataset["next"] = "/a.jpg";
    media.click();
    delete media.dataset["next"];
    media.click();
    expect(m.patches).toEqual([
      { featuredImage: { alt: "A barn", src: "/b.jpg" } },
      { featuredImage: undefined },
    ]);

    // The alt text row writes the object back with that one member changed, or removed.
    const alt = row(m, "featuredImage/alt");
    expect(alt.textContent).toContain("featuredImage alt text");
    commit(control(m, "featuredImage/alt", "text"), "A red barn");
    commit(control(m, "featuredImage/alt", "text"), "");
    expect(m.patches.slice(2)).toEqual([
      { featuredImage: { alt: "A red barn", height: 5, src: "/a.jpg", width: 10 } },
      { featuredImage: { height: 5, src: "/a.jpg", width: 10 } },
    ]);
    expect(seen.length).toBeGreaterThan(0);
  });

  test("an image object with no alt member draws no alt row", async () => {
    resetSchemaForms();
    const bare = {
      properties: {
        icon: { properties: { src: { type: "string" } }, type: "object" },
      },
    };
    const m = await mountForm(bare, { icon: { src: "/i.svg" } });
    expect(m.container.querySelector('[data-prop="icon/alt"]')).toBeNull();
  });
});

// ─── The control registry ────────────────────────────────────────────────────

describe("control registry and ui overrides", () => {
  /**
   * There is no public lookup to assert against any more — `getFormControl` handed a TEMPLATE
   * control to a lit caller that would interpolate it, and a mounted control needs a HOST, which
   * only the engine has. So registration is proved the way it matters: the engine draws the
   * registered control for the field the override names, and what the control commits reaches the
   * host. The other half — a name nothing registered — is the fall-through test below.
   */
  test("a registered control wins via a ui override, and its commit reaches the host", async () => {
    registerFormControl("stub-control", {
      mount(host, args) {
        let latest = args;
        const button = document.createElement("button");
        button.dataset["stub"] = "stub-control";
        button.textContent = args.key;
        button.addEventListener("click", () => latest.onChange(`${String(latest.value)}!`));
        host.replaceChildren(button);
        return {
          dispose: () => host.replaceChildren(),
          update: (next) => {
            latest = next;
          },
        };
      },
    });

    const m = await mountForm(
      { properties: { field: { type: "string" } } },
      { field: "v" },
      { ui: { field: { control: "stub-control" } } },
    );
    const button = stub(m.container, "stub-control");
    expect(button?.textContent).toBe("field");
    pointer(button!, "click");
    expect(m.patches).toEqual([{ field: "v!" }]);
  });

  test("a control redraws from the value the last repaint handed the engine", async () => {
    registerFormControl(
      "echo",
      stubControl("echo", ({ value }) => String(value)),
    );
    const m = await mountForm(
      { properties: { field: { type: "string" } } },
      { field: "one" },
      { ui: { field: { control: "echo" } } },
    );
    const host = stub(m.container, "echo")!;
    expect(host.textContent).toBe("one");
    await m.repaint({ field: "two" });
    /* The SAME host says the new value: the standing control was told the value moved rather than
       being disposed and mounted again, which is what keeps a caret in a control the reader is in
       when the field beside it commits. */
    expect(stub(m.container, "echo")).toBe(host);
    expect(host.textContent).toBe("two");
  });

  test("unknown ui overrides fall through to the default control", async () => {
    const m = await mountForm(
      { properties: { field: { type: "boolean" } } },
      {},
      { ui: { field: { control: "never-registered" } } },
    );
    expect(part(m, "field", "checkbox")).not.toBeNull();
    expect(stub(m.container, "never-registered")).toBeNull();
  });

  test("ui enum overrides layer dynamic $context choices over a plain string field", async () => {
    const m = await mountForm(
      { properties: { connection: { type: "string" } } },
      {},
      {
        context: ctxOver({
          connections: { main: { provider: "d1" }, replica: { provider: "sqlite" } },
        }),
        ui: { connection: { enum: { $ref: "#/$context/connections" } } },
      },
    );
    const select = control(m, "connection", "select");
    expect(options(select)).toEqual(["__none__", "main", "replica"]);
    commit(select, "replica");
    expect(m.patches).toEqual([{ connection: "replica" }]);
  });
});

// ─── Array-of-objects rows ───────────────────────────────────────────────────

describe("array-of-objects fields", () => {
  const columnsSchema: JsonSchema = {
    properties: {
      columns: {
        items: {
          properties: {
            align: { enum: ["left", "right"] },
            label: { default: "col", type: "string" },
            visible: { type: "boolean" },
            width: { type: "integer" },
          },
          type: "object",
        },
        type: "array",
      },
    },
  };

  test("draws a typed control per declared property and edits an item in place", async () => {
    const m = await mountForm(columnsSchema, {
      columns: [{ align: "left", label: "a", visible: true, width: 2 }],
    });
    const first = row(m, "columns").querySelector('[part="row"]')!;
    expect(first.querySelector('[part="cell-select"]')).not.toBeNull();
    expect(first.querySelector('[part="cell-checkbox"]')).not.toBeNull();
    expect(first.querySelector('[part="cell-number"]')).not.toBeNull();

    type(first.querySelector('[part="cell-text"] [part="input"]')!, "renamed");
    expect(m.patches).toEqual([
      { columns: [{ align: "left", label: "renamed", visible: true, width: 2 }] },
    ]);
  });

  test("add seeds item defaults; remove takes a row out and clears the last one", async () => {
    const m = await mountForm(columnsSchema, {}, { withRerender: true });
    pointer(part(m, "columns", "row-add").querySelector('[part="control"]')!, "click");
    expect(m.patches).toEqual([{ columns: [{ label: "col" }] }]);
    expect(m.renders.count).toBe(1);

    const two = await mountForm(columnsSchema, { columns: [{ label: "a" }, { label: "b" }] });
    pointer(row(two, "columns").querySelector('[part="row-remove"] [part="control"]')!, "click");
    expect(two.patches).toEqual([{ columns: [{ label: "b" }] }]);

    const one = await mountForm(columnsSchema, { columns: [{ label: "only" }] });
    pointer(row(one, "columns").querySelector('[part="row-remove"] [part="control"]')!, "click");
    expect(one.patches).toEqual([{ columns: undefined }]);
  });

  test("a cell holding a $ref edits the pointer string directly", async () => {
    const m = await mountForm(
      {
        properties: {
          columns: {
            items: { properties: { source: { type: "string" } }, type: "object" },
            type: "array",
          },
        },
      },
      { columns: [{ source: { $ref: "#/$params/sku" } }] },
    );
    const cell = row(m, "columns").querySelector<HTMLInputElement>(
      '[part="cell-text"] [part="input"]',
    )!;
    expect(cell.value).toBe("#/$params/sku");
    commit(cell, "#/$params/other");
    expect(m.patches).toEqual([{ columns: [{ source: { $ref: "#/$params/other" } }] }]);
  });

  test("cell enums resolve dependent refs against the whole form value", async () => {
    const m = await mountForm(
      {
        properties: {
          fields: {
            items: {
              properties: {
                name: { enum: { $ref: "#/$context/content/{@type}/schema/properties" } },
              },
              type: "object",
            },
            type: "array",
          },
        },
      },
      { fields: [{}], type: "post" },
      {
        context: ctxOver({
          content: { post: { schema: { properties: { slug: {}, title: {} } } } },
        }),
      },
    );
    expect(options(control(m, "fields", "cell-select"))).toEqual(["__none__", "slug", "title"]);
  });
});

// ─── Arrays of single values ─────────────────────────────────────────────────

describe("arrays of single values", () => {
  const tagsSchema: JsonSchema = {
    properties: { tags: { items: { type: "string" }, type: "array" } },
  };

  test("a list of text is a row per item, named by its place, not a JSON box", async () => {
    const m = await mountForm(tagsSchema, { tags: ["Patios", "Walls"] });
    expect(row(m, "tags").querySelector('[part="json"]')).toBeNull();
    const cells = [
      ...row(m, "tags").querySelectorAll<HTMLInputElement>('[part="cell-text"] [part="input"]'),
    ];
    expect(cells.map((cell) => cell.value)).toEqual(["Patios", "Walls"]);
    type(cells[1]!, "Steps");
    expect(m.patches).toEqual([{ tags: ["Patios", "Steps"] }]);
  });

  test("clearing an item keeps its row; add appends one; remove takes one out", async () => {
    const m = await mountForm(tagsSchema, { tags: ["a", "b"] }, { withRerender: true });
    type(row(m, "tags").querySelector('[part="cell-text"] [part="input"]')!, "");
    expect(m.patches.at(-1)).toEqual({ tags: ["", "b"] });
    pointer(part(m, "tags", "row-add").querySelector('[part="control"]')!, "click");
    expect(m.patches.at(-1)).toEqual({ tags: ["a", "b", ""] });
    pointer(row(m, "tags").querySelector('[part="row-remove"] [part="control"]')!, "click");
    expect(m.patches.at(-1)).toEqual({ tags: ["b"] });

    const one = await mountForm(tagsSchema, { tags: ["only"] });
    pointer(row(one, "tags").querySelector('[part="row-remove"] [part="control"]')!, "click");
    expect(one.patches).toEqual([{ tags: undefined }]);
  });

  test("a value that is not a list yet is shown as its one item", async () => {
    const m = await mountForm(tagsSchema, { tags: "Patios" });
    const cell = row(m, "tags").querySelector<HTMLInputElement>(
      '[part="cell-text"] [part="input"]',
    )!;
    expect(cell.value).toBe("Patios");
    const empty = await mountForm(tagsSchema, { tags: "" });
    expect(row(empty, "tags").querySelector('[part="row"]')).toBeNull();
  });

  test("numbers and enums draw their own cells; a JSON-schema item stays JSON", async () => {
    const m = await mountForm(
      {
        properties: {
          kinds: { items: { enum: ["a", "b"] }, type: "array" },
          sizes: { items: { type: "integer" }, type: "array" },
          schemas: { items: { format: "json-schema", type: "string" }, type: "array" },
        },
      },
      { kinds: ["a"], schemas: [], sizes: [3] },
    );
    expect(row(m, "sizes").querySelector('[part="cell-number"]')).not.toBeNull();
    expect(row(m, "kinds").querySelector('[part="cell-select"]')).not.toBeNull();
    expect(row(m, "schemas").querySelector('[part="row"]')).toBeNull();
  });

  test("a picture item is the registered media control, writing the list back", async () => {
    const seen: SchemaFormControlArgs[] = [];
    registerFormControl(
      "media",
      stubControl("media-cell", (args) => {
        seen.push(args);
        return String(args.value);
      }),
    );
    const m = await mountForm(
      { properties: { gallery: { items: { format: "image", type: "string" }, type: "array" } } },
      { gallery: ["/a.jpg", "/b.jpg"] },
    );
    expect(stub(row(m, "gallery"), "media-cell")?.textContent).toBe("/a.jpg");
    seen.find((args) => args.value === "/b.jpg")!.onChange("/c.jpg");
    expect(m.patches).toEqual([{ gallery: ["/a.jpg", "/c.jpg"] }]);
  });
});

// ─── Inline errors (§16.5) ───────────────────────────────────────────────────

describe("inline errors", () => {
  test("a host message is announced at the control, with a repeat counter from two up", async () => {
    const m = await mountForm(
      { properties: { port: { type: "string" }, url: { type: "string" } } },
      { port: "80", url: "x" },
      { errorCounts: { url: 3 }, errors: { url: "Not a URL." } },
    );
    const line = part(m, "url", "field-error");
    expect(line.getAttribute("role")).toBe("alert");
    expect(line.textContent).toContain("Not a URL.");
    expect(part(m, "url", "field-error-count").textContent).toBe("×3");
    expect(row(m, "url").dataset["invalid"]).toBeDefined();
    expect(row(m, "port").querySelector('[part="field-error"]')).toBeNull();
  });

  test("required-but-empty is silent until the host asks for it", async () => {
    const quiet = await mountForm(
      { properties: { name: { type: "string" } }, required: ["name"] },
      {},
    );
    expect(quiet.container.querySelector('[part="field-error"]')).toBeNull();

    const loud = await mountForm(
      { properties: { name: { type: "string" } }, required: ["name"] },
      {},
      { showRequired: true },
    );
    expect(part(loud, "name", "field-error").textContent).toContain("Required.");
  });

  test("a host message wins over the intrinsic check", async () => {
    const m = await mountForm(
      { properties: { kind: { enum: ["a"] } } },
      { kind: "b" },
      { errors: { kind: "That connector was deleted." } },
    );
    expect(part(m, "kind", "field-error").textContent).toContain("That connector was deleted.");
  });
});

// ─── The standing mount ──────────────────────────────────────────────────────

describe("the standing mount", () => {
  test("the same key updates the form in place rather than building a second one", async () => {
    const m = await mountForm({ properties: { a: { type: "string" } } }, { a: "one" });
    const input = control(m, "a", "text");
    await m.repaint({ a: "two" });
    expect(control(m, "a", "text")).toBe(input);
    expect(input.value).toBe("two");
    expect(m.container.querySelectorAll('[part="form"]')).toHaveLength(1);
  });

  test("a document taken out of its host is put back by the next update", async () => {
    const m = await mountForm({ properties: { a: { type: "string" } } }, { a: "one" });
    // Something else emptied the host — the one case an assignment to the scope cannot answer.
    m.container.querySelector('[part="form"]')!.remove();
    await m.repaint({ a: "two" });
    await flush(4);
    expect(m.container.querySelector('[part="form"]')).not.toBeNull();
    expect(control(m, "a", "text").value).toBe("two");
  });

  test("a form taken down while its mount is in flight leaves nothing behind", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    container.append(
      mountSchemaForm(
        "in-flight",
        { properties: { a: { type: "string" } } },
        {},
        { onChange: () => {} },
      ),
    );
    // Down before the mount settles: the document that lands has nowhere to be.
    resetSchemaForms();
    await flush(6);
    expect(container.querySelector('[part="field"]')).toBeNull();
  });

  test("a form whose host has left the page is swept when another is mounted", async () => {
    const gone = document.createElement("div");
    document.body.append(gone);
    gone.append(mountSchemaForm("swept", { properties: {} }, {}, { onChange: () => {} }));
    await flush(4);
    gone.remove();

    const kept = document.createElement("div");
    document.body.append(kept);
    containers.push(kept);
    kept.append(mountSchemaForm("kept", { properties: {} }, {}, { onChange: () => {} }));
    await flush(4);
    // The swept form's host was emptied by its dispose; the standing one is untouched.
    expect(gone.querySelector('[part="form"]')).toBeNull();
    expect(kept.querySelector('[part="form"]')).not.toBeNull();
  });
});
