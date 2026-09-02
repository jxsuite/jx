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

/**
 * The tags whose DEFINITION declares `popover` on its root.
 *
 * A consumer writes `<jx-menu id="m1">` and the `popover` attribute is nowhere in their document,
 * so every structural rule in `@jxsuite/schema/overlays` read it as an ordinary element: a command
 * aimed at it was a target mismatch, and a host asking "does this document have a popover?" was
 * told no. The set is DERIVED from the documents rather than listed, so a new overlay element joins
 * it by being one.
 */
export const POPOVER_TAGS: ReadonlySet<string> = new Set(
  Object.entries(documents)
    .filter(([, doc]) => "popover" in ((doc as { attributes?: object }).attributes ?? {}))
    .map(([tag]) => tag),
);

/** The invoker attributes an element must observe to be forwarding them to a native button. */
const INVOKER_ATTRS = ["popovertarget", "popovertargetaction", "command", "commandfor"];

/**
 * The tags that forward the invoker attributes to a native `<button>` inside themselves.
 *
 * `popovertarget` and `commandfor` come from an IDL mixin HTML includes into `HTMLButtonElement`
 * and `HTMLInputElement` and nothing else, so the overlay lints refuse them on any other tag. A kit
 * button is the exception: it observes them and passes them to its own control, which is where the
 * platform reads them. Without this the lints fire on the spelling the kit's own docs teach.
 *
 * Derived from `observedAttributes` rather than listed, for the same reason as
 * {@link POPOVER_TAGS}.
 */
export const INVOKER_TAGS: ReadonlySet<string> = new Set(
  Object.entries(documents)
    .filter(([, doc]) =>
      INVOKER_ATTRS.every((attr) =>
        ((doc as { observedAttributes?: string[] }).observedAttributes ?? []).includes(attr),
      ),
    )
    .map(([tag]) => tag),
);
