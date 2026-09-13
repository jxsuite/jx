/// <reference lib="dom" />
/**
 * Ai-model-picker.ts — the provider's model catalogue as one control, for every surface that
 * chooses a model.
 *
 * It was private to `panels/ai-chat/composer.ts`, which was correct while the chat composer was the
 * only place a model could be chosen. The New Project **Import** source now chooses one too — and
 * that run spends more tokens than any single chat turn — so the choice needed a second host. A
 * copy would have been two implementations of the invariant below, which is exactly the kind that
 * only breaks in the copy nobody looked at.
 *
 * **The list is never held privately.** It is read from `cachedModels(credentials)` on every
 * render, so a list can only ever be shown for the credentials it was listed under: change the key
 * and the catalogue becomes UNAVAILABLE rather than stale. Holding it in a closure is what once let
 * the picker offer one provider's models while another was configured.
 *
 * This module is the FLOW; `surfaces/ai-model-picker.json` is what it draws. `render()` hands back
 * the surface's own host element rather than a template, because both hosts are still lit templates
 * that interpolate the picker into a row of their own — see `surfaces/ai-model-picker.ts` for why
 * that element is the mount point and why re-rendering the row cannot disturb it.
 *
 * A closure factory (precedent: `createComposer`, `createAiCredentialsForm`) so two hosts never
 * share a loading flag or a failed-fetch record.
 *
 * @docs studio/ai
 * @license MIT
 */

import {
  aiConnection,
  cachedModels,
  fetchAvailableModels,
  modelToolSupport,
  preferredModel,
} from "../services/ai-models";
import { setModel } from "../services/ai-settings";
import { createModelPickerSurface } from "../surfaces/ai-model-picker";

import type { AiCredentials } from "../services/ai-models";
import type {
  ModelPickerRow,
  ModelPickerSurface,
  ModelPickerView,
  ModelPickerWidth,
} from "../surfaces/ai-model-picker";

/** The row value of the disabled placeholder shown during the first listing. */
export const LOADING_MODELS = "__loading__";

/** What a listed model's row says when the backend reported it cannot call tools. */
export const NO_TOOLS_SUFFIX = " — no tools";

/**
 * A model's row label: its name, plus a note when it is known to be chat-only.
 *
 * Labelled, never filtered or disabled. Choosing a chat-only model to ask questions of is a
 * legitimate thing to do, and a picker that hides half a managed catalogue would be reporting a
 * capability gap as an outage. Only `toolSupport === false` is labelled — `undefined` is a BYOK
 * provider saying nothing, and a suffix there would be an invention.
 */
function itemLabel(model: { id: string; name: string }): string {
  return modelToolSupport(model.id) === false ? `${model.name}${NO_TOOLS_SUFFIX}` : model.name;
}

export interface ModelPickerOptions {
  /** Host re-render scheduler — called whenever a fetch settles. */
  requestRender: () => void;
  /**
   * The model to show as selected. Defaults to the stored/proxy-preferred one, which is what the
   * chat composer wants; the Import form passes its own draft, which is not a stored setting until
   * the run starts.
   */
  getModel?: () => string;
  /**
   * Where a choice goes. Defaults to `setModel` (the roaming application preference). The Import
   * form passes its own setter, because choosing a model for one import must not silently retarget
   * the assistant.
   */
  onChange?: (id: string) => void;
  /**
   * Which of the surface's two shapes to draw. `"compact"` (the composer's) by default; the Import
   * form's field column asks for `"fill"`.
   *
   * This replaced a `className`. A document styles through `part` rather than through a class
   * (`ui.md` §3.1), so the two rules the hosts used to supply are one attribute the document
   * branches on — and a host can no longer reach in and restyle a control it does not own.
   */
  width?: ModelPickerWidth;
  /** Control size; `"sm"` (the composer's) by default. */
  size?: "sm" | "md";
}

export interface ModelPicker {
  /**
   * The picker's host element.
   *
   * A host interpolates it into its own lit template, which inserts a Node it is handed as-is.
   */
  render: () => HTMLElement;
  /** Whether a fetch is in flight — for a host that wants to disable a submit button. */
  isLoading: () => boolean;
  /** The last fetch's failure, or `""`. */
  error: () => string;
  /**
   * Whether the selected model is known NOT to support tools — for a host that wants to say so.
   *
   * `false` while the backend has no opinion, so a host reads it as "warn" rather than as "block".
   */
  selectedLacksTools: () => boolean;
}

/**
 * Create a model picker bound to a host's render scheduler.
 *
 * @param {ModelPickerOptions} opts
 * @returns {ModelPicker}
 */
export function createModelPicker(opts: ModelPickerOptions): ModelPicker {
  const getModel = opts.getModel ?? preferredModel;
  const onChange = opts.onChange ?? setModel;

  let loading = false;
  let failure = "";

  /**
   * The credentials the last fetch was made FOR, so a failure is not retried on every render.
   *
   * The list itself is deliberately not held here — see the module docblock.
   */
  let attempted: AiCredentials | null = null;

  /** Made on the first render, and kept for the life of the controller. */
  let surface: ModelPickerSurface | null = null;

  function sameConnection(a: AiCredentials | null, b: AiCredentials): boolean {
    return a !== null && a.apiKey === b.apiKey && a.baseUrl === b.baseUrl;
  }

  function ensureModels(force = false) {
    const credentials = aiConnection();
    const settled = cachedModels(credentials) !== null || sameConnection(attempted, credentials);
    if (loading || (settled && !force)) {
      return;
    }
    loading = true;
    failure = "";
    attempted = credentials;
    fetchAvailableModels({ credentials, force })
      .catch((error: unknown) => {
        failure = (error as Error).message || "Failed to fetch models";
      })
      .finally(() => {
        loading = false;
        opts.requestRender();
      });
  }

  /** List again, from the beginning: a refusal is forgotten so the same credentials are re-asked. */
  function retry() {
    attempted = null;
    ensureModels(true);
    opts.requestRender();
  }

  function choose(value: string) {
    /* The placeholder is disabled, so a reader cannot land on it; a host driving the control
       directly still can, and a state is not a model. */
    if (value && value !== LOADING_MODELS) {
      onChange(value);
    }
  }

  /** The rows to offer — what the catalogue holds, plus the one state that is worth a row. */
  function rows(): ModelPickerRow[] {
    const current = getModel();
    const listed = cachedModels(aiConnection()) ?? [];
    /* A catalogue that does not contain the current model still has to show it selected — an
       unlisted id is the normal case for a self-hosted or newly released model. */
    const items = listed.some((m) => m.id === current)
      ? listed
      : [{ id: current, name: current }, ...listed];
    const offered: ModelPickerRow[] = items.map((m) => ({ label: itemLabel(m), value: m.id }));
    if (loading) {
      offered.push({ disabled: true, label: "Loading models…", value: LOADING_MODELS });
    }
    return offered;
  }

  /** What the picker says right now — the whole of what the surface is told. */
  function view(): ModelPickerView {
    return {
      failure,
      hint: failure ? `Couldn't load models: ${failure}` : "Model",
      options: rows(),
      size: opts.size ?? "sm",
      value: getModel(),
      width: opts.width ?? "compact",
    };
  }

  function render(): HTMLElement {
    ensureModels();
    if (surface) {
      surface.update(view());
    } else {
      surface = createModelPickerSurface(view(), { choose, retry });
    }
    return surface.host;
  }

  return {
    error: () => failure,
    isLoading: () => loading,
    render,
    selectedLacksTools: () => modelToolSupport(getModel()) === false,
  };
}
