/**
 * Alerts — GitHub-style callouts (`> [!NOTE]`) recognised in a Markdown tree.
 *
 * GitHub, Obsidian and most static-site plugins agree on one notation for a callout: a blockquote
 * whose first line is `[!TYPE]`. Without recognising it a document renders as a quotation that
 * begins with the literal text `[!NOTE]`, which is wrong everywhere a reader sees it.
 *
 * Recognition is a **tree rewrite that runs before conversion**, not a case inside the blockquote
 * handler, for two reasons. Alerts nest (in list items, in other callouts, inside directives), and
 * a rewrite that visits every blockquote gets all of those without the converter having to know the
 * configuration at every depth. And it keeps `transpileJxMarkdown`, the path Studio parses a file
 * through, untouched: that path round-trips back to Markdown on save, and a callout already
 * converted to a `div` would be written back as a directive, silently rewriting the author's file.
 * Only the content loader asks for alerts.
 *
 * Pure: no `node:` imports, no knowledge of Jx elements. The converter lives beside `mdastNodeToJx`
 * in `transpile.ts`.
 *
 * @module @jxsuite/parser/alerts
 * @license MIT
 * @docs framework/site/jx-markdown
 */

import type { MdastNode } from "./types.ts";

/** The five alert types GitHub defines, and the title each shows by default. */
export const DEFAULT_ALERT_TITLES: Readonly<Record<string, string>> = {
  caution: "Caution",
  important: "Important",
  note: "Note",
  tip: "Tip",
  warning: "Warning",
};

/** The synthetic mdast node type an alert becomes, consumed by `mdastNodeToJx`. */
export const ALERT_NODE = "jxAlert";

/**
 * The `alerts` option of a content type: alert type (case-insensitive) → the custom element that
 * renders it, or `true` for the built-in markup (which is also how a type beyond GitHub's five,
 * such as Obsidian's `info` or `example`, is switched on). A `null` or `false` value leaves that
 * type as an ordinary blockquote, and `false` for the whole option turns alert recognition off.
 */
export type AlertsConfig = Record<string, string | boolean | null> | false;

/** The option after validation, keyed by lower-case alert type. */
export interface AlertSettings {
  /** Type → element tag name, or `null` to render the built-in markup. */
  types: Map<string, string | null>;
}

/** A tag name an author could mean: HTML elements and custom elements alike. */
const TAG_NAME = /^[A-Za-z][\w.-]*$/;

/**
 * Validate the `alerts` option into settings, or `null` when recognition is off.
 *
 * Throws on a value that is not a tag name so a typo in `project.json` fails the build where it was
 * written rather than rendering a callout as an unknown element.
 */
export function normalizeAlerts(config?: unknown, where = "alerts"): AlertSettings | null {
  if (config === false) {
    return null;
  }
  const types = new Map<string, string | null>(
    Object.keys(DEFAULT_ALERT_TITLES).map((type) => [type, null]),
  );
  if (config === undefined || config === true) {
    return { types };
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new TypeError(
      `${where}: expected an object mapping alert types to element names, or false`,
    );
  }
  for (const [type, element] of Object.entries(config)) {
    const key = type.toLowerCase();
    if (!/^[a-z][\w-]*$/.test(key)) {
      throw new TypeError(`${where}: "${type}" is not a valid alert type name`);
    }
    if (element === false || element === null) {
      types.delete(key);
    } else if (element === true) {
      types.set(key, null);
    } else if (typeof element === "string" && TAG_NAME.test(element)) {
      types.set(key, element);
    } else {
      throw new TypeError(
        `${where}.${type}: expected an element name such as "doc-note", true or false, got ${JSON.stringify(element)}`,
      );
    }
  }
  return { types };
}

/** The shape an alert takes after the rewrite. */
export interface AlertNode extends MdastNode {
  type: typeof ALERT_NODE;
  /** Lower-case alert type: `note`, `tip`, … */
  alert: string;
  /** Custom element tag from the `alerts` option, or null for the built-in markup. */
  element: string | null;
  /** The author's title as inline nodes, or null to use the type's default title. */
  titleNodes: MdastNode[] | null;
}

const MARKER = /^\[!([A-Za-z][\w-]*)\][+-]?/;

/** Plain text of a run of inline nodes. */
export function inlineText(nodes: readonly MdastNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (typeof node.value === "string") {
      out += node.value;
    } else if (node.children) {
      out += inlineText(node.children);
    }
  }
  return out;
}

function textNode(value: string): MdastNode {
  return { type: "text", value };
}

/**
 * Split the first paragraph of a blockquote into the title line and the rest, or null when the
 * blockquote is not an alert of a configured type.
 *
 * The title is whatever follows `[!TYPE]` on its own line, across inline formatting (`> [!NOTE] A
 * **bold** title`). That is Obsidian's custom-title form; GitHub itself shows such a blockquote as
 * plain text, so a file using it still reads sensibly there.
 */
function splitMarker(
  paragraph: MdastNode,
  settings: AlertSettings,
): { type: string; title: MdastNode[]; body: MdastNode[] } | null {
  const [first, ...siblings] = paragraph.children ?? [];
  if (first?.type !== "text" || typeof first.value !== "string") {
    return null;
  }
  const match = MARKER.exec(first.value);
  if (!match) {
    return null;
  }
  const type = match[1]!.toLowerCase();
  if (!settings.types.has(type)) {
    return null;
  }
  const rest = first.value.slice(match[0].length);
  if (rest !== "" && !/^[ \t\n]/.test(rest)) {
    return null;
  }

  const title: MdastNode[] = [];
  const body: MdastNode[] = [];
  let inTitle = true;
  const take = (node: MdastNode) => {
    if (inTitle && node.type === "break") {
      inTitle = false;
    } else if (inTitle && node.type === "text" && typeof node.value === "string") {
      const newline = node.value.indexOf("\n");
      if (newline === -1) {
        title.push(node);
      } else {
        title.push(textNode(node.value.slice(0, newline)));
        inTitle = false;
        body.push(textNode(node.value.slice(newline + 1)));
      }
    } else {
      (inTitle ? title : body).push(node);
    }
  };
  take(textNode(rest.replace(/^[ \t]+/, "")));
  for (const node of siblings) {
    take(node);
  }

  const trimmed = title.filter((node) => !(node.type === "text" && node.value === ""));
  const text = inlineText(trimmed);
  return {
    body: body.filter((node) => !(node.type === "text" && node.value === "")),
    title: text.trim() === "" ? [] : trimmed,
    type,
  };
}

/**
 * Rewrite every alert blockquote in a tree into an {@link AlertNode}, in place.
 *
 * A blockquote that is not an alert, or is of a type the settings do not know, is left alone and
 * its children are still searched, so a callout nested inside an ordinary quotation is found.
 *
 * @param {MdastNode} tree
 * @param {AlertSettings} settings
 */
export function transformAlerts(tree: MdastNode, settings: AlertSettings): void {
  const { children } = tree;
  if (!children) {
    return;
  }
  for (const [i, child] of children.entries()) {
    if (child.type === "blockquote") {
      const [paragraph, ...rest] = child.children ?? [];
      const split = paragraph?.type === "paragraph" ? splitMarker(paragraph, settings) : null;
      if (split) {
        const bodyParagraph: MdastNode[] =
          split.body.length > 0 && inlineText(split.body).trim() !== ""
            ? [{ children: split.body, type: "paragraph" }]
            : [];
        const alert: AlertNode = {
          alert: split.type,
          children: [...bodyParagraph, ...rest],
          element: settings.types.get(split.type) ?? null,
          titleNodes: split.title.length > 0 ? split.title : null,
          type: ALERT_NODE,
        };
        children[i] = alert;
        transformAlerts(alert, settings);
        continue;
      }
    }
    transformAlerts(child, settings);
  }
}
