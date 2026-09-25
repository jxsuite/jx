/**
 * Tests for src/settings/contexts-section.ts — Project Settings › Contexts, the ONE definition site
 * for breakpoints, colour schemes and feature queries (plan §4.2, §2 principle 5).
 *
 * What these pin is mostly what is NOT here any more. `$media` used to be writable from four
 * surfaces — the New Project wizard, Settings › General, Properties › Media and the CSS-variables
 * "Enable dark scheme" button — and the third of those rendered only when the document ROOT was
 * selected, so adding a breakpoint cost you your element. This section is the whole story now, so
 * the tests cover the whole story: classification, naming, validation, and the two failure modes (a
 * schema refusal and a refused write) that the predecessors dropped on the floor.
 *
 * **The section is a Jx document now** (`src/surfaces/settings-contexts.json`), so three things
 * about this file are deliberate rather than incidental:
 *
 * - The container is APPENDED TO THE DOCUMENT. A kit element renders in `connectedCallback`, so a
 *   detached container gets `<jx-textfield>` tags with nothing inside them — every assertion about
 *   a control would read `null` and the failure would look like a missing element rather than a
 *   missing connection.
 * - Rendering is awaited. `renderContextsSection` still returns void, as the registry's
 *   `render(container)` seam requires, and mounting is asynchronous underneath it; {@link settle}
 *   is the one place that knows how long that takes.
 * - An edit is made on the NATIVE control inside the kit element, not on the element. That is what a
 *   reader's edit is: `jx-textfield` hears its own input's event and lets it bubble on, so a test
 *   that wrote the host's `value` property would be moving the control without ever telling it.
 *
 * `jx-validate` is mocked. The real one compiles the project's generated entry document with ajv,
 * which is both slow and dependent on which extensions the fixture happens to enable — neither of
 * which is what this file is about. What it IS about is that a human editing project.json through a
 * form gets the same gate the AI's `write_project_config` has always had.
 */
import { flush, installMockPlatform, pointer, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { projectState } from "../src/store";

import type { MockPlatformState } from "./harness";
import type { StudioPlatform } from "../src/types";

type AnyConfig = Record<string, any>;

/**
 * What the mocked validator returns.
 *
 * A FUNCTION of the config, because the section validates twice now — the file as it stands and the
 * file as the edit would leave it — and subtracts the first from the second, so a test that cannot
 * tell those two calls apart cannot test either half. A bare array answers both, which is exactly
 * how a pre-existing problem is expressed.
 */
let validatorResult: string[] | Error | ((candidate: AnyConfig) => string[]) = [];

const validateProjectConfig = mock(async (candidate: unknown): Promise<string[]> => {
  if (validatorResult instanceof Error) {
    // eslint-disable-next-line no-throw-literal -- validatorResult IS an Error on this branch
    throw validatorResult as Error;
  }
  return typeof validatorResult === "function"
    ? validatorResult(candidate as AnyConfig)
    : validatorResult;
});
void mock.module("../src/services/jx-validate.js", () => ({
  validateProjectConfig,
  validateDoc: async () => [],
  applyProjectSchemas: () => {},
  resetProjectSchemas: () => {},
}));

const { contextKeyOf, contextKindOf, renderContextsSection, splitContexts } =
  await import("../src/settings/contexts-section");
const { mountContextsSurface } = await import("../src/surfaces/settings-contexts");

/**
 * Let the document catch up.
 *
 * Generous on purpose, and in one place: the mount awaits the kit's registration, each kit element
 * builds its own scope asynchronously in `connectedCallback`, and a write runs two validations and
 * a `writeFile` before it re-projects. A per-test turn count would be four different guesses at the
 * same number.
 */
async function settle(): Promise<void> {
  await flush(8);
}

async function setup(
  media: Record<string, string> | undefined,
  overrides: Partial<StudioPlatform> = {},
): Promise<{ container: HTMLElement; state: MockPlatformState }> {
  const { state } = installMockPlatform(overrides);
  resetStudioState({
    projectConfig: { name: "Site", ...(media ? { $media: media } : {}) } as unknown,
  });
  const container = document.createElement("div");
  document.body.append(container);
  renderContextsSection(container);
  await settle();
  return { container, state };
}

function config(): AnyConfig {
  return (projectState as AnyConfig).projectConfig;
}

function group(container: HTMLElement, kind: string): HTMLElement {
  const el = container.querySelector(`[data-context-group="${kind}"]`);
  if (!el) {
    throw new Error(`no "${kind}" group in the Contexts section`);
  }
  return el as HTMLElement;
}

function rowKeys(container: HTMLElement, kind: string): string[] {
  return [...group(container, kind).querySelectorAll("[data-context]")].map(
    (el) => (el as HTMLElement).dataset.context ?? "",
  );
}

function addButton(container: HTMLElement, kind: string): HTMLElement {
  return group(container, kind).querySelector(`[data-add="${kind}"]`) as HTMLElement;
}

/** The name field of the first row in a group. */
function nameField(container: HTMLElement, kind: string, index = 0): Element {
  return group(container, kind).querySelectorAll('[part="name"]')[index]!;
}

/** The value control of the first row in a group — a text field, or a scheme select. */
function valueField(container: HTMLElement, kind: string, index = 0): Element {
  return group(container, kind).querySelectorAll('[part="value"]')[index]!;
}

/**
 * Type into a kit control and commit it, the way a reader does: the write and the event both happen
 * on the native control inside the element (`[part="input"]` for a field, `[part="control"]` for a
 * select), and the element lets `change` bubble on to whoever is listening.
 */
function setAndFire(el: Element, value: string): void {
  const control = el.querySelector<HTMLInputElement>('[part="input"], [part="control"]');
  if (!control) {
    throw new Error(`no native control inside <${el.tagName.toLowerCase()}>`);
  }
  control.value = value;
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The base-width field, addressed by the data hook rather than by position. */
function baseField(container: HTMLElement): Element {
  return container.querySelector('[data-context="base"]')!;
}

function errorTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[part="row-error"], [part="section-error"]')].map(
    (el) => el.textContent?.trim() ?? "",
  );
}

beforeEach(() => {
  validatorResult = [];
  validateProjectConfig.mockClear();
});

afterEach(() => {
  document.body.replaceChildren();
});

// ─── Classification ──────────────────────────────────────────────────────────
/* All three kinds are the same thing on disk — one `$media` entry — so which group a row belongs
   to has to be DERIVED, not stored. That is what keeps the on-disk format unchanged while the
   authoring surface moves. */

describe("classification", () => {
  test("width queries are sizes, scheme queries are schemes, the rest are features", () => {
    expect(contextKindOf("(max-width: 768px)")).toBe("size");
    expect(contextKindOf("(min-width: 1024px)")).toBe("size");
    expect(contextKindOf("(prefers-color-scheme: dark)")).toBe("scheme");
    expect(contextKindOf("(prefers-color-scheme: light)")).toBe("scheme");
    expect(contextKindOf("(prefers-reduced-motion: reduce)")).toBe("feature");
    expect(contextKindOf("print")).toBe("feature");
  });

  test("splitContexts lifts the base width out and classifies the rest", () => {
    const { base, entries } = splitContexts({
      "--": "1280px",
      "--dark": "(prefers-color-scheme: dark)",
      "--print": "print",
      "--sm": "(max-width: 600px)",
    });
    expect(base).toBe("1280px");
    expect(entries.map((e) => [e.key, e.kind])).toEqual([
      ["--dark", "scheme"],
      ["--print", "feature"],
      ["--sm", "size"],
    ]);
  });

  test("an absent or empty $media splits into nothing", () => {
    expect(splitContexts()).toEqual({ base: "", entries: [] });
    expect(splitContexts({})).toEqual({ base: "", entries: [] });
  });
});

describe("naming", () => {
  test("a friendly name becomes a -- key without the user typing dashes", () => {
    expect(contextKeyOf("Tablet")).toBe("--tablet");
    expect(contextKeyOf("Wide screen")).toBe("--wide-screen");
    expect(contextKeyOf("  Extra  Large  ")).toBe("--extra-large");
  });

  test("dashes the user does type are not doubled", () => {
    expect(contextKeyOf("--tablet")).toBe("--tablet");
  });

  test("a name with nothing nameable in it is refused, not turned into --", () => {
    expect(contextKeyOf("")).toBe("");
    expect(contextKeyOf("---")).toBe("");
    expect(contextKeyOf("!!!")).toBe("");
  });
});

// ─── Rendering ───────────────────────────────────────────────────────────────

describe("rendering", () => {
  test("the three groups always render, each with an empty state and an add button", async () => {
    const { container } = await setup(undefined);
    for (const kind of ["size", "scheme", "feature"]) {
      expect(rowKeys(container, kind)).toEqual([]);
      expect(addButton(container, kind)).not.toBeNull();
    }
    expect(container.textContent).toContain("No breakpoints yet");
    expect(container.textContent).toContain("No colour schemes yet");
  });

  test("entries land in their own group and nowhere else", async () => {
    const { container } = await setup({
      "--": "1280px",
      "--dark": "(prefers-color-scheme: dark)",
      "--print": "print",
      "--sm": "(max-width: 600px)",
    });
    expect(rowKeys(container, "size")).toEqual(["--sm"]);
    expect(rowKeys(container, "scheme")).toEqual(["--dark"]);
    expect(rowKeys(container, "feature")).toEqual(["--print"]);
  });

  test("the base width renders its own row, outside every group", async () => {
    const { container } = await setup({ "--": "1280px" });
    const base = baseField(container) as HTMLElement & { value: string };
    expect(base.value).toBe("1280px");
    expect(base.closest("[data-context-group]")).toBeNull();
  });

  test("a scheme row is a select, so a scheme can never be mistyped into a feature", async () => {
    const { container } = await setup({ "--dark": "(prefers-color-scheme: dark)" });
    const picker = group(container, "scheme").querySelector("jx-select");
    expect(picker).not.toBeNull();
    expect((picker as unknown as { value: string }).value).toBe("dark");
    expect([...picker!.querySelectorAll("option")].map((o) => o.value)).toEqual(["light", "dark"]);
  });

  test("the section is one mounted document, re-used rather than re-mounted", async () => {
    /*
     * The host calls `render(container)` again for every change it notices — a nav click, an
     * extension registering, a command selecting an entry — and the lit version answered each by
     * rebuilding the whole section. A remount would take the reader's focus and their caret with
     * it, so what a repeat call must do is write the new projection into the scope that is already
     * mounted, leaving the element identities alone.
     */
    const { container } = await setup({ "--sm": "(max-width: 600px)" });
    const before = valueField(container, "size");
    renderContextsSection(container);
    await settle();
    expect(valueField(container, "size")).toBe(before);
  });

  test("a container another section took over is rebuilt, not written into from a distance", async () => {
    /*
     * Two sections share one container: the pane hands it to whoever is displayed, and the one that
     * arrives clears it. Coming back has to notice that the mounted document is gone — otherwise
     * the scope stays live over detached nodes and the section renders nothing, for good.
     */
    const { container } = await setup({ "--sm": "(max-width: 600px)" });
    container.textContent = "";
    renderContextsSection(container);
    await settle();
    expect(rowKeys(container, "size")).toEqual(["--sm"]);
  });

  test("remove is an icon button the kit draws, not a × somebody typed", async () => {
    const { container } = await setup({ "--sm": "(max-width: 600px)" });
    const remove = group(container, "size").querySelector('[data-remove="--sm"]')!;
    expect(remove.querySelector('[part="icon-glyph"]')).not.toBeNull();
    expect(remove.querySelector('[part="control"]')?.getAttribute("aria-label")).toBe("Remove Sm");
  });
});

// ─── Editing ─────────────────────────────────────────────────────────────────

describe("editing", () => {
  test("adding a breakpoint writes one entry with a real query", async () => {
    const { container } = await setup({ "--": "1280px" });
    pointer(addButton(container, "size"), "click");
    await settle();
    expect(config().$media).toEqual({ "--": "1280px", "--breakpoint": "(max-width: 768px)" });
  });

  test("adding twice does not collide — the second takes the next free name", async () => {
    const { container } = await setup({});
    pointer(addButton(container, "size"), "click");
    await settle();
    pointer(addButton(container, "size"), "click");
    await settle();
    expect(Object.keys(config().$media)).toEqual(["--breakpoint", "--breakpoint-2"]);
  });

  test("adding a colour scheme writes the canonical prefers-color-scheme query", async () => {
    const { container } = await setup({});
    pointer(addButton(container, "scheme"), "click");
    await settle();
    expect(config().$media["--dark"]).toBe("(prefers-color-scheme: dark)");
  });

  test("changing a query persists it", async () => {
    const { container } = await setup({ "--sm": "(max-width: 600px)" });
    setAndFire(valueField(container, "size"), "(max-width: 720px)");
    await settle();
    expect(config().$media["--sm"]).toBe("(max-width: 720px)");
  });

  test("renaming preserves order — a rename is not a reordering", async () => {
    const { container } = await setup({
      "--": "1280px",
      "--sm": "(max-width: 600px)",
      "--md": "(max-width: 900px)",
    });
    setAndFire(nameField(container, "size"), "Phone");
    await settle();
    expect(Object.keys(config().$media)).toEqual(["--", "--phone", "--md"]);
    expect(config().$media["--phone"]).toBe("(max-width: 600px)");
  });

  test("switching a scheme row's select rewrites the query, not the name", async () => {
    const { container } = await setup({ "--scheme": "(prefers-color-scheme: dark)" });
    setAndFire(valueField(container, "scheme"), "light");
    await settle();
    expect(config().$media).toEqual({ "--scheme": "(prefers-color-scheme: light)" });
  });

  test("remove deletes exactly one entry", async () => {
    const { container } = await setup({
      "--sm": "(max-width: 600px)",
      "--md": "(max-width: 900px)",
    });
    const remove = group(container, "size").querySelector('[data-remove="--sm"]') as HTMLElement;
    pointer(remove, "click");
    await settle();
    expect(config().$media).toEqual({ "--md": "(max-width: 900px)" });
  });

  test("the base width accepts pixels and clearing it drops the key", async () => {
    const { container } = await setup({ "--": "1280px", "--sm": "(max-width: 600px)" });
    setAndFire(baseField(container), "1440px");
    await settle();
    expect(config().$media["--"]).toBe("1440px");

    setAndFire(baseField(container), "");
    await settle();
    expect(config().$media).toEqual({ "--sm": "(max-width: 600px)" });
  });
});

// ─── Refusals (§7.1 inline tier) ─────────────────────────────────────────────
/* Every one of these used to be a silent snap-back: the predecessors did `void
   updateSiteConfig(...)` and dropped the rejection, so a refused value looked like the field
   forgetting what you typed. */

describe("refusals", () => {
  test("a base width that is not pixels is refused at its own control", async () => {
    const { container } = await setup({ "--": "1280px" });
    setAndFire(baseField(container), "wide");
    await settle();
    expect(errorTexts(container)).toContain("Enter a width in pixels, like 1280px.");
    expect(config().$media["--"]).toBe("1280px");
    // And the control says so itself, rather than only the line under it.
    expect((baseField(container) as unknown as { invalid: boolean }).invalid).toBe(true);
  });

  test("an empty name is refused and the entry survives", async () => {
    const { container } = await setup({ "--sm": "(max-width: 600px)" });
    setAndFire(nameField(container, "size"), "   ");
    await settle();
    expect(errorTexts(container)).toContain("A context needs a name.");
    expect(config().$media).toEqual({ "--sm": "(max-width: 600px)" });
  });

  test("renaming onto an existing name is refused instead of eating the other entry", async () => {
    const { container } = await setup({
      "--sm": "(max-width: 600px)",
      "--md": "(max-width: 900px)",
    });
    setAndFire(nameField(container, "size", 0), "md");
    await settle();
    expect(errorTexts(container).join(" ")).toContain("already defined");
    expect(config().$media).toEqual({
      "--md": "(max-width: 900px)",
      "--sm": "(max-width: 600px)",
    });
  });

  test("renaming to the same name is a no-op, not an error", async () => {
    const { container } = await setup({ "--sm": "(max-width: 600px)" });
    setAndFire(nameField(container, "size"), "sm");
    await settle();
    expect(errorTexts(container)).toEqual([]);
    expect(config().$media).toEqual({ "--sm": "(max-width: 600px)" });
  });

  test("an empty query is refused", async () => {
    const { container } = await setup({ "--sm": "(max-width: 600px)" });
    setAndFire(valueField(container, "size"), "  ");
    await settle();
    expect(errorTexts(container).join(" ")).toContain("needs a media query");
    expect(config().$media["--sm"]).toBe("(max-width: 600px)");
  });
});

// ─── Validation and write failures ───────────────────────────────────────────

describe("validation", () => {
  test("a schema refusal blocks the write and is shown at the row that caused it", async () => {
    // Clean before, broken after: an error THIS edit introduced.
    validatorResult = (candidate) =>
      candidate.$media?.["--sm"] === "nonsense" ? ["/$media/--sm: must match pattern"] : [];
    const { container, state } = await setup({ "--sm": "(max-width: 600px)" });
    setAndFire(valueField(container, "size"), "nonsense");
    await settle();
    expect(errorTexts(container)).toContain("/$media/--sm: must match pattern");
    expect(config().$media["--sm"]).toBe("(max-width: 600px)");
    expect(state.calls.filter(([name]) => name === "writeFile")).toHaveLength(0);
  });

  test("a problem the file already had does not block an unrelated edit", async () => {
    /*
     * This is what an imported project looked like. Its `project.json` carried three top-level keys
     * the composed schema does not allow, so every Contexts edit was refused with three copies of
     * "(root): must NOT have unevaluated properties" parked under whichever control was touched —
     * typing a base width reported an error about `title`. The candidate is the whole file, so the
     * baseline has to be subtracted or the section can only ever be used on a perfect one.
     */
    validatorResult = ["(root): must NOT have unevaluated properties (title)"];
    const { container, state } = await setup({ "--sm": "(max-width: 600px)" });
    setAndFire(baseField(container), "1280px");
    await settle();

    expect(config().$media["--"]).toBe("1280px");
    expect(state.calls.filter(([name]) => name === "writeFile").length).toBeGreaterThan(0);
  });

  test("but the file's own problem is still reported, once, at section level", async () => {
    validatorResult = ["(root): must NOT have unevaluated properties (title)"];
    const { container } = await setup({ "--sm": "(max-width: 600px)" });
    setAndFire(baseField(container), "1280px");
    await settle();

    const notice = container.querySelector('[part="notice"]')?.textContent ?? "";
    expect(notice).toContain("pre-existing schema");
    // And it NAMES the key, which is the whole difference between a diagnosis and a mystery.
    expect(notice).toContain("(title)");
    // Not under the control the author touched — it is not that control's fault.
    expect(errorTexts(container)).toEqual([]);
  });

  test("a validator that will not compile reports itself and blocks nothing else", async () => {
    validatorResult = new Error("ajv exploded");
    const { container } = await setup({ "--sm": "(max-width: 600px)" });
    setAndFire(valueField(container, "size"), "(min-width: 1px)");
    await settle();
    expect(errorTexts(container).join(" ")).toContain("Could not validate project.json");
  });

  test("a rejected write is shown, not swallowed", async () => {
    const { container } = await setup({ "--sm": "(max-width: 600px)" }, {
      writeFile: async () => {
        throw new Error("EROFS: read-only file system");
      },
    } as unknown as Partial<StudioPlatform>);
    setAndFire(valueField(container, "size"), "(min-width: 1px)");
    await settle();
    expect(errorTexts(container).join(" ")).toContain(
      "Could not save project.json — EROFS: read-only file system",
    );
  });

  test("a later success clears the error", async () => {
    const { container } = await setup({ "--sm": "(max-width: 600px)" }, {
      writeFile: async () => {
        throw new Error("EROFS");
      },
    } as unknown as Partial<StudioPlatform>);
    setAndFire(valueField(container, "size"), "(min-width: 1px)");
    await settle();
    expect(errorTexts(container)).not.toEqual([]);

    installMockPlatform();
    setAndFire(valueField(container, "size"), "(min-width: 2px)");
    await settle();
    expect(errorTexts(container)).toEqual([]);
    expect(config().$media["--sm"]).toBe("(min-width: 2px)");
  });
});

// ─── The adapter's own lifecycle ─────────────────────────────────────────────

describe("the contexts surface", () => {
  test("disposing before the mount lands tears it down rather than leaving it running", async () => {
    /*
     * Mounting is asynchronous and closing is not, so the two can cross. `attached()` answers "yes"
     * for a mount in flight — otherwise a second synchronous render would tear down the mount it is
     * waiting for — which makes this the one path where a handle is disposed with nothing to
     * dispose yet, and the effects and the nodes both have to go when it does land.
     */
    const host = document.createElement("div");
    document.body.append(host);
    const noop = () => {};
    const handle = mountContextsSurface(host, {
      add: noop,
      remove: noop,
      rename: noop,
      setBase: noop,
      setQuery: noop,
      setScheme: noop,
    });
    handle.dispose();
    await handle.ready;
    await settle();

    expect(handle.attached()).toBe(false);
    expect(host.querySelector('[part="contexts"]')).toBeNull();
  });
});
