/**
 * Studio's button groups, judged over every surface document (ui.md §5.4).
 *
 * A compact `jx-action-group` draws its members' segmented frame and selected segment itself,
 * whatever each member's `quiet` says. That fixed every switch Studio converted from Spectrum (the
 * Canvas view, the Style panel rows, Preferences' Theme, the zoom pod) in one place, because
 * `sp-action-button` was not quiet by default and `jx-action-button` is: every converted compact
 * group had been drawing as a gap-less row of bare words. It also makes three mistakes silent at
 * runtime, which is why they are caught here instead:
 *
 * - A member of a compact group that says `quiet: true` is framed anyway, so the author meant a row
 *   of quiet tools and got a segmented control. That row is `compact: false`.
 * - A `selects: "single"` group whose members do not bind `checked` is a radiogroup with no radio in
 *   it, and a member that `toggles` would flip itself against the host that owns the value.
 * - A `span` or `div` with a group role over two or more action buttons that carry a selected or
 *   checked state is a HAND-ROLLED button group: it gets no frame, no roving caret, and announces
 *   no choice. The Signals panel's Body switch was one until this suite existed.
 * - A button that `toggles` and ALSO acts in its own `onclick` has two writers for one state. The kit
 *   flips `selected` in a click listener on the same host, registered after the surface's, and a
 *   real click flushes microtasks between listeners, so the host's projection draws the committed
 *   state and the flip then inverts it: the Style panel's Display row read unset after pressing
 *   Flex and set after pressing it again, and Preview drew off while it was on. A toggle acts on
 *   the kit's `change`, which follows the flip; a choice the host owns is a `checked` radio
 *   instead.
 *
 * The walk reaches every element in a document however deep, through `children`, `$switch` cases
 * and `$prototype: "Array"` maps alike, so nesting a group one wrapper deeper cannot dodge it.
 */
import { isJsonObject, isNonNullObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** A surface document read off disk: its root is a JSON object, or the file is not a document. */
function readSurface(path: string): JsonObject {
  const doc = JSON.parse(readFileSync(path, "utf8"));
  if (!isJsonObject(doc)) {
    throw new TypeError(`${path} is not a JSON object`);
  }
  return doc;
}

const dir = resolve(import.meta.dir, "../src/surfaces");
// Sorted: `readdirSync` answers in the filesystem's order, which moves when a file is rewritten.
const surfaces = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .toSorted()
  .map((name) => ({ doc: readSurface(join(dir, name)), name }));

/** A member of a node that is itself an object (`$props`, `attributes`, `style`, `onclick`). */
function objectAt(node: JsonObject, key: string): JsonObject | undefined {
  const value = node[key];
  return isJsonObject(value) ? value : undefined;
}

/** One of a node's `$props`, when it declares any. */
function propOf(node: JsonObject, name: string): JsonValue | undefined {
  return objectAt(node, "$props")?.[name];
}

/** One of a node's `attributes`, when it declares any. */
function attrOf(node: JsonObject, name: string): JsonValue | undefined {
  return objectAt(node, "attributes")?.[name];
}

/** A node's `children` when they are a static list; any other form holds no direct children. */
function childrenOf(node: JsonObject): JsonValue[] {
  const { children } = node;
  return Array.isArray(children) ? children : [];
}

/** One rule of a surface's own `style` block, or an empty rule when it declares none. */
function ruleOf(doc: JsonObject, selector: string): JsonObject {
  const rule = objectAt(doc, "style")?.[selector];
  return isJsonObject(rule) ? rule : {};
}

/** Every element anywhere in a document: any object that names a tag, at any depth. */
function elements(value: JsonValue): JsonObject[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => elements(item));
  }
  if (!isJsonObject(value)) {
    return [];
  }
  const own = isString(value["tagName"]) ? [value] : [];
  return [...own, ...Object.values(value).flatMap((child) => elements(child))];
}

/**
 * The action buttons a container OWNS in the DOM it draws: its own `jx-action-button` children, and
 * the map of an `Array` among them, which stands for every item it repeats. That is exactly the set
 * the group's direct-child seam reaches; a button inside any other element is not one.
 */
function members(node: JsonObject): JsonObject[] {
  return childrenOf(node).flatMap((kid) => {
    if (!isJsonObject(kid)) {
      return [];
    }
    const { map } = kid;
    if (kid["$prototype"] === "Array" && isNonNullObject(map)) {
      return members({ children: [map] });
    }
    return kid["tagName"] === "jx-action-button" ? [kid] : [];
  });
}

/** How many buttons a container draws, counting a repeated map as the "two or more" it is. */
function drawn(node: JsonObject): JsonObject[] {
  const out: JsonObject[] = [];
  for (const kid of childrenOf(node)) {
    const own = members({ children: [kid] });
    out.push(...own);
    if (isJsonObject(kid) && kid["$prototype"] === "Array") {
      out.push(...own);
    }
  }
  return out;
}

const partOf = (node: JsonObject) => String(attrOf(node, "part") ?? "");
const where = (name: string, node: JsonObject) =>
  `${name} ${String(node["tagName"])} [part="${partOf(node)}"]`;

/** Every `jx-action-group` in Studio's chrome, with the document it lives in. */
const groups = surfaces.flatMap(({ doc, name }) =>
  elements(doc)
    .filter((node) => node["tagName"] === "jx-action-group")
    .map((node) => ({ name, node })),
);

/**
 * Hand-rolled groups that are NOT segmented controls and say so. Keyed by document and part, so the
 * entry names one node; `staleness` below fails when a listed node no longer exists.
 */
const NOT_SEGMENTED = new Map<string, string>([
  [
    "commandbar.json docks",
    "Three independent dock toggles, each a quiet tool in the command bar: not a choice among them.",
  ],
  [
    "rail.json ",
    "A rail section of stacked navigation buttons, drawn as the rail and not as a segmented control.",
  ],
]);

describe("Studio's button groups", () => {
  test("there are groups to judge, and both kinds are among them", () => {
    expect(groups.length).toBeGreaterThan(10);
    expect(groups.some(({ node }) => propOf(node, "compact") === false)).toBe(true);
    expect(groups.some(({ node }) => propOf(node, "compact") !== false)).toBe(true);
  });

  test("no member of a compact group asks to be quiet, because the group frames it anyway", () => {
    for (const { name, node } of groups) {
      if (propOf(node, "compact") === false) {
        continue;
      }
      for (const member of members(node)) {
        expect(propOf(member, "quiet"), `${where(name, node)} > ${partOf(member)}`).not.toBe(true);
      }
    }
  });

  test('every member of a selects="single" group is a radio: it binds checked, and never toggles', () => {
    for (const { name, node } of groups) {
      if (propOf(node, "selects") !== "single") {
        continue;
      }
      const radios = members(node);
      expect(radios.length, where(name, node)).toBeGreaterThan(0);
      for (const member of radios) {
        const label = `${where(name, node)} > ${partOf(member)}`;
        expect(propOf(member, "checked"), label).toBeDefined();
        expect(propOf(member, "toggles"), label).toBeUndefined();
      }
    }
  });

  test("a button that toggles acts on change, never in its own click handler", () => {
    /* Anywhere in Studio, not only inside a group: Preview and the block action bar's format
       buttons were both inverted by it. A click handler on a toggle may still stop the event (the
       action bar's controls keep a click off the canvas under them), but anything it CALLS runs
       before the kit's flip, and the flip then writes over whatever that call drew. */
    const STOP_ONLY = new Set(["stopPropagation", "preventDefault"]);
    const found: string[] = [];
    let toggles = 0;
    for (const { doc, name } of surfaces) {
      for (const node of elements(doc)) {
        if (node["tagName"] !== "jx-action-button" || propOf(node, "toggles") !== true) {
          continue;
        }
        toggles += 1;
        const body = objectAt(node, "onclick")?.["body"];
        const steps = Array.isArray(body) ? body : [];
        /* A step that is not an object is not a bare stop either, so it counts as acting. */
        const acts = steps.some(
          (step) => !isJsonObject(step) || Object.keys(step).some((k) => !STOP_ONLY.has(k)),
        );
        if (acts) {
          found.push(where(name, node));
        }
      }
    }
    expect(toggles).toBeGreaterThan(3);
    expect(found).toEqual([]);
  });

  test("the Style panel's rows are radios: the document owns the value, the button only draws it", () => {
    const style = surfaces.find(({ name }) => name === "style-panel.json")!.doc;
    const row = elements(style).find(
      (node) =>
        node["tagName"] === "jx-action-group" && members(node).some((m) => partOf(m) === "button"),
    )!;
    expect(propOf(row, "selects")).toBe("single");
    const [button] = members(row);
    expect(propOf(button!, "toggles")).toBeUndefined();
    expect(propOf(button!, "checked")).toEqual({ $ref: "$map/item/checked" });
  });

  test("no span or div draws a button group of its own", () => {
    const found: string[] = [];
    for (const { doc, name } of surfaces) {
      for (const node of elements(doc)) {
        const role = attrOf(node, "role");
        if (node["tagName"] === "jx-action-group" || (role !== "group" && role !== "radiogroup")) {
          continue;
        }
        const buttons = drawn(node);
        const stateful = buttons.filter(
          (button) =>
            propOf(button, "selected") !== undefined || propOf(button, "checked") !== undefined,
        );
        if (buttons.length >= 2 && stateful.length > 0) {
          found.push(`${name} ${partOf(node)}`);
        }
      }
    }
    expect(found.filter((key) => !NOT_SEGMENTED.has(key))).toEqual([]);
    // The staleness half: every exemption still names a node that is there to be exempted.
    for (const key of NOT_SEGMENTED.keys()) {
      expect(found, key).toContain(key);
    }
  });

  test("the two quiet rows Spectrum drew are compact=false", () => {
    /* Spectrum had exactly two action groups that were quiet on purpose, the Files toolbar
       (`compact quiet`) and the git sync verbs (`quiet`, never compact). The kit spells both as a
       group that is not compact, over its members' default quiet. */
    const compactOf = (doc: string, part: string) => {
      const row = groups.find(({ name, node }) => name === doc && partOf(node) === part)?.node;
      return row && propOf(row, "compact");
    };
    expect(compactOf("files-panel.json", "toolbar-actions")).toBe(false);
    expect(compactOf("publish-workspace.json", "sync-actions")).toBe(false);
  });

  test("a group that WRAPS is not compact, and its members frame themselves", () => {
    /* A compact group refuses to wrap (ui.md §5.4): its seam is written in tree order, no selector
       can find the ends of a flex line, and a wrapped one therefore overhung the group's own edge
       by 1px, doubled the border between the two rows and squared both line ends. Studio's
       wrapping rows are the pane context's breakpoint and feature chips and Add new's cards and field
       presets, and a chip frames itself,
       so each member says `quiet: false` where a segment would have said nothing at all. */
    const wrapping: string[] = [];
    for (const { name, node } of groups) {
      const part = partOf(node);
      const { doc } = surfaces.find((surface) => surface.name === name)!;
      const rules = Object.entries(objectAt(doc, "style") ?? {});
      const wraps = rules.some(([key, block]) => {
        const declared = isJsonObject(block) ? block["flexWrap"] : undefined;
        return key.includes(`[part="${part}"]`) && String(declared ?? "").startsWith("wrap");
      });
      if (!wraps) {
        continue;
      }
      wrapping.push(`${name} ${part}`);
      expect(propOf(node, "compact"), `${where(name, node)} wraps`).toBe(false);
      for (const member of members(node)) {
        expect(propOf(member, "quiet"), `${where(name, node)} > ${partOf(member)}`).toBe(false);
      }
    }
    expect(wrapping).toEqual([
      "add-new.json start-from",
      "add-new.json presets",
      "add-new.json wrap-in",
      "add-new.json component-start",
      "pane-context.json sizes",
      "pane-context.json features",
    ]);
  });

  test("the zoom pod's Fit picker is a control beside the zoom group, not a fourth segment", () => {
    /* It was the group's fourth child, inside a `display: contents` div, which made it a flex item
       of a gap-0 segmented control that roves only jx-action-button: the `+` segment's rounded,
       bordered end met the select's rounded, bordered start as a 2px rule notched at both corners.
       A group frames the members it owns and nothing else, so the select is the pod's second
       control, with the pod's gap between them — and the pod draws no box of its own around the
       two frames it holds. */
    const pane = surfaces.find(({ name }) => name === "pane-context.json")!.doc;
    const all = elements(pane);
    const pod = all.find((node) => partOf(node) === "pod")!;
    const kids = childrenOf(pod).map((kid) => (isJsonObject(kid) ? partOf(kid) : ""));
    expect(kids).toEqual(["zoom-group", "fit-slot"]);
    const zoom = all.find((node) => partOf(node) === "zoom-group")!;
    expect(members(zoom).map((member) => partOf(member))).toEqual([
      "zoom-out",
      "zoom-label",
      "zoom-in",
    ]);
    const rule = ruleOf(pane, '& [part="pod"]');
    expect(rule["display"]).toBe("flex");
    for (const own of ["border", "borderRadius", "background", "padding"]) {
      expect(rule[own], `the pod draws its own ${own} around two framed controls`).toBeUndefined();
    }
  });

  test("the zoom label's width is its host's and its face is its control's, so the frame has no hole", () => {
    /* The rule used to set the mono face on the HOST, which the kit's control does not inherit
       (it sets its own), and the 48px floor on a host whose control sat inside it at its content
       width: a 6px gap opened in the segmented frame before the `+` segment. */
    const pane = surfaces.find(({ name }) => name === "pane-context.json")!.doc;
    const host = ruleOf(pane, '& [part="zoom-label"]');
    const control = ruleOf(pane, '& [part="zoom-label"] > [part="control"]');
    expect(host["minWidth"]).toBe("48px");
    expect(host["fontFamily"]).toBeUndefined();
    expect(control["flex"]).toBe("1");
    expect(control["fontFamily"]).toBe("var(--font-mono)");
  });
});
