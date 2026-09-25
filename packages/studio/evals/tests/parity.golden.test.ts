import "../../tests/with-dom.ts";
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";
import { runTask, runTrial } from "../runner.js";
import type { Task, TrialResult } from "../runner.js";
import { writeRun } from "../scoreboard.js";

/*
 * Eval parity goldens (harness slice J1.2, "freeze v1").
 *
 * Every golden task in `evals/tasks/` is run through the REAL runner path (`runTrial` -> the real
 * `runAgentLoop`, the real tool registry, the real render critic and schema grader) with a scripted,
 * keyless streaming client injected exactly as `runner.test.ts` injects one. The observable result
 * is normalized and compared to `fixtures/parity/<scenario>.json`. No network, no API key.
 *
 * - `<task>.json`: one per golden task, a sensible edit for that task.
 * - `<task>--<variant>.json`: the loop's other exits (a stream error, the round cap with and
 *   without applied edits, failing graders, a text-only answer).
 * - `offered-tools.json`: the tool names the runner's registry offers the model.
 * - `scoreboard.json`: `runTask` at k=2 over every task plus `writeRun`'s results.json, report.md
 *   and transcript headers, then a second run that regresses.
 *
 * These goldens freeze CURRENT behavior, defects included. A mismatch is a behavior change: read the
 * reported path, decide whether the change is intended, and regenerate with
 *
 *   JX_UPDATE_GOLDENS=1 bun test --isolate evals/tests/parity.golden.test.ts
 *
 * from `packages/studio`.
 */

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "parity");
const TASKS_DIR = join(import.meta.dir, "..", "tasks");
const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const UPDATE = process.env.JX_UPDATE_GOLDENS === "1";
/** The golden for what `writeRun` produces over SCOREBOARD_PLAN, plus a regressing re-run. */
const SCOREBOARD_GOLDEN = "scoreboard";
/** The golden for the tool names the runner's registry offers the model. */
const OFFERED_TOOLS_GOLDEN = "offered-tools";

// ─── Scripted client ─────────────────────────────────────────────────────────

/** One model request as the scripted client received it (content is in the transcript). */
interface RecordedRequest {
  roles: string[];
  tools: string[];
}

/**
 * A scripted streaming client. Each `streamChat` call replays the next round of events. Unlike the
 * lenient client in `runner.test.ts`, asking for a round the script does not have THROWS, so a loop
 * that runs longer than the script fails the test instead of silently receiving a default "done".
 */
function scriptedClient(rounds: StreamEvent[][]): StreamingClient & {
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    async *streamChat(messages, tools) {
      const events = rounds[requests.length];
      requests.push({
        roles: messages.map((m) => String((m as { role?: unknown }).role)),
        tools: tools.map((t) => String((t as { function?: { name?: unknown } }).function?.name)),
      });
      if (!events) {
        throw new Error(
          `scripted client exhausted: request ${requests.length} has no scripted round`,
        );
      }
      for (const e of events) {
        yield e;
      }
    },
  };
}

/** A tool call as a model streams one: start, the arguments in two fragments, end. */
function call(id: string, name: string, args: object): StreamEvent[] {
  const json = JSON.stringify(args);
  const cut = Math.floor(json.length / 2);
  return [
    { type: "tool_call_start", id, name },
    { type: "tool_call_delta", id, args: json.slice(0, cut) },
    { type: "tool_call_delta", id, args: json.slice(cut) },
    { type: "tool_call_end", id },
  ];
}

/** A round made of one or more tool calls, finished with `tool_calls`. */
function toolRound(...calls: StreamEvent[][]): StreamEvent[] {
  return [...calls.flat(), { type: "done", stopReason: "tool_calls" }];
}

/** A closing text round, streamed in two deltas. */
function textRound(text: string): StreamEvent[] {
  const cut = Math.floor(text.length / 2);
  return [
    { type: "delta", content: text.slice(0, cut) },
    { type: "delta", content: text.slice(cut) },
    { type: "done", stopReason: "stop" },
  ];
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

interface Scenario {
  /** Golden file stem: the task id for the task's own scenario, `<task>--<variant>` otherwise. */
  id: string;
  task: string;
  what: string;
  rounds: StreamEvent[][];
}

const SCENARIOS: Scenario[] = [
  {
    id: "add-nav-to-header",
    task: "add-nav-to-header",
    what: "reads the document, mis-aims add_child at a children array, then corrects itself",
    rounds: [
      toolRound(call("nav-1", "read_document", {})),
      toolRound(
        call("nav-2", "add_child", {
          parentPath: ["children"],
          index: 1,
          node: { tagName: "nav", children: [] },
        }),
      ),
      toolRound(
        call("nav-3", "add_child", {
          parentPath: [],
          index: 1,
          node: {
            tagName: "nav",
            children: [
              { tagName: "a", attributes: { href: "/" }, textContent: "Home" },
              { tagName: "a", attributes: { href: "/about" }, textContent: "About" },
            ],
          },
        }),
      ),
      textRound("Added a nav with Home and About links after the heading."),
    ],
  },
  {
    id: "counter-button",
    task: "counter-button",
    what: "reasoning frame plus two parallel tool calls, then the button in a second round",
    rounds: [
      [
        { type: "reasoning", content: "Need a handler, a display, and a button." },
        ...call("cnt-1", "add_state", {
          key: "increment",
          value: { $prototype: "Function", body: "state.count++" },
        }),
        ...call("cnt-2", "add_child", {
          parentPath: [],
          index: 0,
          node: { tagName: "p", textContent: "Count: ${state.count}" },
        }),
        { type: "done", stopReason: "tool_calls" },
      ],
      toolRound(
        call("cnt-3", "add_child", {
          parentPath: [],
          index: 1,
          node: {
            tagName: "button",
            textContent: "Increment",
            onclick: { $ref: "#/state/increment" },
          },
        }),
      ),
      textRound("The button now increments state.count, shown above it."),
    ],
  },
  {
    id: "list-from-state",
    task: "list-from-state",
    what: "maps state.fruits into li items with a $prototype Array children object",
    rounds: [
      toolRound(
        call("lst-1", "add_child", {
          parentPath: [],
          index: 0,
          node: {
            tagName: "ul",
            children: {
              $prototype: "Array",
              items: { $ref: "#/state/fruits" },
              map: { tagName: "li", textContent: "${$map.item}" },
            },
          },
        }),
      ),
      textRound("Rendered the fruits as a list."),
    ],
  },
  {
    id: "style-card",
    task: "style-card",
    what: "three parallel set_style calls in one round, a usage frame, then a closing message",
    rounds: [
      [
        ...call("sty-1", "set_style", { path: [], property: "backgroundColor", value: "#ffffff" }),
        ...call("sty-2", "set_style", { path: [], property: "padding", value: "16px" }),
        ...call("sty-3", "set_style", { path: [], property: "borderRadius", value: "8px" }),
        { type: "usage", inputTokens: 1200, outputTokens: 80 },
        { type: "done", stopReason: "tool_calls" },
      ],
      textRound("Styled the card; the heading is unchanged."),
    ],
  },
  {
    id: "add-nav-to-header--stream-error",
    task: "add-nav-to-header",
    what: "an applied edit, then a provider error mid tool call that ends the turn",
    rounds: [
      toolRound(
        call("err-1", "add_child", {
          parentPath: [],
          index: 1,
          node: { tagName: "nav", children: [] },
        }),
      ),
      [
        { type: "delta", content: "Now adding the links" },
        { type: "tool_call_start", id: "err-2", name: "add_child" },
        { type: "tool_call_delta", id: "err-2", args: '{"parentPath":["children",1],' },
        { type: "error", message: "Upstream provider returned 503", code: "upstream_unavailable" },
      ],
    ],
  },
  {
    id: "list-from-state--graders-fail",
    task: "list-from-state",
    what: "an unbound template and a schema-invalid style, never fixed: both graders fail",
    rounds: [
      toolRound(
        call("bad-1", "add_child", {
          parentPath: [],
          index: 0,
          node: { tagName: "ul", children: [{ tagName: "li", textContent: "${fruit}" }] },
        }),
      ),
      toolRound(call("bad-2", "set_property", { path: [], key: "style", value: "red" })),
      textRound("Done."),
    ],
  },
  {
    id: "style-card--no-op",
    task: "style-card",
    what: "the model answers in text and edits nothing",
    rounds: [textRound("Sure, the card could use some styling.")],
  },
  {
    id: "style-card--round-cap",
    task: "style-card",
    what: "five work rounds with edits applied and errors seen: the cap as an assistant message",
    rounds: [
      toolRound(
        call("cap-1", "set_style", { path: [], property: "backgroundColor", value: "white" }),
      ),
      toolRound(call("cap-2", "set_style", { path: [], property: "padding", value: "16px" })),
      toolRound(call("cap-3", "set_style", { path: [], property: "borderRadius", value: "8px" })),
      toolRound(
        call("cap-4", "set_style", {
          path: ["children", 1],
          property: "color",
          value: "black",
        }),
      ),
      toolRound(call("cap-5", "read_document", { path: ["children", 0] })),
    ],
  },
  {
    id: "counter-button--round-cap-nothing-applied",
    task: "counter-button",
    what: "five failing work rounds (truncated args, missing key/node/arg): the cap as an error",
    rounds: [
      [
        { type: "tool_call_start", id: "nop-1", name: "update_state" },
        { type: "tool_call_delta", id: "nop-1", args: '{"key":"cou' },
        { type: "tool_call_end", id: "nop-1" },
        { type: "done", stopReason: "length" },
      ],
      toolRound(call("nop-2", "update_state", { key: "counter", value: 1 })),
      toolRound(
        call("nop-3", "set_property", { path: ["children", 0], key: "textContent", value: "0" }),
        call("nop-3b", "create_component", {
          path: "components/counter-display.json",
          content: { tagName: "counter-display" },
        }),
      ),
      toolRound(call("nop-4", "set_style", { path: [], value: "red" })),
      toolRound(call("nop-5", "update_state", { key: "counter", value: 1 })),
    ],
  },
];

// ─── Normalization ───────────────────────────────────────────────────────────

interface WireToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface WireMessage {
  role: string;
  content?: string | null;
  reasoning_content?: string;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
}

/** Replace anything run-dependent with a stable placeholder. */
function normalizeString(s: string): string {
  return s
    .split(REPO_ROOT)
    .join("<repo>")
    .replaceAll(/msg_\d+_\d+/g, "msg_<id>")
    .replaceAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<timestamp>");
}

/**
 * Normalize strings, and give the value exactly the shape JSON would: `undefined` members dropped
 * and `undefined` array slots as `null`. So the actual value compares against a parsed golden
 * as-is.
 */
function normalizeDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return normalizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : normalizeDeep(v)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, normalizeDeep(v)]),
    );
  }
  return value;
}

/** Tool arguments as the loop parsed them, or the raw text when they did not parse. */
function parseArgs(raw: string): unknown {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { $unparsed: raw };
  }
}

function normalizeTrial(scenario: Scenario, trial: TrialResult, requests: RecordedRequest[]) {
  const wire = trial.transcript as WireMessage[];
  const toolCalls = wire.flatMap((m) =>
    (m.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: parseArgs(tc.function.arguments),
    })),
  );
  const transcript = wire.map((m) => {
    if (m.role === "tool") {
      // The loop sends `JSON.stringify(result)`; stored parsed so the golden stays readable.
      return { role: m.role, toolCallId: m.tool_call_id, result: parseArgs(m.content ?? "") };
    }
    const entry: {
      role: string;
      content: string | null;
      reasoning?: string;
      toolCalls?: string[];
    } = { role: m.role, content: m.content ?? null };
    if (m.reasoning_content !== undefined) {
      entry.reasoning = m.reasoning_content;
    }
    if (m.tool_calls) {
      entry.toolCalls = m.tool_calls.map((tc) => tc.function.name);
    }
    return entry;
  });
  return normalizeDeep({
    scenario: scenario.id,
    task: scenario.task,
    what: scenario.what,
    modelRequests: requests.map((r) => r.roles.join(" ")),
    rounds: trial.rounds,
    toolCallCount: trial.toolCalls,
    toolCalls,
    loopError: trial.loopError,
    grades: { pass: trial.pass, render: trial.render, schema: trial.schema },
    finalDoc: trial.finalDoc,
    transcript,
  });
}

// ─── Golden comparison ───────────────────────────────────────────────────────

function pathJoin(base: string, key: string | number): string {
  return typeof key === "number" ? `${base}[${key}]` : `${base}.${key}`;
}

function show(v: unknown): string {
  const s = JSON.stringify(v);
  return s === undefined ? "undefined" : s.length > 400 ? `${s.slice(0, 400)}...` : s;
}

/** The first path at which two JSON values differ (key order included), or null when equal. */
function firstDifference(expected: unknown, actual: unknown, at = "$"): string | null {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      const d = firstDifference(expected[i], actual[i], pathJoin(at, i));
      if (d) {
        return d;
      }
    }
    if (expected.length !== actual.length) {
      return (
        `${at}: expected ${expected.length} items, got ${actual.length}; ` +
        `first extra: ${show(expected.length > actual.length ? expected[n] : actual[n])}`
      );
    }
    return null;
  }
  const isObj = (v: unknown): v is Record<string, unknown> =>
    Boolean(v) && typeof v === "object" && !Array.isArray(v);
  if (isObj(expected) && isObj(actual)) {
    const ek = Object.keys(expected);
    const ak = Object.keys(actual);
    for (const k of ek) {
      if (!(k in actual)) {
        return `${pathJoin(at, k)}: missing (expected ${show(expected[k])})`;
      }
      const d = firstDifference(expected[k], actual[k], pathJoin(at, k));
      if (d) {
        return d;
      }
    }
    for (const k of ak) {
      if (!(k in expected)) {
        return `${pathJoin(at, k)}: unexpected (got ${show(actual[k])})`;
      }
    }
    if (ek.join("\0") !== ak.join("\0")) {
      return `${at}: key order differs; expected [${ek.join(", ")}], got [${ak.join(", ")}]`;
    }
    return null;
  }
  if (Object.is(expected, actual)) {
    return null;
  }
  return `${at}: expected ${show(expected)}, got ${show(actual)}`;
}

/**
 * Run the repo formatter over a freshly written golden, so the committed file is already in the
 * shape the pre-commit hook (`oxfmt` over staged `*.json`) would give it. The comparison below is
 * structural, so formatting can never fail a check; this only keeps an update from arriving as a
 * reformat on commit.
 */
function formatGolden(file: string) {
  const oxfmt = join(REPO_ROOT, "node_modules", ".bin", "oxfmt");
  if (existsSync(oxfmt)) {
    Bun.spawnSync([oxfmt, file], { cwd: REPO_ROOT, stdout: "ignore", stderr: "ignore" });
  }
}

/**
 * Compare against the committed golden, or rewrite it when JX_UPDATE_GOLDENS=1. The comparison is
 * on the parsed value (key order included), not the text, so a reformat is not a behavior change.
 */
function matchGolden(id: string, actual: unknown) {
  const file = join(FIXTURES_DIR, `${id}.json`);
  if (UPDATE) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
    formatGolden(file);
    return;
  }
  if (!existsSync(file)) {
    throw new Error(
      `missing golden fixtures/parity/${id}.json; run with JX_UPDATE_GOLDENS=1 to create it`,
    );
  }
  const golden = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const diff = firstDifference(golden, actual);
  if (diff) {
    throw new Error(
      `eval parity golden fixtures/parity/${id}.json differs at ${diff}\n` +
        `If the change is intended, regenerate with JX_UPDATE_GOLDENS=1.`,
    );
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

function loadTasks(): Map<string, Task> {
  const tasks = new Map<string, Task>();
  for (const f of readdirSync(TASKS_DIR).filter((n) => n.endsWith(".json"))) {
    const task = JSON.parse(readFileSync(join(TASKS_DIR, f), "utf8")) as Task;
    tasks.set(task.id, task);
  }
  return tasks;
}

const TASKS = loadTasks();

function taskFor(id: string): Task {
  const task = TASKS.get(id);
  if (!task) {
    throw new Error(`no golden task ${id} in evals/tasks/`);
  }
  return task;
}

function scenarioById(id: string): Scenario {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) {
    throw new Error(`no scenario ${id}`);
  }
  return scenario;
}

/**
 * The scoreboard run: every golden task at k=2, trial by trial. Two tasks mix a passing script with
 * a failing or erroring one, so pass@k, pass^k, the rate and the per-trial lines all vary.
 */
const SCOREBOARD_PLAN: { task: string; trials: string[] }[] = [
  { task: "add-nav-to-header", trials: ["add-nav-to-header", "add-nav-to-header--stream-error"] },
  { task: "counter-button", trials: ["counter-button", "counter-button"] },
  { task: "list-from-state", trials: ["list-from-state", "list-from-state--graders-fail"] },
  { task: "style-card", trials: ["style-card", "style-card"] },
];

describe("eval parity goldens", () => {
  test("every golden task has its own scenario", () => {
    const own = SCENARIOS.filter((s) => s.id === s.task).map((s) => s.id);
    expect(own.toSorted()).toEqual([...TASKS.keys()].toSorted());
  });

  test("every committed golden belongs to a scenario", () => {
    if (UPDATE || !existsSync(FIXTURES_DIR)) {
      return;
    }
    const committed = readdirSync(FIXTURES_DIR)
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -".json".length));
    expect(committed.toSorted()).toEqual(
      [...SCENARIOS.map((s) => s.id), SCOREBOARD_GOLDEN, OFFERED_TOOLS_GOLDEN].toSorted(),
    );
  });

  for (const scenario of SCENARIOS) {
    test(`${scenario.id}: ${scenario.what}`, async () => {
      const client = scriptedClient(scenario.rounds);
      const trial = await runTrial(taskFor(scenario.task), { client });

      // The loop consumed the whole script and asked for nothing past it.
      expect(client.requests).toHaveLength(scenario.rounds.length);
      // Every request in the turn offers the same tools (the list is frozen in offered-tools.json).
      expect(new Set(client.requests.map((r) => r.tools.join(","))).size).toBe(1);

      matchGolden(scenario.id, normalizeTrial(scenario, trial, client.requests));
    });
  }

  test("the runner offers the model this tool list", async () => {
    const client = scriptedClient([textRound("Nothing to change.")]);
    await runTrial(taskFor("style-card"), { client });
    matchGolden(OFFERED_TOOLS_GOLDEN, { tools: client.requests[0]?.tools ?? [] });
  });

  test("runTask (k=2) + writeRun: isolated trials and the scoreboard the CLI writes", async () => {
    const results = [];
    for (const plan of SCOREBOARD_PLAN) {
      const scripts = plan.trials.map((id) => scenarioById(id));
      const task = taskFor(plan.task);
      // One client across both trials, as the CLI shares one: trial 2 reads the second script.
      const client = scriptedClient(scripts.flatMap((s) => s.rounds));
      const result = await runTask(task, { k: scripts.length, client });
      expect(client.requests).toHaveLength(scripts.reduce((n, s) => n + s.rounds.length, 0));

      // Isolation: each trial inside runTask equals the same script run alone on a fresh trial.
      for (const [i, scenario] of scripts.entries()) {
        const alone = await runTrial(task, { client: scriptedClient(scenario.rounds) });
        const inTask = result.trials[i];
        expect(inTask && normalizeDeep(inTask.finalDoc)).toEqual(normalizeDeep(alone.finalDoc));
        expect(inTask && normalizeDeep(inTask.transcript)).toEqual(normalizeDeep(alone.transcript));
      }
      results.push(result);
    }

    const runsDir = mkdtempSync(join(tmpdir(), "jx-eval-parity-"));
    try {
      const first = writeRun(results, { stamp: "20260101-000000", runsDir });
      expect(first.outDir).toBe(join(runsDir, "20260101-000000"));
      const resultsJson = JSON.parse(readFileSync(join(first.outDir, "results.json"), "utf8")) as {
        summary: unknown;
        regressed: unknown;
      };
      // What the CLI reads back equals what it wrote.
      expect(first.summary).toEqual(resultsJson.summary as typeof first.summary);
      expect(first.regressed).toEqual(resultsJson.regressed as string[]);

      /* The head of each transcript file: title, counters and both grader sections. The rest is
         the final document and the transcript, which the per-scenario goldens already hold. */
      const transcripts: Record<string, string[]> = {};
      for (const name of readdirSync(join(first.outDir, "transcripts")).toSorted()) {
        const text = readFileSync(join(first.outDir, "transcripts", name), "utf8");
        transcripts[name] = text.slice(0, text.indexOf("## final document")).trimEnd().split("\n");
      }

      // A second run in which the task that passed at k now fails outright: the regression diff.
      const failing = scenarioById("list-from-state--graders-fail");
      const rerun = await runTask(taskFor(failing.task), {
        k: 1,
        client: scriptedClient(failing.rounds),
      });
      const second = writeRun([rerun], { stamp: "20260101-010000", runsDir });

      const report = readFileSync(join(first.outDir, "report.md"), "utf8").split("\n");
      const rerunReport = readFileSync(join(second.outDir, "report.md"), "utf8").split("\n");
      matchGolden(
        SCOREBOARD_GOLDEN,
        normalizeDeep({
          plan: SCOREBOARD_PLAN,
          results: resultsJson,
          report,
          transcripts,
          rerun: { regressed: second.regressed, report: rerunReport },
        }),
      );
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });

  test("the comparison reports the first differing path", () => {
    expect(firstDifference({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(
      "$.a[1].b: expected 2, got 3",
    );
    expect(firstDifference({ a: 1, b: 2 }, { b: 2, a: 1 })).toContain("key order differs");
    expect(firstDifference([1, 2], [1])).toContain("expected 2 items, got 1");
    expect(firstDifference({ a: 1 }, {})).toBe("$.a: missing (expected 1)");
    expect(firstDifference({}, { z: 1 })).toBe("$.z: unexpected (got 1)");
    expect(firstDifference({ a: [1] }, { a: [1] })).toBeNull();
  });

  test("normalization replaces run-dependent values", () => {
    expect(normalizeString(`${REPO_ROOT}/x msg_1727000000000_12 at 2026-09-24T10:11:12.345Z`)).toBe(
      "<repo>/x msg_<id> at <timestamp>",
    );
  });
});
