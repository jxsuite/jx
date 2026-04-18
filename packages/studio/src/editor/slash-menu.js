/**
 * Slash-menu.js — Shared slash command menu for element insertion
 *
 * A single implementation used by both inline-edit (Edit/Content modes) and component inline
 * editing (Design mode). Renders a Spectrum-styled popover with keyboard navigation. Uses a
 * document-level capturing keydown listener so it intercepts Enter/Arrow/Escape before any
 * element-level handlers.
 */

import { html, render as litRender, nothing } from "lit-html";

// ─── Commands ─────────────────────────────────────────────────────────────────

const SLASH_COMMANDS = [
  { label: "Heading 1", tag: "h1", description: "Large heading" },
  { label: "Heading 2", tag: "h2", description: "Medium heading" },
  { label: "Heading 3", tag: "h3", description: "Small heading" },
  { label: "Paragraph", tag: "p", description: "Plain text" },
  { label: "Bulleted List", tag: "ul", description: "Unordered list" },
  { label: "Numbered List", tag: "ol", description: "Numbered list" },
  { label: "Blockquote", tag: "blockquote", description: "Quote block" },
  { label: "Image", tag: "img", description: "Insert image" },
  { label: "Horizontal Rule", tag: "hr", description: "Divider line" },
  { label: "Button", tag: "button", description: "Button element" },
  { label: "Link", tag: "a", description: "Anchor link" },
  { label: "Code Block", tag: "pre", description: "Preformatted code" },
  { label: "Table", tag: "table", description: "Insert table" },
  { label: "Div", tag: "div", description: "Container" },
  { label: "Section", tag: "section", description: "Section container" },
];

// ─── State ────────────────────────────────────────────────────────────────────

const host = document.createElement("div");
host.style.display = "contents";

/** @type {{ onSelect: (cmd: any) => void } | null} */
let callbacks = null;
let activeIdx = 0;
/** @type {any[]} */
let filteredItems = [];
let open = false;

// ─── Public API ───────────────────────────────────────────────────────────────

/** @returns {boolean} */
export function isSlashMenuOpen() {
  return open;
}

/**
 * Show (or update) the slash menu anchored below `anchorEl`.
 *
 * @param {HTMLElement} anchorEl — the element being edited (for positioning)
 * @param {string} filter — current typed filter text (after the "/")
 * @param {{ onSelect: (cmd: any) => void }} cbs
 */
export function showSlashMenu(anchorEl, filter, cbs) {
  // Lazily attach host to sp-theme
  if (!host.parentElement) {
    (document.querySelector("sp-theme") || document.body).appendChild(host);
  }

  callbacks = cbs;

  filteredItems = filter
    ? SLASH_COMMANDS.filter(
        (c) => c.label.toLowerCase().includes(filter) || c.tag.toLowerCase().includes(filter),
      )
    : SLASH_COMMANDS;

  if (!filteredItems.length) {
    dismissSlashMenu();
    return;
  }

  activeIdx = 0;

  const rect = anchorEl.getBoundingClientRect();

  litRender(
    html`
      <sp-popover
        open
        style="position:fixed;left:${rect.left}px;top:${rect.bottom +
        4}px;z-index:9999;max-height:280px;overflow-y:auto"
      >
        <sp-menu style="min-width:220px">
          ${filteredItems.map(
            (cmd, i) => html`
              <sp-menu-item
                ?focused=${i === 0}
                @click=${(/** @type {Event} */ e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  select(cmd);
                }}
              >
                ${cmd.label}
                ${cmd.description
                  ? html`<span slot="description">${cmd.description}</span>`
                  : nothing}
              </sp-menu-item>
            `,
          )}
        </sp-menu>
      </sp-popover>
    `,
    host,
  );

  if (!open) {
    open = true;
    document.addEventListener("keydown", onKeydown, true); // capture phase
  }
}

export function dismissSlashMenu() {
  if (!open) return;
  open = false;
  callbacks = null;
  filteredItems = [];
  document.removeEventListener("keydown", onKeydown, true);
  litRender(nothing, host);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/** @param {any} cmd */
function select(cmd) {
  const cbs = callbacks;
  dismissSlashMenu();
  cbs?.onSelect(cmd);
}

/** @param {KeyboardEvent} e */
function onKeydown(e) {
  if (!open) return;

  const items = /** @type {NodeListOf<Element>} */ (host.querySelectorAll("sp-menu-item"));
  if (!items.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    items[activeIdx]?.removeAttribute("focused");
    activeIdx = (activeIdx + 1) % items.length;
    items[activeIdx]?.setAttribute("focused", "");
    items[activeIdx]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation();
    items[activeIdx]?.removeAttribute("focused");
    activeIdx = (activeIdx - 1 + items.length) % items.length;
    items[activeIdx]?.setAttribute("focused", "");
    items[activeIdx]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    const cmd = filteredItems[activeIdx];
    if (cmd) select(cmd);
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    dismissSlashMenu();
  }
}
