/**
 * The shared empty state as a DOCUMENT (`src/surfaces/empty-state.json`).
 *
 * `tests/empty-state.test.ts` beside this one pins the copy vocabulary — the shared verb, the
 * stale-selection sentence, `openPageAction` — and the lit template the expression editor still
 * renders. This pins the other half: what the document draws from a spec, and the seam every lit
 * region hands its box to.
 */
import { flush } from "./harness";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { html, render as litRender, nothing } from "lit-html";
import { createEmptyStateSurface, emptyState } from "../src/surfaces/empty-state";
import type { EmptyStateSpec } from "../src/panels/empty-state";

const hosts: HTMLElement[] = [];

/** Mount the document into a detached box and hand back the element it drew. */
async function draw(spec: EmptyStateSpec): Promise<HTMLElement> {
  const box = document.createElement("div");
  document.body.append(box);
  hosts.push(box);
  const surface = createEmptyStateSurface(spec);
  box.append(surface.host);
  await flush();
  return box;
}

function part(root: ParentNode, name: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[part="${name}"]`);
}

/**
 * A kit button's own control.
 *
 * `jx-button` draws a native `<button part="control">`, and that is the node `disabled` lands on
 * and the node a press has to reach: a click dispatched at the HOST runs the host's listener
 * whatever the control says, so asserting through it is what makes the disabled state mean
 * anything.
 */
function control(button: Element | null): HTMLButtonElement | null {
  return button?.querySelector<HTMLButtonElement>('[part="control"]') ?? null;
}

afterEach(() => {
  for (const host of hosts.splice(0)) {
    host.remove();
  }
});

describe("the empty-state document", () => {
  test("draws the sentence, and neither a detail line nor an action row when there are none", async () => {
    const box = await draw({ message: "Open a page to see the elements it is built from." });
    expect(part(box, "empty-message")?.textContent).toBe(
      "Open a page to see the elements it is built from.",
    );
    expect(part(box, "empty-detail")).toBeNull();
    expect(part(box, "empty-actions")).toBeNull();
  });

  test("draws the optional second sentence", async () => {
    const box = await draw({ detail: "It comes from project.json.", message: "Nothing yet." });
    expect(part(box, "empty-detail")?.textContent).toBe("It comes from project.json.");
  });

  test("an empty detail string is no detail, not an empty line", async () => {
    /* A producer passing its own optional through — `detail: held ? "…" : ""` — means "no second
       sentence", and a `<p>` with nothing in it is a gap the reader has to account for. */
    const box = await draw({ detail: "", message: "Nothing yet." });
    expect(part(box, "empty-detail")).toBeNull();
  });

  test("an action is a real button that runs its handler", async () => {
    let ran = 0;
    const box = await draw({
      actions: [
        {
          label: "Add a value",
          run: () => {
            ran += 1;
          },
        },
      ],
      message: "Data lives here.",
    });
    const button = part(box, "empty-action")!;
    expect(button.textContent?.trim()).toBe("Add a value");
    control(button)!.click();
    await flush();
    expect(ran).toBe(1);
  });

  test("several actions keep their own handlers, and a disabled one says so", async () => {
    /* Positional, and that is the contract worth pinning: the document addresses a press by the
       row's slot in the list, so two actions must not share one handler. */
    const ran: string[] = [];
    const box = await draw({
      actions: [
        { disabled: true, label: "Initialize Repository", run: () => ran.push("init") },
        { label: "Create GitHub repository", run: () => ran.push("create") },
      ],
      message: "This project is not tracked by git yet.",
    });
    const buttons = [...box.querySelectorAll<HTMLElement>('[part="empty-action"]')];
    expect(buttons).toHaveLength(2);
    expect(control(buttons[0]!)!.disabled).toBe(true);
    expect(control(buttons[1]!)!.disabled).toBe(false);
    control(buttons[1]!)!.click();
    await flush();
    expect(ran).toEqual(["create"]);
  });

  test("compact marks the inline variant that sits above its own add form", async () => {
    const compact = await draw({ compact: true, message: "No commits yet." });
    expect(part(compact, "empty")!.dataset["compact"]).toBe("");
    const full = await draw({ message: "No commits yet." });
    expect(part(full, "empty")!.dataset["compact"]).toBeUndefined();
  });

  test("update assigns rather than remounting — the same element keeps saying the new thing", async () => {
    const box = document.createElement("div");
    document.body.append(box);
    hosts.push(box);
    const surface = createEmptyStateSurface({ message: "First." });
    box.append(surface.host);
    await flush();
    const before = part(box, "empty");

    surface.update({ actions: [{ label: "Do it", run: () => {} }], message: "Second." });
    await flush();

    expect(part(box, "empty")).toBe(before);
    expect(part(box, "empty-message")?.textContent).toBe("Second.");
    expect(part(box, "empty-action")?.textContent?.trim()).toBe("Do it");
  });

  test("dispose gives the host back empty", async () => {
    const box = document.createElement("div");
    document.body.append(box);
    hosts.push(box);
    const surface = createEmptyStateSurface({ message: "Gone in a moment." });
    box.append(surface.host);
    await flush();
    expect(part(box, "empty")).not.toBeNull();

    surface.dispose();
    expect(part(box, "empty")).toBeNull();
  });

  test("disposing before the mount settles leaves nothing behind", async () => {
    const box = document.createElement("div");
    document.body.append(box);
    hosts.push(box);
    const surface = createEmptyStateSurface({ message: "Never seen." });
    box.append(surface.host);
    surface.dispose();
    await flush();
    expect(part(box, "empty")).toBeNull();
  });
});

describe("the lit seam", () => {
  test("one surface per owner: a repaint assigns, it does not mount a second document", async () => {
    const owner = document.createElement("div");
    document.body.append(owner);
    hosts.push(owner);

    litRender(html`${emptyState(owner, { message: "First." })}`, owner);
    await flush();
    const first = part(owner, "empty");

    litRender(html`${emptyState(owner, { message: "Second." })}`, owner);
    await flush();

    expect(owner.querySelectorAll('[part="empty"]')).toHaveLength(1);
    expect(part(owner, "empty")).toBe(first);
    expect(part(owner, "empty-message")?.textContent).toBe("Second.");
  });

  test("the document survives the region flipping to its own markup and back", async () => {
    /* The whole reason the surface owns its host: a Navigator body draws a panel OR this, and lit
       takes the node out and puts it back. A rebuild on every flip would be a remount per repaint,
       which is what a keyed node exists to avoid. */
    const owner = document.createElement("div");
    document.body.append(owner);
    hosts.push(owner);

    litRender(html`${emptyState(owner, { message: "Nothing here." })}`, owner);
    await flush();
    const drawn = part(owner, "empty");

    litRender(html`<p class="content">Something here.</p>`, owner);
    await flush();
    expect(part(owner, "empty")).toBeNull();

    litRender(html`${emptyState(owner, { message: "Nothing here again." })}`, owner);
    await flush();
    expect(part(owner, "empty")).toBe(drawn);
    expect(part(owner, "empty-message")?.textContent).toBe("Nothing here again.");
  });

  test("two owners get two surfaces", async () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    document.body.append(a, b);
    hosts.push(a, b);

    litRender(html`${emptyState(a, { message: "A." })}`, a);
    litRender(html`${emptyState(b, { message: "B." })}`, b);
    await flush();

    expect(part(a, "empty-message")?.textContent).toBe("A.");
    expect(part(b, "empty-message")?.textContent).toBe("B.");
  });

  test("lit clearing the region leaves the document standing, ready to be handed back", async () => {
    const owner = document.createElement("div");
    document.body.append(owner);
    hosts.push(owner);
    const ran = mock(() => {});

    litRender(
      html`${emptyState(owner, { actions: [{ label: "Go", run: ran }], message: "X." })}`,
      owner,
    );
    await flush();
    litRender(nothing, owner);
    litRender(
      html`${emptyState(owner, { actions: [{ label: "Go", run: ran }], message: "X." })}`,
      owner,
    );
    await flush();

    control(part(owner, "empty-action"))!.click();
    await flush();
    expect(ran).toHaveBeenCalledTimes(1);
  });
});
