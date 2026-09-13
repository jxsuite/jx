/**
 * The kit's `$src` modules as LOADERS: the same table as `KIT_MODULES`, under the same specifiers,
 * with every entry a dynamic import rather than a namespace.
 *
 * A host that registers the kit's elements needs the behaviours at once, because the elements are
 * about to render — that is `registerUi()` and `KIT_MODULES`. A host that only MIGHT render a kit
 * element, from documents it does not know in advance, should not pay for twenty sidecars on the
 * chance: Studio's canvas frame is that host. It renders whatever project is open, and a project
 * that uses a kit element names the element's document by URL and the document names its sidecar by
 * `jx-ui:` specifier; this table is what lets the frame answer that specifier when it comes, and
 * not before. Each entry is its own chunk under a bundler that splits on `import()`, so the frame's
 * entry grows by a table of twenty thunks and nothing else (embedding.md §6).
 *
 * `loaders.test.ts` holds the two tables to one key set, so a behaviour added to one cannot be
 * forgotten in the other.
 *
 * @docs extending/ui-kit
 */

/** A module the runtime imports on first use, keyed as the kit's documents spell their `$src`. */
export type KitModuleLoader = () => Promise<Record<string, unknown>>;

/** Behaviour modules as loaders, under the `$src` specifiers the documents use. */
export const KIT_LOADERS: Readonly<Record<string, KitModuleLoader>> = {
  "jx-ui:/behaviors/color-area.ts": () => import("./behaviors/color-area.ts"),
  "jx-ui:/behaviors/color-field.ts": () => import("./behaviors/color-field.ts"),
  "jx-ui:/behaviors/color-slider.ts": () => import("./behaviors/color-slider.ts"),
  "jx-ui:/behaviors/combobox.ts": () => import("./behaviors/combobox.ts"),
  "jx-ui:/behaviors/dialog.ts": () => import("./behaviors/dialog.ts"),
  "jx-ui:/behaviors/listbox.ts": () => import("./behaviors/listbox.ts"),
  "jx-ui:/behaviors/menu.ts": () => import("./behaviors/menu.ts"),
  "jx-ui:/behaviors/number-field.ts": () => import("./behaviors/number-field.ts"),
  "jx-ui:/behaviors/action-group.ts": () => import("./behaviors/action-group.ts"),
  "jx-ui:/behaviors/popover.ts": () => import("./behaviors/popover.ts"),
  "jx-ui:/behaviors/select.ts": () => import("./behaviors/select.ts"),
  "jx-ui:/behaviors/split.ts": () => import("./behaviors/split.ts"),
  "jx-ui:/behaviors/swatch-group.ts": () => import("./behaviors/swatch-group.ts"),
  "jx-ui:/behaviors/tabs.ts": () => import("./behaviors/tabs.ts"),
  "jx-ui:/behaviors/toolbar.ts": () => import("./behaviors/toolbar.ts"),
  "jx-ui:/behaviors/tree.ts": () => import("./behaviors/tree.ts"),
  "jx-ui:/behaviors/tooltip.ts": () => import("./behaviors/tooltip.ts"),
  "jx-ui:/behaviors/textfield.ts": () => import("./behaviors/textfield.ts"),
  "jx-ui:/behaviors/toast.ts": () => import("./behaviors/toast.ts"),
  "jx-ui:/behaviors/toast-host.ts": () => import("./behaviors/toast-host.ts"),
  "jx-ui:/color.ts": () => import("./color.ts"),
  "jx-ui:/icons.ts": () => import("./icons.ts"),
};
