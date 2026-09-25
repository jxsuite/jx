import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText, mount } from "@jxsuite/runtime";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";
import stylebookTab from "../stylebook/jx-tab.json";
import { tabsOf } from "../src/behaviors/tabs.ts";

/** Let the runtime's queued `onMount` settle. */
const flush = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type TabsEl = HTMLElement & { selected: string };
type TabEl = HTMLElement & { value: string; label: string; selected: boolean };

let dispose: (() => void) | null = null;

interface Mounted {
  host: HTMLElement;
  tabs: TabsEl;
  rows: TabEl[];
  changes: string[];
  closes: string[];
  clicked: string[];
}

/**
 * Mount one strip and listen where a host listens: on an ANCESTOR of the tablist, never on the
 * element that dispatches, so a `change` that does not bubble cannot pass for one that does.
 */
async function render(doc: JxDocument): Promise<Mounted> {
  const host = document.createElement("div");
  document.body.append(host);
  ({ dispose } = await mount(doc, host));
  await flush();
  const tabs = host.querySelector("jx-tabs") as TabsEl;
  const changes: string[] = [];
  const closes: string[] = [];
  const clicked: string[] = [];
  host.addEventListener("change", (e) => changes.push(String((e as CustomEvent).detail)));
  host.addEventListener("close", (e) => closes.push(String((e as CustomEvent).detail)));
  // What a slotted control's OWN handler saw. Bound in the capture phase at the ancestor so it
  // Records the click whether or not the tab's actions container stops it afterwards.
  host.addEventListener(
    "click",
    (e) => {
      const probe = (e.target as Element).closest?.<HTMLElement>("[data-probe]");
      if (probe) {
        clicked.push(probe.dataset["probe"] ?? "");
      }
    },
    true,
  );
  return { changes, clicked, closes, host, rows: tabsOf(tabs) as TabEl[], tabs };
}

/** Press a key where a keyboard would: at the focused node, or at `fallback`. */
function key(fallback: Element, name: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name });
  const active = document.activeElement;
  const target = active && fallback.contains(active) ? active : fallback;
  target.dispatchEvent(event);
  return event;
}

/** The emitted stylesheet for ONE element, by selector, with its scope attribute folded to `&`. */
function rules(el: HTMLElement): Map<string, string> {
  const scope = el.dataset["jx"];
  const out = new Map<string, string>();
  for (const line of documentStyleText().split("\n")) {
    const match = /^(.*?) \{ (.*) \}$/.exec(line);
    if (!match || scope === undefined || !match[1]!.includes(`[data-jx="${scope}"]`)) {
      continue;
    }
    out.set(match[1]!.replaceAll(/\[data-jx="[^"]+"\]/g, "&"), match[2]!);
  }
  return out;
}

const carets = (rows: TabEl[]) => rows.map((row) => row.getAttribute("tabindex"));

/** A `<span data-probe="…">` for one of the tab's slots. */
function mark(slot: string, text: string, extra: Record<string, string> = {}): JxElement {
  return {
    attributes: { "data-probe": slot, slot, ...extra },
    tagName: "span",
    textContent: text,
  } as unknown as JxElement;
}

/** A real `<button>` in `slot="actions"` — what a consumer's pin toggle is. */
function actionButton(name: string, tabindex: string): JxElement {
  return {
    attributes: {
      "aria-label": name,
      "data-probe": "actions-button",
      slot: "actions",
      tabindex,
      type: "button",
    },
    tagName: "button",
    textContent: "◎",
  } as unknown as JxElement;
}

interface TabSpec {
  closable?: boolean;
  dirty?: boolean;
  children?: JxElement[];
  label?: string;
}

function tab(value: string, spec: TabSpec = {}): JxElement {
  const attributes: Record<string, string> = { id: `tab-${value}`, value };
  if (spec.label !== undefined) {
    attributes["label"] = spec.label;
  }
  if (spec.closable) {
    attributes["closable"] = "";
  }
  if (spec.dirty) {
    attributes["dirty"] = "";
  }
  return {
    attributes,
    tagName: "jx-tab",
    ...(spec.children ? { children: spec.children } : {}),
  } as unknown as JxElement;
}

function strip(tabs: JxElement[], selected = "one"): JxDocument {
  return {
    children: [
      { attributes: { label: "Open documents", selected }, children: tabs, tagName: "jx-tabs" },
    ],
    tagName: "div",
  } as unknown as JxDocument;
}

/** The decorated tab every slot test starts from: a marker, a pill, a control, a dot and a ✕. */
const decorated = () =>
  strip([
    tab("one", {
      children: [
        mark("icon", "↳", { "aria-hidden": "true" }),
        mark("status", "Draft"),
        actionButton("Pin hello.md", "0"),
      ],
      closable: true,
      dirty: true,
      label: "hello.md",
    }),
    tab("two", { closable: true, label: "about.md" }),
  ]);

beforeAll(async () => {
  await registerUi({ theme: false });
});

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
});

describe("jx-tab slots", () => {
  test("the element declares three named slots and no default one", () => {
    /* Read off the DEFINITION rather than off a rendering, because a slot leaves no node once it
       is distributed — so the rendered tree cannot say which slots exist, only which received
       something. The absence of a default slot is the half that has to be asserted here: unnamed
       content has nowhere to go by design (the tab's words are `label`), and nothing at runtime
       distinguishes "dropped because there is no default slot" from "the consumer wrote none". */
    const doc = documents["jx-tab"]!;
    const slots: { name: string | undefined; part: string | undefined }[] = [];
    const attr = (node: JxElement, name: string): string | undefined => {
      const value = node.attributes?.[name];
      return typeof value === "string" ? value : undefined;
    };
    const walk = (node: JxElement, part?: string): void => {
      for (const child of (node.children ?? []) as JxElement[]) {
        if (child.tagName === "slot") {
          slots.push({ name: attr(child, "name"), part });
          continue;
        }
        walk(child, attr(child, "part") ?? part);
      }
    };
    walk(doc as unknown as JxElement);
    expect(slots).toEqual([
      { name: "icon", part: "icon" },
      { name: "status", part: "status" },
      { name: "actions", part: "actions" },
    ]);
    // Each container is named, because a `part` on the slot itself would name nothing (ui.md
    // §3.2) — the CONTAINER is what a rule and a `:empty` test key on.
    expect(slots.every((slot) => typeof slot.part === "string")).toBe(true);
  });

  test("a marker draws before the label; a pill and a control after it and before the dot and the ✕", async () => {
    const { rows } = await render(decorated());
    const row = rows[0]!;
    /* Order is the whole contract of a positional slot, so it is read as ORDER — the flattened
       sequence of the tab's own marks — rather than as five independent presence checks, each of
       which would pass with the containers in any arrangement at all. */
    const flat = [...row.children].map((child) => {
      const part = child.getAttribute("part");
      return part ?? `slot:${child.getAttribute("slot")}`;
    });
    expect(flat).toEqual(["icon", "label", "status", "actions", "dirty-slot", "close-slot"]);
    expect(row.querySelector('[part="icon"]')!.textContent).toBe("↳");
    expect(row.querySelector('[part="label"]')!.textContent).toBe("hello.md");
    expect(row.querySelector('[part="status"]')!.textContent).toBe("Draft");
    expect(row.querySelector('[part="actions"] button')!.getAttribute("aria-label")).toBe(
      "Pin hello.md",
    );
    expect(row.querySelector('[part="dirty"]')).not.toBeNull();
    expect(row.querySelector('[part="close"]')).not.toBeNull();

    // Every slot UNWRAPPED: the content stands where the slot stood, and no `<slot>` survives to
    // Be captured by an outer element's distribution.
    expect(row.querySelectorAll("slot")).toHaveLength(0);
  });

  test("an undecorated tab pays nothing for the three slots it did not use", async () => {
    const { rows } = await render(decorated());
    const plain = rows[1]!;
    for (const part of ["icon", "status", "actions"]) {
      expect(plain.querySelector(`[part="${part}"]`)!.childNodes).toHaveLength(0);
    }
    /* `display: contents` is what makes an empty container cost nothing. As flex items the three
       would each take the tab's gap — the same defect `[part="dirty-slot"]` was given `contents`
       for, measured at 8px of dead trailing space with the label visibly off-centre. */
    expect(rules(plain).get('& [part="icon"], & [part="status"], & [part="actions"]')).toContain(
      "display: contents",
    );
  });

  test("unnamed content still has nowhere to go", async () => {
    const { rows } = await render(
      strip([
        tab("one", {
          children: [{ tagName: "b", textContent: "stray" } as unknown as JxElement],
          closable: true,
          label: "hello.md",
        }),
      ]),
    );
    const row = rows[0]!;
    // No default slot, so it lands nowhere at all — and in particular not inside the close button,
    // Which is where a nested defined element's own default slot would have put it.
    expect(row.querySelector("b")).toBeNull();
    expect(row.querySelector('[part="close"]')!.querySelector("b")).toBeNull();
    expect(row.querySelector('[part="label"]')!.textContent).toBe("hello.md");
  });
});

describe("jx-tab's accessible name survives the slots", () => {
  test("nothing slotted joins the tab's name, and each control keeps its own", async () => {
    const { rows } = await render(decorated());
    const row = rows[0]!;
    /* `aria-label` beats name-from-content in accname's precedence order, and that is the ONLY
       reason the slots are safe: a `role="tab"` names itself from its content, so "↳", "Draft",
       "Pin hello.md" and "Close hello.md" would otherwise all be part of the tab's own name and a
       reader would hear the file twice with three decorations wrapped around it. */
    expect(row.getAttribute("aria-label")).toBe("hello.md");
    expect(row.querySelector('[part="close"]')!.getAttribute("aria-label")).toBe("Close hello.md");
    expect(row.querySelector('[part="actions"] button')!.getAttribute("aria-label")).toBe(
      "Pin hello.md",
    );
    // The marker is the consumer's to hide, and it is hidden: a "↳" announced beside a file name
    // Says nothing a reader can use.
    expect(row.querySelector('[part="icon"] [data-probe]')!.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  test("the element says label is required once anything is slotted", () => {
    /* An unlabelled tab writes no `aria-label` at all, so name-from-content comes back and the
       slots become the name. Nothing can lint that — a bound role switches the naming rules off —
       so the contract lives in the prop's own description and this is what holds it there. */
    const doc = documents["jx-tab"]!;
    const label = doc.state!["label"] as { description: string };
    expect(label.description).toContain("REQUIRED once anything is slotted");
    expect(doc.attributes!["aria-label"]).toBe("${state.label || null}");
  });
});

describe("jx-tab's slots and the click", () => {
  test("a click on a control in actions never also selects the tab", async () => {
    const { rows, tabs, changes, clicked } = await render(decorated());
    const pin = rows[1]!.querySelector('[part="actions"] button');
    // The second tab is undecorated on purpose: the strip below starts on `one`, so a click that
    // Leaked through would be a VISIBLE selection change rather than a no-op.
    expect(pin).toBeNull();

    const own = rows[0]!.querySelector('[part="actions"] button') as HTMLButtonElement;
    tabs.selected = "two";
    own.click();
    // The control's own handler ran — it is the click's target, and `stopPropagation` at the
    // Container above it cannot unrun a listener that has already fired.
    expect(clicked).toEqual(["actions-button"]);
    // And the tab did not select: the same judgement the close button makes.
    expect(changes).toEqual([]);
    expect(tabs.selected).toBe("two");
  });

  test("a click on a mark in icon or status IS a click on the tab", async () => {
    const { rows, tabs, changes } = await render(decorated());
    tabs.selected = "two";
    (rows[0]!.querySelector('[part="status"] [data-probe]') as HTMLElement).click();
    expect(changes).toEqual(["one"]);
    expect(tabs.selected).toBe("one");

    tabs.selected = "two";
    (rows[0]!.querySelector('[part="icon"] [data-probe]') as HTMLElement).click();
    expect(changes).toEqual(["one", "one"]);
  });
});

describe("jx-tab's slots and the keyboard", () => {
  test("Enter and Space on a slotted control belong to the control", async () => {
    const { rows, tabs, changes } = await render(decorated());
    tabs.selected = "two";
    const pin = rows[0]!.querySelector('[part="actions"] button') as HTMLButtonElement;
    pin.focus();
    expect(document.activeElement).toBe(pin);
    /* A focusable control the keyboard cannot operate is SC 2.1.1, not a rough edge. If the strip
       answered these it would select the tab AND cancel the default, so the platform's own button
       activation would never run. */
    for (const name of ["Enter", " "]) {
      const pressed = key(tabs, name);
      expect(pressed.target, name).toBe(pin);
      expect(pressed.defaultPrevented, name).toBe(false);
    }
    expect(changes).toEqual([]);
    expect(tabs.selected).toBe("two");
  });

  test("the arrows move on from the tab the focused control is IN", async () => {
    const { rows, tabs } = await render(decorated());
    const pin = rows[0]!.querySelector('[part="actions"] button') as HTMLButtonElement;
    pin.focus();
    // Focus genuinely reaches a tab's slotted descendant, so the active tab is the one that
    // CONTAINS the key's target. Resolving only exact targets would send the caret to the first.
    const forward = key(tabs, "ArrowRight");
    expect(forward.defaultPrevented).toBe(true);
    expect(carets(rows)).toEqual(["-1", "0"]);
    expect(document.activeElement).toBe(rows[1]!);

    rows[1]!.focus();
    key(tabs, "Home");
    expect(carets(rows)).toEqual(["0", "-1"]);
    expect(document.activeElement).toBe(rows[0]!);

    key(tabs, "End");
    expect(carets(rows)).toEqual(["-1", "0"]);
  });

  test("Delete from a slotted control closes the tab that holds it", async () => {
    const { rows, tabs, closes } = await render(decorated());
    const pin = rows[0]!.querySelector('[part="actions"] button') as HTMLButtonElement;
    pin.focus();
    const event = key(tabs, "Delete");
    expect(event.defaultPrevented).toBe(true);
    // The pointer's own path: Delete presses the close button of the tab the caret is in, and the
    // Close button stops the click, so closing cannot also select.
    expect(closes).toEqual(["one"]);
  });

  test("a slotted control is only a tab stop while its tab is current", async () => {
    /* The kit does NOT write a `tabindex` onto consumer content — that is the foreign-attribute
       write ui.md §2 principle 5 forbids — so this is the consumer's contract, and the element's
       page states it. The cost of getting it wrong is a strip of ten tabs with ten tab stops, and
       the close button is what the right answer looks like. */
    const { rows } = await render(decorated());
    expect(rows[0]!.querySelector('[part="close"]')!.getAttribute("tabindex")).toBe("0");
    expect(rows[1]!.querySelector('[part="close"]')!.getAttribute("tabindex")).toBe("-1");
    const page = stylebookTab as unknown as { children: { textContent?: string }[] };
    expect(
      page.children.some((child) =>
        child.textContent?.includes("in the tab order only while its tab is the current one"),
      ),
    ).toBe(true);
  });
});
