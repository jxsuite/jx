/**
 * Runner.js — headless driver for the AI-assistant eval harness.
 *
 * Exercises the _production_ agent loop (the real `runAgentLoop` + `@jxsuite/ai` tool registry +
 * `ai-system-prompt` + `ai-tools`) against a fixed task, swapping only the fake test client for a
 * real OpenAI-compatible streaming client. Each trial gets a fresh tab (clean state — no shared
 * caches, per Anthropic's isolation guidance), then the produced document is graded.
 *
 * A task with no `initialDoc` runs the other way the assistant works: a project is open and no
 * document is on the canvas, so the model gets the project-mode prompt and the file tools, gated
 * exactly as the assistant gates them, over an in-memory copy of the task's `files`. The trial is
 * graded on the file named by `output`, as the run left it.
 *
 * @license MIT
 */

import { createChatState, createToolRegistry } from "@jxsuite/ai";
import { createOpenAIStreamingClient } from "@jxsuite/ai/streaming-client";
import type { StreamEvent, StreamingClient } from "@jxsuite/ai/streaming-client";
import type { ToolRegistry } from "@jxsuite/ai/tools";
import type { JxMutableNode } from "@jxsuite/schema/types";
import { registerPlatform } from "../src/platform";
import type { DirEntry, StudioPlatform } from "../src/types";
import { createTab, disposeTab } from "../src/tabs/tab";
import { registerAiTools } from "../src/services/ai-tools";
import { registerProjectTools } from "../src/services/ai-project-tools";
import { createGatedToolRegistry } from "../src/services/gated-registry";
import { runAgentLoop } from "../src/services/tool-executor";
import { AI_TOOL_TIERS, buildSystemPrompt, toolActive } from "../src/services/ai-system-prompt";
import { renderCritic } from "./render-critic.js";
import { schemaGrader } from "./schema-grader.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * Resolve OpenAI config from env, mirroring the server proxy (packages/server/src/ai-api.js).
 *
 * @returns {{ apiKey: string; baseUrl: string; model: string }}
 */
export function resolveConfig() {
  const apiKey = process.env.OPENAI_API_KEY || "";
  const baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  return { apiKey, baseUrl, model };
}

export interface Task {
  id: string;
  prompt: string;
  /** The document open on the canvas. Absent for a task that runs with no document open. */
  initialDoc?: JxMutableNode;
  /** A no-document task's project, as project-relative path → file text. */
  files?: Record<string, string>;
  /** The project-relative file a no-document task is graded on, as the run left it. */
  output?: string;
  intent?: string[];
  tags?: string[];
}

/**
 * The provider's own token counts for a trial: the sum of every `usage` frame its requests
 * streamed. `cachedInputTokens` is the part of `inputTokens` served from a prompt cache, so
 * `cachedInputTokens / inputTokens` is how much of the trial the cache paid for. A provider that
 * reports nothing leaves every figure at zero, and `requests` at zero says so.
 */
export interface TrialUsage {
  /** How many `usage` frames were counted: one per request that reported. */
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface TrialResult {
  pass: boolean;
  render: { pass: boolean; errors: string[] };
  schema: { pass: boolean; errors: string[] };
  rounds: number;
  toolCalls: number;
  loopError: string | null;
  finalDoc: object;
  transcript: object[];
  usage: TrialUsage;
}

/**
 * Wrap a client so every `usage` frame it streams is added to `usage` on its way to the loop. The
 * frames themselves pass through untouched: the loop reads them too.
 */
function meteredClient(client: StreamingClient, usage: TrialUsage): StreamingClient {
  return {
    async *streamChat(messages, tools, systemPrompt, signal) {
      for await (const event of client.streamChat(messages, tools, systemPrompt, signal)) {
        if (event.type === "usage") {
          usage.requests += 1;
          usage.inputTokens += event.inputTokens;
          usage.cachedInputTokens += event.cachedInputTokens ?? 0;
          usage.outputTokens += event.outputTokens;
        }
        yield event as StreamEvent;
      }
    },
  };
}

/**
 * Directory entries under `dir`, from a flat path → text map, the way the real backends list them:
 * the root is `.` (or empty), and a deeper path's first segment is a directory.
 */
function listMemoryDirectory(files: Map<string, string>, dir: string): DirEntry[] {
  const prefix = dir === "" || dir === "." ? "" : `${dir.replace(/\/$/, "")}/`;
  const seen = new Map<string, DirEntry>();
  for (const path of files.keys()) {
    const rest = path.slice(prefix.length);
    const [head] = rest.split("/");
    if (path.startsWith(prefix) && head && !seen.has(head)) {
      seen.set(head, {
        name: head,
        path: prefix + head,
        type: rest.includes("/") ? "directory" : "file",
      });
    }
  }
  return [...seen.values()];
}

/**
 * `searchFiles` over the in-memory project, with the adapters' contract rather than a looser one:
 * the desktop and dev-server adapters match every file in the tree against the name glob
 * `*<query>*.{json,...extensions}`, so the query matches the file NAME before its extension (never
 * a directory, never the content), only `.json` plus the extensions asked for come back (a leading
 * dot stripped), and dot-files are skipped. The `search_files` tool tells the model exactly that,
 * so an eval that matched more would credit discovery production refuses.
 */
function searchMemoryFiles(
  files: Map<string, string>,
  query: string,
  extensions: string[],
): DirEntry[] {
  const exts = ["json", ...extensions.map((e) => e.replace(/^\./, ""))];
  return [...files.keys()]
    .filter((path) => {
      if (path.split("/").some((segment) => segment.startsWith("."))) {
        return false;
      }
      const name = path.split("/").pop() ?? path;
      return exts.some(
        (ext) => name.endsWith(`.${ext}`) && name.slice(0, -(ext.length + 1)).includes(query),
      );
    })
    .map((path) => ({ name: path.split("/").pop() ?? path, path, type: "file" }));
}

/**
 * The platform a no-document trial runs against: the file members the file tools call, over an
 * in-memory map, and nothing else. A tool that reaches for another member fails loudly in the
 * transcript, which is where a grader-reader would want to see it.
 */
function memoryPlatform(files: Map<string, string>): StudioPlatform {
  return {
    listDirectory: async (dir: string) => listMemoryDirectory(files, dir),
    readFile: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`no such file: ${path}`);
      }
      return content;
    },
    searchFiles: async (query: string, extensions: string[] = []) =>
      searchMemoryFiles(files, query, extensions),
    writeFile: async (path: string, content: string) => {
      files.set(path, content);
    },
  } as Partial<StudioPlatform> as StudioPlatform;
}

/**
 * What the file tools need from the window, for a project with nothing open: no tab, so nothing to
 * reconcile a write with or reload, and no other project to adopt. `saveFile` is the `create_page`
 * / `create_component` sink, into the same in-memory project the file tools read.
 */
export function projectToolDeps(files: Map<string, string>) {
  const noTab = () => null;
  return {
    adoptProject: async (root: string) => {
      throw new Error(`an eval project cannot adopt another project (${root})`);
    },
    findOpenTab: noTab,
    getTab: noTab,
    reloadTab: async (path: string) => {
      throw new Error(`no tab is open in an eval, so ${path} has none to reload`);
    },
    saveFile: async (relPath: string, content: string) => {
      files.set(relPath, content);
    },
  };
}

/** What a no-document trial is graded on: `output`, parsed, or why there is nothing to grade. */
function outputDocument(task: Task, files: Map<string, string>): object | string {
  const text = task.output === undefined ? undefined : files.get(task.output);
  if (text === undefined) {
    return `${task.output ?? "(no output declared)"} was not written`;
  }
  try {
    return JSON.parse(text) as object;
  } catch (error) {
    return `${task.output} is not JSON: ${(error as Error).message}`;
  }
}

/**
 * Run a single trial of a task through the real agent loop and grade the result.
 *
 * @param task
 * @param opts
 * @param opts.client - Override the LLM client (the scripted fake client is injected here in unit
 *   tests).
 * @param opts.trial - Which trial of the task this is, 1-based. It names the trial's prompt-cache
 *   affinity, so a trial's own rounds are routed together. The key is a routing hint, not a cache
 *   partition: every trial opens with the same static prefix, so a trial (or a rerun minutes later,
 *   which reuses the same key) can be served a prefix an earlier one cached.
 */
export async function runTrial(
  task: Task,
  { client, trial = 1 }: { client?: StreamingClient | undefined; trial?: number } = {},
): Promise<TrialResult> {
  const cfg = resolveConfig();
  const usage: TrialUsage = { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
  const streamingClient = meteredClient(
    client ??
      createOpenAIStreamingClient({
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        sessionAffinity: `eval-${task.id}-${trial}`,
      }),
    usage,
  );
  const chatState = createChatState({ model: cfg.model });
  chatState.sendMessage(task.prompt);

  let finalDoc: object;
  let critique: { pass: boolean; errors: string[] } | null = null;
  if (task.initialDoc) {
    const tab = createTab({
      document: structuredClone(task.initialDoc) as Record<string, unknown>,
      id: `eval-${task.id}`,
    });
    try {
      const toolRegistry = createToolRegistry() as ToolRegistry;
      // Default `validate` is the real validateDoc, so the loop self-corrects just like production.
      registerAiTools(toolRegistry, { getTab: () => tab });
      await runAgentLoop({
        chatState,
        streamingClient,
        toolRegistry,
        systemPrompt: buildSystemPrompt({ document: structuredClone(task.initialDoc) }),
      });
      // JSON-clone to strip the Vue reactive proxy and any functions — graders only need the plain
      // JSON shape.
      // oxlint-disable-next-line unicorn/prefer-structured-clone -- structuredClone throws on the reactive proxy; JSON round-trip is the deliberate way to flatten it
      finalDoc = JSON.parse(JSON.stringify(tab.doc.document)) as typeof tab.doc.document;
    } finally {
      disposeTab(tab);
    }
  } else {
    const files = new Map(Object.entries(task.files ?? {}));
    const host = globalThis as { __jxPlatform?: StudioPlatform };
    const previous = host.__jxPlatform;
    registerPlatform(memoryPlatform(files));
    try {
      const inner = createToolRegistry() as ToolRegistry;
      const deps = projectToolDeps(files);
      registerAiTools(inner, { getTab: deps.getTab, saveFile: deps.saveFile });
      registerProjectTools(inner, deps);
      /* The assistant's own gate over the project-mode state, so the model is offered the tools the
         prompt names and no others: no document tool, no bootstrap tool. */
      const state = { canImport: false, hasDocument: false, hasProject: true, treeEditable: true };
      const toolRegistry = createGatedToolRegistry(
        inner,
        new Map(
          AI_TOOL_TIERS.map((t) => [
            t.name,
            { requires: `the ${t.tier} tier`, when: () => toolActive(t, state) },
          ]),
        ),
      );
      await runAgentLoop({
        chatState,
        streamingClient,
        toolRegistry,
        systemPrompt: buildSystemPrompt({ hasProject: true, projectRoot: `/eval/${task.id}` }),
      });
    } finally {
      if (previous) {
        registerPlatform(previous);
      } else {
        delete host.__jxPlatform;
      }
    }
    const output = outputDocument(task, files);
    if (typeof output === "string") {
      finalDoc = {};
      critique = { errors: [output], pass: false };
    } else {
      finalDoc = output;
    }
  }

  const render = critique ?? (await renderCritic(finalDoc));
  const schema = critique ?? (await schemaGrader(finalDoc));

  const transcript = chatState.toMessagesArray();
  const toolCalls = transcript.reduce(
    (n, m) => n + (m.role === "assistant" ? (m.tool_calls?.length ?? 0) : 0),
    0,
  );
  const rounds = transcript.filter((m) => m.role === "assistant").length;
  const loopError = chatState.status === "error" ? chatState.error : null;

  return {
    /* Render critic is the PRIMARY signal (per scope decision), but only for a trial that reached
       the model. One whose loop failed before the model answered at all (a bad key, an endpoint
       that is down or refuses the request) grades the task's untouched starting document, which
       renders: every task passed without a single call reaching the provider. */
    pass: render.pass && !(rounds === 0 && loopError !== null),
    render,
    schema,
    rounds,
    toolCalls,
    loopError,
    finalDoc,
    transcript,
    usage,
  };
}

/**
 * Run a task `k` times and compute pass@k / pass^k (Anthropic non-determinism metrics).
 *
 * @param task
 * @param opts
 * @param opts.k
 * @param opts.client
 */
export async function runTask(
  task: Task,
  { k = 3, client }: { k?: number; client?: StreamingClient | undefined } = {},
): Promise<{
  id: string;
  tags: string[];
  k: number;
  passAtK: boolean;
  passHatK: boolean;
  passRate: number;
  trials: TrialResult[];
}> {
  const trials: TrialResult[] = [];
  for (let i = 0; i < k; i++) {
    trials.push(await runTrial(task, { client, trial: i + 1 }));
  }
  const passes = trials.filter((t) => t.pass).length;
  return {
    id: task.id,
    tags: task.tags ?? [],
    k,
    passAtK: passes >= 1, // ≥1 success in k attempts
    passHatK: passes === k, // All k succeed (reliability)
    passRate: passes / k,
    trials,
  };
}
