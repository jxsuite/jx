/**
 * The Outline, mounted the way the Navigator mounts it.
 *
 * The panel's body is a Jx document now (`src/surfaces/panel-outline.json`), so a suite cannot
 * render a template and read the result: it mounts the surface into the `.panel-body` /
 * `.panel-content` pair the Navigator paints and waits for the runtime. Everything here is
 * addressed by `part`, `role` and `data-*` — there is no `.layer-row` any more, and the classes of
 * that name that survive in `styles/panels.css` are dead until the sweep takes them.
 *
 * Two things every caller has to know, and they are properties of the runtime rather than of this
 * fixture. A scope write is applied on a JOB, not synchronously, so an assertion about what a
 * gesture drew has to `await flush()` first. And a keyboard assertion needs the same wait for a
 * second reason: the panel answers a caret move the tree could not perform by scrolling, selecting
 * and repainting, and `jx-tree` takes the keyboard to the revealed row from its own sync once that
 * row is focusable — a step behind the projection that drew it.
 */
import { flush } from "./harness";
import { detachOutline, mountOutlinePanel } from "../src/panels/layers-panel";
import { initLayers } from "../src/ui/layers";
import { view } from "../src/view";

/** What the last {@link mountOutline} was given, so a test can assert the Navigator was asked. */
export interface OutlineMountLog {
  /** How many times the panel asked for drag-and-drop to be re-registered. */
  dnd: number;
  /** How many times it asked the Navigator for a whole repaint. */
  rerenders: number;
}

/**
 * Build the DOM the Navigator paints — a `.panel-body` holding the `.panel-content` lit owns — plus
 * the three overlay hosts `ui/layers.ts` renders menus and dialogs into.
 *
 * @param {boolean} [scroller] - Wrap the panel in a scrolling element, for the windowed suites
 * @returns {HTMLElement} The `.panel-body`, which is what `mountOutlinePanel` is handed
 */
export function outlineHost(scroller = false): HTMLElement {
  document.body.innerHTML = `
    ${scroller ? '<div id="scroller">' : ""}
      <div class="panel-body"><div class="panel-content"></div></div>
    ${scroller ? "</div>" : ""}
    <div id="layer-popover"></div>
    <div id="layer-modal"></div>
    <div id="layer-dialog"></div>
  `;
  initLayers();
  view._layersCollapsed = new Set();
  view.dndCleanups = [];
  return document.querySelector(".panel-body") as HTMLElement;
}

/**
 * Mount (or update) the Outline into `host` and let the document settle.
 *
 * The `rerender` it hands the panel is the Navigator's, and the Navigator's answer to it is another
 * `afterRender` — so it is this same call, which is what makes the scroll watch's repaint reach the
 * rows in a test the way it does in the app.
 */
export async function mountOutline(host: HTMLElement, log?: OutlineMountLog): Promise<HTMLElement> {
  mountOutlinePanel(
    {
      registerDnD: () => {
        if (log) {
          log.dnd += 1;
        }
      },
      rerender: () => {
        if (log) {
          log.rerenders += 1;
        }
        void mountOutline(host, log);
      },
    },
    host,
  );
  await flush(3);
  return host;
}

/** Take the Outline down and clear the document — every suite's `afterEach`. */
export function resetOutline(): void {
  detachOutline();
  document.body.innerHTML = "";
}

/**
 * One row by the `pathKey` it stands for, or null when the window does not hold it.
 *
 * `data-value` and not `data-path`: `jx-tree-item` mirrors its own `value` there, it is what the
 * drag island addresses a row by, and it is the detail of every event the row provokes — so a
 * second attribute saying the same thing would be two answers to "which row is this". The text
 * lines, which are not `jx-tree-item`s, carry it too for exactly the same reason.
 */
export function row(host: HTMLElement, key: string): HTMLElement | null {
  return (
    [...host.querySelectorAll<HTMLElement>('[part="row"]')].find(
      (el) => el.dataset.value === key,
    ) ?? null
  );
}

/** One row by key, or a failure naming the key rather than a null dereference. */
export function needRow(host: HTMLElement, key: string): HTMLElement {
  const found = row(host, key);
  if (!found) {
    throw new Error(`no Outline row for "${key}"`);
  }
  return found;
}

/** Every `jx-tree-item` in the window, in visual order — the rows the caret walks. */
export function treeItems(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[part="row"][role="treeitem"]')];
}

/** Every row the window drew, tree items and text-node lines alike. */
export function allRows(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[part="row"]')];
}

/** The tree element itself. */
export function tree(host: HTMLElement): HTMLElement {
  return host.querySelector('[part="tree"]') as HTMLElement;
}

/** What a row's badge or label says. */
export function textOf(el: HTMLElement, part: string): string {
  return el.querySelector(`[part="${part}"]`)?.textContent?.trim() ?? "";
}

/**
 * The row's verb buttons, keyed by command id.
 *
 * By `data-command` rather than by title, because the title is the record's own tooltip — its chord
 * when it can act, its `requires` sentence when it cannot — and the surface is not allowed to know
 * either string.
 */
export function rowActions(el: HTMLElement): Record<string, HTMLElement> {
  const out: Record<string, HTMLElement> = {};
  for (const button of el.querySelectorAll<HTMLElement>('[part="action"][data-command]')) {
    out[button.dataset.command ?? ""] = button;
  }
  return out;
}

/** The `<button part="control">` a kit action button puts the disabled state and the tooltip on. */
export function control(button: HTMLElement): HTMLElement {
  return button.querySelector('[part="control"]') as HTMLElement;
}

/** Whether the row's button for `id` is present but refusing — ONE shape: disabled, not removed. */
export function isRefusing(actions: Record<string, HTMLElement>, id: string): boolean {
  const button = actions[id];
  if (!button) {
    throw new Error(`row action not rendered: ${id}`);
  }
  return control(button).hasAttribute("disabled");
}

/** Press a key on a row, the way a reader on that row does. */
export function press(el: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init }));
}

/** Click a row, with whichever selection modifiers the gesture carries. */
export function click(el: HTMLElement, init: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
}

/** Move the pointer onto a row — `mouseenter`, which is bound per row and does not bubble. */
export function hover(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent("mouseenter"));
}
