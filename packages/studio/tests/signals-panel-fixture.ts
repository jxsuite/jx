/**
 * Mounting the Navigator's Data panel in a test, and addressing what it drew.
 *
 * The panel is a Jx document (`src/surfaces/panel-signals.json`), mounted by
 * `src/surfaces/panel-signals.ts` and projected by `src/panels/signals-panel.ts`, so everything
 * here is addressed by `part`, by `role` or by `data-prop` — there is no `.signal-row`,
 * `sp-textfield` or `sp-picker` to find any more.
 *
 * Two things follow from the substrate and are worth knowing before reading a test that uses this.
 * Every draw is AWAITED: `mountSurface` is asynchronous, each kit element settles its own template
 * one `connectedCallback` after that, and a `$map`'s re-render is coalesced into a microtask — so a
 * synchronous `click(); assert;` asserts against the frame before the one it means. And a row is
 * addressed by the entry it draws (`[part="entry"][data-signal="$count"]`), never by counting
 * siblings, because several rows stand open at once.
 */
import { flush, resetWorkspaceWithTab } from "./harness";
import { activeTab } from "../src/workspace/workspace";
import { effect, effectScope } from "../src/reactivity";
import { mountSignalsPanel } from "../src/panels/signals-panel";
import type { EffectScope } from "@vue/reactivity";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** A control the reader can put a string into. */
export type ValueEl = HTMLElement & { value: string };

/** What a mounted panel hands back: its content node, and the two hooks the Navigator supplies. */
export interface MountedSignals {
  /** The `.panel-content` the document was mounted into. */
  panel: HTMLElement;
  /** The `.panel-body` around it, as `left-panel.ts` paints it. */
  host: HTMLElement;
  /** Repaint, exactly as the Navigator would. Awaited by {@link settle}. */
  repaint: () => void;
  /** How many times the panel asked for a repaint since the last {@link resetCounts}. */
  counts: { repaints: number; refreshes: number };
  resetCounts: () => void;
  /** Stop the render effect. Called for every standing panel by {@link clearSignalPanels}. */
  dispose: () => void;
}

/** Every render effect this module started, stopped together between tests. */
const scopes: EffectScope[] = [];

/** Every panel body this module put in the page, so a test file can clear them between tests. */
export function clearSignalPanels(): void {
  for (const scope of scopes.splice(0)) {
    scope.stop();
  }
  for (const stale of document.querySelectorAll("body > .panel-body")) {
    stale.remove();
  }
}

/** The Navigator's panel host: a `.panel-body` with the `.panel-content` the document goes into. */
function panelHost(): HTMLElement {
  const body = document.createElement("div");
  body.className = "panel-body";
  const content = document.createElement("div");
  content.className = "panel-content";
  body.append(content);
  document.body.append(body);
  return body;
}

/** Let the mount, the kit elements inside it and one map re-render all settle. */
export async function settle(turns = 6): Promise<void> {
  await flush(turns);
}

export interface DrawOptions {
  /** The document's tag — hyphenate it to get the CEM fields a custom element adds. */
  tagName?: string;
  /** What the canvas resolved these entries to. `null` means it has not answered at all. */
  scope?: Record<string, unknown> | null;
  /** Whether the panel is handed a Refresh verb. Omitted means yes. */
  refreshData?: boolean;
  /** The document's path, which is what `$params` are derived from. */
  documentPath?: string;
}

/**
 * Open a document with `state` and draw the Data panel over it.
 *
 * The `S` record is `NavigatorPanelContext.doc`, built the way `left-panel.ts` builds it, so this
 * drives the same shape the app does.
 */
export async function drawSignals(
  state: Record<string, unknown>,
  options: DrawOptions = {},
): Promise<MountedSignals> {
  /* One panel at a time, which is what the Navigator has: a standing render effect from an earlier
     draw would keep painting into a container this test has moved on from. */
  clearSignalPanels();
  resetWorkspaceWithTab({
    children: [],
    state,
    tagName: options.tagName ?? "div",
  } as unknown as JxMutableNode);
  const tab = activeTab.value;
  if (!tab) {
    throw new Error("no active tab");
  }
  if (options.scope !== undefined) {
    tab.session.canvas.scope = options.scope;
  }
  const host = panelHost();
  const counts = { refreshes: 0, repaints: 0 };
  const S: Record<string, unknown> = {
    canvas: tab.session.canvas,
    document: tab.doc.document,
    mode: tab.doc.mode,
    selection: tab.session.selection,
    ui: tab.session.ui,
    ...(options.documentPath === undefined ? {} : { documentPath: options.documentPath }),
  };
  const ctx: Record<string, unknown> = {
    renderLeftPanel: () => {
      counts.repaints += 1;
      S.document = activeTab.value?.doc.document;
      mountSignalsPanel(host, S as never, ctx as never);
    },
  };
  if (options.refreshData !== false) {
    ctx.refreshData = () => {
      counts.refreshes += 1;
    };
  }
  /* Inside an effect, because that is where `panels/left-panel.ts` renders: a transaction replaces
     `tab.doc.document` and the Navigator repaints, which is why the panel's own handlers only ask
     for a repaint when they changed something the DOCUMENT does not hold (an expansion, a refused
     rename, the advanced-parameter view). A fixture that repainted only on demand would make every
     one of those handlers look like a bug. */
  const scope = effectScope();
  scopes.push(scope);
  scope.run(() => {
    effect(() => {
      const live = activeTab.value;
      if (!live) {
        // Every tab closed: there is no document to project, exactly as the Navigator's own empty
        // State means.
        return;
      }
      void live.doc.document;
      void live.doc.mode;
      (ctx.renderLeftPanel as () => void)();
    });
  });
  await settle();
  counts.repaints = 0;
  return {
    counts,
    dispose: () => {
      scope.stop();
    },
    host,
    panel: host.querySelector(".panel-content") as HTMLElement,
    repaint: ctx.renderLeftPanel as () => void,
    resetCounts: () => {
      counts.refreshes = 0;
      counts.repaints = 0;
    },
  };
}

/** One entry's row, by the entry it draws. */
export function entryRow(panel: HTMLElement, name: string): HTMLElement {
  const row = panel.querySelector<HTMLElement>(`[part="entry"][data-signal="${name}"]`);
  if (!row) {
    throw new Error(`no row for ${name}`);
  }
  return row;
}

/** The names the panel lists, in the order it lists them. */
export function listedNames(panel: HTMLElement): string[] {
  return [...panel.querySelectorAll<HTMLElement>('[part="entry"]')].map(
    (row) => row.dataset["signal"] ?? "",
  );
}

/** One element's `data-*` value. */
export function dataOf(el: Element | null | undefined, key: string): string | undefined {
  return (el as HTMLElement | null | undefined)?.dataset[key];
}

/**
 * Whether a marker attribute is present.
 *
 * A marker is written EMPTY rather than `"true"` (`data-expanded`, `data-selected`,
 * `data-invalid`), so its presence is the state and its value says nothing.
 */
export function marked(el: Element | null | undefined, key: string): boolean {
  return dataOf(el, key) !== undefined;
}

/** The tone of one entry's summary: `hint` for a definition, `value` or `pending` for a result. */
export function summaryTone(panel: HTMLElement, name: string): string | undefined {
  return dataOf(entryRow(panel, name).querySelector('[part="summary"]'), "tone");
}

/** The text of one entry's summary, whichever of the two it is showing. */
export function summaryText(panel: HTMLElement, name: string): string | null | undefined {
  return entryRow(panel, name).querySelector('[part="summary"]')?.textContent;
}

/** Whether the panel has a row for an entry at all. */
export function hasEntry(panel: HTMLElement, name: string): boolean {
  return panel.querySelector(`[part="entry"][data-signal="${name}"]`) !== null;
}

/** Open (or close) one entry's editor and let the document settle. */
export async function toggleEntry(panel: HTMLElement, name: string): Promise<void> {
  entryRow(panel, name).querySelector<HTMLElement>('[part="disclosure"]')?.click();
  await settle();
}

/** Open one entry's editor if it is closed, and return it. */
export async function openEntry(panel: HTMLElement, name: string): Promise<HTMLElement> {
  if (!panel.querySelector(`[part="editor"][data-signal="${name}"]`)) {
    await toggleEntry(panel, name);
  }
  return editorFor(panel, name);
}

/** THIS entry's editor — several stand open at once, so it is addressed by name. */
export function editorFor(panel: HTMLElement, name: string): HTMLElement {
  const editor = panel.querySelector<HTMLElement>(`[part="editor"][data-signal="${name}"]`);
  if (!editor) {
    throw new Error(`no editor open for ${name}`);
  }
  return editor;
}

/** One field row of an editor, by the `data-prop` the region grammar reads. */
export function fieldRow(editor: HTMLElement, prop: string): HTMLElement {
  const row = editor.querySelector<HTMLElement>(`[part="field"][data-prop="${prop}"]`);
  if (!row) {
    throw new Error(`no field row ${prop}`);
  }
  return row;
}

/** The `data-prop` of every field row in an editor, in order. */
export function fieldProps(editor: HTMLElement): string[] {
  return [...editor.querySelectorAll<HTMLElement>('[part="field"]')]
    .filter((row) => row.closest('[part="editor"]') === editor)
    .map((row) => row.dataset["prop"] ?? "");
}

/** The control inside a field row — `text`, `multiline`, `select` or `checkbox`. */
export function control<T extends Element = Element>(
  editor: HTMLElement,
  prop: string,
  part: string,
): T {
  const el = fieldRow(editor, prop).querySelector(`[part="${part}"]`);
  if (!el) {
    throw new Error(`no [part="${part}"] in field row ${prop}`);
  }
  return el as unknown as T;
}

/** The native input or textarea a kit text field wraps — what a keystroke actually lands on. */
export function nativeInput(scope: Element): HTMLInputElement {
  const el = scope.querySelector('[part="input"]');
  if (!el) {
    throw new Error("no native control inside the field");
  }
  return el as HTMLInputElement;
}

/** The native select a `jx-select` wraps. */
export function nativeSelect(scope: Element): HTMLSelectElement {
  const el = scope.querySelector("select");
  if (!el) {
    throw new Error("no native select inside the picker");
  }
  return el as HTMLSelectElement;
}

/** Type into a control and leave it: an `input` and then a `change`, which is what a blur is. */
export async function commitText(scope: Element, value: string): Promise<void> {
  const input = nativeInput(scope);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}

/** Type into a control WITHOUT leaving it — the debounced path. */
export function typeText(scope: Element, value: string): void {
  const input = nativeInput(scope);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Pick a row in a `jx-select`. */
export async function pick(scope: Element, value: string): Promise<void> {
  const select = nativeSelect(scope);
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}

/** Tick or clear a `jx-checkbox`. */
export async function tick(scope: Element, checked: boolean): Promise<void> {
  const box = scope.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!box) {
    throw new Error("no checkbox inside the field");
  }
  box.checked = checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}

/** Press a kit button — the inner control, which is the node that carries the accessible name. */
export async function press(el: Element | null | undefined): Promise<void> {
  if (!el) {
    throw new Error("no button to press");
  }
  const target = el.querySelector<HTMLElement>('[part="control"]') ?? (el as HTMLElement);
  target.click();
  await settle();
}

/** One button inside a scope, by its `part`. */
export function button(scope: Element, part: string): HTMLElement {
  const el = scope.querySelector<HTMLElement>(`[part="${part}"]`);
  if (!el) {
    throw new Error(`no [part="${part}"]`);
  }
  return el;
}

/** A kit control's accessible name, which the element forwards to the node inside it. */
export function accessibleName(el: Element | null | undefined): string | null {
  return el?.querySelector('[part="control"]')?.getAttribute("aria-label") ?? null;
}

/** The open document's state map, as the test reads it back. */
export function docState(): Record<string, Record<string, unknown>> {
  return (activeTab.value?.doc.document.state ?? {}) as Record<string, Record<string, unknown>>;
}
