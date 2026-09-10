/**
 * The pane's chrome — the context bar (region ⑦) and the floating zoom pod (region ⑩).
 *
 * These cases are the old `tab-bar` suite re-aimed at what replaced it, and then re-aimed again at
 * the DOCUMENT that replaced the lit template. The claims that changed:
 *
 * - **Three labelled axes, not five unlabelled controls.** Every axis renders under its own name, and
 *   the tests assert the names, because the label is the whole point of the restructure.
 * - **Preview is a flag over a base, not a third radio value.** The radio marks the base throughout
 *   and a separate `aria-pressed` toggle says whether preview is on.
 * - **The rendering context only selects.** Its popover ends in "Manage contexts…", which runs
 *   `settings.open` — the definition site — rather than defining anything itself.
 * - **The pod floats.** Zoom left the band; the fit picker writes the declared {@link FitMode}.
 * - **The band is where a standing statement goes.** The read-only banner (§7.4) is drawn here,
 *   inside the band the stage is offset by, because this is the per-document chrome directly above
 *   the editing surface.
 *
 * **Nothing below names a class**, and that is the conversion's own gate: a surface document styles
 * through `part` and states itself through roles, so a test that still found a control by
 * `.pc-view` would be asserting a stylesheet. Every query here is a `part`, a region, a role or an
 * accessible name — which is also why the assertions got sharper rather than weaker: `aria-checked`
 * on a radio and `aria-pressed` on a toggle are the contract `?selected` only implied.
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Tab } from "../src/tabs/tab";

const paneContext = await import("../src/panels/pane-context");
const { PRIMARY_PANE, SECONDARY_PANE, closeAllTabs, focusPane, openTab, splitRight, workspace } =
  await import("../src/workspace/workspace");
const { getFit, hasDeclaredFit, resetFits } = await import("../src/canvas/canvas-utils");
const { createCommandRegistry } = await import("../src/commands/registry");
const { makeContext } = await import("../src/commands/context");
const { activeRegistry, setActiveRegistry } = await import("../src/commands/active-registry");
const { canvasViewCommands } = await import("../src/canvas/canvas-utils");
const { collabState } = await import("../src/collab/collab-state");
const { getEffectiveLocales } = await import("../src/site-context");
const { tabOfPane } = await import("../src/canvas/canvas-surface");
const { localeLabel } = await import("@jxsuite/schema/locale");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

type Ctx = Parameters<typeof paneContext.mount>[1];

/**
 * The ctx, with a `setCanvasMode` double that RECORDS ITS TARGET and writes through it.
 *
 * Both halves matter, and both were missing. The double used to be `(_mode: string) => {}`, holding
 * no tab and changing nothing — so `toHaveBeenCalledWith("source")` could not distinguish "the
 * bar's own tab moved" from "some other pane's tab moved", which is exactly the defect the Editor
 * picker had. It writes through now, so a second pane's bar drawn from the same fixture disagrees
 * visibly when the wrong tab is written.
 *
 * There is no `getCanvasMode` double either, because there is no `getCanvasMode` in the ctx: it
 * answered for the FOCUSED pane and this bar is drawn per pane. Every mode question the bar asks is
 * now asked of a real tab, so a fixture can no longer describe a state the app cannot be in.
 */
function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    exportFile: mock(() => {}),
    parseMediaEntries: mock(() => ({
      baseWidth: 1200,
      featureQueries: [] as { name: string; query: string }[],
      sizeBreakpoints: [] as { name: string; query: string; width: number; type: string }[],
    })),
    setCanvasMode: mock((tab: Tab | null, mode: string) => {
      if (tab) {
        tab.session.ui.canvasMode = mode;
      }
    }),
    ...overrides,
  } as Ctx;
}

/**
 * A ctx for a pane whose tab is in `mode`. The MODE is a fact about the tab, and only about the
 * tab.
 *
 * This used to set the tab's mode AND hand back a `getCanvasMode` double returning the same string,
 * with a docstring defending the pair as "both, because both are now read". They cannot disagree in
 * a fixture, which is the whole reason they disagreed in the app: the Export control asked the ctx
 * and got the focused pane's answer, so a Code document in either pane put an Export button in both
 * bars. One source of truth, so the fixture can no longer hide the difference.
 */
function ctxInMode(mode: string, overrides: Partial<Ctx> = {}): Ctx {
  const tab = tabOfPane(PRIMARY_PANE);
  if (tab) {
    tab.session.ui.canvasMode = mode;
    tab.session.ui.preview = false;
  }
  return makeCtx(overrides);
}

function openTestTab(media?: Record<string, string>): Tab {
  const tab = resetWorkspaceWithTab(
    {
      children: [{ tagName: "p", textContent: "Hi" }],
      tagName: "div",
      ...(media ? { $media: media } : {}),
    } as never,
    { documentPath: "/project/index.json", id: "pane-context-tab" },
  );
  tab.capabilities.modes = ["edit", "design", "preview", "source"];
  return tab;
}

/** The document behind {@link withScheme}: `parseMediaEntries` is a stub, `$media` is the truth. */
const SCHEME_MEDIA = {
  "--dark-mode": "(prefers-color-scheme: dark)",
  "--reduced-motion": "(prefers-reduced-motion: reduce)",
  md: "(min-width: 768px)",
};

/**
 * Mount and let the document settle.
 *
 * A mounted surface needs more turns than a lit render: `mountSurface` awaits the kit, the runtime
 * renders a microtask after insertion, and each kit element settles its own template one
 * `connectedCallback` later.
 */
async function mountBar(ctx: Ctx = makeCtx()): Promise<void> {
  paneContext.mount(root, ctx);
  await flush(6);
}

// ─── Reading the surface: parts, roles and names — never classes ─────────────

function part(name: string, host: HTMLElement = root): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[part="${name}"]`);
}

function partAll(name: string, host: HTMLElement = root): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(`[part="${name}"]`)];
}

/** A kit button's accessible name: the words it prints, or the label it carries when it prints none. */
function nameOf(el: Element): string {
  const printed = el.querySelector('[part="label"]')?.textContent?.trim() ?? "";
  return printed || (el.querySelector('[part="control"]')?.getAttribute("aria-label") ?? "");
}

/** Every kit button in the chrome, by accessible name. */
function buttons(host: HTMLElement = root): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("jx-action-button")];
}

function labels(host: HTMLElement = root): string[] {
  return buttons(host).map((b) => nameOf(b));
}

function btn(label: string, host: HTMLElement = root): HTMLElement {
  const match = buttons(host).find((b) => nameOf(b) === label);
  if (!match) {
    throw new Error(`no button named "${label}" — have: ${labels(host).join(", ")}`);
  }
  return match;
}

function hasBtn(label: string, host: HTMLElement = root): boolean {
  return buttons(host).some((b) => nameOf(b) === label);
}

/** The inner control a kit element states itself on: role, aria-checked, aria-pressed, title. */
function control(el: Element): HTMLElement {
  return el.querySelector<HTMLElement>('[part="control"]')!;
}

/** The axis labels the bar prints, in order — the assertion the restructure exists for. */
function axes(host: HTMLElement = root): string[] {
  return partAll("axis-label", host).map((el) => el.textContent?.trim() ?? "");
}

/** The segments of a named radio/toggle group, by printed word. */
function segments(groupPart: string, host: HTMLElement = root): HTMLElement[] {
  const strip = part(groupPart, host);
  return strip ? [...strip.querySelectorAll<HTMLElement>("jx-action-button")] : [];
}

/** A `jx-select`'s native control — what a reader picks from, and what a test writes. */
function select(partName: string, host: HTMLElement = root): HTMLSelectElement | null {
  return part(partName, host)?.querySelector<HTMLSelectElement>("select") ?? null;
}

function choose(el: HTMLSelectElement | HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The popover group under `label` — the groups are keyed by their own heading. */
function group(label: string, host: HTMLElement = root): HTMLElement | null {
  return (
    partAll("ctx-group", host).find(
      (g) => g.querySelector('[part="ctx-group-label"]')?.textContent?.trim() === label,
    ) ?? null
  );
}

/**
 * A registry holding what the chrome reaches for, so a click is observable.
 *
 * The three rendering-context axes are REAL records — `canvasViewCommands` — because the popover's
 * controls run them now rather than writing `session.ui` directly. Stubbing them would leave the
 * assertions below testing that a click calls a spy, when what they need to prove is that it
 * changes the tab.
 */
function installRegistry(ran: string[]) {
  const registry = createCommandRegistry({
    /* `isMultilingual` is DERIVED here, exactly as `commands/live-context.ts` derives it, rather
       than asserted true: `i18n.switchLocale` is gated on it, and a fixture that claimed it while
       `projectState` declared no locales would describe a state the app cannot be in — the same
       defect the `getCanvasMode` double had. */
    getContext: () =>
      makeContext({
        document: { open: true },
        project: { isMultilingual: (getEffectiveLocales()?.locales.length ?? 0) > 1, open: true },
      }),
    mac: true,
  });
  registry.registerAll(
    canvasViewCommands({
      getCanvasMode: () => "design",
      renderPane: () => {},
      setCanvasMode: () => {},
      setOpenPopover: () => {},
      setOpenDialog: () => {},

      setResolvingOpen: paneContext.setResolvingOpen,
    }).filter((c) =>
      [
        "canvas.setBreakpoint",
        "canvas.setColorScheme",
        "canvas.setLayoutVisible",
        "canvas.setResolvingOpen",
        "canvas.setRouteParam",
        "canvas.setTestProp",
        // Axis 3's fourth segment. Its id is in the `i18n.` namespace and its definition site is
        // `canvas-utils.ts`, for the reason that record's comment gives.
        "i18n.switchLocale",
      ].includes(c.id),
    ),
  );
  registry.register({
    category: "Project",
    group: "7_settings",
    id: "settings.open",
    level: "project",
    menus: ["palette"],
    run: (_ctx, args) => {
      ran.push(`settings.open:${String((args as { section?: string }).section)}`);
    },
    title: "Open Settings",
  });
  setActiveRegistry(registry);
}

let root: HTMLElement;

beforeEach(() => {
  paneContext.resetResolvingOpen();
  closeAllTabs();
  resetStudioState();
  installMockPlatform();
  resetFits();
  // The bar's controls RUN COMMANDS now, so every test needs the registry — not only the two that
  // Were watching `settings.open`. Without one, a click is a silent no-op and an assertion about
  // `session.ui` reads the value the test set up.
  installRegistry([]);
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  paneContext.unmount();
  setActiveRegistry(null);
  root.remove();
});

// ─── The band itself ──────────────────────────────────────────────────────────

describe("the bar", () => {
  test("renders the three labelled axes for an ordinary editor tab", async () => {
    openTestTab();
    await mountBar();
    expect(part("bar")).not.toBeNull();
    expect(axes()).toEqual(["Editor", "View", "Context"]);
  });

  test("carries this pane's region on the BAR, never on the host it was handed", async () => {
    // `resolveRegion` takes the LAST match, so an id on the wrapper as well would be a silently
    // Widened crop — `panels/pane-grid.ts` says so at the ref that hands this module its host.
    openTestTab();
    await mountBar();
    expect(part("bar")!.dataset.jxRegion).toBe("pane.primary/context");
    expect(root.dataset.jxRegion).toBeUndefined();
  });

  test("renders nothing — and no stage offset — when there is no active tab", async () => {
    await mountBar();
    expect(part("bar")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--pane-context-h")).toBe("0px");
  });

  test("offsets the stage by the bar's height while a bar is on screen", async () => {
    openTestTab();
    await mountBar();
    expect(document.documentElement.style.getPropertyValue("--pane-context-h")).toBe("28px");
    paneContext.unmount();
    expect(document.documentElement.style.getPropertyValue("--pane-context-h")).toBe("0px");
  });

  test("render() is inert before mount and after unmount", async () => {
    openTestTab();
    paneContext.render();
    expect(root.childElementCount).toBe(0);
    await mountBar();
    paneContext.unmount();
    expect(part("bar")).toBeNull();
    paneContext.render();
    await flush(6);
    expect(part("bar")).toBeNull();
  });

  test("Project Settings gets no bar at all — three inert controls above their own definition site", async () => {
    const tab = openTestTab();
    await mountBar();
    expect(part("bar")).not.toBeNull();
    tab.session.ui.canvasMode = "settings";
    await flush(6);
    expect(part("bar")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--pane-context-h")).toBe("0px");
  });

  test("no read-only banner while the document has no collaboration to report", async () => {
    openTestTab();
    await mountBar();
    expect(part("banner")).toBeNull();
  });

  test("a read-only collaborator gets the banner, above the stage, before the first keystroke", async () => {
    const tab = openTestTab();
    await mountBar();
    const state = collabState(tab);
    state.active = true;
    state.readOnly = true;
    await flush(4);
    const banner = part("banner");
    expect(banner).not.toBeNull();
    expect(banner!.dataset.kind).toBe("read-only");
    expect(banner!.textContent).toContain("not published to the other people");
    expect(banner!.getAttribute("role")).toBe("status");
    // Inside the band the stage is offset by, so it pushes the document down rather than over it.
    expect(part("band")!.contains(banner)).toBe(true);
  });

  test("the banner appears and disappears with the permission, without another edit", async () => {
    const tab = openTestTab();
    await mountBar();
    const state = collabState(tab);
    state.active = true;
    await flush(4);
    expect(part("banner")).toBeNull();

    state.readOnly = true;
    await flush(4);
    expect(part("banner")).not.toBeNull();

    state.readOnly = false;
    await flush(4);
    expect(part("banner")).toBeNull();
  });

  test("an inactive session with the read-only flag says nothing — there is nobody to be read-only to", async () => {
    const tab = openTestTab();
    await mountBar();
    const state = collabState(tab);
    state.readOnly = true;
    state.active = false;
    await flush(4);
    expect(part("banner")).toBeNull();
  });

  test("a logic editor keeps the banner — a frozen guest is still a guest", async () => {
    const tab = openTestTab();
    await mountBar();
    const state = collabState(tab);
    state.active = true;
    state.readOnly = true;
    tab.session.ui.editingFunction = { defName: "greet", type: "def" };
    await flush(4);
    expect(part("banner")).not.toBeNull();
  });
});

// ─── There is no takeover ─────────────────────────────────────────────────────

describe("a logic editor open in the dock", () => {
  // The bar used to blank itself the moment `editingFunction` or `editingFormula` was set, on the
  // Grounds that a full-screen sub-editor owned the stage. P8 put both in the Bottom dock's Logic
  // Tab and left the page rendering underneath, so the axes describe the document that is still on
  // Screen and the pod still has something to zoom. Suppressing them removed the controls for the
  // Document the reader could see.
  test("leaves all three axes and the zoom pod exactly where they were", async () => {
    const tab = openTestTab();
    await mountBar();
    const before = axes();
    expect(before).toEqual(["Editor", "View", "Context"]);

    tab.session.ui.editingFunction = { defName: "greet", type: "def" };
    await flush(4);
    expect(axes()).toEqual(before);
    expect(part("pod")).not.toBeNull();

    tab.session.ui.editingFunction = null;
    tab.session.ui.editingFormula = { defName: "total", type: "def" };
    await flush(4);
    expect(axes()).toEqual(before);
    expect(part("pod")).not.toBeNull();
  });

  test("draws no Back and no breadcrumb — the dock header and the jump bar own both", async () => {
    // Two exits and two trails, side by side, for one sub-document. The Logic tab's header carries
    // The real Close (P8.5) and ⑥ carries the address; this bar drew a second of each.
    const tab = openTestTab();
    await mountBar();
    tab.session.ui.editingFunction = { defName: "greet", type: "def" };
    await flush(4);
    expect(root.querySelector('[part="breadcrumb"]')).toBeNull();
    expect(hasBtn("Back")).toBe(false);
  });

  test("the Export control survives too, in the view that owns it", async () => {
    const tab = openTestTab();
    await mountBar(ctxInMode("source"));
    tab.session.ui.editingFormula = { eventKey: "onclick", type: "event" };
    await flush(4);
    expect(hasBtn("Export")).toBe(true);
  });
});

// ─── Axis 1 · Editor kind ─────────────────────────────────────────────────────

describe("editor kind", () => {
  test("a document with several kinds gets a dropdown listing only those kinds", async () => {
    openTestTab();
    await mountBar();
    const picker = select("editor-kind")!;
    expect(picker).not.toBeNull();
    const options = [...picker.querySelectorAll("option")].map((o) => o.textContent?.trim());
    // Edit/design/preview all name the Canvas; source names Code. No dead entry for grid or diff.
    expect(options).toEqual(["Canvas", "Code"]);
    expect(picker.value).toBe("canvas");
    expect(picker.getAttribute("aria-label")).toBe("Editor");
  });

  test("a document with one kind prints its name instead of an immovable dropdown", async () => {
    const tab = openTestTab();
    tab.capabilities.modes = ["edit", "design", "preview"];
    await mountBar();
    expect(part("editor-kind")).toBeNull();
    expect(part("static")?.textContent?.trim()).toBe("Canvas");
  });

  test("choosing a kind lands on that kind's first mode and clears preview", async () => {
    const tab = openTestTab();
    tab.session.ui.preview = true;
    const ctx = makeCtx();
    await mountBar(ctx);

    choose(select("editor-kind")!, "code");
    await flush(4);
    expect(ctx.setCanvasMode).toHaveBeenCalledWith(tab, "source");
    expect(tab.session.ui.preview).toBe(false);
  });

  test("a kind this document does not support is refused rather than half-applied", async () => {
    const tab = openTestTab();
    const ctx = makeCtx();
    await mountBar(ctx);

    /* A kind the document does NOT declare, reported by the control anyway. The picker only ever
       offers declared kinds, so this is the shape a stale option or a programmatic write takes —
       and the refusal has to hold for it, because `modeForEditorKind` answering nothing is the
       only thing standing between it and a half-applied mode. */
    const picker = select("editor-kind")!;
    const rogue = document.createElement("option");
    rogue.value = "library";
    picker.append(rogue);
    choose(picker, "library");
    await flush(4);
    expect(ctx.setCanvasMode).not.toHaveBeenCalled();
    expect(tab.session.ui.canvasMode).toBe("edit");
  });
});

// ─── Axis 2 · Canvas view ─────────────────────────────────────────────────────

describe("canvas view", () => {
  test("is a two-value radiogroup plus a SEPARATE preview toggle", async () => {
    /*
     * This asserted the opposite — three values in one radio group, and "nothing in the axis is a
     * toggle: a value cannot silently compose with another value". But preview does compose, and
     * always did: it is stored as `ui.preview` over an edit/design base, `PREVIEWABLE_BASE_MODES`
     * names which bases it composes with, and `canvasModeOfPane` folds the two together. The radio
     * was describing its own storage inaccurately, and the cost was legible: while previewing, it
     * could not say which mode you were previewing or which one you would come back to.
     */
    openTestTab();
    await mountBar();

    const strip = part("views")!;
    expect(strip.getAttribute("role")).toBe("radiogroup");
    expect(strip.getAttribute("aria-label")).toBe("Canvas view");
    const segs = segments("views");
    expect(segs.map((s) => nameOf(s))).toEqual(["Edit", "Design"]);
    expect(segs.map((s) => control(s).getAttribute("role"))).toEqual(["radio", "radio"]);
    expect(segs.map((s) => control(s).getAttribute("aria-checked"))).toEqual(["true", "false"]);

    const toggle = part("preview-toggle")!;
    expect(nameOf(toggle)).toBe("Preview");
    // A toggle, not a third radio: it announces `aria-pressed` and carries no `aria-checked`.
    expect(control(toggle).getAttribute("aria-pressed")).toBe("false");
    expect(control(toggle).getAttribute("aria-checked")).toBeNull();
  });

  test("previewing leaves the BASE marked — the state the radio could not express", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "design";
    tab.session.ui.preview = true;
    await mountBar();

    expect(segments("views").map((s) => control(s).getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
    ]);
    const toggle = part("preview-toggle")!;
    expect(control(toggle).getAttribute("aria-pressed")).toBe("true");
    // And it says where "off" goes, rather than leaving the author to guess.
    expect(control(toggle).getAttribute("title")).toContain("Design");
  });

  test("the toggle sets the flag and clears it, over either base", async () => {
    const tab = openTestTab();
    const ctx = makeCtx();
    await mountBar(ctx);

    pointer(part("preview-toggle")!, "click");
    await flush(4);
    expect(tab.session.ui.preview).toBe(true);
    expect(tab.session.ui.canvasMode).toBe("edit"); // The base is untouched.

    pointer(part("preview-toggle")!, "click");
    await flush(4);
    expect(tab.session.ui.preview).toBe(false);

    pointer(btn("Design"), "click");
    await flush(4);
    pointer(part("preview-toggle")!, "click");
    await flush(4);
    expect(tab.session.ui.preview).toBe(true);
    expect(ctx.setCanvasMode).toHaveBeenCalledWith(tab, "design");
  });

  test("Design clears the flag on the way past", async () => {
    const tab = openTestTab();
    const ctx = makeCtx();
    await mountBar(ctx);

    pointer(part("preview-toggle")!, "click");
    await flush(4);
    expect(tab.session.ui.preview).toBe(true);

    pointer(btn("Design"), "click");
    await flush(4);
    expect(tab.session.ui.preview).toBe(false);
    expect(ctx.setCanvasMode).toHaveBeenCalledWith(tab, "design");
  });

  test("no toggle for a document that does not declare preview", async () => {
    const tab = openTestTab();
    tab.capabilities.modes = ["edit", "design"];
    await mountBar();
    expect(part("preview-toggle")).toBeNull();
    expect(segments("views").map((s) => nameOf(s))).toEqual(["Edit", "Design"]);
  });

  test("offers only the views the document declares", async () => {
    const tab = openTestTab();
    tab.capabilities.modes = ["edit", "source"];
    await mountBar();
    expect(segments("views").map((s) => nameOf(s))).toEqual(["Edit"]);
    // `source` is in the list but composes with no preview, so the toggle is not offered either.
    expect(part("preview-toggle")).toBeNull();
  });

  test("is absent entirely when the editor is not the Canvas", async () => {
    const tab = openTestTab();
    tab.session.ui.canvasMode = "source";
    await mountBar(ctxInMode("source"));
    expect(part("views")).toBeNull();
    expect(axes()).toEqual(["Editor", "Context"]);
  });

  test("a document whose modes name no Canvas view renders no view axis", async () => {
    const tab = openTestTab();
    tab.capabilities.modes = ["source"];
    tab.session.ui.canvasMode = "edit";
    await mountBar();
    expect(part("views")).toBeNull();
  });
});

// ─── Axis 3 · Rendering context ───────────────────────────────────────────────

describe("rendering context", () => {
  const withScheme = () =>
    makeCtx({
      parseMediaEntries: mock(() => ({
        baseWidth: 1200,
        featureQueries: [
          { name: "--dark-mode", query: "(prefers-color-scheme: dark)" },
          { name: "--reduced-motion", query: "(prefers-reduced-motion: reduce)" },
        ],
        sizeBreakpoints: [{ name: "md", query: "(min-width: 768px)", type: "min", width: 768 }],
      })),
    });

  /** What the rendering-context trigger reads, without the caret glyph beside it. */
  function summary(): string {
    return part("context-trigger")!.querySelector('[part="label"] span')!.textContent!.trim();
  }

  test("summarises size and scheme on the trigger", async () => {
    const tab = openTestTab();
    await mountBar(withScheme());
    expect(summary()).toBe("Base · Auto");

    tab.session.ui.activeMedia = "md";
    tab.session.ui.previewColorScheme = "dark";
    await flush(4);
    expect(summary()).toBe("Md · Dark");
  });

  test("omits the scheme from the summary when the project declares no scheme query", async () => {
    openTestTab();
    await mountBar();
    expect(summary()).toBe("Base");
  });

  test("the size segment writes activeMedia — the field a panel header writes", async () => {
    // The document declares `md` as well as the ctx stub offering it: `canvas.setBreakpoint`
    // Refuses a key the document cannot render under, and a fixture where the control offers one
    // The app would refuse is a fixture testing a shape the app does not have.
    const tab = openTestTab(SCHEME_MEDIA);
    await mountBar(withScheme());

    const sizes = segments("sizes");
    expect(sizes.map((s) => nameOf(s))).toEqual(["Base", "Md"]);
    expect(part("sizes")!.getAttribute("role")).toBe("radiogroup");
    pointer(sizes[1]!, "click");
    await flush(4);
    expect(tab.session.ui.activeMedia).toBe("md");
    expect(segments("sizes").map((s) => control(s).getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
    ]);

    pointer(segments("sizes")[0]!, "click");
    await flush(4);
    // The base row carries the empty string on the wire; the command reads it back as "no
    // Breakpoint applied", which is `null` and not `""`.
    expect(tab.session.ui.activeMedia).toBeNull();
  });

  test("the scheme segment replaces the old bar-level Auto/Light/Dark control", async () => {
    const tab = openTestTab();
    await mountBar(withScheme());

    pointer(btn("Dark"), "click");
    await flush(4);
    expect(tab.session.ui.previewColorScheme).toBe("dark");
    expect(control(btn("Dark")).getAttribute("aria-checked")).toBe("true");

    pointer(btn("Auto"), "click");
    await flush(4);
    expect(tab.session.ui.previewColorScheme).toBe("auto");
    expect(control(btn("Dark")).getAttribute("aria-checked")).toBe("false");
  });

  test("non-scheme feature queries keep their toggles, inside the popover", async () => {
    const tab = openTestTab();
    await mountBar(withScheme());

    const toggle = segments("features").find(
      (b) => control(b).getAttribute("title") === "(prefers-reduced-motion: reduce)",
    )!;
    expect(nameOf(toggle)).toBe("Reduced Motion");
    // A feature is INDEPENDENTLY on or off, so the group is a plain group of pressed toggles —
    // Never a radiogroup, which would say the two queries were mutually exclusive.
    expect(part("features")!.getAttribute("role")).toBe("group");
    expect(control(toggle).getAttribute("aria-pressed")).toBe("false");
    pointer(toggle, "click");
    await flush(4);
    expect(tab.session.ui.featureToggles["--reduced-motion"]).toBe(true);
    expect(
      control(
        segments("features").find(
          (b) => control(b).getAttribute("title") === "(prefers-reduced-motion: reduce)",
        )!,
      ).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("groups a document declares nothing for are absent", async () => {
    openTestTab();
    await mountBar();
    expect(partAll("ctx-group-label").map((el) => el.textContent?.trim())).toEqual(["Size"]);
  });

  // ─── The language segment ───────────────────────────────────────────────────
  /*
   * A rendering context, not a translation. Jx has no message catalogue, so what these buttons
   * change is `lang`, `dir` and `$locale` — and the group's own sentence says exactly that, which
   * is why the tests assert it: a control that let an author believe the page had been translated
   * would be worse than no control.
   */

  /** A project that declares `locales`, with `path` open. */
  function multilingual(locales: string[], path = "pages/about.json"): Tab {
    resetStudioState({ isSiteProject: true, projectConfig: { i18n: { locales } } });
    const tab = resetWorkspaceWithTab({ children: [], tagName: "div" } as never, {
      documentPath: path,
      id: "locale-tab",
    });
    tab.capabilities.modes = ["edit", "design", "preview", "source"];
    return tab;
  }

  test("there is no language group in a project that declares one language", async () => {
    multilingual(["en"]);
    await mountBar();
    // One declared locale is the same as none for this axis: there is nothing to switch TO.
    expect(group("Language")).toBeNull();
  });

  test("one button per declared locale, each labelled in its own language", async () => {
    multilingual(["en", "fr", "ar"]);
    await mountBar();

    const offered = segments("locales");
    expect(offered.map((b) => nameOf(b))).toEqual(["en", "fr", "ar"].map((t) => localeLabel(t)));
    // The autonym, not the name in the site's language: a reader looking for their own language
    // Scans for their own word for it.
    expect(nameOf(offered[2]!)).not.toBe("Arabic");
  });

  test("the group says what it does and does not do", async () => {
    multilingual(["en", "ar"]);
    await mountBar();
    expect(part("locales")!.getAttribute("title")).toBe(
      "The language this pane renders as — its lang and direction only. The text is whatever file is open.",
    );
  });

  test("a button writes through the command, onto THIS pane's tab", async () => {
    const tab = multilingual(["en", "ar"]);
    await mountBar();

    const arabic = segments("locales").find((b) => nameOf(b) === localeLabel("ar"))!;
    pointer(arabic, "click");
    await flush(4);

    // Through `i18n.switchLocale` — the popover is not the capability, the registry is.
    expect(tab.session.ui.previewLocale).toBe("ar");
    expect(
      nameOf(segments("locales").find((b) => control(b).getAttribute("aria-checked") === "true")!),
    ).toBe(localeLabel("ar"));
  });

  test("the document's own language is the selected one until an author says otherwise", async () => {
    multilingual(["en", "fr"], "pages/fr/a-propos.json");
    await mountBar();

    const offered = segments("locales");
    const french = offered.find((b) => nameOf(b) === localeLabel("fr"))!;
    expect(control(french).getAttribute("aria-checked")).toBe("true");
    // …and it says which one it is, because "no override" is not otherwise visible.
    expect(control(french).getAttribute("title")).toContain(
      "the language of the file this pane has open",
    );
    expect(control(offered[0]!).getAttribute("title")).not.toContain("the file this pane has open");
  });

  test("the trigger names the language only when it is not the document's own", async () => {
    const tab = multilingual(["en", "fr"], "pages/fr/a-propos.json");
    await mountBar();
    // A French page in a French pane is not a rendering context worth reporting.
    expect(summary()).toBe("Base");

    tab.session.ui.previewLocale = "en";
    await flush(4);
    expect(summary()).toBe(`Base · ${localeLabel("en")}`);
  });

  test("the layout switch shows for a site page with a layout and flips showLayout", async () => {
    resetStudioState({ isSiteProject: true });
    const tab = resetWorkspaceWithTab(
      { $layout: "./layouts/base.json", children: [], tagName: "div" } as never,
      { documentPath: "pages/about.json", id: "layout-tab" },
    );
    await mountBar();

    const input = () => part("layout-switch")!.querySelector<HTMLInputElement>("input")!;
    expect(input().getAttribute("role")).toBe("switch");
    expect(input().checked).toBe(true);
    input().dispatchEvent(new Event("change", { bubbles: true }));
    await flush(4);
    expect(tab.session.ui.showLayout).toBe(false);
    expect(input().checked).toBe(false);

    input().dispatchEvent(new Event("change", { bubbles: true }));
    await flush(4);
    expect(tab.session.ui.showLayout).toBe(true);
  });

  test("no layout switch for a page without one", async () => {
    resetStudioState({ isSiteProject: true });
    resetWorkspaceWithTab({ children: [], tagName: "div" }, { documentPath: "pages/plain.json" });
    await mountBar();
    expect(part("layout-switch")).toBeNull();
  });

  test("Manage contexts… routes to the definition site instead of defining anything", async () => {
    const ran: string[] = [];
    installRegistry(ran);
    openTestTab();
    await mountBar();

    pointer(part("manage")!, "click");
    await flush(4);
    expect(ran).toEqual(["settings.open:contexts"]);
  });

  test("Manage contexts… is inert, not fatal, before a registry is published", async () => {
    openTestTab();
    await mountBar();
    setActiveRegistry(null);
    expect(() => pointer(part("manage")!, "click")).not.toThrow();
  });

  /**
   * The two panels the axis opens, and the one thing about them this module still owns.
   *
   * Light dismissal, Escape and focus restoration are the PLATFORM's (`popover="auto"`); what the
   * mount owns is that a trigger opens its own panel, that a second press closes it rather than
   * being light-dismissed and reopened by the same gesture, and that a close the platform decided
   * on reaches the flag `canvas.setResolvingOpen` reads.
   */
  describe("the two panels", () => {
    /** Whether the panel behind a trigger is showing, as the trigger itself announces it. */
    function expanded(trigger: string): string | null {
      return control(part(trigger)!).getAttribute("aria-expanded");
    }

    /** A panel, as the kit element states itself: `open`, and the point it was placed at. */
    function panel(kind: string): HTMLElement & { open?: boolean; x?: number; y?: number } {
      return partAll("popover").find((p) => p.dataset.popover === kind)!;
    }

    test("the rendering-context trigger opens its own panel, and a second press closes it", async () => {
      openTestTab();
      await mountBar(withScheme());
      expect(expanded("context-trigger")).toBe("false");

      pointer(part("context-trigger")!, "click");
      await flush(4);
      expect(expanded("context-trigger")).toBe("true");
      expect(panel("context").open).toBe(true);
      // Its own panel, never the one beside it.
      expect(panel("resolving").open).not.toBe(true);

      pointer(part("context-trigger")!, "click");
      await flush(4);
      expect(expanded("context-trigger")).toBe("false");
      expect(panel("context").open).toBe(false);
    });

    test("a panel opens under the control that opened it, at its trailing edge", async () => {
      openTestTab();
      await mountBar(withScheme());
      const trigger = part("context-trigger")!;
      trigger.getBoundingClientRect = () =>
        ({ bottom: 40, height: 20, left: 300, right: 360, top: 20, width: 60 }) as DOMRect;
      pointer(trigger, "click");
      await flush(4);
      /* Below it, and RIGHT-aligned to it: the three axes sit at the trailing edge of a pane that
         may be half the window wide, so a panel hanging off the left of a trigger 40px from the
         window edge would run off the screen. (A panel with no laid-out width in this DOM is zero
         wide, so its trailing edge and the trigger's are the same number.) */
      expect(panel("context").y).toBe(40);
      expect(panel("context").x).toBe(360);
    });

    test("a close the platform decided on reaches the flag the command reads", async () => {
      resetStudioState({ isSiteProject: true });
      resetWorkspaceWithTab(
        { $paths: { param: "sku", values: ["alpha"] }, children: [], tagName: "div" } as never,
        { documentPath: "pages/products/[sku].json", id: "toggle-param" },
      );
      await mountBar();
      await flush(4);

      pointer(part("resolving-trigger")!, "click");
      await flush(4);
      expect(paneContext.isResolvingOpen(PRIMARY_PANE)).toBe(true);
      expect(expanded("resolving-trigger")).toBe("true");

      /* A light dismiss, an Escape, or a second panel taking the top layer: the platform hides it
         and says so with one `toggle`. Without the mirror the flag would still read "open", and
         the next press would try to close a panel that is already shut. */
      panel("resolving").dispatchEvent(
        Object.assign(new Event("toggle", { bubbles: false }), { newState: "closed" }),
      );
      await flush(4);
      expect(paneContext.isResolvingOpen(PRIMARY_PANE)).toBe(false);
      expect(expanded("resolving-trigger")).toBe("false");

      // …so the press after it OPENS, rather than closing something already closed.
      pointer(part("resolving-trigger")!, "click");
      await flush(4);
      expect(paneContext.isResolvingOpen(PRIMARY_PANE)).toBe(true);
    });

    test("taking the chrome down closes whatever it had open", async () => {
      resetStudioState({ isSiteProject: true });
      resetWorkspaceWithTab(
        { $paths: { param: "sku", values: ["alpha"] }, children: [], tagName: "div" } as never,
        { documentPath: "pages/products/[sku].json", id: "dispose-param" },
      );
      await mountBar();
      await flush(4);
      pointer(part("resolving-trigger")!, "click");
      await flush(4);
      expect(paneContext.isResolvingOpen(PRIMARY_PANE)).toBe(true);

      // A pane that stops having chrome cannot go on having a panel over the stage.
      paneContext.unmount();
      expect(paneContext.isResolvingOpen(PRIMARY_PANE)).toBe(false);
      expect(document.querySelector('[part="popover"][data-popover="resolving"]')).toBeNull();
    });
  });

  test("the popovers are panels the pointer can reach, inside a chrome layer that takes none", async () => {
    // `.pane-chrome` is `pointer-events: none` and handed it to its DIRECT children; a document
    // Root is `display: contents`, so the three surfaces that take the pointer say so themselves.
    openTestTab();
    await mountBar();
    for (const panel of partAll("popover")) {
      expect(panel.getAttribute("popover")).toBe("auto");
      expect(panel.id).toContain("primary");
    }
    expect(partAll("popover")).toHaveLength(2);
  });
});

// ─── "Resolving with…" ────────────────────────────────────────────────────────

describe("resolving with", () => {
  /** What the "resolving with" trigger reads, without the caret glyph beside it. */
  function resolvingLabel(): string {
    return part("resolving-trigger")!.querySelector('[part="label"] span')!.textContent!.trim();
  }

  test("a page renders one picker per route param and auto-selects the first value", async () => {
    resetStudioState({ isSiteProject: true });
    const tab = resetWorkspaceWithTab(
      {
        $paths: { param: "sku", values: ["alpha", "beta"] },
        children: [],
        tagName: "div",
      } as never,
      { documentPath: "pages/products/[sku].json", id: "param-tab" },
    );
    await mountBar();
    await flush(4);

    const picker = select("param")!;
    expect(picker).not.toBeNull();
    expect([...picker.querySelectorAll("option")].map((o) => o.textContent?.trim())).toEqual([
      "alpha",
      "beta",
    ]);
    expect(tab.session.ui.previewParams).toEqual({ sku: "alpha" });

    choose(picker, "beta");
    await flush(4);
    expect(tab.session.ui.previewParams).toEqual({ sku: "beta" });
  });

  test("the values live in a popover headed 'resolving with', in a vertical stack", async () => {
    /*
     * They were a row of fields OPEN on the bar, and the argument for that was the screenshot
     * contract: behind a click, typing a test prop costs a second gesture and the manifest's input
     * budget may only ratchet down. The answer is not n text fields on a 28px band that also
     * carries the editor, the view and the rendering context — it is that a transient surface opens
     * by COMMAND (§13.2), so the shot spends a `cmd` step and the input budget is untouched.
     */
    resetStudioState({ isSiteProject: true });
    resetWorkspaceWithTab(
      { $paths: { param: "sku", values: ["alpha"] }, children: [], tagName: "div" } as never,
      { documentPath: "pages/products/[sku].json", id: "inline-param" },
    );
    await mountBar();
    await flush(4);

    const picker = part("param")!;
    expect((picker.closest('[part="popover"]') as HTMLElement | null)?.dataset.popover).toBe(
      "resolving",
    );
    // The phrase is the popover's group heading, and the fields stack under it.
    expect(
      picker.closest('[part="ctx-group"]')!.querySelector('[part="ctx-group-label"]')!.textContent,
    ).toBe("resolving with");
    // …and the bar itself carries only the trigger.
    expect(part("bar")!.contains(part("resolving-trigger"))).toBe(true);
    expect(part("bar")!.querySelector('[part="param"]')).toBeNull();
  });

  test("the trigger says how many values are set, so the chevron reads before it opens", async () => {
    resetStudioState({ isSiteProject: true });
    const tab = resetWorkspaceWithTab(
      {
        $paths: { param: "sku", values: ["alpha", "beta"] },
        children: [],
        tagName: "div",
      } as never,
      { documentPath: "pages/products/[sku].json", id: "count-param" },
    );
    await mountBar();
    await flush(4);
    expect(resolvingLabel()).toBe("Defaults");

    tab.session.ui.previewParams = { sku: "beta" };
    paneContext.render();
    await flush(4);
    expect(resolvingLabel()).toBe("1 set");
  });

  test("canvas.setResolvingOpen is the door the camera and the keyboard use", async () => {
    // A transient surface opens by command, not by clicking — otherwise the one shot that types a
    // Test value would need a CSS selector, which the shot contract forbids outright.
    resetStudioState({ isSiteProject: true });
    resetWorkspaceWithTab(
      { $paths: { param: "sku", values: ["alpha"] }, children: [], tagName: "div" } as never,
      { documentPath: "pages/products/[sku].json", id: "cmd-param" },
    );
    await mountBar();
    await flush(4);
    expect(paneContext.isResolvingOpen(PRIMARY_PANE)).toBe(false);

    void activeRegistry()!.run("canvas.setResolvingOpen", {});
    await flush(4);
    expect(paneContext.isResolvingOpen(PRIMARY_PANE)).toBe(true);
    // Idempotent, and `{ open: false }` closes through the same record rather than a second id.
    void activeRegistry()!.run("canvas.setResolvingOpen", {});
    expect(paneContext.isResolvingOpen(PRIMARY_PANE)).toBe(true);
    void activeRegistry()!.run("canvas.setResolvingOpen", { open: false });
    expect(paneContext.isResolvingOpen(PRIMARY_PANE)).toBe(false);
  });

  test("a pane with no chrome at all is closed, rather than answering for another pane's panel", async () => {
    // The mount owns the answer; a pane that has no mount has no panel to be open.
    await mountBar();
    expect(paneContext.isResolvingOpen(PRIMARY_PANE)).toBe(false);
    expect(() => paneContext.setResolvingOpen(PRIMARY_PANE, true)).not.toThrow();
    expect(paneContext.isResolvingOpen(PRIMARY_PANE)).toBe(false);
  });

  test("no pickers for a page without params", async () => {
    resetStudioState({ isSiteProject: true });
    resetWorkspaceWithTab({ children: [], tagName: "div" }, { documentPath: "pages/simple.json" });
    await mountBar();
    expect(part("param")).toBeNull();
    expect(part("resolving-trigger")).toBeNull();
  });

  test("a component renders one test-prop field per prop, keeping its region id", async () => {
    const tab = resetWorkspaceWithTab(
      {
        children: [{ tagName: "h3", textContent: "${state.title}" }],
        state: {
          count: { default: 3, type: "number" },
          greet: { $prototype: "Function", body: "" },
          title: "Hello",
        },
        tagName: "x-card",
      } as never,
      { documentPath: "components/x-card.json", id: "comp-tab" },
    );
    await mountBar();

    const fields = partAll("prop");
    expect(fields.map((f) => f.dataset.propName)).toEqual(["count", "title"]);
    // The screenshot manifest addresses this field by region; the id survives the move.
    expect(fields[0]!.dataset.jxRegion).toBe("pane.primary/prop:count");
    const inputOf = (f: HTMLElement) => f.querySelector<HTMLInputElement>("input")!;
    expect(inputOf(fields[0]!).getAttribute("placeholder")).toBe("count");

    choose(inputOf(fields[1]!), "Test drive");
    await flush(4);
    expect(tab.session.ui.previewProps).toEqual({ title: "Test drive" });

    choose(inputOf(fields[0]!), "7");
    await flush(4);
    expect(tab.session.ui.previewProps).toEqual({ count: 7, title: "Test drive" });
  });

  test("clearing the last prop field resets previewProps to null", async () => {
    const tab = resetWorkspaceWithTab(
      { children: [], state: { title: "Hello" }, tagName: "x-card" } as never,
      { documentPath: "components/x-card.json", id: "comp-clear" },
    );
    tab.session.ui.previewProps = { title: "Test drive" };
    await mountBar();

    const field = part("prop")!.querySelector<HTMLInputElement>("input")!;
    expect(field.value).toBe("Test drive");
    choose(field, "");
    await flush(4);
    expect(tab.session.ui.previewProps).toBeNull();
  });

  test("no prop fields for a component whose state holds no plain data", async () => {
    resetWorkspaceWithTab(
      { children: [], state: { fn: { $prototype: "Function", body: "" } }, tagName: "x-bare" },
      { documentPath: "components/x-bare.json" },
    );
    await mountBar();
    expect(part("prop")).toBeNull();
  });
});

// ─── ⑩ The floating zoom pod ──────────────────────────────────────────────────

describe("zoom pod", () => {
  /** What the pod's reset button reads. */
  function zoomLabel(host: HTMLElement = root): string {
    return nameOf(part("zoom-label", host)!);
  }

  test("floats outside the bar, and shows the edit-mode content zoom", async () => {
    const tab = openTestTab();
    tab.session.ui.editZoom = 1.5;
    await mountBar();

    const pod = part("pod")!;
    expect(pod).not.toBeNull();
    expect(part("bar")!.contains(pod)).toBe(false);
    expect(pod.dataset.jxRegion).toBe("pane.primary/zoom");
    expect(zoomLabel()).toBe("150%");
    // Edit mode has no artboard, so it has no fit.
    expect(part("fit")).toBeNull();
  });

  test("− / + step the edit zoom and the label tracks reactively", async () => {
    const tab = openTestTab();
    await mountBar();

    pointer(part("zoom-in")!, "click");
    await flush(4);
    expect(tab.session.ui.editZoom).toBeCloseTo(1.2);
    expect(zoomLabel()).toBe("120%");

    pointer(part("zoom-out")!, "click");
    await flush(4);
    expect(tab.session.ui.editZoom).toBeCloseTo(1);

    pointer(part("zoom-label")!, "click");
    await flush(4);
    expect(tab.session.ui.editZoom).toBe(1);
  });

  test("design mode drives ui.zoom and declares each step as the document's fit", async () => {
    const tab = openTestTab();
    tab.session.ui.zoom = 2;
    await mountBar(ctxInMode("design"));
    expect(zoomLabel()).toBe("200%");
    expect(hasDeclaredFit()).toBe(false);

    pointer(part("zoom-in")!, "click");
    await flush(4);
    expect(tab.session.ui.zoom).toBeCloseTo(2.4);
    expect(tab.session.ui.editZoom).toBe(1);
    expect(getFit()).toBeCloseTo(2.4, 5);

    pointer(part("zoom-out")!, "click");
    await flush(4);
    expect(tab.session.ui.zoom).toBeCloseTo(2);
  });

  test("the fit picker writes the declared fit, and 100% declares the number 1", async () => {
    openTestTab();
    await mountBar(ctxInMode("design"));

    const fit = select("fit")!;
    expect([...fit.querySelectorAll("option")].map((o) => o.textContent?.trim())).toEqual([
      "Fit page",
      "Fit width",
      "Actual size",
      "No fit",
    ]);

    choose(fit, "width");
    expect(getFit()).toBe("width");

    choose(fit, "page");
    expect(getFit()).toBe("page");

    choose(fit, "none");
    expect(getFit()).toBe("none");

    choose(fit, "actual");
    expect(getFit()).toBe(1);

    // An unknown value is ignored rather than clearing the declared fit.
    fit.dispatchEvent(new Event("change", { bubbles: true }));
    fit.value = "";
    fit.dispatchEvent(new Event("change", { bubbles: true }));
    expect(getFit()).toBe(1);

    resetFits();
    pointer(part("zoom-label")!, "click");
    expect(getFit()).toBe(1);
  });

  test("the picker shows an author-chosen zoom as no named fit", async () => {
    const tab = openTestTab();
    tab.session.ui.zoom = 2;
    await mountBar(ctxInMode("design"));
    pointer(part("zoom-in")!, "click");
    await flush(4);
    expect(select("fit")!.value).toBe("");
  });

  test("stylebook is on the panzoom surface; preview and source have no pod", async () => {
    openTestTab();
    await mountBar(ctxInMode("stylebook"));
    expect(part("pod")).not.toBeNull();

    paneContext.unmount();
    await mountBar(ctxInMode("preview"));
    expect(part("pod")).toBeNull();

    paneContext.unmount();
    await mountBar(ctxInMode("source"));
    expect(part("pod")).toBeNull();
  });
});

// ─── The mode action ──────────────────────────────────────────────────────────

describe("export", () => {
  test("shows in the Code view only, and invokes ctx.exportFile", async () => {
    openTestTab();
    const ctx = ctxInMode("source");
    await mountBar(ctx);
    pointer(btn("Export"), "click");
    expect(ctx.exportFile).toHaveBeenCalledTimes(1);

    paneContext.unmount();
    await mountBar(ctxInMode("design"));
    expect(hasBtn("Export")).toBe(false);
  });
});

// ─── Two bars, two panes ──────────────────────────────────────────────────────

/**
 * The bar is drawn ONCE PER PANE, and every control in it must write the pane it was drawn for.
 *
 * Every case above mounts one host, and one host is precisely the configuration in which "this
 * pane's tab" and "the focused tab" cannot disagree. Nine controls resolved their target through
 * `updateUi`/`ctx.setCanvasMode`, both of which opened with `activeTab.value`, so the unfocused bar
 * was a fully live remote control for the OTHER pane's document — and nothing in the suite, the
 * type checker or the pane-singleton guard could see it.
 */
describe("two bars, two panes", () => {
  let sideHost: HTMLElement;

  const WITH_MD = {
    baseWidth: 1200,
    featureQueries: [] as { name: string; query: string }[],
    sizeBreakpoints: [{ name: "md", query: "(min-width: 768px)", type: "min", width: 768 }],
  };

  /** One tab per pane, both bars attached. `[primaryTab, sideTab]`; focus lands on the side. */
  async function twoBars(ctx: Ctx): Promise<[Tab, Tab]> {
    const home = openTestTab(SCHEME_MEDIA);
    const away = openTab({
      capabilities: { modes: ["edit", "design", "preview", "source"] },
      // `$media` on BOTH: `canvas.setBreakpoint` reads the document it is addressing, which for the
      // Side bar is the side pane's — and that is exactly the fact this describe block exists for.
      document: {
        $media: SCHEME_MEDIA,
        children: [{ tagName: "p", textContent: "Away" }],
        tagName: "div",
      } as never,
      documentPath: "/project/away.json",
      id: "pane-context-away",
    });
    expect(splitRight()?.id).toBe(SECONDARY_PANE);
    paneContext.mount(root, ctx);
    paneContext.attachPaneChromeHost(SECONDARY_PANE, sideHost);
    await flush(8);
    return [home, away];
  }

  beforeEach(() => {
    sideHost = document.createElement("div");
    document.body.append(sideHost);
  });

  afterEach(() => {
    sideHost.remove();
  });

  test("each bar carries its own region, so a shot of one never crops the other", async () => {
    await twoBars(makeCtx());
    expect(part("bar")!.dataset.jxRegion).toBe("pane.primary/context");
    expect(part("bar", sideHost)!.dataset.jxRegion).toBe(`pane.${SECONDARY_PANE}/context`);
    expect(part("pod", sideHost)!.dataset.jxRegion).toBe(`pane.${SECONDARY_PANE}/zoom`);
  });

  test("each bar's popovers carry their own ids — one pane's trigger cannot open the other's panel", async () => {
    await twoBars(makeCtx());
    const ids = (host: HTMLElement) => partAll("popover", host).map((p) => p.id);
    expect(ids(root)).toEqual(["pane-context-primary-context", "pane-context-primary-resolving"]);
    expect(ids(sideHost)).toEqual([
      `pane-context-${SECONDARY_PANE}-context`,
      `pane-context-${SECONDARY_PANE}-resolving`,
    ]);
  });

  test("the SIDE bar's size control writes the side pane's tab, not the focused one", async () => {
    const [home, away] = await twoBars(makeCtx({ parseMediaEntries: mock(() => WITH_MD) }));
    // Focus is the side pane after the split, so this is the case that used to look right. Move
    // It to the primary: the bar being clicked is then the one the keyboard is NOT in.
    focusPane(PRIMARY_PANE);
    await flush(4);

    pointer(btn("Md", sideHost), "click");
    await flush(4);

    expect(away.session.ui.activeMedia).toBe("md");
    expect(home.session.ui.activeMedia ?? null).toBeNull();
    console.log(
      `[pane-context] clicked "Md" in the SIDE bar: primary.activeMedia=` +
        `${JSON.stringify(home.session.ui.activeMedia ?? null)} ` +
        `side.activeMedia=${JSON.stringify(away.session.ui.activeMedia)} ` +
        `(focus=${workspace.activePaneId})`,
    );
  });

  test("the SIDE bar's Editor picker moves the side pane's tab", async () => {
    const [home, away] = await twoBars(makeCtx());
    focusPane(PRIMARY_PANE);
    await flush(4);

    choose(select("editor-kind", sideHost)!, "code");
    await flush(4);

    expect(away.session.ui.canvasMode).toBe("source");
    expect(home.session.ui.canvasMode).not.toBe("source");
    console.log(
      `[pane-context] chose Code in the SIDE Editor picker: primary.canvasMode=` +
        `${home.session.ui.canvasMode} side.canvasMode=${away.session.ui.canvasMode}`,
    );
  });

  test("Export appears in the bar of the pane that is in Code — and in no other", async () => {
    const [home, away] = await twoBars(makeCtx());
    home.session.ui.canvasMode = "source";
    away.session.ui.canvasMode = "design";
    paneContext.render();
    await flush(4);

    expect(part("export")).not.toBeNull();
    expect(part("export", sideHost)).toBeNull();
    console.log(
      `[pane-context] primary=source side=design → Export in primary bar: ` +
        `${part("export") !== null}, in side bar: ${part("export", sideHost) !== null}`,
    );

    // And the other way round, with focus left where it is: the answer follows the DOCUMENT.
    home.session.ui.canvasMode = "design";
    away.session.ui.canvasMode = "source";
    paneContext.render();
    await flush(4);
    expect(part("export")).toBeNull();
    expect(part("export", sideHost)).not.toBeNull();
  });

  test("the SIDE bar's Design segment leaves the primary's mode alone", async () => {
    const [home, away] = await twoBars(makeCtx());
    home.session.ui.canvasMode = "edit";
    away.session.ui.canvasMode = "edit";
    paneContext.render();
    await flush(4);

    pointer(btn("Design", sideHost), "click");
    await flush(4);

    expect(away.session.ui.canvasMode).toBe("design");
    expect(home.session.ui.canvasMode).toBe("edit");
  });

  test("the SIDE bar's resolving panel is the side pane's, and the primary's stays shut", async () => {
    resetStudioState({ isSiteProject: true });
    await twoBars(makeCtx());
    paneContext.setResolvingOpen(SECONDARY_PANE, true);
    expect(paneContext.isResolvingOpen(SECONDARY_PANE)).toBe(false);
    // Neither document declares route params or props, so neither bar draws a trigger to open —
    // Which is the honest answer, and the one a per-pane handle can give.
    expect(paneContext.isResolvingOpen(PRIMARY_PANE)).toBe(false);
  });
});
