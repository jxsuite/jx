/// <reference lib="dom" />
/**
 * Ai-panel.ts — AI assistant tab for the right panel (Stack B document assistant).
 *
 * The assistant over the reactive document-assistant session: a view-state machine (sessions list ↔
 * chat), the transcript, the sticky composer, and the six `Assistant:` records that are the only
 * definition of what it can do. It is a Jx document over the kit now
 * (`surfaces/ai-chat.json` + `surfaces/ai-chat.ts`); this module is the flow, and everything below
 * decides rather than draws.
 *
 * Credentials are NOT a state of this panel. A provider key is a roaming APPLICATION setting
 * configured once, so it lives in Preferences › Assistant (⌘,) — not in a dialog reachable only
 * from the panel that is broken for want of one. The panel with no key configured still opens on an
 * invitation to talk, with the way to fix it offered beneath. It re-projects when a credential is
 * saved or revoked by subscribing to `settings/preferences-accounts.ts`, which is a LEAF both
 * modules depend on rather than an import back into the sheet.
 *
 * **The frame loop is gone, and nothing replaced it.** This panel used to own a private
 * rAF-coalesced `litRender` that deliberately bypassed `panels/panel-scheduler.ts`'s focus guard,
 * because streaming had to repaint while the composer was focused and a whole-panel repaint would
 * otherwise have taken the caret. A document's bindings re-run per PROPERTY and skip a write equal
 * to what is already there, so a token arriving mid-stream touches one text node and reaches
 * nothing else — the composer is never re-rendered, so there is nothing to guard against and
 * nothing to coalesce. One `effect()` recomputes the projection; the surface follows.
 *
 * @docs studio/ai/chat
 * @license MIT
 */

import { effect, effectScope } from "../reactivity";
import { createDocumentAssistant } from "../services/document-assistant";
import { writesForTurn } from "../services/ai-writes";
import { notify } from "../services/notify";
import { undo } from "../tabs/transact";
import { activeTab } from "../workspace/workspace";
import { setOpenAiKey } from "../services/ai-settings";
import { hasAiCredentials } from "../services/ai-models";
import { answerAsk, isAwaitingAnswer, pendingAsk, skipAsk } from "../services/ai-ask";
import { activeImportRun, importRun } from "../services/import-run";
import type { ImportBrief } from "../services/import-seed";
import type { ImportBreakpointPolicy } from "../types";
import { openPreferences } from "../settings/preferences-dialog";
import { onCredentialsChanged } from "../settings/preferences-accounts";
import { setDockCollapsed } from "../shell";
import { hasSelection } from "../commands/context";
import { activeRegistry } from "../commands/active-registry";
import { clearMarkdownCache } from "./ai-chat/chat-markdown";
import {
  formatErrorAdvice,
  projectCommand,
  projectCommands,
  projectRows,
  tokenHint,
  tokenLabel,
} from "./ai-chat/chat-view";
import { createComposer } from "./ai-chat/composer";
import { projectSessions } from "./ai-chat/sessions-view";
import { buildMessageWithContext } from "./ai-chat/attached-context";
import { setInspectorTab } from "./right-panel";
import { emptyAiChatView, mountAiChatSurface } from "../surfaces/ai-chat";

import type { AiChatSurface, AiChatView } from "../surfaces/ai-chat";
import type { AnyCommand } from "../commands/registry";
import type { CommandContext } from "../commands/context";
import type { EffectScope } from "@vue/reactivity";

// ─── State (module-level, persists across tab switches) ─────────────────────

let mounted = false;

/** Which pane the panel shows. */
let view: "chat" | "sessions" = "chat";

/** Document AST assistant session — created lazily, persists across tab switches. */
const assistant = createDocumentAssistant();
(globalThis as Record<string, unknown>).assistant = assistant;
let assistantScope: EffectScope | null = null;

// ─── The surface ────────────────────────────────────────────────────────────

/** The mounted document, once the right panel has handed over its container. */
let surface: AiChatSurface | null = null;

/**
 * Mount the assistant into the container the Inspector owns, and subscribe to the state it draws.
 * Called once from the right panel's container setup; replaces the old render-host binding.
 *
 * `null` unbinds: the document is disposed and the watcher stopped, which is what `chat-panel.ts`'s
 * `unmount()` needs. It is the same seam rather than a second export, because a tear-down nothing
 * but a teardown reaches is a tear-down the reachability ledger has to carry.
 *
 * @param {HTMLElement | null} el
 */
export function bindAiPanelHost(el: HTMLElement | null) {
  assistantScope?.stop();
  assistantScope = null;
  surface?.dispose();
  surface = null;
  if (!el) {
    return;
  }
  surface = mountAiChatSurface(el, projectPanel(), {
    answer: (text) => {
      void handleAssistantSend(text);
    },
    attach: (_scope, event) => {
      composer.openAttachMenu(event.currentTarget);
    },
    deleteSession,
    dropChip: (kind) => composer.dropChip(kind),
    edit: (text) => composer.edit(text),
    openSession,
    openSettings: () => {
      void openPreferences("assistant");
    },
    pickerSlot: (host) => composer.pickerSlot(host),
    restore: handleRestore,
    run: runCommand,
    send: () => composer.send(),
    skip: () => {
      skipAsk();
      renderAiPanel();
    },
    stop,
  });
  watchAssistant();
}

/** Whether a projection is already queued for the end of this tick. */
let projectionQueued = false;

/**
 * Recompute the projection; the surface follows.
 *
 * **Coalesced on a microtask, for two reasons that are not about paint.** A turn writes several
 * reactive facts in one tick — the message, the status, the token count — and the transcript
 * projection is O(messages), so running it once per write would rebuild the whole list three times
 * for one event. And the write LEDGER (`services/ai-writes.ts`) is a plain array: `endTurn` files
 * it immediately after the assistant message lands, so a projection that ran synchronously inside
 * the effect would read the turn's changed-files summary one write too early, every time. The old
 * frame loop hid both by accident of deferral; this states them. Precedent: `panels/overlays.ts`,
 * §9.3's second scheduler.
 */
export function renderAiPanel(): void {
  if (projectionQueued || !surface) {
    return;
  }
  projectionQueued = true;
  queueMicrotask(() => {
    projectionQueued = false;
    surface?.update(projectPanel());
  });
}

/**
 * Run one of the panel's projected commands.
 *
 * Re-asked at click time, not trusted from the projection: state moves between the two, and
 * `registry.run` THROWS on a refusal. Same bargain `registry.handleKeyEvent` strikes for a chord
 * bound to a disabled command — swallow it here rather than make every surface wrap a dispatch in
 * try/catch.
 */
function runCommand(id: string): void {
  const registry = activeRegistry();
  if (registry?.isEnabled(id)) {
    void registry.run(id);
  }
}

/**
 * Reactively re-project on chat-state changes. Tracks the message count, the tail message's growth
 * (streaming deltas / tool calls), status, and errors.
 *
 * There is no coalescer under this and there does not need to be one: the projection is data, and
 * the runtime writes only the bindings whose value actually moved.
 */
function watchAssistant() {
  assistantScope?.stop();
  assistantScope = effectScope();
  assistantScope.run(() => {
    effect(() => {
      const cs = assistant.chatState;
      void cs.messages.length;
      const last = cs.messages.at(-1);
      void last?.content;
      void last?.toolCalls?.length;
      void cs.status;
      void cs.error;
      // The registry is composed AFTER the bootstrap mounts this, and it is a reactive holder —
      // Reading it here is what turns the header's skeleton into its real buttons.
      void activeRegistry();
      // The question is not chat state — it lives in `services/ai-ask.ts` — but it is drawn into
      // This panel, so the same effect has to track it or a question would appear a turn late
      // (and its ANSWER would never repaint the card at all).
      void pendingAsk();
      /* The run record, for the same reason: an import reports a line at a time from a store that
         is not chat state, and its chip has to follow every one of them. Reading the ACTIVE run
         tracks the whole record, so any field moving re-projects. */
      const run = activeImportRun();
      void run?.message;
      void run?.log.length;
      void run?.status;
      renderAiPanel();
    });
  });
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function mountAiPanel() {
  if (mounted) {
    return;
  }
  mounted = true;
  // A key saved (or revoked) in Preferences changes what this panel shows — the setup notice, and
  // Whether the composer can send. One subscription, and no import back into the sheet.
  onCredentialsChanged(renderAiPanel);
}

// ─── Sending ────────────────────────────────────────────────────────────────

/**
 * Send a message through the document assistant agent loop — or answer the question it is waiting
 * on, which is the same keystroke and a different act.
 *
 * The answer must NOT become a user message. `toMessagesArray` serialises the array verbatim and a
 * provider requires a `tool` reply to follow its `tool_calls` request; a user turn spliced between
 * them is a 400. It travels as the tool result instead, and the question's own card renders it.
 */
async function handleAssistantSend(text: string) {
  if (!text.trim() || assistant.chatState.status === "streaming") {
    return;
  }
  if (answerAsk(text.trim())) {
    surface?.pin();
    renderAiPanel();
    return;
  }
  // A send always lands in the chat view, pinned to the newest message.
  view = "chat";
  surface?.pin();
  renderAiPanel();
  try {
    await assistant.sendMessage(text);
  } catch {
    // Synchronous failure (e.g. network unreachable) — the DocumentAssistant's
    // Own try/catch calls chatState.setError(), which the watcher renders.
  }
}

/**
 * Re-send the last user message — §7.4's Retry.
 *
 * `chatState.retryLast()` pops the failed assistant turn AND the user message that caused it, on
 * the contract that the caller re-sends. It has been exported with zero callers since it was
 * written, so a failed turn's only recovery was retyping the prompt. Read the text before popping;
 * there is nowhere else it survives.
 */
async function handleRetry(): Promise<void> {
  const cs = assistant.chatState;
  const lastUser = cs.messages.toReversed().find((m) => m.role === "user");
  if (!lastUser) {
    return;
  }
  const { content } = lastUser;
  cs.retryLast();
  renderAiPanel();
  await handleAssistantSend(content);
}

/**
 * Undo everything one assistant turn changed — §7.4's "Restore to here".
 *
 * The loop opens one batch per turn per document, so undoing the turn is undoing that batch. The
 * button is offered by the projection only when every recorded change was transactional; this guard
 * is the second half of the same promise, because a ledger can be trimmed (MAX_TURNS) between the
 * projection and the click and a Restore that silently restored SOME of a turn would be worse than
 * one that refused.
 *
 * @param {string} messageId
 */
/* Exported so the guard can be exercised directly: the button is not DRAWN for a turn that touched
   disk, which would otherwise make the refusal path unreachable from the panel. */
export function handleRestore(messageId: string): void {
  const writes = writesForTurn(messageId);
  if (writes.length === 0) {
    notify.warn("There is no longer a record of what that turn changed.", { source: "Assistant" });
    return;
  }
  const disk = writes.filter((w) => w.disk).map((w) => w.path);
  if (disk.length > 0) {
    notify.warn(
      `Cannot restore: ${disk.join(", ")} ${disk.length === 1 ? "was" : "were"} written straight ` +
        "to disk, which undo cannot reach.",
      { source: "Assistant" },
    );
    return;
  }
  const tab = activeTab.value;
  if (!tab) {
    notify.warn("Open the document that turn edited to restore it.", { source: "Assistant" });
    return;
  }
  undo(tab);
  notify.success("Restored to before that turn.", { action: "edit.redo", source: "Assistant" });
  renderAiPanel();
}

/**
 * Seed the assistant with a prompt programmatically (e.g. the New Project flow handing off a
 * project brief). Delegates to the same send path as the composer. Safe to call right after the
 * Assistant tab renders — the reactive watcher projects chat-state into the panel whenever it
 * mounts.
 */
export async function seedAssistantPrompt(text: string): Promise<void> {
  await handleAssistantSend(text);
}

/**
 * Take the New Project Import form's brief and start the run as an assistant turn.
 *
 * The wizard closes without having created anything: `import_site` is `no-project` tiered and does
 * the creating, so the window is still on the welcome screen when this runs — which is exactly the
 * state the assistant is designed to be usable in (`specs/studio.md` §6).
 *
 * A fresh chat, deliberately. An import is the start of a project, and threading it onto whatever
 * conversation the previous project left behind would put another project's document context in
 * front of the model on its very first decision.
 *
 * The brief is already in `services/import-seed.ts` — the form that gathered it put it there, so
 * `import_site` can read the destination later whether or not this hand-off is what started it.
 *
 * @param {ImportBrief} brief
 */
export async function revealImportHandoff(brief: ImportBrief): Promise<void> {
  revealAssistant();
  newChat();
  await seedAssistantPrompt(buildImportTurn(brief));
}

/** The breakpoint policy in a sentence the model can act on rather than a JSON blob. */
function describeBreakpoints(policy: ImportBreakpointPolicy): string {
  if (policy.mode === "all") {
    return "keep every one the site declares";
  }
  if (policy.mode === "explicit") {
    return `${(policy.widths ?? []).join(", ")} (rounding ${policy.rounding ?? "nearest"})`;
  }
  return `keep ${policy.count ?? 3}, evenly spaced (rounding ${policy.rounding ?? "nearest"})`;
}

/**
 * The user message that opens an import turn.
 *
 * The parameters ride in an attached-context block — the composer's own convention for facts the
 * model must see but the reader should not have to re-read (`ai-chat/attached-context.ts`). The
 * body is the user's own brief, so the transcript reads as what they asked for rather than as a
 * form submission.
 *
 * @param {ImportBrief} brief
 * @returns {string}
 */
export function buildImportTurn(brief: ImportBrief): string {
  const body = brief.prompt.trim() || `Import ${brief.url} and get it ready for me to work on.`;
  return buildMessageWithContext(body, [
    {
      detail:
        `Import request from the New Project form — url: ${brief.url}, ` +
        `destination: ${brief.directory}, depth: ${brief.depth}, ` +
        `max pages: ${brief.maxPages}, AI component naming: ${brief.aiComponents}, ` +
        `breakpoints: ${describeBreakpoints(brief.breakpoints)}. ` +
        "Call import_site with the url; the destination and options above are already settled.",
      kind: "import",
      label: `Import ${brief.url}`,
    },
  ]);
}

// ─── Automation seeding (screenshot runner) ─────────────────────────────────

/** A canned tool-call chip for {@link seedAssistantMessages}. */
export interface SeededToolCall {
  name: string;
  /** JSON-encoded arguments, e.g. `{"path":["children",0],"text":"…"}`. */
  arguments: string;
}

/** A canned transcript entry for {@link seedAssistantMessages}. */
export interface SeededAssistantMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: SeededToolCall[];
}

let seededCount = 0;

/**
 * Automation-only seam (scripts/screenshots): stage a canned conversation without ever invoking a
 * model. Stores an inert demo key so the key gate opens (localStorage-only on the dev server — no
 * request fires), switches to the chat view, and pushes fully-formed messages straight into the
 * reactive chat state — the same path session restore uses — so the panel re-projects through its
 * normal watcher.
 */
export function seedAssistantMessages(messages: SeededAssistantMessage[]): void {
  setOpenAiKey("sk-demo");
  view = "chat";
  surface?.pin();
  for (const msg of messages) {
    seededCount += 1;
    const seq = seededCount;
    assistant.chatState.messages.push({
      content: msg.content,
      id: `seeded_${seq}`,
      role: msg.role,
      timestamp: seq,
      ...(msg.toolCalls
        ? {
            toolCalls: msg.toolCalls.map((tc, i) => ({
              arguments: tc.arguments,
              id: `seeded_${seq}_tc${i}`,
              name: tc.name,
            })),
          }
        : {}),
    });
  }
  renderAiPanel();
}

// ─── Controls ─────────────────────────────────────────────────────────────────

/**
 * Show the assistant: open the Inspector, then select its fourth tab.
 *
 * The two lines `view.setAssistant { open: true }` runs, in the module that owns the surface, so
 * the three callers that need them — that record, `chat-panel.ts`'s pending-prompt handoff, and
 * every `Assistant:` command below — do not each keep their own copy. `chat-panel.ts` had one
 * inline, and a reveal that opens the dock but forgets the tab (or the reverse) is a silent
 * half-success.
 */
export function revealAssistant(): void {
  setDockCollapsed("right", false);
  setInspectorTab("assistant");
}

/**
 * Whether a turn is suspended on the reader.
 *
 * Not the same as streaming and not the opposite of idle: no tokens are moving, but the loop is
 * alive and holding a tool open. `assistant.stop` is enabled on the union of the two, because a
 * turn waiting forever on a question nobody wants to answer is exactly what Stop is for.
 */
export function isAssistantWaiting(): boolean {
  return isAwaitingAnswer();
}

/**
 * Whether a turn is in flight — the probe `commands/live-context.ts` declares as `aiStreaming` and
 * projects onto `ctx.ai.streaming`.
 *
 * That source was declared optional with the note "there is nothing to read yet; the caller passes
 * a probe when one exists", and no caller ever did — so `ctx.ai.streaming` read `false` forever and
 * `assistant.stop` would have been permanently refused. Reading the reactive chat state here is
 * what makes the fact LIVE: `createLiveContext` builds a fresh record per predicate evaluation, so
 * a surface projecting from an effect tracks this status and re-projects when the stream starts or
 * ends.
 */
export function isAssistantStreaming(): boolean {
  return assistant.chatState.status === "streaming";
}

function stop() {
  assistant.stop();
}

function newChat() {
  assistant.newChat();
  clearMarkdownCache();
  view = "chat";
  surface?.pin();
  renderAiPanel();
}

function openSession(id: string) {
  assistant.openSession(id);
  clearMarkdownCache();
  view = "chat";
  surface?.pin();
  renderAiPanel();
}

function deleteSession(id: string) {
  assistant.deleteSession(id);
  renderAiPanel();
}

function showSessions() {
  view = "sessions";
  renderAiPanel();
}

/** The open session's title for the chat header (null → "New chat"). */
function activeSessionTitle(): string | null {
  const id = assistant.activeSessionId();
  if (!id) {
    return null;
  }
  return assistant.listSessions().find((s) => s.id === id)?.title ?? null;
}

// ─── Composer ───────────────────────────────────────────────────────────────

const composer = createComposer({
  isAwaiting: isAssistantWaiting,
  isStreaming: isAssistantStreaming,
  onSend: (text) => {
    void handleAssistantSend(text);
  },
  requestRender: renderAiPanel,
});

/**
 * Reveal the assistant, put it on the chat view, and place the caret in the composer.
 *
 * The focus rides a frame because the surface's own bindings settle asynchronously: revealing from
 * the sessions list means the textarea does not exist yet, and focusing a node that is about to be
 * inserted would leave the caret nowhere.
 */
function focusComposer(): void {
  revealAssistant();
  if (view !== "chat") {
    view = "chat";
    renderAiPanel();
  }
  requestAnimationFrame(() => {
    surface?.focusComposer();
  });
}

// ─── Projection ─────────────────────────────────────────────────────────────

/**
 * The whole panel, as data.
 *
 * Two header buttons and one Retry, each `projectCommand`ed rather than written out: the record is
 * the definition site and this is only where it is drawn. The glyph is the one thing decided here,
 * because a command record carries no icon and the rail's `PanelRecord.icon` is the only place in
 * Studio that does.
 */
function projectPanel(): AiChatView {
  const cs = assistant.chatState;
  const streaming = cs.status === "streaming";
  const error = !streaming && cs.error ? cs.error : "";
  const advice = error ? formatErrorAdvice(error) : "";
  const newChatCommand = projectCommand("assistant.newChat", { icon: "plus" });
  const rows = projectRows({
    ask: { importRun, pendingId: pendingAsk()?.id ?? null },
    messages: cs.messages,
    status: cs.status,
  });
  return {
    ...emptyAiChatView(),
    ...composer.view(),
    emptyState: rows.length === 0 && !streaming ? "shown" : "hidden",
    error,
    errorAdvice: advice,
    errorState: error ? "shown" : "hidden",
    hasAdvice: advice !== "",
    hasSessions: assistant.listSessions().length > 0,
    headLead: projectCommands([
      projectCommand("assistant.history", { icon: "clock-counter-clockwise" }),
    ]),
    headTrail: projectCommands([newChatCommand]),
    /* `assistant.retry`, not a closure. Its `enablement` reads `ctx.ai.configured`, so the one
       error this row cannot recover from — no provider connected, whose advice line above already
       says to add a key — draws the button disabled with that sentence rather than offering a send
       that will fail identically. */
    retry: projectCommands([projectCommand("assistant.retry", { text: "Retry" })]),
    rows,
    sessionCommands: projectCommands([
      newChatCommand ? { ...newChatCommand, text: "New Chat" } : null,
    ]),
    sessions: projectSessions(assistant.listSessions()),
    setupState: hasAiCredentials() ? "hidden" : "shown",
    streaming,
    title: activeSessionTitle() ?? "New chat",
    tokens: tokenLabel(cs.tokenCount),
    tokensHint: tokenHint(cs.tokenCount, cs.contextWarning),
    tokensState: cs.tokenCount > 0 ? "shown" : "hidden",
    tokensTone: cs.contextWarning ? "warn" : "normal",
    view,
  };
}

// ─── The `Assistant:` command family (§11.1) ────────────────────────────────

/**
 * Six records, beside the chat session they write.
 *
 * §11.1 pays for the chat column's demotion into an Inspector tab with a command family, and the
 * `Assistant` category — declared in `commands/levels.ts` since the taxonomy landed — held ZERO
 * records. Every capability below already existed and every one of them existed ONLY as a button in
 * this panel: not in the palette, not bindable, not reachable by `__jxAutomation` or by name, and
 * absent from the generated commands and shortcuts sheets. A capability that one surface can reach
 * and the registry cannot is the second definition site inverted.
 *
 * **All six are `level: "application"`, by principle 3 — a record is filed by the level of the
 * state it WRITES, not the state it reads.** The chat session is application state: it outlives the
 * open document, survives project close, and `assistant.attachSelection` is the case that proves
 * the rule — it READS the canvas selection and writes a chip into the composer, so it is
 * application, not selection, however selection-ish it looks. That is also why it may declare
 * `menus: ["palette"]` at all: `blockbar` and `context/element` admit selection-level records
 * only.
 *
 * **No `aiTool` on any of them.** The assistant projecting "start a new chat" into its own tool
 * list would let a turn end its own conversation; the tier tables in `services/ai-tools.ts` gate
 * what the agent may do TO A PROJECT, not to the chat it is running inside.
 */
export function assistantCommands(): AnyCommand[] {
  return [
    {
      category: "Assistant",
      id: "assistant.focus",
      level: "application",
      /* A sixth record, and it earns its place: `inspector.focus.assistant` (⌘⇧4) is DOCUMENT-level
         and refuses when nothing is open — which is exactly the state the assistant is most wanted
         in, because the panel deliberately renders with no project and no document. `view.setAssistant`
         is `menus: ["never"]`. Neither puts the caret anywhere, so neither answers "let me type".
         The title is distinct on purpose: two palette rows printing one sentence is the defect
         `tests/app-commands-composition.test.ts` refuses, and "Show Assistant" is already taken. */
      title: "Focus Composer",
      keybinding: "mod+shift+a",
      menus: ["palette"],
      group: "1_chat",
      run: focusComposer,
    },
    {
      category: "Assistant",
      id: "assistant.newChat",
      level: "application",
      title: "New Chat",
      menus: ["palette"],
      group: "1_chat",
      // No `enablement` on the stream: `newChat()` calls `stop()` first (see
      // `services/document-assistant.ts`), so starting one mid-turn is already the handled case.
      run: () => {
        revealAssistant();
        newChat();
      },
    },
    {
      category: "Assistant",
      id: "assistant.history",
      level: "application",
      title: "Chat History",
      menus: ["palette"],
      group: "1_chat",
      run: () => {
        revealAssistant();
        showSessions();
      },
    },
    {
      category: "Assistant",
      id: "assistant.attachSelection",
      level: "application",
      title: "Attach Selection",
      menus: ["palette"],
      group: "2_turn",
      requires: "an element selected on the canvas",
      // `hasSelection` is `commands/context.ts`'s shared predicate — the same one the element menu
      // And the structural verbs are gated on, so "a selection" means one thing in three menus.
      when: (ctx: CommandContext) => hasSelection(ctx),
      run: () => {
        if (!composer.attachSelection()) {
          // Reachable despite `when`: a script or the palette can race the selection away between
          // The predicate and the run, and a silent no-op would look like the chip had landed.
          notify.warn("Nothing is selected to attach.", { source: "Assistant" });
          return;
        }
        focusComposer();
      },
    },
    {
      category: "Assistant",
      id: "assistant.retry",
      level: "application",
      title: "Retry Last Message",
      menus: ["palette"],
      group: "2_turn",
      requires: "a connected AI provider, and no turn already in flight",
      /* `ctx.ai.configured` and `ctx.ai.streaming` have been declared in `commands/context.ts` with
         zero readers; this record and `assistant.stop` are the first. Re-sending with no provider
         connected reproduces the same failure the error row is already explaining, and re-sending
         mid-stream would interleave two turns. */
      enablement: (ctx: CommandContext) => ctx.ai.configured && !ctx.ai.streaming,
      run: () => {
        revealAssistant();
        void handleRetry();
      },
    },
    {
      category: "Assistant",
      id: "assistant.stop",
      level: "application",
      title: "Stop Responding",
      menus: ["palette"],
      group: "2_turn",
      requires: "a turn in flight",
      /* The union, not just `streaming`. A turn suspended on `ask_user` moves no tokens, so
         `ctx.ai.streaming` reads false — and that is precisely the turn a reader who does not want
         to answer needs to end. */
      enablement: (ctx: CommandContext) => ctx.ai.streaming || ctx.ai.waiting,
      run: stop,
    },
  ];
}
