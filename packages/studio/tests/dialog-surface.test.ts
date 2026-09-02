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
        label: "Format",
        options: [{ label: "Markdown", selected: true, value: ".md" }],
      },
      field: { placeholder: "untitled.md", select: "none", value: "draft" },
    });
    await handle.ready;
    await flush();
    const input = layer.querySelector<HTMLInputElement>('jx-textfield [part="input"]')!;
    expect(input.value).toBe("draft");
    expect(input.placeholder).toBe("untitled.md");
    handle.update({
      error: "draft.json exists.",
      invalid: true,
      options: [
        { label: "Markdown", selected: false, value: ".md" },
        { label: "JSON", selected: true, value: ".json" },
      ],
      placeholder: "untitled.json",
      value: "draft-2",
    });
    await flush();
    expect(input.value).toBe("draft-2");
    expect(input.placeholder).toBe("untitled.json");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(layer.querySelector('[part="error"]')?.textContent).toBe("draft.json exists.");
    const select = layer.querySelector<HTMLSelectElement>('select[part="choice"]')!;
    expect([...select.options].map((o) => [o.value, o.hasAttribute("selected")])).toEqual([
      [".md", false],
      [".json", true],
    ]);
    expect(select.value).toBe(".json");
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
