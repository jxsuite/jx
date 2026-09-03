import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

/** Every rule the element's own style block emits, under a stand-in scope handle. */
const sheet = (): string[] =>
  buildStyleRules(documents["jx-accordion-item"]!.style as JxStyle, { scope: "S" }).map(
    (rule) => rule.text,
  );

const page = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../stylebook/jx-accordion-item.json"), "utf8"),
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
       Chrome: 4px between the label's right edge and an EMPTY row. The rule is the same `:has`
       shape `jx-action-button`'s label uses, asserted as text because happy-dom's `:has` matches
       an occupied row too. */
    expect(sheet()).toContain(
      'S > [part="details"] > [part="summary"] > [part="actions"]:has([part="actions-slot"]:empty) { display: none }',
    );
    const el = await item({ label: "Layout" });
    expect(el.querySelector('[part="actions-slot"]')!.children).toHaveLength(0);
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

  test("a slotted heading mark lands inside the summary and stays in the document", async () => {
    /* `[slot="heading"]` is for INERT marks — properties-panel's section dot — and losing the slot
       does not misplace such a mark, it DROPS it: a `<span slot="heading">` appended to an element
       whose document has no matching slot comes back `isConnected: false`. */
    const dot = document.createElement("span");
    dot.slot = "heading";
    dot.className = "jx-dot";
    const el = await item({ label: "Typography" }, [dot]);
    expect(dot.isConnected).toBe(true);
    expect(summaryOf(el).contains(dot)).toBe(true);
    expect(el.querySelector('[part="heading-slot"]')!.contains(dot)).toBe(true);
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

  test("no element pretends to be an accordion container; the stylebook uses the class", () => {
    /* All six shipped containers pass `allow-multiple`, which an un-named `<details>` already is,
       and every one of them keeps the open set outside itself. An element would exist to make a
       no-op explicit, so `div.jx-accordion` is a RECIPE — a rule in the kit's `project.json`,
       which is not a document and which this test therefore cannot read. What it CAN pin is the
       half that lives here: no `jx-accordion` document, and a page that demonstrates the class on
       a plain `<div>` whose children are all items. */
    expect(Object.keys(documents)).not.toContain("jx-accordion");
    const containers = walk(page).filter((child) => child.attributes?.["class"] === "jx-accordion");
    expect(containers.length).toBeGreaterThanOrEqual(2);
    for (const container of containers) {
      expect(container.tagName).toBe("div");
      for (const child of container.children as JxElement[]) {
        expect(child.tagName).toBe("jx-accordion-item");
      }
    }
    // And the exclusive form the platform gives for one forwarded attribute is shown.
    const exclusive = containers.at(-1)!.children as JxElement[];
    expect(exclusive.every((child) => child.$props?.["name"] === "stylebook-exclusive")).toBe(true);
  });
});
