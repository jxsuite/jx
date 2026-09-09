/**
 * Tests for src/settings/contributed-section.ts — the generic renderer for `$studio.settings`
 * sections: form layout (schema form over the whole section value) and map layout (master-detail
 * with add/rename/delete, slugified keys, and newEntry templates), both persisting through
 * projectState.projectConfig + platform.writeFile("project.json", …).
 *
 * **The section is a Jx document now** (`src/surfaces/settings-contributed.json`), so four things
 * about this file are deliberate rather than incidental:
 *
 * - The container is APPENDED TO THE DOCUMENT. A kit element renders in `connectedCallback`, so a
 *   detached container gets `<jx-textfield>` tags with nothing inside them, and every assertion
 *   about a control would read `null` — a failure that looks like a missing element rather than a
 *   missing connection.
 * - Rendering is awaited. `renderContributedSection` still returns void, as the registry's
 *   `render(container)` seam requires, and mounting is asynchronous underneath it; {@link settle}
 *   is the one place that knows how long that takes.
 * - Nothing is addressed by a CSS class. The section's own chrome is addressed by `part`, an entry
 *   row by its `data-entry` key, and the two rows the screenshot pipeline photographs by the
 *   `data-jx-region` they carry.
 * - The SCHEMA FORM is still lit over Spectrum (`src/ui/schema-form.ts`), and this document renders
 *   an empty `[part="form-host"]` for it. So `.style-row`, `[data-prop=…]` and `sp-checkbox` are
 *   still the right way to reach a field: they belong to the island, not to this surface.
 *
 * What the surface added, and what these pin as behaviour rather than markup: a refused rename now
 * puts the on-disk key back in the field (the scope moves, where the lit handler assigned to
 * `target.value`), and the new-entry name survives a redraw that arrives mid-typing.
 */
import { flush, installMockPlatform, key, pointer, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { html } from "lit-html";
import { registerFormControl, resetSchemaForms } from "../src/ui/schema-form";
import { projectState } from "../src/store";
import type { MockPlatformState } from "./harness";
import type { SettingsContribution } from "../src/settings/contributed-section";

/** What the mocked project validator returns (or throws) on the next call. */
let validatorResult: string[] | Error = [];
void mock.module("../src/services/jx-validate.js", () => ({
  applyProjectSchemas: () => {},
  resetProjectSchemas: () => {},
  validateDoc: async () => [],
  validateProjectConfig: async () => {
    if (validatorResult instanceof Error) {
      // eslint-disable-next-line no-throw-literal -- validatorResult IS an Error on this branch
      throw validatorResult as Error;
    }
    return validatorResult;
  },
}));

const {
  renderContributedSection,
  resetContributedDiagnostics,
  resetContributedSectionState,
  routeDiagnostics,
} = await import("../src/settings/contributed-section");
const { mountContributedSurface } = await import("../src/surfaces/settings-contributed");
const { problems, resetNotifications } = await import("../src/services/notify");

/**
 * Let the document catch up.
 *
 * Generous on purpose, and in one place: the mount awaits the kit's registration, each kit element
 * builds its own scope asynchronously in `connectedCallback`, the schema form is rendered into the
 * host node the document announces, and a write goes through a commit before the file is on disk.
 */
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

/** The native control a kit element wraps: a field's input, or a select's select. */
function control(el: Element): HTMLInputElement {
  const inner = el.querySelector<HTMLInputElement>(
    'input[part="input"], textarea[part="input"], select[part="control"]',
  );
  if (!inner) {
    throw new Error(`no native control inside <${el.tagName.toLowerCase()}>`);
  }
  return inner;
}

/** One field of the schema form — its own island, addressed by the property it edits. */
function field(root: ParentNode, prop: string): HTMLElement {
  const el = root.querySelector(`[data-prop="${prop}"]`);
  if (!el) {
    throw new Error(`the form has no field for "${prop}"`);
  }
  return el as HTMLElement;
}

/**
 * The message under one field, or `""`.
 *
 * `[part="error-slot"]` and not `[part="error"]`: a kit textfield carries an error part of its own,
 * so the second selector finds the CONTROL's empty one on every field whether or not anything is
 * wrong.
 */
function fieldError(root: ParentNode, prop: string): string {
  return field(root, prop).querySelector('[part="error-slot"]')?.textContent?.trim() ?? "";
}

/** Tick a checkbox the way a reader does. */
function tick(el: Element, checked: boolean): void {
  const inner = control(el);
  inner.checked = checked;
  inner.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Type into a kit control and commit it, the way a reader does: `input` as each character lands,
 * and then the event that commits it. A kit field mirrors `input` into its own state and hears
 * nothing from `change`, so a test that fired only the commit would leave the element believing it
 * still holds the old text.
 */
function setAndFire(el: Element, value: string, type = "change"): void {
  const inner = control(el);
  inner.value = value;
  inner.dispatchEvent(new Event("input", { bubbles: true }));
  if (type !== "input") {
    inner.dispatchEvent(new Event(type, { bubbles: true }));
  }
}

/** What a kit control currently shows. */
function shows(el: Element): string {
  return control(el).value;
}

/** The entry keys the left column is offering, in order. */
function entryKeys(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-entry]")].map(
    (el) => (el as HTMLElement).dataset.entry ?? "",
  );
}

/** Click one entry row and let the editor arrive. */
async function selectEntry(container: HTMLElement, name: string): Promise<void> {
  const row = container.querySelector(`[data-entry="${name}"]`);
  if (!row) {
    throw new Error(`no entry row for "${name}"`);
  }
  pointer(row, "click");
  await settle();
}

function config(): Record<string, unknown> {
  return projectState!.projectConfig as unknown as Record<string, unknown>;
}

/** Project.json writes captured by the mock platform. */
function projectWrites(state: MockPlatformState): string[] {
  return state.calls
    .filter((c) => c[0] === "writeFile" && c[1] === "project.json")
    .map((c) => c[2] as string);
}

let platformState: MockPlatformState;
let container: HTMLElement;

beforeEach(() => {
  validatorResult = [];
  resetContributedDiagnostics();
  resetContributedSectionState();
  /* The schema form is a standing mount keyed by name (`ui/schema-form.ts`), and a key that is
     asked for again is exempt from its own sweep — so without this, one test's form is handed to
     the next with the previous test's host detached under it. */
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
  document.body.replaceChildren();
});

// ─── Form layout ─────────────────────────────────────────────────────────────

const formContribution: SettingsContribution = {
  entrySchema: {
    properties: {
      enabled: { type: "boolean" },
      id: { type: "string" },
      mode: { enum: ["auto", "manual"] },
    },
  },
  key: "analytics",
  settings: { layout: "form" },
  title: "Analytics",
};

describe("form layout", () => {
  test("renders the title and one form over the section value", async () => {
    renderContributedSection(container, formContribution);
    await settle();
    expect(part(container, "title").textContent).toBe("Analytics");
    expect(part(container, "form-host").querySelectorAll("[data-prop]")).toHaveLength(3);
    expect(field(container, "enabled").querySelector('[part="checkbox"]')).not.toBeNull();
    expect(field(container, "mode").querySelector('[part="select"]')).not.toBeNull();
    // A form layout has no master-detail chrome at all.
    expect(container.querySelector('[part="columns"]')).toBeNull();
  });

  test("title falls back to the section key", async () => {
    renderContributedSection(container, { ...formContribution, title: undefined });
    await settle();
    expect(part(container, "title").textContent).toBe("analytics");
  });

  test("edits mutate projectConfig[key] and persist via writeFile", async () => {
    renderContributedSection(container, formContribution);
    await settle();
    tick(part(field(container, "enabled"), "checkbox"), true);
    await settle();

    expect(config().analytics).toEqual({ enabled: true });
    const writes = projectWrites(platformState);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!)).toMatchObject({ analytics: { enabled: true } });
  });

  test("undefined patches unset keys; the form rerenders with current values", async () => {
    config().analytics = { mode: "auto" };
    renderContributedSection(container, formContribution);
    await settle();
    const picker = part(field(container, "mode"), "select");
    expect(shows(picker)).toBe("auto");
    setAndFire(picker, "__none__");
    await settle();
    expect(config().analytics).toEqual({});
    expect(projectWrites(platformState)).toHaveLength(1);
  });

  test("entry.ui control overrides apply to the form", async () => {
    registerFormControl(
      "stub-section-control",
      ({ key: prop }) => html`<div class="stub-section-control">${prop}</div>`,
    );
    renderContributedSection(container, {
      ...formContribution,
      settings: { entry: { ui: { id: { control: "stub-section-control" } } }, layout: "form" },
    });
    await settle();
    expect(container.querySelector(".stub-section-control")?.textContent).toBe("id");
  });

  test("renders without a project config and drops edits silently", async () => {
    resetStudioState({ projectConfig: null });
    renderContributedSection(container, formContribution);
    await settle();
    tick(part(field(container, "enabled"), "checkbox"), true);
    await settle();
    expect(projectWrites(platformState)).toHaveLength(0);
  });
});

// ─── Map layout ──────────────────────────────────────────────────────────────

const mapContribution: SettingsContribution = {
  entrySchema: {
    properties: {
      label: { type: "string" },
      provider: { enum: ["d1", "sqlite"] },
    },
  },
  key: "connections",
  settings: {
    entry: {
      newEntry: { label: "${key} connection", nested: { source: "./data/${key}" }, provider: "d1" },
    },
    layout: "map",
  },
  title: "Connections",
};

describe("map layout", () => {
  test("lists entry keys on the left with an empty state until one is selected", async () => {
    renderContributedSection(container, mapContribution);
    await settle();
    expect(entryKeys(container)).toEqual(["main"]);
    expect(part(container, "empty").textContent).toContain("Select or create an entry");
    expect(container.querySelector('[part="editor"]')).toBeNull();
  });

  test("an entry row and the editor carry the region a shot names them by", async () => {
    renderContributedSection(container, mapContribution);
    await settle();
    expect((container.querySelector('[data-entry="main"]') as HTMLElement).dataset.jxRegion).toBe(
      "pane.primary/entry:main",
    );
    await selectEntry(container, "main");
    expect(part(container, "editor").dataset.jxRegion).toBe("pane.primary/editor");
  });

  test("selecting an entry renders its form; edits persist to the entry", async () => {
    renderContributedSection(container, mapContribution);
    await settle();
    await selectEntry(container, "main");
    expect(container.querySelector('[part="editor"]')).not.toBeNull();

    const picker = part(field(container, "provider"), "select");
    expect(shows(picker)).toBe("d1");
    setAndFire(picker, "sqlite");
    await settle();

    expect(config().connections).toEqual({ main: { provider: "sqlite" } });
    expect(projectWrites(platformState)).toHaveLength(1);
  });

  test("creates slugified entries from the newEntry template with ${key} substitution", async () => {
    renderContributedSection(container, mapContribution);
    await settle();
    pointer(part(container, "new-open"), "click");
    await settle();

    setAndFire(part(container, "new-field"), "My DB!", "input");
    await settle();
    pointer(part(container, "new-create"), "click");
    await settle();

    expect((config().connections as Record<string, unknown>)["my-db"]).toEqual({
      label: "my-db connection",
      nested: { source: "./data/my-db" },
      provider: "d1",
    });
    // The new entry is selected and editable
    expect(shows(part(container, "entry-name"))).toBe("my-db");
    expect(projectWrites(platformState)).toHaveLength(1);
  });

  test("Enter creates, Escape closes, blanks and duplicates are ignored", async () => {
    renderContributedSection(container, mapContribution);
    await settle();
    pointer(part(container, "new-open"), "click");
    await settle();
    const nameField = () => part(container, "new-field");

    setAndFire(nameField(), "!!!", "input");
    await settle();
    key(control(nameField()), "Enter");
    await settle();
    expect(Object.keys(config().connections as Record<string, unknown>)).toEqual(["main"]);

    setAndFire(nameField(), "main", "input");
    await settle();
    key(control(nameField()), "Enter");
    await settle();
    expect(Object.keys(config().connections as Record<string, unknown>)).toEqual(["main"]);

    key(control(nameField()), "Escape");
    await settle();
    expect(container.querySelector('[part="new-field"]')).toBeNull();

    pointer(part(container, "new-open"), "click");
    await settle();
    setAndFire(nameField(), "Backup Store", "input");
    await settle();
    key(control(nameField()), "Enter");
    await settle();
    expect(Object.keys(config().connections as Record<string, unknown>)).toEqual([
      "main",
      "backup-store",
    ]);
  });

  test("the half-typed new-entry name survives a redraw that arrives mid-typing", async () => {
    renderContributedSection(container, mapContribution);
    await settle();
    pointer(part(container, "new-open"), "click");
    await settle();
    setAndFire(part(container, "new-field"), "part-typ", "input");
    await settle();

    // Something else redraws the section — an extension registering, a validator returning.
    renderContributedSection(container, mapContribution);
    await settle();
    expect(shows(part(container, "new-field"))).toBe("part-typ");
  });

  test("renames slugify, preserve entry order, and skip collisions", async () => {
    config().connections = { alpha: { provider: "d1" }, beta: { provider: "sqlite" } };
    renderContributedSection(container, mapContribution);
    await settle();
    await selectEntry(container, "alpha");

    setAndFire(part(container, "entry-name"), "Primary DB");
    await settle();
    expect(Object.keys(config().connections as Record<string, unknown>)).toEqual([
      "primary-db",
      "beta",
    ]);
    expect(projectWrites(platformState)).toHaveLength(1);
    expect(entryKeys(container)).toEqual(["primary-db", "beta"]);
  });

  test("a refused rename puts the key on disk back in the field", async () => {
    config().connections = { alpha: { provider: "d1" }, beta: { provider: "sqlite" } };
    renderContributedSection(container, mapContribution);
    await settle();
    await selectEntry(container, "alpha");

    // Onto an existing key, and to a slug that is empty — both refused.
    setAndFire(part(container, "entry-name"), "beta");
    await settle();
    expect(shows(part(container, "entry-name"))).toBe("alpha");

    setAndFire(part(container, "entry-name"), "!!!");
    await settle();
    expect(shows(part(container, "entry-name"))).toBe("alpha");

    expect(Object.keys(config().connections as Record<string, unknown>)).toEqual(["alpha", "beta"]);
    expect(projectWrites(platformState)).toHaveLength(0);
  });

  test("Escape in the name field abandons the edit without writing", async () => {
    renderContributedSection(container, mapContribution);
    await settle();
    await selectEntry(container, "main");
    setAndFire(part(container, "entry-name"), "renamed", "input");
    await settle();
    key(control(part(container, "entry-name")), "Escape");
    await settle();
    expect(shows(part(container, "entry-name"))).toBe("main");
    expect(projectWrites(platformState)).toHaveLength(0);
  });

  test("delete removes the entry and returns to the empty state", async () => {
    renderContributedSection(container, mapContribution);
    await settle();
    await selectEntry(container, "main");
    pointer(part(container, "delete-entry"), "click");
    await settle();

    expect(config().connections).toEqual({});
    expect(container.querySelector('[part="empty"]')).not.toBeNull();
    expect(projectWrites(platformState)).toHaveLength(1);
  });

  test("entry.ui overrides apply to the entry form", async () => {
    registerFormControl(
      "stub-entry-control",
      ({ value }) => html`<div class="stub-entry-control">${String(value)}</div>`,
    );
    renderContributedSection(container, {
      ...mapContribution,
      settings: {
        entry: { ui: { provider: { control: "stub-entry-control" } } },
        layout: "map",
      },
    });
    await settle();
    await selectEntry(container, "main");
    expect(container.querySelector(".stub-entry-control")?.textContent).toBe("d1");
  });

  test("creates the section object on demand when missing", async () => {
    delete config().connections;
    renderContributedSection(container, mapContribution);
    await settle();
    expect(container.querySelector('[part="empty"]')).not.toBeNull();
    expect(config().connections).toEqual({});
  });
});

// ─── The host's actions row ──────────────────────────────────────────────────
/* An island: the row is contributed by `panels/data-grid.ts`, still lit over Spectrum, and the
   document renders the node it lands in and nothing inside it. */

describe("the actions island", () => {
  test("a section with no actions draws no actions row at all", async () => {
    renderContributedSection(container, formContribution);
    await settle();
    expect(container.querySelector('[part="actions"]')).toBeNull();
  });

  test("a host's actions land in the section's actions node, told what is selected", async () => {
    const seen: (string | null)[] = [];
    renderContributedSection(container, mapContribution, {
      actions: (ctx) => {
        seen.push(ctx.selected);
        return html`<button class="stub-action">${ctx.sectionKey}</button>`;
      },
    });
    await settle();
    expect(part(container, "actions").querySelector(".stub-action")?.textContent).toBe(
      "connections",
    );
    expect(seen.at(-1)).toBeNull();

    await selectEntry(container, "main");
    expect(seen.at(-1)).toBe("main");
  });
  test("a section that loses its actions loses the row with it", async () => {
    renderContributedSection(container, mapContribution, {
      actions: () => html`<button class="stub-action">x</button>`,
    });
    await settle();
    expect(container.querySelector(".stub-action")).not.toBeNull();

    renderContributedSection(container, mapContribution);
    await settle();
    expect(container.querySelector('[part="actions"]')).toBeNull();
    expect(container.querySelector(".stub-action")).toBeNull();
  });
});

// ─── The mount seam ──────────────────────────────────────────────────────────
/* `panels/settings-pane.ts` hands each section its own host and may hand the same one back, so the
   section has to be able to say whether what it mounted is still standing — and to take it down
   when it is not. */

describe("the section's mount", () => {
  test("a container another section took over is re-mounted, not drawn into twice", async () => {
    renderContributedSection(container, mapContribution);
    await settle();
    expect(container.querySelector('[part="contributed"]')).not.toBeNull();

    // What a lit section rendering into the same container does.
    container.replaceChildren();
    renderContributedSection(container, mapContribution);
    await settle();
    expect(container.querySelectorAll('[part="contributed"]')).toHaveLength(1);
    expect(entryKeys(container)).toEqual(["main"]);
  });

  test("a mount disposed before it settles leaves nothing behind", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const noop = (): void => {};
    const handle = mountContributedSurface(
      host,
      {
        cancelNew: noop,
        cancelRename: noop,
        createNew: noop,
        editNew: noop,
        openNew: noop,
        removeEntry: noop,
        renameEntry: noop,
        select: noop,
      },
      { actionsSlot: noop, formSlot: noop },
    );
    handle.dispose();
    await handle.ready;
    await settle();

    expect(handle.attached()).toBe(false);
    expect(handle.host).toBe(host);
    expect(host.querySelector('[part="contributed"]')).toBeNull();
  });

  test("the two island hosts are announced as the document creates them", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const noop = (): void => {};
    const seen: string[] = [];
    const handle = mountContributedSurface(
      host,
      {
        cancelNew: noop,
        cancelRename: noop,
        createNew: noop,
        editNew: noop,
        openNew: noop,
        removeEntry: noop,
        renameEntry: noop,
        select: noop,
      },
      {
        actionsSlot: (el) => seen.push(`actions:${el.tagName.toLowerCase()}`),
        formSlot: (el) => seen.push(`form:${el.tagName.toLowerCase()}`),
      },
    );
    handle.update({
      actionsState: "slot",
      editorRegion: "pane.primary/editor",
      editorState: "empty",
      entries: [],
      entryName: "",
      layout: "form",
      newName: "",
      newState: "closed",
      title: "Islands",
    });
    await handle.ready;
    await settle();

    expect(seen).toEqual(["actions:div", "form:div"]);
    expect(handle.attached()).toBe(true);
    handle.dispose();
  });
});

// ─── §7.1/§7.2: validation and write failures ────────────────────────────────
/* `jx-validate` was wired to exactly one caller — the AI's `write_project_config` — so the model's
   edits to project.json were schema-checked and a human's edits through this very form were not.
   And the write itself was `void saveProjectConfig()`: a read-only file or a dead RPC was dropped
   on the floor while the form kept showing the value it had failed to save. */

describe("routeDiagnostics", () => {
  test("routes a message to the field it names, one level under the base", () => {
    expect(routeDiagnostics("/search", ["/search/index: must be string"])).toEqual({
      fields: { index: "must be string" },
      section: [],
    });
  });

  test("a deeper pointer still belongs to the control that exists on this form", () => {
    expect(routeDiagnostics("/search", ["/search/fields/0/kind: must be one of"]).fields).toEqual({
      fields: "must be one of",
    });
  });

  test("a message about the base itself has no field, and is returned for the section line", () => {
    expect(routeDiagnostics("/search", ["/search: must have required property 'index'"])).toEqual({
      fields: {},
      section: ["must have required property 'index'"],
    });
  });

  test("messages about other sections are not this form's business", () => {
    expect(routeDiagnostics("/search", ["/connections/main: must be object"])).toEqual({
      fields: {},
      section: [],
    });
  });

  test("the first message per field wins, and a message with no pointer is ignored", () => {
    const routed = routeDiagnostics("/search", [
      "/search/index: first",
      "/search/index: second",
      "no pointer here",
    ]);
    expect(routed.fields).toEqual({ index: "first" });
    expect(routed.section).toEqual([]);
  });
});

describe("persistence failures", () => {
  beforeEach(() => {
    resetContributedDiagnostics();
    resetNotifications();
  });

  test("a rejected project.json write becomes a Problem, not a silence", async () => {
    installMockPlatform({
      writeFile: async () => {
        throw new Error("EROFS: read-only file system");
      },
    } as never);
    renderContributedSection(container, formContribution);
    await settle();
    tick(part(field(container, "enabled"), "checkbox"), true);
    await settle();
    const failure = problems.find((p) => p.message.includes("Could not save project.json"));
    expect(failure?.source).toBe("Settings");
    expect(failure?.path).toBe("project.json");
    expect(failure?.message).toContain("EROFS");
  });

  test("schema errors reach the field they are about, on the next render", async () => {
    validatorResult = ["/analytics/id: must be string"];
    renderContributedSection(container, formContribution);
    await settle();
    tick(part(field(container, "enabled"), "checkbox"), true);
    await settle();
    /* §7.1: a message that names a field belongs on that field, and nowhere else — so it is under
       the control it is about, and nothing about it reaches the Problems panel. */
    expect(fieldError(container, "id")).toContain("must be string");
    expect(problems.some((p) => p.message.includes("must be string"))).toBe(false);
    expect(projectWrites(platformState)).toHaveLength(1);
  });

  test("a validator that will not compile is a problem of its own, not the user's field", async () => {
    validatorResult = new Error("ajv exploded");
    renderContributedSection(container, formContribution);
    await settle();
    tick(part(field(container, "enabled"), "checkbox"), true);
    await settle();
    expect(problems.some((p) => p.message.includes("Could not validate project.json"))).toBe(true);
    expect(fieldError(container, "id")).toBe("");
  });
});
