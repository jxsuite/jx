/**
 * Content-rules tests: the `exclude` globs and the `where` filter (src/content-rules.ts).
 *
 * Both grammars are closed on purpose, so most of what is asserted here is what they REFUSE: an
 * unknown operator or a negated glob is an error naming the key, never a filter that quietly
 * matches nothing.
 */

import { describe, expect, it } from "bun:test";
import {
  compileExclude,
  compileWhere,
  expandBraces,
  globToRegExp,
  readField,
} from "../src/content-rules.ts";

describe("expandBraces", () => {
  it("expands alternatives and leaves a plain pattern alone", () => {
    expect(expandBraces("a/{x,y}.md")).toEqual(["a/x.md", "a/y.md"]);
    expect(expandBraces("plain/*.md")).toEqual(["plain/*.md"]);
  });

  it("expands several groups and nested groups", () => {
    expect(expandBraces("{a,b}/{c,d}")).toEqual(["a/c", "a/d", "b/c", "b/d"]);
    expect(expandBraces("{a,{b,c}}")).toEqual(["a", "b", "c"]);
  });

  it("keeps a group with no comma literal, and honors an escaped brace", () => {
    expect(expandBraces("{a}")).toEqual(["{a}"]);
    expect(expandBraces("{}")).toEqual(["{}"]);
    expect(expandBraces(String.raw`\{a,b}`)).toEqual([String.raw`\{a,b}`]);
  });

  it("leaves an unclosed group alone", () => {
    expect(expandBraces("{a,b")).toEqual(["{a,b"]);
  });
});

describe("globToRegExp", () => {
  const hit = (pattern: string, path: string) => globToRegExp(pattern).test(path);

  it("matches a literal path exactly, anchored at the source root", () => {
    expect(hit("STYLE.md", "STYLE.md")).toBe(true);
    expect(hit("STYLE.md", "docs/STYLE.md")).toBe(false);
    expect(hit("STYLE.md", "STYLE.mdx")).toBe(false);
    expect(hit("./STYLE.md", "STYLE.md")).toBe(true);
    expect(hit("/STYLE.md", "STYLE.md")).toBe(true);
  });

  it("* and ? stop at a slash", () => {
    expect(hit("*.md", "a.md")).toBe(true);
    expect(hit("*.md", "dir/a.md")).toBe(false);
    expect(hit("a?.md", "ab.md")).toBe(true);
    expect(hit("a?.md", "a/.md")).toBe(false);
    expect(hit("a**b.md", "axxb.md")).toBe(true);
  });

  it("** as a segment crosses directories, including none", () => {
    expect(hit("**/*.md", "a.md")).toBe(true);
    expect(hit("**/*.md", "a/b/c.md")).toBe(true);
    expect(hit("a/**/c.md", "a/c.md")).toBe(true);
    expect(hit("a/**/c.md", "a/x/y/c.md")).toBe(true);
    expect(hit("a/**/c.md", "b/c.md")).toBe(false);
  });

  it("a trailing /** and a trailing slash both mean everything below", () => {
    for (const pattern of ["internal/**", "internal/"]) {
      expect(hit(pattern, "internal/a.md")).toBe(true);
      expect(hit(pattern, "internal/deep/a.md")).toBe(true);
      expect(hit(pattern, "internal.md")).toBe(false);
      expect(hit(pattern, "other/internal/a.md")).toBe(false);
    }
    expect(hit("**", "any/thing.md")).toBe(true);
  });

  it("treats dotfiles and dot directories as ordinary files", () => {
    expect(hit("**/*.md", ".obsidian/notes.md")).toBe(true);
    expect(hit(".*/**", ".obsidian/notes.md")).toBe(true);
    expect(hit(".*/**", "docs/.hidden/notes.md")).toBe(false);
    expect(hit("**/.*/**", "docs/.hidden/notes.md")).toBe(true);
  });

  it("supports character classes, negation and escapes", () => {
    expect(hit("[ab].md", "a.md")).toBe(true);
    expect(hit("[ab].md", "c.md")).toBe(false);
    expect(hit("[a-c].md", "b.md")).toBe(true);
    expect(hit("[!a].md", "b.md")).toBe(true);
    expect(hit("[!a].md", "a.md")).toBe(false);
    expect(hit("[^a].md", "a.md")).toBe(false);
    expect(hit(String.raw`a\*.md`, "a*.md")).toBe(true);
    expect(hit(String.raw`a\*.md`, "ab.md")).toBe(false);
    expect(hit("a[.md", "a[.md")).toBe(true);
  });

  it("escapes regular-expression syntax in literals", () => {
    expect(hit("a+b(c).md", "a+b(c).md")).toBe(true);
    expect(hit("a+b(c).md", "aab(c).md")).toBe(false);
    expect(hit("Git & Dev Tools/**", "Git & Dev Tools/x.md")).toBe(true);
  });
});

describe("compileExclude", () => {
  it("is empty and inert with no patterns", () => {
    const m = compileExclude();
    expect(m.empty).toBe(true);
    expect(m.excludedBy("a.md")).toBeUndefined();
    expect(m.excludesDir("a")).toBe(false);
    expect(compileExclude([]).empty).toBe(true);
  });

  it("names the pattern that matched, expanding braces", () => {
    const m = compileExclude(["internal/**", "{STYLE,README}.md"]);
    expect(m.empty).toBe(false);
    expect(m.excludedBy("internal/Company/x.md")).toBe("internal/**");
    expect(m.excludedBy("STYLE.md")).toBe("{STYLE,README}.md");
    expect(m.excludedBy("README.md")).toBe("{STYLE,README}.md");
    expect(m.excludedBy("Frappe/README.md")).toBeUndefined();
  });

  it("answers whether a whole directory is excluded, so a walk can skip it", () => {
    const m = compileExclude(["internal/**", "**/node_modules/**", ".*/**", "Sites/*/dist/"]);
    expect(m.excludesDir("internal")).toBe(true);
    expect(m.excludesDir("internal/Clients")).toBe(false);
    expect(m.excludesDir("Sites/avunu.net/node_modules")).toBe(true);
    expect(m.excludesDir(".obsidian")).toBe(true);
    expect(m.excludesDir("Sites/avunu.net/dist")).toBe(true);
    expect(m.excludesDir("Frappe")).toBe(false);
    // A file-only pattern never prunes a directory.
    expect(compileExclude(["STYLE.md"]).excludesDir("STYLE.md")).toBe(false);
  });

  it("a bare ** excludes everything", () => {
    const m = compileExclude(["**"]);
    expect(m.excludesDir("anything")).toBe(true);
    expect(m.excludedBy("a/b.md")).toBe("**");
  });

  it("refuses a malformed list with a message naming the problem", () => {
    expect(() => compileExclude("internal/**" as unknown as string[])).toThrow(/array of glob/);
    expect(() => compileExclude([""])).toThrow(/non-empty strings/);
    expect(() => compileExclude([42 as unknown as string])).toThrow(/non-empty strings/);
    expect(() => compileExclude(["!keep.md"])).toThrow(/negated patterns are not supported/);
  });
});

describe("readField", () => {
  const data = { a: { b: { c: 1 } }, "dotted.key": "literal", list: [1] };

  it("reads a literal key, then a dotted path", () => {
    expect(readField(data, "dotted.key")).toBe("literal");
    expect(readField(data, "a.b.c")).toBe(1);
    expect(readField(data, "a.x.c")).toBeUndefined();
    expect(readField(data, "missing")).toBeUndefined();
    expect(readField(data, "list.0")).toBeUndefined();
  });
});

describe("compileWhere", () => {
  const publishable = compileWhere({ publish: true, status: { $ne: "draft" } });

  it("keeps everything when there is no filter", () => {
    const keep = compileWhere();
    expect(keep({})).toBe(true);
    expect(keep.why({})).toBeUndefined();
  });

  it("ANDs keys: publish true and status not draft", () => {
    expect(publishable({ publish: true, status: "review" })).toBe(true);
    expect(publishable({ publish: true })).toBe(true);
    expect(publishable({ publish: true, status: "draft" })).toBe(false);
    expect(publishable({ publish: false, status: "review" })).toBe(false);
    expect(publishable({ status: "review" })).toBe(false);
    expect(publishable({})).toBe(false);
  });

  it("names the first failing field", () => {
    expect(publishable.why({ publish: true, status: "draft" })).toBe("status");
    expect(publishable.why({ publish: false, status: "draft" })).toBe("publish");
    expect(publishable.why({ publish: true, status: "review" })).toBeUndefined();
  });

  it("equality is strict: a string is not a boolean", () => {
    expect(publishable({ publish: "true", status: "review" })).toBe(false);
    expect(compileWhere({ n: 1 })({ n: "1" })).toBe(false);
    expect(compileWhere({ n: 1 })({ n: 1 })).toBe(true);
    expect(compileWhere({ n: null })({ n: null })).toBe(true);
  });

  it("a scalar matches an array field that contains it", () => {
    const tagged = compileWhere({ tags: "frappe" });
    expect(tagged({ tags: ["frappe", "bench"] })).toBe(true);
    expect(tagged({ tags: ["wordpress"] })).toBe(false);
    expect(tagged({ tags: "frappe" })).toBe(true);
    expect(tagged({})).toBe(false);
  });

  it("an array or object operand compares as a whole value", () => {
    expect(compileWhere({ tags: ["a", "b"] })({ tags: ["a", "b"] })).toBe(true);
    expect(compileWhere({ tags: ["a", "b"] })({ tags: ["b", "a"] })).toBe(false);
    expect(compileWhere({ tags: ["a"] })({ tags: ["a", "b"] })).toBe(false);
    expect(compileWhere({ meta: { x: 1 } })({ meta: { x: 1 } })).toBe(true);
    expect(compileWhere({ meta: { x: 1 } })({ meta: { x: 2 } })).toBe(false);
    expect(compileWhere({ meta: { x: 1 } })({ meta: { x: 1, y: 2 } })).toBe(false);
    expect(compileWhere({ meta: { x: 1 } })({ meta: [1] })).toBe(false);
  });

  it("$eq and $ne", () => {
    expect(compileWhere({ k: { $eq: "a" } })({ k: "a" })).toBe(true);
    expect(compileWhere({ k: { $eq: "a" } })({ k: "b" })).toBe(false);
    expect(compileWhere({ k: { $ne: "a" } })({ k: "b" })).toBe(true);
    expect(compileWhere({ k: { $ne: "a" } })({})).toBe(true);
    expect(compileWhere({ k: { $ne: "a" } })({ k: "a" })).toBe(false);
  });

  it("$in and $nin, including against an array field", () => {
    const inSet = compileWhere({ status: { $in: ["review", "published"] } });
    expect(inSet({ status: "review" })).toBe(true);
    expect(inSet({ status: "draft" })).toBe(false);
    expect(inSet({})).toBe(false);
    const outSet = compileWhere({ status: { $nin: ["draft"] } });
    expect(outSet({ status: "review" })).toBe(true);
    expect(outSet({ status: "draft" })).toBe(false);
    expect(outSet({})).toBe(true);
    expect(compileWhere({ tags: { $in: ["a"] } })({ tags: ["a", "b"] })).toBe(true);
    expect(compileWhere({ tags: { $in: ["z"] } })({ tags: ["a", "b"] })).toBe(false);
  });

  it("$exists treats null as absent", () => {
    const has = compileWhere({ title: { $exists: true } });
    expect(has({ title: "x" })).toBe(true);
    expect(has({ title: "" })).toBe(true);
    expect(has({ title: null })).toBe(false);
    expect(has({})).toBe(false);
    const lacks = compileWhere({ internal: { $exists: false } });
    expect(lacks({})).toBe(true);
    expect(lacks({ internal: true })).toBe(false);
  });

  it("orders strings, numbers and dates, and refuses to order mixed kinds", () => {
    expect(compileWhere({ n: { $gt: 1 } })({ n: 2 })).toBe(true);
    expect(compileWhere({ n: { $gt: 1 } })({ n: 1 })).toBe(false);
    expect(compileWhere({ n: { $gte: 1 } })({ n: 1 })).toBe(true);
    expect(compileWhere({ n: { $lt: 1 } })({ n: 0 })).toBe(true);
    expect(compileWhere({ n: { $lte: 1 } })({ n: 2 })).toBe(false);
    expect(compileWhere({ s: { $lt: "b" } })({ s: "a" })).toBe(true);
    expect(compileWhere({ s: { $gt: "b" } })({ s: "a" })).toBe(false);
    expect(compileWhere({ s: { $gte: "b" } })({ s: "b" })).toBe(true);
    expect(compileWhere({ n: { $gt: 1 } })({ n: "2" })).toBe(false);
    expect(compileWhere({ n: { $gt: 1 } })({})).toBe(false);
  });

  it("reads a YAML date as RFC 3339 text", () => {
    const midnight = new Date("2025-03-04T00:00:00Z");
    const instant = new Date("2025-03-04T10:30:15.250Z");
    expect(compileWhere({ d: "2025-03-04" })({ d: midnight })).toBe(true);
    expect(compileWhere({ d: { $lte: "2025-03-04" } })({ d: midnight })).toBe(true);
    expect(compileWhere({ d: { $gt: "2025-03-04" } })({ d: instant })).toBe(true);
    expect(compileWhere({ d: "2025-03-04T10:30:15Z" })({ d: instant })).toBe(true);
    expect(compileWhere({ d: { $gt: "2025-01-01" } })({ d: new Date("nope") })).toBe(false);
    expect(compileWhere({ d: ["2025-03-04"] })({ d: [midnight] })).toBe(true);
  });

  it("combines operators on one field with AND", () => {
    const window = compileWhere({ n: { $gte: 1, $lt: 5 } });
    expect(window({ n: 3 })).toBe(true);
    expect(window({ n: 5 })).toBe(false);
    expect(window({ n: 0 })).toBe(false);
  });

  it("reaches into nested data with a dotted key", () => {
    const nested = compileWhere({ "meta.public": true });
    expect(nested({ meta: { public: true } })).toBe(true);
    expect(nested({ meta: { public: false } })).toBe(false);
    expect(nested({ meta: "x" })).toBe(false);
  });

  it("an object with no operators is a literal value", () => {
    expect(compileWhere({ meta: { a: 1, b: 2 } })({ meta: { a: 1, b: 2 } })).toBe(true);
  });

  it("refuses what it cannot run, naming the key", () => {
    expect(() => compileWhere("publish" as unknown)).toThrow(/must be an object/);
    expect(() => compileWhere([] as unknown)).toThrow(/must be an object/);
    expect(() => compileWhere({ $or: [] })).toThrow(/top-level operators are not supported/);
    expect(() => compileWhere({ k: { $regex: "x" } })).toThrow(
      /where\.k: unknown operator "\$regex"/,
    );
    expect(() => compileWhere({ k: { $in: "a" } })).toThrow(/where\.k\.\$in: expected an array/);
    expect(() => compileWhere({ k: { $nin: 1 } })).toThrow(/where\.k\.\$nin: expected an array/);
    expect(() => compileWhere({ k: { $exists: "yes" } })).toThrow(
      /\$exists: expected true or false/,
    );
    expect(() => compileWhere({ k: { $gt: true } })).toThrow(/\$gt: expected a string or number/);
    expect(() => compileWhere({ k: { $eq: 1, plain: 2 } })).toThrow(/cannot mix \$operators/);
  });
});
