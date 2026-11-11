/**
 * Scratch projects for the real compiler and the real language server.
 *
 * What the mapper is for cannot be shown without them: that `tsc` prints a document's error at the
 * line and column its author wrote it, and that an editor's hover and rename land on the author's
 * text. A fixture is a folder with a `tsconfig.json` naming the mapper, and this package linked
 * into its `node_modules`, which is how a project that installed it sees it.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

/** This package's folder. */
export const PACKAGE = resolve(import.meta.dir, "..");

/** The compiler the repository pins. */
const TSC = resolve(PACKAGE, "../../node_modules/.bin/tsc");

/**
 * How long a test that starts the compiler or the language server is given: each starts a process
 * of its own, and a process for the mapper.
 */
export const SLOW = 60_000;

/** How long a language server is given to answer one request. */
const ANSWER_MS = 20_000;

/**
 * Bundle the mapper as it is published. `tsc` starts `bin/server.js`, which imports the bundle, so
 * a test of the compiler reads the source as it is now only after this.
 */
export function buildMapper(): void {
  const built = spawnSync(process.execPath, ["run", "build"], { cwd: PACKAGE, encoding: "utf8" });
  if (built.status !== 0) {
    throw new Error(`The mapper did not build:\n${built.stdout}\n${built.stderr}`);
  }
}

/** One line of what the compiler printed about a file. */
export interface Finding {
  /** `file(line,column)`, as printed. */
  at: string;
  /** `TS2339`, or `jx1` for one of the mapper's own. */
  code: string;
  message: string;
}

/** One run of the compiler. */
export interface Check {
  findings: Finding[];
  /** Everything printed. */
  output: string;
  status: number | null;
}

/** What a fixture's `tsconfig.json` says beyond the defaults. */
export interface FixtureOptions {
  compilerOptions?: JsonObject;
  /** Mappers declared after this package's. */
  mappers?: JsonObject[];
}

/** A position as the compiler prints one: `(line,column)`, both counted from one. */
export function printed(source: string, needle: string, delta = 0): string {
  const index = source.indexOf(needle);
  if (index === -1) {
    throw new Error(`${JSON.stringify(needle)} is not in the file`);
  }
  const before = source.slice(0, index + delta);
  const line = before.split("\n").length;
  return `(${line},${before.length - before.lastIndexOf("\n")})`;
}

/** A position as a language server takes one: a line and a character, both counted from zero. */
export function position(source: string, needle: string, delta = 0) {
  const index = source.indexOf(needle);
  if (index === -1) {
    throw new Error(`${JSON.stringify(needle)} is not in the file`);
  }
  const before = source.slice(0, index + delta);
  return {
    character: before.length - before.lastIndexOf("\n") - 1,
    line: before.split("\n").length - 1,
  };
}

/** A scratch project that names the mapper. */
export class Fixture {
  readonly root: string;

  /** @param options What its `tsconfig.json` says beyond the defaults. */
  constructor(options: FixtureOptions = {}) {
    // The compiler names files by their real path, and a temporary folder is often a link.
    const made = mkdtempSync(join(tmpdir(), "jx-content-mapper-"));
    this.root = realpathSync(made);
    mkdirSync(join(this.root, "node_modules/@jxsuite"), { recursive: true });
    symlinkSync(PACKAGE, join(this.root, "node_modules/@jxsuite/content-mapper"), "dir");
    this.write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          allowArbitraryExtensions: true,
          module: "esnext",
          moduleResolution: "bundler",
          noEmit: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          strict: true,
          target: "esnext",
          types: [],
          ...options.compilerOptions,
        },
        contentMappers: [
          { extensions: [".jxn"], package: "@jxsuite/content-mapper" },
          ...(options.mappers ?? []),
        ],
        include: ["src"],
      }),
    );
  }

  /**
   * Write a file of the project.
   *
   * @param path Where, from the project's folder.
   * @param text What it holds.
   * @returns Its absolute path.
   */
  write(path: string, text: string): string {
    const full = join(this.root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    return full;
  }

  /**
   * Run the compiler over the project.
   *
   * @param flags What it is told beyond `-p`.
   */
  check(...flags: string[]): Check {
    const run = spawnSync(TSC, ["-p", ".", "--pretty", "false", ...flags], {
      cwd: this.root,
      encoding: "utf8",
    });
    const output = `${run.stdout}${run.stderr}`;
    const findings = output.split("\n").flatMap((line) => {
      const groups = /^(?<at>[^\s(]+\(\d+,\d+\)): error (?<code>\w+): (?<message>.*)$/u.exec(
        line,
      )?.groups;
      return groups
        ? [{ at: groups.at ?? "", code: groups.code ?? "", message: groups.message ?? "" }]
        : [];
    });
    return { findings, output, status: run.status };
  }

  /** Delete the project. */
  remove(): void {
    rmSync(this.root, { force: true, recursive: true });
  }
}

/** A JSON-RPC answer. */
interface Answer {
  error?: JsonValue;
  id?: number;
  method?: string;
  params?: JsonObject;
  result?: JsonValue;
}

/** The language server, started on a project. */
export class LanguageServer {
  readonly #child;
  readonly #waiting = new Map<number, (answer: Answer) => void>();
  #buffer = Buffer.alloc(0);
  #next = 1;

  /** @param root The project's folder. */
  constructor(root: string) {
    this.#child = spawn(TSC, ["--lsp", "--stdio"], {
      cwd: root,
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.#child.stdout.on("data", (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#read();
    });
  }

  /** Take every whole message off the front of what has arrived. */
  #read(): void {
    for (;;) {
      const head = this.#buffer.indexOf("\r\n\r\n");
      const headers = this.#buffer.subarray(0, Math.max(head, 0)).toString();
      const length = Number(/Content-Length: (?<length>\d+)/iu.exec(headers)?.groups?.length);
      if (head === -1 || this.#buffer.length < head + 4 + length) {
        return;
      }
      // SAFETY: the server speaks JSON-RPC, and each message is one of its three shapes.
      const message = JSON.parse(
        this.#buffer.subarray(head + 4, head + 4 + length).toString(),
      ) as Answer;
      this.#buffer = this.#buffer.subarray(head + 4 + length);
      if (message.id !== undefined && message.method === undefined) {
        this.#waiting.get(message.id)?.(message);
        this.#waiting.delete(message.id);
      } else if (message.id !== undefined) {
        // The server asking the editor something: it has no configuration to give.
        const items = message.params?.items;
        this.#send({
          id: message.id,
          result:
            message.method === "workspace/configuration" && Array.isArray(items)
              ? items.map(() => null)
              : null,
        });
      }
    }
  }

  #send(message: JsonObject): void {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
    this.#child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.#child.stdin.write(body);
  }

  /**
   * Ask the server something, and wait for its answer.
   *
   * @param method The request.
   * @param params What it is asked about.
   * @returns The answer's result.
   */
  async request(method: string, params: JsonObject): Promise<JsonValue> {
    const id = this.#next;
    this.#next += 1;
    const answer = await new Promise<Answer>((resolveAnswer, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`The language server did not answer ${method}`));
      }, ANSWER_MS);
      this.#waiting.set(id, (message) => {
        clearTimeout(timer);
        resolveAnswer(message);
      });
      this.#send({ id, method, params });
    });
    if (answer.error !== undefined) {
      throw new Error(`${method}: ${JSON.stringify(answer.error)}`);
    }
    return answer.result ?? null;
  }

  /** Tell the server something it does not answer. */
  notify(method: string, params: JsonObject): void {
    this.#send({ method, params });
  }

  /**
   * Start a session: say what the editor can do, and whether the project's mappers may run.
   *
   * @param root The project's folder.
   * @param runExternalCode What the person at the editor answered when asked to trust the project.
   */
  async open(root: string, runExternalCode = true): Promise<void> {
    await this.request("initialize", {
      capabilities: {
        textDocument: {
          completion: {},
          diagnostic: {},
          hover: {},
          rename: { prepareSupport: true },
        },
        workspace: { configuration: true, workspaceEdit: { documentChanges: true } },
      },
      initializationOptions: { runExternalCode },
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      workspaceFolders: [{ name: "fixture", uri: pathToFileURL(root).href }],
    });
    this.notify("initialized", {});
  }

  /**
   * Open a file in the editor.
   *
   * @param path Its absolute path.
   * @param text What the editor holds for it.
   * @returns What a request names it by.
   */
  edit(path: string, text: string) {
    const uri = pathToFileURL(path).href;
    this.notify("textDocument/didOpen", {
      textDocument: { languageId: "jxn", text, uri, version: 1 },
    });
    return { uri };
  }

  /** End the session. */
  stop(): void {
    this.#child.kill();
  }
}
