import "./with-dom.ts";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { documentStyleText, mount } from "@jxsuite/runtime";
import type { JxDocument } from "@jxsuite/schema/types";

import { documents } from "../src/documents.ts";
import { registerUi } from "../src/index.ts";

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

type JxTable = HTMLElement & { label: string; rowcount: number };
type JxTr = HTMLElement & { rowindex: number };
type JxTh = HTMLElement & { scope: string };

beforeAll(async () => {
  await registerUi();
});

afterEach(() => {
  document.body.replaceChildren();
});

/** A fresh, unattached kit element by tag, with the attributes given. */
function make(tag: string, attrs: Record<string, string> = {}, text = ""): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  el.textContent = text;
  return el;
}

/** A two-column table of the rows given, each row's first cell a row header. */
async function table(attrs: Record<string, string>, rows: string[][]): Promise<JxTable> {
  /* SAFETY: registerUi() in beforeAll defined jx-table from its document, so createElement
     constructs that class synchronously, and jx-table.json declares `label` and `rowcount` as
     state props the class exposes as properties. */
  const el = make("jx-table", attrs) as JxTable;
  const head = make("jx-tr");
  head.append(make("jx-th", {}, "Package"), make("jx-th", {}, "Current"));
  el.append(head);
  for (const [name = "", version = ""] of rows) {
    const row = make("jx-tr");
    row.append(make("jx-th", { scope: "row" }, name), make("jx-td", {}, version));
    el.append(row);
  }
  document.body.append(el);
  await tick();
  await tick();
  return el;
}

/**
 * The emitted rules that mention ONE element's scope handle, keyed by selector with that handle
 * folded to `&`. Declaration TEXT, not behaviour: happy-dom leaves any value containing `var()`
 * empty in `getComputedStyle`, so a token-valued declaration can only be read as what was written.
 */
function rulesOf(el: HTMLElement): Map<string, string> {
  const handle = `[data-jx="${el.dataset["jx"] ?? ""}"]`;
  const out = new Map<string, string>();
  for (const line of documentStyleText().split("\n")) {
    const match = /^(.*?) \{ (.*) \}$/u.exec(line);
    if (match && match[1]!.includes(handle)) {
      out.set(match[1]!.replaceAll(handle, "&"), match[2]!);
    }
  }
  return out;
}

const displayOf = (el: Element) => getComputedStyle(el).display;

/**
 * A cell's own `display`, read as declaration text. happy-dom's computed style does not know
 * `table-cell` as a `display` value and answers with nothing, so the cascade cannot be asked for a
 * cell; it is asked for the table and the row, whose values it does know.
 */
const declaredDisplay = (el: HTMLElement) =>
  /(?:^|; )display: ([a-z-]+)/u.exec(rulesOf(el).get("&") ?? "")?.[1];

describe("jx-table", () => {
  test("jx-table is a CSS table with the table role, named by its label", async () => {
    const el = await table({ label: "Files" }, [["a", "1"]]);
    expect(el.getAttribute("role")).toBe("table");
    expect(displayOf(el)).toBe("table");
    expect(el.getAttribute("aria-label")).toBe("Files");
    // An empty label writes no attribute at all, rather than naming the table "".
    const unnamed = await table({}, [["a", "1"]]);
    expect(unnamed.hasAttribute("aria-label")).toBe(false);
    unnamed.label = "Packages";
    await tick();
    expect(unnamed.getAttribute("aria-label")).toBe("Packages");
  });

  test("rows, header cells and cells take their roles and table displays", async () => {
    const el = await table({ label: "Files" }, [["a", "1"]]);
    const [head, row] = [...el.querySelectorAll<HTMLElement>("jx-tr")];
    expect(head!.getAttribute("role")).toBe("row");
    expect(displayOf(head!)).toBe("table-row");
    const column = head!.querySelector<HTMLElement>("jx-th")!;
    expect(column.getAttribute("role")).toBe("columnheader");
    expect(declaredDisplay(column)).toBe("table-cell");
    const cell = row!.querySelector<HTMLElement>("jx-td")!;
    expect(cell.getAttribute("role")).toBe("cell");
    expect(declaredDisplay(cell)).toBe("table-cell");
  });

  test("a jx-th with scope=row is a row header, and changing scope moves the role", async () => {
    const el = await table({ label: "Files" }, [["a", "1"]]);
    /* SAFETY: jx-th.json declares `scope` as a state prop the registered class exposes. */
    const header = el.querySelectorAll("jx-tr")[1]!.querySelector("jx-th") as JxTh;
    // Written as an ATTRIBUTE before connection, which works because the document observes it.
    expect(header.getAttribute("role")).toBe("rowheader");
    expect(declaredDisplay(header)).toBe("table-cell");
    header.scope = "col";
    await tick();
    expect(header.getAttribute("role")).toBe("columnheader");
    header.scope = "row";
    await tick();
    expect(header.getAttribute("role")).toBe("rowheader");
  });

  test("rowcount and rowindex are written only when given", async () => {
    const el = await table({ label: "Files" }, [["a", "1"]]);
    /* SAFETY: jx-tr.json declares `rowindex` as a state prop the registered class exposes. */
    const row = el.querySelectorAll("jx-tr")[1] as JxTr;
    // Zero, the default, says "count me from the DOM", which is what a whole table wants.
    expect(el.hasAttribute("aria-rowcount")).toBe(false);
    expect(row.hasAttribute("aria-rowindex")).toBe(false);
    el.rowcount = 41;
    row.rowindex = 3;
    await tick();
    expect(el.getAttribute("aria-rowcount")).toBe("41");
    expect(row.getAttribute("aria-rowindex")).toBe("3");
    // And as attributes, which is how a document that is not a Jx surface writes them.
    const windowed = await table({ label: "Files", rowcount: "2001" }, []);
    const late = make("jx-tr", { rowindex: "18" });
    windowed.append(late);
    await tick();
    expect(windowed.getAttribute("aria-rowcount")).toBe("2001");
    expect(late.getAttribute("aria-rowindex")).toBe("18");
    el.rowcount = 0;
    await tick();
    expect(el.hasAttribute("aria-rowcount")).toBe(false);
  });

  test("a mapped list of rows leaves nothing but rows between the table and them", async () => {
    /* The hazard ui.md §3.5 names, held. A row must be its table's own child and a cell its
       row's: any box between them and CSS wraps it in an anonymous row, and the roles stop
       describing the boxes. A slot leaves no node and a mapped array leaves only a comment, so a
       document that maps its rows inside a `jx-table` draws exactly the tree it wrote. */
    const doc: JxDocument = {
      tagName: "div",
      state: { rows: [{ name: "a" }, { name: "b" }, { name: "c" }] },
      children: [
        {
          tagName: "jx-table",
          $props: { label: "Mapped" },
          children: [
            { tagName: "jx-tr", children: [{ tagName: "jx-th", textContent: "Name" }] },
            {
              $prototype: "Array",
              items: { $ref: "#/state/rows" },
              key: { $ref: "$map/item/name" },
              map: {
                tagName: "jx-tr",
                children: [{ tagName: "jx-td", textContent: "${$map.item.name}" }],
              },
            },
          ],
        },
      ],
    };
    const host = document.createElement("div");
    document.body.append(host);
    await mount(doc, host);
    await tick();
    await tick();
    const el = host.querySelector<HTMLElement>("jx-table")!;
    expect([...el.children].map((child) => child.localName)).toEqual([
      "jx-tr",
      "jx-tr",
      "jx-tr",
      "jx-tr",
    ]);
    for (const row of el.children) {
      expect([...row.children].every((cell) => /^jx-t[dh]$/u.test(cell.localName))).toBe(true);
      expect(row.children).toHaveLength(1);
    }
    expect(el.querySelector("slot")).toBeNull();
    expect([...el.querySelectorAll("jx-td")].map((cell) => cell.textContent)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("the cells draw the kit's hairline and padding, and the header its tone", async () => {
    const el = await table({ label: "Files" }, [["a", "1"]]);
    const own = rulesOf(el).get("&") ?? "";
    // Separate borders at zero spacing: each cell draws one hairline, and a sticky cell keeps it.
    expect(own).toContain("border-collapse: separate");
    expect(own).toContain("border-spacing: 0");
    expect(own).toContain("width: 100%");
    const row = el.querySelectorAll<HTMLElement>("jx-tr")[1]!;
    const header = rulesOf(row.querySelector<HTMLElement>("jx-th")!).get("&") ?? "";
    const cell = rulesOf(row.querySelector<HTMLElement>("jx-td")!).get("&") ?? "";
    for (const text of [header, cell]) {
      expect(text).toContain("padding: var(--jx-space-2) var(--jx-space-3)");
      expect(text).toContain("border-block-end: 1px solid var(--jx-border)");
      expect(text).toContain("vertical-align: middle");
    }
    expect(header).toContain("font-weight: 600");
    expect(header).toContain("color: var(--jx-fg-dim)");
    expect(header).toContain("text-align: start");
    expect(cell).not.toContain("font-weight");
    // A row owns no look: hover, a cursor and a click are the consumer's.
    expect([...rulesOf(row).keys()].toSorted()).toEqual(["&", "&[hidden]"]);
  });

  test("the four elements hold no part, no event and no behaviour: one slot each", () => {
    for (const tag of ["jx-table", "jx-tr", "jx-th", "jx-td"] as const) {
      const doc = documents[tag];
      expect(doc.children, tag).toEqual([{ tagName: "slot" }]);
      expect(JSON.stringify(doc), tag).not.toContain("jx-ui:/behaviors");
      expect(JSON.stringify(doc), tag).not.toContain("dispatchEvent");
    }
  });
});
