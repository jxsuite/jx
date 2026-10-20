/**
 * Tests for the Overview section — `src/settings/general-settings.ts` and the surface it mounts,
 * `src/surfaces/settings-overview.{json,ts}`: site identity (name, description, production URL),
 * favicon, and the Project Styles shortcut.
 *
 * Persistence flows through updateSiteConfig → platform.writeFile("project.json"), and every write
 * in this section surfaces its rejection instead of dropping it — that is what the "save failures"
 * block pins.
 *
 * Everything is addressed by `part` and by the row's `data-field`, because the section is a
 * document: there is no `.settings-site-name` to find any more, and the label, its sentence and the
 * announced refusal under each control belong to `jx-field` and `jx-textfield` now. The mount is
 * asynchronous — the kit has to be defined before a document can render — so every setup awaits
 * it.
 *
 * Two things are NOT tested here any more, both because they left. Breakpoints were one of four
 * `$media` definition sites and live in Contexts (tests/contexts-section.test.ts). The platform
 * adapter moved to Deploy (tests/project-sections.test.ts) — Overview says what the site IS, Deploy
 * says where it ships.
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { requireProjectState } from "../src/store";

import type { CommandContext } from "../src/commands/context";
import type { MockPlatformState } from "./harness";
import type { ProjectConfig } from "@jxsuite/schema/types";
import type { StudioPlatform } from "../src/types";

const { renderGeneralSettings } = await import("../src/settings/general-settings");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext } = await import("../src/commands/context");

/**
 * Mount the section into a fresh container and let the document render.
 *
 * The container is in the document because the surface is made of custom elements: a kit element in
 * a detached node is never connected, so its own template never runs.
 */
async function setup(
  cfg: ProjectConfig | null,
  overrides: Partial<StudioPlatform> = {},
): Promise<{ container: HTMLElement; state: MockPlatformState }> {
  const { state } = installMockPlatform(overrides);
  resetStudioState({ projectConfig: cfg });
  const container = document.createElement("div");
  document.body.append(container);
  renderGeneralSettings(container);
  await flush();
  await flush();
  return { container, state };
}

/** The native control inside one row's field. */
function control(container: HTMLElement, field: string): HTMLInputElement | HTMLTextAreaElement {
  const el = container.querySelector(`[data-field="${field}"] [part="input"]`);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    throw new Error(`no control in the "${field}" row of the Overview section`);
  }
  return el;
}

/** Whatever refusal the section is currently showing — the section's own, a row's, or the upload's. */
function errorText(container: HTMLElement): string | undefined {
  for (const node of container.querySelectorAll(
    '[part="section-error"], [part="favicon-error"], [part="error"]',
  )) {
    const text = node.textContent.trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

function part(container: HTMLElement, name: string): HTMLElement {
  const el = container.querySelector(`[part="${name}"]`);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`no [part="${name}"] in the Overview section`);
  }
  return el;
}

function config(): ProjectConfig {
  const cfg = requireProjectState().projectConfig;
  if (!cfg) {
    throw new Error("no project config is loaded");
  }
  return cfg;
}

function setAndFire(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  type = "change",
): void {
  el.value = value;
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

/** Click Upload Favicon with `document.createElement` watched, and hand back the file input. */
function pickFavicon(container: HTMLElement): HTMLInputElement {
  const createElement = spyOn(document, "createElement");
  let created: HTMLElement[] = [];
  try {
    pointer(part(container, "favicon-upload"), "click");
  } finally {
    created = createElement.mock.results.flatMap((result) =>
      result.type === "return" ? [result.value] : [],
    );
    createElement.mockRestore();
  }
  // The last input created during the click is the one the upload listens on.
  const fileInput = created.findLast((el) => el instanceof HTMLInputElement);
  if (!(fileInput instanceof HTMLInputElement)) {
    throw new Error("Upload Favicon opened no file input");
  }
  return fileInput;
}

afterEach(() => {
  setActiveRegistry(null);
  document.body.replaceChildren();
});

// ─── Site identity ───────────────────────────────────────────────────────────
//
// The New Project wizard collects name + location only and tells the user to set the rest "from
// Settings". These three fields are what makes that sentence true: before them, description and
// Production URL had no editing surface anywhere in Studio, and the name was editable only at
// Creation time.

describe("site name", () => {
  test("shows the configured name and persists a trimmed edit", async () => {
    const { container, state } = await setup({ name: "Old Name" });
    const input = control(container, "name");
    expect(input.value).toBe("Old Name");

    setAndFire(input, "  Bistro  ");
    await flush();
    expect(config().name).toBe("Bistro");
    expect(JSON.parse(state.files.get("project.json")!).name).toBe("Bistro");
    expect(errorText(container)).toBeUndefined();
    // The control is told what was actually written, so it holds the trimmed name.
    expect(control(container, "name").value).toBe("Bistro");
  });

  test("a blank name is refused, not written — a nameless project is not a state to reach", async () => {
    const { container, state } = await setup({ name: "Bistro" });
    setAndFire(control(container, "name"), "   ");
    await flush();
    expect(config().name).toBe("Bistro");
    expect(state.calls.filter(([name]) => name === "writeFile")).toHaveLength(0);
    expect(errorText(container)).toBe("A project name is required.");
    // The control snaps back to the value that is actually on disk.
    expect(control(container, "name").value).toBe("Bistro");
  });

  test("the row's label names the control, which the bare <label> it replaced never did", async () => {
    const { container } = await setup({ name: "Bistro" });
    const label = container.querySelector('[data-field="name"] [part="label"]')!;
    expect(label.textContent).toBe("Site Name");
    expect(control(container, "name").getAttribute("aria-labelledby")).toBe(label.id);
    expect(label.id).not.toBe("");
  });
});

describe("description", () => {
  const withMeta = (content: string) => ({
    $head: [
      { attributes: { content: "width=device-width", name: "viewport" }, tagName: "meta" },
      { attributes: { content, name: "description" }, tagName: "meta" },
    ],
  });

  test("reads the $head description meta, not a top-level key", async () => {
    // `description` is not a top-level project.json key — the composed project schema is closed
    // (unevaluatedProperties: false) — so it lives exactly where @jxsuite/create writes it.
    const { container } = await setup(withMeta("A neighbourhood bistro."));
    expect(control(container, "description").value).toBe("A neighbourhood bistro.");
  });

  test("editing rewrites the existing meta in place, leaving other head entries alone", async () => {
    const { container, state } = await setup(withMeta("Old copy."));
    setAndFire(control(container, "description"), "  New copy.  ");
    await flush();
    const head = JSON.parse(state.files.get("project.json")!).$head;
    expect(head).toEqual([
      { attributes: { content: "width=device-width", name: "viewport" }, tagName: "meta" },
      { attributes: { content: "New copy.", name: "description" }, tagName: "meta" },
    ]);
  });

  test("a project with no description meta gets one appended", async () => {
    const { container, state } = await setup({ $head: [] });
    setAndFire(control(container, "description"), "First words.");
    await flush();
    expect(JSON.parse(state.files.get("project.json")!).$head).toEqual([
      { attributes: { content: "First words.", name: "description" }, tagName: "meta" },
    ]);
  });

  test("a project with no $head at all gets the array created", async () => {
    const { container } = await setup({});
    setAndFire(control(container, "description"), "Hello.");
    await flush();
    expect(config().$head).toEqual([
      { attributes: { content: "Hello.", name: "description" }, tagName: "meta" },
    ]);
  });

  test("clearing it removes the meta rather than leaving an empty one", async () => {
    const { container } = await setup(withMeta("Old copy."));
    setAndFire(control(container, "description"), "   ");
    await flush();
    expect(config().$head).toEqual([
      { attributes: { content: "width=device-width", name: "viewport" }, tagName: "meta" },
    ]);
  });

  test("clearing when there was never a description writes no meta", async () => {
    const { container } = await setup({ $head: [] });
    setAndFire(control(container, "description"), "");
    await flush();
    expect(config().$head).toEqual([]);
  });
});

describe("production URL", () => {
  test("persists an absolute address", async () => {
    const { container, state } = await setup({});
    setAndFire(control(container, "url"), " https://example.com ");
    await flush();
    expect(config().url).toBe("https://example.com");
    expect(JSON.parse(state.files.get("project.json")!).url).toBe("https://example.com");
  });

  test("a bare hostname is refused — the sitemap needs a full address", async () => {
    const { container, state } = await setup({ url: "https://example.com" });
    setAndFire(control(container, "url"), "example.com");
    await flush();
    expect(config().url).toBe("https://example.com");
    expect(state.calls.filter(([name]) => name === "writeFile")).toHaveLength(0);
    expect(errorText(container)).toBe("Enter a full address starting with http:// or https://");
  });

  test("clearing it drops the key instead of writing an empty string", async () => {
    const { container, state } = await setup({ url: "https://example.com" });
    setAndFire(control(container, "url"), "");
    await flush();
    expect("url" in JSON.parse(state.files.get("project.json")!)).toBe(false);
    expect(config().url).toBeUndefined();
  });
});

// ─── Save failures ───────────────────────────────────────────────────────────

describe("save failures", () => {
  const failing: Partial<StudioPlatform> = {
    writeFile: async () => {
      throw new Error("EROFS: read-only file system");
    },
  };

  test("a rejected project.json write is shown under the field, not swallowed", async () => {
    const { container } = await setup({ name: "Bistro" }, failing);
    setAndFire(control(container, "name"), "Trattoria");
    await flush(4);
    expect(errorText(container)).toBe("Could not save project.json — EROFS: read-only file system");
    // The kit draws it into the field's own live region, so the first refusal is announced.
    expect(container.querySelector('[data-field="name"] [part="error"]')?.textContent).toContain(
      "Could not save project.json",
    );
  });

  test("a failure on a field with no control of its own lands at the top of the section", async () => {
    const { container } = await setup({ $head: [] }, failing);
    setAndFire(control(container, "description"), "A bistro");
    await flush(4);
    expect(errorText(container)).toContain("Could not save project.json");
  });

  test("a later success clears the error", async () => {
    const { container } = await setup({ name: "Bistro" }, failing);
    setAndFire(control(container, "name"), "Trattoria");
    await flush(4);
    expect(errorText(container)).toBeDefined();

    // Re-register a working platform and retry through the same container.
    installMockPlatform();
    setAndFire(control(container, "name"), "Trattoria");
    await flush(4);
    expect(errorText(container)).toBeUndefined();
    expect(config().name).toBe("Trattoria");
  });

  test("a failed favicon upload reports the upload, not a phantom save", async () => {
    const { container } = await setup(
      {},
      {
        uploadFile: async () => {
          throw new Error("disk full");
        },
      },
    );

    const fileInput = pickFavicon(container);
    const file = new File(["x"], "favicon.ico", { type: "image/x-icon" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event("change"));
    await flush(4);

    expect(errorText(container)).toBe("Could not upload the favicon — disk full");
    expect(config().$head ?? []).toEqual([]);
  });
});

// ─── Favicon ─────────────────────────────────────────────────────────────────

describe("favicon", () => {
  /** The `$head` entries that are an icon link. */
  const iconLinks = () =>
    (config().$head ?? []).filter(
      (entry) => entry.tagName === "link" && String(entry.attributes?.rel).includes("icon"),
    );

  test("no icon link shows the dashed placeholder; the $head icon link shows preview + path", async () => {
    const { container } = await setup({});
    expect(container.querySelector("img")).toBeNull();
    expect(part(container, "favicon-empty").textContent).toBe("—");

    // Where every starter puts it: `project.json` has no top-level favicon key.
    const { container: withFavicon } = await setup({
      $head: [
        { attributes: { content: "Jx", name: "generator" }, tagName: "meta" },
        { attributes: { href: "/favicon.svg", rel: "icon" }, tagName: "link" },
      ],
    });
    expect(part(withFavicon, "favicon").getAttribute("src")).toBe("/favicon.svg");
    expect(part(withFavicon, "favicon-path").textContent).toBe("/favicon.svg");
    expect(withFavicon.querySelector('[part="favicon-empty"]')).toBeNull();
  });

  test("rel is a token list: `shortcut icon` is the favicon, `apple-touch-icon` is not", async () => {
    const { container } = await setup({
      $head: [{ attributes: { href: "/touch.png", rel: "apple-touch-icon" }, tagName: "link" }],
    });
    expect(container.querySelector('[part="favicon-empty"]')).not.toBeNull();

    const { container: legacy } = await setup({
      $head: [{ attributes: { href: "/images/logo.png", rel: "Shortcut Icon" }, tagName: "link" }],
    });
    expect(part(legacy, "favicon-path").textContent).toBe("/images/logo.png");
  });

  test("upload stores the file under its own type and adds the $head icon link", async () => {
    const { container, state } = await setup({});
    const fileInput = pickFavicon(container);
    expect(fileInput.type).toBe("file");
    expect(fileInput.accept).toBe("image/*,.ico,.svg");

    const file = new File(["<svg/>"], "Logo.SVG", { type: "image/svg+xml" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event("change"));
    await flush(4);

    const upload = state.calls.find(([name]) => name === "uploadFile");
    expect(upload).toEqual(["uploadFile", "public/favicon.svg", file]);
    expect(iconLinks()).toEqual([
      { attributes: { href: "/favicon.svg", rel: "icon" }, tagName: "link" },
    ]);
    // Never the top-level key the closed project schema refuses.
    expect(Object.hasOwn(config(), "favicon")).toBe(false);
    // The preview swaps in without the section being rebuilt: one binding, one `$switch`.
    expect(part(container, "favicon").getAttribute("src")).toBe("/favicon.svg");
  });

  test("upload rewrites the existing icon link in place, keeping its other attributes", async () => {
    const { container } = await setup({
      $head: [
        {
          attributes: { href: "/favicon.svg", rel: "icon", sizes: "any", type: "image/svg+xml" },
          tagName: "link",
        },
        { attributes: { content: "Jx", name: "generator" }, tagName: "meta" },
      ],
    });
    const fileInput = pickFavicon(container);
    const file = new File(["png"], "mark", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event("change"));
    await flush(4);

    expect(config().$head).toEqual([
      // `type` described the old file; a name with no extension is stored as favicon.ico.
      { attributes: { href: "/favicon.ico", rel: "icon", sizes: "any" }, tagName: "link" },
      { attributes: { content: "Jx", name: "generator" }, tagName: "meta" },
    ]);
    expect(part(container, "favicon-path").textContent).toBe("/favicon.ico");
  });

  test("change event without a selected file is a no-op", async () => {
    const { container, state } = await setup({});
    const fileInput = pickFavicon(container);
    Object.defineProperty(fileInput, "files", { configurable: true, value: [] });
    fileInput.dispatchEvent(new Event("change"));
    await flush(4);
    expect(state.calls.filter(([name]) => name === "uploadFile")).toHaveLength(0);
    expect(iconLinks()).toEqual([]);
  });
});

// ─── Platform adapter ────────────────────────────────────────────────────────

describe("platform adapter", () => {
  test("is no longer on Overview — it is a Deploy fact, not an identity one", async () => {
    const { container } = await setup({ build: { adapter: "static" } });
    expect(container.querySelector("jx-select")).toBeNull();
  });
});

// ─── Global styles shortcut ──────────────────────────────────────────────────

describe("global styles shortcut", () => {
  /*
   * The button RENDERS FROM `workspace.focus.styles` and runs the workspace switch. It used to
   * write `session.ui.canvasMode` itself — a second implementation of a capability that also
   * existed as no command at all (studio-ui-guidelines.md §12.5). Global styles are the Styles
   * workspace's now, and the switch is the one door to it.
   */
  function installStylesRegistry() {
    const registry = createCommandRegistry({ getContext: () => emptyContext(), mac: true });
    registry.register({
      id: "workspace.focus.styles",
      title: "Go to Styles",
      category: "View",
      level: "application",
      menus: ["palette"],
      requires: "an open project",
      when: (ctx: CommandContext) => ctx.project.open,
      run: () => {},
    });
    setActiveRegistry(registry);
    return registry;
  }

  test("Go to Styles switches to the Styles workspace, rather than writing the mode itself", async () => {
    const registry = installStylesRegistry();
    const ran: { id: string; args: unknown }[] = [];
    registry.run = (id, args) => {
      ran.push({ args, id });
      return Promise.resolve();
    };
    resetWorkspaceWithTab();
    const { container } = await setup({});
    pointer(part(container, "styles-open"), "click");
    expect(ran).toEqual([{ args: { workspace: "styles" }, id: "view.setWorkspace" }]);
  });

  test("its tooltip is the record's own title, so the two cannot drift", async () => {
    // The button's LABEL is in-context copy, but what it invokes is named by the record, the half
    // Studio-ui-guidelines.md §12.3 governs.
    installStylesRegistry();
    const { container } = await setup({});
    expect(part(container, "styles-open").getAttribute("title")).toBe("Go to Styles");
    expect(part(container, "styles-open").textContent.trim()).toBe("Go to Styles");
  });

  /*
   * It does NOT render its enablement, and that is deliberate rather than an omission.
   * `styles.open` is gated on an open project, and Overview is a section of that project's own
   * configuration document — so the question cannot be false where this button lives. Asking anyway
   * would be a focus read inside a pane-scoped render, which `check-pane-singletons.ts` rule 4
   * forbids. What CAN be missing is the registry, and that is an existence check.
   */
  test("with no registry at all it renders disabled rather than throwing", async () => {
    setActiveRegistry(null);
    const { container } = await setup({});
    const button = part(container, "styles-open");
    expect(button.querySelector('[part="control"]')?.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toBe("");
  });
});

// ─── Living in the pane's content area ───────────────────────────────────────
/*
 * The section does not own its container: the settings document hands the same content area to
 * whichever section is showing, and calls this renderer again whenever something it cannot see may
 * have changed. A redraw must therefore keep the surface it has, and a container the document has
 * been taken out of must be mounted into again.
 */

describe("redraws", () => {
  test("a redraw updates the standing surface instead of rebuilding it", async () => {
    const { container } = await setup({ name: "Bistro" });
    const first = control(container, "name");
    requireProjectState().projectConfig = { name: "Trattoria" };

    renderGeneralSettings(container);
    await flush();
    // The same control, holding the new value: nothing was torn down and the caret would have kept
    // Its place.
    expect(control(container, "name")).toBe(first);
    expect(first.value).toBe("Trattoria");
  });

  test("a container the document has left is mounted into again", async () => {
    const { container } = await setup({ name: "Bistro" });
    // What another section drawing over this content area looks like from here.
    container.replaceChildren();

    renderGeneralSettings(container);
    await flush();
    await flush();
    expect(control(container, "name").value).toBe("Bistro");
  });

  test("a mount still in flight gives the container up rather than landing on top of it", async () => {
    installMockPlatform();
    resetStudioState({ projectConfig: { name: "Bistro" } });
    const container = document.createElement("div");
    document.body.append(container);
    renderGeneralSettings(container);

    // Another section claims the area before the first mount has rendered.
    const foreign = document.createElement("p");
    container.append(foreign);
    renderGeneralSettings(container);
    await flush();
    await flush();

    expect(container.contains(foreign)).toBe(false);
    expect(container.querySelectorAll('[part="overview"]')).toHaveLength(1);
  });
});
