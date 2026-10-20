/**
 * The status bar — three fields, in scope order, every interactive item a command. The middle one,
 * DOCUMENT, is a slot the jump bar's breadcrumb trail is mounted into (`tests/jump-bar.test.ts`).
 *
 * The bar's contract is what it CANNOT do as much as what it can: it holds no transient message, it
 * has no click handler of its own, and it renders no item whose command the registry does not
 * have.
 */
import { flush, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { initShellRefs, requireShellRef, setProjectState, statusbarEl } from "../src/store";
import { closeAllTabs } from "../src/workspace/workspace";
import {
  aheadBehindLabel,
  changedFilesLabel,
  mountStatusbar,
  renderStatusbar,
  unmountStatusbar,
} from "../src/surfaces/statusbar";
import { unmountJumpBar } from "../src/panels/jump-bar";
import { resetProjectShell, shell } from "../src/shell";
import { readFileSync } from "node:fs";
import { setActiveRegistry } from "../src/commands/active-registry";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import { notify, resetNotifications } from "../src/services/notify";
import { collabState } from "../src/collab/collab-state";
import type { CommandContext } from "../src/commands/context";
import type { AnyCommand } from "../src/commands/registry";

/** The shell's status bar cell, which `initShellRefs()` found before these tests run. */
function barHost(): HTMLElement {
  return requireShellRef(statusbarEl, "statusbar");
}

beforeAll(() => {
  const bar = document.createElement("div");
  bar.id = "statusbar";
  document.body.append(bar);
  initShellRefs();
});

let ctx: CommandContext = makeContext();
const ran: { id: string; args: unknown }[] = [];

/** One command record, as bare as the registry allows: the bar must not care what it does. */
function stub(id: string, title: string, level: AnyCommand["level"]): AnyCommand {
  const command: AnyCommand = {
    category: "View",
    id,
    level,
    run: (_c, args) => {
      ran.push({ args, id });
    },
    title,
  };
  return command;
}

function buildRegistry(ids?: readonly string[]) {
  const registry = createCommandRegistry({ getContext: () => ctx });
  const all: AnyCommand[] = [
    stub("project.open", "Open Project…", "project"),
    stub("project.openRecent", "Open Recent…", "project"),
    stub("view.setWorkspace", "Show Workspace", "application"),
    stub("publish.open", "Show Publish", "project"),
    stub("git.init", "Initialize Repository", "project"),
    // `view.setBottomTab`, not `panel.focus.problems` — that record is generated from the rail
    // Roster and Problems is off the rail.
    stub("view.setBottomTab", "Show Bottom Dock Tab", "application"),
    stub("palette.openFiles", "Go to File…", "application"),
    stub("selection.set", "Select Element", "document"),
    stub("collab.showStatus", "Collaborate: What is happening in this document?", "document"),
  ];
  registry.registerAll(ids ? all.filter((c) => ids.includes(c.id)) : all);
  return registry;
}

beforeEach(() => {
  closeAllTabs();
  // `projectState` is a module-level binding, not a per-test one: the bar's "No project" state has
  // To be stated rather than inherited from whichever test ran last.
  setProjectState(null);
  resetProjectShell();
  resetNotifications();
  ran.length = 0;
  ctx = makeContext();
  setActiveRegistry(buildRegistry());
});

afterEach(async () => {
  unmountStatusbar();
  unmountJumpBar();
  setActiveRegistry(null);
  resetNotifications();
  await flush();
});

/** Recompute the projection and let the surface follow: mount, reconcile, connect. */
async function render(): Promise<void> {
  renderStatusbar();
  await flush();
  await flush();
  // The jump bar mounts its own document into the DOCUMENT slot once this one exists.
  await flush(3);
}

/** Every item the bar shows — buttons and readouts — in order. */
const items = () =>
  [...barHost().querySelectorAll('[part="item"], [part="state"]')].map((e) => e.textContent.trim());
const field = (name: string) => barHost().querySelector(`[data-jx-region="statusbar/${name}"]`);
const slot = () => barHost().querySelector<HTMLElement>('[part="trail"]');
const crumbs = () =>
  [...barHost().querySelectorAll('[part="crumb"]')].map((e) => e.textContent.trim());

/** The first button a field draws, failing the test by name when it draws none. */
function buttonIn(name: string): HTMLButtonElement {
  const button = field(name)?.querySelector("button");
  if (!button) {
    throw new Error(`the ${name} field drew no button`);
  }
  return button;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe("aheadBehindLabel", () => {
  test("says nothing when the branch is level with its upstream", () => {
    expect(aheadBehindLabel(0, 0)).toBe("");
  });

  test("names each direction only when it is non-zero", () => {
    expect(aheadBehindLabel(2, 0)).toBe(" ↑2");
    expect(aheadBehindLabel(0, 3)).toBe(" ↓3");
    expect(aheadBehindLabel(2, 3)).toBe(" ↑2 ↓3");
  });
});

describe("the PROJECT field", () => {
  test("with no project it offers the one command that fixes that", async () => {
    await render();
    expect(field("project")?.textContent.trim()).toBe("No project");
  });

  test("names the project, and the name is Open Recent…", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    await render();
    const button = buttonIn("project");
    expect(button.textContent.trim()).toBe("My Site");
    expect(button.title).toContain("Open Recent…");
    button.click();
    expect(ran).toEqual([{ args: {}, id: "project.openRecent" }]);
  });

  test("the branch item appears only for a repo, and carries ahead/behind", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    await render();
    expect(items()).not.toContain("⑂ main");
    shell.git.status = {
      ahead: 1,
      behind: 2,
      branch: "main",
      files: [],
      isRepo: true,
      remotes: [],
    };
    await render();
    expect(items()).toContain("⑂ main ↑1 ↓2");
  });

  /* Source Control is the Publish workspace (studio.md §5.5), so the branch item opens it rather
     than a Navigator panel that no longer exists. */
  test("the branch item opens the Publish workspace", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    shell.git.status = {
      ahead: 0,
      behind: 0,
      branch: "main",
      files: [],
      isRepo: true,
      remotes: [],
    };
    await render();
    const branch = [...(field("project")?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent.includes("⑂ main"),
    );
    branch?.click();
    expect(ran).toEqual([{ args: { tab: "review" }, id: "publish.open" }]);
    // The tooltip says what the item counts and where it goes, not "Switch Workspace".
    expect(branch?.getAttribute("title")).toBe("No changes on main · Show Publish");
  });

  test("changedFilesLabel counts in words", () => {
    expect(changedFilesLabel(0)).toBe("No changes");
    expect(changedFilesLabel(1)).toBe("1 changed file");
    expect(changedFilesLabel(3)).toBe("3 changed files");
  });

  /*
   * The first-hour redesign asked for it: "repo state becomes a persistent status-bar field".
   *
   * It reads like a request for a "not tracked" twin of the branch item, and it is not: the field
   * already states an untracked project, one item along, because `deployStatusItem()`'s first link
   * is `repo` — label "Track this project with git", command `git.init`. Two items saying that with
   * the same verb is the adjacent-duplicate chrome studio-ui-guidelines.md §12.2 forbids.
   *
   * So the invariant worth pinning is the PAIRING, and it is asserted from both ends: exactly one
   * item names `git.init`, and it is there at all. Deleting the checklist's repo step takes the
   * state off the bar and fails here; adding a second one fails here too.
   */
  test("an untracked project is stated ONCE, by the item whose command initializes the repo", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    // Not a repo, so there is no branch: the empty name is what a host reports for one.
    shell.git.status = { ahead: 0, behind: 0, branch: "", files: [], isRepo: false, remotes: [] };
    await render();
    // No branch to name, so the branch item is absent — and the state is said anyway.
    expect(items().some((t) => t.startsWith("⑂"))).toBe(false);
    expect(items()).toContain("Track this project with git");

    const buttons = [...field("project")!.querySelectorAll("button")];
    for (const button of buttons) {
      button.click();
    }
    expect(ran.filter((r) => r.id === "git.init")).toHaveLength(1);
  });

  test("once tracked, the field stops offering to track it and names the branch instead", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    shell.git.status = {
      ahead: 0,
      behind: 0,
      branch: "main",
      files: [],
      isRepo: true,
      remotes: [],
    };
    await render();
    const shown = items();
    expect(shown).toContain("⑂ main");
    expect(shown).not.toContain("Track this project with git");
  });

  test("the problems item counts `notify`'s Problems store, and appears only when non-zero", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    await render();
    expect(items().some((t) => t.startsWith("⚠"))).toBe(false);
    notify.error("Could not save.");
    notify.warn("Slots", { tier: "problem" });
    await render();
    expect(items()).toContain("⚠ 2");
    // By LABEL, not by index: the field's item count moves with the deploy checklist and the peer
    // Count, and a positional lookup here would silently start clicking whichever item grew in
    // Front of it (it did — the deploy item's `git.init` link took slot 1).
    const problems = [...field("project")!.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "⚠ 2",
    )!;
    problems.click();
    // The one door the other three Bottom-dock tabs use, carrying which tab it means.
    expect(ran.at(-1)!.id).toBe("view.setBottomTab");
    expect(ran.at(-1)!.args).toEqual({ tab: "problems" });
  });

  test("the peers item counts them, and opens what is happening in this document", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    const tab = resetWorkspaceWithTab();
    collabState(tab).peers = [
      {
        clientId: 2,
        state: { focusedPath: null, user: { color: "#f00", login: "ada", name: "Ada" } },
      },
    ];
    await render();
    expect(items()).toContain("1 peer");
    const buttons = [...field("project")!.querySelectorAll("button")];
    const peersButton = buttons.at(-1);
    if (!peersButton) {
      throw new Error("the project field drew no buttons");
    }
    peersButton.click();
    expect(ran.at(-1)!.id).toBe("collab.showStatus");
  });

  test("it stays silent with nobody there", async () => {
    resetStudioState({ name: "My Site", projectRoot: "/p" });
    resetWorkspaceWithTab();
    await render();
    expect(items().some((t) => t.includes("peer"))).toBe(false);
  });

  /*
   * The gate that was missing, and the reason this readout was blank for two phases.
   *
   * The item named `collab.share`. The `Collaborate:` family then shipped under five ids, with
   * `share` renamed `collab.setEnabled` on the way, and `itemTpl` renders `nothing` for an id the
   * registry does not have — so the peer count silently stopped existing, while a comment in the
   * file promised it would appear "with no edit to this file". Every test above builds a STUB
   * registry, so none of them could see it: they prove the bar renders what it is given, not that
   * what it names exists.
   */
  test("every command the bar names is one the real app declares", async () => {
    const { appCommandSet } = await import("../src/commands/app-commands");
    const declared = new Set(appCommandSet().map((c) => c.id));
    const source = readFileSync(new URL("../src/surfaces/statusbar.ts", import.meta.url), "utf8");
    // SAFETY: group 1 is not optional in this pattern, so every match the iterator yields carries it.
    const named = [...source.matchAll(/command:\s*"([\w.]+)"/g)].map((m) => m[1] as string);
    expect(named.length).toBeGreaterThan(3);
    expect(named.filter((id) => !declared.has(id))).toEqual([]);
  });
});

// ─── DOCUMENT ────────────────────────────────────────────────────────────────

describe("the DOCUMENT field", () => {
  test("is a hidden slot with no document open", async () => {
    await render();
    expect(slot()).not.toBeNull();
    expect(slot()!.hasAttribute("hidden")).toBe(true);
  });

  test("is the jump bar's trail: the path first, and the path is Go to File…", async () => {
    resetStudioState({ name: "Site", projectRoot: "/p" });
    resetWorkspaceWithTab(undefined, { documentPath: "/p/pages/index.json" });
    await render();
    expect(slot()!.hasAttribute("hidden")).toBe(false);
    expect(field("document")?.tagName).toBe("NAV");
    const button = buttonIn("document");
    expect(button.textContent.trim()).toBe("pages/index.json");
    button.click();
    expect(ran.at(-1)!.id).toBe("palette.openFiles");
  });

  test("names every ancestor of the selection, and each one selects it", async () => {
    const tab = resetWorkspaceWithTab({
      children: [{ children: [{ tagName: "li" }], tagName: "ul" }],
      tagName: "div",
    });
    tab.session.selection = [["children", 0, "children", 0]];
    await render();
    expect(crumbs()).toEqual(["/project/index.json", "ul", "li"]);
    const ul = [...barHost().querySelectorAll<HTMLElement>('button[part="crumb"]')][1]!;
    ul.click();
    expect(ran.at(-1)).toEqual({ args: { path: ["children", 0] }, id: "selection.set" });
  });

  test("states no view and no save word — the context bar and the tab strip own those", async () => {
    const tab = resetWorkspaceWithTab();
    tab.doc.dirty = true;
    ctx = makeContext({ canvas: { view: "preview" }, editor: { kind: "canvas" } });
    await render();
    for (const word of ["Preview", "Unsaved changes", "Saved", "Read-only"]) {
      expect(barHost().textContent).not.toContain(word);
    }
  });

  test("unmounting the bar takes the trail down with it", async () => {
    resetWorkspaceWithTab();
    await render();
    expect(crumbs()).toEqual(["/project/index.json"]);
    unmountStatusbar();
    await flush();
    expect(crumbs()).toEqual([]);
  });
});

// ─── SELECTION ───────────────────────────────────────────────────────────────

describe("the SELECTION field", () => {
  test("is absent with nothing selected", async () => {
    resetWorkspaceWithTab();
    await render();
    expect(field("selection")).toBeNull();
  });

  test("holds NO ancestor trail — the trail is the DOCUMENT field's, and one copy is the point", async () => {
    const tab = resetWorkspaceWithTab({
      children: [{ children: [{ tagName: "li", textContent: "Item" }], tagName: "ul" }],
      tagName: "div",
    });
    ctx = makeContext({ document: { open: true } });
    tab.session.selection = [["children", 0, "children", 0]];
    await render();
    // A single selection leaves the field empty: the trail's leaf states it, with its ancestors,
    // One field to the left.
    expect(field("selection")).toBeNull();
    expect(barHost().querySelectorAll(".sb-sep")).toHaveLength(0);
    const shown = items();
    expect(shown).not.toContain("ul");
    expect(shown).not.toContain("li");
  });

  test("a batch says its SIZE, which is the one selection fact an address cannot state", async () => {
    const tab = resetWorkspaceWithTab({
      children: [{ tagName: "p" }, { tagName: "p" }, { tagName: "p" }],
      tagName: "div",
    });
    tab.session.selection = [
      ["children", 0],
      ["children", 2],
    ];
    await render();
    expect(field("selection")?.textContent.trim()).toBe("2 selected");
    // A count is a readout, not a control: there is no command that "selects two things".
    expect(field("selection")?.querySelectorAll("button")).toHaveLength(0);
  });

  test("the stylebook selector is the field's content when no node is picked", async () => {
    const tab = resetWorkspaceWithTab();
    tab.session.ui.canvasMode = "stylebook";
    shell.stylebook.selection = "ul li";
    await render();
    expect(field("selection")?.textContent.trim()).toBe("ul › li");
  });

  test("the stylebook selector is not stated once the focused tab leaves the stylebook", async () => {
    // Styles > pick h1 > switch to Publish or Content: the selection survives for the way back, but
    // The tab now focused is not editing it.
    const tab = resetWorkspaceWithTab();
    tab.session.ui.canvasMode = "stylebook";
    shell.stylebook.selection = "h1";
    await render();
    expect(field("selection")?.textContent.trim()).toBe("h1");
    tab.session.ui.canvasMode = "design";
    await render();
    expect(field("selection")).toBeNull();
    expect(shell.stylebook.selection).toBe("h1");
  });

  test("outside the stylebook a node selection is the only answer, even printing nothing", async () => {
    const tab = resetWorkspaceWithTab({ children: [{ tagName: "p" }], tagName: "div" });
    shell.stylebook.selection = "h1";
    tab.session.selection = [["children", 0]];
    await render();
    // Two answers to "what is selected" is the defect; the document's answer wins, and when it has
    // Nothing ambient to add the field is absent rather than falling through to the other one.
    expect(field("selection")).toBeNull();
  });

  test("in the stylebook the rule wins over the root the tag pick parks the selection on", async () => {
    // `selectStylebookTag` writes `selection: [[]]` before it moves the rule, so a single-selection
    // Rule that prints nothing hid `h1` in the one place it is the answer.
    const tab = resetWorkspaceWithTab();
    tab.session.ui.canvasMode = "stylebook";
    tab.session.selection = [[]];
    shell.stylebook.selection = "h1";
    await render();
    expect(field("selection")?.textContent.trim()).toBe("h1");
  });
});

// ─── The registry is the source of truth ─────────────────────────────────────

describe("items are a rendering of the registry", () => {
  test("no registry at all paints an empty bar rather than crashing", async () => {
    setActiveRegistry(null);
    resetStudioState({ name: "Site", projectRoot: "/p" });
    resetWorkspaceWithTab();
    await render();
    expect(barHost().querySelectorAll("button")).toHaveLength(0);
  });

  test("an item whose command is unregistered disappears; the field survives", async () => {
    setActiveRegistry(buildRegistry(["project.openRecent"]));
    resetStudioState({ name: "Site", projectRoot: "/p" });
    shell.git.status = {
      ahead: 0,
      behind: 0,
      branch: "main",
      files: [],
      isRepo: true,
      remotes: [],
    };
    await render();
    expect(items()).toEqual(["Site"]);
  });

  test("a hidden command hides its item", async () => {
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.register({
      ...stub("project.openRecent", "Open Recent…", "project"),
      when: () => false,
    });
    setActiveRegistry(registry);
    resetStudioState({ name: "Site", projectRoot: "/p" });
    await render();
    expect(field("project")).toBeNull();
  });

  test("a disabled command renders disabled, with its own requires sentence", async () => {
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.register({
      ...stub("project.openRecent", "Open Recent…", "project"),
      enablement: () => false,
      requires: "a recent project",
    });
    setActiveRegistry(registry);
    resetStudioState({ name: "Site", projectRoot: "/p" });
    await render();
    const recent = buttonIn("project");
    expect(recent.disabled).toBe(true);
    expect(recent.title).toContain("a recent project");
  });
});

// ─── Mounting ────────────────────────────────────────────────────────────────

describe("mountStatusbar", () => {
  test("repaints when the state it renders changes", async () => {
    const tab = resetWorkspaceWithTab();
    mountStatusbar();
    await flush();
    expect(field("selection")).toBeNull();
    tab.session.selection = [
      ["children", 0],
      ["children", 1],
    ];
    await flush();
    expect(field("selection")).not.toBeNull();
  });

  test("repaints when a problem arrives", async () => {
    resetStudioState({ name: "Site", projectRoot: "/p" });
    mountStatusbar();
    await flush();
    expect(items()).not.toContain("⚠ 1");
    notify.error("Broken");
    await flush();
    expect(items()).toContain("⚠ 1");
  });

  test("a multi-selection says its SIZE — the one selection fact this bar still owns (§6.7)", async () => {
    const tab = resetWorkspaceWithTab();
    mountStatusbar();
    await flush();
    tab.session.selection = [["children", 0]];
    await flush();
    expect(items()).not.toContain("2 selected");
    tab.session.selection = [
      ["children", 0],
      ["children", 1],
    ];
    await flush();
    expect(items()).toContain("2 selected");
  });

  test("is idempotent — a second mount replaces the effect rather than stacking one", async () => {
    const tab = resetWorkspaceWithTab();
    mountStatusbar();
    mountStatusbar();
    await flush();
    tab.session.selection = [
      ["children", 0],
      ["children", 1],
    ];
    await flush();
    expect(barHost().querySelectorAll('[data-jx-region="statusbar/selection"]')).toHaveLength(1);
  });

  test("unmount stops the repaint", async () => {
    const tab = resetWorkspaceWithTab();
    mountStatusbar();
    await flush();
    expect(field("selection")).toBeNull();
    unmountStatusbar();
    // A BATCH, not a single node: a single selection leaves this field empty either way, so it
    // Could not tell a stopped effect from a live one.
    tab.session.selection = [
      ["children", 0],
      ["children", 1],
    ];
    await flush();
    expect(field("selection")).toBeNull();
  });
});
