/// <reference lib="dom" />
/**
 * Ai-credentials-form.ts — reusable AI provider credentials form (key / model / endpoint).
 *
 * Embedded by every host that needs a provider configured — **Preferences › Assistant** (⌘,) and the
 * New Project modal's Import/Agent gates. All draft/model-list state lives inside the closure, so
 * multiple instances never share state. Persists via src/services/ai-settings.ts on Save.
 *
 * The interim `Assistant: Settings…` dialog that used to host it is deleted: a provider key is an
 * application setting, and the surface that owns application settings is also the one that can list
 * it and revoke it (plan §9.3). Nothing about this form changed for the move, which is the argument
 * for it having been a reusable form rather than a section of a dialog.
 *
 * This module is the FLOW; `surfaces/ai-credentials-form.json` is what it draws. It keeps the three
 * drafts, decides which credentials a listing is sent with, what Save persists and re-reads, and
 * whether Cancel is on offer; the surface renders those and reports what the reader did. `render()`
 * hands back the surface's own host element rather than a template, because every gate is still a
 * lit template that interpolates the form beside the keyless offer — see
 * `surfaces/ai-credentials-form.ts` for why that element is the mount point and why re-rendering
 * the gate cannot disturb it.
 *
 * @docs studio/ai
 * @license MIT
 */

import { fetchAvailableModels } from "../services/ai-models";
import {
  getBaseUrl,
  getOpenAiKey,
  hasOpenAiKey,
  saveAiProvider,
  storedModel,
} from "../services/ai-settings";
import { createAiCredentialsSurface } from "../surfaces/ai-credentials-form";
import type {
  AiCredentialsSurface,
  AiCredentialsView,
  CredentialsModelRow,
} from "../surfaces/ai-credentials-form";

/** The blurb a host that says nothing gets. */
const DEFAULT_INTRO =
  "Any OpenAI-compatible key works. Stored locally in this browser; sent only to the Studio proxy (never to a third party except your chosen endpoint).";

export interface AiCredentialsFormOptions {
  /** Host re-render scheduler — called whenever the form's internal state changes. */
  requestRender: () => void;
  /** Called after Save persists the credentials. */
  onSaved?: () => void;
  /** Called when Cancel dismisses the form (Cancel is only offered when a key already exists). */
  onCancel?: () => void;
  /**
   * Optional context line replacing the default blurb.
   *
   * A string, not a template: the line is drawn by a document, and a document renders text rather
   * than somebody else's markup. Nothing that passed one ever passed more than a sentence.
   */
  intro?: string;
}

export interface AiCredentialsForm {
  /**
   * The form's host element.
   *
   * A gate interpolates it into its own lit template, which inserts a Node it is handed as-is.
   */
  render: () => HTMLElement;
  /** Preload drafts from the stored ai-settings and auto-fetch the model list. */
  startEdit: () => void;
}

/**
 * Create an AI credentials form instance bound to a host's render scheduler.
 *
 * @param {AiCredentialsFormOptions} opts
 * @returns {AiCredentialsForm}
 */
export function createAiCredentialsForm(opts: AiCredentialsFormOptions): AiCredentialsForm {
  let keyDraft = "";
  let baseUrlDraft = "";
  let modelDraft = "";

  /** Fetched from the proxy's /models endpoint (sibling of the chat endpoint). */
  let availableModels: { id: string; name: string }[] = [];
  let modelsLoading = false;
  let modelsError = "";

  /** Made on the first render, and kept for the life of the controller. */
  let surface: AiCredentialsSurface | null = null;

  /**
   * Load the drafts from what is stored.
   *
   * The model comes from {@link storedModel} rather than `getModel()`, so a user who has never
   * picked one drafts an empty field instead of the `"gpt-4o"` default. Saving a prefilled default
   * writes a choice nobody made, and `jx.ai.model: "gpt-4o"` is exactly what a broken install was
   * left holding.
   */
  function loadDrafts() {
    keyDraft = getOpenAiKey();
    baseUrlDraft = getBaseUrl();
    modelDraft = storedModel();
  }

  /** Open the form pre-filled with the current settings, and load the model list. */
  function startEdit() {
    loadDrafts();
    opts.requestRender();
    // Auto-fetch available models if not already loaded.
    if (availableModels.length === 0 && !modelsLoading) {
      void fetchModels();
    }
  }

  /**
   * Persist the drafted key + endpoint + model and notify the host.
   *
   * **Re-seeds the drafts; it must never blank them.** Preferences is a place rather than a wizard
   * step, so the sheet stays open across Save and `startEdit` is not called again — which meant
   * every field emptied the instant a save succeeded. That reads as "it didn't take", and the
   * obvious response to it destroyed the credentials: a blank draft is what
   * `setOpenAiKey`/`setBaseUrl` treat as _clear_, so pressing Save a second time on the emptied
   * form deleted the key and endpoint that the first press had just stored. Reading back through
   * the getters also shows what was actually kept — trimmed, and with the endpoint's trailing slash
   * stripped — rather than what was typed.
   */
  function save() {
    saveAiProvider({ apiKey: keyDraft, baseUrl: baseUrlDraft, model: modelDraft });
    loadDrafts();
    modelsError = "";
    /* The fetched list stays: it was listed under exactly these credentials, and dropping it
       collapsed the model list control back to a bare text field on every save. The module cache is
       dropped by ai-models' own settings subscription, so this form does not have to remember to. */
    opts.onSaved?.();
    opts.requestRender();
  }

  /** Dismiss the form without saving (only offered when a key already exists). */
  function cancel() {
    loadDrafts();
    modelsError = "";
    opts.onCancel?.();
    opts.requestRender();
  }

  /**
   * Fetch available models via src/services/ai-models.ts, preferring the in-form drafts over the
   * stored settings so the list reflects the credentials being edited. Always forces past the
   * module cache — this runs on explicit user action (or first open) with possibly-new drafts.
   *
   * Both lines below read draft-first. The key used to read stored-first, against this paragraph
   * and against the line beside it: editing a key in place and pressing Fetch models listed the OLD
   * key's models, and — worse — a form whose drafts had been blanked still fetched successfully
   * from storage, which is what made an emptied form look like it was working.
   */
  async function fetchModels() {
    modelsLoading = true;
    modelsError = "";
    opts.requestRender();
    try {
      availableModels = await fetchAvailableModels({
        credentials: {
          apiKey: keyDraft || getOpenAiKey(),
          baseUrl: baseUrlDraft || getBaseUrl(),
        },
        force: true,
      });
    } catch (error: unknown) {
      modelsError = (error as Error).message || "Failed to fetch models";
    } finally {
      modelsLoading = false;
      opts.requestRender();
    }
  }

  /** The catalogue as rows. A model with no name of its own is called by its id. */
  function rows(): CredentialsModelRow[] {
    return availableModels.map((model) => ({ label: model.name, value: model.id }));
  }

  /** What the form says right now — the whole of what the surface is told. */
  function view(): AiCredentialsView {
    return {
      baseUrlDraft,
      fetchLabel: modelsLoading
        ? "Fetching…"
        : availableModels.length > 0
          ? "Refresh models"
          : "Fetch models",
      haveKey: hasOpenAiKey(),
      intro: opts.intro ?? DEFAULT_INTRO,
      keyDraft,
      modelDraft,
      models: rows(),
      modelsError,
      modelsLoading,
    };
  }

  /**
   * What the reader typed, announced on the scope before anything else reads it.
   *
   * A document's binding writes only when the value it reads CHANGES (§9.3), so a draft the flow
   * decided without the raw text passing through would leave the field holding something the flow
   * does not have. Nothing rewrites a draft today; the echo is what makes a rewrite possible.
   */
  function setKey(value: string) {
    keyDraft = value;
    surface?.update(view());
  }

  function setModel(value: string) {
    modelDraft = value;
    surface?.update(view());
  }

  function setBaseUrl(value: string) {
    baseUrlDraft = value;
    surface?.update(view());
  }

  function render(): HTMLElement {
    if (surface) {
      surface.update(view());
    } else {
      surface = createAiCredentialsSurface(view(), {
        cancel,
        fetchModels: () => {
          void fetchModels();
        },
        save,
        setBaseUrl,
        setKey,
        setModel,
      });
    }
    return surface.host;
  }

  return { render, startEdit };
}
