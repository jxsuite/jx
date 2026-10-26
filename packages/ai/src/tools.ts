/**
 * Tools.js — Tool registry infrastructure
 *
 * Provider-agnostic base classes for defining and registering tools that an LLM can call. Tools
 * have JSON Schema parameter definitions and execute functions. The registry validates arguments
 * before execution.
 *
 * Every call carries a {@link ToolContext}: its own signal, its call id, who it acts for, the turn's
 * write ledger and the session's facts (specs/ai.md §3.7). A caller that has none gets a detached
 * one, so a tool run outside a turn (a test, a command) records into nothing and cannot be
 * stopped.
 *
 * @module @jxsuite/ai/tools
 * @license MIT
 * @docs extending/embedding/assistant-harness
 */

import type {
  AiWrite,
  JsonObject,
  JsonValue,
  SessionFacts,
  ToolContext,
  ToolResult,
  WriteLedger,
} from "./core-types.ts";
import type { OpenAITool } from "./messages/types.ts";

export type {
  Actor,
  AiWrite,
  JsonArray,
  JsonObject,
  JsonValue,
  SessionFacts,
  ToolContext,
  ToolResult,
  WriteLedger,
} from "./core-types.ts";

/**
 * JSON Schema fragment describing a tool's parameters. Only the subset the registry's lightweight
 * validator inspects is modeled; arbitrary extra keywords are permitted.
 */
export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  /** Any other keyword: a JSON value, or a subschema (`items`, `anyOf`) or a map of them. */
  [keyword: string]:
    | JsonValue
    | JSONSchema
    | readonly JSONSchema[]
    | Record<string, JSONSchema>
    | undefined;
}

/**
 * A call's arguments: the JSON object a model sent, as {@link invokeTool} decodes it, or one a host
 * builds in code, which may leave a member `undefined` (the validator reports it as such).
 */
export type ToolArguments = Readonly<Record<string, JsonValue | undefined>>;

/**
 * What a tool does to the world, as MCP's four behaviour hints name it (specs/ai.md §3.10). Every
 * hint is stated, never left to a default: a host decides approvals and an MCP client its warnings
 * from them.
 */
export interface ToolAnnotations {
  /** It changes nothing. */
  readonly readOnlyHint: boolean;
  /** It may destroy or overwrite something a person made. */
  readonly destructiveHint: boolean;
  /** Calling it twice with the same arguments does what calling it once did. */
  readonly idempotentHint: boolean;
  /** It reaches outside the project (the network, an installer). */
  readonly openWorldHint: boolean;
}

/** Why a call needs the author's approval before it runs. */
export type ApprovalReason = "destructive" | "not-undoable" | "open-world";

/** What a call asks a person, before any of the tool's own code runs (specs/ai.md §3.11). */
export type InteractionRequest =
  | {
      readonly kind: "question";
      readonly question: string;
      /** Short answers offered as choices; a person may always answer in their own words. */
      readonly options: readonly string[];
      /** One line of why the question is being asked. */
      readonly context: string;
    }
  | {
      readonly kind: "approval";
      readonly tool: string;
      readonly title: string;
      /** What the call would do, for the person deciding. */
      readonly summary: string;
      readonly reason: ApprovalReason;
    };

/** A person's answer to an {@link InteractionRequest}. */
export type InteractionResponse =
  /** `answer: null` with `skipped` is "you decide"; with neither, the question went unanswered. */
  | { readonly kind: "question"; readonly answer: string | null; readonly skipped: boolean }
  | { readonly kind: "approval"; readonly approved: boolean };

/** Whether a call may run: as it is, never, or once the author approves it. */
export type ApprovalDecision =
  | { readonly kind: "proceed" }
  | { readonly kind: "deny"; readonly message: string }
  | { readonly kind: "confirm"; readonly reason: ApprovalReason; readonly summary: string };

/** Decides, per call, whether it needs the author's approval before it runs. */
export type ApprovalPolicy = (definition: ToolDefinition, args: ToolArguments) => ApprovalDecision;

/** The policy that approves every call: what a host with no approvals runs. */
export const proceedAlways: ApprovalPolicy = () => ({ kind: "proceed" });

export interface ToolDefinition {
  name: string;
  /** A person-facing name for the tool. A catalog requires it. */
  title?: string;
  description: string;
  parameters: JSONSchema;
  /** Its behaviour hints. A catalog requires them. */
  annotations?: ToolAnnotations;
  strict: boolean;
  llmStrict: boolean;
  /**
   * The call suspends the turn on a person rather than doing work (`ask_user`), so a round that
   * made only such calls does not spend the turn's work budget.
   */
  interactive?: boolean;
  /**
   * What the call asks a person, or the sentence refusing the call (`refusal`). A tool that
   * declares it is never executed by the invoker: the person's answer goes to `settle`, so no tool
   * body awaits a person.
   */
  interaction?: (args: ToolArguments) => InteractionRequest | { readonly refusal: string };
  /** The result of a call to an `interaction` tool, given the person's answer. */
  settle?: (args: ToolArguments, response: InteractionResponse) => ToolResult;
  execute: (args: ToolArguments, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
}

export interface ToolRegistry {
  register: (tool: ToolDefinition) => void;
  list: () => ToolDefinition[];
  listForLLM: () => object[];
  validate: (toolName: string, args: ToolArguments) => { valid: boolean; errors?: string[] };
  /**
   * Run a tool with the call's context; a registry that wraps another forwards `ctx` unchanged.
   * Omitted, the call gets a detached context ({@link createToolContext}).
   */
  execute: (toolName: string, args: ToolArguments, ctx?: ToolContext) => Promise<ToolResult>;
  getDefinition: (toolName: string) => ToolDefinition | undefined;
}

// ─── ToolResult ──────────────────────────────────────────────────────────────

/**
 * Create a successful tool result.
 *
 * @param {ToolResult["data"]} data - Result data
 * @param {string} [summary] - Human-readable summary
 * @returns {ToolResult}
 */
export function toolSuccess(data: ToolResult["data"], summary?: string): ToolResult {
  /* SAFETY: the only mismatch is `summary: undefined` against the optional `summary`. An absent
     summary has always been carried as an explicit `undefined` member, which every reader treats
     as absent and JSON drops, so the result keeps the shape this function has always returned. */
  return { success: true, data, summary } as ToolResult;
}

/**
 * Create a failed tool result.
 *
 * @param {string} error - Error message
 * @returns {ToolResult}
 */
export function toolError(error: string): ToolResult {
  return { success: false, error };
}

// ─── ToolDefinition ──────────────────────────────────────────────────────────

/**
 * Create a tool definition.
 *
 * @param {object} opts
 * @param {string} opts.name - Unique tool name (lowercase, underscores for spaces)
 * @param {string} opts.description - What the tool does (used by the LLM to decide when to call it)
 * @param {object} opts.parameters - JSON Schema for the tool's arguments
 * @param {boolean} [opts.strict] - Whether the registry enforces its own argument validation
 *   (default true). Distinct from `llmStrict`.
 * @param {boolean} [opts.llmStrict] - Whether to send OpenAI `strict: true` in the function schema
 *   (default false). Only enable if the parameter schema is OpenAI-strict-compliant
 *   (additionalProperties:false everywhere, all properties in `required`, every property typed).
 * @param {boolean} [opts.interactive] - The call suspends the turn on a person (`ask_user`)
 * @param {string} [opts.title] - A person-facing name, which a catalog requires
 * @param {ToolAnnotations} [opts.annotations] - Its behaviour hints, which a catalog requires
 * @param {ToolDefinition["interaction"]} [opts.interaction] - What the call asks a person
 * @param {ToolDefinition["settle"]} [opts.settle] - The result, given the person's answer
 * @param {(args: ToolArguments, ctx: ToolContext) => Promise<ToolResult> | ToolResult} opts.execute -
 *   The tool implementation, handed the call's context
 * @returns {ToolDefinition}
 */
export function createToolDefinition({
  name,
  description,
  parameters,
  strict = true,
  llmStrict = false,
  interactive,
  title,
  annotations,
  interaction,
  settle,
  execute,
}: {
  name: string;
  description: string;
  parameters: JSONSchema;
  strict?: boolean;
  llmStrict?: boolean;
  interactive?: boolean;
  title?: string;
  annotations?: ToolAnnotations;
  interaction?: ToolDefinition["interaction"];
  settle?: ToolDefinition["settle"];
  execute: (args: ToolArguments, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
}): ToolDefinition {
  const definition: ToolDefinition = { name, description, parameters, strict, llmStrict, execute };
  // After `execute` rather than before it: a definition serializes without its function either way.
  if (interactive !== undefined) {
    definition.interactive = interactive;
  }
  if (title !== undefined) {
    definition.title = title;
  }
  if (annotations !== undefined) {
    definition.annotations = annotations;
  }
  if (interaction !== undefined) {
    definition.interaction = interaction;
  }
  if (settle !== undefined) {
    definition.settle = settle;
  }
  return definition;
}

// ─── ToolContext ─────────────────────────────────────────────────────────────

/**
 * A write ledger: the writes one turn's tools record, in order.
 *
 * @param {(write: AiWrite) => void} [onRecord] - Told of each write as it is recorded
 * @returns {WriteLedger}
 */
export function createLedger(onRecord?: (write: AiWrite) => void): WriteLedger {
  const writes: AiWrite[] = [];
  return {
    record(write: AiWrite) {
      writes.push(write);
      onRecord?.(write);
    },
    writes,
  };
}

/**
 * Per-session facts: JSON a tool remembers across one conversation's turns.
 *
 * @param {string | null} [sessionId]
 * @param {Readonly<Record<string, JsonValue>>} [initial] - Facts to start from (a restored session)
 * @returns {SessionFacts & { toJSON: () => Record<string, JsonValue> }}
 */
export function createSessionFacts(
  sessionId: string | null = null,
  initial: Readonly<Record<string, JsonValue>> = {},
): SessionFacts & { toJSON: () => Record<string, JsonValue> } {
  const facts = new Map<string, JsonValue>(Object.entries(initial));
  return {
    sessionId,
    get: (key: string) => facts.get(key),
    set: (key: string, value: JsonValue) => {
      facts.set(key, value);
    },
    toJSON: () => Object.fromEntries(facts),
  };
}

/** A signal that never aborts: the one a detached call gets. */
const NEVER = new AbortController().signal;

/**
 * A tool call's context. Every field not given is detached: a signal that never aborts, an empty
 * call id, a fresh ledger nothing files, empty session facts and a progress sink that drops
 * everything. That is what a call made outside any turn gets.
 *
 * @param {Partial<ToolContext>} [init]
 * @returns {ToolContext}
 */
export function createToolContext(init: Partial<ToolContext> = {}): ToolContext {
  const session = init.session ?? createSessionFacts();
  return {
    actor: init.actor ?? {
      id: `assistant:${session.sessionId ?? "local"}:`,
      kind: "assistant",
      sessionId: session.sessionId,
      turnId: "",
    },
    callId: init.callId ?? "",
    ledger: init.ledger ?? createLedger(),
    progress: init.progress ?? (() => {}),
    session,
    signal: init.signal ?? NEVER,
  };
}

/** A call's own signal, and the unlinking {@link linkCallSignal} hands back with it. */
export interface CallSignalLink {
  readonly signal: AbortSignal;
  /** Unlink the call from its turn, once the call settles. */
  release: () => void;
}

/**
 * A call's own signal, linked to its turn's: it aborts when the turn does, with the turn's reason,
 * and {@link release} unlinks it once the call settles, so a Stop later in the turn reaches no call
 * that has already finished.
 *
 * Linked by hand, with one `{ once: true }` listener, rather than with `AbortSignal.any`, so page
 * webviews and the Worker's ES2023 typing agree.
 *
 * @param {AbortSignal} turn
 * @returns {CallSignalLink}
 */
export function linkCallSignal(turn: AbortSignal): CallSignalLink {
  const call = new AbortController();
  if (turn.aborted) {
    call.abort(turn.reason);
    return { release: () => {}, signal: call.signal };
  }
  const onAbort = () => {
    call.abort(turn.reason);
  };
  turn.addEventListener("abort", onAbort, { once: true });
  return {
    release: () => {
      turn.removeEventListener("abort", onAbort);
    },
    signal: call.signal,
  };
}

// ─── ToolRegistry ────────────────────────────────────────────────────────────

/**
 * Create a new tool registry.
 *
 * @returns {ToolRegistry}
 */
export function createToolRegistry() {
  const _tools = new Map<string, ToolDefinition>();

  return {
    /**
     * Register a tool definition.
     *
     * @param {ToolDefinition} tool
     */
    register(tool: ToolDefinition) {
      if (_tools.has(tool.name)) {
        console.warn(`Tool "${tool.name}" is being re-registered.`);
      }
      _tools.set(tool.name, tool);
    },

    /**
     * List all registered tool definitions.
     *
     * @returns {ToolDefinition[]}
     */
    list() {
      return [..._tools.values()];
    },

    /**
     * List tools in OpenAI function-calling format.
     *
     * @returns {object[]}
     */
    listForLLM() {
      return [..._tools.values()].map((t): OpenAITool => {
        const fn: OpenAITool["function"] = {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        };
        /* OpenAI strict mode is opt-in per tool via `llmStrict`, NOT the `strict` field: that one
           drives the registry's own argument validation below. They are different concerns:
           OpenAI strict requires every object to set additionalProperties:false and list all
           properties in `required`, which the Jx tools deliberately don't (e.g. set_property's
           `value` is polymorphic and optional). GPT-5.x rejects the schema otherwise. */
        if (t.llmStrict === true) {
          fn.strict = true;
        }
        return { type: "function", function: fn };
      });
    },

    /**
     * Get a single tool definition by name.
     *
     * @param {string} toolName
     * @returns {ToolDefinition | undefined}
     */
    getDefinition(toolName: string) {
      return _tools.get(toolName);
    },

    /**
     * Validate tool arguments against the tool's JSON Schema.
     *
     * This is a lightweight structural check — it verifies required properties exist and property
     * types match. Full JSON Schema validation (pattern, minimum, maximum, enum, etc.) can be
     * layered on with a proper validator library if needed.
     *
     * @param {string} toolName
     * @param {ToolArguments} args
     * @returns {{ valid: boolean; errors?: string[] }}
     */
    validate(toolName: string, args: ToolArguments) {
      const tool = _tools.get(toolName);
      if (!tool) {
        return { valid: false, errors: [`Unknown tool: "${toolName}"`] };
      }

      if (!tool.strict) {
        return { valid: true };
      }

      const schema = tool.parameters;
      if (!schema.properties) {
        return { valid: true };
      }

      const errors: string[] = [];
      const props = schema.properties;
      const required = schema.required || [];

      // Check required properties
      for (const key of required) {
        if (!(key in args) || args[key] === undefined || args[key] === null) {
          errors.push(`Missing required argument: "${key}"`);
        }
      }

      // Check property types (basic)
      for (const [key, value] of Object.entries(args)) {
        const propSchema = props[key];
        if (!propSchema) {
          // Unknown property — warn but don't fail (LLM might send extra)
          continue;
        }

        const expectedType = propSchema.type;
        if (!expectedType) {
          continue;
        }

        const actualType = argumentType(value);

        // Number / integer type validation with string coercion
        if (expectedType === "number" || expectedType === "integer") {
          if (isOfType(value, "number")) {
            continue;
          }
          if (isOfType(value, "string")) {
            if (!Number.isNaN(Number(value))) {
              continue;
            }
            errors.push(`Argument "${key}" should be a number, got non-numeric string "${value}"`);
            continue;
          }
          errors.push(`Argument "${key}" should be a number, got ${actualType}`);
          continue;
        }

        if (expectedType === "string" && actualType !== "string") {
          errors.push(`Argument "${key}" should be a string, got ${actualType}`);
        } else if (expectedType === "boolean" && actualType !== "boolean") {
          errors.push(`Argument "${key}" should be a boolean, got ${actualType}`);
        } else if (expectedType === "array" && actualType !== "array") {
          errors.push(`Argument "${key}" should be an array, got ${actualType}`);
        } else if (expectedType === "object" && actualType !== "object") {
          errors.push(`Argument "${key}" should be an object, got ${actualType}`);
        }
      }

      return errors.length > 0 ? { valid: false, errors } : { valid: true };
    },

    /**
     * Execute a tool by name. Validates arguments before execution.
     *
     * @param {string} toolName
     * @param {ToolArguments} args
     * @param {ToolContext} [ctx] - The call's context; omitted, a detached one
     * @returns {Promise<ToolResult>}
     */
    async execute(toolName: string, args: ToolArguments, ctx: ToolContext = createToolContext()) {
      const tool = _tools.get(toolName);
      if (!tool) {
        return toolError(`Unknown tool: "${toolName}"`);
      }

      // Validate
      const validation = this.validate(toolName, args);
      if (!validation.valid) {
        return toolError(`Validation failed: ${(validation.errors || []).join("; ")}`);
      }

      try {
        return await tool.execute(args, ctx);
      } catch (error) {
        return toolError(`Tool "${toolName}" execution error: ${messageOf(error)}`);
      }
    },
  };
}

// ─── Invocation ──────────────────────────────────────────────────────────────

/** A call a model made: its id, the tool, and the arguments exactly as streamed. */
export interface ToolCall {
  readonly callId: string;
  readonly name: string;
  /** Raw, and possibly not JSON: a call cut off mid-arguments still arrives. */
  readonly argumentsText: string;
}

/**
 * What invoking a call produced: a result (`executed` is false when the tool's body never ran), or
 * the question a person must answer before it can be invoked again with their response.
 */
export type InvokeOutcome =
  | { readonly status: "done"; readonly result: ToolResult; readonly executed: boolean }
  | { readonly status: "needs_input"; readonly request: InteractionRequest };

/** How a call is invoked: the host's approval policy, and a person's answer on a second invoke. */
export interface InvokeOptions {
  /** Defaults to {@link proceedAlways}. */
  readonly approval?: ApprovalPolicy;
  /** The answer to the request a first invoke returned as `needs_input`. */
  readonly response?: InteractionResponse;
}

/** What a declined call answers. */
export const DECLINED_SENTENCE = "The author declined this call.";

/**
 * A result as JSON would carry it: the serialized bytes are unchanged, and `data` becomes plain
 * JSON, so the result survives any transport that serializes it.
 *
 * @param {ToolResult} result
 * @returns {ToolResult}
 */
export function normalizeToolResult(result: ToolResult): ToolResult {
  /* SAFETY: `success`, `error` and `summary` are a boolean and strings, which the round trip keeps
     as they were (an undefined one is dropped, and each is optional but `success`); `data` becomes
     its JSON form, and ToolResult does not constrain `data`. */
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- the JSON round trip is the point
  return JSON.parse(JSON.stringify(result)) as ToolResult;
}

/**
 * The `message` of what a tool, a registry or a JSON round trip threw, as the result texts quote
 * it.
 *
 * @param {unknown} cause - What was thrown
 * @returns {string}
 */
function messageOf(cause: unknown): string {
  /* SAFETY: only `message` is read. Every throw in reach is an Error (JSON.parse's SyntaxError,
     parseArguments' TypeError, a tool's own Error); a tool that throws a non-null non-Error reads
     it as undefined, which the result text has always quoted as "undefined". */
  return (cause as Error).message;
}

/** The types an argument's mismatch sentence names by `typeof`, each with the value it names. */
interface PrimitiveTypes {
  string: string;
  number: number;
  boolean: boolean;
  undefined: undefined;
}

/** The {@link PrimitiveTypes} names, in the order {@link argumentType} tries them. */
const PRIMITIVE_TYPES = [
  "string",
  "number",
  "boolean",
  "undefined",
] as const satisfies readonly (keyof PrimitiveTypes)[];

/**
 * True when an argument is of the named primitive type.
 *
 * @param {JsonValue | undefined} value - An argument, as sent
 * @param {keyof PrimitiveTypes} type - The type to test for
 * @returns {boolean}
 */
function isOfType<T extends keyof PrimitiveTypes>(
  value: JsonValue | undefined,
  type: T,
): value is PrimitiveTypes[T] {
  return typeof value === type;
}

/**
 * True when a JSON value is an object: not `null`, and not an array.
 *
 * @param {JsonValue | undefined} value - Parsed arguments
 * @returns {boolean}
 */
function isArgumentObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The type an argument's mismatch sentence names: its `typeof`, except that an array is `array`.
 * `null` is `object`, as `typeof` has always named it here.
 *
 * @param {JsonValue | undefined} value - An argument, as sent
 * @returns {string}
 */
function argumentType(value: JsonValue | undefined): string {
  if (Array.isArray(value)) {
    return "array";
  }
  return PRIMITIVE_TYPES.find((type) => isOfType(value, type)) ?? "object";
}

/**
 * A call's arguments as the object a tool takes.
 *
 * An empty string is no arguments. JSON that parses to something other than an object (`null`, an
 * array, a number) is refused with its own sentence rather than reaching the registry, where a
 * validator reading a property of `null` threw a message about the validator.
 */
function parseArguments(text: string): ToolArguments {
  if (!text) {
    return {};
  }
  /* SAFETY: JSON.parse without a reviver only ever produces null, booleans, numbers, strings,
     arrays and plain objects, which is exactly JsonValue. */
  const parsed = JSON.parse(text) as JsonValue;
  if (!isArgumentObject(parsed)) {
    const type = parsed === null ? "null" : argumentType(parsed);
    throw new TypeError(`arguments must be a JSON object, got ${type}`);
  }
  return parsed;
}

/**
 * Run one model call through a registry, in order: parse its arguments, put an interaction tool's
 * question to a person or settle it with their answer, ask the approval policy, execute it with its
 * context, and return the result as JSON would carry it (specs/ai.md §3.11). Never throws: a
 * failure is a result the model reads.
 *
 * Arguments that do not parse answer `Failed to parse arguments: <reason>`, with the same prefix
 * for a non-object, so the model reads both as one kind of mistake. A call that needs a person
 * answers `needs_input` before any tool code runs; the caller invokes it again with the response.
 * The registry keeps its own texts for an unknown tool, failed validation, a gate and a tool that
 * threw. A registry that itself throws is answered with the parse prefix too, as the agent loop
 * always answered it, and a result JSON cannot carry is answered as one that cannot be serialized.
 *
 * @param {ToolRegistry} registry
 * @param {ToolCall} call
 * @param {ToolContext} ctx - The call's context, forwarded to the tool unchanged
 * @param {InvokeOptions} [options]
 * @returns {Promise<InvokeOutcome>}
 */
export async function invokeTool(
  registry: ToolRegistry,
  call: ToolCall,
  ctx: ToolContext,
  { approval = proceedAlways, response }: InvokeOptions = {},
): Promise<InvokeOutcome> {
  let executed = false;
  let result: ToolResult;
  try {
    const args = parseArguments(call.argumentsText);
    const definition = registry.getDefinition(call.name);
    const step = definition ? beforeExecute(registry, definition, args, approval, response) : null;
    if (step?.status === "needs_input") {
      return step;
    }
    if (step) {
      ({ result } = step);
    } else {
      executed = true;
      result = await registry.execute(call.name, args, ctx);
    }
  } catch (error) {
    result = toolError(`Failed to parse arguments: ${messageOf(error)}`);
  }
  try {
    return { status: "done", result: normalizeToolResult(result), executed };
  } catch (error) {
    /* A result JSON cannot carry (a cycle, a BigInt) cannot be sent back to the model either. It
       used to throw out of the turn; the model is told instead, and the turn goes on. */
    const reason = messageOf(error);
    return {
      status: "done",
      result: toolError(
        `Tool "${call.name}" returned a result that cannot be serialized: ${reason}`,
      ),
      executed,
    };
  }
}

/**
 * The steps before a body runs: an interaction tool is asked or settled and never executed, and any
 * other tool is approved, denied, or put to the author. Null means execute.
 */
function beforeExecute(
  registry: ToolRegistry,
  definition: ToolDefinition,
  args: ToolArguments,
  approval: ApprovalPolicy,
  response: InteractionResponse | undefined,
): InvokeOutcome | null {
  const { interaction, settle } = definition;
  if (interaction && settle) {
    const validation = registry.validate(definition.name, args);
    if (!validation.valid) {
      return refused(`Validation failed: ${(validation.errors || []).join("; ")}`);
    }
    if (response) {
      return {
        status: "done",
        result: settleSafely(definition.name, settle, args, response),
        executed: false,
      };
    }
    const request = interaction(args);
    return "refusal" in request ? refused(request.refusal) : { status: "needs_input", request };
  }
  const decision = approval(definition, args);
  if (decision.kind === "deny") {
    return refused(decision.message);
  }
  if (decision.kind === "confirm") {
    if (!response) {
      return {
        status: "needs_input",
        request: {
          kind: "approval",
          reason: decision.reason,
          summary: decision.summary,
          title: definition.title ?? definition.name,
          tool: definition.name,
        },
      };
    }
    if (response.kind !== "approval" || !response.approved) {
      return refused(DECLINED_SENTENCE);
    }
  }
  return null;
}

/** A result no body produced. */
function refused(error: string): InvokeOutcome {
  return { status: "done", result: toolError(error), executed: false };
}

/** `settle`'s result, or the execution error a registry would have answered for a throw. */
function settleSafely(
  name: string,
  settle: NonNullable<ToolDefinition["settle"]>,
  args: ToolArguments,
  response: InteractionResponse,
): ToolResult {
  try {
    return settle(args, response);
  } catch (error) {
    return toolError(`Tool "${name}" execution error: ${messageOf(error)}`);
  }
}
