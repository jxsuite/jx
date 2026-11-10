/**
 * The generator against a real compiler (`spec.md` §23.3): every function body in the repository's
 * pages, layouts and components is wrapped and checked by `tsc`, so a change to what `State` says
 * that makes a working body fail shows up here, and a seeded mistake is found at its own position.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isJsonObject, isString } from "../src/guards.ts";
import { parseJxn } from "../src/jxn/index.ts";
import { bodyOffsetOf, generateBodyTypes } from "../src/jxn/virtual-types.ts";
import type { VirtualBody, VirtualTarget } from "../src/jxn/virtual-types.ts";
import type { JsonValue, JxElement } from "../types";

const ROOT = resolve(import.meta.dir, "../../..");
const TSC = join(ROOT, "node_modules/.bin/tsc");

/** What the checker is told, which is what Studio's worker is told. */
const COMPILER_OPTIONS = {
  lib: ["esnext", "dom", "dom.iterable"],
  module: "esnext",
  moduleResolution: "bundler",
  noEmit: true,
  noImplicitAny: false,
  skipLibCheck: true,
  strict: true,
  target: "esnext",
  types: [],
};

/** One body found in a document, and the file written for it. */
interface Found {
  file: string;
  label: string;
  unit: VirtualBody;
  name: string;
}

const scratch = mkdtempSync(join(tmpdir(), "jx-virtual-types-"));
afterAll(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/** The documents whose bodies run, as JSON values. */
function documents(): { doc: JxElement; file: string }[] {
  const files = execFileSync("git", ["ls-files", "*.json", "*.jxn"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => /(?:^|\/)(?:pages|layouts|components)\//u.test(file))
    .filter((file) => !/\.(?:class|schema)\.(?:json|jxn)$/u.test(file));
  return files.flatMap((file) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    // SAFETY: JSON.parse without a reviver only ever yields a JSON value.
    const parsed = file.endsWith(".jxn") ? parseJxn(text) : (JSON.parse(text) as JsonValue);
    // SAFETY: a document is an object; an element is what its members describe.
    return isJsonObject(parsed) ? [{ doc: parsed as JxElement, file }] : [];
  });
}

/** Every string body in a document: root `state` functions and inline `on*` handlers. */
function bodiesIn(doc: JxElement): { body: string; label: string; target: VirtualTarget }[] {
  const found: { body: string; label: string; target: VirtualTarget }[] = [];
  const walk = (node: JsonValue | undefined, path: (string | number)[]): void => {
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        walk(item, [...path, index]);
      }
      return;
    }
    if (!isJsonObject(node)) {
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "state") {
        if (path.length === 0 && isJsonObject(value)) {
          for (const [name, entry] of Object.entries(value)) {
            if (isJsonObject(entry) && entry.$prototype === "Function" && isString(entry.body)) {
              found.push({
                body: entry.body,
                label: `state.${name}`,
                target: { key: name, kind: "state" },
              });
            }
          }
        }
        continue;
      }
      if (
        /^on[a-z]+$/u.test(key) &&
        isJsonObject(value) &&
        value.$prototype === "Function" &&
        isString(value.body)
      ) {
        found.push({
          body: value.body,
          label: `${path.join("/")}.${key}`,
          target: { eventKey: key, kind: "event", path },
        });
      }
      walk(value, [...path, key]);
    }
  };
  // SAFETY: a document is JSON data; its types name what it holds.
  walk(doc as JsonValue, []);
  return found;
}

/** Run `tsc` over the generated files and read its `name(line,col): error TSxxxx: message` lines. */
function check(): { code: number; column: number; line: number; message: string; name: string }[] {
  writeFileSync(
    join(scratch, "tsconfig.json"),
    JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ["*.ts"] }),
  );
  const run = spawnSync(TSC, ["-p", scratch], { encoding: "utf8" });
  return run.stdout.split("\n").flatMap((text) => {
    const match =
      /^(?:.*\/)?(?<name>[\w-]+\.ts)\((?<line>\d+),(?<column>\d+)\): error TS(?<code>\d+): (?<message>.*)$/u.exec(
        text,
      );
    const groups = match?.groups;
    return groups
      ? [
          {
            code: Number(groups.code),
            column: Number(groups.column),
            line: Number(groups.line),
            message: groups.message ?? "",
            name: groups.name ?? "",
          },
        ]
      : [];
  });
}

describe("the repository's own bodies", () => {
  const found: Found[] = [];
  for (const { doc, file } of documents()) {
    for (const { body, label, target } of bodiesIn(doc)) {
      const name = `body-${found.length}.ts`;
      const unit = generateBodyTypes(doc, target, body);
      writeFileSync(join(scratch, name), unit.text);
      found.push({ file, label, name, unit });
    }
  }

  test("are found in numbers that cannot pass by finding nothing", () => {
    expect(found.length).toBeGreaterThan(30);
  });

  test("check clean, but for what TypeScript objects to in JavaScript idioms", () => {
    const errors = check().filter((error) => error.name.startsWith("body-"));
    const where = (error: { name: string }): string => {
      const body = found.find((f) => f.name === error.name);
      return body ? `${body.file} ${body.label}` : error.name;
    };
    /* Real complaints about working code, not gaps in what `State` says: an expando on `document`,
       and an event target read as an element. Annotating them is the author's to do. */
    expect([...new Set(errors.map((error) => where(error)))].toSorted()).toEqual([
      "sites/jxsuite.com/components/site-search.json state.onMount",
      "sites/jxsuite.com/components/theme-toggle.json state.onMount",
    ]);
    expect(errors.every((error) => error.code === 2339)).toBe(true);
  });
});

describe("a seeded mistake", () => {
  test("is found at its own line and column in the body", () => {
    const body = "const n = 1;\nstate.nope = n;";
    const unit = generateBodyTypes(
      // SAFETY: a document literal with one state entry.
      { state: { a: 1 } } as JxElement,
      { key: "a", kind: "state" },
      body,
    );
    writeFileSync(join(scratch, "seeded.ts"), unit.text);
    const error = check().find((e) => e.name === "seeded.ts");
    expect(error?.code).toBe(2339);
    expect(error?.message).toBe("Property 'nope' does not exist on type 'State'.");
    // The body begins on the line after the wrapper's head, and the mistake is its second line.
    const firstBodyLine = unit.text.slice(0, unit.bodyStart).split("\n").length;
    expect(error?.line).toBe(firstBodyLine + 1);
    // `state.` is six characters, so the property starts at column 7 of the body's own line.
    expect(error?.column).toBe(7);
    expect(bodyOffsetOf(unit, unit.bodyStart + body.length - 1)).toBe(body.length - 1);
  });
});
