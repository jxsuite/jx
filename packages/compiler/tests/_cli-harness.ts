/**
 * _cli-harness.ts — Shared harness for in-process CLI entrypoint tests
 *
 * Bun records coverage only for the last evaluated instance of a module path within a process, so
 * each CLI scenario footprint lives in its own test file (run with --isolate); they all share this
 * harness. It stages process.argv, stubs process.exit with a throwing sentinel, captures console
 * output, and mocks the heavy collaborators (buildSite, runCli) via mock.module.
 */

import { mock, spyOn } from "bun:test";
import type { DbPushOptions } from "../src/site/db-push.ts";
import type { buildSite } from "../src/site/site-build.ts";
import type { ProjectValidationResult } from "@jxsuite/schema/validate-project";

/** The exit code `process.exit` was called with. */
type ExitCode = Parameters<typeof process.exit>[0];

/** The options object the CLI hands `buildSite`. */
type BuildSiteOptions = NonNullable<Parameters<typeof buildSite>[1]>;

export class ExitSentinelError extends Error {
  code: ExitCode;
  constructor(code?: ExitCode) {
    super(`process.exit(${code})`);
    this.name = "ExitSentinelError";
    this.code = code;
  }
}

let buildSiteImpl: (root: string, opts: BuildSiteOptions) => ReturnType<typeof buildSite> = () =>
  Promise.resolve({ errors: [], files: 0, routes: 0 });

export const buildSiteCalls: { root: string; opts: BuildSiteOptions }[] = [];

export function setBuildSite(impl: typeof buildSiteImpl) {
  buildSiteImpl = impl;
}

void mock.module("../src/site/site-build.ts", () => ({
  buildSite: (root: string, opts: BuildSiteOptions) => {
    buildSiteCalls.push({ opts, root });
    return buildSiteImpl(root, opts);
  },
}));

let runCliImpl: (src: string, out?: string) => Promise<void> = () => Promise.resolve();

export const runCliCalls: { src: string; out: string | undefined }[] = [];

export function setRunCli(impl: typeof runCliImpl) {
  runCliImpl = impl;
}

void mock.module("../src/compiler.ts", () => ({
  runCli: (src: string, out?: string) => {
    runCliCalls.push({ out, src });
    return runCliImpl(src, out);
  },
}));

export interface SchemaCommandResult {
  projectSchemaPath: string;
  documentSchemaPath: string;
}

let writeProjectSchemasImpl: (root: string) => Promise<SchemaCommandResult> = (root) =>
  Promise.resolve({
    documentSchemaPath: `${root}/document.schema.json`,
    projectSchemaPath: `${root}/project.schema.json`,
  });

export const writeProjectSchemasCalls: string[] = [];

export function setWriteProjectSchemas(impl: typeof writeProjectSchemasImpl) {
  writeProjectSchemasImpl = impl;
}

void mock.module("../src/site/schema-command.ts", () => ({
  writeProjectSchemas: (root: string) => {
    writeProjectSchemasCalls.push(root);
    return writeProjectSchemasImpl(root);
  },
}));

let validateProjectFileImpl: (root: string) => Promise<ProjectValidationResult> = () =>
  Promise.resolve({ errors: null, valid: true });

export const validateProjectFileCalls: string[] = [];

export function setValidateProjectFile(impl: typeof validateProjectFileImpl) {
  validateProjectFileImpl = impl;
}

void mock.module("@jxsuite/schema/validate-project", () => ({
  validateProjectFile: (root: string) => {
    validateProjectFileCalls.push(root);
    return validateProjectFileImpl(root);
  },
}));

export interface ProjectTreeResultLike {
  valid: boolean;
  checked: number;
  issues: { file: string; errors: unknown[] }[];
  lint?: { file: string; severity: string; message: string; source: string; rule: string }[];
}

/** One accessibility error the lint pass reports, shared by the `validate` lint scenarios. */
export const BUTTON_NAME_FINDING = {
  file: "pages/index.json",
  message: "the <button> has no accessible name.",
  rule: "interactive-unnamed",
  severity: "error",
  source: "accessibility",
};

let validateProjectTreeImpl: (
  root: string,
  options?: { strict?: boolean },
) => Promise<ProjectTreeResultLike> = () =>
  Promise.resolve({ checked: 1, issues: [], valid: true });

export const validateProjectTreeCalls: string[] = [];
/** The options each call carried, in call order. */
export const validateProjectTreeOptions: ({ strict?: boolean } | undefined)[] = [];

export function setValidateProjectTree(impl: typeof validateProjectTreeImpl) {
  validateProjectTreeImpl = impl;
}

void mock.module("../src/site/validate-command.ts", () => ({
  formatProjectTreeIssues: (result: ProjectTreeResultLike) =>
    result.issues.flatMap((issue) => [
      `${issue.file}:`,
      ...issue.errors.map((error) => `  - ${JSON.stringify(error)}`),
    ]),
  formatProjectTreeLint: (result: ProjectTreeResultLike) =>
    (result.lint ?? []).map(
      (finding) =>
        `${finding.file}: ${finding.severity}: ${finding.message} [${finding.source}/${finding.rule}]`,
    ),
  validateProjectTree: (root: string, options?: { strict?: boolean }) => {
    validateProjectTreeCalls.push(root);
    validateProjectTreeOptions.push(options);
    return validateProjectTreeImpl(root, options);
  },
}));

export interface DbPushResultLike {
  results: {
    connection: string;
    provider: string;
    tables: string[];
    statements: string[];
    warnings: string[];
    applied: boolean;
  }[];
  bindingsPatched: boolean;
  wranglerPath: string | null;
}

let dbPushImpl: (root: string, opts: DbPushOptions) => Promise<DbPushResultLike> = () =>
  Promise.resolve({ bindingsPatched: false, results: [], wranglerPath: null });

export const dbPushCalls: { root: string; opts: DbPushOptions }[] = [];

export function setDbPush(impl: typeof dbPushImpl) {
  dbPushImpl = impl;
}

void mock.module("../src/site/db-push.ts", () => ({
  dbPush: (root: string, opts: DbPushOptions) => {
    dbPushCalls.push({ opts, root });
    return dbPushImpl(root, opts);
  },
}));

export const runDevCalls: { root: string; port: number | undefined }[] = [];

// The CLI discards what `runDev` returns, so a stub's return value is never read.
let runDevImpl: (root: string, port?: number) => void = () => ({});

export function setRunDev(impl: typeof runDevImpl) {
  runDevImpl = impl;
}

void mock.module("../src/site/dev-command.ts", () => ({
  runDev: (root: string, port?: number) => {
    runDevCalls.push({ port, root });
    return runDevImpl(root, port);
  },
}));

export const previewCalls: { distDir: string; port: number }[] = [];

void mock.module("../src/site/preview-server.ts", () => ({
  startPreviewServer: (distDir: string, port: number) => {
    previewCalls.push({ distDir, port });
    return { close: () => {} };
  },
}));

const originalArgv = process.argv;

/** What the harness reads from an entrypoint module: the promise its body runs in. */
interface EntryModule {
  ready?: Promise<unknown>;
}

/**
 * Import an entrypoint with staged argv; returns logs, errors, and the exit code (if any).
 *
 * Each entrypoint may be imported at most ONCE per process (modules are cached, and Bun records
 * coverage reliably only for plain single-instance imports), hence one scenario per test file.
 */
export async function runEntry(entry: "cli" | "compile-cli", args: string[]) {
  process.argv = ["bun", entry, ...args];
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  const errSpy = spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errors.push(a.map(String).join(" "));
  });
  const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
    throw new ExitSentinelError(code);
  });

  let exitCode: ExitCode;
  let exited = false;
  try {
    // The entry runs its body in an exported `ready` promise instead of a top-level await, so await
    // That: Bun's test runtime drops a dynamically-imported module's top-level-await continuation
    // (it never resumes on Windows), which would leave the entry's effects unexecuted.
    const mod: EntryModule = await import(`../src/${entry}.ts`);
    await mod.ready;
  } catch (error) {
    if (error instanceof ExitSentinelError) {
      exited = true;
      exitCode = error.code;
    } else {
      throw error;
    }
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    process.argv = originalArgv;
  }
  return { errors, exitCode, exited, logs };
}
