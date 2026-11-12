/**
 * Completion in the Code view of a `.jxn` file (§4.2.1): what the reader of `spec.md` §22.6 offers,
 * as Monaco is given it.
 */
import { describe, expect, test } from "bun:test";
import type { ComposedProjectSchemas } from "@jxsuite/schema/project-schemas";
import type { IPosition } from "monaco-editor/editor";
import {
  JXN_TRIGGER_CHARACTERS,
  jxnSuggestions,
  registerJxnCompletion,
} from "../src/services/jxn-completion";
import type { JxnCompletionKinds, JxnCompletionModel } from "../src/services/jxn-completion";
import { JXN_LANGUAGE_ID } from "../src/services/jxn-language";

/** Monaco's own numbers for the four kinds. */
const KINDS: JxnCompletionKinds = { Class: 5, Keyword: 17, Property: 9, Value: 13 };

const SCHEMAS: ComposedProjectSchemas = {
  document: {
    $defs: {
      Element: {
        properties: {
          children: { items: { $ref: "#/$defs/Element" }, type: "array" },
          dir: { description: "Which way text runs.", enum: ["ltr", "rtl"] },
          tagName: { examples: ["div", "p"], type: "string" },
        },
      },
    },
    properties: {
      children: { items: { $ref: "#/$defs/Element" }, type: "array" },
      tagName: { examples: ["div", "p"], type: "string" },
    },
  },
  project: {},
};

/** A model holding `text`, which counts lines and columns from one as Monaco does. */
function modelOf(text: string): JxnCompletionModel {
  return {
    getOffsetAt: ({ column, lineNumber }) => {
      const before = text.split("\n").slice(0, lineNumber - 1);
      return before.join("\n").length + (before.length > 0 ? 1 : 0) + column - 1;
    },
    getPositionAt: (offset) => {
      const before = text.slice(0, offset).split("\n");
      return { column: (before.at(-1)?.length ?? 0) + 1, lineNumber: before.length };
    },
    getValue: () => text,
  };
}

/** The position of the `|` in a case, and the case without it. */
function marked(source: string): [text: string, position: IPosition] {
  const text = source.replace("|", "");
  return [text, modelOf(text).getPositionAt(source.indexOf("|"))];
}

/** What Monaco is given at the `|` of a case. */
function suggested(source: string, schemas: ComposedProjectSchemas = SCHEMAS) {
  const [text, position] = marked(source);
  return jxnSuggestions(KINDS, schemas, modelOf(text), position).suggestions;
}

describe("what Monaco is given", () => {
  test("is each offer with its kind, in the reader's order", () => {
    const offers = suggested("div {\n  |\n}");
    expect(offers.map((offer) => offer.label)).toEqual([
      "state",
      "style",
      "attributes",
      "script",
      "div",
      "p",
      "-",
      "$array",
      "$element",
      ".children",
      ".dir",
    ]);
    expect(offers.map((offer) => offer.sortText)).toEqual(
      offers.map((_, at) => String(at).padStart(5, "0")),
    );
    expect(offers[0]).toEqual({
      insertText: "state",
      kind: KINDS.Property,
      label: "state",
      range: { endColumn: 3, endLineNumber: 2, startColumn: 3, startLineNumber: 2 },
      sortText: "00000",
    });
    expect(offers[4]?.kind).toBe(KINDS.Class);
    expect(suggested("div .dir=|")[0]?.kind).toBe(KINDS.Value);
    expect(suggested("div {\n  (|\n}")[0]?.kind).toBe(KINDS.Keyword);
  });

  test("replaces the word the position is in", () => {
    const [offer] = suggested("div {\n  p\n  sty|\n}");
    expect(offer?.range).toEqual({
      endColumn: 6,
      endLineNumber: 3,
      startColumn: 3,
      startLineNumber: 3,
    });
  });

  test("carries what the schema says an offer is for", () => {
    const dir = suggested("div |").find((offer) => offer.label === ".dir=");
    expect(dir?.documentation).toBe("Which way text runs.");
    expect(suggested("div .dir=|")[0]).not.toHaveProperty("documentation");
  });

  test("asks again after a name is accepted, for its value", () => {
    const dir = suggested("div |").find((offer) => offer.label === ".dir=");
    expect(dir?.command).toEqual({ id: "editor.action.triggerSuggest", title: "Suggest" });
    expect(suggested("div .dir=|")[0]).not.toHaveProperty("command");
  });

  test("is nothing in the code a file holds", () => {
    expect(suggested('div {\n  script #"""\n    const a = |\n    """#\n}')).toEqual([]);
  });
});

describe("registering with Monaco", () => {
  test("gives it one provider for the language, asked at the characters that begin a token", () => {
    const registered: [string, readonly string[] | undefined][] = [];
    registerJxnCompletion(
      {
        CompletionItemKind: KINDS,
        registerCompletionItemProvider: (language, provider) => {
          registered.push([String(language), provider.triggerCharacters]);
          return { dispose: () => {} };
        },
      },
      () => SCHEMAS,
    );
    expect(registered).toEqual([[JXN_LANGUAGE_ID, JXN_TRIGGER_CHARACTERS]]);
    // Enter accepts an offer, so a space must not open the list.
    expect(JXN_TRIGGER_CHARACTERS).not.toContain(" ");
  });

  test("does nothing where Monaco has no language API", () => {
    expect(() => {
      registerJxnCompletion(undefined, () => SCHEMAS);
    }).not.toThrow();
  });
});
