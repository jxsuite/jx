/**
 * The one blocking progress surface (`ui/progress-modal.ts` and
 * `src/surfaces/progress-modal.json`).
 *
 * What is worth pinning is what §7.3 changed: the modal is no longer the operation's only memory
 * (every one of them leaves an Activity entry behind), it is no longer inescapable (`Run in the
 * background` and Escape both hand the app back while the work continues), and it no longer owns
 * the error view — a failure is a Problem, with the captured log as its detail.
 *
 * Everything is addressed by `part`, because the surface is a document: there is no
 * `.progress-modal` to find any more, and the fixed card, its `sp-underlay` scrim and the `z-index:
 * 1000` that card needed to climb out from under it all belong to `jx-dialog` now.
 */
import { flush, pointer } from "./harness";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { initLayers, isModalOpen } from "../src/ui/layers";
import { showProgressModal } from "../src/ui/progress-modal";
import { activities, resetActivities } from "../src/panels/activity-panel";
import { problems, resetNotifications } from "../src/services/notify";
import { shell } from "../src/shell";

beforeAll(() => {
  for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
    if (!document.querySelector(`#${id}`)) {
      const el = document.createElement("div");
      el.id = id;
      document.body.append(el);
    }
  }
  initLayers();
});

function modalLayer(): HTMLElement {
  return document.querySelector("#layer-modal") as HTMLElement;
}

function card(): HTMLElement | null {
  return modalLayer().querySelector('jx-dialog[part="progress"]');
}

/**
 * Open it and wait twice: the mount resolving means the DOCUMENT rendered, and the `jx-dialog`'s
 * own template is one `connectedCallback` after that.
 */
async function open(opts: Parameters<typeof showProgressModal>[0]) {
  const handle = showProgressModal(opts);
  await flush();
  await flush();
  return handle;
}

/** Escape, as a native `<dialog>` raises it: the platform's `cancel`, not a keydown we listen for. */
function escape(): void {
  card()?.dispatchEvent(new Event("cancel", { bubbles: true }));
}

function answer(part: "confirm" | "secondary"): HTMLElement | null {
  return card()?.querySelector<HTMLElement>(`[part="${part}"]`) ?? null;
}

afterEach(async () => {
  escape();
  await flush();
  modalLayer().innerHTML = "";
  resetActivities();
  resetNotifications();
  shell.docks.bottom.collapsed = true;
});

describe("showProgressModal", () => {
  test("renders a running view with spinner, title and status", async () => {
    const h = await open({ status: "Running…", title: "Installing" });
    expect(card()).not.toBeNull();
    expect(card()?.querySelector("jx-spinner")).not.toBeNull();
    // The operation's name is the dialog's headline, which is also its accessible name.
    expect(card()?.querySelector('[part="headline"]')?.textContent).toBe("Installing");
    expect(card()?.querySelector('[part="status"]')?.textContent).toBe("Running…");
    h.done();
  });

  test("is shown MODALLY, not merely rendered", async () => {
    /* The trap: `mountSurface` resolving means the document rendered, while the element's own
       template is one `connectedCallback` later — so `showModal` in between finds no `<dialog>` to
       open, and every assertion about content passes against a surface nobody can see. */
    const h = await open({ title: "Installing" });
    expect(card()?.querySelector("dialog")?.open).toBe(true);
    // And no scrim of its own: a modal `<dialog>` is in the top layer with a backdrop it owns.
    expect(modalLayer().querySelector("sp-underlay")).toBeNull();
    /* The app's keyboard handlers stand down while a blocking surface is up, and what they read is
       the live DOM. The scrim used to be the evidence; `jx-dialog[data-open]` is now, so an
       install still cannot be interrupted by ⌘S or Delete landing on the document behind it. */
    expect(isModalOpen()).toBe(true);
    h.done();
  });

  test("the operation is recorded in Activity, blocking or not", async () => {
    const h = await open({ source: "Packages", status: "Running…", title: "Installing" });
    expect(activities).toHaveLength(1);
    expect(activities[0]?.title).toBe("Installing");
    expect(activities[0]?.source).toBe("Packages");
    expect(activities[0]?.state).toBe("running");
    h.done();
    // The entry OUTLIVES the modal — that is the whole point of promoting it out of here.
    expect(card()).toBeNull();
    expect(activities[0]?.state).toBe("done");
  });

  test("setStatus updates the status line and the entry together", async () => {
    const h = await open({ title: "Installing" });
    h.setStatus("Linking…");
    await flush();
    expect(card()?.querySelector('[part="status"]')?.textContent).toBe("Linking…");
    expect(activities[0]?.status).toBe("Linking…");
    h.done();
  });

  test("log() goes to the entry, not to the modal", async () => {
    const h = await open({ title: "Installing" });
    h.log("resolving 40 packages");
    expect(activities[0]?.log).toEqual(["resolving 40 packages"]);
    expect(card()?.textContent).not.toContain("resolving 40 packages");
    h.done();
  });

  test("done() removes the modal, slot and all", async () => {
    const h = await open({ title: "Installing" });
    expect(modalLayer().childElementCount).toBe(1);
    h.done();
    expect(card()).toBeNull();
    // The slot is created per open; one left behind would stack up over an app's lifetime.
    expect(modalLayer().childElementCount).toBe(0);
  });

  test("an operation that ends before the surface lands leaves nothing behind", async () => {
    /* The mount is asynchronous and the flow is not: `ensure-deps` can find the dependencies
       already installed and call `done()` in the same turn it opened the modal. The document must
       then be disposed as it arrives rather than shown to nobody, and the slot must go with it. */
    const h = showProgressModal({ title: "Installing" });
    h.done();
    await flush();
    await flush();
    expect(card()).toBeNull();
    expect(modalLayer().childElementCount).toBe(0);
    expect(activities[0]?.state).toBe("done");
  });

  test("Run in the background keeps the work and shows it where it lives", async () => {
    const h = await open({ title: "Installing" });
    expect(card()?.querySelector('[part="confirm-label"]')?.textContent).toBe(
      "Run in the background",
    );
    pointer(answer("confirm")!, "click");
    await flush();
    expect(card()).toBeNull();
    expect(activities[0]?.state).toBe("running");
    // "Where it lives" is the Bottom dock's Activity tab, opened by the same setter ⌘J writes.
    expect(shell.bottomTab).toBe("activity");
    expect(shell.docks.bottom.collapsed).toBe(false);
    h.done();
  });

  test("Escape means the same thing the button does — stop blocking, not stop working", async () => {
    /* One `cancel` covers Escape, a light dismissal and a cancel button alike, so the answer that
       STOPS the work cannot be the cancel one: a keystroke must never abort a dependency install. */
    const h = await open({
      cancel: () => {
        throw new Error("Escape must not stop the work");
      },
      title: "Installing",
    });
    escape();
    await flush();
    expect(card()).toBeNull();
    expect(activities[0]?.state).toBe("running");
    h.done();
  });

  test("Cancel appears only when the operation handed one over, and it stops the work", async () => {
    let stopped = 0;
    const plain = await open({ title: "Installing" });
    expect(answer("secondary")).toBeNull();
    plain.done();

    await open({
      cancel: () => {
        stopped += 1;
      },
      title: "Installing",
    });
    expect(card()?.querySelector('[part="secondary-label"]')?.textContent).toBe("Cancel");
    pointer(answer("secondary")!, "click");
    await flush();
    expect(stopped).toBe(1);
    expect(card()).toBeNull();
  });

  test("a one-line failure is its own headline in Problems", async () => {
    const h = await open({ source: "Packages", title: "Installing" });
    h.fail("EACCES denied");
    await flush();
    expect(card()).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toBe("EACCES denied");
    expect(problems[0]?.source).toBe("Packages");
  });

  test("a captured log becomes the detail, under a headline that names the operation", async () => {
    const h = await open({ title: "Installing" });
    h.fail("error: no matching version\n  at bun install\n  giving up");
    await flush();
    // Three of the four call sites pass `result.log` as their message. A Problems list whose first
    // Row is 400 lines of `bun` output is not a list.
    expect(problems[0]?.message).toBe("Installing failed");
    expect(problems[0]?.detail).toContain("no matching version");
    expect(activities[0]?.state).toBe("failed");
  });

  test("an empty failure still says something", async () => {
    const h = await open({ title: "Installing" });
    h.fail("");
    expect(problems[0]?.message).toBe("Installing failed");
  });

  test("setStatus/fail after done are no-ops", async () => {
    const h = await open({ title: "Installing" });
    h.done();
    h.setStatus("late");
    h.fail("late");
    h.done();
    expect(card()).toBeNull();
    expect(problems).toHaveLength(0);
    expect(activities[0]?.state).toBe("done");
  });
});
