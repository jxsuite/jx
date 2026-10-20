/**
 * Stylebook specimen-document generator — pure functions (no DOM) that turn the static element
 * catalog (data/stylebook-meta.json) plus the project's component registry into a plain JxDocument
 * the iframe canvas renders like any page. Each breakpoint panel renders the SAME generated doc in
 * a width-sized iframe, so `@media` blocks evaluate for real — this replaces the legacy parent-side
 * inline-style flatten (`buildStylebookElement`/`refreshStylebookStyles`).
 *
 * One runtime fact shapes {@link transposeStylebookStyle}: tag-keyed rules on the generated root
 * would restyle the card chrome (`div` rules hit chrome divs), so every tag rule `T` is re-keyed to
 * `` `& .element-card-preview ${T}` `` — applyStyle resolves `&` to the root's `[data-jx=uid]`
 * scope, confining the cascade to specimens.
 *
 * There used to be a second, and it was a workaround rather than a fact: `applyStyle` emitted
 * `@media → selector` but DROPPED `selector → @media`, so a tag rule's embedded `@name` block was
 * HOISTED into the corresponding top-level one here. The runtime composes both orders now, so the
 * hoist is gone and a nested `@name` block stays where the author wrote it.
 */

import { serializeJxPath } from "../canvas/path-mapping";
import { isKeyframesAtRule } from "@jxsuite/runtime/css";
import type { StylebookEntry } from "./stylebook-panel";
import type { ComponentEntry } from "../files/components";
import type { JxPath } from "../state";
import { isNonNullObject, isRef } from "@jxsuite/schema/guards";
import type { StylebookSpecimens } from "../style/stylebook-specimens";
import type {
  JxDocument,
  JxHeadEntry,
  JxMutableNode,
  JxStateDefinition,
  JxStyle,
} from "@jxsuite/schema/types";

export interface StylebookDocResult {
  /** The specimen document (plain JSON — safe to post over the bridge). */
  doc: JxMutableNode;
  /** SerializeJxPath(path) → tag or compound ("ul li") for hit decoding. Chrome paths absent. */
  pathToTag: Map<string, string>;
  /** Tag/compound → the FIRST matching card's document path (selection-overlay measurement). */
  tagToCardPath: Map<string, JxPath>;
}

/** Selector-key classifier — a bare tag path like "p" or "table th" (mirrors style-panel's rule). */
function isTagPath(key: string): boolean {
  return (
    !key.startsWith(":") &&
    !key.startsWith(".") &&
    !key.startsWith("&") &&
    !key.startsWith("[") &&
    !key.startsWith("@") &&
    !key.startsWith("--")
  );
}

/** A nested style block (a rule or an at-rule body), as opposed to a scalar or a block list. */
function isStyleBlock(value: JxStyle[string]): value is JxStyle {
  return isNonNullObject(value) && !Array.isArray(value);
}

/** The specimen-scoping selector prefix (see the module doc). */
const SPECIMEN_SCOPE = "& .element-card-preview";

/**
 * Transform the merged effective document style into the generated root's style block: flat scalars
 * and `--` custom props stay at the top (inheritance into specimens) and tag rules are re-keyed
 * under {@link SPECIMEN_SCOPE}, per the module doc. Shared by the doc generator and the live
 * `styleUpdate` fast path so an edit round-trips through the exact same transform.
 */
export function transposeStylebookStyle(effectiveStyle: JxStyle): JxStyle {
  const out: JxStyle = {};

  /** Drop the base-width marker, which is not a query and would resolve to `@media --`. */
  const withoutBaseWidth = (rule: JxStyle): JxStyle => {
    const cleaned: JxStyle = {};
    for (const [k, v] of Object.entries(rule)) {
      if (k !== "@--") {
        cleaned[k] = v;
      }
    }
    return cleaned;
  };

  for (const [k, v] of Object.entries(effectiveStyle)) {
    if (!isStyleBlock(v)) {
      out[k] = v; // Flat scalars + -- custom props.
      continue;
    }
    if (k === "@--") {
      continue; // Base canvas width marker, not a real query.
    }
    if (isKeyframesAtRule(k)) {
      /* A keyframes body holds keyframe selectors — `from`, `to`, `50%` — which `isTagPath`
         accepts and which re-keying would turn into `& .element-card-preview from`, a stop the
         browser discards along with the rest of the animation. It has no selectors to confine. */
      out[k] = v;
      continue;
    }
    if (k.startsWith("@")) {
      // Media block: re-key tag rules inside; non-tag keys (scalars/pseudo) apply to the root.
      const bucket: JxStyle = {};
      for (const [mk, mv] of Object.entries(v)) {
        if (isStyleBlock(mv) && isTagPath(mk)) {
          bucket[`${SPECIMEN_SCOPE} ${mk}`] = withoutBaseWidth(mv);
        } else {
          bucket[mk] = mv;
        }
      }
      out[k] = bucket;
      continue;
    }
    if (isTagPath(k)) {
      out[`${SPECIMEN_SCOPE} ${k}`] = withoutBaseWidth(v);
      continue;
    }
    out[k] = v;
  }

  return out;
}

/** Resolve a nested tag path ("table th") in a style object; null when absent. */
function resolveNestedStyle(style: JxStyle, tagPath: string): JxStyle | null {
  const parts = tagPath.split(" ");
  let obj: JxStyle[string] = style;
  for (const part of parts) {
    if (!isStyleBlock(obj)) {
      return null;
    }
    obj = obj[part];
  }
  return isStyleBlock(obj) ? obj : null;
}

/** Whether the effective style customizes `tagPath` (directly or under any `@media` block). */
export function hasTagStyle(rootStyle: JxStyle, tagPath: string): boolean {
  const direct = resolveNestedStyle(rootStyle, tagPath);
  if (direct && Object.keys(direct).length > 0) {
    return true;
  }
  for (const [key, val] of Object.entries(rootStyle)) {
    if (!key.startsWith("@") || !isStyleBlock(val)) {
      continue;
    }
    const nested = resolveNestedStyle(val, tagPath);
    if (nested && Object.keys(nested).length > 0) {
      return true;
    }
  }
  return false;
}

/** One catalogue tag as a list of element defaults draws it: the Styles panel's, and the Outline's. */
export interface CatalogueRow {
  /** The catalogue entry the row stands for. */
  entry: StylebookEntry;
  tag: string;
  /** The compound path (`ul li`): the row's key, and what selecting the row selects. */
  path: string;
  /** How deep in its specimen the tag sits: 0 for a section's own entries. */
  depth: number;
  /** Whether the selection's leaf is this tag ({@link selectionLeaf}). */
  selected: boolean;
}

/**
 * The leaf of a stylebook selection.
 *
 * A selection is a compound path (`"ul li"`) and the catalogue draws one row per TAG, so the row
 * that is marked is the one whose tag is the path's last segment. That is what the tree has always
 * done; it is written down here because "selected" meaning something other than "equal" is exactly
 * the kind of thing a reader assumes is a bug.
 */
export function selectionLeaf(selection: string | null): string | null {
  if (!selection) {
    return null;
  }
  return selection.split(" ").pop() ?? null;
}

/**
 * Flatten catalogue entries and everything under them into rows, in document order.
 *
 * Children are deduplicated by tag: a `<ul>` specimen carries several `<li>`s and they are one row,
 * because the row selects a TAG and there is one rule per tag path to write. The ONE walk both
 * lists draw from, so the two cannot drift; what each says about a row (its dot, its label) is the
 * caller's.
 *
 * @param entries A section's entries, or several sections' in order
 * @param selection The stylebook selection (`shell.stylebook.selection`)
 */
export function catalogueRows(
  entries: readonly StylebookEntry[],
  selection: string | null,
): CatalogueRow[] {
  const leaf = selectionLeaf(selection);
  const out: CatalogueRow[] = [];
  const walk = (entry: StylebookEntry, depth: number, parentPath: string): void => {
    const path = parentPath ? `${parentPath} ${entry.tag}` : entry.tag;
    out.push({ depth, entry, path, selected: entry.tag === leaf, tag: entry.tag });
    const children = entry.children
      ? [...new Map(entry.children.map((child) => [child.tag, child])).values()]
      : [];
    for (const child of children) {
      walk(child, depth + 1, path);
    }
  };
  for (const entry of entries) {
    walk(entry, 0, "");
  }
  return out;
}

/**
 * A card's specimen for a component drawn as the first row of a list
 * (`style/stylebook-specimens.ts`): the list's repeater, reading its row from `rootState[key]` so
 * two cards' lists cannot collide, and the rest of the page state the row was drawn in, the first
 * card's value winning a shared name (`$page`, `$site`). Null when the sample is not a repeater
 * over a state list.
 */
export function sampleRowSpecimen(
  sample: JxDocument,
  key: string,
  rootState: Record<string, JxStateDefinition>,
): JxMutableNode | null {
  const [list] = Array.isArray(sample.children) ? sample.children : [];
  if (!isNonNullObject(list) || Array.isArray(list) || !isRef(list.items)) {
    return null;
  }
  const { $ref } = list.items;
  const listKey = $ref.startsWith("#/state/") ? $ref.slice("#/state/".length) : "";
  const rows = sample.state?.[listKey];
  if (!Array.isArray(rows)) {
    return null;
  }
  rootState[key] = rows;
  for (const [name, value] of Object.entries(sample.state ?? {})) {
    if (name !== listKey && !(name in rootState)) {
      rootState[name] = value;
    }
  }
  /* SAFETY: `list` is the repeater object a page's `children` held; only its `items` is replaced,
     with a ref of the same shape. */
  const repeater = { ...list, items: { $ref: `#/state/${key}` } } as JxMutableNode;
  return { children: [repeater], tagName: "div" };
}

/** Options for {@link buildStylebookDoc}. */
export interface BuildStylebookDocOpts {
  meta: { $sections: { label: string; elements: StylebookEntry[] }[] };
  components: ComponentEntry[];
  /** Merged document+project style (getEffectiveStyle output) — transposed here. */
  effectiveStyle: JxStyle;
  /** Merged $media map (getEffectiveMedia output) — becomes the doc's $media. */
  effectiveMedia: Record<string, string>;
  /** Merged project+document `$head` (getEffectiveHead output) — becomes the doc's `$head`. */
  effectiveHead?: JxHeadEntry[];
  filter: string;
  customizedOnly: boolean;
  projectRoot: string | null;
  /**
   * How each component card is drawn, by tag (`style/stylebook-specimens.ts`). A component with no
   * entry is drawn bare, with its declared defaults as attributes.
   */
  specimens?: StylebookSpecimens;
}

/**
 * Build the specimen document + path↔tag maps. Deterministic: paths are recorded as the tree is
 * assembled, so the parent can decode `hit` paths and measure selection cards without reading the
 * iframe DOM.
 */
export function buildStylebookDoc(opts: BuildStylebookDocOpts): StylebookDocResult {
  const pathToTag = new Map<string, string>();
  const tagToCardPath = new Map<string, JxPath>();
  const filter = opts.filter.toLowerCase();

  /** Register a specimen subtree's paths: root → tag; descendants → compound (legacy semantics). */
  const registerSpecimenPaths = (entry: StylebookEntry, path: JxPath, rootTag: string): void => {
    const compound = entry.tag === rootTag ? rootTag : `${rootTag} ${entry.tag}`;
    pathToTag.set(serializeJxPath(path), compound);
    const kids = entry.children ?? [];
    for (const [i, child] of kids.entries()) {
      registerSpecimenPaths(child, [...path, "children", i], rootTag);
    }
  };

  const specimenNode = (entry: StylebookEntry): JxMutableNode => {
    const attributes = { ...entry.attributes };
    if (entry.style) {
      attributes.style = entry.style; // Inline CSS text — legacy `el.style.cssText` parity.
    }
    const node: JxMutableNode = { tagName: entry.tag };
    if (entry.text) {
      node.textContent = entry.text;
    }
    if (Object.keys(attributes).length > 0) {
      node.attributes = attributes;
    }
    if (entry.children) {
      node.children = entry.children.map(specimenNode);
    }
    return node;
  };

  /** A card wrapping one specimen; registers card/preview/specimen paths under `tag`. */
  const cardNode = (
    tag: string,
    label: string,
    specimen: JxMutableNode,
    cardPath: JxPath,
    entryForPaths: StylebookEntry | null,
  ): JxMutableNode => {
    pathToTag.set(serializeJxPath(cardPath), tag);
    pathToTag.set(serializeJxPath([...cardPath, "children", 0]), tag);
    const specimenPath = [...cardPath, "children", 0, "children", 0];
    if (entryForPaths) {
      registerSpecimenPaths(entryForPaths, specimenPath, tag);
    } else {
      pathToTag.set(serializeJxPath(specimenPath), tag);
    }
    if (!tagToCardPath.has(tag)) {
      tagToCardPath.set(tag, cardPath);
    }
    return {
      attributes: { class: "element-card" },
      children: [
        { attributes: { class: "element-card-preview" }, children: [specimen], tagName: "div" },
        { attributes: { class: "element-card-label" }, tagName: "div", textContent: label },
      ],
      tagName: "div",
    };
  };

  const sections: JxMutableNode[] = [];
  const sectionNode = (label: string, cards: JxMutableNode[]): JxMutableNode => ({
    attributes: { class: "sb-section" },
    children: [
      { attributes: { class: "sb-label" }, tagName: "div", textContent: label },
      { attributes: { class: "sb-body" }, children: cards, tagName: "div" },
    ],
    tagName: "div",
  });

  // Paths below mirror the assembled tree: root.children[si] = section; section.children[1] =
  // Sb-body; body.children[ci] = card. Sections are appended only when non-empty, so indices are
  // Computed from the OUTPUT arrays, not the input catalog.
  const sectionBodyPath = (): JxPath => ["children", sections.length, "children", 1];

  for (const section of opts.meta.$sections) {
    let entries = section.elements;
    if (filter) {
      entries = entries.filter(
        (e) => e.tag.includes(filter) || section.label.toLowerCase().includes(filter),
      );
    }
    if (opts.customizedOnly) {
      entries = entries.filter((e) => hasTagStyle(opts.effectiveStyle, e.tag));
    }
    if (entries.length === 0) {
      continue;
    }
    const bodyPath = sectionBodyPath();
    const cards = entries.map((entry, ci) =>
      cardNode(
        entry.tag,
        `<${entry.tag}>`,
        specimenNode(entry),
        [...bodyPath, "children", ci],
        entry,
      ),
    );
    sections.push(sectionNode(section.label, cards));
  }

  // Custom components from the registry — live custom elements registered via $elements.
  const $elements: (string | { $ref: string })[] = [];
  // The data the sample-row cards read: each row's list, and the page context it was drawn in.
  const rootState: Record<string, JxStateDefinition> = {};
  {
    let comps = opts.components;
    if (filter) {
      comps = comps.filter((c) => c.tagName.toLowerCase().includes(filter));
    }
    if (opts.customizedOnly) {
      comps = comps.filter((c) => hasTagStyle(opts.effectiveStyle, c.tagName));
    }
    if (comps.length > 0) {
      const bodyPath = sectionBodyPath();
      const cards = comps.map((comp, ci) => {
        const cardPath = [...bodyPath, "children", ci];
        const renderable = comp.source !== "npm" && comp.path?.endsWith(".json");
        if (renderable) {
          // Root-relative $ref: registerElements resolves it against docBase (the canvas origin).
          // Collapse leading slashes — an absolute projectRoot ("/home/…") would otherwise produce
          // A protocol-relative "//home/…" that URL-resolves to a foreign host.
          $elements.push({
            $ref: `/${opts.projectRoot ? `${opts.projectRoot}/` : ""}${comp.path}`.replace(
              /^\/+/,
              "/",
            ),
          });
          const drawn = opts.specimens?.get(comp.tagName);
          if (drawn?.kind === "props") {
            const specimen: JxMutableNode = { $props: drawn.props, tagName: comp.tagName };
            return cardNode(comp.tagName, `<${comp.tagName}>`, specimen, cardPath, null);
          }
          if (drawn?.kind === "row") {
            const row = sampleRowSpecimen(drawn.sample.doc, `stylebookRow${ci}`, rootState);
            if (row) {
              return cardNode(comp.tagName, `<${comp.tagName}>`, row, cardPath, null);
            }
          }
          if (drawn?.kind !== "none") {
            const attributes: Record<string, string> = {};
            for (const p of comp.props ?? []) {
              if (p.default !== undefined && p.default !== "false" && p.default !== "''") {
                attributes[p.name] = String(p.default).replaceAll(/^'|'$/g, "");
              }
            }
            const specimen: JxMutableNode = { tagName: comp.tagName };
            if (Object.keys(attributes).length > 0) {
              specimen.attributes = attributes;
            }
            return cardNode(comp.tagName, `<${comp.tagName}>`, specimen, cardPath, null);
          }
        }
        // Npm/format-class components can't be $ref-registered — placeholder box (legacy parity).
        const fallback: JxMutableNode = {
          attributes: { class: "sb-fallback" },
          tagName: "div",
          textContent: `<${comp.tagName}>`,
        };
        return cardNode(comp.tagName, `<${comp.tagName}>`, fallback, cardPath, null);
      });
      sections.push(sectionNode("Components", cards));
    }
  }

  if (sections.length === 0) {
    sections.push({
      attributes: { class: "sb-empty" },
      tagName: "div",
      textContent: opts.customizedOnly ? "No customized elements" : "No matching elements",
    });
  }

  // Assigned in this order so the posted document keeps its key order: `$elements` leads when present.
  const doc: JxMutableNode = {};
  if ($elements.length > 0) {
    doc.$elements = $elements;
  }
  /* The project's `$head` too: its webfont links are what make `fontFamily: 'Barlow'` render as
     Barlow, and a specimen sheet drawn in the system fallback shows styles the site never has. */
  if (opts.effectiveHead && opts.effectiveHead.length > 0) {
    doc.$head = opts.effectiveHead;
  }
  doc.$media = opts.effectiveMedia;
  if (Object.keys(rootState).length > 0) {
    doc.state = rootState;
  }
  doc.attributes = { class: "sb-root" };
  doc.children = sections;
  doc.style = transposeStylebookStyle(opts.effectiveStyle);
  doc.tagName = "div";

  return { doc, pathToTag, tagToCardPath };
}
