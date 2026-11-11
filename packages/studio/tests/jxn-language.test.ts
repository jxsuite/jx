/** The `.jxn` language definition, and Studio reading and writing one in its own process. */
import { describe, expect, test } from "bun:test";
import {
  formatByExtension,
  formatByName,
  formatForPath,
  formatParse,
  formatSerialize,
  getFormats,
  setFormats,
} from "../src/format/format-host";
import {
  JXN_LANGUAGE_CONFIGURATION,
  JXN_LANGUAGE_ID,
  JXN_MONARCH,
  registerJxnLanguage,
} from "../src/services/jxn-language";
import { monacoLangForPath } from "../src/services/model-uri";

describe("the language", () => {
  test("a .jxn path opens in it", () => {
    expect(monacoLangForPath("pages/a.jxn")).toBe(JXN_LANGUAGE_ID);
  });

  test("registering it gives Monaco all three parts", () => {
    const calls: string[] = [];
    registerJxnLanguage({
      register: ({ extensions, id }) => {
        calls.push(`${id} ${extensions?.join(",")}`);
      },
      setLanguageConfiguration: (id, configuration) => {
        expect(configuration).toBe(JXN_LANGUAGE_CONFIGURATION);
        calls.push(`configuration ${id}`);
        return { dispose: () => {} };
      },
      setMonarchTokensProvider: (id, grammar) => {
        expect(grammar).toBe(JXN_MONARCH);
        calls.push(`tokens ${id}`);
        return { dispose: () => {} };
      },
    });
    expect(calls).toEqual(["jxn .jxn", "configuration jxn", "tokens jxn"]);
  });

  test("a Monaco with no language API is left alone", () => {
    expect(() => registerJxnLanguage()).not.toThrow();
  });

  /** The first root rule whose pattern matches at the start of this text. */
  function firstRule(text: string): readonly unknown[] | undefined {
    const rules = JXN_MONARCH.tokenizer.root ?? [];
    return rules
      .filter((rule) => Array.isArray(rule))
      .find(([pattern]) => pattern instanceof RegExp && pattern.exec(text)?.index === 0);
  }

  test.each([
    ["a line comment", "// x", "comment"],
    ["a slashdash", "/- x", "comment"],
    ["a known annotation", "(ref)", "type"],
    ["a script's export", "(export)", "type"],
    ["a script's server export", "(server)", "type"],
    ["an unknown one", "(nope)", "invalid"],
    ["a keyword", "#true", "keyword"],
    ["a number", "12.5e3", "number"],
    ["a dollar name", "$id", "keyword"],
    ["a property name", "href=", "attribute.name"],
    ["a node name", "div", "identifier"],
  ])("%s", (_label, text, token) => {
    expect(firstRule(text)?.[1]).toBe(token);
  });

  test("it starts in the root state, not in whichever is listed first", () => {
    expect(JXN_MONARCH.start).toBe("root");
    expect(JXN_MONARCH.tokenizer.root).toBeDefined();
  });

  test("a multi-line raw string is TypeScript, and a quoted one is not", () => {
    const raw = firstRule('#"""')?.[1];
    expect(raw).toMatchObject({ nextEmbedded: "typescript" });
    expect(firstRule('"""')?.[1]).toBe("string");
  });
});

describe("the built-in format", () => {
  test("every lookup finds it, in any project", () => {
    setFormats([]);
    expect(formatForPath("pages/a.jxn")?.name).toBe("jxn");
    expect(formatByExtension("JXN")?.name).toBe("jxn");
    expect(formatByName("jxn")?.extensions).toEqual([".jxn"]);
  });

  test("it is not offered as something to choose", () => {
    setFormats([]);
    expect(getFormats()).toEqual([]);
  });

  test("it asks no backend to read or write", async () => {
    const document = await formatParse("jxn", 'p "hi"');
    expect(document).toEqual({ tagName: "p", textContent: "hi" });
    expect(await formatSerialize("jxn", document)).toEndWith("\np hi\n");
  });

  test("a save keeps the comments of what it read", async () => {
    const source = '// keep me\np "hi"\n';
    const document = await formatParse("jxn", source);
    document.textContent = "bye";
    expect(await formatSerialize("jxn", document, { source })).toBe("// keep me\np bye\n");
  });
});
