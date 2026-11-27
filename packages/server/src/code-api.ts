/**
 * Code-api.js — OXC-powered code services for the studio function editor
 *
 * Endpoints under /__studio/code/* that format (oxfmt, through `code-format.ts`) and lint (oxlint
 * CLI) a function body. A body may be TypeScript (`spec.md` §23.1), so both read it as `.ts`.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { format } from "oxfmt";
import { isJsonObject } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import type { JsonValue } from "@jxsuite/schema/types";
import type { CodeServiceResult } from "@jxsuite/protocol";
import { formatBody } from "./code-format.ts";
import { problem } from "./problem.ts";

/** A label's source span; oxlint's other span members pass through to the client unchanged. */
interface OxcSpan {
  offset: number;
  line: number;
  [key: string]: JsonValue;
}

interface OxcLabel {
  span: OxcSpan;
  [key: string]: JsonValue;
}

/** One entry of `oxlint --format=json` output; members other than `labels` pass through. */
interface OxcDiagnostic {
  labels?: OxcLabel[];
  [key: string]: JsonValue | undefined;
}

/** The actions the code services answer, in the order the editor asks for them. */
export const CODE_SERVICE_ACTIONS = ["format", "lint"] as const;

/** What a request body carries, once narrowed: anything else is dropped. */
interface CodeApiBody {
  code?: string;
  args?: string[];
}

/**
 * Run oxlint's CLI the way the host runs JavaScript: a script is started as `[process.execPath,
 * script]`, which is Bun on the dev server and Electron's own Node in the packaged application, and
 * `ELECTRON_RUN_AS_NODE` makes the second behave as plain Node. No host needs a `node` on its
 * PATH.
 */
const RUN_AS_NODE = { ELECTRON_RUN_AS_NODE: "1" };

/** The first file named `name` on `PATH`, or null. */
function onPath(name: string): string | null {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`] : [name];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const candidate of names) {
      const path = join(dir, candidate);
      if (dir && existsSync(path)) {
        return path;
      }
    }
  }
  return null;
}

/**
 * Locate the oxlint CLI as a command to spawn. In order: an explicit JX_OXLINT_BIN override (empty
 * means lint is disabled outright); the copy a packaged application stages beside its bundled
 * module (`oxlint/bin/oxlint`); a walk up from this module for `node_modules/oxlint/bin/oxlint`,
 * which is the monorepo's and the hoisted install's; and `oxlint` on PATH. Null when none exists,
 * and lint then answers no diagnostics.
 *
 * @param startDir Where the search starts, the directory of this module unless a test says so.
 */
export function resolveOxlintCommand(startDir: string = import.meta.dirname): string[] | null {
  const override = process.env.JX_OXLINT_BIN;
  if (override !== undefined) {
    return override ? [override] : null;
  }
  const staged = join(startDir, "oxlint", "bin", "oxlint");
  if (existsSync(staged)) {
    return [process.execPath, staged];
  }
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, "node_modules", "oxlint", "bin", "oxlint");
    if (existsSync(candidate)) {
      return [process.execPath, candidate];
    }
    const parent = dirname(dir);
    if (parent === dir) {
      const found = onPath("oxlint");
      return found === null ? null : [found];
    }
    dir = parent;
  }
}

let formatterProbe: Promise<boolean> | undefined;

/**
 * Whether the formatter's native binding loads on this host. Settled once: the editor asks to
 * format and to lint together when it opens, and a binding that is missing is missing every time.
 */
export function formatterLoads(): Promise<boolean> {
  formatterProbe ??= format("probe.js", "0", {}).then(
    () => true,
    () => false,
  );
  return formatterProbe;
}

// ─── Wrapper utilities ───────────────────────────────────────────────────────

/**
 * A body inside a function with its parameters, so the linter knows each name it is called with.
 * The function is not `async`, as the one a document's body becomes is not, so a body that awaits
 * is told so here and not first when it runs.
 *
 * @param {string} body
 * @param {string[]} [args]
 */
function wrapBody(body: string, args: string[] = ["state", "event"]) {
  const params = args.join(", ");
  return `function __jx_fn__(${params}) {\n${body}\n}`;
}

/**
 * @param {OxcDiagnostic[]} diagnostics
 * @param {number} headerLen
 */
function adjustDiagnostics(diagnostics: OxcDiagnostic[], headerLen: number) {
  return diagnostics.flatMap((d) => {
    const line = d.labels?.[0]?.span.line;
    // A diagnostic on line 1 points at the synthetic wrapper header, not the user's code
    if (line != null && line <= 1) {
      return [];
    }
    // Diagnostics are freshly parsed and serialized right after; mutate in place
    for (const label of d.labels ?? []) {
      label.span.line -= 1;
      label.span.offset -= headerLen;
    }
    return [d];
  });
}

// ─── Services ────────────────────────────────────────────────────────────────

/** Format a body; null when the formatter cannot load. A body it cannot parse comes back as sent. */
async function formatCode({ code }: CodeApiBody): Promise<CodeServiceResult | null> {
  if (!(await formatterLoads())) {
    return null;
  }
  if (!code?.trim()) {
    return { code: "", errors: [] };
  }
  try {
    const result = await formatBody(code);
    return { code: result.code, errors: result.errors.map((message) => ({ message })) };
  } catch (error) {
    return { code, errors: [{ message: errorMessage(error) }] };
  }
}

/** Run a command to its end and read what it printed. */
function output(command: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const [file = "", ...args] = command;
    const child = spawn(file, args, {
      cwd,
      env: { ...process.env, ...RUN_AS_NODE },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let text = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      text += chunk;
    });
    child.on("error", reject);
    child.on("close", () => resolve(text));
  });
}

/**
 * Lint a body with oxlint's default rules. The body is written into a private directory beside an
 * empty configuration given with `-c`, which is also the working directory: oxlint otherwise uses
 * the nearest `.oxlintrc.json` above where it runs, and a world-writable temp directory is a place
 * another user could plant one.
 */
async function lintCode({ code, args }: CodeApiBody): Promise<CodeServiceResult> {
  if (!code?.trim()) {
    return { diagnostics: [] };
  }
  const command = resolveOxlintCommand();
  if (!command) {
    // No oxlint anywhere: lint quietly disables.
    return { diagnostics: [] };
  }
  const wrapped = wrapBody(code, args);
  const headerLen = wrapped.indexOf("\n") + 1;
  const dir = await mkdtemp(join(tmpdir(), "jx-lint-"));
  try {
    const config = join(dir, ".oxlintrc.json");
    const file = join(dir, "fn.ts");
    await writeFile(config, "{}");
    await writeFile(file, wrapped);
    const text = await output(
      [...command, "-c", config, "--format=json", "-A", "no-unused-vars", file],
      dir,
    );
    /* SAFETY: `oxlint --format=json` prints `{ diagnostics: [...] }` whose labels each carry a
       numeric `span.line`/`span.offset`; output that is not JSON throws into the catch below. */
    const parsed = JSON.parse(text) as { diagnostics?: OxcDiagnostic[] };
    const adjusted = adjustDiagnostics(parsed.diagnostics ?? [], headerLen);
    /* SAFETY: every member was just parsed from JSON, so each diagnostic is a JSON value; the
       interface leaves its optional `labels` open to `undefined`, which a parse never produces. */
    return { diagnostics: adjusted as JsonValue[] };
  } catch (error) {
    return { diagnostics: [], error: errorMessage(error) };
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

/* oxlint-disable deslop/no-unknown-parameters, deslop/no-runtime-typeof -- A code-service payload is
   the editor's JSON body at the host boundary, and narrowing it member by member is the parse. */

/** Keep `code` when it is a string and `args` when it is a list of them; drop everything else. */
function narrow(payload: unknown): CodeApiBody {
  const body: CodeApiBody = {};
  if (!isJsonObject(payload)) {
    return body;
  }
  const { code, args } = payload;
  if (typeof code === "string") {
    body.code = code;
  }
  if (Array.isArray(args) && args.every((arg) => typeof arg === "string")) {
    body.args = args;
  }
  return body;
}

/**
 * Answer one code-service request, with no HTTP in between: the dev server's route and the desktop
 * backend's `codeService` request both call it.
 *
 * @param action One of {@link CODE_SERVICE_ACTIONS}.
 * @param payload The request body, `{ code, args? }`; anything else is read as an empty body.
 * @returns The result, or null for an unknown action and for `format` where the formatter cannot
 *   load.
 */
export async function runCodeService(
  action: string,
  payload: unknown,
): Promise<CodeServiceResult | null> {
  if (action === "format") {
    return formatCode(narrow(payload));
  }
  if (action === "lint") {
    return lintCode(narrow(payload));
  }
  return null;
}
/* oxlint-enable deslop/no-unknown-parameters, deslop/no-runtime-typeof */

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * The HTTP adapter of {@link runCodeService}.
 *
 * @param {Request} req
 * @param {URL} url
 */
export async function handleCodeApi(req: Request, url: URL) {
  const path = url.pathname;
  if (!path.startsWith("/__studio/code/") || req.method !== "POST") {
    return null;
  }
  const action = path.slice("/__studio/code/".length);
  if (!CODE_SERVICE_ACTIONS.some((known) => known === action)) {
    return null;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problem("invalidRequest", "Invalid JSON");
  }

  const result = await runCodeService(action, body);
  return result === null
    ? problem("capabilityUnavailable", "The formatter did not load, so format is unavailable")
    : Response.json(result);
}
