/// <reference lib="dom" />
/**
 * Inline link application for contenteditable editing.
 *
 * Realm-agnostic: every DOM access uses ambient `window`/`document`, so bundled into the canvas
 * iframe these operate on the iframe realm where the edited DOM (and its Selection) live. The
 * parent format toolbar never calls these — it posts an `applyFormat` intent and the iframe applies
 * it here (Phase 4b-2).
 *
 * `document.execCommand` is uncoverable under happy-dom (no implementation), so it is wrapped in a
 * one-line shim {@link execEditingCommand} that the branch logic calls; tests stub
 * `document.execCommand` and assert at the stub level (documented as stub-level, not behavioral).
 */

import { normalizeInlineContent } from "./inline-format";
import { forgetKeptAttribute, keptBindingKeys } from "./kept-node";

/**
 * The one uncoverable call, isolated so the surrounding branch logic stays unit-testable, and the
 * one place Studio reaches `document.execCommand`. It is deprecated, and NOT kept for the native
 * undo stack: Studio owns history (`edit.undo` is forwarded out of the frame and a `historyUndo`
 * `beforeinput` is rejected, studio.md §8.2.1). It is kept because it is the only script entry into
 * the browser's editing engine, which a Range rewrite would not reproduce: `insertText` rebalances
 * whitespace into `&nbsp;` runs (and back) around the caret, and `createLink` splits the anchor at
 * inline-formatting boundaries it only partly covers.
 */
export const execEditingCommand = (cmd: string, val?: string): boolean =>
  // oxlint-disable-next-line typescript/no-deprecated -- no successor API exists: execCommand is the only script entry into the browser's editing engine (whitespace rebalancing, anchor splitting), see the doc comment above
  document.execCommand(cmd, false, val);

/** The link the selection sits in, as the format toolbar's Link field shows it. */
export interface LinkState {
  /** Whether the selection anchor is inside an `<a>`. */
  active: boolean;
  /** The author-entered URL of that `<a>`, or null when there is none. */
  href: string | null;
}

/**
 * Whether `node` is an `<a>` element. Decided by node type and name rather than `instanceof`, so it
 * holds for nodes of another realm; for an element, `nodeName` is its tag name.
 */
function isAnchorNode(node: Node): node is HTMLAnchorElement | SVGAElement {
  return node.nodeType === Node.ELEMENT_NODE && node.nodeName.toLowerCase() === "a";
}

/**
 * Read the link state of the current selection relative to `root`: walk the selection's anchor node
 * up to `root` looking for an `<a>`. Returns the author-entered `href` attribute (NOT the resolved
 * `.href` property), so relative/templated URLs round-trip unchanged.
 */
export function linkStateForSelection(root: HTMLElement): LinkState {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    return { active: false, href: null };
  }
  let node: Node | null = sel.anchorNode;
  while (node && node !== root) {
    if (isAnchorNode(node)) {
      // Design/edit renders anchors de-linked, with the URL on `data-jx-href` — so the toolbar's
      // Link field must read that first or it shows an empty URL for every existing link.
      return { active: true, href: node.dataset.jxHref ?? node.getAttribute("href") };
    }
    node = node.parentNode;
  }
  return { active: false, href: null };
}

/**
 * Find the `<a>` that contains the selection anchor (up to `root`), if any.
 *
 * @param {HTMLElement} root
 * @returns {HTMLAnchorElement | SVGAElement | null}
 */
function anchorInSelection(root: HTMLElement): HTMLAnchorElement | SVGAElement | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    return null;
  }
  let node: Node | null = sel.anchorNode;
  while (node && node !== root) {
    if (isAnchorNode(node)) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}

/**
 * Apply (or remove) a link on the current selection within `root`. With an existing `<a>` in the
 * selection: rewrite its `href`, or unwrap it when `href` is null/empty. Otherwise create a link
 * via `execCommand("createLink")`. Always normalizes the inline content afterwards.
 *
 * Returns what each binding this replaced or removed is counted as (`keptBindingKeys`): a bound
 * `href` the author typed a URL over, or everything a link held when it is unwrapped. The session
 * reports them with its next commit, which may then drop them; unreported, the commit is refused
 * for losing a binding, and a bound link's URL could never be changed from the canvas.
 */
export function applyLink(root: HTMLElement, href: string | null): string[] {
  const existing = anchorInSelection(root);
  let replaced: string[] = [];
  if (existing) {
    if (href) {
      /* The URL is the canvas's to say from here on: the element stops carrying the one its
         document node held, and a de-linked anchor holds its URL where the serializer reads it.
         Set as `href` alone, the new URL was written beside a `data-jx-href` that still held the
         old one, and the old one is what the commit stored. */
      replaced = keptBindingKeys(existing, "href");
      forgetKeptAttribute(existing, "href");
      if (existing.dataset.jxHref === undefined) {
        existing.setAttribute("href", href);
      } else {
        existing.dataset.jxHref = href;
      }
    } else {
      replaced = keptBindingKeys(existing);
      // Unwrap: replace the anchor with its children, preserving the text.
      const frag = document.createDocumentFragment();
      while (existing.firstChild) {
        frag.append(existing.firstChild);
      }
      existing.replaceWith(frag);
    }
  } else if (href) {
    execEditingCommand("createLink", href);
  }
  normalizeInlineContent(root);
  return replaced;
}
