/**
 * The kit's element documents, as bundled JSON. This is the whole authored surface of the kit:
 * every element is one of these files, interpreted by the runtime, and the canvas edits the same
 * bytes the shell runs.
 */
import type { JxDocument } from "@jxsuite/schema/types";
import jxActionButton from "../components/jx-action-button.json";
import jxButton from "../components/jx-button.json";
import jxCheckbox from "../components/jx-checkbox.json";
import jxDialog from "../components/jx-dialog.json";
import jxIcon from "../components/jx-icon.json";
import jxMenu from "../components/jx-menu.json";
import jxMenuItem from "../components/jx-menu-item.json";
import jxNumberField from "../components/jx-number-field.json";
import jxSwitch from "../components/jx-switch.json";
import jxTextfield from "../components/jx-textfield.json";

/** Tag name → document, in registration order (a document's `$elements` come before it). */
export const documents: Readonly<Record<string, JxDocument>> = {
  "jx-icon": jxIcon as unknown as JxDocument,
  "jx-button": jxButton as unknown as JxDocument,
  "jx-action-button": jxActionButton as unknown as JxDocument,
  "jx-menu-item": jxMenuItem as unknown as JxDocument,
  "jx-menu": jxMenu as unknown as JxDocument,
  "jx-textfield": jxTextfield as unknown as JxDocument,
  "jx-checkbox": jxCheckbox as unknown as JxDocument,
  "jx-switch": jxSwitch as unknown as JxDocument,
  "jx-number-field": jxNumberField as unknown as JxDocument,
  "jx-dialog": jxDialog as unknown as JxDocument,
};

/** Every tag the kit defines. */
export const KIT_TAGS: readonly string[] = Object.keys(documents);
