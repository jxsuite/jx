/**
 * Tests for src/settings/defs-editor.ts — Project Settings › Data Shapes, the editor for
 * project-level `$defs`.
 *
 * **The section is a Jx document now** (`src/surfaces/settings-defs.json`), so four things about
 * this file are deliberate rather than incidental:
 *
 * - The container is APPENDED TO THE DOCUMENT. A kit element renders in `connectedCallback`, so a
 *   detached container gets `<jx-textfield>` tags with nothing inside them, and every assertion
 *   about a control would read `null` — a failure that looks like a missing element rather than a
 *   missing connection.
 * - Rendering is awaited. `renderDefsEditor` still returns void, as the registry's
 *   `render(container)` seam requires, and mounting is asynchronous underneath it; {@link settle}
 *   is the one place that knows how long that takes.
 * - An edit is made on the NATIVE control inside the kit element, never on the element. That is what
 *   a reader's edit is: the kit hears its own input's event and lets it bubble on, so a test that
 *   wrote the host's `value` property would be moving the control without telling it.
 * - The selection, the two forms and the per-object add-row drafts are kept PER CONTAINER, so each
 *   test's fresh container starts cold. The lit version kept them per module, which is why the file
 *   it replaced had to drive selection through the list in a fixed order.
 *
 * What the surface added, and what these pin as behaviour rather than markup: a refused rename now
 * puts the on-disk name back in the field (the scope moves, where the lit handler assigned to
 * `target.value`), and the nested add row keeps what the reader typed in the section's own state
 * rather than in the DOM it was about to re-render.
 */
import { flush, installMockPlatform, key, pointer, resetStudioState } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import { projectState } from "../src/store";

import type { MockPlatformState } from "./harness";

const { renderDefsEditor } = await import("../src/settings/defs-editor");
const { mountDefsSurface } = await import("../src/surfaces/settings-defs");

type AnyConfig = Record<string, any>;

/**
 * Let the document catch up.
 *
 * Generous on purpose, and in one place: the mount awaits the kit's registration, each kit element
 * builds its own scope asynchronously in `connectedCallback`, and a write goes through a commit
 * before the file is on disk. A per-test turn count would be four guesses at the same number.
 */
async function settle(): Promise<void> {
  await flush(8);
}

async function setup(
  cfg: AnyConfig | null,
): Promise<{ container: HTMLElement; state: MockPlatformState }> {
  const { state } = installMockPlatform();
  resetStudioState({ projectConfig: cfg as unknown });
  const container = document.createElement("div");
  document.body.append(container);
  renderDefsEditor(container);
  await settle();
  return { container, state };
}

/** A project holding only `$defs`, which is what most of these are about. */
async function withDefs(
  defs: AnyConfig | null,
): Promise<{ container: HTMLElement; state: MockPlatformState }> {
  return setup(defs === null ? null : { $defs: defs });
}

function config(): AnyConfig {
  return (projectState as AnyConfig).projectConfig;
}

function part(root: ParentNode, name: string): HTMLElement {
  const el = root.querySelector(`[part="${name}"]`);
  if (!el) {
    throw new Error(`no [part="${name}"] in the Data Shapes section`);
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

/**
 * Type into a control and commit it, the way a reader does: `input` as each character lands, and
 * then the event that commits it.
 *
 * Both halves matter. A kit field mirrors `input` into its own state and hears nothing from
 * `change`, so a test that fired only the commit would leave the element believing it still holds
 * the old text — and every assertion about a value being put back would pass against an element
 * that had never moved.
 */
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

/** What a field's name control shows — the assertion a refused rename is judged by. */
function nameShown(within: HTMLElement): string {
  return shows(nameField(within));
}

function shapes(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-shape]")].map(
    (el) => (el as HTMLElement).dataset.shape ?? "",
  );
}

async function selectShape(container: HTMLElement, name: string): Promise<void> {
  const button = container.querySelector(`[data-shape="${name}"]`);
  if (!button) {
    throw new Error(`no list button for the data shape "${name}"`);
  }
  pointer(button, "click");
  await settle();
}

function card(container: HTMLElement, field: string): HTMLElement {
  const el = container.querySelector(`[data-field="${field}"]`);
  if (!el) {
    throw new Error(`no field card for "${field}"`);
  }
  return el as HTMLElement;
}

/** A field's own row, so a parent object's controls are never mistaken for a child's. */
function row(container: HTMLElement, field: string): HTMLElement {
  return card(container, field).querySelector('[part="field-row"]') as HTMLElement;
}

/** One child of an object field. Its card holds exactly one row, which is that child's. */
function nested(container: HTMLElement, parent: string, child: string): HTMLElement {
  const el = card(container, parent).querySelector(`[data-nested="${child}"]`);
  if (!el) {
    throw new Error(`no nested card for "${parent}.${child}"`);
  }
  return el as HTMLElement;
}

/** The three controls of an object field's add row. */
function draftName(container: HTMLElement, parent: string): HTMLElement {
  return part(card(container, parent), "nested-add-name");
}
function draftType(container: HTMLElement, parent: string): HTMLElement {
  return part(card(container, parent), "nested-add-type");
}
function draftAdd(container: HTMLElement, parent: string): HTMLElement {
  return part(card(container, parent), "nested-add-button");
}

/** The four per-row controls, addressed by the part they carry rather than by their order. */
function nameField(within: HTMLElement): HTMLElement {
  return part(within, "field-name");
}
function typePicker(within: HTMLElement): HTMLElement {
  return part(within, "field-type");
}
function formatPicker(within: HTMLElement): HTMLElement {
  return part(within, "field-format");
}
function requiredSwitch(within: HTMLElement): HTMLElement {
  return part(within, "field-required");
}

function written(state: MockPlatformState): AnyConfig {
  const text = state.files.get("project.json");
  if (text === undefined) {
    throw new Error("project.json was never written");
  }
  return JSON.parse(text) as AnyConfig;
}

function writes(state: MockPlatformState): number {
  return state.calls.filter(([name]) => name === "writeFile").length;
}

afterEach(() => {
  document.body.replaceChildren();
});

function postDefs(): AnyConfig {
  return {
    Author: {
      properties: { name: { type: "string" } },
      required: [],
      type: "object",
    },
    Post: {
      properties: {
        cover: { format: "image", type: "string" },
        meta: {
          properties: { author: { type: "string" } },
          required: ["author"],
          type: "object",
        },
        tags: { items: { format: "image", type: "string" }, type: "array" },
        title: { type: "string" },
      },
      required: ["title"],
      type: "object",
    },
  };
}

// ─── List panel ──────────────────────────────────────────────────────────────

describe("the shape list", () => {
  test("says what to do when nothing is selected, and offers only the new-shape button", async () => {
    const { container } = await withDefs({});
    expect(part(container, "empty").textContent).toContain(
      "Pick a data shape on the left, or create one.",
    );
    expect(shapes(container)).toEqual([]);
    expect(container.querySelector('[part="new-open"]')).not.toBeNull();
    expect(container.querySelector('[part="editor"]')).toBeNull();
  });

  test("lists every shape, and selecting one opens its fields", async () => {
    const { container } = await withDefs(postDefs());
    expect(shapes(container)).toEqual(["Author", "Post"]);

    await selectShape(container, "Post");
    expect(part(container, "editor-name").textContent).toBe("Post");
    expect(container.querySelectorAll("[data-field]").length).toBe(4);
    /* The chosen row says so on the button the reader clicked, not just in the editor beside it —
       and the kit draws that state itself, which is why this document has no rule for it. */
    const chosen = container.querySelector('[data-shape="Post"]') as HTMLElement;
    expect(chosen.dataset.selected).toBe("");
  });

  test("a field's caption is its name in words, beside the raw key the reader edits", async () => {
    const { container } = await withDefs({
      Post: { properties: { heroImage: { type: "string" } }, type: "object" },
    });
    await selectShape(container, "Post");
    expect(part(card(container, "heroImage"), "field-label").textContent).toBe("Hero Image");
    expect(nameShown(card(container, "heroImage"))).toBe("heroImage");
  });
});

// ─── New shape ───────────────────────────────────────────────────────────────

describe("creating a shape", () => {
  /*
   * The indentation assertion is inverted on purpose. This editor used to own a second writer at
   * `JSON.stringify(config, null, "\t")`, so adding one data shape re-indented every line of
   * `project.json` — a file that is on disk with two spaces everywhere in this repository. There is
   * one serialisation now (tabs/project-config.ts), and it is the one every other JSON document
   * Studio saves already uses.
   */
  test("Enter trims the name, selects it, and persists at the project indent", async () => {
    const { container, state } = await withDefs({});
    pointer(part(container, "new-open"), "click");
    await settle();
    const field = part(container, "new-field");
    setAndFire(field, "  ApiResponse  ", "input");
    key(control(field), "Enter");
    await settle();

    expect(config().$defs.ApiResponse).toEqual({ properties: {}, required: [], type: "object" });
    expect(part(container, "editor-name").textContent).toBe("ApiResponse");
    const text = state.files.get("project.json");
    expect(text).toBeDefined();
    expect(text).not.toContain("\t");
    expect(text).toContain('\n  "$defs"');
    expect(written(state).$defs.ApiResponse).toBeDefined();
  });

  test("the Create button does the same, and the form closes behind it", async () => {
    const { container, state } = await withDefs({});
    pointer(part(container, "new-open"), "click");
    await settle();
    setAndFire(part(container, "new-field"), "Product", "input");
    pointer(part(container, "new-create"), "click");
    await settle();

    expect(config().$defs.Product).toBeDefined();
    expect(container.querySelector('[part="new-field"]')).toBeNull();
    expect(state.files.has("project.json")).toBe(true);
  });

  test("a blank name is refused, the form stays open, and Escape closes it", async () => {
    const { container, state } = await withDefs({});
    pointer(part(container, "new-open"), "click");
    await settle();
    const field = part(container, "new-field");
    setAndFire(field, "   ", "input");
    key(control(field), "Enter");
    await settle();

    expect(Object.keys(config().$defs)).toEqual([]);
    // The text the reader typed is still there: nothing was decided, so nothing was taken away.
    expect(shows(part(container, "new-field"))).toBe("   ");
    expect(state.files.size).toBe(0);

    key(control(part(container, "new-field")), "Escape");
    await settle();
    expect(container.querySelector('[part="new-field"]')).toBeNull();
  });

  test("a duplicate name does not overwrite the shape that has it", async () => {
    const { container, state } = await withDefs(postDefs());
    pointer(part(container, "new-open"), "click");
    await settle();
    const field = part(container, "new-field");
    setAndFire(field, "Post", "input");
    key(control(field), "Enter");
    await settle();

    expect(config().$defs.Post.properties.title).toEqual({ type: "string" });
    expect(state.files.size).toBe(0);
  });

  test("a project that is not open is a safe no-op", async () => {
    const { container } = await withDefs(null);
    pointer(part(container, "new-open"), "click");
    await settle();
    const field = part(container, "new-field");
    setAndFire(field, "Whatever", "input");
    expect(() => key(control(field), "Enter")).not.toThrow();
    await settle();
    expect(container.querySelector('[part="empty"]')).not.toBeNull();
  });

  test("a project with no $defs at all gets one", async () => {
    const { container } = await setup({ name: "Site" });
    pointer(part(container, "new-open"), "click");
    await settle();
    const field = part(container, "new-field");
    setAndFire(field, "Fresh", "input");
    key(control(field), "Enter");
    await settle();
    expect(config().$defs.Fresh).toBeDefined();
  });
});

// ─── Adding a field ──────────────────────────────────────────────────────────

describe("adding a field", () => {
  test("a formatted, required field lands with its format and its requirement", async () => {
    const { container, state } = await withDefs(postDefs());
    await selectShape(container, "Post");
    pointer(part(container, "add-open"), "click");
    await settle();

    setAndFire(part(container, "add-name"), "heroImage", "input");
    toggle(part(container, "add-required"), true);
    setAndFire(part(container, "add-format"), "image");
    pointer(part(container, "add-confirm"), "click");
    await settle();

    const def = config().$defs.Post;
    expect(def.properties.heroImage).toEqual({ format: "image", type: "string" });
    expect(def.required).toContain("heroImage");
    expect(container.querySelector('[part="add-form"]')).toBeNull();
    expect(written(state).$defs.Post.properties.heroImage).toBeDefined();
  });

  test("choosing object takes the format picker away and adds an object skeleton", async () => {
    const { container } = await withDefs(postDefs());
    await selectShape(container, "Post");
    pointer(part(container, "add-open"), "click");
    await settle();

    setAndFire(part(container, "add-name"), "extras", "input");
    setAndFire(part(container, "add-type"), "object");
    await settle();
    expect(container.querySelector('[part="add-format"]')).toBeNull();

    key(control(part(container, "add-name")), "Enter");
    await settle();
    expect(config().$defs.Post.properties.extras).toEqual({
      properties: {},
      required: [],
      type: "object",
    });
  });

  test("an empty name keeps the form open, and Cancel empties what it held", async () => {
    const { container } = await withDefs(postDefs());
    await selectShape(container, "Post");
    pointer(part(container, "add-open"), "click");
    await settle();

    key(control(part(container, "add-name")), "Enter");
    await settle();
    expect(container.querySelector('[part="add-form"]')).not.toBeNull();

    setAndFire(part(container, "add-name"), "draft", "input");
    pointer(part(container, "add-cancel"), "click");
    await settle();
    expect(container.querySelector('[part="add-form"]')).toBeNull();
    expect(config().$defs.Post.properties.draft).toBeUndefined();

    pointer(part(container, "add-open"), "click");
    await settle();
    expect(shows(part(container, "add-name"))).toBe("");

    key(control(part(container, "add-name")), "Escape");
    await settle();
    expect(container.querySelector('[part="add-form"]')).toBeNull();
  });

  test("a shape with neither map gets both", async () => {
    const { container } = await withDefs({ Slim: { type: "object" } });
    await selectShape(container, "Slim");
    pointer(part(container, "add-open"), "click");
    await settle();
    setAndFire(part(container, "add-name"), "title", "input");
    toggle(part(container, "add-required"), true);
    key(control(part(container, "add-name")), "Enter");
    await settle();
    expect(config().$defs.Slim.properties.title).toEqual({ type: "string" });
    expect(config().$defs.Slim.required).toEqual(["title"]);
  });

  test("a shape deleted underneath the open form is a guarded no-op", async () => {
    const { container, state } = await withDefs(postDefs());
    await selectShape(container, "Post");
    pointer(part(container, "add-open"), "click");
    await settle();
    setAndFire(part(container, "add-name"), "ghost", "input");

    delete config().$defs.Post;
    expect(() => key(control(part(container, "add-name")), "Enter")).not.toThrow();
    await settle();
    expect(writes(state)).toBe(0);
  });
});

// ─── Field mutations ─────────────────────────────────────────────────────────

describe("editing a field", () => {
  test("delete takes the property and its requirement with it", async () => {
    const { container, state } = await withDefs(postDefs());
    await selectShape(container, "Post");
    pointer(part(row(container, "title"), "field-delete"), "click");
    await settle();

    const def = config().$defs.Post;
    expect(def.properties.title).toBeUndefined();
    expect(def.required).not.toContain("title");
    expect(container.querySelector('[data-field="title"]')).toBeNull();
    expect(written(state).$defs.Post.properties.title).toBeUndefined();
  });

  test("the required switch writes what it now holds, in both directions", async () => {
    const { container } = await withDefs(postDefs());
    await selectShape(container, "Post");
    toggle(requiredSwitch(row(container, "cover")), true);
    await settle();
    expect(config().$defs.Post.required).toContain("cover");

    toggle(requiredSwitch(row(container, "cover")), false);
    await settle();
    expect(config().$defs.Post.required).not.toContain("cover");
  });

  test("a shape with no required list gets one", async () => {
    const { container } = await withDefs({
      Slim: { properties: { a: { type: "string" } }, type: "object" },
    });
    await selectShape(container, "Slim");
    toggle(requiredSwitch(row(container, "a")), true);
    await settle();
    expect(config().$defs.Slim.required).toEqual(["a"]);
  });

  test("a rename keeps the literal name, remaps required, and preserves the order", async () => {
    const { container } = await withDefs(postDefs());
    await selectShape(container, "Post");
    const before = Object.keys(config().$defs.Post.properties);
    setAndFire(nameField(row(container, "title")), "header");
    await settle();

    const def = config().$defs.Post;
    expect(def.properties.header).toEqual({ type: "string" });
    expect(def.properties.title).toBeUndefined();
    expect(def.required).toContain("header");
    expect(Object.keys(def.properties)).toEqual(before.map((k) => (k === "title" ? "header" : k)));
  });

  /*
   * The refusal, and the reason the section echoes. A document's binding writes only when the scope
   * value CHANGES, and after a refusal the scope still holds the name on disk — so the setter says
   * what the control holds before it decides, and the snap-back is a real move rather than a write
   * the runtime skips. The lit version did this by assigning to `target.value` from the handler.
   */
  test("a rename onto a name already taken is refused, and the field snaps back", async () => {
    const { container, state } = await withDefs(postDefs());
    await selectShape(container, "Post");
    setAndFire(nameField(row(container, "title")), "cover");
    await settle();

    const def = config().$defs.Post;
    expect(def.properties.title).toEqual({ type: "string" });
    expect(def.properties.cover).toEqual({ format: "image", type: "string" });
    expect(nameShown(row(container, "title"))).toBe("title");
    expect(writes(state)).toBe(0);
  });

  test("a rename to nothing is refused the same way", async () => {
    const { container, state } = await withDefs(postDefs());
    await selectShape(container, "Post");
    setAndFire(nameField(row(container, "title")), "   ");
    await settle();
    expect(config().$defs.Post.properties.title).toEqual({ type: "string" });
    expect(nameShown(row(container, "title"))).toBe("title");
    expect(writes(state)).toBe(0);
  });

  test("string to array keeps the format, on the items where an array carries it", async () => {
    const { container } = await withDefs(postDefs());
    await selectShape(container, "Post");
    setAndFire(typePicker(row(container, "cover")), "array");
    await settle();
    expect(config().$defs.Post.properties.cover).toEqual({
      items: { format: "image", type: "string" },
      type: "array",
    });
  });

  test("a type that carries no format drops it, and stops drawing the picker", async () => {
    const { container } = await withDefs(postDefs());
    await selectShape(container, "Post");
    setAndFire(typePicker(row(container, "cover")), "number");
    await settle();
    expect(config().$defs.Post.properties.cover).toEqual({ type: "number" });
    expect(row(container, "cover").querySelector('[part="field-format"]')).toBeNull();
  });

  test("a format keeps the type it is a format of", async () => {
    const { container } = await withDefs(postDefs());
    await selectShape(container, "Post");
    setAndFire(formatPicker(row(container, "title")), "date");
    await settle();
    expect(config().$defs.Post.properties.title).toEqual({ format: "date", type: "string" });

    setAndFire(formatPicker(row(container, "tags")), "color");
    await settle();
    expect(config().$defs.Post.properties.tags).toEqual({
      items: { format: "color", type: "string" },
      type: "array",
    });
  });

  test("a property with no type is treated as the string it is drawn as", async () => {
    const { container } = await withDefs({
      Slim: { properties: { odd: { format: "date" } }, type: "object" },
    });
    await selectShape(container, "Slim");
    setAndFire(formatPicker(row(container, "odd")), "color");
    await settle();
    expect(config().$defs.Slim.properties.odd).toEqual({ format: "color", type: "string" });
  });
});

// ─── Nested fields ───────────────────────────────────────────────────────────

describe("editing an object's children", () => {
  function meta(): AnyConfig {
    return config().$defs.Post.properties.meta;
  }

  test("the add row keeps its draft in the section, and adds on Enter and on the button", async () => {
    const { container, state } = await withDefs(postDefs());
    await selectShape(container, "Post");

    const addName = draftName(container, "meta");
    setAndFire(addName, "birthYear", "input");
    setAndFire(draftType(container, "meta"), "number");
    await settle();
    // The draft survives the redraw the type change caused: it is state, not markup.
    expect(shows(draftName(container, "meta"))).toBe("birthYear");

    key(control(draftName(container, "meta")), "Enter");
    await settle();
    expect(meta().properties.birthYear).toEqual({ type: "number" });
    // The name clears and the type does not: the next field is usually another one of these.
    expect(shows(draftName(container, "meta"))).toBe("");

    setAndFire(draftName(container, "meta"), "homepage", "input");
    setAndFire(draftType(container, "meta"), "string");
    pointer(draftAdd(container, "meta"), "click");
    await settle();
    expect(meta().properties.homepage).toEqual({ type: "string" });
    expect(state.files.has("project.json")).toBe(true);
  });

  test("an object with no properties map gets one", async () => {
    const { container } = await withDefs({
      Post: { properties: { meta: { type: "object" } }, type: "object" },
    });
    await selectShape(container, "Post");
    setAndFire(draftName(container, "meta"), "slug", "input");
    key(control(draftName(container, "meta")), "Enter");
    await settle();
    expect(meta().properties.slug).toEqual({ type: "string" });
  });

  test("an empty draft adds nothing", async () => {
    const { container, state } = await withDefs(postDefs());
    await selectShape(container, "Post");
    pointer(draftAdd(container, "meta"), "click");
    await settle();
    expect(Object.keys(meta().properties)).toEqual(["author"]);
    expect(writes(state)).toBe(0);
  });

  test("delete takes the child and its requirement with it", async () => {
    const { container } = await withDefs(postDefs());
    await selectShape(container, "Post");
    pointer(part(nested(container, "meta", "author"), "field-delete"), "click");
    await settle();
    expect(meta().properties.author).toBeUndefined();
    expect(meta().required).not.toContain("author");
  });

  test("a child's required switch writes what it now holds", async () => {
    const { container } = await withDefs(postDefs());
    await selectShape(container, "Post");
    toggle(requiredSwitch(nested(container, "meta", "author")), false);
    await settle();
    expect(meta().required).not.toContain("author");

    toggle(requiredSwitch(nested(container, "meta", "author")), true);
    await settle();
    expect(meta().required).toContain("author");
  });

  test("an object with no required list gets one", async () => {
    const { container } = await withDefs({
      Post: {
        properties: { meta: { properties: { a: { type: "string" } }, type: "object" } },
        type: "object",
      },
    });
    await selectShape(container, "Post");
    toggle(requiredSwitch(nested(container, "meta", "a")), true);
    await settle();
    expect(meta().required).toEqual(["a"]);
  });

  test("a child rename remaps required; a conflicting one is refused and snaps back", async () => {
    const { container } = await withDefs(postDefs());
    await selectShape(container, "Post");
    setAndFire(nameField(nested(container, "meta", "author")), "writer");
    await settle();
    expect(meta().properties.writer).toEqual({ type: "string" });
    expect(meta().required).toContain("writer");

    setAndFire(draftName(container, "meta"), "city", "input");
    key(control(draftName(container, "meta")), "Enter");
    await settle();

    setAndFire(nameField(nested(container, "meta", "city")), "writer");
    await settle();
    expect(meta().properties.city).toEqual({ type: "string" });
    expect(nameShown(nested(container, "meta", "city"))).toBe("city");
  });

  test("a child's type keeps a format between the types that carry one", async () => {
    const { container } = await withDefs({
      Post: {
        properties: {
          meta: { properties: { avatar: { format: "image", type: "string" } }, type: "object" },
        },
        type: "object",
      },
    });
    await selectShape(container, "Post");
    setAndFire(typePicker(nested(container, "meta", "avatar")), "array");
    await settle();
    expect(meta().properties.avatar).toEqual({
      items: { format: "image", type: "string" },
      type: "array",
    });

    setAndFire(typePicker(nested(container, "meta", "avatar")), "boolean");
    await settle();
    expect(meta().properties.avatar).toEqual({ type: "boolean" });
  });

  test("a child's format keeps its type, and gives an untyped property one", async () => {
    const { container } = await withDefs({
      Post: {
        properties: {
          meta: {
            properties: { author: { type: "string" }, odd: { format: "date" } },
            type: "object",
          },
        },
        type: "object",
      },
    });
    await selectShape(container, "Post");
    setAndFire(formatPicker(nested(container, "meta", "author")), "color");
    await settle();
    expect(meta().properties.author).toEqual({ format: "color", type: "string" });

    setAndFire(formatPicker(nested(container, "meta", "odd")), "image");
    await settle();
    expect(meta().properties.odd).toEqual({ format: "image", type: "string" });
  });
});

// ─── Guards ──────────────────────────────────────────────────────────────────

describe("edits against a schema that has moved underneath", () => {
  test("every control is a guarded no-op, and none of them persists", async () => {
    const { container, state } = await withDefs(postDefs());
    await selectShape(container, "Post");
    const title = row(container, "title");
    const author = nested(container, "meta", "author");
    /* Held before the shape goes: a control the reader is looking at when the file changes
       underneath is exactly the one whose click must be a no-op, and it is gone from the section
       by the time it is clicked. */
    const deleteShape = part(container, "delete-shape");
    const addRow = draftName(container, "meta");
    const addType = draftType(container, "meta");

    expect(() => {
      // The parent object is gone: every nested handler bails.
      delete config().$defs.Post.properties.meta;
      pointer(part(author, "field-delete"), "click");
      toggle(requiredSwitch(author), true);
      setAndFire(typePicker(author), "number");
      setAndFire(formatPicker(author), "color");
      setAndFire(nameField(author), "orphanName");
      setAndFire(addType, "number");
      setAndFire(addRow, "orphan", "input");
      key(control(addRow), "Enter");

      // The properties map is gone: every top-level handler bails.
      delete config().$defs.Post.properties;
      pointer(part(title, "field-delete"), "click");
      setAndFire(typePicker(title), "number");
      setAndFire(formatPicker(title), "date");
      setAndFire(nameField(title), "newName");

      // The shape itself is gone: the required switch and the delete button bail.
      delete config().$defs.Post;
      toggle(requiredSwitch(title), true);
      pointer(deleteShape, "click");
    }).not.toThrow();

    await settle();
    expect(writes(state)).toBe(0);
  });
});

// ─── Deleting a shape ────────────────────────────────────────────────────────

describe("deleting a shape", () => {
  test("removes the entry, clears the selection, and persists", async () => {
    const { container, state } = await withDefs(postDefs());
    await selectShape(container, "Post");
    pointer(part(container, "delete-shape"), "click");
    await settle();

    expect(config().$defs.Post).toBeUndefined();
    expect(config().$defs.Author).toBeDefined();
    expect(part(container, "empty")).not.toBeNull();
    expect(written(state).$defs.Post).toBeUndefined();
  });

  test("a shape that has gone from the file leaves the section on its empty state", async () => {
    const { container } = await withDefs(postDefs());
    await selectShape(container, "Post");

    resetStudioState({ projectConfig: { $defs: {} } as unknown });
    renderDefsEditor(container);
    await settle();
    expect(part(container, "empty")).not.toBeNull();
    expect(container.querySelector('[part="editor"]')).toBeNull();
  });
});

// ─── Reference fields ────────────────────────────────────────────────────────

/*
 * The reference type was only ever half-built here: choosing it wrote `#/content/` and offered no
 * way to say what it pointed at. The picker is the other half, and it is drawn only when the
 * project has content types to point at.
 */

describe("a reference field", () => {
  async function withRefs(ref: AnyConfig): Promise<{
    container: HTMLElement;
    state: MockPlatformState;
  }> {
    const mounted = await setup({
      $defs: { Post: { properties: { author: ref }, required: [], type: "object" } },
      content: { authors: { source: "./content/authors" }, tags: {} },
    });
    await selectShape(mounted.container, "Post");
    return mounted;
  }

  test("offers every content type, and shows the one it points at", async () => {
    const { container } = await withRefs({ $ref: "#/content/authors" });
    const picker = part(card(container, "author"), "ref-target-select");
    expect([...picker.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual([
      "authors",
      "tags",
    ]);
    expect(control(picker).value).toBe("authors");
  });

  test("choosing a target rewrites the pointer and persists it", async () => {
    const { container, state } = await withRefs({ $ref: "#/content/authors" });
    setAndFire(part(card(container, "author"), "ref-target-select"), "tags");
    await settle();
    expect(config().$defs.Post.properties.author).toEqual({ $ref: "#/content/tags" });
    expect(written(state).$defs.Post.properties.author).toEqual({ $ref: "#/content/tags" });
  });

  test("choosing a target for a field that has gone is a guarded no-op", async () => {
    const { container, state } = await withRefs({ $ref: "#/content/authors" });
    const picker = part(card(container, "author"), "ref-target-select");
    delete config().$defs.Post.properties.author;
    setAndFire(picker, "tags");
    await settle();
    expect(writes(state)).toBe(0);
  });

  test("choosing the reference type from the picker writes the bare pointer", async () => {
    const { container } = await withRefs({ type: "string" });
    setAndFire(typePicker(row(container, "author")), "reference");
    await settle();
    expect(config().$defs.Post.properties.author).toEqual({ $ref: "#/content/" });
    // With a target list to offer, the picker appears in the same move.
    expect(card(container, "author").querySelector('[part="ref-target-select"]')).not.toBeNull();
  });

  test("with no content types there is no picker, because there is nothing to point at", async () => {
    const { container } = await setup({
      $defs: { Post: { properties: { author: { $ref: "#/content/gone" } }, type: "object" } },
    });
    await selectShape(container, "Post");
    expect(container.querySelector('[part="ref-target-select"]')).toBeNull();
  });
});

// ─── The mount ───────────────────────────────────────────────────────────────

describe("the surface", () => {
  test("a section that lost its container is mounted again rather than updated into nothing", async () => {
    const { container } = await withDefs(postDefs());
    expect(container.querySelector('[part="defs"]')).not.toBeNull();

    // What a different section rendering into the same container does.
    container.replaceChildren();
    renderDefsEditor(container);
    await settle();
    expect(container.querySelector('[part="defs"]')).not.toBeNull();
  });

  test("a mount disposed before it settles leaves nothing behind", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const noop = (): void => {};
    const handle = mountDefsSurface(host, {
      addNested: noop,
      cancelAdd: noop,
      cancelNew: noop,
      confirmAdd: noop,
      createNew: noop,
      editAddFormat: noop,
      editAddName: noop,
      editAddRequired: noop,
      editAddType: noop,
      editDraftName: noop,
      editDraftType: noop,
      editNew: noop,
      openAdd: noop,
      openNew: noop,
      removeField: noop,
      removeNested: noop,
      removeShape: noop,
      renameField: noop,
      renameNested: noop,
      select: noop,
      setFormat: noop,
      setNestedFormat: noop,
      setNestedRequired: noop,
      setNestedType: noop,
      setRequired: noop,
      setTarget: noop,
      setType: noop,
    });
    handle.dispose();
    await handle.ready;
    await settle();

    expect(handle.attached()).toBe(false);
    expect(handle.host).toBe(host);
    expect(host.querySelector('[part="defs"]')).toBeNull();
  });
});
