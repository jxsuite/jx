/// <reference lib="dom" />
/**
 * Data section actions — the owner console entry points over the platform's data surface.
 *
 * Integration: the settings modal's contributed sections stay fully generic — extension-sections
 * passes this module's {@link dataSectionActions} into the ContributedSectionOptions.actions slot
 * for the data-domain sections ("connections"/"data") whenever the platform implements the
 * protocol's data routes. Those actions surface Test Connection, Push Schema (dry-run plan
 * confirmation before apply), and Open Data Grid — which opens the grid-tab source picker; table
 * editing itself lives in the spreadsheet grid tabs (src/grid/), which replaced the old modal grid
 * at feature parity (paging, cell edit, add/delete row) and added batch save with undo.
 *
 * **The markup left.** The row is `surfaces/data-actions.json` and the push plan is
 * `surfaces/push-plan.json`, mounted into the confirm dialog `ui/layers.ts` already owns — a push
 * is a confirm, and a second answer to that question is a defect (studio-ui-guidelines.md §12.5).
 * The actions slot became a MOUNT rather than a template: the section redraws on every keystroke
 * its form takes, and re-rendering the row each time replaced the button the reader was pressing.
 */

import { layerHost } from "../ui/layers";
import { openDialogSurface } from "../surfaces/dialog";
import { mountDataActionsSurface } from "../surfaces/data-actions";
import { mountPushPlanSurface } from "../surfaces/push-plan";
import { dataSurfaceAvailable, pushSchema, testConnection } from "../services/data-service";
import { openGridSourcePicker } from "../grid/grid-open";
import type { DataActionsSurfaceHandle, DataActionsView } from "../surfaces/data-actions";
import type { DialogSurfaceHandle } from "../surfaces/dialog";
import type { PushPlanSurfaceHandle, PushPlanView } from "../surfaces/push-plan";
import type { DataConnectionTestResult, DataPushResult } from "../types";
import type { SectionActionsContext } from "../settings/contributed-section";

// ─── Grid opening (delegates to the grid-tab source picker) ──────────────────

/** Reset all module UI state and close any open surfaces (test hook / project switch). */
export function resetDataGridState(): void {
  actionsState = { pushing: false, testResult: null, testing: null };
  closePushDialog();
  for (const mount of mounted.values()) {
    mount.dispose();
  }
  mounted.clear();
}

/** True when the platform serves the data grid. */
export function isDataGridAvailable(): boolean {
  return dataSurfaceAvailable();
}

// ─── Push dialog (dry-run plan confirmation before apply) ─────────────────────

interface PushDialogState {
  handle: DialogSurfaceHandle;
  /** The plan body, once the dialog's island exists. */
  plan: PushPlanSurfaceHandle | null;
  connection: string | undefined;
  phase: "loading" | "confirm" | "applying" | "done";
  dryRun: DataPushResult | null;
  result: DataPushResult | null;
  onDone: () => void;
}

let pushDialog: PushDialogState | null = null;

/** Close the push dialog (also part of resetDataGridState). */
function closePushDialog(): void {
  const open = pushDialog;
  pushDialog = null;
  open?.plan?.dispose();
  open?.handle.close();
}

/** Give every row of the plan an identity, so a re-projection reconciles rather than rebuilds. */
function noteRows(texts: readonly string[], prefix: string) {
  return texts.map((text, index) => ({ key: `${prefix}:${index}`, text }));
}

/** What the body lists: the dry run until it has been applied, then what actually happened. */
function planView(state: PushDialogState): PushPlanView {
  const shown = state.phase === "done" ? state.result : state.dryRun;
  return {
    errors: noteRows(shown?.errors ?? [], "error"),
    steps: (shown?.plan ?? []).map((step, index) => ({
      key: `${step.kind}:${index}`,
      kind: step.kind,
      summary: step.summary,
    })),
    warnings: noteRows(shown?.warnings ?? [], "warning"),
  };
}

/**
 * The sentence under the headline.
 *
 * The empty plan gets one of its own: "nothing to push" is the answer an author most needs and the
 * one an empty list says worst.
 */
function planMessage(state: PushDialogState): string {
  if (state.phase === "loading") {
    return "Compiling plan…";
  }
  if (state.phase === "applying") {
    return "Applying…";
  }
  if (state.phase === "done") {
    return state.result?.applied ? "Schema applied." : "Push failed.";
  }
  const steps = state.dryRun?.plan.length ?? 0;
  const errors = state.dryRun?.errors?.length ?? 0;
  return steps === 0 && errors === 0 ? "Nothing to push — the schema is up to date." : "";
}

/** Put the dialog's three moving parts — its buttons, its sentence and its list — in step. */
function paintPushDialog(): void {
  const state = pushDialog;
  if (!state) {
    return;
  }
  const confirmable = state.phase === "confirm" && (state.dryRun?.plan.length ?? 0) > 0;
  state.handle.update({
    cancelLabel: state.phase === "done" ? "Close" : "Cancel",
    confirmLabel: confirmable ? "Apply" : "",
    message: planMessage(state),
  });
  state.plan?.update(planView(state));
}

/** Start a push: dry-run first, then a confirmation dialog gates the apply. */
export async function startPush(connection: string | undefined, onDone: () => void) {
  if (pushDialog) {
    return;
  }
  const state: PushDialogState = {
    connection,
    dryRun: null,
    handle: null as unknown as DialogSurfaceHandle,
    onDone,
    phase: "loading",
    plan: null,
    result: null,
  };
  state.handle = openDialogSurface({
    cancelLabel: "Cancel",
    confirmLabel: "",
    headline: connection ? `Push Schema — ${connection}` : "Push Schema",
    island: (host) => {
      state.plan = mountPushPlanSurface(host, planView(state));
    },
    layer: layerHost("dialog"),
    message: "Compiling plan…",
    onCancel: closePushDialog,
    onClosed: () => {
      if (pushDialog === state) {
        closePushDialog();
      }
    },
    onConfirm: () => {
      void applyPush();
    },
    region: "data/push",
  });
  pushDialog = state;

  const plan = await pushSchema({
    dryRun: true,
    ...(connection === undefined ? {} : { connection }),
  });
  if (pushDialog !== state) {
    return;
  }
  state.dryRun = plan;
  state.phase = "confirm";
  paintPushDialog();
}

async function applyPush(): Promise<void> {
  const state = pushDialog;
  if (!state) {
    return;
  }
  state.phase = "applying";
  paintPushDialog();
  const result = await pushSchema(
    state.connection === undefined ? {} : { connection: state.connection },
  );
  if (pushDialog !== state) {
    return;
  }
  state.result = result;
  state.phase = "done";
  paintPushDialog();
  state.onDone();
}

// ─── Contributed-section actions (Test / Push / Open grid) ────────────────────

interface ActionsState {
  /** Connection currently being tested, when any. */
  testing: string | null;
  testResult: (DataConnectionTestResult & { connection: string }) | null;
  pushing: boolean;
}

let actionsState: ActionsState = { pushing: false, testResult: null, testing: null };

/**
 * The row mounted in each host the settings machinery has handed us.
 *
 * Keyed by the host node, because one settings pane per stage means one host per stage (§4.1) and a
 * module-level single would make the second pane's row replace the first's.
 */
const mounted = new Map<HTMLElement, DataActionsSurfaceHandle>();

/** What the row says right now, for one section and its selected entry. */
function projectActions(sectionKey: string, selected: string | null): DataActionsView {
  const { testResult } = actionsState;
  return {
    resultOk: testResult?.ok ? "true" : "false",
    resultState: testResult ? "shown" : "hidden",
    resultText: testResult
      ? `${testResult.connection}: ${testResult.ok ? "connected" : (testResult.error ?? "failed")}`
      : "",
    resultTitle: testResult?.error ?? "",
    testDisabled: !selected || actionsState.testing !== null,
    testLabel: actionsState.testing ? "Testing…" : "Test Connection",
    testState: sectionKey === "connections" ? "shown" : "hidden",
  };
}

/**
 * The actions renderer for a data-domain contributed section, or null when the section is not
 * data-domain or the platform lacks the data routes. Section keys "connections"/"data" are the
 * connector's host wire contract (the same literals the backend's data routes serve) — the generic
 * contributed-section renderer itself stays extension-agnostic.
 *
 * It is a MOUNT rather than a template: the returned function is handed the host the section
 * document made, and the second call for the same host projects into the row already there.
 *
 * @param {string} sectionKey
 * @returns {((host: HTMLElement, ctx: SectionActionsContext) => void) | null}
 */
export function dataSectionActions(
  sectionKey: string,
): ((host: HTMLElement, ctx: SectionActionsContext) => void) | null {
  if ((sectionKey !== "connections" && sectionKey !== "data") || !dataSurfaceAvailable()) {
    return null;
  }
  return (host, ctx) => paintSectionActions(host, sectionKey, ctx);
}

async function runTest(connection: string, rerender: () => void): Promise<void> {
  actionsState.testing = connection;
  actionsState.testResult = null;
  rerender();
  const result = await testConnection(connection);
  actionsState.testing = null;
  actionsState.testResult = { ...result, connection };
  rerender();
}

function paintSectionActions(
  host: HTMLElement,
  sectionKey: string,
  ctx: SectionActionsContext,
): void {
  const { rerender, selected } = ctx;
  const existing = mounted.get(host);
  if (existing) {
    existing.update(projectActions(sectionKey, selected));
    return;
  }
  // On the connections section a selected entry scopes both Test and Push to that connection.
  const target = () => (sectionKey === "connections" ? (ctx.selected ?? undefined) : undefined);
  mounted.set(
    host,
    mountDataActionsSurface(host, projectActions(sectionKey, selected), {
      openGrid: () => {
        void openGridSourcePicker();
      },
      push: () => {
        void startPush(target(), rerender);
      },
      test: () => {
        const connection = ctx.selected;
        if (connection) {
          void runTest(connection, rerender);
        }
      },
    }),
  );
}
