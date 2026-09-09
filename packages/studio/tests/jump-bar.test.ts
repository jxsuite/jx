/**
 * ⑥ The jump bar — one address, every step of it a command.
 *
 * The bar's contract is what it CANNOT do as much as what it can: it has no click handler that
 * names behaviour, it never renders a step it invented, it never leaves a hole in the chain, and it
 * contributes no command of its own. The two half-breadcrumbs it merged are asserted gone in
 * `statusbar.test.ts` (the ancestor trail) and `pane-context.test.ts` (the second Back).
 *
 * The bar is a Jx document now (`surfaces/jump-bar.json`), so every assertion here names a ROLE, a
 * `part` or a region — never a class, of which the surface emits none — and the menu a chevron
 * opens is the kit's, `surfaces/menu.ts`, addressed by `jx-menu-item` rather than by a popover
 * selector of its own.
 */
import { flush, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mountShellTree } from "../src/shell/tree";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PRIMARY_PANE,
  SECONDARY_PANE,
  closeAllTabs,
  openTab,
  splitRight,
} from "../src/workspace/workspace";
import { setPaneDerivation } from "../src/workspace/pane-derive";
import { setProjectState } from "../src/store";
import { initLayers } from "../src/ui/layers";
import {
  applyJumpBarOffset,
  attachJumpBarHost,
  crumbSiblings,
  documentLabel,
  dismissJumpMenu,
  jumpSegments,
  mountJumpBar,
  renderJumpBar,
  selectionCrumbs,
  unmountJumpBar,
} from "../src/panels/jump-bar";
import { appCommandSet } from "../src/commands/app-commands";
import { setActiveRegistry } from "../src/commands/active-registry";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import type { CommandContext } from "../src/commands/context";
import type { AnyCommand } from "../src/commands/registry";

let host: HTMLElement;

beforeAll(() => {
  for (const id of ["layer-popover", "layer-modal", "layer-dialog", "layer-toast"]) {
    const layer = document.createElement("div");
    layer.id = id;
    document.body.append(layer);
  }
  initLayers();
  host = document.createElement("div");
  host.id = "jump-bar-host";
  document.body.append(host);
});

let ctx: CommandContext = makeContext({ document: { open: true } });
const ran: { id: string; args: unknown }[] = [];

/** One command record, as bare as the registry allows: the bar must not care what it does. */
function stub(id: string, title: string, level: AnyCommand["level"]): AnyCommand {
  return {
    category: "View",
    id,
    level,
    run: (_c, args) => {
      ran.push({ args, id });
    },
    title,
  } as AnyCommand;
}

/** Every id the bar can name. Pass a subset to prove what an absent record does. */
const BAR_IDS = ["project.openRecent", "palette.openFiles", "selection.set"] as const;

function buildRegistry(ids: readonly string[] = BAR_IDS) {
  const registry = createCommandRegistry({ getContext: () => ctx });
  registry.registerAll(
    [
      stub("project.openRecent", "Open Recent…", "project"),
      stub("palette.openFiles", "Go to File…", "application"),
      stub("selection.set", "Select Element", "document"),
    ].filter((command) => ids.includes(command.id)),
  );
  return registry;
}

beforeEach(() => {
  closeAllTabs();
  setProjectState(null as never);
  ran.length = 0;
  ctx = makeContext({ document: { open: true } });
  setActiveRegistry(buildRegistry());
});

afterEach(async () => {
  unmountJumpBar();
  dismissJumpMenu();
  setActiveRegistry(null);
  await flush();
  document.querySelector("#layer-popover")?.replaceChildren();
});

/**
 * Mount the primary pane's bar and let its document settle.
 *
 * A mounted surface takes more turns than a lit render did: the mount resolves, then the keyed
 * `$map` reconciles, then the `$switch` inside each step does. Three is what that costs.
 */
async function paint(into: HTMLElement = host): Promise<void> {
  mountJumpBar(into);
  await flush(3);
}

const bar = (into: HTMLElement = host) => into.querySelector('nav[part="bar"]');
const crumbs = (into: HTMLElement = host) =>
  [...into.querySelectorAll('[part="crumb"]')].map((e) => e.textContent?.trim());
const kinds = (into: HTMLElement = host) =>
  [...into.querySelectorAll<HTMLElement>("[data-jump-kind]")].map((e) => e.dataset.jumpKind);
const menuRows = () =>
  [...document.querySelectorAll("#layer-popover jx-menu-item")].map((e) =>
    e.querySelector('[part="label"]')?.textContent?.trim(),
  );

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe("documentLabel", () => {
  test("strips the project root, which is already field one", () => {
    resetStudioState({ name: "Site", projectRoot: "/home/k/site" });
    expect(documentLabel("/home/k/site/pages/index.json")).toBe("pages/index.json");
  });

  test("leaves a path outside the root alone, and names an unsaved document", () => {
    resetStudioState({ name: "Site", projectRoot: "/home/k/site" });
    expect(documentLabel("/elsewhere/x.json")).toBe("/elsewhere/x.json");
    expect(documentLabel(null)).toBe("Untitled");
  });
});

describe("selectionCrumbs", () => {
  test("one crumb per NODE, with the path that selects it", () => {
    const doc = {
      children: [{ children: [{ tagName: "li" }], tagName: "ul" }],
      tagName: "div",
    };
    expect(selectionCrumbs(doc, ["children", 0, "children", 0])).toEqual([
      { label: "ul", path: ["children", 0] },
      { label: "li", path: ["children", 0, "children", 0] },
    ]);
  });

  test("a repeater's lone `map` segment does not break the pairing", () => {
    const doc = {
      children: [{ $prototype: "Array", map: { tagName: "article" } }],
      tagName: "div",
    };
    expect(selectionCrumbs(doc, ["children", 0, "map"]).map((crumb) => crumb.label)).toEqual([
      "Repeater",
      "article",
    ]);
  });

  test("falls back to `tag`, then to a bracketed index", () => {
    const doc = { children: [{ tag: "h2" }, {}], tagName: "div" };
    expect(selectionCrumbs(doc, ["children", 0])[0]!.label).toBe("h2");
    expect(selectionCrumbs(doc, ["children", 1])[0]!.label).toBe("[1]");
  });

  test("a `cases` step is named by its case key", () => {
    const doc = { cases: { warm: {} }, tagName: "div" };
    expect(selectionCrumbs(doc, ["cases", "warm"])[0]!.label).toBe("warm");
  });
});

describe("crumbSiblings", () => {
  const doc = {
    children: [
      { $id: "lede", tagName: "p" },
      { children: [{ tagName: "li" }], tagName: "ul" },
      "a bare text child",
    ],
    tagName: "div",
  };

  test("every sibling is a `selection.set`, labelled the way the Outline labels it", () => {
    const trail = selectionCrumbs(doc, ["children", 1]);
    expect(crumbSiblings(doc, trail, 0)).toEqual([
      { args: { path: ["children", 0] }, command: "selection.set", label: "lede" },
      { args: { path: ["children", 1] }, command: "selection.set", current: true, label: "ul" },
    ]);
  });

  test("a text child is not addressable, so it is not offered", () => {
    const trail = selectionCrumbs(doc, ["children", 0]);
    expect(crumbSiblings(doc, trail, 0).map((choice) => choice.label)).toEqual(["lede", "ul"]);
  });

  test("a `cases` step offers its sibling cases", () => {
    const switchDoc = { cases: { cold: { tagName: "b" }, warm: { tagName: "i" } }, tagName: "div" };
    const trail = selectionCrumbs(switchDoc, ["cases", "warm"]);
    expect(crumbSiblings(switchDoc, trail, 0).map((choice) => choice.args!.path)).toEqual([
      ["cases", "cold"],
      ["cases", "warm"],
    ]);
  });

  test("a repeater template has no siblings — there is exactly one of it", () => {
    const repeaterDoc = {
      children: [{ $prototype: "Array", map: { tagName: "article" } }],
      tagName: "div",
    };
    const trail = selectionCrumbs(repeaterDoc, ["children", 0, "map"]);
    expect(crumbSiblings(repeaterDoc, trail, 1)).toEqual([]);
  });

  test("an index past the end of the trail asks about nothing, and answers nothing", () => {
    expect(crumbSiblings(doc, [], 0)).toEqual([]);
  });

  test("a `cases` step whose parent has no cases object answers nothing", () => {
    expect(
      crumbSiblings({ tagName: "div" }, [{ label: "warm", path: ["cases", "warm"] }], 0),
    ).toEqual([]);
  });
});

// ─── The address ──────────────────────────────────────────────────────────────

describe("jumpSegments", () => {
  test("no tab is no address", () => {
    expect(jumpSegments(null)).toEqual([]);
  });

  test("project › file, and the file segment is the file picker", () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    const tab = resetWorkspaceWithTab(undefined, { documentPath: "/p/pages/index.json" });
    expect(
      jumpSegments(tab).map((segment) => [segment.kind, segment.label, segment.command]),
    ).toEqual([
      ["project", "My Site", "project.openRecent"],
      ["file", "pages/index.json", "palette.openFiles"],
    ]);
  });

  test("with no project open the address starts at the file", () => {
    const tab = resetWorkspaceWithTab();
    expect(jumpSegments(tab)[0]!.kind).toBe("file");
  });

  test("the selection's ancestors follow the file, leaf last, each a `selection.set`", () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    const tab = resetWorkspaceWithTab({
      children: [{ children: [{ $id: "first", tagName: "li" }], tagName: "ul" }],
      tagName: "div",
    });
    tab.session.selection = [["children", 0, "children", 0]];
    const segments = jumpSegments(tab);
    expect(segments.map((segment) => segment.kind)).toEqual(["project", "file", "node", "node"]);
    // An ancestor prints its compact tag; the LEAF prints the Outline's label, which is where an
    // An author's `$id` shows up there — the one fact the status bar used to add beside it.
    expect(segments.at(-2)!.label).toBe("ul");
    expect(segments.at(-1)!.label).toBe("first");
    expect(segments.at(-1)!.args).toEqual({ path: ["children", 0, "children", 0] });
    expect(segments.at(-1)!.command).toBe("selection.set");
  });

  test("only the PRIMARY of a multi-selection is addressed — a path names one node", () => {
    const tab = resetWorkspaceWithTab({
      children: [{ tagName: "h1" }, { tagName: "p" }],
      tagName: "div",
    });
    tab.session.selection = [
      ["children", 0],
      ["children", 1],
    ];
    expect(jumpSegments(tab).at(-1)!.args).toEqual({ path: ["children", 1] });
  });

  test("the address holds ONE document — there is no sub-document chain to walk", () => {
    // The bar used to emit a `subdocument` segment per `session.documentStack` frame, each one a
    // `document.setStackLevel` you could click back to. Nothing in `src/` ever pushed a frame, so
    // The chain was always length one and the whole apparatus drew this. A tab holds a document;
    // Drilling in opens a tab of its own.
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    const tab = resetWorkspaceWithTab(undefined, { documentPath: "/p/index.json" });
    const segments = jumpSegments(tab);
    expect(segments.map((segment) => [segment.kind, segment.label, segment.command])).toEqual([
      ["project", "My Site", "project.openRecent"],
      ["file", "index.json", "palette.openFiles"],
    ]);
    expect(segments.some((segment) => segment.args)).toBe(false);
    expect(segments.some((segment) => segment.kind === ("subdocument" as never))).toBe(false);
  });

  test("a logic editor is the leaf, and it takes no selection under it", () => {
    const tab = resetWorkspaceWithTab({ children: [{ tagName: "p" }], tagName: "div" });
    tab.session.selection = [["children", 0]];
    tab.session.ui.editingFunction = { defName: "greet", type: "def" } as never;
    expect(jumpSegments(tab).at(-1)).toEqual({
      choices: [],
      command: null,
      kind: "editor",
      label: "ƒ greet",
    });
    expect(jumpSegments(tab).some((segment) => segment.kind === "node")).toBe(false);
  });

  test("an event handler and a formula name their key, with their own sigil", () => {
    const tab = resetWorkspaceWithTab();
    tab.session.ui.editingFunction = { eventKey: "onclick", type: "event" } as never;
    expect(jumpSegments(tab).at(-1)!.label).toBe("ƒ onclick");
    tab.session.ui.editingFunction = null;
    tab.session.ui.editingFormula = { defName: "total", type: "def" } as never;
    expect(jumpSegments(tab).at(-1)!.label).toBe("fx total");
  });

  test("a node with siblings offers them; the only child of its parent offers nothing", () => {
    const tab = resetWorkspaceWithTab({
      children: [{ children: [{ tagName: "li" }, { tagName: "li" }], tagName: "ul" }],
      tagName: "div",
    });
    tab.session.selection = [["children", 0, "children", 0]];
    const segments = jumpSegments(tab);
    expect(segments.at(-1)!.choices).toHaveLength(2);
    // `ul` IS the root's only child, so its segment has one "alternative" — not a choice.
    expect(segments.at(-2)!.choices).toHaveLength(1);
  });
});

// ─── Rendering ────────────────────────────────────────────────────────────────

describe("the rendered bar", () => {
  test("prints nothing at all with no tab open — and no dead band under the welcome screen", async () => {
    await paint();
    // The document stays mounted and states its own emptiness: the next tab open is one
    // Assignment away, and re-mounting would cost a frame of blank chrome.
    expect(bar()!.hasAttribute("hidden")).toBe(true);
    expect(crumbs()).toEqual([]);
    expect(document.documentElement.style.getPropertyValue("--jump-bar-h")).toBe("0px");
  });

  test("prints one crumb per segment, separated, and reserves its own height", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    const tab = resetWorkspaceWithTab(
      { children: [{ children: [{ tagName: "li" }], tagName: "ul" }], tagName: "div" },
      { documentPath: "/p/index.json" },
    );
    tab.session.selection = [["children", 0, "children", 0]];
    await paint();
    expect(bar()!.hasAttribute("hidden")).toBe(false);
    expect(crumbs()).toEqual(["My Site", "index.json", "ul", "li"]);
    expect(kinds()).toEqual(["project", "file", "node", "node"]);
    expect(host.querySelectorAll('[part="separator"]')).toHaveLength(3);
    expect(document.documentElement.style.getPropertyValue("--jump-bar-h")).toBe("24px");
  });

  /* THE BAR ASKS ABOUT ITS OWN PANE. `jumpSegments` takes the derivation as an argument — the
     tests above prove it turns Open into Keep — and the per-pane projection is where the argument
     comes from. Passing `null` there compiles, keeps every `jumpSegments` test green, and draws a
     following pane's address bar as an ordinary one: Open Files where Keep This Document belongs,
     and no way to stop the follow from the one control that is always on screen. */
  test("a derived pane's bar reads ITS pane's derivation, not the app's", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    resetWorkspaceWithTab({ children: [], tagName: "div" }, { documentPath: "/p/index.json" });
    openTab({ document: { tagName: "div" }, documentPath: "/p/side.json", id: "side" });
    expect(splitRight()?.id).toBe(SECONDARY_PANE);
    setPaneDerivation(SECONDARY_PANE, {
      diff: null,
      kind: "lens",
      media: null,
      mode: "source",
      preset: "code",
      reason: "",
      sourcePaneId: PRIMARY_PANE,
      status: "ready",
      zoom: 1,
    });

    const registry = buildRegistry();
    registry.registerAll([stub("pane.pin", "Keep This Document", "document")]);
    setActiveRegistry(registry);

    const sideHost = document.createElement("div");
    document.body.append(sideHost);
    /* Read off the crumb's TITLE, which is `${command.title} — requires …` or `${command.title}`:
       the verb is the observable, and the bar deliberately carries no `data-command` for a test to
       read instead. */
    const fileCrumbTitle = (into: HTMLElement) =>
      [...into.querySelectorAll('[part="crumb"]')]
        .map((el) => el.getAttribute("title") ?? "")
        .find((title) => title.includes("index.json"));
    try {
      await paint();
      attachJumpBarHost(SECONDARY_PANE, sideHost);
      await flush(3);
      expect(fileCrumbTitle(sideHost)).toContain("Keep This Document");
      // …and the pane that owns the document still offers Open.
      expect(fileCrumbTitle(host)).not.toContain("Keep This Document");
    } finally {
      attachJumpBarHost(SECONDARY_PANE, null);
      sideHost.remove();
    }
  });

  test("the bar is one addressable region, not a CSS selector the camera has to know", async () => {
    resetWorkspaceWithTab();
    await paint();
    expect(host.querySelector('[data-jx-region="pane.primary/jump"]')).not.toBeNull();
  });

  test("a crumb click RUNS its command with its args — there is no bespoke handler", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    const tab = resetWorkspaceWithTab({
      children: [{ children: [{ tagName: "li" }], tagName: "ul" }],
      tagName: "div",
    });
    tab.session.selection = [["children", 0, "children", 0]];
    await paint();
    const buttons = [...host.querySelectorAll('button[part="crumb"]')] as HTMLElement[];
    buttons[0]!.click();
    buttons[2]!.click();
    expect(ran).toEqual([
      { args: {}, id: "project.openRecent" },
      { args: { path: ["children", 0] }, id: "selection.set" },
    ]);
  });

  test("a crumb's tooltip is the record's own title, never a second wording", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    resetWorkspaceWithTab();
    await paint();
    expect(host.querySelector('button[part="crumb"]')!.getAttribute("title")).toContain(
      "Open Recent…",
    );
  });

  test("a step whose command is unregistered becomes a READOUT — the chain keeps no hole", async () => {
    setActiveRegistry(buildRegistry(["project.openRecent"]));
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    resetWorkspaceWithTab(undefined, { documentPath: "/p/index.json" });
    await paint();
    // Both steps are still there; only the file step lost its button. The status bar drops an item
    // With no command — an address may not, because a gap in it is a lie about containment.
    expect(crumbs()).toEqual(["My Site", "index.json"]);
    expect(host.querySelectorAll('button[part="crumb"]')).toHaveLength(1);
    expect(host.querySelectorAll('span[part="crumb"]')).toHaveLength(1);
  });

  test("no registry at all still prints the address, as readouts", async () => {
    setActiveRegistry(null);
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    resetWorkspaceWithTab(undefined, { documentPath: "/p/index.json" });
    await paint();
    expect(crumbs()).toEqual(["My Site", "index.json"]);
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  test("a disabled command renders a disabled crumb carrying the record's own `requires`", async () => {
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.register({
      ...stub("project.openRecent", "Open Recent…", "project"),
      enablement: () => false,
      requires: "a recent project",
    });
    setActiveRegistry(registry);
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    resetWorkspaceWithTab();
    await paint();
    const button = host.querySelector('button[part="crumb"]') as HTMLButtonElement;
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.title).toContain("requires a recent project");
  });

  test("the leaf is marked as where you are, and is still a control", async () => {
    const tab = resetWorkspaceWithTab({ children: [{ tagName: "p" }], tagName: "div" });
    tab.session.selection = [["children", 0]];
    await paint();
    expect(host.querySelector('[part="crumb"][aria-current]')?.textContent?.trim()).toBe("p");
  });
});

describe("a segment's alternatives", () => {
  async function openFirstMenu() {
    const tab = resetWorkspaceWithTab({
      children: [
        {
          children: [
            { $id: "one", tagName: "li" },
            { $id: "two", tagName: "li" },
          ],
          tagName: "ul",
        },
      ],
      tagName: "div",
    });
    tab.session.selection = [["children", 0, "children", 0]];
    await paint();
    (host.querySelector('[part="alternatives"]') as HTMLElement).click();
    await flush(3);
    return tab;
  }

  test("a chevron appears only where there is more than one place to go", async () => {
    await openFirstMenu();
    // Project, file and `ul` have no alternatives; only the leaf `li` does.
    expect(host.querySelectorAll('[part="alternatives"]')).toHaveLength(1);
  });

  test("the menu lists the siblings and marks the one you are on", async () => {
    await openFirstMenu();
    expect(menuRows()).toEqual(["one", "two"]);
    const rows = [...document.querySelectorAll("#layer-popover jx-menu-item")];
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });

  test("choosing a sibling is `selection.set` with THAT sibling's path", async () => {
    await openFirstMenu();
    const rows = [...document.querySelectorAll("#layer-popover jx-menu-item")] as HTMLElement[];
    rows[1]!.click();
    await flush();
    expect(ran).toEqual([{ args: { path: ["children", 0, "children", 1] }, id: "selection.set" }]);
    // Choosing dismisses: a menu left open over the surface it just moved is a second answer.
    expect(document.querySelector("#layer-popover jx-menu")).toBeNull();
  });

  test("opening a second menu closes the first", async () => {
    await openFirstMenu();
    (host.querySelector('[part="alternatives"]') as HTMLElement).click();
    await flush(3);
    expect(document.querySelectorAll("#layer-popover jx-menu")).toHaveLength(1);
  });

  test("a click away closes it, and the bar forgets it", async () => {
    await openFirstMenu();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flush();
    expect(document.querySelector("#layer-popover jx-menu")).toBeNull();
    // Forgotten, not merely hidden: re-opening must not leave the first slot in the layer.
    (host.querySelector('[part="alternatives"]') as HTMLElement).click();
    await flush(3);
    expect(document.querySelectorAll("#layer-popover jx-menu")).toHaveLength(1);
  });

  test("a repaint closes it — a menu of siblings for a node no longer on the bar is a lie", async () => {
    const tab = await openFirstMenu();
    expect(document.querySelector("#layer-popover jx-menu")).not.toBeNull();
    tab.session.selection = [];
    await flush(3);
    expect(document.querySelector("#layer-popover jx-menu")).toBeNull();
  });

  test("unmounting closes it too", async () => {
    await openFirstMenu();
    unmountJumpBar();
    await flush();
    expect(document.querySelector("#layer-popover jx-menu")).toBeNull();
  });
});

describe("mountJumpBar", () => {
  test("repaints when the address changes", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    const tab = resetWorkspaceWithTab(
      { children: [{ tagName: "p" }], tagName: "div" },
      { documentPath: "/p/index.json" },
    );
    await paint();
    expect(crumbs()).toEqual(["My Site", "index.json"]);
    tab.session.selection = [["children", 0]];
    await flush(3);
    expect(crumbs()).toEqual(["My Site", "index.json", "p"]);
  });

  test("repaints when a takeover editor opens", async () => {
    const tab = resetWorkspaceWithTab();
    await paint();
    tab.session.ui.editingFormula = { defName: "total", type: "def" } as never;
    await flush(3);
    expect(crumbs()).toContain("fx total");
  });

  test("is idempotent — a second mount replaces the effect rather than stacking one", async () => {
    const tab = resetWorkspaceWithTab({ children: [{ tagName: "p" }], tagName: "div" });
    mountJumpBar(host);
    mountJumpBar(host);
    await flush(3);
    tab.session.selection = [["children", 0]];
    await flush(3);
    expect(host.querySelectorAll('nav[part="bar"]')).toHaveLength(1);
  });

  test("unmount stops the repaint and gives the height back", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    const tab = resetWorkspaceWithTab(
      { children: [{ tagName: "p" }], tagName: "div" },
      { documentPath: "/p/index.json" },
    );
    await paint();
    unmountJumpBar();
    expect(document.documentElement.style.getPropertyValue("--jump-bar-h")).toBe("0px");
    // The host is empty, so nothing is left to repaint into.
    tab.session.selection = [["children", 0]];
    await flush(3);
    expect(crumbs()).toEqual([]);
  });

  test("renderJumpBar before a mount is a no-op, not a crash", () => {
    unmountJumpBar();
    resetWorkspaceWithTab();
    expect(() => {
      renderJumpBar();
    }).not.toThrow();
  });

  test("the offset is one projection, and it can be written directly", () => {
    applyJumpBarOffset(24);
    expect(document.documentElement.style.getPropertyValue("--jump-bar-h")).toBe("24px");
    applyJumpBarOffset(0);
  });
});

// ─── The wiring ───────────────────────────────────────────────────────────────

describe("the bar is wired to the app, not to a stub", () => {
  test("every id the bar can name is a record the app actually registers", () => {
    // P7 shipped eleven features reachable from nothing. A bar built entirely out of command ids is
    // Only as real as the registry behind it, so this asserts against the APP's set — not the three
    // Stubs the rest of this file uses.
    const ids = new Set(appCommandSet().map((command) => command.id));
    expect([...BAR_IDS].filter((id) => !ids.has(id))).toEqual([]);
  });

  test("the bar contributes no command of its own — every id belongs to another surface", () => {
    // It used to declare `document.setStackLevel`, whose enablement read a `documentStack` nothing
    // Could push onto: a palette entry permanently disabled, for a stack with no way in. Both are
    // Gone, and a bar that only NAMES commands is the shape the header claims.
    expect(appCommandSet().some((command) => command.id === "document.setStackLevel")).toBe(false);
    const source = readFileSync(
      join(resolve(import.meta.dir, "..", "src"), "panels", "jump-bar.ts"),
      "utf8",
    );
    expect(source).not.toContain("jumpBarCommands");
  });

  test("the chevron opens the KIT menu, not a second list of its own", () => {
    // §12.5: a second list of actions is a defect. The flow projects rows and hands them to
    // `surfaces/menu.ts`; the panel, the caret, typeahead and Escape are that surface's.
    const source = readFileSync(
      join(resolve(import.meta.dir, "..", "src"), "panels", "jump-bar.ts"),
      "utf8",
    );
    expect(source).toContain('import { openMenu } from "../surfaces/menu"');
    expect(source).not.toContain("renderPopover");
    expect(source).not.toContain("lit-html");
  });

  test("the bootstrap mounts the bar into a cell the shell actually has", async () => {
    // `app-commands-composition.test.ts` guards the projection; this guards the other half — a
    // Surface nothing mounts is exactly as unreachable as a command nothing registers.
    //
    // There is no `#jump-bar`. The bar is a PER-PANE surface, so its host is built by the pane's
    // Cell rather than declared as a row of the application grid — a `<div id>` can only ever be
    // One pane's bar, which is exactly the bug the grid exists to end.
    const bootstrap = readFileSync(
      join(resolve(import.meta.dir, "..", "src"), "studio.ts"),
      "utf8",
    );
    expect(bootstrap).toContain("mountJumpBar(primaryCell");
    const grid = readFileSync(
      join(resolve(import.meta.dir, "..", "src"), "panels", "pane-grid.ts"),
      "utf8",
    );
    // The cell is a lit template now, so the host is a `class="pane-jump"` in it and the bar is
    // Handed the element by the `ref()` beside it rather than by a `createElement` + `append`.
    expect(grid).toContain('<div class="pane-jump"');
    expect(grid).toContain("attachJumpBarHost(paneId,");
    /* And the FRAME really has a pane grid and no bar of its own. Asserted against the rendered
       tree rather than index.html's text: the frame is src/shell/tree.ts now, and the document
       carries an empty body. */
    const frame = document.createElement("div");
    await mountShellTree(frame);
    expect(frame.querySelector("#pane-grid")).not.toBeNull();
    expect(frame.querySelector("#jump-bar")).toBeNull();
  });
});
