/**
 * The process the compiler starts (`spec.md` §23.3), spoken to as the compiler speaks to it: one
 * framed JSON-RPC message at a time, over the two streams it is given.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";

import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import type { RunningContentMapper } from "ts-content-mapper";

import { run } from "../src/server";

/** One answer, as it arrives. */
interface Answer {
  error?: { message: string };
  id: number;
  result?: JsonValue;
}

/** The compiler's end of a running mapper. */
class Compiler {
  readonly #input = new PassThrough();
  readonly #output = new PassThrough();
  readonly #waiting = new Map<number, (answer: Answer) => void>();
  readonly #running: RunningContentMapper;
  #buffer = Buffer.alloc(0);
  #next = 1;

  constructor() {
    this.#output.on("data", (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#read();
    });
    this.#running = run({ input: this.#input, output: this.#output });
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
      const body = this.#buffer.subarray(head + 4, head + 4 + length).toString();
      this.#buffer = this.#buffer.subarray(head + 4 + length);
      // SAFETY: the mapper speaks JSON-RPC, and is only ever asked, so each message is an answer.
      const answer = JSON.parse(body) as Answer;
      this.#waiting.get(answer.id)?.(answer);
      this.#waiting.delete(answer.id);
    }
  }

  /** Ask, and wait for the answer, whichever kind it is. */
  async ask(method: string, params: JsonObject): Promise<Answer> {
    const id = this.#next;
    this.#next += 1;
    const body = Buffer.from(JSON.stringify({ id, jsonrpc: "2.0", method, params }));
    return await new Promise<Answer>((resolve) => {
      this.#waiting.set(id, resolve);
      this.#input.write(`Content-Length: ${body.length}\r\n\r\n`);
      this.#input.write(body);
    });
  }

  stop(): void {
    this.#running.dispose();
    this.#input.destroy();
    this.#output.destroy();
  }
}

let compiler: Compiler | undefined;

/** Start a mapper, stopped when the test is done. */
function start(): Compiler {
  compiler = new Compiler();
  return compiler;
}

afterEach(() => {
  compiler?.stop();
  compiler = undefined;
});

const SOURCE = 'div {\n  state { count 0 }\n  (fn)onclick "state.nope"\n}\n';

describe("the mapper's process", () => {
  test("agrees on how positions are counted, and names its errors", async () => {
    const asked = start();
    // oxlint-disable-next-line unicorn/text-encoding-identifier-case -- the protocol's own spelling
    const { result } = await asked.ask("initialize", { positionEncodings: ["utf-8", "utf-16"] });
    expect(result).toEqual({ diagnosticSource: "jx", positionEncoding: "utf-16" });
  });

  test("opens a project, maps a file of it, and closes it", async () => {
    const asked = start();
    await asked.ask("initialize", { positionEncodings: ["utf-16"] });

    const opened = await asked.ask("openProject", {
      compilerOptions: {},
      configFileName: "",
      projectHandle: "p1",
    });
    // What the mapper remembers for the project stays in the mapper.
    expect(opened.result).toEqual({ configIdentity: "inferred" });

    const mapped = await asked.ask("transform", {
      content: SOURCE,
      fileName: "/somewhere/a.jxn",
      projectHandle: "p1",
    });
    expect(mapped.result).toMatchObject({
      diagnostics: [],
      extension: ".ts",
      mappings: [[expect.any(Number), 5, SOURCE.indexOf("count"), 5, 0]],
      supplemental: [{ extension: ".ts" }],
    });

    const closed = await asked.ask("closeProject", { projectHandle: "p1" });
    expect(closed.result).toBeNull();
    expect(closed.error).toBeUndefined();
  });

  test("maps no file of a project it has not been told of", async () => {
    const asked = start();
    await asked.ask("initialize", { positionEncodings: ["utf-16"] });
    const mapped = await asked.ask("transform", {
      content: SOURCE,
      fileName: "/somewhere/a.jxn",
      projectHandle: "never",
    });
    expect(mapped.result).toBeUndefined();
    expect(mapped.error?.message).toBe('Unknown project handle "never"');
  });
});
