/// <reference lib="dom" />
/**
 * Dynamic-slot — the per-field memory behind the Value Source ladder.
 *
 * A bindable document position may be produced in several ways — Fixed value / From data… / Mixed
 * text / Formula (`ui/value-source.ts` owns the vocabulary, and derives which rungs a position
 * permits from its schema). The surfaces that DRAW that ladder are Jx documents now; what lives
 * here is the state they share, so a field means the same thing wherever it is offered.
 *
 * Two pieces of memory, both per field and per session:
 *
 * - Each mode's last value, so switching back to an earlier mode restores what the user had there
 *   ({@link stashSlotValue} / {@link recallSlotValue}, and {@link switchSlotMode} over the pair).
 * - The rung a field is CURRENTLY being edited at ({@link effectiveSlotMode}), so typing `${` into a
 *   Fixed value field does not swap the widget out from under the cursor mid-keystroke.
 *
 * {@link slotModeSeed} is the third shared thing: the value a field takes when it arrives at a rung
 * with nothing remembered there. A second table of seeds is how a fresh binding ends up meaning two
 * different things in two panels.
 */

import { cloneValue } from "../tabs/doc-op-apply";
import { activeTab } from "../workspace/workspace";
import { slotMode } from "./value-source";

import type { JsonValue } from "../types";
import type { SlotMode } from "./value-source";

export type { SlotCapsSource, SlotMode, SlotPosition } from "./value-source";
export { slotCaps, slotMode } from "./value-source";

/*
 * Session memory of each field's last value per mode, so switching modes round-trips user input.
 * Keyed `${tabId}|${fieldKey}|${mode}`; the mode key is derived from the value at stash time, so a
 * restore always lands a value whose slotMode() matches the target mode. `undefined` is a
 * legitimate stash (cleared literal), hence Map.has() discrimination on recall.
 */
const slotModeMemory = new Map<string, JsonValue | undefined>();

/*
 * The rung each field is CURRENTLY being edited at, keyed `${tabId}|${fieldKey}`.
 *
 * Without this the rendered rung was re-sniffed from the document value on every render, so typing
 * `${` into a Fixed value field swapped the widget out from under the cursor mid-keystroke — and
 * typing the closing brace away swapped it back. A keystroke can only ever move a value between
 * the literal and mixed-text rungs (both are plain strings); every other transition needs a
 * structural change to the value, which a text edit cannot make. So those two rungs hold once
 * entered, and everything else still follows the document.
 */
const slotModeRendered = new Map<string, SlotMode>();

/** Test hook: drop all remembered per-mode field values and per-field rungs. */
export function resetSlotModeMemory(): void {
  slotModeMemory.clear();
  slotModeRendered.clear();
}

function memoryKey(fieldKey: string, mode: SlotMode): string {
  return `${activeTab.value?.id ?? "-"}|${fieldKey}|${mode}`;
}

function fieldScopeKey(fieldKey: string): string {
  return `${activeTab.value?.id ?? "-"}|${fieldKey}`;
}

/** Remember `value` as this field's representation at `mode`, for a later switch back. */
export function stashSlotValue(
  fieldKey: string,
  mode: SlotMode,
  value: JsonValue | undefined,
): void {
  slotModeMemory.set(memoryKey(fieldKey, mode), cloneValue(value));
}

/** Whether this field has a remembered representation at `mode`. */
export function hasStashedSlotValue(fieldKey: string, mode: SlotMode): boolean {
  return slotModeMemory.has(memoryKey(fieldKey, mode));
}

/** This field's remembered representation at `mode` (a fresh clone). */
export function recallSlotValue(fieldKey: string, mode: SlotMode): JsonValue | undefined {
  return cloneValue(slotModeMemory.get(memoryKey(fieldKey, mode)));
}

/** Record the rung the user just chose for this field, so the next render honours it. */
export function setSlotMode(fieldKey: string, mode: SlotMode): void {
  slotModeRendered.set(fieldScopeKey(fieldKey), mode);
}

/** Whether a keystroke alone could have produced this rung transition. */
function isTextEditRung(mode: SlotMode): boolean {
  return mode === "literal" || mode === "template";
}

/**
 * The rung to render this field at: the one it is already being edited at when a text edit could
 * explain the difference, otherwise whatever the document value says. Records its answer.
 */
export function effectiveSlotMode(fieldKey: string, value: unknown): SlotMode {
  const key = fieldScopeKey(fieldKey);
  const sniffed = slotMode(value);
  const previous = slotModeRendered.get(key);
  const mode =
    previous !== undefined && isTextEditRung(previous) && isTextEditRung(sniffed)
      ? previous
      : sniffed;
  slotModeRendered.set(key, mode);
  return mode;
}

/** One pointer the From data… rung may offer, as a picker option. */
export interface SignalOption {
  value: string;
  label: string;
}

/** Where a rung's seed value comes from — the subset of a slot's options that decides one. */
export interface SlotSeedSources {
  /** State keys the position may point at; the first is what a fresh binding lands on. */
  stateDefs: readonly string[];
  /** Extra pointers beyond `#/state/*` — route params, `$map/item`. */
  extraSignals?: readonly SignalOption[] | null;
  /** What Fixed value restores to. */
  literalDefault?: JsonValue | undefined;
}

/**
 * The value a field takes when it arrives at a rung with nothing remembered there.
 *
 * Exported because several surfaces offer the same rungs — the Inspector's property, style and
 * event ladders, and `ui/schema-form.ts` — and a second table of seeds is how a fresh binding ends
 * up meaning two different things in two panels.
 *
 * @param {SlotMode} mode
 * @param {SlotSeedSources} sources
 * @returns {JsonValue | undefined}
 */
export function slotModeSeed(mode: SlotMode, sources: SlotSeedSources): JsonValue | undefined {
  switch (mode) {
    case "ref": {
      const [first] = sources.stateDefs;
      return first
        ? { $ref: `#/state/${first}` }
        : { $ref: sources.extraSignals?.[0]?.value ?? "" };
    }
    case "template": {
      const [first] = sources.stateDefs;
      return first ? `\${state.${first}}` : "${}";
    }
    case "expression": {
      return { $expression: { operator: "??", target: null, value: null } };
    }
    case "function": {
      return { $prototype: "Function", body: "", parameters: [] };
    }
    default: {
      return sources.literalDefault;
    }
  }
}

/**
 * Switch a field to `next`: stash the outgoing representation, restore the incoming one if this
 * field has been there before, and record the new rung. Shared with the Events tab, which used to
 * throw the outgoing representation away on every mode change.
 */
export function switchSlotMode(
  fieldKey: string,
  from: SlotMode,
  to: SlotMode,
  current: JsonValue | undefined,
  seed: JsonValue | undefined,
): JsonValue | undefined {
  stashSlotValue(fieldKey, from, current);
  setSlotMode(fieldKey, to);
  return hasStashedSlotValue(fieldKey, to) ? recallSlotValue(fieldKey, to) : seed;
}
