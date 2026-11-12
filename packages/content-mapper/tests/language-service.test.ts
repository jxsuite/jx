/**
 * The mapper under the real language server (`spec.md` §23.3): what an editor shows and changes is
 * the text the author wrote, in the `.jxn` file, and never the TypeScript written from it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { pathToFileURL } from "node:url";

import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

import { Fixture, LanguageServer, SLOW, buildMapper, position } from "./fixture";

const SOURCE = [
  "div {",
  '  script #"""',
  "    export const double = (state: State) => state.count * 2;",
  "    export function greet(state: State, event: Event) {",
  "      state.count += 1;",
  "      void event;",
  "    }",
  '    """#',
  "  state {",
  "    count 0",
  "    (export)double",
  "    (export)hello $export=greet",
  '    (fn)go a b """',
  "      state.count = a + b;",
  "      void state.double;",
  "      state.nope = 1;",
  '      """',
  "  }",
  "  button {",
  "    state { local 1 }",
  '    (fn)onclick "state.local += state.count; state.hello(1)"',
  '    (fn)onkeydown e "void e.key"',
  "  }",
  '  p "${state.count} left" hidden=(ref)"#/state/count" title=(ref)"#/state/absent"',
  "}",
  "",
].join("\n");

/** A place in the file as `line:character`, both counted from zero, as the server counts. */
function at(needle: string, delta = 0): string {
  const { character, line } = position(SOURCE, needle, delta);
  return `${line}:${character}`;
}

/** A range of the file, as the server answers with one. */
interface Range extends JsonObject {
  end: { character: number; line: number };
  start: { character: number; line: number };
}

/** Where a range starts, and how far along its line it goes. */
const spanOf = ({ end, start }: Range): string =>
  `${start.line}:${start.character}+${end.character - start.character}`;

/** A place and a length, as {@link spanOf} writes one. */
const span = (needle: string, delta: number, length: number): string =>
  `${at(needle, delta)}+${length}`;

let fixture: Fixture;
let server: LanguageServer;
let document: { uri: string };

/** Ask about a place in the file. */
async function ask(
  method: string,
  needle: string,
  delta: number,
  more: JsonObject = {},
): Promise<JsonValue> {
  return await server.request(method, {
    position: position(SOURCE, needle, delta),
    textDocument: document,
    ...more,
  });
}

/** Rename what is at a place, and say every span of the file the editor would rewrite. */
async function renamed(needle: string, delta: number): Promise<string[]> {
  const answer = await ask("textDocument/rename", needle, delta, { newName: "renamed" });
  // SAFETY: a rename is answered with a workspace edit, its changes keyed by the file they are in.
  const { changes } = answer as { changes: Record<string, { newText: string; range: Range }[]> };
  expect(Object.keys(changes)).toEqual([document.uri]);
  return (changes[document.uri] ?? []).map((edit) => spanOf(edit.range)).toSorted();
}

/** What the editor shows over a place: its text, and the span it is about. */
async function hovered(needle: string, delta: number) {
  const answer = await ask("textDocument/hover", needle, delta);
  // SAFETY: a hover over a name is answered with its text and the range of the name.
  const { contents, range } = answer as { contents: { value: string }; range: Range };
  return { over: spanOf(range), text: contents.value };
}

beforeAll(async () => {
  buildMapper();
  fixture = new Fixture();
  const path = fixture.write("src/a.jxn", SOURCE);
  server = new LanguageServer(fixture.root);
  await server.open(fixture.root);
  document = server.edit(path, SOURCE);
}, SLOW);

afterAll(() => {
  server.stop();
  fixture.remove();
});

describe("an editor on a document", () => {
  test(
    "marks an error where the author wrote it",
    async () => {
      const answer = await server.request("textDocument/diagnostic", { textDocument: document });
      // SAFETY: a pull for diagnostics is answered with the file's whole list.
      const { items } = answer as { items: { code: number; range: Range }[] };
      expect(items.map((item) => `${spanOf(item.range)} TS${item.code}`)).toEqual([
        `${span("state.nope", 6, 4)} TS2339`,
        `${span("state.hello(1)", 6, 5)} TS2554`,
        `${span("absent", 0, 6)} TS2339`,
      ]);
    },
    SLOW,
  );

  test("shows the type of state read in a body, over the name as written", async () => {
    expect(await hovered("state.count = a", 6)).toEqual({
      over: span("state.count = a", 6, 5),
      text: "(property) State.count: number",
    });
  });

  test("shows, over an entry's name, the export the entry names", async () => {
    expect(await hovered("(export)double", 9)).toEqual({
      over: span("(export)double", 8, 6),
      text: "const double: (state: State) => number",
    });
    // And where a body reads the entry, what the entry is: a computed value is what it returns.
    expect(await hovered("void state.double", 12)).toEqual({
      over: span("void state.double", 11, 6),
      text: "(property) double: number",
    });
  });

  test("shows a parameter where a body uses it", async () => {
    expect(await hovered("= a + b", 2)).toEqual({
      over: span("= a + b", 2, 1),
      text: "(parameter) a: any",
    });
  });

  test("shows the state of a scope inside the document, to a body in that scope", async () => {
    expect(await hovered("state.local", 6)).toEqual({
      over: span("state.local", 6, 5),
      // Each scope inside a document has an interface of its own, numbered from the root's.
      text: "(property) State$1.local: number",
    });
  });

  test("renames an export under an entry's own name from the script, the entry or a body", async () => {
    // The one word is the entry and the export, so wherever it starts a rename reaches all three.
    const every = [
      span("const double", 6, 6),
      span("(export)double", 8, 6),
      span("void state.double", 11, 6),
    ].toSorted();
    expect(await renamed("const double", 6)).toEqual(every);
    expect(await renamed("(export)double", 9)).toEqual(every);
    expect(await renamed("void state.double", 12)).toEqual(every);
  });

  test("renames a script's export where an entry's $export names it", async () => {
    expect(await renamed("function greet", 9)).toEqual(
      [span("function greet", 9, 5), span("$export=greet", 8, 5)].toSorted(),
    );
  });

  test("renames a state entry in its declaration, the script, and every body that reads it", async () => {
    expect(await renamed("    count 0", 4)).toEqual(
      [
        span("    count 0", 4, 5),
        span("state.count * 2", 6, 5),
        span("state.count += 1", 6, 5),
        span("state.count = a", 6, 5),
        // A body in a scope of its own reads the document's state through the same declaration.
        span("state.count; state.hello", 6, 5),
        // And so do a template and a reference, which are no body at all.
        span("${state.count} left", 8, 5),
        span('"#/state/count"', 9, 5),
      ].toSorted(),
    );
  });

  test("shows the type of state read in a template, and of what a reference names", async () => {
    expect(await hovered("${state.count} left", 8)).toEqual({
      over: span("${state.count} left", 8, 5),
      text: "(property) State.count: number",
    });
    expect(await hovered('"#/state/count"', 9)).toEqual({
      over: span('"#/state/count"', 9, 5),
      text: "(property) State.count: number",
    });
  });

  test("renames a state entry from a reference to it, and goes from one to the entry", async () => {
    expect(await renamed('"#/state/count"', 9)).toEqual(await renamed("    count 0", 4));
    const answer = await ask("textDocument/definition", '"#/state/count"', 9);
    // SAFETY: a definition is answered with the places that declare the name.
    const places = answer as { range: Range; uri: string }[];
    expect(places.map((place) => `${place.uri} ${spanOf(place.range)}`)).toEqual([
      `${document.uri} ${span("    count 0", 4, 5)}`,
    ]);
  });

  test("renames an entry of a scope inside the document, where it is declared and read", async () => {
    expect(await renamed("state { local 1 }", 8)).toEqual(
      [span("state { local 1 }", 8, 5), span("state.local", 6, 5)].toSorted(),
    );
  });

  test("shows the event a handler is given, over the parameter that receives it", async () => {
    expect(await hovered("void e.key", 5)).toEqual({
      over: span("void e.key", 5, 1),
      text: [
        "(parameter) e: KeyboardEvent & {",
        "    readonly currentTarget: HTMLButtonElement;",
        "    readonly target: HTMLButtonElement;",
        "}",
      ].join("\n"),
    });
    // What it reads off the event is the platform's, with the platform's own account of it after.
    const key = await hovered("void e.key", 7);
    expect(key.over).toBe(span("void e.key", 7, 3));
    expect(key.text).toStartWith("(property) KeyboardEvent.key: string");
  });

  test("renames a parameter where it is declared and where the body uses it", async () => {
    expect(await renamed("(fn)go a b", 7)).toEqual(
      [span("(fn)go a b", 7, 1), span("= a + b", 2, 1)].toSorted(),
    );
  });

  test("offers the document's state after `state.`", async () => {
    const answer = await ask("textDocument/completion", "state.nope", 6);
    // SAFETY: a completion is answered with a list of items, each with the text it offers.
    const { items } = answer as { items: { label: string }[] };
    expect(items.map((item) => item.label).toSorted()).toEqual(["count", "double", "go", "hello"]);
  });

  test("goes from an entry that is an export under its own name to the script", async () => {
    const answer = await ask("textDocument/definition", "void state.double", 12);
    // SAFETY: a definition is answered with the places that declare the name.
    const places = answer as { range: Range; uri: string }[];
    expect(places.map((place) => spanOf(place.range))).toEqual([span("const double", 6, 6)]);
  });

  test("goes from a call in a body to the entry, and through it to the script", async () => {
    const answer = await ask("textDocument/definition", "state.hello(1)", 6);
    // SAFETY: a definition is answered with the places that declare the name.
    const places = answer as { range: Range; uri: string }[];
    expect(places.map((place) => place.uri)).toEqual([document.uri, document.uri]);
    expect(places.map((place) => spanOf(place.range))).toEqual([
      span("(export)hello", 8, 5),
      span("function greet", 9, 5),
    ]);
  });
});

describe("an editor on a document that gives a component its props", () => {
  const CARD = [
    "x-card {",
    '  state { title "t"; count 0 }',
    '  h2 "${state.title}"',
    "}",
    "",
  ].join("\n");
  const PAGE = [
    '(array)$elements (ref)"./x-card.jxn"',
    "div {",
    '  state { heading "x" }',
    '  x-card { $props title=(ref)"#/state/heading" count="3" }',
    "}",
    "",
  ].join("\n");
  let made: Fixture;
  let editor: LanguageServer;
  let card: { uri: string };
  let page: { uri: string };

  /** A span of one of the two files, as `uri line:character+length`. */
  const within = (file: { uri: string }, source: string, needle: string, length: number) => {
    const { character, line } = position(source, needle);
    return `${file.uri} ${line}:${character}+${length}`;
  };

  /** Rename what is at a place, and say every span of either file the editor would rewrite. */
  async function rewritten(file: { uri: string }, source: string, needle: string) {
    const answer = await editor.request("textDocument/rename", {
      newName: "renamed",
      position: position(source, needle),
      textDocument: file,
    });
    // SAFETY: a rename is answered with a workspace edit, its changes keyed by the file they are in.
    const { changes } = answer as { changes: Record<string, { range: Range }[]> };
    return Object.entries(changes)
      .flatMap(([uri, edits]) => edits.map((edit) => `${uri} ${spanOf(edit.range)}`))
      .toSorted();
  }

  beforeAll(async () => {
    made = new Fixture();
    const cardPath = made.write("src/x-card.jxn", CARD);
    const pagePath = made.write("src/page.jxn", PAGE);
    editor = new LanguageServer(made.root);
    await editor.open(made.root);
    card = editor.edit(cardPath, CARD);
    page = editor.edit(pagePath, PAGE);
  }, SLOW);

  afterAll(() => {
    editor.stop();
    made.remove();
  });

  test(
    "marks a prop the component does not take as that, at the prop's name",
    async () => {
      const answer = await editor.request("textDocument/diagnostic", { textDocument: page });
      // SAFETY: a pull for diagnostics is answered with the file's whole list.
      const { items } = answer as { items: { code: number; range: Range }[] };
      expect(items.map((item) => `${page.uri} ${spanOf(item.range)} TS${item.code}`)).toEqual([
        `${within(page, PAGE, 'count="3"', 5)} TS2322`,
      ]);
    },
    SLOW,
  );

  test("shows, over a prop's name, what the component holds under it", async () => {
    const answer = await editor.request("textDocument/hover", {
      position: position(PAGE, "title="),
      textDocument: page,
    });
    // SAFETY: a hover over a name is answered with its text and the range of the name.
    const { contents, range } = answer as { contents: { value: string }; range: Range };
    expect(`${page.uri} ${spanOf(range)}`).toBe(within(page, PAGE, "title=", 5));
    expect(contents.value).toBe("(property) title?: string | null | undefined");
  });

  test("goes from a prop's name to the entry of the component it sets", async () => {
    const answer = await editor.request("textDocument/definition", {
      position: position(PAGE, "title="),
      textDocument: page,
    });
    // SAFETY: a definition is answered with the places that declare the name.
    const places = answer as { range: Range; uri: string }[];
    expect(places.map((place) => `${place.uri} ${spanOf(place.range)}`)).toEqual([
      within(card, CARD, 'title "t"', 5),
    ]);
  });

  test("renames a component's entry in the component and in every document that sets it", async () => {
    const everywhere = [
      within(card, CARD, 'title "t"', 5),
      within(card, CARD, "title}", 5),
      within(page, PAGE, "title=", 5),
    ].toSorted();
    expect(await rewritten(card, CARD, 'title "t"')).toEqual(everywhere);
    // And from the prop, which is the same name.
    expect(await rewritten(page, PAGE, "title=")).toEqual(everywhere);
  });
});

describe("an editor on a document that declares its types", () => {
  const LIST = [
    "$defs {",
    "  TodoItem {",
    "    type object",
    "    properties {",
    "      text type=string",
    '      next (ref)"#/$defs/TodoItem"',
    "    }",
    "    (array)required text",
    "  }",
    "}",
    "todo-list {",
    "  state {",
    "    items {",
    '      type type=array items=(ref)"#/$defs/TodoItem"',
    "      (array)default",
    "    }",
    '    (fn)add "state.items.push({ text: 1 })"',
    "  }",
    '  p "${state.items[0].text}"',
    "}",
    "",
  ].join("\n");
  let made: Fixture;
  let editor: LanguageServer;
  let list: { uri: string };

  /** A span of the file, as `line:character+length`. */
  const where = (needle: string, delta: number, length: number): string => {
    const { character, line } = position(LIST, needle, delta);
    return `${line}:${character}+${length}`;
  };

  /** Ask about a place in the file. */
  async function asked(method: string, needle: string, delta: number, more: JsonObject = {}) {
    return await editor.request(method, {
      position: position(LIST, needle, delta),
      textDocument: list,
      ...more,
    });
  }

  /** Rename what is at a place, and say every span of the file the editor would rewrite. */
  async function rewritten(needle: string, delta: number): Promise<string[]> {
    const answer = await asked("textDocument/rename", needle, delta, { newName: "Renamed" });
    // SAFETY: a rename is answered with a workspace edit, its changes keyed by the file they are in.
    const { changes } = answer as { changes: Record<string, { range: Range }[]> };
    expect(Object.keys(changes)).toEqual([list.uri]);
    return (changes[list.uri] ?? []).map((edit) => spanOf(edit.range)).toSorted();
  }

  beforeAll(async () => {
    made = new Fixture();
    const path = made.write("src/todo-list.jxn", LIST);
    editor = new LanguageServer(made.root);
    await editor.open(made.root);
    list = editor.edit(path, LIST);
  }, SLOW);

  afterAll(() => {
    editor.stop();
    made.remove();
  });

  test(
    "marks a value a definition does not take, where the author wrote it",
    async () => {
      const answer = await editor.request("textDocument/diagnostic", { textDocument: list });
      // SAFETY: a pull for diagnostics is answered with the file's whole list.
      const { items } = answer as { items: { code: number; range: Range }[] };
      expect(items.map((item) => `${spanOf(item.range)} TS${item.code}`)).toEqual([
        `${where("text: 1", 0, 4)} TS2322`,
      ]);
    },
    SLOW,
  );

  test("shows state by the definition it names, and the definition over a reference to it", async () => {
    const answer = await asked("textDocument/hover", "state.items.push", 6);
    // SAFETY: a hover over a name is answered with its text and the range of the name.
    const { contents, range } = answer as { contents: { value: string }; range: Range };
    expect(spanOf(range)).toBe(where("state.items.push", 6, 5));
    expect(contents.value).toBe("(property) State.items: $defs.TodoItem[]");
    const over = await asked("textDocument/hover", 'TodoItem"\n      (array)', 0);
    // SAFETY: as above.
    const named = over as { contents: { value: string }; range: Range };
    expect(spanOf(named.range)).toBe(where('TodoItem"\n      (array)', 0, 8));
    expect(named.contents.value).toContain("type $defs.TodoItem = {");
  });

  test("goes from a reference to the definition it names", async () => {
    const answer = await asked("textDocument/definition", 'TodoItem"\n      (array)', 0);
    // SAFETY: a definition is answered with the places that declare the name.
    const places = answer as { range: Range; uri: string }[];
    expect(places.map((place) => spanOf(place.range))).toEqual([where("TodoItem {", 0, 8)]);
  });

  test("renames a definition where it is declared and at the end of every reference to it", async () => {
    const everywhere = [
      where("TodoItem {", 0, 8),
      where('TodoItem"\n    }', 0, 8),
      where('TodoItem"\n      (array)', 0, 8),
    ].toSorted();
    expect(await rewritten("TodoItem {", 0)).toEqual(everywhere);
    // And from a reference, which is the same name.
    expect(await rewritten('TodoItem"\n      (array)', 0)).toEqual(everywhere);
  });

  test("renames a property of a definition where it is declared and where code reads it", async () => {
    expect(await rewritten("text type=string", 0)).toEqual(
      [where("text type=string", 0, 4), where("text: 1", 0, 4), where("text}", 0, 4)].toSorted(),
    );
  });
});

/** What a test asks of a document that has an editor to itself. */
interface Alone {
  /** Rename what is at a place, and say every span of the file the editor would rewrite. */
  rewritten: (needle: string, delta: number) => Promise<string[]>;
  /** A place and a length in the document. */
  where: (needle: string, delta: number, length: number) => string;
}

/** Open one more document in an editor of its own, for as long as the `describe` around it runs. */
function alone(name: string, source: string): Alone {
  let made: Fixture;
  let editor: LanguageServer;
  let opened: { uri: string };

  beforeAll(async () => {
    made = new Fixture();
    const path = made.write(name, source);
    editor = new LanguageServer(made.root);
    await editor.open(made.root);
    opened = editor.edit(path, source);
  }, SLOW);

  afterAll(() => {
    editor.stop();
    made.remove();
  });

  return {
    rewritten: async (needle, delta) => {
      const answer = await editor.request("textDocument/rename", {
        newName: "renamed",
        position: position(source, needle, delta),
        textDocument: opened,
      });
      // SAFETY: a rename is answered with a workspace edit, its changes keyed by their file.
      const { changes } = answer as { changes: Record<string, { range: Range }[]> };
      return (changes[opened.uri] ?? []).map((edit) => spanOf(edit.range)).toSorted();
    },
    where: (needle, delta, length) => {
      const { character, line } = position(source, needle, delta);
      return `${line}:${character}+${length}`;
    },
  };
}

describe("an editor on a document whose entry is a server function under its own name", () => {
  const SERVED = [
    "div {",
    '  script timing=server #"""',
    "    export async function user(args: { id: number }) {",
    '      return { name: "a", id: args.id };',
    "    }",
    '    """#',
    "  state {",
    "    (server)user id=1",
    '    (fn)go "void state.user?.name"',
    "  }",
    "}",
    "",
  ].join("\n");
  const { rewritten, where } = alone("src/served.jxn", SERVED);

  const declared = where("function user", 9, 4);
  const entry = where("(server)user", 8, 4);
  const read = where("state.user", 6, 4);

  test("renames the function, the entry and what reads it, from the entry", async () => {
    expect(await rewritten("(server)user", 9)).toEqual([declared, entry, read].toSorted());
  });

  // The server module cannot name itself, so the entry and the function stay two names there.
  test("leaves what reads the entry when the rename starts at the function", async () => {
    expect(await rewritten("function user", 9)).toEqual([declared, entry].toSorted());
  });

  test("leaves the function when the rename starts where the entry is read", async () => {
    expect(await rewritten("state.user", 6)).toEqual([entry, read].toSorted());
  });
});

describe("an editor on a document whose element declares a name of the state around it", () => {
  const SHADOWED = [
    "div {",
    '  script "export const double = (state: State) => state.count * 2;"',
    "  state {",
    "    count 0",
    '    label "x"',
    "    (export)double",
    '    (fn)go "void [state.count, state.label, state.double]"',
    "  }",
    "  section {",
    '    state { count "now a string"; local 1 }',
    '    (fn)onclick "void [state.count.trim(), state.label.trim(), state.double, state.local]"',
    "    b {",
    "      state { label 1 }",
    '      (fn)onclick "void [state.label.toFixed(), state.count.length, state.local]"',
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
  const { rewritten, where } = alone("src/shadowed.jxn", SHADOWED);

  /* The element's `State` extends the one around it less the name it declares, so every other
     member is still the member the root declares, and the name it declares is a member of its own. */
  test("renames an entry of the state around it from the root or from a body in the element", async () => {
    const all = [
      where('label "x"', 0, 5),
      where("state.label, state.double", 6, 5),
      where("state.label.trim", 6, 5),
    ].toSorted();
    expect(await rewritten('label "x"', 1)).toEqual(all);
    expect(await rewritten("state.label.trim", 7)).toEqual(all);
  });

  test("renames the name the element declares where that one is read, and not the root's", async () => {
    const inner = [
      where('count "now', 0, 5),
      where("state.count.trim", 6, 5),
      where("state.count.length", 6, 5),
    ].toSorted();
    expect(await rewritten("state.count.length", 7)).toEqual(inner);
    expect(await rewritten("count 0", 1)).toEqual(
      [
        where("count 0", 0, 5),
        where("state.count * 2", 6, 5),
        where("state.count, state.label", 6, 5),
      ].toSorted(),
    );
  });

  test("renames an entry of the element from a body in an element inside it that declares another", async () => {
    expect(await rewritten("state.local]", 7)).toEqual(
      [
        where("local 1", 0, 5),
        where("state.double, state.local", "state.double, state.".length, 5),
        where("state.count.length, state.local", "state.count.length, state.".length, 5),
      ].toSorted(),
    );
  });

  test("renames an export under an entry's own name from a body in the element", async () => {
    expect(await rewritten("state.double, state.local", 7)).toEqual(
      [
        where("const double", 6, 6),
        where("(export)double", 8, 6),
        where("state.double]", 6, 6),
        where("state.double, state.local", 6, 6),
      ].toSorted(),
    );
  });
});

describe("an editor on a document whose parameters declare their types", () => {
  const TYPED = [
    "$defs {",
    "  Task {",
    "    type object",
    "    properties { id type=integer }",
    "  }",
    "}",
    "div {",
    "  state {",
    "    add {",
    "      $prototype Function",
    "      parameters {",
    '        - { name task; type text="$defs.Task[]" }',
    '        - name=other type=(ref)"#/$defs/Task"',
    "      }",
    '      body "void [task.length, other.id]"',
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
  const { rewritten, where } = alone("src/typed.jxn", TYPED);

  test("renames a parameter written with its type, at its name and where the body uses it", async () => {
    const block = [where("name task", 5, 4), where("task.length", 0, 4)].toSorted();
    expect(await rewritten("name task", 6)).toEqual(block);
    expect(await rewritten("task.length", 1)).toEqual(block);
    const line = [where("name=other", 5, 5), where("other.id", 0, 5)].toSorted();
    expect(await rewritten("name=other", 6)).toEqual(line);
    expect(await rewritten("other.id", 1)).toEqual(line);
  });

  test("renames a definition inside the text of a type and at the end of a reference", async () => {
    const all = [
      where("Task {", 0, 4),
      where("$defs.Task[]", 6, 4),
      where('#/$defs/Task"', 8, 4),
    ].toSorted();
    expect(await rewritten("Task {", 1)).toEqual(all);
    expect(await rewritten("$defs.Task[]", 7)).toEqual(all);
  });
});

describe("an editor on a page of a project in a folder under the tsconfig", () => {
  const PAGE = 'div {\n  (fn)onclick "void state.shared"\n}\n';

  test(
    "reads the page again when told the project's file has changed",
    async () => {
      const made = new Fixture();
      const editor = new LanguageServer(made.root);
      try {
        const projectFile = made.write("src/site/project.jxn", 'project "x"\n');
        const path = made.write("src/site/pages/index.jxn", PAGE);
        await editor.open(made.root);
        const opened = editor.edit(path, PAGE);
        const codes = async (): Promise<JsonValue[]> => {
          const answer = await editor.request("textDocument/diagnostic", { textDocument: opened });
          // SAFETY: a pull of diagnostics is answered with a report holding its items.
          return (answer as { items: { code: JsonValue }[] }).items.map((item) => item.code);
        };
        // The project has no state, so the page's own is all there is to read.
        expect(await codes()).toEqual([2339]);

        made.write("src/site/project.jxn", 'project "x"\nstate {\n  shared 1\n}\n');
        // An editor watches the files a server asks it to, and says when one changes.
        editor.notify("workspace/didChangeWatchedFiles", {
          changes: [{ type: 2, uri: pathToFileURL(projectFile).href }],
        });
        expect(await codes()).toEqual([]);
      } finally {
        editor.stop();
        made.remove();
      }
    },
    SLOW,
  );
});

describe("an editor that has not been let run the project's mappers", () => {
  test(
    "says nothing of a document, and starts nothing to read it",
    async () => {
      const made = new Fixture();
      const quiet = new LanguageServer(made.root);
      try {
        const path = made.write("src/a.jxn", SOURCE);
        await quiet.open(made.root, false);
        const opened = quiet.edit(path, SOURCE);
        const diagnostics = await quiet.request("textDocument/diagnostic", {
          textDocument: opened,
        });
        expect(diagnostics).toEqual({ items: [], kind: "full" });
        const hover = await quiet.request("textDocument/hover", {
          position: position(SOURCE, "state.count = a", 6),
          textDocument: opened,
        });
        expect(hover).toBeNull();
      } finally {
        quiet.stop();
        made.remove();
      }
    },
    SLOW,
  );
});
