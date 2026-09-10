/**
 * Ui/layers — showDialog/showConfirmDialog resolution, renderPopover dismissal (outside click,
 * layer targeting), and named layer slots.
 */
import { flush, mountOverlayLayers } from "./harness";
import { beforeAll, describe, expect, test } from "bun:test";
import { html } from "lit-html";
import {
  clearLayerSlot,
  getLayerSlot,
  initLayers,
  isModalOpen,
  renderPopover,
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

    test("Escape in a bespoke body with no wrapper is left to the body, and not swallowed", async () => {
      let doneFn: ((v: string) => void) | null = null;
      const promise = showDialog<string>((done) => {
        doneFn = done;
        return html`<div id="bespoke">no wrapper here</div>`;
      });
      const body = layer("dialog").querySelector("#bespoke") as HTMLElement;
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      });
      body.dispatchEvent(event);
      expect(layer("dialog").querySelector("#bespoke")).not.toBeNull();
      // A slot that will not answer the key must not eat it either — the body still gets its turn.
      expect(event.defaultPrevented).toBe(false);
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

    test("true for a jx-dialog surface open in the MODAL layer", () => {
      /* The modal layer is read beside the dialog layer for the two surfaces that live in it —
         `surfaces/progress-modal.ts` and `surfaces/publish.ts`, both `jx-dialog`s. `data-open` is
         how the element mirrors the platform's own toggle (`jx-dialog.json`), so the predicate asks
         the DOM what is covering the app rather than keeping a count. */
      const slot = document.createElement("div");
      const dialog = document.createElement("jx-dialog");
      dialog.dataset.open = "";
      slot.append(dialog);
      layer("modal").append(slot);
      expect(isModalOpen()).toBe(true);
      slot.remove();
      expect(isModalOpen()).toBe(false);
    });

    test("false for a modal-layer body with no underlay (the mouse still gets through)", () => {
      const slot = document.createElement("div");
      slot.append(document.createElement("jx-dialog"));
      layer("modal").append(slot);
      expect(isModalOpen()).toBe(false);
      slot.remove();
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
      layer("dialog").querySelector('jx-textfield [part="error"]')?.textContent?.trim() ?? null;

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

    /* A paste box is this same flow with a taller field, not a second dialog (§12.5) — which is
       what the redirects import needed. Two things have to change together for that to be usable:
       the control becomes a `<textarea>`, and Enter stops confirming, because Enter on the second
       line of a pasted `_redirects` file would submit the dialog mid-paste. */
    test("a multiline prompt is a textarea, and Enter in it is a newline rather than a confirm", async () => {
      const promise = showPromptDialog("Paste", { multiline: true, mono: true, rows: "10" });
      const host = await dialog();
      const box = host.querySelector("jx-textfield textarea") as HTMLTextAreaElement;
      expect(box).not.toBeNull();
      expect(host.querySelector('jx-textfield [part="input"]')?.tagName).toBe("TEXTAREA");

      box.value = "/old  /new  301";
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await flush();
      expect(layer("dialog").querySelector("jx-dialog")).not.toBeNull();

      host.dispatchEvent(new Event("confirm"));
      expect(await promise).toBe("/old  /new  301");
    });

    test("a single-line prompt still confirms on Enter", async () => {
      const promise = showPromptDialog("Name", { value: "seed" });
      await dialog();
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
      /* The part is on the `jx-select`; the `<select>` inside it is what a reader drives, and what
         carries the name the element forwarded. Selectedness is read off the CONTROL rather than
         off an option's attribute — no option carries one, which is the whole point (ui.md §5.1). */
      const choice = host.querySelector<HTMLElement>('jx-select[part="choice"]')!;
      const select = choice.querySelector<HTMLSelectElement>("select")!;
      expect(select.getAttribute("aria-label")).toBe("Format");
      expect([...select.options].map((o) => [o.value, o.textContent?.trim()])).toEqual([
        [".md", "Markdown"],
        [".json", "JSON"],
      ]);
      expect(select.value).toBe(".md");
      expect(host.querySelector("option[selected]")).toBeNull();
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

  // ─── The keyboard contract the slot owns, not the body ─────────────────────

  /** Dispatch a keydown on an overlay slot and hand back the event, to read what it did with it. */
  function key(slot: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    slot.dispatchEvent(event);
    return event;
  }

  describe("Escape in a showDialog body that HAS a wrapper", () => {
    test("fires the wrapper's own close, and stops there", async () => {
      /* The counterpart to "a bespoke body owns its own keys": when there is a wrapper, Escape is
         translated into the `close` event each helper's `@close` binding already answers, so no
         helper needs a keydown listener of its own. */
      const reachedApp: Event[] = [];
      const listener = (e: Event) => {
        reachedApp.push(e);
      };
      document.body.addEventListener("keydown", listener);
      const promise = showDialog<string>(
        (done) =>
          html`<sp-dialog-wrapper
            headline="Rename"
            @close=${() => {
              done("dismissed");
            }}
          ></sp-dialog-wrapper>`,
      );
      const slot = layer("dialog").querySelector("[role='dialog']") as HTMLElement;
      const event = key(slot, { key: "Escape" });
      document.body.removeEventListener("keydown", listener);

      expect(await promise).toBe("dismissed");
      expect(layer("dialog").querySelector("sp-dialog-wrapper")).toBeNull();
      expect(event.defaultPrevented).toBe(true);
      expect(reachedApp).toEqual([]);
    });

    test("the body's `@close` DECIDES: one that does not resolve keeps the dialog up", async () => {
      /* Escape is translated into the wrapper's `close`; it is not a close. A body with bookkeeping
         of its own — a flow mid-step, a running operation — answers the event and stays up, and
         nothing takes the surface down until its own `done()` runs. */
      const dismissed: number[] = [];
      let doneFn: ((v: string) => void) | null = null;
      const promise = showDialog<string>((done) => {
        doneFn = done;
        return html`<sp-dialog-wrapper
          headline="Held"
          @close=${() => {
            dismissed.push(1);
          }}
        >
          <p id="held">busy</p>
        </sp-dialog-wrapper>`;
      });
      const slot = layer("dialog").querySelector("[role='dialog']") as HTMLElement;
      key(slot, { key: "Escape" });
      expect(dismissed).toEqual([1]);
      expect(layer("dialog").querySelector("#held")).not.toBeNull();

      doneFn!("closed by the body");
      expect(await promise).toBe("closed by the body");
      expect(layer("dialog").querySelector("#held")).toBeNull();
    });
  });

  describe("a key the slot does not answer", () => {
    test("is left entirely alone", async () => {
      let doneFn: ((v: string) => void) | null = null;
      const promise = showDialog<string>((done) => {
        doneFn = done;
        return html`<button id="only">only</button>`;
      });
      const slot = layer("dialog").querySelector("[role='dialog']") as HTMLElement;
      slot.querySelector<HTMLElement>("#only")!.focus();
      const event = key(slot, { key: "a" });
      expect(event.defaultPrevented).toBe(false);
      expect((document.activeElement as HTMLElement).id).toBe("only");
      doneFn!("x");
      await promise;
    });
  });

  describe("renderPopover", () => {
    test("update() re-renders into the same slot rather than opening a second popover", () => {
      const handle = renderPopover(html`<p id="pop">first</p>`, { dismissOnOutsideClick: false });
      const slot = handle.host;
      expect(slot.parentElement).toBe(layer("popover"));
      handle.update(html`<p id="pop">second</p>`);
      expect(slot.querySelector("#pop")?.textContent).toBe("second");
      // Same node: an owner holding `handle.host` (the zoom indicator does) keeps its reference.
      expect(handle.host).toBe(slot);
      handle.dismiss();
      expect(slot.parentElement).toBeNull();
    });
  });
});
