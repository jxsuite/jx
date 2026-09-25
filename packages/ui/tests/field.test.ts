/**
 * `jx-field`: one element where the kit shipped four classes — `.jx-field-row`, `.jx-field-label`,
 * `.jx-help-text` and `.jx-help-text--error`. They were always one contract, which is why every
 * call site that used them hand-wrote two ids and repeated both back as `labelledby` and
 * `describedby`. The row now mints those ids and names its own control, and these tests are what
 * hold it to that.
 */
import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStyleRules } from "@jxsuite/runtime/css";
import type { JxStyle } from "@jxsuite/schema/types";
import fieldDoc from "../components/jx-field.json";
import { nameFieldControl } from "../src/behaviors/textfield.ts";
import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxField = HTMLElement & {
  label: string;
  description: string;
  required: boolean;
  invalid: boolean;
  warning: boolean;
  span: boolean;
  uid: string;
};

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A mounted `jx-field`, with attributes written before it connects and the control slotted the way
 * a consumer writes it.
 *
 * @param {Record<string, string>} [attrs] Attributes to set before connecting
 * @param {string} [markup] Light-DOM children: the control, and anything for the help slot
 * @returns {Promise<JxField>} The connected element, after its first render and its mount
 */
async function row(attrs: Record<string, string> = {}, markup = ""): Promise<JxField> {
  const el = document.createElement("jx-field") as JxField;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  if (markup !== "") {
    el.innerHTML = markup;
  }
  document.body.append(el);
  await tick();
  await tick();
  return el;
}

const part = (el: Element, name: string) => el.querySelector<HTMLElement>(`[part="${name}"]`)!;

/** The element's own rules, as the sheet spells them under a test scope. */
const rules = buildStyleRules(fieldDoc.style as JxStyle, { scope: "S" }).map((rule) => rule.text);

/** The one rule the element emits for a selector, WHOLE — every declaration it carries. */
function ruleFor(selector: string): string {
  const found = rules.filter((text) => text.startsWith(`${selector} {`));
  expect(found, `expected exactly one rule for ${selector}`).toHaveLength(1);
  return found[0]!;
}

const stylebookDir = resolve(import.meta.dir, "..", "stylebook");
const pageText = (name: string) => readFileSync(resolve(stylebookDir, name), "utf8");

describe("jx-field", () => {
  test("draws the three boxes the four classes drew, and the slot leaves no node", async () => {
    const el = await row(
      { label: "Title", description: "Shown in the Library." },
      "<jx-textfield></jx-textfield>",
    );
    const [label, control, help] = [...el.children] as HTMLElement[];
    expect(label!.tagName).toBe("LABEL");
    expect(label!.getAttribute("part")).toBe("label");
    expect(label!.textContent).toBe("Title");
    expect(control!.getAttribute("part")).toBe("control");
    expect(help!.tagName).toBe("P");
    expect(help!.getAttribute("part")).toBe("help");
    expect(help!.textContent).toBe("Shown in the Library.");
    // Both slots unwrapped: the control stands in the default slot's place, the description in the
    // Help slot's, and neither slot is addressable any more.
    expect(el.querySelector("slot")).toBeNull();
    expect(control!.firstElementChild?.tagName).toBe("JX-TEXTFIELD");
  });

  test("names the slotted control from an id it mints, so no call site writes one", async () => {
    const el = await row(
      { label: "Title", description: "Shown in the Library." },
      "<jx-textfield></jx-textfield>",
    );
    const stem = el.uid;
    expect(stem).toMatch(/^jx-field-\d+$/u);
    expect(part(el, "label").id).toBe(`${stem}-label`);
    expect(part(el, "help").id).toBe(`${stem}-help`);

    /* The naming reaches the control as PROPERTIES, and the control folds them into whatever else
       it has to say about itself — which is why the row does not write `aria-labelledby` onto a
       foreign element. `jx-textfield` puts its own error and help ids in FRONT of the row's. */
    const field = el.querySelector("jx-textfield") as HTMLElement & {
      labelledby: string;
      describedby: string;
    };
    expect(field.labelledby).toBe(`${stem}-label`);
    expect(field.describedby).toBe(`${stem}-help`);
    const input = el.querySelector("input")!;
    expect(input.getAttribute("aria-labelledby")).toBe(`${stem}-label`);
    expect(input.getAttribute("aria-describedby")).toBe(`${stem}-help`);
  });

  test("two rows on one surface never share a stem", async () => {
    const a = await row({ label: "One" }, "<jx-textfield></jx-textfield>");
    const b = await row({ label: "Two" }, "<jx-textfield></jx-textfield>");
    expect(a.uid).not.toBe(b.uid);
    expect(a.querySelector("input")!.getAttribute("aria-labelledby")).not.toBe(
      b.querySelector("input")!.getAttribute("aria-labelledby"),
    );
  });

  test("a control that already names itself keeps what it was given", async () => {
    const el = await row(
      { label: "Title" },
      '<jx-textfield labelledby="mine" describedby="mine-help"></jx-textfield>',
    );
    const field = el.querySelector("jx-textfield") as HTMLElement & {
      labelledby: string;
      describedby: string;
    };
    // The row names a control that has said nothing about its own name; it never overrules one.
    expect(field.labelledby).toBe("mine");
    expect(field.describedby).toBe("mine-help");
  });

  test("a native control slotted straight in is left alone, and must name itself", async () => {
    /* The documented limitation. A bare `<input>` has no `labelledby` property, so writing one
       would be a dead expando rather than a name — and the row cannot write `aria-labelledby` onto
       it without overwriting whatever a consumer put there. It is left untouched. */
    const el = await row({ label: "Language" }, '<input type="text">');
    const input = el.querySelector("input")!;
    expect(input.getAttribute("aria-labelledby")).toBeNull();
    expect((input as unknown as Record<string, unknown>)["labelledby"]).toBeUndefined();
    // The row still minted its stem, so its own label and sentence carry ids to point at.
    expect(part(el, "label").id).toBe(`${el.uid}-label`);
  });

  test("a row with nothing slotted mints its stem and names nothing", () => {
    // Called directly: the element always renders a control part, so the empty-row branch of the
    // Sidecar has no reachable path through the DOM.
    const bare = document.createElement("div");
    const state: Record<string, unknown> = {};
    nameFieldControl(state, bare);
    expect(state["uid"]).toMatch(/^jx-field-\d+$/u);

    const empty = document.createElement("div");
    empty.innerHTML = '<div part="control"></div>';
    const second: Record<string, unknown> = {};
    nameFieldControl(second, empty);
    expect(second["uid"]).not.toBe(state["uid"]);
    expect(empty.querySelector('[part="control"]')!.children.length).toBe(0);
  });

  test("the description is the help slot's fallback, so slotted help replaces it", async () => {
    const el = await row(
      { label: "Selector", description: "This is replaced." },
      '<jx-textfield></jx-textfield><span slot="help">Any selector <code>querySelector</code> accepts.</span>',
    );
    const help = part(el, "help");
    expect(help.textContent).toBe("Any selector querySelector accepts.");
    expect(help.textContent).not.toContain("This is replaced.");
    expect(help.querySelector("code")).not.toBeNull();
  });

  test("a row with no description and nothing slotted leaves the help line EMPTY", async () => {
    /* `:empty` is the whole mechanism, and it works only because a slot leaves no node: the help
       paragraph holds exactly one child, the zero-length text node the description binding writes.
       Blink's `:empty` MATCHES that (measured: an element holding one empty text node matches, and
       the row is 28px tall with the paragraph computing `display: none`, against the class form's
       28px) — a zero-length node is not content. Blink is not Selectors 4 here: a WHITESPACE text
       node does NOT match, so `description=" "` computes `display: block` and the row measures 30px
       rather than 28. A binding that resolves to a space rather than "" leaves a blank line.
       Asserted here as the DOM fact the rule keys on, because happy-dom's `matches(":empty")`
       answers `true` even for the paragraph holding "Shown." — it cannot see this either way. */
    const el = await row({ label: "Visible" }, "<jx-checkbox></jx-checkbox>");
    const help = part(el, "help");
    expect(help.childNodes).toHaveLength(1);
    expect(help.firstChild!.nodeType).toBe(Node.TEXT_NODE);
    expect(help.textContent).toBe("");
  });

  test("a row with nothing to say points its control at nothing", async () => {
    /* The class form wrote `describedby` exactly when the call site had a sentence to point at.
       Pointing at the row's empty, `display: none` paragraph would be a description of nothing —
       and `jx-textfield`, which merges the row's id behind its own, would carry it as a dead
       trailing id. So the row reads its help line before it describes anything. */
    const el = await row({ label: "Visible" }, "<jx-checkbox></jx-checkbox>");
    const box = el.querySelector("jx-checkbox") as HTMLElement & {
      labelledby: string;
      describedby: string;
    };
    expect(box.labelledby).toBe(`${el.uid}-label`);
    expect(box.describedby).toBe("");
    expect(el.querySelector("input")!.hasAttribute("aria-describedby")).toBe(false);
  });

  test("help that is SLOTTED describes even before it has any text", async () => {
    /* The row reads its help line once, at mount, so a `description` that starts empty and fills
       later never names anything. A slotted element is seen by its presence rather than its text,
       which is what a sentence that only sometimes says something should use. */
    const el = await row(
      { label: "Slug" },
      '<jx-textfield></jx-textfield><span slot="help"></span>',
    );
    const field = el.querySelector("jx-textfield") as HTMLElement & { describedby: string };
    expect(part(el, "help").childElementCount).toBe(1);
    expect(field.describedby).toBe(`${el.uid}-help`);
  });

  test("only a control whose definition observes labelledby is named", async () => {
    /* A hyphen says the tag is custom, not that the element can be named. A `jx-field` may hold
       another one, and the outer row's first slotted element is then the inner ROW — which observes
       neither prop, so a write would be a dead expando that nothing reads and nothing sees. */
    const el = await row(
      { label: "Outer" },
      '<jx-field label="Inner"><jx-textfield></jx-textfield></jx-field>',
    );
    const inner = el.querySelector("jx-field") as JxField;
    expect(Object.hasOwn(inner, "labelledby")).toBe(false);
    expect(Object.hasOwn(inner, "describedby")).toBe(false);
    // The inner row named its own control, from its own stem.
    const field = inner.querySelector("jx-textfield") as HTMLElement & { labelledby: string };
    expect(field.labelledby).toBe(`${inner.uid}-label`);
  });

  test("an element with no definition at all is left alone, like a native control", () => {
    // The definition is what says a control can be named, and it is readable before the instance
    // Upgrades — but an element nothing has defined when the row mounts cannot be asked.
    const host = document.createElement("div");
    host.innerHTML =
      '<div part="control"><x-unregistered></x-unregistered></div><p part="help">Help.</p>';
    nameFieldControl({}, host);
    const stranger = host.querySelector("x-unregistered")!;
    expect(Object.hasOwn(stranger, "labelledby")).toBe(false);
  });

  test("the description is live, and the line fills once there is something to say", async () => {
    const el = await row({ label: "Visible" }, "<jx-checkbox></jx-checkbox>");
    expect(part(el, "help").textContent).toBe("");
    el.description = "A hidden layer is still exported.";
    await tick();
    expect(part(el, "help").textContent).toBe("A hidden layer is still exported.");
  });

  test("every flag mirrors to a data attribute, set as an attribute or as a property", async () => {
    const el = await row({ label: "Slug", required: "", invalid: "", warning: "", span: "" });
    expect(el.dataset["required"]).toBe("");
    expect(el.dataset["invalid"]).toBe("");
    expect(el.dataset["warning"]).toBe("");
    expect(el.dataset["span"]).toBe("");

    /* The mirror is why the rules key on `data-*` rather than on the observed attribute itself: a
       consumer writing `$props` sets a PROPERTY, and nothing reflects that back to an attribute, so
       a rule on `[required]` would silently not fire for half the ways the row is used. */
    const bound = await row({ label: "Slug" });
    expect(bound.dataset["required"]).toBeUndefined();
    bound.required = true;
    bound.span = true;
    await tick();
    expect(bound.dataset["required"]).toBe("");
    expect(bound.dataset["span"]).toBe("");
  });

  test("the required mark is DRAWN, never appended to the accessible name", async () => {
    const el = await row({ label: "Slug", required: "" }, "<jx-textfield></jx-textfield>");
    // The label node is the control's accessible name, so an asterisk inside its text would be
    // Read out as a word. It is content on `::after` with an empty alt string instead.
    expect(part(el, "label").textContent).toBe("Slug");
  });
});

/**
 * The boxes, declaration by declaration.
 *
 * Nothing in this suite can measure one. happy-dom computes no layout, and its cascade is wrong
 * here in both directions: `help.matches(":empty")` answers `true` for a paragraph holding
 * "Shown.", and `getComputedStyle(row).gridTemplateColumns` reads `minmax(0, 1fr)` — the
 * `[data-span]` value — off a row carrying no such attribute. So an assertion about a computed
 * value would pin happy-dom's mistake rather than the element.
 *
 * What the suite CAN hold is the exact text of every rule the element emits, and that is what these
 * tests do: each spells one rule WHOLE, so removing any declaration from `jx-field.json` reddens
 * the test that owns it, and the last test catches a rule appearing or vanishing entirely. It is a
 * text pin, not a measurement — the measurement is below, and it is what says the text is right.
 *
 * Chrome 152, one page carrying both forms — this element, and the class recipe as `git show
 * HEAD:packages/ui/project.json` spells it — in a 420px container, kit theme, no other CSS. `w×h @
 * dx,dy` from the row's own box; every number identical in the two forms:
 *
 * | case                            | row     | label       | control         | help         |
 * | ------------------------------- | ------- | ----------- | --------------- | ------------ |
 * | labelled + help                 | 420×46  | 80×18 @0,5  | 332×24 @88,2    | 420×16 @0,28 |
 * | no description (checkbox)       | 420×28  | 80×18 @0,5  | 332×24 @88,2    | out of flow  |
 * | span, 3-row textarea            | 420×114 | 420×18 @0,2 | 420×72 @0,22    | 420×16 @0,96 |
 * | required / invalid / warning    | 420×46  | 80×18 @0,5  | 332×24 @88,2    | 420×16 @0,28 |
 * | usage-site justify-items: start | 420×46  | 80×18 @0,5  | 209.33×24 @88,2 | fit-content  |
 *
 * And what each declaration is worth, overridden away on that same page — the labelled row, and the
 * long label where only it moves:
 *
 * | overridden away           | row                                                            | label          | control            | help         |
 * | ------------------------- | -------------------------------------------------------------- | -------------- | ------------------ | ------------ |
 * | (intact)                  | 420×46                                                         | 80×18 @0,5     | 332×24 @88,2       | 420×16 @0,28 |
 * | display: grid             | 420×62.38                                                      | 80×18 @0,2     | 209.33×24 @0,20.38 | 420×16 @0,44 |
 * | grid-template-columns     | 420×66                                                         | 80×18 @0,2     | 420×24 @0,22       | 420×16 @0,48 |
 * | column-gap                | 420×46                                                         | 80×18 @0,5     | 340×24 @80,2       | 420×16 @0,28 |
 * | row-gap                   | 420×44                                                         | 80×18 @0,5     | 332×24 @88,2       | 420×16 @0,26 |
 * | align-items: center       | 420×46                                                         | 80×24 @0,2     | 332×24 @88,2       | 420×16 @0,28 |
 * | padding                   | 420×42                                                         | 80×18 @0,3     | 332×24 @88,0       | 420×16 @0,26 |
 * | label width               | 420×46                                                         | 136.86×18 @0,5 | 209.33×24 @88,2    | 420×16 @0,28 |
 * | label display: block      | 420×46                                                         | 136.86×18 @0,5 | 332×24 @88,2       | 420×16 @0,28 |
 * | label text-align: right   | the label's text moves from x 55.51 to x 0 inside its 80px box |                |                    |              |
 * | label white-space: nowrap | 420×58                                                         | 80×36 @0,2     | 332×24 @88,8       | 420×16 @0,40 |
 * | label overflow + ellipsis | the long label spills its box: scrollWidth 137, clientWidth 80 |                |                    |              |
 * | help grid-column: 1 / -1  | 420×62                                                         | 80×18 @0,5     | 332×24 @88,2       | 80×32 @0,28  |
 * | help margin: 0            | 420×68                                                         | 80×18 @0,5     | 332×24 @88,2       | 420×16 @0,39 |
 * | control display: contents | 420×46.38                                                      | 80×18 @0,5.19  | 209.33×24 @88,2.38 | 420×16 @0,28 |
 *
 * The two label rows read 420×46 with the label unchanged because in the plain grid the item is
 * stretched and blockified anyway — those two declarations are worth nothing there, and 56.86px of
 * overflow the moment the usage site stops the stretch. `justify-items: start` on the row is the
 * measured case: 136.86×18 against the class form's 80×18, the label spilling its 80px track into
 * the control column. A usage-site `display: block` on the row is the other: the label computes
 * `inline`, ignores its width and measures 136.86 wide, where the class label stayed 80. Both are
 * back to 80×18 with the two declarations restored, which is why they are here rather than left to
 * grid stretch.
 */
describe("jx-field's boxes, as rule text measured in Chrome", () => {
  test("the row is the two-column grid, and says what hidden means to it", () => {
    expect(ruleFor("S")).toBe(
      "S { display: grid; grid-template-columns: var(--jx-field-label-w) minmax(0, 1fr); " +
        "column-gap: var(--jx-space-3); row-gap: var(--jx-space-1); align-items: center; " +
        "padding: var(--jx-space-1) 0; min-width: 0 }",
    );
    /* An element that declares a display must say what `hidden` does, or the UA's
       `[hidden] { display: none }` loses to it: the class row never could, and `.jx-field-row`
       still computes `grid` under a `hidden` attribute in Chrome where this row computes `none`
       and measures 0 tall. It is the one place the two forms deliberately differ. */
    expect(ruleFor("S[hidden]")).toBe("S[hidden] { display: none }");
  });

  test("the label owns its own 80px box, rather than borrowing the track's", () => {
    expect(ruleFor('S > [part="label"]')).toBe(
      'S > [part="label"] { display: block; width: var(--jx-field-label-w); min-width: 0; ' +
        "text-align: right; color: var(--jx-fg-dim); font-family: var(--jx-font-sans); " +
        "font-size: var(--jx-text-md); line-height: var(--jx-leading-md); overflow: hidden; " +
        "text-overflow: ellipsis; white-space: nowrap }",
    );
    /* `font-family` is the one declaration `.jx-field-label` did not carry, and it is the kit's
       rule rather than this element's: 16 of the 23 kit documents declare `var(--jx-font-sans)` on
       the text they draw. Measured on a page whose body font is `system-ui`, the CLASS row drew its
       label in system-ui while the `jx-textfield` beside it drew Inter; the element row draws both
       in Inter. The row is now internally consistent, at the price of no longer inheriting a host
       page's font — which is what every other kit element already did. */
    expect(ruleFor('S > [part="label"]')).toContain("font-family: var(--jx-font-sans)");
  });

  test("span collapses the grid to one column, and gives the label the width back", () => {
    expect(ruleFor("S[data-span]")).toBe("S[data-span] { grid-template-columns: minmax(0, 1fr) }");
    /* `width: auto` is why the label fills the single column instead of sitting 80px wide in it —
       the same reset `.jx-field-row[data-span] > .jx-field-label` carried. Measured: label
       420×18 @0,2 in both forms. */
    expect(ruleFor('S[data-span] > [part="label"]')).toBe(
      'S[data-span] > [part="label"] { width: auto; text-align: left }',
    );
  });

  test("invalid is a state of the row, which is the whole of .jx-help-text--error", () => {
    // The fourth class existed only to recolour the sentence. It is one selector on the row now,
    // So a consumer cannot put the row in one state and its sentence in another.
    expect(ruleFor('S[data-invalid] > [part="label"]')).toBe(
      'S[data-invalid] > [part="label"] { color: var(--jx-danger) }',
    );
    expect(ruleFor('S[data-invalid] > [part="help"]')).toBe(
      'S[data-invalid] > [part="help"] { color: var(--jx-danger) }',
    );
    expect(ruleFor('S[data-warning] > [part="label"]')).toBe(
      'S[data-warning] > [part="label"] { color: var(--jx-warning) }',
    );
    // Measured: label and sentence both rgb(232, 100, 96) under invalid, label rgb(229, 174, 74)
    // And sentence rgb(162, 162, 175) under warning — identical to the class form in both.
  });

  test("the required mark is content with an empty alt string, 2px after the label", () => {
    expect(ruleFor('S[data-required] > [part="label"]::after')).toBe(
      'S[data-required] > [part="label"]::after { content: "*" / ""; color: var(--jx-danger); ' +
        "margin-inline-start: var(--jx-space-1) }",
    );
    // Measured on both forms: content `"*" / ""`, rgb(232, 100, 96), margin-inline-start 2px.
  });

  test("the control part generates no box, so the slotted control is the grid item", () => {
    /* `display: contents` is what keeps the geometry identical to the class form, where the
       control was a direct child of the row. A wrapper that generated a box would stretch to the
       column while the control inside it shrank to fit: measured 332×24 @88,2 with contents,
       209.33×24 @88,2.38 with the wrapper drawing a block. */
    expect(ruleFor('S > [part="control"]')).toBe('S > [part="control"] { display: contents }');
  });

  test("the help sentence spans both columns, and leaves the flow when it is empty", () => {
    /* `grid-column: 1 / -1` is the entire content of the recipe block it replaces. Without it the
       sentence drops into the 80px label column: 80×32 @0,28, the row growing 46 → 62. */
    expect(ruleFor('S > [part="help"]')).toBe(
      'S > [part="help"] { grid-column: 1 / -1; margin: 0; min-width: 0; color: var(--jx-fg-dim); ' +
        "font-family: var(--jx-font-sans); font-size: var(--jx-text-sm); " +
        "line-height: var(--jx-leading-sm) }",
    );
    expect(ruleFor('S > [part="help"]:empty')).toBe('S > [part="help"]:empty { display: none }');
  });

  test("emits these rules and no others, in this order", () => {
    // A rule that vanishes whole would slip past every test above, each of which asks for its own
    // Selector. This is the one that sees it.
    expect(rules.map((text) => text.slice(0, text.indexOf(" {")))).toEqual([
      "S",
      "S[hidden]",
      "S[data-span]",
      'S > [part="label"]',
      'S[data-span] > [part="label"]',
      'S[data-invalid] > [part="label"]',
      'S[data-warning] > [part="label"]',
      'S[data-required] > [part="label"]::after',
      'S > [part="control"]',
      'S > [part="help"]',
      'S > [part="help"]:empty',
      'S[data-invalid] > [part="help"]',
    ]);
  });
});

describe("the stylebook, after the row became an element", () => {
  const owned = [
    "jx-field.json",
    "jx-checkbox.json",
    "jx-switch.json",
    "jx-textfield.json",
    "jx-number-field.json",
  ];

  test("no page names a field class any more", () => {
    for (const name of readdirSync(stylebookDir).filter((n) => n.endsWith(".json"))) {
      const text = pageText(name);
      for (const cls of ["jx-field-row", "jx-field-label", "jx-help-text"]) {
        expect(text, `${name} names .${cls}`).not.toContain(cls);
      }
    }
  });

  test("no page that uses the row writes an id or an aria-labelledby", () => {
    // The proof the element earned its keep: four hand-written strings per row, gone from five
    // Pages, with nothing left for a consumer to keep in step.
    for (const name of owned) {
      const text = pageText(name);
      expect(text, `${name} writes an id`).not.toContain('"id":');
      expect(text, `${name} writes aria-labelledby`).not.toContain('"aria-labelledby":');
      expect(text, `${name} writes labelledby`).not.toContain('"labelledby":');
      expect(text, `${name} writes describedby`).not.toContain('"describedby":');
    }
  });

  test("jx-tabs owns its own boxes rather than a page-local class", () => {
    // The kit is at zero classes, so a page cannot keep one either. The row that held the vertical
    // Tabs carries the three declarations on the node that draws it.
    const page = JSON.parse(pageText("jx-tabs.json")) as {
      style: Record<string, unknown>;
      children: { style?: Record<string, string>; attributes?: Record<string, string> }[];
    };
    expect(Object.keys(page.style).some((key) => key.includes("."))).toBe(false);
    expect(pageText("jx-tabs.json")).not.toContain('"class"');
    const flexed = page.children.find((child) => child.style?.["display"] === "flex")!;
    expect(flexed.style).toEqual({
      display: "flex",
      alignItems: "flex-start",
      gap: "var(--jx-space-5)",
    });
  });
});
