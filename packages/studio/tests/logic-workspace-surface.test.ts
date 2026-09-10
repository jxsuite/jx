/**
 * `src/surfaces/logic-workspace.ts` — the adapter, driven directly rather than through the flow.
 *
 * `formula-workspace.test.ts` owns the Logic tab as a reader meets it. What is left here is the
 * seam between the tab and its container, which no projection can reach: where each of the three
 * islands is announced from, what the mount is allowed to do to a host lit still owns, whether the
 * surface knows it has been taken out of the page, and what a dispose that beats the mount leaves
 * behind.
 */
import { flush } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { emptyLogicWorkspaceView, mountLogicWorkspace } from "../src/surfaces/logic-workspace";
import { mountsOf, resetSurfaceRegistry } from "../src/services/surface-registry";
import type {
  LogicWorkspaceActions,
  LogicWorkspaceIslands,
  LogicWorkspaceView,
} from "../src/surfaces/logic-workspace";

let host: HTMLElement;
let codes: HTMLElement[];
let editors: HTMLElement[];
/** One tree announcement: the entry key the surface said, and what the node knew at the time. */
let trees: { key: string; entryThen: string | undefined; node: HTMLElement }[];
let chipPicks: string[];
let anchors: HTMLElement[];
let closes: number;

const actions: LogicWorkspaceActions = {
  browseCatalog: (anchor) => anchors.push(anchor),
  close: () => {
    closes += 1;
  },
  selectChip: (key) => chipPicks.push(key),
};

function islands(): LogicWorkspaceIslands {
  return {
    codeSlot: (node) => codes.push(node),
    editorSlot: (node) => editors.push(node),
    treeSlot: (key, node) => trees.push({ entryThen: node.dataset["entry"], key, node }),
  };
}

/** A ready formula surface with one chip and one rail entry — the shape every island lives in. */
function formulaView(overrides: Partial<LogicWorkspaceView> = {}): LogicWorkspaceView {
  return {
    ...emptyLogicWorkspaceView(),
    chips: [{ badge: "6", hasBadge: true, key: "target", label: "count" }],
    glyph: "fx",
    hasCatalog: true,
    hasScope: true,
    kind: "state expression",
    name: "total",
    resultText: "= 6",
    resultTone: "value",
    scopeEntries: [{ key: "count", name: "count", type: "number" }],
    selectedSummary: "root",
    state: "ready",
    surface: "formula",
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
  resetSurfaceRegistry();
  codes = [];
  editors = [];
  trees = [];
  chipPicks = [];
  anchors = [];
  closes = 0;
});

describe("the islands", () => {
  test("the formula surface announces its editor host and one tree host per rail entry", async () => {
    const surface = mountLogicWorkspace(
      host,
      formulaView({
        scopeEntries: [
          { key: "count", name: "count", type: "number" },
          { key: "items", name: "items", type: "array (2)" },
        ],
      }),
      actions,
      islands(),
    );
    await flush(4);

    expect(editors).toHaveLength(1);
    expect(editors[0]!.getAttribute("part")).toBe("editor-host");
    expect(host.querySelector('[part="editor-host"]')).toBe(editors[0]!);

    expect(trees.map((t) => t.key)).toEqual(["count", "items"]);
    /* The announced node carries NO identity of its own — not then and not later — which is what
       makes the entry's `$map` scope the only place the key can come from. A node is announced
       when it is BUILT, one step before its attributes settle, so even an identity written onto it
       would read as "" here. */
    expect(trees[0]!.entryThen).toBeUndefined();
    expect(trees[0]!.node.dataset["entry"]).toBeUndefined();
    expect(trees[0]!.node.closest<HTMLElement>('[part="entry"]')?.dataset["entry"]).toBe("count");
    expect(trees.map((t) => t.node.getAttribute("part"))).toEqual(["tree-host", "tree-host"]);

    // Monaco's host belongs to the other surface: nothing announced it here.
    expect(codes).toEqual([]);
    surface.dispose();
  });

  test("the code surface announces Monaco's host and nothing else", async () => {
    const surface = mountLogicWorkspace(
      host,
      formulaView({ glyph: "ƒ", kind: "function body", surface: "code" }),
      actions,
      islands(),
    );
    await flush(4);

    expect(codes).toHaveLength(1);
    expect(codes[0]!.getAttribute("part")).toBe("code-host");
    expect(editors).toEqual([]);
    expect(trees).toEqual([]);
    surface.dispose();
  });

  test("nothing is announced while the tab holds no target at all", async () => {
    const surface = mountLogicWorkspace(
      host,
      { ...emptyLogicWorkspaceView(), emptyMessage: "Open a formula." },
      actions,
      islands(),
    );
    await flush(4);

    expect(host.querySelector('[part="empty-message"]')?.textContent).toBe("Open a formula.");
    expect(host.querySelector('[part="frame"]')).toBeNull();
    expect([...codes, ...editors, ...trees]).toEqual([]);
    surface.dispose();
  });
});

describe("the controls", () => {
  test("a chip reports its own key, and the catalog reports the control that asked", async () => {
    const surface = mountLogicWorkspace(host, formulaView(), actions, islands());
    await flush(4);

    const chip = host.querySelector<HTMLElement>('[part="chip"]')!;
    expect(chip.dataset["path"]).toBe("target");
    expect(chip.querySelector('[part="chip-label"]')?.textContent).toBe("count");
    expect(chip.querySelector('[part="badge"]')?.textContent).toBe("6");
    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(chipPicks).toEqual(["target"]);

    const catalog = host.querySelector<HTMLElement>('[part="catalog"]')!;
    catalog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Anchored on the control that asked: the palette opens under the button, not under the tab.
    expect(anchors).toEqual([catalog]);

    host
      .querySelector<HTMLElement>('[part="close"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(closes).toBe(1);
    surface.dispose();
  });

  test("a chip with no live value draws no badge, and one with an empty value draws one", async () => {
    const surface = mountLogicWorkspace(
      host,
      formulaView({
        chips: [
          { badge: "", hasBadge: false, key: "", label: "+" },
          { badge: "", hasBadge: true, key: "target", label: "name" },
        ],
      }),
      actions,
      islands(),
    );
    await flush(4);

    const chips = [...host.querySelectorAll<HTMLElement>('[part="chip"]')];
    expect(chips[0]!.querySelector('[part="badge"]')).toBeNull();
    // "" is what an empty string evaluates to. Drawing nothing there would report "not evaluated"
    // For a formula that evaluated perfectly well.
    expect(chips[1]!.querySelector('[part="badge"]')).not.toBeNull();
    surface.dispose();
  });
});

describe("the surface's own lifetime", () => {
  test("the mount appends rather than clearing, so a lit host keeps what it left behind", async () => {
    /* The Bottom dock renders its tabs with lit and the Logic record draws `nothing`, so what this
       document is appended into still holds lit's own comment markers. Taking them away would
       break the dock's next paint of another tab — which is the difference between this seam and
       the Inspector's, where the container is the surface's alone. */
    const marker = document.createComment("lit$0$");
    host.append(marker);
    const surface = mountLogicWorkspace(host, formulaView(), actions, islands());
    await flush(4);

    expect(marker.isConnected).toBe(true);
    expect(host.firstChild).toBe(marker);
    expect(host.querySelector('[part="workspace"]')).not.toBeNull();
    surface.dispose();
  });

  test("connected() follows the mounted root out of the page", async () => {
    const surface = mountLogicWorkspace(host, formulaView(), actions, islands());
    /* Before the mount lands there is no root to ask about, so the surface answers for itself —
       otherwise the dock would treat a tab that is merely still mounting as one that is gone, and
       mount a second copy over it. */
    expect(surface.connected()).toBe(true);
    await flush(4);
    expect(surface.connected()).toBe(true);

    // A repaint for another tab clears the body, which is how this document goes away.
    host.replaceChildren();
    expect(surface.connected()).toBe(false);
    surface.dispose();
  });

  test("a dispose that beats the mount takes it down rather than leaving it live", async () => {
    const surface = mountLogicWorkspace(host, formulaView(), actions, islands());
    surface.dispose();
    await flush(4);

    expect(mountsOf("logic-workspace")).toHaveLength(0);
    expect(surface.connected()).toBe(false);
    // Nothing was ever in the page, so no island was ever handed over either.
    expect(host.querySelector('[part="workspace"]')).toBeNull();
  });

  test("update() re-projects into the same mount, and ready resolves once it has rendered", async () => {
    const surface = mountLogicWorkspace(host, formulaView(), actions, islands());
    await surface.ready;
    await flush(2);
    expect(host.querySelector('[part="title"]')?.textContent).toBe("fx total");
    expect(mountsOf("logic-workspace")).toHaveLength(1);

    surface.update(formulaView({ name: "subtotal", resultText: "= 7" }));
    await flush(3);
    expect(host.querySelector('[part="title"]')?.textContent).toBe("fx subtotal");
    expect(host.querySelector('[part="result-text"]')?.textContent).toBe("= 7");
    // One mount throughout: a projection is an assignment, never a re-mount, so the editor island
    // The flow is holding is still the node it was handed.
    expect(mountsOf("logic-workspace")).toHaveLength(1);
    expect(editors).toHaveLength(1);

    surface.dispose();
    expect(mountsOf("logic-workspace")).toHaveLength(0);
  });

  test("the result line carries its tone, and its note only when there is one", async () => {
    const surface = mountLogicWorkspace(host, formulaView(), actions, islands());
    await flush(4);
    expect(host.querySelector<HTMLElement>('[part="result"]')?.dataset["tone"]).toBe("value");
    expect(host.querySelector('[part="result-note"]')).toBeNull();

    surface.update(
      formulaView({
        hasResultNote: true,
        resultNote: "(mutates target)",
        resultText: "= undefined",
      }),
    );
    await flush(3);
    expect(host.querySelector('[part="result-note"]')?.textContent).toBe("(mutates target)");

    surface.update(formulaView({ resultText: "boom", resultTone: "error" }));
    await flush(3);
    expect(host.querySelector<HTMLElement>('[part="result"]')?.dataset["tone"]).toBe("error");
    // The note went with the value it annotated rather than being left behind.
    expect(host.querySelector('[part="result-note"]')).toBeNull();
    surface.dispose();
  });

  test("the missing surface keeps the header and its Close, and draws no pipeline", async () => {
    const surface = mountLogicWorkspace(
      host,
      formulaView({ missingMessage: "No expression here.", surface: "missing" }),
      actions,
      islands(),
    );
    await flush(4);

    expect(host.querySelector('[part="title"]')?.textContent).toBe("fx total");
    expect(host.querySelector('[part="close"]')).not.toBeNull();
    expect(host.querySelector('[part="empty-message"]')?.textContent).toBe("No expression here.");
    expect(host.querySelector('[part="chips"]')).toBeNull();
    expect(editors).toEqual([]);
    surface.dispose();
  });
});
