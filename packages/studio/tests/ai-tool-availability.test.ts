/**
 * The assistant's tool availability matrix (specs/ai.md §3.6 and §3.10), frozen in
 * `fixtures/ai-tool-availability.json`.
 *
 * For each Studio state the golden records which tools the model is offered (by name, and the exact
 * bytes of the listing it is sent, as a digest) and the sentence a call to each gated hand tool is
 * refused with. It was recorded from the composition the assistant used before tool membership
 * became a catalog, so it is the proof that the catalog advertises and refuses exactly as that
 * did.
 *
 * A red golden means availability moved: if that was the intent, re-record with
 * `JX_UPDATE_GOLDENS=1 bun test --isolate tests/ai-tool-availability.test.ts` and review the diff.
 */
import "./with-dom.ts";
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fromOpenAITools } from "@jxsuite/ai/messages";
import { createToolRegistry } from "@jxsuite/ai/tools";
import type { ToolRegistry } from "@jxsuite/ai/tools";
import { setActiveRegistry } from "../src/commands/active-registry";
import { appCommandSet } from "../src/commands/app-commands";
import { makeContext } from "../src/commands/context";
import type { CommandContextPatch } from "../src/commands/context";
import { createCommandRegistry } from "../src/commands/registry";
import { setExtensionCatalog } from "../src/format/format-host";
import { registerAskTool } from "../src/services/ai-ask";
import { createCommandToolRegistry } from "../src/services/ai-command-tools";
import { registerImportTools } from "../src/services/ai-import-tools";
import { registerProjectTools } from "../src/services/ai-project-tools";
import { AI_TOOL_TIERS } from "../src/services/ai-system-prompt";
import type { AiToolState } from "../src/services/ai-system-prompt";
import { registerAiTools } from "../src/services/ai-tools";
import { assistantToolRegistry } from "../src/services/harness/assistant-tools";
import { setProjectState } from "../src/store";
import type { ProjectState } from "../src/types";
import { matchGolden } from "./harness/trace-recorder";

interface StudioState {
  name: string;
  tools: AiToolState;
  context: CommandContextPatch;
  /** Whether the extension catalogue has an entry, which decides `enable_extension`'s enum. */
  catalogue: boolean;
}

const OPEN_PROJECT = { isMultilingual: true, isRepo: true, isSite: true, open: true };
const ON_CANVAS: CommandContextPatch = {
  document: { open: true },
  editor: { kind: "canvas" },
  project: OPEN_PROJECT,
  selection: { count: 1, paths: [["children", 0]] },
};

const STATES: StudioState[] = [
  {
    catalogue: true,
    context: {},
    name: "an empty window",
    tools: { canImport: true, hasDocument: false, hasProject: false, treeEditable: false },
  },
  {
    catalogue: true,
    context: {},
    name: "an empty window with no import backend",
    tools: { canImport: false, hasDocument: false, hasProject: false, treeEditable: false },
  },
  {
    catalogue: true,
    context: { project: OPEN_PROJECT },
    name: "a project with no document",
    tools: { canImport: true, hasDocument: false, hasProject: true, treeEditable: false },
  },
  {
    catalogue: true,
    context: ON_CANVAS,
    name: "a document on the canvas",
    tools: { canImport: true, hasDocument: true, hasProject: true, treeEditable: true },
  },
  {
    catalogue: true,
    context: { document: { open: true }, editor: { kind: "code" }, project: OPEN_PROJECT },
    name: "a document in Code view",
    tools: { canImport: true, hasDocument: true, hasProject: true, treeEditable: false },
  },
  {
    catalogue: true,
    context: { document: { open: true }, editor: { kind: "canvas" } },
    name: "a single file with no project",
    tools: { canImport: true, hasDocument: true, hasProject: false, treeEditable: true },
  },
  {
    catalogue: false,
    context: ON_CANVAS,
    name: "a document on the canvas with no extension catalogue",
    tools: { canImport: true, hasDocument: true, hasProject: true, treeEditable: true },
  },
];

afterEach(() => {
  setActiveRegistry(null);
  setExtensionCatalog([]);
});

/** A project with no extension enabled, so `disable_extension` has nothing it could take. */
const NO_EXTENSIONS: string[] = [];

/** The hand tools, registered the way the document assistant registers them. */
function handTools(): ToolRegistry {
  const hand = createToolRegistry();
  registerAskTool(hand);
  registerAiTools(hand, { getTab: () => null, validate: async () => [] });
  registerImportTools(hand, {});
  registerProjectTools(hand, {
    adoptProject: async () => {},
    findOpenTab: () => null,
    reloadTab: async () => {},
    validate: async () => [],
  });
  return hand;
}

/** The assistant's registry in `state`, with a command registry whose context is the state's. */
function assistantIn(state: StudioState): ToolRegistry {
  setExtensionCatalog(
    state.catalogue
      ? [{ name: "@jxsuite/parser", sections: [{ key: "content" }], source: "first-party" }]
      : [],
  );
  /* SAFETY: a deliberately partial project, the shape `resetStudioState` installs; the tool modules
     read only `projectState?.projectConfig`. */
  setProjectState({
    dirs: new Map(),
    expanded: new Set(),
    projectConfig: { extensions: NO_EXTENSIONS },
  } as ProjectState);
  const commands = createCommandRegistry({ getContext: () => makeContext(state.context) });
  commands.registerAll(appCommandSet());
  setActiveRegistry(commands);
  return assistantToolRegistry(
    handTools(),
    createCommandToolRegistry({ getTab: () => null, validate: async () => [] }),
    () => state.tools,
  );
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

test("each studio state offers and refuses the tools in the golden", async () => {
  const matrix: Record<string, { offered: string[]; listing: string; refusals: string[] }> = {};
  for (const state of STATES) {
    const registry = assistantIn(state);
    const listed = registry.listForLLM();
    const offered = fromOpenAITools(listed).map((spec) => spec.name);
    const refusals: string[] = [];
    for (const { name } of AI_TOOL_TIERS) {
      if (!offered.includes(name)) {
        // A gated hand tool is refused before it runs, so calling it here has no effect.
        const result = await registry.execute(name, {});
        refusals.push(`${name}: ${result.error}`);
      }
    }
    matrix[state.name] = { listing: digest(JSON.stringify(listed)), offered, refusals };
  }
  matchGolden(resolve(import.meta.dir, "fixtures", "ai-tool-availability.json"), matrix);
});

test("a name no tool has is unknown in every state", async () => {
  const registry = assistantIn(STATES[3]!);
  expect(await registry.execute("no_such_tool", {})).toEqual({
    error: 'Unknown tool: "no_such_tool"',
    success: false,
  });
  expect(registry.getDefinition("no_such_tool")).toBeUndefined();
  expect(registry.validate("no_such_tool", {})).toEqual({
    errors: ['Unknown tool: "no_such_tool"'],
    valid: false,
  });
});
