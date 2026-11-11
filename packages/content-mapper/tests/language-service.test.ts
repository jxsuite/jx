/**
 * The mapper under the real language server (`spec.md` §23.3): what an editor shows and changes is
 * the text the author wrote, in the `.jxn` file, and never the TypeScript written from it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

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
  "      state.nope = 1;",
  '      """',
  "  }",
  "  button {",
  "    state { local 1 }",
  '    (fn)onclick "state.local += state.count; state.hello(1)"',
  "  }",
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
      text: "(property) State.double: number\n\nconst double: (state: State) => number",
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
      text: "(property) State.local: number",
    });
  });

  test("renames a script's export where an entry names it, as its own name or as $export", async () => {
    expect(await renamed("const double", 6)).toEqual(
      [span("const double", 6, 6), span("(export)double", 8, 6)].toSorted(),
    );
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
      ].toSorted(),
    );
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
