/// <reference lib="dom" />
/**
 * Composer.ts — the sticky bottom chat input, as state and decisions.
 *
 * The draft, the attached-context chips, the attach menu and the model picker. Enter sends and
 * Shift+Enter opens a line; the button morphs into Stop while a turn is in flight. Closure factory
 * (precedent: createAiCredentialsForm) so draft state never leaks between hosts.
 *
 * **There is no markup here.** `surfaces/ai-chat.json` draws the composer and this module says what
 * it holds — which is what let the auto-grow go entirely: the textarea grows with
 * `field-sizing: content`, where this file used to write `scrollHeight` back into `style.height` on
 * every keystroke.
 *
 * **The draft is a controlled value now, and that is safe for the reason it was not before.** The
 * lit textarea had to be uncontrolled, because a streaming repaint re-rendered the whole panel and
 * would have clobbered the caret; a document's binding re-runs only when what it reads CHANGES, and
 * a write equal to what the field already says is skipped. So a token arriving mid-stream touches
 * one text node in the transcript and nothing at all down here.
 *
 * The attach menu is `surfaces/menu.ts`, the kit menu every other menu in Studio opens. It was an
 * `overlay-trigger` + `sp-popover` + `sp-menu` of its own, which is a second answer to a settled
 * question — and the one that did not get roving focus, typeahead or light dismissal.
 *
 * @license MIT
 */

import { displayTagName } from "@jxsuite/schema/guards";
import { getNodeAtPath } from "../../state";
import { createModelPicker } from "../../ui/ai-model-picker";
import { openMenu } from "../../surfaces/menu";
import { rectOf } from "../../utils/geometry";
import { activeTab } from "../../workspace/workspace";
import { primarySelection } from "../../tabs/selection";
import { buildMessageWithContext } from "./attached-context";
import type { ContextChip } from "./attached-context";
import type { ChatComposerChip } from "../../surfaces/ai-chat";
import type { MenuHandle } from "../../surfaces/menu";
import type { JxMutableNode } from "@jxsuite/schema/types";

export interface ComposerOptions {
  /** Receives the full message content (typed text + serialized context). */
  onSend: (text: string) => void;
  isStreaming: () => boolean;
  /**
   * Whether the turn is suspended on a question. The composer becomes the answer field: Enter still
   * sends, but the host routes it to the pending question instead of opening a new turn.
   *
   * Optional so the evals harness and tests that predate `ask_user` keep compiling.
   */
  isAwaiting?: () => boolean;
  /** Host re-projection scheduler — called whenever composer state changes. */
  requestRender: () => void;
}

/** What the composer contributes to the surface's projection. */
export interface ComposerView {
  draft: string;
  placeholder: string;
  composerChips: ChatComposerChip[];
  hasComposerChips: boolean;
  /** `send` or `stop`. */
  sendState: string;
  sendLabel: string;
  sendDisabled: boolean;
  note: string;
  noteState: string;
  awaiting: boolean;
}

export interface Composer {
  /** What the composer says right now, for the panel's projection. */
  view: () => ComposerView;
  /** The reader typed. */
  edit: (text: string) => void;
  /** Send what is typed, if anything is and nothing is already in flight. */
  send: () => void;
  clear: () => void;
  /** Open the attach menu under the button that was pressed. */
  openAttachMenu: (anchor: unknown) => void;
  /** Take a chip off, by its kind. */
  dropChip: (kind: string) => void;
  /** The model picker's host is in the page; put the picker's own element in it. */
  pickerSlot: (host: HTMLElement) => void;
  /**
   * Attach the canvas selection as a context chip, as the attach menu's second item does.
   *
   * `false` when nothing is selected, so a caller can say why nothing happened. This exists because
   * `assistant.attachSelection` (`panels/ai-panel.ts`) must reach the SAME chip the menu builds —
   * the attach convention is one delimiter and one `ContextChip` shape (`attached-context.ts`), and
   * a command that assembled its own line would be a second way to say "this element", diverging
   * the first time the label changes.
   */
  attachSelection: () => boolean;
}

/**
 * Create a composer instance bound to a host's projection scheduler.
 *
 * @param {ComposerOptions} opts
 * @returns {Composer}
 */
export function createComposer(opts: ComposerOptions): Composer {
  let draft = "";
  let chips: ContextChip[] = [];
  let menu: MenuHandle | null = null;
  /** The slot the document rendered for the picker, once it has. */
  let pickerHost: HTMLElement | null = null;

  /* The model picker is `ui/ai-model-picker.ts`, not forty lines here: the New Project Import
     source chooses a model too, and the "never hold the list privately" invariant is the kind that
     only breaks in the copy nobody looked at. */
  const modelPicker = createModelPicker({ requestRender: opts.requestRender });

  // ── Context attach ────────────────────────────────────────────────────

  /** Snapshot the current page / selected element into chip candidates. */
  function contextCandidates() {
    const tab = activeTab.value;
    const documentPath = tab?.documentPath || null;
    const selection = primarySelection(tab?.session.selection);
    let selectionChip: ContextChip | null = null;
    if (tab && selection) {
      /* No `tagName?: string` in this cast any more. It overrode the widened type — a tag may be
         a name or a choice between names — so the compiler could not see that this chip would
         render `[object Object]` for a chosen one. A cast that narrows a field back to what it
         used to be is a hole the type system cannot report. */
      const node = getNodeAtPath(tab.doc.document as JxMutableNode, selection) as
        | (JxMutableNode & { textContent?: string })
        | undefined;
      const tag = displayTagName(node?.tagName) || "element";
      const text = typeof node?.textContent === "string" ? node.textContent.slice(0, 40) : "";
      selectionChip = {
        detail: `Selected element at ${JSON.stringify(selection)}: <${tag}>${text ? ` "${text}"` : ""}`,
        kind: "selection",
        label: `<${tag}>`,
      };
    }
    return {
      pageChip: documentPath
        ? ({ detail: `Page: ${documentPath}`, kind: "page", label: documentPath } as ContextChip)
        : null,
      selectionChip,
    };
  }

  /** Add (or refresh) a chip of the given kind — one chip per kind. */
  function addChip(chip: ContextChip) {
    chips = [...chips.filter((c) => c.kind !== chip.kind), chip];
    opts.requestRender();
  }

  function dropChip(kind: string) {
    chips = chips.filter((c) => c.kind !== kind);
    opts.requestRender();
  }

  /** {@link Composer.attachSelection} — the attach menu's "Selected element" item, by name. */
  function attachSelection(): boolean {
    const { selectionChip } = contextCandidates();
    if (!selectionChip) {
      return false;
    }
    addChip(selectionChip);
    return true;
  }

  /**
   * The attach menu, under its own button. A second press closes it: the button is a toggle.
   *
   * `openMenu` rather than a popover of this module's own — the kit menu is the settled answer, and
   * it brings roving focus, typeahead, Escape and light dismissal with it.
   */
  function openAttachMenu(anchor: unknown): void {
    if (menu) {
      menu.close();
      menu = null;
      return;
    }
    const opener = anchor instanceof HTMLElement ? anchor : null;
    const { pageChip, selectionChip } = contextCandidates();
    menu = openMenu({
      label: "Attach context",
      onClosed: (handle) => {
        if (menu === handle) {
          menu = null;
        }
      },
      ...(opener ? { opener } : {}),
      ...(opener
        ? {
            place: () => {
              const box = rectOf(opener);
              return { x: box.left, y: box.top - 4 };
            },
          }
        : { origin: { x: 0, y: 0 } }),
      region: "assistant-attach",
      rows: [
        {
          destructive: false,
          disabled: pageChip === null,
          dividerAbove: false,
          id: "attach.page",
          requires: "a page open in this pane",
          run: () => {
            if (pageChip) {
              addChip(pageChip);
            }
          },
          title: pageChip ? `Current page — ${pageChip.label}` : "Current page",
        },
        {
          destructive: false,
          disabled: selectionChip === null,
          dividerAbove: false,
          id: "attach.selection",
          requires: "an element selected on the canvas",
          run: () => {
            if (selectionChip) {
              addChip(selectionChip);
            }
          },
          title: selectionChip ? `Selected element — ${selectionChip.label}` : "Selected element",
        },
      ],
    });
  }

  // ── Input ─────────────────────────────────────────────────────────────

  function edit(text: string) {
    const had = draft.trim().length > 0;
    draft = text;
    if (had !== draft.trim().length > 0) {
      // Only re-project on the empty↔non-empty flip: the send button is the only thing that moves,
      // And the field itself is bound to `draft`, which the document already has.
      opts.requestRender();
    }
  }

  function send() {
    if (!draft.trim() || opts.isStreaming()) {
      return;
    }
    const text = buildMessageWithContext(draft, chips);
    clear();
    opts.onSend(text);
    opts.requestRender();
  }

  function clear() {
    draft = "";
    chips = [];
  }

  /**
   * Bring the picker up to date and keep its host element in the slot.
   *
   * `createModelPicker().render()` is both the update and the element: it re-reads the catalogue
   * for the CURRENT credentials on every call, which is the invariant that stops one provider's
   * models being offered while another is configured. Re-appending a node already in place is a
   * no-op, so this costs nothing on a repaint.
   */
  function refreshPicker(): void {
    const element = modelPicker.render();
    if (pickerHost && element.parentNode !== pickerHost) {
      pickerHost.append(element);
    }
  }

  function view(): ComposerView {
    refreshPicker();
    const streaming = opts.isStreaming();
    const awaiting = opts.isAwaiting?.() ?? false;
    /* Said once, quietly, under the picker that caused it. A chat-only model still answers, so this
       is not a gate — but the agent loop it silently disables is the whole reason the panel exists,
       and nothing else on screen would have mentioned it. */
    const note = modelPicker.selectedLacksTools()
      ? "This model can't use editing tools — the assistant will answer but not edit."
      : "";
    return {
      awaiting,
      composerChips: chips.map((c) => ({ hint: c.detail, key: c.kind, label: c.label })),
      draft,
      hasComposerChips: chips.length > 0,
      note,
      noteState: note ? "shown" : "hidden",
      placeholder: awaiting
        ? "Answer the assistant… (Enter to reply)"
        : "Ask the assistant… (Enter to send)",
      sendDisabled: draft.trim().length === 0,
      sendLabel: awaiting ? "Answer" : "Send",
      sendState: streaming ? "stop" : "send",
    };
  }

  return {
    attachSelection,
    clear,
    dropChip,
    edit,
    openAttachMenu,
    pickerSlot: (host: HTMLElement) => {
      pickerHost = host;
      refreshPicker();
    },
    send,
    view,
  };
}
