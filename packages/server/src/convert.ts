/**
 * `jx convert`: move a document between `.json` and `.jxn`, with every reference repaired.
 *
 * It is a rename, because that is what makes it safe: writing a new file beside the old one would
 * leave every `$ref` to it dangling, and the refactor pass is what repairs them. This runs under
 * Bun for the same reason `jx dev` does, so `@jxsuite/compiler`'s CLI resolves it from the project
 * and spawns it.
 *
 * @docs framework/build/cli
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { buildProjectExtensionRegistry } from "@jxsuite/compiler/format-host";
import { loadProjectConfig } from "@jxsuite/compiler/site-loader";
import { countJxnComments, parseJxn, serializeJxn } from "@jxsuite/schema/jxn";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { errorMessage, parseJxDocument } from "@jxsuite/schema/parse";
import type { ProjectConfig } from "@jxsuite/schema/types";
import { applyRename } from "./refactor/index.ts";

/** The formats a document can move between. */
export type ConvertTarget = "json" | "jxn";

/** What was asked. */
export interface ConvertOptions {
  /** Convert a `.jxn` file that has comments, which `.json` has nowhere to keep. */
  dropComments: boolean;
  /** Say what would happen, and change nothing. */
  dryRun: boolean;
  to: ConvertTarget;
}

/** What happened to one file. */
export interface ConvertRow {
  from: string;
  /** Other files whose references to this one were repaired. */
  references: number;
  /** Why it was left alone, or what is still wrong after moving it. */
  problem: string | null;
  to: string;
}

/** The directories that hold documents, which are conventions the build hard-codes. */
const DOCUMENT_ROOTS = ["components/", "layouts/", "pages/"];

/**
 * Where each content collection's files are, project-relative: the part of its `source` before any
 * `{locale}` or glob. Only a collection reaching into a document root can matter here.
 */
function collectionRoots(config: ProjectConfig): string[] {
  const content = isJsonObject(config.content) ? Object.values(config.content) : [];
  return content.flatMap((definition) => {
    const source = isJsonObject(definition) ? definition.source : null;
    if (!isString(source)) {
      return [];
    }
    const [fixed = ""] = /^[^{*]*/u.exec(source) ?? [];
    return [fixed.replace(/^\.\//u, "").replace(/\/+$/u, "")];
  });
}

/** Every convertible file a path names: itself, or what is under it. */
function expand(path: string): string[] {
  // A path that is not there comes through as itself, so `refusal` can say so.
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return [path];
  }
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      return expand(child);
    }
    return /\.(?:json|jxn)$/iu.test(entry.name) && !entry.name.endsWith(".class.json")
      ? [child]
      : [];
  });
}

/** Why a file cannot be converted, or null when it can. */
async function refusal(
  root: string,
  path: string,
  options: ConvertOptions,
  sources: readonly string[],
): Promise<string | null> {
  if (!existsSync(path)) {
    return "there is no such file";
  }
  const name = relative(root, path).replaceAll("\\", "/");
  if (!DOCUMENT_ROOTS.some((prefix) => name.startsWith(prefix))) {
    return `only ${DOCUMENT_ROOTS.join(", ")} hold documents`;
  }
  const ext = extname(path).toLowerCase();
  if (ext !== ".json" && ext !== ".jxn") {
    return `${ext || "this file"} is not a native document format`;
  }
  if (path.endsWith(".class.json")) {
    return "a class descriptor stays JSON";
  }
  if (ext === `.${options.to}`) {
    return `already .${options.to}`;
  }
  if (sources.some((source) => name === source || name.startsWith(`${source}/`))) {
    // Both directions: an entry would drop out of its glob, and a neighbour would be enlisted.
    return "a content collection's file keeps its collection's format";
  }
  if (existsSync(targetOf(path, options.to))) {
    return `${basename(targetOf(path, options.to))} already exists`;
  }
  if (ext === ".jxn" && !options.dropComments) {
    const comments = countJxnComments(await readFile(path, "utf8"));
    if (comments > 0) {
      return `it has ${comments} comment(s), and .json has nowhere to keep them. --drop-comments converts it anyway`;
    }
  }
  return null;
}

/** The path a file has once converted. */
function targetOf(path: string, to: ConvertTarget): string {
  return join(dirname(path), `${basename(path, extname(path))}.${to}`);
}

/** The file's text in the other format. */
async function converted(path: string, to: ConvertTarget): Promise<string> {
  const text = await readFile(path, "utf8");
  return to === "jxn"
    ? serializeJxn(parseJxDocument(text, path))
    : `${JSON.stringify(parseJxn(text, path), null, 2)}\n`;
}

/**
 * Convert documents in a project.
 *
 * @param root The project root.
 * @param paths Files and directories, relative to the root.
 * @param options What was asked.
 */
export async function convertDocuments(
  root: string,
  paths: readonly string[],
  options: ConvertOptions,
): Promise<ConvertRow[]> {
  const { config } = loadProjectConfig(root);
  const sources = collectionRoots(config);
  const { formats } = await buildProjectExtensionRegistry(root, config);
  const rows: ConvertRow[] = [];
  for (const path of paths.flatMap((item) => expand(resolve(root, item)))) {
    const from = relative(root, path);
    const target = targetOf(path, options.to);
    const row: ConvertRow = { from, references: 0, problem: null, to: relative(root, target) };
    rows.push(row);
    row.problem = await refusal(root, path, options, sources);
    if (row.problem !== null) {
      continue;
    }
    try {
      const text = await converted(path, options.to);
      if (options.dryRun) {
        continue;
      }
      /* In place and then renamed, so a failure writing leaves the old name holding the old text or
         the new, and nothing beside it to be mistaken for the document. */
      await writeFile(path, text);
      await rename(path, target);
      const report = await applyRename({ absFrom: path, absTo: target, registry: formats, root });
      row.references = report.references.filesChanged;
      if (report.errors.length > 0) {
        const unread = report.errors.map((item) => item.path).join(", ");
        row.problem = `converted, and ${unread} could not be read, so a reference in it may still name the old path`;
      }
    } catch (error) {
      row.problem = errorMessage(error);
    }
  }
  return rows;
}

/** What `jx convert` was given. */
export interface ConvertArgs extends ConvertOptions {
  paths: string[];
  root: string;
}

/**
 * Read `jx convert`'s arguments.
 *
 * @param argv The arguments after the command.
 * @returns What was asked, or null when it does not say.
 */
export function parseConvertArgs(argv: readonly string[]): ConvertArgs | null {
  const paths: string[] = [];
  let to: string | undefined;
  let root = process.cwd();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--to") {
      index += 1;
      to = argv[index];
    } else if (arg === "--root") {
      index += 1;
      root = resolve(argv[index] ?? root);
    } else if (arg.startsWith("--")) {
      flags.add(arg);
    } else {
      paths.push(arg);
    }
  }
  if ((to !== "json" && to !== "jxn") || paths.length === 0) {
    return null;
  }
  return {
    dropComments: flags.has("--drop-comments"),
    dryRun: flags.has("--dry-run"),
    paths,
    root,
    to,
  };
}

/**
 * Run `jx convert`.
 *
 * @param argv The arguments after the command.
 * @param print Where the report goes.
 * @returns The exit code: 1 when anything was left unconverted.
 */
export async function runConvert(
  argv: readonly string[],
  print: (line: string) => void = console.log,
): Promise<number> {
  const args = parseConvertArgs(argv);
  if (!args) {
    print("Usage: jx convert <paths…> --to jxn|json [--dry-run] [--drop-comments]");
    return 2;
  }
  const rows = await convertDocuments(args.root, args.paths, args);
  for (const row of rows) {
    if (row.problem !== null) {
      print(`${row.from}: ${row.problem}`);
    } else if (args.dryRun) {
      print(`${row.from} would become ${row.to}`);
    } else {
      print(`${row.from} → ${row.to} (${row.references} file(s) repaired)`);
    }
  }
  return rows.some((row) => row.problem !== null) ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = await runConvert(process.argv.slice(2));
}
