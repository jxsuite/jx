/** The `.jxn` language definition, and Studio reading and writing one in its own process. */
import { describe, expect, test } from "bun:test";
import { isString } from "@jxsuite/schema/guards";
import type { languages } from "monaco-editor/editor";
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

/** What a rule does where it matches: the token it gives, and the state it moves to. */
interface Step {
  next?: string;
  token: string;
}

/** The step an action takes, a `cases` action choosing by `$n==$S2` as Monarch does. */
function stepOf(
  action: languages.IMonarchLanguageAction | undefined,
  match: RegExpExecArray,
  state: string,
): Step {
  if (isString(action)) {
    return { token: action };
  }
  if (!action || Array.isArray(action)) {
    throw new Error("an action this reader of the grammar does not know");
  }
  if (!action.cases) {
    return { token: action.token ?? "", ...(action.next !== undefined && { next: action.next }) };
  }
  const [, argument] = state.split(".");
  const cases: [string, languages.IMonarchLanguageAction][] = Object.entries(action.cases);
  const chosen = cases.find(([guard]) => {
    const compared = /^\$(?<group>\d)==\$S2$/u.exec(guard);
    return guard === "@default" || (compared && match[Number(compared.groups?.group)] === argument);
  });
  return stepOf(chosen?.[1], match, state);
}

/**
 * The grammar run as Monarch runs it, as far as this grammar uses Monarch: the first rule of the
 * state that matches where the line stands, and a state named `name.argument` once `$n` is filled
 * in from the match. Stretches of one token are joined, and blank ones dropped.
 */
function painted(text: string): string[] {
  const stack = [JXN_MONARCH.start ?? ""];
  const pieces: [token: string, text: string][] = [];
  for (const line of text.split("\n")) {
    let rest = line;
    while (rest.length > 0) {
      const state = stack.at(-1) ?? "";
      const rules = JXN_MONARCH.tokenizer[state.split(".")[0] ?? ""] ?? [];
      let taken: [token: string, text: string] = [JXN_MONARCH.defaultToken ?? "", rest.slice(0, 1)];
      for (const rule of rules) {
        const [pattern, action, then] = Array.isArray(rule) ? rule : [];
        const match =
          pattern instanceof RegExp && new RegExp(`^(?:${pattern.source})`, "u").exec(rest);
        if (match) {
          const step = stepOf(action, match, state);
          const next = (step.next ?? (isString(then) ? then : "")).replaceAll(
            /\$(?<group>\d)/gu,
            (_all, group: string) => match[Number(group)] ?? "",
          );
          if (next === "@pop") {
            stack.pop();
          } else if (next !== "") {
            stack.push(next === "@push" ? state : next.slice(1));
          }
          taken = [step.token, match[0]];
          break;
        }
      }
      const last = pieces.at(-1);
      if (last?.[0] === taken[0]) {
        last[1] += taken[1];
      } else {
        pieces.push(taken);
      }
      rest = rest.slice(taken[1].length);
    }
    pieces.push(["", " "]);
  }
  return pieces.flatMap(([token, piece]) =>
    piece.trim() === "" ? [] : [`${token}:${piece.trim()}`],
  );
}

describe("a string in the language", () => {
  test("a raw one on a line ends where it closes, and what follows is not a string", () => {
    expect(painted('(fn)bump #"state.count += 1;"#\nh1 "Hello" .dir=ltr')).toEqual([
      "type:(fn)",
      "identifier:bump",
      'string:#"state.count += 1;"#',
      "identifier:h1",
      'string:"Hello"',
      "attribute.name:.dir",
      "delimiter:=",
      "identifier:ltr",
    ]);
  });

  test("one opened with more hashes is not ended by fewer", () => {
    expect(painted('p ##"say "#hi"## .dir=ltr')).toEqual([
      "identifier:p",
      'string:##"say "#hi"##',
      "attribute.name:.dir",
      "delimiter:=",
      "identifier:ltr",
    ]);
  });

  test("a raw one over lines ends at its own hashes too, however many", () => {
    expect(painted('script #"""\n  const a = "#";\n  """#\np')).toEqual([
      "identifier:script",
      'string.quote:#"""',
      ':const a = "#";',
      'string.quote:"""#',
      "identifier:p",
    ]);
    expect(painted('script ##"""\n  const a = """#;\n  """##\np')).toEqual([
      "identifier:script",
      'string.quote:##"""',
      ':const a = """#;',
      'string.quote:"""##',
      "identifier:p",
    ]);
  });

  test("a quoted one ends at its quote, an escaped quote aside", () => {
    expect(painted(String.raw`p "a \" b" c`)).toEqual([
      "identifier:p",
      'string:"a',
      String.raw`string.escape:\"`,
      'string:b"',
      "identifier:c",
    ]);
    expect(painted('p """\n  a "quoted" word\n  """\nq')).toEqual([
      "identifier:p",
      'string:"""',
      'string:a "quoted" word',
      'string:"""',
      "identifier:q",
    ]);
  });

  test("a comment in a comment ends with its own end", () => {
    expect(painted("/* a /* b */ c */ p")).toEqual(["comment:/* a /* b */ c */", "identifier:p"]);
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
