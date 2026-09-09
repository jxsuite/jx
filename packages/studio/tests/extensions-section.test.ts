/**
 * The Extensions section — the surface that turns "install it, then enable it" into one gesture.
 *
 * The assertions that carry the weight are the ones about the ORDER of the two writes and about
 * what happens when one of them fails, because the state this section exists to eliminate is a
 * `project.json` that names a package which is not installed: that fails the next build, and the
 * old free-text field manufactured it routinely.
 *
 * Everything is addressed by `part`, because the section is a document now
 * (`src/surfaces/settings-extensions.json`): there is no `.settings-toggle-row` or
 * `.settings-field-error` to find any more. A reader's flip is performed on the NATIVE `<input>`
 * inside `jx-switch` — writing the host's `checked` property instead would move a control no reader
 * can move, and would skip the element's own mirror of the flip, which is half of what the echo
 * below is asserted against.
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { refreshFormats, setExtensionCatalog, setExtensions } from "../src/format/format-host";
import { renderExtensionsSection } from "../src/settings/extensions-section";
import type { MockPlatformState } from "./harness";
import type { ExtensionCatalogEntry, PackageInfo, StudioPlatform } from "../src/types";

type AnyConfig = Record<string, any>;

const PARSER: ExtensionCatalogEntry = {
  description: "File-based content collections with Markdown and CSV formats",
  installed: false,
  name: "@jxsuite/parser",
  sections: [{ key: "content", title: "Content Types" }],
  source: "first-party",
  title: "Content & Markdown",
};

let container: HTMLElement;

/**
 * Draw the section into a fresh container and let the surface mount.
 *
 * Four turns rather than one: `mountSurface` settles when the DOCUMENT has rendered, each kit
 * element's own template is one `connectedCallback` later, and `renderExtensionsSection` also
 * re-reads the package list before it repaints.
 */
async function mount(
  cfg: AnyConfig,
  catalog: ExtensionCatalogEntry[] = [PARSER],
  overrides: Partial<StudioPlatform> = {},
  packages: PackageInfo[] = [],
): Promise<MockPlatformState> {
  const { state } = installMockPlatform({
    listPackages: async () => packages,
    ...overrides,
  });
  resetStudioState({ projectConfig: cfg as unknown });
  setExtensionCatalog(catalog);
  setExtensions([]);
  container = document.createElement("div");
  document.body.append(container);
  renderExtensionsSection(container);
  await flush(4);
  return state;
}

/** Redraw the section the way the settings pane does, into the same host. */
async function redraw(): Promise<void> {
  renderExtensionsSection(container);
  await flush(4);
}

function rows(): HTMLElement[] {
  return [...container.querySelectorAll('[part="row"]')] as HTMLElement[];
}

function rowFor(name: string): HTMLElement | undefined {
  return rows().find((row) => row.dataset.package === name);
}

function part(row: HTMLElement | undefined, name: string): HTMLElement | null {
  return (row?.querySelector(`[part="${name}"]`) ?? null) as HTMLElement | null;
}

/** The native checkbox inside a row's `jx-switch` — where a reader actually clicks. */
function switchIn(row: HTMLElement | undefined): HTMLInputElement {
  return row?.querySelector('[part="toggle"] [part="input"]') as HTMLInputElement;
}

/** Every row's switch, for the "one operation at a time" assertions. */
function toggles(): HTMLInputElement[] {
  return [...container.querySelectorAll('[part="toggle"] [part="input"]')] as HTMLInputElement[];
}

/** A switch's tooltip, which `jx-switch` draws on the label it wraps the control in. */
function switchHint(row: HTMLElement | undefined): string | null {
  return part(row, "toggle")?.querySelector('[part="control"]')?.getAttribute("title") ?? null;
}

/** Flip a switch the way a reader does: move the control, then let it announce the move. */
async function flip(row: HTMLElement | undefined): Promise<void> {
  const input = switchIn(row);
  input.checked = !input.checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await flush(6);
}

/** The row's Remove button, or null when none is offered. */
function removeButton(row: HTMLElement | undefined): HTMLElement | null {
  return part(row, "remove");
}

/** Its inner control, which is what carries `disabled` and the refusal. */
function removeControl(row: HTMLElement | undefined): HTMLButtonElement | null {
  return (removeButton(row)?.querySelector('[part="control"]') ?? null) as HTMLButtonElement | null;
}

/** The order of platform writes, which is what the enable path is really about. */
function writeOrder(state: MockPlatformState): string[] {
  return state.calls
    .filter(
      ([name, path]) =>
        name === "addPackage" ||
        name === "removePackage" ||
        (name === "writeFile" && String(path).includes("project.json")),
    )
    .map(([name]) => String(name));
}

function written(state: MockPlatformState): AnyConfig | null {
  const raw = state.files.get("project.json");
  return raw === undefined ? null : (JSON.parse(raw) as AnyConfig);
}

/** The failed operation, said under the section title rather than beside a control. */
function alertText(): string | undefined {
  return container.querySelector('[part="error"][role="alert"]')?.textContent ?? undefined;
}

beforeEach(() => {
  resetWorkspaceWithTab();
  refreshFormats();
});

afterEach(() => {
  container?.remove();
  refreshFormats();
});

describe("what the section shows", () => {
  test("renders a row per catalogue entry with its identity and sections", async () => {
    await mount({ extensions: [] });
    const row = rowFor("@jxsuite/parser");
    expect(row).toBeDefined();
    // Under the heading that says which of the three kinds of row it is, and the sentence that
    // Says what the kind means — a catalogue offer, not something the project already has.
    const group = container.querySelector('[part="group"][data-origin="catalog"]');
    expect(group?.querySelector('[part="group-title"]')?.textContent).toBe("Available");
    expect(group?.querySelector('[part="group-desc"]')?.textContent).toContain(
      "installs its package first",
    );
    expect(group?.contains(row!)).toBe(true);
    expect(part(row, "row-title")?.textContent).toContain("Content & Markdown");
    expect(part(row, "desc")?.textContent).toContain("content collections");
    expect(part(row, "section")?.textContent).toBe("content");
  });

  test("the switch reflects project.json, not the catalogue", async () => {
    await mount({ extensions: ["@jxsuite/parser"] });
    expect(switchIn(rowFor("@jxsuite/parser")).checked).toBe(true);
  });

  test("a flip the file has not accepted yet is put straight back", async () => {
    /*
     * The `live()` proof, restated for a document, and the reason the section echoes. The row is
     * painted from `project.json` the moment the operation starts, so a switch the file has not
     * agreed to is put back where the document says it belongs — and that correction only lands
     * because the scope was first moved to where the switch is. A projection that merely re-stated
     * the value on disk would write nothing, and the switch would sit on a state no project ever
     * took.
     */
    let release: (() => void) | undefined;
    await mount({ extensions: [] }, [PARSER], {
      addPackage: () =>
        new Promise<void>((r) => {
          release = r;
        }) as Promise<unknown>,
    });
    const sw = switchIn(rowFor("@jxsuite/parser"));
    sw.checked = true;
    sw.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(2);
    expect(switchIn(rowFor("@jxsuite/parser")).checked).toBe(false);
    release?.();
    await flush(6);
  });

  test("an extension project.json names but nothing describes still gets a row", async () => {
    await mount({ extensions: ["@acme/mystery"] }, []);
    // It can still be turned OFF, which matters most for the rows nothing can explain.
    const row = rowFor("@acme/mystery");
    expect(row).toBeDefined();
    expect(switchIn(row).checked).toBe(true);
    expect(switchIn(row).disabled).toBe(false);
  });

  test("enabled but not installed renders as broken and says why", async () => {
    await mount({ extensions: ["@jxsuite/parser"] });
    const row = rowFor("@jxsuite/parser");
    expect(row?.dataset.broken).toBe("");
    expect(part(row, "note-warn")?.textContent).toContain("the next build will fail");
  });

  test("an unavailable entry is disabled WITH its reason, not hidden", async () => {
    await mount({ extensions: [] }, [
      { ...PARSER, installed: true, problem: "this backend bundles no parser" },
    ]);
    const row = rowFor("@jxsuite/parser");
    expect(row).toBeDefined();
    expect(switchIn(row).disabled).toBe(true);
    expect(switchHint(row)).toContain("bundles no parser");
    // And the same sentence is visible, because a title on a control that already has an
    // Aria-label is announced by almost nothing.
    expect(part(row, "note-warn")?.textContent).toContain("bundles no parser");
  });

  test("a bundled entry says it needs no install", async () => {
    await mount({ extensions: [] }, [{ ...PARSER, bundled: true }]);
    expect(part(rowFor("@jxsuite/parser"), "note")?.textContent).toContain("needs no install");
  });

  test("an empty catalogue teaches rather than reporting absence", async () => {
    await mount({}, []);
    const empty = container.querySelector('[part="empty"]');
    expect(empty).not.toBeNull();
    expect(rows()).toHaveLength(0);
    // Says what the region is FOR, never "no extensions".
    expect(empty?.textContent).toContain("Extensions add what the core does not do");
    // Nothing to act on: a backend with no catalogue is not a project waiting to be filled in.
    expect(container.querySelector("jx-button")).toBeNull();
  });
});

describe("turning one on", () => {
  test("installs first, then writes project.json", async () => {
    const state = await mount({ extensions: [] });
    await flip(rowFor("@jxsuite/parser"));

    // The order is the whole point: a project.json naming an uninstalled package fails the next
    // Build, so config-first would open a window in which the project is broken.
    expect(writeOrder(state)).toEqual(["addPackage", "writeFile"]);
    expect(written(state)?.extensions).toEqual(["@jxsuite/parser"]);
  });

  test("an already-installed extension is enabled without installing", async () => {
    const state = await mount({ extensions: [] }, [{ ...PARSER, installed: true }]);
    await flip(rowFor("@jxsuite/parser"));
    expect(writeOrder(state)).toEqual(["writeFile"]);
    expect(written(state)?.extensions).toEqual(["@jxsuite/parser"]);
  });

  test("a bundled extension is enabled without installing", async () => {
    const state = await mount({ extensions: [] }, [{ ...PARSER, bundled: true }]);
    await flip(rowFor("@jxsuite/parser"));
    expect(writeOrder(state)).toEqual(["writeFile"]);
  });

  test("a failed install does NOT write project.json", async () => {
    /*
     * The defect the section exists to remove. Writing the entry anyway would manufacture exactly
     * the enabled-but-missing row asserted above.
     */
    const state: MockPlatformState = await mount({ extensions: [] }, [PARSER], {
      addPackage: () => {
        state.calls.push(["addPackage"]);
        return Promise.reject(new Error("registry unreachable"));
      },
    });
    await flip(rowFor("@jxsuite/parser"));

    expect(writeOrder(state)).toEqual(["addPackage"]);
    expect(written(state)).toBeNull();
    // The snap-back, which is what the echo buys: the scope was moved to where the switch is
    // Before the operation started, so the file's answer is a move away from it rather than a
    // Restatement of a value that never changed.
    expect(switchIn(rowFor("@jxsuite/parser")).checked).toBe(false);
    expect(alertText()).toContain("registry unreachable");
  });

  test("a failed config write leaves the package installed rather than rolling it back", async () => {
    const state: MockPlatformState = await mount({ extensions: [] }, [PARSER], {
      writeFile: () => {
        state.calls.push(["writeFile", "project.json"]);
        return Promise.reject(new Error("EROFS: read-only file system"));
      },
    });
    await flip(rowFor("@jxsuite/parser"));

    // An automatic uninstall triggered by an unrelated failure is a destructive act nobody asked
    // For; an unused dependency is inert.
    expect(state.calls.some(([name]) => name === "removePackage")).toBe(false);
    // The rejection is shown at the control rather than dropped. The switch stays ON because
    // `commitProjectConfig` mutates the document before it writes and leaves the change in place
    // When the write fails: the document really does say "enabled", it is just unsaved, and ⌘S
    // Retries it. That is the same contract every settings section keeps.
    expect(alertText()).toContain("read-only file system");
    expect(switchIn(rowFor("@jxsuite/parser")).checked).toBe(true);
  });
});

describe("turning one off", () => {
  test("removes the project.json entry and leaves the package installed", async () => {
    const state = await mount({ extensions: ["@jxsuite/parser"] }, [
      { ...PARSER, installed: true },
    ]);
    await flip(rowFor("@jxsuite/parser"));

    expect(written(state)?.extensions).toEqual([]);
    expect(state.calls.some(([name]) => name === "removePackage")).toBe(false);
  });
});

describe("removing the package", () => {
  test("is refused while the extension is still enabled, with the reason on the control", async () => {
    await mount({ extensions: ["@jxsuite/parser"] }, [{ ...PARSER, installed: true }]);
    const control = removeControl(rowFor("@jxsuite/parser"));
    expect(control?.disabled).toBe(true);
    expect(control?.getAttribute("title")).toContain("Turn Content & Markdown off first");
  });

  test("is offered once the extension is disabled", async () => {
    await mount({ extensions: [] }, [{ ...PARSER, installed: true }]);
    expect(removeControl(rowFor("@jxsuite/parser"))?.disabled).toBe(false);
  });

  test("is not offered for a package the project never installed", async () => {
    await mount({ extensions: [] });
    expect(removeButton(rowFor("@jxsuite/parser"))).toBeNull();
  });
});

describe("installed-ness can come from the package list", () => {
  test("a catalogue entry with no `installed` flag falls back to the dependencies", async () => {
    /*
     * A backend may answer the catalogue without answering installed-ness (the field is optional).
     * The package list is then the fallback, which is why the row model takes it: without it a row
     * would offer to install something the project already has.
     */
    const bare = { ...PARSER };
    delete (bare as { installed?: boolean }).installed;
    await mount({ extensions: [] }, [bare], {}, [{ name: "@jxsuite/parser", version: "1.7.0" }]);
    const row = rowFor("@jxsuite/parser");
    // No "Not installed" note, and Remove is offered — both derived from the package list.
    expect(part(row, "note")).toBeNull();
    expect(removeButton(row)).not.toBeNull();
  });
});

describe("an enabled extension is described by what the backend resolved", () => {
  test("its sections come from the extensions payload, not the catalogue", async () => {
    /*
     * The split the row model exists for: for an OFFER the catalogue is the only source that can
     * describe a package the project has not installed, but once an extension is enabled the
     * backend has resolved it for real and that answer wins.
     */
    await mount({ extensions: ["@jxsuite/parser"] }, [{ ...PARSER, installed: true }]);
    setExtensions([
      {
        contributions: [
          {
            className: "Content",
            project: { key: "resolved-content", title: "Content Types" },
          },
        ],
        description: "Resolved by the backend",
        name: "@jxsuite/parser",
        specifier: "@jxsuite/parser",
        title: "Resolved Parser",
      },
    ]);
    await redraw();
    const row = rowFor("@jxsuite/parser");
    expect(part(row, "section")?.textContent).toBe("resolved-content");
    // Identity still comes from the catalogue — only the SECTIONS are the resolved answer, because
    // Only they change with what the backend could actually load.
    expect(part(row, "row-title")?.textContent).toContain("Content & Markdown");
  });

  test("a configured-only extension the backend resolved is described too", async () => {
    await mount({ extensions: ["@acme/mystery"] }, []);
    setExtensions([
      {
        contributions: [{ className: "Guest", project: { key: "guestbook" } }],
        description: "A third-party guestbook",
        name: "@acme/mystery",
        specifier: "@acme/mystery",
        title: "Guestbook",
      },
    ]);
    await redraw();
    const row = rowFor("@acme/mystery");
    expect(part(row, "row-title")?.textContent).toContain("Guestbook");
    expect(part(row, "section")?.textContent).toBe("guestbook");
    expect(part(row, "desc")?.textContent).toContain("guestbook");
  });
});

describe("removing actually removes", () => {
  test("the Remove button uninstalls the package once the extension is off", async () => {
    const state = await mount({ extensions: [] }, [{ ...PARSER, installed: true }]);
    pointer(removeButton(rowFor("@jxsuite/parser"))!, "click");
    await flush(6);
    expect(
      state.calls.some(([name, arg]) => name === "removePackage" && arg === "@jxsuite/parser"),
    ).toBe(true);
  });

  test("a failed removal is shown inline rather than dropped", async () => {
    await mount({ extensions: [] }, [{ ...PARSER, installed: true }], {
      removePackage: () => Promise.reject(new Error("EPERM: operation not permitted")),
    });
    pointer(removeButton(rowFor("@jxsuite/parser"))!, "click");
    await flush(6);
    expect(alertText()).toContain("operation not permitted");
  });
});

describe("a backend that cannot list packages", () => {
  test("still renders the catalogue rather than failing the section", async () => {
    // Installed-ness degrades to "what the catalogue said", which is the honest fallback.
    await mount({ extensions: [] }, [PARSER], {
      listPackages: () => Promise.reject(new Error("no package backend")),
    });
    expect(rowFor("@jxsuite/parser")).toBeDefined();
  });
});

describe("one operation at a time", () => {
  test("every switch is disabled while an install runs, naming the package", async () => {
    let release: (() => void) | undefined;
    await mount(
      { extensions: [] },
      [PARSER, { ...PARSER, name: "@jxsuite/feed", title: "Feeds" }],
      {
        addPackage: () =>
          new Promise<void>((r) => {
            release = r;
          }) as Promise<unknown>,
      },
    );
    const input = switchIn(rowFor("@jxsuite/parser"));
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(2);

    for (const sw of toggles()) {
      expect(sw.disabled).toBe(true);
    }
    expect(switchHint(rowFor("@jxsuite/feed"))).toContain("@jxsuite/parser");
    release?.();
    await flush(6);
  });
});

describe("the mount survives the pane reusing its host", () => {
  test("a redraw updates the standing document rather than making a second one", async () => {
    await mount({ extensions: [] });
    const row = rowFor("@jxsuite/parser");
    await redraw();
    // The same node, not a rebuilt one: a remount would take the caret out of whatever the reader
    // Was in, and would cost the row its identity for no reason.
    expect(rowFor("@jxsuite/parser")).toBe(row!);
  });

  test("a host something else has claimed is mounted into again", async () => {
    /*
     * A settings section is handed the pane's content area, and a lit section drawing into the
     * same element replaces everything in it. The surface has to notice that its root is gone and
     * take the old mount down rather than update a document nobody can see.
     */
    await mount({ extensions: [] });
    const claim = document.createElement("div");
    claim.dataset.claim = "";
    container.replaceChildren(claim);
    await redraw();
    expect(rowFor("@jxsuite/parser")).toBeDefined();
    expect(container.querySelector("[data-claim]")).toBeNull();
  });

  test("a mount still in flight when its host is taken is disposed on arrival", async () => {
    /*
     * Claimed before the first mount settles. A document renders one microtask after it is asked
     * for, so the surface can be evicted while it has nothing in the container yet — and the copy
     * that arrives afterwards has to take itself down rather than land on top of the one that
     * replaced it.
     */
    await mount({ extensions: [] });
    container.remove();
    container = document.createElement("div");
    document.body.append(container);
    renderExtensionsSection(container);
    const claim = document.createElement("div");
    claim.dataset.claim = "";
    container.append(claim);
    renderExtensionsSection(container);
    await flush(4);
    expect(rows()).toHaveLength(1);
    expect(container.querySelector("[data-claim]")).toBeNull();
  });
});

describe("a row the catalogue has stopped describing", () => {
  test("a flip on it writes nothing and the row goes", async () => {
    /*
     * The extension set can change under a painted row — a backend re-answering, an extension
     * unregistering — and the switch is still on screen until the next repaint. Intent is read
     * from the row model rather than from the control, so there is nothing to enable and the
     * repaint is the whole response.
     */
    const state = await mount({ extensions: [] });
    setExtensionCatalog([]);
    await flip(rowFor("@jxsuite/parser"));
    expect(writeOrder(state)).toEqual([]);
    expect(rowFor("@jxsuite/parser")).toBeUndefined();
  });
});
