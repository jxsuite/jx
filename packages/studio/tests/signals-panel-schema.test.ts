/**
 * Signals panel — plugin schema-driven forms: renderSchemaFieldsTemplate (enum/boolean/number/
 * json-schema/array-of-objects/json controls, contentType $ref enums) and
 * renderExternalPrototypeEditorTemplate (source/prototype fields, schema cache, async loading).
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { html, render } from "lit-html";
import { activeTab } from "../src/workspace/workspace";
import {
  renderExternalPrototypeEditorTemplate,
  renderSchemaFieldsTemplate,
} from "../src/panels/signals-panel";
import { resetSlotModeMemory } from "../src/ui/dynamic-slot";
import { resetSchemaForms } from "../src/ui/schema-form";
import { initLayers } from "../src/ui/layers";
import { pluginSchemaCache } from "../src/services/code-services";
import type { JxMutableNode } from "@jxsuite/schema/types";

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  const el = document.createElement("div");
  el.id = id;
  document.body.append(el);
}
initLayers();

type ValueEl = HTMLElement & { value: string };

/** The native control a kit field is made of — what a reader actually types into or picks from. */
function native(el: Element): Element {
  return el.querySelector('[part="input"], [part="control"]') ?? el;
}

function commitValue(el: Element, value: string): void {
  const target = native(el);
  (target as ValueEl).value = value;
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

function inputValue(el: Element, value: string): void {
  const target = native(el);
  (target as ValueEl).value = value;
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The values a row's option list offers, in order. */
function optionValues(scope: HTMLElement, prop: string): (string | null)[] {
  return [...scope.querySelectorAll(`[data-prop="${prop}"] [part="option"]`)].map((el) =>
    el.getAttribute("value"),
  );
}

function pluginDef(): Record<string, unknown> {
  const tab = activeTab.value;
  if (!tab) {
    throw new Error("no active tab");
  }
  return (tab.doc.document.state as Record<string, Record<string, unknown>>).plugin as Record<
    string,
    unknown
  >;
}

/** Every container this file has attached, so one test's DOM never outlives it. */
const mounted: HTMLElement[] = [];

/**
 * Open a tab whose state holds a single `plugin` def and render schema fields for it.
 *
 * The schema form is a document now, so `renderSchemaFieldsTemplate` interpolates the element the
 * form lives in rather than a template: the container is ATTACHED (a kit element renders on
 * connect) and the mount is awaited before anything is asserted. Re-mounting under the same signal
 * name updates the STANDING form and moves its host into the new container, which is exactly what a
 * repaint of the panel does.
 */
async function mountSchema(
  schema: Record<string, unknown> | null,
  def: Record<string, unknown>,
  ctx: { renderLeftPanel: () => void } | null = null,
  documentPath?: string,
): Promise<HTMLElement> {
  resetWorkspaceWithTab({
    children: [],
    state: { plugin: def },
    tagName: "div",
  } as unknown as JxMutableNode);
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  const tab = activeTab.value;
  if (!tab) {
    throw new Error("no active tab");
  }
  const S = {
    document: tab.doc.document,
    ...(documentPath != null && { documentPath }),
  } as never;
  render(
    html`${renderSchemaFieldsTemplate(
      schema as never,
      pluginDef() as never,
      "plugin",
      S,
      ctx as never,
    )}`,
    container,
  );
  await flush(6);
  return container;
}

/**
 * Open one row's Value Source picker and hand back the menu.
 *
 * The rungs are a kit menu in the popover layer now, not a `sp-overlay` inside the row: the ladder
 * is one answer shared with every other bindable position (studio-ui-guidelines.md §6.3).
 */
async function openSourceMenu(scope: HTMLElement, prop: string): Promise<HTMLElement> {
  const chip = scope.querySelector(`[data-prop="${prop}"] [part="source"] [part="control"]`);
  if (!chip) {
    throw new Error(`no value-source chip in row ${prop}`);
  }
  pointer(chip, "click");
  await flush(6);
  const menu = document.querySelector('[data-jx-region="overlay.menu:value-source"] jx-menu');
  if (!menu) {
    throw new Error(`the value-source menu did not open for ${prop}`);
  }
  return menu as HTMLElement;
}

function fieldEl<T extends Element>(scope: HTMLElement, prop: string, selector: string): T {
  const row = scope.querySelector(`[data-prop="${prop}"]`);
  if (!row) {
    throw new Error(`no field row ${prop}`);
  }
  const el = row.querySelector(selector);
  if (!el) {
    throw new Error(`no ${selector} in row ${prop}`);
  }
  return el as T;
}

beforeEach(() => {
  resetStudioState();
  installMockPlatform();
  pluginSchemaCache.clear();
  resetSlotModeMemory();
  resetSchemaForms();
});

afterEach(() => {
  resetSchemaForms();
  for (const node of mounted.splice(0)) {
    node.remove();
  }
});

// ─── renderSchemaFieldsTemplate basics ───────────────────────────────────────

describe("renderSchemaFieldsTemplate basics", () => {
  test("no schema or missing properties → renders nothing", async () => {
    const none = await mountSchema(null, {});
    expect(none.children).toHaveLength(0);
    const noProps = await mountSchema({ type: "object" }, {});
    expect(noProps.children).toHaveLength(0);
  });

  test("studio-reserved keys are skipped", async () => {
    const container = await mountSchema(
      {
        properties: {
          $export: { type: "string" },
          $prototype: { type: "string" },
          $src: { type: "string" },
          body: { type: "string" },
          source: { type: "string" },
          timing: { type: "string" },
        },
      },
      {},
    );
    expect(container.querySelectorAll('[part="field"]')).toHaveLength(1);
    expect(container.querySelector('[data-prop="source"]')).not.toBeNull();
  });

  test("required props get a * suffix and skip the none option in enums", async () => {
    const container = await mountSchema(
      {
        properties: {
          kind: { enum: ["a", "b"] },
          title: { type: "string" },
        },
        required: ["kind", "title"],
      },
      {},
    );
    expect(
      (container.querySelector('[data-prop="title"]') as HTMLElement).dataset["required"],
    ).toBeDefined();
    expect(optionValues(container, "kind")).toEqual(["a", "b"]);
  });

  test("string field commits after debounce and clears to undefined", async () => {
    const container = await mountSchema(
      { properties: { empty: { type: "string" }, source: { type: "string" } } },
      { empty: "remove-me" },
    );
    inputValue(fieldEl(container, "source", '[part="text"]'), "posts");
    inputValue(fieldEl(container, "empty", '[part="text"]'), "");
    await new Promise((r) => {
      setTimeout(r, 460);
    });
    expect((pluginDef() as { source: string }).source).toBe("posts");
    expect((pluginDef() as { empty?: string }).empty).toBeUndefined();
  });

  test("string field placeholder comes from default, falling back to examples", async () => {
    const container = await mountSchema(
      {
        properties: {
          a: { default: "dflt", type: "string" },
          b: { examples: ["ex1"], type: "string" },
          c: { type: "string" },
        },
      },
      {},
    );
    expect(native(fieldEl(container, "a", '[part="text"]')).getAttribute("placeholder")).toBe(
      "dflt",
    );
    expect(native(fieldEl(container, "b", '[part="text"]')).getAttribute("placeholder")).toBe(
      "ex1",
    );
  });
});

// ─── Enums (including contentType refs) ──────────────────────────────────────

describe("schema enums", () => {
  test("plain enum renders a picker that commits values and clears via —", async () => {
    const container = await mountSchema(
      { properties: { layout: { enum: ["grid", "list"] } } },
      { layout: "grid" },
    );
    const picker = fieldEl<ValueEl>(container, "layout", '[part="select"]');
    expect((native(picker) as ValueEl).value).toBe("grid");
    const values = optionValues(container, "layout");
    expect(values).toEqual(["__none__", "grid", "list"]);

    commitValue(picker, "list");
    expect((pluginDef() as { layout: string }).layout).toBe("list");

    commitValue(picker, "__none__");
    expect((pluginDef() as { layout?: string }).layout).toBeUndefined();
  });

  test("picker shows schema default when no value is set", async () => {
    const container = await mountSchema(
      { properties: { mode: { default: "auto", enum: ["auto", "manual"] } } },
      {},
    );
    expect((native(fieldEl<ValueEl>(container, "mode", '[part="select"]')) as ValueEl).value).toBe(
      "auto",
    );
  });

  test("$ref #/$context/content resolves project content type keys", async () => {
    resetStudioState({
      projectConfig: { content: { page: {}, post: {} } },
    });
    const container = await mountSchema(
      { properties: { type: { enum: { $ref: "#/$context/content" } } } },
      {},
    );
    const values = optionValues(container, "type");
    expect(values).toEqual(["__none__", "page", "post"]);
  });

  test("$ref #/$context/content with no content section yields empty choices, not a textfield", async () => {
    resetStudioState({ projectConfig: {} });
    const container = await mountSchema(
      { properties: { type: { enum: { $ref: "#/$context/content" } } } },
      {},
    );
    expect(container.querySelector('[data-prop="type"] [part="select"]')).not.toBeNull();
    const values = optionValues(container, "type");
    expect(values).toEqual(["__none__"]);
  });

  // Legacy-form coverage: old class descriptors still ship `#/$context/contentTypes` refs against
  // A contentTypes-keyed project config.
  test("legacy $ref #/$context/contentTypes resolves a contentTypes-keyed config", async () => {
    resetStudioState({
      projectConfig: { contentTypes: { page: {}, post: {} } },
    });
    const container = await mountSchema(
      { properties: { type: { enum: { $ref: "#/$context/contentTypes" } } } },
      {},
    );
    const values = optionValues(container, "type");
    expect(values).toEqual(["__none__", "page", "post"]);
  });

  // Legacy-form coverage: the deprecated string sentinel keeps resolving the legacy key.
  test("legacy $contentTypes sentinel resolves the same keys", async () => {
    resetStudioState({ projectConfig: { contentTypes: { doc: {} } } });
    const container = await mountSchema({ properties: { type: { enum: "$contentTypes" } } }, {});
    const values = optionValues(container, "type");
    expect(values).toEqual(["__none__", "doc"]);
  });

  test("dependent {@param} ref resolves properties of the selected content type", async () => {
    resetStudioState({
      projectConfig: {
        content: {
          post: { schema: { properties: { date: {}, title: {} } } },
        },
      },
    });
    const container = await mountSchema(
      {
        properties: {
          field: { enum: { $ref: "#/$context/content/{@type}/schema/properties" } },
        },
      },
      { type: "post" },
    );
    const values = optionValues(container, "field");
    expect(values).toEqual(["__none__", "date", "title"]);
  });

  test("dependent ref without a selected param falls back to a text field", async () => {
    resetStudioState({
      projectConfig: { content: { post: { schema: { properties: { title: {} } } } } },
    });
    const container = await mountSchema(
      {
        properties: {
          field: { enum: { $ref: "#/$context/content/{@type}/schema/properties" } },
        },
      },
      {},
    );
    expect(container.querySelector('[data-prop="field"] [part="select"]')).toBeNull();
    expect(container.querySelector('[data-prop="field"] [part="text"]')).not.toBeNull();
  });

  test("unresolvable enum shapes fall back to a text field", async () => {
    const container = await mountSchema(
      {
        properties: {
          a: { enum: { $ref: "#/other/path" } },
          b: { enum: {} },
        },
      },
      {},
    );
    expect(container.querySelector('[data-prop="a"] [part="text"]')).not.toBeNull();
    expect(container.querySelector('[data-prop="b"] [part="text"]')).not.toBeNull();
  });
});

// ─── Boolean / number / JSON controls ────────────────────────────────────────

describe("schema typed controls", () => {
  test("boolean renders a checkbox that commits checked state", async () => {
    const container = await mountSchema({ properties: { live: { type: "boolean" } } }, {});
    const check = fieldEl<HTMLElement & { checked: boolean }>(
      container,
      "live",
      '[part="checkbox"]',
    );
    check.checked = true;
    check.dispatchEvent(new Event("change", { bubbles: true }));
    expect((pluginDef() as { live: boolean }).live).toBe(true);
  });

  test("integer and number fields parse after debounce; blank clears", async () => {
    const container = await mountSchema(
      {
        properties: {
          limit: { maximum: 100, minimum: 1, type: "integer" },
          old: { type: "integer" },
          ratio: { type: "number" },
        },
      },
      { old: 3 },
    );
    commitValue(fieldEl(container, "limit", '[part="number"]'), "7");
    commitValue(fieldEl(container, "ratio", '[part="number"]'), "2.5");
    commitValue(fieldEl(container, "old", '[part="number"]'), "");
    await new Promise((r) => {
      setTimeout(r, 460);
    });
    expect((pluginDef() as { limit: number }).limit).toBe(7);
    expect((pluginDef() as { ratio: number }).ratio).toBe(2.5);
    expect((pluginDef() as { old?: number }).old).toBeUndefined();
  });

  test("array/object props render a JSON textfield committing parsed values", async () => {
    const container = await mountSchema(
      {
        properties: {
          bad: { type: "object" },
          tags: { type: "array" },
        },
      },
      { bad: { keep: true } },
    );
    inputValue(fieldEl(container, "tags", '[part="json-text"]'), '["a","b"]');
    inputValue(fieldEl(container, "bad", '[part="json-text"]'), "{nope");
    await new Promise((r) => {
      setTimeout(r, 560);
    });
    expect((pluginDef() as { tags: string[] }).tags).toEqual(["a", "b"]);
    // Invalid JSON is ignored
    expect((pluginDef() as { bad: unknown }).bad).toEqual({ keep: true } as never);
  });

  test("json-schema format shows property chips and commits parsed JSON", async () => {
    const container = await mountSchema(
      { properties: { shape: { format: "json-schema", type: "object" } } },
      { shape: { properties: { count: { type: "number" }, name: {} }, type: "object" } },
    );
    const chips = [...container.querySelectorAll('[part="chip"]')].map((el) =>
      el.textContent?.trim(),
    );
    expect(chips).toContain("count: number");
    expect(chips).toContain("name: any");

    inputValue(
      fieldEl(container, "shape", '[part="json-text"]'),
      '{"type":"object","properties":{"x":{"type":"string"}}}',
    );
    await new Promise((r) => {
      setTimeout(r, 560);
    });
    expect(
      (pluginDef() as { shape: { properties: Record<string, unknown> } }).shape.properties,
    ).toEqual({ x: { type: "string" } } as never);
  });

  test("json-schema format with a $ref value hides chips; invalid input is ignored", async () => {
    const container = await mountSchema(
      { properties: { shape: { format: "json-schema", type: "object" } } },
      { shape: { $ref: "#/defs/thing" } },
    );
    const chips = [...container.querySelectorAll('[part="chip"]')];
    expect(chips).toHaveLength(0);

    inputValue(fieldEl(container, "shape", '[part="json-text"]'), "{broken");
    await new Promise((r) => {
      setTimeout(r, 560);
    });
    expect((pluginDef() as { shape: unknown }).shape).toEqual({ $ref: "#/defs/thing" } as never);
  });
});

// ─── Array-of-objects rows ────────────────────────────────────────────────────

describe("array-of-objects fields", () => {
  const columnsSchema = {
    properties: {
      columns: {
        items: {
          properties: {
            align: { enum: ["left", "right"] },
            label: { default: "col", type: "string" },
            ratio: { type: "number" },
            visible: { type: "boolean" },
            width: { type: "integer" },
          },
          type: "object",
        },
        type: "array",
      },
    },
  };

  test("renders one row per entry with typed inline controls", async () => {
    const container = await mountSchema(columnsSchema, {
      columns: [{ align: "left", label: "a", ratio: 0.5, visible: true, width: 2 }],
    });
    const row = container.querySelector('[part="row"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.querySelector('[part="cell-select"]')).not.toBeNull();
    expect(row.querySelector('[part="cell-checkbox"]')).not.toBeNull();
    expect(row.querySelectorAll('[part="cell-number"]')).toHaveLength(2);
    expect(row.querySelector('[part="cell-text"]')).not.toBeNull();
  });

  test("inline text/switch/number/enum edits update the row in place", async () => {
    const def = {
      columns: [{ align: "left", label: "a", visible: true, width: 2 }],
    };
    let container = await mountSchema(columnsSchema, def);
    const row = () => container.querySelector('[part="row"]') as HTMLElement;
    const cols = () => (pluginDef() as { columns: never[] }).columns;
    // Remount with a plain clone — the tab document is a reactive proxy, which structuredClone
    // Cannot handle, so JSON round-trip instead.
    const remount = async () => {
      // oxlint-disable-next-line unicorn/prefer-structured-clone
      const plainColumns = JSON.parse(JSON.stringify(cols()));
      container = await mountSchema(columnsSchema, { columns: plainColumns });
    };

    inputValue(row().querySelector('[part="cell-text"]') as Element, "renamed");
    expect((cols()[0]! as { label: string }).label).toBe("renamed");

    await remount();
    const sw = row().querySelector('[part="cell-checkbox"]') as HTMLElement & { checked: boolean };
    sw.checked = false;
    sw.dispatchEvent(new Event("change", { bubbles: true }));
    expect((cols()[0]! as { visible: boolean }).visible).toBe(false);

    await remount();
    commitValue(row().querySelectorAll('[part="cell-number"]')[1] as Element, "5");
    expect((cols()[0]! as { width: number }).width).toBe(5);

    await remount();
    commitValue(row().querySelectorAll('[part="cell-number"]')[0] as Element, "1.5");
    expect((cols()[0]! as { ratio: number }).ratio).toBe(1.5);

    await remount();
    commitValue(row().querySelectorAll('[part="cell-number"]')[1] as Element, "");
    expect((cols()[0]! as { width?: number }).width).toBeUndefined();

    await remount();
    commitValue(row().querySelector('[part="cell-select"]') as Element, "right");
    expect((cols()[0]! as { align: string }).align).toBe("right");

    await remount();
    commitValue(row().querySelector('[part="cell-select"]') as Element, "__none__");
    expect((cols()[0]! as { align?: string }).align).toBeUndefined();
  });

  test("add button appends a row seeded with item defaults and notifies ctx", async () => {
    let renders = 0;
    const container = await mountSchema(
      columnsSchema,
      {},
      {
        renderLeftPanel: () => {
          renders += 1;
        },
      },
    );
    pointer(container.querySelector('[part="row-add"] [part="control"]') as Element, "click");
    expect((pluginDef() as { columns: never[] }).columns).toEqual([{ label: "col" }] as never[]);
    expect(renders).toBe(1);
  });

  test("delete removes a row, clearing the key for the last one (null ctx ok)", async () => {
    let container = await mountSchema(columnsSchema, {
      columns: [{ label: "a" }, { label: "b" }],
    });
    const delButtons = () =>
      [...container.querySelectorAll('[part="row-remove"] [part="control"]')] as Element[];
    pointer(delButtons()[0] as Element, "click");
    expect((pluginDef() as { columns: never[] }).columns).toEqual([{ label: "b" }] as never[]);

    container = await mountSchema(columnsSchema, {
      columns: [{ label: "only" }],
    });
    pointer(delButtons()[0] as Element, "click");
    expect((pluginDef() as { columns?: unknown }).columns).toBeUndefined();
  });

  test("inline enum with dependent contentType ref resolves against the row's parent def", async () => {
    resetStudioState({
      projectConfig: {
        content: { post: { schema: { properties: { slug: {}, title: {} } } } },
      },
    });
    const schema = {
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
    };
    const container = await mountSchema(schema, { fields: [{}], type: "post" });
    const values = [...container.querySelectorAll('[part="row"] [part="option"]')].map((el) =>
      el.getAttribute("value"),
    );
    expect(values).toEqual(["__none__", "slug", "title"]);
  });
});

// ─── Binding a config field (§6.6's one ladder) ──────────────────────────────

describe("binding a config field", () => {
  const stringSchema = { properties: { id: { type: "string" } } };
  const skuDoc = "pages/products/[sku].json";

  async function rungs(container: HTMLElement, prop: string): Promise<string[]> {
    const menu = await openSourceMenu(container, prop);
    return [...menu.querySelectorAll<HTMLElement>("jx-menu-item")].map(
      (el) => el.dataset["commandId"]!,
    );
  }

  /** Choose a rung the way a reader does: open the picker and click the row. */
  async function chooseRung(container: HTMLElement, prop: string, rung: string): Promise<void> {
    const menu = await openSourceMenu(container, prop);
    menu.querySelector<HTMLElement>(`[data-command-id="${rung}"]`)!.click();
    await flush(2);
  }

  test("the rungs are the ladder's own words, not a private Static / param / Custom… list", async () => {
    const container = await mountSchema(stringSchema, { id: "abc" }, null, skuDoc);
    const chip = container.querySelector('[data-prop="id"] [part="source"]')!;
    expect(chip.textContent!.trim()).toBe("Fixed value");
    expect(await rungs(container, "id")).toEqual(["literal", "ref", "template"]);
    const menu = await openSourceMenu(container, "id");
    const labels = [...menu.querySelectorAll<HTMLElement>("jx-menu-item")].map((el) =>
      el.textContent!.trim(),
    );
    expect(labels).toEqual(["Fixed value", "From data…", "Mixed text"]);
  });

  test("a plain string field can START a binding — the gesture that did not exist", async () => {
    const container = await mountSchema(stringSchema, { id: "abc" }, null, skuDoc);
    await chooseRung(container, "id", "ref");
    expect((pluginDef() as { id: unknown }).id).toEqual({ $ref: "#/$params/sku" } as never);
  });

  test("a $ref value renders the pointer, never [object Object]", async () => {
    const container = await mountSchema(
      stringSchema,
      { id: { $ref: "#/$params/sku" } },
      null,
      skuDoc,
    );
    const combo = fieldEl<ValueEl>(container, "id", '[part="pointer"]');
    expect(combo.value).toBe("#/$params/sku");
    expect(container.querySelector('[data-prop="id"] [part="source"]')!.textContent!.trim()).toBe(
      "From data…",
    );
    expect(container.textContent).not.toContain("[object Object]");
  });

  test("picking another param commits the new $ref", async () => {
    const container = await mountSchema(
      stringSchema,
      { id: { $ref: "#/$params/a" } },
      null,
      "pages/[a]/[b].json",
    );
    commitValue(fieldEl(container, "id", '[part="pointer"]'), "#/$params/b");
    expect((pluginDef() as { id: unknown }).id).toEqual({ $ref: "#/$params/b" } as never);
  });

  test("a pointer outside the offered list is still accepted, and blank clears the key", async () => {
    const container = await mountSchema(
      stringSchema,
      { id: { $ref: "#/$params/sku" } },
      null,
      skuDoc,
    );
    commitValue(fieldEl(container, "id", '[part="pointer"]'), "#/other/path");
    expect((pluginDef() as { id: unknown }).id).toEqual({ $ref: "#/other/path" } as never);

    const blank = await mountSchema(stringSchema, { id: { $ref: "#/custom/ref" } }, null, skuDoc);
    commitValue(fieldEl(blank, "id", '[part="pointer"]'), "  ");
    expect((pluginDef() as { id?: unknown }).id).toBeUndefined();
  });

  test("going back to Fixed value drops the binding", async () => {
    const container = await mountSchema(
      stringSchema,
      { id: { $ref: "#/$params/sku" } },
      null,
      skuDoc,
    );
    await chooseRung(container, "id", "literal");
    expect((pluginDef() as { id?: unknown }).id).toBeUndefined();
  });

  test("a document with no route params and no other signal offers no source", async () => {
    const container = await mountSchema(stringSchema, { id: "abc" }, null, "pages/index.json");
    expect(container.querySelector('[data-prop="id"] [part="source"]')).toBeNull();
    expect(fieldEl<ValueEl>(container, "id", '[part="text"]').value).toBe("abc");
  });

  test("a sibling signal is a source too, and the def never offers itself", async () => {
    resetWorkspaceWithTab({
      children: [],
      state: { count: { default: 0, type: "number" }, plugin: { id: "abc" } },
      tagName: "div",
    } as unknown as JxMutableNode);
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    const tab = activeTab.value!;
    render(
      html`${renderSchemaFieldsTemplate(
        stringSchema as never,
        (tab.doc.document.state as Record<string, unknown>).plugin as never,
        "plugin",
        { document: tab.doc.document } as never,
        null,
      )}`,
      container,
    );
    await flush(6);
    await chooseRung(container, "id", "ref");
    expect(
      (
        (tab.doc.document.state as Record<string, Record<string, unknown>>).plugin as {
          id: unknown;
        }
      ).id,
    ).toEqual({ $ref: "#/state/count" } as never);
  });

  test("an enum prop keeps its choices and gains the binding rung, but never Mixed text", async () => {
    const container = await mountSchema(
      { properties: { layout: { enum: ["grid", "list"] } } },
      { layout: "grid" },
      null,
      skuDoc,
    );
    expect(await rungs(container, "layout")).toEqual(["literal", "ref"]);
    const values = optionValues(container, "layout");
    expect(values).toEqual(["__none__", "grid", "list"]);
  });

  test("json-schema format props keep their editor and get no chip", async () => {
    const container = await mountSchema(
      { properties: { shape: { format: "json-schema", type: "object" } } },
      { shape: { $ref: "#/defs/thing" } },
      null,
      skuDoc,
    );
    expect(container.querySelector('[data-prop="shape"] [part="json"]')).not.toBeNull();
    expect(container.querySelector('[data-prop="shape"] [part="source"]')).toBeNull();
  });

  test("array-of-objects cell with a $ref shows the ref string and preserves the shape", async () => {
    const schema = {
      properties: {
        columns: {
          items: { properties: { source: { type: "string" } }, type: "object" },
          type: "array",
        },
      },
    };
    const container = await mountSchema(schema, {
      columns: [{ source: { $ref: "#/$params/sku" } }],
    });
    const tf = container.querySelector('[part="row"] [part="cell-text"]') as ValueEl;
    expect(tf.value).toBe("#/$params/sku");
    expect(container.textContent).not.toContain("[object Object]");
    commitValue(tf, "#/$params/other");
    expect((pluginDef() as { columns: { source: unknown }[] }).columns[0]!.source).toEqual({
      $ref: "#/$params/other",
    } as never);
  });
});

// ─── renderExternalPrototypeEditorTemplate ───────────────────────────────────

interface ExternalMount {
  container: HTMLElement;
  calls: { left: number };
  rerender: () => void;
  /**
   * What the panel said on its FIRST paint, before anything settled.
   *
   * A schema fetch is in flight at that moment and the config form below it is a document being
   * mounted, so "Loading schema…" is only observable here — by the time the mount has settled the
   * fetch it triggered has resolved too.
   */
  initialText: string;
}

async function mountExternal(
  def: Record<string, unknown>,
  opts: { documentPath?: string } = {},
): Promise<ExternalMount> {
  resetWorkspaceWithTab({
    children: [],
    state: { plugin: def },
    tagName: "div",
  } as unknown as JxMutableNode);
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  const calls = { left: 0 };
  const tab = activeTab.value;
  if (!tab) {
    throw new Error("no active tab");
  }
  const S = {
    document: tab.doc.document,
    ...(opts.documentPath != null && { documentPath: opts.documentPath }),
  } as never;
  const ctx = {
    renderLeftPanel: () => {
      calls.left += 1;
      render(
        html`${renderExternalPrototypeEditorTemplate(S, "plugin", pluginDef() as never, ctx)}`,
        container,
      );
    },
  };
  const rerender = () =>
    render(
      html`${renderExternalPrototypeEditorTemplate(S, "plugin", pluginDef() as never, ctx)}`,
      container,
    );
  rerender();
  const initialText = container.textContent ?? "";
  await flush(6);
  return { calls, container, initialText, rerender };
}

describe("renderExternalPrototypeEditorTemplate", () => {
  test("shows Source/Kind fields when the prototype is not imported", async () => {
    const m = await mountExternal({ $prototype: "Widget", $src: "./w.js" });
    expect(m.container.querySelector('[data-prop="Source"]')).not.toBeNull();
    expect(m.container.querySelector('[data-prop="Kind"]')).not.toBeNull();
    expect(m.container.querySelector('[data-prop="Export"]')).toBeNull();
  });

  test("Source/Kind commits update the def and invalidate the schema cache", async () => {
    pluginSchemaCache.set("./w.js::Widget", null);
    pluginSchemaCache.set("./new.js::Widget", { properties: {} });
    const m = await mountExternal({ $prototype: "Widget", $src: "./w.js" });
    commitValue(fieldEl(m.container, "Source", "sp-textfield"), "./new.js");
    expect((pluginDef() as { $src: string }).$src).toBe("./new.js");
    expect(pluginSchemaCache.has("./new.js::Widget")).toBe(false);

    pluginSchemaCache.set("./new.js::Gadget", { properties: {} });
    m.rerender();
    commitValue(fieldEl(m.container, "Kind", "sp-textfield"), "Gadget");
    expect((pluginDef() as { $prototype: string }).$prototype).toBe("Gadget");
    expect(pluginSchemaCache.has("./new.js::Gadget")).toBe(false);
  });

  test("Export field appears when $export is set and commits changes", async () => {
    pluginSchemaCache.set("./w.js::Widget", null);
    const m = await mountExternal({ $export: "make", $prototype: "Widget", $src: "./w.js" });
    commitValue(fieldEl(m.container, "Export", "sp-textfield"), "build");
    expect((pluginDef() as { $export: string }).$export).toBe("build");
  });

  test("imported prototypes show a hint instead of Source/Prototype fields", async () => {
    resetStudioState({ projectConfig: { imports: { Widget: "./plugins/widget.js" } } });
    pluginSchemaCache.set("./plugins/widget.js::Widget", null);
    const m = await mountExternal({ $prototype: "Widget" });
    expect(m.container.querySelector('[data-prop="Source"]')).toBeNull();
    expect(m.container.querySelector(".signal-hint")?.textContent?.trim()).toBe("Widget");
  });

  test("cached schema renders its description and config fields", async () => {
    pluginSchemaCache.set("./w.js::Widget", {
      description: "A fine widget",
      properties: { color: { type: "string" } },
    });
    const m = await mountExternal({ $prototype: "Widget", $src: "./w.js" });
    expect(m.container.textContent).toContain("A fine widget");
    expect(m.container.querySelector('[data-prop="color"] [part="text"]')).not.toBeNull();
  });

  test("cached null schema renders no config section", async () => {
    pluginSchemaCache.set("./w.js::Widget", null);
    const m = await mountExternal({ $prototype: "Widget", $src: "./w.js" });
    expect(m.container.textContent).not.toContain("Loading schema");
    // Source + Prototype only, and those two rows are `ui/field-row.ts`'s — still lit.
    expect(m.container.querySelectorAll(".style-row")).toHaveLength(2);
  });

  test("uncached schema shows a loading hint, fetches, then re-renders the panel", async () => {
    installMockPlatform({
      fetchPluginSchema: async () => ({ properties: { size: { type: "integer" } } }),
    });
    const m = await mountExternal(
      { $prototype: "Widget", $src: "./w.js" },
      { documentPath: "pages/index.json" },
    );
    expect(m.initialText).toContain("Loading schema…");
    await flush();
    expect(m.calls.left).toBe(1);
    expect(pluginSchemaCache.get("./w.js::Widget")).toEqual({
      properties: { size: { type: "integer" } },
    });
    expect(m.container.querySelector('[data-prop="size"] [part="number"]')).not.toBeNull();
  });

  test("fetch resolving to null leaves the panel without a schema section", async () => {
    const m = await mountExternal({ $prototype: "Widget", $src: "./w.js" });
    expect(m.initialText).toContain("Loading schema…");
    await flush();
    expect(m.calls.left).toBe(0);
    expect(pluginSchemaCache.get("./w.js::Widget")).toBeNull();
    m.rerender();
    expect(m.container.textContent).not.toContain("Loading schema");
  });

  test("def without $prototype renders the plain Source/Prototype fields and no schema", async () => {
    const m = await mountExternal({ $src: "./w.js" });
    expect(m.container.querySelector('[data-prop="Source"]')).not.toBeNull();
    expect(m.container.textContent).not.toContain("Loading schema");
  });
});
