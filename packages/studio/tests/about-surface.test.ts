/**
 * `src/surfaces/about.ts` — the adapter's own lifecycle, which the flow above it cannot reach.
 *
 * Two of its branches are about a close that lands BEFORE the dialog is showing: one while the
 * document is still mounting, one while the element is still becoming ready. `about-modal.test.ts`
 * owns everything the reader sees; what is asserted here is that neither window can end in an OPEN
 * `<dialog>` — one shown after its handle is gone sits in the top layer with nothing left holding
 * it — and that the mount is DISPOSED rather than orphaned inside a detached slot.
 *
 * Nothing is doubled. "Still becoming ready" is a real state of a real element: a `jx-dialog` in a
 * layer that is not in the document cannot connect, so it has not rendered its own
 * `[part="dialog"]` yet, which is exactly the window `whenReady` exists to wait out.
 */
import { flush } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { openAboutSurface } from "../src/surfaces/about";
import { mountsOf, resetSurfaceRegistry } from "../src/services/surface-registry";

let layer: HTMLElement;
let closes: number;

beforeEach(() => {
  document.body.innerHTML = "";
  layer = document.createElement("div");
  layer.id = "layer-dialog";
  document.body.append(layer);
  resetSurfaceRegistry();
  closes = 0;
});

function open(into: HTMLElement = layer) {
  return openAboutSurface({
    headline: "About Jx Studio",
    layer: into,
    links: [{ href: "https://example.test", label: "Docs" }],
    onClosed: () => {
      closes += 1;
    },
    rows: [{ label: "Version", value: "dev" }],
  });
}

/** Whether the platform was asked to show it — the native element's own answer. */
function isShowing(element: HTMLElement): boolean {
  return element.querySelector("dialog")?.open === true;
}

describe("openAboutSurface", () => {
  test("shows the dialog once the element is ready, and holds exactly one live mount", async () => {
    const handle = open();
    const element = await handle.ready;
    await flush(2);
    expect(isShowing(element)).toBe(true);
    expect(mountsOf("about")).toHaveLength(1);

    handle.close();
    // Closing disposes the document, so the mount is gone rather than merely off screen.
    expect(mountsOf("about")).toHaveLength(0);
    expect(layer.childElementCount).toBe(0);
    expect(closes).toBe(1);
  });

  test("a close before the mount lands disposes it and never shows anything", async () => {
    /* Synchronous, so `mountSurface` has not resolved: `close()` finds no element at all, and the
       branch that has to clean up is the one inside the mount's own `then`. */
    const handle = open();
    handle.close();
    expect(closes).toBe(1);

    const element = await handle.ready;
    await flush(2);
    expect(isShowing(element)).toBe(false);
    /* The mount is disposed by the branch that finds it already closed. Left registered, it would
       keep a live reactive scope and a detached document for the life of the window. */
    expect(mountsOf("about")).toHaveLength(0);
    expect(layer.childElementCount).toBe(0);
    // One report, from whichever path got there first.
    expect(closes).toBe(1);
  });

  test("a close while the element is still becoming ready never opens the dialog", async () => {
    /* `whenReady` sits between the mount and `showModal`: the document has rendered, the element's
       own template has not. Showing it after a close in that window puts a modal `<dialog>` in the
       top layer whose handle has already reported itself closed — nothing owns it, and the close
       that was meant to take it down ran BEFORE it opened. */
    const detached = document.createElement("div");
    const handle = open(detached);
    await flush(3);
    const element = handle.host.firstElementChild as HTMLElement;
    expect(element.tagName.toLowerCase()).toBe("jx-dialog");
    expect(mountsOf("about")).toHaveLength(1);
    /* The document is all there — its rows are the element's own children. What is missing is the
       element's TEMPLATE, `[part="dialog"]` included, because it never connected. That gap is the
       whole of what `whenReady` waits for. */
    expect(element.querySelector('[part="meta-row"]')).not.toBeNull();
    expect(element.querySelector('[part="dialog"]')).toBeNull();

    handle.close();
    expect(closes).toBe(1);
    expect(detached.childElementCount).toBe(0);

    // It connects at last and finishes becoming ready — too late to matter.
    document.body.append(element);
    await flush(3);
    expect(element.querySelector('[part="dialog"]')).not.toBeNull();
    expect(await handle.ready).toBe(element);
    expect(isShowing(element)).toBe(false);
    element.remove();
  });
});
