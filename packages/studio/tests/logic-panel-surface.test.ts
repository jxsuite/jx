/**
 * `src/surfaces/logic-panel.ts` — the adapter, driven directly rather than through the flow.
 *
 * `events-panel.test.ts` owns the Logic tab as a reader meets it. What is left here is the seam
 * between the tab and its container, which no projection can reach: where a control island is
 * announced from, whether the surface knows it has been taken out of the page, and what a dispose
 * that beats the mount is supposed to leave behind.
 */
import { flush } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { emptyLogicView, mountLogicSurface } from "../src/surfaces/logic-panel";
import { mountsOf, resetSurfaceRegistry } from "../src/services/surface-registry";
import type { LogicActions, LogicFieldView, LogicIslands } from "../src/surfaces/logic-panel";

/** One announcement: the key the surface said, and what the node knew about itself at the time. */
interface Announced {
  key: string;
  /** `data-field` AT ANNOUNCE TIME — the attribute is applied one step later. */
  attributeThen: string | undefined;
  node: HTMLElement;
}

let host: HTMLElement;
let controls: Announced[];
let expressions: Announced[];
let statements: Announced[];

/** Every action a control could ask for, recorded rather than performed. */
const noop = () => {};
const actions: LogicActions = {
  addCase: noop,
  addEvent: noop,
  clearEvent: noop,
  clearField: noop,
  editTemplate: noop,
  openCase: noop,
  openEditor: noop,
  pickEventName: noop,
  pickHandler: noop,
  pickSource: noop,
  removeCase: noop,
  renameCase: noop,
  runEmptyAction: noop,
  setBodyMode: noop,
  setCode: noop,
  setField: noop,
  setHandlerRef: noop,
  setSection: noop,
};

function record(into: Announced[]) {
  return (key: string, node: HTMLElement) => {
    into.push({ attributeThen: node.dataset["field"], key, node });
  };
}

function islands(): LogicIslands {
  return {
    controlSlot: record(controls),
    expressionSlot: record(expressions),
    statementsSlot: record(statements),
  };
}

/** One bindable row, in whichever of the three control shapes the flow asked for. */
function field(key: string, kind: LogicFieldView["kind"]): LogicFieldView {
  return {
    clearLocked: false,
    clearTitle: `Clear ${key}`,
    dotState: "set",
    key,
    kind,
    label: key,
    mono: false,
    options: [],
    placeholder: "",
    prop: key,
    source: "signal",
    sourceHint: `${key} comes from a signal`,
    sourceLabel: "Signal",
    sourceLocked: false,
    tone: "neutral",
    value: "",
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
  resetSurfaceRegistry();
  controls = [];
  expressions = [];
  statements = [];
});

describe("the control island", () => {
  test("is announced with the row's key, read from the $map scope and not off the node", async () => {
    const surface = mountLogicSurface(
      host,
      {
        ...emptyLogicView(),
        hasRepeater: true,
        repeaterFields: [field("items", "control"), field("filter", "text")],
        repeaterOpen: true,
        state: "ready",
      },
      actions,
      islands(),
    );
    await flush(4);

    // Only the `control` row gets a host; `text` draws a field of its own and needs no island.
    expect(controls.map((entry) => entry.key)).toEqual(["items"]);
    const [items] = controls;
    expect(items!.node.getAttribute("part")).toBe("control-host");
    /* A node is announced when it is BUILT, one step before its attributes settle — so `data-field`
       is still empty here, and reading the key off the element would hand the flow "". That is the
       whole reason the key comes out of the row's own `$map` scope. */
    expect(items!.attributeThen).toBeUndefined();
    expect(items!.node.dataset["field"]).toBe("items");
    // The node the flow was handed is the one that ended up in the page.
    expect(host.querySelector('[part="control-host"]')).toBe(items!.node);
    expect(expressions).toEqual([]);
    expect(statements).toEqual([]);

    surface.dispose();
  });
});

describe("the surface's own lifetime", () => {
  test("connected() follows the mounted root out of the page", async () => {
    const surface = mountLogicSurface(host, emptyLogicView(), actions, islands());
    /* Before the mount lands there is no root to ask about, so the surface answers for itself —
       otherwise the Inspector would treat a tab that is merely still mounting as one that is gone
       and mount a second copy over it. */
    expect(surface.connected()).toBe(true);
    await flush(4);
    expect(surface.connected()).toBe(true);

    // The Inspector clearing its container is how the tab goes away.
    host.replaceChildren();
    expect(surface.connected()).toBe(false);
    surface.dispose();
  });

  test("a dispose that beats the mount takes it down rather than leaving it live", async () => {
    const surface = mountLogicSurface(host, emptyLogicView(), actions, islands());
    surface.dispose();
    await flush(4);

    // Nothing survived: the mount is disposed by the branch that finds the surface already gone.
    expect(mountsOf("logic-panel")).toHaveLength(0);
    // And with no root ever kept, `connected()` answers for the disposal instead.
    expect(surface.connected()).toBe(false);
  });

  test("update() re-projects into the same mount", async () => {
    const surface = mountLogicSurface(host, emptyLogicView(), actions, islands());
    await flush(4);
    expect(host.querySelector('[part="empty-message"]')?.textContent).toBe("");
    expect(mountsOf("logic-panel")).toHaveLength(1);

    surface.update({
      ...emptyLogicView(),
      emptyMessage: "Select an element to wire it up.",
    });
    await flush(3);
    expect(host.querySelector('[part="empty-message"]')?.textContent).toBe(
      "Select an element to wire it up.",
    );
    // One mount throughout: a projection is an assignment, never a re-mount.
    expect(mountsOf("logic-panel")).toHaveLength(1);
    surface.dispose();
    expect(mountsOf("logic-panel")).toHaveLength(0);
  });
});
