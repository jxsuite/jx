/**
 * Dialog and invoker-command rules — the second half of the overlay lint (spec §8.7).
 *
 * `overlays.ts` judges `popover` and `popovertarget`. This module judges the other two things the
 * platform gives a document for overlays: a `<dialog>`, opened modally with `showModal()` and
 * closed by Escape or a `close` command, and the **invoker commands** — `command` and `commandfor`
 * on a `<button>` — that open and close either kind without a line of script. The rules share one
 * shape and one walker with the popover rules, so a document report can file both under one source
 * and a repair can address a node by the same path.
 *
 * Every rule encodes a fact about the platform that is easy to get wrong and hard to see:
 *
 * - `commandfor` and `command` come from `HTMLButtonElement` and nowhere else — not `<input>`, which
 *   `popovertarget` does allow — so on any other element they parse and do nothing.
 * - `command` is an enumerated attribute: a value that is not one of the built-in keywords and does
 *   not start with `--` is invalid, and an invalid value makes the button do nothing.
 * - `show-modal`, `close` and `request-close` act on a dialog; the three `*-popover` commands act on
 *   a popover. A command aimed at the other kind is silently ignored.
 * - A `--custom` command is a `CommandEvent` the target must answer; with no `oncommand` handler
 *   there, the click does nothing.
 * - `closedby` is enumerated too: `any`, `closerequest` or `none`.
 * - A modal dialog that closes on nothing — `closedby="none"` and no close button inside — traps the
 *   reader, because a modal makes the rest of the page inert.
 * - A closed dialog is hidden by the browser's own `dialog:not([open]) { display: none }`, which is
 *   UA-origin, so an author `display` in the base rule shows it on every page. Same defect as a
 *   popover's, same repair: the `display` belongs in the open rule.
 */
import { getNestedStyle } from "./guards.ts";
import {
  attrs,
  idOf,
  isPopover,
  labelOf,
  literalAttr,
  popoverIdsIn,
  scalar,
  tagOf,
  walk,
} from "./overlays.ts";

import type { PopoverPath } from "./overlays.ts";
import type { JxElement, JxStyle } from "../types.ts";

/**
 * The built-in invoker commands.
 *
 * The six the HTML standard defines for popovers and dialogs. Anything else the button does not
 * understand — unless it starts with `--`, which is a custom command the target answers itself.
 */
export const INVOKER_COMMANDS = [
  "toggle-popover",
  "show-popover",
  "hide-popover",
  "show-modal",
  "close",
  "request-close",
] as const;

/** The commands that act on a `<dialog>`. */
export const DIALOG_COMMANDS: ReadonlySet<string> = new Set([
  "show-modal",
  "close",
  "request-close",
]);

/** The commands that act on a popover. */
export const POPOVER_COMMANDS: ReadonlySet<string> = new Set([
  "toggle-popover",
  "show-popover",
  "hide-popover",
]);

/** The values `closedby` takes. */
export const DIALOG_CLOSEDBY = ["any", "closerequest", "none"] as const;

/**
 * Only a `<button>` carries `command` and `commandfor` (`HTMLButtonElement`, and no other
 * interface).
 */
export const COMMAND_INVOKER_TAGS: ReadonlySet<string> = new Set(["button"]);

/** Every rule this module can report. */
export type DialogRule =
  | "invoker-not-button"
  | "command-invalid"
  | "command-target-missing"
  | "command-target-mismatch"
  | "custom-command-unhandled"
  | "dialog-closedby-invalid"
  | "dialog-no-invoker"
  | "modal-without-close"
  | "dialog-display";

/**
 * The mechanical repair a finding can carry: `display` moves into the open rule, `invoker` removes
 * the two attributes.
 */
export type DialogFix = "display" | "invoker";

export interface DialogDefect {
  rule: DialogRule;
  path: PopoverPath;
  message: string;
  detail: string;
  severity: "error" | "warn";
  fix?: DialogFix;
}

const DOCS = "See docs/framework/concepts/overlays.";

/** Whether the node is a `<dialog>`. */
export function isDialog(node: JxElement): boolean {
  return tagOf(node) === "dialog";
}

/** Whether the value is a custom command. */
function isCustomCommand(command: string): boolean {
  return command.startsWith("--");
}

/** Every `id` in the document that belongs to a `<dialog>`, in document order. */
export function dialogIdsIn(doc: JxElement): string[] {
  const ids: string[] = [];
  for (const { node } of walk(doc)) {
    const id = idOf(node);
    if (isDialog(node) && id !== null && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/** Whether the document holds a `<dialog>` at all — what a "show dialog" verb's enablement asks. */
export function documentHasDialog(doc: JxElement): boolean {
  for (const { node } of walk(doc)) {
    if (isDialog(node)) {
      return true;
    }
  }
  return false;
}

/** Whether a node declares an `oncommand` handler, in any of the handler spellings. */
function handlesCommand(node: JxElement): boolean {
  const handler = (node as Record<string, unknown>).oncommand;
  return handler !== undefined && handler !== null;
}

/**
 * The buttons inside `node` whose command closes it, or closes the dialog they are in through a
 * form.
 */
function hasCloseControl(dialog: JxElement, dialogId: string | null): boolean {
  for (const { node } of walk(dialog)) {
    if (node === dialog) {
      continue;
    }
    const tag = tagOf(node);
    if (tag === "button") {
      const command = literalAttr(node, "command");
      const target = literalAttr(node, "commandfor");
      if (
        command !== null &&
        (command === "close" || command === "request-close") &&
        (target === null || target === dialogId)
      ) {
        return true;
      }
    }
    if (tag === "form" && literalAttr(node, "method")?.toLowerCase() === "dialog") {
      return true;
    }
  }
  return false;
}

/**
 * Every dialog and invoker-command defect in a document, in document order.
 *
 * @param doc The document to check.
 * @returns The defects, most structural first within each node.
 */
export function findDialogDefects(doc: JxElement): DialogDefect[] {
  const visits = [...walk(doc)];
  const dialogIds = dialogIdsIn(doc);
  const popoverIds = popoverIdsIn(doc);
  const hasAnyTarget = dialogIds.length > 0 || popoverIds.length > 0;
  const byId = new Map<string, JxElement>();
  const targeted = new Map<string, Set<string>>();
  for (const { node } of visits) {
    const id = idOf(node);
    if (id !== null && !byId.has(id)) {
      byId.set(id, node);
    }
    if (tagOf(node) === "button") {
      const target = literalAttr(node, "commandfor");
      const command = literalAttr(node, "command");
      if (target !== null) {
        const commands = targeted.get(target) ?? new Set<string>();
        commands.add(command ?? "");
        targeted.set(target, commands);
      }
    }
  }

  const defects: DialogDefect[] = [];
  for (const { node, path } of visits) {
    defects.push(...invokerDefects(node, path, byId, dialogIds, popoverIds, hasAnyTarget));
    if (isDialog(node)) {
      defects.push(...dialogDefects(node, path, targeted));
    }
  }
  return defects;
}

/** The rules that judge a button carrying `command` or `commandfor`. */
function invokerDefects(
  node: JxElement,
  path: PopoverPath,
  byId: ReadonlyMap<string, JxElement>,
  dialogIds: string[],
  popoverIds: string[],
  hasAnyTarget: boolean,
): DialogDefect[] {
  const out: DialogDefect[] = [];
  const tag = tagOf(node);
  const command = literalAttr(node, "command");
  const target = literalAttr(node, "commandfor");
  const carries =
    command !== null || target !== null || "command" in attrs(node) || "commandfor" in attrs(node);
  if (!carries) {
    return out;
  }
  const label = labelOf(node, "the element");

  if (!COMMAND_INVOKER_TAGS.has(tag)) {
    out.push({
      detail:
        "`command` and `commandfor` are attributes of `HTMLButtonElement` and of no other " +
        "interface — not even `<input>`, which `popovertarget` does allow. Elsewhere they parse " +
        `and do nothing. Make it a <button>, or remove both attributes. ${DOCS}`,
      fix: "invoker",
      message: `<${tag || "element"}> carries command/commandfor, which only <button> supports.`,
      path,
      rule: "invoker-not-button",
      severity: "error",
    });
    return out;
  }

  if (
    command !== null &&
    !(INVOKER_COMMANDS as readonly string[]).includes(command) &&
    !isCustomCommand(command)
  ) {
    out.push({
      detail:
        `\`command\` is an enumerated attribute taking ${INVOKER_COMMANDS.map((c) => `\`${c}\``).join(", ")}, ` +
        "or a custom command starting with `--`. Anything else is the invalid-value state, and a " +
        `button in that state does nothing when clicked. ${DOCS}`,
      message: `${label} declares command="${command}", which is not a built-in or --custom command.`,
      path,
      rule: "command-invalid",
      severity: "error",
    });
    return out;
  }

  if (target !== null) {
    const known = byId.get(target);
    const targetsDialog = dialogIds.includes(target);
    const targetsPopover = popoverIds.includes(target);
    if (!known && hasAnyTarget) {
      const names = [...dialogIds, ...popoverIds].map((id) => `"${id}"`).join(", ");
      out.push({
        detail:
          `No element in this document has the id "${target}". The dialogs and popovers here are: ${names}. ` +
          `A commandfor that names nothing does nothing, silently. ${DOCS}`,
        message: `commandfor="${target}" names nothing in this document.`,
        path,
        rule: "command-target-missing",
        severity: "error",
      });
      return out;
    }
    if (command !== null && known) {
      if (DIALOG_COMMANDS.has(command) && !isDialog(known)) {
        out.push({
          detail:
            `\`${command}\` acts on a <dialog>, and "${target}" is ${targetsPopover ? "a popover" : `a <${tagOf(known) || "element"}>`}. ` +
            `The click is ignored. ${targetsPopover ? "Use `toggle-popover`, `show-popover` or `hide-popover` for a popover." : "Point it at a dialog, or make the target one."} ${DOCS}`,
          message: `${label} sends ${command} to "${target}", which is not a dialog.`,
          path,
          rule: "command-target-mismatch",
          severity: "error",
        });
      } else if (POPOVER_COMMANDS.has(command) && !isPopover(known)) {
        out.push({
          detail:
            `\`${command}\` acts on a popover, and "${target}" is ${targetsDialog ? "a dialog" : `a <${tagOf(known) || "element"}>`} that declares no \`popover\`. ` +
            `The click is ignored. ${targetsDialog ? "Use `show-modal`, `close` or `request-close` for a dialog." : "Give the target a `popover` attribute, or point the button elsewhere."} ${DOCS}`,
          message: `${label} sends ${command} to "${target}", which is not a popover.`,
          path,
          rule: "command-target-mismatch",
          severity: "error",
        });
      } else if (isCustomCommand(command) && !handlesCommand(known)) {
        out.push({
          detail:
            `A custom command is a \`CommandEvent\` dispatched at its target, and "${target}" has no ` +
            "`oncommand` handler to answer it — so the click does nothing. Add one that switches on " +
            `\`event#/command\`, or use a built-in command. ${DOCS}`,
          message: `${label} sends ${command} to "${target}", which handles no command.`,
          path,
          rule: "custom-command-unhandled",
          severity: "warn",
        });
      }
    }
  }
  return out;
}

/** The rules that judge a `<dialog>` itself. */
function dialogDefects(
  node: JxElement,
  path: PopoverPath,
  targeted: ReadonlyMap<string, Set<string>>,
): DialogDefect[] {
  const out: DialogDefect[] = [];
  const label = labelOf(node, "the dialog");
  const id = idOf(node);
  const { style } = node;

  const closedby = literalAttr(node, "closedby");
  if (closedby !== null && !(DIALOG_CLOSEDBY as readonly string[]).includes(closedby)) {
    out.push({
      detail:
        "`closedby` is an enumerated attribute taking `any` (light dismiss and Escape), " +
        "`closerequest` (Escape only, the default for a modal) or `none`. Anything else is the " +
        `invalid-value default, \`auto\`, which is the same as leaving it out. ${DOCS}`,
      message: `${label} declares closedby="${closedby}", which is not any, closerequest or none.`,
      path,
      rule: "dialog-closedby-invalid",
      severity: "error",
    });
  }

  if (scalar(style, "display") !== null) {
    out.push({
      detail:
        "A closed dialog is hidden by the browser's own `dialog:not([open]) { display: none }`. " +
        "That rule is UA-origin, so any author `display` beats it, and the dialog is laid out on " +
        "every page whether or not anyone opened it. `display` belongs in the `&[open]` rule and " +
        `nowhere else. ${DOCS}`,
      fix: "display",
      message: `${label} sets display in its base rule.`,
      path,
      rule: "dialog-display",
      severity: "error",
    });
  }

  const commands = id === null ? undefined : targeted.get(id);
  const opened =
    literalAttr(node, "open") !== null || attrs(node).open === true || node.open === true;
  // Its own close button names it too, and closing is not opening.
  if (id !== null && !commands?.has("show-modal") && !opened) {
    out.push({
      detail:
        'No <button> in this document opens it with `command="show-modal"`. If it is opened from another ' +
        "file or from a function that calls `showModal()`, this is fine; otherwise there is no " +
        `way for a reader to open it. ${DOCS}`,
      message: `${label} has no invoker in this document.`,
      path,
      rule: "dialog-no-invoker",
      severity: "warn",
    });
  }

  if (commands?.has("show-modal") && closedby === "none" && !hasCloseControl(node, id)) {
    out.push({
      detail:
        "A modal dialog makes everything outside it inert, so the only ways out are the ones it " +
        'offers: `closedby="none"` turns off Escape and light dismiss, and nothing inside it ' +
        'closes it. A reader who opens it cannot leave. Add a <button command="close"> inside, or ' +
        `drop \`closedby="none"\`. ${DOCS}`,
      message: `${label} opens modally, closes on nothing, and has no close button.`,
      path,
      rule: "modal-without-close",
      severity: "error",
    });
  }
  return out;
}

export interface DialogDisplayRepair {
  /** Properties to delete from the dialog's BASE rule. */
  base: string[];
  /** The `display` value to write into `&[open]`, or null when it already declares one. */
  openDisplay: string | null;
}

/**
 * The style edit that repairs a `dialog-display` finding: the base `display` moves into the open
 * rule. Pure and returned as data, for the same reason `popoverDisplayRepair` is.
 *
 * @param style The dialog's own style object.
 * @returns The properties to remove from the base rule and the value to write into `&[open]`, or
 *   null when there is nothing to move.
 */
export function dialogDisplayRepair(style?: JxStyle): DialogDisplayRepair | null {
  if (!style) {
    return null;
  }
  const display = scalar(style, "display");
  if (display === null) {
    return null;
  }
  const existing =
    getNestedStyle(style, "&[open]") ??
    getNestedStyle(style, "[open]") ??
    getNestedStyle(style, "&:open") ??
    getNestedStyle(style, ":open");
  return { base: ["display"], openDisplay: scalar(existing, "display") !== null ? null : display };
}
