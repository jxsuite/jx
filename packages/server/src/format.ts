/**
 * `jx format`: format the code a `.jxn` file holds, and the file around it (compiler.md §2.3).
 *
 * The code is what `oxfmt` cannot reach, because it is a string in a file `oxfmt` does not read:
 * every `Function` entry's body and both of a document's scripts. The file around it is the
 * writer's to lay out. A file with no comment is written whole, in the one form the writer has. A
 * file with a comment is merged the way a save from Studio is (spec.md §22.4), so that only what
 * the formatter changed is rewritten and no comment is lost.
 *
 * This runs under Bun for the same reason `jx convert` does, so `@jxsuite/compiler`'s CLI resolves
 * it from the project and spawns it.
 *
 * @docs framework/build/cli
 * @docs framework/concepts/jxn-files
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { isFunctionEntry, isJsonObject, isString } from "@jxsuite/schema/guards";
import {
  classifyJxn,
  countJxnComments,
  isJxnPath,
  parseJxn,
  parseProject,
  serializeJxn,
  serializeProject,
} from "@jxsuite/schema/jxn";
import { errorMessage } from "@jxsuite/schema/parse";
import type { JsonObject, JsonValue, JxDocument, ProjectConfig } from "@jxsuite/schema/types";
import { formatBody, formatScript } from "./code-format.ts";
import type { FormattedCode } from "./code-format.ts";

/** Code in a file that could not be formatted. */
export interface FormatProblem {
  /** Why not, as the formatter says it. */
  message: string;
  /** The JSON Pointer of the string that holds the code. */
  pointer: string;
}

/** One `.jxn` file's text, formatted. */
export interface FormattedJxn {
  /** The code left as written, each with why. */
  problems: FormatProblem[];
  text: string;
}

/** What formats one piece of code. */
type CodeFormatter = (code: string) => Promise<FormattedCode>;

/** The folders under a named one that hold nothing an author wrote. */
const SKIPPED = new Set(["dist", "node_modules"]);

/** A JSON Pointer one step down. */
function pointerInto(pointer: string, key: string | number): string {
  return `${pointer}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

/**
 * What formats the string a member holds, or null where it is not code: a `Function` entry's body,
 * wherever the entry sits, and each side of the document's `$script`. Any other `body` may be data
 * (a `Request`'s payload), and a template is left to its author.
 */
function formatterOf(owner: JsonObject, pointer: string, key: string): CodeFormatter | null {
  if (key === "body") {
    return isFunctionEntry(owner) ? formatBody : null;
  }
  return pointer === "/$script" && (key === "client" || key === "server") ? formatScript : null;
}

/** Copy a tree, formatting the code in it. */
async function walk(
  value: JsonValue,
  pointer: string,
  problems: FormatProblem[],
): Promise<JsonValue> {
  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const [index, item] of value.entries()) {
      items.push(await walk(item, pointerInto(pointer, index), problems));
    }
    return items;
  }
  if (!isJsonObject(value)) {
    return value;
  }
  const entries: [string, JsonValue][] = [];
  for (const [key, child] of Object.entries(value)) {
    const at = pointerInto(pointer, key);
    const formatter = formatterOf(value, pointer, key);
    // Nothing but white space is no code, and is left as the nothing its author wrote.
    if (formatter === null || !isString(child) || child.trim() === "") {
      entries.push([key, await walk(child, at, problems)]);
    } else {
      const { code, errors } = await formatter(child);
      problems.push(...errors.map((message) => ({ message, pointer: at })));
      entries.push([key, code]);
    }
  }
  // Built from entries: assigning `__proto__` would set the copy's prototype.
  return Object.fromEntries(entries);
}

/**
 * Format one `.jxn` file's text: a document or a project file.
 *
 * @param text The file.
 * @returns The file formatted, and the code in it that was left as written.
 * @throws {JxnError} When the file cannot be read, or holds what Jx Notation cannot spell.
 */
export async function formatJxn(text: string): Promise<FormattedJxn> {
  const problems: FormatProblem[] = [];
  const isProject = classifyJxn(text) === "project";
  const read: unknown = isProject ? parseProject(text) : parseJxn(text);
  const formatted = await walk(isJsonObject(read) ? read : {}, "", problems);
  // Merged into the file it replaces only where there is a comment to lose (spec.md §22.4).
  const previous = countJxnComments(text) > 0 ? text : undefined;
  /* SAFETY: `walk` copies what was read member for member, and puts a string where a string was, so
     the copy is whatever the file it came from was. */
  const written = isProject
    ? serializeProject(formatted as ProjectConfig, previous)
    : serializeJxn(formatted as JxDocument, previous);
  return { problems, text: written };
}

/** Every `.jxn` file a path names: itself, or what is under it. */
function expand(path: string): string[] {
  // A path that is not there comes through as itself, so the report can say so.
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return [path];
  }
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      return entry.name.startsWith(".") || SKIPPED.has(entry.name) ? [] : expand(child);
    }
    return isJxnPath(entry.name) ? [child] : [];
  });
}

/** What happened to one file. */
export interface FormatRow {
  /** Its text is not what formatting it gives. */
  changed: boolean;
  /** Its path from the root. */
  path: string;
  /** What is wrong with it, each as the line the report prints after the path. */
  problems: string[];
}

/** Format one file where it is, or say what formatting it would do. */
async function formatFile(root: string, path: string, check: boolean): Promise<FormatRow> {
  const row: FormatRow = {
    changed: false,
    path: relative(root, path).replaceAll("\\", "/"),
    problems: [],
  };
  if (!existsSync(path)) {
    row.problems.push(": there is no such file");
    return row;
  }
  if (!isJxnPath(path)) {
    row.problems.push(": only a .jxn file holds code this can reach");
    return row;
  }
  try {
    const text = await readFile(path, "utf8");
    const formatted = await formatJxn(text);
    row.problems = formatted.problems.map((problem) => `#${problem.pointer}: ${problem.message}`);
    row.changed = formatted.text !== text;
    if (row.changed && !check) {
      await writeFile(path, formatted.text);
    }
  } catch (error) {
    row.problems.push(`: ${errorMessage(error)}`);
  }
  return row;
}

/**
 * Format the `.jxn` files under some paths.
 *
 * @param root What the paths are relative to.
 * @param paths Files and directories.
 * @param check Say what would change, and write nothing.
 */
export async function formatFiles(
  root: string,
  paths: readonly string[],
  check: boolean,
): Promise<FormatRow[]> {
  const files = new Set(paths.flatMap((item) => expand(resolve(root, item))));
  const rows: FormatRow[] = [];
  for (const path of [...files].toSorted()) {
    rows.push(await formatFile(root, path, check));
  }
  return rows;
}

/** What `jx format` was given. */
export interface FormatArgs {
  check: boolean;
  paths: string[];
  root: string;
}

/**
 * Read `jx format`'s arguments.
 *
 * @param argv The arguments after the command.
 * @returns What was asked, or null when it names an option there is not.
 */
export function parseFormatArgs(argv: readonly string[]): FormatArgs | null {
  const paths: string[] = [];
  let root = process.cwd();
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--root") {
      index += 1;
      root = resolve(argv[index] ?? root);
    } else if (arg === "--check") {
      check = true;
    } else if (arg.startsWith("-")) {
      return null;
    } else {
      paths.push(arg);
    }
  }
  // With no path named, the project is what is formatted.
  return { check, paths: paths.length > 0 ? paths : ["."], root };
}

/**
 * Run `jx format`.
 *
 * @param argv The arguments after the command.
 * @param print Where the report goes.
 * @returns The exit code: 1 when a file or code in one could not be formatted, or when `--check`
 *   found a file that formatting would change.
 */
export async function runFormat(
  argv: readonly string[],
  print: (line: string) => void = console.log,
): Promise<number> {
  const args = parseFormatArgs(argv);
  if (!args) {
    print("Usage: jx format [paths…] [--check]");
    return 2;
  }
  const rows = await formatFiles(args.root, args.paths, args.check);
  for (const row of rows) {
    for (const problem of row.problems) {
      print(`${row.path}${problem}`);
    }
    if (row.changed) {
      print(`${row.path} ${args.check ? "would be formatted" : "formatted"}`);
    }
  }
  const changed = rows.filter((row) => row.changed).length;
  print(
    `${changed} file(s) ${args.check ? "would be formatted" : "formatted"}, ${rows.length - changed} left as written`,
  );
  const failed = rows.some((row) => row.problems.length > 0) || (args.check && changed > 0);
  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = await runFormat(process.argv.slice(2));
}
