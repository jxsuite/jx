/**
 * `jx-select`'s sidecar: the two things a document body cannot say about a native `<select>`, and
 * nothing else. It never builds DOM — it writes state and it writes one DOM property — because the
 * document is what renders rows.
 *
 * SELECTEDNESS is the reason this file exists, and both obvious spellings are broken.
 *
 * The `selected` CONTENT ATTRIBUTE must never be written. Measured in Chrome 152 with real CDP
 * `ArrowDown` + `Enter` on the "Courier New" row, then a host write away and back to that same row:
 * the `selected` attribute is on the Courier option and `select.value` is `"Georgia, serif"`, the
 * FIRST row. The reader's own pick set that option's dirtiness flag, and from that moment the
 * attribute no longer moves selectedness — so the select falls to index 0. This is the `checked`
 * trap, confirmed on `<select>` with genuine input rather than with a synthetic event.
 *
 * The `value` PROPERTY binding alone is broken too, and for a different reason. Its effect runs
 * while the `<select>` is being built, BEFORE any `$map` has appended an option, so `select.value =
 * "system-ui"` is refused by the platform and silently leaves `""`. The effect then never re-runs,
 * because nothing it read changed: `@vue/reactivity` stops an equal write before `bindProperty`'s
 * own equal-write guard is even reached, and `renderMappedArrayInto` defers every re-render to a
 * microtask, so any effect reacting to the same data change runs before the options exist.
 *
 * What passes is the property binding PLUS this: a `MutationObserver` on the control, re-asserting
 * `sel.value` whenever the option list changes and only when the wanted value is actually among the
 * options and differs from what is there. Measured green on first paint (index 5), on the rows
 * being replaced and the row returning, on a real pick followed by a host write back to the picked
 * row, and on list churn while sitting on the row. Eight observer runs across five list mutations,
 * so it is not a hot path.
 *
 * The observer watches `data-value` as well as `childList`, and that half is this file's one
 * addition to the contract it implements. A host write to `value` mutates no option, so it produces
 * no childList record at all — and the stand-in row below is computed FROM that value, so a value
 * moving off a stood-in row onto a listed one left the stand-in in the list for the life of the
 * element. The document is what makes the write visible: the `<select>` binds `data-value` to
 * `state.value`, so the one attribute the observer filters on changes exactly when the answer does.
 * The alternative was a reactive effect, which would make this kit depend on the runtime's
 * reactivity library to learn something the document can simply say out loud.
 *
 * @docs extending/ui-kit
 */

/** A row as the element draws it. Only `value` and `label` are ever read here. */
interface UnlistedRow {
  value: string;
  label: string;
}

/** How many stems have been minted, so no two instances share one. */
let minted = 0;

/** The element's own native control. */
function controlOf(host: HTMLElement): HTMLSelectElement | null {
  return host.querySelector<HTMLSelectElement>('select[part="control"]');
}

/**
 * Whether the wanted value is held by a row the DOCUMENT listed.
 *
 * The stand-in row is excluded by its own `part`, and that exclusion is what stops the computation
 * below oscillating: were the synthesised option counted as listed, the next observer run would
 * find the value present, drop the row, find it absent again, and add it back for as long as the
 * element lived.
 */
function isListed(sel: HTMLSelectElement, want: string): boolean {
  return [...sel.options].some(
    (option) => option.getAttribute("part") !== "unlisted" && option.value === want,
  );
}

/**
 * Bring the control back into agreement with `state.value`: the stand-in row first, then
 * selectedness.
 *
 * Order matters. A value no group holds needs its row to EXIST before `sel.value` can be moved onto
 * it, and appending that row is itself a childList mutation, so the assignment lands on the
 * observer run the append provokes rather than on this one.
 *
 * **Selectedness is TOTAL and the stand-in row is not**, and the asymmetry is the whole of the
 * empty string's special case. A blank row labelled with a blank value would say nothing about what
 * is held, so `""` is never stood in for — but leaving the assignment out for the same value left
 * the element saying one thing and its control showing and SUBMITTING another. `<jx-select
 * label="Alignment" name="align">` with rows and no `value` measured `element ""` against `control
 * "start" index 0`, so an ordinary first paint shipped two answers to one question and a form got
 * the one the element had never been told to hold. When no option holds the wanted value the
 * control now holds no option, which is what "nothing here says that" looks like on a select.
 *
 * `sel.value` alone cannot tell those apart: it reads `""` both for a picked `""` row and for no
 * row at all, so the index is what discriminates.
 *
 * @param state The element's reactive scope.
 * @param sel The element's own `<select>`.
 */
export function syncSelect(state: Record<string, unknown>, sel: HTMLSelectElement): void {
  const want = String(state["value"] ?? "");
  const rows = (state["unlisted"] as UnlistedRow[] | undefined) ?? [];
  /* The empty string is a legal value — the inherit row — rather than absence, so it is never
     stood in for: a blank row labelled with a blank value would say nothing about what is held. */
  if (want !== "" && !isListed(sel, want)) {
    if (rows.length !== 1 || rows[0]?.value !== want) {
      state["unlisted"] = [{ label: want, value: want }];
    }
  } else if (rows.length > 0) {
    state["unlisted"] = [];
  }
  if ([...sel.options].some((option) => option.value === want)) {
    if (sel.value !== want || sel.selectedIndex < 0) {
      sel.value = want;
    }
  } else if (sel.selectedIndex >= 0) {
    sel.selectedIndex = -1;
  }
}

/**
 * Mint the element's id stem, then keep the control in step with `state.value` for as long as it
 * lives.
 *
 * A document cannot mint the stem: the closed operator set has no counter and no identity, and two
 * selects on one surface must not collide. This is the sidecar case specs/ui.md §3.2 sanctions.
 *
 * @param state The element's reactive scope, whose `uid` and `unlisted` this writes.
 * @param host The `jx-select` element.
 */
export function mountSelect(state: Record<string, unknown>, host: HTMLElement): void {
  minted += 1;
  state["uid"] = `jx-select-${minted}`;
  const sel = controlOf(host);
  if (!sel) {
    return;
  }
  syncSelect(state, sel);
  const observer = new MutationObserver(() => syncSelect(state, sel));
  observer.observe(sel, {
    attributeFilter: ["data-value"],
    attributes: true,
    childList: true,
    subtree: true,
  });
}

/*
 * THERE IS NO `onUnmount`, and its absence is the decision rather than the omission.
 *
 * The runtime initialises an element ONCE — `connectedCallback` returns early on `_jxInitialized` —
 * so a sidecar that disconnects its observer at `disconnectedCallback` can never be handed the
 * chance to install another. Moving an element to a different parent fires the remove steps and
 * then the insert steps, which means an ordinary re-parent (Studio does this) would bring the
 * element back rendering, reactive, and DEAF: its value would stop following its option list, in
 * silence, on an element that looks entirely alive.
 *
 * Nothing leaks by leaving it. The observer's only strong references are the registration on the
 * `<select>` and the closure over that same select and its scope, so the whole cycle is inside the
 * detached subtree and is collected with it; the observation is on the control rather than on the
 * document, so a detached element's mutations reach nothing else.
 */
