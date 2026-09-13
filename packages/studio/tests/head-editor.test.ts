/**
 * Project Settings › Site head — the `settings-head` surface.
 *
 * The section is a Jx document over the kit now (`src/surfaces/settings-head.json`), mounted by
 * `src/surfaces/settings-head.ts` and reached through the seam the registry holds
 * (`src/settings/head-editor.ts`). So the assertions address `part` names rather than the classes
 * the lit template used to emit, and each one goes through the mounted element the way a reader
 * would: type into the control, dispatch what the browser dispatches, and read the `$head` array
 * the project actually holds.
 */
import { flush, installMockPlatform, key, pointer, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { MockPlatformState } from "./harness";
import type { JxHeadEntry } from "@jxsuite/schema/types";

const { renderHeadEditor } = await import("../src/settings/head-editor");

// ─── Local helpers ────────────────────────────────────────────────────────────

/** Run fn with setTimeout/clearTimeout replaced by immediate invocation (deterministic debounce). */
function withImmediateTimers<T>(fn: () => T): T {
  const origSet = globalThis.setTimeout;
  const origClear = globalThis.clearTimeout;
  (globalThis as any).setTimeout = (cb: () => void) => {
    cb();
    return 0;
  };
  (globalThis as any).clearTimeout = () => {};
  try {
    return fn();
  } finally {
    globalThis.setTimeout = origSet;
    globalThis.clearTimeout = origClear;
  }
}

let platformState: MockPlatformState;

/** Seed project state with a $head array and mount the section into a fresh host. */
async function setup(
  head: JxHeadEntry[] = [],
): Promise<{ host: HTMLElement; head: JxHeadEntry[] }> {
  ({ state: platformState } = installMockPlatform());
  resetStudioState({ projectConfig: { $head: head, name: "demo" } });
  const host = document.createElement("div");
  document.body.append(host);
  renderHeadEditor(host);
  await flush();
  await flush();
  return { head, host };
}

/** Let a structural edit reconcile into the document. */
async function settle(): Promise<void> {
  await flush();
}

function entries(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll('[part="entry"]')] as HTMLElement[];
}

function fontRows(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll('[part="font-row"]')] as HTMLElement[];
}

function fontsSection(host: HTMLElement): HTMLElement {
  return host.querySelector('[data-section="fonts"]') as HTMLElement;
}

function headSection(host: HTMLElement): HTMLElement {
  return host.querySelector('[data-section="head"]') as HTMLElement;
}

/** The kit field carrying one attribute of an entry, by the `$head` key it writes. */
function field(scope: HTMLElement, dataKey: string): HTMLElement {
  const found = scope.querySelector(`[data-key="${dataKey}"]`);
  if (!found) {
    throw new Error(`no field for ${dataKey}`);
  }
  return found as HTMLElement;
}

/** The native control inside a `jx-textfield` — what a reader types into, and what events come from. */
function control(field_: Element): HTMLInputElement | HTMLTextAreaElement {
  return field_.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement;
}

/** Type into a field and dispatch the event the browser would, past the debounce. */
function type(field_: Element, value: string, eventName: "change" | "input" = "change"): void {
  const el = control(field_);
  el.value = value;
  withImmediateTimers(() => {
    el.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
}

/** Type into a field WITHOUT letting the debounce fire — an edit still in flight. */
function typePending(field_: Element, value: string): void {
  const el = control(field_);
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** What the field writing `key` on the entry at `index` is showing. */
function shown(host: HTMLElement, index: number, dataKey: string): string {
  const block = entries(host)[index]!;
  return control(field(block, dataKey)).value;
}

function addButton(host: HTMLElement, tag: string): HTMLElement {
  return host.querySelector(`[part="add-entry"][data-tag="${tag}"]`) as HTMLElement;
}

function fontEntryUrl(family: string): string {
  return `https://fonts.googleapis.com/css2?family=${family.replaceAll(" ", "+")}&display=swap`;
}

async function savedHead(): Promise<JxHeadEntry[]> {
  await flush();
  const raw = platformState.files.get("project.json");
  expect(raw).toBeTruthy();
  return JSON.parse(raw!).$head;
}

beforeEach(() => {
  resetStudioState();
});

afterEach(async () => {
  document.body.replaceChildren();
  await flush();
});

// ─── Head entry rendering ─────────────────────────────────────────────────────

describe("head entry rendering", () => {
  test("renders one block per entry with tag headers and per-tag fields", async () => {
    const { host } = await setup([
      { attributes: { href: "/a.css", rel: "stylesheet" }, tagName: "link" },
      { attributes: { content: "ie=edge", name: "x-ua" }, tagName: "meta" },
      { attributes: { src: "/app.js" }, tagName: "script" },
      { attributes: {}, tagName: "script" },
      { tagName: "style", textContent: ".x{}" } as JxHeadEntry,
      { attributes: {}, tagName: "base" },
    ]);
    const blocks = entries(host);
    expect(blocks.length).toBe(6);
    expect(blocks.map((b) => b.querySelector('[part="entry-tag"]')?.textContent)).toEqual([
      "<link>",
      "<meta>",
      "<script>",
      "<script>",
      "<style>",
      "<base>",
    ]);

    // Link: rel + href, each bound to what the entry holds.
    expect(control(field(blocks[0]!, "rel")).value).toBe("stylesheet");
    expect(control(field(blocks[0]!, "href")).value).toBe("/a.css");

    // Meta: name + content.
    expect(control(field(blocks[1]!, "name")).value).toBe("x-ua");
    expect(control(field(blocks[1]!, "content")).value).toBe("ie=edge");

    // Script with src: the one field, and no inline body.
    expect(control(field(blocks[2]!, "src")).value).toBe("/app.js");
    expect(blocks[2]!.querySelector("textarea")).toBeNull();

    // Script without src: the body box appears beside the src field.
    expect(blocks[3]!.querySelector("textarea")).toBeTruthy();
    expect(field(blocks[3]!, "src")).toBeTruthy();

    // Style: the body box, carrying the entry's text.
    expect((blocks[4]!.querySelector("textarea") as HTMLTextAreaElement).value).toBe(".x{}");

    // Unknown tag: a header and nothing to fill in.
    expect(blocks[5]!.querySelector('[part="entry-fields"]')?.children.length).toBe(0);
  });

  test("a body box is named by the row it sits in, not by a label beside it", async () => {
    const { host } = await setup([{ tagName: "style", textContent: "" } as JxHeadEntry]);
    const row = host.querySelector('[part="body-row"]') as HTMLElement;
    expect(row.querySelector('[part="label"]')?.textContent).toBe("Style body");
    const area = host.querySelector("textarea")!;
    expect(area.getAttribute("aria-labelledby")).toBe(row.querySelector("label")!.id);
    expect(area.getAttribute("aria-labelledby")).toBeTruthy();
    // The code box is the kit's: mono, multiline, and as tall as the entry kind asks for.
    const box = host.querySelector('[part="body-field"]') as HTMLElement;
    expect(box.dataset["mono"]).toBe("");
    expect(box.dataset["rows"]).toBe("8");
  });

  test("a remount that overtakes a pending one leaves one live document", async () => {
    installMockPlatform();
    resetStudioState({ projectConfig: { $head: [], name: "demo" } });
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);
    renderHeadEditor(first);
    renderHeadEditor(first); // Still mounting into this very container — not a second mount.
    renderHeadEditor(second); // Overtakes a mount that has not resolved yet.
    await flush();
    await flush();
    expect(second.querySelector('[part="head-settings"]')).toBeTruthy();
    // The overtaken mount was disposed rather than left to reconcile into a host nobody reads.
    pointer(addButton(second, "meta"), "click");
    await settle();
    expect(second.querySelectorAll('[part="entry"]').length).toBe(1);
    expect(first.querySelectorAll('[part="entry"]').length).toBe(0);
  });

  test("a second render into the same container keeps the mounted document", async () => {
    const { host } = await setup([{ attributes: {}, tagName: "meta" }]);
    const before = host.firstElementChild;
    renderHeadEditor(host);
    await settle();
    expect(host.firstElementChild).toBe(before);
    expect(entries(host).length).toBe(1);
  });
});

// ─── Add / remove entries ─────────────────────────────────────────────────────

describe("add and remove entries", () => {
  test("add buttons append tag-specific defaults and persist", async () => {
    const { host, head } = await setup([]);
    for (const tag of ["link", "meta", "script", "style"]) {
      pointer(addButton(host, tag), "click");
    }
    await settle();

    expect(head).toEqual([
      { attributes: { href: "", rel: "stylesheet" }, tagName: "link" },
      { attributes: { content: "", name: "" }, tagName: "meta" },
      { attributes: { src: "" }, tagName: "script" },
      { attributes: {}, tagName: "style", textContent: "" },
    ]);
    // The section redrew itself with the new entries.
    expect(entries(host).length).toBe(4);
    expect(await savedHead()).toEqual(head);
    const store = await import("../src/store");
    expect(store.projectState?.projectConfig?.$head).toBe(head as any);
  });

  test("delete button removes the entry and persists", async () => {
    const { host, head } = await setup([
      { attributes: { content: "a", name: "first" }, tagName: "meta" },
      { attributes: { content: "b", name: "second" }, tagName: "meta" },
    ]);
    pointer(entries(host)[0]!.querySelector('[part="remove-entry"]')!, "click");
    await settle();

    expect(head.length).toBe(1);
    expect(head[0]!.attributes?.name).toBe("second");
    expect(entries(host).length).toBe(1);
    expect(shown(host, 0, "name")).toBe("second");
    const persisted = await savedHead();
    expect(persisted.length).toBe(1);
  });

  test("a delete button whose entry is already gone changes nothing", async () => {
    const { host, head } = await setup([
      { attributes: { name: "first" }, tagName: "meta" },
      { attributes: { name: "second" }, tagName: "meta" },
    ]);
    const button = entries(host)[0]!.querySelector('[part="remove-entry"]')!;
    pointer(button, "click");
    // The same node again, before the row it named has been drawn away.
    pointer(button, "click");
    await settle();
    expect(head.length).toBe(1);
    expect(head[0]!.attributes?.name).toBe("second");
    expect(entries(host).length).toBe(1);
  });

  test("an edit still in flight is written before a structural change redraws it", async () => {
    const { host, head } = await setup([
      { attributes: { content: "", name: "" }, tagName: "meta" },
    ]);
    typePending(field(entries(host)[0]!, "name"), "viewport");
    // Not written yet — the debounce is still counting.
    expect(head[0]!.attributes?.name).toBe("");

    pointer(addButton(host, "meta"), "click");
    await settle();

    expect(head[0]!.attributes?.name).toBe("viewport");
    expect(shown(host, 0, "name")).toBe("viewport");
  });
});

// ─── Field updates ────────────────────────────────────────────────────────────

describe("field updates", () => {
  test("link field change debounces into attributes (creating them when absent)", async () => {
    const { host, head } = await setup([{ tagName: "link" } as JxHeadEntry]);
    const block = entries(host)[0]!;
    type(field(block, "rel"), "preload");
    type(field(block, "href"), "/new.css");
    expect(head[0]!.attributes).toEqual({ href: "/new.css", rel: "preload" });
  });

  test("meta content change updates attributes.content (not textContent)", async () => {
    const { host, head } = await setup([
      { attributes: { content: "old", name: "desc" }, tagName: "meta" },
    ]);
    type(field(entries(host)[0]!, "content"), "new");
    expect(head[0]!.attributes?.content).toBe("new");
    expect(head[0]!.textContent).toBeUndefined();
  });

  test("inline script and style bodies write textContent via the content key", async () => {
    const { host, head } = await setup([
      { attributes: {}, tagName: "script" },
      { attributes: {}, tagName: "style", textContent: "" },
    ]);
    const [scriptBlock, styleBlock] = entries(host);
    type(field(scriptBlock!, "content"), "console.log(1)", "input");
    type(field(styleBlock!, "content"), "body{margin:0}", "input");
    expect(head[0]!.textContent).toBe("console.log(1)");
    expect(head[1]!.textContent).toBe("body{margin:0}");
    const persisted = await savedHead();
    expect(persisted[1]!.textContent).toBe("body{margin:0}");
  });
});

// ─── Google Fonts section ─────────────────────────────────────────────────────

describe("google fonts", () => {
  function fontInput(host: HTMLElement): HTMLElement {
    return fontsSection(host).querySelector('[part="font-input"]') as HTMLElement;
  }

  /** Type a family name the way a reader does: the control's value, then `input`. */
  function typeFamily(host: HTMLElement, family: string): HTMLElement {
    const el = fontInput(host);
    control(el).value = family;
    control(el).dispatchEvent(new Event("input", { bubbles: true }));
    return el;
  }

  test("shows an empty message without fonts and family names with them", async () => {
    const empty = await setup([]);
    expect(fontsSection(empty.host).textContent).toContain("No fonts imported.");
    expect(fontRows(empty.host).length).toBe(0);

    const withFonts = await setup([
      { attributes: { href: fontEntryUrl("Open Sans"), rel: "stylesheet" }, tagName: "link" },
      { attributes: { href: fontEntryUrl("Inter"), rel: "stylesheet" }, tagName: "link" },
    ]);
    const names = [...withFonts.host.querySelectorAll('[part="font-name"]')].map(
      (s) => s.textContent,
    );
    expect(names).toEqual(["Open Sans", "Inter"]);
    // Every entry is still listed under Head, fonts included.
    expect(entries(withFonts.host).length).toBe(2);
  });

  test("Enter in the family field adds preconnects plus the stylesheet link", async () => {
    const { host, head } = await setup([]);
    const input = typeFamily(host, "Open Sans");
    key(control(input), "Enter");
    await settle();

    expect(head.length).toBe(3);
    expect(head[0]).toEqual({
      attributes: { href: "https://fonts.googleapis.com", rel: "preconnect" },
      tagName: "link",
    });
    expect(head[1]).toEqual({
      attributes: { crossorigin: "", href: "https://fonts.gstatic.com", rel: "preconnect" },
      tagName: "link",
    });
    expect(head[2]!.attributes?.href).toBe(fontEntryUrl("Open Sans"));
    expect(control(fontInput(host)).value).toBe(""); // Cleared after adding
    expect(fontsSection(host).textContent).toContain("Open Sans"); // Redrawn
    const persisted = await savedHead();
    expect(persisted.length).toBe(3);
  });

  test("Enter with an empty field and non-Enter keys are no-ops", async () => {
    const { host, head } = await setup([]);
    typeFamily(host, "   ");
    key(control(fontInput(host)), "Enter");
    await settle();
    expect(head.length).toBe(0);

    typeFamily(host, "Inter");
    key(control(fontInput(host)), "a");
    await settle();
    expect(head.length).toBe(0);
  });

  test("+ Add reads the family field; an empty one is a no-op", async () => {
    const { host, head } = await setup([]);
    const button = fontsSection(host).querySelector('[part="add-font"]')!;
    pointer(button, "click"); // Nothing typed → nothing happens
    await settle();
    expect(head.length).toBe(0);

    typeFamily(host, "Roboto");
    pointer(button, "click");
    await settle();
    expect(head.length).toBe(3); // 2 preconnects + stylesheet
    expect(head[2]!.attributes?.href).toBe(fontEntryUrl("Roboto"));
    expect(control(fontInput(host)).value).toBe("");
  });

  test("removing the last font also strips preconnects; earlier fonts keep them", async () => {
    const { host, head } = await setup([]);
    typeFamily(host, "Open Sans");
    key(control(fontInput(host)), "Enter");
    await settle();
    typeFamily(host, "Inter");
    key(control(fontInput(host)), "Enter");
    await settle();
    expect(head.length).toBe(4); // 2 preconnects + 2 stylesheets (preconnects deduped)

    // Remove "Open Sans" — the preconnects survive because Inter remains.
    pointer(fontRows(host)[0]!.querySelector('[part="remove-font"]')!, "click");
    await settle();
    expect(head.length).toBe(3);
    expect(head.filter((e) => e.attributes?.rel === "preconnect").length).toBe(2);
    expect(fontRows(host).length).toBe(1);

    // Remove the last font — the preconnects go with it, in place.
    pointer(fontRows(host)[0]!.querySelector('[part="remove-font"]')!, "click");
    await settle();
    expect(head.length).toBe(0);
    expect(fontsSection(host).textContent).toContain("No fonts imported.");
    expect(entries(host).length).toBe(0);
    expect(headSection(host).textContent).toContain("Head");
  });
});
