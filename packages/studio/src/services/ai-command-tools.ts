/**
 * Ai-command-tools.ts — the assistant's tools that ARE command records.
 *
 * A `ToolRegistry` that is a VIEW over this window's active command registry, in the idiom of
 * `services/automation.ts`'s `scriptableCommands()`: nothing is registered here, ever. Every call to
 * `listForLLM()` enumerates the records that carry an `aiTool` projection and builds one function
 * schema per record whose `parameters` is the record's own `args` object — by reference, so a
 * `derivedEnumProperty` getter serialises live on every agent-loop round — whose `description` is
 * the record's, and which is advertised exactly while `registry.isEnabled(id)` holds. `execute` is
 * `registry.run(id, args)`.
 *
 * **Why a view and not a registration.** `const assistant = createDocumentAssistant()` runs at
 * module load of `panels/ai-panel.ts`, before the bootstrap composes the registry, so a
 * registration step would have to import `app-commands.ts` (every command module into the
 * assistant's import graph) and read `report` from a record built with `noopCommandDeps` — a
 * second instance of every record, whose closures are not the app's. A view has neither problem,
 * and it cannot be dormant: issue 273 was forty-seven declarations that reached the assistant from
 * none of them, because each waited on a hand-registered tool nobody wrote. There is no
 * registration step between `aiTool` and the tool, so there is nothing to omit.
 *
 * **What the model reads.** A refusal is the person's own sentence: `CommandUnavailableError.message`
 * IS `refusalSentence`, and a `RangeError` from `coerceArgs` (which `registry.run` applies for
 * every caller) or from inside `run` already names the value and the declared list. Both pass
 * through untouched. There is deliberately no pre-check with `refusalMessage` — `run` refuses with
 * the same sentence, and a second call site for one predicate is precisely the divergence
 * `specs/studio-ui-guidelines.md` §12.4 is about. And because this module owns `execute`,
 * `@jxsuite/ai`'s `Tool "<name>" execution error:` prefix never wraps a refusal.
 *
 * **The write witness.** A record with `undo: "document"` is held to having written: `transactDoc`
 * replaces the document's root reference on every applied transaction (`tabs/transact.ts`), so an
 * unchanged reference after `run` means the collab freeze refused it, or `run` returned early, and
 * the model is told "changed nothing" rather than congratulated. This is what closes the
 * phantom-success finding for every bridged document write, not just the one tool it was found on.
 *
 * **The project witness** is the same comparison over `project.json`. Every configuration write is
 * a transaction on the configuration document (`tabs/project-config.ts`), whose bind effect keeps
 * `projectState.projectConfig` equal to `toRaw(document.doc.document)` — so a record with `undo:
 * "project"` that left that reference alone wrote nothing, whatever its report says. The ledger
 * then files nothing (`wrote: []`, mechanically, for every project record), and a report that
 * named no `wrote` of its own — one with no latch to know it was a no-op — has its sentence
 * replaced by "changed nothing", because "Wrote project.json" over an untouched file is the
 * phantom the ledger exists to keep out. A record whose report answered `wrote: []` itself is one
 * that KNEW, and its sentence ("already enabled") is the one the witness cannot write. That is why
 * `add_project_locale` keeps its latch: the sentence, not the ledger, is what the latch is for.
 *
 * **A tool with nothing it could be called with is withheld.** A `derivedEnumProperty` on a
 * REQUIRED argument serialises `enum: []` when the list behind it is empty — `enable_extension`
 * with no catalogue — and `@jxsuite/ai`'s validator tolerates that only because every projected
 * tool is `strict: false`. The record's gate cannot see its own argument list, so the bridge reads
 * it: an enabled record whose required enum is empty is not advertised this round, and comes back
 * the round the list does. `getDefinition` still answers, so a call the model makes anyway meets
 * the coercion's own refusal (`is not declared — declared: none`) rather than `Unknown tool`.
 *
 * **`validate()` is a no-op, on purpose.** `@jxsuite/ai`'s validator never checks `enum` and treats
 * a required `null` as missing (`packages/ai/src/tools.ts`), which would refuse `select_node
 * { path: null }`. The registry's coercion is the single validator, so every projected tool is
 * `strict: false`.
 *
 * @license MIT
 */

import { toolError } from "@jxsuite/ai/tools";
import type { ToolDefinition, ToolRegistry, ToolResult } from "@jxsuite/ai/tools";
import { activeRegistry } from "../commands/active-registry";
import { argsSchema } from "../commands/command-args";
import { inCanvas } from "../commands/context";
import { toRaw } from "../reactivity";
import { projectState } from "../state";
import { recordWrite } from "./ai-writes";
import { reportDocumentWrite, snapshotBeforeWrite } from "./ai-write-report";
import type { WriteReportDeps, WriteSnapshot } from "./ai-write-report";
import type { CommandContext } from "../commands/context";
import type { AiToolReport, AnyCommand, CommandRegistry } from "../commands/registry";
import type { Tab } from "../tabs/tab";

/**
 * The record a selection-level projection composes through.
 *
 * The model addresses nodes by path, so a selection verb's tool takes `paths` and the bridge runs
 * this selector first. "Act on whatever is selected" would be a verb over state the model cannot
 * observe — the same objection `specs/studio.md` §13.5 raises against a `toggle*` id.
 */
export const SELECTOR = "selection.setPaths";

/** What the bridge needs that a command record cannot know: the tab, and the write reporter's deps. */
export interface CommandToolDeps extends WriteReportDeps {
  /**
   * The active tab — the document a `undo: "document"` record wrote, for the witness and the
   * ledger.
   */
  getTab: () => Tab | null;
}

/** Schema for a record that declares no `args`: an empty object, so the wire shape is uniform. */
const EMPTY_ARGS = argsSchema({});

/** The loosely-typed view of a record's `args` this module reads. */
interface ArgsShape {
  properties?: Record<string, { enum?: unknown }>;
  required?: readonly string[];
}

/**
 * Whether a required argument's choice list is empty right now.
 *
 * Reading `enum` is what serialises a `derivedEnumProperty` — the getter runs here exactly as it
 * runs on the wire — so this is the same answer the model would have been shown. Only a REQUIRED
 * property counts: an optional enum that is empty is an argument the model can leave out.
 */
function hasEmptyRequiredEnum(args: object | undefined): boolean {
  const shape = (args ?? EMPTY_ARGS) as ArgsShape;
  return (shape.required ?? []).some((key) => {
    const declared = shape.properties?.[key]?.enum;
    return Array.isArray(declared) && declared.length === 0;
  });
}

/**
 * The selector's own `paths` property object, taken BY REFERENCE from the live record so the
 * description the model reads is the selector's. `undefined` when the selector is not registered,
 * in which case no selection-level record can be composed and none is projected.
 */
function pathsProperty(registry: CommandRegistry): object | undefined {
  const args = registry.get(SELECTOR)?.args as ArgsShape | undefined;
  return args?.properties?.paths;
}

/**
 * A selection-level record's parameters: the selector's `paths` in front, REQUIRED, then the
 * record's own properties. Merging the record's after the selector's is what lets a future
 * selection verb with an argument of its own compose without a rule change — and `register()`
 * refuses a selection-level record that declares `paths` itself, so the two cannot collide.
 */
function withPaths(paths: object, args: object | undefined): object {
  const own = (args ?? EMPTY_ARGS) as ArgsShape;
  return {
    additionalProperties: false,
    properties: { paths, ...own.properties },
    required: ["paths", ...(own.required ?? [])],
    type: "object",
  };
}

/**
 * The tail every projected description carries, so a record says neither in its own sentence.
 *
 * `undo` names what ⌘Z reaches; `destructive` is the same flag the menus derive the danger styling
 * from. A record with no `undo` is a read or a navigation, and says nothing.
 */
function undoSuffix(command: AnyCommand): string {
  const undo =
    command.undo === "document"
      ? " Undo: document."
      : command.undo === "project"
        ? " Undo: project."
        : command.undo === "none"
          ? " Not undoable."
          : "";
  return `${undo}${command.destructive ? " Destructive." : ""}`;
}

/**
 * Whether a selection-level projection can be composed and honoured right now: a document tree is
 * on the canvas (`inCanvas`, the predicate `hasSelection` is built from — read, not respelled) and
 * the selector is usable, which is "a document is open". The `count > 0` conjunct of the verb's own
 * `when` is what the bridge satisfies itself by running the selector.
 */
function selectionAdvertised(registry: CommandRegistry): boolean {
  return (
    inCanvas(registry.context()) &&
    registry.get(SELECTOR) !== undefined &&
    registry.isEnabled(SELECTOR)
  );
}

/**
 * Whether one record's tool is advertised this round. For a project- or document-level record it is
 * the record's own gate, evaluated as the palette evaluates it — a module-state `enablement`
 * closure included. Selection-level records are the one derived case, above. And a record the gate
 * admits is still withheld while a required argument has an empty choice list: there is nothing it
 * could be called with, and a tool advertised with `enum: []` costs a round to discover that.
 */
function advertised(registry: CommandRegistry, command: AnyCommand): boolean {
  const open =
    command.level === "selection" ? selectionAdvertised(registry) : registry.isEnabled(command.id);
  return open && !hasEmptyRequiredEnum(command.args);
}

/** Every record carrying a projection, enabled or not. */
function projected(registry: CommandRegistry): AnyCommand[] {
  return registry.list().filter((command) => command.aiTool !== undefined);
}

/**
 * The definition one record projects, or `undefined` for a selection-level record when the selector
 * it composes through is not registered.
 */
function definitionOf(
  registry: CommandRegistry,
  command: AnyCommand,
  execute: (name: string, args: object) => Promise<ToolResult>,
): ToolDefinition | undefined {
  const tool = command.aiTool!;
  let parameters: object;
  if (command.level === "selection") {
    const paths = pathsProperty(registry);
    if (paths === undefined) {
      return undefined;
    }
    parameters = withPaths(paths, command.args);
  } else {
    parameters = command.args ?? EMPTY_ARGS;
  }
  return {
    name: tool.name,
    description: `${tool.description}${undoSuffix(command)}`,
    parameters: parameters as ToolDefinition["parameters"],
    strict: false,
    llmStrict: false,
    execute: (args) => execute(tool.name, args),
  };
}

/**
 * Pure: the definitions a given registry projects RIGHT NOW (advertised = the record's gate).
 *
 * Read by `listForLLM()` and by {@link commandToolBlurbs} both, so the prompt advertises exactly
 * what the gate will honour — one function, not two that agree until someone edits one.
 *
 * @param {CommandRegistry} registry
 * @param {(name: string, args: object) => Promise<ToolResult>} [execute] What each definition's
 *   `execute` calls. Defaults to a refusal, so a caller that only reads definitions cannot run
 *   one.
 * @returns {ToolDefinition[]}
 */
export function advertisedCommandTools(
  registry: CommandRegistry,
  execute: (name: string, args: object) => Promise<ToolResult> = async (name) =>
    toolError(`Tool "${name}" was listed without an executor.`),
): ToolDefinition[] {
  const definitions: ToolDefinition[] = [];
  for (const command of projected(registry)) {
    if (!advertised(registry, command)) {
      continue;
    }
    const definition = definitionOf(registry, command, execute);
    if (definition) {
      definitions.push(definition);
    }
  }
  return definitions;
}

/** The parameter list a prompt blurb prints: `a, b?` — required names bare, optional ones marked. */
function signatureOf(parameters: object): string {
  const shape = parameters as ArgsShape;
  const required = new Set(shape.required);
  return Object.keys(shape.properties ?? {})
    .map((key) => (required.has(key) ? key : `${key}?`))
    .join(", ");
}

/**
 * Pure: the prompt lines for the definitions a registry projects right now, in the hand tools' own
 * blurb shape: `name(a, b?) — description`. `null` (no registry composed yet) is no lines.
 *
 * Why `isEnabled` rather than `isVisible` with a "(not right now)" line: the prompt's invariant is
 * "advertises exactly what the gate will honour", and with the kept records there is no steady
 * state in which a projected record is visible and disabled, so the line would be empty in practice
 * and cost a wasted round when it was not. If a future record wants the palette's "why can't I"
 * answer in the prompt, this is the one function to extend.
 *
 * @param {CommandRegistry | null} registry
 * @returns {string[]}
 */
export function commandToolBlurbs(registry: CommandRegistry | null): string[] {
  if (!registry) {
    return [];
  }
  return advertisedCommandTools(registry).map(
    (definition) =>
      `${definition.name}(${signatureOf(definition.parameters)}) — ${definition.description}`,
  );
}

/** A `report` return, normalised: a bare string is a summary alone. */
function normaliseReport(report: string | AiToolReport): AiToolReport {
  return typeof report === "string" ? { summary: report } : report;
}

/**
 * The configuration object the app is live on, unwrapped, or `null` before a project has one.
 *
 * The same read `tabs/project-config.ts`'s `liveConfig()` makes: `projectState.projectConfig` is
 * held to `toRaw(document.doc.document)` by the bind effect, so a `transactDoc` on the
 * configuration document is a new reference here — and an unchanged reference is a run that never
 * transacted, however the record's report reads.
 */
function projectConfigRef(): object | null {
  const config = projectState?.projectConfig;
  return config ? toRaw(config as unknown as object) : null;
}

/**
 * The ledger paths a record's write defaults to when `report` names none, by undo scope. `"none"`
 * has no default on purpose — see {@link AiToolReport.wrote}.
 */
function defaultPaths(command: AnyCommand, tab: Tab | null): string[] {
  if (command.undo === "document") {
    return [tab?.documentPath ?? "(untitled)"];
  }
  if (command.undo === "project") {
    return ["project.json"];
  }
  return ["(unknown file)"];
}

/**
 * File a projected run in the "Changed N files" ledger, by undo scope.
 *
 * No `undo` is a read or a navigation and records nothing. `disk` is `undo === "none"`, because
 * `undo: "project"` IS a transaction ⌘Z reaches and the ledger's flag means "unreachable by undo".
 * An EMPTY `wrote` is a run that changed nothing — an idempotent verb asked for a state it already
 * had — and files nothing, because the ledger names files that changed; `undefined` is a report
 * that named none and takes the record's defaults.
 */
function fileLedger(command: AnyCommand, tab: Tab | null, wrote?: readonly string[]): void {
  if (command.undo === undefined) {
    return;
  }
  const disk = command.undo === "none";
  for (const path of wrote ?? defaultPaths(command, tab)) {
    recordWrite({ disk, ok: true, path, tool: command.title });
  }
}

/**
 * A ToolRegistry whose tools are the active registry's `aiTool` records. Nothing is registered.
 *
 * @param {CommandToolDeps} deps
 * @returns {ToolRegistry}
 */
export function createCommandToolRegistry(deps: CommandToolDeps): ToolRegistry {
  /** The record projecting `name`, enabled or not — so `execute` can reach a refusal. */
  function commandFor(name: string): AnyCommand | undefined {
    return activeRegistry()
      ?.list()
      .find((command) => command.aiTool?.name === name);
  }

  /**
   * Run one projected record as the agent — the whole of §3 of the design.
   *
   * @param {string} name
   * @param {object} received
   * @returns {Promise<ToolResult>}
   */
  async function execute(name: string, received: object): Promise<ToolResult> {
    const registry = activeRegistry();
    const command = commandFor(name);
    if (!registry || !command) {
      /* Two absences, one shape. A window with no registry is answered in today's wording; a name
         no record projects is `@jxsuite/ai`'s own `Unknown tool` sentence. */
      return registry
        ? toolError(`Unknown tool: "${name}"`)
        : { error: `Cannot run "${name}" — this window has no command registry.`, success: false };
    }
    const tool = command.aiTool!;
    const args = received as Record<string, unknown>;

    /* The witness and the snapshot, only for a record that writes the document: `rootBefore` is
       what `transactDoc` replaces, and the snapshot is what the verdict compares against. */
    const tab = command.undo === "document" ? deps.getTab() : null;
    const rootBefore = tab ? toRaw(tab.doc.document) : null;
    /* The project witness's half: the configuration object the chokepoint holds, which every
       applied `project.json` transaction replaces. Read for `undo: "project"` records only — the
       comparison is meaningless for a record that does not claim the file. */
    const configBefore = command.undo === "project" ? projectConfigRef() : null;
    let snapshot: WriteSnapshot | null = null;
    let before: CommandContext;
    try {
      if (tab) {
        snapshot = await snapshotBeforeWrite(tab, deps);
      }
      if (command.level === "selection") {
        /* The selector first, with its own gate and its own argument refusal ("addresses no
           node", "expected an array of document paths"); then the verb, against the selection the
           selector made. Both steps are records; the bridge holds no predicate of its own. On a
           refusal at the second step the selection stays where the selector put it — the honest
           trace of what the agent attempted, and restoring it would be a second write inside a
           refusal path. */
        const { paths, ...rest } = args;
        await registry.run(SELECTOR, { paths });
        before = registry.context();
        await registry.run(command.id, rest);
      } else {
        before = registry.context();
        await registry.run(command.id, args);
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), success: false };
    }

    if (tab && toRaw(tab.doc.document) === rootBefore) {
      const frozen = registry.context().collab.sourceCanonical
        ? " A collaborator is editing its source, so structural edits are paused."
        : "";
      return {
        error: `${command.title} changed nothing: the document is exactly as it was.${frozen}`,
        success: false,
      };
    }

    /* The project witness's verdict, decided before the report so a report that throws is filed
       against it too. Unlike the document witness this is not a refusal: an idempotent project verb
       asked for a state it already had is an ordinary answer, and the record's own sentence may
       say why. What the witness owns is the LEDGER — nothing landed, so nothing is filed. */
    const projectUnchanged = command.undo === "project" && projectConfigRef() === configBefore;

    const after = registry.context();
    let report: AiToolReport;
    try {
      report = normaliseReport(tool.report({ after, args: args as never, before }));
    } catch (error) {
      /* `run` has resolved, so the write HAPPENED; a report that throws must not make it vanish.
         Left to the loop, the throw would be labelled "Failed to parse arguments" and the ledger
         would never be filed. So the ledger is filed from `undo`'s defaults — the report that would
         have named the paths is the thing that failed — and the model is told both halves. */
      fileLedger(command, tab, projectUnchanged ? [] : undefined);
      const message = error instanceof Error ? error.message : String(error);
      return { error: `${command.title} ran, but its report failed: ${message}`, success: false };
    }

    let { summary, wrote } = report;
    if (projectUnchanged) {
      /* The ledger files nothing whatever the report named. A report that did not itself know it
         was a no-op has its sentence replaced — a claim of a write over an untouched file is
         exactly the phantom this exists to catch. A report that answered `wrote: []` knew, and its
         sentence is kept: it says WHY nothing changed, which the witness cannot. */
      wrote = [];
      if (report.wrote === undefined || report.wrote.length > 0) {
        summary = `${command.title} changed nothing: project.json is exactly as it was.`;
      }
    }
    fileLedger(command, tab, wrote);
    if (tab && snapshot) {
      const verdict = await reportDocumentWrite(tab, snapshot, summary, deps);
      if (!verdict.success) {
        return verdict;
      }
      /* A success verdict may have appended the token hints; the report's sentence is kept. */
      summary = verdict.summary ?? summary;
    }
    return {
      success: true,
      summary,
      ...(report.data === undefined ? {} : { data: report.data }),
    };
  }

  return {
    register() {
      throw new Error(
        "command tools are a view over the registry; declare aiTool on the record instead",
      );
    },
    list() {
      const registry = activeRegistry();
      return registry ? advertisedCommandTools(registry, execute) : [];
    },
    listForLLM() {
      return this.list().map((definition) => ({
        type: "function",
        function: {
          name: definition.name,
          description: definition.description,
          parameters: definition.parameters,
        },
      }));
    },
    getDefinition(name) {
      const registry = activeRegistry();
      const command = commandFor(name);
      return registry && command ? definitionOf(registry, command, execute) : undefined;
    },
    validate() {
      return { valid: true };
    },
    execute,
  };
}

/**
 * Union of two registries for the loop: hand tools gated by tier, command tools gated by the
 * record.
 *
 * `list`/`listForLLM` concatenate (hand first); `getDefinition`/`validate`/`execute` go to
 * whichever side has the definition, hand first; an unknown name answers `Unknown tool: "<name>"`
 * as `@jxsuite/ai` does; `register` goes to `hand`. A name on both sides is a defect the parity
 * test in `tests/ai-system-prompt.test.ts` catches; the composite's hand-first order is not a
 * feature anyone may rely on.
 *
 * @param {ToolRegistry} hand
 * @param {ToolRegistry} commands
 * @returns {ToolRegistry}
 */
export function composeToolRegistries(hand: ToolRegistry, commands: ToolRegistry): ToolRegistry {
  function sideOf(name: string): ToolRegistry | undefined {
    if (hand.getDefinition(name)) {
      return hand;
    }
    return commands.getDefinition(name) ? commands : undefined;
  }
  return {
    register(tool) {
      hand.register(tool);
    },
    list() {
      return [...hand.list(), ...commands.list()];
    },
    listForLLM() {
      return [...hand.listForLLM(), ...commands.listForLLM()];
    },
    getDefinition(name) {
      return sideOf(name)?.getDefinition(name);
    },
    validate(name, args) {
      const side = sideOf(name);
      return side
        ? side.validate(name, args)
        : { valid: false, errors: [`Unknown tool: "${name}"`] };
    },
    async execute(name, args) {
      const side = sideOf(name);
      return side ? side.execute(name, args) : toolError(`Unknown tool: "${name}"`);
    },
  };
}
