/**
 * The inspector's "Used on N pages →" line, and the `selection.findUsages` record behind it.
 *
 * The tests that matter are the two ways of not knowing. A backend without the capability renders
 * NO section — a confident "Not used yet" for a component on every page is the failure this whole
 * workstream exists to prevent — and a failed query renders a section that says so and offers Retry
 * rather than quietly answering zero.
 */

import { flush, installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import { componentRegistry } from "../src/files/components";
import { invalidateUsages } from "../src/services/references";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import { emptyContext, makeContext } from "../src/commands/context";
import { shell } from "../src/shell";
import type { ReferencesResult, StudioPlatform } from "../src/types";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** `files/files.ts` pulls half the app in; the row only needs to prove it calls openFileInTab. */
const openFileInTab = mock(async (_path: string) => {});
void mock.module("../src/files/files", () => ({ openFileInTab }));

// Dynamic, and after the mock: properties-panel imports files/files at module scope.
const { bindContentHost, inspectorCommands, inspectorSectionKeys, renderPropertiesPanel } =
  await import("../src/panels/properties-panel");

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  if (!document.querySelector(`#${id}`)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
}
initLayers();

let host: HTMLElement | null = null;

/** Mount the Content tab once for this test, then bring the standing document up to date. */
async function renderPanel(): Promise<HTMLElement> {
  if (!host) {
    host = document.createElement("div");
    document.body.append(host);
    bindContentHost(host);
  }
  renderPropertiesPanel();
  await flush(6);
  return host;
}

const CARD_DOC = {
  children: [{ children: [], tagName: "my-card" }],
  tagName: "div",
} as unknown as JxMutableNode;

function usageResult(over: Partial<ReferencesResult> = {}): ReferencesResult {
  return {
    errors: [],
    files: [
      {
        count: 2,
        path: "pages/index.json",
        refs: [{ count: 2, ref: "<my-card>", refType: "tagName" }],
      },
      {
        count: 1,
        path: "pages/about.json",
        refs: [{ count: 1, ref: "<my-card>", refType: "tagName" }],
      },
      {
        count: 1,
        path: "components/hero.json",
        refs: [{ count: 1, ref: "./card.json", refType: "$ref" }],
      },
    ],
    filesReferencing: 3,
    path: "components/card.json",
    refsTotal: 4,
    tagName: "my-card",
    ...over,
  };
}

/** Select the `<my-card>` instance in a fresh document, with the registry knowing its definition. */
function selectCard(): void {
  const tab = resetWorkspaceWithTab(CARD_DOC);
  tab.session.selection = [["children", 0]] as never;
  componentRegistry.length = 0;
  componentRegistry.push({ path: "components/card.json", tagName: "my-card" });
}

/** The Usage section, whatever its heading currently says — the count IS the heading. */
function usageSection(root: Element): (HTMLElement & { label: string; open: boolean }) | null {
  return root.querySelector('[data-section="__usages"]') as
    | (HTMLElement & { label: string; open: boolean })
    | null;
}

/** The sentence the Usage section says when it has no list to show. */
function note(root: Element): string {
  return usageSection(root)?.querySelector('[part="note"]')?.textContent ?? "";
}

afterEach(() => {
  bindContentHost(null);
  host?.remove();
  host = null;
});

beforeEach(() => {
  shell.layoutSelection = null;
  componentRegistry.length = 0;
  invalidateUsages();
  resetStudioState({ projectRoot: "/p", selectedPath: null });
  closeAllTabs();
});

describe("the Usage section", () => {
  test("names the count in its heading and lists the referencing files", async () => {
    /* The query is held open, because a mounted document settles over several turns and an
       immediately-resolved promise would land before the first projection — so "cold" would be a
       state no assertion could ever see. Held, it is the state the reader actually gets. */
    let release: (() => void) | null = null;
    installMockPlatform({
      findReferences: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return usageResult();
      },
    });
    selectCard();

    const first = await renderPanel();
    expect(usageSection(first)!.label).toBe("Usage");
    expect(note(first)).toContain("Counting references");

    release!();
    await flush(4);

    const root = await renderPanel();
    expect(usageSection(root)!.label).toBe("Used on 2 pages and 1 other file");

    const rows = [...root.querySelectorAll('[part="file-path"]')].map((el) =>
      el.textContent?.trim(),
    );
    // Most-referenced first, then alphabetical.
    expect(rows).toEqual(["pages/index.json", "components/hero.json", "pages/about.json"]);
  });

  test("a usage row opens the file it names", async () => {
    openFileInTab.mockClear();
    installMockPlatform({ findReferences: async () => usageResult() });
    selectCard();
    await renderPanel();
    await flush(4);

    const root = await renderPanel();
    root.querySelector<HTMLElement>('[part="file"]')!.click();
    await flush(2);
    expect(openFileInTab).toHaveBeenCalledWith("pages/index.json");
  });

  test("an unused component says so instead of hiding", async () => {
    installMockPlatform({
      findReferences: async () => usageResult({ files: [], filesReferencing: 0, refsTotal: 0 }),
    });
    selectCard();
    await renderPanel();
    await flush(4);

    const root = await renderPanel();
    expect(usageSection(root)!.label).toBe("Not used yet");
    expect(note(root)).toContain("my-card");
  });

  test("a host without the capability renders no section at all", async () => {
    // No `findReferences` member: the mock platform omits it unless asked for.
    installMockPlatform();
    selectCard();
    const root = await renderPanel();
    await flush(4);
    expect(usageSection(root)).toBeNull();
  });

  test("a failed query says unknown and offers Retry — never zero", async () => {
    let attempts = 0;
    installMockPlatform({
      findReferences: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("backend down");
        }
        return usageResult();
      },
    });
    selectCard();
    await renderPanel();
    await flush(4);

    const root = await renderPanel();
    expect(usageSection(root)!.label).toBe("Usage · unknown");
    expect(note(root)).toContain("backend down");
    expect(note(root)).toContain("unused");

    const retry = [...root.querySelectorAll('[part="action"]')].find((b) =>
      b.textContent?.includes("Retry"),
    )!;
    (retry as HTMLElement).click();
    await flush(4);
    const after = await renderPanel();
    expect(usageSection(after)!.label).toContain("Used on");
  });

  test("an ordinary element is not a reusable thing, so it gets no section", async () => {
    installMockPlatform({ findReferences: async () => usageResult() });
    const tab = resetWorkspaceWithTab({
      children: [{ children: [], tagName: "p" }],
      tagName: "div",
    } as unknown as JxMutableNode);
    tab.session.selection = [["children", 0]] as never;
    const root = await renderPanel();
    await flush(4);
    expect(usageSection(root)).toBeNull();
  });

  test("the section key is addressable by inspector.setSection", () => {
    resetWorkspaceWithTab(CARD_DOC);
    expect(inspectorSectionKeys()).toContain("__usages");
  });

  test("its accordion toggle writes through the same per-tab record as every other section", async () => {
    installMockPlatform({ findReferences: async () => usageResult() });
    selectCard();
    await renderPanel();
    await flush(4);
    const root = await renderPanel();
    // Collapsed by default: the heading IS the answer.
    expect(usageSection(root)!.open).toBe(false);

    const details = usageSection(root)!.querySelector("details") as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await flush();
    expect(activeTab.value!.session.ui.inspectorSections.__usages).toBe(true);

    const reopened = await renderPanel();
    expect(usageSection(reopened)!.open).toBe(true);
  });
});

describe("selection.findUsages", () => {
  const record = () => inspectorCommands().find((c) => c.id === "selection.findUsages")!;

  test("is declared once, for both the palette and the element menu", () => {
    expect(record().menus).toEqual(["context/element", "palette"]);
    expect(record().level).toBe("selection");
    expect(record().title).toBe("Find Usages");
  });

  test("hides without the capability, and without a component instance", () => {
    const withCapability = makeContext({
      capability: { ...emptyContext().capability, findReferences: true },
      selection: { count: 1, isComponentInstance: true, isRoot: false, kind: "my-card" },
    });
    expect(record().when!(withCapability)).toBe(true);

    const noCapability = makeContext({
      selection: { count: 1, isComponentInstance: true, isRoot: false, kind: "my-card" },
    });
    expect(record().when!(noCapability)).toBe(false);

    const notAComponent = makeContext({
      capability: { ...emptyContext().capability, findReferences: true },
      selection: { count: 1, isComponentInstance: false, isRoot: false, kind: "p" },
    });
    expect(record().when!(notAComponent)).toBe(false);
  });

  test("running it opens the section and loads the count", async () => {
    const seen: unknown[] = [];
    installMockPlatform({
      findReferences: async (target) => {
        seen.push(target);
        return usageResult();
      },
    } as Partial<StudioPlatform>);
    selectCard();

    void record().run(emptyContext(), undefined as never);
    await flush(3);

    expect(activeTab.value!.session.ui.inspectorSections["__usages"]).toBe(true);
    expect(seen).toEqual([{ path: "components/card.json", tagName: "my-card" }]);

    const root = await renderPanel();
    expect(usageSection(root)!.label).toContain("Used on");
    expect(usageSection(root)!.open).toBe(true);
  });

  test("running it on a plain element does nothing", async () => {
    const seen: unknown[] = [];
    installMockPlatform({
      findReferences: async (target) => {
        seen.push(target);
        return usageResult();
      },
    } as Partial<StudioPlatform>);
    const tab = resetWorkspaceWithTab({
      children: [{ children: [], tagName: "p" }],
      tagName: "div",
    } as unknown as JxMutableNode);
    tab.session.selection = [["children", 0]] as never;

    void record().run(emptyContext(), undefined as never);
    await flush(2);
    expect(seen).toEqual([]);
  });

  test("running it with no tab open does nothing", async () => {
    installMockPlatform({ findReferences: async () => usageResult() });
    closeAllTabs();
    expect(() => record().run(emptyContext(), undefined as never)).not.toThrow();
    await flush(1);
  });
});
