/**
 * Tests for src/services/ai-system-prompt.ts — the dynamic system prompt builder.
 *
 * BuildSystemPrompt() assembles a large prompt from static reference sections plus optional context
 * (open document, project config, components). These tests drive every optional section so the
 * document summary (element tree, typed state, imported elements) and project summary (tokens,
 * components, breakpoints) branches are all exercised.
 */
import "./with-dom.ts";
import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "../src/services/ai-system-prompt";
import type { ComponentEntry } from "../src/files/components";
import type { JxMutableNode, ProjectConfig } from "@jxsuite/schema/types";

describe("ai-system-prompt — buildSystemPrompt", () => {
  test("emits the static core sections with no context", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("expert Jx builder assistant");
    expect(prompt).toContain("## Error Recovery");
    expect(prompt).not.toContain("## Current Document");
    expect(prompt).not.toContain("## Project Context");
  });

  test("summarizes the open document: element tree, typed state, and imported elements", () => {
    const document = {
      $elements: ["my-button", { $ref: "site-card" }, {}],
      $id: "DemoPage",
      children: [
        { tagName: "h1", textContent: "Title" },
        { children: [{ tagName: "span", textContent: "x" }], tagName: "section" },
      ],
      state: {
        count: 5, // Scalar (number)
        dataSrc: { $prototype: "Data", url: "/api" }, // Data source
        flag: null, // Non-object → typeof
        greet: { $prototype: "Function", body: "return 1" }, // Function
        label: "hello", // Non-object string → typeof
        scalarObj: {}, // Object with no markers → "Scalar"
        typed: { type: "number" }, // Typed (number)
      },
      tagName: "div",
    } as unknown as JxMutableNode;

    const prompt = buildSystemPrompt({ document });
    expect(prompt).toContain("## Current Document");
    expect(prompt).toContain("Document: DemoPage");
    expect(prompt).toContain("Element tree");
    expect(prompt).toContain("State keys (7)");
    expect(prompt).toContain("Function");
    expect(prompt).toContain("Data source");
    expect(prompt).toContain("Typed (number)");
    expect(prompt).toContain("Scalar");
    expect(prompt).toContain("Imported elements:");
    expect(prompt).toContain("my-button");
    expect(prompt).toContain("site-card");
    expect(prompt).toContain("(unknown)");
  });

  test("an unnamed document with no state or imports still summarizes", () => {
    const document = {
      children: [{ tagName: "p", textContent: "hi" }],
      tagName: "div",
    } as unknown as JxMutableNode;
    const prompt = buildSystemPrompt({ document });
    expect(prompt).toContain("Document: (unnamed)");
    expect(prompt).not.toContain("State keys");
    expect(prompt).not.toContain("Imported elements");
  });

  test("summarizes project context: name, root, components, tokens, and breakpoints", () => {
    const projectConfig = {
      $media: { lg: "min-width: 1200px", sm: "max-width: 600px" },
      name: "Demo Site",
      style: {
        "--color-accent": "#ff0000",
        "--font-body": "Inter",
        "--radius-md": "8px", // "other" token group
        notAToken: "ignored", // Not a -- token → filtered out
      },
    } as unknown as ProjectConfig;

    const components = [
      { $id: "Card", path: "components/card.json", tagName: "my-card" },
      { path: "components/nav.json", tag: "my-nav" }, // Tag fallback
      { name: "thing-widget" }, // Name fallback
      { path: "components/orphan.json" }, // Path fallback, no $id
    ] as unknown as ComponentEntry[];

    const prompt = buildSystemPrompt({
      components,
      projectConfig,
      projectRoot: "/projects/demo",
    });

    expect(prompt).toContain("## Project Context");
    expect(prompt).toContain("Project: Demo Site");
    expect(prompt).toContain("Root: /projects/demo");
    expect(prompt).toContain("Available components");
    expect(prompt).toContain("<my-card> — Card (components/card.json)");
    expect(prompt).toContain("<my-nav>");
    expect(prompt).toContain("<thing-widget>");
    expect(prompt).toContain("Design tokens");
    expect(prompt).toContain("--color-accent: #ff0000");
    expect(prompt).toContain("--font-body: Inter");
    expect(prompt).toContain("--radius-md: 8px");
    expect(prompt).not.toContain("notAToken");
    expect(prompt).toContain("Responsive breakpoints");
  });

  test("a context-less but truthy project config yields no Project Context section", () => {
    const prompt = buildSystemPrompt({ projectConfig: {} as unknown as ProjectConfig });
    expect(prompt).not.toContain("## Project Context");
  });
});

describe("ai-system-prompt — state-aware modes", () => {
  test("no-project mode offers bootstrap tools only, keeping the static Jx knowledge", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("No project is open yet");
    expect(prompt).toContain("create_project(");
    expect(prompt).toContain("list_starters()");
    // No file or document tools are advertised…
    expect(prompt).not.toContain("- list_files(");
    expect(prompt).not.toContain("- set_property(");
    // …but the schema/pattern sections stay so the model can plan starter content.
    expect(prompt).toContain("## Jx Document Format");
    expect(prompt).toContain("## Design Principles");
  });

  test("project mode (no document) advertises the cross-file workflow", () => {
    const prompt = buildSystemPrompt({ projectRoot: "/proj" });
    expect(prompt).toContain("no document is on the canvas");
    expect(prompt).toContain("- list_files(");
    expect(prompt).toContain("- write_file(");
    /* `open_document` is no longer a hand row: it is the projection of `document.open`, so it
       reaches the prompt through `commandTools` (the next block) and not through the tier table.
       The workflow prose still names it, so the model is steered to a tool the record advertises. */
    expect(prompt).not.toContain("- open_document(");
    expect(prompt).toContain("Use open_document only when");
    expect(prompt).not.toContain("- create_project(");
    expect(prompt).not.toContain("- set_property(");
  });

  test("document mode lists document AND file tools", () => {
    const prompt = buildSystemPrompt({
      document: { children: [], tagName: "div" } as unknown as JxMutableNode,
      projectRoot: "/proj",
    });
    expect(prompt).toContain("- set_property(");
    expect(prompt).toContain("- read_file(");
    expect(prompt).not.toContain("- create_project(");
    expect(prompt).toContain("## Current Document");
  });

  test("file inventory renders in project mode and caps at 100 entries", () => {
    const fileInventory = Array.from({ length: 120 }, (_, i) => `pages/p${i}.json`);
    const prompt = buildSystemPrompt({ fileInventory, projectRoot: "/proj" });
    expect(prompt).toContain("## Project Files");
    expect(prompt).toContain("pages/p0.json");
    expect(prompt).toContain("pages/p99.json");
    expect(prompt).not.toContain("pages/p100.json");
    expect(prompt).toContain("and 20 more");
    // Without a project the inventory is omitted even if passed.
    expect(buildSystemPrompt({ fileInventory })).not.toContain("## Project Files");
  });
});

describe("ai-system-prompt — tool-table/gating consistency", () => {
  test("the prompt names the extensions the project has enabled", () => {
    // BuildProjectSummary has always received `extensions` and dropped it, so a model working in a
    // Parser project was never told parser was on.
    const prompt = buildSystemPrompt({
      projectConfig: { extensions: ["@jxsuite/parser"], name: "Site" },
      projectRoot: "/site",
    });
    expect(prompt).toContain("Extensions enabled: @jxsuite/parser");
  });

  test("the catalogue lists each entry with what it contributes, marking the enabled ones", () => {
    const prompt = buildSystemPrompt({
      extensionCatalog: [
        {
          description: "File-based content collections",
          name: "@jxsuite/parser",
          sections: ["content"],
          title: "Content & Markdown",
        },
        { name: "@jxsuite/feed", sections: ["feed"], title: "Feeds" },
      ],
      projectConfig: { extensions: ["@jxsuite/parser"], name: "Site" },
      projectRoot: "/site",
    });
    expect(prompt).toContain("@jxsuite/parser — Content & Markdown.");
    expect(prompt).toContain("Contributes: content.");
    expect(prompt).toContain("[enabled]");
    // The one that is NOT enabled must not be marked.
    expect(prompt).toContain("@jxsuite/feed — Feeds. Contributes: feed.");
    expect(prompt.split("@jxsuite/feed")[1]?.split("\n")[0]).not.toContain("[enabled]");
  });

  test("the guidance names capabilities, and only when there is a catalogue", () => {
    const withCatalog = buildSystemPrompt({
      extensionCatalog: [{ name: "@jxsuite/parser", sections: ["content"] }],
      projectConfig: { name: "Site" },
      projectRoot: "/site",
    });
    expect(withCatalog).toContain("schema error");
    expect(withCatalog).toContain("fails the build");
    // Capabilities, never packages: the mapping is the entry's own description.
    expect(withCatalog).toContain("a blog or any folder of Markdown");

    const without = buildSystemPrompt({ projectConfig: { name: "Site" }, projectRoot: "/site" });
    expect(without).not.toContain("Extensions available.");
  });

  test("a long catalogue is capped and says how much it dropped", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `@acme/ext-${i}`,
      sections: [`s${i}`],
    }));
    const prompt = buildSystemPrompt({
      extensionCatalog: many,
      projectConfig: { name: "Site" },
      projectRoot: "/site",
    });
    expect(prompt).toContain("@acme/ext-19");
    expect(prompt).not.toContain("@acme/ext-20");
    expect(prompt).toContain("and 10 more");
  });

  test("neither block appears without a project", () => {
    const prompt = buildSystemPrompt({
      extensionCatalog: [{ name: "@jxsuite/parser", sections: ["content"] }],
      hasProject: false,
      projectConfig: { extensions: ["@jxsuite/parser"], name: "Site" },
    });
    expect(prompt).not.toContain("Extensions available.");
    expect(prompt).not.toContain("Extensions enabled:");
  });

  /*
   * Parity, in BOTH directions, with counts. The assistant's tools are two kinds: the hand-registered
   * ones (`AI_TOOL_TIERS` is their table) and the projections of every command record that declares
   * `aiTool` (`services/ai-command-tools.ts` is their view). The hand names must be exactly the
   * tier table; the projected names must be exactly the declarations; the two sets must be
   * disjoint; and the composite must hold their sum — the count matters because
   * `ToolRegistry.register` only `console.warn`s on a duplicate name, so a hand tool that shadowed
   * a projection would otherwise vanish quietly.
   */
  test("hand tools are the tier table, projected tools are the declarations, and the two are disjoint", async () => {
    const { AI_TOOL_TIERS } = await import("../src/services/ai-system-prompt");
    const { createToolRegistry } = await import("@jxsuite/ai");
    const { registerAiTools } = await import("../src/services/ai-tools");
    const { registerProjectTools } = await import("../src/services/ai-project-tools");
    const { registerAskTool } = await import("../src/services/ai-ask");
    const { registerImportTools } = await import("../src/services/ai-import-tools");
    const { composeToolRegistries, createCommandToolRegistry } =
      await import("../src/services/ai-command-tools");
    const { appCommandSet } = await import("../src/commands/app-commands");
    const { createCommandRegistry } = await import("../src/commands/registry");
    const { makeContext } = await import("../src/commands/context");
    const { setActiveRegistry } = await import("../src/commands/active-registry");
    const { setExtensionCatalog } = await import("../src/format/format-host");
    const { setProjectState } = await import("../src/store");

    /* A project with an enabled extension and a catalogue behind it, so the two derived enums
       (`enable_extension`'s catalogue, `disable_extension`'s enabled set) are non-empty: a record
       whose required enum is empty is withheld from the round, and this test is about the full
       set the declarations project, not about that rule. */
    setExtensionCatalog([
      { name: "@jxsuite/parser", sections: [{ key: "content" }], source: "first-party" },
    ]);
    setProjectState({
      dirs: new Map(),
      expanded: new Set(),
      projectConfig: { extensions: ["@jxsuite/parser"] },
    } as never);

    const hand = createToolRegistry();
    registerAskTool(hand);
    registerImportTools(hand, { getTab: () => null });
    registerAiTools(hand, { getTab: () => null, validate: async () => [] });
    registerProjectTools(hand, {
      adoptProject: async () => {},
      findOpenTab: () => null,
      getTab: () => null,
      reloadTab: async () => {},
      validate: async () => [],
    });

    /* A permissive context — everything open, a spliceable selection on the canvas — so every
       projected record's gate holds and the view lists them all. */
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
      const composite = composeToolRegistries(hand, commands);

      const handNames = new Set(hand.list().map((t) => t.name));
      const tiered = new Set(AI_TOOL_TIERS.map((t) => t.name));
      expect([...handNames].toSorted()).toEqual([...tiered].toSorted());

      const projectedNames = new Set(commands.list().map((t) => t.name));
      const declared = new Set(appCommandSet().flatMap((c) => (c.aiTool ? [c.aiTool.name] : [])));
      expect([...projectedNames].toSorted()).toEqual([...declared].toSorted());

      expect([...handNames].filter((name) => projectedNames.has(name))).toEqual([]);
      expect(composite.list()).toHaveLength(handNames.size + projectedNames.size);
      // The counts the design was measured against: 19 hand rows, 9 projected records; then
      // `open_document` crossed from hand to record and `set_canvas_mode` was projected (#334).
      expect(handNames.size).toBe(18);
      expect(projectedNames.size).toBe(11);
    } finally {
      setActiveRegistry(null);
      setProjectState(null);
      setExtensionCatalog([]);
    }
  });

  test("the command-projected blurbs render under every workflow heading, and only when passed", () => {
    const line = "delete_node(paths) — Delete elements from the document as one undoable step.";
    const document = { children: [], tagName: "x-a" } as unknown as JxMutableNode;
    const states = [
      buildSystemPrompt({ commandTools: [line], hasProject: false }),
      buildSystemPrompt({ commandTools: [line], hasProject: true }),
      buildSystemPrompt({ commandTools: [line], document, hasProject: true }),
    ];
    for (const prompt of states) {
      expect(prompt).toContain(`- ${line}`);
      // After the hand tools, under the same heading — one list, not a second one.
      expect(prompt.indexOf("- ask_user(")).toBeLessThan(prompt.indexOf(`- ${line}`));
    }
    expect(buildSystemPrompt({ document, hasProject: true })).not.toContain("delete_node(");
  });
});

describe("the agent's gate is the human's gate", () => {
  /*
   * `Command.aiTool`'s contract, in `commands/registry.ts`, is "the human's gate and the agent's
   * gate stay one predicate". They were two. The registry's `selection.delete` / `duplicate` /
   * `moveUp` require `editor.kind === "canvas"` because the Outline renders whatever the active
   * tab's document is — with Project Settings open, that is `project.json` drawn as a layer tree.
   * The assistant's `document` tier asked only whether a tab existed, so in that exact state the
   * agent was advertised `remove_node` and `move_node` and executed them against the file that
   * defines the project, while the person's `delete_node` was refused.
   *
   * `remove_node` self-refused only the document ROOT (`path.length < 2`), which is a weaker test
   * than `structurallyEditable`, so a repeater template or a `$switch` case was removable by the
   * agent and not by the person. It is gone: deletion is `delete_node`, the projection of
   * `selection.delete` itself, so there is no second predicate left to drift. The seven hand
   * writers below remain, because each addresses a node by PATH with no command twin.
   */
  const TREE_WRITERS = [
    "add_child",
    "move_node",
    "set_property",
    "set_style",
    "set_text",
    "add_state",
    "update_state",
  ];

  test("every element-tree WRITER is document-tree; the read is not", async () => {
    const { AI_TOOL_TIERS } = await import("../src/services/ai-system-prompt");
    const tierOf = new Map(AI_TOOL_TIERS.map((t) => [t.name, t.tier]));
    for (const name of TREE_WRITERS) {
      expect([name, tierOf.get(name)]).toEqual([name, "document-tree"]);
    }
    // Reading a document you cannot restructure is still perfectly sensible.
    expect(tierOf.get("read_document")).toBe("document");
    // And the structural pair is not in this table at all: they are selection-level RECORDS.
    expect(tierOf.has("remove_node")).toBe(false);
    expect(tierOf.has("delete_node")).toBe(false);
  });

  test("delete_node and duplicate_node are projections of selection-level records", async () => {
    const { appCommandSet } = await import("../src/commands/app-commands");
    const byTool = new Map(
      appCommandSet().flatMap((c) => (c.aiTool ? [[c.aiTool.name, c] as const] : [])),
    );
    expect(byTool.get("delete_node")?.id).toBe("selection.delete");
    expect(byTool.get("delete_node")?.level).toBe("selection");
    expect(byTool.get("duplicate_node")?.id).toBe("selection.duplicate");
    expect(byTool.get("duplicate_node")?.level).toBe("selection");
  });

  test("with a document open but no tree to edit, the writers are inactive and the read is not", async () => {
    const { tierActive } = await import("../src/services/ai-system-prompt");
    const settingsOpen = { hasDocument: true, hasProject: true, treeEditable: false };
    expect(tierActive("document-tree", settingsOpen)).toBe(false);
    expect(tierActive("document", settingsOpen)).toBe(true);

    const canvasOpen = { hasDocument: true, hasProject: true, treeEditable: true };
    expect(tierActive("document-tree", canvasOpen)).toBe(true);
  });

  test("no document at all still refuses both, tree-editable or not", async () => {
    const { tierActive } = await import("../src/services/ai-system-prompt");
    const none = { hasDocument: false, hasProject: true, treeEditable: true };
    expect(tierActive("document-tree", none)).toBe(false);
    expect(tierActive("document", none)).toBe(false);
  });

  test("the prompt advertises exactly what the gate will honour", () => {
    // A model told about a tool that is then refused burns a round trip learning it. The prompt's
    // Filter and the gate's predicate are the same function over the same facts.
    const withTree = buildSystemPrompt({
      document: { children: [], tagName: "x-a" } as unknown as JxMutableNode,
      hasProject: true,
      treeEditable: true,
    });
    const withoutTree = buildSystemPrompt({
      document: { children: [], tagName: "x-a" } as unknown as JxMutableNode,
      hasProject: true,
      treeEditable: false,
    });
    for (const name of TREE_WRITERS) {
      expect([name, withTree.includes(`${name}(`)]).toEqual([name, true]);
      expect([name, withoutTree.includes(`${name}(`)]).toEqual([name, false]);
    }
    expect(withoutTree).toContain("read_document(");
  });
});

describe("the importSite capability gate", () => {
  test("a tier cannot express it, so `import_site` carries a capability", async () => {
    /* "No project is open" is exactly as true on cloud as anywhere else, and cloud ships no
       `importSite` — so the tool must be gated on the PAL, not on what happens to be open. */
    const { AI_TOOL_TIERS, toolActive } = await import("../src/services/ai-system-prompt");
    const importTool = AI_TOOL_TIERS.find((t) => t.name === "import_site")!;
    expect(importTool.tier).toBe("no-project");
    expect(importTool.capability).toBe("importSite");

    const bootstrapping = { hasDocument: false, hasProject: false, treeEditable: true };
    expect(toolActive(importTool, { ...bootstrapping, canImport: true })).toBe(true);
    expect(toolActive(importTool, { ...bootstrapping, canImport: false })).toBe(false);
    // The tier still applies on a platform that CAN import.
    expect(toolActive(importTool, { ...bootstrapping, canImport: true, hasProject: true })).toBe(
      false,
    );
  });

  test("a tool with no capability is unaffected by the platform's answer", async () => {
    const { AI_TOOL_TIERS, toolActive } = await import("../src/services/ai-system-prompt");
    const createTool = AI_TOOL_TIERS.find((t) => t.name === "create_project")!;
    const state = { canImport: false, hasDocument: false, hasProject: false, treeEditable: true };
    expect(toolActive(createTool, state)).toBe(true);
  });

  test("`ask_user` is active in every state, because a question is not gated on one", async () => {
    const { AI_TOOL_TIERS, tierActive, toolActive } =
      await import("../src/services/ai-system-prompt");
    const askTool = AI_TOOL_TIERS.find((t) => t.name === "ask_user")!;
    expect(askTool.tier).toBe("always");
    expect(
      tierActive("always", { hasDocument: false, hasProject: false, treeEditable: false }),
    ).toBe(true);
    expect(toolActive(askTool, { hasDocument: true, hasProject: true, treeEditable: true })).toBe(
      true,
    );
  });

  test("the prompt lists import_site only where it can be run", async () => {
    const prompts = await import("../src/services/ai-system-prompt");
    expect(prompts.buildSystemPrompt({})).toContain("import_site");
    const noImport = prompts.buildSystemPrompt({ canImport: false });
    expect(noImport).not.toContain("import_site(");
    // And the asking guidance is in every prompt, since ask_user always is.
    expect(noImport).toContain("Asking the user");
  });
});
