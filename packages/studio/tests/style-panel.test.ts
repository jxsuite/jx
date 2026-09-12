/**
 * The Inspector's Style tab — the CSS editor, as a Jx document over the kit.
 *
 * Nothing here names a class. A row is addressed by `[part="row"]` and the property it edits
 * (`data-prop`, which is also what `ui/regions.ts` resolves `inspector/field:*` through), a control
 * by its `part`, a section by `data-section`, and every list the tab opens is the kit menu in the
 * popover layer. What is asserted is the contract the tab exists for: a row says where its value
 * came from, a commit reaches every selected element in one undo step, a section heading tallies
 * what is set inside it, and a colour row is a `jx-color-field` with the project's own palette
 * slotted into its picker.
 *
 * A mounted document needs more turns than a lit render — the surface mounts, the Target Line
 * mounts inside it, and the keyed repeaters reconcile after that — so `flush(4)` is the normal
 * settling here rather than a smell.
 */
import {
  answerPromptDialog,
  flush,
  resetStudioState,
  resetWorkspaceWithTab,
  topDialog,
} from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as storeActual from "../src/store";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import type { JxMutableNode, JxStyle } from "@jxsuite/schema/types";
import { shell } from "../src/shell";

// Make debounced style commits synchronous so an `input` handler commits without a real timer.
void mock.module("../src/store", () => ({
  ...storeActual,
  debouncedStyleCommit:
    <A extends unknown[]>(_prop: string, _ms: number, fn: (...args: A) => void) =>
    (...args: A) =>
      fn(...args),
}));

// Stub the stylebook panel so nested-rule navigation doesn't drag in canvas panning.
const selectStylebookTagMock = mock((..._args: unknown[]) => {});
void mock.module("../src/panels/stylebook-panel", () => ({
  selectStylebookTag: selectStylebookTagMock,
}));

// The Target Line's segments route to commands rather than growing their own selectors, so the
// Registry is what the tests assert against — the segment's job is to name the right verb.
const runMock = mock((..._args: unknown[]) => {});
void mock.module("../src/commands/active-registry", () => ({
  activeRegistry: () => ({ run: runMock }),
}));

const { bindStyleHost, resetSelectorMenu } = await import("../src/panels/style-panel");
const { mountStylePanelSurface } = await import("../src/surfaces/style-panel");
const { openSelectorMenu } = await import("../src/surfaces/target-line");
const { initCssData } = await import("../src/panels/style-utils");
const { initLayers } = await import("../src/ui/layers");
const { getNodeAtPath } = await import("../src/store");
const { resetSlotModeMemory } = await import("../src/ui/dynamic-slot");

// Happy-dom may not provide requestAnimationFrame in all versions.
(globalThis as Record<string, unknown>).requestAnimationFrame ??= (cb: (t: number) => void) =>
  setTimeout(() => cb(0), 0);

beforeAll(() => {
  for (const id of ["layer-popover", "layer-modal", "layer-dialog", "layer-toast"]) {
    if (!document.querySelector(`#${id}`)) {
      const el = document.createElement("div");
      el.id = id;
      document.body.append(el);
    }
  }
  initLayers();
});

const MEDIA = { md: "(min-width: 768px)", sm: "(min-width: 640px)" };

function setupTab(style: JxStyle | undefined, opts: { media?: boolean } = {}) {
  resetStudioState();
  const doc = {
    children: [{ ...(style ? { style } : {}), tagName: "section" }],
    tagName: "div",
    ...(opts.media ? { $media: MEDIA } : {}),
  } as unknown as JxMutableNode;
  const tab = resetWorkspaceWithTab(doc);
  tab.session.selection = [["children", 0]];
  return tab;
}

function selectedNode(): JxMutableNode {
  return getNodeAtPath(activeTab.value!.doc.document, ["children", 0]);
}

/** Every host a paint has put in the document, so a test never inherits the last one's tab. */
const painted: HTMLElement[] = [];

/**
 * Mount the tab into a CONNECTED host and let both documents settle.
 *
 * Connected because `style.openSelectorMenu` asks the trigger whether it is still in the document,
 * and four turns because two documents land here: the tab's own, and the Target Line's inside it.
 */
async function renderPanel(mode = "edit"): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  painted.push(host);
  bindStyleHost(host, { getCanvasMode: () => mode });
  await flush(4);
  return host;
}

/** Let the tab's own effect re-project after state moved under it. */
const settle = () => flush(2);

function row(container: HTMLElement, prop: string, kind = ""): HTMLElement | null {
  const of = kind ? `[data-kind="${kind}"]` : "";
  return container.querySelector(`[part="row"][data-prop="${prop}"]${of}:not([data-child])`);
}

function childRow(container: HTMLElement, prop: string): HTMLElement | null {
  return container.querySelector(`[part="row"][data-prop="${prop}"][data-child="true"]`);
}

function section(container: HTMLElement, key: string): HTMLElement | null {
  return container.querySelector(`[part="section"][data-section="${key}"]`);
}

/** A row's provenance chip, whatever state it is in. */
function chip(container: HTMLElement, prop: string): HTMLElement | null {
  return row(container, prop)?.querySelector('[part="chip"]') ?? null;
}

/** The control inside a row — a kit field's own native input. */
function input(scope: Element | null, part = "text"): HTMLInputElement | null {
  return scope?.querySelector(`[part="${part}"] [part="input"]`) ?? null;
}

function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** Type into a kit field the way a reader does: the control's value, then the event. */
function fire(el: Element | null | undefined, type: string, value?: string) {
  expect(el).toBeTruthy();
  if (value !== undefined) {
    (el as HTMLInputElement).value = value;
  }
  el!.dispatchEvent(new Event(type, { bubbles: true }));
}

/** One segment of the Target Line, addressed by the axis it states. */
function segment(container: HTMLElement, key: string): HTMLElement | null {
  return container.querySelector(`[part="line"] [data-seg="${key}"]`);
}

/** The trailing scope chip — "this element" / "all <h1> in this document". */
function scopeChip(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[part="scope"]');
}

/** Open a row's list and read its rows. Every list on this tab is the kit menu. */
async function openList(trigger: Element | null | undefined): Promise<HTMLElement[]> {
  click(trigger);
  await flush(3);
  return [
    ...document.querySelectorAll<HTMLElement>("#layer-popover jx-menu-item[data-command-id]"),
  ];
}

function listRow(rows: HTMLElement[], value: string): HTMLElement | undefined {
  return rows.find((el) => el.dataset.commandId === value);
}

/** A row's chooser button — the unit list, the keyword list, or the button-group overflow. */
function chooser(scope: HTMLElement | null): HTMLElement | null {
  return scope?.querySelector('[part="group-open"]') ?? null;
}

/** A row's Value Source chip. */
function sourceChip(scope: HTMLElement | null): HTMLElement | null {
  return scope?.querySelector('[part="source"]') ?? null;
}

/** Open a chooser's list and press the entry that stands for `value`. */
async function pickFrom(trigger: Element | null | undefined, value: string): Promise<void> {
  const rows = await openList(trigger);
  click(listRow(rows, value));
  await settle();
}

/** The Target Line's own selector menu, opened through the command that photographs it. */
async function selectorRows(): Promise<HTMLElement[]> {
  openSelectorMenu();
  await flush(3);
  return [
    ...document.querySelectorAll<HTMLElement>("#layer-popover jx-menu-item[data-command-id]"),
  ];
}

/** Open or close a section through the kit's own `toggle`, the way the platform announces one. */
async function toggleSection(item: HTMLElement | null, open: boolean): Promise<void> {
  expect(item).toBeTruthy();
  item!.dispatchEvent(new CustomEvent("toggle", { bubbles: false, detail: open }));
  await settle();
}

beforeEach(() => {
  initCssData({
    cssProps: [
      ["display", "inline"],
      ["zoom", "1"],
    ],
  });
  selectStylebookTagMock.mockClear();
  runMock.mockClear();
  resetSelectorMenu();
  resetSlotModeMemory();
});

afterEach(async () => {
  bindStyleHost(null);
  closeAllTabs();
  resetSelectorMenu();
  await flush();
  for (const host of painted.splice(0)) {
    host.remove();
  }
  document.querySelector("#layer-popover")?.replaceChildren();
});

// ─── Empty states ────────────────────────────────────────────────────────────

describe("the tab's teaching states", () => {
  test("no open tab → the shared open-a-page state, with the button that does it", async () => {
    resetStudioState();
    closeAllTabs();
    const c = await renderPanel();
    expect(c.querySelector('[part="empty-message"]')?.textContent).toBe(
      "Open a page to style what you click.",
    );
    expect(c.querySelector('[part="empty-action"]')?.textContent?.trim()).toBe("Open a page…");
  });

  test("tab without selection → the one shared canvas verb, and no button", async () => {
    resetStudioState();
    resetWorkspaceWithTab();
    const c = await renderPanel();
    // The rail must not read as three different requirements: Content, Logic and Style all ask for
    // A selection with the same sentence.
    expect(c.querySelector('[part="empty-message"]')?.textContent).toBe(
      "Click anything on the canvas to style it.",
    );
    expect(c.querySelector('[part="empty-action"]')).toBeNull();
  });

  test("selection pointing at a missing node → names the loss, then the shared verb", async () => {
    const tab = setupTab({});
    tab.session.selection = [["children", 9]];
    const c = await renderPanel();
    expect(c.querySelector('[part="empty-message"]')?.textContent).toBe(
      "That element is no longer on the page. Click anything on the canvas to pick another one.",
    );
  });

  test("stylebook mode with null document → the same open-a-page state", async () => {
    const tab = setupTab({});
    shell.stylebook.selection = "h1";
    (tab.doc as unknown as Record<string, unknown>).document = null;
    const c = await renderPanel("stylebook");
    expect(c.querySelector('[part="empty-message"]')?.textContent).toBe(
      "Open a page to style what you click.",
    );
  });
});

// ─── Stylebook mode ──────────────────────────────────────────────────────────

describe("stylebook mode", () => {
  test("the scope chip states the blast radius, and site style shows through as a donor", async () => {
    setupTab({});
    resetStudioState({ projectConfig: { style: { textAlign: "center" } } });
    shell.stylebook.selection = "h1";
    const c = await renderPanel("stylebook");
    expect(segment(c, "element")?.textContent).toContain("h1");
    expect(scopeChip(c)?.textContent).toContain("all <h1> in this document");
    // The value comes from the project's site style, not from this document — so it is inherited,
    // With the donor named, rather than an accent dot whose "clear" would do nothing.
    const r = row(c, "textAlign");
    expect(r).not.toBeNull();
    expect(chip(c, "textAlign")?.dataset.state).toBe("inherited");
    expect(chip(c, "textAlign")?.textContent).toContain("from site tokens");
  });

  test("a layout's stylebook rule is project-wide, and the band says how wide", async () => {
    setupTab({});
    resetStudioState();
    activeTab.value!.documentPath = "layouts/base.json";
    shell.stylebook.selection = "h1";
    const c = await renderPanel("stylebook");
    expect(scopeChip(c)?.textContent).toContain("all <h1> in this project");
    // The harness platform answers no `findReferences`, so the honest count is "unknown" — never a
    // Confident zero.
    expect(c.querySelector('[part="warning-text"]')?.textContent).toContain("unknown");
  });
});

// ─── Base rows, conditions, commits ──────────────────────────────────────────

describe("base style rows", () => {
  test("renders set props, conditional rows, and auto-opens their sections", async () => {
    const tab = setupTab({ display: "flex", flexDirection: "row" });
    const c = await renderPanel();
    expect(row(c, "display")).not.toBeNull();
    const flexDir = row(c, "flexDirection");
    expect(flexDir).not.toBeNull();
    expect(flexDir!.dataset.warning).toBeUndefined();
    // FlexWrap has no value but its $show condition (display: flex) passes.
    expect(row(c, "flexWrap")).not.toBeNull();
    expect(tab.session.ui.styleSections.layout).toBe(true);
  });

  test("a set value whose $show condition fails is marked, and an unset one is dropped", async () => {
    setupTab({ flexDirection: "row" });
    const c = await renderPanel();
    expect(row(c, "flexDirection")!.dataset.warning).toBe("true");
    expect(row(c, "flexWrap")).toBeNull();
  });

  test("the set chip clears the property, and is a real button rather than a bare dot", async () => {
    setupTab({ display: "flex", flexDirection: "row" });
    const c = await renderPanel();
    const dot = chip(c, "display")!;
    expect(dot.tagName.toLowerCase()).toBe("button");
    expect(dot.dataset.state).toBe("set");
    expect(dot.getAttribute("aria-label")).toContain("clear display");
    click(dot);
    await settle();
    expect(selectedNode().style?.display).toBeUndefined();
    expect(selectedNode().style?.flexDirection).toBe("row");
    expect(activeTab.value!.doc.dirty).toBe(true);
  });

  test("$span 2 props in grid sections span both columns", async () => {
    setupTab({ boxSizing: "border-box" });
    const c = await renderPanel();
    expect(row(c, "boxSizing")!.dataset.span).toBe("2");
    expect(section(c, "size")!.querySelector('[part="rows"][data-layout="grid"]')).not.toBeNull();
  });
});

// ─── The Value Source ladder (§6.3) ──────────────────────────────────────────

describe("the Value Source ladder", () => {
  test("style rows offer literal and template only — JxStyle admits no $ref", async () => {
    // With a signal declared, which is exactly the state the generic ladder used to leak a
    // `From data…` rung in: a `{ $ref }` in a declaration is a document `JxStyle` refuses.
    resetStudioState();
    const doc = {
      children: [{ style: { display: "flex" }, tagName: "section" }],
      state: { mode: { default: "grid" } },
      tagName: "div",
    } as unknown as JxMutableNode;
    const tab = resetWorkspaceWithTab(doc);
    tab.session.selection = [["children", 0]];
    const c = await renderPanel();
    const source = sourceChip(row(c, "display"))!;
    expect(source.textContent!.trim()).toBe("Fixed value");
    expect(source.dataset.source).toBe("literal");
    const offered = await openList(source);
    expect(offered.map((el) => el.dataset.commandId)).toEqual(["literal", "template"]);
  });

  test("switching to Mixed text seeds a state-based template string", async () => {
    resetStudioState();
    const doc = {
      children: [{ style: { display: "flex" }, tagName: "section" }],
      state: { mode: { default: "grid" } },
      tagName: "div",
    } as unknown as JxMutableNode;
    const tab = resetWorkspaceWithTab(doc);
    tab.session.selection = [["children", 0]];
    const c = await renderPanel();
    await pickFrom(sourceChip(row(c, "display")), "template");
    expect(selectedNode().style?.display).toBe("${state.mode}");
  });

  test("a template value draws a monospaced field that commits when it is LEFT", async () => {
    setupTab({ display: "${state.mode}" });
    const c = await renderPanel();
    const r = row(c, "display")!;
    expect(r.querySelector('[part="source"]')!.textContent!.trim()).toBe("Mixed text");
    const field = input(r)!;
    expect(field.value).toBe("${state.mode}");
    // Typing alone must not write: a half-finished `${state.m` is not a binding.
    fire(field, "input", "${state.oth");
    expect(selectedNode().style?.display).toBe("${state.mode}");
    fire(field, "change", "${state.other}");
    await settle();
    expect(selectedNode().style?.display).toBe("${state.other}");
  });

  test("de-escalating a template value to Fixed value clears the property", async () => {
    setupTab({ display: "${state.mode}" });
    const c = await renderPanel();
    await pickFrom(sourceChip(row(c, "display")), "literal");
    expect(selectedNode().style).toBeUndefined();
  });

  test("cycling back to Fixed value restores the stashed literal", async () => {
    setupTab({ display: "flex" });
    let c = await renderPanel();
    await pickFrom(sourceChip(row(c, "display")), "template");
    expect(selectedNode().style?.display).toBe("${}");

    c = await renderPanel();
    await pickFrom(sourceChip(row(c, "display")), "literal");
    expect(selectedNode().style?.display).toBe("flex");
  });
});

// ─── The Target Line (§6.1) ──────────────────────────────────────────────────

describe("the Target Line", () => {
  test("states the element and the base breakpoint, and scopes to the element", async () => {
    setupTab({});
    const c = await renderPanel();
    expect(segment(c, "element")?.textContent?.trim()).toBe("section");
    expect(segment(c, "media")?.textContent?.trim()).toBe("Base");
    expect(segment(c, "scheme")).toBeNull();
    expect(scopeChip(c)?.textContent?.trim()).toBe("this element");
    expect(c.querySelector('[part="warning"]')).toBeNull();
  });

  test("names the active breakpoint, and every segment routes rather than picking", async () => {
    const tab = setupTab({}, { media: true });
    tab.session.ui.activeMedia = "md";
    const c = await renderPanel();
    expect(segment(c, "media")?.textContent?.trim()).toBe("@Md");
    click(segment(c, "media"));
    expect(runMock).toHaveBeenCalledWith("settings.open", { section: "contexts" });
    click(segment(c, "element"));
    expect(runMock).toHaveBeenCalledWith("view.setActivity", { tab: "layers" });
  });

  test("the selector segment names the rule and marks what the element declares", async () => {
    const tab = setupTab({ "&.active": { color: "red" } });
    tab.session.ui.activeSelector = "&.custom";
    const c = await renderPanel();
    expect(segment(c, "selector")?.textContent).toContain("&.custom");
    const rows = await selectorRows();
    const values = rows.map((el) => el.dataset.commandId);
    expect(values).toContain("&.active");
    expect(values).toContain("&.custom");
    expect(values).toContain("__base__");
    expect(listRow(rows, "&.active")?.getAttribute("aria-checked")).toBe("true");
  });

  test("choosing a menu entry sets the selector; the base entry clears it", async () => {
    const tab = setupTab({});
    await renderPanel();
    click(listRow(await selectorRows(), ":focus"));
    await settle();
    expect(tab.session.ui.activeSelector).toBe(":focus");
    click(listRow(await selectorRows(), "__base__"));
    await settle();
    expect(tab.session.ui.activeSelector).toBeNull();
  });

  test("+ Add custom… opens a validated dialog, not an imperative input", async () => {
    const tab = setupTab({});
    await renderPanel();
    const addCustom = async () => click(listRow(await selectorRows(), "__add_custom__"));

    await addCustom();
    await flush();
    expect(topDialog()).not.toBeNull();
    expect(topDialog()!.getAttribute("headline")).toBe("Add Selector");
    await answerPromptDialog("notASelector");
    expect(topDialog()!.querySelector('jx-textfield [part="error"]')?.textContent).toContain(
      'must start with ":"',
    );
    await answerPromptDialog(".fancy");
    await settle();
    expect(tab.session.ui.activeSelector).toBe(".fancy");

    // Cancelling changes nothing.
    await addCustom();
    await flush();
    await answerPromptDialog(null);
    expect(tab.session.ui.activeSelector).toBe(".fancy");
  });

  test("style.openSelectorMenu opens the line's own menu, and refuses when unrendered", async () => {
    setupTab({});
    await renderPanel();
    expect(listRow(await selectorRows(), "__base__")).toBeDefined();

    resetSelectorMenu();
    expect(() => openSelectorMenu()).toThrow("needs the Inspector's Style tab rendered");
  });
});

// ─── Color-scheme layer routing (spec §9.5) ──────────────────────────────────

describe("color-scheme layer routing", () => {
  const SCHEME_MEDIA = { "--dark": "(prefers-color-scheme: dark)", ...MEDIA };

  function setupSchemeTab(
    style: JxStyle | undefined,
    media: Record<string, string> = SCHEME_MEDIA,
  ) {
    resetStudioState();
    const doc = {
      $media: media,
      children: [{ ...(style ? { style } : {}), tagName: "section" }],
      tagName: "div",
    } as unknown as JxMutableNode;
    const tab = resetWorkspaceWithTab(doc);
    tab.session.selection = [["children", 0]];
    return tab;
  }

  test("forced Dark shows the variant segment and routes base-context edits into @--dark", async () => {
    const tab = setupSchemeTab({ "@--dark": { textTransform: "uppercase" }, color: "blue" });
    tab.session.ui.previewColorScheme = "dark";
    const c = await renderPanel();
    expect(segment(c, "scheme")?.textContent).toContain("Dark variant");
    click(chip(c, "textTransform"));
    await settle();
    expect(selectedNode().style?.["@--dark"]).toBeUndefined();
    expect(selectedNode().style?.color).toBe("blue");
  });

  test("the base value shows through as an inherited donor, and the chip goes back to it", async () => {
    const tab = setupSchemeTab({ color: "blue" });
    tab.session.ui.previewColorScheme = "dark";
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    expect(chip(c, "color")?.textContent).toContain("from Base");
    click(chip(c, "color"));
    await settle();
    expect(tab.session.ui.previewColorScheme as string).toBe("auto");
  });

  test("Auto keeps base-context editing and shows no variant segment", async () => {
    const tab = setupSchemeTab({ color: "blue" });
    tab.session.ui.previewColorScheme = "auto";
    const c = await renderPanel();
    expect(segment(c, "scheme")).toBeNull();
    click(chip(c, "color"));
    await settle();
    expect(selectedNode().style?.color).toBeUndefined();
  });

  test("a breakpoint tab stays breakpoint-scoped even while a scheme is forced", async () => {
    const tab = setupSchemeTab({ "@sm": { textTransform: "uppercase" }, color: "blue" });
    tab.session.ui.previewColorScheme = "dark";
    tab.session.ui.activeMedia = "sm";
    const c = await renderPanel();
    expect(segment(c, "scheme")).toBeNull();
    click(chip(c, "textTransform"));
    await settle();
    expect(selectedNode().style?.["@sm"]).toBeUndefined();
    expect(selectedNode().style?.color).toBe("blue");
  });

  test("no declared scheme query — forced scheme falls back to base routing", async () => {
    const tab = setupSchemeTab({ color: "blue" }, MEDIA);
    tab.session.ui.previewColorScheme = "dark";
    const c = await renderPanel();
    expect(segment(c, "scheme")).toBeNull();
    click(chip(c, "color"));
    await settle();
    expect(selectedNode().style?.color).toBeUndefined();
  });
});

// ─── Provenance chips (§6.2) ─────────────────────────────────────────────────

describe("provenance chips", () => {
  test("an inherited value names its donor breakpoint and jumps there", async () => {
    const tab = setupTab({ color: "blue" }, { media: true });
    tab.session.ui.activeMedia = "md";
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    const inherited = chip(c, "color")!;
    expect(inherited.dataset.state).toBe("inherited");
    expect(inherited.textContent).toContain("from Base");
    expect(inherited.getAttribute("title")).toContain("click to go there");
    click(inherited);
    await settle();
    expect(tab.session.ui.activeMedia).toBeNull();
  });

  test("a lower breakpoint is named as the donor, not just 'Base'", async () => {
    const tab = setupTab({ "@sm": { color: "red" }, color: "blue" }, { media: true });
    tab.session.ui.activeMedia = "md";
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    expect(chip(c, "color")?.textContent).toContain("from Sm");
    click(chip(c, "color"));
    await settle();
    expect(tab.session.ui.activeMedia).toBe("sm");
  });

  test("a ${} value is bound, names its signal and opens it", async () => {
    resetStudioState();
    const doc = {
      children: [{ style: { color: "${state.brand}" }, tagName: "section" }],
      state: { brand: { default: "red" } },
      tagName: "div",
    } as unknown as JxMutableNode;
    const tab = resetWorkspaceWithTab(doc);
    tab.session.selection = [["children", 0]];
    const c = await renderPanel();
    const bound = chip(c, "color")!;
    expect(bound.dataset.state).toBe("bound");
    expect(bound.textContent).toContain("brand");
    click(bound);
    // The Data panel, and the row for that entry — both verbs, because the chip's promise is "show
    // Me where this comes from" and the rail tab alone leaves you looking at a collapsed list.
    expect(runMock).toHaveBeenCalledWith("view.setActivity", { tab: "data" });
    expect(runMock).toHaveBeenCalledWith("data.expandRow", { name: "brand" });
  });

  test("an unset property carries no chip at all — absence is the ghost", async () => {
    setupTab({ display: "flex" });
    const c = await renderPanel();
    expect(chip(c, "flexDirection")).toBeNull();
  });
});

// ─── Selector-scoped editing ─────────────────────────────────────────────────

describe("selector style editing", () => {
  test("pseudo selector: rows come from the nested block; clearing removes the block", async () => {
    const tab = setupTab({ ":hover": { textTransform: "uppercase" } });
    tab.session.ui.activeSelector = ":hover";
    const c = await renderPanel();
    expect(segment(c, "selector")?.textContent).toContain(":hover");
    expect(listRow(await selectorRows(), ":hover")?.getAttribute("aria-checked")).toBe("true");
    click(chip(c, "textTransform"));
    await settle();
    expect(selectedNode().style).toBeUndefined();
  });

  test("pseudo selector inside a media tab", async () => {
    const tab = setupTab({ "@sm": { ":hover": { textTransform: "lowercase" } } }, { media: true });
    tab.session.ui.activeMedia = "sm";
    tab.session.ui.activeSelector = ":hover";
    const c = await renderPanel();
    click(chip(c, "textTransform"));
    await settle();
    expect(selectedNode().style).toBeUndefined();
  });

  test("tag path selector resolves nested tag styles", async () => {
    const tab = setupTab({ th: { textTransform: "capitalize" } });
    tab.session.ui.activeSelector = "th";
    const c = await renderPanel();
    click(chip(c, "textTransform"));
    await settle();
    expect(selectedNode().style).toBeUndefined();
  });

  test("multi-segment tag path resolves deeply; missing paths yield empty style", async () => {
    const tab = setupTab({ table: { th: { textTransform: "uppercase" } } });
    tab.session.ui.activeSelector = "table th";
    let c = await renderPanel();
    expect(chip(c, "textTransform")?.dataset.state).toBe("set");

    tab.session.ui.activeSelector = "table td";
    c = await renderPanel();
    // Missing path resolves to an empty style: the row is there and states nothing.
    expect(chip(c, "textTransform")).toBeNull();
  });

  test("tag path within a media tab", async () => {
    const tab = setupTab({ "@sm": { th: { textTransform: "uppercase" } } }, { media: true });
    tab.session.ui.activeMedia = "sm";
    tab.session.ui.activeSelector = "th";
    const c = await renderPanel();
    click(chip(c, "textTransform"));
    await settle();
    expect(selectedNode().style).toBeUndefined();
  });
});

// ─── Filter bar ──────────────────────────────────────────────────────────────

describe("filter bar", () => {
  test("the filter field updates session ui", async () => {
    const tab = setupTab({});
    const c = await renderPanel();
    fire(input(c, "filter-input"), "input", "flex");
    await settle();
    expect(tab.session.ui.styleFilter).toBe("flex");
  });

  test("text filter shows matching rows only and drops empty sections", async () => {
    const tab = setupTab({ display: "flex" });
    tab.session.ui.styleFilter = "flex";
    const c = await renderPanel();
    expect(row(c, "flexDirection")).not.toBeNull();
    expect(row(c, "display")).toBeNull();
    expect(section(c, "size")).toBeNull();
  });

  test("filter matches against the human-readable label", async () => {
    const tab = setupTab({ display: "flex" });
    tab.session.ui.styleFilter = "wrap"; // Matches label "Flex Wrap", not the camelCase prop name
    const c = await renderPanel();
    expect(row(c, "flexWrap")).not.toBeNull();
    expect(row(c, "display")).toBeNull();
  });

  test("a section heading tallies what is set, inherited and bound inside it", async () => {
    const tab = setupTab({ display: "flex", paddingTop: "4px" }, { media: true });
    tab.session.ui.activeMedia = "md";
    const c = await renderPanel();
    const dots = section(c, "layout")!.querySelector('[part="dots"]')!;
    // Nothing is set on @md, so the tally is what shows through from Base — which is exactly the
    // Question the retired "Active" toggle could only answer by hiding everything else.
    expect(dots.getAttribute("title")).toContain("inherited");
    expect(dots.querySelector('[part="dot"][data-state="inherited"]')).not.toBeNull();
    expect(dots.hasAttribute("hidden")).toBe(false);
    // A section with nothing informative in it draws no tally at all, rather than an empty span
    // Carrying the words "nothing set" for a screen reader to read out on every closed heading.
    const quiet = section(c, "effects")!.querySelector('[part="dots"]')!;
    expect(quiet.hasAttribute("hidden")).toBe(true);
  });
});

// ─── Shorthand rows ──────────────────────────────────────────────────────────

describe("shorthand rows", () => {
  test("a set longhand auto-expands and seeds the shorthand placeholder", async () => {
    setupTab({ paddingTop: "4px" });
    const c = await renderPanel();
    expect(input(row(c, "padding"))!.getAttribute("placeholder")).toBe("4px 0 0 0");
    expect(c.querySelectorAll('[part="row"][data-child="true"]').length).toBe(4);
  });

  test("typing a shorthand value clears longhands and sets the shorthand", async () => {
    setupTab({ paddingTop: "4px" });
    const c = await renderPanel();
    fire(input(row(c, "padding")), "input", "8px");
    await settle();
    expect(selectedNode().style?.padding).toBe("8px");
    expect(selectedNode().style?.paddingTop).toBeUndefined();
  });

  test("shorthand-only value starts collapsed; the expander opens the child rows", async () => {
    const tab = setupTab({ padding: "1px 2px 3px 4px" });
    let c = await renderPanel();
    expect(c.querySelectorAll('[part="row"][data-child="true"]').length).toBe(0);
    click(row(c, "padding")!.querySelector('[part="expand"]'));
    await settle();
    expect(tab.session.ui.styleShorthands.padding).toBe(true);
    c = await renderPanel();
    const childProps = [...c.querySelectorAll<HTMLElement>('[part="row"][data-child="true"]')].map(
      (r) => r.dataset.prop,
    );
    expect(childProps).toEqual(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]);
  });

  test("clearing one expanded longhand recompresses the shorthand", async () => {
    const tab = setupTab({ padding: "1px 2px 3px 4px" });
    tab.session.ui.styleShorthands = { padding: true };
    const c = await renderPanel();
    click(childRow(c, "paddingTop")!.querySelector('[part="chip"]'));
    await settle();
    expect(selectedNode().style?.padding).toBe("0 2px 3px 4px");
  });

  test("clearing a longhand also folds other explicit longhands into the shorthand", async () => {
    const tab = setupTab({ padding: "1px 2px 3px 4px", paddingLeft: "5px" });
    tab.session.ui.styleShorthands = { padding: true };
    const c = await renderPanel();
    click(childRow(c, "paddingTop")!.querySelector('[part="chip"]'));
    await settle();
    expect(selectedNode().style?.padding).toBe("0 2px 3px 5px");
    expect(selectedNode().style?.paddingLeft).toBeUndefined();
  });

  test("editing a longhand clears other explicit longhands before recommitting", async () => {
    const tab = setupTab({ border: "1px solid red", borderColor: "blue" });
    tab.session.ui.styleShorthands = { border: true };
    const c = await renderPanel();
    fire(input(childRow(c, "borderStyle")), "input", "dotted");
    await settle();
    expect(selectedNode().style?.border).toBe("1px dotted blue");
    expect(selectedNode().style?.borderColor).toBeUndefined();
  });

  test("the shorthand chip clears the shorthand and all set longhands", async () => {
    setupTab({ padding: "4px", paddingLeft: "2px" });
    const c = await renderPanel();
    click(chip(c, "padding"));
    await settle();
    expect(selectedNode().style).toBeUndefined();
  });

  test("border-side shorthand expands into width/style/color and recommits on child edit", async () => {
    const tab = setupTab({ border: "1px solid red" });
    tab.session.ui.styleShorthands = { border: true };
    const c = await renderPanel();
    expect(childRow(c, "borderStyle")).not.toBeNull();
    fire(input(childRow(c, "borderStyle")), "input", "dashed");
    await settle();
    expect(selectedNode().style?.border).toBe("1px dashed red");
  });

  test("clearing a border-side child drops the empty token", async () => {
    const tab = setupTab({ border: "1px solid red" });
    tab.session.ui.styleShorthands = { border: true };
    const c = await renderPanel();
    click(childRow(c, "borderStyle")!.querySelector('[part="chip"]'));
    await settle();
    expect(selectedNode().style?.border).toBe("1px red");
  });

  test("inherited base values surface as placeholders on higher breakpoints", async () => {
    const tab = setupTab({ padding: "9px" }, { media: true });
    tab.session.ui.activeMedia = "md";
    tab.session.ui.styleSections = { spacing: true };
    let c = await renderPanel();
    expect(input(row(c, "padding"))!.getAttribute("placeholder")).toBe("9px");

    const tab2 = setupTab({ paddingTop: "3px" }, { media: true });
    tab2.session.ui.activeMedia = "md";
    tab2.session.ui.styleSections = { spacing: true };
    c = await renderPanel();
    expect(input(row(c, "padding"))!.getAttribute("placeholder")).toBe("3px 0 0 0");
  });
});

// ─── Section accordion ───────────────────────────────────────────────────────

describe("section accordion", () => {
  test("an open section's clear dot clears every set prop including shorthand longhands", async () => {
    setupTab({ padding: "4px", paddingTop: "1px" });
    const c = await renderPanel();
    click(section(c, "spacing")!.querySelector('[part="dot"][data-clear="spacing"]'));
    await settle();
    expect(selectedNode().style).toBeUndefined();
  });

  test("toggling an open section persists the open state", async () => {
    const tab = setupTab({ display: "flex" });
    const c = await renderPanel();
    await toggleSection(section(c, "layout"), false);
    expect(tab.session.ui.styleSections.layout).toBe(false);
  });

  test("a closed section draws no rows but still offers its clear-all dot", async () => {
    const tab = setupTab({
      ":hover": {
        display: { unexpected: true } as unknown as string,
        paddingTop: { unexpected: true } as unknown as string,
      },
    });
    tab.session.ui.activeSelector = ":hover";
    let c = await renderPanel();
    // A property row, specifically: an object under `:hover` is a nested RULE, and that section
    // Draws a row of its own under the same name.
    expect(row(c, "display", "field")).toBeNull(); // Section is closed → no rows
    click(section(c, "layout")!.querySelector('[part="dot"][data-clear="layout"]'));
    await settle();
    const hover = selectedNode().style?.[":hover"] as Record<string, unknown>;
    expect(hover.display).toBeUndefined();
    expect(hover.paddingTop).toBeDefined();

    c = await renderPanel();
    click(section(c, "spacing")!.querySelector('[part="dot"][data-clear="spacing"]'));
    await settle();
    expect(selectedNode().style).toBeUndefined();
  });

  test("toggling a closed section open persists the state", async () => {
    const tab = setupTab({});
    const c = await renderPanel();
    await toggleSection(section(c, "border"), true);
    expect(tab.session.ui.styleSections.border).toBe(true);
  });
});

// ─── The number + unit control ───────────────────────────────────────────────

describe("the number + unit control", () => {
  test("a length shows its number alone, and the chooser wears its unit", async () => {
    const tab = setupTab({ width: "500px" });
    tab.session.ui.styleSections = { size: true };
    const c = await renderPanel();
    const r = row(c, "width")!;
    expect(input(r)!.value).toBe("500");
    expect(r.querySelector('[part="group-open"]')!.textContent!.trim()).toBe("px");
  });

  test("a value that only partially parses shows its leading number and is left alone", async () => {
    const tab = setupTab({ width: "10px 20px" });
    tab.session.ui.styleSections = { size: true };
    const c = await renderPanel();
    expect(input(row(c, "width"))!.value).toBe("10");
  });

  test("a keyword shows itself, and the chooser falls back to the first unit", async () => {
    const tab = setupTab({ width: "auto" });
    tab.session.ui.styleSections = { size: true };
    const c = await renderPanel();
    const r = row(c, "width")!;
    expect(input(r)!.value).toBe("auto");
    expect(r.querySelector('[part="group-open"]')!.textContent!.trim()).toBe("px");
  });

  test("an inherited length contributes its NUMBER as the placeholder, not its unit", async () => {
    const tab = setupTab({ width: "500px" }, { media: true });
    tab.session.ui.activeMedia = "md";
    tab.session.ui.styleSections = { size: true };
    const c = await renderPanel();
    expect(input(row(c, "width"))!.getAttribute("placeholder")).toBe("500");
  });

  test("typing a bare number re-attaches the current unit; emptying clears the property", async () => {
    const tab = setupTab({ width: "500px" });
    tab.session.ui.styleSections = { size: true };
    const c = await renderPanel();
    fire(input(row(c, "width")), "change", "12");
    await settle();
    expect(selectedNode().style?.width).toBe("12px");
    fire(input(row(c, "width")), "change", "  ");
    await settle();
    expect(selectedNode().style?.width).toBeUndefined();
  });

  test("the unit list re-commits the number under a new unit, and a keyword outright", async () => {
    const tab = setupTab({ width: "500px" });
    tab.session.ui.styleSections = { size: true };
    const c = await renderPanel();
    const units = await openList(chooser(row(c, "width")));
    const ids = units.map((el) => el.dataset.commandId);
    expect(ids).toContain("rem");
    expect(ids).toContain("auto");
    click(listRow(units, "rem"));
    await settle();
    expect(selectedNode().style?.width).toBe("500rem");

    await pickFrom(chooser(row(c, "width")), "auto");
    expect(selectedNode().style?.width).toBe("auto");
  });

  test("choosing a unit with no number to attach it to commits nothing", async () => {
    const tab = setupTab({ width: "auto" });
    tab.session.ui.styleSections = { size: true };
    const c = await renderPanel();
    await pickFrom(chooser(row(c, "width")), "px");
    expect(selectedNode().style?.width).toBe("auto");
  });
});

// ─── The number control ──────────────────────────────────────────────────────

describe("the number control", () => {
  test("a bounded number draws a number field carrying its own bounds, and commits on change", async () => {
    const tab = setupTab({ opacity: "0.5" });
    tab.session.ui.styleSections = { effects: true };
    const c = await renderPanel();
    const r = row(c, "opacity")!;
    // The bounds come off the property's own schema and reach the native control, so IT refuses
    // Out-of-range input rather than the panel checking it afterwards.
    const field = input(r, "number")!;
    expect(field.getAttribute("min")).toBe("0");
    expect(field.getAttribute("max")).toBe("1");
    expect(field.getAttribute("step")).toBe("0.1");
    fire(input(r, "number"), "change", "0.25");
    await settle();
    expect(selectedNode().style?.opacity).toBe("0.25");
  });
});

// ─── Keyword and font lists ──────────────────────────────────────────────────

/*
 * A keyword row is one `jx-combobox` with `allows-custom-value` (ui.md §5.3): the field is the
 * value and the rows under it are the values worth offering. The unit row and the font row stay
 * the `group` composite — a field beside a kit MENU — because their lists run verbs rather than
 * commit values; the font row is a combobox too, because a menu row cannot draw itself in its own
 * face and a font is chosen by looking, and what its commit WRITES is the adapter's.
 */
describe("keyword and font lists", () => {
  /** The keyword rows a combobox row lists, by value, once its chevron has opened them. */
  async function keywordRows(scope: HTMLElement | null): Promise<string[]> {
    const field = scope?.querySelector<HTMLElement>('jx-combobox[part="text"]');
    expect(field).toBeTruthy();
    click(field!.querySelector('[part="toggle"]'));
    await flush(2);
    return [...field!.querySelectorAll<HTMLElement>("jx-option")].map(
      (el) => el.getAttribute("value") ?? "",
    );
  }

  test("an enum row is a combobox over its values, and taking one commits it", async () => {
    const tab = setupTab({ textTransform: "uppercase" });
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    const scope = row(c, "textTransform");
    /* Not the group composite: there is no chooser button and no menu to open. */
    expect(chooser(scope)).toBeNull();
    const values = await keywordRows(scope);
    expect(values).toContain("lowercase");
    const option = scope!.querySelector<HTMLElement>('jx-option[value="lowercase"]');
    expect(option?.getAttribute("label")).toBe("Lowercase");
    option!.click();
    await settle();
    expect(selectedNode().style?.textTransform).toBe("lowercase");
    expect(input(scope)!.value).toBe("lowercase");
  });

  test("the field stays free text — an enum is a list of suggestions, not a whitelist", async () => {
    const tab = setupTab({ textTransform: "uppercase" });
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    fire(input(row(c, "textTransform")), "change", "full-width");
    await settle();
    expect(selectedNode().style?.textTransform).toBe("full-width");
  });

  test("a font token shows unwrapped, and the list is every project font as its own specimen", async () => {
    /* The site's fonts and the document's together, because a project declares its fonts once, in
       `project.json`, and a list that read only the document offered a component none of them. */
    resetStudioState({
      projectConfig: { style: { "--font-ui": "Inter, sans-serif" } },
    });
    const doc = {
      children: [{ style: { fontFamily: "var(--font-body)" }, tagName: "section" }],
      style: {
        "--font-body": "Georgia, serif",
        "--font-display": "var(--font-ui)",
        "--font-nested": { not: "a font" },
      },
      tagName: "div",
    } as unknown as JxMutableNode;
    const tab = resetWorkspaceWithTab(doc);
    tab.session.selection = [["children", 0]];
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    const scope = row(c, "fontFamily");
    expect(input(scope)!.value).toBe("--font-body");
    /* A combobox over jx-option rows, not the group composite with a menu: a menu row is an action
       and cannot draw itself in a typeface, and a font is chosen by looking. */
    expect(chooser(scope)).toBeNull();
    const values = await keywordRows(scope);
    expect(values.slice(0, 3)).toEqual(["--font-ui", "--font-body", "--font-display"]);
    const option = (value: string) =>
      scope!.querySelector<HTMLElement>(`jx-option[value="${value}"]`)!;
    expect(option("--font-body").getAttribute("label")).toBe("Body");
    expect(option("--font-body").getAttribute("description")).toBe("--font-body");
    expect(option("--font-body").getAttribute("face")).toBe("Georgia, serif");
    /* An alias is followed to the stack at the end of the chain, so the row is set in a real face. */
    expect(option("--font-display").getAttribute("face")).toBe("Inter, sans-serif");
    /* The presets follow, each in its own face, named by the token a pick would mint. */
    const preset = option("--font-geometric-humanist");
    expect(preset.getAttribute("label")).toBe("Geometric Humanist");
    expect(preset.getAttribute("face")).toContain("Avenir");
    expect(preset.getAttribute("description")).toBe("");

    option("--font-display").click();
    await settle();
    expect(selectedNode().style?.fontFamily).toBe("var(--font-display)");
    expect(input(row(c, "fontFamily"))!.value).toBe("--font-display");
  });

  test("choosing a preset mints the token first, and never overwrites one that exists", async () => {
    resetStudioState();
    const doc = {
      children: [{ style: {}, tagName: "section" }],
      tagName: "div",
    } as unknown as JxMutableNode;
    const tab = resetWorkspaceWithTab(doc);
    tab.session.selection = [["children", 0]];
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    const values = await keywordRows(row(c, "fontFamily"));
    const varName = "--font-geometric-humanist";
    expect(values).toContain(varName);
    row(c, "fontFamily")!.querySelector<HTMLElement>(`jx-option[value="${varName}"]`)!.click();
    await settle();
    const minted = activeTab.value!.doc.document.style?.[varName];
    expect(typeof minted).toBe("string");
    expect(minted).toContain("Avenir");
    expect(selectedNode().style?.fontFamily).toBe(`var(${varName})`);

    // Committing it again finds the token already there and leaves its value alone.
    fire(input(row(c, "fontFamily")), "change", varName);
    await settle();
    expect(activeTab.value!.doc.document.style?.[varName]).toBe(minted);
    /* And, minted, it is a token row now: named for what it is, with its name beside it. */
    await keywordRows(row(c, "fontFamily"));
    const minted_row = row(c, "fontFamily")!.querySelector(`jx-option[value="${varName}"]`)!;
    expect(minted_row.getAttribute("description")).toBe(varName);
  });

  test("a typed stack is the value itself, a typed token name is a reference, and typing mints nothing", async () => {
    setupTab({ fontFamily: "var(--font-body)" });
    activeTab.value!.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    fire(input(row(c, "fontFamily")), "change", "Georgia, serif");
    await settle();
    expect(selectedNode().style?.fontFamily).toBe("Georgia, serif");

    /* A token name that is no preset's is pointed at as it is: the reader knows a token the
       editor cannot see, and inventing a value for it would be worse than trusting them. */
    fire(input(row(c, "fontFamily")), "change", "--font-ui");
    await settle();
    expect(selectedNode().style?.fontFamily).toBe("var(--font-ui)");
    expect(activeTab.value!.doc.document.style).toBeUndefined();

    /* The debounced edit that follows a keystroke commits the reference and mints nothing: a
       reader halfway through a preset's name has not asked for a token. */
    fire(input(row(c, "fontFamily")), "input", "--font-geometric-humanist");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 450);
    });
    await settle();
    expect(selectedNode().style?.fontFamily).toBe("var(--font-geometric-humanist)");
    expect(activeTab.value!.doc.document.style).toBeUndefined();

    fire(input(row(c, "fontFamily")), "change", "");
    await settle();
    expect(selectedNode().style?.fontFamily).toBeUndefined();
  });

  test("a typography row draws each value as itself, in the element's own face", async () => {
    resetStudioState();
    const doc = {
      children: [
        {
          style: {
            fontFamily: "var(--font-body)",
            fontStyle: "normal",
            fontVariant: "normal",
            fontWeight: "400",
            textDecoration: "none",
            textTransform: "none",
            whiteSpace: "normal",
          },
          tagName: "section",
        },
      ],
      style: { "--font-body": "Georgia, serif" },
      tagName: "div",
    } as unknown as JxMutableNode;
    const tab = resetWorkspaceWithTab(doc);
    tab.session.selection = [["children", 0]];
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    const option = (prop: string, value: string) =>
      row(c, prop)!.querySelector<HTMLElement>(`jx-option[value="${value}"]`)!;
    /* Each axis reaches its row through the jx-option channel that draws it — a weight at that
       weight, an italic leaning, a transform applied to the words without changing them — and
       every one of them in the typeface the element is actually set in, followed through the
       token, so `700` reads as 700 in Georgia rather than in the panel's own face. */
    expect(option("fontWeight", "700").getAttribute("weight")).toBe("700");
    expect(option("fontWeight", "700").getAttribute("face")).toBe("Georgia, serif");
    expect(option("fontWeight", "700").getAttribute("label")).toBe("700");
    expect(option("fontStyle", "italic").getAttribute("slant")).toBe("italic");
    expect(option("fontVariant", "small-caps").getAttribute("variant")).toBe("small-caps");
    expect(option("textTransform", "uppercase").getAttribute("transform")).toBe("uppercase");
    expect(option("textTransform", "uppercase").getAttribute("label")).toBe("Uppercase");
    expect(option("textDecoration", "underline wavy").getAttribute("decoration")).toBe(
      "underline wavy",
    );
    /* A keyword row that is not about type carries no channel at all. */
    expect(option("whiteSpace", "nowrap").getAttribute("weight")).toBe("");
    expect(option("whiteSpace", "nowrap").getAttribute("face")).toBe("");
  });

  test("the preview face is the base context's when the breakpoint sets none, and none when nothing does", async () => {
    /* `inheritedStyle` is the cascade WITHIN the coordinate — the base block under a breakpoint's —
       so a weight edited at `sm` previews in the face the base block set. */
    const tab = setupTab(
      { "@sm": { fontWeight: "400" }, fontFamily: "Georgia, serif" },
      { media: true },
    );
    tab.session.ui.activeMedia = "sm";
    tab.session.ui.styleSections = { typography: true };
    let c = await renderPanel();
    expect(
      row(c, "fontWeight")!.querySelector('jx-option[value="700"]')!.getAttribute("face"),
    ).toBe("Georgia, serif");

    setupTab({ fontWeight: "400" });
    activeTab.value!.session.ui.styleSections = { typography: true };
    c = await renderPanel();
    expect(
      row(c, "fontWeight")!.querySelector('jx-option[value="700"]')!.getAttribute("face"),
    ).toBe("");
  });
});

// ─── The button group ────────────────────────────────────────────────────────

describe("the button group", () => {
  test("one button per offered value, the current one pressed, and a second press clears", async () => {
    setupTab({ display: "flex" });
    const c = await renderPanel();
    const buttons = [...row(c, "display")!.querySelectorAll<HTMLElement>('[part="button"]')];
    expect(buttons.map((b) => b.dataset.value)).toEqual([
      "flex",
      "grid",
      "block",
      "inline",
      "none",
    ]);
    const flex = buttons.find((b) => b.dataset.value === "flex")!;
    expect(flex.dataset.selected).toBe("");
    expect(flex.querySelector('[part="control"]')!.getAttribute("aria-pressed")).toBe("true");
    click(buttons.find((b) => b.dataset.value === "grid"));
    await settle();
    expect(selectedNode().style?.display).toBe("grid");
    click(row(c, "display")!.querySelector('[part="button"][data-value="grid"]'));
    await settle();
    expect(selectedNode().style?.display).toBeUndefined();
  });

  test("values that do not fit are the overflow list, and it commits like any other", async () => {
    setupTab({ display: "flex" });
    const c = await renderPanel();
    const rows = await openList(chooser(row(c, "display")));
    const ids = rows.map((el) => el.dataset.commandId);
    expect(ids).toContain("inline-block");
    expect(ids).not.toContain("flex");
    click(listRow(rows, "inline-block"));
    await settle();
    expect(selectedNode().style?.display).toBe("inline-block");
  });
});

// ─── The colour row ──────────────────────────────────────────────────────────

/*
 * This block used to assert that a colour row drew an announced `[part="control-host"]` and that
 * `ui/color-selector.ts` filled it with an `sp-swatch` and an `sp-overlay`. `ui.md` §5.6 landed, so
 * the island is gone and what is asserted instead is the contract the kit's field gave the tab: it
 * holds the row's value, its own gestures commit through the tab's two verbs, and a token stays a
 * token on the way through.
 */

/** The colour field of a row, and the palette slotted into its picker. */
function colourField(container: HTMLElement, prop = "color") {
  return row(container, prop)?.querySelector<HTMLElement & { value: string }>(
    'jx-color-field[part="color-field"]',
  );
}

function swatches(container: HTMLElement, prop = "color") {
  return [
    ...(row(container, prop)?.querySelectorAll<HTMLElement>('jx-swatch[part="token"]') ?? []),
  ];
}

describe("the colour row", () => {
  test("a colour row is the kit's field, holding the row's own value", async () => {
    const tab = setupTab({ color: "#ff0000" });
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    const field = colourField(c)!;
    expect(field).not.toBeNull();
    expect(field.value).toBe("#ff0000");
    // The row is named by the property it edits, as every other row is.
    expect(input(row(c, "color"), "text")!.value).toBe("#ff0000");
  });

  test("a value the field cannot decompose is kept verbatim rather than refused", async () => {
    const tab = setupTab({ color: "var(--color-accent)" });
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    /* The whole reason the conversion was possible: a token is a perfectly good colour that only
       the browser can resolve, and the field shows it rather than replacing it with black. */
    expect(colourField(c)!.value).toBe("var(--color-accent)");
    expect(input(row(c, "color"), "text")!.value).toBe("var(--color-accent)");
    /* A token the effective style does not define resolves to nothing, and the field is told so. */
    expect(colourField(c)!.resolved).toBe("");
  });

  test("a token value hands the field the literal behind it, so the chip can draw it", async () => {
    /* `var(--color-accent)` resolves in the canvas and nowhere in Studio's own page, so the chip
       drew the no-colour checkerboard the moment a swatch was picked. The row follows the token
       through the effective style — the site's block under the document's — to the colour. */
    resetStudioState({ projectConfig: { style: { "--color-accent": "#0d9488" } } });
    const doc = {
      children: [{ style: { color: "var(--color-ink)" }, tagName: "section" }],
      style: { "--color-ink": "var(--color-accent)" },
      tagName: "div",
    } as unknown as JxMutableNode;
    const tab = resetWorkspaceWithTab(doc);
    tab.session.selection = [["children", 0]];
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    const field = colourField(c)!;
    expect(field.value).toBe("var(--color-ink)");
    expect(field.resolved).toBe("#0d9488");
    expect(field.dataset["resolved"]).toBe("#0d9488");
    expect(field.style.getPropertyValue("--jx-color-field-preview")).toBe("#0d9488");

    /* Picking the other token re-answers, and a literal draws itself with nothing resolved. */
    click(swatches(c)[0]!.querySelector('[part="control"]'));
    await settle();
    expect(selectedNode().style?.color).toBe("var(--color-accent)");
    expect(colourField(c)!.resolved).toBe("#0d9488");
    fire(input(row(c, "color"), "text"), "change", "#ff0000");
    await settle();
    expect(colourField(c)!.resolved).toBe("");
    expect(colourField(c)!.style.getPropertyValue("--jx-color-field-preview")).toBe("#ff0000");
  });

  test("typing a colour into the field commits it; a word that is not one commits nothing", async () => {
    const tab = setupTab({ color: "#ff0000" });
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    fire(input(row(c, "color"), "text"), "change", "not a colour");
    await settle();
    /* The field refuses it and stops the text box's own event at its root, so the tab never hears
       a commit — which is exactly what a listener bound ON the field instead of above it would
       have got wrong. */
    expect(selectedNode().style?.color).toBe("#ff0000");

    fire(input(row(c, "color"), "text"), "change", "#00ff00");
    await settle();
    expect(selectedNode().style?.color).toBe("#00ff00");
  });

  test("moving the hue track commits the colour the field composed", async () => {
    const tab = setupTab({ color: "#ff0000" });
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    const hue = row(c, "color")!.querySelector<HTMLInputElement>('[part="hue"] [part="input"]')!;
    fire(hue, "input", "200");
    await settle();
    // The commit is the FIELD's value, not the track's number.
    expect(selectedNode().style?.color).toBe("#00aaff");
  });

  test("the project's colour tokens are the palette, and choosing one commits the reference", async () => {
    resetStudioState();
    const doc = {
      children: [{ style: { color: "#111111" }, tagName: "section" }],
      style: { "--color-accent": "#ff0000", "--color-ink": "#0000ff", "--space-2": "8px" },
      tagName: "div",
    } as unknown as JxMutableNode;
    const tab = resetWorkspaceWithTab(doc);
    tab.session.selection = [["children", 0]];
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();

    const chips = swatches(c);
    // Only the `--color-*` custom properties, and a swatch is named rather than read out as a hex.
    expect(chips.map((el) => el.dataset.token)).toEqual([
      "var(--color-accent)",
      "var(--color-ink)",
    ]);
    expect(
      chips.map((el) => el.querySelector('[part="control"]')?.getAttribute("aria-label")),
    ).toEqual(["Accent", "Ink"]);
    expect(chips.map((el) => el.style.getPropertyValue("--jx-swatch-color"))).toEqual([
      "#ff0000",
      "#0000ff",
    ]);

    click(chips[1]!.querySelector('[part="control"]'));
    await settle();
    /* The REFERENCE, not the literal behind it: the field itself cannot parse a token and declines
       it, which is what leaves the group's own answer standing. */
    expect(selectedNode().style?.color).toBe("var(--color-ink)");
    await settle();
    expect(swatches(c)[1]!.dataset.chosen).toBe("");
  });

  test("a document with no colour tokens draws no palette at all", async () => {
    const tab = setupTab({ color: "#ff0000" });
    tab.session.ui.styleSections = { typography: true };
    const c = await renderPanel();
    // An empty radiogroup is a thing a reader is told about and cannot use.
    expect(row(c, "color")!.querySelectorAll('[part="palette"]').length).toBe(0);
  });
});

// ─── Custom section ──────────────────────────────────────────────────────────

describe("custom section", () => {
  test("unknown props render as key/value pairs; value edits commit", async () => {
    setupTab({ foo: "bar" });
    const c = await renderPanel();
    const pair = row(c, "foo")!;
    expect(input(pair, "kv-key")!.value).toBe("foo");
    fire(input(pair, "kv-value"), "input", "baz");
    await settle();
    expect(selectedNode().style?.foo).toBe("baz");
  });

  test("renaming the key moves the value; same or empty name is a no-op", async () => {
    const tab = setupTab({ foo: "bar" });
    let c = await renderPanel();
    fire(input(row(c, "foo"), "kv-key"), "change", "qux");
    await settle();
    expect(selectedNode().style?.foo).toBeUndefined();
    expect(selectedNode().style?.qux).toBe("bar");

    c = await renderPanel();
    const before = tab.history.snapshots.length;
    fire(input(row(c, "qux"), "kv-key"), "change", "qux");
    fire(input(row(c, "qux"), "kv-key"), "change", "  ");
    await settle();
    expect(tab.history.snapshots.length).toBe(before);
    expect(selectedNode().style?.qux).toBe("bar");
  });

  test("the remove button drops the custom prop", async () => {
    setupTab({ foo: "bar" });
    const c = await renderPanel();
    click(row(c, "foo")!.querySelector('[part="kv-remove"]'));
    await settle();
    expect(selectedNode().style).toBeUndefined();
  });

  test("Enter in the add field seeds the CSS initial value and empties the field", async () => {
    setupTab({ foo: "bar" });
    const c = await renderPanel();
    const adder = input(row(c, "+add"), "kv-add")!;
    adder.value = "zoom";
    adder.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await settle();
    expect(selectedNode().style?.zoom).toBe("1");
    expect(adder.value).toBe("");
  });

  test("the add field ignores empty names and non-Enter keys", async () => {
    const tab = setupTab({ foo: "bar" });
    const c = await renderPanel();
    const adder = input(row(c, "+add"), "kv-add")!;
    const before = tab.history.snapshots.length;
    adder.value = "zoom";
    adder.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
    adder.value = "   ";
    adder.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await settle();
    expect(tab.history.snapshots.length).toBe(before);
  });

  test("toggle persists the Custom section open state", async () => {
    const tab = setupTab({});
    const c = await renderPanel();
    await toggleSection(section(c, "other"), true);
    expect(tab.session.ui.styleSections.other).toBe(true);
  });
});

// ─── Relative styling (nested rules) ─────────────────────────────────────────

describe("relative styling section", () => {
  function nestedTab() {
    const tab = setupTab({ table: { textTransform: "uppercase", th: { color: "blue" } } });
    tab.session.ui.activeSelector = "table";
    return tab;
  }

  test("a nested rule opens as a compound selector", async () => {
    nestedTab();
    const c = await renderPanel();
    click(row(c, "th")!.querySelector('[part="nested-open"]'));
    expect(selectStylebookTagMock).toHaveBeenCalledWith("table th", undefined, {
      panCanvas: true,
    });
  });

  test("the remove button drops the nested rule and nothing else", async () => {
    nestedTab();
    const c = await renderPanel();
    click(row(c, "th")!.querySelector('[part="nested-remove"]'));
    await settle();
    const table = selectedNode().style?.table as Record<string, unknown>;
    expect(table.th).toBeUndefined();
    expect(table.textTransform).toBe("uppercase");
  });

  test("+ Add opens a selector dialog and creates an empty rule; blank or cancel is ignored", async () => {
    nestedTab();

    /** Press the section's "+ Add" and let the prompt dialog render. */
    async function clickAdd(container: HTMLElement) {
      click(container.querySelector('[part="nested-add"]'));
      await flush();
    }

    let c = await renderPanel();
    await clickAdd(c);

    expect(topDialog()).not.toBeNull();
    expect(topDialog()!.getAttribute("headline")).toBe("Add Nested Selector");
    expect(topDialog()!.getAttribute("confirm-label")).toBe("Add");

    await answerPromptDialog(" td ");
    await settle();
    const table = selectedNode().style?.table as Record<string, unknown>;
    expect(table.td).toEqual({});

    // Cancelling adds nothing.
    c = await renderPanel();
    await clickAdd(c);
    await answerPromptDialog(null);

    // A blank selector is rejected in place, leaving the dialog open and the style untouched.
    c = await renderPanel();
    await clickAdd(c);
    await answerPromptDialog("   ");
    expect(topDialog()).not.toBeNull();
    expect(topDialog()!.querySelector('jx-textfield [part="error"]')?.textContent).toContain(
      "Enter a selector.",
    );
    await answerPromptDialog(null);

    expect(Object.keys(selectedNode().style?.table as Record<string, unknown>).toSorted()).toEqual(
      ["td", "textTransform", "th"].toSorted(),
    );
  });

  test("absent in base mode, and its open state persists", async () => {
    const tab = setupTab({ display: "flex" });
    let c = await renderPanel();
    expect(section(c, "nested")).toBeNull();

    tab.session.ui.activeSelector = "table";
    const tab2 = nestedTab();
    c = await renderPanel();
    await toggleSection(section(c, "nested"), false);
    expect(tab2.session.ui.styleSections.nested).toBe(false);
  });
});

// ─── The surface's own seam ──────────────────────────────────────────────────

/**
 * The three answers `mountStylePanelSurface` gives about ITS host, driven directly.
 *
 * They are what stops the tab standing in a container the dock has taken away: the flow asks
 * `connected()` before it decides a standing mount is still standing, and a bind taken down while
 * the mount is in flight has a surface arriving after the decision was made.
 */
describe("the surface's own seam", () => {
  const NOTHING = {
    addCustom: () => {},
    addNested: () => {},
    chipClick: () => {},
    clearSection: () => {},
    commitText: () => {},
    editText: () => {},
    openNested: () => {},
    pickChoice: () => {},
    pickSource: () => {},
    pressButton: () => {},
    renameCustom: () => {},
    runEmptyAction: () => {},
    setFilter: () => {},
    toggleSection: () => {},
    toggleShorthand: () => {},
  };
  const VIEW = {
    emptyActionLabel: "",
    emptyMessage: "Open a page to style what you click.",
    filter: "",
    hasEmptyAction: false,
    sections: [],
    view: "empty" as const,
  };

  function mountBare(host: HTMLElement) {
    const targets: (HTMLElement | null)[] = [];
    const handle = mountStylePanelSurface(host, VIEW, NOTHING, {
      target: (el) => targets.push(el),
    });
    return { handle, targets };
  }

  test("a mount taken down before it lands is disposed, and never claims the host", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    painted.push(host);
    const { handle, targets } = mountBare(host);
    handle.dispose();
    // The Target Line is told the host is gone, so its own document comes down with this one.
    expect(targets.at(-1)).toBeNull();
    await flush(4);
    expect(handle.connected()).toBe(false);
    expect(host.childNodes.length).toBe(0);
    handle.dispose(); // Idempotent.
  });

  test("connected() answers no once the host it was given is emptied under it", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    painted.push(host);
    const { handle } = mountBare(host);
    await flush(4);
    expect(handle.connected()).toBe(true);
    // What a dock that redrew does: the root is taken away without telling anyone.
    host.replaceChildren();
    expect(handle.connected()).toBe(false);
    handle.dispose();
  });

  test("while a mount is in flight the tab owns the host only while it is still empty", () => {
    const host = document.createElement("div");
    document.body.append(host);
    painted.push(host);
    const { handle } = mountBare(host);
    expect(handle.connected()).toBe(true);
    host.append(document.createElement("span"));
    expect(handle.connected()).toBe(false);
    handle.dispose();
  });
});
