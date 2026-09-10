/**
 * The Navigator's Data panel, as the document draws it — `src/surfaces/panel-signals.json`, mounted
 * by `src/surfaces/panel-signals.ts` and projected by `src/panels/signals-panel.ts`.
 *
 * Category grouping, row expansion, add and delete, and the per-category editors (state, computed,
 * data sources, functions and their CEM facts, expressions).
 *
 * Everything is addressed by `part`, by `data-prop` or by the region grammar, because the panel is
 * a document: there is no `.signal-row`, `sp-picker` or `sp-textfield` of this panel's own to find
 * any more. A row is addressed by the entry it draws (`[part="entry"][data-signal="$count"]`)
 * rather than by counting siblings, because several rows stand open at once. And every draw is
 * awaited — `mountSurface` is asynchronous, each kit element settles one `connectedCallback` after
 * that, and a `$map`'s re-render is coalesced into a microtask.
 *
 * The four foreign surfaces an editor embeds — the expression editor, the statement-card editor,
 * the media picker and the shared schema form — are ISLANDS, so what is asserted here is the seam:
 * that the host exists for the right entry and that the flow filled it. What each of them then
 * draws belongs to its own suite.
 */
import {
  clearSignalPanels,
  commitText,
  control,
  docState,
  drawSignals,
  editorFor,
  entryRow,
  fieldProps,
  fieldRow,
  dataOf,
  hasEntry,
  listedNames,
  marked,
  nativeInput,
  nativeSelect,
  openEntry,
  pick,
  press,
  settle,
  summaryText,
  summaryTone,
  tick,
  toggleEntry,
  typeText,
} from "./signals-panel-fixture";
import { flush, installMockPlatform, key, resetStudioState } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { activeTab } from "../src/workspace/workspace";
import { setExtensions } from "../src/format/format-host";
import { shell } from "../src/shell";
import { pluginSchemaCache } from "../src/services/code-services";

beforeEach(() => {
  resetStudioState();
  installMockPlatform();
  pluginSchemaCache.clear();
  clearSignalPanels();
});

/** Every category heading the panel is showing, in order. */
function categoryLabels(panel: HTMLElement): string[] {
  return [...panel.querySelectorAll('[part="category"] [part="summary"] > [part="label"]')].map(
    (el) => el.textContent ?? "",
  );
}

/** One category section, by the key the projection gave it. */
function category(panel: HTMLElement, name: string): HTMLElement {
  return panel.querySelector(`[part="category"][data-category="${name}"]`) as HTMLElement;
}

/** Whether a section is disclosed, read off the details the kit renders. */
function isOpen(item: HTMLElement): boolean {
  return (item.querySelector('[part="details"]') as HTMLDetailsElement).open;
}

/** Open or close a section the way a reader does — through that same details element. */
async function openSection(item: HTMLElement, open: boolean): Promise<void> {
  const details = item.querySelector('[part="details"]') as HTMLDetailsElement;
  details.open = open;
  details.dispatchEvent(new Event("toggle"));
  await settle();
}

/** The add picker's rows, grouped the way `jx-select` draws them. */
function addGroups(panel: HTMLElement): Record<string, string[]> {
  const select = nativeSelect(panel.querySelector('[part="add-picker"]') as Element);
  const out: Record<string, string[]> = {};
  for (const group of select.querySelectorAll("optgroup")) {
    out[group.label] = [...group.querySelectorAll("option")].map((o) => o.value);
  }
  return out;
}

/** Pick a row in the "+ Add…" picker. */
async function add(panel: HTMLElement, value: string): Promise<void> {
  await pick(panel.querySelector('[part="add-picker"]') as Element, value);
}

/** The island host for one entry's foreign surface. */
function island(editor: HTMLElement, slot: string): HTMLElement | null {
  return editor.querySelector<HTMLElement>(`[part="slot-host"][data-slot="${slot}"]`);
}

/** One entry's CEM parameters, as the document wrote them back. */
function paramsOf(name: string): Record<string, unknown>[] {
  return (docState()[name]?.parameters ?? []) as Record<string, unknown>[];
}

/** One entry's CEM emits, as the document wrote them back. */
function emitsOf(name: string): Record<string, unknown>[] {
  return (docState()[name]?.emits ?? []) as Record<string, unknown>[];
}

/** The text cells of one table row, left to right. */
function cellsOf(editor: HTMLElement, prop: string, row: string): Element[] {
  return [
    ...fieldRow(editor, prop).querySelectorAll(
      `[part="cell-row"][data-row="${row}"] [part="cell-text"]`,
    ),
  ];
}

// ─── Grouping and structure ───────────────────────────────────────────────────

describe("the entry list", () => {
  test("groups entries by category into labelled sections", async () => {
    const { panel } = await drawSignals({
      $count: { default: 0, type: "integer" },
      $double: { $compute: "$count * 2" },
      $items: { $prototype: "Request", url: "/api" },
      $push: { $expression: { operator: "push", target: { $ref: "#/state/$count" } } },
      $title: { default: "x", type: "string" },
      save: { $prototype: "Function", body: "" },
    });
    expect(categoryLabels(panel)).toEqual([
      "State (2)",
      "Computed (1)",
      "Data (1)",
      "Expressions (1)",
      "Functions (1)",
    ]);
    expect(panel.querySelector('[part="empty"]')).toBeNull();

    expect(entryRow(panel, "$items").querySelector('[part="badge"]')?.textContent).toBe("R");
    expect(summaryText(panel, "$items")).toBe("GET /api");
  });

  test("naked primitive and array entries group safely under State", async () => {
    const { panel } = await drawSignals({ list: ["a"], plain: 5 } as never);
    expect(categoryLabels(panel)).toEqual(["State (2)"]);
    expect(entryRow(panel, "plain").querySelector('[part="badge"]')?.textContent).toBe("S");
  });

  test("the badge carries its category, which is what tints it", async () => {
    // The tint is one rule keyed on `data-category`, so the category has to reach the DOM rather
    // Than be a class the projection composed.
    const { panel } = await drawSignals({
      go: { $prototype: "Function", body: "" },
      n: { default: 1 },
    });
    expect(dataOf(entryRow(panel, "n").querySelector('[part="badge"]'), "category")).toBe("state");
    expect(dataOf(entryRow(panel, "go").querySelector('[part="badge"]'), "category")).toBe(
      "function",
    );
  });

  test("no state → the empty state teaches, and its button adds what the picker adds", async () => {
    const { panel, counts } = await drawSignals({});
    expect(panel.querySelector('[part="empty-message"]')?.textContent).toContain("Data lives here");
    expect(panel.querySelectorAll('[part="category"]').length).toBe(0);

    await press(panel.querySelector('[part="empty-action"]'));
    expect(docState().$newSignal).toEqual({ default: "", type: "string" } as never);
    expect(counts.repaints).toBeGreaterThan(0);
  });

  test("a section collapses and re-expands, and the panel remembers which", async () => {
    const { panel } = await drawSignals({ $a: { default: "" } });
    expect(isOpen(category(panel, "state"))).toBe(true);

    await openSection(category(panel, "state"), false);
    expect(isOpen(category(panel, "state"))).toBe(false);

    await openSection(category(panel, "state"), true);
    expect(isOpen(category(panel, "state"))).toBe(true);
  });

  test("the disclosure is a button that says whether the entry is open", async () => {
    // The row is the box and the disclosure is the control, rather than the row being a
    // `role="button"` with Delete nested inside it — a control the keyboard reaches only by
    // Leaving the one it is in.
    const { panel } = await drawSignals({ $a: { default: "x" } });
    const disclosure = entryRow(panel, "$a").querySelector('[part="disclosure"]') as HTMLElement;
    expect(disclosure.tagName).toBe("BUTTON");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");

    const editor = await openEntry(panel, "$a");
    expect(fieldRow(editor, "Name")).not.toBeNull();
    expect(
      entryRow(panel, "$a").querySelector('[part="disclosure"]')?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(marked(entryRow(panel, "$a"), "expanded")).toBe(true);

    await toggleEntry(panel, "$a");
    expect(panel.querySelector('[part="editor"]')).toBeNull();
  });

  test("several rows stay open at once — comparing two entries means seeing both", async () => {
    const { panel } = await drawSignals({ $a: { default: 1 }, $b: { default: 2 } });
    await openEntry(panel, "$a");
    await openEntry(panel, "$b");
    expect(panel.querySelectorAll('[part="editor"]').length).toBe(2);
    expect(editorFor(panel, "$a")).not.toBe(editorFor(panel, "$b"));
  });

  test("Delete removes the entry, and names it for a reader who cannot see the row", async () => {
    const { panel } = await drawSignals({ $a: { default: "x" }, $b: { default: "y" } });
    const remove = entryRow(panel, "$a").querySelector('[part="delete"]');
    expect(remove?.querySelector('[part="control"]')?.getAttribute("aria-label")).toBe("Delete $a");
    await press(remove);
    expect(hasEntry(panel, "$a")).toBe(false);
    expect(hasEntry(panel, "$b")).toBe(true);
  });
});

// ─── Add picker ───────────────────────────────────────────────────────────────

describe("the add picker", () => {
  test("its rows are grouped rather than divided by unlabelled rules", async () => {
    const { panel } = await drawSignals({});
    const groups = addGroups(panel);
    expect(Object.keys(groups)).toEqual(["Values", "Data sources", "Logic"]);
    expect(groups["Values"]).toEqual(["state", "computed"]);
    expect(groups["Logic"]).toEqual(["expression", "function"]);
    expect(groups["Data sources"]).toContain("localStorage");
  });

  test("adds a value entry from the template and opens it", async () => {
    const { panel } = await drawSignals({});
    await add(panel, "state");
    expect(docState().$newSignal).toEqual({ default: "", type: "string" } as never);
    expect(marked(entryRow(panel, "$newSignal"), "expanded")).toBe(true);
  });

  test("the picker never rests on what was picked", async () => {
    // A controlled input is authoritative only while the scope value MOVES, so the pick is
    // Announced and then withdrawn — otherwise the same row could not be picked twice.
    const { panel } = await drawSignals({});
    await add(panel, "state");
    expect(nativeSelect(panel.querySelector('[part="add-picker"]') as Element).value).toBe("");
    await add(panel, "state");
    expect(docState().$newSignal1).toBeDefined();
  });

  test("name collisions increment a numeric suffix", async () => {
    const { panel } = await drawSignals({ $newSignal: { default: "taken" } });
    await add(panel, "state");
    expect(docState().$newSignal1).toEqual({ default: "", type: "string" } as never);
  });

  test("the function template uses the newFunction base name", async () => {
    const { panel } = await drawSignals({});
    await add(panel, "function");
    expect(docState().newFunction).toEqual({
      $prototype: "Function",
      body: "",
      parameters: [],
    } as never);
  });

  test("the request template seeds method, timing and url", async () => {
    const { panel } = await drawSignals({});
    await add(panel, "request");
    expect(docState().$newSignal).toEqual({
      $prototype: "Request",
      method: "GET",
      timing: "client",
      url: "",
    } as never);
  });

  test("an empty pick is a no-op", async () => {
    const { panel } = await drawSignals({});
    await add(panel, "");
    expect(Object.keys(docState())).toEqual([]);
  });

  test("project imports are a group of their own and add a prototype entry", async () => {
    resetStudioState({ projectConfig: { imports: { ContentCollection: "./plugins/cc.js" } } });
    const { panel, counts } = await drawSignals({});
    expect(addGroups(panel)["Project imports"]).toEqual(["import:ContentCollection"]);

    let fetched = 0;
    installMockPlatform({
      fetchPluginSchema: async () => {
        fetched += 1;
        return { properties: { source: { type: "string" } } };
      },
    });
    await add(panel, "import:ContentCollection");
    expect(docState().$contentCollection).toEqual({ $prototype: "ContentCollection" } as never);
    await flush();
    // Fetched through the platform and cached, then the panel repainted with the form in it.
    expect(fetched).toBe(1);
    expect(pluginSchemaCache.get("./plugins/cc.js::ContentCollection")).toEqual({
      properties: { source: { type: "string" } },
    });
    expect(counts.repaints).toBeGreaterThan(0);
  });

  test("an import with no known source path still adds the entry and repaints", async () => {
    // `Missing` is declared with no path, so the entry is added and nothing is fetched.
    resetStudioState({ projectConfig: { imports: { Known: "./k.js", Missing: "" } } });
    const { panel, counts } = await drawSignals({ $missing: { $prototype: "Missing" } });
    await add(panel, "import:Missing");
    // Collision with the existing `$missing` entry → suffix.
    expect(docState().$missing1).toEqual({ $prototype: "Missing" } as never);
    expect(counts.repaints).toBeGreaterThan(0);
  });

  test("extension state classes are a group, and their stateDefaults seed the entry", async () => {
    setExtensions([
      {
        classes: [
          // Auth carries admission blocks → not a state class, so no row.
          { name: "Auth", path: "/ext/Auth.class.json" },
          {
            name: "Session",
            path: "/ext/Session.class.json",
            state: true,
            stateDefaults: { timing: "client" },
          },
          { name: "AuthActions", path: "/ext/AuthActions.class.json", state: true },
        ],
        contributions: [],
        name: "@jxsuite/auth",
        specifier: "@jxsuite/auth",
      },
    ]);
    try {
      const { panel } = await drawSignals({});
      expect(addGroups(panel)["Extensions"]).toEqual(["ext:Session", "ext:AuthActions"]);

      // The descriptor's stateDefaults seed the created entry (specs/extensions.md §10).
      await add(panel, "ext:Session");
      expect(docState().$session).toEqual({ $prototype: "Session", timing: "client" } as never);
      // Without stateDefaults the entry is the bare prototype reference.
      await add(panel, "ext:AuthActions");
      expect(docState().$authActions).toEqual({ $prototype: "AuthActions" } as never);
    } finally {
      setExtensions([]);
    }
  });
});

// ─── State entry editor ───────────────────────────────────────────────────────

describe("the value editor", () => {
  test("rename commits when the field is left", async () => {
    const { panel } = await drawSignals({ $old: { default: "v" } });
    const editor = await openEntry(panel, "$old");
    await commitText(control(editor, "Name", "text"), "$renamed");
    expect(docState().$old).toBeUndefined();
    expect(docState().$renamed).toEqual({ default: "v" } as never);
  });

  test("a rename onto an existing name is refused, AND says so", async () => {
    // The refusal used to be a silent `return`: the document kept `$a`, the field showed `$b`, and
    // The only way to learn which had won was to look at the canvas.
    const { panel } = await drawSignals({ $a: { default: 1 }, $b: { default: 2 } });
    let editor = await openEntry(panel, "$a");
    await commitText(control(editor, "Name", "text"), "$b");
    expect(docState().$a).toEqual({ default: 1 } as never);
    expect(docState().$b).toEqual({ default: 2 } as never);

    editor = editorFor(panel, "$a");
    const alert = fieldRow(editor, "Name").querySelector('[role="alert"]');
    expect(alert?.textContent?.trim()).toBe('"$b" is already defined by this document.');
    expect(marked(fieldRow(editor, "Name"), "invalid")).toBe(true);
  });

  test("an empty name is refused with its own message", async () => {
    const { panel } = await drawSignals({ $a: { default: 1 } });
    const editor = await openEntry(panel, "$a");
    await commitText(control(editor, "Name", "text"), "   ");
    expect(docState().$a).toEqual({ default: 1 } as never);
    expect(
      fieldRow(editorFor(panel, "$a"), "Name").querySelector('[role="alert"]')?.textContent?.trim(),
    ).toBe("A name is required.");
  });

  test("an accepted rename clears the refusal and keeps the row open under the new name", async () => {
    const { panel } = await drawSignals({ $a: { default: 1 }, $b: { default: 2 } });
    let editor = await openEntry(panel, "$a");
    await commitText(control(editor, "Name", "text"), "$b");
    editor = editorFor(panel, "$a");
    await commitText(control(editor, "Name", "text"), "$c");
    expect(docState().$c).toEqual({ default: 1 } as never);
    // The editor followed the rename rather than collapsing out from under the caret…
    expect(marked(entryRow(panel, "$c"), "expanded")).toBe(true);
    // …and the refusal it replaced is gone.
    expect(editorFor(panel, "$c").querySelector('[role="alert"]')).toBeNull();
  });

  test("the type picker updates the entry", async () => {
    const { panel } = await drawSignals({ $sig: { default: "", type: "string" } });
    const editor = await openEntry(panel, "$sig");
    await pick(control(editor, "Type", "select"), "integer");
    expect(docState().$sig!.type).toBe("integer");
  });

  test("format is offered for strings, and an image format hands Default to the media picker", async () => {
    const { panel } = await drawSignals({ $img: { default: "", type: "string" } });
    let editor = await openEntry(panel, "$img");
    await pick(control(editor, "Format", "select"), "image");
    expect(docState().$img!.format).toBe("image");

    editor = editorFor(panel, "$img");
    // The picker is a surface of its own, so what this panel owns is the host it lands in.
    const host = island(editor, "media");
    expect(host).not.toBeNull();
    expect(host!.childNodes.length).toBeGreaterThan(0);

    const field = host!.querySelector("sp-textfield") as HTMLElement & { value: string };
    field.value = "/hero.png";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => {
      setTimeout(r, 450);
    });
    expect(docState().$img!.default).toBe("/hero.png");
  });

  test("the format row is hidden for non-string types", async () => {
    const { panel } = await drawSignals({ $n: { default: 1, type: "integer" } });
    const editor = await openEntry(panel, "$n");
    expect(fieldProps(editor)).not.toContain("Format");
  });

  test("default values parse per type", async () => {
    const { panel } = await drawSignals({
      $arr: { default: [], type: "array" },
      $bool: { default: false, type: "boolean" },
      $int: { default: 0, type: "integer" },
      $num: { default: 0, type: "number" },
      $obj: { default: {}, type: "object" },
      $str: { default: "", type: "string" },
    });
    const commitDefault = async (name: string, value: string) => {
      await commitText(control(await openEntry(panel, name), "Default", "text"), value);
    };
    await commitDefault("$int", "42");
    expect(docState().$int!.default).toBe(42);
    await commitDefault("$num", "3.5");
    expect(docState().$num!.default).toBe(3.5);
    await commitDefault("$bool", "true");
    expect(docState().$bool!.default).toBe(true);
    await commitDefault("$arr", '["a","b"]');
    expect(docState().$arr!.default).toEqual(["a", "b"]);
    // Invalid JSON falls back to the raw string.
    await commitDefault("$obj", "{oops");
    expect(docState().$obj!.default).toBe("{oops");
    await commitDefault("$str", "plain");
    expect(docState().$str!.default).toBe("plain");
  });

  test("an invalid integer default coerces to 0, and an object default reads as JSON", async () => {
    const { panel } = await drawSignals({
      $int: { default: 0, type: "integer" },
      $obj: { default: { a: 1 }, type: "object" },
    });
    await commitText(control(await openEntry(panel, "$int"), "Default", "text"), "abc");
    expect(docState().$int!.default).toBe(0);

    const editor = await openEntry(panel, "$obj");
    expect(nativeInput(control(editor, "Default", "text")).value).toBe('{"a":1}');
  });

  test("a commit that does not move the value transacts nothing", async () => {
    // `signalFieldRow`'s "unchanged value does not call onChange" — a blur fires `change` whether
    // Or not anything was typed, and a rename or a default that re-writes what is already there
    // Would be an undo step for nothing.
    const { panel } = await drawSignals({ $s: { default: "keep" } });
    const editor = await openEntry(panel, "$s");
    const before = activeTab.value!.doc.document;
    await commitText(control(editor, "Default", "text"), "keep");
    // A transaction replaces the document; nothing happened, so nothing was replaced.
    expect(activeTab.value!.doc.document).toBe(before);
    expect(docState().$s!.default).toBe("keep");
  });

  test("description commits, and clearing it drops the key", async () => {
    const { panel } = await drawSignals({ $s: { default: "" } });
    let editor = await openEntry(panel, "$s");
    await commitText(control(editor, "Description", "text"), "my desc");
    expect(docState().$s!.description).toBe("my desc");

    editor = editorFor(panel, "$s");
    await commitText(control(editor, "Description", "text"), "");
    expect(docState().$s!.description).toBeUndefined();
  });

  test("a custom element gets the CEM fields: attribute, reflects, deprecated", async () => {
    const { panel } = await drawSignals(
      { $open: { default: false, type: "boolean" } },
      { tagName: "my-card" },
    );
    const editor = await openEntry(panel, "$open");
    await commitText(control(editor, "Attribute", "text"), "open");
    expect(docState().$open!.attribute).toBe("open");

    await tick(control(editorFor(panel, "$open"), "reflects", "checkbox"), true);
    expect(docState().$open!.reflects).toBe(true);
    await tick(control(editorFor(panel, "$open"), "reflects", "checkbox"), false);
    expect(docState().$open!.reflects).toBeUndefined();

    await commitText(control(editorFor(panel, "$open"), "Deprecated", "text"), "use $visible");
    expect(docState().$open!.deprecated).toBe("use $visible");
  });

  test("a plain document has no CEM fields", async () => {
    const { panel } = await drawSignals({ $s: { default: "" } });
    const editor = await openEntry(panel, "$s");
    expect(fieldProps(editor)).toEqual(["Name", "Type", "Format", "Default", "Description"]);
  });
});

// ─── Computed editor ──────────────────────────────────────────────────────────

describe("the computed editor", () => {
  test("shows the expression and its dependencies; typing recomputes $deps after a pause", async () => {
    const { panel } = await drawSignals({
      $sum: { $compute: "$a + $b", $deps: ["#/state/$a", "#/state/$b"] },
    });
    const editor = await openEntry(panel, "$sum");
    expect(nativeInput(control(editor, "expression", "multiline")).value).toBe("$a + $b");
    expect(fieldRow(editor, "dependencies").textContent).toContain("$a, $b");

    typeText(control(editor, "expression", "multiline"), "$x * $y + $x");
    await new Promise((r) => {
      setTimeout(r, 540);
    });
    expect(docState().$sum!.$compute).toBe("$x * $y + $x");
    expect(docState().$sum!.$deps).toEqual(["#/state/$x", "#/state/$y"]);
  });

  test("the dependencies row is hidden when there are none", async () => {
    const { panel } = await drawSignals({ $c: { $compute: "1" } });
    const editor = await openEntry(panel, "$c");
    expect(fieldProps(editor)).not.toContain("dependencies");
  });
});

// ─── Data source editors ──────────────────────────────────────────────────────

describe("the data-source editors", () => {
  test("Request: url, method and timing commit", async () => {
    const { panel } = await drawSignals({
      $req: { $prototype: "Request", method: "GET", timing: "client", url: "" },
    });
    const editor = await openEntry(panel, "$req");
    await commitText(control(editor, "URL", "text"), "/api/posts");
    await pick(control(editorFor(panel, "$req"), "Method", "select"), "POST");
    await pick(control(editorFor(panel, "$req"), "Timing", "select"), "server");
    expect(docState().$req!.url).toBe("/api/posts");
    expect(docState().$req!.method).toBe("POST");
    expect(docState().$req!.timing).toBe("server");
  });

  test("LocalStorage: key commits; the default parses JSON or keeps the raw string", async () => {
    const { panel } = await drawSignals({
      $ls: { $prototype: "LocalStorage", default: null, key: "" },
    });
    const editor = await openEntry(panel, "$ls");
    await commitText(control(editor, "Key", "text"), "theme");
    expect(docState().$ls!.key).toBe("theme");

    await commitText(control(editorFor(panel, "$ls"), "Default", "multiline"), '{"mode":"dark"}');
    expect(docState().$ls!.default).toEqual({ mode: "dark" } as never);
    await commitText(control(editorFor(panel, "$ls"), "Default", "multiline"), "not json");
    expect(docState().$ls!.default).toBe("not json" as never);
  });

  test("SessionStorage renders an object default as pretty JSON", async () => {
    const { panel } = await drawSignals({
      $ss: { $prototype: "SessionStorage", default: { mode: "dark" }, key: "k" },
    });
    const editor = await openEntry(panel, "$ss");
    const stored = nativeInput(control(editor, "Default", "multiline")).value;
    expect(JSON.parse(stored)).toEqual({ mode: "dark" });
  });

  test("IndexedDB: database and store commit; version falls back to 1", async () => {
    const { panel } = await drawSignals({
      $db: { $prototype: "IndexedDB", database: "", store: "", version: 1 },
    });
    const editor = await openEntry(panel, "$db");
    await commitText(control(editor, "Database", "text"), "appdb");
    await commitText(control(editorFor(panel, "$db"), "Store", "text"), "items");
    await commitText(control(editorFor(panel, "$db"), "Version", "text"), "5");
    expect(docState().$db!.database).toBe("appdb");
    expect(docState().$db!.store).toBe("items");
    expect(docState().$db!.version).toBe(5);

    await commitText(control(editorFor(panel, "$db"), "Version", "text"), "bogus");
    expect(docState().$db!.version).toBe(1);
  });

  test("Cookie: name and default commit", async () => {
    const { panel } = await drawSignals({ $ck: { $prototype: "Cookie", default: "", name: "" } });
    const editor = await openEntry(panel, "$ck");
    await commitText(control(editor, "Cookie", "text"), "sid");
    await commitText(control(editorFor(panel, "$ck"), "Default", "text"), "anon");
    expect(docState().$ck!.name).toBe("sid");
    expect(docState().$ck!.default).toBe("anon");
  });

  test("Set: a JSON default commits; invalid JSON is ignored", async () => {
    const { panel } = await drawSignals({ $set: { $prototype: "Set", default: [] } });
    const editor = await openEntry(panel, "$set");
    await commitText(control(editor, "Default", "multiline"), '["a","b"]');
    expect(docState().$set!.default).toEqual(["a", "b"]);

    await commitText(control(editorFor(panel, "$set"), "Default", "multiline"), "{nope");
    expect(docState().$set!.default).toEqual(["a", "b"]);
  });

  test("FormData edits the fields key and reads existing fields as JSON", async () => {
    const { panel } = await drawSignals({ $fd: { $prototype: "FormData", fields: { email: "" } } });
    const editor = await openEntry(panel, "$fd");
    const fields = nativeInput(control(editor, "Fields", "multiline")).value;
    expect(JSON.parse(fields)).toEqual({ email: "" });
    await commitText(control(editor, "Fields", "multiline"), '{"email":"","name":""}');
    expect(docState().$fd!.fields).toEqual({ email: "", name: "" } as never);
  });

  test("Map reads its default and commits parsed JSON", async () => {
    const { panel } = await drawSignals({ $map: { $prototype: "Map", default: { a: 1 } } });
    const editor = await openEntry(panel, "$map");
    const stored = nativeInput(control(editor, "Default", "multiline")).value;
    expect(JSON.parse(stored)).toEqual({ a: 1 });
    await commitText(control(editor, "Default", "multiline"), '{"b":2}');
    expect(docState().$map!.default).toEqual({ b: 2 } as never);
  });

  test("an unknown prototype falls back to the external plugin editor", async () => {
    const { panel } = await drawSignals({ $ext: { $prototype: "Widget", $src: "./w.js" } });
    const editor = await openEntry(panel, "$ext");
    expect(fieldProps(editor)).toContain("Source");
    expect(fieldProps(editor)).toContain("Kind");
  });
});

// ─── Function editor ──────────────────────────────────────────────────────────

describe("the function editor", () => {
  test("description and body commit; the code button opens the Logic tab on this entry", async () => {
    const { panel } = await drawSignals({
      save: { $prototype: "Function", body: "", parameters: [] },
    });
    let editor = await openEntry(panel, "save");
    await commitText(control(editor, "Description", "text"), "saves things");
    expect(docState().save!.description).toBe("saves things");

    editor = editorFor(panel, "save");
    typeText(editor.querySelector('[part="code"]') as Element, "console.log(1)");
    expect(docState().save!.body).toBe("console.log(1)");

    shell.docks.bottom.collapsed = true;
    await press(
      editorFor(panel, "save").querySelector('[part="bar-button"][data-action="editor"]'),
    );
    expect(activeTab.value!.session.ui.editingFunction).toEqual({ defName: "save", type: "def" });
    // The click is a GESTURE: it puts the surface on screen itself rather than leaning on the
    // Dock's once-per-target effect, which is what made a second click on a closed dock a no-op.
    expect(shell.bottomTab).toBe("logic");
    expect(shell.docks.bottom.collapsed).toBe(false);
  });

  test("an external function shows Source and Export instead of a body", async () => {
    const { panel } = await drawSignals({
      run: { $export: "runIt", $prototype: "Function", $src: "./fns.js" },
    });
    const editor = await openEntry(panel, "run");
    expect(editor.querySelector('[part="code"]')).toBeNull();
    expect(editor.querySelector('[part="bar"]')).toBeNull();

    await commitText(control(editor, "Source", "text"), "./other.js");
    await commitText(control(editorFor(panel, "run"), "Export", "text"), "main");
    expect(docState().run!.$src).toBe("./other.js");
    expect(docState().run!.$export).toBe("main");
  });

  test("basic parameters: chips render, Enter adds, remove drops the last one's key", async () => {
    const { panel } = await drawSignals({
      go: { $prototype: "Function", body: "", parameters: ["a", "b"] },
    });
    let editor = await openEntry(panel, "go");
    expect([...editor.querySelectorAll('[part="chip-label"]')].map((c) => c.textContent)).toEqual([
      "a",
      "b",
    ]);

    const addInput = nativeInput(
      fieldRow(editor, "parameters").querySelector('[part="chip-add"]') as Element,
    );
    addInput.value = "c";
    key(addInput, "Enter");
    await settle();
    expect(docState().go!.parameters).toEqual([
      { name: "a" },
      { name: "b" },
      { name: "c" },
    ] as never);

    // A non-Enter key does nothing.
    const stillThere = nativeInput(
      fieldRow(editorFor(panel, "go"), "parameters").querySelector('[part="chip-add"]') as Element,
    );
    stillThere.value = "d";
    key(stillThere, "a");
    await settle();
    expect(docState().go!.parameters).toHaveLength(3);

    editor = editorFor(panel, "go");
    await press(editor.querySelector('[part="chip"][data-chip="0"] [part="chip-remove"]'));
    expect(docState().go!.parameters).toEqual([{ name: "b" }, { name: "c" }] as never);
  });

  test("removing the only parameter drops the parameters key", async () => {
    const { panel } = await drawSignals({
      go: { $prototype: "Function", body: "", parameters: ["only"] },
    });
    const editor = await openEntry(panel, "go");
    await press(editor.querySelector('[part="chip-remove"]'));
    expect(docState().go!.parameters).toBeUndefined();
  });

  test("advanced parameters: every column commits, and rows are added and removed", async () => {
    const { panel } = await drawSignals({
      adv: {
        $prototype: "Function",
        body: "",
        parameters: [{ name: "evt", type: { text: "Event" } }, "ctx"],
      },
    });
    let editor = await openEntry(panel, "adv");
    await press(editor.querySelector('[part="field-footer"]'));

    editor = editorFor(panel, "adv");
    expect(fieldRow(editor, "parameters").querySelectorAll('[part="cell-row"]').length).toBe(2);
    expect(cellsOf(editor, "parameters", "0")).toHaveLength(3);
    expect(nativeInput(cellsOf(editor, "parameters", "0")[1]!).value).toBe("Event");

    await commitText(cellsOf(editor, "parameters", "0")[0]!, "event");
    expect(docState().adv!.parameters).toEqual([
      { name: "event", type: { text: "Event" } },
      { name: "ctx" },
    ] as never);

    // Clearing the type drops the key rather than writing an empty one.
    await commitText(cellsOf(editorFor(panel, "adv"), "parameters", "0")[1]!, "");
    expect(paramsOf("adv")[0]).toEqual({ name: "event" } as never);

    await commitText(cellsOf(editorFor(panel, "adv"), "parameters", "0")[2]!, "the event");
    expect(paramsOf("adv")[0]!.description).toBe("the event");

    // Optional is a column of its own.
    const optional = () =>
      editorFor(panel, "adv").querySelector(
        '[part="cell-row"][data-row="0"] [part="cell-checkbox"]',
      )!;
    await tick(optional(), true);
    expect(paramsOf("adv")[0]!.optional).toBe(true);
    await tick(optional(), false);
    expect(paramsOf("adv")[0]!.optional).toBeUndefined();

    // A type set on the second row becomes the CEM `{ text }` shape.
    await commitText(cellsOf(editorFor(panel, "adv"), "parameters", "1")[1]!, "AppContext");
    expect(paramsOf("adv")[1]!.type).toEqual({
      text: "AppContext",
    } as never);

    await press(fieldRow(editorFor(panel, "adv"), "parameters").querySelector('[part="row-add"]'));
    expect(docState().adv!.parameters).toHaveLength(3);

    await press(
      editorFor(panel, "adv").querySelector('[part="cell-row"][data-row="2"] [part="cell-remove"]'),
    );
    expect(docState().adv!.parameters).toHaveLength(2);

    // …and back to the chips.
    await press(editorFor(panel, "adv").querySelector('[part="field-footer"]'));
    expect(editorFor(panel, "adv").querySelector('[part="chip-add"]')).not.toBeNull();
  });

  test("removing the only advanced parameter drops the key", async () => {
    const { panel } = await drawSignals({
      solo: { $prototype: "Function", body: "", parameters: ["x"] },
    });
    const editor = await openEntry(panel, "solo");
    await press(editor.querySelector('[part="field-footer"]'));
    await press(editorFor(panel, "solo").querySelector('[part="cell-remove"]'));
    expect(docState().solo!.parameters).toBeUndefined();
  });
});

// ─── Function body mode (statements vs code, spec §20) ───────────────────────

describe("the function body's two modes", () => {
  test("a string body is the Code mode: the switch says so, and the text box is there", async () => {
    const { panel } = await drawSignals({
      fn: { $prototype: "Function", body: "doIt()", parameters: [] },
    });
    const editor = await openEntry(panel, "fn");
    expect(editor.querySelector('[part="bar-label"]')?.textContent).toBe("Body");
    expect(marked(editor.querySelector('[part="segment"][data-segment="code"]'), "selected")).toBe(
      true,
    );
    expect(
      marked(editor.querySelector('[part="segment"][data-segment="statements"]'), "selected"),
    ).toBe(false);
    expect(editor.querySelector('[part="code"]')).not.toBeNull();
    expect(island(editor, "statements")).toBeNull();
  });

  test("an array body is the Statements mode, and the card editor lands in its host", async () => {
    const { panel } = await drawSignals({
      fn: { $prototype: "Function", body: [{ dispatchEvent: "ping" }], parameters: [] },
    });
    const editor = await openEntry(panel, "fn");
    expect(
      marked(editor.querySelector('[part="segment"][data-segment="statements"]'), "selected"),
    ).toBe(true);
    expect(editor.querySelector('[part="code"]')).toBeNull();
    // The statement editor is a surface of its own; this panel owns the host and the region it is
    // Drawn under, which is what tells it apart from the Events tab's copy.
    expect(island(editor, "statements")?.childNodes.length).toBeGreaterThan(0);
    expect(editor.querySelector('[data-jx-region="navigator/statements"]')).not.toBeNull();
    // The code affordance only applies to a string body.
    expect(editor.querySelector('[part="bar-button"][data-action="editor"]')).toBeNull();
  });

  test("switching to Statements seeds an empty array; switching back seeds an empty string", async () => {
    const { panel } = await drawSignals({
      fn: { $prototype: "Function", body: "doIt()", parameters: [] },
    });
    let editor = await openEntry(panel, "fn");
    await press(editor.querySelector('[part="segment"][data-segment="statements"]'));
    expect(docState().fn!.body).toEqual([] as never);
    editor = editorFor(panel, "fn");
    expect(island(editor, "statements")).not.toBeNull();

    await press(editor.querySelector('[part="segment"][data-segment="code"]'));
    expect(docState().fn!.body).toBe("" as never);
    editor = editorFor(panel, "fn");
    expect(island(editor, "statements")).toBeNull();
    expect(editor.querySelector('[part="code"]')).not.toBeNull();
  });

  test("pressing the mode that is already on is a no-op", async () => {
    const { panel } = await drawSignals({
      fn: { $prototype: "Function", body: "keep me", parameters: [] },
    });
    const editor = await openEntry(panel, "fn");
    await press(editor.querySelector('[part="segment"][data-segment="code"]'));
    expect(docState().fn!.body).toBe("keep me" as never);
  });

  test("the row summary counts a structured body's statements", async () => {
    const { panel } = await drawSignals({
      fn: { $prototype: "Function", body: [{ dispatchEvent: "a" }], parameters: [] },
      fn2: { $prototype: "Function", body: [], parameters: [] },
    });
    expect(summaryText(panel, "fn")).toBe("1 statement");
    expect(summaryText(panel, "fn2")).toBe("0 statements");
  });
});

// ─── Emits editor (custom elements) ──────────────────────────────────────────

describe("the emits editor", () => {
  test("hidden for a document that is not a custom element", async () => {
    const { panel } = await drawSignals({ fn: { $prototype: "Function", body: "" } });
    const editor = await openEntry(panel, "fn");
    expect(fieldProps(editor)).not.toContain("emits");
  });

  test("event name, type and description commit; rows are added and removed", async () => {
    const { panel } = await drawSignals(
      {
        notify: {
          $prototype: "Function",
          body: "",
          emits: [
            { description: "old", name: "changed", type: { text: "CustomEvent" } },
            { name: "closed" },
          ],
        },
      },
      { tagName: "my-card" },
    );
    const editor = await openEntry(panel, "notify");
    expect(fieldRow(editor, "emits").querySelectorAll('[part="cell-row"]').length).toBe(2);

    await commitText(cellsOf(editor, "emits", "0")[0]!, "updated");
    expect(emitsOf("notify")[0]).toEqual({
      description: "old",
      name: "updated",
      type: { text: "CustomEvent" },
    } as never);

    await commitText(cellsOf(editorFor(panel, "notify"), "emits", "0")[1]!, "");
    expect(emitsOf("notify")[0]!.type).toBeUndefined();
    await commitText(cellsOf(editorFor(panel, "notify"), "emits", "0")[2]!, "");
    expect(emitsOf("notify")[0]!.description).toBeUndefined();

    await commitText(cellsOf(editorFor(panel, "notify"), "emits", "1")[1]!, "Event");
    await commitText(cellsOf(editorFor(panel, "notify"), "emits", "1")[2]!, "fires on close");
    expect(emitsOf("notify")[1]).toEqual({
      description: "fires on close",
      name: "closed",
      type: { text: "Event" },
    } as never);

    await press(fieldRow(editorFor(panel, "notify"), "emits").querySelector('[part="row-add"]'));
    expect(docState().notify!.emits).toHaveLength(3);

    await press(
      fieldRow(editorFor(panel, "notify"), "emits").querySelector(
        '[part="cell-row"][data-row="0"] [part="cell-remove"]',
      ),
    );
    expect(docState().notify!.emits).toHaveLength(2);
  });

  test("a malformed CEM type object reads as empty type text", async () => {
    const { panel } = await drawSignals(
      { fn: { $prototype: "Function", body: "", emits: [{ name: "e", type: { weird: 1 } }] } },
      { tagName: "x-el" },
    );
    const editor = await openEntry(panel, "fn");
    expect(nativeInput(cellsOf(editor, "emits", "0")[1]!).value).toBe("");
  });

  test("removing the only event drops the emits key", async () => {
    const { panel } = await drawSignals(
      { fn: { $prototype: "Function", body: "", emits: [{ name: "only" }] } },
      { tagName: "x-el" },
    );
    const editor = await openEntry(panel, "fn");
    await press(fieldRow(editor, "emits").querySelector('[part="cell-remove"]'));
    expect(docState().fn!.emits).toBeUndefined();
  });
});

// ─── Expression editor ────────────────────────────────────────────────────────

describe("the expression editor", () => {
  test("the formula tree lands in its host and commits an operator change", async () => {
    const { panel } = await drawSignals({
      $inc: { $expression: { operator: "=", target: { $ref: "#/state/$count" } } },
    });
    const editor = await openEntry(panel, "$inc");
    const host = island(editor, "expression");
    expect(host?.childNodes.length).toBeGreaterThan(0);

    // The editor is a surface of its own: what this panel owns is that its edits reach the entry.
    const picker = host!.querySelector(".expr-operator") as HTMLElement & { value: string };
    picker.value = "!";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect((docState().$inc!.$expression as { operator: string }).operator).toBe("!");
  });

  test("the workspace button names itself, and takes the Logic tab from a function", async () => {
    const { panel } = await drawSignals({
      $inc: { $expression: { operator: "=", target: { $ref: "#/state/$count" } } },
    });
    const editor = await openEntry(panel, "$inc");
    const button = editor.querySelector('[part="bar-button"][data-action="formula"]');
    expect(button?.querySelector('[part="control"]')?.getAttribute("aria-label")).toBe(
      "Open in formula workspace",
    );

    // A function body is open in the same tab: one Logic tab holds ONE target, so opening the
    // Formula has to take it — this used to leave both set, and `logicTarget` gives the function
    // The tie, so the click showed nothing and changed nothing.
    activeTab.value!.session.ui.editingFunction = { defName: "other", type: "def" } as never;
    shell.docks.bottom.collapsed = true;
    await press(button);

    expect(activeTab.value!.session.ui.editingFormula).toEqual({ defName: "$inc", type: "def" });
    expect(activeTab.value!.session.ui.editingFunction).toBeNull();
    expect(shell.bottomTab).toBe("logic");
    expect(shell.docks.bottom.collapsed).toBe(false);
  });

  test("an entry that only ACTS shows its definition rather than a value", async () => {
    // A function and an assignment expression are things the page does, not things it knows, so
    // They are absent from the resolved scope — and the value column called them "pending", which
    // Reads as "still loading" for something that will never load.
    const { panel } = await drawSignals(
      {
        held: { default: 1, type: "number" },
        runIt: { $prototype: "Function", body: "return 1;" },
        setIt: { $expression: { operator: "=", target: { $ref: "#/state/held" }, value: 2 } },
        sum: { $expression: { operator: "+", target: { $ref: "#/state/held" }, value: 2 } },
      },
      { scope: { held: 1, sum: 3 } },
    );
    const toneOf = (name: string) => summaryTone(panel, name);
    expect(toneOf("held")).toBe("value");
    // …and a formula expression DOES hold one, so it keeps the column.
    expect(toneOf("sum")).toBe("value");
    expect(toneOf("runIt")).toBe("hint");
    expect(toneOf("setIt")).toBe("hint");
  });
});

// ─── The list is keyed ───────────────────────────────────────────────────────

describe("reconciliation", () => {
  test("a repaint keeps the node a reader is typing into", async () => {
    // Every host array a document renders is a keyed `$map`, so a registry tick never rebuilds a
    // Row the reader is on — which is what retires the lit panel's focus guard.
    const { panel, repaint } = await drawSignals({ $a: { default: "x" }, $b: { default: "y" } });
    const editor = await openEntry(panel, "$a");
    const field = nativeInput(control(editor, "Description", "text"));
    field.focus();
    repaint();
    await settle();
    const after = editorFor(panel, "$a");
    expect(nativeInput(control(after, "Description", "text"))).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(listedNames(panel)).toEqual(["$a", "$b"]);
  });
});
