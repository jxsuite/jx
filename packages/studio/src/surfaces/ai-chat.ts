/// <reference lib="dom" />
/**
 * The assistant, as a Jx document over the kit.
 *
 * This is the adapter. `panels/ai-panel.ts` keeps the assistant — which pane is showing, what the
 * chat state holds, how a tool call turned out, what a turn changed, which `Assistant:` records the
 * registry offers, what a send does — and hands this module one flat projection with no decisions
 * left in it: rows already keyed by message id, chips already told their outcome, commands already
 * resolved to a glyph, a label, a tooltip and whether they are refused.
 *
 * **Two islands, both through `onNodeCreated`** (specs/studio-ui-guidelines.md §9.4). Model output
 * is sanitized HTML, which no binding can express: the document renders `[part="md"]` and nothing
 * inside it, and this module fills it. The model picker is a surface of its own with a host element
 * it owns (`surfaces/ai-model-picker.ts`), so `[part="composer-picker"]` is where that host is
 * put.
 *
 * **The scroller is the adapter's, not the flow's.** Whether the reader is still at the newest
 * message is a fact about a box, not a decision — so `scrolled` is a scope entry this module adds
 * beside the flow's actions, and {@link AiChatSurface.pin} is how the flow says "a send just
 * landed; follow it". The import logs stick to their own newest line on the same terms.
 *
 * **The mount is never rebuilt for a repaint.** A projection only ASSIGNS to the standing scope,
 * which is what lets a token arrive mid-stream without taking the composer out from under a reader
 * who is typing into it — the whole reason the lit panel needed a frame loop that bypassed the
 * focus guard, and the reason this one needs no scheduler at all.
 *
 * @docs studio/ai/chat
 */

import { reactive } from "../reactivity";
import { trustedHtml } from "../services/trusted-types";
import { mountSurface, registerSurface } from "../ui/surface";
import aiChatDoc from "./ai-chat.json";
import type { JxElement, JxDocument } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("ai-chat", aiChatDoc as unknown as JxDocument);

/** How close (px) to the bottom of a scroller still counts as "following along". */
const STICK_THRESHOLD = 48;

/** The same question for an import log, which reports a line at a time into a much shorter box. */
const LOG_STICK_THRESHOLD = 24;

/**
 * One control that IS a command, already resolved.
 *
 * The flow asks the registry; the document draws what it is told. A command the registry does not
 * hold, or whose `when` is false, never becomes one of these — which is what keeps the panel a
 * rendering of the registry rather than a second place its capabilities are decided (§12.5).
 */
export interface ChatCommandView extends Record<string, unknown> {
  /** The reconcile key. The command id, because a button is drawn once per bar. */
  key: string;
  /** What `run` is given. */
  id: string;
  /** The kit glyph, by its name in the manifest. Empty for a text-only button. */
  icon: string;
  /** The accessible name. */
  label: string;
  /** The tooltip: the command's title, plus its chord or the sentence it requires. */
  hint: string;
  /** Visible text. Empty on an icon-only button. */
  text: string;
  /** Visible but refused: the tooltip already says why. */
  disabled: boolean;
}

/** One answer an `ask_user` card offers as a shortcut. */
export interface ChatAskOption extends Record<string, unknown> {
  key: string;
  label: string;
}

/** One line an import run has reported. */
export interface ChatLogLine extends Record<string, unknown> {
  key: string;
  phase: string;
  message: string;
}

/**
 * One tool call, as the transcript draws it.
 *
 * Every field is present on every chip whatever its `kind`, because a binding renders a value and a
 * `$switch` chooses on one: a chip that omitted `options` would leave the question case reading an
 * absent path.
 */
export interface ChatChipView extends Record<string, unknown> {
  /** The tool-call id — the reconcile key. */
  key: string;
  /** The tool's name, for a test and for the `data-tool` attribute. */
  tool: string;
  /** `chip` or `ask`: which of the two drawings this call gets. */
  kind: "chip" | "ask";
  /** `pending`, `unanswered`, `ok` or `failed`. Drawn as `data-outcome`. */
  outcome: string;
  /** The chip's name: the tool plus the path it was called with. */
  label: string;
  /** The chip's tooltip: the tool's own sentence where it has one. */
  hint: string;
  /** What the tool said about itself — its summary, or its error. */
  outcomeText: string;
  /** `shown` once the call has an outcome to report; `hidden` while it is still running. */
  outcomeState: string;
  /** The tick or the cross. */
  mark: string;
  /** An `ask_user` call's question. Empty on every other chip. */
  question: string;
  /** The sentence the question came with. */
  context: string;
  hasContext: boolean;
  /** `pending`, `unanswered`, `answered`, `failed` or `none` — which half of the card to draw. */
  askState: string;
  options: ChatAskOption[];
  /** What the reader replied, once they have. */
  answer: string;
  /** `run` when this call has an import to report, `none` otherwise. */
  importState: string;
  importOpen: boolean;
  importPhase: string;
  hasPhase: boolean;
  importMessage: string;
  /** How many lines the log holds, as text — a document has no `length` to ask. */
  importCount: string;
  /** `none`, `busy` or `progress`. */
  importSpinner: string;
  /** A determinate run's percentage, as text. */
  importProgress: string;
  importLog: ChatLogLine[];
}

/** One file a turn changed. */
export interface ChatChangeView extends Record<string, unknown> {
  key: string;
  path: string;
  /** The tool that wrote it, or the sentence saying why it did not. */
  note: string;
  ok: boolean;
  /** Written straight to disk, which undo cannot reach. */
  disk: boolean;
}

/** One attached-context chip on a user turn. */
export interface ChatContextChip extends Record<string, unknown> {
  key: string;
  label: string;
}

/** One line of the transcript. */
export interface ChatRowView extends Record<string, unknown> {
  /** The message id. The `$map` key, and what `restore` is given. */
  key: string;
  /** `user`, `assistant`, `streaming`, `typing` or `tool-error`. */
  kind: string;
  /** The row's text, for every kind that is text: the typed body, the live tail, the failure. */
  body: string;
  /** Sanitized model output for an `assistant` row. Filled into the island, never bound. */
  markdown: string;
  contextChips: ChatContextChip[];
  hasContextChips: boolean;
  chips: ChatChipView[];
  hasChips: boolean;
  /** `list` when the turn changed something, `none` otherwise. */
  changesState: string;
  changesSummary: string;
  /** Every recorded change went through a transaction, so Restore can honestly be offered. */
  canRestore: boolean;
  changes: ChatChangeView[];
}

/** One row of the chat history. */
export interface ChatSessionView extends Record<string, unknown> {
  /** The session id — the key, and what a row opens or deletes. */
  key: string;
  title: string;
  /** When it was last touched and how many messages it holds, in one sentence. */
  meta: string;
}

/** One chip the composer is carrying. */
export interface ChatComposerChip extends Record<string, unknown> {
  /** The chip's kind — one chip per kind, so the kind IS the identity. */
  key: string;
  label: string;
  /** The line this chip will embed into the message. */
  hint: string;
}

/** What the assistant is showing right now. Every field is a value the flow settled. */
export interface AiChatView {
  /** `chat` or `sessions`. */
  view: string;
  /** The open session's title, or the words a fresh chat is called. */
  title: string;
  /** The compact token count. */
  tokens: string;
  tokensHint: string;
  /** `normal` or `warn`. */
  tokensTone: string;
  /** `shown` once there is a count worth printing. */
  tokensState: string;
  streaming: boolean;
  /** The header's leading commands — History today. */
  headLead: ChatCommandView[];
  /** The header's trailing commands — New Chat today. */
  headTrail: ChatCommandView[];
  rows: ChatRowView[];
  /** `shown` when the transcript has nothing in it and nothing on the way. */
  emptyState: string;
  error: string;
  errorAdvice: string;
  hasAdvice: boolean;
  /** `shown` when there is a failure the reader has to see. */
  errorState: string;
  /** `assistant.retry`, projected. Empty when the registry does not offer it. */
  retry: ChatCommandView[];
  /** `shown` while no provider is connected. */
  setupState: string;
  sessions: ChatSessionView[];
  hasSessions: boolean;
  /** The sessions pane's own header commands — New Chat, the same record the chat header runs. */
  sessionCommands: ChatCommandView[];
  /** What is typed. */
  draft: string;
  placeholder: string;
  composerChips: ChatComposerChip[];
  hasComposerChips: boolean;
  /** `send` or `stop`. */
  sendState: string;
  sendLabel: string;
  sendDisabled: boolean;
  /** A sentence under the picker. */
  note: string;
  /** `shown` when {@link AiChatView.note} has anything in it. */
  noteState: string;
  /** Whether a turn is suspended on a question, so the composer is the answer field. */
  awaiting: boolean;
}

/** What a control can ask the flow to do. Read once, when the scope is made. */
export interface AiChatActions {
  /** Run a projected command by id. */
  run: (id: string) => void;
  openSession: (id: string) => void;
  deleteSession: (id: string) => void;
  /** An `ask_user` shortcut was chosen. */
  answer: (text: string) => void;
  /** "You decide". */
  skip: () => void;
  /** Undo everything one turn changed. Given the row's key, which is the message id. */
  restore: (key: string) => void;
  /** Take a chip off the composer, by its kind. */
  dropChip: (key: string) => void;
  /** Open the attach menu under the button that was pressed. */
  attach: (scope: JxScope, event: Event) => void;
  openSettings: () => void;
  /** The reader is typing. */
  edit: (text: string) => void;
  send: () => void;
  stop: () => void;
  /** The model picker's host is in the page; put its element in it. */
  pickerSlot: (host: HTMLElement) => void;
}

export interface AiChatSurface {
  /** Bring the standing document up to date. Assignment only; the mount is never rebuilt. */
  update: (view: AiChatView) => void;
  /** Follow the newest message again — a send landed, or a session opened. */
  pin: () => void;
  /** Put the caret in the composer. */
  focusComposer: () => void;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope the document reads: the view, the flow's actions, and the scroller's own handler. */
interface AiChatScope extends Record<string, unknown>, AiChatView, AiChatActions {
  scrolled: () => void;
}

/** Write a whole view into the scope. */
function project(scope: AiChatScope, view: AiChatView): void {
  scope.view = view.view;
  scope.title = view.title;
  scope.tokens = view.tokens;
  scope.tokensHint = view.tokensHint;
  scope.tokensTone = view.tokensTone;
  scope.tokensState = view.tokensState;
  scope.streaming = view.streaming;
  scope.headLead = view.headLead;
  scope.headTrail = view.headTrail;
  scope.rows = view.rows;
  scope.emptyState = view.emptyState;
  scope.error = view.error;
  scope.errorAdvice = view.errorAdvice;
  scope.hasAdvice = view.hasAdvice;
  scope.errorState = view.errorState;
  scope.retry = view.retry;
  scope.setupState = view.setupState;
  scope.sessions = view.sessions;
  scope.hasSessions = view.hasSessions;
  scope.sessionCommands = view.sessionCommands;
  scope.draft = view.draft;
  scope.placeholder = view.placeholder;
  scope.composerChips = view.composerChips;
  scope.hasComposerChips = view.hasComposerChips;
  scope.sendState = view.sendState;
  scope.sendLabel = view.sendLabel;
  scope.sendDisabled = view.sendDisabled;
  scope.note = view.note;
  scope.noteState = view.noteState;
  scope.awaiting = view.awaiting;
}

/** The empty view, so a scope exists before the flow has computed anything. */
export function emptyAiChatView(): AiChatView {
  return {
    awaiting: false,
    composerChips: [],
    draft: "",
    emptyState: "shown",
    error: "",
    errorAdvice: "",
    errorState: "hidden",
    hasAdvice: false,
    hasComposerChips: false,
    hasSessions: false,
    headLead: [],
    headTrail: [],
    note: "",
    noteState: "hidden",
    placeholder: "Ask the assistant… (Enter to send)",
    retry: [],
    rows: [],
    sendDisabled: true,
    sendLabel: "Send",
    sendState: "send",
    sessionCommands: [],
    sessions: [],
    setupState: "hidden",
    streaming: false,
    title: "New chat",
    tokens: "",
    tokensHint: "",
    tokensState: "hidden",
    tokensTone: "normal",
    view: "chat",
  };
}

/** The `part` a node's definition carries, or "" for a text node or an unmarked element. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/** The `$map` item a node was rendered inside, if it was rendered inside one. */
function mapItem(state: JxScope | undefined): Record<string, unknown> | null {
  const map = state?.["$map"] as { item?: unknown } | undefined;
  const item = map?.item;
  return item !== null && typeof item === "object" ? (item as Record<string, unknown>) : null;
}

/** A string field off a `$map` item, or "". */
function itemString(item: Record<string, unknown> | null, field: string): string {
  const value = item?.[field];
  return typeof value === "string" ? value : "";
}

/** Keep a scroller pinned to its newest line, unless the reader has scrolled away from it. */
function stick(element: HTMLElement, threshold: number): void {
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  if (distance <= threshold || element.scrollTop === 0) {
    element.scrollTop = element.scrollHeight;
  }
}

/**
 * Mount the assistant into `host` — the container `panels/chat-panel.ts` owns for the life of the
 * window.
 *
 * The host is CLEARED first: this document is the whole of what the assistant shows, and whatever
 * was in the container belongs to a render that is over.
 *
 * @param {HTMLElement} host The assistant's persistent container.
 * @param {AiChatView} view What to draw to begin with.
 * @param {AiChatActions} actions What each control does. Read once, when the scope is made.
 * @returns {AiChatSurface}
 */
export function mountAiChatSurface(
  host: HTMLElement,
  view: AiChatView,
  actions: AiChatActions,
): AiChatSurface {
  /** The transcript, once the document has rendered it. Announced through `onNodeCreated`. */
  let messagesEl: HTMLElement | null = null;
  /** The composer's textarea, for {@link AiChatSurface.focusComposer}. */
  let composerEl: HTMLElement | null = null;
  /** Whether the reader is still at the newest message. */
  let following = true;
  /** The markdown islands, by row key, with the markup each was last given. */
  const islands = new Map<string, { node: HTMLElement; html: string }>();
  /** The import logs, by chip key. */
  const logs = new Map<string, HTMLElement>();

  const scope = reactive<AiChatScope>({
    ...emptyAiChatView(),
    ...actions,
    scrolled: () => {
      if (messagesEl) {
        following =
          messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <
          STICK_THRESHOLD;
      }
    },
  }) as AiChatScope;
  project(scope, view);

  /**
   * Fill every island whose markup has moved, and drop the ones whose row has gone.
   *
   * `onNodeCreated` fires once per node, and a row that finishes streaming swaps its whole body
   * case — so creation covers the common path. This covers the rest, and it is also what prunes the
   * map: a transcript is cleared by `newChat` and replaced wholesale by `openSession`.
   */
  function syncIslands(): void {
    const live = new Set(scope.rows.map((row) => row.key));
    for (const [key, entry] of islands) {
      if (!live.has(key) || !entry.node.isConnected) {
        islands.delete(key);
      }
    }
    for (const row of scope.rows) {
      const entry = islands.get(row.key);
      if (entry && entry.html !== row.markdown) {
        fillIsland(entry.node, row.markdown);
        entry.html = row.markdown;
      }
    }
  }

  /**
   * Put sanitized model output into an island.
   *
   * `innerHTML` is the app's ONE injection sink, and `trustedHtml` is what stands in front of it:
   * `markdownToHtml` has already dropped raw HTML and `javascript:` URLs, and the policy ASSERTS
   * that it did rather than taking a comment's word for it. Under a Trusted Types enforcement the
   * value assigned here is a `TrustedHTML`; without one the same assertion has still run.
   */
  function fillIsland(node: HTMLElement, html: string): void {
    (node as unknown as { innerHTML: unknown }).innerHTML = trustedHtml(html);
  }

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  host.replaceChildren();
  /* Nothing is called on an element here, so the mount is all there is to wait for: the islands
     announce themselves through `onNodeCreated` as they are created, which is one
     `connectedCallback` EARLIER than awaiting the element would be (§1.1, "await the element"). */
  void mountSurface("ai-chat", scope, host, {
    onNodeCreated: (element, _path, def, state) => {
      const part = partOf(def);
      if (part === "" || !(element instanceof HTMLElement)) {
        return;
      }
      if (part === "messages") {
        messagesEl = element;
        return;
      }
      if (part === "composer-input") {
        composerEl = element;
        return;
      }
      if (part === "composer-picker") {
        actions.pickerSlot(element);
        return;
      }
      if (part === "md") {
        const key = itemString(mapItem(state), "key");
        const html = itemString(mapItem(state), "markdown");
        if (key) {
          fillIsland(element, html);
          islands.set(key, { html, node: element });
        }
        return;
      }
      if (part === "import-log") {
        const key = itemString(mapItem(state), "key");
        if (key) {
          logs.set(key, element);
        }
      }
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
    syncIslands();
    maintain();
  });

  /** Follow the newest line in the transcript and in every open import log. */
  function maintain(): void {
    if (messagesEl && following) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    for (const [key, node] of logs) {
      if (!node.isConnected) {
        logs.delete(key);
        continue;
      }
      stick(node, LOG_STICK_THRESHOLD);
    }
  }

  /* There is no `connected()` here, where `doc-header.ts` and `panel-stylebook-layers.ts` both
     have one. Those two mount into a node LIT repaints, so "is my root still where I put it" is a
     live question. The assistant's container is built once for the life of the window
     (`right-panel.ts`'s `_ensureContainers`) and nothing else ever writes into it, so the answer
     would be a constant — and a constant nobody reads is a second thing to keep in step. */
  return {
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
      islands.clear();
      logs.clear();
    },
    focusComposer: () => composerEl?.focus(),
    pin() {
      following = true;
    },
    update(next) {
      project(scope, next);
      /* The document's own bindings settle on a microtask, so the islands and the scroll positions
         are brought up on the next one — after the rows the runtime is about to reconcile exist. */
      queueMicrotask(() => {
        if (!disposed) {
          syncIslands();
          maintain();
        }
      });
    },
  };
}
