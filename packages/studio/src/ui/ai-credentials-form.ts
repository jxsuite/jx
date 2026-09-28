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
 * whether there is anything to Save or Cancel; the surface renders those and reports what the
 * reader did. `render()` hands back the surface's own host element rather than a template, because
 * every gate is still a lit template that interpolates the form beside the keyless offer — see
 * `surfaces/ai-credentials-form.ts` for why that element is the mount point and why re-rendering
 * the gate cannot disturb it.
 *
 * @docs studio/ai
 * @license MIT
 */

import { fetchAvailableModels, proxyModelsErrorMessage } from "../services/ai-models";
import {
  aiProviderDiffers,
  getBaseUrl,
  getOpenAiKey,
  saveAiProvider,
  storedEquals,
  storedModel,
} from "../services/ai-settings";
import { SETTINGS } from "../services/settings/definitions";
import type { AiProvider } from "../services/ai-settings";
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
  /**
   * Called when Cancel puts the drafts back to what is stored (Cancel is only offered while they
   * differ from it).
   */
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

  /**
   * What the store held when the drafts last agreed with it — the answer to "has the reader touched
   * this field?". A draft still equal to its basis is a VIEW of the store, not an edit, so
   * {@link followStore} may move it; one that differs is the reader's and nothing but a Save or a
   * Cancel replaces it. Starts blank because the drafts do, which is what lets a host that never
   * calls `startEdit` still open on what is stored.
   */
  let basis: AiProvider = { apiKey: "", baseUrl: "", model: "" };

  /** Made on the first render, and kept for the life of the controller. */
  let surface: AiCredentialsSurface | null = null;

  /**
   * What is stored, in the shape the drafts take.
   *
   * The model comes from {@link storedModel} rather than `getModel()`, so a user who has never
   * picked one drafts an empty field instead of the `"gpt-4o"` default. Saving a prefilled default
   * writes a choice nobody made, and `jx.ai.model: "gpt-4o"` is exactly what a broken install was
   * left holding.
   */
  function stored(): AiProvider {
    return { apiKey: getOpenAiKey(), baseUrl: getBaseUrl(), model: storedModel() };
  }

  /** Load the drafts from what is stored, discarding any edit, and take that as the new basis. */
  function loadDrafts() {
    basis = stored();
    keyDraft = basis.apiKey;
    baseUrlDraft = basis.baseUrl;
    modelDraft = basis.model;
  }

  /**
   * Bring every untouched draft up to what is stored now, and keep every edited one.
   *
   * Without this a draft could drift from the store with nobody having typed, and a form that
   * offers Save and Cancel only while it differs would offer them for an edit nobody made. Two
   * hosts did exactly that: the New Project gates never call `startEdit`, so their drafts began
   * blank over a stored endpoint or model — and Save then overwrote both with nothing — and a
   * Disconnect in Preferences › Accounts left the Assistant form holding the key it had just
   * revoked, which its Save would have stored again. Run from {@link render}, the host's repaint,
   * and never from a setter, so a keystroke is never rebased onto the store under the reader.
   *
   * **"Untouched" is judged by the same rule as `dirty`**, through the store's own normalisation,
   * because the two questions have to agree. Raw string equality made a draft that differed only by
   * whitespace, or by an endpoint's trailing slash, TOUCHED here and not-dirty there: no Save and
   * no Cancel were drawn, so nothing could reset it, and yet this function refused to move it — so
   * a Disconnect in Accounts left the revoked key sitting in the field, and once the store was
   * empty the form turned dirty and offered to store it back. A draft Save would not move is a view
   * of the store, whatever it was typed as.
   */
  function followStore() {
    const now = stored();
    keyDraft = storedEquals(SETTINGS.aiOpenAiKey, keyDraft, basis.apiKey) ? now.apiKey : keyDraft;
    baseUrlDraft = storedEquals(SETTINGS.aiBaseUrl, baseUrlDraft, basis.baseUrl)
      ? now.baseUrl
      : baseUrlDraft;
    modelDraft = storedEquals(SETTINGS.aiModel, modelDraft, basis.model) ? now.model : modelDraft;
    basis = now;
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
   * stripped — rather than what was typed. And because the drafts then equal the store, the form is
   * no longer `dirty`: Save and Cancel go away, so a second press has nothing to land on.
   */
  function save() {
    saveAiProvider({ apiKey: keyDraft, baseUrl: baseUrlDraft, model: modelDraft });
    loadDrafts();
    modelsError = "";
    /* The fetched list stays: it was listed under exactly these credentials, and dropping it
       collapsed the model combobox back to a bare text field on every save. The module cache is
       dropped by ai-models' own settings subscription, so this form does not have to remember to. */
    opts.onSaved?.();
    opts.requestRender();
  }

  /**
   * Put the drafts back to what is stored. Only offered while they differ from it, so it always
   * abandons something — which is also why it takes itself away.
   */
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
      /*
       * A 200 from the proxy does not mean the UPSTREAM listing worked — handleModels answers with
       * defaults and `configured: true` even when the provider's /models route failed, so the list
       * fetch never throws for that case. Cloudflare Workers AI's OpenAI-compatible surface has no
       * /models route at all, so this is the only way that failure ever reaches the form; without
       * it, the field silently filled with OpenAI's default ids instead of the user's own models.
       */
      const upstreamMessage = proxyModelsErrorMessage();
      if (upstreamMessage) {
        modelsError = `${upstreamMessage} — type the model ID directly instead.`;
      }
    } catch (error: unknown) {
      modelsError = (error as Error).message || "Failed to fetch models";
    } finally {
      modelsLoading = false;
      opts.requestRender();
    }
  }

  /**
   * The catalogue as rows — the list the combobox will draw, never a corpus it matches against. A
   * model with no name of its own is called by its id.
   */
  function rows(): CredentialsModelRow[] {
    return availableModels.map((model) => ({ label: model.name, value: model.id }));
  }

  /** What the form says right now — the whole of what the surface is told. */
  function view(): AiCredentialsView {
    return {
      baseUrlDraft,
      /* Compared as the store would hold each value, so what Save would erase — whitespace, an
         endpoint's trailing slash — is not an edit. See `aiProviderDiffers`. */
      dirty: aiProviderDiffers({ apiKey: keyDraft, baseUrl: baseUrlDraft, model: modelDraft }),
      fetchLabel: modelsLoading
        ? "Fetching…"
        : availableModels.length > 0
          ? "Refresh models"
          : "Fetch models",
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

  /**
   * Typed, picked from the catalogue, or committed — the combobox says all three through one value,
   * and the draft is the one place it lands.
   */
  function setModel(value: string) {
    modelDraft = value;
    surface?.update(view());
  }

  function setBaseUrl(value: string) {
    baseUrlDraft = value;
    surface?.update(view());
  }

  function render(): HTMLElement {
    followStore();
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
