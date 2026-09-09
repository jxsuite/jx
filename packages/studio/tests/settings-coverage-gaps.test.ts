/**
 * Coverage-gap tests for the settings section renderers:
 *
 * - Dependencies-editor: listPackages failure, capability-gated no-ops, blank add, failed
 *   update/update-all/reinstall (progress-modal error view), and busy re-entrancy.
 * - Css-vars-editor: font/size row deletion and the scheme-override color swatch input.
 * - Contributed-section: template-less newEntry, array/number template leaves, stale delete clicks,
 *   and the entry-name keydown (Enter/Escape) handling. That section is a Jx document
 *   (`src/surfaces/settings-contributed.json`), so its container is on the page and every render is
 *   awaited, and Escape no longer blurs a field: the scope moves back to the key on disk, which is
 *   what the field then shows.
 */
import { flush, installMockPlatform, key, pointer, resetStudioState, topDialog } from "./harness";
import { problems, resetNotifications } from "../src/services/notify";
import { resetActivities } from "../src/panels/activity-panel";
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { MockPlatformState } from "./harness";
import type { SettingsContribution } from "../src/settings/contributed-section";

void mock.module("../src/version", () => ({
  APP_NAME: "Jx Studio",
  BUILD_DATE: "",
  GIT_COMMIT: "test",
  LINKS: { docs: "", github: "", license: "" },
  VERSION: "0.30.1",
}));

const { initLayers } = await import("../src/ui/layers");
const { maybePromptJxsuiteUpdate } = await import("../src/packages/jxsuite-update");
const { renderDependenciesEditor } = await import("../src/settings/dependencies-editor");
const { renderCssVarsEditor } = await import("../src/settings/css-vars-editor");
const { renderContributedSection, resetContributedSectionState } =
  await import("../src/settings/contributed-section");
const { resetSchemaForms } = await import("../src/ui/schema-form");
// Namespace import keeps the `projectState` binding live across resetStudioState calls.
const store = await import("../src/store");

beforeAll(() => {
  for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
    if (!document.querySelector(`#${id}`)) {
      const el = document.createElement("div");
      el.id = id;
      document.body.append(el);
    }
  }
  initLayers();
});

afterEach(() => {
  resetNotifications();
  resetActivities();
  for (const d of document.querySelectorAll("body > div")) {
    if (!d.id) {
      d.remove();
    }
  }
  (document.querySelector("#layer-modal") as HTMLElement).innerHTML = "";
});

function makeContainer(): HTMLElement {
  const c = document.createElement("div");
  document.body.append(c);
  return c;
}

function modalLayer(): HTMLElement {
  return document.querySelector("#layer-modal") as HTMLElement;
}

// ─── Dependencies editor ─────────────────────────────────────────────────────

/*
 * The Packages section is a document (`src/surfaces/settings-packages.json`), so everything below
 * addresses it by `part` and gives the mount its turns: `flush(4)` rather than the default two,
 * because the surface settles one turn after the document renders and each kit element's own
 * template one turn after that.
 */

/** The line drawn where the table would be: "Loading…" or "No dependencies.". */
function depsStatus(c: HTMLElement): string {
  return c.querySelector('[part="status"]')?.textContent?.trim() ?? "";
}

/** One package's row, found by the package it draws. */
function depsRow(c: HTMLElement, name: string): HTMLElement {
  const el = c.querySelector(`[part="row"][data-package="${name}"]`);
  if (!el) {
    throw new Error(`no row for "${name}"`);
  }
  return el as HTMLElement;
}

const TWO_DEPS = {
  listPackages: async () => [
    { dev: true, name: "@jxsuite/compiler", version: "^0.19.0" },
    { name: "hono", version: "^4.0.0" },
  ],
  packageVersions: async () => [{ current: "^4.0.0", latest: "4.6.0", name: "hono" }],
};

describe("dependencies editor gaps", () => {
  test("listPackages failure falls back to the empty state", async () => {
    installMockPlatform({
      listPackages: async () => {
        throw new Error("bun pm ls failed");
      },
    });
    const c = makeContainer();
    renderDependenciesEditor(c);
    await flush(4);
    expect(depsStatus(c)).toContain("No dependencies");
  });

  test("packageVersions failure keeps the table without latest versions", async () => {
    installMockPlatform({
      listPackages: TWO_DEPS.listPackages,
      packageVersions: async () => {
        throw new Error("registry unreachable");
      },
    });
    const c = makeContainer();
    renderDependenciesEditor(c);
    await flush(4);
    expect(c.querySelectorAll('[part="row"]')).toHaveLength(2);
    // The rows still list; with no registry answer every Latest cell reads — and nothing is
    // Offered as an update. A best-effort lookup that fails must not invent a target.
    expect(depsRow(c, "hono").querySelector('[part="latest"]')?.textContent?.trim()).toBe("—");
    expect(c.querySelector('[part="update"]')).toBeNull();
  });

  test("update, update all, and reinstall are no-ops without platform capabilities", async () => {
    const { state } = installMockPlatform(TWO_DEPS);
    const c = makeContainer();
    renderDependenciesEditor(c);
    await flush(4);
    pointer(depsRow(c, "hono").querySelector('[part="update"]')!, "click");
    pointer(c.querySelector('[part="update-all"]')!, "click");
    pointer(c.querySelector('[part="reinstall"]')!, "click");
    await flush(4);
    // No capability → no busy run, no progress modal, no writes.
    expect(modalLayer().querySelector(".progress-modal")).toBeNull();
    expect(state.calls.some(([name]) => name === "writeFile")).toBe(false);
  });

  test("add with a blank name is a no-op", async () => {
    const { state } = installMockPlatform({ listPackages: async () => [] });
    const c = makeContainer();
    renderDependenciesEditor(c);
    await flush(4);
    pointer(c.querySelector('[part="add-button"]')!, "click");
    await flush(4);
    expect(state.calls.some(([name]) => name === "addPackage")).toBe(false);
    expect(modalLayer().querySelector(".progress-modal")).toBeNull();
  });

  test("a failed row update surfaces the backend log in Problems", async () => {
    installMockPlatform({
      ...TWO_DEPS,
      setPackageVersions: async () => ({ log: "conflicting peer deps", ok: false }),
    });
    const c = makeContainer();
    renderDependenciesEditor(c);
    await flush(4);
    pointer(depsRow(c, "hono").querySelector('[part="update"]')!, "click");
    await flush(4);
    expect(problems[0]?.message).toContain("conflicting peer deps");
  });

  test("update all skips current packages and reports a log-less failure", async () => {
    let received: { name: string }[] = [];
    installMockPlatform({
      listPackages: async () => [
        { name: "hono", version: "^4.0.0" },
        { name: "left-pad", version: "^1.3.0" },
      ],
      packageVersions: async () => [{ current: "^4.0.0", latest: "4.6.0", name: "hono" }],
      setPackageVersions: async (updates) => {
        received = updates;
        return { ok: false };
      },
    });
    const c = makeContainer();
    renderDependenciesEditor(c);
    await flush(4);
    pointer(c.querySelector('[part="update-all"]')!, "click");
    await flush(4);
    // The current package produced no update entry; the failure fell back to a generic message.
    expect(received.map((u) => u.name)).toEqual(["hono"]);
    expect(problems[0]?.message).toContain("Update failed");
  });

  test("a stale update-all click after the list refreshes to current is a no-op", async () => {
    installMockPlatform({
      ...TWO_DEPS,
      setPackageVersions: async () => ({ ok: true }),
    });
    const c = makeContainer();
    renderDependenciesEditor(c);
    await flush(4);
    const staleButton = c.querySelector('[part="update-all"]')!;

    let called = 0;
    installMockPlatform({
      listPackages: async () => [],
      setPackageVersions: async () => {
        called += 1;
        return { ok: true };
      },
    });
    renderDependenciesEditor(makeContainer());
    await flush(4);

    pointer(staleButton, "click");
    await flush(4);
    expect(called).toBe(0);
    expect(modalLayer().querySelector(".progress-modal")).toBeNull();
  });

  test("a failed reinstall surfaces the install log in Problems", async () => {
    installMockPlatform({
      ...TWO_DEPS,
      installDependencies: async () => ({ log: "lockfile busted", ok: false }),
    });
    const c = makeContainer();
    renderDependenciesEditor(c);
    await flush(4);
    pointer(c.querySelector('[part="reinstall"]')!, "click");
    await flush(4);
    expect(problems[0]?.message).toContain("lockfile busted");
  });

  test("operations are ignored while another one is running", async () => {
    let releaseAdd: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });
    let adds = 0;
    installMockPlatform({
      addPackage: async () => {
        adds += 1;
        await gate;
        return {};
      },
      listPackages: async () => [],
    });
    const c = makeContainer();
    renderDependenciesEditor(c);
    await flush(4);
    const field = c.querySelector('[part="add-field"] [part="input"]') as HTMLInputElement;
    field.value = "lodash";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flush(2);
    const addButton = c.querySelector('[part="add-button"]')!;
    pointer(addButton, "click");
    // Second click lands while the first run holds the busy flag.
    pointer(addButton, "click");
    releaseAdd();
    await flush(4);
    expect(adds).toBe(1);
  });
});

// ─── Jxsuite update prompt with unavailable storage ──────────────────────────

describe("jxsuite-update dismissal storage", () => {
  test("the prompt still shows when localStorage access throws (never remembered)", async () => {
    installMockPlatform({
      packageVersions: async () => [
        { current: "^0.1.0", latest: "0.4.0", name: "@jxsuite/runtime" },
      ],
      setPackageVersions: async () => ({ ok: true }),
    });
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage denied");
      },
    });
    try {
      const pending = maybePromptJxsuiteUpdate("/proj");
      await flush();
      const dialog = topDialog()!;
      expect(dialog).not.toBeNull();
      dialog!.dispatchEvent(new Event("cancel")); // Declines → setDismissed also hits the catch.
      await pending;
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "localStorage", original);
      }
      (document.querySelector("#layer-dialog") as HTMLElement).innerHTML = "";
    }
  });
});

// ─── CSS variables editor ────────────────────────────────────────────────────

describe("css vars editor gaps", () => {
  /**
   * The editor is a document now, so its content arrives a turn after `render` returns — the kit's
   * elements have to be defined first. Every caller awaits this.
   */
  async function setupVars(media?: Record<string, string>): Promise<HTMLElement> {
    installMockPlatform();
    resetStudioState({
      projectConfig: {
        style: {
          "--color-primary": "#007acc",
          "--font-body": "'Georgia', serif",
          "--size-gap": "16px",
        },
        ...(media ? { $media: media } : {}),
      } as unknown,
    });
    const container = document.createElement("div");
    renderCssVarsEditor(container);
    await flush();
    await flush();
    return container;
  }

  function style(): Record<string, unknown> {
    return (store.projectState as unknown as { projectConfig: { style: Record<string, unknown> } })
      .projectConfig.style;
  }

  function groupByTitle(container: HTMLElement, title: string): HTMLElement {
    const group = [...container.querySelectorAll('[part="group"]')].find(
      (g) => g.querySelector('[part="group-title"]')?.textContent?.trim() === title,
    );
    if (!group) {
      throw new Error(`no css-vars group titled "${title}"`);
    }
    return group as HTMLElement;
  }

  test("font row delete removes the token", async () => {
    const container = await setupVars();
    const fonts = groupByTitle(container, "Fonts");
    pointer(fonts.querySelector('[part="remove"]')!, "click");
    expect(style()["--font-body"]).toBeUndefined();
  });

  test("size row delete removes the token", async () => {
    const container = await setupVars();
    const sizes = groupByTitle(container, "Sizes & Spacing");
    pointer(sizes.querySelector('[part="remove"]')!, "click");
    expect(style()["--size-gap"]).toBeUndefined();
  });

  test("scheme override swatch input writes into the scheme block", async () => {
    const container = await setupVars({ "--dark": "(prefers-color-scheme: dark)" });
    /* A document now: a scheme override is `[part="override"]`, and its colour well is the native
       input the kit's swatch wraps. */
    const swatchInput = container.querySelector(
      '[part="override"] input[type="color"]',
    ) as HTMLInputElement;
    swatchInput.value = "#222222";
    swatchInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect((style()["@--dark"] as Record<string, unknown>)["--color-primary"]).toBe("#222222");
  });
});

// ─── Contributed sections ────────────────────────────────────────────────────

describe("contributed section gaps", () => {
  let platformState: MockPlatformState;
  let container: HTMLElement;

  /** Let the section's document and the standing schema form catch up. */
  async function settle(): Promise<void> {
    await flush(8);
  }

  /** A node the section's own document draws, by the `part` it carries. */
  function part(root: ParentNode, name: string): HTMLElement {
    const el = root.querySelector(`[part="${name}"]`);
    if (!el) {
      throw new Error(`no [part="${name}"] in the contributed section`);
    }
    return el as HTMLElement;
  }

  /** The native control a kit element wraps. */
  function control(el: Element): HTMLInputElement {
    const inner = el.querySelector<HTMLInputElement>('input[part="input"]');
    if (!inner) {
      throw new Error(`no native control inside <${el.tagName.toLowerCase()}>`);
    }
    return inner;
  }

  beforeEach(() => {
    resetContributedSectionState();
    resetSchemaForms();
    ({ state: platformState } = installMockPlatform());
    resetStudioState({
      projectConfig: {
        connections: { main: { provider: "d1" } },
        name: "site",
      } as unknown,
    });
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
  });

  function config(): Record<string, unknown> {
    return store.projectState!.projectConfig as unknown as Record<string, unknown>;
  }

  const mapContribution: SettingsContribution = {
    entrySchema: { properties: { label: { type: "string" } } },
    key: "connections",
    settings: { layout: "map" },
    title: "Connections",
  };

  async function createEntry(name: string): Promise<void> {
    pointer(part(container, "new-open"), "click");
    await settle();
    const field = control(part(container, "new-field"));
    field.value = name;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    pointer(part(container, "new-create"), "click");
    await settle();
  }

  async function selectEntry(name: string): Promise<void> {
    const row = container.querySelector(`[data-entry="${name}"]`);
    if (!row) {
      throw new Error(`no entry row for "${name}"`);
    }
    pointer(row, "click");
    await settle();
  }

  test("create without a newEntry template starts from an empty entry", async () => {
    renderContributedSection(container, mapContribution);
    await settle();
    await createEntry("Fresh One");
    expect((config().connections as Record<string, unknown>)["fresh-one"]).toEqual({});
  });

  test("newEntry templates substitute inside arrays and keep non-string leaves", async () => {
    renderContributedSection(container, {
      ...mapContribution,
      settings: {
        entry: {
          newEntry: { depth: 2, enabled: true, tags: ["${key}", 7, { ref: "${key}" }] },
        },
        layout: "map",
      },
    });
    await settle();
    await createEntry("tagged");
    expect((config().connections as Record<string, unknown>).tagged).toEqual({
      depth: 2,
      enabled: true,
      tags: ["tagged", 7, { ref: "tagged" }],
    });
  });

  test("a stale delete click after the entry is gone is a no-op", async () => {
    renderContributedSection(container, mapContribution);
    await settle();
    await selectEntry("main");
    const deleteButton = part(container, "delete-entry");
    pointer(deleteButton, "click");
    await settle();
    const writes = platformState.calls.filter(
      (c) => c[0] === "writeFile" && c[1] === "project.json",
    ).length;
    // The detached button's handler still fires, but the entry is already gone.
    pointer(deleteButton, "click");
    await settle();
    expect(config().connections).toEqual({});
    expect(
      platformState.calls.filter((c) => c[0] === "writeFile" && c[1] === "project.json"),
    ).toHaveLength(writes);
  });

  test("Enter commits the entry rename and Escape abandons it", async () => {
    renderContributedSection(container, mapContribution);
    await settle();
    await selectEntry("main");
    const nameInput = () => control(part(container, "entry-name"));

    // Escape puts the key on disk back, and writes nothing.
    nameInput().value = "half-typed";
    nameInput().dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    key(nameInput(), "Escape");
    await settle();
    expect(nameInput().value).toBe("main");
    expect(Object.keys(config().connections as Record<string, unknown>)).toEqual(["main"]);
    expect(
      platformState.calls.filter((c) => c[0] === "writeFile" && c[1] === "project.json"),
    ).toHaveLength(0);

    // Enter commits, without waiting for the field to lose focus.
    nameInput().value = "Renamed One";
    nameInput().dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    key(nameInput(), "Enter");
    await settle();
    expect(Object.keys(config().connections as Record<string, unknown>)).toEqual(["renamed-one"]);
    expect(nameInput().value).toBe("renamed-one");
  });
});
