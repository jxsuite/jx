// ─── Clipboard & Context Menu ─────────────────────────────────────────────────
import { html, render as litRender } from "lit-html";
import {
  update,
  selectNode,
  insertNode,
  removeNode,
  duplicateNode,
  getNodeAtPath,
  parentElementPath,
  childIndex,
} from "../../store.js";
import { statusMessage } from "../panels/statusbar.js";

/** @type {any} */
let clipboard = null;

// ─── Clipboard ────────────────────────────────────────────────────────────────

/** @param {any} S */
export function copyNode(S) {
  if (!S.selection) return;
  const node = getNodeAtPath(S.document, S.selection);
  if (!node) return;
  clipboard = structuredClone(node);
  statusMessage("Copied");
}

/** @param {any} S */
export function cutNode(S) {
  if (!S.selection || S.selection.length < 2) return;
  const node = getNodeAtPath(S.document, S.selection);
  if (!node) return;
  clipboard = structuredClone(node);
  update(removeNode(S, S.selection));
  statusMessage("Cut");
}

/** @param {any} S */
export function pasteNode(S) {
  if (!clipboard) return;
  const pPath = S.selection || [];
  const parent = getNodeAtPath(S.document, pPath);
  if (!parent) return;

  if (S.selection && S.selection.length >= 2) {
    // Paste as sibling after selection
    const pp = /** @type {any} */ (parentElementPath(S.selection));
    const idx = /** @type {number} */ (childIndex(S.selection));
    update(insertNode(S, pp, idx + 1, structuredClone(clipboard)));
  } else {
    // Paste as last child of root/selected
    const idx = parent.children ? parent.children.length : 0;
    update(insertNode(S, pPath, idx, structuredClone(clipboard)));
  }
  statusMessage("Pasted");
}

// ─── Context menu ─────────────────────────────────────────────────────────────

const ctxMenu = document.createElement("sp-popover");
ctxMenu.style.position = "fixed";
ctxMenu.style.zIndex = "10000";
document.body.appendChild(ctxMenu);

document.addEventListener("click", () => {
  ctxMenu.removeAttribute("open");
});

/**
 * @param {any} e
 * @param {any} path
 * @param {any} S
 */
export function showContextMenu(e, path, S) {
  e.preventDefault();
  ctxMenu.removeAttribute("open");

  const node = getNodeAtPath(S.document, path);
  if (!node) return;

  // Select the node
  update(selectNode(S, path));

  /** @type {{ label: string; action?: () => void; danger?: boolean }[]} */
  const items = [];

  items.push({ label: "Copy", action: () => copyNode(S) });
  if (path.length >= 2) {
    items.push({ label: "Cut", action: () => cutNode(S) });
    items.push({ label: "Duplicate", action: () => update(duplicateNode(S, S.selection)) });
    items.push({ label: "—" }); // separator
    items.push({ label: "Delete", action: () => update(removeNode(S, S.selection)), danger: true });
  }
  if (clipboard) {
    items.push({ label: "—" });
    items.push({
      label: "Paste inside",
      action: () => {
        const idx = node.children ? node.children.length : 0;
        update(insertNode(S, path, idx, structuredClone(clipboard)));
      },
    });
    if (path.length >= 2) {
      items.push({
        label: "Paste after",
        action: () => {
          const pp = /** @type {any} */ (parentElementPath(path));
          const idx = /** @type {number} */ (childIndex(path));
          update(insertNode(S, pp, idx + 1, structuredClone(clipboard)));
        },
      });
    }
  }

  litRender(
    html`${items.map((item) =>
      item.label === "—"
        ? html`<sp-menu-divider></sp-menu-divider>`
        : html`<sp-menu-item
            style=${item.danger ? "color: var(--danger)" : ""}
            @click=${() => {
              ctxMenu.removeAttribute("open");
              item.action?.();
            }}
            >${item.label}</sp-menu-item
          >`,
    )}`,
    ctxMenu,
  );

  // Position the menu
  ctxMenu.setAttribute("open", "");
  const menuRect = ctxMenu.getBoundingClientRect();
  let x = e.clientX,
    y = e.clientY;
  if (x + menuRect.width > window.innerWidth) x = window.innerWidth - menuRect.width - 4;
  if (y + menuRect.height > window.innerHeight) y = window.innerHeight - menuRect.height - 4;
  ctxMenu.style.left = `${x}px`;
  ctxMenu.style.top = `${y}px`;
}
