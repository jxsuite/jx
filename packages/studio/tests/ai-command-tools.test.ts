/**
 * The assistant's command-projected tools — `services/ai-command-tools.ts` (issue 273).
 *
 * The invariant under test is "a declaration IS the tool": every command record that declares
 * `aiTool` is listed by the view, executes through `registry.run`, and is advertised exactly while
 * its own gate holds. It is checked two ways — the parity test in `ai-system-prompt.test.ts`
 * (declared names = projected names, disjoint from the hand tools, with counts) and the per-record
 * witness here, which proves for EACH record in `appCommandSet()` that a call reaches `run` by id
 * and passes the refusal back verbatim. The rest of this file is the bridge's own contract: the
 * level ladder, the parameters identity, the write witness, the ledger, the report shape, the
 * budget, and the closed set of records that wait on a person.
 */
import { installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CommandUnavailableError, createCommandRegistry } from "../src/commands/registry";
import type { AnyCommand, CommandRegistry } from "../src/commands/registry";
import { emptyContext, hasSelection, makeContext } from "../src/commands/context";
import type { CommandContext } from "../src/commands/context";
import { argsSchema, stringProperty } from "../src/commands/command-args";
import { setActiveRegistry } from "../src/commands/active-registry";
import { appCommandSet } from "../src/commands/app-commands";
import { selectionCommands } from "../src/canvas/canvas-render";
import { CHROME_BUDGET } from "../src/commands/budget";
import { AI_TOOL_TIERS } from "../src/services/ai-system-prompt";
import {
  SELECTOR,
  advertisedCommandTools,
  commandToolBlurbs,
  composeToolRegistries,
  createCommandToolRegistry,
} from "../src/services/ai-command-tools";
import { fileTurn } from "../src/services/ai-writes";
import { recordingContext } from "./harness/recording-context";
import { createToolContext } from "@jxsuite/ai/tools";
import { mutateUpdateProperty, transactDoc } from "../src/tabs/transact";
import { resetProjectConfigDocument } from "../src/tabs/project-config";
import { updateSiteConfig } from "../src/site-context";
import { refreshFormats, setExtensionCatalog, setExtensions } from "../src/format/format-host";
import { createToolRegistry } from "@jxsuite/ai";
import type { ProjectConfig } from "@jxsuite/schema/types";

/** The declarations the app ships, keyed by tool name. */
const DECLARED = new Map(
  appCommandSet().flatMap((c) => (c.aiTool ? [[c.aiTool.name, c] as const] : [])),
);

/** A registry over `appCommandSet()` whose context the test can move. */
function appRegistry(initial: CommandContext = emptyContext()) {
  let ctx = initial;
  const registry = createCommandRegistry({ getContext: () => ctx });
  registry.registerAll(appCommandSet());
  return {
    registry,
    setContext(next: CommandContext) {
      ctx = next;
    },
  };
}

/** The richest state: a project of every kind, a canvas document, a spliceable selection. */
const RICH = makeContext({
  document: { open: true },
  editor: { kind: "canvas" },
  project: { isMultilingual: true, isRepo: true, isSite: true, open: true },
  selection: { count: 1, paths: [["children", 0]] },
});

/** A value of the shape a required property declares — enough to reach `run`, no more. */
function minimalArgs(parameters: object): Record<string, unknown> {
  const { properties = {}, required = [] } = parameters as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const args: Record<string, unknown> = {};
  for (const key of required) {
    const property = properties[key] ?? {};
    if (Array.isArray(property.enum) && property.enum.length > 0) {
      [args[key]] = property.enum as unknown[];
    } else if (property.type === "array") {
      args[key] = [["children", 0]];
    } else if (property.type === "boolean") {
      args[key] = true;
    } else if (property.type === "number" || property.type === "integer") {
      args[key] = 0;
    } else if (Array.isArray(property.oneOf)) {
      args[key] = null;
    } else {
      args[key] = "x";
    }
  }
  return args;
}

const noDeps = { getTab: () => null, validate: async () => [] };

beforeEach(() => {
  installMockPlatform();
  refreshFormats();
  setExtensions([]);
  setExtensionCatalog([
    {
      name: "@jxsuite/parser",
      sections: [{ key: "content" }],
      source: "first-party",
      title: "Content & Markdown",
    },
  ]);
  /* Parser ENABLED, not merely offered: `disable_extension`'s `package` enum is the enabled set,
     and a projected record whose required enum is empty is withheld from the round (asserted
     below, under its own heading). The tests that read the full set of declarations need every
     enum non-empty. */
  resetStudioState({ projectConfig: { extensions: ["@jxsuite/parser"] } });
});

afterEach(() => {
  // `active-registry.ts` documents this as the unmount contract.
  setActiveRegistry(null);
  refreshFormats();
  // A fake project record wrote through the chokepoint; the next test binds its own document.
  resetProjectConfigDocument();
});

// ─── The declaration IS the tool ─────────────────────────────────────────────

describe("every declaration reaches run, by id, and the refusal comes back verbatim", () => {
  /*
   * A stub `run` that records the id and refuses everything but the selector step, so the witness
   * sees `run("selection.setPaths")` then `run("<id>")` for a selection-level record and
   * `run("<id>")` alone otherwise — and so `report` is never reached: a refusal describes nothing,
   * records nothing, and reaches the model as the person's own sentence.
   */
  function witnessRegistry() {
    const calls: string[] = [];
    const { registry } = appRegistry(RICH);
    const stub: CommandRegistry = {
      ...registry,
      run(id) {
        calls.push(id);
        if (id === SELECTOR) {
          return;
        }
        throw new CommandUnavailableError(id, "a test state");
      },
    };
    return { calls, stub };
  }

  for (const [name, command] of DECLARED) {
    test(`${name} → run("${command.id}")`, async () => {
      const { calls, stub } = witnessRegistry();
      setActiveRegistry(stub);
      const tools = createCommandToolRegistry(noDeps);
      const definition = tools.getDefinition(name)!;
      expect(definition).toBeDefined();

      const witnessCall = recordingContext();
      const result = await tools.execute(name, minimalArgs(definition.parameters), witnessCall);
      expect(result).toEqual({
        error: `Command "${command.id}" is not available right now — it requires a test state.`,
        success: false,
      });
      expect(calls).toEqual(command.level === "selection" ? [SELECTOR, command.id] : [command.id]);
      // No ledger entry for a refusal.
      expect(fileTurn("witness", witnessCall.ledger.writes)).toEqual([]);
    });
  }

  test("the eleven declarations are exactly these, and each is one record", () => {
    /* Nine from the projection (seven completed, two migrated), then #334: `open_document`
       crossed from the hand table to the `document.open` record, and `canvas.setMode` was
       projected because the mode decides `editor.kind`, the fact the tree tools are gated on. */
    expect([...DECLARED.keys()].toSorted()).toEqual([
      "add_project_locale",
      "check_accessibility",
      "check_popovers",
      "delete_node",
      "disable_extension",
      "duplicate_node",
      "enable_extension",
      "open_document",
      "select_node",
      "set_canvas_mode",
      "validate_redirects",
    ]);
  });
});

// ─── The tier is the level ───────────────────────────────────────────────────

describe("level is the tier: a ladder of contexts", () => {
  const RUNGS: CommandContext[] = [
    emptyContext(),
    makeContext({ project: { isMultilingual: true, isRepo: true, isSite: true, open: true } }),
    makeContext({
      document: { open: true },
      editor: { kind: "canvas" },
      project: { isMultilingual: true, isRepo: true, isSite: true, open: true },
    }),
    RICH,
  ];
  /* The rung at which a level's records first appear. `selection` is 2, not 3: the bridge
     supplies the selection itself by running the selector, so a canvas document is enough. */
  const FIRST_RUNG = { document: 2, project: 1, selection: 2 } as const;

  test("every projected record is absent below its level's rung and present from it", () => {
    const { registry, setContext } = appRegistry();
    for (const [rung, ctx] of RUNGS.entries()) {
      setContext(ctx);
      const listed = new Set(advertisedCommandTools(registry).map((t) => t.name));
      for (const [name, command] of DECLARED) {
        const level = command.level as keyof typeof FIRST_RUNG;
        expect([rung, name, listed.has(name)]).toEqual([rung, name, rung >= FIRST_RUNG[level]]);
      }
    }
  });

  test("the blurbs are the same filter as the definitions, read from one function", () => {
    const { registry, setContext } = appRegistry();
    for (const ctx of RUNGS) {
      setContext(ctx);
      const names = advertisedCommandTools(registry).map((t) => t.name);
      expect(commandToolBlurbs(registry).map((line) => line.slice(0, line.indexOf("(")))).toEqual(
        names,
      );
    }
    expect(commandToolBlurbs(null)).toEqual([]);
  });

  test("with Project Settings focused, a selection verb is not advertised even with a selection", () => {
    const { registry } = appRegistry(
      makeContext({ ...RICH, editor: { kind: "config" } } as CommandContext),
    );
    const listed = advertisedCommandTools(registry).map((t) => t.name);
    expect(listed).not.toContain("delete_node");
    expect(listed).not.toContain("duplicate_node");
    // The document-level pointer stays: project.json is drawn as a tree and the selector holds.
    expect(listed).toContain("select_node");
  });

  test("a selection-level projection's own gate agrees with the bridge at the point it lands", () => {
    // `when` and `enablement` hold where the bridge would run the verb (a canvas, one spliceable
    // Path), and `when` is false with a configuration document focused, selection or not.
    const landed = makeContext({
      document: { open: true },
      editor: { kind: "canvas" },
      selection: { count: 1, paths: [["children", 0]] },
    });
    const config = makeContext({ ...landed, editor: { kind: "config" } } as CommandContext);
    for (const command of DECLARED.values()) {
      if (command.level !== "selection") {
        continue;
      }
      expect([command.id, command.when!(landed)]).toEqual([command.id, true]);
      expect([command.id, command.enablement!(landed)]).toEqual([command.id, true]);
      expect([command.id, command.when!(config)]).toEqual([command.id, false]);
    }
  });
});

// ─── Parameters are the record's ────────────────────────────────────────────

describe("parameters are the record's own args object", () => {
  test("identity for a non-selection record; the selector's paths in front for a selection one", () => {
    const { registry } = appRegistry(RICH);
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry(noDeps);
    const selectorPaths = (registry.get(SELECTOR)!.args as { properties: { paths: object } })
      .properties.paths;
    for (const name of DECLARED.keys()) {
      const { parameters } = tools.getDefinition(name)!;
      // The LIVE record's object, not `DECLARED`'s: `appCommandSet()` builds fresh records per
      // Call, and identity against the registry's is the property the model depends on.
      const command = registry.list().find((c) => c.aiTool?.name === name)!;
      if (command.level === "selection") {
        const props = parameters.properties!;
        expect(Object.is(props.paths, selectorPaths)).toBe(true);
        expect(parameters.required).toEqual(["paths"]);
        expect(Object.keys(props)).toEqual(["paths"]);
      } else if (command.args) {
        expect(Object.is(parameters, command.args)).toBe(true);
      } else {
        expect(parameters).toEqual({
          additionalProperties: false,
          properties: {},
          required: [],
          type: "object",
        });
      }
    }
  });

  test("a derived enum serialises live: two listForLLM() calls disagree after the state moves", () => {
    const { registry } = appRegistry(RICH);
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry(noDeps);
    /* Serialised the way the wire does it, because the getter is what is under test: `[...]` of
       the property would read it too, but the model receives JSON. */
    interface Listed {
      function: { name: string; parameters: object };
    }
    const enumOf = () => {
      const listed = tools.listForLLM() as Listed[];
      const tool = listed.find((t) => t.function.name === "enable_extension")!;
      const wire = JSON.stringify(tool.function.parameters);
      const parsed = JSON.parse(wire) as { properties: { package: { enum: string[] } } };
      return parsed.properties.package.enum;
    };
    expect(enumOf()).toEqual(["@jxsuite/parser"]);
    setExtensionCatalog([
      { name: "@jxsuite/parser", sections: [{ key: "content" }], source: "first-party" },
      { name: "@jxsuite/search", sections: [{ key: "search" }], source: "first-party" },
    ]);
    expect(enumOf()).toEqual(["@jxsuite/parser", "@jxsuite/search"]);
  });

  test("the description carries the undo scope and the destructive flag as a suffix", () => {
    const { registry } = appRegistry(RICH);
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry(noDeps);
    expect(tools.getDefinition("delete_node")!.description).toEndWith(
      " Undo: document. Destructive.",
    );
    expect(tools.getDefinition("enable_extension")!.description).toEndWith(" Not undoable.");
    expect(tools.getDefinition("disable_extension")!.description).toEndWith(" Undo: project.");
    // A read says nothing about undo.
    expect(tools.getDefinition("check_accessibility")!.description).not.toContain("Undo");
    // And nothing is strict: the registry's coercion is the single validator.
    for (const definition of tools.list()) {
      expect([definition.name, definition.strict, definition.llmStrict]).toEqual([
        definition.name,
        false,
        false,
      ]);
    }
    expect(tools.validate("delete_node", { paths: null })).toEqual({ valid: true });
  });

  test("a selection verb with an argument of its own composes it after paths", async () => {
    const tab = resetWorkspaceWithTab({
      children: [{ tagName: "p" }, { tagName: "span" }],
      tagName: "div",
    });
    const seen: unknown[] = [];
    let ctx = makeContext({ document: { open: true }, editor: { kind: "canvas" } });
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.registerAll(selectionCommands());
    registry.register({
      aiTool: { description: "Tag it.", name: "tag_thing", report: () => "Tagged." },
      args: argsSchema({ tag: stringProperty("The tag.") }),
      category: "Selection",
      id: "selection.tag",
      level: "selection",
      requires: "an element selection",
      run: (_ctx, args) => {
        seen.push(args, [...tab.session.selection]);
      },
      title: "Tag",
      when: hasSelection,
    } as AnyCommand);
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry(noDeps);

    const { parameters } = tools.getDefinition("tag_thing")!;
    expect(Object.keys(parameters.properties!)).toEqual(["paths", "tag"]);
    expect(parameters.required).toEqual(["paths", "tag"]);
    expect(commandToolBlurbs(registry)).toContain("tag_thing(paths, tag) — Tag it.");

    // The selector runs first and the verb sees its selection; `paths` never reaches the verb.
    ctx = makeContext({
      ...ctx,
      selection: { count: 1, paths: [["children", 1]] },
    } as CommandContext);
    const ok = await tools.execute("tag_thing", { paths: [["children", 1]], tag: "p" });
    expect(ok).toEqual({ success: true, summary: "Tagged." });
    expect(seen).toEqual([{ tag: "p" }, [["children", 1]]]);
    expect(tab.session.selection).toEqual([["children", 1]]);

    // The selector's own refusals pass through: a hole, and a shape the schema refuses.
    const hole = await tools.execute("tag_thing", { paths: [["children", 9]], tag: "p" });
    expect(hole.success).toBe(false);
    expect(hole.error).toContain('command "selection.setPaths" argument "paths": [children, 9]');
    const shape = await tools.execute("tag_thing", { paths: "children/0", tag: "p" });
    expect(shape.success).toBe(false);
    expect(shape.error).toContain('command "selection.setPaths" argument "paths"');
    expect(seen).toHaveLength(2);
  });
});

// ─── Execution: the witness, the ledger, the report ─────────────────────────

describe("execution", () => {
  /** A registry of fake records over the harness tab, one per shape the bridge distinguishes. */
  function fakeRegistry(
    tab: ReturnType<typeof resetWorkspaceWithTab>,
    ctxPatch: Partial<CommandContext> = {},
  ) {
    const registry = createCommandRegistry({
      getContext: () =>
        makeContext({
          document: { open: true },
          editor: { kind: "canvas" },
          project: { open: true },
          ...ctxPatch,
        } as never),
    });
    registry.registerAll([
      {
        aiTool: { description: "d", name: "doc_write", report: () => "Wrote the document." },
        category: "Document",
        id: "doc.write",
        level: "document",
        run: () => {
          transactDoc(tab, (t) => mutateUpdateProperty(t, [], "id", "x"));
        },
        title: "Write Doc",
        undo: "document",
      },
      {
        aiTool: { description: "d", name: "doc_noop", report: () => "Nothing." },
        category: "Document",
        id: "doc.noop",
        level: "document",
        run: () => {},
        title: "No-op Doc",
        undo: "document",
      },
      {
        aiTool: {
          description: "d",
          name: "disk_write",
          report: () => ({ summary: "Wrote two files.", wrote: ["a.json", "b.json"] }),
        },
        category: "Project",
        id: "disk.write",
        level: "project",
        run: () => {},
        title: "Write Disk",
        undo: "none",
      },
      {
        aiTool: { description: "d", name: "proj_write", report: () => "Wrote project.json." },
        category: "Project",
        id: "proj.write",
        level: "project",
        /* Through the chokepoint, as every real project record writes: the project witness
           compares the configuration reference the chokepoint holds, so a run that only claims
           to write is exactly what it catches (`proj_phantom` below). */
        run: () => updateSiteConfig({ name: "written" } as Partial<ProjectConfig>),
        title: "Write Project",
        undo: "project",
      },
      {
        aiTool: { description: "d", name: "proj_phantom", report: () => "Wrote project.json." },
        category: "Project",
        id: "proj.phantom",
        level: "project",
        run: () => {},
        title: "Phantom Project",
        undo: "project",
      },
      {
        aiTool: { description: "d", name: "disk_unnamed", report: () => "Wrote something." },
        category: "Project",
        id: "disk.unnamed",
        level: "project",
        run: () => {},
        title: "Write Somewhere",
        undo: "none",
      },
      {
        aiTool: {
          description: "d",
          name: "read_thing",
          report: () => ({ data: [{ message: "m" }], summary: "Found one." }),
        },
        category: "Document",
        id: "read.thing",
        level: "document",
        run: () => {},
        title: "Read Thing",
      },
      {
        aiTool: {
          description: "d",
          name: "proj_noop",
          report: () => ({ summary: "Already so.", wrote: [] }),
        },
        category: "Project",
        id: "proj.noop",
        level: "project",
        run: () => {},
        title: "No-op Project",
        undo: "project",
      },
      {
        aiTool: {
          description: "d",
          name: "proj_bad_report",
          report: () => {
            throw new TypeError("sections is not iterable");
          },
        },
        category: "Project",
        id: "proj.badReport",
        level: "project",
        run: () => updateSiteConfig({ name: "written" } as Partial<ProjectConfig>),
        title: "Bad Report",
        undo: "project",
      },
      {
        aiTool: {
          description: "d",
          name: "proj_bad_report_noop",
          report: () => {
            throw new TypeError("sections is not iterable");
          },
        },
        category: "Project",
        id: "proj.badReportNoop",
        level: "project",
        run: () => {},
        title: "Bad Report No-op",
        undo: "project",
      },
    ] as AnyCommand[]);
    return registry;
  }

  test("a document write records { disk: false } at the document's path and passes the verdict", async () => {
    const tab = resetWorkspaceWithTab(undefined, { documentPath: "pages/index.json" });
    setActiveRegistry(fakeRegistry(tab));
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    const tCall = recordingContext();
    const result = await tools.execute("doc_write", {}, tCall);
    expect(result).toEqual({ success: true, summary: "Wrote the document." });
    expect(tab.doc.document.id).toBe("x");
    expect(fileTurn("t", tCall.ledger.writes)).toEqual([
      { disk: false, ok: true, path: "pages/index.json", tool: "Write Doc" },
    ]);
  });

  test("a document record whose run transacted nothing is 'changed nothing', not a success", async () => {
    const tab = resetWorkspaceWithTab();
    setActiveRegistry(fakeRegistry(tab));
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    const tCall = recordingContext();
    const result = await tools.execute("doc_noop", {}, tCall);
    expect(result).toEqual({
      error: "No-op Doc changed nothing: the document is exactly as it was.",
      success: false,
    });
    expect(fileTurn("t", tCall.ledger.writes)).toEqual([]);
  });

  test("…and names the collab freeze when source is canonical", async () => {
    const tab = resetWorkspaceWithTab();
    setActiveRegistry(
      fakeRegistry(tab, { collab: { attached: true, readOnly: false, sourceCanonical: true } }),
    );
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    const result = await tools.execute("doc_noop", {});
    expect(result.error).toBe(
      "No-op Doc changed nothing: the document is exactly as it was. A collaborator is editing " +
        "its source, so structural edits are paused.",
    );
  });

  test("a project record whose run left the configuration alone is 'changed nothing', and files nothing", async () => {
    /* The project witness: `projectState.projectConfig` is the configuration document's root and
       every applied `project.json` transaction replaces it, so an unchanged reference after `run`
       is a run that never transacted. This record REPORTS a write; the report's claim does not
       reach the model, and the ledger stays empty — mechanically, with no latch in the record. */
    const tab = resetWorkspaceWithTab();
    setActiveRegistry(fakeRegistry(tab));
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    const tCall = recordingContext();
    expect(await tools.execute("proj_phantom", {}, tCall)).toEqual({
      success: true,
      summary: "Phantom Project changed nothing: project.json is exactly as it was.",
    });
    expect(fileTurn("t", tCall.ledger.writes)).toEqual([]);
  });

  test("…and one that wrote through the chokepoint passes the witness: its sentence and one ledger entry", async () => {
    const tab = resetWorkspaceWithTab();
    setActiveRegistry(fakeRegistry(tab));
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    const tCall = recordingContext();
    expect(await tools.execute("proj_write", {}, tCall)).toEqual({
      success: true,
      summary: "Wrote project.json.",
    });
    expect(fileTurn("t", tCall.ledger.writes)).toEqual([
      { disk: false, ok: true, path: "project.json", tool: "Write Project" },
    ]);
    // The second run of the same patch is the idempotent case: the chokepoint compares the
    // Serialised result against the file and transacts nothing, and the witness says so.
    const uCall = recordingContext();
    expect(await tools.execute("proj_write", {}, uCall)).toEqual({
      success: true,
      summary: "Write Project changed nothing: project.json is exactly as it was.",
    });
    expect(fileTurn("u", uCall.ledger.writes)).toEqual([]);
  });

  test("a throwing report on a run that changed nothing files nothing either", async () => {
    // The witness is decided BEFORE the report, so the defaults-filed ledger of the throwing path
    // Is held to it too: `project.json` is not filed for a run that never touched it.
    const tab = resetWorkspaceWithTab();
    setActiveRegistry(fakeRegistry(tab));
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    const tCall = recordingContext();
    expect(await tools.execute("proj_bad_report_noop", {}, tCall)).toEqual({
      error: "Bad Report No-op ran, but its report failed: sections is not iterable",
      success: false,
    });
    expect(fileTurn("t", tCall.ledger.writes)).toEqual([]);
  });

  test("undo: none with wrote records one { disk: true } per path; undo: project defaults to project.json", async () => {
    const tab = resetWorkspaceWithTab();
    setActiveRegistry(fakeRegistry(tab));
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    const tCall = recordingContext();
    expect(await tools.execute("disk_write", {}, tCall)).toEqual({
      success: true,
      summary: "Wrote two files.",
    });
    expect(await tools.execute("proj_write", {}, tCall)).toEqual({
      success: true,
      summary: "Wrote project.json.",
    });
    expect(fileTurn("t", tCall.ledger.writes)).toEqual([
      { disk: true, ok: true, path: "a.json", tool: "Write Disk" },
      { disk: true, ok: true, path: "b.json", tool: "Write Disk" },
      { disk: false, ok: true, path: "project.json", tool: "Write Project" },
    ]);
  });

  test("undo: none with no wrote files (unknown file), which is the sentence a missing wrote earns", async () => {
    /* A disk write has no default path: only the record knows what it touched, and one that says
       nothing is filed under a name a reader will question rather than left out of the ledger. The
       kept records all name their paths (asserted below); this is what the bridge does for one
       that forgets. */
    const tab = resetWorkspaceWithTab();
    setActiveRegistry(fakeRegistry(tab));
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    const tCall = recordingContext();
    expect(await tools.execute("disk_unnamed", {}, tCall)).toEqual({
      success: true,
      summary: "Wrote something.",
    });
    expect(fileTurn("t", tCall.ledger.writes)).toEqual([
      { disk: true, ok: true, path: "(unknown file)", tool: "Write Somewhere" },
    ]);
  });

  test("an empty wrote is a run that changed nothing: the sentence stands, the ledger stays empty", async () => {
    /* The default for `undo: "project"` is `project.json`, and it is the RECORD's default — what
       this record writes — not this run's. An idempotent verb asked for a state it already had
       says so with `wrote: []`, and no "Changed 1 file" entry is filed for a file nobody touched.
       The project witness agrees (nothing transacted) and, because the report KNEW, keeps its
       sentence: "Already so." says why, which the witness cannot. */
    const tab = resetWorkspaceWithTab();
    setActiveRegistry(fakeRegistry(tab));
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    const tCall = recordingContext();
    expect(await tools.execute("proj_noop", {}, tCall)).toEqual({
      success: true,
      summary: "Already so.",
    });
    expect(fileTurn("t", tCall.ledger.writes)).toEqual([]);
  });

  test("a report that throws after run resolved names the write and files it from the defaults", async () => {
    /* `run` returned, so the write happened. Left to escape, the loop's one catch would label the
       throw "Failed to parse arguments" and, because the ledger is filed after `report`, the write
       would never be filed. So the bridge files the record's default paths — the report that would
       have named them is what failed — and tells the model both halves. */
    const tab = resetWorkspaceWithTab();
    setActiveRegistry(fakeRegistry(tab));
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    const tCall = recordingContext();
    expect(await tools.execute("proj_bad_report", {}, tCall)).toEqual({
      error: "Bad Report ran, but its report failed: sections is not iterable",
      success: false,
    });
    expect(fileTurn("t", tCall.ledger.writes)).toEqual([
      { disk: false, ok: true, path: "project.json", tool: "Bad Report" },
    ]);
  });

  test("a record with no undo records nothing, and its data reaches the result", async () => {
    const tab = resetWorkspaceWithTab();
    setActiveRegistry(fakeRegistry(tab));
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    const tCall = recordingContext();
    expect(await tools.execute("read_thing", {}, tCall)).toEqual({
      data: [{ message: "m" }],
      success: true,
      summary: "Found one.",
    });
    expect(fileTurn("t", tCall.ledger.writes)).toEqual([]);
  });

  test("a schema-breaking write returns the write reporter's verdict, not the report's summary", async () => {
    const tab = resetWorkspaceWithTab();
    setActiveRegistry(fakeRegistry(tab));
    let call = 0;
    const tools = createCommandToolRegistry({
      getTab: () => tab,
      validate: async () => {
        call += 1;
        return call === 1 ? [] : ["/tagName: must match pattern"];
      },
    });
    const result = await tools.execute("doc_write", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("introduced schema errors");
    expect(result.error).toContain("→ Fix:");
  });

  test("a success verdict's token hints ride on the report's sentence", async () => {
    const tab = resetWorkspaceWithTab({ style: { color: "#ff0000" }, tagName: "div" } as never);
    setActiveRegistry(fakeRegistry(tab));
    const tools = createCommandToolRegistry({
      getProjectStyle: () => ({ "--color-accent": "#ff0000" }),
      getTab: () => tab,
      validate: async () => [],
    });
    const result = await tools.execute("doc_write", {});
    expect(result.success).toBe(true);
    expect(result.summary).toStartWith("Wrote the document.");
    expect(result.summary).toContain("--color-accent");
  });

  test("no registry, and a name no record projects", async () => {
    const tools = createCommandToolRegistry(noDeps);
    expect(tools.list()).toEqual([]);
    expect(tools.listForLLM()).toEqual([]);
    expect(tools.getDefinition("delete_node")).toBeUndefined();
    expect(await tools.execute("delete_node", { paths: [] })).toEqual({
      error: 'Cannot run "delete_node" — this window has no command registry.',
      success: false,
    });
    setActiveRegistry(appRegistry(RICH).registry);
    expect(await tools.execute("nope", {})).toEqual({
      error: 'Unknown tool: "nope"',
      success: false,
    });
  });

  test("register() is refused: the view has nothing to register into", () => {
    const tools = createCommandToolRegistry(noDeps);
    expect(() =>
      tools.register({
        description: "d",
        execute: async () => ({ success: true }),
        llmStrict: false,
        name: "x",
        parameters: {},
        strict: false,
      }),
    ).toThrow("declare aiTool on the record instead");
  });

  test("a selection-level record is not projected where the selector is not registered", () => {
    // The bridge composes through `selection.setPaths`; with no selector there is nothing to run
    // First and no `paths` description to hand the model, so the record is simply absent.
    const registry = createCommandRegistry({ getContext: () => RICH });
    registry.register({
      aiTool: { description: "d", name: "lonely_verb", report: () => "r" },
      category: "Selection",
      id: "selection.lonely",
      level: "selection",
      requires: "an element selection",
      run: () => {},
      title: "Lonely",
      when: hasSelection,
    } as AnyCommand);
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry(noDeps);
    expect(tools.list()).toEqual([]);
    expect(tools.getDefinition("lonely_verb")).toBeUndefined();
  });

  test("a definition listed without an executor refuses rather than running", async () => {
    const { registry } = appRegistry(RICH);
    const [first] = advertisedCommandTools(registry);
    expect(await first!.execute({}, createToolContext())).toEqual({
      error: `Tool "${first!.name}" was listed without an executor.`,
      success: false,
    });
  });
});

// ─── A tool with nothing it could be called with ────────────────────────────

describe("a required argument with an empty derived enum withholds the tool", () => {
  test("disable_extension is absent while nothing is enabled, and back when something is", () => {
    /* `disable_extension`'s `package` enum is the enabled set. With `extensions: []` it serialised
       `enum: []` — a tool the model could only call wrongly — and the `@jxsuite/ai` validator let
       it through only because projected tools are `strict: false`. */
    resetStudioState({ projectConfig: { extensions: [] } });
    const { registry } = appRegistry(RICH);
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry(noDeps);
    // The record's own gate holds; the bridge withholds anyway.
    expect(registry.isEnabled("project.disableExtension")).toBe(true);
    expect(advertisedCommandTools(registry).map((t) => t.name)).not.toContain("disable_extension");
    expect(tools.list().map((t) => t.name)).not.toContain("disable_extension");
    expect(commandToolBlurbs(registry).some((l) => l.startsWith("disable_extension("))).toBe(false);
    // `enable_extension` has a catalogue behind it and stays.
    expect(tools.list().map((t) => t.name)).toContain("enable_extension");

    resetStudioState({ projectConfig: { extensions: ["@jxsuite/parser"] } });
    expect(tools.list().map((t) => t.name)).toContain("disable_extension");
  });

  test("enable_extension is absent with no catalogue", () => {
    setExtensionCatalog([]);
    resetStudioState({ projectConfig: { extensions: [] } });
    const { registry } = appRegistry(RICH);
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry(noDeps);
    const listed = tools.listForLLM() as { function: { name: string } }[];
    expect(listed.map((t) => t.function.name)).not.toContain("enable_extension");
  });

  test("a withheld tool is still resolvable, so a call the model makes anyway meets the coercion", async () => {
    resetStudioState({ projectConfig: { extensions: [] } });
    const { registry } = appRegistry(RICH);
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry(noDeps);
    expect(tools.getDefinition("disable_extension")).toBeDefined();
    const result = await tools.execute("disable_extension", { package: "@jxsuite/parser" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("is not declared — declared: none");
  });

  test("an OPTIONAL argument with an empty enum withholds nothing", () => {
    const registry = createCommandRegistry({ getContext: () => RICH });
    registry.register({
      aiTool: { description: "d", name: "optional_choice", report: () => "r" },
      args: {
        additionalProperties: false,
        properties: { choice: { enum: [], type: "string" } },
        required: [],
        type: "object",
      },
      category: "Project",
      id: "project.optionalChoice",
      level: "project",
      run: () => {},
      title: "Optional Choice",
    } as AnyCommand);
    setActiveRegistry(registry);
    expect(advertisedCommandTools(registry).map((t) => t.name)).toEqual(["optional_choice"]);
  });
});

// ─── The composite ───────────────────────────────────────────────────────────

describe("composeToolRegistries", () => {
  test("routes by name, hand first, and answers Unknown tool for neither side", async () => {
    const hand = createToolRegistry();
    hand.register({
      description: "hand",
      execute: async () => ({ success: true, summary: "hand ran" }),
      llmStrict: false,
      name: "hand_tool",
      parameters: { properties: {}, type: "object" },
      strict: false,
    });
    setActiveRegistry(appRegistry(RICH).registry);
    const commands = createCommandToolRegistry(noDeps);
    const composite = composeToolRegistries(hand, commands);

    expect(
      composite
        .list()
        .map((t) => t.name)
        .slice(0, 1),
    ).toEqual(["hand_tool"]);
    expect(composite.list()).toHaveLength(1 + commands.list().length);
    expect(composite.listForLLM()).toHaveLength(1 + commands.list().length);
    expect(composite.getDefinition("hand_tool")?.description).toBe("hand");
    expect(composite.getDefinition("delete_node")?.name).toBe("delete_node");
    expect(composite.getDefinition("nope")).toBeUndefined();

    expect(composite.validate("hand_tool", {})).toEqual({ valid: true });
    expect(composite.validate("delete_node", {})).toEqual({ valid: true });
    expect(composite.validate("nope", {})).toEqual({
      errors: ['Unknown tool: "nope"'],
      valid: false,
    });

    expect(await composite.execute("hand_tool", {})).toEqual({
      success: true,
      summary: "hand ran",
    });
    expect(await composite.execute("nope", {})).toEqual({
      error: 'Unknown tool: "nope"',
      success: false,
    });

    // `register` goes to the hand side; the view refuses one.
    composite.register({
      description: "second",
      execute: async () => ({ success: true }),
      llmStrict: false,
      name: "second_hand",
      parameters: { properties: {}, type: "object" },
      strict: false,
    });
    expect(hand.getDefinition("second_hand")).toBeDefined();
  });
});

// ─── Budget and the ratchet ──────────────────────────────────────────────────

describe("the assistant's tool budget", () => {
  test("hand rows plus projected records stay under CHROME_BUDGET.assistantTools", () => {
    const total = AI_TOOL_TIERS.length + DECLARED.size;
    // Delete a declaration, or raise the cap in budget.ts deliberately.
    expect([total, total <= CHROME_BUDGET.assistantTools]).toEqual([total, true]);
    expect(CHROME_BUDGET.assistantTools).toBe(30);
  });

  /*
   * The records whose `run` waits on a person — a dialog, a prompt, a confirm. §12.4's second
   * deletion rule keeps them out of the projection: the loop does not count a New File prompt as
   * interactive, the turn would hang on the author, and a cancel resolves with nothing a report
   * could describe. This set is the ratchet for the ones already known; adding a dialog to a
   * projected `run` is a review rule the spec states.
   */
  const WAITS_ON_A_PERSON = [
    "selection.repeat",
    "grid.saveView",
    "redirects.import",
    "publish.setUp",
    "file.convertFormat",
    "content.newEntry",
    "i18n.createTranslation",
    "library.newEntry",
    "project.new",
  ];

  test("no record that waits on a person carries a declaration", () => {
    const byId = new Map(appCommandSet().map((c) => [c.id, c]));
    for (const id of WAITS_ON_A_PERSON) {
      const command = byId.get(id);
      expect([id, command !== undefined]).toEqual([id, true]);
      expect([id, command!.aiTool]).toEqual([id, undefined]);
    }
  });

  test("select_node reports what it pointed at, or that it cleared the selection", () => {
    const { report } = DECLARED.get("select_node")!.aiTool!;
    expect(
      report({
        after: makeContext({ selection: { count: 0, kind: "", paths: [] } }),
        args: { path: null } as never,
        before: emptyContext(),
      }),
    ).toBe("Cleared the selection.");
    expect(
      report({
        after: makeContext({ selection: { count: 1, kind: "p", paths: [["children", 2]] } }),
        args: { path: ["children", 2] } as never,
        before: emptyContext(),
      }),
    ).toBe("Selected p at [children, 2]; the Inspector and the Outline now address it.");
    expect(
      report({
        after: makeContext({ selection: { count: 1, kind: "", paths: [["children", 0]] } }),
        args: { path: ["children", 0] } as never,
        before: emptyContext(),
      }),
    ).toBe("Selected the element at [children, 0]; the Inspector and the Outline now address it.");
  });

  test("every kept undo: none projection returns wrote, so the ledger never files (unknown file)", () => {
    for (const [name, command] of DECLARED) {
      if (command.undo !== "none") {
        continue;
      }
      // Reported against the empty state the record can be asked about with no project open.
      const report = command.aiTool!.report({
        after: emptyContext(),
        args: { package: "@jxsuite/parser" } as never,
        before: emptyContext(),
      });
      expect([name, typeof report === "string" ? undefined : report.wrote?.length]).toEqual([
        name,
        expect.any(Number),
      ]);
    }
  });
});
