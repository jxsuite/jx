/**
 * Tool catalogs (specs/ai.md §3.10): which tools a host has (membership), and which of them the
 * model is offered and may call right now (advertisement and the gate).
 *
 * @module @jxsuite/ai/catalog
 * @license MIT
 */

import { isFunction } from "@jxsuite/schema/guards";
import { createToolRegistry, toolError } from "../tools.ts";
import type {
  ToolAnnotations,
  ToolArguments,
  ToolContext,
  ToolDefinition,
  ToolRegistry,
} from "../tools.ts";

/** What a tool's name may be: what every provider and MCP accept. */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** A catalog member: a tool definition with the title and the hints a catalog requires. */
export type CatalogEntry = ToolDefinition & {
  readonly title: string;
  readonly annotations: ToolAnnotations;
};

/** A host's tools, each name once, in the order they were given. */
export interface Catalog {
  readonly entries: readonly CatalogEntry[];
  /** The member named `name`. */
  readonly get: (name: string) => CatalogEntry | undefined;
}

/** Why a catalog refused a tool. */
export class CatalogError extends Error {
  /**
   * `name`: the name is not {@link TOOL_NAME_PATTERN}. `duplicate`: two tools share it. `schema`:
   * its parameters are not an object schema. `annotations`: it has no title or no hints.
   */
  readonly code: "name" | "duplicate" | "schema" | "annotations";

  constructor(code: CatalogError["code"], message: string) {
    super(message);
    this.name = "CatalogError";
    this.code = code;
  }
}

/** The entry, or the reason it cannot be one. */
function admit(tool: ToolDefinition): CatalogEntry {
  if (!TOOL_NAME_PATTERN.test(tool.name)) {
    throw new CatalogError("name", `Tool name "${tool.name}" is not ${TOOL_NAME_PATTERN}.`);
  }
  if (tool.parameters.type !== "object") {
    throw new CatalogError("schema", `Tool "${tool.name}" parameters are not an object schema.`);
  }
  const { annotations, title } = tool;
  if (title === undefined || annotations === undefined) {
    throw new CatalogError("annotations", `Tool "${tool.name}" has no title or no annotations.`);
  }
  return { ...tool, annotations, title };
}

/**
 * A catalog of `groups`, in order. Membership is decided here, once: a tool is a member or the
 * catalog is not built.
 *
 * @param {...(readonly ToolDefinition[])} groups
 * @returns {Catalog}
 * @throws {CatalogError} For an invalid or duplicate name, a non-object parameter schema, or a
 *   missing title or annotations
 */
export function createCatalog(...groups: readonly (readonly ToolDefinition[])[]): Catalog {
  const byName = new Map<string, CatalogEntry>();
  for (const tool of groups.flat()) {
    if (byName.has(tool.name)) {
      throw new CatalogError("duplicate", `Tool "${tool.name}" is in the catalog twice.`);
    }
    byName.set(tool.name, admit(tool));
  }
  const entries = [...byName.values()];
  return { entries, get: (name) => byName.get(name) };
}

/**
 * Whether `entry` may be called with `args` right now: null, or what it requires (the end of the
 * sentence the model reads, such as `"an open project"`). `args` is null when the question is
 * whether to offer the tool at all.
 */
export type Gate = (entry: CatalogEntry, args: ToolArguments | null) => string | null;

/** How a host sees its catalog this round. */
export interface CatalogView {
  /** Refuses a member, at listing and at call time alike. */
  readonly gate?: Gate;
  /**
   * Narrows what the model is offered, without refusing the call: a member it returns false for is
   * not listed, and a call to it still runs.
   */
  readonly advertise?: (entry: CatalogEntry) => boolean;
}

/** A catalog with the plain registry that validates and runs its members. */
interface CatalogRun {
  members: Catalog;
  runner: ToolRegistry;
}

/**
 * The registry a turn reads its tools from: `list()` is the members, `listForLLM()` the members the
 * view admits, and `execute` refuses a call the gate refuses, naming what it requires. `catalog`
 * may be a function, read on every call, for a host whose membership follows its own state.
 *
 * @param {Catalog | (() => Catalog)} catalog
 * @param {CatalogView} [view]
 * @returns {ToolRegistry}
 */
export function catalogRegistry(
  catalog: Catalog | (() => Catalog),
  { advertise, gate }: CatalogView = {},
): ToolRegistry {
  const runners = new WeakMap<Catalog, ToolRegistry>();

  /** The catalog now, and the registry that validates and runs its members. */
  function current(): CatalogRun {
    const members = isFunction(catalog) ? catalog() : catalog;
    let runner = runners.get(members);
    if (!runner) {
      runner = createToolRegistry();
      for (const entry of members.entries) {
        runner.register(entry);
      }
      runners.set(members, runner);
    }
    return { members, runner };
  }

  function offered(entry: CatalogEntry): boolean {
    return (gate?.(entry, null) ?? null) === null && (advertise?.(entry) ?? true);
  }

  return {
    register() {
      throw new TypeError("A catalog's members are given to createCatalog, not registered.");
    },
    list: () => [...current().members.entries],
    listForLLM() {
      const { members, runner } = current();
      const names = new Set(members.entries.filter(offered).map((entry) => entry.name));
      // The runner's own listing, so the bytes are the ones a plain registry sends.
      return runner.listForLLM().filter((_tool, at) => names.has(members.entries[at]!.name));
    },
    getDefinition: (name) => current().members.get(name),
    validate: (name, args) => current().runner.validate(name, args),
    async execute(name: string, args: ToolArguments, ctx?: ToolContext) {
      const { members, runner } = current();
      const entry = members.get(name);
      const requires = entry ? (gate?.(entry, args) ?? null) : null;
      if (requires !== null) {
        return toolError(`Tool "${name}" is not available right now — it requires ${requires}.`);
      }
      return runner.execute(name, args, ctx);
    },
  };
}
