/**
 * The Data panel's plugin config form: the schema-driven fields an external `$prototype` gets, and
 * the Source/Kind/Export rows above them.
 *
 * The panel is a document (`src/surfaces/panel-signals.json`) and the form is a document of its own
 * (`src/ui/schema-form.ts`), so the two meet at an ISLAND: the panel draws an empty
 * `[part="slot-host"][data-slot="schema"]` and `panels/signals-panel.ts` puts the form's host in
 * it. Every test here mounts the real panel and then scopes to that host, which is what
 * `renderSchemaFieldsTemplate` used to hand back — so what the form draws is asserted exactly as it
 * was, and the panel's own decisions (the reserved-key filter, the context pointers, the sibling
 * signals a value may bind to, and the cache) are on the same path they take in the app.
 */
import {
  clearSignalPanels,
  drawSignals,
  editorFor,
  openEntry,
  settle,
} from "./signals-panel-fixture";
import { flush, installMockPlatform, pointer, resetStudioState } from "./harness";
import { printedOf } from "./kit-readers";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeTab } from "../src/workspace/workspace";
import { resetSlotModeMemory } from "../src/ui/dynamic-slot";
import { resetSchemaForms } from "../src/ui/schema-form";
import { initLayers } from "../src/ui/layers";
import { pluginSchemaCache } from "../src/services/code-services";
import type { PluginSchema } from "../src/services/code-services";
import { isBoolean, isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  const el = document.createElement("div");
  el.id = id;
  document.body.append(el);
}
initLayers();

/** The `$src` every plugin entry in this file is defined against. */
const SRC = "./w.js";
/** The cache key `SRC` plus the prototype resolve to. */
const KEY = `${SRC}::Widget`;

/** The native control a kit field is made of — what a reader actually types into or picks from. */
function native(el: Element): Element {
  return el.querySelector('[part="input"], [part="control"]') ?? el;
}

/** A control that carries a string `value`: a native input, select or textarea, or a kit field. */
function hasValue(el: Element): el is Element & { value: string } {
  return "value" in el && isString(el.value);
}

/** A control that carries a boolean `checked`: a native checkbox or a kit checkbox/switch. */
function isCheckable(el: Element): el is Element & { checked: boolean } {
  return "checked" in el && isBoolean(el.checked);
}

/** The string a control currently holds, or a throw naming the element that holds none. */
function valueOf(el: Element): string {
  if (!hasValue(el)) {
    throw new Error(`<${el.localName}> carries no string value`);
  }
  return el.value;
}

/** Type `value` into a field's native control and fire `type` the way a reader's edit does. */
function setValue(el: Element, value: string, type: "change" | "input"): void {
  const target = native(el);
  if (!hasValue(target)) {
    throw new Error(`<${target.localName}> carries no string value`);
  }
  target.value = value;
  target.dispatchEvent(new Event(type, { bubbles: true }));
}

function commitValue(el: Element, value: string): void {
  setValue(el, value, "change");
}

function inputValue(el: Element, value: string): void {
  setValue(el, value, "input");
}

/** Tick or untick a checkbox and commit it the way a reader's click does. */
function setChecked(el: Element, checked: boolean): void {
  if (!isCheckable(el)) {
    throw new Error(`<${el.localName}> carries no checked state`);
  }
  el.checked = checked;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The `index`th match of `selector` under `scope`, or a throw naming what was not drawn. */
function nth(scope: ParentNode, selector: string, index = 0): Element {
  const el = scope.querySelectorAll(selector)[index];
  if (!el) {
    throw new Error(`no ${selector} #${index} drawn`);
  }
  return el;
}

/** `key` of a JSON object, or undefined for anything that is not one. */
function member(value: JsonValue | undefined, key: string): JsonValue | undefined {
  return isJsonObject(value) ? value[key] : undefined;
}

/** The values a row's option list offers, in order. */
function optionValues(scope: HTMLElement, prop: string): (string | null)[] {
  return [...scope.querySelectorAll(`[data-prop="${prop}"] [part="option"]`)].map((el) =>
    el.getAttribute("value"),
  );
}

/** The `plugin` entry as the tab's document holds it now. */
function pluginDef(): JsonObject {
  const tab = activeTab.value;
  if (!tab) {
    throw new Error("no active tab");
  }
  const def = tab.doc.document.state?.["plugin"];
  if (!isJsonObject(def)) {
    throw new Error("the document has no plugin entry");
  }
  return def;
}

/** The `index`th row of the plugin's `columns`, or a throw naming what is there instead. */
function column(index: number): JsonObject {
  const { columns } = pluginDef();
  const row = Array.isArray(columns) ? columns[index] : undefined;
  if (!isJsonObject(row)) {
    throw new Error(`no columns row ${index}`);
  }
  return row;
}

/** The last panel drawn, so a test can ask it for a repaint or read its counts. */
let panel: HTMLElement;
let repaints: { repaints: number; refreshes: number };
let redraw: () => void;

/**
 * Open a document whose one entry is an external `Widget`, with `schema` already cached, and hand
 * back the island the config form was mounted into.
 *
 * The schema is SEEDED rather than fetched, which is what makes this a test of the form rather than
 * of the platform: the fetch path is exercised on its own below.
 */
async function mountSchema(
  schema: PluginSchema | null,
  def: JsonObject,
  documentPath?: string,
): Promise<HTMLElement> {
  pluginSchemaCache.set(KEY, schema);
  const drawn = await drawSignals(
    { plugin: { $prototype: "Widget", $src: SRC, ...def } },
    ...(documentPath === undefined ? [] : [{ documentPath }]),
  );
  ({ counts: repaints, panel, repaint: redraw } = drawn);
  await openEntry(panel, "plugin");
  drawn.resetCounts();
  return schemaHost();
}

/** The island the config form stands in, or a throw naming what the panel drew instead. */
function schemaHost(): HTMLElement {
  const host = editorFor(panel, "plugin").querySelector<HTMLElement>(
    '[part="slot-host"][data-slot="schema"]',
  );
  if (!host) {
    throw new Error("the panel drew no config-form island for this entry");
  }
  return host;
}

/**
 * Open one row's Value Source picker and hand back the menu.
 *
 * The rungs are a kit menu in the popover layer now, not a `sp-overlay` inside the row: the ladder
 * is one answer shared with every other bindable position (the value-source ladder, §6.6).
 */
async function openSourceMenu(scope: HTMLElement, prop: string): Promise<HTMLElement> {
  const chip = scope.querySelector(`[data-prop="${prop}"] [part="source"] [part="control"]`);
  if (!chip) {
    throw new Error(`no value-source chip in row ${prop}`);
  }
  pointer(chip, "click");
  await flush(6);
  const menu = document.querySelector('[data-jx-region="overlay.menu:value-source"] jx-menu');
  if (!(menu instanceof HTMLElement)) {
    throw new TypeError(`the value-source menu did not open for ${prop}`);
  }
  return menu;
}

function fieldEl(scope: HTMLElement, prop: string, selector: string): Element {
  const row = scope.querySelector(`[data-prop="${prop}"]`);
  if (!row) {
    throw new Error(`no field row ${prop}`);
  }
  const el = row.querySelector(selector);
  if (!el) {
    throw new Error(`no ${selector} in row ${prop}`);
  }
  return el;
}

beforeEach(() => {
  /* First, because the schema cache is reactive and a standing render effect from the last test
     would run against a workspace this one has not built yet. */
  clearSignalPanels();
  resetStudioState();
  installMockPlatform();
  pluginSchemaCache.clear();
  resetSlotModeMemory();
  resetSchemaForms();
});

afterEach(() => {
  resetSchemaForms();
  clearSignalPanels();
});

// ─── renderSchemaFieldsTemplate basics ───────────────────────────────────────

describe("renderSchemaFieldsTemplate basics", () => {
  test("no schema draws no island; a schema with no properties draws an empty one", async () => {
    // The two are different answers: a schema the platform said was `null` is a plugin with
    // Nothing to configure, and the panel offers no section at all; a schema that arrived and
    // Declares no properties still has a host, so the day it grows one there is nowhere new to put
    // It.
    pluginSchemaCache.set(KEY, null);
    const drawn = await drawSignals({ plugin: { $prototype: "Widget", $src: SRC } });
    ({ panel } = drawn);
    const opened = await openEntry(panel, "plugin");
    expect(opened.querySelector('[part="slot-host"][data-slot="schema"]')).toBeNull();

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
    expect(container.querySelector('[data-prop="title"][data-required]')).not.toBeNull();
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
    expect(pluginDef().source).toBe("posts");
    expect(pluginDef().empty).toBeUndefined();
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
    const picker = fieldEl(container, "layout", '[part="select"]');
    expect(valueOf(native(picker))).toBe("grid");
    const values = optionValues(container, "layout");
    expect(values).toEqual(["__none__", "grid", "list"]);

    commitValue(picker, "list");
    expect(pluginDef().layout).toBe("list");

    commitValue(picker, "__none__");
    expect(pluginDef().layout).toBeUndefined();
  });

  test("picker shows schema default when no value is set", async () => {
    const container = await mountSchema(
      { properties: { mode: { default: "auto", enum: ["auto", "manual"] } } },
      {},
    );
    const picker = fieldEl(container, "mode", '[part="select"]');
    expect(valueOf(native(picker))).toBe("auto");
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
    setChecked(fieldEl(container, "live", '[part="checkbox"]'), true);
    expect(pluginDef().live).toBe(true);
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
    expect(pluginDef().limit).toBe(7);
    expect(pluginDef().ratio).toBe(2.5);
    expect(pluginDef().old).toBeUndefined();
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
    expect(pluginDef().tags).toEqual(["a", "b"]);
    // Invalid JSON is ignored
    expect(pluginDef().bad).toEqual({ keep: true });
  });

  test("json-schema format shows property chips and commits parsed JSON", async () => {
    const container = await mountSchema(
      { properties: { itemSchema: { format: "json-schema", type: "object" } } },
      { itemSchema: { properties: { count: { type: "number" }, name: {} }, type: "object" } },
    );
    const chips = [...container.querySelectorAll('[part="chip"]')].map((el) =>
      el.textContent.trim(),
    );
    expect(chips).toContain("count: number");
    expect(chips).toContain("name: any");

    inputValue(
      fieldEl(container, "itemSchema", '[part="json-text"]'),
      '{"type":"object","properties":{"x":{"type":"string"}}}',
    );
    await new Promise((r) => {
      setTimeout(r, 560);
    });
    expect(member(pluginDef().itemSchema, "properties")).toEqual({ x: { type: "string" } });
  });

  test("json-schema format with a $ref value hides chips; invalid input is ignored", async () => {
    const container = await mountSchema(
      { properties: { itemSchema: { format: "json-schema", type: "object" } } },
      { itemSchema: { $ref: "#/defs/thing" } },
    );
    const chips = [...container.querySelectorAll('[part="chip"]')];
    expect(chips).toHaveLength(0);

    inputValue(fieldEl(container, "itemSchema", '[part="json-text"]'), "{broken");
    await new Promise((r) => {
      setTimeout(r, 560);
    });
    expect(pluginDef().itemSchema).toEqual({
      $ref: "#/defs/thing",
    });
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
    const row = nth(container, '[part="row"]');
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
    const row = () => nth(container, '[part="row"]');
    // Remount with a plain clone — the tab document is a reactive proxy, which structuredClone
    // Cannot handle, so JSON round-trip instead.
    const remount = async () => {
      // oxlint-disable-next-line unicorn/prefer-structured-clone
      const plainColumns: JsonValue = JSON.parse(JSON.stringify(pluginDef().columns));
      container = await mountSchema(columnsSchema, { columns: plainColumns });
    };

    inputValue(nth(row(), '[part="cell-text"]'), "renamed");
    expect(column(0).label).toBe("renamed");

    await remount();
    setChecked(nth(row(), '[part="cell-checkbox"]'), false);
    expect(column(0).visible).toBe(false);

    await remount();
    commitValue(nth(row(), '[part="cell-number"]', 1), "5");
    expect(column(0).width).toBe(5);

    await remount();
    commitValue(nth(row(), '[part="cell-number"]', 0), "1.5");
    expect(column(0).ratio).toBe(1.5);

    await remount();
    commitValue(nth(row(), '[part="cell-number"]', 1), "");
    expect(column(0).width).toBeUndefined();

    await remount();
    commitValue(nth(row(), '[part="cell-select"]'), "right");
    expect(column(0).align).toBe("right");

    await remount();
    commitValue(nth(row(), '[part="cell-select"]'), "__none__");
    expect(column(0).align).toBeUndefined();
  });

  test("add button appends a row seeded with item defaults and repaints the panel", async () => {
    const container = await mountSchema(columnsSchema, {});
    pointer(nth(container, '[part="row-add"] [part="control"]'), "click");
    expect(pluginDef().columns).toEqual([{ label: "col" }]);
    // The form asks its host to repaint, and the host is this panel.
    expect(repaints.repaints).toBeGreaterThan(0);
  });

  test("delete removes a row, clearing the key for the last one", async () => {
    let container = await mountSchema(columnsSchema, {
      columns: [{ label: "a" }, { label: "b" }],
    });
    const firstDelete = () => nth(container, '[part="row-remove"] [part="control"]');
    pointer(firstDelete(), "click");
    expect(pluginDef().columns).toEqual([{ label: "b" }]);

    container = await mountSchema(columnsSchema, {
      columns: [{ label: "only" }],
    });
    pointer(firstDelete(), "click");
    expect(pluginDef().columns).toBeUndefined();
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
    const container = await mountSchema(stringSchema, { id: "abc" }, skuDoc);
    const chip = container.querySelector('[data-prop="id"] [part="source"]')!;
    // What the chip PRINTS: its label part, since an enabled hint is a tip child of the host.
    expect(printedOf(chip)).toBe("Fixed value");
    expect(await rungs(container, "id")).toEqual(["literal", "ref", "template"]);
    const menu = await openSourceMenu(container, "id");
    const labels = [...menu.querySelectorAll<HTMLElement>("jx-menu-item")].map((el) =>
      el.textContent!.trim(),
    );
    expect(labels).toEqual(["Fixed value", "From data…", "Mixed text"]);
  });

  test("a plain string field can START a binding — the gesture that did not exist", async () => {
    const container = await mountSchema(stringSchema, { id: "abc" }, skuDoc);
    await chooseRung(container, "id", "ref");
    expect(pluginDef().id).toEqual({ $ref: "#/$params/sku" });
  });

  test("a $ref value renders the pointer, never [object Object]", async () => {
    const container = await mountSchema(stringSchema, { id: { $ref: "#/$params/sku" } }, skuDoc);
    const combo = fieldEl(container, "id", '[part="pointer"]');
    expect(valueOf(combo)).toBe("#/$params/sku");
    expect(printedOf(container.querySelector('[data-prop="id"] [part="source"]'))).toBe(
      "From data…",
    );
    expect(container.textContent).not.toContain("[object Object]");
  });

  test("picking another param commits the new $ref", async () => {
    const container = await mountSchema(
      stringSchema,
      { id: { $ref: "#/$params/a" } },
      "pages/[a]/[b].json",
    );
    commitValue(fieldEl(container, "id", '[part="pointer"]'), "#/$params/b");
    expect(pluginDef().id).toEqual({ $ref: "#/$params/b" });
  });

  test("a pointer outside the offered list is still accepted, and blank clears the key", async () => {
    const container = await mountSchema(stringSchema, { id: { $ref: "#/$params/sku" } }, skuDoc);
    commitValue(fieldEl(container, "id", '[part="pointer"]'), "#/other/path");
    expect(pluginDef().id).toEqual({ $ref: "#/other/path" });

    const blank = await mountSchema(stringSchema, { id: { $ref: "#/custom/ref" } }, skuDoc);
    commitValue(fieldEl(blank, "id", '[part="pointer"]'), "  ");
    expect(pluginDef().id).toBeUndefined();
  });

  test("going back to Fixed value drops the binding", async () => {
    const container = await mountSchema(stringSchema, { id: { $ref: "#/$params/sku" } }, skuDoc);
    await chooseRung(container, "id", "literal");
    expect(pluginDef().id).toBeUndefined();
  });

  test("a document with no route params and no other signal offers no source", async () => {
    const container = await mountSchema(stringSchema, { id: "abc" }, "pages/index.json");
    expect(container.querySelector('[data-prop="id"] [part="source"]')).toBeNull();
    expect(valueOf(fieldEl(container, "id", '[part="text"]'))).toBe("abc");
  });

  test("a sibling signal is a source too, and the def never offers itself", async () => {
    pluginSchemaCache.set(KEY, stringSchema);
    const drawn = await drawSignals({
      count: { default: 0, type: "number" },
      plugin: { $prototype: "Widget", $src: SRC, id: "abc" },
    });
    ({ panel } = drawn);
    await openEntry(panel, "plugin");
    await chooseRung(schemaHost(), "id", "ref");
    expect(pluginDef().id).toEqual({ $ref: "#/state/count" });
  });

  test("an enum prop keeps its choices and gains the binding rung, but never Mixed text", async () => {
    const container = await mountSchema(
      { properties: { layout: { enum: ["grid", "list"] } } },
      { layout: "grid" },
      skuDoc,
    );
    expect(await rungs(container, "layout")).toEqual(["literal", "ref"]);
    const values = optionValues(container, "layout");
    expect(values).toEqual(["__none__", "grid", "list"]);
  });

  test("json-schema format props keep their editor and get no chip", async () => {
    const container = await mountSchema(
      { properties: { itemSchema: { format: "json-schema", type: "object" } } },
      { itemSchema: { $ref: "#/defs/thing" } },
      skuDoc,
    );
    expect(container.querySelector('[data-prop="itemSchema"] [part="json"]')).not.toBeNull();
    expect(container.querySelector('[data-prop="itemSchema"] [part="source"]')).toBeNull();
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
    const tf = nth(container, '[part="row"] [part="cell-text"]');
    expect(valueOf(tf)).toBe("#/$params/sku");
    expect(container.textContent).not.toContain("[object Object]");
    commitValue(tf, "#/$params/other");
    expect(column(0).source).toEqual({
      $ref: "#/$params/other",
    });
  });
});

// ─── The Source / Kind / Export rows and the schema cache ────────────────────

/**
 * Open a document whose one entry is `def`, and hand back its editor.
 *
 * Nothing is seeded here: this is the half of the path that ASKS for a schema, so what the cache
 * holds at the end of a draw is the result rather than the setup.
 */
async function mountExternal(
  def: JsonObject,
  opts: { documentPath?: string } = {},
): Promise<HTMLElement> {
  const drawn = await drawSignals(
    { plugin: def },
    ...(opts.documentPath === undefined ? [] : [{ documentPath: opts.documentPath }]),
  );
  ({ counts: repaints, panel, repaint: redraw } = drawn);
  const opened = await openEntry(panel, "plugin");
  drawn.resetCounts();
  return opened;
}

/** The editor as it stands now — a repaint replaces nodes a `$switch` re-chose. */
function pluginEditor(): HTMLElement {
  return editorFor(panel, "plugin");
}

describe("an external prototype's own rows", () => {
  test("shows Source and Kind when the prototype is not a project import", async () => {
    pluginSchemaCache.set(KEY, null);
    const el = await mountExternal({ $prototype: "Widget", $src: SRC });
    expect(el.querySelector('[data-prop="Source"]')).not.toBeNull();
    expect(el.querySelector('[data-prop="Kind"]')).not.toBeNull();
    expect(el.querySelector('[data-prop="Export"]')).toBeNull();
  });

  test("Source and Kind commits update the entry and invalidate the schema cache", async () => {
    pluginSchemaCache.set(KEY, null);
    pluginSchemaCache.set("./new.js::Widget", { properties: {} });
    const el = await mountExternal({ $prototype: "Widget", $src: SRC });
    commitValue(fieldEl(el, "Source", '[part="text"]'), "./new.js");
    expect(pluginDef().$src).toBe("./new.js");
    expect(pluginSchemaCache.has("./new.js::Widget")).toBe(false);

    pluginSchemaCache.set("./new.js::Gadget", { properties: {} });
    await settle();
    commitValue(fieldEl(pluginEditor(), "Kind", '[part="text"]'), "Gadget");
    expect(pluginDef().$prototype).toBe("Gadget");
    expect(pluginSchemaCache.has("./new.js::Gadget")).toBe(false);
  });

  test("Export appears when $export is set, and commits changes", async () => {
    pluginSchemaCache.set(KEY, null);
    const el = await mountExternal({ $export: "make", $prototype: "Widget", $src: SRC });
    commitValue(fieldEl(el, "Export", '[part="text"]'), "build");
    expect(pluginDef().$export).toBe("build");
  });

  test("an imported prototype names itself instead of offering Source and Kind", async () => {
    resetStudioState({ projectConfig: { imports: { Widget: "./plugins/widget.js" } } });
    pluginSchemaCache.set("./plugins/widget.js::Widget", null);
    const el = await mountExternal({ $prototype: "Widget" });
    expect(el.querySelector('[data-prop="Source"]')).toBeNull();
    expect(el.querySelector('[part="hint"]')?.textContent.trim()).toBe("Widget");
  });

  test("a cached schema draws its description and its config fields", async () => {
    pluginSchemaCache.set(KEY, {
      description: "A fine widget",
      properties: { color: { type: "string" } },
    });
    const el = await mountExternal({ $prototype: "Widget", $src: SRC });
    expect(el.textContent).toContain("A fine widget");
    expect(el.querySelector('[data-prop="color"] [part="text"]')).not.toBeNull();
  });

  test("a cached null schema draws no config section at all", async () => {
    pluginSchemaCache.set(KEY, null);
    const el = await mountExternal({ $prototype: "Widget", $src: SRC });
    expect(el.textContent).not.toContain("Loading schema");
    expect(el.querySelector('[part="slot-host"][data-slot="schema"]')).toBeNull();
    // Name, Source and Kind — the entry's own three rows, and nothing under them.
    expect(
      [...el.querySelectorAll<HTMLElement>('[part="field"]')].map((f) => f.dataset["prop"]),
    ).toEqual(["Name", "Source", "Kind"]);
  });

  test("an unanswered schema says it is loading, and asks for it exactly once", async () => {
    // The wait is held open on purpose: "Loading schema…" is a STATE, and racing a resolved fetch
    // To observe it is what made this assertion flaky before. The count is the other half — the
    // Navigator repaints on every document change, and one request per repaint is a bug.
    let asked = 0;
    installMockPlatform({
      fetchPluginSchema: () => {
        asked += 1;
        return new Promise<JsonValue>(() => {});
      },
    });
    const el = await mountExternal(
      { $prototype: "Widget", $src: SRC },
      { documentPath: "pages/index.json" },
    );
    expect(el.querySelector('[part="hint"]')?.textContent).toContain("Loading schema…");
    redraw();
    await settle();
    expect(asked).toBe(1);
  });

  test("a schema that arrives repaints the panel with its fields in place", async () => {
    installMockPlatform({
      fetchPluginSchema: async () => ({ properties: { size: { type: "integer" } } }),
    });
    await mountExternal({ $prototype: "Widget", $src: SRC }, { documentPath: "pages/index.json" });
    await flush();
    expect(pluginSchemaCache.get(KEY)).toEqual({ properties: { size: { type: "integer" } } });
    await settle();
    expect(pluginEditor().querySelector('[data-prop="size"] [part="number"]')).not.toBeNull();
  });

  test("a fetch resolving to null leaves the entry without a schema section", async () => {
    const el = await mountExternal({ $prototype: "Widget", $src: SRC });
    expect(el.querySelector('[part="hint"]')?.textContent).toContain("Loading schema…");
    await flush();
    expect(pluginSchemaCache.get(KEY)).toBeNull();
    redraw();
    await settle();
    expect(pluginEditor().textContent).not.toContain("Loading schema");
  });

  test("a prototype with nowhere to resolve from gets the plain rows and no schema", async () => {
    const el = await mountExternal({ $prototype: "Widget" });
    expect(el.querySelector('[data-prop="Source"]')).not.toBeNull();
    expect(el.textContent).not.toContain("Loading schema");
  });
});
