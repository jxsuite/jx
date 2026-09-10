/**
 * Tests for src/ui/form-controls.ts — the built-in "schema-builder" and "secret" form controls.
 *
 * **The schema-builder is a document now** (`src/surfaces/schema-builder.json`), so four things
 * about the first half of this file are deliberate rather than incidental:
 *
 * - It is registered as a MOUNT, not as a template. `builder.mount(host, args)` is called once and
 *   every later paint of the form reaches it through `handle.update(args)` — which is what the
 *   engine does, and what {@link mountBuilder} imitates for a host of its own.
 * - The host is APPENDED TO THE DOCUMENT. A kit element renders in `connectedCallback`, so a detached
 *   host gets `<jx-textfield>` tags with nothing inside them and every assertion about a control
 *   reads `null` — a failure that looks like a missing element rather than a missing connection.
 * - Everything is addressed by `part` and by the field's `data-field` key. There is no
 *   `.schema-field-card` or `sp-picker` to find, and a card is never addressed by its position.
 * - An edit is made on the NATIVE control inside the kit element, never on the element: the kit hears
 *   its own input's event and lets it bubble on, so writing the host's `value` property would be
 *   moving the control without telling it.
 *
 * The secret control is still a lit template over Spectrum (its header says why), so its tests
 * render it and address Spectrum elements, exactly as before.
 */
import { flush, key, pointer } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { html, render } from "lit-html";
import {
  builtinFormControls,
  resetFormControlUiState,
  schemaBuilderControl,
} from "../src/ui/form-controls";
import { getFormControl, mountSchemaForm, resetSchemaForms } from "../src/ui/schema-form";
import type {
  SchemaFormContext,
  SchemaFormControlArgs,
  SchemaFormControlHandle,
} from "../src/ui/schema-form";

type ValueEl = HTMLElement & { value: string };

const inertCtx: SchemaFormContext = {
  resolvePointer: () => {
    // No context data
  },
};

const contentTypesCtx: SchemaFormContext = {
  resolvePointer: (ptr) => (ptr === "#/$context/content" ? { page: {}, post: {} } : undefined),
};

/**
 * Let the document catch up.
 *
 * Generous on purpose, and in one place: the mount awaits the kit's registration and each kit
 * element builds its own scope in `connectedCallback`. A per-test turn count would be a dozen
 * guesses at the same number.
 */
async function settle(): Promise<void> {
  await flush(6);
}

interface BuilderMount {
  host: HTMLElement;
  handle: SchemaFormControlHandle;
  /** Every value the control has committed, in order. */
  patches: unknown[];
  /** The value the host is holding — what the control is drawn from after a redraw. */
  state: { value: unknown };
  /** Let the document catch up after an interaction. */
  settle: () => Promise<void>;
}

const hosts: HTMLElement[] = [];

/**
 * Mount the schema-builder over a value a host keeps and redraws from.
 *
 * `redraws: false` is the OTHER kind of host — `panels/frontmatter-fields.ts` passes no `rerender`
 * and never comes back — so what the cards show after a commit is the commit itself.
 */
async function mountBuilder(
  initial: unknown,
  { ctx = inertCtx, redraws = true }: { ctx?: SchemaFormContext; redraws?: boolean } = {},
): Promise<BuilderMount> {
  const builder = schemaBuilderControl;
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const state = { value: initial };
  const patches: unknown[] = [];
  let handle: SchemaFormControlHandle | null = null;
  const args = (): SchemaFormControlArgs => ({
    ctx,
    key: "schema",
    onChange: (next) => {
      patches.push(next);
      if (redraws) {
        state.value = next;
        handle?.update(args());
      }
    },
    schema: { format: "json-schema", type: "object" },
    value: state.value,
  });
  handle = builder.mount(host, args());
  await settle();
  return {
    handle,
    host,
    patches,
    settle,
    state,
  };
}

/** A node the document drew, by the `part` it carries. */
function part(root: ParentNode, name: string): HTMLElement {
  const el = root.querySelector(`[part="${name}"]`);
  if (!el) {
    throw new Error(`no [part="${name}"] in the schema builder`);
  }
  return el as HTMLElement;
}

/** The native control a kit element wraps: the field's input, or the picker's select. */
function control(el: Element): HTMLInputElement {
  const inner = el.querySelector<HTMLInputElement>(
    'input[part="input"], textarea[part="input"], select[part="control"]',
  );
  if (!inner) {
    throw new Error(`no native control inside <${el.tagName.toLowerCase()}>`);
  }
  return inner;
}

/** Type into a control and commit it, the way a reader does. */
function setAndFire(el: Element, value: string, type = "change"): void {
  const inner = control(el);
  inner.value = value;
  inner.dispatchEvent(new Event("input", { bubbles: true }));
  if (type !== "input") {
    inner.dispatchEvent(new Event(type, { bubbles: true }));
  }
}

/** Flip a switch, the way a reader does. */
function toggle(el: Element, checked: boolean): void {
  const inner = control(el);
  inner.checked = checked;
  inner.dispatchEvent(new Event("change", { bubbles: true }));
}

/** What a control currently shows. */
function shows(el: Element): string {
  return control(el).value;
}

/** One field's card, by the property it edits. */
function card(m: BuilderMount, field: string): HTMLElement {
  const el = m.host.querySelector(`[data-field="${field}"]`);
  if (!el) {
    throw new Error(`no field card for "${field}"`);
  }
  return el as HTMLElement;
}

/** A field's own row, so a parent object's controls are never mistaken for a child's. */
function row(m: BuilderMount, field: string): HTMLElement {
  return part(card(m, field), "field-row");
}

/** One control of a field's own row, by the part it carries rather than by its order. */
function fieldPart(m: BuilderMount, field: string, name: string): HTMLElement {
  return part(row(m, field), name);
}

/** One control of a field's card that is not on its row — the add row, the target picker. */
function cardPart(m: BuilderMount, field: string, name: string): HTMLElement {
  return part(card(m, field), name);
}

/** One child of an object field. Its card holds exactly one row, which is that child's. */
function nested(m: BuilderMount, parent: string, child: string): HTMLElement {
  const el = card(m, parent).querySelector(`[data-nested="${child}"]`);
  if (!el) {
    throw new Error(`no nested card for "${parent}.${child}"`);
  }
  return el as HTMLElement;
}

/** One control of a child's row. */
function nestedPart(m: BuilderMount, parent: string, child: string, name: string): HTMLElement {
  return part(nested(m, parent, child), name);
}

/** The property keys the builder is drawing, in order. */
function fieldKeys(m: BuilderMount): string[] {
  return [...m.host.querySelectorAll("[data-field]")].map(
    (el) => (el as HTMLElement).dataset.field ?? "",
  );
}

/** The values a picker is offering. */
function options(el: Element): string[] {
  return [...el.querySelectorAll('option[part="option"]')].map(
    (o) => o.getAttribute("value") ?? "",
  );
}

/** The schema as the host now holds it. */
function schemaOf(m: BuilderMount): {
  properties: Record<string, Record<string, any>>;
  required: string[];
  type?: string;
} {
  return m.state.value as never;
}

/** The last value the control committed. */
function lastPatch(m: BuilderMount): {
  properties: Record<string, Record<string, any>>;
  required: string[];
} {
  return m.patches.at(-1) as never;
}

beforeEach(() => {
  resetFormControlUiState();
});

afterEach(() => {
  document.body.replaceChildren();
  hosts.length = 0;
});

// ─── Registration ─────────────────────────────────────────────────────────────

describe("registration", () => {
  test("all three built-ins are registered on import", () => {
    expect(builtinFormControls).toEqual(["schema-builder", "secret", "reference"]);
    expect(schemaBuilderControl.mount).toBeInstanceOf(Function);
    expect(getFormControl("secret")).toBeDefined();
    expect(getFormControl("reference")).toBeDefined();
  });

  /**
   * The template lookup refuses a mounted control, on purpose: a lit caller that interpolated one
   * would get a document's handle where a template belongs. The two templates answer it, so the
   * refusal is about the KIND rather than about the name being unregistered.
   */
  test("a mounted control is not offered as a template", () => {
    expect(getFormControl("schema-builder")).toBeUndefined();
    expect(getFormControl("secret")).toBeDefined();
    expect(getFormControl("reference")).toBeDefined();
  });
});

// ─── The cards ───────────────────────────────────────────────────────────────

describe("the field cards", () => {
  const initial = () => ({
    properties: {
      count: { type: "number" },
      cover: { format: "image", type: "string" },
      title: { type: "string" },
    },
    required: ["title"],
    type: "object",
  });

  test("draws one card per property, keyed by the property it edits", async () => {
    const m = await mountBuilder(initial());
    expect(fieldKeys(m)).toEqual(["count", "cover", "title"]);
  });

  test("a card carries the name in words, the raw key, its type and its format", async () => {
    const m = await mountBuilder({
      properties: { heroImage: { format: "image", type: "string" } },
      required: [],
      type: "object",
    });
    const hero = card(m, "heroImage");
    expect(part(hero, "field-label").textContent).toBe("Hero Image");
    expect(shows(part(hero, "field-name"))).toBe("heroImage");
    expect(shows(part(hero, "field-type"))).toBe("string");
    expect(shows(part(hero, "field-format"))).toBe("image");
    expect(options(part(hero, "field-type"))).toEqual([
      "string",
      "number",
      "boolean",
      "array",
      "object",
      "reference",
    ]);
    // The empty format is named rather than blank: a blank row says nothing about choosing it.
    expect(options(part(hero, "field-format"))).toEqual(["", "image", "date", "color"]);
    expect(part(hero, "field-format").querySelector("option")?.textContent).toContain("(none)");
  });

  test("only string and array carry a format, and required is drawn from the list", async () => {
    const m = await mountBuilder(initial());
    expect(row(m, "count").querySelector('[part="field-format"]')).toBeNull();
    expect(row(m, "title").querySelector('[part="field-format"]')).not.toBeNull();
    expect(control(fieldPart(m, "title", "field-required")).checked).toBe(true);
    expect(control(fieldPart(m, "count", "field-required")).checked).toBe(false);
  });
});

// ─── Adding a field ──────────────────────────────────────────────────────────

describe("adding a field", () => {
  test("the add form commits a camelCased, formatted, required field and closes", async () => {
    const m = await mountBuilder({ properties: {}, required: [], type: "object" });
    expect(m.host.querySelector('[part="add-form"]')).toBeNull();

    pointer(part(m.host, "add-open"), "click");
    await m.settle();
    setAndFire(part(m.host, "add-name"), "Publish Date", "input");
    setAndFire(part(m.host, "add-format"), "date");
    toggle(part(m.host, "add-required"), true);
    await m.settle();
    pointer(part(m.host, "add-confirm"), "click");
    await m.settle();

    expect(schemaOf(m).properties.publishDate).toEqual({ format: "date", type: "string" });
    expect(schemaOf(m).required).toEqual(["publishDate"]);
    expect(m.host.querySelector('[part="add-form"]')).toBeNull();
    expect(fieldKeys(m)).toEqual(["publishDate"]);
  });

  test("Enter in the name field adds it too, and a type with no format draws none", async () => {
    const m = await mountBuilder({ properties: {}, required: [], type: "object" });
    pointer(part(m.host, "add-open"), "click");
    await m.settle();
    setAndFire(part(m.host, "add-type"), "boolean");
    await m.settle();
    expect(m.host.querySelector('[part="add-format"]')).toBeNull();

    setAndFire(part(m.host, "add-name"), "is draft", "input");
    key(control(part(m.host, "add-name")), "Enter");
    await m.settle();
    expect(schemaOf(m).properties.isDraft).toEqual({ type: "boolean" });
  });

  test("a blank name commits nothing and leaves the form open", async () => {
    const m = await mountBuilder({ properties: {}, required: [], type: "object" });
    pointer(part(m.host, "add-open"), "click");
    await m.settle();
    setAndFire(part(m.host, "add-name"), "   ", "input");
    pointer(part(m.host, "add-confirm"), "click");
    await m.settle();

    expect(m.patches).toEqual([]);
    expect(m.host.querySelector('[part="add-form"]')).not.toBeNull();
  });

  test("Cancel closes the form, and Escape does the same; reopening starts blank", async () => {
    const m = await mountBuilder({ properties: {}, required: [], type: "object" });
    pointer(part(m.host, "add-open"), "click");
    await m.settle();
    setAndFire(part(m.host, "add-name"), "draft", "input");
    pointer(part(m.host, "add-cancel"), "click");
    await m.settle();
    expect(m.host.querySelector('[part="add-form"]')).toBeNull();

    pointer(part(m.host, "add-open"), "click");
    await m.settle();
    expect(shows(part(m.host, "add-name"))).toBe("");
    key(control(part(m.host, "add-name")), "Escape");
    await m.settle();
    expect(m.host.querySelector('[part="add-form"]')).toBeNull();
    expect(m.patches).toEqual([]);
  });

  test("a value that is not an object becomes one, rather than being refused", async () => {
    const m = await mountBuilder(null);
    pointer(part(m.host, "add-open"), "click");
    await m.settle();
    setAndFire(part(m.host, "add-name"), "title", "input");
    pointer(part(m.host, "add-confirm"), "click");
    await m.settle();
    expect(m.state.value).toEqual({
      properties: { title: { type: "string" } },
      required: [],
      type: "object",
    });
  });
});

// ─── Editing a field ─────────────────────────────────────────────────────────

describe("editing a field", () => {
  const initial = () => ({
    properties: {
      cover: { format: "image", type: "string" },
      summary: { type: "string" },
      title: { type: "string" },
    },
    required: ["title"],
    type: "object",
  });

  test("a rename camelCases, remaps required, and keeps the property order", async () => {
    const m = await mountBuilder(initial());
    setAndFire(fieldPart(m, "title", "field-name"), "post title");
    await m.settle();
    expect(schemaOf(m).properties.postTitle).toEqual({ type: "string" });
    expect(schemaOf(m).properties.title).toBeUndefined();
    expect(schemaOf(m).required).toEqual(["postTitle"]);
    expect(fieldKeys(m)).toEqual(["cover", "summary", "postTitle"]);
  });

  /**
   * The lit card assigned `target.value` from inside its own change handler. A document's binding
   * only writes when the scope value CHANGES, so the control says what it now holds first and the
   * snap-back is a real move — which is the only reason a refused rename can be seen at all.
   */
  test("a refused rename commits nothing and puts the name back in the field", async () => {
    const m = await mountBuilder(initial());
    setAndFire(fieldPart(m, "summary", "field-name"), "title");
    await m.settle();
    expect(m.patches).toEqual([]);
    expect(shows(fieldPart(m, "summary", "field-name"))).toBe("summary");

    setAndFire(fieldPart(m, "summary", "field-name"), "   ");
    await m.settle();
    expect(m.patches).toEqual([]);
    expect(shows(fieldPart(m, "summary", "field-name"))).toBe("summary");
  });

  test("a type change keeps a format the new type can carry, and drops one it cannot", async () => {
    const m = await mountBuilder(initial());
    setAndFire(fieldPart(m, "cover", "field-type"), "array");
    await m.settle();
    expect(schemaOf(m).properties.cover).toEqual({
      items: { format: "image", type: "string" },
      type: "array",
    });

    setAndFire(fieldPart(m, "cover", "field-type"), "number");
    await m.settle();
    expect(schemaOf(m).properties.cover).toEqual({ type: "number" });
    expect(row(m, "cover").querySelector('[part="field-format"]')).toBeNull();
  });

  test("a format change keeps the type, landing on items for arrays", async () => {
    const m = await mountBuilder({
      properties: { tags: { items: { type: "string" }, type: "array" } },
      required: [],
      type: "object",
    });
    setAndFire(fieldPart(m, "tags", "field-format"), "color");
    await m.settle();
    expect(schemaOf(m).properties.tags).toEqual({
      items: { format: "color", type: "string" },
      type: "array",
    });
  });

  test("required toggles on and off; delete drops the field and its required entry", async () => {
    const m = await mountBuilder(initial());
    toggle(fieldPart(m, "summary", "field-required"), true);
    await m.settle();
    expect(schemaOf(m).required).toEqual(["title", "summary"]);
    toggle(fieldPart(m, "summary", "field-required"), false);
    await m.settle();
    expect(schemaOf(m).required).toEqual(["title"]);

    pointer(fieldPart(m, "title", "field-delete"), "click");
    await m.settle();
    expect(schemaOf(m).properties.title).toBeUndefined();
    expect(schemaOf(m).required).toEqual([]);
    expect(() => card(m, "title")).toThrow();
  });
});

// ─── References ──────────────────────────────────────────────────────────────

describe("reference fields", () => {
  test("the target picker offers the context's content types and writes the pointer", async () => {
    const m = await mountBuilder(
      { properties: { related: { $ref: "#/content/page" } }, required: [], type: "object" },
      { ctx: contentTypesCtx },
    );
    const picker = cardPart(m, "related", "ref-target-select");
    expect(options(picker)).toEqual(["page", "post"]);
    expect(shows(picker)).toBe("page");
    setAndFire(picker, "post");
    await m.settle();
    expect(schemaOf(m).properties.related).toEqual({ $ref: "#/content/post" });
  });

  test("choosing the reference type from a plain field writes the empty pointer", async () => {
    const m = await mountBuilder(
      { properties: { summary: { type: "string" } }, required: [], type: "object" },
      { ctx: contentTypesCtx },
    );
    setAndFire(fieldPart(m, "summary", "field-type"), "reference");
    await m.settle();
    expect(schemaOf(m).properties.summary).toEqual({ $ref: "#/content/" });
    expect(card(m, "summary").querySelector('[part="ref-target"]')).not.toBeNull();
  });

  /** A picker over an empty list is a control with no answers in it. */
  test("with no content types there is no target picker at all", async () => {
    const m = await mountBuilder({
      properties: { related: { $ref: "#/content/page" } },
      required: [],
      type: "object",
    });
    expect(card(m, "related").querySelector('[part="ref-target"]')).toBeNull();
  });

  /** A legacy `#/contentTypes/<name>` pointer round-trips: the section prefix is stripped. */
  test("a pointer into another section still shows its target", async () => {
    const m = await mountBuilder(
      { properties: { related: { $ref: "#/contentTypes/post" } }, required: [], type: "object" },
      { ctx: contentTypesCtx },
    );
    expect(shows(cardPart(m, "related", "ref-target-select"))).toBe("post");
  });
});

// ─── Nested object fields ────────────────────────────────────────────────────

describe("nested fields", () => {
  const initial = () => ({
    properties: {
      meta: {
        properties: { author: { type: "string" } },
        required: ["author"],
        type: "object",
      },
      title: { type: "string" },
    },
    required: [],
    type: "object",
  });

  const meta = (m: BuilderMount) =>
    schemaOf(m).properties.meta as { properties: Record<string, unknown>; required: string[] };

  test("the add row keeps its draft in the control's own state, not in the DOM", async () => {
    const m = await mountBuilder(initial());
    setAndFire(cardPart(m, "meta", "nested-add-name"), "birth year", "input");
    setAndFire(cardPart(m, "meta", "nested-add-type"), "number");
    await m.settle();

    /* An outside repaint mid-typing: the lit row read its own name field at click time, so this is
       exactly where what the reader had typed used to disappear. */
    m.handle.update({
      ctx: inertCtx,
      key: "schema",
      onChange: () => {
        throw new Error("a repaint must commit nothing");
      },
      schema: { format: "json-schema", type: "object" },
      value: m.state.value,
    });
    await m.settle();
    expect(shows(cardPart(m, "meta", "nested-add-name"))).toBe("birth year");
    expect(shows(cardPart(m, "meta", "nested-add-type"))).toBe("number");
  });

  test("the add button commits a camelCased child, clears the name and keeps the type", async () => {
    const m = await mountBuilder(initial());
    setAndFire(cardPart(m, "meta", "nested-add-name"), "birth year", "input");
    setAndFire(cardPart(m, "meta", "nested-add-type"), "number");
    await m.settle();
    pointer(cardPart(m, "meta", "nested-add-button"), "click");
    await m.settle();

    expect(meta(m).properties.birthYear).toEqual({ type: "number" });
    expect(shows(cardPart(m, "meta", "nested-add-name"))).toBe("");
    expect(shows(cardPart(m, "meta", "nested-add-type"))).toBe("number");
  });

  test("Enter in the add row does the same, and a blank name commits nothing", async () => {
    const m = await mountBuilder(initial());
    key(control(cardPart(m, "meta", "nested-add-name")), "Enter");
    await m.settle();
    expect(m.patches).toEqual([]);

    setAndFire(cardPart(m, "meta", "nested-add-name"), "bio", "input");
    key(control(cardPart(m, "meta", "nested-add-name")), "Enter");
    await m.settle();
    expect(meta(m).properties.bio).toEqual({ type: "string" });
  });

  test("a child renames, changes type and format, toggles required, and deletes", async () => {
    const m = await mountBuilder(initial());
    setAndFire(nestedPart(m, "meta", "author", "field-name"), "author name");
    await m.settle();
    expect(meta(m).properties.authorName).toEqual({ type: "string" });
    expect(meta(m).required).toEqual(["authorName"]);

    setAndFire(nestedPart(m, "meta", "authorName", "field-type"), "array");
    await m.settle();
    expect(meta(m).properties.authorName).toEqual({ items: { type: "string" }, type: "array" });

    setAndFire(nestedPart(m, "meta", "authorName", "field-format"), "image");
    await m.settle();
    expect(meta(m).properties.authorName).toEqual({
      items: { format: "image", type: "string" },
      type: "array",
    });

    toggle(nestedPart(m, "meta", "authorName", "field-required"), false);
    await m.settle();
    expect(meta(m).required).toEqual([]);

    pointer(nestedPart(m, "meta", "authorName", "field-delete"), "click");
    await m.settle();
    expect(meta(m).properties.authorName).toBeUndefined();
  });

  test("a refused child rename commits nothing and puts the name back", async () => {
    const m = await mountBuilder({
      properties: {
        meta: {
          properties: { author: { type: "string" }, editor: { type: "string" } },
          required: [],
          type: "object",
        },
      },
      required: [],
      type: "object",
    });
    setAndFire(nestedPart(m, "meta", "author", "field-name"), "editor");
    await m.settle();
    expect(m.patches).toEqual([]);
    expect(shows(nestedPart(m, "meta", "author", "field-name"))).toBe("author");
  });

  test("a field that is not an object draws no children and no add row", async () => {
    const m = await mountBuilder(initial());
    expect(card(m, "title").querySelector('[part="nested"]')).toBeNull();
    expect(card(m, "title").querySelector('[part="nested-add"]')).toBeNull();
  });
});

// ─── A field that has gone underneath the card ───────────────────────────────

/**
 * The value can change between the paint and the interaction — an external edit landing on the
 * object a host is holding, with no repaint behind it — and the card the reader is looking at is
 * then a node the document has moved on from. Every handler guards, and the guard is a REFUSAL: the
 * lit control cloned the value, ran a mutation that returned early, and committed the clone anyway,
 * so an edit to a vanished field recorded a write that changed nothing.
 */
describe("stale cards", () => {
  interface Stale {
    m: BuilderMount;
    ghost: HTMLElement;
    child: HTMLElement;
    addName: HTMLElement;
    addButton: HTMLElement;
    target: HTMLElement;
  }

  /** Three cards, then the object they were drawn from loses all three IN PLACE. */
  async function stale(): Promise<Stale> {
    const value: { properties: Record<string, unknown>; required: string[]; type: string } = {
      properties: {
        ghost: { type: "string" },
        meta: {
          properties: { child: { type: "string" } },
          required: ["child"],
          type: "object",
        },
        target: { $ref: "#/content/page" },
      },
      required: [],
      type: "object",
    };
    const m = await mountBuilder(value, { ctx: contentTypesCtx });
    const held = {
      addButton: cardPart(m, "meta", "nested-add-button"),
      addName: cardPart(m, "meta", "nested-add-name"),
      child: nested(m, "meta", "child"),
      ghost: row(m, "ghost"),
      m,
      target: cardPart(m, "target", "ref-target-select"),
    };
    delete value.properties.ghost;
    delete value.properties.meta;
    delete value.properties.target;
    return held;
  }

  test("type, format, name, required, target and delete on a vanished field commit nothing", async () => {
    const s = await stale();
    setAndFire(part(s.ghost, "field-type"), "number");
    setAndFire(part(s.ghost, "field-format"), "date");
    setAndFire(part(s.ghost, "field-name"), "renamed");
    toggle(part(s.ghost, "field-required"), true);
    setAndFire(s.target, "post");
    pointer(part(s.ghost, "field-delete"), "click");
    await s.m.settle();
    expect(s.m.patches).toEqual([]);
    expect(fieldKeys(s.m)).toEqual([]);
  });

  test("nested edits under a vanished parent commit nothing", async () => {
    const s = await stale();
    setAndFire(part(s.child, "field-name"), "renamed");
    setAndFire(part(s.child, "field-type"), "number");
    setAndFire(part(s.child, "field-format"), "image");
    toggle(part(s.child, "field-required"), false);
    pointer(part(s.child, "field-delete"), "click");
    setAndFire(s.addName, "orphan", "input");
    pointer(s.addButton, "click");
    await s.m.settle();
    expect(s.m.patches).toEqual([]);
  });
});

// ─── The two kinds of host ───────────────────────────────────────────────────

describe("the host relationship", () => {
  /**
   * A host that never redraws — the frontmatter renderer passes no `rerender` at all — still sees
   * its cards move: what was committed is what is shown until the value itself does.
   */
  test("a host that does not redraw still gets the committed schema on screen", async () => {
    const m = await mountBuilder(
      { properties: { title: { type: "string" } }, required: [], type: "object" },
      { redraws: false },
    );
    setAndFire(fieldPart(m, "title", "field-type"), "number");
    await m.settle();
    expect(lastPatch(m).properties.title).toEqual({ type: "number" });
    expect(shows(fieldPart(m, "title", "field-type"))).toBe("number");
  });

  /** What the host says the value is wins over what the control last committed. */
  test("an update from the host replaces what the control was showing", async () => {
    const m = await mountBuilder({ properties: {}, required: [], type: "object" });
    m.state.value = {
      properties: { fromElsewhere: { type: "boolean" } },
      required: [],
      type: "object",
    };
    m.handle.update({
      ctx: inertCtx,
      key: "schema",
      onChange: () => {
        // Nothing commits here
      },
      schema: { format: "json-schema", type: "object" },
      value: m.state.value,
    });
    await m.settle();
    expect(fieldKeys(m)).toEqual(["fromElsewhere"]);
  });

  /**
   * A host the document has been taken out of — the form's own repaint replacing the control host,
   * or a caller emptying it — is the one case an assignment to the scope cannot answer.
   */
  test("an update after the host was emptied mounts the document again", async () => {
    const m = await mountBuilder({
      properties: { title: { type: "string" } },
      required: [],
      type: "object",
    });
    m.host.textContent = "";
    m.handle.update({
      ctx: inertCtx,
      key: "schema",
      onChange: () => {
        // Nothing commits here
      },
      schema: { format: "json-schema", type: "object" },
      value: m.state.value,
    });
    await m.settle();
    expect(m.host.querySelector('[part="builder"]')).not.toBeNull();
    expect(fieldKeys(m)).toEqual(["title"]);
  });

  /** Disposing before the mount has settled must not leave a document running in a detached host. */
  test("dispose during the mount takes down the surface that arrives after it", async () => {
    const builder = schemaBuilderControl;
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const handle = builder.mount(host, {
      ctx: inertCtx,
      key: "schema",
      onChange: () => {
        // Nothing commits here
      },
      schema: { format: "json-schema", type: "object" },
      value: { properties: { title: { type: "string" } }, required: [], type: "object" },
    });
    handle.dispose();
    await settle();
    expect(host.childNodes.length).toBe(0);
  });

  test("dispose takes the document down and leaves the host empty", async () => {
    const m = await mountBuilder({
      properties: { title: { type: "string" } },
      required: [],
      type: "object",
    });
    expect(m.host.querySelector('[part="builder"]')).not.toBeNull();
    m.handle.dispose();
    await m.settle();
    expect(m.host.childNodes.length).toBe(0);
  });
});

// ─── Through the schema form ─────────────────────────────────────────────────

/**
 * The seam itself, end to end: the engine draws an empty `[part="control-host"]` for a field a
 * registered control owns, mounts the control into it, and takes the mount down when the field
 * stops being one. Nothing else in this file goes through `mountSchemaForm`.
 */
describe("mounted through the schema form", () => {
  const entrySchema = {
    properties: { schema: { format: "json-schema", type: "object" } },
    type: "object",
  };
  const entry = () => ({
    schema: { properties: { title: { type: "string" } }, required: [], type: "object" },
  });

  afterEach(() => {
    resetSchemaForms();
  });

  test("the engine mounts the builder into the host it drew, and disposes it when the override goes", async () => {
    const host = mountSchemaForm("test:builder", entrySchema, entry(), {
      onChange: () => {
        // Nothing commits here
      },
      ui: { schema: { control: "schema-builder" } },
    });
    document.body.append(host);
    hosts.push(host);
    await settle();

    const island = host.querySelector('[data-prop="schema"]');
    expect(island?.querySelector('[part="control-host"] [part="builder"]')).not.toBeNull();
    expect(island?.querySelector('[data-field="title"]')).not.toBeNull();

    /* The same form, the same key, without the override: `schema` is an ordinary JSON field now,
       and the document it was drawing has to go with it rather than being left running. */
    mountSchemaForm("test:builder", entrySchema, entry(), {
      onChange: () => {
        // Nothing commits here
      },
    });
    await settle();
    expect(host.querySelector('[part="builder"]')).toBeNull();
  });
});

// ─── Secret control ──────────────────────────────────────────────────────────

describe("secret control", () => {
  function commitValue(el: Element, value: string): void {
    (el as ValueEl).value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function mountSecret(
    ctx: SchemaFormContext,
    value?: unknown,
    onChange: (next: unknown) => void = () => {
      // Default: ignore the committed env name
    },
  ) {
    const secret = getFormControl("secret")!;
    const container = document.createElement("div");
    render(
      html`${secret({
        ctx,
        key: "urlEnv",
        onChange,
        schema: { format: "secret", type: "string" },
        value,
      })}`,
      container,
    );
    return container;
  }

  test("renders disabled without a commitSecret hook (backend has no secrets surface)", () => {
    const container = mountSecret(inertCtx);
    const field = container.querySelector("sp-textfield")!;
    expect(field.hasAttribute("disabled")).toBe(true);
    expect(field.getAttribute("placeholder")).toBe("Not set");
    expect(field.getAttribute("type")).toBe("password");
    // Change events are inert while disabled
    commitValue(field, "ignored");
  });

  test("stores the VALUE via commitSecret and persists only the returned env NAME", async () => {
    const commits: [string, string][] = [];
    const changes: unknown[] = [];
    const container = mountSecret(
      {
        commitSecret: (key_, value) => {
          commits.push([key_, value]);
          return "MAIN_URL";
        },
        resolvePointer: () => {
          // No context data
        },
      },
      undefined,
      (next) => changes.push(next),
    );
    const field = container.querySelector("sp-textfield")!;
    expect(field.hasAttribute("disabled")).toBe(false);
    commitValue(field, "postgres://secret");
    await flush();
    expect(commits).toEqual([["urlEnv", "postgres://secret"]]);
    expect(changes).toEqual(["MAIN_URL"]);
    // The entered secret never lingers in the field
    expect((field as ValueEl).value).toBe("");
  });

  test("shows the stored env NAME as placeholder and rerenders on a same-name recommit", async () => {
    let rerenders = 0;
    const secret = getFormControl("secret")!;
    const container = document.createElement("div");
    render(
      html`${secret({
        ctx: {
          commitSecret: () => "MAIN_URL",
          resolvePointer: () => {
            // No context data
          },
        },
        key: "urlEnv",
        onChange: () => {
          throw new Error("unchanged env names must not patch project.json");
        },
        rerender: () => {
          rerenders += 1;
        },
        schema: { format: "secret", type: "string" },
        value: "MAIN_URL",
      })}`,
      container,
    );
    const field = container.querySelector("sp-textfield")!;
    expect(field.getAttribute("placeholder")).toBe("Stored as MAIN_URL");
    commitValue(field, "rotated-value");
    await flush();
    expect(rerenders).toBe(1);
  });

  test("blank input never commits", async () => {
    const commits: unknown[] = [];
    const container = mountSecret({
      commitSecret: (key_, value) => {
        commits.push([key_, value]);
        return "X";
      },
      resolvePointer: () => {
        // No context data
      },
    });
    commitValue(container.querySelector("sp-textfield")!, "");
    await flush();
    expect(commits).toEqual([]);
  });
});
