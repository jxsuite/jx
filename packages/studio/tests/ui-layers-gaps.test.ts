/**
 * Ui/layers — showDialog/showConfirmDialog resolution, openModal handle, renderPopover dismissal
 * (outside click, layer targeting), and named layer slots.
 */
import { flush, mountOverlayLayers } from "./harness";
import { beforeAll, describe, expect, test } from "bun:test";
import { html } from "lit-html";
import {
  clearLayerSlot,
  getLayerSlot,
  initLayers,
  isModalOpen,
  openModal,
  showConfirmDialog,
  showDialog,
  showPromptDialog,
  showSaveDiscardDialog,
} from "../src/ui/layers";

function layer(id: string): HTMLElement {
  return document.querySelector(`#layer-${id}`) as HTMLElement;
}

describe("getLayerSlot before initLayers", () => {
  test("falls back to document.body when layers are not initialized", () => {
    document.body.innerHTML = "";
    const slot = getLayerSlot("popover", "pre-init");
    expect(slot.parentElement).toBe(document.body);
    clearLayerSlot("popover", "pre-init");
    expect(slot.parentElement).toBeNull();
  });
});

describe("layers after init", () => {
  beforeAll(() => {
    mountOverlayLayers(document.body);
    initLayers();
  });

  describe("showDialog", () => {
    test("resolves with the done() value and removes the slot", async () => {
      const promise = showDialog<string>(
        (done) => html`<button
          id="dlg-btn"
          @click=${() => {
            done("picked");
          }}
        >
          pick
        </button>`,
      );
      expect(layer("dialog").querySelector("#dlg-btn")).not.toBeNull();
      (layer("dialog").querySelector("#dlg-btn") as HTMLElement).click();
      expect(await promise).toBe("picked");
      expect(layer("dialog").querySelector("#dlg-btn")).toBeNull();
    });

    test("a dialog says it is one, and that everything behind it is inert", async () => {
      /*
       * `aria-modal` is what constrains a screen reader's virtual cursor, which a Tab trap cannot:
       * the virtual cursor does not use Tab. It is also why not trapping Tab is still correct — the
       * wrapper's action buttons live in a shadow root a light-DOM cycle cannot enumerate.
       */
      let doneFn: ((v: string) => void) | null = null;
      const promise = showDialog<string>((done) => {
        doneFn = done;
        return html`<sp-dialog-wrapper headline="Delete page?"></sp-dialog-wrapper>`;
      });
      const slot = layer("dialog").querySelector("[role='dialog']") as HTMLElement;
      expect(slot).not.toBeNull();
      expect(slot.getAttribute("aria-modal")).toBe("true");
      // The name comes off the wrapper's headline, which only exists after the template has run.
      expect(slot.getAttribute("aria-label")).toBe("Delete page?");
      doneFn!("x");
      await promise;
    });

    test("an explicit label wins, and a nameless dialog is left nameless", async () => {
      let doneFn: ((v: string) => void) | null = null;
      const labelled = showDialog<string>(
        (done) => {
          doneFn = done;
          return html`<sp-dialog-wrapper headline="Ignored"></sp-dialog-wrapper>`;
        },
        { label: "Chosen" },
      );
      expect(
        (layer("dialog").querySelector("[role='dialog']") as HTMLElement).getAttribute(
          "aria-label",
        ),
      ).toBe("Chosen");
      doneFn!("x");
      await labelled;

      // A caller that supplies neither has a defect of its own; inventing a name would hide it.
      const bare = showDialog<string>((done) => {
        doneFn = done;
        return html`<span>body</span>`;
      });
      expect(
        (layer("dialog").querySelector("[role='dialog']") as HTMLElement).hasAttribute(
          "aria-label",
        ),
      ).toBe(false);
      doneFn!("x");
      await bare;
    });

    test("second done() call is ignored", async () => {
      let doneFn: ((v: number) => void) | null = null;
      const promise = showDialog<number>((done) => {
        doneFn = done;
        return html`<span>x</span>`;
      });
      doneFn!(1);
      doneFn!(2);
      expect(await promise).toBe(1);
    });

    test("takes the keyboard on open and hands focus back on close", async () => {
      const opener = document.createElement("button");
      document.body.append(opener);
      opener.focus();
      expect(document.activeElement).toBe(opener);

      let doneFn: ((v: string) => void) | null = null;
      const promise = showDialog<string>((done) => {
        doneFn = done;
        return html`<sp-dialog-wrapper open><input id="dlg-field" /></sp-dialog-wrapper>`;
      });
      // Focus lands a frame later — the wrapper's own buttons live in a shadow root Spectrum
      // Renders asynchronously.
      await flush();
      expect(document.activeElement).toBe(layer("dialog").querySelector("#dlg-field"));

      doneFn!("x");
      await promise;
      expect(document.activeElement).toBe(opener);
      opener.remove();
    });

    test("does not steal focus from a body that already claimed it", async () => {
      let doneFn: ((v: string) => void) | null = null;
      const promise = showDialog<string>((done) => {
        doneFn = done;
        return html`<sp-dialog-wrapper open
          ><input id="first" /><input id="second"
        /></sp-dialog-wrapper>`;
      });
      (layer("dialog").querySelector("#second") as HTMLElement).focus();
      await flush();
      expect((document.activeElement as HTMLElement).id).toBe("second");
      doneFn!("x");
      await promise;
    });

    test("Escape on a flow's dialog is the platform's cancel, and each helper maps it to its own value", async () => {
      const promise = showConfirmDialog("Hm", "really?");
      await flush();
      // The kit dialog is a native modal <dialog>: Escape reaches it as the platform's `cancel`,
      // Which the element dispatches on itself and the flow answers with false.
      const native = layer("dialog").querySelector('jx-dialog [part="dialog"]') as HTMLElement;
      native.dispatchEvent(new Event("cancel"));
      expect(await promise).toBe(false);
      expect(layer("dialog").children).toHaveLength(0);
    });

    test("Escape in a bespoke body with no wrapper is left to the body", async () => {
      let doneFn: ((v: string) => void) | null = null;
      const promise = showDialog<string>((done) => {
        doneFn = done;
        return html`<div id="bespoke">no wrapper here</div>`;
      });
      const body = layer("dialog").querySelector("#bespoke") as HTMLElement;
      body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      expect(layer("dialog").querySelector("#bespoke")).not.toBeNull();
      doneFn!("still here");
      expect(await promise).toBe("still here");
    });
  });

  describe("isModalOpen", () => {
    test("false when the layers are empty", () => {
      expect(isModalOpen()).toBe(false);
    });

    test("true while a dialog is up, false once it resolves", async () => {
      const promise = showConfirmDialog("Blocking?", "yes");
      await flush();
      // Open state is the platform's toggle, mirrored onto the host as data-open.
      expect(isModalOpen()).toBe(true);
      (layer("dialog").querySelector("jx-dialog") as HTMLElement).dispatchEvent(new Event("close"));
      await promise;
      expect(isModalOpen()).toBe(false);
    });

    test("true for an openModal body that paints its own underlay", () => {
      const handle = openModal(
        html`<sp-underlay open></sp-underlay>
          <div>settings</div>`,
        { label: "Settings" },
      );
      expect(isModalOpen()).toBe(true);
      handle.close();
      expect(isModalOpen()).toBe(false);
    });

    test("false for a modal-layer body with no underlay (the mouse still gets through)", () => {
      const handle = openModal(html`<div class="progress">working…</div>`, { label: "Working" });
      expect(isModalOpen()).toBe(false);
      handle.close();
    });
  });

  describe("showConfirmDialog", () => {
    /** The flow's dialog: the kit element, once its document has rendered. */
    async function dialog(): Promise<HTMLElement> {
      await flush();
      return layer("dialog").querySelector("jx-dialog") as HTMLElement;
    }
    const buttonText = (host: HTMLElement, part: string) =>
      host.querySelector(`[part="${part}"]`)?.textContent?.trim() ?? null;

    test("confirm resolves true with custom labels, on a kit dialog opened modally", async () => {
      const promise = showConfirmDialog("Delete?", "Gone for good", {
        cancelLabel: "Keep",
        confirmLabel: "Delete",
        destructive: true,
      });
      const host = await dialog();
      expect(host.getAttribute("headline")).toBe("Delete?");
      expect(host.querySelector('[part="message"]')?.textContent).toBe("Gone for good");
      expect(buttonText(host, "confirm")).toBe("Delete");
      expect(buttonText(host, "cancel")).toBe("Keep");
      expect(host.querySelector<HTMLElement>('[part="confirm"]')?.dataset["variant"]).toBe(
        "negative",
      );
      expect((host.querySelector('[part="dialog"]') as HTMLDialogElement).open).toBe(true);
      expect(host.parentElement?.dataset["jxRegion"]).toBe("overlay.dialog");
      host.dispatchEvent(new Event("confirm"));
      expect(await promise).toBe(true);
      expect(layer("dialog").querySelector("jx-dialog")).toBeNull();
    });

    test("close resolves false; defaults are non-destructive, and a lit message lands in the island", async () => {
      const promise = showConfirmDialog("Sure?", html`<em>rich</em>`);
      const host = await dialog();
      expect(buttonText(host, "confirm")).toBe("Confirm");
      expect(host.querySelector<HTMLElement>('[part="confirm"]')?.dataset["variant"]).toBe(
        "accent",
      );
      expect(host.querySelector('[part="island"] em')?.textContent).toBe("rich");
      expect(host.querySelector('[part="message"]')).toBeNull();
      host.dispatchEvent(new Event("close"));
      expect(await promise).toBe(false);
    });
  });

  describe("showSaveDiscardDialog", () => {
    async function dialog(): Promise<HTMLElement> {
      await flush();
      return layer("dialog").querySelector("jx-dialog") as HTMLElement;
    }

    test("confirm resolves 'save' with the given labels, and secondary resolves 'discard'", async () => {
      const promise = showSaveDiscardDialog("Unsaved", "Keep them?", {
        cancelLabel: "Back",
        discardLabel: "Throw away",
        saveLabel: "Keep",
      });
      const host = await dialog();
      const text = (part: string) => host.querySelector(`[part="${part}"]`)?.textContent?.trim();
      expect([text("confirm"), text("secondary"), text("cancel")]).toEqual([
        "Keep",
        "Throw away",
        "Back",
      ]);
      host.dispatchEvent(new Event("confirm"));
      expect(await promise).toBe("save");

      const second = showSaveDiscardDialog("Again", "?");
      const again = await dialog();
      again.dispatchEvent(new Event("secondary"));
      expect(await second).toBe("discard");
    });

    test("cancel and close both resolve 'cancel'", async () => {
      const cancelled = showSaveDiscardDialog("A", "?");
      const first = await dialog();
      first.dispatchEvent(new Event("cancel"));
      expect(await cancelled).toBe("cancel");
      const closed = showSaveDiscardDialog("B", "?");
      const second = await dialog();
      second.dispatchEvent(new Event("close"));
      expect(await closed).toBe("cancel");
    });
  });

  describe("showPromptDialog", () => {
    async function dialog(): Promise<HTMLElement> {
      await flush();
      return layer("dialog").querySelector("jx-dialog") as HTMLElement;
    }
    function field(): HTMLInputElement {
      return layer("dialog").querySelector('jx-textfield [part="input"]') as HTMLInputElement;
    }
    /** Type into the field the way the kit's input event reaches the flow. */
    function type(text: string): void {
      field().value = text;
      field().dispatchEvent(new Event("input", { bubbles: true }));
    }
    const errorText = () =>
      layer("dialog").querySelector('[part="error"]')?.textContent?.trim() ?? null;

    test("confirm resolves the trimmed value; defaults render OK/Cancel", async () => {
      const promise = showPromptDialog("Name it");
      const host = await dialog();
      expect(host.getAttribute("headline")).toBe("Name it");
      expect(host.querySelector('[part="confirm"]')?.textContent?.trim()).toBe("OK");
      expect(host.querySelector('[part="cancel"]')?.textContent?.trim()).toBe("Cancel");
      // No message option → no explanatory paragraph, and the field is named by the headline.
      expect(host.querySelector('[part="message"]')).toBeNull();
      expect(field().getAttribute("aria-label")).toBe("Name it");
      type("  spaced  ");
      host.dispatchEvent(new Event("confirm"));
      expect(await promise).toBe("spaced");
      expect(layer("dialog").querySelector("jx-dialog")).toBeNull();
    });

    test("cancel and close both resolve null", async () => {
      const cancelled = showPromptDialog("A");
      const first = await dialog();
      first.dispatchEvent(new Event("cancel"));
      expect(await cancelled).toBeNull();
      const closed = showPromptDialog("B");
      const second = await dialog();
      second.dispatchEvent(new Event("close"));
      expect(await closed).toBeNull();
    });

    test("Enter in the field confirms; other keys do not", async () => {
      const promise = showPromptDialog("C", { value: "seed" });
      await dialog();
      field().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
      await flush();
      expect(layer("dialog").querySelector("jx-dialog")).not.toBeNull();
      field().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      expect(await promise).toBe("seed");
    });

    test("a blank value blocks confirm and shows the default help text", async () => {
      const promise = showPromptDialog("D");
      const host = await dialog();
      host.dispatchEvent(new Event("confirm"));
      await flush();
      expect(layer("dialog").querySelector("jx-dialog")).not.toBeNull();
      expect(field().getAttribute("aria-invalid")).toBe("true");
      expect(errorText()).toBe("Enter a value.");
      /* Typing something valid empties the error in place, then confirm goes through. The region
         itself stays: it is the field's live region, and one minted with its text already inside
         announces nothing. `""` rather than `null` is what says it is still there. */
      type("ok");
      await flush();
      expect(errorText()).toBe("");
      expect(field().hasAttribute("aria-invalid")).toBe(false);
      host.dispatchEvent(new Event("confirm"));
      expect(await promise).toBe("ok");
    });

    test("a custom validate() message blocks confirm until it passes", async () => {
      const promise = showPromptDialog("E", {
        confirmLabel: "Create",
        message: "Pick a slug",
        validate: (v) => (v.startsWith("x") ? "" : "Must start with x."),
        value: "nope",
      });
      const host = await dialog();
      expect(host.querySelector('[part="message"]')?.textContent).toBe("Pick a slug");
      expect(host.querySelector('[part="confirm"]')?.textContent?.trim()).toBe("Create");
      host.dispatchEvent(new Event("confirm"));
      await flush();
      expect(errorText()).toBe("Must start with x.");
      type("xyz");
      host.dispatchEvent(new Event("confirm"));
      expect(await promise).toBe("xyz");
    });

    test("typing keeps the same field: the document reconciles, it never rebuilds", async () => {
      const promise = showPromptDialog("F");
      const host = await dialog();
      const before = field();
      type("aa");
      type("bb");
      await flush();
      expect(field() === before).toBe(true);
      host.dispatchEvent(new Event("confirm"));
      expect(await promise).toBe("bb");
    });

    test("select:'all' focuses the field and selects the whole value; 'stem' stops at the last dot", async () => {
      const all = showPromptDialog("G", { value: "hello" });
      let host = await dialog();
      await flush();
      expect(document.activeElement === field()).toBe(true);
      expect([field().selectionStart, field().selectionEnd]).toEqual([0, 5]);
      host.dispatchEvent(new Event("cancel"));
      await all;

      const stem = showPromptDialog("H", { select: "stem", value: "note.md" });
      host = await dialog();
      await flush();
      expect([field().selectionStart, field().selectionEnd]).toEqual([0, 4]);
      host.dispatchEvent(new Event("cancel"));
      await stem;

      const none = showPromptDialog("I", { select: "none", value: "as is" });
      host = await dialog();
      await flush();
      expect(document.activeElement === field()).toBe(true);
      host.dispatchEvent(new Event("cancel"));
      await none;
    });

    test("a choice renders as a native select, and a pick refreshes the placeholder and the options", async () => {
      const picked: string[] = [];
      let format = ".md";
      const promise = showPromptDialog("New file", {
        choice: {
          initial: ".md",
          label: "Format",
          onChange: (next) => {
            picked.push(next);
            format = next;
          },
          options: () => [
            { label: "Markdown", value: ".md" },
            { label: "JSON", value: ".json" },
          ],
        },
        placeholder: () => `untitled${format}`,
        validate: (v, chosen) => (v === "taken" && chosen === ".json" ? "taken.json exists." : ""),
        value: "taken",
      });
      const host = await dialog();
      const select = host.querySelector<HTMLSelectElement>('select[part="choice"]')!;
      expect(select.getAttribute("aria-label")).toBe("Format");
      expect([...select.options].map((o) => [o.value, o.textContent, o.selected])).toEqual([
        [".md", "Markdown", true],
        [".json", "JSON", false],
      ]);
      expect(field().placeholder).toBe("untitled.md");
      // Nothing said yet: the prefill is valid for the initial format, and nobody has typed.
      expect(errorText()).toBe("");
      select.value = ".json";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      expect(picked).toEqual([".json"]);
      expect(field().placeholder).toBe("untitled.json");
      // A pick never puts the first error under an untouched field…
      expect(errorText()).toBe("");
      // …but confirm still refuses, and from then on a pick refreshes the verdict.
      host.dispatchEvent(new Event("confirm"));
      await flush();
      expect(errorText()).toBe("taken.json exists.");
      select.value = ".md";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      expect(errorText()).toBe("");
      host.dispatchEvent(new Event("confirm"));
      expect(await promise).toBe("taken");
    });
  });
});
