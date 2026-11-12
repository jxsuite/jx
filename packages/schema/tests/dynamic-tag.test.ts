import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  DYNAMIC_TAG_ROOTS,
  dynamicTagKind,
  dynamicTagLabel,
  dynamicTagLiteral,
  dynamicTagPath,
  humanizeIdentifier,
  parseDynamicTag,
  printDynamicTag,
  templateSegments,
} from "../src/dynamic-tag.ts";
import { isJsonObject, isString } from "../src/guards.ts";

import type {
  DynamicTag,
  DynamicTagLiteral,
  DynamicTagPipe,
  DynamicTagStep,
} from "../src/dynamic-tag.ts";
import type { JsonValue } from "../types.ts";

/** A parsed tag, for a test that has already said the expression is one. */
function parsed(expr: string): DynamicTag {
  const tag = parseDynamicTag(expr);
  if (tag === null) {
    throw new Error(`not a structured tag: ${expr}`);
  }
  return tag;
}

// ─── A seeded generator, so a failure names a tag that fails again ───────────

/** A Lehmer generator: small and deterministic, which is all a property test needs. */
function seeded(seed: number): () => number {
  let state = (seed % 2_147_483_646) + 1;
  return () => {
    state = (state * 48_271) % 2_147_483_647;
    return state / 2_147_483_647;
  };
}

const NAMES = ["entry", "data", "title", "$children", "_x", "featuredImage", "a1", "seo", "if"];
const FORMULAS = ["formatDate", "orBlank", "notEmpty", "$f", "truncate"];
const VALUES: JsonValue[] = [
  "",
  "a b",
  'say "hi"',
  "it's",
  String.raw`back\slash`,
  "line\nbreak",
  "}",
  "${x}",
  0,
  -1,
  1.5,
  1e21,
  true,
  false,
  null,
  [],
  {},
  [1, "two", [3]],
  { dateStyle: "long", nested: { a: [1, { b: "}" }] } },
];

/** A string literal as an author writes it in single quotes, with only JSON's escapes. */
function singleQuoted(value: string): DynamicTagLiteral {
  const body = JSON.stringify(value)
    .slice(1, -1)
    .replaceAll(String.raw`\"`, '"');
  return { raw: `'${body.replaceAll("'", String.raw`\'`)}'`, value };
}

function generator(seed: number) {
  const next = seeded(seed);
  const pick = <T>(list: readonly T[]): T => {
    const item = list[Math.floor(next() * list.length)];
    if (item === undefined) {
      throw new Error("empty list");
    }
    return item;
  };
  const literal = (): DynamicTagLiteral => {
    const value = pick(VALUES);
    return isString(value) && next() < 0.5 ? singleQuoted(value) : dynamicTagLiteral(value);
  };
  const key = (): DynamicTagLiteral =>
    next() < 0.3 ? dynamicTagLiteral(Math.floor(next() * 9)) : singleQuoted(pick(NAMES));
  const step = (): DynamicTagStep =>
    next() < 0.75
      ? { name: pick(NAMES), optional: next() < 0.3, type: "member" }
      : { key: key(), optional: next() < 0.3, type: "index" };
  const pipe = (depth: number): DynamicTagPipe => {
    if (depth > 0 && next() < 0.4) {
      return {
        args: Array.from({ length: Math.floor(next() * 3) }, literal),
        input: pipe(depth - 1),
        name: pick(FORMULAS),
        type: "call",
      };
    }
    return {
      root: pick(DYNAMIC_TAG_ROOTS),
      steps: Array.from({ length: Math.floor(next() * 5) }, step),
      type: "path",
    };
  };
  const tag = (): DynamicTag => {
    const base = { negations: pick([0, 0, 0, 1, 2] as const), pipe: pipe(2) };
    return next() < 0.5
      ? { ...base, fallback: { operator: pick(["??", "||"] as const), value: literal() } }
      : base;
  };
  return { next, tag };
}

/** The same expression with white space added in each place the grammar accepts it. */
function respaced(tag: DynamicTag, next: () => number): string {
  const gap = (): string => (next() < 0.5 ? "" : " \n\t".slice(0, 1 + Math.floor(next() * 3)));
  const pipe = (value: DynamicTagPipe): string => {
    if (value.type === "path") {
      return printDynamicTag({ negations: 0, pipe: value });
    }
    const args = value.args.map((arg) => `${gap()},${gap()}${arg.raw}`).join("");
    return `state.${value.name}(${gap()}${pipe(value.input)}${args}${gap()})`;
  };
  const fallback = tag.fallback
    ? `${gap()}${tag.fallback.operator}${gap()}${tag.fallback.value.raw}`
    : "";
  return `${gap()}${"!".repeat(tag.negations)}${pipe(tag.pipe)}${fallback}${gap()}`;
}

const SCOPE = ["state", "item", "index", "$map", "$page", "$site"];

describe("round trip", () => {
  test("print(parse(x)) is x for 2000 generated canonical tags", () => {
    const { tag } = generator(20_261_111);
    for (let i = 0; i < 2000; i += 1) {
      const made = tag();
      const text = printDynamicTag(made);
      const read = parseDynamicTag(text);
      expect(read).toEqual(made);
      expect(printDynamicTag(parsed(text))).toBe(text);
    }
  });

  test("every generated tag is a JavaScript expression", () => {
    const { tag } = generator(7);
    for (let i = 0; i < 500; i += 1) {
      const text = printDynamicTag(tag());
      expect(() => new Function(...SCOPE, `return (${text});`)).not.toThrow();
    }
  });

  test("white space where the grammar accepts it reads as the same tag, and prints canonically", () => {
    const { next, tag } = generator(42);
    for (let i = 0; i < 1000; i += 1) {
      const made = tag();
      const read = parseDynamicTag(respaced(made, next));
      expect(read).toEqual(made);
      const again = parsed(respaced(made, next));
      expect(printDynamicTag(again)).toBe(printDynamicTag(made));
    }
  });

  test("a literal keeps the text it was written as", () => {
    const text = `state.formatDate($map.item.data.date, { "dateStyle" : "long" }) ?? ''`;
    const tag = parsed(text);
    expect(printDynamicTag(tag)).toBe(text);
    expect(tag.fallback?.value).toEqual({ raw: "''", value: "" });
    expect(dynamicTagPath(tag).steps.length).toBe(3);
  });

  test("a literal's value is what JavaScript evaluates its text to", () => {
    for (const raw of [
      String.raw`'it\'s'`,
      String.raw`'a "b"'`,
      String.raw`'\\ \/ \n \t é \"'`,
      '"x"',
      "-0.5e2",
      '{"a":[1,null,true]}',
    ]) {
      const tag = parsed(`state.x ?? ${raw}`);
      /* SAFETY: each `raw` above is a literal, so evaluating it yields a JSON value. */
      const evaluated = new Function(`return (${raw});`)() as JsonValue;
      expect(tag.fallback?.value.value).toEqual(evaluated);
    }
  });
});

describe("the shapes it reads", () => {
  test("a bare root, and each kind of step", () => {
    expect(parsed("index")).toEqual({
      negations: 0,
      pipe: { root: "index", steps: [], type: "path" },
    });
    expect(parsed(`$map.item?.terms?.['post_tag'][0]`).pipe).toEqual({
      root: "$map",
      steps: [
        { name: "item", optional: false, type: "member" },
        { name: "terms", optional: true, type: "member" },
        { key: { raw: "'post_tag'", value: "post_tag" }, optional: true, type: "index" },
        { key: { raw: "0", value: 0 }, optional: false, type: "index" },
      ],
      type: "path",
    });
  });

  test("a formula over a formula, with arguments", () => {
    const tag = parsed(`!!state.orBlank(state.truncate(state.entry.data.title, 40)) || "Untitled"`);
    expect(tag.negations).toBe(2);
    expect(dynamicTagKind(tag)).toBe("format");
    expect(tag.pipe).toMatchObject({ args: [], name: "orBlank", type: "call" });
    expect(dynamicTagPath(tag).root).toBe("state");
    expect(tag.fallback).toEqual({
      operator: "||",
      value: { raw: '"Untitled"', value: "Untitled" },
    });
  });

  test("a state key that is not called is a path", () => {
    expect(dynamicTagKind(parsed("state.formatDate"))).toBe("field");
    expect(dynamicTagKind(parsed("!state.entry.draft"))).toBe("field");
  });
});

describe("everything else is custom", () => {
  const rejected = [
    "",
    "   ",
    // Lambdas, ternaries, arithmetic.
    "((v) => !!v)(state.x)",
    "(s => s)(state.entry.data.title)",
    "state.a ? state.b : ''",
    "state.count + 1",
    "(state.rows.length) > 0",
    "state.a === 1",
    "-state.count",
    // Parentheses, two fallbacks, a path as a fallback.
    "(state.a ?? '') || ''",
    "state.a || state.b || ''",
    "state.a ?? state.b",
    "state.a ?? ",
    "state.a ??",
    "state.a ? ? ''",
    "state.a | ''",
    "state.a ?? '' extra",
    // Calls on anything but `state.<name>`, and steps after a call.
    "item.format(1)",
    "$site.fn(state.x)",
    "String(state.x)",
    "state.items.map(x)",
    "state.fn(state.x).length",
    "state.fn(state.x)[0]",
    "state.fn()",
    "state.fn(1)",
    "state.fn('a')",
    "state.fn(state.x,)",
    "state.fn(state.x, state.y)",
    "state.fn(state.x, 1",
    "state.fn(state.x 1)",
    "state.fn (state.x)",
    // Roots the grammar does not name.
    "window.location",
    "stateful.x",
    "$maps.item",
    "entry.title",
    "42",
    "'text'",
    // Malformed paths, and white space where it is not accepted.
    "state.",
    "state?.",
    "state..x",
    "state.1x",
    "state . x",
    "state. x",
    "! state.x",
    "!!!state.x",
    "state[",
    "state[]",
    "state[0",
    "state[true]",
    "state[{}]",
    "state[state.i]",
    "state.é",
    // Literals JSON cannot spell.
    "state.x ?? undefined",
    "state.x ?? truely",
    "state.x ?? 01",
    "state.x ?? .5",
    "state.x ?? 'open",
    'state.x ?? "open',
    String.raw`state.x ?? '\x41'`,
    String.raw`state.x ?? '\0'`,
    "state.x ?? 'a\nb'",
    "state.x ?? {a: 1}",
    "state.x ?? {'a': 1}",
    "state.x ?? [1,",
    'state.x ?? ["open',
    "state.x ?? [1, 2,]",
    "state.x ?? `t`",
    "state.fn(state.x, () => 1)",
    // JSON that JavaScript reads differently: `__proto__` in an object literal sets the prototype
    // (and is a SyntaxError written twice), and a number past the range is `Infinity`.
    'state.x ?? {"__proto__":null}',
    'state.fn(state.x, {"a":[{"__proto__":{"b":1}}]})',
    'state.fn(state.x, {"__proto__":1,"__proto__":2})',
    "state.x ?? 1e999",
    "state.fn(state.x, [-1e999])",
    // A comment, and a literal that goes on after it ends.
    "state.x /* why */",
    "state.x // why",
    'state.x ?? "a".length',
    "state.x ?? [1][0]",
    "state.x ?? - 1",
  ];

  for (const expr of rejected) {
    test(JSON.stringify(expr), () => {
      expect(parseDynamicTag(expr)).toBeNull();
    });
  }
});

describe("a literal that only looks like more of the tag", () => {
  /** A formula that hands back what it was called with, so the arguments it received show. */
  const scope = { fn: (...received: JsonValue[]): JsonValue => received, x: null };

  /** What JavaScript makes of the expression, with `state` bound to the sample scope. */
  function evaluate(expr: string): JsonValue {
    /* SAFETY: `new Function` returns a function of the one named parameter, and every expression
       here yields a literal or what `fn` returned, which is JSON. */
    const run = new Function("state", `return (${expr});`) as (state: typeof scope) => JsonValue;
    return run(scope);
  }

  const cases: [expr: string, args: JsonValue[], fallback: JsonValue | undefined][] = [
    ["state.fn(state.x, 'a)b')", ["a)b"], undefined],
    ["state.fn(state.x, 'a ?? b', \"c || d\") ?? ')'", ["a ?? b", "c || d"], ")"],
    [String.raw`state.fn(state.x, 'it\'s, (so)')`, ["it's, (so)"], undefined],
    ['state.fn(state.x, {"a":"}) ?? 1"}, ["]"])', [{ a: "}) ?? 1" }, ["]"]], undefined],
    ["state.x ?? '${state.y}'", [], "${state.y}"],
    ["state.x || -0.5e-2", [], -0.005],
  ];

  for (const [expr, args, fallback] of cases) {
    test(expr, () => {
      const tag = parseDynamicTag(expr);
      expect(tag).not.toBeNull();
      expect(printDynamicTag(tag!)).toBe(expr);
      const { pipe } = tag!;
      expect(pipe.type === "call" ? pipe.args.map((arg) => arg.value) : []).toEqual(args);
      expect(tag!.fallback?.value.value).toEqual(fallback);
      // The model's reading is JavaScript's: the call receives these arguments and no others.
      const expected: JsonValue = pipe.type === "call" ? [null, ...args] : (fallback ?? null);
      expect(evaluate(expr)).toEqual(expected);
    });
  }
});

describe("labels", () => {
  const labels: [string, string][] = [
    ["$map.item.data.date", "Date"],
    ['state.formatDate($map.item.data.date, {"dateStyle":"long"}) ?? \'\'', "Date"],
    ["state.entry.data.featuredImage?.alt ?? ''", "Alt"],
    ["state.entry.data", "Entry"],
    ["state.author.data?.first_name", "First name"],
    ["state.entry.data.terms?.['post-tag']", "Post tag"],
    ["state.entry.$children", "Children"],
    ["state.rows[0]", "Rows"],
    ["state.rows[0].authorUrl", "Author url"],
    ["$map.item", "Item"],
    ["$map", "Item"],
    ["item", "Item"],
    ["index", "Index"],
    ["state", "State"],
    ["state['data'][0]", "State"],
    ["state['$']", "State"],
    ["$page.locale", "Locale"],
    ["$site.name", "Name"],
    ["$page", "Page"],
    ["$site", "Site"],
  ];

  for (const [expr, label] of labels) {
    test(`${expr} is "${label}"`, () => {
      expect(dynamicTagLabel(parsed(expr))).toBe(label);
    });
  }

  test("a name becomes words", () => {
    expect(humanizeIdentifier("featuredImage")).toBe("Featured image");
    expect(humanizeIdentifier("featured_image")).toBe("Featured image");
    expect(humanizeIdentifier("seoURL")).toBe("Seo URL");
    expect(humanizeIdentifier("HTMLTitle2x")).toBe("HTML title2x");
    expect(humanizeIdentifier("__")).toBe("");
  });
});

describe("templateSegments", () => {
  test("literal text, a tag and a custom expression, in order and covering the template", () => {
    const template = "By ${state.entry.data.author ?? ''} on ${(d => d)(state.entry.data.date)}.";
    const segments = templateSegments(template);
    expect(segments.map((segment) => segment.type)).toEqual([
      "literal",
      "tag",
      "literal",
      "custom",
      "literal",
    ]);
    expect(
      segments
        .map((segment) => (segment.type === "literal" ? segment.text : segment.source))
        .join(""),
    ).toBe(template);
    expect(segments[1]).toMatchObject({
      end: 35,
      expr: "state.entry.data.author ?? ''",
      source: "${state.entry.data.author ?? ''}",
      start: 3,
    });
    expect(segments[3]).toMatchObject({ expr: "(d => d)(state.entry.data.date)", type: "custom" });
  });

  test("a template that is one tag has one segment, and text with none has one literal", () => {
    expect(templateSegments("${index}").map((segment) => segment.type)).toEqual(["tag"]);
    expect(templateSegments("plain")).toEqual([
      { end: 5, start: 0, text: "plain", type: "literal" },
    ]);
    expect(templateSegments("")).toEqual([]);
  });

  test("a brace inside a literal argument does not end the tag", () => {
    const [only] = templateSegments('${state.f(state.x, {"a":"}"})}');
    expect(only?.type).toBe("tag");
  });

  test("a padded tag is a tag whose source is kept, though printing would respace it", () => {
    const [only] = templateSegments("${ state.x  ??  '' }");
    if (only?.type !== "tag") {
      throw new Error("expected a tag");
    }
    expect(only.source).toBe("${ state.x  ??  '' }");
    expect(printDynamicTag(only.tag)).toBe("state.x ?? ''");
  });
});

// ─── The bindings of a real site ─────────────────────────────────────────────

/** The converted Anabaptist Perspectives site, checked out beside this repository when present. */
const CORPUS = resolve(import.meta.dir, "../../../../site-anabaptistperspectives-jx");

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Every string in a JSON value, at any depth. */
function strings(value: JsonValue, out: string[] = []): string[] {
  if (isString(value)) {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      strings(item, out);
    }
  } else if (isJsonObject(value)) {
    for (const item of Object.values(value)) {
      strings(item, out);
    }
  }
  return out;
}

describe("a real site's bindings", () => {
  const files = [...jsonFiles(join(CORPUS, "pages")), ...jsonFiles(join(CORPUS, "layouts"))];

  // The site is not part of this repository, so a checkout without it has nothing to measure.
  test.skipIf(files.length === 0)("a measured share parse, and each one round-trips", () => {
    let bindings = 0;
    let tags = 0;
    for (const file of files) {
      /* SAFETY: `JSON.parse` returns only what JSON can spell, which is `JsonValue`. */
      const doc = JSON.parse(readFileSync(file, "utf8")) as JsonValue;
      for (const text of strings(doc)) {
        for (const segment of templateSegments(text)) {
          if (segment.type !== "literal") {
            bindings += 1;
          }
          if (segment.type === "tag") {
            tags += 1;
            // Byte for byte: what the converter wrote is what an unedited tag prints as.
            expect(printDynamicTag(segment.tag)).toBe(segment.expr);
          }
        }
      }
    }
    console.log(`dynamic-tag corpus: ${tags} of ${bindings} bindings are structured tags`);
    // Measured at 105 of 240 (the rest are lambdas, ternaries and `||` chains, custom by design).
    expect(bindings).toBeGreaterThanOrEqual(200);
    expect(tags).toBeGreaterThanOrEqual(100);
  });
});
