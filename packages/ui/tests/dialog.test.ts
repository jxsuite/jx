import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { registerUi } from "../src/index.ts";
import { close, showModal } from "../src/behaviors/dialog.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxDialog = HTMLElement & { open: boolean; headline: string; destructive: boolean };

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

async function dialog(
  attrs: Record<string, string> = {},
  body = "Are you sure?",
): Promise<JxDialog> {
  const el = document.createElement("jx-dialog") as JxDialog;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  el.append(body);
  document.body.append(el);
  await tick();
  return el;
}
const inner = (el: Element) => el.querySelector<HTMLDialogElement>('[part="dialog"]')!;
const part = (el: Element, name: string) => el.querySelector<HTMLElement>(`[part="${name}"]`);
const buttonIn = (el: Element, name: string) =>
  part(el, name)?.querySelector<HTMLButtonElement>('[part="control"]') ?? null;

describe("jx-dialog", () => {
  test("is a native dialog named by its headline, with the reader's answers as buttons", async () => {
    const el = await dialog({
      headline: "Delete page?",
      "confirm-label": "Delete",
      "cancel-label": "Keep",
    });
    expect(inner(el).tagName).toBe("DIALOG");
    expect(inner(el).getAttribute("aria-label")).toBe("Delete page?");
    expect(part(el, "headline")?.textContent).toBe("Delete page?");
    expect(part(el, "body")?.textContent).toContain("Are you sure?");
    expect(buttonIn(el, "confirm")?.textContent?.trim()).toBe("Delete");
    expect(buttonIn(el, "cancel")?.textContent?.trim()).toBe("Keep");
    expect(part(el, "secondary")).toBeNull();
    // Closed at rest, and not dismissible by a stray click unless asked.
    expect(inner(el).open).toBe(false);
    expect(inner(el).getAttribute("closedby")).toBe("closerequest");
  });

  test("announces jx-ready once it has rendered its native dialog", async () => {
    const el = document.createElement("jx-dialog") as JxDialog;
    const ready = new Promise<boolean>((resolve) => {
      el.addEventListener("jx-ready", () => resolve(inner(el) !== null), { once: true });
    });
    document.body.append(el);
    expect(await ready).toBe(true);
  });

  test("showModal opens it modally, mirrors open, and close closes it", async () => {
    const el = await dialog({ headline: "Rename" });
    showModal(el);
    await tick();
    expect(inner(el).open).toBe(true);
    expect(el.open).toBe(true);
    expect(el.dataset["open"]).toBeDefined();
    showModal(el);
    expect(inner(el).open).toBe(true);
    const closed: string[] = [];
    el.addEventListener("close", () => closed.push("close"));
    close(el, "done");
    await tick();
    expect(inner(el).open).toBe(false);
    expect(el.open).toBe(false);
    expect(inner(el).returnValue).toBe("done");
    expect(closed).toEqual(["close"]);
  });

  test("confirm dispatches confirm and leaves the dialog open; cancel says so and closes", async () => {
    const el = await dialog({ headline: "Save?", "secondary-label": "Discard" });
    showModal(el);
    await tick();
    const heard: string[] = [];
    for (const name of ["confirm", "secondary", "cancel", "close"]) {
      el.addEventListener(name, () => heard.push(name));
    }
    buttonIn(el, "confirm")!.click();
    expect(heard).toEqual(["confirm"]);
    expect(inner(el).open).toBe(true);
    buttonIn(el, "secondary")!.click();
    expect(heard).toEqual(["confirm", "secondary"]);
    buttonIn(el, "cancel")!.click();
    await tick();
    expect(heard).toEqual(["confirm", "secondary", "cancel", "close"]);
    expect(inner(el).open).toBe(false);
  });

  test("the platform's cancel (Escape, a light dismissal) is dispatched as cancel", async () => {
    const el = await dialog({ headline: "Hm", dismissible: "" });
    expect(inner(el).getAttribute("closedby")).toBe("any");
    showModal(el);
    await tick();
    const heard: string[] = [];
    el.addEventListener("cancel", () => heard.push("cancel"));
    inner(el).dispatchEvent(new Event("cancel"));
    expect(heard).toEqual(["cancel"]);
    expect(el.open).toBe(false);
  });

  test("a --show invoker command opens it and --close closes it, so a page needs no script", async () => {
    const el = await dialog({ headline: "Invoked" });
    const command = (name: string) =>
      Object.assign(new Event("command", { bubbles: true }), { command: name });
    el.dispatchEvent(command("--show"));
    await tick();
    expect(inner(el).open).toBe(true);
    el.dispatchEvent(command("--close"));
    await tick();
    expect(inner(el).open).toBe(false);
    // A built-in command never reaches a custom element; an unknown custom one does nothing.
    el.dispatchEvent(command("--dance"));
    expect(inner(el).open).toBe(false);
  });

  test("Enter never lands on a destructive action: focus goes to confirm, or to cancel when it destroys", async () => {
    /*
     * `showModal()` focuses the first focusable descendant unless something claims `autofocus`, and
     * the footer's DOM order is secondary, cancel, confirm — so an unclaimed save-or-discard dialog
     * opened with focus on DISCARD, and a reader answering the way people answer dialogs, with
     * Enter, threw their work away. Measured in Chrome 152 before this attribute existed.
     */
    const saveOrDiscard = await dialog({
      "cancel-label": "Cancel",
      "confirm-label": "Save",
      headline: "Unsaved changes",
      "secondary-label": "Discard",
    });
    expect(buttonIn(saveOrDiscard, "confirm")?.hasAttribute("autofocus")).toBe(true);
    expect(buttonIn(saveOrDiscard, "cancel")?.hasAttribute("autofocus")).toBe(false);

    // A destructive primary hands it to the safe answer instead.
    const destructive = await dialog({
      "confirm-label": "Delete",
      destructive: "",
      headline: "Delete page?",
    });
    expect(buttonIn(destructive, "confirm")?.hasAttribute("autofocus")).toBe(false);
    expect(buttonIn(destructive, "cancel")?.hasAttribute("autofocus")).toBe(true);
  });

  test("destructive draws the primary action in the negative variant; size and empty labels", async () => {
    const el = await dialog({
      destructive: "",
      "cancel-label": "",
      "confirm-label": "Erase",
      size: "lg",
    });
    expect(part(el, "confirm")?.dataset["variant"]).toBe("negative");
    expect(el.dataset["size"]).toBe("lg");
    expect(part(el, "cancel")).toBeNull();
    expect(part(el, "header")?.childElementCount).toBe(0);
    const plain = await dialog({ headline: "Plain" });
    expect(part(plain, "confirm")?.dataset["variant"]).toBe("accent");
  });
});
