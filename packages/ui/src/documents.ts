/**
 * The kit's element documents, as bundled JSON. This is the whole authored surface of the kit:
 * every element is one of these files, interpreted by the runtime, and the canvas edits the same
 * bytes the shell runs.
 */
import { overlayScopeFor } from "@jxsuite/schema/overlays";
import type { JsonPrimitive, JxDocument } from "@jxsuite/schema/types";
import jxAccordion from "../components/jx-accordion.json";
import jxAccordionItem from "../components/jx-accordion-item.json";
import jxActionButton from "../components/jx-action-button.json";
import jxActionGroup from "../components/jx-action-group.json";
import jxButton from "../components/jx-button.json";
import jxCheckbox from "../components/jx-checkbox.json";
import jxColorArea from "../components/jx-color-area.json";
import jxColorField from "../components/jx-color-field.json";
import jxColorSlider from "../components/jx-color-slider.json";
import jxDialog from "../components/jx-dialog.json";
import jxDivider from "../components/jx-divider.json";
import jxDot from "../components/jx-dot.json";
import jxField from "../components/jx-field.json";
import jxKbd from "../components/jx-kbd.json";
import jxIcon from "../components/jx-icon.json";
import jxMenu from "../components/jx-menu.json";
import jxMenuItem from "../components/jx-menu-item.json";
import jxPopover from "../components/jx-popover.json";
import jxCombobox from "../components/jx-combobox.json";
import jxListbox from "../components/jx-listbox.json";
import jxOption from "../components/jx-option.json";
import jxSelect from "../components/jx-select.json";
import jxSpinner from "../components/jx-spinner.json";
import jxSplit from "../components/jx-split.json";
import jxTooltip from "../components/jx-tooltip.json";
import jxNumberField from "../components/jx-number-field.json";
import jxSwatch from "../components/jx-swatch.json";
import jxSwatchGroup from "../components/jx-swatch-group.json";
import jxSwitch from "../components/jx-switch.json";
import jxTab from "../components/jx-tab.json";
import jxTabPanel from "../components/jx-tab-panel.json";
import jxTabs from "../components/jx-tabs.json";
import jxTextfield from "../components/jx-textfield.json";
import jxToast from "../components/jx-toast.json";
import jxTree from "../components/jx-tree.json";
import jxTreeItem from "../components/jx-tree-item.json";
import jxToastHost from "../components/jx-toast-host.json";
import jxToolbar from "../components/jx-toolbar.json";

/**
 * A value as TypeScript types a JSON module import. Under the root config's
 * `exactOptionalPropertyTypes` that is always a `JsonValue`, but `packages/desktop` compiles this
 * file without the flag, and there an array of differently shaped objects is normalised by giving
 * each object the others' keys as `?: undefined`, which `JsonValue` refuses.
 */
type ImportedJson =
  | JsonPrimitive
  | undefined
  | readonly ImportedJson[]
  | { readonly [key: string]: ImportedJson };

/**
 * A bundled component file as the document the runtime defines it from.
 *
 * @param {Readonly<Record<string, ImportedJson>>} json - One of the `components/*.json` imports
 *   above
 * @returns {JxDocument} The same object, typed as the document it is
 */
function kitDocument(json: Readonly<Record<string, ImportedJson>>): JxDocument {
  /* SAFETY: every argument is a `components/*.json` file of this package, and `conformance.test.ts`
     validates each entry of `documents` against the Jx document schema (ui.md §3.2), so the JSON
     is a JxDocument; TypeScript only sees the literal shape the JSON import infers. */
  return json as JxDocument;
}

/** Tag name → document, in registration order (a document's `$elements` come before it). */
export const documents = {
  "jx-icon": kitDocument(jxIcon),
  "jx-spinner": kitDocument(jxSpinner),
  // Before the buttons: each renders a `jx-tooltip` for its `hint`.
  "jx-tooltip": kitDocument(jxTooltip),
  "jx-button": kitDocument(jxButton),
  "jx-action-button": kitDocument(jxActionButton),
  "jx-menu-item": kitDocument(jxMenuItem),
  "jx-menu": kitDocument(jxMenu),
  "jx-popover": kitDocument(jxPopover),
  "jx-textfield": kitDocument(jxTextfield),
  "jx-checkbox": kitDocument(jxCheckbox),
  "jx-switch": kitDocument(jxSwitch),
  "jx-number-field": kitDocument(jxNumberField),
  "jx-select": kitDocument(jxSelect),
  "jx-option": kitDocument(jxOption),
  "jx-listbox": kitDocument(jxListbox),
  "jx-combobox": kitDocument(jxCombobox),
  "jx-action-group": kitDocument(jxActionGroup),
  "jx-toolbar": kitDocument(jxToolbar),
  "jx-tab": kitDocument(jxTab),
  "jx-tab-panel": kitDocument(jxTabPanel),
  "jx-tabs": kitDocument(jxTabs),
  "jx-tree-item": kitDocument(jxTreeItem),
  "jx-tree": kitDocument(jxTree),
  "jx-accordion-item": kitDocument(jxAccordionItem),
  "jx-accordion": kitDocument(jxAccordion),
  "jx-divider": kitDocument(jxDivider),
  "jx-split": kitDocument(jxSplit),
  "jx-kbd": kitDocument(jxKbd),
  "jx-dot": kitDocument(jxDot),
  "jx-field": kitDocument(jxField),
  "jx-dialog": kitDocument(jxDialog),
  "jx-toast": kitDocument(jxToast),
  "jx-toast-host": kitDocument(jxToastHost),
  "jx-color-area": kitDocument(jxColorArea),
  "jx-color-slider": kitDocument(jxColorSlider),
  "jx-swatch": kitDocument(jxSwatch),
  "jx-swatch-group": kitDocument(jxSwatchGroup),
  "jx-color-field": kitDocument(jxColorField),
} as const satisfies Readonly<Record<string, JxDocument>>;

/** Every tag the kit defines. */
export const KIT_TAGS: readonly string[] = Object.keys(documents);

/**
 * The tags whose DEFINITION declares `popover` on its root, and the tags that forward the invoker
 * attributes to a native `<button>` inside themselves.
 *
 * A consumer writes `<jx-menu id="m1">` and the `popover` attribute is nowhere in their document,
 * so every structural rule in `@jxsuite/schema/overlays` read it as an ordinary element: a command
 * aimed at it was a target mismatch, and a host asking "does this document have a popover?" was
 * told no. The mirror image is `popovertarget`, which HTML gives only to `<button>` and `<input>`,
 * so the lints refused it on a kit button that observes it and passes it to its own control.
 *
 * DERIVED from the documents by the schema's own `overlayScopeFor`, not listed here: the compiler
 * asks the same question of a project's `*.class.json` definitions, and two derivations of "what
 * makes a tag a popover" is two chances to disagree about one project.
 */
const KIT_SCOPE = overlayScopeFor(Object.values(documents));

/** Tags whose definition declares `popover`. */
export const POPOVER_TAGS: ReadonlySet<string> = KIT_SCOPE.popoverTags ?? new Set();

/** Tags that forward `popovertarget` and `commandfor` to a native button inside themselves. */
export const INVOKER_TAGS: ReadonlySet<string> = KIT_SCOPE.invokerTags ?? new Set();
