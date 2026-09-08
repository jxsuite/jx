/**
 * The dialog surface's adapter on its own: what the flows in `ui/layers.ts` do not reach — closing
 * before the element has rendered, patching a live dialog, and the ready check's two branches.
 */
import { flush } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import { openDialogSurface, whenReady } from "../src/surfaces/dialog";

let layer: HTMLElement;

function open(overrides: Partial<Parameters<typeof openDialogSurface>[0]> = {}) {
  layer = document.createElement("div");
  document.body.append(layer);
  return openDialogSurface({
    cancelLabel: "Cancel",
    confirmLabel: "OK",
    headline: "Name it",
    layer,
    onCancel: () => {},
    onClosed: () => {},
    onConfirm: () => {},
    ...overrides,
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("the dialog surface", () => {
  test("the slot turns pointer events back on, because the layer turns them off", async () => {
    /*
     * `.jx-layer` is `pointer-events: none` so a click passes through to the app when no overlay is
     * up, and every slot in it re-enables them. `pointer-events` inherits and the top layer changes
     * paint order rather than inheritance, so a modal dialog in a slot that skipped this hit-tests
     * to nothing: measured in Chrome 152, `elementFromPoint` over the dialog's own button returned
     * `<html>`. The reader sees the dialog and the mouse goes through it. Asserted here because
     * happy-dom performs no hit-testing, so only the declaration itself can be pinned.
     */
    const handle = open();
    expect(handle.host.style.pointerEvents).toBe("auto");
    handle.close();
  });

  test("refusing the same value twice re-announces it, rather than writing nothing", async () => {
    /*
     * A live region announces a CHANGE, and the reactive write is skipped when the value is equal,
     * so pressing confirm again on a blank field — the ordinary way to meet a refusal twice — set
     * the same sentence, wrote nothing, and said nothing. The region is cleared first, on its own
     * turn, so the repeat is a change like the first one.
     */
    const handle = open({ field: { placeholder: "", select: "none", value: "" } });
    await handle.ready;
    await flush();
    const seen: string[] = [];
    const region = layer.querySelector('jx-textfield [part="error"]');
    const observer = new MutationObserver(() => seen.push(region?.textContent ?? ""));
    observer.observe(region!, { characterData: true, childList: true, subtree: true });

    handle.update({ error: "Enter a value.", invalid: true });
    await flush();
    handle.update({ error: "Enter a value.", invalid: true });
    await flush();
    observer.disconnect();

    // The second refusal cleared and re-set, so the region changed again rather than staying put.
    expect(seen.filter((text) => text === "Enter a value.")).toHaveLength(2);
    expect(region?.textContent).toBe("Enter a value.");
    handle.close();
  });

  test("closing before the element is ready still disposes the mount, and a second close is a no-op", async () => {
    const handle = open();
    expect(layer.childElementCount).toBe(1);
    handle.close();
    expect(layer.childElementCount).toBe(0);
    const element = await handle.ready;
    await flush();
    // The mount that landed after the close was disposed rather than left showing.
    expect(element.isConnected).toBe(false);
    expect(document.querySelector("jx-dialog")).toBeNull();
    expect(() => {
      handle.close();
    }).not.toThrow();
  });

  test("update patches the live dialog: value, placeholder, refusal and options", async () => {
    const handle = open({
      choice: {
        chosen: ".md",
        label: "Format",
        options: [{ label: "Markdown", value: ".md" }],
      },
      field: { placeholder: "untitled.md", select: "none", value: "draft" },
    });
    await handle.ready;
    await flush();
    const input = layer.querySelector<HTMLInputElement>('jx-textfield [part="input"]')!;
    expect(input.value).toBe("draft");
    expect(input.placeholder).toBe("untitled.md");
    handle.update({
      chosen: ".json",
      error: "draft.json exists.",
      invalid: true,
      options: [
        { label: "Markdown", value: ".md" },
        { label: "JSON", value: ".json" },
      ],
      placeholder: "untitled.json",
      value: "draft-2",
    });
    await flush();
    expect(input.value).toBe("draft-2");
    expect(input.placeholder).toBe("untitled.json");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(layer.querySelector('jx-textfield [part="error"]')?.textContent).toBe(
      "draft.json exists.",
    );
    const select = layer.querySelector<HTMLSelectElement>('[part="choice"] select')!;
    expect([...select.options].map((o) => o.value)).toEqual([".md", ".json"]);
    /* The control holds the chosen row, and NO option carries a `selected` attribute — the two
       halves of the contract `ui.md` §5.1 makes normative. The attribute is what a projection used
       to mark, and it is right up to the reader's first pick and wrong after it, so the element
       must be shown to have moved selectedness without ever writing one. */
    expect(select.value).toBe(".json");
    expect(layer.querySelector("option[selected]")).toBeNull();
    handle.close();
  });

  test("whenReady answers at once for an element that has rendered, and waits for jx-ready otherwise", async () => {
    const rendered = document.createElement("div");
    rendered.innerHTML = '<dialog part="dialog"></dialog>';
    expect((await whenReady(rendered)) === rendered).toBe(true);

    const pending = document.createElement("div");
    let settled = false;
    const wait = whenReady(pending).then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    pending.dispatchEvent(new Event("jx-ready"));
    await wait;
    expect(settled).toBe(true);
  });
});
