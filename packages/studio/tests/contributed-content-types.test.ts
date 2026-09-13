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
 * **Both halves are Jx documents now**, and they are addressed the same way. The section's own
 * chrome — the entry list, the entry name, the delete button, the empty state — is
 * `src/surfaces/settings-contributed.json`, reached by `part` and by an entry's `data-entry` key.
 * The FIELD CARDS are a second document below it (`src/surfaces/schema-builder.json`, the
 * schema-builder control), mounted into the empty `[part="control-host"]` the schema form draws for
 * the `schema` property — so a card is `[data-field="<name>"]`, a child is
 * `[data-nested="<name>"]`, and every control on a row carries the part it is. There is no
 * `.schema-field-card`, no `sp-picker` and no `[title="Delete field"]` anywhere in this surface any
 * more. The container is appended to the document and every render awaited, because a kit element
 * renders in `connectedCallback` and a mounted control settles a turn after the form around it.
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

/** The values a kit picker is offering. */
function pickerOptions(el: Element): string[] {
  return [...el.querySelectorAll('option[part="option"]')].map(
    (o) => o.getAttribute("value") ?? "",
  );
}

/** Flip a kit switch, the way a reader does. */
function toggleSwitch(el: Element, checked: boolean): void {
  const inner = control(el);
  inner.checked = checked;
  inner.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The (top-level) field card the schema-builder drew for a property. */
function fieldCard(container: HTMLElement, fieldName: string): HTMLElement {
  const card = container.querySelector(`[data-field="${fieldName}"]`);
  if (!card) {
    throw new Error(`no field card for "${fieldName}"`);
  }
  return card as HTMLElement;
}

/** One control of a field's own row, so a parent's is never mistaken for a child's. */
function fieldPart(container: HTMLElement, fieldName: string, name: string): HTMLElement {
  return part(part(fieldCard(container, fieldName), "field-row"), name);
}

/** One control of a field's card that is not on its row — the add row, the target picker. */
function cardPart(container: HTMLElement, fieldName: string, name: string): HTMLElement {
  return part(fieldCard(container, fieldName), name);
}

/** One control of a child's row, under the object field that holds it. */
function nestedPart(
  container: HTMLElement,
  parent: string,
  child: string,
  name: string,
): HTMLElement {
  const card = fieldCard(container, parent).querySelector(`[data-nested="${child}"]`);
  if (!card) {
    throw new Error(`no nested card for "${parent}.${child}"`);
  }
  return part(card, name);
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
    expect(container.querySelector('[data-prop="schema"] [part="builder"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-field]").length).toBeGreaterThanOrEqual(5);
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
    pointer(part(container, "add-open"), "click");
    await settle();

    setAndFire(part(container, "add-name"), "hero image", "input");
    setAndFire(part(container, "add-format"), "image");
    toggleSwitch(part(container, "add-required"), true);
    await settle();
    pointer(part(container, "add-confirm"), "click");
    await settle();

    expect(postsSchema().properties.heroImage).toEqual({ format: "image", type: "string" });
    expect(postsSchema().required).toContain("heroImage");
    expect(container.querySelector('[part="add-form"]')).toBeNull();
    expect(projectWrites(platformState).length).toBeGreaterThanOrEqual(1);
  });

  test("rename camelCases, remaps required, preserves order, and rejects collisions", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    const before = Object.keys(postsSchema().properties);
    setAndFire(fieldPart(container, "title", "field-name"), "post title");
    await settle();
    expect(postsSchema().properties.postTitle).toEqual({ type: "string" });
    expect(postsSchema().properties.title).toBeUndefined();
    expect(postsSchema().required).toContain("postTitle");
    expect(Object.keys(postsSchema().properties)).toEqual(
      before.map((k) => (k === "title" ? "postTitle" : k)),
    );

    setAndFire(fieldPart(container, "cover", "field-name"), "tags");
    await settle();
    expect(postsSchema().properties.cover).toEqual({ format: "image", type: "string" });
    // A refused rename puts the name on disk back in the field, rather than leaving the collision.
    expect(shows(fieldPart(container, "cover", "field-name"))).toBe("cover");
  });

  test("delete removes the property and its required entry", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    pointer(fieldPart(container, "title", "field-delete"), "click");
    await settle();
    expect(postsSchema().properties.title).toBeUndefined();
    expect(postsSchema().required).not.toContain("title");
    expect(() => fieldCard(container, "title")).toThrow();
    expect(projectWrites(platformState).length).toBeGreaterThanOrEqual(1);
  });

  test("required toggles on and off through the field switch", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    toggleSwitch(fieldPart(container, "cover", "field-required"), true);
    await settle();
    expect(postsSchema().required).toContain("cover");
    toggleSwitch(fieldPart(container, "cover", "field-required"), false);
    await settle();
    expect(postsSchema().required).not.toContain("cover");
  });

  test("type change string→array preserves the format on items; number drops it", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    setAndFire(fieldPart(container, "cover", "field-type"), "array");
    await settle();
    expect(postsSchema().properties.cover).toEqual({
      items: { format: "image", type: "string" },
      type: "array",
    });
    setAndFire(fieldPart(container, "cover", "field-type"), "number");
    await settle();
    expect(postsSchema().properties.cover).toEqual({ type: "number" });
  });

  test("format change keeps the type, landing on items for arrays", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    setAndFire(fieldPart(container, "title", "field-format"), "date");
    await settle();
    expect(postsSchema().properties.title).toEqual({ format: "date", type: "string" });
    setAndFire(fieldPart(container, "tags", "field-format"), "color");
    await settle();
    expect(postsSchema().properties.tags).toEqual({
      items: { format: "color", type: "string" },
      type: "array",
    });
  });

  test("reference fields pick targets from the live content map", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    const refPicker = cardPart(container, "related", "ref-target-select");
    expect(shows(refPicker)).toBe("pages");
    // Targets resolve through #/$context/content over the real project config.
    expect(pickerOptions(refPicker)).toEqual(["pages", "posts"]);
    setAndFire(refPicker, "posts");
    await settle();
    expect(postsSchema().properties.related).toEqual({ $ref: "#/content/posts" });
  });

  test("nested fields add, rename, toggle required, and delete under an object field", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    const metaSchema = () => postsSchema().properties.meta;

    setAndFire(cardPart(container, "meta", "nested-add-name"), "birth year", "input");
    setAndFire(cardPart(container, "meta", "nested-add-type"), "number");
    await settle();
    key(control(cardPart(container, "meta", "nested-add-name")), "Enter");
    await settle();
    expect(metaSchema().properties.birthYear).toEqual({ type: "number" });

    setAndFire(nestedPart(container, "meta", "author", "field-name"), "author name");
    await settle();
    expect(metaSchema().properties.authorName).toEqual({ type: "string" });
    expect(metaSchema().required).toContain("authorName");

    toggleSwitch(nestedPart(container, "meta", "authorName", "field-required"), false);
    await settle();
    expect(metaSchema().required).not.toContain("authorName");

    pointer(nestedPart(container, "meta", "birthYear", "field-delete"), "click");
    await settle();
    expect(metaSchema().properties.birthYear).toBeUndefined();
    expect(projectWrites(platformState).length).toBeGreaterThanOrEqual(3);
  });

  test("every schema edit persists the whole project config to project.json", async () => {
    await setup(postsConfig());
    await selectType(container, "posts");
    pointer(fieldPart(container, "cover", "field-delete"), "click");
    await settle();
    const persisted = JSON.parse(platformState.files.get("project.json")!);
    expect(persisted.content.posts.schema.properties.cover).toBeUndefined();
    expect(persisted.content.posts.format).toBe("Markdown");
    expect(persisted.content.pages).toBeDefined();
  });
});
