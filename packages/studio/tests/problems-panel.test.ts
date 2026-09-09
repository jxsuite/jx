/**
 * Problems (`panels/problems-panel.ts`) — the surface that keeps `notify`'s promise.
 *
 * Four things are worth pinning: that the list is a RENDERING of `services/notify.ts`'s store
 * (nobody pushes rows at it), that the recovery button is a projection of a command record — its
 * label, its disabled state and its refusal sentence all come off the registry — that there is
 * exactly ONE record, hosted in the Bottom dock (§7.2), whose badge the rail borrows, and that the
 * document it mounts leaves the host the moment the dock paints another tab into it.
 *
 * The body is a Jx document, so every assertion below is against `part` names and every render is
 * awaited: `mountSurface` settles when the DOCUMENT has rendered and each kit element's own
 * template is one `connectedCallback` after that.
 */
import { flush, installMockPlatform } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { nothing } from "lit-html";
import {
  groupProblems,
  projectProblems,
  registerProblemsPanel,
  UNGROUPED_SOURCE,
} from "../src/panels/problems-panel";
import { getPanel, panelContext, resetPanels } from "../src/panels/panel-registry";
import { notify, problems, resetNotifications } from "../src/services/notify";
import { setActiveRegistry } from "../src/commands/active-registry";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext, makeContext } from "../src/commands/context";
import type { CommandContext } from "../src/commands/context";
import type { NavigatorPanelContext, PanelRecord } from "../src/panels/panel-registry";

let ctx: CommandContext = emptyContext();
const ran: { id: string; args: unknown }[] = [];

/** Every path a click opened. */
const opened: string[] = [];

/* The file opener, doubled. A path button hands off to `files/files.ts`'s `openFileInTab` through a
   LAZY import, so without a double there is nothing to assert against — and worse, the real module
   settles whenever it settles: it reaches the platform, fails to find the file, and files a Problem
   of its own into whichever test happens to be running by then. That is not hypothetical; it is
   what made "dismissing a row takes it off the store" find a second row under `--coverage`. */
void mock.module("../src/files/files.js", () => ({
  openFileInTab: (path: string) => {
    opened.push(path);
    return Promise.resolve();
  },
}));

/** A registry with one command that is visible, and refused when there is nothing to undo. */
function buildRegistry() {
  const registry = createCommandRegistry({ getContext: () => ctx });
  registry.register({
    category: "File",
    id: "file.save",
    level: "document",
    requires: "an open document",
    run: (_c, args) => {
      ran.push({ args, id: "file.save" });
    },
    title: "Save",
    when: () => true,
    enablement: (c) => c.document.open,
  });
  return registry;
}

/** What the Bottom dock hands a tab: no deps, no document — Problems is a project-level list. */
const PANEL_CTX: NavigatorPanelContext = {
  deps: {} as never,
  doc: null,
  rerender: () => {},
};

/** The panel body the dock paints its active tab into. */
let host: HTMLElement;

beforeEach(() => {
  // The in-memory platform, so nothing here can reach a real backend. The one call that used to
  // Need it — the path button's file opener — is doubled above instead.
  installMockPlatform();
  resetNotifications();
  resetPanels();
  ran.length = 0;
  opened.length = 0;
  ctx = makeContext({ document: { open: true } });
  setActiveRegistry(buildRegistry());
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  /* Twice, and the first one is the housekeeping. A test that called `render` without the
     `afterRender` beside it leaves the "the dock drew me" mark set, so the first call consumes it
     (mounting, at worst) and the second is the take-down every test needs. */
  const panel = getPanel("problems");
  panel?.afterRender?.(PANEL_CTX, host);
  panel?.afterRender?.(PANEL_CTX, host);
  await flush(2);
  host.remove();
  resetNotifications();
  resetPanels();
  setActiveRegistry(null);
});

/** The record, registered on first ask so a test can still assert what a second call does. */
function record(): PanelRecord {
  if (!getPanel("problems")) {
    registerProblemsPanel();
  }
  return getPanel("problems")!;
}

/**
 * Paint the dock with Problems as the active tab: `render` for the tab that was chosen, then
 * `afterRender` for every tab, which is exactly what `panels/bottom-dock.ts` does.
 */
async function paint(): Promise<HTMLElement> {
  const panel = record();
  panel.render(PANEL_CTX);
  panel.afterRender?.(PANEL_CTX, host);
  await flush(4);
  return host;
}

/** Paint the dock with some OTHER tab active: `afterRender` runs, `render` did not. */
async function paintAnotherTab(): Promise<void> {
  record().afterRender?.(PANEL_CTX, host);
  await flush(2);
}

function part(name: string): HTMLElement | null {
  return host.querySelector(`[part="${name}"]`);
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll('[part="row"]')] as HTMLElement[];
}

describe("groupProblems", () => {
  test("groups by source in first-seen order, and names the ungrouped group", () => {
    notify.error("A", { source: "Save" });
    notify.error("B", {});
    notify.warn("C", { source: "Save", tier: "problem" });
    const groups = groupProblems();
    expect(groups.map((group) => group.source)).toEqual(["Save", UNGROUPED_SOURCE]);
    expect(groups[0]!.records.map((record_) => record_.message)).toEqual(["A", "C"]);
  });

  test("reads the live store by default", () => {
    notify.error("live");
    expect(groupProblems()).toHaveLength(1);
    expect(groupProblems([])).toEqual([]);
  });
});

describe("the projection", () => {
  test("an empty store says so, and counts nothing", () => {
    const values = projectProblems();
    expect(values.hasProblems).toBe(false);
    expect(values.groups).toEqual([]);
    expect(values.clearLabel).toBe("Clear 0");
  });

  test("a record becomes a row of values — no records, no closures", () => {
    notify.error("bad key", { detail: "at $.adaptor", path: "project.json", source: "Validation" });
    const row = projectProblems().groups[0]!.rows[0]!;
    expect(row).toMatchObject({
      detail: "at $.adaptor",
      dismissLabel: "Dismiss: bad key",
      hasAction: false,
      hasDetail: true,
      hasPath: true,
      icon: "✕",
      message: "bad key",
      path: "project.json",
      pathTitle: "Open project.json",
      severity: "error",
    });
  });
});

describe("rendering", () => {
  test("an empty list says nothing needs fixing, in the words of what the region is for", async () => {
    await paint();
    expect(part("empty-message")?.textContent).toContain("Nothing needs fixing");
    expect(part("row")).toBeNull();
  });

  test("a row carries severity, message, source, path and detail", async () => {
    notify.error("project.json:14 unknown key", {
      detail: "at $.adaptor",
      path: "project.json",
      source: "Validation",
    });
    await paint();
    expect(rows()[0]?.dataset["severity"]).toBe("error");
    expect(part("group-title")?.textContent).toContain("Validation");
    expect(part("message")?.textContent).toContain("unknown key");
    expect(part("file-path")?.textContent).toContain("project.json");
    expect(part("file-path")?.getAttribute("title")).toBe("Open project.json");
    expect(part("detail")?.textContent).toContain("at $.adaptor");
  });

  test("a problem with no path and no detail renders neither", async () => {
    notify.error("bare");
    await paint();
    expect(part("file-path")).toBeNull();
    expect(part("detail")).toBeNull();
  });

  test("clicking a path hands that file to the opener", async () => {
    notify.error("bad", { path: "pages/index.md" });
    await paint();
    (part("file-path") as HTMLElement).click();
    await flush();
    expect(opened).toEqual(["pages/index.md"]);
  });

  test("dismissing a row takes it off the store", async () => {
    notify.error("go away");
    await paint();
    (host.querySelector('[part="dismiss"] [part="control"]') as HTMLElement).click();
    expect(problems).toHaveLength(0);
  });

  test("the dismiss button names the row it dismisses", async () => {
    notify.error("go away");
    await paint();
    const control = host.querySelector('[part="dismiss"] [part="control"]') as HTMLElement;
    expect(control.getAttribute("aria-label")).toBe("Dismiss: go away");
  });

  test("Clear takes the whole list", async () => {
    notify.error("one");
    notify.error("two");
    await paint();
    const clear = host.querySelector('[part="clear"] [part="control"]') as HTMLElement;
    expect(clear.textContent).toContain("Clear 2");
    clear.click();
    expect(problems).toHaveLength(0);
  });

  test("rows are grouped under their source, in first-seen order", async () => {
    notify.error("A", { source: "Save" });
    notify.error("B", { source: "Canvas" });
    notify.error("C", { source: "Save" });
    await paint();
    expect([...host.querySelectorAll('[part="group-title"]')].map((h) => h.textContent)).toEqual([
      "Save",
      "Canvas",
    ]);
    expect([...host.querySelectorAll('[part="group"]')][0]?.querySelectorAll("li")).toHaveLength(2);
  });
});

describe("the list keeps itself current", () => {
  /* The lit body was redrawn because the DOCK repainted, and the dock repainted on this panel's
     own badge — a coincidence that happened to cover every change. The document is fed by an
     effect instead, so none of these needs a second paint. */
  test("a problem raised after the mount appears without another paint", async () => {
    await paint();
    expect(part("row")).toBeNull();
    notify.error("late arrival");
    await flush(2);
    expect(part("message")?.textContent).toContain("late arrival");
  });

  test("a dismissed row leaves, and the Clear label follows the count", async () => {
    notify.error("one");
    notify.error("two");
    await paint();
    expect(rows()).toHaveLength(2);
    (host.querySelector('[part="dismiss"] [part="control"]') as HTMLElement).click();
    await flush(2);
    expect(rows()).toHaveLength(1);
    expect(host.querySelector('[part="clear"] [part="control"]')?.textContent).toContain("Clear 1");
  });

  test("a registry published after the mount turns the recovery buttons on", async () => {
    setActiveRegistry(null);
    notify.error("Save failed", { action: "file.save" });
    await paint();
    expect(part("action")).toBeNull();
    setActiveRegistry(buildRegistry());
    await flush(2);
    expect(part("action")?.textContent?.trim()).toBe("Save");
  });
});

describe("the recovery button is the command record", () => {
  test("its label is the command's title, and clicking it runs the command with its args", async () => {
    notify.error("Save failed", { action: "file.save", actionArgs: { path: "a.md" } });
    await paint();
    const action = part("action")!;
    expect(action.textContent?.trim()).toBe("Save");
    expect((action.querySelector('[part="control"]') as HTMLButtonElement).disabled).toBe(false);
    (action.querySelector('[part="control"]') as HTMLElement).click();
    await flush();
    expect(ran).toEqual([{ args: { path: "a.md" }, id: "file.save" }]);
  });

  test("a refused command renders disabled, with the requires sentence as its tooltip", async () => {
    ctx = makeContext({ document: { open: false } });
    notify.error("Save failed", { action: "file.save" });
    await paint();
    const action = part("action")!;
    expect((action.querySelector('[part="control"]') as HTMLButtonElement).disabled).toBe(true);
    expect(action.getAttribute("title")).toContain("requires an open document");
  });

  test("a command the registry does not have renders no button at all", async () => {
    notify.error("Attach failed", { action: "collab.retry" });
    await paint();
    expect(part("action")).toBeNull();
  });

  test("no registry at all is a row with no button, not a crash", async () => {
    setActiveRegistry(null);
    notify.error("Save failed", { action: "file.save" });
    await paint();
    expect(part("row")).not.toBeNull();
    expect(part("action")).toBeNull();
  });

  test("a problem that named no command renders no button", async () => {
    notify.error("nothing to do");
    await paint();
    expect(part("action")).toBeNull();
  });

  test("a click on a row whose command has gone is inert, not a throw", async () => {
    notify.error("Save failed", { action: "file.save" });
    await paint();
    const control = host.querySelector('[part="action"] [part="control"]') as HTMLElement;
    setActiveRegistry(null);
    control.click();
    await flush();
    expect(ran).toEqual([]);
  });
});

describe("the document is mounted for the tab that is showing, and only that one", () => {
  /* `bottom-dock.ts` runs EVERY registered tab's `afterRender` against the body it just painted,
     showing or not — which is what Logic needs. A panel whose body is a document has to answer
     "was I the tab drawn?" for itself, or it lands underneath whatever is. */
  test("the record draws no markup — the body is a document", () => {
    expect(record().render(PANEL_CTX)).toBe(nothing);
  });

  test("afterRender without a render of its own mounts nothing", async () => {
    notify.error("not yours");
    await paintAnotherTab();
    expect(part("row")).toBeNull();
    expect(host.childNodes).toHaveLength(0);
  });

  test("a repaint with this tab still showing keeps the same document", async () => {
    notify.error("standing");
    await paint();
    const first = part("panel");
    await paint();
    expect(host.querySelectorAll('[part="panel"]')).toHaveLength(1);
    expect(host.querySelector('[part="panel"]')).toBe(first);
  });

  test("the dock painting another tab takes the document out of the body", async () => {
    notify.error("standing");
    await paint();
    expect(part("panel")).not.toBeNull();
    await paintAnotherTab();
    expect(part("panel")).toBeNull();
  });

  test("and selecting it again mounts it back, current", async () => {
    notify.error("first");
    await paint();
    await paintAnotherTab();
    notify.error("second");
    await paint();
    expect(rows()).toHaveLength(2);
  });

  test("a dock that was closed and reopened gets ONE document, in the new body", async () => {
    /* Collapsing the dock paints `nothing` over the whole body and then runs `afterRender` against
       the DOCK rather than the body that just left, and reopening it builds a new body. A handle
       kept per host would never be asked about the old one again: its effect would go on projecting
       into a document nobody can see, once per open and close. */
    notify.error("standing");
    await paint();
    const first = host;
    record().afterRender?.(PANEL_CTX, document.createElement("div")); // The collapse: the dock hands its own host over, with no render of ours before it.
    await flush(2);
    expect(first.querySelector('[part="panel"]')).toBeNull();

    host = document.createElement("div");
    document.body.append(host);
    await paint();
    expect(part("row")).not.toBeNull();
    expect(first.querySelector('[part="panel"]')).toBeNull();
    first.remove();
  });

  test("a body that was emptied under it is mounted into again", async () => {
    notify.error("standing");
    await paint();
    // What a dock repaint does to a host whose part committed something else: the document's root
    // Goes with it, and the handle has to notice rather than update a tree nobody can see.
    host.replaceChildren();
    await paint();
    expect(part("row")).not.toBeNull();
  });
});

describe("the panel record", () => {
  test("is the Bottom dock's project-level Problems tab, with the count as its badge", () => {
    const panel = record();
    expect(panel.dock).toBe("bottom");
    // And OFF the rail, like the three tabs beside it. It had a button in the PROJECT group while
    // Its body was drawn here, which took a per-dock branch in three places and pointed a
    // Left-hand control at a dock along the bottom. The status bar carries the count.
    expect(panel.rail).toBe(false);
    expect(panel.level).toBe("project");
    expect(panel.title).toBe("Problems");
    // P3 registered this id with `when: () => false`. The predicate is what P4.2 deleted.
    expect(panel.when).toBeUndefined();

    const pctx = panelContext();
    expect(panel.badge?.(pctx)).toBeNull();
    notify.error("one");
    expect(panel.badge?.(pctx)).toBe(1);
  });

  test("has exactly one registration site — a second call is a duplicate, and throws", () => {
    // The guard that used to make this idempotent existed because two hosts registered the record.
    // One host, one caller: a second call is a genuine second definition and must fail loudly.
    registerProblemsPanel();
    expect(() => registerProblemsPanel()).toThrow(/already registered/);
  });
});
