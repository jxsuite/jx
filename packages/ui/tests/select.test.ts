/**
 * `jx-select`, and the four traps a scripted test cannot see.
 *
 * Two of the element's four load-bearing decisions PASS every assertion that can be written in
 * happy-dom and FAIL a real control, so every claim below was first measured in Chrome 152 through
 * CDP with genuine `Input.dispatchKeyEvent` — the numbers in the comments are those measurements,
 * and each test says plainly which half of its claim the suite is actually holding.
 *
 * What the suite CAN see: the document's own shape (no `selected` attribute is authored anywhere,
 * no `option[label]`, the change body says one thing), every emitted CSS rule, the sidecar's
 * arithmetic over a real option list, and the rule COUNT — which is the whole proof that a row's
 * face costs no rule.
 *
 * What the suite CANNOT see, and where each was measured instead:
 *
 * - THE `selected` ATTRIBUTE TRAP. Writing the attribute passes every scripted assertion. It fails
 *   only after a REAL pick, because the pick sets the option's dirtiness flag and the attribute
 *   stops moving selectedness from then on. Measured in Chrome with ArrowDown x2 + Enter on the
 *   font picker, then a host write away and back: with the attribute spelling the attribute sits on
 *   the picked option while `select.value` is the FIRST row's. With this element's spelling the
 *   same five states read: after the real pick `value="system-ui" idx=3`, host write away
 *   `"Georgia, serif" idx=0`, host write back `"system-ui" idx=3`, rows replaced `"system-ui"
 *   idx=0`, rows restored `"system-ui" idx=3` — and `selected` on nothing, all five times.
 * - `<jx-option>`. A custom element inside a `<select>` renders and looks right in the a11y tree.
 *   Measured with a real `probe-option` carrying `role="option"`: it draws 17.3px tall, and
 *   `select.options.length` is 0, ArrowDown + Enter gives `value ""`, `selectedIndex -1`, and ZERO
 *   change events. The suite can only assert the kit ships no such element, which it does below.
 * - THE CHANGE LOOP. An `onchange` body that also dispatches `change` re-enters itself: one pick
 *   produced 43 change events. A synthetic change in happy-dom would re-enter too, but the shape of
 *   the proof is the document's body, asserted structurally here; the one-per-pick count was
 *   measured in Chrome (`["select:system-ui"]`, one entry, for one real Enter).
 * - `option[hidden]`. Measured on a bare probe: with `option { display: flex }` and no `[hidden]`
 *   rule the hidden option computes `display: flex`, and it is in `select.options` either way
 *   (`options.length` 2, values `["a","b"]`). Adding `option[hidden] { display: none }` makes it
 *   `none`. happy-dom computes no cascade, so the suite holds the RULE and the leak, not the
 *   pixel.
 *
 * Also measured in Chrome 152 on a page carrying only this element: zero DevTools issues; the open
 * a11y tree is `combobox "Font" expanded haspopup="menu" value="Courier"` -> `MenuListPopup` ->
 * `group "This project"` (with the legend's StaticText) -> `option ... selectable/selected`, with
 * `option "Locked" disableable disabled` and the whole trigger subtree ignored; a first option rect
 * of 205.3 x 24, which is the only valid feature test for `appearance: base-select`; the swatch
 * 16x16 `rgb(192, 57, 43)` and the rule 32x2 `dashed` and the face `"Courier New", monospace` in
 * the picker AND in the closed trigger; `::checkmark` order 1 on every row with `rgb(59, 130, 246)`
 * only on the checked one; `:open::picker-icon` rotate 180deg; 43 adopted rules total, unchanged by
 * one 70-row select and unchanged by two of them; and 70 options built 11.6ms after the element was
 * appended.
 */
import "./with-dom.ts";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { documentStyleText } from "@jxsuite/runtime";
import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";
import { mountSelect, syncSelect } from "../src/behaviors/select.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

interface Row {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  face?: string;
  swatch?: string;
  line?: string;
}
type JxSelect = HTMLElement & {
  value: string;
  options: Row[];
  groups: { id: string; label: string; rows: Row[] }[];
  unlisted: Row[];
  error: string;
  help: string;
  invalid: boolean;
};

const FACES: Row[] = [
  { face: "Georgia, serif", label: "Georgia", value: "Georgia, serif" },
  { face: '"Courier New", monospace', label: "Courier New", value: '"Courier New", monospace' },
  { face: '"Times New Roman", serif', label: "Times New Roman", value: '"Times New Roman", serif' },
];
const GENERIC: Row[] = [
  { description: "system", face: "system-ui", label: "system-ui", value: "system-ui" },
  { face: "serif", label: "serif", value: "serif" },
  { disabled: true, face: "fantasy", label: "Locked", value: "fantasy" },
];

beforeAll(async () => {
  await registerUi();
});
afterEach(() => {
  document.body.replaceChildren();
});

/** An element with whatever attributes and properties it was given, rendered. */
async function select(
  attrs: Record<string, string> = {},
  props: Record<string, unknown> = {},
): Promise<JxSelect> {
  const el = document.createElement("jx-select") as JxSelect;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  Object.assign(el, props);
  document.body.append(el);
  await tick();
  await tick();
  return el;
}

const control = (el: Element) => el.querySelector<HTMLSelectElement>('select[part="control"]')!;
const values = (el: Element) => [...control(el).options].map((option) => option.value);
const parts = (el: Element, part: string) => [...el.querySelectorAll(`[part="${part}"]`)];

/** Every emitted CSS rule scoped to this element's own document, in source order. */
function rules(el: Element): string[] {
  const scope = `[data-jx="${(el as HTMLElement).dataset["jx"]}"]`;
  return documentStyleText()
    .split("\n")
    .filter((line) => line.startsWith(scope) || line.includes(`{ ${scope}`));
}
/** The first emitted rule whose selector carries `selector`. */
const ruleFor = (el: Element, selector: string) =>
  rules(el).find((line) => line.slice(0, line.indexOf("{") + 1).includes(selector)) ?? "";

/**
 * Every key/value pair in the document, however deeply nested.
 *
 * @param node The document or a subtree of it.
 * @param path A label for messages.
 * @yields {[string, string, unknown]} The owner's path, the key, and the value
 */
function* entries(node: unknown, path = "root"): Generator<[string, string, unknown]> {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* entries(item, `${path}[${i}]`);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    yield [path, key, value];
    yield* entries(value, `${path}.${key}`);
  }
}

const doc = documents["jx-select"]!;

describe("jx-select", () => {
  test("is one native select, named, with the document's rows inside it", async () => {
    const el = await select(
      { label: "Font" },
      { groups: [{ id: "p", label: "This project", rows: FACES }] },
    );
    const sel = control(el);
    expect(sel.tagName).toBe("SELECT");
    expect(sel.getAttribute("aria-label")).toBe("Font");
    // No popover, no listbox, no second control: one select is the whole thing.
    expect(el.querySelectorAll("select").length).toBe(1);
    expect(el.querySelector("[popover]")).toBeNull();
    expect(el.querySelector('[role="listbox"]')).toBeNull();
    expect(values(el)).toEqual(FACES.map((row) => row.value));
    // The trigger the picker mirrors the chosen row's children into.
    const trigger = el.querySelector('[part="trigger"]')!;
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.firstElementChild?.getAttribute("part")).toBe("preview");
  });

  test("a group draws its heading and names itself, and needs both halves", async () => {
    const el = await select(
      { label: "Font" },
      {
        groups: [
          { id: "p", label: "This project", rows: FACES },
          { id: "g", label: "Generic", rows: GENERIC },
        ],
      },
    );
    const groups = parts(el, "group");
    expect(groups.map((g) => g.tagName)).toEqual(["OPTGROUP", "OPTGROUP"]);
    /* The optgroup's `label` is what NAMES the group in the accessibility tree; the legend inside it
       is what DRAWS the heading. Neither substitutes for the other — measured in Chrome, stripping
       the legend keeps `group "This project"` in the open tree with no StaticText under it and an
       18px empty band above its first row. */
    expect(groups.map((g) => g.getAttribute("label"))).toEqual(["This project", "Generic"]);
    expect(parts(el, "group-heading").map((l) => [l.tagName, l.textContent])).toEqual([
      ["LEGEND", "This project"],
      ["LEGEND", "Generic"],
    ]);
    expect(values(el)).toEqual([...FACES, ...GENERIC].map((row) => row.value));
    // A disabled row is stepped over by the platform rather than by anything authored here.
    expect(control(el).options[5]!.disabled).toBe(true);
    expect(ruleFor(el, "option:disabled")).toContain("opacity: 0.45");
  });

  test("a keyed $map renders no wrapper, so an empty one is the conditional-row primitive", async () => {
    const el = await select({ label: "Font" }, { options: FACES });
    const sel = control(el);
    // Only options, comments and the trigger — never a div, and never an element `select.options`
    // Would have to ignore.
    const stray = [...sel.children].filter(
      (child) => !["BUTTON", "OPTION", "OPTGROUP"].includes(child.tagName),
    );
    expect(stray).toEqual([]);
    expect([...sel.childNodes].filter((n) => n.nodeType === 8).length).toBeGreaterThan(0);
    expect(el.querySelector("slot")).toBeNull();
  });

  test("the default slot takes native rows from the call site, and leaves no node", async () => {
    /* The static path, and it is static on purpose: `distributeSlots` runs once in
       `connectedCallback`, so a row appended to the call site afterwards is never distributed. That
       is the whole reason the data path above exists. Measured in Chrome: `select.options.length` 2,
       with the value and the trigger correct. */
    const el = document.createElement("jx-select") as JxSelect;
    el.setAttribute("label", "Alignment");
    el.setAttribute("value", "center");
    for (const [value, label] of [
      ["", "Inherit"],
      ["center", "Center"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      el.append(option);
    }
    document.body.append(el);
    await tick();
    await tick();
    expect(values(el)).toEqual(["", "center"]);
    expect(control(el).value).toBe("center");
    // A `<slot>` leaves no node once its content is distributed, so nothing inside the select is
    // Something `select.options` has to ignore.
    expect(el.querySelector("slot")).toBeNull();
    expect([...control(el).children].map((child) => child.tagName)).toEqual([
      "BUTTON",
      "OPTION",
      "OPTION",
    ]);
  });

  test("selectedness lands on first paint, though the value binding ran before any option existed", async () => {
    /* This is the whole reason the sidecar exists. The `value` property binding's effect runs while
       the `<select>` is still being built: `sel.value = "system-ui"` is refused because no option
       holds it, and the effect never re-runs because `state.value` never changed. The observer's
       first synchronisation at mount is what puts it right. Mutation-checked: deleting the
       `syncSelect(state, sel)` call from `mountSelect` reddens exactly this test. */
    const el = await select(
      { label: "Font", value: "system-ui" },
      {
        groups: [
          { id: "p", label: "This project", rows: FACES },
          { id: "g", label: "Generic", rows: GENERIC },
        ],
      },
    );
    expect(control(el).value).toBe("system-ui");
    expect(control(el).selectedIndex).toBe(3);
  });

  test("the document authors no `selected` attribute, anywhere, and never an option label", () => {
    /* The trap that passes every scripted test and fails a real one. Measured in Chrome with a real
       ArrowDown + Enter on "Courier New" and then a host write away and back to that row: the
       `selected` attribute is on the Courier option and `select.value` is `"Georgia, serif"`, index
       0 — the pick made the option dirty, and from then on the attribute moves nothing. So the
       document must not contain the word at all, in any spelling. */
    for (const [path, key] of entries(doc)) {
      expect(key.toLowerCase(), `${path}.${key}`).not.toBe("selected");
      // `option[label]` suppresses the option's children in the picker while `<selectedcontent>`
      // Still mirrors them into the trigger: the row and the trigger stop agreeing.
      expect(key.toLowerCase(), `${path}.${key}`).not.toBe("defaultselected");
    }
    const optionLabels = [...entries(doc)].filter(
      ([, key, value]) =>
        key === "attributes" &&
        typeof value === "object" &&
        value !== null &&
        "part" in value &&
        (value as { part: string }).part === "option" &&
        "label" in value,
    );
    expect(optionLabels).toEqual([]);
  });

  test("a host write away and back to a row lands on that row", async () => {
    const el = await select(
      { label: "Font", value: "system-ui" },
      {
        groups: [
          { id: "p", label: "This project", rows: FACES },
          { id: "g", label: "Generic", rows: GENERIC },
        ],
      },
    );
    for (const [want, index] of [
      ["Georgia, serif", 0],
      ["system-ui", 3],
      ["serif", 4],
      ["system-ui", 3],
    ] as const) {
      el.value = want;
      await tick();
      expect(control(el).value, want).toBe(want);
      expect(control(el).selectedIndex, want).toBe(index);
      expect([...control(el).options].filter((o) => o.hasAttribute("selected"))).toEqual([]);
    }
  });

  test("the row survives the list being replaced under it, and comes back with it", async () => {
    const el = await select(
      { label: "Font", value: "system-ui" },
      {
        groups: [
          { id: "p", label: "This project", rows: FACES },
          { id: "g", label: "Generic", rows: GENERIC },
        ],
      },
    );
    el.groups = [{ id: "only", label: "Only", rows: [{ label: "system-ui", value: "system-ui" }] }];
    await tick();
    expect(control(el).value).toBe("system-ui");
    el.groups = [
      { id: "p", label: "This project", rows: FACES },
      { id: "g", label: "Generic", rows: GENERIC },
    ];
    await tick();
    await tick();
    expect(control(el).value).toBe("system-ui");
    expect(control(el).selectedIndex).toBe(3);
  });

  test("the stand-in row is not counted among the rows it stands in for", () => {
    /* The exclusion that keeps the computation from oscillating, asked directly and synchronously —
       and it is FIRST among the tests that touch it on purpose. Were the synthesised option counted
       as listed, every element whose value is unlisted would drop the row, find the value absent,
       and add it back forever; each cycle is a microtask, so the loop does not redden the suite, it
       HANGS it, and every async test below this one stops reporting. Mutation-checked: dropping the
       `part` check from `isListed` fails this line and then hangs the rest of the file. */
    const sel = document.createElement("select");
    for (const [value, part] of [
      ["groove", "unlisted"],
      ["solid", "option"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.setAttribute("part", part);
      sel.append(option);
    }
    const kept = [{ label: "groove", value: "groove" }];
    const state: Record<string, unknown> = { unlisted: kept, value: "groove" };
    syncSelect(state, sel);
    expect(state["unlisted"]).toBe(kept);
    // And a value the DOCUMENT listed needs no stand-in, so the list is emptied instead.
    const other: Record<string, unknown> = { unlisted: kept, value: "solid" };
    syncSelect(other, sel);
    expect(other["unlisted"]).toEqual([]);
  });

  test("a value no row holds is stood in for, rather than falling silently to index 0", async () => {
    const el = await select(
      { label: "Border", value: "groove" },
      {
        options: [
          { label: "Solid", value: "solid" },
          { label: "Dashed", value: "dashed" },
        ],
      },
    );
    expect(el.unlisted).toEqual([{ label: "groove", value: "groove" }]);
    expect(values(el)).toEqual(["groove", "solid", "dashed"]);
    expect(control(el).value).toBe("groove");
    expect(parts(el, "unlisted").length).toBe(1);
    // And it goes when the value becomes one the list holds. Nothing mutates an option here, so the
    // Observer hears about it through `data-value` rather than through a childList record.
    el.value = "dashed";
    await tick();
    await tick();
    expect(el.unlisted).toEqual([]);
    expect(values(el)).toEqual(["solid", "dashed"]);
    expect(control(el).value).toBe("dashed");
  });

  test("the stand-in row is computed once and does not oscillate", async () => {
    const el = await select(
      { label: "Border", value: "groove" },
      { options: [{ label: "Solid", value: "solid" }] },
    );
    const first = el.unlisted;
    for (let i = 0; i < 5; i += 1) {
      await tick();
    }
    /* The synthesised option is excluded from the listed set by its own `part`. Were it counted, the
       next observer run would find the value present, drop the row, find it absent, and add it back
       for the life of the element — and the identity below would change on every pass. */
    expect(el.unlisted).toBe(first);
    expect(values(el)).toEqual(["groove", "solid"]);
  });

  test("the empty string is a value, not absence", async () => {
    const el = await select(
      { label: "Alignment", value: "" },
      {
        options: [
          { label: "Inherit", value: "" },
          { label: "Start", value: "start" },
        ],
      },
    );
    expect(control(el).value).toBe("");
    expect(control(el).selectedIndex).toBe(0);
    // And an empty value with no row for it is NOT stood in for: a blank row labelled with a blank
    // Value would say nothing about what the element holds.
    const bare = await select(
      { label: "Alignment", value: "" },
      { options: [{ label: "Start", value: "start" }] },
    );
    expect(bare.unlisted).toEqual([]);
    /* But the CONTROL must not then quietly hold the first row. This is the default state of an
       ordinary `<jx-select label="…" name="…">` with rows and no value, and before selectedness was
       made total it measured `element ""` against `control "start" index 0` — two answers to one
       question, and a form submitting the one the element was never told to hold. `value` reads
       `""` for "no row" as well as for a picked `""` row, so the index is the discriminator. */
    expect(bare.value).toBe("");
    expect(control(bare).selectedIndex).toBe(-1);
    expect(control(bare).value).toBe("");
    // The same state a host write reaches, so first paint and a later write agree.
    const picked = await select(
      { label: "Alignment" },
      {
        options: [
          { label: "Start", value: "start" },
          { label: "Center", value: "center" },
        ],
      },
    );
    picked.value = "center";
    await tick();
    expect(control(picked).selectedIndex).toBe(1);
    picked.value = "";
    await tick();
    expect(control(picked).selectedIndex).toBe(-1);
  });

  test("change writes the value and says nothing of its own", async () => {
    const el = await select({ label: "Font" }, { options: FACES });
    const heard: string[] = [];
    el.addEventListener("change", (e) =>
      heard.push(`${(e.target as Element).localName}:${(e.target as HTMLSelectElement).value}`),
    );
    control(el).value = "serif";
    control(el).value = '"Times New Roman", serif';
    control(el).dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(el.value).toBe('"Times New Roman", serif');
    expect(heard).toEqual(['select:"Times New Roman", serif']);

    /* The count above is the part happy-dom can hold. The re-entry it guards against is structural:
       an `onchange` body that also dispatches `change` hears its own event — one real pick produced
       43 of them in Chrome. The body says one thing, and this is what keeps it saying one thing. */
    const body = (doc.state as Record<string, { body?: unknown[] }>)["onChange"]!.body!;
    expect(body.length).toBe(1);
    for (const [path, key] of entries(body)) {
      expect(key, `onChange.body${path}`).not.toBe("dispatchEvent");
    }
    expect((doc.state as Record<string, { emits?: unknown }>)["onChange"]!.emits).toBeUndefined();
  });

  test("a description belongs to the list, and is not mirrored into the closed trigger", async () => {
    /* `<selectedcontent>` clones the picked option's CHILDREN, so without this rule a row's
       description is drawn in the trigger beside its label. specs/ui.md §5.1 names the rule by
       selector; nothing held it until this. */
    const el = await select({ label: "Font" }, { options: GENERIC });
    expect(ruleFor(el, '[part="preview"] [part="description"]')).toContain("display: none");
  });

  test("a call site may slot an `<hr>` between rows, and the element draws it", async () => {
    /* The one thing the element styles that it never authors. A `<select>` under
       `appearance: base-select` renders an `<hr>` between options as a real separator, and this
       element exists to delimit groups — so the hook is deliberate rather than residue, and the
       rule is dead the moment nothing proves a slotted rule reaches it. */
    const el = document.createElement("jx-select") as JxSelect;
    el.setAttribute("label", "Font");
    const first = document.createElement("option");
    first.value = "a";
    const rule = document.createElement("hr");
    const second = document.createElement("option");
    second.value = "b";
    el.append(first, rule, second);
    document.body.append(el);
    await tick();
    await tick();
    expect(control(el).querySelector("hr")).toBe(rule);
    expect(values(el)).toEqual(["a", "b"]);
    expect(ruleFor(el, "select hr")).toContain("border-block-start: 1px solid var(--jx-border)");
  });

  test("a face, a colour and a border style ride on the row's own custom properties", async () => {
    const el = await select(
      { label: "Font" },
      {
        options: [
          {
            face: "Georgia, serif",
            label: "Georgia",
            line: "dashed",
            swatch: "rgb(192, 57, 43)",
            value: "g",
          },
          { label: "Plain", value: "p" },
        ],
      },
    );
    const [first, second] = [...control(el).options];
    /* The style goes on a CHILD span, never on the option: `<selectedcontent>` mirrors the option's
       CHILDREN and their styles into the closed trigger, and the option's own style is not mirrored.
       Measured in Chrome, in the picker AND in the trigger: swatch 16x16 `rgb(192, 57, 43)`, rule
       32x2 `dashed`, face `"Courier New", monospace`. */
    expect(first!.getAttribute("style")).toBeNull();
    expect(first!.querySelector('[part="text"]')!.getAttribute("style")).toBe(
      "--jx-row-face: Georgia, serif;",
    );
    expect(first!.querySelector('[part="swatch"]')!.getAttribute("style")).toBe(
      "--jx-row-swatch: rgb(192, 57, 43);",
    );
    expect(first!.querySelector('[part="line"]')!.getAttribute("style")).toBe(
      "--jx-row-line: dashed;",
    );
    // A row with no drawing channel writes no property, and its decorations are out of the row.
    expect(second!.querySelector('[part="text"]')!.getAttribute("style")).toBeNull();
    expect(second!.querySelector('[part="swatch"]')!.hasAttribute("hidden")).toBe(true);
    expect(second!.querySelector('[part="line"]')!.hasAttribute("hidden")).toBe(true);

    // The channels are declared ONCE, by the element, and read the property the row set.
    expect(ruleFor(el, '[part="text"]')).toContain("font-family: var(--jx-row-face, inherit)");
    expect(ruleFor(el, '[part="swatch"]')).toContain(
      "background: var(--jx-row-swatch, transparent)",
    );
    expect(ruleFor(el, '[part="swatch"]')).toContain("inline-size: 16px");
    expect(ruleFor(el, '[part="swatch"]')).toContain("block-size: 16px");
    expect(ruleFor(el, '[part="line"]')).toContain(
      "border-block-start: 2px var(--jx-row-line, none) currentColor",
    );
    expect(ruleFor(el, '[part="line"]')).toContain("inline-size: 32px");

    // Every row carries real text, so typeahead prefix-matches and an off-Chrome engine still reads.
    expect(first!.textContent).toBe("Georgia");
  });

  test("seventy rows cost the same rules as two, and no row interns one of its own", async () => {
    /* The proof that a reactive custom property on a self-target rule is written inline under the
       author's own name. Without it each row's `style` object indirects through `--jx-rN-0`, the
       rule text carries the serial, and the interning handle — a hash of that text — is unique per
       row: measured before that landed, 9 rows produced 9 handles and 9 rules; at 70 faces it is 70
       rules per picker. Measured in Chrome 152 with this element: 43 adopted rules on the page, and
       43 after one 70-row select, and 43 after two of them. */
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        face: `Face${i}`,
        label: `Row ${i}`,
        line: "dashed",
        swatch: "rgb(192, 57, 43)",
        value: `v${i}`,
      }));
    const small = await select({ label: "Two" }, { options: rows(2) });
    const baseline = rules(small).length;
    const big = await select({ label: "Seventy" }, { options: rows(70) });
    expect(control(big).options.length).toBe(70);
    expect(rules(big).length).toBe(baseline);
    // One rule set, shared: both elements carry the same handle because neither's rule text has
    // Anything per-element in it.
    expect(big.dataset["jx"]).toBe(small.dataset["jx"]);
    /* And nothing inside a row has a rule set of its own — compared as PART NAMES, never as the
       nodes themselves. `toEqual` on an array of live elements deep-walks each one's object graph
       (`parentNode`, `ownerDocument`, every sibling), so the failing case — 70 rows that each
       interned a rule — did not go red, it went out of memory: the run was killed with no summary
       line, and a whole session of `bun test` died with it. A gate whose failure mode is an OOM
       reports nothing, so it is worse than no gate. Names are small, printable, and say which part
       broke. */
    expect(
      [...big.querySelectorAll<HTMLElement>("[part]")]
        .filter((node) => node.dataset["jx"] !== undefined)
        .map((node) => node.getAttribute("part")),
    ).toEqual([]);
    expect(big.querySelectorAll('[part="text"][style]').length).toBe(70);
  });

  test("a hidden option is still in select.options, so the element says what hidden means", async () => {
    const el = await select({ label: "Alignment" });
    const ghost = document.createElement("option");
    ghost.value = "ghost";
    ghost.textContent = "Ghost";
    ghost.hidden = true;
    control(el).append(ghost);
    /* `hidden` is not a hiding place on an option: it stays in `select.options` and stays selectable
       in the accessibility tree. Measured on a bare probe in Chrome — `options.length` 2, values
       `["a","b"]`, and with `option { display: flex }` and no `[hidden]` rule the hidden one
       computes `display: flex`, because an author declaration beats the UA's `[hidden]` rule. The
       element declares `display: flex` on every option, so the rule below is MANDATORY. */
    expect(values(el)).toContain("ghost");
    expect(ruleFor(el, "select option[hidden]")).toContain("display: none");
    expect(ruleFor(el, "select option {")).toContain("display: flex");
  });

  test("the kit ships no jx-option", () => {
    /* A custom element inside a `<select>` survives insertion and renders, and with `role="option"`
       the open a11y tree reads `combobox expanded -> MenuListPopup -> option "Alpha" selectable` —
       a convincing forgery. Measured in Chrome with a real `probe-option`: it draws 17.3px tall,
       `select.options.length` is 0, and ArrowDown + Enter gives `value ""`, `selectedIndex -1` and
       zero change events. A test that asserts the tree passes while the control does nothing, so
       the only defence is that no such element exists. */
    expect(Object.keys(documents)).not.toContain("jx-option");
    expect(customElements.get("jx-option")).toBeUndefined();
    for (const [path, key, value] of entries(doc)) {
      if (key === "tagName") {
        expect(value, `${path}.tagName`).not.toBe("jx-option");
      }
    }
    // Every row is a native option, and every node inside the control is one of four native tags.
    const tags = [...entries(doc)].filter(([, key]) => key === "tagName").map((entry) => entry[2]);
    for (const tag of ["select", "option", "optgroup", "legend"]) {
      expect(tags).toContain(tag);
    }
  });

  test("both appearance declarations sit in one object, and the picker parts are styled", async () => {
    const el = await select({ label: "Font" }, { options: FACES });
    /* `appearance: base-select` on the select alone gives a styleable control with a UA picker;
       on `::picker(select)` alone, nothing. The two-rules-or-none trap is unfailable here by
       construction rather than by a rule someone remembers: both live in this element's own style
       object, so one cannot be written without the other being available to write. Neither `:open`
       nor `CSS.supports` is a valid feature test — a non-zero first-option rect is, and it measured
       205.3 x 24 in Chrome. */
    expect(ruleFor(el, "select {")).toContain("appearance: base-select");
    expect(ruleFor(el, "select::picker(select)")).toContain("appearance: base-select");
    // A selector-list split that respected paren depth is what keeps `::picker(select)` whole.
    expect(ruleFor(el, "select::picker(select)")).toContain("box-shadow: var(--jx-shadow-popover)");
    expect(ruleFor(el, "select:open::picker-icon")).toContain("rotate: 180deg");
    /* GEOMETRY AND ORDER on every checkmark, COLOUR only on the checked one. The UA generates
       `::checkmark` on every option and hides the unchecked ones with `visibility: hidden`, so
       `content` on the unscoped selector changes the reserved width of every row — a 10-character
       content took every option from 102px to 229px — and `order` on `:checked` alone misaligns the
       list, because the unchecked rows keep `order: 0` and only the checked row moves. */
    const anyCheck = ruleFor(el, "option::checkmark");
    expect(anyCheck).toContain("order: 1");
    expect(anyCheck).not.toContain("content:");
    const checkedCheck = ruleFor(el, "option:checked::checkmark");
    expect(checkedCheck).toContain("color: var(--jx-accent)");
    expect(checkedCheck).not.toContain("order:");
  });

  test("the sentences under it describe the control, and the region predates its text", async () => {
    const el = await select({ label: "Font" }, { options: FACES });
    const region = el.querySelector('[part="error"]')!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    expect(control(el).hasAttribute("aria-describedby")).toBe(false);

    el.error = "Pick a font this project ships.";
    el.invalid = true;
    el.help = "Letters, digits and dashes.";
    await tick();
    expect(el.querySelector('[part="error"]')).toBe(region);
    expect(region.textContent).toBe("Pick a font this project ships.");
    expect(control(el).getAttribute("aria-invalid")).toBe("true");
    const described = control(el).getAttribute("aria-describedby")!.split(" ");
    expect(described).toEqual([region.id, el.querySelector('[part="help"]')!.id]);
    expect(region.id).toStartWith("jx-select-");
    // Two instances never share a stem.
    const other = await select({ error: "x", label: "Other" });
    expect(other.querySelector('[part="error"]')!.id).not.toBe(region.id);
  });

  test("size, name, disabled and required reach the control", async () => {
    const el = await select({
      disabled: "",
      label: "Font",
      name: "font",
      required: "",
      size: "sm",
    });
    expect(el.dataset["size"]).toBe("sm");
    expect(el.dataset["disabled"]).toBeDefined();
    expect(control(el).getAttribute("name")).toBe("font");
    expect(control(el).disabled).toBe(true);
    expect(control(el).required).toBe(true);
    expect(ruleFor(el, '[data-size="sm"] {')).toContain("--jx-select-h");
  });

  test("the sidecar is inert on a host with no control, and installs nothing to tear down", () => {
    /* Reachable in a real page: a host the runtime has not rendered into yet. It still gets its id
       stem — the sentences under it are the element's whatever the control is doing — and it
       observes nothing.

       There is deliberately no `onUnmount` to pair with this. The runtime initialises an element
       once, so a sidecar that disconnected at `disconnectedCallback` could never install another:
       a re-parent fires remove then insert, and the element would come back rendering, reactive and
       DEAF. The observer is collected with the subtree it is registered on instead. */
    const state: Record<string, unknown> = { unlisted: [], value: "x" };
    const bare = document.createElement("div");
    mountSelect(state, bare);
    expect(state["uid"]).toStartWith("jx-select-");
    expect(state["unlisted"]).toEqual([]);
    expect((doc.state as Record<string, unknown>)["onUnmount"]).toBeUndefined();
  });

  test("an element that is moved keeps following its own option list", async () => {
    const el = await select(
      { label: "Font", value: "system-ui" },
      {
        groups: [
          { id: "p", label: "This project", rows: FACES },
          { id: "g", label: "Generic", rows: GENERIC },
        ],
      },
    );
    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);
    elsewhere.append(el);
    await tick();
    expect(control(el).value).toBe("system-ui");
    // The move ran disconnect and then connect, and the runtime does not render an element twice —
    // So whatever the sidecar installed at mount is all this element will ever have.
    el.groups = [{ id: "only", label: "Only", rows: [{ label: "serif", value: "serif" }] }];
    await tick();
    await tick();
    expect(values(el)).toEqual(["system-ui", "serif"]);
    expect(control(el).value).toBe("system-ui");
    expect(el.unlisted).toEqual([{ label: "system-ui", value: "system-ui" }]);
  });

  test("the sidecar writes selectedness only onto a value the list holds", async () => {
    const el = await select({ label: "Font" }, { options: FACES });
    const sel = control(el);
    const state: Record<string, unknown> = { unlisted: [], value: "serif" };
    sel.value = "Georgia, serif";
    /* "serif" is in no option here, so the row is never guessed at — and the control is taken OFF
       every row rather than left showing Georgia, which the element does not hold. Leaving it was
       the defect: an ordinary `<jx-select label="…" name="…">` with rows and no value measured
       `element ""` against `control "start" index 0`, so a first paint submitted a row nothing had
       chosen. `value` reads `""` for "no row" as well as for a picked `""` row, so the index is
       what discriminates. */
    syncSelect(state, sel);
    expect(sel.selectedIndex).toBe(-1);
    expect(state["unlisted"]).toEqual([{ label: "serif", value: "serif" }]);
    /* And it lands the moment the row it asked for exists. In the element that row arrives by
       re-render, one microtask later; here it is appended by hand, which is the same event as far
       as this function is concerned. */
    const stand = document.createElement("option");
    stand.value = "serif";
    stand.setAttribute("part", "unlisted");
    sel.append(stand);
    syncSelect(state, sel);
    expect(sel.value).toBe("serif");
    state["value"] = '"Times New Roman", serif';
    syncSelect(state, sel);
    expect(sel.value).toBe('"Times New Roman", serif');
    expect(state["unlisted"]).toEqual([]);
  });
});
