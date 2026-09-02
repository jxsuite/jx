import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText } from "@jxsuite/runtime";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxSpinner = HTMLElement & { value: string; label: string; size: string };

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  document.body.replaceChildren();
});

async function spinner(attrs: Record<string, string> = {}): Promise<JxSpinner> {
  const el = document.createElement("jx-spinner") as JxSpinner;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  document.body.append(el);
  await tick();
  return el;
}

const glyph = (el: Element) => el.querySelector<HTMLElement>('[part="glyph"]')!;

/**
 * Every emitted rule that mentions ONE element's scope handle, keyed by its selector with that
 * handle replaced by `&`.
 *
 * Scoped to one handle on purpose. Keying the whole sheet by selector collapses every element's own
 * base rule onto `&`, so the last one rendered silently answers for all of them — which is a test
 * that reads whichever element happened to render last.
 *
 * @param {HTMLElement} el - The element whose handle to read
 * @returns {Map<string, string>}
 */
function rulesOf(el: HTMLElement): Map<string, string> {
  const handle = `[data-jx="${el.dataset["jx"] ?? ""}"]`;
  const out = new Map<string, string>();
  for (const line of documentStyleText().split("\n")) {
    const match = /^(.*?) \{ (.*) \}$/.exec(line);
    if (match && match[1]!.includes(handle)) {
      out.set(match[1]!.replaceAll(handle, "&"), match[2]!);
    }
  }
  return out;
}

/**
 * Every declaration that decides what this spinner PAINTS: its own rules, its glyph's own rule, and
 * the glyph's inline style. The colour finding was that one of these named `--jx-accent`.
 *
 * @param {HTMLElement} el - The spinner
 * @returns {string}
 */
function paintOf(el: HTMLElement): string {
  const handles = [el.dataset["jx"] ?? "", glyph(el).dataset["jx"] ?? ""];
  const lines = documentStyleText()
    .split("\n")
    .filter((line) => handles.some((h) => h !== "" && line.includes(`[data-jx="${h}"]`)));
  return `${lines.join("\n")}\n${glyph(el).getAttribute("style") ?? ""}`;
}

describe("jx-spinner", () => {
  test("is a progressbar that names itself, or hides itself when it has no name", async () => {
    /* The one-name shape jx-icon already ships: a label names it, and no label REMOVES the name
       and hides the node instead, because "progressbar" announced alone says nothing. */
    const named = await spinner({ label: "Loading components" });
    expect(named.getAttribute("role")).toBe("progressbar");
    expect(named.getAttribute("aria-label")).toBe("Loading components");
    expect(named.hasAttribute("aria-hidden")).toBe(false);

    const bare = await spinner();
    expect(bare.getAttribute("role")).toBe("progressbar");
    expect(bare.hasAttribute("aria-label")).toBe(false);
    expect(bare.getAttribute("aria-hidden")).toBe("true");

    named.label = "";
    await tick();
    expect(named.hasAttribute("aria-label")).toBe(false);
    expect(named.getAttribute("aria-hidden")).toBe("true");
  });

  test("an empty value writes no value attributes at all, because that IS indeterminate", async () => {
    /* An ARIA progressbar with no aria-valuenow is the indeterminate state. Writing a valuenow of
       0 would announce "0 percent" for a spinner that knows nothing about its own progress. */
    const el = await spinner({ label: "Working" });
    expect(el.hasAttribute("aria-valuenow")).toBe(false);
    expect(el.hasAttribute("aria-valuemin")).toBe(false);
    expect(el.hasAttribute("aria-valuemax")).toBe(false);
    expect(el.dataset["determinate"]).toBeUndefined();
  });

  test("a value announces itself, with the min and max the range is read against", async () => {
    const el = await spinner({ label: "Importing", value: "40" });
    expect(el.getAttribute("aria-valuenow")).toBe("40");
    expect(el.getAttribute("aria-valuemin")).toBe("0");
    expect(el.getAttribute("aria-valuemax")).toBe("100");
    expect(el.dataset["determinate"]).toBeDefined();
  });

  test("value is a STRING entry, so removing the attribute is empty rather than zero", async () => {
    /* `absorbAttribute` coerces by the CURRENT value's type, so a numeric entry would turn a
       removed attribute into `Number(null) === 0` — a determinate ring stuck at nothing, which is
       exactly the state that has to stay expressible as "I do not know". */
    const el = await spinner({ label: "Importing" });
    el.setAttribute("value", "60");
    await tick();
    expect(el.value).toBe("60");
    el.removeAttribute("value");
    await tick();
    expect(el.value).toBe("");
    expect(el.hasAttribute("aria-valuenow")).toBe(false);
  });

  test("determinate fills a ring and stops the rotation; indeterminate spins an empty one", async () => {
    const el = await spinner({ label: "Importing" });
    /* A bound child `style` is hoisted to a per-instance custom property plus a rule, so the
       inline style is the PROPERTY and the rule is where `background` is spelled — reading
       `style.background` back would be `""` in both states and could never fail. */
    expect(rulesOf(glyph(el)).get("&")).toMatch(/^background: var\(--jx-r\d+-\d+\)$/);
    expect(glyph(el).getAttribute("style")).toMatch(/^--jx-r\d+-\d+: none;$/);
    expect(el.querySelector('[part="glyph-icon"]')!.hasAttribute("hidden")).toBe(false);

    el.value = "40";
    await tick();
    const ring = glyph(el).getAttribute("style") ?? "";
    expect(ring).toContain(
      "conic-gradient(var(--jx-spin-color) 40%, var(--jx-spin-track-color) 0)",
    );
    expect(el.querySelector('[part="glyph-icon"]')!.hasAttribute("hidden")).toBe(true);

    const r = rulesOf(el);
    expect(r.get('& [part="glyph"]')).toContain("animation: jx-spin var(--jx-spin-dur) linear");
    expect(r.get('&[data-determinate] [part="glyph"]')).toContain("animation: none");
    /* A conic gradient on its own is a filled PIE. The mask is what cuts the middle out, and the
       track width is what the cut is measured from — delete either and the element draws a solid
       disc where a progress ring belongs, with nothing else in the document changing. */
    expect(r.get('&[data-determinate] [part="glyph"]')).toContain(
      "mask: radial-gradient(farthest-side, transparent calc(100% - var(--jx-spin-track)), black 0)",
    );
    expect(r.get("&")).toContain("--jx-spin-track: 2px");

    el.value = "";
    await tick();
    expect(glyph(el).getAttribute("style")).not.toContain("conic-gradient");
    expect(el.querySelector('[part="glyph-icon"]')!.hasAttribute("hidden")).toBe(false);
  });

  test("the glyph is the shipped spinner drawing, inside the part that rotates", async () => {
    const el = await spinner({ label: "Working" });
    const icon = el.querySelector<HTMLElement & { name: string; weight: string }>(
      '[part="glyph-icon"]',
    )!;
    expect(icon.tagName).toBe("JX-ICON");
    expect(icon.name).toBe("spinner");
    expect(glyph(el).contains(icon)).toBe(true);
    /* `not.toBe("")` would pass for a `<path>` carrying no `d`, because a missing attribute reads
       back as null: the assertion has to be about the path data itself. */
    const d = icon.querySelector("path")!.getAttribute("d");
    expect(d).toMatch(/^M/);
    expect(d!.length).toBeGreaterThan(100);
  });

  test("the keyframes is hoisted document-global, and minted once under the kit's prefix", async () => {
    /* A keyframes name has no scope: the style builder hoists it, and two definitions of one name
       mean the LAST one wins and the earlier animation is dropped entirely. `jx-` is the whole
       mitigation, and one emission however many spinners are on the page is the other half. */
    await spinner({ label: "One" });
    await spinner({ label: "Two", value: "10" });
    const css = documentStyleText();
    expect(css).toContain("@keyframes jx-spin { from { rotate: 0deg } to { rotate: 360deg } }");
    expect(css.match(/@keyframes jx-spin\b/g)).toHaveLength(1);
    expect(css).not.toMatch(/@keyframes (?!jx-)/);
  });

  test("reduced motion SLOWS the rotation instead of zeroing it", async () => {
    /* `--jx-dur-*` is zeroed under `prefers-reduced-motion: reduce`, which is right for a
       transition and wrong for a busy indicator: a 0-duration spin is a frozen spinner, and a
       frozen spinner reads as a hang. The rotation therefore has a duration of its own. */
    const el = await spinner({ label: "Working" });
    const css = documentStyleText();
    const r = rulesOf(el);
    expect(r.get("&")).toContain("--jx-spin-dur: 900ms");
    expect(r.get("&")).not.toContain("--jx-spin-dur: 0");

    const handle = `[data-jx="${el.dataset["jx"] ?? ""}"]`;
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(block).toContain(`${handle} { --jx-spin-dur: 2400ms }`);

    // And the rotation never reads a token the theme is allowed to zero.
    expect(r.get('& [part="glyph"]')).not.toContain("--jx-dur");
  });

  test("the document declares its own duration, not the project's", async () => {
    // `--jx-spin-dur` belongs to the element, because project.json is not this element's file.
    const style = documents["jx-spinner"]!.style as Record<string, unknown>;
    expect(style["--jx-spin-dur"]).toBe("900ms");
    expect(style["@keyframes jx-spin"]).toBeDefined();
  });

  test("size moves the ring without moving the row it sits in", async () => {
    const el = await spinner({ label: "Working", size: "sm" });
    expect(el.dataset["size"]).toBe("sm");
    const r = rulesOf(el);
    expect(r.get('&[data-size="sm"]')).toContain("--jx-spin-size: 12px");
    expect(r.get('&[data-size="lg"]')).toContain("--jx-spin-size: 20px");
    expect(r.get("&")).toContain("--jx-spin-size: var(--jx-icon-size, 16px)");
    /* Declaring the variable moves nothing. These are the two declarations that READ it — the
       ring's own box, and the glyph inside it through the kit's icon variable. Sever both and
       `size` changes nothing on screen while every assertion above still passes. */
    expect(r.get('& [part="glyph"]')).toContain("width: var(--jx-spin-size)");
    expect(r.get('& [part="glyph"]')).toContain("height: var(--jx-spin-size)");
    expect(r.get('& [part="glyph-icon"]')).toBe("--jx-icon-size: var(--jx-spin-size)");
    // And the other half of the name: a non-shrinking box sitting on the middle of the text.
    expect(r.get("&")).toContain("flex: none");
    expect(r.get("&")).toContain("vertical-align: middle");
  });

  test("the ring paints in the text colour around it, never in a fixed accent", async () => {
    /* `color: var(--jx-accent)` on the glyph is the accent BUTTON's own fill. Measured in Chrome
       152: control background and glyph fill both `rgb(37, 99, 235)`, so a loading accent button —
       the case `loading` exists for — showed an empty gap where the spinner should be. The spinner
       therefore paints in `currentColor`, exposed as a token so a consumer can still override it. */
    const el = await spinner({ label: "Importing", value: "40" });
    const r = rulesOf(el);
    expect(r.get("&")).toContain("--jx-spin-color: currentColor");
    expect(r.get("&")).toContain("--jx-spin-track-color: var(--jx-border)");
    expect(r.get('& [part="glyph"]')).toContain("color: var(--jx-spin-color)");
    expect(getComputedStyle(glyph(el)).color).toBe("currentcolor");
    // Nothing this element paints with names the accent, which IS the accent button's background.
    expect(paintOf(el)).not.toContain("--jx-accent");
  });

  test("a number through the property door renders as a value, not as a fourth state", async () => {
    /* `value` is a string entry and the attribute door is guarded, but a host porting a
       `progress=${…}` binding writes a NUMBER straight to the property. Three separate spellings
       of "is it empty" then disagreed at 0: `value !== ""` said determinate and hid the glyph,
       while `state.value ? …` wrote none of the value attributes — a rotating solid disc with no
       glyph and no announced value, which is a state the element has no rendering for. One
       normalised predicate, #/state/progress, is what every one of them reads now. */
    const el = await spinner({ label: "Importing" });
    const host = el as unknown as { value: unknown };
    host.value = 0;
    await tick();
    expect(el.getAttribute("aria-valuenow")).toBe("0");
    expect(el.getAttribute("aria-valuemin")).toBe("0");
    expect(el.getAttribute("aria-valuemax")).toBe("100");
    expect(el.dataset["determinate"]).toBeDefined();
    expect(glyph(el).getAttribute("style")).toContain("conic-gradient(var(--jx-spin-color) 0%");
    expect(el.querySelector('[part="glyph-icon"]')!.hasAttribute("hidden")).toBe(true);

    host.value = 60;
    await tick();
    expect(el.getAttribute("aria-valuenow")).toBe("60");
    expect(glyph(el).getAttribute("style")).toContain("conic-gradient(var(--jx-spin-color) 60%");
  });

  test("hidden hides it, because the host declares a display of its own", async () => {
    const el = await spinner({ label: "Working" });
    const r = rulesOf(el);
    expect(r.get("&")).toContain("display: inline-flex");
    expect(r.get("&[hidden]")).toBe("display: none");
    /* `el.hidden` reflecting to the attribute is the platform's and holds for any element. What is
       THIS element's is that an `inline-flex` host overrides the UA's `[hidden]` rule, so the
       computed display is the only thing that says the rule above actually reaches it. */
    expect(getComputedStyle(el).display).toBe("inline-flex");
    el.hidden = true;
    await tick();
    expect(getComputedStyle(el).display).toBe("none");
  });
});
