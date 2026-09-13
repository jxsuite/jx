/**
 * Tests for src/panels/ai-chat/chat-view.ts — the transcript's PROJECTION: row anatomy per role
 * (user bodies + context chips, assistant markdown + tool chips, failed-tool surfacing, streaming
 * tail), the tool-chip outcomes, the changed-files summary, the question card, the import log, and
 * the moved helper functions.
 *
 * The markup is `surfaces/ai-chat.json` now, so these assertions read the DATA the surface is
 * handed; that the document draws it, and that a click on it does what it says, is
 * `tests/ai-panel.test.ts`'s subject, against the mounted document.
 *
 * The three buttons this file used to draw are COMMANDS (§11.1), and {@link projectCommand} is what
 * is left of them. They are tested the way `tests/statusbar.test.ts` tests the bar: against a
 * registry of bare stubs, because the contract is "projects the record the registry holds, and
 * nothing when it holds none". The last test in the file closes the loop the same way the status
 * bar's does: every id named in the panel is one the real app declares.
 */
import "./with-dom.js";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  formatErrorAdvice,
  formatToolLabel,
  parseAsk,
  projectChip,
  projectCommand,
  projectCommands,
  projectRows,
  tokenHint,
  tokenLabel,
  toolOutcome,
  toolOutcomeText,
  tryParseToolResult,
} from "../src/panels/ai-chat/chat-view";
import type { AskHandlers } from "../src/panels/ai-chat/chat-view";
import { beginTurn, endTurn, recordWrite, resetAiWrites } from "../src/services/ai-writes";
import { ATTACHED_CONTEXT_DELIMITER } from "../src/panels/ai-chat/attached-context";
import { setActiveRegistry } from "../src/commands/active-registry";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import type { CommandContext } from "../src/commands/context";
import type { AnyCommand } from "../src/commands/registry";
import type { ChatRowView } from "../src/surfaces/ai-chat";
import type { Message } from "@jxsuite/ai/chat-state";

let idCounter = 0;
function msg(role: Message["role"], content: string, extra: Partial<Message> = {}): Message {
  idCounter += 1;
  return { content, id: `t_${idCounter}`, role, timestamp: idCounter, ...extra };
}

// ─── The registry the buttons project from ───────────────────────────────────

let ctx: CommandContext = makeContext();

/** One record, as bare as the registry allows: the projection must not care what it does. */
function stub(id: string, title: string, extra: Partial<AnyCommand> = {}): AnyCommand {
  return {
    category: "Assistant",
    id,
    level: "application",
    run: () => {},
    title,
    ...extra,
  } as AnyCommand;
}

const ASSISTANT_STUBS: readonly AnyCommand[] = [
  stub("assistant.history", "Chat History", { keybinding: "mod+shift+h" }),
  stub("assistant.newChat", "New Chat"),
  stub("assistant.retry", "Retry Last Message", {
    enablement: (c: CommandContext) => c.ai.configured,
    requires: "a connected AI provider",
  }),
];

function buildRegistry(ids?: readonly string[]) {
  const registry = createCommandRegistry({ getContext: () => ctx, mac: true });
  registry.registerAll(ids ? ASSISTANT_STUBS.filter((c) => ids.includes(c.id)) : ASSISTANT_STUBS);
  return registry;
}

beforeEach(() => {
  ctx = makeContext({ ai: { configured: true } });
  setActiveRegistry(buildRegistry());
});

afterEach(() => {
  setActiveRegistry(null);
});

/** The transcript, as rows. */
function rows(
  messages: Message[],
  opts: { status?: string; ask?: AskHandlers } = {},
): ChatRowView[] {
  return projectRows({
    messages,
    status: opts.status ?? "idle",
    ...(opts.ask ? { ask: opts.ask } : {}),
  });
}

/** An assistant turn whose only tool call is a question. */
function asking(
  id: string,
  args: object,
  result?: { success: boolean; data?: unknown; error?: string },
): Message {
  return msg("assistant", "", {
    toolCalls: [
      {
        arguments: JSON.stringify(args),
        id,
        name: "ask_user",
        ...(result ? { result: result as never } : {}),
      },
    ],
  });
}

/** File a ledger entry against a message id, the way the agent loop does. */
function ledger(id: string, writes: { disk: boolean; ok: boolean; path: string }[]) {
  beginTurn(`for:${id}`);
  for (const w of writes) {
    recordWrite({ ...w, tool: "write_file" });
  }
  endTurn(id);
}

describe("helpers", () => {
  test("tryParseToolResult parses only tool-result JSON", () => {
    expect(tryParseToolResult('{"success":true}')).toEqual({ success: true });
    expect(tryParseToolResult('{"success":false,"error":"bad path"}')).toEqual({
      error: "bad path",
      success: false,
    });
    expect(tryParseToolResult("not json")).toBeNull();
    expect(tryParseToolResult('{"other":1}')).toBeNull();
  });

  test("formatToolLabel includes the target path when present", () => {
    expect(formatToolLabel({ arguments: '{"path":["children",0]}', name: "set_prop" })).toBe(
      'set_prop: ["children",0]',
    );
    expect(formatToolLabel({ arguments: '{"parentPath":[]}', name: "add_child" })).toBe(
      "add_child: []",
    );
    expect(formatToolLabel({ arguments: "{partial", name: "add_child" })).toBe("add_child");
    expect(formatToolLabel({ arguments: "", name: "list" })).toBe("list");
  });

  test("formatErrorAdvice maps common failures to recovery hints", () => {
    expect(formatErrorAdvice("HTTP 401 unauthorized")).toContain("API key");
    expect(formatErrorAdvice("Network error while fetching")).toContain("dev server");
    expect(formatErrorAdvice("429 rate limit exceeded")).toContain("rate limit");
    expect(formatErrorAdvice("500 internal server error")).toContain("server error");
    expect(formatErrorAdvice("something exotic")).toBe("");
  });
});

describe("the context budget", () => {
  /*
   * `services/context-manager.ts` has computed the token count and the warning flag on every turn
   * since it was written, and `chat-state.ts` has stored them, and NOTHING read either. Plan §11.6:
   * "Context budget manager → tokenCount / contextWarning actually rendered". A conversation was
   * silently trimmed, the assistant forgot what you told it ten turns ago, and the two numbers that
   * would have explained why sat in the store.
   */
  test("the count is compact — a four-digit number in a 28px header is noise", () => {
    expect(tokenLabel(18_400)).toBe("18.4k");
    expect(tokenLabel(940)).toBe("940");
  });

  test("the tooltip says what happens next, not just that a number is large", () => {
    expect(tokenHint(18_400, false)).toContain("18,400 tokens");
    expect(tokenHint(96_000, true)).toContain("oldest turns are dropped");
  });
});

describe("projectCommand", () => {
  test("a record projects to a button wearing its own name and chord", () => {
    const history = projectCommand("assistant.history", { icon: "clock-counter-clockwise" })!;
    expect(history.id).toBe("assistant.history");
    expect(history.key).toBe("assistant.history");
    expect(history.label).toBe("Chat History");
    expect(history.hint).toBe("Chat History (⌘⇧H)");
    expect(history.icon).toBe("clock-counter-clockwise");
    expect(history.disabled).toBe(false);
  });

  test("a refused record projects disabled, with the sentence it requires", () => {
    ctx = makeContext({ ai: { configured: false } });
    const retry = projectCommand("assistant.retry", { text: "Retry" })!;
    expect(retry.disabled).toBe(true);
    expect(retry.hint).toBe("Retry Last Message — requires a connected AI provider");
    expect(retry.text).toBe("Retry");
  });

  test("a command the registry does not hold projects nothing — not a dead button", () => {
    setActiveRegistry(buildRegistry(["assistant.history"]));
    expect(projectCommand("assistant.history")).not.toBeNull();
    expect(projectCommand("assistant.newChat")).toBeNull();

    // And with no registry at all — the frame the app paints before its bootstrap composes one.
    setActiveRegistry(null);
    expect(projectCommand("assistant.history")).toBeNull();
    expect(projectCommands([projectCommand("assistant.newChat")])).toEqual([]);
  });
});

describe("projectRows", () => {
  test("an empty chat projects no rows — the surface draws its own hint", () => {
    expect(rows([])).toEqual([]);
  });

  test("user messages carry their body; attached context becomes chips", () => {
    const plain = msg("user", "hello there");
    const withContext = msg(
      "user",
      `restyle this\n\n${ATTACHED_CONTEXT_DELIMITER}\nPage: pages/index.json\nSelected element at ["children",0]: <h1> "Hi"`,
    );
    const projected = rows([plain, withContext]);
    expect(projected.map((r) => r.kind)).toEqual(["user", "user"]);
    expect(projected[0]!.body).toBe("hello there");
    expect(projected[0]!.hasContextChips).toBe(false);
    expect(projected[1]!.body).toBe("restyle this");
    expect(projected[1]!.contextChips.map((c) => c.label)).toEqual([
      "Page: pages/index.json",
      'Selected element at ["children",0]: <h1> "Hi"',
    ]);
  });

  test("assistant messages carry markdown and tool chips; empty ones are skipped", () => {
    const withText = msg("assistant", "Use **bold** text");
    const withTool = msg("assistant", "", {
      toolCalls: [{ arguments: '{"path":["children",1]}', id: "c1", name: "set_prop" }],
    });
    const empty = msg("assistant", "");
    const projected = rows([withText, withTool, empty]);
    expect(projected).toHaveLength(2);
    expect(projected[0]!.markdown).toContain("<strong>bold</strong>");
    expect(projected[1]!.chips[0]!.label).toBe('set_prop: ["children",1]');
    expect(projected[1]!.hasChips).toBe(true);
  });

  test("tool messages surface failures only", () => {
    const ok = msg("tool", '{"success":true}', { toolCallId: "c1" });
    const failed = msg("tool", '{"success":false,"error":"path not found"}', { toolCallId: "c2" });
    const projected = rows([ok, failed]);
    expect(projected).toHaveLength(1);
    expect(projected[0]!.kind).toBe("tool-error");
    expect(projected[0]!.body).toContain("path not found");
  });

  test("the streaming tail is plain text; earlier messages are finalized markdown", () => {
    const finalized = msg("assistant", "**done**");
    const tail = msg("assistant", "**partial");
    const projected = rows([finalized, tail], { status: "streaming" });
    expect(projected[0]!.kind).toBe("assistant");
    expect(projected[0]!.markdown).toContain("<strong>done</strong>");
    // The tail stayed literal: markdown parses once, on finalize.
    expect(projected[1]!.kind).toBe("streaming");
    expect(projected[1]!.body).toBe("**partial");
    expect(projected[1]!.markdown).toBe("");
  });

  test("an empty streaming tail is the typing indicator, not an empty assistant row", () => {
    const projected = rows([msg("user", "hi"), msg("assistant", "")], { status: "streaming" });
    expect(projected.map((r) => r.kind)).toEqual(["user", "typing"]);
  });

  test("the key is the message id, so a token appended never re-keys the list", () => {
    const user = msg("user", "hi");
    const tail = msg("assistant", "one");
    const first = rows([user, tail], { status: "streaming" }).map((r) => r.key);
    tail.content = "one two";
    const second = rows([user, tail], { status: "streaming" }).map((r) => r.key);
    expect(second).toEqual(first);
    // And the same key survives the stream finishing, though the row changes shape.
    expect(rows([user, tail]).map((r) => r.key)).toEqual(first);
  });
});

// ─── §7.4: the three things the renderer would not say ───────────────────────

describe("tool chips carry outcomes", () => {
  test("toolOutcome/toolOutcomeText read the result the loop has always populated", () => {
    expect(toolOutcome({ arguments: "{}", id: "1", name: "x" })).toBe("pending");
    expect(toolOutcomeText({ arguments: "{}", id: "1", name: "x" })).toBe("");
    const ok = { arguments: "{}", id: "1", name: "x", result: { success: true, summary: "Done." } };
    expect(toolOutcome(ok)).toBe("ok");
    expect(toolOutcomeText(ok)).toBe("Done.");
    const bad = { arguments: "{}", id: "1", name: "x", result: { error: "Nope.", success: false } };
    expect(toolOutcome(bad)).toBe("failed");
    expect(toolOutcomeText(bad)).toBe("Nope.");
  });

  test("a chip says what became of the call, not only what was called", () => {
    resetAiWrites();
    const projected = rows([
      msg("assistant", "", {
        toolCalls: [
          {
            arguments: "{}",
            id: "a",
            name: "update_style",
            result: { success: true, summary: "Set padding." },
          },
          {
            arguments: "{}",
            id: "b",
            name: "remove_node",
            result: { error: "No such path.", success: false },
          },
          { arguments: "{}", id: "c", name: "read_file" },
        ],
      }),
    ]);
    const { chips } = projected[0]!;
    expect(chips.map((c) => c.outcome)).toEqual(["ok", "failed", "pending"]);
    expect(chips[0]!.outcomeText).toBe("Set padding.");
    expect(chips[0]!.mark).toBe("✓");
    expect(chips[1]!.outcomeText).toBe("No such path.");
    expect(chips[1]!.mark).toBe("✗");
    // A call still in flight claims nothing.
    expect(chips[2]!.outcomeState).toBe("hidden");
    // The reconcile key is the tool-call id, so a settling call keeps its own node.
    expect(chips.map((c) => c.key)).toEqual(["a", "b", "c"]);
  });
});

describe("changed-files summary", () => {
  test('a turn that changed nothing projects no summary — never "Changed 0 files"', () => {
    resetAiWrites();
    expect(rows([msg("assistant", "I looked at the page.")])[0]!.changesState).toBe("none");
  });

  test("the summary counts distinct files and names the disk writes undo cannot reach", () => {
    resetAiWrites();
    const m = msg("assistant", "Done.");
    ledger(m.id, [
      { disk: false, ok: true, path: "pages/index.json" },
      { disk: true, ok: true, path: "layouts/base.json" },
    ]);
    const row = rows([m])[0]!;
    expect(row.changesState).toBe("list");
    expect(row.changesSummary).toContain("Changed 2 files");
    expect(row.changesSummary).toContain("undo cannot reach it");
    const disk = row.changes.find((c) => c.disk)!;
    expect(disk.path).toBe("layouts/base.json");
  });

  test("Restore to here is offered only when every change was transactional", () => {
    resetAiWrites();
    const transactional = msg("assistant", "A.");
    ledger(transactional.id, [{ disk: false, ok: true, path: "pages/index.json" }]);
    const withDisk = msg("assistant", "B.");
    ledger(withDisk.id, [{ disk: true, ok: true, path: "pages/other.json" }]);
    const projected = rows([transactional, withDisk]);
    expect(projected[0]!.canRestore).toBe(true);
    expect(projected[1]!.canRestore).toBe(false);
    // Both still say what they changed; only the button is withheld.
    expect(projected[1]!.changesState).toBe("list");
  });

  test("a turn where every write failed says so instead of claiming files", () => {
    resetAiWrites();
    const m = msg("assistant", "A.");
    ledger(m.id, [{ disk: true, ok: false, path: "pages/index.json" }]);
    const row = rows([m])[0]!;
    expect(row.changesSummary).toContain("1 change failed");
    expect(row.changes[0]!.ok).toBe(false);
    expect(row.changes[0]!.note).toContain("failed");
  });
});

describe("every id the assistant names is one the real app declares", () => {
  /* The status bar's bargain (`tests/statusbar.test.ts`), for the assistant: `projectCommand`
     projects NOTHING for an id the registry does not hold, so a rename on the other side would
     leave these three buttons permanently absent with no test failing — which is exactly how
     `collab.showStatus` sat unrendered behind a comment claiming it was fine. */
  test("the header's and the error row's command ids resolve", async () => {
    const { appCommandSet } = await import("../src/commands/app-commands");
    const declared = new Set(appCommandSet().map((c) => c.id));
    const source = readFileSync(new URL("../src/panels/ai-panel.ts", import.meta.url), "utf8");
    const named = [...source.matchAll(/projectCommand\("([\w.]+)"/g)].map((m) => m[1] as string);
    expect(named).toEqual(["assistant.newChat", "assistant.history", "assistant.retry"]);
    expect(named.filter((id) => !declared.has(id))).toEqual([]);
  });
});

describe("the question card", () => {
  test("carries the question, its context and its options", () => {
    const row = rows(
      [asking("q1", { context: "3 look alike", options: ["Merge", "Keep"], question: "Which?" })],
      { ask: { pendingId: "q1" } },
    )[0]!;
    const chip = row.chips[0]!;
    // A gears chip would be the wrong shape for the one row that will not proceed without a reader.
    expect(chip.kind).toBe("ask");
    expect(chip.question).toBe("Which?");
    expect(chip.context).toBe("3 look alike");
    expect(chip.hasContext).toBe(true);
    expect(chip.askState).toBe("pending");
    expect(chip.options.map((o) => o.label)).toEqual(["Merge", "Keep"]);
  });

  test("You decide is always offered, even with no options — the card draws it unconditionally", () => {
    const chip = rows([asking("q1", { question: "Which?" })], { ask: { pendingId: "q1" } })[0]!
      .chips[0]!;
    expect(chip.askState).toBe("pending");
    expect(chip.options).toEqual([]);
  });

  test("an answered question shows the answer and offers no buttons", () => {
    const chip = rows([
      asking(
        "q1",
        { options: ["Merge"], question: "Which?" },
        { data: { answer: "Neither", skipped: false }, success: true },
      ),
    ])[0]!.chips[0]!;
    expect(chip.askState).toBe("answered");
    expect(chip.answer).toBe("Neither");
  });

  test("a skipped question says so rather than showing an empty answer", () => {
    const chip = rows([
      asking(
        "q1",
        { question: "Which?" },
        { data: { answer: null, skipped: true }, success: true },
      ),
    ])[0]!.chips[0]!;
    expect(chip.answer).toBe("You decide");
  });

  test("a failed question carries its reason", () => {
    const chip = rows([
      asking("q1", { question: "Which?" }, { error: "the turn was stopped", success: false }),
    ])[0]!.chips[0]!;
    expect(chip.askState).toBe("failed");
    expect(chip.outcomeText).toContain("the turn was stopped");
  });

  test("a question left open by a reload is inert, and says why", () => {
    /* The promise lives in memory and the transcript does not. Without this the restored card is
       indistinguishable from a live one and waits on a loop that is gone. */
    const chip = rows([asking("q1", { options: ["Merge"], question: "Which?" })], {
      ask: { pendingId: null },
    })[0]!.chips[0]!;
    expect(chip.outcome).toBe("unanswered");
    expect(chip.askState).toBe("unanswered");
  });

  test("a half-streamed question falls back to an ordinary chip", () => {
    // Arguments arrive as fragments, so a chip can be asked to draw a call whose JSON is unfinished.
    const half = msg("assistant", "Let me check", {
      toolCalls: [{ arguments: '{"question":"Whi', id: "q1", name: "ask_user" }],
    });
    const chip = rows([half], { status: "streaming" })[0]!.chips[0]!;
    expect(chip.kind).toBe("chip");
    expect(chip.askState).toBe("none");
  });

  test("the streaming tail carries a question too", () => {
    /* In the real loop `finishStream` runs BEFORE tools execute, so a live question is drawn by the
       settled-message path. The tail still has to handle one: the model may write text, emit the
       call, and have the round end while this row is the tail. */
    const tail = msg("assistant", "One thing first.", {
      toolCalls: [
        { arguments: JSON.stringify({ question: "Which?" }), id: "q1", name: "ask_user" },
      ],
    });
    const row = rows([tail], { ask: { pendingId: "q1" }, status: "streaming" })[0]!;
    expect(row.kind).toBe("streaming");
    expect(row.chips[0]!.question).toBe("Which?");
  });
});

describe("parseAsk", () => {
  /** Read a question out of the arguments an `ask_user` call would carry. */
  function ask(args: object | string) {
    const encoded = typeof args === "string" ? args : JSON.stringify(args);
    return parseAsk({ arguments: encoded, id: "q", name: "ask_user" });
  }

  test("reads a question, its options and its context", () => {
    expect(ask({ context: "c", options: ["a"], question: "Q" })).toEqual({
      context: "c",
      options: ["a"],
      question: "Q",
    });
  });

  test("tolerates unfinished and malformed JSON", () => {
    expect(ask('{"question":"Q')).toBeNull();
    expect(ask("")).toBeNull();
  });

  test("refuses a call with no question to show", () => {
    expect(ask({})).toBeNull();
    expect(ask({ question: "   " })).toBeNull();
    expect(ask({ question: 42 })).toBeNull();
  });

  test("drops non-string options and a non-array options field", () => {
    expect(ask({ options: ["a", 1, ""], question: "Q" })?.options).toEqual(["a"]);
    expect(ask({ options: "nope", question: "Q" })?.options).toEqual([]);
    expect(ask({ context: 9, question: "Q" })?.context).toBe("");
  });
});

describe("a running import, under the chip that started it", () => {
  /** An assistant turn whose tool call is an import, optionally already settled. */
  function importing(result?: { success: boolean; summary?: string }): Message {
    return msg("assistant", "", {
      toolCalls: [
        {
          arguments: JSON.stringify({ url: "https://example.com" }),
          id: "run1",
          name: "import_site",
          ...(result ? { result: result as never } : {}),
        },
      ],
    });
  }

  const RECORD = {
    current: null,
    directory: "/home/dev/Sites/example",
    error: "",
    id: "run1",
    log: [
      { message: "Launching browser...", phase: "launch" },
      { message: "Crawled 3 pages", phase: "crawl" },
    ],
    message: "Crawled 3 pages",
    phase: "crawl",
    status: "running" as const,
    total: null,
    url: "https://example.com/",
    warnings: [],
  };

  test("carries the phase, the latest line and the log", () => {
    /* An import reports for minutes. It used to report into the New Project modal, which meant a
       successful run destroyed its own account of what it did at the moment it handed off. */
    const chip = rows([importing()], { ask: { importRun: () => RECORD, pendingId: null } })[0]!
      .chips[0]!;
    expect(chip.importState).toBe("run");
    expect(chip.importMessage).toBe("Crawled 3 pages");
    expect(chip.importPhase).toBe("crawl");
    expect(chip.hasPhase).toBe(true);
    expect(chip.importLog).toHaveLength(2);
    expect(chip.importSpinner).toBe("busy");
    // A running import is open; the reader should not have to ask for the thing they are waiting on.
    expect(chip.importOpen).toBe(true);
  });

  test("a phase that counts draws a determinate bar", () => {
    const chip = rows([importing()], {
      ask: { importRun: () => ({ ...RECORD, current: 5, total: 20 }), pendingId: null },
    })[0]!.chips[0]!;
    expect(chip.importSpinner).toBe("progress");
    expect(chip.importProgress).toBe("25");
  });

  test("carries the whole retained log, not a fixed tail of it", () => {
    /* The log was sliced to the last six lines, so a run that reported forty steps showed six and
       silently dropped the rest — including every warning above the cut. It is a scroller now, and
       what it scrolls is everything the store still holds. */
    const log = Array.from({ length: 40 }, (_, i) => ({ message: `step ${i}`, phase: "crawl" }));
    const chip = rows([importing()], {
      ask: { importRun: () => ({ ...RECORD, log }), pendingId: null },
    })[0]!.chips[0]!;
    expect(chip.importLog).toHaveLength(40);
    expect(chip.importCount).toBe("40");
    // Keyed by index AND phase, so a line arriving never re-keys the ones above it.
    expect(chip.importLog[0]!.key).toBe("0:crawl");
  });

  test("a settled import KEEPS its log, collapsed, and says how it ended", () => {
    /* The record used to be fetched only while the call was pending, so a successful import
       destroyed its own account of itself at the moment it succeeded — the same failure the
       hand-off from the wizard to the assistant was made to fix, one layer in. */
    const chip = rows([importing({ success: true, summary: "Imported example.com" })], {
      ask: { importRun: () => ({ ...RECORD, status: "done" as const }) },
    })[0]!.chips[0]!;
    expect(chip.importState).toBe("run");
    expect(chip.importOpen).toBe(false);
    expect(chip.importLog).toHaveLength(2);
    expect(chip.importMessage).toContain("https://example.com/");
    // No spinner on a run that is over.
    expect(chip.importSpinner).toBe("none");
    expect(chip.outcomeText).toContain("Imported");
  });

  test("a failed run says why, where the outcome would have been", () => {
    const chip = rows([importing({ success: false, summary: "boom" })], {
      ask: {
        importRun: () => ({
          ...RECORD,
          error: "Chrome would not launch",
          status: "failed" as const,
        }),
      },
    })[0]!.chips[0]!;
    expect(chip.importMessage).toContain("Chrome would not launch");
  });

  test("a stopped run says so rather than looking like a failure", () => {
    const chip = rows([importing({ success: false, summary: "stopped" })], {
      ask: { importRun: () => ({ ...RECORD, status: "stopped" as const }) },
    })[0]!.chips[0]!;
    expect(chip.importMessage).toBe("Import stopped");
  });

  test("a host with no run record simply draws the chip", () => {
    // The evals runner and the screenshot seeder project transcripts with no import store at all.
    const chip = projectChip({
      arguments: "{}",
      id: "run1",
      name: "import_site",
    });
    expect(chip.importState).toBe("none");
    expect(chip.kind).toBe("chip");
  });
});
