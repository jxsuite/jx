/**
 * The schemas a `.jxn` file is completed from are the ones its JSON siblings are validated against
 * (§4.2.1): the bundled core until a project's are applied, the project's from then on, and the
 * core again once they are reset.
 *
 * Isolated from `monaco-setup.test.ts` so this file gets its own module registry: the provider is
 * registered when `monaco-setup` is imported, and what it is registered with is this file's
 * double.
 */
import "./harness";
import { describe, expect, mock, test } from "bun:test";
import type { languages } from "monaco-editor/editor";
import type { JxnCompletionModel } from "../src/services/jxn-completion";
import { JXN_LANGUAGE_ID } from "../src/services/jxn-language";
import { installMonacoSetupMocks } from "./monaco-setup-mocks";
import type { CompletionProviderDouble } from "./monaco-setup-mocks";

const registerCompletionItemProvider = mock(
  (_language: string, _provider: CompletionProviderDouble) => ({
    dispose: () => {},
  }),
);

installMonacoSetupMocks({
  editorApi: {
    languages: {
      CompletionItemKind: { Class: 5, Keyword: 17, Property: 9, Value: 13 },
      register: () => {},
      registerCompletionItemProvider,
      setLanguageConfiguration: () => ({ dispose: () => {} }),
      setMonarchTokensProvider: () => ({ dispose: () => {} }),
    },
  },
});

if (typeof self === "undefined") {
  Object.assign(globalThis, { self: globalThis });
}

const { applyProjectSchemas, resetProjectSchemas } = await import("../src/services/monaco-setup");

/** A one-line model with the position at its end. */
function asked(text: string): languages.CompletionItem[] {
  const [call] = registerCompletionItemProvider.mock.calls;
  if (!call) {
    throw new Error("no completion provider was registered");
  }
  const model: JxnCompletionModel = {
    getOffsetAt: ({ column }) => column - 1,
    getPositionAt: (offset) => ({ column: offset + 1, lineNumber: 1 }),
    getValue: () => text,
  };
  return call[1].provideCompletionItems(model, { column: text.length + 1, lineNumber: 1 })
    .suggestions;
}

const labels = (text: string): unknown[] => asked(text).map((offer) => offer.label);

describe("the schemas a .jxn file is completed from", () => {
  test("one provider is registered, for the language", () => {
    expect(registerCompletionItemProvider.mock.calls.map(([language]) => language)).toEqual([
      JXN_LANGUAGE_ID,
    ]);
  });

  test("are the bundled core where no project is open", () => {
    expect(labels("div .dir=")).toEqual(["ltr", "rtl", "auto"]);
    expect(labels('project "x"\nbuild ')).toContain("adapter=");
  });

  test("are the project's once they are applied, and the core again once reset", () => {
    const element = {
      properties: { dir: { enum: ["up", "down"] }, tagName: { type: "string" } },
    };
    const applied = applyProjectSchemas({
      document: { properties: { children: { items: element, type: "array" } } },
      project: { properties: { build: { properties: { target: {} } } } },
    });
    expect(applied).toBe(true);
    expect(labels("div .dir=")).toEqual(["up", "down"]);
    expect(labels('project "x"\nbuild ')).toEqual(["target="]);

    resetProjectSchemas();
    expect(labels("div .dir=")).toEqual(["ltr", "rtl", "auto"]);
  });

  test("keep the core for the half a project does not give", () => {
    applyProjectSchemas({ project: { properties: { build: { properties: { target: {} } } } } });
    expect(labels("div .dir=")).toEqual(["ltr", "rtl", "auto"]);
    expect(labels('project "x"\nbuild ')).toEqual(["target="]);
    resetProjectSchemas();
  });
});
