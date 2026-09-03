import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { documentStyleText, setCanvasDelinkPopovers } from "@jxsuite/runtime";
import { findPopoverDefects } from "@jxsuite/schema/overlays";
import type { JxElement } from "@jxsuite/schema/types";

import { documents, INVOKER_TAGS, POPOVER_TAGS } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";
import {
  anchorOf,
  clampIntoViewport,
  close,
  measureAnchor,
  onToggle,
  onTransitionEnd,
  openAt,
} from "../src/behaviors/popover.ts";
import type { PopoverElement, PopoverState } from "../src/behaviors/popover.ts";

/** Let the popover shim's queued `toggle` and the runtime's reactive flush settle. */
const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

/** Wait one animation frame, which is where the clamp and the settle both land. */
const frame = () =>
  new Promise((r) => {
    requestAnimationFrame(() => r(null));
  });

type JxPopover = HTMLElement & {
  label: string;
  arrow: boolean;
  matchWidth: boolean;
  x: number;
  y: number;
  floor: number;
  open: boolean;
  settling: boolean;
  anchorWidth: number;
};

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  document.body.replaceChildren();
});

/** A panel on the page, with whatever props the case needs. */
async function panel(props: Record<string, unknown> = {}): Promise<JxPopover> {
  const el = document.createElement("jx-popover") as JxPopover;
  for (const [key, value] of Object.entries(props)) {
    (el as unknown as Record<string, unknown>)[key] = value;
  }
  const text = document.createElement("p");
  text.textContent = "Panel content";
  el.append(text);
  document.body.append(el);
  await tick();
  return el;
}

/** Give an element a box, since happy-dom lays nothing out. */
function stubRect(
  el: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      bottom: rect.top + rect.height,
      right: rect.left + rect.width,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }) as DOMRect;
}

/**
 * Every top-level rule in the emitted sheet, in sheet order, with the per-instance scope id
 * replaced by `&`. Order matters here as much as content: two rules that both set `display` are
 * decided by specificity and then by which came last.
 *
 * @param {string} css
 * @returns {{ selector: string; block: string }[]}
 */
function rules(css: string): { selector: string; block: string }[] {
  const out: { selector: string; block: string }[] = [];
  for (const line of css.split("\n")) {
    const match = /^(.*?) \{ (.*) \}$/.exec(line);
    if (match) {
      out.push({
        block: match[2]!,
        selector: match[1]!.replaceAll(/\[data-jx="[^"]+"\]/g, "&"),
      });
    }
  }
  return out;
}

/** Only the rules that belong to `el`, so one instance's sheet is read rather than the page's. */
function sheetFor(el: HTMLElement): string {
  const handle = el.dataset["jx"];
  return documentStyleText()
    .split("\n")
    .filter((line) => handle !== undefined && line.includes(`[data-jx="${handle}"]`))
    .join("\n");
}

/**
 * What one of the panel's own reactive declarations will actually resolve to. A reactive value is
 * emitted as a `var()` read of a custom property the element sets INLINE, so following the variable
 * is what proves a measurement reaches the box rather than stopping at the state.
 */
function resolved(el: HTMLElement, property: string): string {
  const base = rules(sheetFor(el)).find((rule) => rule.selector === "&");
  const name = new RegExp(`${property}: var\\((--[\\w-]+)\\)`).exec(base?.block ?? "")?.[1] ?? "";
  return el.style.getPropertyValue(name).trim();
}

describe("jx-popover the document", () => {
  const doc = documents["jx-popover"]!;

  test('declares popover="auto" as a literal, carries no id, and is overlay-lint clean', () => {
    const attributes = (doc.attributes ?? {}) as Record<string, unknown>;
    // A literal, never a template or a `$ref`: `popoverModeOf` reads the raw string and
    // `literalAttr` answers null for anything else, so a bound value would blank the very check
    // `invalid-mode` exists for.
    expect(attributes["popover"]).toBe("auto");
    expect(attributes["id"]).toBeUndefined();
    expect(doc.id).toBeUndefined();
    expect(findPopoverDefects(doc)).toEqual([]);
  });

  test("has no `mode` prop, and every numeric prop defaults to 0", () => {
    const state = (doc.state ?? {}) as Record<string, { type?: string; default?: unknown }>;
    expect(state["mode"]).toBeUndefined();
    for (const [key, entry] of Object.entries(state)) {
      if (entry && typeof entry === "object" && entry.type === "number") {
        // A non-zero numeric default cannot express "unset": removing the attribute coerces
        // Through the current value's type, so `Number(null)` writes 0 anyway. The panel's gap
        // From its anchor is the `--jx-popover-offset` token for exactly that reason.
        expect(entry.default, key).toBe(0);
      }
    }
    expect(JSON.stringify(doc.style)).toContain("--jx-popover-offset");
  });

  test("says in the open prop's own description that writing it is not how a panel opens", () => {
    const open = (doc.state as Record<string, { description?: string }>)["open"]!;
    expect(open.description).toContain("showPopover()");
    expect(open.description).toContain("hidePopover()");
  });
});

describe("how a consumer opens one", () => {
  /** A one-page document with `invoker` as the thing aimed at a `jx-popover`. */
  function page(invoker: JxElement): JxElement {
    return {
      tagName: "main",
      children: [invoker, { attributes: { id: "p1" }, tagName: "jx-popover" }],
    } as JxElement;
  }

  const defectRules = (doc: JxElement, scope?: Parameters<typeof findPopoverDefects>[1]) =>
    findPopoverDefects(doc, scope).map((defect) => defect.rule);

  test("a raw <button popovertarget> is clean, and the same attribute on a kit button is not", () => {
    /* The lints judge the tag the DOCUMENT writes, not the tag the definition renders, and they
       read `node.attributes` and never `$props`. So of the three natural spellings only two pass
       with no scope — and the failure is a red CI check in a file the author never opened. */
    expect(
      defectRules(page({ attributes: { popovertarget: "p1" }, tagName: "button" } as JxElement)),
    ).toEqual([]);
    expect(
      defectRules(page({ $props: { popovertarget: "p1" }, tagName: "jx-button" } as JxElement)),
    ).toEqual([]);
    expect(
      defectRules(page({ attributes: { popovertarget: "p1" }, tagName: "jx-button" } as JxElement)),
    ).toContain("invoker-not-button");
  });

  test("a kit popover is a popover to a caller that says which tags are, and not otherwise", () => {
    const doc = page({
      attributes: { command: "toggle-popover", commandfor: "p1" },
      tagName: "button",
    } as JxElement);
    expect(POPOVER_TAGS.has("jx-popover")).toBe(true);
    // The `popover` attribute lives in the DEFINITION, so a consumer's node carries none: without
    // The tags the whole document reads as having no popover in it at all.
    expect(defectRules(doc, { popoverTags: POPOVER_TAGS })).toEqual([]);
    expect(
      defectRules(
        page({ attributes: { popovertarget: "p1" }, tagName: "jx-button" } as JxElement),
        {
          invokerTags: INVOKER_TAGS,
          popoverTags: POPOVER_TAGS,
        },
      ),
    ).toEqual([]);
  });

  test("the stylebook page opens its panel with a spelling the lints accept", () => {
    const sheet = JSON.parse(
      readFileSync(resolve(import.meta.dir, "../stylebook/jx-popover.json"), "utf8"),
    ) as JxElement;
    const invoker = (sheet.children as JxElement[]).find(
      (child) => child.attributes?.["popovertarget"] !== undefined,
    );
    expect(invoker?.tagName).toBe("button");
    expect(findPopoverDefects(sheet, { popoverTags: POPOVER_TAGS })).toEqual([]);
    /* And it demonstrates a NAMED panel, because the element cannot force one: `role="group"` is
       in neither the accessibility lint's content-named roles nor its labelled roles, so an
       unnamed panel of controls is invisible to every gate. */
    const panelNode = (sheet.children as JxElement[]).find(
      (child) => child.tagName === "jx-popover",
    );
    const props = (panelNode as { $props?: Record<string, unknown> }).$props ?? {};
    expect(props["label"]).toBeString();
    expect(props["label"]).not.toBe("");
    expect((panelNode!.children as JxElement[]).length).toBeGreaterThan(0);
  });

  test("the stylebook's invoker paragraph says what the lints answer, for both kinds of caller", () => {
    const shape = page({
      attributes: { popovertarget: "p1" },
      tagName: "jx-button",
    } as JxElement);
    /* The measurement the paragraph has to match: since the scope seam landed, this spelling is
       an error only to a caller that names no invoker tags. Studio names the kit's and reports
       nothing, so a page asserting the error unconditionally steers an author away from a
       spelling their own editor accepts. */
    expect(defectRules(shape)).toContain("invoker-not-button");
    expect(defectRules(shape, { invokerTags: INVOKER_TAGS, popoverTags: POPOVER_TAGS })).toEqual(
      [],
    );

    const sheet = JSON.parse(
      readFileSync(resolve(import.meta.dir, "../stylebook/jx-popover.json"), "utf8"),
    ) as JxElement;
    const prose = (sheet.children as JxElement[])
      .filter((child) => child.tagName === "p")
      .map((child) => String(child.textContent ?? ""))
      .join(" ");
    expect(prose).toContain("invoker-not-button");
    // The claim and its condition travel together or the page teaches a rule that is false.
    expect(prose).toContain("DEPENDS ON THE CALLER");
    expect(prose).toContain("Studio");
    expect(prose).not.toContain("is an invoker-not-button error:");
  });
});

describe("jx-popover the sheet", () => {
  test("declares display: revert-layer in its base rule, and the flex box only when open", async () => {
    await panel();
    const emitted = rules(documentStyleText());
    const base = emitted.find((rule) => rule.selector === "&");
    expect(base?.block).toContain("flex-direction: column");
    /* The base block MUST declare a display, and it must be `revert`. It must declare one because
       `declaresDisplay` now reads the base block alone: a definition that leaves it out has
       `display: block` written into its own rule at (0,1,0), which is an author value and
       therefore beats the UA's `[popover]:not(:popover-open) { display: none }` at any
       specificity — the panel is then laid out on every page whether it is open or not. And it
       must be `revert-layer` rather than plain `revert`, and the difference shows only in the
       Studio canvas. On a shipped page both roll back past the author origin to the UA rule. In
       the canvas the runtime renames `popover` to `data-jx-popover`, so the UA rule matches
       nothing and Studio re-supplies it inside `@layer jx-canvas-ua`: `revert` rolls back to the
       UA origin, where the element has no popover attribute and nothing hides it, and the closed
       panel is drawn over the artboard (measured in Chrome 152: `inline`, 35x17). `revert-layer`
       rolls back one layer onto Studio's own rule and measures `none` at 0x0 in both places. */
    expect(base?.block).toContain("display: revert-layer");
    expect(base?.block?.match(/display:/g)).toHaveLength(1);
    for (const value of ["block", "flex", "grid", "inline", "contents", "flow-root", "revert;"]) {
      expect(base?.block, value).not.toContain(`display: ${value}`);
    }
    expect(base?.block).not.toContain("visibility:");

    const open = emitted.find((rule) => rule.selector === "&:popover-open");
    expect(open?.block).toContain("display: flex");
    // And nothing may sneak a display in through an at-rule either, which is the same defect
    // Arriving at one viewport width and therefore harder to see.
    for (const rule of emitted) {
      if (rule.selector.startsWith("@")) {
        expect(rule.block, rule.selector).not.toContain("display:");
      }
    }
  });

  test("[hidden] beats :popover-open, so hiding a shown panel actually hides it", async () => {
    await panel();
    const emitted = rules(documentStyleText());
    const open = emitted.findIndex((rule) => rule.selector === "&:popover-open");
    const hidden = emitted.findIndex((rule) => rule.selector === "&[hidden]:popover-open");
    expect(hidden).toBeGreaterThan(-1);
    expect(emitted[hidden]!.block).toContain("display: none");
    /* And a plain `&[hidden]`, for the closed panel. `display: revert` in the base rule cannot in
       fact beat the UA's `[hidden] { display: none }` — it reverts to it — but a base rule that
       declares a display owes a reader an answer to "what does hidden mean here", and the kit
       contract asks every one of them for it. */
    const rest = emitted.find((rule) => rule.selector === "&[hidden]");
    expect(rest?.block).toContain("display: none");
    // The UA's `[hidden] { display: none }` is (0,1,0) and loses to a `:popover-open` rule, and
    // The conformance host-display check is a SHALLOW `"display" in style` on the root, so it
    // Cannot see this. The repair is one rule that is strictly more specific and later.
    expect(hidden).toBeGreaterThan(open);
    expect(emitted[hidden]!.selector).toContain(emitted[open]!.selector.replace("&", "&[hidden]"));
  });

  test("keeps the scroll box off the element the arrow hangs from, so an arrow paints", async () => {
    const el = await panel({ arrow: true });
    const emitted = rules(sheetFor(el));
    const base = emitted.find((rule) => rule.selector === "&");
    const content = emitted.find((rule) => rule.selector === '& > [part="content"]');
    const arrow = emitted.find((rule) => rule.selector === '& > [part="arrow"]');
    /* The panel is `position: fixed`, so it is the arrow's containing block, and the arrow sits
       5px ABOVE its padding box. A scroll container clips exactly that, and a negative
       block-start offset contributes no scrollable overflow — so with `overflow: auto` here the
       arrow is not scrolled to, it is gone, and what is left is a 3px diamond of the panel's own
       background painted over its content. Measured in Chrome 152: `elementFromPoint` at the
       arrow's tip returns HTML with `overflow: auto` and the arrow with `overflow: visible`. */
    expect(arrow?.block).toContain("inset-block-start: -5px");
    expect(base?.block).toContain("overflow: visible");
    expect(base?.block).not.toContain("overflow: auto");
    // Scrolling belongs to the content box instead, which needs `min-height: 0` to shrink at all
    // Inside the panel's own flex column.
    expect(content?.block).toContain("overflow: auto");
    expect(content?.block).toContain("min-height: 0");
  });

  test("keeps the open rule with the attribute on the Studio canvas, so a shown panel is visible", async () => {
    setCanvasDelinkPopovers(true);
    try {
      const el = document.createElement("jx-popover");
      // What the studio's stamper writes; it is also the runtime's gate for both halves below.
      el.dataset["jxPath"] = "/children/0";
      document.body.append(el);
      await tick();
      // The canvas renames `popover`, so the panel leaves the top layer and the artboard can grow
      // Around it. `:popover-open` cannot match after that — and the runtime transposes it to
      // `[data-jx-popover-open]` in the same move, at the same (0,1,0) specificity.
      expect(el.getAttribute("popover")).toBeNull();
      expect(el.dataset["jxPopover"]).toBe("auto");
      const scoped = sheetFor(el);
      expect(scoped).not.toContain(":popover-open");
      const emitted = rules(scoped);
      const base = emitted.find((rule) => rule.selector === "&");
      const open = emitted.find((rule) => rule.selector === "&[data-jx-popover-open]");
      expect(base?.block).toContain("opacity: 0");
      /* Without the transposed rule the base `opacity: 0` would be the last word on the canvas:
         the author opens a panel and sees nothing, badge included, because opacity groups its
         subtree. Studio's shown-in-place rule forces position, inset, align-self and flex, and
         neither display nor opacity, so this rule is the only thing that restores either. */
      expect(open?.block).toContain("opacity: 1");
      expect(open?.block).toContain("display: flex");
    } finally {
      setCanvasDelinkPopovers(false);
    }
  });

  test("transitions display together with overlay, and puts no display inside @starting-style", () => {
    const style = documents["jx-popover"]!.style as Record<string, unknown>;
    const transition = String(style["transition"]);
    expect(transition).toContain("display");
    // Without `overlay …allow-discrete` the panel drops out of the top layer a frame early and
    // The exit reads as a flicker, which is the `cut-exit` rule.
    expect(transition).toContain("overlay");
    /* And BOTH need `allow-discrete` by name: `display` and `overlay` are discrete properties, so
       without it neither is animatable at all and the exit cuts — the very defect `cut-exit`
       describes, which its own test (`value.includes("display") && !value.includes("overlay")`)
       cannot see. */
    for (const property of ["display", "overlay"]) {
      const clause = transition.split(",").find((part) => part.trim().startsWith(property));
      expect(clause, property).toContain("allow-discrete");
    }
    const starting = style["@starting-style"] as Record<string, unknown>;
    expect(starting).toBeDefined();
    expect("display" in starting).toBe(false);
    expect(JSON.stringify(starting)).toContain("opacity");
  });
});

describe("jx-popover on the page", () => {
  test("is a native auto popover, named only when it has a label", async () => {
    const named = await panel({ label: "Grid options" });
    expect(named.getAttribute("popover")).toBe("auto");
    expect(named.getAttribute("role")).toBe("group");
    expect(named.getAttribute("aria-label")).toBe("Grid options");

    const bare = await panel();
    expect(bare.hasAttribute("role")).toBe(false);
    expect(bare.hasAttribute("aria-label")).toBe(false);
  });

  test("projects any content into a real scroll box, and an arrow only when asked for one", async () => {
    const plain = await panel();
    /* A `<slot>` leaves NO NODE — distribution replaces it with its matches — so the scroll box
       cannot be the slot. It is a real `<div>`, because `& > [part="content"]` has to address
       something: on a slot that part named nothing and the panel's own overflow would have had to
       do the scrolling, which is the defect the arrow test below measures. */
    expect(plain.querySelectorAll("slot").length).toBe(0);
    const content = plain.querySelector('[part="content"]')!;
    expect(content.tagName.toLowerCase()).toBe("div");
    // The projected child is a DIRECT child of the box, not a grandchild behind a slot, which is
    // What `& > [part="content"]` and its flex column need.
    expect(content.firstElementChild?.tagName.toLowerCase()).toBe("p");
    expect(content.textContent).toBe("Panel content");
    /* UNNAMED, and that is the whole content contract: any shape projects, from the colour
       popover's area+slider+swatches to the grid form. Naming it destroys every consumer's
       children silently — `distributeSlots` matches on `slot="…"`, so nothing goes in and the
       panel renders empty with every gate green. The slot is gone from the DOM, so the document
       is where that is asserted. */
    const box = (documents["jx-popover"]!.children as JxElement[])[0]!;
    expect(box.attributes?.["part"]).toBe("content");
    const slot = (box.children as JxElement[])[0]!;
    expect(slot.tagName).toBe("slot");
    expect(slot.attributes?.["name"]).toBeUndefined();
    expect(plain.querySelector('[part="arrow"]')!.hasAttribute("hidden")).toBe(true);

    const pointed = await panel({ arrow: true });
    expect(pointed.querySelector('[part="arrow"]')!.hasAttribute("hidden")).toBe(false);
    expect(pointed.querySelector('[part="arrow"]')!.getAttribute("aria-hidden")).toBe("true");
  });

  test("the platform's toggle mirrors open onto the state and the host; close clears both", async () => {
    const el = await panel();
    expect(el.open).toBe(false);
    el.showPopover();
    await tick();
    expect(el.open).toBe(true);
    expect(el.dataset["open"]).toBe("");
    el.getAnimations = () => [{} as Animation];
    close(el);
    await tick();
    expect(el.open).toBe(false);
    expect(el.dataset["open"]).toBeUndefined();
    // A CLOSING panel is settling too: a host that waits for `data-jx-settling` to clear before
    // Measuring would otherwise measure a panel mid-exit.
    expect(el.dataset["jxSettling"]).toBe("");
  });

  test("announces jx-ready once it has rendered, which is when a host may show it", async () => {
    const el = document.createElement("jx-popover") as JxPopover;
    const seen: string[] = [];
    const listen = (event: Event) => {
      seen.push((event.target as Element).tagName.toLowerCase());
    };
    document.addEventListener("jx-ready", listen);
    document.body.append(el);
    await tick();
    document.removeEventListener("jx-ready", listen);
    // The event is what tells a host the element carries its popover attribute; a host awaiting it
    // Before `openAt` hangs forever without it.
    expect(seen).toContain("jx-popover");
    expect(el.getAttribute("popover")).toBe("auto");
  });

  test("writing el.open = true does NOT show the panel: the prop is mirrored, not a door", async () => {
    const el = await panel();
    el.open = true;
    await tick();
    // The state took the write, and the platform learned nothing — which is the whole point of
    // The warning in the prop's description.
    expect(el.dataset["popoverOpen"]).toBeUndefined();
    el.showPopover();
    await tick();
    expect(el.dataset["popoverOpen"]).toBe("");
    expect(el.open).toBe(true);
  });

  test("raises data-jx-settling while a transition runs and clears it when the host comes to rest", async () => {
    const el = await panel();
    el.getAnimations = () => [{} as Animation];
    el.showPopover();
    await tick();
    await frame();
    await tick();
    // A real transition is running, so the frame leaves the flag alone.
    expect(el.dataset["jxSettling"]).toBe("");
    el.dispatchEvent(new Event("transitionend"));
    await tick();
    expect(el.dataset["jxSettling"]).toBeUndefined();
  });

  test("clears data-jx-settling in a frame when a zeroed transition fires no transitionend", async () => {
    const el = await panel();
    // `@(prefers-reduced-motion: reduce)` zeroes `--jx-dur-*`, and a 0ms transition fires no
    // `transitionend` in most engines — so without the frame path the flag sticks forever and
    // Nothing waiting for the panel to settle ever proceeds.
    el.getAnimations = () => [];
    el.showPopover();
    await tick();
    await frame();
    await tick();
    expect(el.dataset["jxSettling"]).toBeUndefined();
  });

  test("measures the anchor under matchWidth on toggle, and only on toggle", async () => {
    const el = await panel({ matchWidth: true });
    const trigger = document.createElement("button");
    document.body.append(trigger);
    stubRect(trigger, { height: 24, left: 0, top: 0, width: 220 });
    openAt(el, trigger);
    await tick();
    expect(el.anchorWidth).toBe(220);
    // A resize of the trigger while the panel is open changes nothing: the measurement is at
    // `@sp-opened` parity, not a per-frame observer.
    stubRect(trigger, { height: 24, left: 0, top: 0, width: 90 });
    await frame();
    await tick();
    expect(el.anchorWidth).toBe(220);
    close(el);
    await tick();
    openAt(el, trigger);
    await tick();
    expect(el.anchorWidth).toBe(90);
  });

  test("matches the width of a trigger that opened it through the platform, not only openAt", async () => {
    const el = await panel({ matchWidth: true });
    el.id = "stylebook-grid";
    const trigger = document.createElement("button");
    trigger.setAttribute("popovertarget", el.id);
    document.body.append(trigger);
    stubRect(trigger, { height: 24, left: 0, top: 0, width: 240 });
    expect(resolved(el, "min-width")).toBe("180px");
    /* Exactly what `<button popovertarget>` does, and it is the spelling the stylebook, the docs
       and the lints all sanction — so a measurement keyed on what `openAt` recorded is a
       measurement that essentially never happens. `openAt` never runs here. */
    el.showPopover();
    await tick();
    expect(el.anchorWidth).toBe(240);
    // And the measurement has to REACH the box: the reactive declaration is a `var()` read of an
    // Inline custom property, so following it is what proves min-width is not still the fallback.
    expect(resolved(el, "min-width")).toBe("240px");
  });

  test("leaves anchorWidth alone when matchWidth is off", async () => {
    const el = await panel();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    stubRect(trigger, { height: 24, left: 0, top: 0, width: 220 });
    openAt(el, trigger);
    await tick();
    expect(el.anchorWidth).toBe(0);
  });

  test("places itself by coordinate: a fixed box whose insets follow x and y", async () => {
    const el = await panel({ x: 12, y: 34 });
    const base = rules(sheetFor(el)).find((rule) => rule.selector === "&");
    /* Placing by measured viewport coordinate IS the substitute for anchor positioning — `anchor`,
       `placement` and `position-try-fallbacks` were dropped in favour of it — so the coordinate
       reaching the box is the contract, not an implementation detail. A panel that computes a
       perfect `y` and never applies it, or that is `position: static` inside a scrolled container,
       is indistinguishable from a correct one to a test that reads only the state. */
    expect(base?.block).toContain("position: fixed");
    expect(resolved(el, "inset-inline-start")).toBe("12px");
    expect(resolved(el, "inset-block-start")).toBe("34px");
    el.y = 78;
    await tick();
    expect(resolved(el, "inset-block-start")).toBe("78px");
  });

  test("clamps a shown panel back up to a floor its BOX reaches, offset and all", async () => {
    const el = await panel({ floor: 500, x: 10, y: 400 });
    /* `state.y` becomes `inset-block-start`, and the panel then adds
       `margin-block-start: var(--jx-popover-offset, 4px)` on top of it — so `floor - height`
       leaves the rendered bottom edge at `floor + 4`, over the status bar the `floor` prop exists
       to keep it off. That is the prop's own promise, and it arrived broken with the move: the
       shared clamp is exact for jx-menu, whose base style carries no block-start margin. */
    const base = rules(sheetFor(el)).find((rule) => rule.selector === "&");
    expect(base?.block).toContain("margin-block-start: var(--jx-popover-offset, 4px)");
    expect(getComputedStyle(el).marginBlockStart).toBe("4px");
    stubRect(el, { height: 300, left: 10, top: 404, width: 200 });
    el.showPopover();
    await tick();
    await frame();
    await tick();
    expect(el.y).toBe(500 - 300 - 4);
  });
});

describe("the popover behaviour", () => {
  test("openAt names the anchor as the popover's source, so focus can be restored to it", async () => {
    const el = await panel();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    openAt(el, trigger);
    await tick();
    expect(el.open).toBe(true);
    expect(anchorOf(el)).toBe(trigger);
    // The source is what makes the invoker not "outside": a mousedown on the button a panel was
    // Opened from belongs to the button's own click, which is what makes a toggle a toggle.
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await tick();
    expect(el.open).toBe(true);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await tick();
    expect(el.open).toBe(false);
  });

  test("openAt falls back to a bare showPopover when the options bag is rejected", () => {
    const calls: unknown[][] = [];
    const host = {
      showPopover(...args: unknown[]) {
        calls.push(args);
        if (args.length > 0) {
          throw new TypeError("no overload takes 1 argument");
        }
      },
    } as unknown as PopoverElement;
    const anchor = document.createElement("button");
    openAt(host, anchor);
    // `showPopover.length` is 0 even in an engine that accepts the bag, so arity detection cannot
    // Work: the try/catch IS the feature test.
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual([{ source: anchor }]);
    expect(calls[1]).toEqual([]);
  });

  test("openAt re-raises a refused show instead of retrying it and throwing twice", () => {
    const calls: unknown[][] = [];
    const host = {
      showPopover(...args: unknown[]) {
        calls.push(args);
        throw new DOMException("Not a popover element", "NotSupportedError");
      },
    } as unknown as PopoverElement;
    const anchor = document.createElement("button");
    /* Only a `TypeError` means "this engine has no options bag". A `DOMException` is the call
       itself refusing, and the bare retry ran OUTSIDE the try — so it threw the same error a
       second time, out of `openAt` and into whatever bound the handler. */
    expect(() => {
      openAt(host, anchor);
    }).toThrow("Not a popover element");
    expect(calls.length).toBe(1);
    expect(anchorOf(host as unknown as HTMLElement)).toBeNull();
  });

  test("a panel that never opened records no anchor, and a closed one stops holding its trigger", async () => {
    const el = await panel();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    openAt(el, trigger);
    await tick();
    expect(anchorOf(el)).toBe(trigger);
    /* A `WeakMap` is weak in its KEY: while the panel lives it holds the trigger, its subtree and
       every listener on it STRONGLY. A long-lived panel over a churning surface would pin one
       removed trigger per open, so the entry goes when the platform says the panel closed. */
    close(el);
    await tick();
    expect(anchorOf(el)).toBeNull();

    // Light dismissal closes a panel without going through `close`, and drops it just the same.
    openAt(el, trigger);
    await tick();
    expect(anchorOf(el)).toBe(trigger);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await tick();
    expect(anchorOf(el)).toBeNull();
  });

  test("onToggle measures the source the platform names, ahead of anything it recorded", () => {
    const host = document.createElement("div");
    host.id = "panel-with-two-triggers";
    document.body.append(host);
    const named = document.createElement("button");
    stubRect(named, { height: 24, left: 0, top: 0, width: 133 });
    const other = document.createElement("button");
    other.setAttribute("popovertarget", host.id);
    stubRect(other, { height: 24, left: 0, top: 0, width: 44 });
    document.body.append(named, other);
    const state: PopoverState = { matchWidth: true };
    // Chrome 152 carries `source` on the toggle for an invoker click and for
    // `showPopover({ source })` alike, so it is the platform's own answer and outranks the rest.
    onToggle(state, { currentTarget: host, newState: "open", source: named } as unknown as Event);
    expect(state.anchorWidth).toBe(133);
    // With no source, the invoker that names the panel is the fallback for an engine that has none.
    const older: PopoverState = { matchWidth: true };
    onToggle(older, { currentTarget: host, newState: "open" } as unknown as Event);
    expect(older.anchorWidth).toBe(44);
  });

  test("openAt with no anchor makes a bare call, and does nothing at all without the API", () => {
    const calls: unknown[][] = [];
    const host = {
      showPopover(...args: unknown[]) {
        calls.push(args);
      },
    } as unknown as PopoverElement;
    openAt(host);
    expect(calls).toEqual([[]]);
    expect(anchorOf(host as unknown as HTMLElement)).toBeNull();
    expect(() => {
      openAt({} as unknown as PopoverElement, document.createElement("button"));
    }).not.toThrow();
    expect(() => {
      close({} as unknown as PopoverElement);
    }).not.toThrow();
  });

  test("onTransitionEnd clears settling only for the panel's own transition", () => {
    const host = document.createElement("div");
    const child = document.createElement("span");
    host.append(child);
    const state: PopoverState = { settling: true };
    onTransitionEnd(state, { currentTarget: host, target: child } as unknown as Event);
    // A transition on a child is not the panel coming to rest.
    expect(state.settling).toBe(true);
    onTransitionEnd(state, { currentTarget: host, target: host } as unknown as Event);
    expect(state.settling).toBe(false);
  });

  test("onToggle keeps settling raised while the host is still animating", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.getAnimations = () => [{} as Animation];
    const state: PopoverState = {};
    onToggle(state, { currentTarget: host, newState: "open" } as unknown as Event);
    expect(state.open).toBe(true);
    expect(state.settling).toBe(true);
    await frame();
    // A real transition is running, so clearing it is `onTransitionEnd`'s job, not the frame's.
    expect(state.settling).toBe(true);
  });

  test("onToggle on a closing panel mirrors open and never measures", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    stubRect(host, { height: 300, left: 10, top: 400, width: 200 });
    const state: PopoverState = { floor: 500, matchWidth: true, open: true, y: 400 };
    onToggle(state, { currentTarget: host, newState: "closed" } as unknown as Event);
    expect(state.open).toBe(false);
    await frame();
    expect(state.y).toBe(400);
    expect(state.anchorWidth).toBeUndefined();
  });

  test("onToggle ignores an event that is not on an element", () => {
    const state: PopoverState = {};
    onToggle(state, new Event("toggle"));
    expect(state.open).toBeUndefined();
  });

  test("measureAnchor is a no-op with nothing to measure, and ignores a zero-width box", () => {
    const state: PopoverState = { matchWidth: true };
    const host = document.createElement("div");
    measureAnchor(state, host);
    expect(state.anchorWidth).toBeUndefined();
    const anchor = document.createElement("button");
    stubRect(anchor, { height: 0, left: 0, top: 0, width: 0 });
    measureAnchor(state, host, anchor);
    expect(state.anchorWidth).toBeUndefined();

    // And an id no button aims at is nothing to measure either: a panel opened from code with no
    // Anchor, on an engine whose toggle carries no source, has no trigger to be as wide as.
    const orphan = document.createElement("div");
    orphan.id = "nothing-aims-here";
    document.body.append(orphan);
    const lonely: PopoverState = { matchWidth: true };
    onToggle(lonely, { currentTarget: orphan, newState: "open" } as unknown as Event);
    expect(lonely.anchorWidth).toBeUndefined();
  });

  test("clampIntoViewport slides a panel in, or flips it beside what it is given", async () => {
    const panelEl = document.createElement("div");
    document.body.append(panelEl);
    stubRect(panelEl, { height: 80, left: window.innerWidth - 20, top: 10, width: 180 });
    const slid: PopoverState = {};
    clampIntoViewport(slid, panelEl);
    await frame();
    expect(slid.x).toBe(window.innerWidth - 180 - 4);
    expect(slid.y).toBeUndefined();

    const parent = document.createElement("div");
    document.body.append(parent);
    stubRect(parent, { height: 200, left: window.innerWidth - 220, top: 10, width: 200 });
    const flipped: PopoverState = {};
    clampIntoViewport(flipped, panelEl, { flipAgainst: parent });
    await frame();
    expect(flipped.x).toBe(window.innerWidth - 220 - 180 + 2);
  });

  test("clampIntoViewport leaves an unlaid-out panel where it is", async () => {
    const panelEl = document.createElement("div");
    document.body.append(panelEl);
    // A zero-SIZE box parked past both edges: every overflow test says move it, and moving it
    // Would slam a panel the engine has simply not laid out yet against the viewport edges —
    // Where a real measurement, one frame later, would have found it perfectly placed.
    stubRect(panelEl, {
      height: 0,
      left: window.innerWidth,
      top: window.innerHeight + 10,
      width: 0,
    });
    const state: PopoverState = { x: 7, y: 9 };
    clampIntoViewport(state, panelEl);
    await frame();
    expect(state.x).toBe(7);
    expect(state.y).toBe(9);
  });
});
