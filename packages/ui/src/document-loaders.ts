/**
 * The kit's element documents as LOADERS: the same table as `documents`, under the same tags, with
 * every entry a dynamic import rather than the document.
 *
 * `registerUi()` defines every element at once because the shell is about to draw with all of them.
 * A host that draws one of Studio's own surfaces in a second realm (the canvas frame, ui.md §10)
 * needs only the elements that surface names, and only when such a surface is opened, so it
 * resolves them here, one chunk per document.
 *
 * A module of its own, apart from the behaviour loaders in `loaders.ts`: the frame registers those
 * at boot, and a table it reads only when a surface is opened should not ride in its boot path.
 *
 * `document-loaders.test.ts` holds this table to `documents`, key for key and object for object.
 *
 * @docs extending/ui-kit
 */

import type { JxDocument } from "@jxsuite/schema/types";

/**
 * A kit element document a host defines on first use. The JSON module's default export is the
 * document; `document-loaders.test.ts` holds each to the very object `documents` carries.
 */
export type KitDocumentLoader = () => Promise<{ default: object }>;

/**
 * The kit's element documents as LOADERS: the same table as `documents`, in the same registration
 * order (a document's `$elements` come before it), with every entry a dynamic import.
 *
 * `registerUi()` defines all of them at once because the shell is about to draw with all of them. A
 * host that draws one of Studio's own surfaces in a second realm (the canvas frame, ui.md §10)
 * needs only the elements that surface names, and only when such a surface is opened, so it
 * resolves them here, one chunk per document.
 */
export const KIT_DOCUMENT_LOADERS = {
  "jx-icon": () => import("../components/jx-icon.json"),
  "jx-spinner": () => import("../components/jx-spinner.json"),
  "jx-tooltip": () => import("../components/jx-tooltip.json"),
  "jx-button": () => import("../components/jx-button.json"),
  "jx-action-button": () => import("../components/jx-action-button.json"),
  "jx-menu-item": () => import("../components/jx-menu-item.json"),
  "jx-menu": () => import("../components/jx-menu.json"),
  "jx-popover": () => import("../components/jx-popover.json"),
  "jx-textfield": () => import("../components/jx-textfield.json"),
  "jx-checkbox": () => import("../components/jx-checkbox.json"),
  "jx-switch": () => import("../components/jx-switch.json"),
  "jx-number-field": () => import("../components/jx-number-field.json"),
  "jx-select": () => import("../components/jx-select.json"),
  "jx-slider": () => import("../components/jx-slider.json"),
  "jx-option": () => import("../components/jx-option.json"),
  "jx-listbox": () => import("../components/jx-listbox.json"),
  "jx-combobox": () => import("../components/jx-combobox.json"),
  "jx-action-group": () => import("../components/jx-action-group.json"),
  "jx-toolbar": () => import("../components/jx-toolbar.json"),
  "jx-tab": () => import("../components/jx-tab.json"),
  "jx-tab-panel": () => import("../components/jx-tab-panel.json"),
  "jx-tabs": () => import("../components/jx-tabs.json"),
  "jx-tree-item": () => import("../components/jx-tree-item.json"),
  "jx-tree": () => import("../components/jx-tree.json"),
  "jx-accordion-item": () => import("../components/jx-accordion-item.json"),
  "jx-accordion": () => import("../components/jx-accordion.json"),
  "jx-table": () => import("../components/jx-table.json"),
  "jx-tr": () => import("../components/jx-tr.json"),
  "jx-th": () => import("../components/jx-th.json"),
  "jx-td": () => import("../components/jx-td.json"),
  "jx-divider": () => import("../components/jx-divider.json"),
  "jx-split": () => import("../components/jx-split.json"),
  "jx-kbd": () => import("../components/jx-kbd.json"),
  "jx-dot": () => import("../components/jx-dot.json"),
  "jx-field": () => import("../components/jx-field.json"),
  "jx-dialog": () => import("../components/jx-dialog.json"),
  "jx-toast": () => import("../components/jx-toast.json"),
  "jx-toast-host": () => import("../components/jx-toast-host.json"),
  "jx-color-area": () => import("../components/jx-color-area.json"),
  "jx-color-slider": () => import("../components/jx-color-slider.json"),
  "jx-swatch": () => import("../components/jx-swatch.json"),
  "jx-swatch-group": () => import("../components/jx-swatch-group.json"),
  "jx-color-field": () => import("../components/jx-color-field.json"),
} as const satisfies Readonly<Record<string, KitDocumentLoader>>;

/**
 * The document a loader resolved, as the document the runtime defines an element from.
 *
 * @param {{ default: object }} loaded - What a {@link KIT_DOCUMENT_LOADERS} entry resolved to
 * @returns {JxDocument} The bundled component document
 */
export function kitDocumentOf(loaded: { default: object }): JxDocument {
  /* SAFETY: every loader imports a `components/*.json` file of this package, the same object
     `documents` holds (`document-loaders.test.ts`), and `conformance.test.ts` validates each of those
     against the Jx document schema (ui.md §3.2); TypeScript sees only the JSON's literal shape. */
  return loaded.default as JxDocument;
}
