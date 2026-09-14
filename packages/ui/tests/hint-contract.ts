/**
 * The `hint` contract `jx-action-button` and `jx-button` share, as one suite both test files run.
 *
 * ONE affordance per state, never both: an ENABLED button draws its hint as a `jx-tooltip` child of
 * its own element — shown on keyboard focus at once, hoverable, dismissible with Escape (WCAG 2.2
 * SC 1.4.13), named on the control as a DESCRIPTION — and a DISABLED button keeps it as the
 * control's native `title`, because a disabled control receives no focus and no pointer event and
 * could never open a tip, while the platform still shows a title on hover. The second half is why
 * this is a hybrid rather than a replacement: Studio's disabled buttons say WHY they cannot act
 * (`requires…`), and that is exactly the reader who hovers.
 */
import { describe, expect, test } from "bun:test";

import { documents } from "../src/documents.ts";

type Hinted = HTMLElement & { disabled: boolean; hint: string };

/** Let the runtime's mount microtask, the `$switch`, and the tip's own mount settle. */
const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/** The shim marks a showing popover with `data-popover-open`; `:popover-open` never matches here. */
const shown = (el: Element | null) =>
  el !== null && (el as HTMLElement).dataset["popoverOpen"] !== undefined;

const control = (el: Element) => el.querySelector<HTMLButtonElement>('[part="control"]')!;

/**
 * Keyboard focus, as the platform delivers it: the control IS focused when `focusin` fires. The
 * order matters, because the sidecar asks the focused element whether its focus is keyboard focus
 * (`:focus-visible`, which happy-dom answers as `:focus`) before it opens anything. happy-dom's
 * `focus()` dispatches the `focusin` itself, so the event is dispatched by hand only for a control
 * that already holds the focus — a second `focus()` there is a no-op.
 */
const focusIn = (el: HTMLElement) => {
  if (document.activeElement === el) {
    el.dispatchEvent(new Event("focusin", { bubbles: true }));
    return;
  }
  el.focus();
};
const tipOf = (el: Element) => el.querySelector<HTMLElement>('[part="tooltip"] > jx-tooltip');

/**
 * Register the hint suite for one element.
 *
 * @param tag The element under test.
 * @param make Renders one instance with the given attributes and waits for it to settle.
 */
export function describeHint(
  tag: "jx-action-button" | "jx-button",
  make: (attrs: Record<string, string>) => Promise<HTMLElement>,
): void {
  const idPattern = new RegExp(`^${tag}-\\d+$`);

  describe("hint", () => {
    test("an enabled button draws its hint as a jx-tooltip child, wired by id both ways", async () => {
      const el = await make({ hint: "Save the page (⌘S)", label: "Save" });
      const inner = control(el);
      const tip = tipOf(el);
      expect(tip).not.toBeNull();
      /* LIGHT DOM, and the element's own child: the kit's id references never cross a shadow
         boundary (ui.md §2), and a tip that lived anywhere else would be one more node a host had
         to place. Compared by value — `toBe` on a live element walks the whole DOM on failure. */
      expect(tip!.closest(tag) === el).toBe(true);
      expect(tip!.parentElement?.getAttribute("part")).toBe("tooltip");
      expect(tip!.getAttribute("role")).toBe("tooltip");
      expect(tip!.getAttribute("popover")).toBe("hint");
      expect(tip!.textContent).toBe("Save the page (⌘S)");
      // The pair is wired by id in both directions, from a stem the sidecar minted.
      expect(inner.id).toMatch(idPattern);
      expect(tip!.id).toBe(`${inner.id}-tip`);
      expect(inner.getAttribute("interestfor")).toBe(tip!.id);
      expect(tip!.getAttribute("for")).toBe(inner.id);
      // And the title is GONE: one affordance, not two.
      expect(inner.hasAttribute("title")).toBe(false);
    });

    test("the tip is the control's description, never its name, and never a tab stop", async () => {
      const el = await make({ hint: "Save the page (⌘S)", label: "Save" });
      const inner = control(el);
      const tip = tipOf(el)!;
      expect(inner.getAttribute("aria-describedby")).toBe(tip.id);
      expect(inner.getAttribute("aria-label")).toBe("Save");
      expect(inner.hasAttribute("aria-labelledby")).toBe(false);
      /* SC 1.4.13's content is read from the control it describes, so nothing in the tip may be
         reachable by Tab — or a keyboard reader lands on a box that vanishes as they leave the
         button. */
      expect(tip.hasAttribute("tabindex")).toBe(false);
      expect(tip.querySelector("[tabindex], button, a, input")).toBeNull();
    });

    test("a host's describedby follows the tip's id rather than replacing it", async () => {
      const el = await make({ describedby: "ext", hint: "Save the page", label: "Save" });
      expect(control(el).getAttribute("aria-describedby")).toBe(`${tipOf(el)!.id} ext`);
    });

    test("keyboard focus opens the tip at once, and Escape closes it (SC 1.4.13)", async () => {
      /* The whole reason the hint is no longer a title: a native title never shows on focus. On
         this engine there are no interest invokers, so the tip's own sidecar binds the control —
         which is the Firefox and Safari path — and the shim stands in for the popover API. */
      const el = await make({ hint: "Save the page", label: "Save" });
      const inner = control(el);
      const tip = tipOf(el)!;
      expect(shown(tip)).toBe(false);
      focusIn(inner);
      expect(shown(tip)).toBe(true);
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      expect(shown(tip)).toBe(false);
      // Focus again, then leave: the tip goes with the focus it was held up by.
      focusIn(inner);
      expect(shown(tip)).toBe(true);
      inner.dispatchEvent(new Event("focusout", { bubbles: true }));
      expect(shown(tip)).toBe(false);
    });

    test("on an engine with interest invokers the platform owns the pair, and nothing is bound", async () => {
      /* The path with no listener at all: the control declares `interestfor` at the tip, so the
         timers, the grace and Escape are the platform's and the sidecar adds nothing. Chrome 152
         has it; the desktop app's Chromium 147 does NOT, so Studio's own chrome is on the bound
         path below until the CEF bump reaches it. Made to look like Chrome BEFORE the pair mounts,
         because the decision is taken at the tip's own mount. */
      const proto = HTMLButtonElement.prototype as unknown as Record<string, unknown>;
      proto["interestForElement"] = null;
      try {
        const el = await make({ hint: "Save the page", label: "Save" });
        const inner = control(el);
        const tip = tipOf(el)!;
        expect(inner.getAttribute("interestfor")).toBe(tip.id);
        focusIn(inner);
        expect(shown(tip)).toBe(false);
      } finally {
        delete proto["interestForElement"];
      }
    });

    test("a click's focus does not open the tip, and keyboard focus does", async () => {
      /* On the fallback path every clicked button in Studio's chrome would otherwise pop its tip
         and keep it up while it held the focus — which the platform's interest invokers never do,
         since interest-on-focus is keyboard focus only. */
      const el = await make({ hint: "Save the page", label: "Save" });
      const inner = control(el);
      const tip = tipOf(el)!;
      inner.dispatchEvent(new Event("pointerenter", { bubbles: true }));
      inner.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      focusIn(inner);
      inner.dispatchEvent(new Event("pointerup", { bubbles: true }));
      inner.dispatchEvent(new Event("click", { bubbles: true }));
      expect(shown(tip)).toBe(false);
      inner.dispatchEvent(new Event("pointerleave", { bubbles: true }));
      inner.blur();
      inner.dispatchEvent(new Event("focusout", { bubbles: true }));
      // The same focus from the keyboard opens it at once.
      focusIn(inner);
      expect(shown(tip)).toBe(true);
      inner.dispatchEvent(new Event("focusout", { bubbles: true }));
      expect(shown(tip)).toBe(false);
    });

    test("a button that is MOVED keeps its tip: a keyed $map reorder and a re-parent", async () => {
      /* The runtime reorders kept `$map` rows with `before()` and a host re-parents a button into
         a toolbar the same way. Both fire `disconnectedCallback` then `connectedCallback` on the
         tip, and the second is a no-op for a mounted element, so nothing rebinds — an unmount that
         disposed at once left every reordered row without its tooltip, for good, on every engine
         without interest invokers. Twenty-seven Studio surfaces render hinted buttons in mapped
         rows. */
      const first = await make({ hint: "One", label: "A" });
      const second = await make({ hint: "Two", label: "B" });
      // A reorder, exactly as the runtime's reconcile spells it.
      first.before(second);
      await tick();
      const order = [...document.body.children];
      expect(order.indexOf(second)).toBeLessThan(order.indexOf(first));
      for (const el of [first, second]) {
        const inner = control(el);
        const tip = tipOf(el)!;
        expect(tip.isConnected).toBe(true);
        focusIn(inner);
        expect(shown(tip)).toBe(true);
        inner.dispatchEvent(new Event("focusout", { bubbles: true }));
        expect(shown(tip)).toBe(false);
      }
      // A re-parent, after the element settled.
      const wrapper = document.createElement("div");
      document.body.append(wrapper);
      wrapper.append(first);
      await tick();
      const inner = control(first);
      const tip = tipOf(first)!;
      focusIn(inner);
      expect(shown(tip)).toBe(true);
      inner.dispatchEvent(new Event("focusout", { bubbles: true }));
      // And a removal is still a removal: the binding goes one tick after the element does.
      first.remove();
      await tick();
      focusIn(inner);
      expect(shown(tip)).toBe(false);
    });

    test("a disabled button keeps the hint as a native title, because it can open no tip", async () => {
      const el = await make({ disabled: "", hint: "Save — requires a page", label: "Save" });
      const inner = control(el);
      expect(tipOf(el)).toBeNull();
      expect(inner.title).toBe("Save — requires a page");
      expect(inner.hasAttribute("interestfor")).toBe(false);
      expect(inner.hasAttribute("aria-describedby")).toBe(false);
    });

    test("toggling disabled at runtime swaps the two affordances", async () => {
      const el = (await make({ hint: "Save the page", label: "Save" })) as Hinted;
      const inner = control(el);
      const tip = tipOf(el)!;
      // Open, then disabled under the reader: the tip leaves with its element, not merely closes.
      focusIn(inner);
      expect(shown(tip)).toBe(true);
      el.disabled = true;
      await tick();
      expect(tipOf(el)).toBeNull();
      expect(tip.isConnected).toBe(false);
      expect(inner.title).toBe("Save the page");
      expect(inner.hasAttribute("aria-describedby")).toBe(false);
      /* And the listeners went with it: a focus on the re-enabled control must open the NEW tip,
         which is the only way to see that the old binding is gone rather than answering into a
         detached element. */
      el.disabled = false;
      await tick();
      const again = tipOf(el)!;
      expect(again).not.toBeNull();
      expect(again.id).toBe(tip.id);
      expect(inner.hasAttribute("title")).toBe(false);
      expect(inner.getAttribute("aria-describedby")).toBe(again.id);
      focusIn(inner);
      expect(shown(again)).toBe(true);
      expect(shown(tip)).toBe(false);
      inner.dispatchEvent(new Event("focusout", { bubbles: true }));
    });

    test("no hint draws neither, and the stem is still minted once per element", async () => {
      const el = await make({ label: "Save" });
      const inner = control(el);
      expect(tipOf(el)).toBeNull();
      expect(inner.hasAttribute("title")).toBe(false);
      expect(inner.hasAttribute("interestfor")).toBe(false);
      expect(inner.hasAttribute("aria-describedby")).toBe(false);
      expect(el.querySelector('[part="tooltip"]')!.childNodes).toHaveLength(0);
      expect(inner.id).toMatch(idPattern);
    });

    test("a hint a binding left null or undefined draws neither, like an empty one", async () => {
      /* A `$map` row that carries no hint hands the prop `undefined` through `$props`, and the
         switch used to be `hint !== ""` — which is true of undefined, so every such button rendered
         an empty tip. The test writes the property the way a binding does. */
      /* `HTMLElement & { hint: unknown }`, not `Hinted & …`: an intersection of `hint: string`
         with `hint: unknown` is `string`, and the two writes below are the point. */
      const el = (await make({ label: "Save" })) as HTMLElement & { hint: unknown };
      el.hint = null;
      await tick();
      expect(tipOf(el)).toBeNull();
      expect(control(el).hasAttribute("title")).toBe(false);
      el.hint = undefined;
      await tick();
      expect(tipOf(el)).toBeNull();
      el.hint = "Save the page";
      await tick();
      expect(tipOf(el)!.textContent).toBe("Save the page");
    });

    test("two buttons never share a stem", async () => {
      const a = await make({ hint: "One", label: "A" });
      const b = await make({ hint: "Two", label: "B" });
      expect(control(a).id).not.toBe(control(b).id);
      expect(tipOf(a)!.id).not.toBe(tipOf(b)!.id);
      expect(document.querySelectorAll(`#${tipOf(a)!.id}`)).toHaveLength(1);
    });

    test("a changed hint updates the tip's text in place", async () => {
      /* The text is a span the element owns rather than `textContent` on the tip: a reactive write
         of `textContent` on the tip's host would replace everything the tip rendered for itself —
         its arrow part included — on the first hint that changes under it. */
      const el = (await make({ hint: "Dock", label: "Dock" })) as Hinted;
      const tip = tipOf(el)!;
      expect(tip.querySelector('[part="arrow"]')).not.toBeNull();
      el.setAttribute("hint", "Undock");
      await tick();
      expect(tipOf(el)!.id).toBe(tip.id);
      expect(tip.textContent).toBe("Undock");
      expect(tip.querySelector('[part="arrow"]')).not.toBeNull();
    });

    test("the hint's slot generates no box, and the tip is registered before the button", () => {
      const doc = documents[tag]!;
      const style = doc.style as Record<string, Record<string, string>>;
      expect(style['& > [part="tooltip"]']!["display"]).toBe("contents");
      expect(JSON.stringify(doc.$elements)).toContain("./jx-tooltip.json");
      /* `defineElement` is awaited per document, and an element registered before a dependency it
         renders gets an HTMLUnknownElement child instead. */
      const order = Object.keys(documents);
      expect(order.indexOf("jx-tooltip")).toBeLessThan(order.indexOf(tag));
    });
  });
}
