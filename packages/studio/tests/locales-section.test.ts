/**
 * Tests for the Locales settings section — `src/settings/locales-section.ts`, the flow, and
 * `src/surfaces/settings-locales.json`, the document it mounts.
 *
 * Every write is asserted TWICE: against the live config and against `project.json` as it was
 * serialized. The two can disagree — `commitProjectConfig` merges at the top level only — and the
 * failure mode that matters here is a patch that lands in memory having quietly dropped
 * `defaultLocale` or `routing` from the file.
 *
 * Everything is addressed by `part`, because the section is a document: there is no
 * `.settings-locale-tag` or `.settings-field-error` to find any more. The refusal under the tag
 * field is `jx-textfield`'s own `error` sentence and the two pickers are `jx-select`s, so a
 * reader's edit is performed on the NATIVE control inside each element — writing the host's
 * property instead would move a control no reader can move.
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { projectState } from "../src/store";
import {
  addProjectLocale,
  LOCALE_ROUTINGS,
  renderLocalesSection,
} from "../src/settings/locales-section";
import { clearProblems, problems, toasts } from "../src/services/notify";
import type { MockPlatformState } from "./harness";
import type { StudioPlatform } from "../src/types";

type AnyConfig = Record<string, any>;

/**
 * Draw the section into a fresh container and let the surface mount.
 *
 * Two flushes rather than one: `mountSurface` settles when the DOCUMENT has rendered, and each kit
 * element's own template is one `connectedCallback` later — so a single turn finds `jx-textfield`
 * with no `input` inside it.
 */
async function setup(
  cfg: AnyConfig | null,
  overrides: Partial<StudioPlatform> = {},
): Promise<{ container: HTMLElement; state: MockPlatformState }> {
  const { state } = installMockPlatform(overrides);
  resetStudioState({ projectConfig: cfg as unknown });
  const container = document.createElement("div");
  document.body.append(container);
  renderLocalesSection(container);
  await flush(4);
  return { container, state };
}

function config(): AnyConfig {
  return (projectState as AnyConfig).projectConfig;
}

function written(state: MockPlatformState): AnyConfig {
  return JSON.parse(state.files.get("project.json")!) as AnyConfig;
}

/** The refusal drawn under the tag field — the kit's own error sentence, permanently present. */
function refusal(container: HTMLElement): string {
  return container.querySelector('[part="add-field"] [part="error"]')?.textContent?.trim() ?? "";
}

/** The whole-file write failure, said under the section title rather than beside a control. */
function alertText(container: HTMLElement): string | undefined {
  return container.querySelector('[role="alert"]')?.textContent?.trim();
}

/** The tag field's native control, which is where a reader types. */
function tagInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('[part="add-field"] [part="input"]') as HTMLInputElement;
}

/** Type into the add field, the way the author does. */
async function typeTag(container: HTMLElement, value: string): Promise<void> {
  const input = tagInput(container);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush(2);
}

/** Press Add. */
function pressAdd(container: HTMLElement): void {
  pointer(container.querySelector('[part="add-button"]')!, "click");
}

/** Pick a value in one of the two pickers, from the native control the reader operates. */
async function pick(container: HTMLElement, part: string, value: string): Promise<void> {
  const select = container.querySelector(`[part="${part}"] select`) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await flush(4);
}

/** The `[value, label]` pairs a picker offers. */
function options(container: HTMLElement, part: string): [string, string][] {
  return [...container.querySelectorAll(`[part="${part}"] option[part="option"]`)].map((o) => [
    o.getAttribute("value") ?? "",
    o.textContent?.trim() ?? "",
  ]);
}

function texts(container: HTMLElement, part: string): (string | null)[] {
  return [...container.querySelectorAll(`[part="${part}"]`)].map((n) => n.textContent);
}

/** A platform whose every write is refused. */
const failing = {
  writeFile: () => Promise.reject(new Error("EROFS: read-only file system")),
} as unknown as Partial<StudioPlatform>;

beforeEach(() => {
  resetWorkspaceWithTab();
  toasts.length = 0;
  clearProblems();
});

afterEach(async () => {
  document.body.replaceChildren();
  await flush();
});

describe("the Locales section", () => {
  test("lists each declared language by its own name, beside its tag", async () => {
    const { container } = await setup({ i18n: { defaultLocale: "en", locales: ["en", "fr"] } });
    expect(texts(container, "name")).toEqual(["English", "français"]);
    expect(texts(container, "tag")).toEqual(["en", "fr"]);
  });

  test("a project with no i18n block is the empty case, not a crash", async () => {
    const { container } = await setup({});
    expect(container.querySelector('[part="empty"]')?.textContent).toContain("No languages");
    // Nothing to choose between, said to the control rather than only drawn.
    expect((container.querySelector('[part="default"] select') as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect((container.querySelector('[part="routing"] select') as HTMLSelectElement).disabled).toBe(
      true,
    );
  });

  test("Add appends the canonical tag to the live config and to project.json", async () => {
    const { container, state } = await setup({ i18n: { locales: ["en"] } });
    await typeTag(container, "  FR-ca  ");
    pressAdd(container);
    await flush(4);
    expect(config().i18n.locales).toEqual(["en", "fr-CA"]);
    expect(written(state).i18n.locales).toEqual(["en", "fr-CA"]);
    // The row reconciles in place, and the field it was typed in is empty again.
    expect(texts(container, "tag")).toEqual(["en", "fr-CA"]);
    expect(tagInput(container).value).toBe("");
  });

  test("Enter in the field adds it too", async () => {
    const { container } = await setup({ i18n: { locales: ["en"] } });
    await typeTag(container, "de");
    tagInput(container).dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    await flush(4);
    expect(config().i18n.locales).toEqual(["en", "de"]);
  });

  test("the sibling keys survive the add — the merge is top-level only", async () => {
    const { container, state } = await setup({
      i18n: { defaultLocale: "en", locales: ["en"], routing: "prefix-always" },
    });
    await typeTag(container, "fr");
    pressAdd(container);
    await flush(4);
    expect(written(state).i18n).toEqual({
      defaultLocale: "en",
      locales: ["en", "fr"],
      routing: "prefix-always",
    });
  });

  test("a malformed tag is refused with words and writes nothing", async () => {
    const { container, state } = await setup({ i18n: { locales: ["en"] } });
    await typeTag(container, "en_US");
    expect(refusal(container)).toContain("not a well-formed language tag");
    pressAdd(container);
    await flush(4);
    expect(config().i18n.locales).toEqual(["en"]);
    expect(state.files.has("project.json")).toBe(false);
  });

  test("a tag already declared says so and is not added twice", async () => {
    const { container, state } = await setup({ i18n: { locales: ["en"] } });
    await typeTag(container, "EN");
    expect(refusal(container)).toContain("already declared");
    pressAdd(container);
    await flush(4);
    expect(config().i18n.locales).toEqual(["en"]);
    expect(state.files.has("project.json")).toBe(false);
  });

  test("a blank field adds nothing and says nothing", async () => {
    const { container, state } = await setup({ i18n: { locales: ["en"] } });
    await typeTag(container, "   ");
    expect(refusal(container)).toBe("");
    pressAdd(container);
    await flush(4);
    expect(state.files.has("project.json")).toBe(false);
  });

  test("the refusal goes away when the tag becomes one this project can take", async () => {
    const { container } = await setup({ i18n: { locales: ["en"] } });
    await typeTag(container, "en_US");
    expect(refusal(container)).not.toBe("");
    /* The whole point of a live verdict: the sentence follows the word being typed, and the field
       it describes keeps the caret because the document writes back the value it already holds. */
    await typeTag(container, "en-US");
    expect(refusal(container)).toBe("");
    expect(tagInput(container).value).toBe("en-US");
  });

  test("removing a language keeps the rest and the block", async () => {
    const { container, state } = await setup({
      i18n: { defaultLocale: "en", locales: ["en", "fr", "de"] },
    });
    pointer(container.querySelector('[title="Remove fr"]')!, "click");
    await flush(4);
    expect(config().i18n.locales).toEqual(["en", "de"]);
    expect(written(state).i18n.defaultLocale).toBe("en");
  });

  test("removing the default language moves the default rather than orphaning it", async () => {
    const { container, state } = await setup({
      i18n: { defaultLocale: "en", locales: ["en", "fr"] },
    });
    pointer(container.querySelector('[title="Remove en"]')!, "click");
    await flush(4);
    // Left alone, `resolveI18n` would unshift "en" back into the list and the removal would do
    // Nothing at all.
    expect(written(state).i18n).toEqual({ defaultLocale: "fr", locales: ["fr"] });
  });

  test("removing the last language removes the whole block", async () => {
    const { container, state } = await setup({
      i18n: { defaultLocale: "fr", locales: ["fr"], routing: "prefix-always" },
    });
    pointer(container.querySelector('[title="Remove fr"]')!, "click");
    await flush(4);
    expect(config().i18n).toBeUndefined();
    expect("i18n" in written(state)).toBe(false);
    expect(container.querySelector('[part="empty"]')).not.toBeNull();
  });

  test("the default picker offers the declared list and persists a choice", async () => {
    const { container, state } = await setup({ i18n: { locales: ["en", "fr"] } });
    expect(options(container, "default")).toEqual([
      ["en", "English"],
      ["fr", "français"],
    ]);
    await pick(container, "default", "fr");
    expect(config().i18n.defaultLocale).toBe("fr");
    expect(written(state).i18n).toEqual({ defaultLocale: "fr", locales: ["en", "fr"] });
  });

  test("the routing picker offers both modes and persists a choice", async () => {
    const { container, state } = await setup({
      i18n: { defaultLocale: "en", locales: ["en", "fr"] },
    });
    expect(options(container, "routing").map(([value]) => value)).toEqual(
      LOCALE_ROUTINGS.map((r) => r.value),
    );
    await pick(container, "routing", "prefix-always");
    expect(config().i18n.routing).toBe("prefix-always");
    expect(written(state).i18n.defaultLocale).toBe("en");
  });

  test("a rejected write is shown under the title instead of being dropped", async () => {
    const { container } = await setup({ i18n: { locales: ["en", "fr"] } }, failing);
    pointer(container.querySelector('[title="Remove fr"]')!, "click");
    await flush(4);
    expect(alertText(container)).toContain("EROFS: read-only file system");
    /* Not inside a field: the whole file failed to save, so the message belongs under the title
       rather than pinned to one control — which is what `jx-textfield`'s own `error` is for. */
    expect(container.querySelector('[role="alert"]')!.closest("jx-field")).toBeNull();
  });

  test("a later success clears the parked error", async () => {
    const { container, state } = await setup({ i18n: { locales: ["en", "fr"] } }, failing);
    pointer(container.querySelector('[title="Remove fr"]')!, "click");
    await flush(4);
    expect(alertText(container)).not.toBeUndefined();

    /* The failed remove still landed in MEMORY — `commitProjectConfig` mutates and then writes, so
       the parked error is the only thing telling the author that the file disagrees. */
    expect(config().i18n.locales).toEqual(["en"]);

    const { state: writable } = installMockPlatform();
    await typeTag(container, "de");
    pressAdd(container);
    await flush(4);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(config().i18n.locales).toEqual(["en", "de"]);
    expect(written(writable).i18n.locales).toEqual(["en", "de"]);
    expect(state.files.has("project.json")).toBe(false);
  });

  test("a container emptied under the section is drawn into again, not left blank", async () => {
    const { container } = await setup({ i18n: { locales: ["en"] } });
    /* What a pane rebuilding its body does. The mounted document is gone but the container is the
       same one, so the section has to notice its own root has left rather than assign into a scope
       nothing is reading. */
    container.replaceChildren();
    renderLocalesSection(container);
    await flush(4);
    expect(texts(container, "tag")).toEqual(["en"]);
  });

  test("a second draw into the same container keeps what is typed in it", async () => {
    const { container } = await setup({ i18n: { locales: ["en"] } });
    await typeTag(container, "fr");
    renderLocalesSection(container);
    await flush(4);
    expect(tagInput(container).value).toBe("fr");
    // And a fresh container is a fresh form, because both are keyed by the container.
    const second = document.createElement("div");
    document.body.append(second);
    renderLocalesSection(second);
    await flush(4);
    expect(tagInput(second).value).toBe("");
  });
});

describe("addProjectLocale — the write both doors make", () => {
  test("declares the first language of a project that had no i18n block", async () => {
    const { state } = installMockPlatform();
    resetStudioState({ projectConfig: {} });
    await addProjectLocale("pt-br");
    expect(config().i18n).toEqual({ locales: ["pt-BR"] });
    expect(written(state).i18n.locales).toEqual(["pt-BR"]);
  });

  test("spreads the parent, so defaultLocale and routing survive", async () => {
    const { state } = installMockPlatform();
    resetStudioState({
      projectConfig: { i18n: { defaultLocale: "en", locales: ["en"], routing: "prefix-always" } },
    });
    await addProjectLocale("fr");
    expect(written(state).i18n).toEqual({
      defaultLocale: "en",
      locales: ["en", "fr"],
      routing: "prefix-always",
    });
  });

  test("a malformed tag is notified, never written", async () => {
    const { state } = installMockPlatform();
    resetStudioState({ projectConfig: { i18n: { locales: ["en"] } } });
    await addProjectLocale("en US");
    expect(config().i18n.locales).toEqual(["en"]);
    expect(state.files.has("project.json")).toBe(false);
    // `error` files a Problem rather than a toast — a refusal that must be fixed, not one that
    // Rests and fades.
    expect(problems.some((p) => p.message.includes("not a well-formed language tag"))).toBe(true);
  });

  test("a tag already declared in another case is a no-op that says so", async () => {
    const { state } = installMockPlatform();
    resetStudioState({ projectConfig: { i18n: { locales: ["FR-ca"] } } });
    await addProjectLocale("fr-CA");
    expect(config().i18n.locales).toEqual(["FR-ca"]);
    expect(state.files.has("project.json")).toBe(false);
    expect(toasts.some((t) => t.message.includes("already one of this project's"))).toBe(true);
  });

  test("a failed write rejects, so a caller can park it on the control that caused it", async () => {
    installMockPlatform(failing);
    resetStudioState({ projectConfig: { i18n: { locales: ["en"] } } });
    expect(addProjectLocale("fr")).rejects.toThrow(/EROFS/);
  });
});
