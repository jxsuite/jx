# AI assistant eval harness

A Karpathy-`autoresearch`-style self-improvement loop for the Jx Studio AI document assistant. The **model is held fixed**. What we iterate on is the _scaffolding_: the system prompt ([ai-system-prompt.ts](../src/services/ai-system-prompt.ts)), the tool schemas + validation-error translations ([ai-tools.ts](../src/services/ai-tools.ts)), and the few-shot examples. A stable golden-task suite is the benchmark; every scaffolding change is measured against it.

It exercises the **real** production loop (`runAgentLoop` + `@jxsuite/ai` + `ai-tools`), swapping only the fake test client for a real OpenAI-compatible client and adding graders + a scoreboard.

## Layout

```
evals/
  tasks/*.json        golden tasks (one isolated, unambiguous spec each)
  runner.ts           drive the real loop headlessly per task; pass@k / pass^k
  render-critic.ts    PRIMARY grader — shadow-render the result with @jxsuite/runtime
  schema-grader.ts    baseline grader — reuse validateDoc() (ajv)
  scoreboard.ts       aggregate → results.json + transcripts + report.md (+ regression diff)
  cli.ts              `bun run eval` entrypoint
  runs/               local-only run artifacts (gitignored)
  tests/              grader/runner unit tests (scripted client, no network)
```

## Run

```bash
# Whole suite, k=3 trials per task (default):
OPENAI_API_KEY=sk-… bun run eval

# One task, single trial (smoke):
OPENAI_API_KEY=sk-… bun run eval --tasks add-nav-to-header --k 1
```

`OPENAI_BASE_URL` and `OPENAI_MODEL` (default `gpt-4o`) are optional, mirroring the server proxy config in [packages/server/src/ai-api.ts](../../server/src/ai-api.ts). Cloudflare Workers AI works too (`OPENAI_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<id>/ai/v1`, an API token as the key, a tool-calling `@cf/…` model): the harness restores Bun's `fetch` over happy-dom's, so a provider that answers no CORS preflight is reachable. The CLI exits non-zero if any task regresses vs the previous run (CI gate). Each run writes `runs/<stamp>/report.md` plus one `transcripts/<task>-<trial>.md` per trial. **Read these**; you can't trust a grader you haven't watched (Anthropic, _Demystifying evals_).

## Tasks

A task is one JSON file under `tasks/`: `id`, `prompt`, `tags`, `intent[]`, and the state the model starts from. Most start from an open document (`initialDoc`), are run with the document tools, and are graded on that document. A task with **no** `initialDoc` starts the way the assistant does when a project is open and nothing is on the canvas: `files` is the project (project-relative path to file text, served from memory), the model gets the project-mode prompt and the file tools behind the assistant's own gate, and the trial is graded on the file named by `output`. A trial that never writes `output` fails. These tasks are what exercise the prompt's project-mode workflow, the part a project with no open document is given.

## Tokens and the prompt cache

Every trial sums the `usage` frames its requests streamed (`inputTokens`, `cachedInputTokens`, `outputTokens`) into `usage`, and `report.md` totals them with the share of input the provider's prompt cache served. The real client is created with `sessionAffinity: eval-<task>-<trial>`, so a trial's rounds share one cache key and two trials never do (OpenAI receives it as `prompt_cache_key`, Workers AI as `x-session-affinity`, any other host nothing). The key only routes; it does not isolate. Every trial sends the same reference material, so a trial can be served a prefix an earlier trial cached, and a rerun within the provider's cache lifetime (the key is the same in every run) starts warm. The ratio is therefore not strictly per trial: compare runs that both started cold, or both warm. A prompt-layout change shows up here first: the system prompt's reference material is most of every request, so a change that puts state ahead of it drops the cache ratio before it moves any pass rate.

## Grading

- **Render critic (primary):** mounts the produced document with the real runtime under happy-dom and fails on thrown errors or `console.error`/`warn` (unresolved `$ref`/`$prototype`, broken bindings). Error strings are written as actionable "Sensor" messages so they can later feed the live loop.
- **Schema grader (baseline):** the same `validateDoc()` the loop already self-corrects against.

A trial passes when the render critic passes and the model answered at least once: a loop that failed before any reply leaves the starting document, which renders, so it would otherwise pass. A run in which no trial reached the model exits `2` and is not written. `intent[]` on each task documents the human success criteria. It is used today when reading transcripts, and is the hook for a future LLM-as-judge grader.

## The improvement loop (`/eval-improve` proposes, a human approves)

1. `bun run eval` → note the baseline mean pass-rate; collect failing `transcripts/`.
2. Have an agent read the failures **and only the scaffolding** (system prompt, tool schemas + `translateValidationError`, few-shot examples) and draft a diff to **one** of them, because Karpathy's "edit one file" discipline keeps experiments comparable.
3. Review and merge the diff.
4. Re-run `bun run eval`. **Keep** the change only if the mean pass-rate improves and `regressed` is empty; otherwise **discard**. The report records the per-task `Δrate`.

The model never changes. Only the scaffolding does, and that is what makes two runs comparable.

## Out of scope (this phase)

Runtime UX sensors in the live assistant, LLM-as-judge grading, and fully-autonomous overnight self-editing. The render-critic error format is intentionally LLM-ready so a later phase can wire it into the live loop or an automated proposer.
