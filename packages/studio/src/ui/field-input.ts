/**
 * Field-input.ts — the draft layer every Studio text field is edited through.
 *
 * Each field is identified by a stable `key`. While a field is focused/edited, its in-progress text
 * lives in a per-key DRAFT, decoupled from the document, and the visible value is always
 * `getFieldValue(key, committed)` — so a render that slips through mid-edit never resets the field
 * to a stale value.
 *
 * Commit semantics (consistent across all panels): commit a short debounce after typing pauses (so
 * the canvas/preview updates live) AND immediately on blur or Enter (so the latest value is never
 * lost). The draft is cleared on blur/Enter, after which the field reflects the committed (possibly
 * normalized) document value again.
 *
 * The controls themselves are Jx documents, which read and write this layer through the panel that
 * draws them; pair it with the focus-aware panel scheduler (panels/panel-scheduler.ts), which keeps
 * the panel from re-rendering at all while a field is focused.
 */

interface DraftEntry {
  value: string;
  timer?: ReturnType<typeof setTimeout>;
}

/** Active per-field drafts, keyed by a stable field key. */
const _drafts = new Map<string, DraftEntry>();

/** The committed value to show for a field — the live draft while editing, else `committed`. */
export function getFieldValue(key: string, committed: string): string {
  const d = _drafts.get(key);
  return d ? d.value : committed;
}

/** Whether a draft is currently being edited for `key`. */
export function hasDraft(key: string): boolean {
  return _drafts.has(key);
}

/** Record the in-progress value for a field without committing it. */
export function setDraft(key: string, value: string): void {
  const d = _drafts.get(key);
  if (d) {
    d.value = value;
  } else {
    _drafts.set(key, { value });
  }
}

/** Discard a field's draft (and cancel any pending debounced commit). */
export function clearDraft(key: string): void {
  const d = _drafts.get(key);
  if (d?.timer) {
    clearTimeout(d.timer);
  }
  _drafts.delete(key);
}

/**
 * Schedule a debounced commit of the current draft, KEEPING the draft afterwards so the field stays
 * controlled by the in-progress text until the user blurs. The committed value flows to the
 * document (live preview) while the cursor/text stay untouched. Exported for unit testing.
 */
export function scheduleDraftCommit(key: string, ms: number, commit: (v: string) => void): void {
  const d = _drafts.get(key);
  if (!d) {
    return;
  }
  if (d.timer) {
    clearTimeout(d.timer);
  }
  d.timer = setTimeout(() => {
    const cur = _drafts.get(key);
    if (!cur) {
      return;
    }
    delete cur.timer;
    commit(cur.value);
  }, ms);
}

/**
 * Flush a field's draft immediately (blur/Enter): commit the latest value and clear the draft so
 * the field reflects the committed document value on the next render.
 */
export function commitField(key: string, commit: (v: string) => void): void {
  const d = _drafts.get(key);
  if (!d) {
    return;
  }
  if (d.timer) {
    clearTimeout(d.timer);
  }
  const { value } = d;
  _drafts.delete(key);
  commit(value);
}
