/**
 * Integration tests for the secret commit path: a contributed section whose descriptor marks a
 * field with the "secret" control stores the typed VALUE via platform.setSecrets under a derived
 * env name and persists only the env NAME to project.json (specs/extensions.md §13). Also covers
 * the ContributedSectionOptions.actions slot carrying the data-domain actions.
 *
 * The section around both is a Jx document (`src/surfaces/settings-contributed.json`), so the
 * container is appended to the page and every render awaited — a kit element renders in its
 * `connectedCallback`. The secret control and the actions row are the two surfaces this section
 * renders empty host nodes for, and both are documents now (`surfaces/secret-field.json`,
 * `surfaces/data-actions.json`) — so both are reached by `part`, and the field's state is read off
 * the native input the kit wraps rather than off the element.
 */
import { flush, installMockPlatform, pointer, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import "../src/ui/form-controls";
import {
  renderContributedSection,
  resetContributedSectionState,
} from "../src/settings/contributed-section";
import { dataSectionActions, resetDataGridState } from "../src/panels/data-grid";
import { resetSchemaForms } from "../src/ui/schema-form";
import { initLayers } from "../src/ui/layers";
import { projectState } from "../src/store";
import type { MockPlatformState } from "./harness";
import type { SecretsSetRequest, StudioPlatform } from "../src/types";
import type { SettingsContribution } from "../src/settings/contributed-section";

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  if (!document.querySelector(`#${id}`)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
}
initLayers();

const CONNECTIONS_CONTRIBUTION: SettingsContribution = {
  entrySchema: {
    properties: {
      provider: { type: "string" },
      urlEnv: { type: "string" },
    },
    type: "object",
  },
  key: "connections",
  settings: {
    entry: { ui: { urlEnv: { control: "secret" } } },
    layout: "map",
  },
  title: "Connections",
};

/** The native control a kit element wraps — the field the reader actually types into. */
function control(el: Element): HTMLInputElement {
  const inner = el.querySelector<HTMLInputElement>('input[part="input"]');
  if (!inner) {
    throw new Error(`no native control inside <${el.tagName.toLowerCase()}>`);
  }
  return inner;
}

/** The secret control's field, wherever in the section it was drawn. */
function secretField(): HTMLInputElement {
  const el = container.querySelector('[part="secret"] [part="field"]');
  expect(el).not.toBeNull();
  return control(el!);
}

function commitValue(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function config(): Record<string, unknown> {
  return projectState!.projectConfig as unknown as Record<string, unknown>;
}

let container: HTMLElement;

/** Let the document and the standing schema form catch up. */
async function settle(): Promise<void> {
  await flush(8);
}

async function mount(
  overrides: Partial<StudioPlatform> = {},
  opts: Parameters<typeof renderContributedSection>[2] = {},
): Promise<MockPlatformState> {
  const { state } = installMockPlatform(overrides);
  container = document.createElement("div");
  document.body.append(container);
  renderContributedSection(container, CONNECTIONS_CONTRIBUTION, opts);
  await settle();
  return state;
}

async function selectEntry(name: string): Promise<void> {
  const button = container.querySelector(`[data-entry="${name}"]`);
  expect(button).not.toBeNull();
  pointer(button!, "click");
  await settle();
}

afterEach(() => {
  container.remove();
});

beforeEach(() => {
  resetContributedSectionState();
  resetSchemaForms();
  resetDataGridState();
  resetStudioState({
    projectConfig: { connections: { main: { provider: "supabase" } }, name: "Site" },
  });
});

describe("secret control inside a contributed section", () => {
  test("stores the VALUE via setSecrets and the derived env NAME in project.json", async () => {
    const secretWrites: SecretsSetRequest[] = [];
    const state = await mount({
      setSecrets: async (req) => {
        secretWrites.push(req);
        return { names: Object.keys(req.set ?? {}), ok: true };
      },
    });
    await selectEntry("main");
    const field = secretField();
    expect(field.disabled).toBe(false);
    expect(field.getAttribute("placeholder")).toBe("Not set");

    commitValue(field, "postgres://user:pw@host/db");
    await settle();

    // The VALUE went to the platform secret store under the derived env name…
    expect(secretWrites).toEqual([{ set: { MAIN_URL: "postgres://user:pw@host/db" } }]);
    // …and project.json carries only the NAME.
    const connections = config().connections as Record<string, Record<string, unknown>>;
    expect(connections.main!.urlEnv).toBe("MAIN_URL");
    const written = state.calls.find((c) => c[0] === "writeFile" && c[1] === "project.json");
    expect(written).toBeDefined();
    expect(written![2] as string).toContain('"urlEnv": "MAIN_URL"');
    expect(written![2] as string).not.toContain("postgres://");

    // The redrawn field advertises where the secret lives, and holds none of it.
    const after = secretField();
    expect(after.getAttribute("placeholder")).toBe("Stored as MAIN_URL");
    expect(after.value).toBe("");
  });

  test("renders disabled when the platform has no setSecrets surface", async () => {
    await mount();
    await selectEntry("main");
    expect(secretField().disabled).toBe(true);
  });
});

describe("actions slot", () => {
  test("data-domain actions render under the section title via opts.actions", async () => {
    // The platform must be data-capable BEFORE resolving the actions renderer.
    installMockPlatform({
      dataConnectionTest: async () => ({ ok: true }),
      dataPush: async () => ({ applied: true, plan: [] }),
      dataRows: async () => ({ columns: [], rows: [], total: 0 }),
    });
    const actions = dataSectionActions("connections");
    expect(actions).not.toBeNull();
    container = document.createElement("div");
    document.body.append(container);
    renderContributedSection(container, CONNECTIONS_CONTRIBUTION, { actions: actions! });
    await settle();
    const probe = () =>
      container.querySelector('[part="test"] [part="control"]') as HTMLElement | null;
    expect(container.querySelector('[part="data-actions"]')).not.toBeNull();
    expect(container.querySelector('[part="push"]')).not.toBeNull();
    // No entry selected yet: Test Connection is present but disabled.
    expect(probe()!.hasAttribute("disabled")).toBe(true);
    await selectEntry("main");
    // The row is projected rather than re-rendered, so the same control answers differently.
    expect(probe()!.hasAttribute("disabled")).toBe(false);
  });

  test("sections without an actions option render actions-free", async () => {
    await mount();
    expect(container.querySelector('[part="actions"]')).toBeNull();
    expect(container.querySelector('[part="data-actions"]')).toBeNull();
  });
});
