/**
 * Every-tool.ts — the assistant's whole tool set, built the way the document assistant builds it.
 *
 * Two kinds of tool reach the model: the hand-registered ones (`AI_TOOL_TIERS` is their table) and
 * the projections of every command record that declares `aiTool` (`services/ai-command-tools.ts`).
 * A test about the set as a whole needs both, every one advertised, so this builds them in the
 * richest state there is: a project with an enabled extension and a catalogue behind it (the two
 * derived enums are non-empty, so no record is withheld for an empty required enum), and a
 * permissive command context, everything open with a spliceable selection on the canvas.
 *
 * The caller's DOM test file imports `./with-dom.ts` first, as every such file must.
 */
import { createToolRegistry } from "@jxsuite/ai";
import { catalogRegistry, createCatalog } from "@jxsuite/ai/catalog";
import type { ToolRegistry } from "@jxsuite/ai/tools";
import { registerAiTools } from "../../src/services/ai-tools";
import { registerProjectTools } from "../../src/services/ai-project-tools";
import { registerAskTool } from "../../src/services/ai-ask";
import { registerImportTools } from "../../src/services/ai-import-tools";
import { createCommandToolRegistry } from "../../src/services/ai-command-tools";
import type { CommandToolRegistry } from "../../src/services/ai-command-tools";
import { appCommandSet } from "../../src/commands/app-commands";
import { createCommandRegistry } from "../../src/commands/registry";
import { makeContext } from "../../src/commands/context";
import { setActiveRegistry } from "../../src/commands/active-registry";
import { setExtensionCatalog } from "../../src/format/format-host";
import { setProjectState } from "../../src/store";
import type { ProjectState } from "../../src/types";

/** The three registries: the hand tools, the command view, and their union the model is shown. */
export interface EveryTool {
  hand: ToolRegistry;
  commands: CommandToolRegistry;
  composite: ToolRegistry;
}

/**
 * Run `fn` against every tool the assistant has, then put the window's state back.
 *
 * @param {(tools: EveryTool) => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withEveryTool<T>(fn: (tools: EveryTool) => T | Promise<T>): Promise<T> {
  setExtensionCatalog([
    { name: "@jxsuite/parser", sections: [{ key: "content" }], source: "first-party" },
  ]);
  /* SAFETY: a deliberately partial project, the same shape `resetStudioState` installs. The tool
     modules read only `projectState?.projectConfig` (ai-command-tools.ts derives the extension enum
     from its `extensions`, ai-project-tools.ts validates it), and the context the command view
     consults comes from `makeContext` below, never from this record. */
  setProjectState({
    dirs: new Map(),
    expanded: new Set(),
    projectConfig: { extensions: ["@jxsuite/parser"] },
  } as ProjectState);

  const hand = createToolRegistry();
  registerAskTool(hand);
  registerImportTools(hand, {});
  registerAiTools(hand, { getTab: () => null, validate: async () => [] });
  registerProjectTools(hand, {
    adoptProject: async () => {},
    findOpenTab: () => null,
    reloadTab: async () => {},
    validate: async () => [],
  });

  const registry = createCommandRegistry({
    getContext: () =>
      makeContext({
        document: { open: true },
        editor: { kind: "canvas" },
        project: { isMultilingual: true, isRepo: true, isSite: true, open: true },
        selection: { count: 1, paths: [["children", 0]] },
      }),
  });
  registry.registerAll(appCommandSet());
  setActiveRegistry(registry);
  try {
    const commands = createCommandToolRegistry({ getTab: () => null, validate: async () => [] });
    // One catalog of every member with no view over it, so every tool is offered at once.
    const composite = catalogRegistry(createCatalog(hand.list(), commands.members()));
    return await fn({ hand, commands, composite });
  } finally {
    setActiveRegistry(null);
    setProjectState(null);
    setExtensionCatalog([]);
  }
}
