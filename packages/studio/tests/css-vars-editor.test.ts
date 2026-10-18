/**
 * Tests for the CSS Variables settings section — `src/settings/css-vars-editor.ts`, the flow, and
 * `src/surfaces/settings-css-vars.json`, the document it mounts.
 *
 * Everything is addressed by `part`, because the section is a document: there is no
 * `.css-vars-group` or `.css-var-media-row` to find any more, and the class that only ever existed
 * so a test could name a scheme row (`.css-var-scheme-row`, which no stylesheet defined) is now
 * `data-kind="scheme"` on the row itself. The controls are the kit's, so a reader's edit is
 * performed on the NATIVE control inside each element — writing the host's property instead would
 * move a control no reader can move.
 *
 * Persistence goes through `updateSiteConfig` → `platform.writeFile("project.json")`, and the
 * writes are asserted against both the live config and the serialized file.
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { hintOf } from "./kit-readers";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { projectState } from "../src/store";
import { focusCssVar, renderCssVarsEditor } from "../src/settings/css-vars-editor";
import { revealCssVarsToken } from "../src/surfaces/settings-css-vars";
import { getNestedStyle, isJsonObject } from "@jxsuite/schema/guards";

import type { JsonObject, JsonValue, JxStyle } from "@jxsuite/schema/types";
import type { MockPlatformState } from "./harness";
import type { StudioPlatform } from "../src/types";

/**
 * Draw the section into a fresh container and let the surface mount.
 *
 * Four turns rather than one: `mountSurface` settles when the DOCUMENT has rendered, and each kit
 * element's own template is one `connectedCallback` later — so a single turn finds `jx-textfield`
 * with no `input` inside it.
 */
async function setup(
  styleObj: JsonObject,
  media?: Record<string, string>,
  overrides: Partial<StudioPlatform> = {},
): Promise<{ container: HTMLElement; state: MockPlatformState }> {
  const { state } = installMockPlatform(overrides);
  const projectConfig: JsonObject = { style: styleObj };
  if (media) {
    projectConfig.$media = media;
  }
  resetStudioState({ projectConfig });
  const container = document.createElement("div");
  document.body.append(container);
  renderCssVarsEditor(container);
  await flush(4);
  return { container, state };
}

/** The live project config's `style` block, which every setup() seeds. */
function style(): JxStyle {
  const current = projectState?.projectConfig?.style;
  if (!current) {
    throw new Error("the project config has no style block");
  }
  return current;
}

/** The `style` block of the project.json the platform was last handed. */
function writtenStyle(state: MockPlatformState): JsonObject {
  const text = state.files.get("project.json");
  if (text === undefined) {
    throw new Error("project.json was never written");
  }
  const config: JsonValue = JSON.parse(text);
  if (!isJsonObject(config) || !isJsonObject(config.style)) {
    throw new TypeError("project.json was written without a style object");
  }
  return config.style;
}

/** One nested block (`@--sm`, `@--dark`) of the written style, when it is an object. */
function writtenBlock(state: MockPlatformState, key: string): JsonObject | undefined {
  const block = writtenStyle(state)[key];
  return isJsonObject(block) ? block : undefined;
}

/** The group whose heading reads `title`. */
function groupByTitle(container: HTMLElement, title: string): HTMLElement {
  const group = [...container.querySelectorAll('[part="token-group"]')].find(
    (g) => g.querySelector('[part="group-title"]')?.textContent.trim() === title,
  );
  if (!(group instanceof HTMLElement)) {
    throw new Error(`no token group titled "${title}"`);
  }
  return group;
}

/** One token's block: its row, its preview and its overrides, addressed by the label on the row. */
function tokenByName(group: HTMLElement, displayName: string): HTMLElement {
  const token = [...group.querySelectorAll('[part="token"]')].find(
    (t) => t.querySelector('[part="name"]')?.textContent.trim() === displayName,
  );
  if (!(token instanceof HTMLElement)) {
    throw new Error(`no token row named "${displayName}"`);
  }
  return token;
}

/** The token block for a name in a group — the two lookups every assertion below starts with. */
function tokenIn(container: HTMLElement, groupTitle: string, name: string): HTMLElement {
  return tokenByName(groupByTitle(container, groupTitle), name);
}

/** The first native `<input>` under `root` matching `selector`. */
function nativeInput(root: ParentNode, selector: string): HTMLInputElement {
  const input = root.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError(`no <input> matches ${selector}`);
  }
  return input;
}

/** The native input inside a kit text field. */
function field(root: ParentNode, part: string): HTMLInputElement {
  return nativeInput(root, `[part="${part}"] [part="input"]`);
}

/** A token's colour well. */
function swatch(root: ParentNode): HTMLInputElement {
  return nativeInput(root, '[part="swatch-input"]');
}

/** Commit an edit into a kit text field, the way a reader does. */
async function commit(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await flush(4);
}

/** Type without committing — what the add row reads on every keystroke. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush(2);
}

/** Drag a colour well. */
async function paint(root: ParentNode, value: string): Promise<void> {
  const well = swatch(root);
  well.value = value;
  well.dispatchEvent(new Event("input", { bubbles: true }));
  await flush(4);
}

/** Fill a group's add row and press Add. */
async function addVar(group: HTMLElement, name: string, value: string): Promise<void> {
  await type(field(group, "add-name"), name);
  await type(field(group, "add-value"), value);
  pointer(group.querySelector('[part="add-button"] [part="control"]')!, "click");
  await flush(4);
}

/** The `[value, label]` pairs a token's add-an-override picker offers, placeholder excluded. */
function offered(token: HTMLElement): [string, string][] {
  return [...token.querySelectorAll('[part="add-picker"] option[part="option"]')].flatMap(
    (o): [string, string][] => {
      const value = o.getAttribute("value") ?? "";
      return value === "" ? [] : [[value, o.textContent.trim()]];
    },
  );
}

/** The native `<select>` of a token's add-an-override picker. */
function addPicker(token: HTMLElement): HTMLSelectElement {
  const select = token.querySelector('[part="add-picker"] select');
  if (!(select instanceof HTMLSelectElement)) {
    throw new TypeError("no add-override picker on this token");
  }
  return select;
}

/** Pick a context in a token's add-an-override picker. */
async function pickContext(token: HTMLElement, value: string): Promise<void> {
  const select = addPicker(token);
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await flush(4);
}

function texts(root: ParentNode, part: string): string[] {
  return [...root.querySelectorAll(`[part="${part}"]`)].map((n) => n.textContent.trim());
}

function baseStyle() {
  return {
    "--color-accent": "tomato",
    "--color-primary": "#007acc",
    "--font-body": "'Georgia', serif",
    "--radius-md": 8,
    "--shadow-soft": "0 1px 2px rgba(0,0,0,.2)",
    "--size-gap": "16px",
    "--spacing-lg": "32px",
    "@--sm": { "--size-gap": "8px" },
    color: "blue", // Not a custom property — skipped
    "--weird": { nested: true }, // Object value — skipped
  } satisfies JsonObject;
}

/** A platform whose every write is refused. */
const failing: Partial<StudioPlatform> = {
  writeFile: () => Promise.reject(new Error("EROFS: read-only file system")),
};

beforeEach(() => {
  resetWorkspaceWithTab();
});

afterEach(async () => {
  document.body.replaceChildren();
  await flush();
});

// ─── Grouping ────────────────────────────────────────────────────────────────

describe("css vars grouping", () => {
  test("vars are bucketed into Colors / Fonts / Sizes / Other", async () => {
    const { container } = await setup(baseStyle());
    expect(groupByTitle(container, "Colors").querySelectorAll('[part="token"]').length).toBe(2);
    expect(groupByTitle(container, "Fonts").querySelectorAll('[part="token"]').length).toBe(1);
    expect(
      groupByTitle(container, "Sizes & Spacing").querySelectorAll('[part="token"]').length,
    ).toBe(3);
    expect(groupByTitle(container, "Other").querySelectorAll('[part="token"]').length).toBe(1);
  });

  test("non-custom-property keys and object values are skipped", async () => {
    const { container } = await setup(baseStyle());
    const names = texts(container, "name");
    expect(names).not.toContain("color");
    expect(names).not.toContain("--weird");
  });

  test("Other group is omitted when empty", async () => {
    const { container } = await setup({ "--color-primary": "#fff" });
    expect(() => groupByTitle(container, "Other")).toThrow();
    expect(() => groupByTitle(container, "Colors")).not.toThrow();
  });

  test("renders with a missing project config without crashing", async () => {
    installMockPlatform();
    resetStudioState({ projectConfig: null });
    const container = document.createElement("div");
    document.body.append(container);
    expect(() => renderCssVarsEditor(container)).not.toThrow();
    await flush(4);
    expect(container.querySelectorAll('[part="token"]').length).toBe(0);
  });

  test("size, spacing and radius prefixes share a group, each row named by its real --name", async () => {
    const { container } = await setup(baseStyle());
    const names = texts(groupByTitle(container, "Sizes & Spacing"), "name");
    expect(names).toContain("--size-gap");
    expect(names).toContain("--spacing-lg");
    expect(names).toContain("--radius-md");
    // No friendly rewording stands in for the property: what the row says is what CSS reads.
    expect(names).not.toContain("Gap");
  });
});

// ─── Color section ───────────────────────────────────────────────────────────

describe("color section", () => {
  test("hex values seed the swatch color input; non-hex falls back", async () => {
    const { container } = await setup(baseStyle());
    const primary = swatch(tokenIn(container, "Colors", "--color-primary"));
    const accent = swatch(tokenIn(container, "Colors", "--color-accent"));
    expect(primary.value).toBe("#007acc");
    expect(accent.value).toBe("#3b82f6"); // Fallback for "tomato"
  });

  test("swatch input updates the var and persists", async () => {
    const { container, state } = await setup(baseStyle());
    await paint(tokenIn(container, "Colors", "--color-primary"), "#ff0000");
    expect(style()["--color-primary"]).toBe("#ff0000");
    expect(writtenStyle(state)["--color-primary"]).toBe("#ff0000");
    // The value field followed the well, which is what makes them one control rather than two.
    expect(field(tokenIn(container, "Colors", "--color-primary"), "value").value).toBe("#ff0000");
  });

  test("textfield change updates the var", async () => {
    const { container } = await setup(baseStyle());
    await commit(field(tokenIn(container, "Colors", "--color-accent"), "value"), "rebeccapurple");
    expect(style()["--color-accent"]).toBe("rebeccapurple");
  });

  test("delete removes the var and re-renders without the row", async () => {
    const { container, state } = await setup(baseStyle());
    const remove = tokenIn(container, "Colors", "--color-accent").querySelector(
      '[part="remove"] [part="control"]',
    )!;
    // The button is named after the token it deletes, not after the icon it draws.
    expect(remove.getAttribute("aria-label")).toBe("Delete --color-accent");
    pointer(remove, "click");
    await flush(4);
    expect(style()["--color-accent"]).toBeUndefined();
    expect(() => tokenIn(container, "Colors", "--color-accent")).toThrow();
    expect(writtenStyle(state)["--color-accent"]).toBeUndefined();
  });

  test("add row creates a slugged var; empty name or value is a no-op", async () => {
    const { container, state } = await setup(baseStyle());
    await addVar(groupByTitle(container, "Colors"), "Brand Green!", "#00aa55");
    expect(style()["--color-brand-green"]).toBe("#00aa55");
    expect(writtenStyle(state)["--color-brand-green"]).toBe("#00aa55");
    // A committed add empties the row it was typed into.
    expect(field(groupByTitle(container, "Colors"), "add-name").value).toBe("");

    const writes = state.calls.filter(([n]) => n === "writeFile").length;
    // A name that slugs to "" is refused, and so is an empty value.
    await addVar(groupByTitle(container, "Colors"), "$$$", "#123456");
    await addVar(groupByTitle(container, "Colors"), "Ghost", "");
    expect(state.calls.filter(([n]) => n === "writeFile").length).toBe(writes);
    expect(style()["--color-ghost"]).toBeUndefined();
  });

  test("a refused add keeps what was typed, so the reader can correct it", async () => {
    const { container } = await setup(baseStyle());
    const colors = groupByTitle(container, "Colors");
    await addVar(colors, "$$$", "#123456");
    /* The predecessor held these two values in the DOM through `ref()`, so a redraw emptied them.
       They are the section's state now, and a refusal leaves them where the reader can fix them. */
    expect(field(colors, "add-name").value).toBe("$$$");
    expect(field(colors, "add-value").value).toBe("#123456");

    /* And it survives the redraw nobody asked for. The half-typed values are the SECTION's state,
       not the field's, so an outside render — a nav click, an extension registering — re-derives
       them rather than writing an empty string over what the reader is still typing. */
    renderCssVarsEditor(container);
    await flush(4);
    expect(field(groupByTitle(container, "Colors"), "add-name").value).toBe("$$$");
    expect(field(groupByTitle(container, "Colors"), "add-value").value).toBe("#123456");
  });
});

// ─── Font section ────────────────────────────────────────────────────────────

describe("font section", () => {
  test("renders a preview line and updates on change", async () => {
    const { container } = await setup(baseStyle());
    const body = tokenIn(container, "Fonts", "--font-body");
    const preview = body.querySelector('[part="font-preview"]')!;
    expect(preview.textContent).toContain("quick brown fox");
    expect(getComputedStyle(preview).fontFamily).toContain("Georgia");

    await commit(field(body, "value"), "monospace");
    expect(style()["--font-body"]).toBe("monospace");
  });

  test("add row creates a font var", async () => {
    const { container } = await setup(baseStyle());
    await addVar(groupByTitle(container, "Fonts"), "Heading Sans", "system-ui");
    expect(style()["--font-heading-sans"]).toBe("system-ui");
  });
});

// ─── Size section + media overrides ──────────────────────────────────────────

describe("size section and media overrides", () => {
  const media = { "--": "1280px", "--sm": "(max-width: 600px)" };

  test("no declared context → no overrides UI at all, not even the add affordance", async () => {
    const { container } = await setup(baseStyle());
    expect(container.querySelector('[part="overrides"]')).toBeNull();
    expect(container.querySelector('[part="override-add"]')).toBeNull();
  });

  test("only the var with an @--sm entry shows an override ROW; the rest show only the add picker", async () => {
    const { container } = await setup(baseStyle(), media);
    const rows = [...container.querySelectorAll('[part="override"]')];
    expect(rows).toHaveLength(1); // Only --size-gap has an @--sm entry
    expect(rows[0]!.querySelector('[part="override-label"]')?.textContent).toBe("@--sm");

    /* Every OTHER token is now reachable too: the block exists for the add picker alone, which is
       the affordance that was missing — a token with no @media block could not be given one. */
    expect(container.querySelectorAll('[part="override-add"]').length).toBe(6);
  });

  test("changing an override writes into the media block and persists", async () => {
    const { container, state } = await setup(baseStyle(), media);
    await commit(
      field(tokenIn(container, "Sizes & Spacing", "--size-gap"), "override-value"),
      "12px",
    );
    expect(getNestedStyle(style(), "@--sm")?.["--size-gap"]).toBe("12px");
    expect(writtenBlock(state, "@--sm")?.["--size-gap"]).toBe("12px");
  });

  test("override change recreates a media block deleted after render", async () => {
    const { container } = await setup(baseStyle(), media);
    delete style()["@--sm"];
    await commit(
      field(tokenIn(container, "Sizes & Spacing", "--size-gap"), "override-value"),
      "10px",
    );
    expect(style()["@--sm"]).toEqual({ "--size-gap": "10px" });
  });

  test("size textfield change and add row work", async () => {
    const { container } = await setup(baseStyle(), media);
    const sizes = groupByTitle(container, "Sizes & Spacing");
    await commit(field(tokenByName(sizes, "--size-gap"), "value"), "20px");
    expect(style()["--size-gap"]).toBe("20px");

    await addVar(groupByTitle(container, "Sizes & Spacing"), "Gutter", "24px");
    expect(style()["--size-gutter"]).toBe("24px");
  });
});

// ─── Other section ───────────────────────────────────────────────────────────

describe("other section", () => {
  test("shows raw names, updates values, and supports media overrides", async () => {
    const { container } = await setup(
      { ...baseStyle(), "@--sm": { "--shadow-soft": "none", "--size-gap": "8px" } },
      { "--": "1280px", "--sm": "(max-width: 600px)" },
    );
    const other = groupByTitle(container, "Other");
    expect(texts(other, "name")).toEqual(["--shadow-soft"]);
    const shadow = tokenByName(other, "--shadow-soft");
    expect(shadow.querySelector('[part="overrides"]')).not.toBeNull();

    await commit(field(shadow, "value"), "none");
    expect(style()["--shadow-soft"]).toBe("none");

    pointer(
      tokenIn(container, "Other", "--shadow-soft").querySelector(
        '[part="remove"] [part="control"]',
      )!,
      "click",
    );
    await flush(4);
    expect(style()["--shadow-soft"]).toBeUndefined();
  });

  test("add row in Other uses the bare -- prefix", async () => {
    const { container } = await setup(baseStyle());
    await addVar(groupByTitle(container, "Other"), "Z Index Modal", "100");
    expect(style()["--z-index-modal"]).toBe("100");
  });
});

// ─── Scheme-aware color tokens (spec.md §9.5) ────────────────────────────────

describe("color scheme overrides", () => {
  const SCHEME_MEDIA = { "--dark": "(prefers-color-scheme: dark)" };

  test("scheme rows render per color token with the current override or an inherits placeholder", async () => {
    const { container } = await setup(
      { ...baseStyle(), "@--dark": { "--color-primary": "#111111" } },
      SCHEME_MEDIA,
    );
    const colors = groupByTitle(container, "Colors");
    const schemeRows = [...colors.querySelectorAll('[part="override"][data-kind="scheme"]')];
    // One Dark row per color token (accent + primary).
    expect(schemeRows).toHaveLength(2);
    expect(schemeRows[0]!.querySelector('[part="override-label"]')?.textContent.trim()).toBe(
      "Dark",
    );
    const values = schemeRows.map((r) => nativeInput(r, '[part="input"]').value);
    expect(values).toContain("#111111");
    expect(values).toContain("");
  });

  test("editing a scheme row writes the token into the @--dark block", async () => {
    const { container } = await setup(baseStyle(), SCHEME_MEDIA);
    await commit(
      field(tokenIn(container, "Colors", "--color-accent"), "override-value"),
      "#0a0a0a",
    );
    expect(getNestedStyle(style(), "@--dark")?.["--color-accent"]).toBe("#0a0a0a");
  });

  test("clearing a scheme override deletes the key and drops the emptied block", async () => {
    const { container } = await setup(
      { ...baseStyle(), "@--dark": { "--color-accent": "#0a0a0a" } },
      SCHEME_MEDIA,
    );
    await commit(field(tokenIn(container, "Colors", "--color-accent"), "override-value"), "");
    expect(style()["@--dark"]).toBeUndefined();
  });

  test("the scheme row's colour well writes into the scheme block, not into the base value", async () => {
    const { container } = await setup(
      { "--color-primary": "#007acc" },
      { "--dark": "(prefers-color-scheme: dark)" },
    );
    const well = nativeInput(
      container,
      '[part="override"][data-kind="scheme"] [part="swatch-input"]',
    );
    well.value = "#222222";
    well.dispatchEvent(new Event("input", { bubbles: true }));
    await flush(4);
    expect(getNestedStyle(style(), "@--dark")?.["--color-primary"]).toBe("#222222");
    expect(style()["--color-primary"]).toBe("#007acc");
  });

  test("a size token overridden in a SCHEME shows that row too — one override vocabulary", async () => {
    /* The predecessor filtered scheme queries out of the size group's media rows, so a
       `"@--dark": { "--size-gap": … }` written by hand was invisible in the form and survived
       every edit unseen. A context is a context: the row is labelled by its KIND ("Dark" vs the
       raw "@--sm"), not filtered by it. */
    const { container } = await setup(
      { ...baseStyle(), "@--dark": { "--size-gap": "4px" } },
      { "--dark": "(prefers-color-scheme: dark)", "--sm": "(max-width: 600px)" },
    );
    const gap = tokenIn(container, "Sizes & Spacing", "--size-gap");
    expect(texts(gap, "override-label")).toEqual(["Dark", "@--sm"]); // Schemes first, then breakpoints
    expect(gap.querySelectorAll('[part="override"][data-kind="scheme"]')).toHaveLength(1);
    // A size token's scheme row is a plain field — the colour well belongs to colour tokens.
    expect(gap.querySelector('[data-kind="scheme"] [part="swatch-input"]')).toBeNull();
  });

  test("with no scheme declared the section points at Contexts and defines nothing", async () => {
    /* This button used to APPEND `--dark: (prefers-color-scheme: dark)` to $media — the fourth and
       least discoverable of the four places a $media entry could be created, filed under
       "variables" and never using the word breakpoint. §7.4: this level overrides, the
       Contexts section defines. What replaced it can only NAVIGATE. */
    const { container } = await setup(baseStyle(), { "--sm": "(max-width: 600px)" });
    const colors = groupByTitle(container, "Colors");
    expect(colors.querySelectorAll('[part="override"][data-kind="scheme"]')).toHaveLength(0);
    const link = colors.querySelector('[part="manage"] [part="control"]')!;
    expect(link.textContent).toContain("Manage contexts");
    // Enabled, so the hint is the tip the kit button renders rather than a title.
    expect(hintOf(link)).toContain("Project Settings");
  });

  test("pressing it opens Project Settings on Contexts — it never defines one", async () => {
    /* The editor is hosted outside Settings (the Styles workspace's Variables view), so the link is
       the command, not a write to the section registry: a section chosen in a dialog that is not
       open would change nothing the reader can see. */
    const { createCommandRegistry } = await import("../src/commands/registry");
    const { emptyContext } = await import("../src/commands/context");
    const { setActiveRegistry } = await import("../src/commands/active-registry");
    const asked: unknown[] = [];
    const commands = createCommandRegistry({ getContext: emptyContext });
    commands.registerAll([
      {
        category: "Project",
        id: "settings.open",
        level: "application",
        menus: ["palette"],
        run: (_ctx, args) => {
          asked.push(args);
        },
        title: "Open Project Settings",
      },
    ]);
    setActiveRegistry(commands);
    try {
      const { container } = await setup(baseStyle(), { "--sm": "(max-width: 600px)" });
      pointer(
        groupByTitle(container, "Colors").querySelector('[part="manage"] [part="control"]')!,
        "click",
      );
      await flush(4);
      expect(asked).toEqual([{ section: "contexts" }]);
      expect(projectState?.projectConfig?.$media).toEqual({ "--sm": "(max-width: 600px)" });
    } finally {
      setActiveRegistry(null);
    }
  });
});

// ─── The add-an-override affordance (§7.4) ───────────────────────────────────

describe("adding an override", () => {
  const media = {
    "--": "1280px",
    "--dark": "(prefers-color-scheme: dark)",
    "--print": "print",
    "--sm": "(max-width: 600px)",
  };

  test("the picker offers every declared context the token has no value in, schemes first", async () => {
    const { container } = await setup(baseStyle(), media);
    // --size-gap already has @--sm, so only the scheme and the feature query remain.
    expect(offered(tokenIn(container, "Sizes & Spacing", "--size-gap"))).toEqual([
      ["--dark", "Dark"],
      ["--print", "@--print"],
    ]);
  });

  test("picking a context seeds the override from the base value and persists it", async () => {
    const { container, state } = await setup(baseStyle(), media);
    await pickContext(tokenIn(container, "Sizes & Spacing", "--spacing-lg"), "--sm");
    expect(getNestedStyle(style(), "@--sm")?.["--spacing-lg"]).toBe("32px");
    expect(writtenBlock(state, "@--sm")?.["--spacing-lg"]).toBe("32px");

    // The row it created is now editable, and the picker no longer offers that context.
    const token = tokenIn(container, "Sizes & Spacing", "--spacing-lg");
    expect(offered(token).map(([value]) => value)).not.toContain("--sm");
    expect(field(token, "override-value").value).toBe("32px");
    /* The picker went back to its placeholder. A binding writes only when what it read changed —
       so the row objects are rebuilt on every refresh, and the runtime then corrects any control
       whose live value has parted from the file. That is what `live()` did for the template. */
    expect(addPicker(token).value).toBe("");
  });

  test("a context name the picker does not offer is ignored rather than written", async () => {
    const { container } = await setup(baseStyle(), media);
    const gap = tokenIn(container, "Sizes & Spacing", "--size-gap");
    const select = addPicker(gap);
    // A context the picker never offered, asked for anyway: a stale row, or an extension.
    const injected = document.createElement("option");
    injected.value = "--nonesuch";
    select.append(injected);
    select.value = "--nonesuch";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(4);
    expect(getNestedStyle(style(), "@--sm")?.["--size-gap"]).toBe("8px");
    expect(style()["@--nonesuch"]).toBeUndefined();
  });

  test("a colour token's scheme rows are shown unprompted, so the picker offers only the rest", async () => {
    const { container } = await setup(baseStyle(), media);
    expect(offered(tokenIn(container, "Colors", "--color-accent")).map(([value]) => value)).toEqual(
      ["--sm", "--print"],
    );
  });

  test("a token with no value is not offered an override it could not carry", async () => {
    const { container } = await setup({ "--size-empty": "", "--size-gap": "16px" }, media);
    expect(
      tokenIn(container, "Sizes & Spacing", "--size-gap").querySelector('[part="add-picker"]'),
    ).not.toBeNull();
    expect(
      tokenIn(container, "Sizes & Spacing", "--size-empty").querySelector('[part="add-picker"]'),
    ).toBeNull();
  });

  test("clearing the last override drops the block, and the context returns to the picker", async () => {
    const { container } = await setup(
      { "--size-gap": "16px", "@--sm": { "--size-gap": "8px" } },
      media,
    );
    await commit(field(tokenIn(container, "Sizes & Spacing", "--size-gap"), "override-value"), "");
    expect(style()["@--sm"]).toBeUndefined();
    expect(offered(tokenIn(container, "Sizes & Spacing", "--size-gap")).map(([v]) => v)).toContain(
      "--sm",
    );
  });
});

// ─── Token references render as chips, not as raw var() text ─────────────────

describe("token reference chips", () => {
  test("an alias colour wears a chip naming its token, and its swatch resolves through it", async () => {
    const { container } = await setup({
      "--color-accent": "var(--color-brand)",
      "--color-brand": "#00aa55",
    });
    const accent = tokenIn(container, "Colors", "--color-accent");
    const chip = accent.querySelector('[part="chip"]')!;
    expect(chip.querySelector('[part="chip-label"]')?.textContent.trim()).toBe("--color-brand");
    expect(chip.getAttribute("title")).toBe("var(--color-brand) → #00aa55");
    expect(getComputedStyle(chip.querySelector('[part="chip-swatch"]')!).background).toContain(
      "#00aa55",
    );
    // The well shows the resolved colour rather than an empty square.
    expect(getComputedStyle(accent.querySelector('[part="well"]')!).background).toContain(
      "#00aa55",
    );
    expect(swatch(accent).value).toBe("#00aa55");
  });

  test("a chain of aliases resolves to the value at its end", async () => {
    const { container } = await setup({
      "--color-a": "var(--color-b)",
      "--color-b": "var(--color-c)",
      "--color-c": "#123456",
    });
    expect(
      tokenIn(container, "Colors", "--color-a")
        .querySelector('[part="chip"]')
        ?.getAttribute("title"),
    ).toBe("var(--color-b) → #123456");
  });

  test("a reference that leads nowhere says so instead of inventing a value", async () => {
    const { container } = await setup({ "--size-gap": "var(--size-missing)" });
    const gap = tokenIn(container, "Sizes & Spacing", "--size-gap");
    expect(gap.querySelector('[part="chip"]')?.getAttribute("title")).toBe(
      "var(--size-missing) → unresolved",
    );
    expect(gap.querySelector('[part="chip-swatch"]')).toBeNull(); // Not a colour group
  });

  test("a plain value wears no chip", async () => {
    const { container } = await setup(baseStyle());
    expect(container.querySelector('[part="chip"]')).toBeNull();
  });
});

// ─── A write that fails says so (§17.1) ──────────────────────────────────────

describe("a refused write", () => {
  test("is reported under the title rather than dropped on the floor", async () => {
    const { container } = await setup(baseStyle(), undefined, failing);
    await commit(field(tokenIn(container, "Colors", "--color-accent"), "value"), "rebeccapurple");
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Could not save project.json");
    /* The predecessor `void`ed the rejection, so a read-only project.json took every edit and kept
       none of them in silence. The edit is still true of the model the canvas is drawn from — what
       failed is the file, and that is what the sentence says. */
    expect(style()["--color-accent"]).toBe("rebeccapurple");
  });

  test("and the message clears once a write lands", async () => {
    const { container } = await setup(baseStyle(), undefined, failing);
    await commit(field(tokenIn(container, "Colors", "--color-accent"), "value"), "rebeccapurple");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    installMockPlatform();
    await commit(field(tokenIn(container, "Colors", "--color-accent"), "value"), "teal");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

// ─── Pointed at from the Outline (§7.1) ──────────────────────────────────────

describe("pointing the editor at a token", () => {
  /** The token block for a custom property, by the property it names. */
  function byName(container: HTMLElement, name: string): HTMLElement {
    const found = [...container.querySelectorAll<HTMLElement>('[part="token"]')].find(
      (el) => el.dataset["token"] === name,
    );
    if (!found) {
      throw new Error(`no token row for ${name}`);
    }
    return found;
  }

  test("marks the token's row, scrolls it into view and puts the keyboard on its value", async () => {
    const { container } = await setup(baseStyle());
    const scrolled: string[] = [];
    const row = byName(container, "--size-gap");
    row.scrollIntoView = () => {
      scrolled.push("--size-gap");
    };
    focusCssVar(container, "--size-gap");
    await flush(4);
    expect(byName(container, "--size-gap").getAttribute("aria-current")).toBe("true");
    expect(byName(container, "--color-accent").getAttribute("aria-current")).toBeNull();
    expect(scrolled).toEqual(["--size-gap"]);
    expect(row.querySelector('[part="value"]')?.contains(document.activeElement)).toBe(true);
  });

  test("reveal: false marks the row and leaves the keyboard where it was", async () => {
    const { container } = await setup(baseStyle());
    const row = byName(container, "--color-accent");
    let scrolled = false;
    row.scrollIntoView = () => {
      scrolled = true;
    };
    focusCssVar(container, "--color-accent", { reveal: false });
    await flush(4);
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(scrolled).toBe(false);
  });

  test("a name the project does not declare marks nothing, and null clears the mark", async () => {
    const { container } = await setup(baseStyle());
    focusCssVar(container, "--nowhere");
    await flush(4);
    expect(container.querySelector('[part="token"][aria-current="true"]')).toBeNull();
    focusCssVar(container, "--color-accent", { reveal: false });
    await flush(2);
    focusCssVar(container, null);
    await flush(2);
    expect(container.querySelector('[part="token"][aria-current="true"]')).toBeNull();
  });
});

describe("revealing a token row (the surface's half)", () => {
  test("a host with no surface moves nothing", async () => {
    const stray = document.createElement("div");
    document.body.append(stray);
    expect(() => {
      revealCssVarsToken(stray, "--color-accent");
    }).not.toThrow();
    await flush(2);
    expect(stray.childElementCount).toBe(0);
  });

  test("a surface taken out of the document before the turn moves nothing", async () => {
    const { container } = await setup(baseStyle());
    const scrolled: string[] = [];
    const markScrolled = (name: string) => () => {
      scrolled.push(name);
    };
    for (const row of container.querySelectorAll<HTMLElement>('[part="token"]')) {
      row.scrollIntoView = markScrolled(row.dataset["token"] ?? "");
    }
    revealCssVarsToken(container, "--color-accent");
    container.remove();
    await flush(4);
    expect(scrolled).toEqual([]);
  });
});

// ─── The section's own part names stay its own ───────────────────────────────

describe("the section's style rules reach only its own nodes", () => {
  test("no rule names a part that a kit element drawn here carries inside it", async () => {
    // The kit is light DOM, so `& [part="preview"]` (the font specimen's rule) also reached the
    // Add override picker's own closed-state value: a 36px picker under every 20px field.
    const { container } = await setup(baseStyle(), {
      "--": "1280px",
      "--sm": "(max-width: 600px)",
    });
    const kitParts = new Set<string>();
    for (const el of container.querySelectorAll("*")) {
      if (el.localName.startsWith("jx-")) {
        for (const inner of el.querySelectorAll("[part]")) {
          kitParts.add(inner.getAttribute("part") ?? "");
        }
      }
    }
    // The picker is drawn, so the name that collided is among the kit's.
    expect(kitParts.has("preview")).toBe(true);
    const { default: doc } = await import("../src/surfaces/settings-css-vars.json");
    const ruled = Object.keys(doc.style).flatMap((selector) =>
      [...selector.matchAll(/\[part="([^"]+)"\]/g)].map((match) => match[1] ?? ""),
    );
    expect(ruled).toContain("well");
    expect(ruled.filter((part) => kitParts.has(part))).toEqual([]);
  });
});
