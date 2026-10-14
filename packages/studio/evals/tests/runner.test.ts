import "../../tests/with-dom.ts";
import { describe, expect, test } from "bun:test";
import type { OpenAIMessage } from "@jxsuite/ai/messages";
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";
import { isJsonObject, isNonNullObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import type { StudioPlatform } from "../../src/types";
import { projectToolDeps, runTrial, runTask } from "../runner.js";

/**
 * Scripted streaming client — drives the real agent loop without a network call (same shape as the
 * fakeClient in tests/ai-loop.test.js).
 */
function fakeClient(rounds: StreamEvent[][]): StreamingClient & { calls: () => number } {
  let call = 0;
  return {
    calls: () => call,
    async *streamChat() {
      const events = rounds[call] ?? [{ type: "done", stopReason: "stop" }];
      call += 1;
      for (const e of events) {
        yield e;
      }
    },
  };
}

function toolCallRound(id: string, name: string, args: JsonObject): StreamEvent[] {
  return [
    { type: "tool_call_start", id, name },
    { type: "tool_call_delta", id, args: JSON.stringify(args) },
    { type: "tool_call_end", id },
    { type: "done", stopReason: "tool_calls" },
  ];
}

/** The text of the tool reply answering call `id`; a transcript without one fails the test. */
function toolReply(transcript: OpenAIMessage[], id: string): string {
  for (const message of transcript) {
    if (message.role === "tool" && message.tool_call_id === id) {
      return message.content;
    }
  }
  throw new Error(`no tool reply to ${id} in the transcript`);
}

/** Whether a tool entry carries the OpenAI wire shape's `function.name`, the name the model sees. */
function isNamedTool(tool: unknown): tool is { function: { name: string } } {
  return (
    isNonNullObject(tool) &&
    "function" in tool &&
    isNonNullObject(tool.function) &&
    "name" in tool.function &&
    isString(tool.function.name)
  );
}

const TASK = {
  id: "unit-add-span",
  prompt: "add a span",
  tags: ["unit"],
  initialDoc: { tagName: "div", children: [{ tagName: "p", textContent: "Hello" }] },
};

describe("eval runner", () => {
  test("runs the real loop with a scripted client, grades, and captures the trajectory", async () => {
    const client = fakeClient([
      toolCallRound("c1", "add_child", {
        parentPath: [],
        index: 1,
        node: { tagName: "span", textContent: "added" },
      }),
      [{ type: "done", stopReason: "stop" }],
    ]);

    const trial = await runTrial(TASK, { client });

    // Produced document was mutated by the real ai-tools path: the span lands after the paragraph.
    expect(trial.finalDoc).toMatchObject({ children: [{ tagName: "p" }, { tagName: "span" }] });
    // Graders ran; clean span renders fine.
    expect(trial.render.pass).toBe(true);
    expect(trial.pass).toBe(true);
    // Trajectory captured: one assistant tool-call turn.
    expect(trial.toolCalls).toBe(1);
    expect(trial.loopError).toBeNull();
  });

  test("computes pass@k / pass^k across k trials", async () => {
    const addSpan = (id: string) =>
      toolCallRound(id, "add_child", {
        parentPath: [],
        index: 1,
        node: { tagName: "span", textContent: "x" },
      });
    // One client is reused across trials, so its call counter carries over.
    // Trial 1 consumes rounds[0..1]; trial 2 consumes rounds[2..3].
    const client = fakeClient([
      addSpan("a"),
      [{ type: "done", stopReason: "stop" }],
      addSpan("b"),
      [{ type: "done", stopReason: "stop" }],
    ]);

    const result = await runTask(TASK, { k: 2, client });

    expect(result.k).toBe(2);
    expect(result.passRate).toBe(1);
    expect(result.passAtK).toBe(true);
    expect(result.passHatK).toBe(true);
  });

  /* A loop that failed before the model answered at all leaves the task's starting document in
     place, and that document renders. Graded on the render critic alone it passed, so a bad key or
     a refused request scored every task at 100%. */
  test("a trial whose loop failed before the model answered does not pass", async () => {
    const client = fakeClient([[{ type: "error", message: "Network error: blocked" }]]);
    const trial = await runTrial(TASK, { client });
    expect(trial.render.pass).toBe(true);
    expect(trial.rounds).toBe(0);
    expect(trial.loopError).toBe("Network error: blocked");
    expect(trial.pass).toBe(false);
  });

  test("an error after the model answered is graded on the document as before", async () => {
    const client = fakeClient([
      toolCallRound("c1", "add_child", {
        parentPath: [],
        index: 1,
        node: { tagName: "span", textContent: "added" },
      }),
      [{ type: "error", message: "upstream 500" }],
    ]);
    const trial = await runTrial(TASK, { client });
    expect(trial.rounds).toBe(1);
    expect(trial.loopError).toBe("upstream 500");
    expect(trial.pass).toBe(true);
  });
});

describe("eval runner — token accounting and the prompt-cache key", () => {
  test("sums every usage frame of a trial, cached tokens included", async () => {
    const client = fakeClient([
      [
        ...toolCallRound("u1", "read_document", {}).slice(0, -1),
        { type: "usage", inputTokens: 1000, cachedInputTokens: 0, outputTokens: 10 },
        { type: "done", stopReason: "tool_calls" },
      ],
      [
        { type: "delta", content: "done" },
        { type: "usage", inputTokens: 1100, cachedInputTokens: 900, outputTokens: 5 },
        { type: "done", stopReason: "stop" },
      ],
    ]);
    const trial = await runTrial(TASK, { client });
    expect(trial.usage).toEqual({
      cachedInputTokens: 900,
      inputTokens: 2100,
      outputTokens: 15,
      requests: 2,
    });
  });

  test("a provider that reports nothing leaves the counts at zero", async () => {
    const trial = await runTrial(TASK, { client: fakeClient([]) });
    expect(trial.usage).toEqual({
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
    });
  });

  test("the real client is keyed per task and trial, so a trial's rounds share one cache", async () => {
    const env = { base: process.env.OPENAI_BASE_URL, key: process.env.OPENAI_API_KEY };
    const realFetch = globalThis.fetch;
    const cacheKeys: (JsonValue | undefined)[] = [];
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
    process.env.OPENAI_API_KEY = "sk-test";
    const stub = async (_url: string | URL | Request, init?: RequestInit) => {
      const body: JsonValue = JSON.parse(String(init?.body));
      if (isJsonObject(body)) {
        cacheKeys.push(body.prompt_cache_key);
      }
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    };
    globalThis.fetch = Object.assign(stub, { preconnect: realFetch.preconnect });
    try {
      await runTask(TASK, { k: 2 });
    } finally {
      globalThis.fetch = realFetch;
      for (const [name, value] of [
        ["OPENAI_BASE_URL", env.base],
        ["OPENAI_API_KEY", env.key],
      ] as const) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
    expect(cacheKeys).toEqual(["eval-unit-add-span-1", "eval-unit-add-span-2"]);
  });
});

describe("eval runner — a task with no document open", () => {
  const PROJECT_TASK = {
    id: "unit-no-doc",
    prompt: "add a page",
    files: { "pages/index.json": JSON.stringify({ tagName: "main", children: [] }) },
    output: "pages/new.json",
  };

  test("offers the project-mode tools, as the assistant's gate would, and nothing else", async () => {
    const offered: string[][] = [];
    const client: StreamingClient = {
      async *streamChat(_messages, tools, systemPrompt) {
        offered.push(
          tools.map((t) => {
            if (!isNamedTool(t)) {
              throw new Error("a tool was offered without a function name");
            }
            return t.function.name;
          }),
        );
        expect(systemPrompt).toContain("no document is on the canvas");
        yield { type: "done", stopReason: "stop" };
      },
    };
    await runTrial(PROJECT_TASK, { client });
    const tools = offered[0] ?? [];
    for (const name of ["list_files", "read_file", "write_file", "search_files", "create_page"]) {
      expect([name, tools.includes(name)]).toEqual([name, true]);
    }
    for (const name of ["read_document", "set_property", "add_child", "create_project"]) {
      expect([name, tools.includes(name)]).toEqual([name, false]);
    }
  });

  test("grades the output file, and fails a trial that never wrote it", async () => {
    const page = JSON.stringify({ tagName: "main", children: [{ tagName: "h1" }] });
    const written = await runTrial(PROJECT_TASK, {
      client: fakeClient([
        toolCallRound("w1", "search_files", { query: "index" }),
        toolCallRound("w2", "write_file", { path: "pages/new.json", content: page }),
        [{ type: "done", stopReason: "stop" }],
      ]),
    });
    expect(written.pass).toBe(true);
    expect(written.finalDoc).toEqual({ tagName: "main", children: [{ tagName: "h1" }] });
    expect(toolReply(written.transcript, "w1")).toContain("pages/index.json");

    const missing = await runTrial(PROJECT_TASK, { client: fakeClient([]) });
    expect(missing.pass).toBe(false);
    expect(missing.render.errors).toEqual(["pages/new.json was not written"]);
  });

  test("search_files matches file names the way the platform adapters do, not content or folders", async () => {
    const files = {
      "project.json": JSON.stringify({ name: "Acme Studio" }),
      "pages/index.json": JSON.stringify({ tagName: "main", textContent: "Acme" }),
      "components/site-header.json": JSON.stringify({ tagName: "header" }),
      "components/site-header.md": "# header notes",
      "styles/header.css": "header {}",
      ".cache/header.json": "{}",
    };
    const queries: [string, { query: string; extensions?: string[] }][] = [
      ["s1", { query: "Acme" }],
      ["s2", { query: "components" }],
      ["s3", { query: "header" }],
      ["s4", { query: "header", extensions: [".md", "css"] }],
      ["s5", { query: "json" }],
    ];
    const trial = await runTrial(
      { ...PROJECT_TASK, files },
      {
        client: fakeClient([
          ...queries.map(([id, args]) => toolCallRound(id, "search_files", args)),
          [{ type: "done", stopReason: "stop" }],
        ]),
      },
    );
    const paths = (id: string): JsonValue[] => {
      const reply: JsonValue = JSON.parse(toolReply(trial.transcript, id));
      if (isJsonObject(reply) && isJsonObject(reply.data) && Array.isArray(reply.data.paths)) {
        return reply.data.paths;
      }
      throw new Error(`the reply to ${id} carries no data.paths`);
    };
    // Content and directory names are not file names, so neither finds anything.
    expect(paths("s1")).toEqual([]);
    expect(paths("s2")).toEqual([]);
    // Only .json by default; dot-folders are skipped as the adapters' glob skips them.
    expect(paths("s3")).toEqual(["components/site-header.json"]);
    // Extensions widen the set, with or without their leading dot.
    expect(paths("s4").toSorted()).toEqual([
      "components/site-header.json",
      "components/site-header.md",
      "styles/header.css",
    ]);
    // The extension is not part of the name the query is matched against.
    expect(paths("s5")).toEqual([]);
  });

  test("an output that is not JSON, or a task that names none, is a failed grade", async () => {
    const notJson = await runTrial(PROJECT_TASK, {
      client: fakeClient([
        toolCallRound("n1", "write_file", { path: "pages/new.json", content: "<html>" }),
        [{ type: "done", stopReason: "stop" }],
      ]),
    });
    // A .json path is parsed before it is written, so this one never reached the file.
    expect(notJson.render.errors).toEqual(["pages/new.json was not written"]);

    const textFile = await runTrial(
      { ...PROJECT_TASK, output: "notes.txt" },
      {
        client: fakeClient([
          toolCallRound("n2", "write_file", { path: "notes.txt", content: "plain words" }),
          [{ type: "done", stopReason: "stop" }],
        ]),
      },
    );
    expect(textFile.pass).toBe(false);
    expect(textFile.schema.errors[0]).toStartWith("notes.txt is not JSON:");

    const unnamed = await runTrial({ id: "unit-unnamed", prompt: "x" }, { client: fakeClient([]) });
    expect(unnamed.render.errors).toEqual(["(no output declared) was not written"]);
  });

  test("create_page writes into the same in-memory project the file tools read", async () => {
    const trial = await runTrial(PROJECT_TASK, {
      client: fakeClient([
        toolCallRound("p1", "create_page", {
          path: "pages/new.json",
          content: { tagName: "main", children: [{ tagName: "h1", textContent: "New" }] },
        }),
        [{ type: "done", stopReason: "stop" }],
      ]),
    });
    expect(trial.pass).toBe(true);
    expect(trial.finalDoc).toMatchObject({ tagName: "main" });
  });

  test("with nothing open there is no tab to reload and no project to adopt", async () => {
    const deps = projectToolDeps(new Map());
    expect(deps.findOpenTab()).toBeNull();
    expect(deps.getTab()).toBeNull();
    const refusal = async (pending: Promise<void>): Promise<string> => {
      try {
        await pending;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      return "resolved";
    };
    expect(await refusal(deps.reloadTab("pages/a.json"))).toContain("has none to reload");
    expect(await refusal(deps.adoptProject("/elsewhere"))).toContain("cannot adopt");
  });

  test("puts back the platform it replaced, and an absent one stays absent", async () => {
    const { getPlatform, hasPlatform, registerPlatform } = await import("../../src/platform");
    /* SAFETY: this names the one slot registerPlatform writes, globalThis.__jxPlatform, so the test
       can clear it; the slot is optional because it is absent until a platform registers. */
    const host = globalThis as { __jxPlatform?: StudioPlatform };
    delete host.__jxPlatform;
    await runTrial(PROJECT_TASK, { client: fakeClient([]) });
    expect(hasPlatform()).toBe(false);

    const sentinel: Partial<StudioPlatform> = { readFile: async () => "sentinel" };
    /* SAFETY: the sentinel is only registered, put back by runTrial, and read through
       getPlatform().readFile, which it defines; no other platform member is called on it. */
    registerPlatform(sentinel as StudioPlatform);
    try {
      await runTrial(PROJECT_TASK, { client: fakeClient([]) });
      expect(await getPlatform().readFile("x")).toBe("sentinel");
    } finally {
      delete host.__jxPlatform;
    }
  });

  test("the file tools see directories, and a missing file is a tool error", async () => {
    const trial = await runTrial(
      { ...PROJECT_TASK, files: { "pages/a/b.json": "{}", "pages/c.json": "{}" } },
      {
        client: fakeClient([
          toolCallRound("d1", "list_files", { dir: "pages/" }),
          toolCallRound("d2", "read_file", { path: "pages/missing.json" }),
          [{ type: "done", stopReason: "stop" }],
        ]),
      },
    );
    const listing = toolReply(trial.transcript, "d1");
    expect(listing).toContain('"path":"pages/a"');
    expect(listing).toContain('"path":"pages/a/b.json"');
    expect(toolReply(trial.transcript, "d2")).toContain("no such file: pages/missing.json");
  });
});
