/**
 * End-to-end parity suite for the descriptor-contributed Content Types section — the replacement
 * for the deleted bespoke content-types editor. The fixture is the REAL @jxsuite/parser
 * contribution: Content.class.json's `project` + `$studio.settings` blocks paired with the shipped
 * project fragment's `properties.content` section schema, exactly the wire shape the backend
 * serves. It drives the full old-editor surface through renderContributedSection: content-type
 * create (newEntry template with ${key} substitution), rename/delete, and field add/rename/
 * delete/require/type/format/reference/nested edits via the schema-builder control — all persisting
 * through projectState.projectConfig + platform.writeFile("project.json", …).
 *
 * Parity note: the parser fragment declares the content-type `format` as a plain string, so it
 * renders as a textfield (a `#/$context/$formats` enum would render a picker) — same as the old
 * editor, which surfaced no format control at all.
 *
 * **The section around the builder is a Jx document now**
 * (`src/surfaces/settings-contributed.json`), so the two halves are addressed differently on
 * purpose. The section's own chrome — the entry list, the entry name, the delete button, the empty
 * state — is reached by `part` and by an entry's `data-entry` key, and the container is appended to
 * the document and every render awaited, because a kit element renders in `connectedCallback`. The
 * FIELD CARDS are not this surface: they are `ui/schema-form.ts`'s schema-builder control, still
 * lit over Spectrum, rendered into the empty `[part="form-host"]` the document announces — so
 * `.schema-field-card`, `sp-picker` and `[title="Delete field"]` remain exactly the right way to
 * reach one.
 */
import { flush, installMockPlatform, key, pointer, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import contentClass from "@jxsuite/parser/Content.class.json";
import parserFragment from "@jxsuite/parser/schemas/project.fragment.schema.json";
import { deriveSettingsSection } from "../src/settings/extension-sections";
import {
  renderContributedSection,
  resetContributedSectionState,
} from "../src/settings/contributed-section";
import { resetFormControlUiState } from "../src/ui/form-controls";
import { projectState } from "../src/store";
import type { ExtensionContributionInfo } from "../src/types";
import type { MockPlatformState } from "./harness";
import type { SettingsContribution } from "../src/settings/contributed-section";

type ValueEl = HTMLElement & { value: string };
type AnyRecord = Record<string, any>;

// ─── The real parser contribution, exactly as the backend wires it ──────────

const parserClass = contentClass as AnyRecord;
const fragment = parserFragment as AnyRecord;

const wireContribution: ExtensionContributionInfo = {
  className: "Content",
  entrySchema: fragment.properties.content,
  project: parserClass.project,
  studio: parserClass.$studio,
};

function derivedContribution(): SettingsContribution {
  const derived = deriveSettingsSection(wireContribution);
  if (!derived) {
    throw new Error("parser's Content class must derive a settings section");
  }
  return derived.contribution;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function commitValue(el: Element, value: string): void {
  (el as ValueEl).value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function inputValue(el: Element, value: string): void {
  (el as ValueEl).value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(scope: HTMLElement, text: string): Element {
  const el = [...scope.querySelectorAll("sp-action-button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!el) {
    throw new Error(`no button "${text}"`);
  }
  return el;
}

/**
 * Let the document catch up: the mount awaits the kit's registration, each kit element builds its
 * own scope in `connectedCallback`, and the schema form is drawn into the host node the document
 * announces once it exists.
 */
async function settle(): Promise<void> {
  await flush(8);
}

/** A node the SECTION's own document draws, by the `part` it carries. */
function part(root: ParentNode, name: string): HTMLElement {
  const el = root.querySelector(`[part="${name}"]`);
  if (!el) {
    throw new Error(`no [part="${name}"] in the Content Types section`);
  }
  return el as HTMLElement;
}

/** The native control a kit element wraps. */
function control(el: Element): HTMLInputElement {
  const inner = el.querySelector<HTMLInputElement>(
    'input[part="input"], textarea[part="input"], select[part="control"]',
  );
  if (!inner) {
    throw new Error(`no native control inside <${el.tagName.toLowerCase()}>`);
  }
  return inner;
}

/** Type into a kit control the way a reader does, then commit it. */
function setAndFire(el: Element, value: string, type = "change"): void {
  const inner = control(el);
  inner.value = value;
  inner.dispatchEvent(new Event("input", { bubbles: true }));
  if (type !== "input") {
    inner.dispatchEvent(new Event(type, { bubbles: true }));
  }
}

/** What a kit control currently shows. */
function shows(el: Element): string {
  return control(el).value;
}

/** One field of the schema form — its own island, addressed by the property it edits. */
function field(root: ParentNode, prop: string): HTMLElement {
  const el = root.querySelector(`[data-prop="${prop}"]`);
  if (!el) {
    throw new Error(`the entry form has no field for "${prop}"`);
  }
  return el as HTMLElement;
}

/** The content-type keys the left column is offering. */
function entryKeys(scope: HTMLElement): string[] {
  return [...scope.querySelectorAll("[data-entry]")].map(
    (el) => (el as HTMLElement).dataset.entry ?? "",
  );
}

function pickerIn(scope: HTMLElement, label: string): ValueEl {
  const el = scope.querySelector(`sp-picker[label="${label}"]`);
  if (!el) {
    throw new Error(`no ${label} picker`);
  }
  return el as ValueEl;
}

/** The (top-level) field card whose name input carries the given field name. */
function fieldCard(container: HTMLElement, fieldName: string): HTMLElement {
  const card = [...container.querySelectorAll(".schema-field-card")].find(
    (c) =>
      !c.classList.contains("schema-field-card--nested") &&
      c.querySelector(".schema-field-name-input")?.getAttribute("value") === fieldName,
  );
  if (!card) {
    throw new Error(`no field card for "${fieldName}"`);
  }
  return card as HTMLElement;
}

async function selectType(container: HTMLElement, name: string): Promise<void> {
  const button = container.querySelector(`[data-entry="${name}"]`);
  if (!button) {
    throw new Error(`no list button for content type "${name}"`);
  }
  pointer(button, "click");
  await settle();
}

/** Open the new-entry form and let the field arrive. */
async function openNewEntry(container: HTMLElement): Promise<void> {
  pointer(part(container, "new-open"), "click");
  await settle();
}

function config(): AnyRecord {
  return (projectState as AnyRecord).projectConfig;
}

function projectWrites(state: MockPlatformState): string[] {
  return state.calls
    .filter((c) => c[0] === "writeFile" && c[1] === "project.json")
    .map((c) => c[2] as string);
}

function postsConfig(): AnyRecord {
  return {
    pages: {
      schema: { properties: { title: { type: "string" } }, required: [], type: "object" },
      source: "./content/pages/",
    },
    posts: {
      format: "Markdown",
      schema: {
        properties: {
          cover: { format: "image", type: "string" },
          meta: {
            properties: { author: { type: "string" } },
            required: ["author"],
            type: "object",
          },
          related: { $ref: "#/content/pages" },
          tags: { items: { format: "image", type: "string" }, type: "array" },
          title: { type: "string" },
        },
        required: ["title"],
        type: "object",
      },
      source: "./content/posts/",
    },
  };
}

let platformState: MockPlatformState;
let container: HTMLElement;

async function setup(content: AnyRecord | null): Promise<void> {
  ({ state: platformState } = installMockPlatform());
  resetStudioState({
    projectConfig: content === null ? null : ({ content } as unknown),
  });
  container = document.createElement("div");
  document.body.append(container);
  renderContributedSection(container, derivedContribution());
  await settle();
}

beforeEach(() => {
  resetContributedSectionState();
  resetFormControlUiState();
});

afterEach(() => {
  document.body.replaceChildren();
});

// ─── Fixture sanity: the real descriptor drives the section ─────────────────

describe("parser contribution fixture", () => {
  test("Content.class.json declares the map-layout settings block the section runs on", () => {
    const contribution = derivedContribution();
    expect(contribution.key).toBe("content");
    expect(contribution.title).toBe("Content Types");
    expect(contribution.settings.layout).toBe("map");
    expect(contribution.settings.entry?.ui).toEqual({ schema: { control: "schema-builder" } });
    expect(contribution.settings.entry?.newEntry).toEqual({
      schema: { properties: {}, required: [], type: "object" },
      source: "./content/${key}/",
    });
    // The per-entry form schema comes from the fragment's additionalProperties.
    expect(Object.keys(contribution.entrySchema.properties ?? {})).toEqual([
      "$elements",
      "format",
      "schema",
      "source",
    ]);
  });
});

// ─── List panel / entry form ─────────────────────────────────────────────────

describe("content types list panel", () => {
  test("renders empty state when nothing is selected", async () => {
    await setup({});
    expect(part(container, "empty").textContent).toContain("Select or create an entry");
    expect(entryKeys(container)).toEqual([]);
  });

  test("lists existing content type names and opens the entry form on select", async () => {
    await setup(postsConfig());
    expect(entryKeys(container)).toContain("posts");
    expect(entryKeys(container)).toContain("pages");

    await selectType(container, "posts");
    expect(container.querySelector('[part="editor"]')).not.toBeNull();
    expect(shows(part(container, "entry-name"))).toBe("posts");
    // Source and format are editable form fields fed by the fragment schema.
    expect(shows(field(container, "source"))).toBe("./content/posts/");
    // The fragment declares `format` as a plain string → a text control, not a select.
    expect(field(container, "format").querySelector('[part="text"]')).not.toBeNull();
    expect(field(container, "format").querySelector('[part="select"]')).toBeNull();
    // The schema field renders through the schema-builder control with one card per field.
    expect(container.querySelector('[data-prop="schema"] .schema-builder')).not.toBeNull();
    expect(container.querySelectorAll(".schema-field-card").length).toBeGreaterThanOrEqual(5);
  });
});

// ─── New content type ────────────────────────────────────────────────────────

describe("new content type flow", () => {
  test("create via Enter slugifies the name and instantiates the newEntry template", async () => {
    await setup({});
    await openNewEntry(container);
    const input = part(container, "new-field");
    setAndFire(input, "My Blog Posts!", "input");
    await settle();
    key(control(input), "Enter");
    await settle();

    // Full old-editor parity: source from ${key} substitution + the empty object schema.
    expect(config().content["my-blog-posts"]).toEqual({
      schema: { properties: {}, required: [], type: "object" },
      source: "./content/my-blog-posts/",
    });
    expect(shows(part(container, "entry-name"))).toBe("my-blog-posts");
    expect(projectWrites(platformState)).toHaveLength(1);
    expect(JSON.parse(platformState.files.get("project.json")!).content["my-blog-posts"]).toEqual(
      config().content["my-blog-posts"],
    );
  });

  test("blank and duplicate names are rejected; Escape closes the inline form", async () => {
    await setup(postsConfig());
    await openNewEntry(container);
    const input = () => part(container, "new-field");

    setAndFire(input(), "$$$", "input");
    await settle();
    key(control(input()), "Enter");
    await settle();
    expect(Object.keys(config().content)).toEqual(["pages", "posts"]);

    setAndFire(input(), "Posts", "input");
    await settle();
    key(control(input()), "Enter");
    await settle();
    expect(config().content.posts.schema.properties.title).toEqual({ type: "string" });

    key(control(input()), "Escape");
    await settle();
    expect(container.querySelector('[part="new-field"]')).toBeNull();
    expect(projectWrites(platformState)).toHaveLength(0);
  });

  test("missing project config drops the create silently", async () => {
    await setup(null);
    await openNewEntry(container);
    const input = part(container, "new-field");
    setAndFire(input, "whatever", "input");
    await settle();
    expect(() => key(control(input), "Enter")).not.toThrow();
    await settle();
    expect(projectWrites(platformState)).toHaveLength(0);
  });
});

// ─── Rename / delete content type ────────────────────────────────────────────

describe("content type rename and delete", () => {
  test("rename slugifies, preserves order, and skips collisions", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    setAndFire(part(container, "entry-name"), "Blog Posts");
    await settle();
    expect(Object.keys(config().content)).toEqual(["pages", "blog-posts"]);
    expect(config().content["blog-posts"].source).toBe("./content/posts/");

    setAndFire(part(container, "entry-name"), "pages");
    await settle();
    expect(Object.keys(config().content)).toEqual(["pages", "blog-posts"]);
    expect(projectWrites(platformState)).toHaveLength(1);
    // Refused: the field shows the key on disk again rather than the name that was typed.
    expect(shows(part(container, "entry-name"))).toBe("blog-posts");
  });

  test("delete removes the entry and returns to the empty state", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    pointer(part(container, "delete-entry"), "click");
    await settle();
    expect(config().content.posts).toBeUndefined();
    expect(config().content.pages).toBeDefined();
    expect(container.querySelector('[part="empty"]')).not.toBeNull();
    expect(JSON.parse(platformState.files.get("project.json")!).content.posts).toBeUndefined();
  });
});

// ─── Schema-builder field CRUD (the old editor's core surface) ───────────────

describe("schema fields through the schema-builder control", () => {
  function postsSchema(): AnyRecord {
    return config().content.posts.schema;
  }

  test("add a formatted required field via the inline add form", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    pointer(buttonByText(container, "Add Field"), "click");

    const addForm = () => container.querySelector(".schema-add-field") as HTMLElement;
    inputValue(addForm().querySelector("sp-textfield")!, "hero image");
    commitValue(pickerIn(addForm(), "Format"), "image");
    const sw = addForm().querySelector("sp-switch") as HTMLElement & { checked: boolean };
    sw.checked = true;
    sw.dispatchEvent(new Event("change", { bubbles: true }));
    pointer(buttonByText(addForm(), "Add"), "click");
    await flush();

    expect(postsSchema().properties.heroImage).toEqual({ format: "image", type: "string" });
    expect(postsSchema().required).toContain("heroImage");
    expect(container.querySelector(".schema-add-field")).toBeNull();
    expect(projectWrites(platformState).length).toBeGreaterThanOrEqual(1);
  });

  test("rename camelCases, remaps required, preserves order, and rejects collisions", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    const before = Object.keys(postsSchema().properties);
    commitValue(
      fieldCard(container, "title").querySelector(".schema-field-name-input")!,
      "post title",
    );
    await flush();
    expect(postsSchema().properties.postTitle).toEqual({ type: "string" });
    expect(postsSchema().properties.title).toBeUndefined();
    expect(postsSchema().required).toContain("postTitle");
    expect(Object.keys(postsSchema().properties)).toEqual(
      before.map((k) => (k === "title" ? "postTitle" : k)),
    );

    commitValue(fieldCard(container, "cover").querySelector(".schema-field-name-input")!, "tags");
    expect(postsSchema().properties.cover).toEqual({ format: "image", type: "string" });
  });

  test("delete removes the property and its required entry", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    pointer(fieldCard(container, "title").querySelector('[title="Delete field"]')!, "click");
    await flush();
    expect(postsSchema().properties.title).toBeUndefined();
    expect(postsSchema().required).not.toContain("title");
    expect(() => fieldCard(container, "title")).toThrow();
    expect(projectWrites(platformState).length).toBeGreaterThanOrEqual(1);
  });

  test("required toggles on and off through the field switch", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    const fire = () =>
      fieldCard(container, "cover")
        .querySelector("sp-switch")!
        .dispatchEvent(new Event("change", { bubbles: true }));
    fire();
    expect(postsSchema().required).toContain("cover");
    fire();
    expect(postsSchema().required).not.toContain("cover");
  });

  test("type change string→array preserves the format on items; number drops it", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    commitValue(pickerIn(fieldCard(container, "cover"), "Type"), "array");
    expect(postsSchema().properties.cover).toEqual({
      items: { format: "image", type: "string" },
      type: "array",
    });
    commitValue(pickerIn(fieldCard(container, "cover"), "Type"), "number");
    expect(postsSchema().properties.cover).toEqual({ type: "number" });
  });

  test("format change keeps the type, landing on items for arrays", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    commitValue(pickerIn(fieldCard(container, "title"), "Format"), "date");
    expect(postsSchema().properties.title).toEqual({ format: "date", type: "string" });
    commitValue(pickerIn(fieldCard(container, "tags"), "Format"), "color");
    expect(postsSchema().properties.tags).toEqual({
      items: { format: "color", type: "string" },
      type: "array",
    });
  });

  test("reference fields pick targets from the live content map", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    const refPicker = fieldCard(container, "related").querySelector(
      ".schema-field-ref-target sp-picker",
    )!;
    expect(refPicker.getAttribute("value")).toBe("pages");
    const options = [...refPicker.querySelectorAll("sp-menu-item")].map((el) =>
      el.getAttribute("value"),
    );
    // Targets resolve through #/$context/content over the real project config.
    expect(options).toEqual(["pages", "posts"]);
    commitValue(refPicker, "posts");
    expect(postsSchema().properties.related).toEqual({ $ref: "#/content/posts" });
  });

  test("nested fields add, rename, toggle required, and delete under an object field", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    const metaCard = () => fieldCard(container, "meta");
    const metaSchema = () => postsSchema().properties.meta;

    const addRow = metaCard().querySelector(".schema-nested-add")!;
    const nameInput = addRow.querySelector(".schema-nested-add-name") as HTMLInputElement;
    nameInput.value = "birth year";
    (addRow.querySelector("sp-picker") as ValueEl).value = "number";
    key(nameInput, "Enter");
    expect(metaSchema().properties.birthYear).toEqual({ type: "number" });

    const nestedCard = (child: string) => {
      const card = [...metaCard().querySelectorAll(".schema-field-card--nested")].find(
        (c) => c.querySelector(".schema-field-name-input")?.getAttribute("value") === child,
      );
      if (!card) {
        throw new Error(`no nested card "${child}"`);
      }
      return card as HTMLElement;
    };

    commitValue(nestedCard("author").querySelector(".schema-field-name-input")!, "author name");
    expect(metaSchema().properties.authorName).toEqual({ type: "string" });
    expect(metaSchema().required).toContain("authorName");

    nestedCard("authorName")
      .querySelector("sp-switch")!
      .dispatchEvent(new Event("change", { bubbles: true }));
    expect(metaSchema().required).not.toContain("authorName");

    pointer(nestedCard("birthYear").querySelector('[title="Delete field"]')!, "click");
    expect(metaSchema().properties.birthYear).toBeUndefined();
    await flush();
    expect(projectWrites(platformState).length).toBeGreaterThanOrEqual(3);
  });

  test("every schema edit persists the whole project config to project.json", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    pointer(fieldCard(container, "cover").querySelector('[title="Delete field"]')!, "click");
    await flush();
    const persisted = JSON.parse(platformState.files.get("project.json")!);
    expect(persisted.content.posts.schema.properties.cover).toBeUndefined();
    expect(persisted.content.posts.format).toBe("Markdown");
    expect(persisted.content.pages).toBeDefined();
  });
});
