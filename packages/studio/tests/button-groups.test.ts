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
 *
 * The walk reaches every element in a document however deep, through `children`, `$switch` cases
 * and `$prototype: "Array"` maps alike, so nesting a group one wrapper deeper cannot dodge it.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The slice of a surface node this suite reads. */
interface Node {
  tagName?: unknown;
  attributes?: Record<string, unknown>;
  $props?: Record<string, unknown>;
  $prototype?: unknown;
  children?: unknown;
  map?: unknown;
  style?: Record<string, unknown>;
}

const dir = resolve(import.meta.dir, "../src/surfaces");
const surfaces = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ doc: JSON.parse(readFileSync(join(dir, name), "utf8")) as Node, name }));

/** Every element anywhere in a document: any object that names a tag, at any depth. */
function elements(value: unknown): Node[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => elements(item));
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  const node = value as Node;
  const own = typeof node.tagName === "string" ? [node] : [];
  return [...own, ...Object.values(node).flatMap((child) => elements(child))];
}

/**
 * The action buttons a container OWNS in the DOM it draws: its own `jx-action-button` children, and
 * the map of an `Array` among them, which stands for every item it repeats. That is exactly the set
 * the group's direct-child seam reaches; a button inside any other element is not one.
 */
function members(node: Node): Node[] {
  const kids = Array.isArray(node.children) ? (node.children as Node[]) : [];
  return kids.flatMap((kid) => {
    if (kid?.$prototype === "Array" && kid.map && typeof kid.map === "object") {
      return members({ children: [kid.map] });
    }
    return kid?.tagName === "jx-action-button" ? [kid] : [];
  });
}

/** How many buttons a container draws, counting a repeated map as the "two or more" it is. */
function drawn(node: Node): Node[] {
  const kids = Array.isArray(node.children) ? (node.children as Node[]) : [];
  const out: Node[] = [];
  for (const kid of kids) {
    const own = members({ children: [kid] });
    out.push(...own);
    if (kid?.$prototype === "Array") {
      out.push(...own);
    }
  }
  return out;
}

const partOf = (node: Node) => String(node.attributes?.["part"] ?? "");
const where = (name: string, node: Node) => `${name} ${node.tagName} [part="${partOf(node)}"]`;

/** Every `jx-action-group` in Studio's chrome, with the document it lives in. */
const groups = surfaces.flatMap(({ doc, name }) =>
  elements(doc)
    .filter((node) => node.tagName === "jx-action-group")
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
    expect(groups.some(({ node }) => node.$props?.["compact"] === false)).toBe(true);
    expect(groups.some(({ node }) => node.$props?.["compact"] !== false)).toBe(true);
  });

  test("no member of a compact group asks to be quiet, because the group frames it anyway", () => {
    for (const { name, node } of groups) {
      if (node.$props?.["compact"] === false) {
        continue;
      }
      for (const member of members(node)) {
        expect(member.$props?.["quiet"], `${where(name, node)} > ${partOf(member)}`).not.toBe(true);
      }
    }
  });

  test('every member of a selects="single" group is a radio: it binds checked, and never toggles', () => {
    for (const { name, node } of groups) {
      if (node.$props?.["selects"] !== "single") {
        continue;
      }
      const radios = members(node);
      expect(radios.length, where(name, node)).toBeGreaterThan(0);
      for (const member of radios) {
        const label = `${where(name, node)} > ${partOf(member)}`;
        expect(member.$props?.["checked"], label).toBeDefined();
        expect(member.$props?.["toggles"], label).toBeUndefined();
      }
    }
  });

  test("no span or div draws a button group of its own", () => {
    const found: string[] = [];
    for (const { doc, name } of surfaces) {
      for (const node of elements(doc)) {
        const role = node.attributes?.["role"];
        if (node.tagName === "jx-action-group" || (role !== "group" && role !== "radiogroup")) {
          continue;
        }
        const buttons = drawn(node);
        const stateful = buttons.filter(
          (button) => "selected" in (button.$props ?? {}) || "checked" in (button.$props ?? {}),
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
    const row = (doc: string, part: string) =>
      groups.find(({ name, node }) => name === doc && partOf(node) === part)?.node;
    expect(row("files-panel.json", "toolbar-actions")?.$props?.["compact"]).toBe(false);
    expect(row("git-panel.json", "sync-actions")?.$props?.["compact"]).toBe(false);
  });

  test("a group that WRAPS is not compact, and its members frame themselves", () => {
    /* A compact group refuses to wrap (ui.md §5.4): its seam is written in tree order, no selector
       can find the ends of a flex line, and a wrapped one therefore overhung the group's own edge
       by 1px, doubled the border between the two rows and squared both line ends. Studio's two
       wrapping rows are the pane context's breakpoint and feature chips, and a chip frames itself,
       so each member says `quiet: false` where a segment would have said nothing at all. */
    const wrapping: string[] = [];
    for (const { name, node } of groups) {
      const part = partOf(node);
      const { doc } = surfaces.find((surface) => surface.name === name)!;
      const rules = Object.entries(doc.style ?? {});
      const wraps = rules.some(([key, block]) => {
        const declared = (block as Record<string, unknown> | undefined)?.["flexWrap"];
        return key.includes(`[part="${part}"]`) && String(declared ?? "").startsWith("wrap");
      });
      if (!wraps) {
        continue;
      }
      wrapping.push(`${name} ${part}`);
      expect(node.$props?.["compact"], `${where(name, node)} wraps`).toBe(false);
      for (const member of members(node)) {
        expect(member.$props?.["quiet"], `${where(name, node)} > ${partOf(member)}`).toBe(false);
      }
    }
    expect(wrapping).toEqual(["pane-context.json sizes", "pane-context.json features"]);
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
    const kids = (pod.children as Node[]).map((kid) => partOf(kid));
    expect(kids).toEqual(["zoom-group", "fit-slot"]);
    const zoom = all.find((node) => partOf(node) === "zoom-group")!;
    expect(members(zoom).map((member) => partOf(member))).toEqual([
      "zoom-out",
      "zoom-label",
      "zoom-in",
    ]);
    const rule = (pane.style?.['& [part="pod"]'] ?? {}) as Record<string, unknown>;
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
    const host = pane.style?.['& [part="zoom-label"]'] as Record<string, unknown>;
    const control = pane.style?.['& [part="zoom-label"] > [part="control"]'] as Record<
      string,
      unknown
    >;
    expect(host["minWidth"]).toBe("48px");
    expect(host["fontFamily"]).toBeUndefined();
    expect(control["flex"]).toBe("1");
    expect(control["fontFamily"]).toBe("var(--font-mono)");
  });
});
