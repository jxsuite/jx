/**
 * Tests for src/panels/data-grid.ts — the data-surface owner console actions: the
 * contributed-section actions slot (Test Connection / Push Schema / Open Data Grid — now the
 * grid-tab source picker), the push dry-run confirmation dialog, and degradation when the platform
 * lacks the data routes. Table editing itself is covered by the grid tests (grid-connector-source
 * and friends).
 */
import { flush, installMockPlatform, mountOverlayLayers, resetStudioState } from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import {
  dataSectionActions,
  isDataGridAvailable,
  resetDataGridState,
  startPush,
} from "../src/panels/data-grid";
import { closeAllTabs } from "../src/workspace/workspace";
import type { DataPushResult, DataRowsQuery, StudioPlatform } from "../src/types";
import type { SectionActionsContext } from "../src/settings/contributed-section";

beforeAll(() => {
  mountOverlayLayers();
  initLayers();
});

/* Both surfaces are documents now — `surfaces/data-actions.json` for the row and
   `surfaces/push-plan.json` inside `ui/layers.ts`'s own confirm dialog for the plan — so nothing
   here names a class. The dialog is addressed as `jx-dialog` and answered with the `confirm` /
   `cancel` events every flow over it dispatches; whether it offers an Apply at all is the
   `confirm-label` attribute, which is absent when there is nothing to apply. */
function pushDialog(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>("#layer-dialog jx-dialog")].at(-1) ?? null;
}

function part(root: ParentNode | null, name: string): HTMLElement | null {
  return root?.querySelector<HTMLElement>(`[part="${name}"]`) ?? null;
}

function textOf(root: ParentNode | null, name: string): string {
  return part(root, name)?.textContent?.replaceAll(/\s+/g, " ").trim() ?? "";
}

function control(root: ParentNode, name: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[part="${name}"] [part="control"]`);
  if (!el) {
    throw new Error(`no control inside [part="${name}"]`);
  }
  return el;
}

async function answer(kind: "confirm" | "cancel"): Promise<void> {
  pushDialog()?.dispatchEvent(new Event(kind));
  await flush(3);
}

interface Calls {
  rows: DataRowsQuery[];
  updates: unknown[];
  inserts: unknown[];
  deletes: unknown[];
  pushes: Record<string, unknown>[];
  tests: string[];
}

const COLUMNS = [
  { name: "id", pk: true, type: "text" },
  { name: "created_at", type: "text" },
  { name: "title", type: "text" },
  { name: "views", type: "integer" },
];

function makeRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    created_at: "2026-01-01",
    id: `r${i}`,
    title: `Title ${i}`,
    views: i,
  }));
}

interface InstallOptions {
  total?: number;
  failRows?: boolean;
  failConnections?: boolean;
  dryPlan?: DataPushResult;
  overrides?: Partial<StudioPlatform>;
}

function installDataPlatform(opts: InstallOptions = {}): Calls {
  const calls: Calls = { deletes: [], inserts: [], pushes: [], rows: [], tests: [], updates: [] };
  const total = opts.total ?? 2;
  const allRows = makeRows(total);
  installMockPlatform({
    dataConnections: async () => {
      if (opts.failConnections) {
        throw new Error("no connections route");
      }
      return {
        connections: [
          {
            configured: true,
            connector: { kind: "sqlite", provider: "sqlite" },
            isDefault: true,
            missingSecrets: [],
            name: "main",
            provider: "sqlite",
            settings: {},
            tables: ["posts", "user"],
          },
          {
            configured: true,
            connector: null,
            isDefault: false,
            missingSecrets: [],
            name: "empty",
            provider: "sqlite",
            settings: {},
            tables: [],
          },
        ],
      };
    },
    dataConnectionTest: async (connection) => {
      calls.tests.push(connection);
      return connection === "main" ? { ok: true } : { error: "no db", ok: false };
    },
    dataDeleteRow: async (req) => {
      calls.deletes.push(req);
      return { ok: true };
    },
    dataInsertRow: async (req) => {
      calls.inserts.push(req);
      return { row: { id: "new", ...req.values } };
    },
    dataPush: async (pushOpts) => {
      calls.pushes.push({ ...pushOpts });
      if (pushOpts?.dryRun) {
        return (
          opts.dryPlan ?? {
            applied: false,
            plan: [{ kind: "createTable", summary: 'Create table "posts"', table: "posts" }],
            warnings: ["type drift on posts.views"],
          }
        );
      }
      return {
        applied: true,
        plan: [{ kind: "createTable", summary: 'Create table "posts"', table: "posts" }],
      };
    },
    dataRows: async (query) => {
      calls.rows.push(query);
      if (opts.failRows) {
        throw new Error("table vanished");
      }
      const offset = query.offset ?? 0;
      return {
        columns: COLUMNS,
        rows: allRows.slice(offset, offset + (query.limit ?? 50)),
        total,
      };
    },
    dataUpdateRow: async (req) => {
      calls.updates.push(req);
      const base = allRows.find((r) => r.id === (req as { pk: unknown }).pk) ?? {};
      return { row: { ...base, ...(req as { set: Record<string, unknown> }).set } };
    },
    ...opts.overrides,
  });
  return calls;
}

beforeEach(() => {
  resetDataGridState();
  resetStudioState();
  closeAllTabs();
});

afterEach(() => {
  resetDataGridState();
});

// ─── Grid modal ───────────────────────────────────────────────────────────────

describe("grid opening", () => {
  test("availability tracks the platform's dataRows member", () => {
    installMockPlatform();
    expect(isDataGridAvailable()).toBe(false);
    installDataPlatform();
    expect(isDataGridAvailable()).toBe(true);
  });

  test("Open Data Grid opens the grid-tab source picker listing connections' tables", async () => {
    installDataPlatform();
    resetStudioState({ projectConfig: { content: {} } });
    const host = await mountActions("data", null);

    control(host, "grid").click();
    await flush(4);
    const labels = [...document.querySelectorAll('#layer-dialog [part="source"]')].map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toContain("Pages");
    expect(labels).toContain("posts");
    expect(labels).toContain("user");
    // The connection with no tables says so instead of contributing a silent empty group.
    expect(
      [...document.querySelectorAll('#layer-dialog [part="group-empty"]')].map((el) =>
        el.textContent?.trim(),
      ),
    ).toEqual(["No tables — push a schema first."]);
    host.remove();
    await answer("cancel");
  });
});

/**
 * Mount the actions row the way the settings machinery does: a host node the section document made,
 * handed to the contributor, which mounts into it and re-projects on every later call.
 */
async function mountActions(sectionKey: string, selected: string | null): Promise<HTMLElement> {
  const actions = dataSectionActions(sectionKey);
  expect(actions).not.toBeNull();
  const host = document.createElement("div");
  document.body.append(host);
  const ctx: SectionActionsContext = {
    rerender: () => actions!(host, ctx),
    sectionKey,
    selected,
  };
  actions!(host, ctx);
  await flush(3);
  return host;
}

describe("data section actions", () => {
  test("only data-domain sections with a data-capable platform get actions", () => {
    installDataPlatform();
    expect(dataSectionActions("content")).toBeNull();
    expect(dataSectionActions("connections")).not.toBeNull();
    expect(dataSectionActions("data")).not.toBeNull();
    installMockPlatform();
    expect(dataSectionActions("connections")).toBeNull();
  });

  test("Test Connection is selection-scoped and reports the probe result", async () => {
    const calls = installDataPlatform();
    const none = await mountActions("connections", null);
    expect(control(none, "test").hasAttribute("disabled")).toBeTrue();

    const host = await mountActions("connections", "main");
    expect(control(host, "test").hasAttribute("disabled")).toBeFalse();
    control(host, "test").click();
    await flush(3);
    expect(calls.tests).toEqual(["main"]);
    expect(part(host, "result")?.dataset["ok"]).toBe("true");
    expect(textOf(host, "result")).toBe("main: connected");
    // The verdict arrives after the press, so it has to announce itself.
    expect(part(host, "result")?.getAttribute("role")).toBe("status");
    none.remove();
    host.remove();
  });

  test("failed probes render the error and mark the row as a failure", async () => {
    installDataPlatform();
    const host = await mountActions("connections", "empty");
    control(host, "test").click();
    await flush(3);
    expect(textOf(host, "result")).toContain("no db");
    expect(part(host, "result")?.dataset["ok"]).toBe("false");
    host.remove();
  });

  test("the data section offers Push and Open Data Grid without Test", async () => {
    installDataPlatform();
    const host = await mountActions("data", null);
    expect(part(host, "test")).toBeNull();
    expect(part(host, "push")).not.toBeNull();
    expect(part(host, "grid")).not.toBeNull();
    host.remove();
  });

  /* The section redraws on every keystroke its form takes, and the row used to be re-rendered with
     it — which replaced the very button the reader was pressing. It is mounted once per host now,
     and a redraw is a projection into the row already there. */
  test("a redraw re-projects the row instead of replacing it", async () => {
    const calls = installDataPlatform();
    const host = await mountActions("connections", "main");
    const button = control(host, "test");
    button.click();
    await flush(3);
    expect(calls.tests).toEqual(["main"]);
    // Same node, after a projection that changed both the label and the result beside it.
    expect(control(host, "test")).toBe(button);
    expect(textOf(host, "result")).toBe("main: connected");
    host.remove();
  });
});

// ─── Push dialog ──────────────────────────────────────────────────────────────

describe("push dialog", () => {
  test("dry-runs first, shows the plan + warnings, and applies only on confirm", async () => {
    const calls = installDataPlatform();
    const host = await mountActions("connections", "main");
    control(host, "push").click();
    await flush(4);

    const dialog = pushDialog()!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("headline")).toBe("Push Schema — main");
    expect(calls.pushes).toEqual([{ connection: "main", dryRun: true }]);
    expect([...dialog.querySelectorAll('[part="step"]')].map((s) => s.textContent?.trim())).toEqual(
      ['Create table "posts"'],
    );
    expect(textOf(dialog, "warning")).toContain("type drift");
    // There is something to apply, so the primary answer exists and says what it does.
    expect(dialog.getAttribute("confirm-label")).toBe("Apply");

    await answer("confirm");
    expect(calls.pushes).toEqual([{ connection: "main", dryRun: true }, { connection: "main" }]);
    expect(textOf(pushDialog(), "message")).toBe("Schema applied.");
    // Applied: there is nothing left to confirm, and the way out is named Close.
    expect(pushDialog()?.getAttribute("confirm-label")).toBeNull();
    expect(pushDialog()?.getAttribute("cancel-label")).toBe("Close");

    await answer("cancel");
    expect(pushDialog()).toBeNull();
    host.remove();
  });

  test("an empty plan reads as nothing-to-push with no Apply", async () => {
    const calls = installDataPlatform({ dryPlan: { applied: false, plan: [] } });
    await startPush(undefined, () => {});
    await flush(4);
    expect(textOf(pushDialog(), "message")).toContain("Nothing to push");
    expect(pushDialog()?.getAttribute("confirm-label")).toBeNull();
    expect(calls.pushes).toEqual([{ dryRun: true }]);
    await answer("cancel");
    expect(pushDialog()).toBeNull();
  });

  test("dry-run errors surface as an alert and only one dialog opens at a time", async () => {
    installDataPlatform({
      dryPlan: { applied: false, errors: ["remote: unreachable"], plan: [] },
    });
    await startPush(undefined, () => {});
    await startPush(undefined, () => {});
    await flush(4);
    expect(document.querySelectorAll("#layer-dialog jx-dialog")).toHaveLength(1);
    expect(textOf(pushDialog(), "error")).toBe("remote: unreachable");
    expect(part(pushDialog(), "error")?.getAttribute("role")).toBe("alert");
    await answer("cancel");
  });

  test("a failed apply says so rather than claiming the schema is live", async () => {
    installDataPlatform({
      overrides: {
        dataPush: async (opts?: { dryRun?: boolean }) =>
          opts?.dryRun
            ? {
                applied: false,
                plan: [{ kind: "createTable", summary: "Create table", table: "posts" }],
              }
            : { applied: false, errors: ["permission denied"], plan: [] },
      },
    });
    let done = 0;
    await startPush(undefined, () => {
      done += 1;
    });
    await flush(4);
    await answer("confirm");
    expect(textOf(pushDialog(), "message")).toBe("Push failed.");
    expect(textOf(pushDialog(), "error")).toBe("permission denied");
    expect(done).toBe(1);
    await answer("cancel");
  });
});
