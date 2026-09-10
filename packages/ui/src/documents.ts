/**
 * The kit's element documents, as bundled JSON. This is the whole authored surface of the kit:
 * every element is one of these files, interpreted by the runtime, and the canvas edits the same
 * bytes the shell runs.
 */
import { overlayScopeFor } from "@jxsuite/schema/overlays";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
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

/** Tag name → document, in registration order (a document's `$elements` come before it). */
export const documents: Readonly<Record<string, JxDocument>> = {
  "jx-icon": jxIcon as unknown as JxDocument,
  "jx-spinner": jxSpinner as unknown as JxDocument,
  "jx-button": jxButton as unknown as JxDocument,
  "jx-action-button": jxActionButton as unknown as JxDocument,
  "jx-menu-item": jxMenuItem as unknown as JxDocument,
  "jx-menu": jxMenu as unknown as JxDocument,
  "jx-popover": jxPopover as unknown as JxDocument,
  "jx-tooltip": jxTooltip as unknown as JxDocument,
  "jx-textfield": jxTextfield as unknown as JxDocument,
  "jx-checkbox": jxCheckbox as unknown as JxDocument,
  "jx-switch": jxSwitch as unknown as JxDocument,
  "jx-number-field": jxNumberField as unknown as JxDocument,
  "jx-select": jxSelect as unknown as JxDocument,
  "jx-option": jxOption as unknown as JxDocument,
  "jx-listbox": jxListbox as unknown as JxDocument,
  "jx-combobox": jxCombobox as unknown as JxDocument,
  "jx-action-group": jxActionGroup as unknown as JxDocument,
  "jx-tab": jxTab as unknown as JxDocument,
  "jx-tab-panel": jxTabPanel as unknown as JxDocument,
  "jx-tabs": jxTabs as unknown as JxDocument,
  "jx-tree-item": jxTreeItem as unknown as JxDocument,
  "jx-tree": jxTree as unknown as JxDocument,
  "jx-accordion-item": jxAccordionItem as unknown as JxDocument,
  "jx-accordion": jxAccordion as unknown as JxDocument,
  "jx-divider": jxDivider as unknown as JxDocument,
  "jx-kbd": jxKbd as unknown as JxDocument,
  "jx-dot": jxDot as unknown as JxDocument,
  "jx-field": jxField as unknown as JxDocument,
  "jx-dialog": jxDialog as unknown as JxDocument,
  "jx-toast": jxToast as unknown as JxDocument,
  "jx-toast-host": jxToastHost as unknown as JxDocument,
  "jx-color-area": jxColorArea as unknown as JxDocument,
  "jx-color-slider": jxColorSlider as unknown as JxDocument,
  "jx-swatch": jxSwatch as unknown as JxDocument,
  "jx-swatch-group": jxSwatchGroup as unknown as JxDocument,
  "jx-color-field": jxColorField as unknown as JxDocument,
};

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
const KIT_SCOPE = overlayScopeFor(Object.values(documents) as JxElement[]);

/** Tags whose definition declares `popover`. */
export const POPOVER_TAGS: ReadonlySet<string> = KIT_SCOPE.popoverTags ?? new Set();

/** Tags that forward `popovertarget` and `commandfor` to a native button inside themselves. */
export const INVOKER_TAGS: ReadonlySet<string> = KIT_SCOPE.invokerTags ?? new Set();
