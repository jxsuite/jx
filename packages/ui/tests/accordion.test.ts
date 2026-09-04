import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { documentStyleText } from "@jxsuite/runtime";
import { buildStyleRules } from "@jxsuite/runtime/css";
import { findA11yDefects } from "@jxsuite/schema/a11y";
import { findPopoverDefects } from "@jxsuite/schema/overlays";
import type { JxElement, JxStyle } from "@jxsuite/schema/types";

import { documents, INVOKER_TAGS, POPOVER_TAGS } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxAccordionItem = HTMLElement & {
  label: string;
  open: boolean;
  name: string;
  level: string;
};

/** Every rule an element's own style block emits, under a stand-in scope handle. */
const sheetOf = (tag: string): string[] =>
  buildStyleRules(documents[tag]!.style as JxStyle, { scope: "S" }).map((rule) => rule.text);

const sheet = () => sheetOf("jx-accordion-item");

const page = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../stylebook/jx-accordion-item.json"), "utf8"),
) as JxElement;

const containerPage = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../stylebook/jx-accordion.json"), "utf8"),
) as JxElement;

/** Every node in a document tree, so a gate cannot be dodged by nesting one level deeper. */
function walk(node: JxElement): JxElement[] {
  const kids = (node.children ?? []) as JxElement[];
  return [node, ...kids.flatMap((child) => walk(child))];
}

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  document.body.replaceChildren();
});

async function item(
  attrs: Record<string, string> = {},
  children: Element[] = [],
): Promise<JxAccordionItem> {
  const el = document.createElement("jx-accordion-item") as JxAccordionItem;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  el.append(...children);
  document.body.append(el);
  await tick();
  return el;
}

const detailsOf = (el: Element) => el.querySelector<HTMLDetailsElement>('[part="details"]')!;
const summaryOf = (el: Element) => el.querySelector<HTMLElement>('[part="summary"]')!;

/** Every `toggle` this element sees, as `[detail, the open state of whatever it came from]`. */
function record(el: Element): [unknown, unknown][] {
  const seen: [unknown, unknown][] = [];
  el.addEventListener("toggle", (e) => {
    seen.push([(e as CustomEvent).detail, (e.target as HTMLDetailsElement).open]);
  });
  return seen;
}

describe("jx-accordion-item", () => {
  test("the summary is the FIRST child of the details, with the slots authored inside it", async () => {
    /* Not a stylistic ordering: the platform stops treating a `<summary>` as the disclosure
       control the moment it is not the first child, and the whole argument for `<details>` is
       that the toggle, Enter, Space, find-in-page reveal and print are the platform's. */
    const el = await item({ label: "Layout" });
    const details = detailsOf(el);
    expect(details.tagName).toBe("DETAILS");
    expect(details.firstElementChild).toBe(summaryOf(el));
    expect(summaryOf(el).tagName).toBe("SUMMARY");
    expect(el.querySelector('[part="label"]')!.textContent).toBe("Layout");
    // The actions row is inside the summary, and the body's slot outside it.
    expect(summaryOf(el).contains(el.querySelector('[part="actions"]'))).toBe(true);
    expect(summaryOf(el).contains(el.querySelector('[part="body"]'))).toBe(false);
  });

  test("a toggle fires exactly once per change, and its detail is the new open", async () => {
    const el = await item({ label: "Layout" });
    const seen = record(el);
    summaryOf(el).click();
    await tick();
    expect(el.open).toBe(true);
    expect(detailsOf(el).open).toBe(true);
    expect(seen).toEqual([[true, true]]);
    summaryOf(el).click();
    await tick();
    expect(el.open).toBe(false);
    expect(seen).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  test("the event's target is the inner details, which is what e.target.open reads off", async () => {
    /* The prop and the event description both promise a host that `e.target.open` keeps working.
       It is the DETAILS that carries `open`, not the host, and the host has no `open` attribute
       to read — so a description that said "the element" would send a porter to the wrong node. */
    const el = await item({ label: "Layout" });
    const targets: (string | null)[] = [];
    el.addEventListener("toggle", (e) => {
      targets.push((e.target as Element).getAttribute("part"));
    });
    summaryOf(el).click();
    await tick();
    expect(targets).toEqual(["details"]);
    expect(el.getAttribute("open")).toBeNull();
  });

  test("re-asserting open after the platform already opened it fires NO second toggle", async () => {
    /* The one the element could get wrong in a way nothing else would notice: the handler
       re-announces on the very node it listens to, so an unguarded body hears its own event. The
       symptom of getting it right is an ABSENCE — a second toggle that never comes. */
    const el = await item({ label: "Layout" });
    const seen = record(el);
    summaryOf(el).click();
    await tick();
    expect(seen).toHaveLength(1);
    el.open = true;
    await tick();
    expect(seen).toHaveLength(1);
    expect(detailsOf(el).open).toBe(true);
    // And a genuine change still speaks.
    el.open = false;
    await tick();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual([false, false]);
  });

  test("a host opening a CLOSED section gets one toggle, and no open attribute back", async () => {
    /* The direction the four style-panel handlers actually drive, and the one the echo guard
       could silently swallow. The reflection gap is pinned in the same test because the prop
       description promises it: a property write leaves the HOST's own attribute alone, so a
       selector or a `getAttribute("open")` on the host reads stale forever. */
    const el = await item({ label: "Layout" });
    const seen = record(el);
    expect(el.open).toBe(false);
    el.open = true;
    await tick();
    expect(el.open).toBe(true);
    expect(detailsOf(el).open).toBe(true);
    expect(seen).toEqual([[true, true]]);
    expect(el.getAttribute("open")).toBeNull();
    expect(el.hasAttribute("open")).toBe(false);
  });

  test("the re-announced toggle stops at the element, so an overlay around it keeps its own open", async () => {
    /* The platform's `toggle` never bubbles, and the kit's overlays are built on that: jx-popover,
       jx-menu, jx-tooltip and jx-dialog each bind `ontoggle` on their own root and read
       `event.newState` with no target guard. Measured in Chrome before the boundary existed: a
       section opened inside a shown popover flipped the panel's `open` to false and dropped its
       `data-open` styling while it was still in the top layer. */
    const panel = document.createElement("jx-popover") as HTMLElement & { open: boolean };
    panel.setAttribute("popover", "");
    const inner = document.createElement("jx-accordion-item") as JxAccordionItem;
    inner.setAttribute("label", "Section");
    panel.append(inner);
    document.body.append(panel);
    await tick();
    panel.showPopover();
    await tick();
    await tick();
    expect(panel.open).toBe(true);
    expect(panel.matches("[data-open]")).toBe(true);
    const escaped: string[] = [];
    document.body.addEventListener("toggle", (e) => {
      escaped.push((e.target as Element).localName);
    });
    summaryOf(inner).click();
    await tick();
    await tick();
    expect(inner.open).toBe(true);
    expect(panel.open).toBe(true);
    expect(panel.matches("[data-open]")).toBe(true);
    // And nothing of the element's own reached anything outside it.
    expect(escaped).toEqual([]);
  });

  test("a nested item's toggle is not read as its container's", async () => {
    /* A native toggle does not bubble, which is what makes nesting safe on the platform, and the
       re-announcement stops at its own host for the same reason — so an inner section opening
       writes neither the outer section's `open` nor a second event carrying the wrong node's
       state, and the outer's own listener hears nothing at all. */
    const inner = document.createElement("jx-accordion-item") as JxAccordionItem;
    inner.setAttribute("label", "Inner");
    const outer = await item({ label: "Outer" }, [inner]);
    await tick();
    const outerSeen = record(outer);
    const innerSeen = record(inner);
    summaryOf(inner).click();
    await tick();
    expect(inner.open).toBe(true);
    expect(outer.open).toBe(false);
    expect(detailsOf(outer).open).toBe(false);
    expect(innerSeen).toEqual([[true, true]]);
    expect(outerSeen).toEqual([]);
  });

  test("a click on the actions row toggles nothing, and does not leave the element", async () => {
    /* Inside the summary is what keeps it VISIBLE while the section is shut — a sibling of the
       summary inside the details is hidden by the UA whenever the section is closed. The cost is
       that a click on the row's own space would otherwise reach the disclosure control. */
    const button = document.createElement("button");
    button.slot = "actions";
    button.textContent = "Reset";
    const el = await item({ label: "Typography" }, [button]);
    const actions = el.querySelector<HTMLElement>('[part="actions"]')!;
    expect(actions.contains(button)).toBe(true);
    expect(summaryOf(el).contains(button)).toBe(true);
    const seen = record(el);
    const heard: string[] = [];
    el.addEventListener("click", () => heard.push("host"));
    const own = new MouseEvent("click", { bubbles: true, cancelable: true });
    actions.dispatchEvent(own);
    await tick();
    expect(own.defaultPrevented).toBe(true);
    expect(el.open).toBe(false);
    expect(detailsOf(el).open).toBe(false);
    expect(seen).toEqual([]);
    // The other half of the guard, which `defaultPrevented` alone cannot see.
    expect(heard).toEqual([]);
    // And the summary itself still toggles.
    summaryOf(el).click();
    await tick();
    expect(el.open).toBe(true);
  });

  test("a slotted control in the actions row keeps its OWN default action", async () => {
    /* The row cancels the click that reached nothing else; it must NOT cancel a control's. A
       blanket `preventDefault` here left a slotted `<a>` unable to navigate and a
       `popovertarget` invoker unable to open its popover — measured in Chrome with trusted
       clicks, and invisible to a test that asserts `defaultPrevented === true` as success. The
       control needs no cancelling anyway: it is the click's own activation target, so the summary
       never toggles for it. */
    const link = document.createElement("a");
    link.slot = "actions";
    link.href = "#docs";
    link.textContent = "Docs";
    const el = await item({ label: "Typography" }, [link]);
    const heard: string[] = [];
    el.addEventListener("click", () => heard.push("host"));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    await tick();
    expect(click.defaultPrevented).toBe(false);
    // Still stopped at the row, so a host's own click handler does not see the row's traffic.
    expect(heard).toEqual([]);
  });

  test("an actions row with nothing slotted into it is collapsed, not a phantom gap", async () => {
    /* The `<span>` stays in the tree whether or not anything is slotted, so as a flex item of the
       summary's `gap` row it costs `--jx-space-2` of label width on every section that has no
       actions — and `[part="label"]` ellipsises, so it truncates that much early. Measured in
       Chrome 152: the label is 841.33px wide beside an empty row and 845.33px with the row gone.

       TWO selectors, because an emptiness question now has two shapes and the section that a
       consumer actually writes is the SECOND. A `<slot>` is replaced by what it matched, so an
       item with body content has no `[part="actions-slot"]` node left to ask about and `:has`
       stops matching — the phantom gap came straight back on every real section. `:empty` is the
       honest question there. But `distributeSlots` returns before it unwraps anything when the
       host was given NO children at all, so a bare item keeps its slot and is not `:empty`; that
       is the case `:has` still answers, and it is the one every test in this file that passes no
       children is in. Asserted as text as well as measured, because happy-dom's `:has` matches an
       occupied row too. */
    expect(sheet()).toContain(
      'S > [part="details"] > [part="summary"] > [part="actions"]:empty { display: none }',
    );
    /* One branch, not two. The rule carried a `:has([part="actions-slot"]:empty)` half because a
       slot used to survive distribution and keep `:empty` false. Slots now unwrap whether or not
       they matched, so an actions row with nothing slotted into it is simply empty. */
    expect(sheet()).not.toContain("actions-slot");
    const bare = await item({ label: "Layout" });
    expect(bare.querySelector("slot")).toBeNull();
    expect(bare.querySelector('[part="actions"]')!.matches(":empty")).toBe(true);

    const action = document.createElement("button");
    action.slot = "actions";
    action.textContent = "Reset";
    const filled = await item({ label: "Layout" }, [action]);
    expect(filled.querySelector('[part="actions"]')!.childNodes.length).toBeGreaterThan(0);
  });

  test("open is a boolean ATTRIBUTE on the details: removed, never written false", async () => {
    /* `<details open="false">` is an OPEN details. A binding that wrote the word would leave every
       closed section drawn open, and nothing in the document would look wrong. */
    const el = await item({ label: "Layout", open: "" });
    const details = detailsOf(el);
    expect(el.open).toBe(true);
    expect(details.getAttribute("open")).toBe("");
    el.open = false;
    await tick();
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.getAttribute("open")).toBeNull();
    expect(details.open).toBe(false);
  });

  test("level ADDS a heading and leaves the disclosure alone; empty renders no heading at all", async () => {
    /* Measured against Chrome's own accessibility tree, which is the only place this is decidable.
       `role="heading"` on the summary REPLACES the disclosure: the node came back
       `heading "Custom" level="3"` with no `expandable` and no expanded state, which is strictly
       worse than the default for the exact panel the prop exists to serve. A heading nested inside
       the summary is pruned out of the tree entirely. A visually hidden heading BESIDE the details
       is the shape that works — Chrome reports both `heading "Custom" level="3"` and
       `DisclosureTriangle "Custom" expandable`. */
    const plain = await item({ label: "Layout" });
    const plainHeading = plain.querySelector<HTMLElement>('[part="heading"]')!;
    expect(plainHeading.hasAttribute("role")).toBe(false);
    expect(plainHeading.hasAttribute("aria-level")).toBe(false);
    expect(plainHeading.hasAttribute("hidden")).toBe(true);
    const el = await item({ label: "Custom", level: "3" });
    const heading = el.querySelector<HTMLElement>('[part="heading"]')!;
    expect(heading.getAttribute("role")).toBe("heading");
    expect(heading.getAttribute("aria-level")).toBe("3");
    expect(heading.hasAttribute("hidden")).toBe(false);
    expect(heading.textContent).toBe("Custom");
    // The summary keeps the native mapping in BOTH cases: that is the whole point of the shape.
    expect(summaryOf(el).hasAttribute("role")).toBe(false);
    expect(summaryOf(el).hasAttribute("aria-level")).toBe(false);
    expect(summaryOf(plain).hasAttribute("role")).toBe(false);
    // And it is the details' own child order that keeps summary first.
    expect(detailsOf(el).firstElementChild).toBe(summaryOf(el));
    el.level = "";
    await tick();
    expect(heading.hasAttribute("role")).toBe(false);
    expect(heading.hasAttribute("hidden")).toBe(true);
  });

  test("name forwards to the details for an exclusive group, and is absent when empty", async () => {
    const plain = await item({ label: "First" });
    expect(detailsOf(plain).hasAttribute("name")).toBe(false);
    const el = await item({ label: "First", name: "sections" });
    expect(detailsOf(el).getAttribute("name")).toBe("sections");
  });

  test("the caret is a real glyph, and it turns for its OWN details", async () => {
    /* Element rules are scoped by an attribute on the HOST, and a nested item's host is a
       descendant of this one — so a descendant combinator here would rotate an inner, closed
       section's caret whenever its container happened to be open. The rule is only half of it:
       with `list-style: none` suppressing the UA triangle, the icon inside the marker is the
       section's ONLY open/closed affordance, and a rule-text assertion cannot see it go. */
    const rules = sheet();
    expect(rules).toContain(
      'S > [part="details"][open] > [part="summary"] > [part="marker"] { transform: rotate(90deg) }',
    );
    for (const rule of rules) {
      if (rule.includes('[part="marker"]')) {
        expect(rule, rule).toStartWith('S > [part="details"]');
      }
    }
    const el = await item({ label: "Layout" });
    const glyph = el.querySelector<HTMLElement & { name?: string }>(
      '[part="marker"] [part="marker-icon"]',
    )!;
    expect(glyph.tagName.toLowerCase()).toBe("jx-icon");
    expect(glyph.name).toBe("caret-right");
    expect(glyph.querySelector("svg")).not.toBeNull();
    expect(el.querySelector('[part="marker"]')!.getAttribute("aria-hidden")).toBe("true");
  });

  test("the UA's own disclosure triangle is removed both ways it is drawn", () => {
    const rules = sheet();
    const summary = 'S > [part="details"] > [part="summary"]';
    const own = rules.find((rule) => rule.startsWith(`${summary} {`))!;
    // `list-style: none` on the summary itself is what removes it everywhere `::marker` is used.
    expect(own).toContain("list-style: none");
    /* And the vendor pseudo for WebKit, which is the only engine it is FOR: measured in Chrome
       152, `CSS.supports('selector(summary::-webkit-details-marker)')` is false while
       `selector(summary::marker)` is true, so Chrome's parser drops this rule and the line above
       is what does the work there. It is kept for Safari, not for the engine we can measure. */
    expect(rules).toContain(`${summary}::-webkit-details-marker { display: none }`);
  });

  test("the summary is named by the LABEL alone, never by the controls beside it", async () => {
    /* A `<summary>` is named from its contents and the actions row is inside it, so the default
       mapping folds a control's name into the section's: Chrome reported
       `DisclosureTriangle "Typography Clear typography overrides"`, and the reader met the same
       button again as a child of the control. An `aria-label` bound to `label` is the fix, and it
       is why this element writes one piece of ARIA it would otherwise not need. */
    const button = document.createElement("jx-action-button");
    button.slot = "actions";
    button.setAttribute("label", "Clear typography overrides");
    button.setAttribute("icon", "arrow-u-up-left");
    const el = await item({ label: "Typography" }, [button]);
    expect(summaryOf(el).getAttribute("aria-label")).toBe("Typography");
    expect(summaryOf(el).textContent).toContain("Typography");
    // Empty means no attribute, so nothing ever names a section the empty string.
    const bare = await item({});
    expect(summaryOf(bare).hasAttribute("aria-label")).toBe(false);
  });

  test("a slotted heading mark STANDS WHERE THE SLOT STOOD, inside the summary", async () => {
    /* `[slot="heading"]` is for INERT marks — properties-panel's section dot — and losing the slot
       does not misplace such a mark, it DROPS it: a `<span slot="heading">` appended to an element
       whose document has no matching slot comes back `isConnected: false`.

       This used to assert that the mark landed INSIDE `[part="heading-slot"]`. That node is gone:
       a slot is replaced by what it matched, so the mark is the summary's own child at the slot's
       own position — which is the position that matters, because it is what puts the mark after
       the label and before the actions row rather than anywhere in the subtree. Confirmed in
       Chrome 152: the summary's children read marker, label, dot, actions. */
    const dot = document.createElement("span");
    dot.slot = "heading";
    dot.className = "jx-dot";
    const el = await item({ label: "Typography" }, [dot]);
    expect(dot.isConnected).toBe(true);
    expect(dot.parentElement).toBe(summaryOf(el));
    expect(
      [...summaryOf(el).children].map((child) => child.getAttribute("part") ?? child.className),
    ).toEqual(["marker", "label", "jx-dot", "actions"]);
    expect(el.querySelector('[part="heading-slot"]')).toBeNull();
    // And it is not swallowed into the body, which is where a missing slot would NOT put it.
    expect(el.querySelector('[part="body"]')!.contains(dot)).toBe(false);
  });

  test("the element writes no aria-expanded and no role of its own", async () => {
    const doc = documents["jx-accordion-item"]!;
    const json = JSON.stringify(doc);
    // `aria-expanded` is computed by the platform from the `open` content attribute; writing one
    // Would fight that mapping with a second, staler answer.
    expect(json).not.toContain("aria-expanded");
    expect(doc.attributes?.["role"]).toBeUndefined();
    /* The two pieces of ARIA it does write, each because a measurement said so: the caret is
       decoration, and the summary's name would otherwise swallow the actions row. */
    expect(json).toContain('"aria-hidden":"true"');
    expect(json).toContain('"aria-label":"${state.label || null}"');
    const el = await item({ label: "Layout" });
    expect(summaryOf(el).hasAttribute("aria-expanded")).toBe(false);
  });

  test("a demo handler that reads the event declares NO parameters", () => {
    /* A `$prototype: "Function"` with a `body` AND a non-empty `parameters` is built as a
       CALLABLE — `(...args) => runStatements(body, state, null, { args })` — so the event is
       `null` by construction and every `event#/…` in the body reads `undefined`. It is silent:
       no lint, no typecheck, no schema rule, and a page whose whole point is a live value just
       prints "undefined". This page carried exactly that, and so did two others. */
    for (const [key, entry] of Object.entries((page.state ?? {}) as Record<string, unknown>)) {
      const fn = entry as { $prototype?: string; parameters?: unknown[]; body?: unknown };
      if (fn?.$prototype !== "Function" || !fn.body) {
        continue;
      }
      if (JSON.stringify(fn.body).includes("event#/")) {
        expect(fn.parameters, key).toBeUndefined();
      }
    }
  });

  test("the element and a consumer document both pass the kit's lints", async () => {
    /* As a DOCUMENT and as something a consumer wrote, because that second reading is what Studio
       and `jx validate` actually perform. */
    const doc = documents["jx-accordion-item"]! as JxElement;
    expect(findA11yDefects(doc)).toEqual([]);
    expect(
      findPopoverDefects(doc, { invokerTags: INVOKER_TAGS, popoverTags: POPOVER_TAGS }),
    ).toEqual([]);
    expect(findA11yDefects(page)).toEqual([]);
    expect(
      findPopoverDefects(page, { invokerTags: INVOKER_TAGS, popoverTags: POPOVER_TAGS }),
    ).toEqual([]);
  });

  test("every section on the stylebook page is NAMED, because no lint can ask for it", async () => {
    /* `label` is the disclosure's whole accessible name and it is a BOUND attribute, which is
       what switches `interactive-unnamed` off — so an item with no label passes every gate the
       kit has and renders, in Chrome, as `DisclosureTriangle expandable` with no name at all.
       This is the gate, and it walks the whole tree rather than one level. */
    const bare = await item({});
    expect(findA11yDefects(page)).toEqual([]);
    expect(summaryOf(bare).hasAttribute("aria-label")).toBe(false);
    const items = walk(page).filter((node) => node.tagName === "jx-accordion-item");
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const node of items) {
      expect(node.$props?.["label"], JSON.stringify(node.$props)).toBeString();
      expect(node.$props?.["label"]).not.toBe("");
    }
  });

  test("the stylebook stacks its sections in the ELEMENT, and no container is a class", () => {
    /* INVERTED, and the inversion is the point of the change rather than collateral. This test
       used to read `expect(Object.keys(documents)).not.toContain("jx-accordion")` and to assert
       that every container on the page was a `<div class="jx-accordion">`. It was written under a
       rule that judged kind by what a definition OWNS — no state, no keyboard, no ARIA, so a class
       was the whole of it — and that rule is gone. Kind is decided by HOW MANY DEFINITIONS DRAW
       THE BOX: the column, the width clamp and the hairline between one section and the next are
       painted by a definition that is not the section's, which is two, which is an element. The
       older rule also had to keep a stylesheet in a kit whose whole claim is that HTML and CSS are
       contained by the Jx schema, and a class the kit ships is debt no consumer can see. */
    expect(Object.keys(documents)).toContain("jx-accordion");
    const containers = walk(page).filter((node) => node.tagName === "jx-accordion");
    expect(containers.length).toBeGreaterThanOrEqual(2);
    for (const container of containers) {
      expect(container.attributes?.["class"]).toBeUndefined();
      for (const child of container.children as JxElement[]) {
        expect(child.tagName).toBe("jx-accordion-item");
      }
    }
    // Nothing on either accordion page still reaches for the class the element replaced.
    for (const node of [...walk(page), ...walk(containerPage)]) {
      expect(node.attributes?.["class"], JSON.stringify(node.attributes)).not.toBe("jx-accordion");
    }
    // And the exclusive form the platform gives for one forwarded attribute is still shown.
    const exclusive = containers.at(-1)!;
    expect(exclusive.$props?.["multiple"]).toBe(false);
    for (const child of exclusive.children as JxElement[]) {
      expect(child.$props?.["name"]).toBe("stylebook-exclusive");
    }

    /* `containers` above is the ITEM's page. The container's OWN page was read only for the
       class sweep, so nothing asked what tag it stacks its sections in — rewriting both of its
       `"tagName": "jx-accordion"` to `"div"` and deleting the exclusive form left the package at
       701 pass. A stylebook page that stops demonstrating the element it is named for is exactly
       the drift a stylebook exists to prevent, so it is asked here in its own right. */
    const own = walk(containerPage).filter((node) => node.tagName === "jx-accordion");
    expect(own.length).toBeGreaterThanOrEqual(3);
    for (const node of own) {
      expect(node.attributes?.["class"]).toBeUndefined();
    }
    // Two top-level stacks and one NESTED, which is the shape the seam claim needs demonstrated.
    expect((containerPage.children as JxElement[]).filter((n) => n.tagName === "jx-accordion")) //
      .toHaveLength(2);
    const nested = own.filter((node) => !(containerPage.children as JxElement[]).includes(node));
    expect(nested).toHaveLength(1);
    // Exactly one stack declares the exclusive intent, and every item in it carries the `name`.
    const declared = own.filter((node) => node.$props?.["multiple"] === false);
    expect(declared).toHaveLength(1);
    for (const child of declared[0]!.children as JxElement[]) {
      expect(child.$props?.["name"]).toBe("stylebook-exclusive");
    }
    // And a section bound HIDDEN, which is the case `* + *` got wrong and the element does not.
    const hidden = walk(containerPage).filter((node) => node.attributes?.["hidden"] !== undefined);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.tagName).toBe("jx-accordion-item");
  });
});

describe("jx-accordion", () => {
  /** A stack holding `count` bare sections, rendered, with the sections at `hidden` hidden. */
  async function stack(
    count: number,
    attrs: Record<string, string> = {},
    hidden: number[] = [],
  ): Promise<HTMLElement> {
    const el = document.createElement("jx-accordion");
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
    for (let i = 0; i < count; i += 1) {
      const section = document.createElement("jx-accordion-item");
      section.setAttribute("label", `Section ${i + 1}`);
      if (hidden.includes(i)) {
        section.setAttribute("hidden", "");
      }
      el.append(section);
    }
    document.body.append(el);
    await tick();
    return el;
  }

  /**
   * Every rule of the element's EMITTED sheet, in source order, scoped to one host's handle.
   *
   * Read off `documentStyleText()` — the stylesheet the runtime actually adopted — rather than
   * re-derived from the JSON with `buildStyleRules`, so a rule the emitter adds, drops or reorders
   * is visible here. Scoped to one handle because every kit element writes an `&[hidden]` rule.
   *
   * @param {HTMLElement} el - The element whose scope handle to read
   * @returns {{ selector: string; decls: string }[]}
   */
  function rulesOf(el: HTMLElement): { selector: string; decls: string }[] {
    const handle = `[data-jx="${el.dataset["jx"] ?? ""}"]`;
    const out: { selector: string; decls: string }[] = [];
    for (const line of documentStyleText().split("\n")) {
      const match = /^(.*?) \{ (.*) \}$/.exec(line);
      if (match && match[1]!.includes(handle)) {
        out.push({ selector: match[1]!, decls: match[2]! });
      }
    }
    return out;
  }

  /**
   * The declaration the CASCADE leaves standing on `node` for `prop`, over every rule the element
   * emits — not the text of the one rule a test went looking for.
   *
   * This is what `toContain("S { display: flex … }")` could not say. A membership assertion on rule
   * text is blind to a LATER rule that overrides the declaration it checked: adding
   * `"&[data-exclusive]": { "minWidth": "auto" }` to the element's style left the whole package
   * green while deleting the clipping column from every exclusive stack. Asking each rule whether
   * it matches, and taking the last answer, is a question no added rule can hide from.
   *
   * Last match wins, which is the cascade only while specificity does not DECREASE down the sheet.
   * That holds for every rule this element ships (`&`, `&[hidden]`, `& > :not([hidden]) ~ *`), and
   * a later rule of lower specificity would be reported as the winner when it is not — a false
   * failure, which is the safe direction for a gate.
   *
   * @param {HTMLElement} host - The element whose sheet to read
   * @param {Element} node - The node the declaration would land on
   * @param {string} prop - The CSS property, kebab-cased as the sheet spells it
   * @returns {string | undefined}
   */
  function cascaded(host: HTMLElement, node: Element, prop: string): string | undefined {
    let value: string | undefined;
    for (const rule of rulesOf(host)) {
      if (!node.matches(rule.selector)) {
        continue;
      }
      for (const decl of rule.decls.split("; ")) {
        const colon = decl.indexOf(": ");
        if (decl.slice(0, colon) === prop) {
          value = decl.slice(colon + 2);
        }
      }
    }
    return value;
  }

  test("the stack is the clipping column the recipe was, and it says what hidden means", async () => {
    /* MEASURED, Chrome 152 at DPR 1.5 (1 CSS px reads 0.666667), element and `div.jx-accordion`
       carrying the recipe verbatim, three sections each, side by side on one page:

         | case                    | element                  | class (control)          |
         | plain, 420px column     | flex/column/0px, 420x85.33 | flex/column/0px, 420x85.33 |
         | seams, plain            | 0 / 0.666667 / 0.666667  | 0 / 0.666667 / 0.666667  |
         | host [hidden]           | none, 0x0, 0 client rects | flex, 420x85.33, 1 rect  |

       So the box IS the class's box, and `[hidden]` is the one deliberate divergence.

       `min-width: 0` is the load-bearing third, and here is the counterfactual rather than the
       claim. A flex item defaults to `min-width: auto` and refuses to shrink below its content, so
       a stack in a 300px flex row holding an 88-character unbreakable label measured:

         | with the clamp (element AND class) | host 150px, label 122px, scrollWidth 525, CLIPPED |
         | the same recipe minus min-width    | host 553.06px, label 525.06px, NOT clipped        |

       The item's `[part="label"]` does the ellipsis; it can only do it if the stack agrees to be
       narrow, and without the clamp the panel is 3.7x its column.

       Nothing below is a `toContain` on rule text. The sheet is pinned by IDENTITY — its selectors,
       in order — so an added rule is a red X, and each declaration is read as the cascade's winner
       over every rule, so an override is a red X too. */
    const el = await stack(3);
    expect(rulesOf(el).map((rule) => rule.selector)).toEqual([
      `[data-jx="${el.dataset["jx"]}"]`,
      `[data-jx="${el.dataset["jx"]}"][hidden]`,
      `[data-jx="${el.dataset["jx"]}"] > :not([hidden]) ~ *`,
    ]);
    expect(cascaded(el, el, "display")).toBe("flex");
    expect(cascaded(el, el, "flex-direction")).toBe("column");
    expect(cascaded(el, el, "min-width")).toBe("0");
    /* The element declares a `display`, so an authored value beats the UA's `[hidden] {
       display: none }` and a hidden stack would still be drawn. Chrome agrees with the cascade
       read here: the class control, which declares `display: flex` and nothing about `hidden`,
       came back `flex` at 420 x 85.33 with the attribute set. */
    const gone = await stack(3, { hidden: "" });
    expect(cascaded(gone, gone, "display")).toBe("none");
  });

  test("the seam falls BETWEEN sections, and never above the first VISIBLE one", async () => {
    /* The whole reason the container is a definition rather than a class: this is a claim about a
       child's POSITION AMONG ITS SIBLINGS, and no section can see that about itself.

       It is a DESCENDANT-target rule, and it only started working when a `<slot>` stopped leaving a
       node. Before that the slot stood between the host and its sections, so the rule addressed the
       slot alone — one element, never a second, so nothing matched and every seam was missing.

       `:not([hidden]) ~ *` rather than `* + *`, and that is where the element does BETTER than the
       class it replaces. `* + *` means "not the first child", which stops being "not the first
       section a reader sees" the moment a panel binds `hidden` on one — and Studio panels do.
       Measured in Chrome 152, three sections, hidden marked H:

         | sections        | element seams              | class seams (control)      |
         | H, -, -         | 0(H) / 0     / 0.666667    | 0(H) / 0.666667 / 0.666667 |
         | -, H, -         | 0    / 0.666667(H) / 0.666667 | identical               |
         | H, H, -         | 0(H) / 0(H)  / 0           | 0(H) / 0.666667(H) / 0.666667 |

       The class drew a hairline across the TOP of the visible stack in two of those three (host
       57.33 and 28.67 against the element's 56.67 and 28); the element draws none. The middle row
       is the case where the two must agree and do: hiding a section between two visible ones leaves
       the pair still needing the seam between them.

       `:not([hidden])` is an attribute selector, so the rule is (0,2,0) — which is what the recipe
       was under `:root .jx-accordion > * + *`, not the (0,1,0) the element shipped with. A
       consumer's own single-class rule is exactly as able to override the seam as it was before.

       Read as the cascade's winner over the whole sheet, so a SECOND rule declaring the same
       property cannot hide behind the first: `.find(rule => rule.includes("border-block-start"))`
       returned the direct-child rule while an added `"& * + *"` seamed every nested stack from its
       container, and the suite stayed at 701 pass. */
    const plain = await stack(3);
    const seams = [...plain.children].map((s) => cascaded(plain, s, "border-block-start"));
    expect(seams).toEqual([undefined, "1px solid var(--jx-border)", "1px solid var(--jx-border)"]);

    const firstHidden = await stack(3, {}, [0]);
    expect([...firstHidden.children].map((s) => cascaded(firstHidden, s, "border-block-start"))) //
      .toEqual([undefined, undefined, "1px solid var(--jx-border)"]);

    const midHidden = await stack(3, {}, [1]);
    expect([...midHidden.children].map((s) => cascaded(midHidden, s, "border-block-start"))) //
      .toEqual([undefined, "1px solid var(--jx-border)", "1px solid var(--jx-border)"]);

    const twoHidden = await stack(3, {}, [0, 1]);
    expect([...twoHidden.children].map((s) => cascaded(twoHidden, s, "border-block-start"))) //
      .toEqual([undefined, undefined, undefined]);
  });

  test("a nested stack keeps its own seams, and takes none from its container", async () => {
    /* The rule reaches DIRECT children, so a stack inside a section's body is a grandchild of the
       outer host and is not seamed by it, while its own sections are — which a descendant
       combinator here would have got wrong in both directions at once.

       The scope handle is a hash of the element's RULES, so two stacks share it only when neither
       adds any: on the shipped `stylebook/jx-accordion.json` the two top-level stacks carry a
       usage-site frame and hash to `jx-twd8wa`, while the bare nested one hashes to `jx-1d50wn6`.
       Both stacks here are bare, so the handles match and one sheet answers for both — which this
       asserts rather than assumes, and which is why the question below is "does this node match",
       not "how many nodes does the document return". */
    const inner = document.createElement("jx-accordion");
    for (const label of ["Inner first", "Inner second"]) {
      const section = document.createElement("jx-accordion-item");
      section.setAttribute("label", label);
      inner.append(section);
    }
    const outer = await stack(2);
    const body = outer.children[1]!.querySelector('[part="body"]')!;
    /* A paragraph BEFORE the nested stack, which is the shape the stylebook page writes and the
       one that makes this decidable: with a descendant rule the inner stack is a sibling-preceded
       node under the outer host and takes a hairline it has no business having, and with the
       direct-child rule it does not. With the stack alone in the body there is no preceding
       sibling and both rules agree. */
    body.append(document.createElement("p"));
    body.append(inner);
    await tick();
    expect(inner.dataset["jx"]).toBe(outer.dataset["jx"]!);
    // Asked of the WHOLE sheet, so an added rule that seams a grandchild reddens here.
    expect(cascaded(outer, inner, "border-block-start")).toBeUndefined();
    expect([...outer.children].map((child) => cascaded(outer, child, "border-block-start"))) //
      .toEqual([undefined, "1px solid var(--jx-border)"]);
    expect([...inner.children].map((child) => cascaded(inner, child, "border-block-start"))) //
      .toEqual([undefined, "1px solid var(--jx-border)"]);
  });

  test("multiple is ADVISORY: it marks the NOTABLE state, and writes nothing onto a section", async () => {
    /* The platform's own switch for an exclusive group is `name` on each `<details>`, and that
       attribute belongs to the section. A container that reached into its slotted children to
       write one would be the foreign-attribute write §2 principle 5 forbids, and there is no
       declarative channel for it either — a `<slot>` leaves no node and projects no props, so the
       container cannot hand a default down the way a definition hands `$props` to a child it
       authored. So the prop is the place the intent is WRITTEN DOWN and read back, not the place
       it is imposed, and this test pins the absence that makes that honest.

       The marker is `data-exclusive`, spelled for the notable state, and the polarity is the point
       of the assertions below rather than an incidental. `multiple` defaults TRUE — an un-named
       `<details>` already stands open beside its siblings, and all six shipped Studio panels want
       that — so a marker named for the prop would have been present on every accordion in every
       document and absent exactly where a consumer had declared something. Every other boolean
       reflection in the kit defaults false and marks attribute-present (`quiet`, `compact`,
       `checked`, `disabled`, `open`, `loading`, `stepper`, `selected`, `stacked`, `determinate`,
       `destructive`, `badInput`, `indeterminate`), so this is the convention rather than a new one,
       and styling the exclusive case is `[data-exclusive]` rather than `:not([data-multiple])`.

       Measured in Chrome 152, two sections under `multiple="false"`: with `name` on each, opening
       the second closed the first (`[true, false]` → `[false, true]`); with no `name`, both stood
       open at once and neither the sections nor their inner `<details>` had gained one. */
    const open = await stack(2);
    const exclusive = await stack(2, { multiple: "false" });
    /* Read as "which markers are on the host", not "is data-exclusive absent" — the polarity is
       only pinned if a DEFAULT stack is shown to carry no marker at all. Off `attributes` rather
       than `dataset`, because happy-dom's dataset proxy caches its key list: `dataset.exclusive`
       reads `""` on a stack whose `Object.keys(dataset)` still answers `["jx"]`. */
    const marks = (el: HTMLElement) =>
      [...el.attributes]
        .map((attr) => attr.name)
        .filter((name) => name.startsWith("data-") && name !== "data-jx")
        .toSorted();
    expect(marks(open)).toEqual([]);
    expect(marks(exclusive)).toEqual(["data-exclusive"]);
    for (const section of exclusive.children) {
      expect(section.hasAttribute("name")).toBe(false);
      expect(section.querySelector('[part="details"]')!.hasAttribute("name")).toBe(false);
    }
    // And nothing in the definition so much as mentions the attribute it refuses to write.
    expect(JSON.stringify(documents["jx-accordion"]!)).not.toContain('"name"');
  });

  test("the element and its stylebook page both pass the kit's lints, and every section is named", () => {
    const doc = documents["jx-accordion"]! as JxElement;
    expect(findA11yDefects(doc)).toEqual([]);
    expect(
      findPopoverDefects(doc, { invokerTags: INVOKER_TAGS, popoverTags: POPOVER_TAGS }),
    ).toEqual([]);
    expect(findA11yDefects(containerPage)).toEqual([]);
    expect(
      findPopoverDefects(containerPage, { invokerTags: INVOKER_TAGS, popoverTags: POPOVER_TAGS }),
    ).toEqual([]);
    /* `label` is a bound attribute, which switches `interactive-unnamed` off, so an unnamed
       section passes every gate the kit has and renders as `DisclosureTriangle expandable` with no
       name. The item's own page is gated this way and the container's has to be too. */
    const items = walk(containerPage).filter((node) => node.tagName === "jx-accordion-item");
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const node of items) {
      expect(node.$props?.["label"], JSON.stringify(node.$props)).toBeString();
      expect(node.$props?.["label"]).not.toBe("");
    }
  });
});
