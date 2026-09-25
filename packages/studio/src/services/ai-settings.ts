/// <reference lib="dom" />
/**
 * Ai-settings.js — the AI assistant's provider settings, over the settings kernel.
 *
 * The Stack B proxy reads the OpenAI key from the `X-Api-Key` header (falling back to the server's
 * `OPENAI_API_KEY` env var). Studio stores a user-supplied key so the browser/dev build works
 * without an env var. The key never leaves the machine except to the same-origin proxy.
 *
 * This module is now a typed façade over `settings/kernel.ts` — the storage keys, defaults and
 * normalisation live in `settings/definitions.ts`, and the kernel owns the cache, the write queue
 * and change notification. What it keeps is the vocabulary: callers say `getOpenAiKey()`, not
 * `readSetting(SETTINGS.aiOpenAiKey)`.
 *
 * **Blank no longer deletes.** `setOpenAiKey("")` stores an empty string; {@link clearAiProvider}
 * is the revoke path. The old conflation read as a convenience right up until a form that blanked
 * its own drafts on Save called these setters with them, and a second Save revoked the credentials
 * the first had stored.
 *
 * @license MIT
 */

import { SETTINGS } from "./settings/definitions";
import type { SettingDefinition } from "./settings/definitions";
import {
  clearSettings,
  hasSetting,
  normalizeSetting,
  readStoredSetting,
  setSetting,
  setSettings,
} from "./settings/kernel";

/** @returns {string} The stored OpenAI key, or "" if none. */
export function getOpenAiKey() {
  return readStoredSetting(SETTINGS.aiOpenAiKey);
}

/**
 * Persist the OpenAI key.
 *
 * @param {string} key - The key to store. A blank value stores blank; it does NOT clear — see
 *   {@link clearAiProvider}.
 */
export function setOpenAiKey(key: string) {
  setSetting(SETTINGS.aiOpenAiKey, key || "");
}

/** @returns {boolean} Whether a non-empty key is stored. */
export function hasOpenAiKey() {
  return hasSetting(SETTINGS.aiOpenAiKey);
}

/**
 * @returns {string} The OpenAI-compatible base URL override (e.g. a local LLM, OpenRouter, Azure),
 *   or "" to use the proxy's default (`https://api.openai.com/v1` / server `OPENAI_BASE_URL`).
 */
export function getBaseUrl() {
  return readStoredSetting(SETTINGS.aiBaseUrl);
}

// ─── Model selection ────────────────────────────────────────────────────────

/**
 * The model the user actually chose, with no default standing in for silence.
 *
 * The getter this replaced masked _unset_ as `"gpt-4o"`, which is right for a sender and wrong for
 * anything that writes back: a form prefilled from it and then saved persists a choice nobody made,
 * which is how `jx.ai.model: "gpt-4o"` came to be the only surviving key in a settings file whose
 * owner had configured a different provider entirely. Senders want
 * {@link ../services/ai-models!preferredModel} instead.
 *
 * @returns {string} The stored model ID, or "" when none has been chosen.
 */
export function storedModel() {
  return readStoredSetting(SETTINGS.aiModel);
}

/**
 * Persist the selected model ID.
 *
 * @param {string} modelId - The model ID to store. A blank value stores blank; it does NOT clear.
 */
export function setModel(modelId: string) {
  setSetting(SETTINGS.aiModel, modelId || "");
}

/** The provider's three values together — what a credentials form drafts and what Save stores. */
export interface AiProvider {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Store the provider's key, endpoint and model as ONE change.
 *
 * What a credentials form's Save should call. Three separate setters coalesce into one write
 * anyway, but they announce three times, and each intermediate announcement describes a provider
 * the user never asked for — a new key against the old endpoint, then against no model.
 *
 * @param {AiProvider} provider
 */
export function saveAiProvider(provider: AiProvider) {
  setSettings([
    [SETTINGS.aiOpenAiKey, provider.apiKey],
    [SETTINGS.aiBaseUrl, provider.baseUrl],
    [SETTINGS.aiModel, provider.model],
  ]);
}

/**
 * Whether {@link saveAiProvider} with these values would change what is stored.
 *
 * What a credentials form's Save and Cancel are drawn from: at rest there is nothing to keep and
 * nothing to abandon. Each value is compared as the store WOULD hold it — through its definition's
 * own `normalize` — so a pasted key's whitespace or an endpoint's trailing slash is not an edit,
 * because Save would store exactly what is already there. An absent setting reads as `""`, as every
 * getter here does, so a blank draft over nothing is no change either.
 *
 * **BOTH sides are normalised, not just the draft.** Only the setters normalise on the way in;
 * `hydrateSettings` and `adoptRemoteSettings` put a backend's or another window's values into the
 * cache as they found them, and a hand-edited `settings.json` carries whatever was typed. So the
 * store legitimately holds `http://localhost:11434/v1/` with the trailing slash the docs print, and
 * comparing a normalised draft against that raw value reported an edit nobody had made: Save and
 * Cancel appeared on a form at rest, and Cancel could not clear them, because reloading the drafts
 * loaded the same unnormalised value again. Normalising the stored side is the comparison the
 * sentence above always claimed to be making.
 *
 * @param {AiProvider} provider The drafts.
 * @returns {boolean} `true` when at least one of the three would move.
 */
export function aiProviderDiffers(provider: AiProvider): boolean {
  return (
    !storedEquals(SETTINGS.aiOpenAiKey, provider.apiKey, getOpenAiKey()) ||
    !storedEquals(SETTINGS.aiBaseUrl, provider.baseUrl, getBaseUrl()) ||
    !storedEquals(SETTINGS.aiModel, provider.model, storedModel())
  );
}

/**
 * Whether a draft and a stored value are the same setting, judged as the store would hold each.
 *
 * Exported because a form's "has the user touched this field?" has to ask the same question as
 * {@link aiProviderDiffers}, or the two disagree about a whitespace-only draft — which is how a
 * revoked key survived a Disconnect (`ui/ai-credentials-form.ts`).
 */
export function storedEquals(
  definition: SettingDefinition,
  draft: string,
  stored: string,
): boolean {
  return normalizeSetting(definition, draft) === normalizeSetting(definition, stored);
}

/**
 * Forget the provider entirely — key, endpoint and model.
 *
 * The one deletion path, and the one the Accounts list's Disconnect uses. Deliberately all three
 * together: a key with an orphaned endpoint is a state no surface knows how to describe.
 */
export function clearAiProvider() {
  clearSettings([SETTINGS.aiOpenAiKey, SETTINGS.aiBaseUrl, SETTINGS.aiModel]);
}
