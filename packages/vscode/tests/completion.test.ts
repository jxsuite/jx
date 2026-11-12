/**
 * Completion in a `.jxn` file (`spec.md` §22.6): what the one reader offers, as VS Code is given
 * it.
 */
import { describe, expect, mock, test } from "bun:test";

import { JXN_LANGUAGE_ID } from "@jxsuite/schema/jxn";
import { JXN_TRIGGER_CHARACTERS } from "@jxsuite/schema/jxn-completion";
import type { ComposedProjectSchemas } from "@jxsuite/schema/project-schemas";

import { fakeVscode } from "./_fake-vscode";
import type { FakeDocument } from "./_fake-vscode";

const fake = fakeVscode();
void mock.module("vscode", () => fake.module);

const { CompletionItemKind, Position, Range } = await import("vscode");
const { jxnItems, registerJxnCompletion } = await import("../src/completion");

const SCHEMAS: ComposedProjectSchemas = {
  document: {
    $defs: {
      Element: {
        properties: {
          children: { items: { $ref: "#/$defs/Element" }, type: "array" },
          translate: { description: "Whether its text is translated.", enum: ["yes", "no"] },
          tagName: { examples: ["main", "p"], type: "string" },
        },
      },
    },
    properties: {
      children: { items: { $ref: "#/$defs/Element" }, type: "array" },
      tagName: { examples: ["main", "p"], type: "string" },
    },
  },
  project: {},
};

/** Schemas that know one element only, to tell which schemas a provider asked with. */
const OTHER: ComposedProjectSchemas = {
  document: { properties: { tagName: { examples: ["aside"], type: "string" } } },
  project: {},
};

/** A document holding `text`, which counts lines and characters from zero as VS Code does. */
function documentOf(text: string, uri: FakeDocument["uri"]): FakeDocument {
  return {
    getText: () => text,
    offsetAt: ({ character, line }) => {
      const before = text.split("\n").slice(0, line);
      return before.join("\n").length + (before.length > 0 ? 1 : 0) + character;
    },
    positionAt: (offset) => {
      const before = text.slice(0, offset).split("\n");
      return new Position(before.length - 1, before.at(-1)?.length ?? 0);
    },
    uri,
  };
}

/** Where a file on disk is, and where a document nobody has saved is not. */
const ON_DISK: FakeDocument["uri"] = { fsPath: "/p/a.jxn", scheme: "file" };
const UNSAVED: FakeDocument["uri"] = { fsPath: "Untitled-1", scheme: "untitled" };

/** The document a case names with its `|` taken out, and where the `|` was. */
function marked(source: string, uri: FakeDocument["uri"]) {
  const document = documentOf(source.replace("|", ""), uri);
  return { document, position: document.positionAt(source.indexOf("|")) };
}

/** What VS Code is given at the `|` of a case. */
function offered(source: string) {
  const { document, position } = marked(source, ON_DISK);
  return jxnItems(SCHEMAS, document, position);
}

/** The offer of a name at the `|` of a case. */
function offer(source: string, label: string) {
  return offered(source).find((item) => item.label === label);
}

describe("what is offered", () => {
  test("is the reader's list in the reader's order, each drawn as its kind", () => {
    const items = offered("div {\n  |\n}");
    expect(items.map((item) => item.label)).toEqual([
      "state",
      "style",
      "attributes",
      "script",
      "main",
      "p",
      "-",
      "$array",
      "$element",
      ".children",
      ".translate",
    ]);
    // VS Code sorts by label unless it is told the order.
    expect(items.map((item) => item.sortText)).toEqual(
      items.map((_, at) => String(at).padStart(5, "0")),
    );
    expect(offer("div {\n  |\n}", "state")?.kind).toBe(CompletionItemKind.Property);
    expect(offer("div {\n  |\n}", "main")?.kind).toBe(CompletionItemKind.Class);
    expect(offered("div .translate=|")[0]?.kind).toBe(CompletionItemKind.Value);
    expect(offered("div {\n  (|\n}")[0]?.kind).toBe(CompletionItemKind.Keyword);
  });

  test("replaces the stretch the reader names, which is the word being written", () => {
    const [item] = offered("div {\n  p\n  sty|\n}");
    // The reader offers everything that may stand there, and the editor narrows it to the word.
    expect(item?.insertText).toBe("state");
    expect(item?.range).toEqual(new Range(new Position(2, 2), new Position(2, 5)));
  });

  test("says what the schema says of a member, and nothing where it says nothing", () => {
    expect(offer("div |", ".translate=")?.documentation).toBe("Whether its text is translated.");
    expect(offered("div .translate=|")[0]?.documentation).toBeUndefined();
  });

  test("asks again after a name, whose value is what is written next", () => {
    expect(offer("div |", ".translate=")?.command).toEqual({
      command: "editor.action.triggerSuggest",
      title: "Suggest",
    });
    expect(offered("div .translate=|")[0]?.command).toBeUndefined();
  });

  test("is nothing inside a block of code, which is TypeScript's to complete", () => {
    expect(offered('div {\n  script #"""\n    const a = |\n    """#\n}')).toEqual([]);
  });
});

describe("the provider", () => {
  test("is registered for the language, at the characters every editor asks at", () => {
    const asked: (string | null)[] = [];
    const registration = registerJxnCompletion((file) => {
      asked.push(file);
      return file === null ? OTHER : SCHEMAS;
    });
    const provider = fake.providers.at(-1);
    expect(provider?.language).toBe(JXN_LANGUAGE_ID);
    expect(provider?.triggers).toEqual([...JXN_TRIGGER_CHARACTERS]);

    // A file on disk is completed from the schemas of the project it is in.
    const onDisk = marked("|", ON_DISK);
    expect(provider?.provide(onDisk.document, onDisk.position).map((item) => item.label)).toEqual([
      "main",
      "p",
    ]);

    // A document that is not a file is in no project, and its path is not one to look from.
    const unsaved = marked("|", UNSAVED);
    expect(provider?.provide(unsaved.document, unsaved.position).map((item) => item.label)).toEqual(
      ["aside"],
    );
    expect(asked).toEqual(["/p/a.jxn", null]);

    registration.dispose();
    expect(provider?.disposed).toBe(true);
  });
});
