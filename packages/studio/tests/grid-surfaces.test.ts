/**
 * The seams the grid's surfaces are mounted through, tested away from the flows that use them.
 *
 * Two contracts live here, and both are races a flow test cannot reach reliably:
 *
 * 1. **A mount disposed before it lands leaves nothing behind.** Every island adapter starts an async
 *    mount and hands back a handle immediately, so a dialog cancelled or a panel repainted in the
 *    same turn disposes something that does not exist yet. The `.then` has to notice.
 * 2. **A popover surface owns its own slot.** They used to share a NAMED layer slot per id, and the
 *    platform's own stacking made that fatal: showing a second `popover=auto` hides the first, the
 *    first's `toggle` runs its teardown, and the teardown cleared the slot the second was already
 *    mounted into — so the panel that had just opened vanished, silently. Each panel creating and
 *    removing its own slot is what makes a successor unreachable from a predecessor's teardown.
 */
import { flush, mountOverlayLayers } from "./harness";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { initLayers, layerHost } from "../src/ui/layers";
import { openPopoverSurface } from "../src/ui/popover-surface";
import { mountGridOpenSurface } from "../src/surfaces/grid-open";
import { mountPushPlanSurface } from "../src/surfaces/push-plan";
import { mountDataActionsSurface } from "../src/surfaces/data-actions";
import { mountGridPanelSurface } from "../src/surfaces/grid-panel";
import { openGridViewsSurface } from "../src/surfaces/grid-views";
import type { GridPanelActions, GridPanelView } from "../src/surfaces/grid-panel";

beforeAll(() => {
  mountOverlayLayers();
  initLayers();
});

beforeEach(() => {
  layerHost("popover").replaceChildren();
});

function host(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

const NOTHING = (): void => {};

const GRID_VIEW: GridPanelView = {
  canDelete: false,
  canInsert: false,
  countLabel: "0 rows",
  countState: "total",
  error: "",
  filter: "",
  groupNote: "",
  groupState: "hidden",
  lossyState: "hidden",
  nextDisabled: true,
  pageRange: "",
  pagerState: "hidden",
  prevDisabled: true,
  refreshDisabled: false,
  saveDisabled: true,
  saveLabel: "Save",
  view: "grid",
  viewLabel: "View",
};

const GRID_ACTIONS: GridPanelActions = {
  addRow: NOTHING,
  deleteRows: NOTHING,
  fillDown: NOTHING,
  gridHost: NOTHING,
  nextPage: NOTHING,
  openReplace: NOTHING,
  openViews: NOTHING,
  prevPage: NOTHING,
  refresh: NOTHING,
  save: NOTHING,
  setFilter: NOTHING,
};

describe("a mount disposed before it lands", () => {
  test("the grid frame leaves the stage empty", async () => {
    const stage = host();
    const handle = mountGridPanelSurface(stage, GRID_VIEW, GRID_ACTIONS);
    handle.dispose();
    await handle.ready;
    await flush(3);
    expect(stage.querySelector('[part="grid"]')).toBeNull();
    // And a second dispose is inert rather than a second teardown.
    handle.dispose();
    expect(stage.childElementCount).toBe(0);
  });

  test("the Open Grid list leaves the dialog's island empty", async () => {
    const island = host();
    const handle = mountGridOpenSurface(island, [], NOTHING);
    handle.dispose();
    await handle.ready;
    await flush(3);
    expect(island.querySelector('[part="sources"]')).toBeNull();
  });

  test("the push plan leaves the dialog's island empty", async () => {
    const island = host();
    const handle = mountPushPlanSurface(island, { errors: [], steps: [], warnings: [] });
    handle.dispose();
    await handle.ready;
    await flush(3);
    expect(island.querySelector('[part="plan"]')).toBeNull();
  });

  test("the data actions row leaves the section's island empty", async () => {
    const island = host();
    const handle = mountDataActionsSurface(
      island,
      {
        resultOk: "false",
        resultState: "hidden",
        resultText: "",
        resultTitle: "",
        testDisabled: false,
        testLabel: "Test Connection",
        testState: "hidden",
      },
      { openGrid: NOTHING, push: NOTHING, test: NOTHING },
    );
    handle.dispose();
    await handle.ready;
    await flush(3);
    expect(island.querySelector('[part="data-actions"]')).toBeNull();
  });
});

describe("a mounted island keeps projecting", () => {
  test("the push plan re-lists on update, keyed so a surviving step keeps its node", async () => {
    const island = host();
    const handle = mountPushPlanSurface(island, {
      errors: [],
      steps: [{ key: "a", kind: "createTable", summary: "Create posts" }],
      warnings: [],
    });
    await handle.ready;
    await flush(3);
    const first = island.querySelector('[part="step"]')!;
    expect(first.textContent).toBe("Create posts");

    handle.update({
      errors: [{ key: "e", text: "denied" }],
      steps: [
        { key: "a", kind: "createTable", summary: "Create posts" },
        { key: "b", kind: "addColumn", summary: "Add posts.views" },
      ],
      warnings: [{ key: "w", text: "drift" }],
    });
    await flush(3);
    expect([...island.querySelectorAll('[part="step"]')].map((el) => el.textContent)).toEqual([
      "Create posts",
      "Add posts.views",
    ]);
    // Keyed: the step that survived is the same node, not a repaint of the list.
    expect(island.querySelector('[part="step"]')).toBe(first);
    expect(island.querySelector('[part="warning"]')?.textContent).toBe("drift");
    expect(island.querySelector('[part="error"]')?.textContent).toBe("denied");
    handle.dispose();
  });

  test("a step's kind reaches the document, so a drop can be drawn as one", async () => {
    const island = host();
    const handle = mountPushPlanSurface(island, {
      errors: [],
      steps: [{ key: "d", kind: "drop", summary: "Drop posts" }],
      warnings: [],
    });
    await handle.ready;
    await flush(3);
    expect(island.querySelector<HTMLElement>('[part="step"]')?.dataset["kind"]).toBe("drop");
    handle.dispose();
  });
});

describe("a popover surface owns its own slot", () => {
  const panels = () => [...layerHost("popover").querySelectorAll('[part="views-panel"]')];

  function open(onDismissed?: () => void) {
    return openGridViewsSurface(
      {
        columns: [],
        dirOptions: [],
        fieldOptions: [],
        groupField: "",
        groupOptions: [],
        saveLabel: "Save view…",
        sortDir: "asc",
        sortDirDisabled: true,
        sortField: "",
        views: [],
        viewsState: "empty",
        x: 0,
        y: 0,
      },
      {
        applyView: NOTHING,
        deleteView: NOTHING,
        reset: NOTHING,
        saveView: NOTHING,
        setGroup: NOTHING,
        setSortDir: NOTHING,
        setSortField: NOTHING,
        toggleColumn: NOTHING,
        ...(onDismissed ? { dismissed: onDismissed } : {}),
      },
      null,
    );
  }

  test("a second panel is not torn down by the first one's dismissal", async () => {
    const first = open();
    await first.ready;
    await flush(2);
    expect(panels()).toHaveLength(1);

    const second = open();
    await second.ready;
    await flush(2);
    /* Whatever the platform did to the first panel, the second is still standing. This is the
       regression: a shared named slot let the first panel's teardown remove the second's home. */
    expect(second.isOpen()).toBeTrue();
    expect(layerHost("popover").querySelectorAll('[part="views-panel"]').length).toBeGreaterThan(0);
    expect(second.host.isConnected).toBeTrue();

    second.close();
    await flush(2);
    expect(second.isOpen()).toBeFalse();
    expect(second.host.isConnected).toBeFalse();
    first.close();
    await flush(2);
    expect(panels()).toHaveLength(0);
  });

  test("closing takes the slot with it, and closing twice is inert", async () => {
    const handle = open();
    await handle.ready;
    await flush(2);
    const { host: slot } = handle;
    expect(slot.isConnected).toBeTrue();

    handle.close();
    expect(handle.isOpen()).toBeFalse();
    expect(slot.isConnected).toBeFalse();
    handle.close();
    expect(slot.isConnected).toBeFalse();
  });

  test("a platform dismissal reports once and an update after it writes nothing", async () => {
    let dismissed = 0;
    const handle = open(() => {
      dismissed += 1;
    });
    await handle.ready;
    await flush(2);
    const panel = layerHost("popover").querySelector('[part="views-panel"]')!;

    panel.dispatchEvent(Object.assign(new Event("toggle"), { newState: "closed" }));
    expect(dismissed).toBe(1);
    expect(handle.isOpen()).toBeFalse();

    // A second toggle — and an explicit close after it — cannot report a second dismissal.
    panel.dispatchEvent(Object.assign(new Event("toggle"), { newState: "closed" }));
    handle.close();
    expect(dismissed).toBe(1);

    /* And the flow's own effect keeps re-projecting for a turn or two after. A write into a
       disposed document is what this guard exists to drop. */
    expect(() =>
      handle.update({
        columns: [{ field: "a", title: "A", visible: true }],
        dirOptions: [],
        fieldOptions: [],
        groupField: "",
        groupOptions: [],
        saveLabel: "Save as…",
        sortDir: "asc",
        sortDirDisabled: true,
        sortField: "",
        views: [],
        viewsState: "empty",
        x: 0,
        y: 0,
      }),
    ).not.toThrow();
    await flush(2);
    expect(layerHost("popover").querySelector('[part="column"]')).toBeNull();
  });

  test("an opening dismissed before it lands never shows a panel", async () => {
    const handle = open();
    handle.close();
    await handle.ready;
    await flush(3);
    expect(panels()).toHaveLength(0);
  });

  test("the slot carries the panel's region, so a shot can address it by name", async () => {
    const handle = openPopoverSurface({
      name: "grid-views",
      scope: { columns: [], views: [], viewsState: "empty", x: 0, y: 0 },
      slot: "grid/views",
    });
    await handle.ready;
    await flush(2);
    expect(handle.host.dataset["jxRegion"]).toContain("grid/views");
    expect(handle.host.style.pointerEvents).toBe("auto");
    handle.close();
  });
});
