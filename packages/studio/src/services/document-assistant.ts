/// <reference lib="dom" />
/**
 * Document-assistant.js — Stack B (canonical) document AI assistant session
 *
 * Wires the @jxsuite/ai infrastructure (chat-state, proxy streaming client, tool registry) to
 * the active Jx document via `transactDoc()`-backed tools, and drives the error-correction
 * agent loop. See specs/ai.md §3.
 *
 * @license MIT
 */

import { createChatState, createProxyStreamingClient, createToolRegistry } from "@jxsuite/ai";
import { createSessionFacts } from "@jxsuite/ai/tools";
import type { ProjectConfig } from "@jxsuite/schema/types";
import { getPlatform } from "../platform";
import { activeTab, workspace } from "../workspace/workspace";
import { shallowRef, toRaw } from "../reactivity";
import { projectState } from "../store";
import { adoptProjectConfig } from "../tabs/project-config";
import type { Tab } from "../tabs/tab";
import { componentRegistry } from "../files/components";
import { activeRegistry } from "../commands/active-registry";
import { registerAiTools } from "./ai-tools";
import { cancelAsk, registerAskTool, resetAsk } from "./ai-ask";
import {
  commandToolBlurbs,
  composeToolRegistries,
  createCommandToolRegistry,
} from "./ai-command-tools";
import { registerProjectTools } from "./ai-project-tools";
import { registerImportTools } from "./ai-import-tools";
import { createGatedToolRegistry } from "./gated-registry";
import type { ToolAvailability } from "./gated-registry";
import { adoptProject } from "./project-adoption";
import { abortImportRun, resetImportRuns } from "./import-run";
import { runAgentLoop } from "./tool-executor";
import { AI_TOOL_TIERS, buildSystemPrompt, toolActive } from "./ai-system-prompt";
import type { ExtensionCatalogSummary } from "./ai-system-prompt";
import { getBaseUrl, getOpenAiKey } from "./ai-settings";
import { preferredModel } from "./ai-models";
import { pruneOrphanToolMessages, trimContext } from "./context-manager";
import { renderCheck } from "./render-critic";
import { validateDoc } from "./jx-validate";
import { reloadFileInTab } from "../files/files";
import { getExtensionCatalog, refreshExtensionUi } from "../format/format-host";
import * as sessionStore from "./ai-session-store";
import { backfillToolResults, stripToolResults } from "./tool-outcomes";

/**
 * Project root scoping the session store, so conversations don't bleed across projects (the history
 * section of docs/studio/ai/chat.md). Falls back to a shared unscoped store when no project is
 * open.
 *
 * @returns {string}
 */
function projectRoot() {
  return workspace.projectRoot || "";
}

/**
 * Create a document-assistant session bound to the currently active tab.
 *
 * @returns {{
 *   chatState: ReturnType<typeof createChatState>;
 *   sendMessage: (text: string) => Promise<void>;
 *   stop: () => void;
 *   newChat: () => void;
 *   listSessions: () => import("./ai-session-store").SessionMeta[];
 *   openSession: (id: string) => void;
 *   deleteSession: (id: string) => void;
 *   activeSessionId: () => string | null;
 * }}
 */
export function createDocumentAssistant() {
  const chatState = createChatState({ model: preferredModel() });

  /** The persisted session backing the live chat; null = fresh unsaved chat. */
  let sessionId: string | null = null;
  /* What the conversation's tools remember across its turns (an import already ran): every call's
     `ctx.session`. New Chat starts over; a new session id keeps what the conversation knew. */
  let sessionFacts = createSessionFacts();

  const getProjectStyle = () =>
    (workspace.projectConfig as ProjectConfig | null)?.style as Record<string, string> | undefined;

  const findOpenTab = (path: string): Tab | null => {
    for (const tab of workspace.tabs.values()) {
      if (tab.documentPath === path) {
        return tab;
      }
    }
    return null;
  };

  const innerRegistry = createToolRegistry();
  // Ungated: a question is not a function of what happens to be open.
  /* A question suspends the turn on the author, for as long as they like, and the conversation is
     otherwise saved only when a turn starts and ends. Saving here is what lets a reload find the
     question to restore as open rather than losing the whole unfinished turn. */
  registerAskTool(innerRegistry, { onPending: () => persistChat() });
  registerAiTools(innerRegistry, {
    getTab: () => activeTab.value,
    saveFile: async (relPath: string, content: string) => {
      const plat = getPlatform();
      await plat.writeFile(relPath, content);
    },
    renderCheck: renderCheck as (
      doc: unknown,
    ) => Promise<{ ok: true } | { ok: false; error: string }>,
    getProjectStyle,
    findOpenTab,
    reloadTab: reloadFileInTab,
  });
  registerImportTools(innerRegistry, {
    adoptProject,
    getTab: () => activeTab.value,
    // Same re-keying as `create_project`: an import bootstraps a project, so the bootstrap
    // Conversation has to follow it out of the unscoped store.
    onProjectAdopted: (root: string) => {
      if (sessionId) {
        sessionStore.moveSession("", root, sessionId);
      }
    },
  });
  registerProjectTools(innerRegistry, {
    getTab: () => activeTab.value,
    renderCheck: renderCheck as (
      doc: unknown,
    ) => Promise<{ ok: true } | { ok: false; error: string }>,
    getProjectStyle,
    findOpenTab,
    reloadTab: reloadFileInTab,
    adoptProject,
    // Re-key the live chat from the unscoped store to the adopted project so the bootstrap
    // Conversation keeps persisting (saveSession drops writes for ids missing from the index).
    onProjectAdopted: (root: string) => {
      if (sessionId) {
        sessionStore.moveSession("", root, sessionId);
      }
    },
    onProjectConfigWritten: async (config: ProjectConfig, text: string) => {
      /* Into the configuration document, not beside it. This used to assign a fresh object to
         `projectState.projectConfig`, leaving the document holding the previous configuration —
         and the next settings commit wrote that stale document back over the assistant's file.
         `adoptProjectConfig` is the one door for a config that reached disk another way. The text
         goes with it: the document derives the file's layout record from the bytes the tool wrote,
         so the next settings commit is a one-line diff on the file as the model laid it out, not a
         re-layout of it with the record of the file it read before (issue 331). */
      await adoptProjectConfig(config, text);
      /* An `extensions` edit changes what the generated entry documents compose, and the backends
         regenerate them from project.json on demand — so without this the editor and the assistant
         both keep judging by the PREVIOUS project's schemas until the window reopens. */
      refreshExtensionUi(getPlatform());
    },
  });

  /*
   * Gate tool advertisement/execution on live studio state, derived from the same tier table the
   * system prompt renders — the model is never shown a tool it cannot execute. listForLLM() runs
   * every agent-loop round, so a mid-loop create_project unlocks the higher tiers immediately.
   */
  const TIER_REQUIREMENTS = {
    /* Never refused, so the sentence is unreachable — it exists because the map is derived from
       the tier union, and a tier without one would not compile. */
    always: "nothing",
    "no-project": "no project to be open (it bootstraps one)",
    project: "an open project",
    document: "an open document (use open_document first)",
    "document-tree":
      "an open document whose element tree the canvas is editing — Project Settings and the " +
      "grid editors are documents, but not trees to restructure, and a page left in Code view " +
      "returns to the canvas with set_canvas_mode",
  } as const;

  /**
   * The HUMAN's own gate, read rather than reimplemented.
   *
   * `Command.aiTool` promises "the human's gate and the agent's gate stay one predicate", and the
   * only way to keep that promise is for the agent to ask the same object: this is the
   * `CommandContext` `selection.delete` and the movers are evaluated against. Recomputing
   * `editor.kind` here would make two predicates that agree today and drift the first time either
   * is edited. Falls back to permissive when no registry is installed — the assistant runs in tests
   * that never build one, and refusing everything there would be a second wrong answer.
   */
  const treeEditable = () => {
    const registry = activeRegistry();
    // `=== "canvas"`, the human's exact test — not a looser cousin of it. Being more permissive for
    // The agent than for the person is the divergence this is here to remove.
    return registry ? registry.context().editor.kind === "canvas" : true;
  };
  const availability = new Map<string, ToolAvailability>(
    AI_TOOL_TIERS.map((t) => [
      t.name,
      {
        when: () =>
          toolActive(t, {
            /* The platform's own answer, read live rather than captured: the assistant is
               constructed at module load, before a platform is registered in some hosts. */
            canImport: Boolean(getPlatform().importSite),
            hasDocument: Boolean(activeTab.value),
            hasProject: Boolean(workspace.projectRoot),
            treeEditable: treeEditable(),
          }),
        requires:
          t.capability === "importSite"
            ? "a platform with a site-import backend"
            : TIER_REQUIREMENTS[t.tier],
      },
    ]),
  );
  /*
   * The other kind of tool: every command record that declares `aiTool`, as a VIEW over the active
   * registry (`services/ai-command-tools.ts`). Nothing is registered — the record IS the tool, its
   * `when` / `enablement` is the gate, `registry.run` is the executor — so `enable_extension`,
   * `delete_node` and the rest need no row in the tier table and no registrar here. The deps are
   * the write reporter's, the same three the hand tree tools take, because a bridged document write
   * is held to the same verdict (new schema errors, the render check, the token hints).
   */
  const commandTools = createCommandToolRegistry({
    getProjectStyle,
    getTab: () => activeTab.value,
    renderCheck: renderCheck as (
      doc: unknown,
    ) => Promise<{ ok: true } | { ok: false; error: string }>,
    validate: validateDoc,
  });
  const toolRegistry = composeToolRegistries(
    createGatedToolRegistry(innerRegistry, availability),
    commandTools,
  );

  let controller: AbortController | null = null;

  /**
   * Whether a turn is in flight: true from the moment a send is accepted until its loop has ended.
   *
   * Not the chat's `status`, which belongs to the token stream: it reads idle while a round's tools
   * run, while a question waits on the author and during an import. Guarding on it let a second
   * send start a second turn beside the first, and let the composer offer Send in the middle of
   * one. One window runs one turn, and this is the fact that says whether it is running.
   */
  const turnActive = shallowRef(false);

  /** Settles when the turn in flight has ended, finally included; already settled when none is. */
  let turnEnded: Promise<void> = Promise.resolve();

  function buildPrompt() {
    const tab = activeTab.value;
    const inventory = projectState
      ? [...projectState.dirs.values()]
          .flat()
          .filter((e) => e.type === "file")
          .map((e) => e.path)
      : undefined;
    /* The synchronous snapshot beside the async load, exactly as `getExtensions()` sits beside
       `loadExtensions()`: `buildSystemPrompt` is a pure function and this is called per turn, so
       the catalogue is read from the ONE cache the Extensions section also reads. Two caches would
       be two answers to "what can this project turn on". */
    const catalog: ExtensionCatalogSummary[] = [];
    for (const entry of getExtensionCatalog()) {
      catalog.push({
        name: entry.name,
        sections: entry.sections.map((section) => section.key),
        ...(entry.title === undefined ? {} : { title: entry.title }),
        ...(entry.description === undefined ? {} : { description: entry.description }),
      });
    }
    return buildSystemPrompt({
      document: tab ? toRaw(tab.doc.document) : undefined,
      projectConfig: (workspace.projectConfig as ProjectConfig | null) || undefined,
      components: componentRegistry.length > 0 ? componentRegistry : undefined,
      projectRoot: workspace.projectRoot || undefined,
      hasProject: Boolean(workspace.projectRoot),
      canImport: Boolean(getPlatform().importSite),
      /* The same reading the gate makes, so the prompt advertises exactly what `execute` will
         honour. This was never passed: with Project Settings focused the prompt listed the seven
         hand tree writers while the `document-tree` gate refused every one of them, and the model
         spent a round learning it. */
      treeEditable: treeEditable(),
      /* Read per turn from the live registry — a projected tool the gate will honour this round is
         listed this round, and one it will not is not. */
      commandTools: commandToolBlurbs(activeRegistry()),
      ...(inventory && inventory.length > 0 ? { fileInventory: inventory } : {}),
      ...(catalog.length > 0 ? { extensionCatalog: catalog } : {}),
    });
  }

  async function sendMessage(text: string) {
    if (!text.trim() || turnActive.value || chatState.status === "streaming") {
      return;
    }

    // Lazily create the backing session on the first message so empty "New Chat"
    // Clicks never pollute the session list.
    if (!sessionId) {
      sessionId = sessionStore.createSession(projectRoot(), text).id;
    }

    chatState.sendMessage(text);

    // Trim context before streaming to keep the conversation within token limits.
    const trimmed = trimContext(chatState, buildPrompt());
    if (trimmed) {
      chatState.setTokenCount(trimmed.estimatedTokens);
    }

    /* AFTER the trim, not before: the trim splices from the front and is itself one of the three
       ways a tool_calls request loses its reply (see pruneOrphanToolMessages). Repairing first
       would leave the very pair the trim then broke. */
    pruneOrphanToolMessages(chatState);

    // Persist after trimming so the saved history reflects what's actually sent.
    persistChat();

    /* Stop is armed before the send's first wait. The turn's signal used to be created after
       `await plat.aiChatUrl()`, which on desktop is an IPC round trip while the chat already reads
       as streaming: a Stop pressed in that window found no controller, so the turn went on to
       stream and run its tools, into a transcript the Stop had already cleared. The URL is now
       resolved inside the first request, on the armed signal. */
    controller = new AbortController();
    const { signal } = controller;
    turnActive.value = true;
    let settleTurnEnded!: () => void;
    turnEnded = new Promise<void>((settle) => {
      settleTurnEnded = settle;
    });
    try {
      const plat = getPlatform();
      // Re-read the persisted model each send: the session is constructed once at module load
      // (before the user sets a key/model), so the picker's choice must be picked up here.
      chatState.setModel(preferredModel());
      const streamingClient = createProxyStreamingClient({
        chatUrl: () => plat.aiChatUrl(),
        model: chatState.model,
        // Sent as X-Api-Key; the proxy falls back to the server's OPENAI_API_KEY when empty.
        apiKey: getOpenAiKey() || undefined,
        // Optional OpenAI-compatible endpoint override; empty uses the proxy default.
        baseUrl: getBaseUrl() || undefined,
      });

      if (sessionFacts.sessionId !== sessionId) {
        sessionFacts = createSessionFacts(sessionId, sessionFacts.toJSON());
      }
      await runAgentLoop({
        chatState,
        streamingClient,
        toolRegistry,
        systemPrompt: buildPrompt(),
        signal,
        session: sessionFacts,
        getTab: () => activeTab.value,
      });
    } catch (error) {
      /*
       * A failure outside the stream's own error frames: the platform not registered, or its chat
       * URL lookup rejecting inside the first request (a lookup that fails after a Stop ends the
       * stream as cancelled instead). Set the error so the panel can display it.
       */
      chatState.setError(error instanceof Error ? error.message : String(error));
    } finally {
      controller = null;
      turnActive.value = false;
      // Persist again once the stream settled so the completed reply (or the state
      // After an error/abort cleanup) survives a reload without another send.
      persistChat();
      settleTurnEnded();
    }
  }

  /** Whether a turn is in flight, tools and questions included. Reactive: read it in an effect. */
  function isTurnActive(): boolean {
    return turnActive.value;
  }

  /**
   * Resolves once the turn in flight, if any, has ended.
   *
   * Stop, New Chat and Open Session end a turn but cannot finish it: they abort its signal, and the
   * loop unwinds afterwards, at least a microtask later and as late as the call it was running
   * allows. Until then the window still holds that turn, so a send made in the meantime is refused.
   * A caller that means to start the next turn waits here first.
   */
  function whenTurnEnds(): Promise<void> {
    return turnEnded;
  }

  function stop() {
    controller?.abort();
    /* The abort settles an outstanding question through the turn signal, but only when the turn
       HAS one — the evals runner and several tests drive the loop without. Settling here as well
       is what makes Stop terminal in every case rather than in most of them. */
    cancelAsk();
    abortImportRun();
    chatState.cancelStream();
  }

  function newChat() {
    stop();
    resetAsk();
    resetImportRuns();
    sessionFacts = createSessionFacts();
    chatState.clearChat();
    sessionId = null;
    sessionStore.setActiveSession(projectRoot(), null);
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  /** The project's persisted sessions, most recently updated first. */
  function listSessions() {
    return sessionStore.listSessions(projectRoot());
  }

  /** Replace the live chat with a persisted session's messages. */
  function openSession(id: string) {
    const msgs = sessionStore.loadSession(projectRoot(), id);
    if (!msgs) {
      return;
    }
    stop();
    resetAsk();
    chatState.clearChat();
    pushRestoredMessages(msgs);
    sessionId = id;
    sessionStore.setActiveSession(projectRoot(), id);
  }

  /** Delete a persisted session; deleting the open one leaves a fresh unsaved chat. */
  function deleteSession(id: string) {
    sessionStore.deleteSession(projectRoot(), id);
    if (sessionId === id) {
      stop();
      resetAsk();
      chatState.clearChat();
      sessionId = null;
    }
  }

  function activeSessionId() {
    return sessionId;
  }

  // ── Persistence ───────────────────────────────────────────────────────

  /** Persist the live conversation into its backing session (non-blocking). */
  function persistChat() {
    if (!sessionId) {
      return;
    }
    // Skip a still-empty streaming placeholder so reloads don't restore blank bubbles.
    const msgs = chatState.messages.filter(
      (m) => m.role !== "assistant" || m.content || (m.toolCalls?.length ?? 0) > 0,
    );
    /* Without each call's `result`: the tool message that answers it is the outcome's one copy,
       and a restore reads it back from there (services/tool-outcomes.ts). */
    sessionStore.saveSession(projectRoot(), sessionId, stripToolResults(msgs));
  }

  /**
   * Push persisted messages into chat state, synthesizing ids where missing, with each tool call's
   * outcome backfilled from the tool message that answered it — so a restored chip shows how its
   * call ended, and an answered question shows its answer.
   */
  function pushRestoredMessages(msgs: sessionStore.PersistedMessage[]) {
    for (const m of backfillToolResults(msgs)) {
      chatState.messages.push({
        ...m,
        id: m.id || `restored_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      } as (typeof chatState.messages)[number]);
    }
  }

  /** Restore the last-active session once on creation, if any. */
  function restoreChat() {
    const root = projectRoot();
    const activeId = sessionStore.getActiveSessionId(root);
    if (!activeId) {
      return;
    }
    const msgs = sessionStore.loadSession(root, activeId);
    if (!msgs || msgs.length === 0) {
      return;
    }
    pushRestoredMessages(msgs);
    sessionId = activeId;
  }

  // Restore once on creation.
  restoreChat();

  return {
    chatState,
    isTurnActive,
    sendMessage,
    whenTurnEnds,
    stop,
    newChat,
    listSessions,
    openSession,
    deleteSession,
    activeSessionId,
  };
}
