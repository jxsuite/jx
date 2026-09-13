/**
 * The field family's behaviour sidecar: focus and selection on `jx-textfield`'s inner native
 * control, the clear button's own three steps, and the id stems neither `jx-textfield` nor
 * `jx-field` may let two instances share. Each of them is something a document body cannot express
 * — it can neither move focus, nor dispatch from an element other than the one whose handler is
 * running, nor count.
 *
 * `jx-field` reaches into this module rather than shipping one of its own because the two elements
 * are one contract: the row names the control, the control names its own sentences, and a single
 * module is what keeps their two id stems provably distinct.
 *
 * @docs extending/ui-kit
 */

/** The element's own native control. */
function controlOf(host: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  return host.querySelector<HTMLInputElement | HTMLTextAreaElement>('[part="input"]');
}

/**
 * Focus the field and select its value: all of it, the stem before the last dot (a filename with
 * its extension left alone), or nothing.
 *
 * @param host The `jx-textfield` element.
 * @param mode What to select once focused.
 */
export function selectValue(host: HTMLElement, mode: "all" | "stem" | "none" = "all"): void {
  const control = controlOf(host);
  if (!control) {
    return;
  }
  control.focus();
  if (mode === "none") {
    return;
  }
  if (mode === "stem") {
    const dot = control.value.lastIndexOf(".");
    control.setSelectionRange(0, dot > 0 ? dot : control.value.length);
    return;
  }
  control.select();
}

/** Focus the field without touching its selection. */
export function focusField(host: HTMLElement): void {
  controlOf(host)?.focus();
}

/** The `jx-textfield` an event inside one came from. */
function hostOf(event: Event): HTMLElement | null {
  const target = event.currentTarget;
  return target instanceof Element ? target.closest<HTMLElement>("jx-textfield") : null;
}

/**
 * Empty a clearable field: write "" into its value, put focus back on the control the reader was
 * in, and say so with `input` and then `change`.
 *
 * Both events come from the ELEMENT rather than from the clear button, because every host reads
 * `e.target.value` and the button's own `value` is not the field's. The platform fires nothing for
 * a value the element wrote itself, so the pair is dispatched here.
 *
 * @param state The element's reactive scope, whose `value` this empties.
 * @param event The click on the clear button.
 */
export function clearField(state: Record<string, unknown>, event: Event): void {
  const host = hostOf(event);
  if (!host) {
    return;
  }
  state["value"] = "";
  focusField(host);
  host.dispatchEvent(new Event("input", { bubbles: true }));
  host.dispatchEvent(new Event("change", { bubbles: true }));
}

let minted = 0;

/**
 * Give the instance an id stem no other field in the document shares, so its error and help
 * sentences can carry ids the control names in `aria-describedby`.
 *
 * A document cannot mint one: the closed operator set has no counter and no identity, and two
 * fields on one surface must not collide. This is the sidecar case specs/ui.md §3.2 sanctions.
 *
 * @param state The element's reactive scope, whose `uid` this writes.
 */
export function mintFieldId(state: Record<string, unknown>): void {
  minted += 1;
  state["uid"] = `jx-tf-${minted}`;
}

let namedRows = 0;

/** Whether an element's DEFINITION says it can be named — that it observes `labelledby`. */
function observesNaming(el: Element): boolean {
  const def = customElements.get(el.localName) as
    | { observedAttributes?: readonly string[] }
    | undefined;
  return def?.observedAttributes?.includes("labelledby") === true;
}

/**
 * Give a `jx-field` an id stem, and hand that stem to the control slotted into it.
 *
 * This is the whole reason the row is an element rather than four classes. The four classes could
 * not name anything, so every call site hand-wrote an `id` on the label, a second one on the help
 * sentence, and `labelledby` and `describedby` on the control repeating both — four strings a
 * consumer had to keep in step, in a document where nothing checks that they are.
 *
 * The stem is written into `state.uid`, which the row's own `id` bindings read. The control is
 * named through PROPERTIES rather than through `aria-labelledby` written onto it: every kit control
 * observes `labelledby` and `describedby` and folds them into whatever else it has to say about
 * itself (`jx-textfield` puts its own error and help sentences in front of the row's), so writing
 * the ARIA attribute directly would silently overwrite that. A property write also needs no
 * mutation observer and no upgrade timing: set on an element the runtime has not initialised yet,
 * it is an own property, and `connectedCallback` reads own properties into state before it defines
 * its accessors.
 *
 * A control is named when its DEFINITION says it can be — `observedAttributes` carries
 * `labelledby`. A hyphen in the tag name says only that the element is custom, and the row would
 * then write a dead expando onto whatever a consumer slotted first, an inner `jx-field` included.
 * The definition is readable before the instance upgrades, so a control the runtime has not
 * initialised yet is still named; an element whose definition is not registered when the row mounts
 * is left alone, exactly as a native control is.
 *
 * A NATIVE control — a bare `<input>`, `<select>` or `<textarea>` — has no definition to ask, so
 * the same rule leaves it alone: a write would be a dead expando rather than a name. Give one its
 * own `aria-labelledby` pointing at the row's label, or wrap it in a kit element.
 *
 * `describedby` is written only when the help line HAS something in it — a sentence from
 * `description`, or an element slotted into `help`. A row with nothing to say would otherwise point
 * its control at an empty paragraph, which the class form never did and which `jx-textfield` would
 * carry as a dead trailing id in its merged list. The presence of a slotted help element is enough,
 * so a sentence whose text arrives later should be SLOTTED rather than passed as a `description`
 * that starts empty: the row reads the help line once, here.
 *
 * Both are read once, at mount, over the control slotted then. A control appended to the row
 * afterwards is neither placed in the control part nor named — see the `onMount` prop's own note.
 *
 * @param state The row's reactive scope, whose `uid` this writes.
 * @param host The `jx-field` element, whose slotted control this names.
 */
export function nameFieldControl(state: Record<string, unknown>, host: HTMLElement): void {
  namedRows += 1;
  const uid = `jx-field-${namedRows}`;
  state["uid"] = uid;

  /* The row's OWN parts, found among its children rather than by a descendant query. Both spellings
     return the same node for a rendered row — the row's own parts precede everything slotted, so
     nothing in the suite can tell them apart — but a `[part]` lookup that may descend is one
     refactor away from reaching into a nested row's parts. */
  const own = (name: string) => [...host.children].find((el) => el.getAttribute("part") === name);
  const control = own("control")?.firstElementChild;
  if (!control || !observesNaming(control)) {
    return;
  }
  const target = control as unknown as Record<string, unknown>;
  target["labelledby"] ||= `${uid}-label`;
  const help = own("help");
  if (help && (help.firstElementChild !== null || help.textContent !== "")) {
    target["describedby"] ||= `${uid}-help`;
  }
}
