/*
 * A definition whose render throws at connection (spec.md §16.4).
 *
 * `Intl/formatDate` of an empty date is a `RangeError`, as the standard says it is, and a card whose
 * `date` defaults to `""` therefore cannot render bare. The render runs inside the instance's async
 * `connectedCallback`, so the throw used to escape as an unhandled rejection that named no element:
 * a Studio preview or a canvas showing that card logged "Uncaught (in promise)" once per instance.
 * It is now reported the way a refused instance is (§16.9): a console line naming the tag and a
 * bubbling `jx-error` from the element, with the rest of the page rendering around it.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { defineElement, mount } from "../src/runtime";
import type { JxDocument } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

let uid = 0;
const uniqueTag = () => `rf-test-${(uid += 1)}`;

/** Let the async connectedCallbacks finish. */
const pause = (ms = 40) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

/** A definition that formats `state.date`, which defaults to a date that is not one. */
function datedCard(tagName: string, onMount = false): JxDocument {
  const state: NonNullable<JxDocument["state"]> = {
    date: "",
    opens: {
      $expression: {
        operator: "call",
        target: { $ref: "window#/Intl/formatDate" },
        value: [{ $ref: "#/state/date" }, "en", { day: "numeric", month: "long" }],
      },
    },
  };
  if (onMount) {
    state.onMount = {
      $prototype: "Function",
      body: [{ operator: "set", target: { $ref: "#/state/date" }, value: "mounted" }],
    };
  }
  return {
    children: [
      { tagName: "h3", textContent: "Before" },
      { tagName: "slot" },
      { tagName: "p", textContent: "${state.opens}" },
      { tagName: "p", textContent: "After" },
    ],
    state,
    tagName,
  };
}

describe("a render that throws at connection (spec.md §16.4)", () => {
  let errors: ReturnType<typeof spyOn<Console, "error">>;
  let host: HTMLElement;

  afterEach(() => {
    errors.mockRestore();
    host.remove();
  });

  const arm = () => {
    errors = spyOn(console, "error").mockImplementation(() => null);
    host = document.createElement("div");
    document.body.append(host);
  };

  test("is reported on the console and as a jx-error from the element, and the page renders", async () => {
    arm();
    const tag = uniqueTag();
    await defineElement(datedCard(tag));
    const seen: ErrorEvent[] = [];
    host.addEventListener("jx-error", (event) => {
      if (event instanceof ErrorEvent) {
        seen.push(event);
      }
    });

    await mount(
      {
        children: [
          { children: ["given"], tagName: tag },
          { tagName: "footer", textContent: "page footer" },
        ],
      },
      host,
    );
    await pause();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.error).toBeInstanceOf(RangeError);
    expect(seen[0]!.bubbles).toBe(true);
    expect(seen[0]!.target).toBe(host.querySelector(tag));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]![0])).toBe(`Jx: <${tag}> was not rendered:`);
    // What rendered before the throw stays, the page around it renders, and the slot drawn before it
    // Still receives what the page gave, rather than losing it.
    const card = host.querySelector(tag)!;
    expect(card.querySelector("h3")?.textContent).toBe("Before");
    expect(card.textContent).not.toContain("After");
    expect(card.textContent).toContain("given");
    expect(host.querySelector("footer")?.textContent).toBe("page footer");
  });

  test("onMount does not run for an instance that did not render", async () => {
    arm();
    const tag = uniqueTag();
    await defineElement(datedCard(tag, true));
    await mount({ children: [{ tagName: tag }] }, host);
    await pause();
    /* SAFETY: the instance defines an accessor for each public state entry its definition declares,
       and `date` is one; the query answers the one card just mounted. */
    const card = host.querySelector(tag) as (HTMLElement & { date?: string }) | null;
    expect(card).not.toBeNull();
    // The hook would have set the date; the property the definition exposes still reads its default.
    expect(card?.date).toBe("");
  });

  test("a host the page discarded before its render failed reports nothing", async () => {
    arm();
    const tag = uniqueTag();
    await defineElement(datedCard(tag));
    const card = document.createElement(tag);
    host.append(card);
    // Gone before the scope it awaits is built, so the render runs on a detached host.
    card.remove();
    await pause();
    expect(errors.mock.calls).toEqual([]);
    expect(card.querySelector("h3")?.textContent).toBe("Before");
  });
});
