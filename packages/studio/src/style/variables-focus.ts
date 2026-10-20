/**
 * Where the Variables view should point next: one custom property, or one group of them.
 *
 * The Styles panel (`panels/styles-panel.ts`) lists every CSS custom property and every group, and
 * choosing one shows it in the Variables view (`style/variables-view.ts`). The panel does not own
 * the pane, so it does not call into the view: it files a REQUEST here and the view, which watches
 * {@link variablesFocus}, scrolls the row into view and puts the keyboard on it. A request made
 * while the view is not on screen yet (the pane was in Elements) is served when the view mounts,
 * once: {@link VariablesFocusRequest.served} is what tells a new request from one already served.
 *
 * The property the view MARKS is `shell.stylebook.variable`, written here too, so the panel and the
 * editor mark the same row.
 *
 * @docs studio/design/tokens
 */

import { shallowRef } from "../reactivity";
import { shell } from "../shell";
import type { TokenGroupId } from "./project-styles";

/** What the Variables view is asked to bring on screen. */
export type VariablesFocus =
  /** One custom property, `--accent`: its row is scrolled to and its value field focused. */
  | { kind: "variable"; name: string }
  /**
   * One group (Colors, Fonts, …): its heading is scrolled to, and with `add` its Add row's name
   * field is focused, which is how "Add variable" reaches the editor's own add flow.
   */
  | { kind: "group"; group: TokenGroupId; add: boolean };

/**
 * One request. `served` is set by the view that brought it on screen, so a second view (another
 * pane, or the same pane drawn again) does not move the keyboard for a click it has already
 * answered. A plain field on a SHALLOW ref's value: serving a request is not a change anybody
 * watches.
 */
export interface VariablesFocusRequest {
  focus: VariablesFocus | null;
  served: boolean;
}

/** The latest request. Every assignment is a new request; nothing asked yet is a served `null`. */
export const variablesFocus = shallowRef<VariablesFocusRequest>({ focus: null, served: true });

/**
 * Ask the Variables view to bring a property or a group on screen. Choosing the property already
 * chosen asks again, which brings it back after the author scrolled away.
 *
 * @param {VariablesFocus} focus
 */
export function requestVariablesFocus(focus: VariablesFocus): void {
  if (focus.kind === "variable") {
    shell.stylebook.variable = focus.name;
  }
  variablesFocus.value = { focus, served: false };
}

/** Forget any request not yet served: a project switch, whose views are not this request's. */
export function resetVariablesFocus(): void {
  variablesFocus.value = { focus: null, served: true };
}
