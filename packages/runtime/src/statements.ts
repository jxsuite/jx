/// <reference lib="dom" />
/**
 * Jx Statement Engine (spec §20) — structured function bodies.
 *
 * A Function entry's `body` may be a statement array instead of opaque JS source. This module is
 * the statements counterpart to expression.ts, with the same dual shape: `runStatements`
 * (interpreter) and `compileStatements` (JS emitter), shared by the runtime and every compiler
 * target. Statement kinds reuse web-platform names only: bare expression nodes (§19), the JSON
 * Schema `if`/`then`/`else` triple, `$switch`/`cases` in statement position, and WHATWG's
 * `dispatchEvent` with `CustomEventInit` members, `stopPropagation` and `preventDefault`.
 */

import { isFunction, isNonNullObject } from "@jxsuite/schema/guards";
import {
  compileExpression,
  compileOperandSource,
  evaluateExpression,
  evaluateOperand,
} from "./expression.ts";

import type {
  JxDispatchStatement,
  JxExpressionNode,
  JxIfStatement,
  JxStatement,
  JxSwitchStatement,
} from "@jxsuite/schema/types";
import type { CompileOpts, IterCtx } from "./expression.ts";
import type { JxScope } from "./types.ts";

interface RunOpts {
  /** Named-formula-style arguments bound for $args/<name> refs in the body. */
  args?: IterCtx["args"];
  /**
   * Dispatch target for dispatchEvent statements when there is no event to read `currentTarget`
   * from — a parameterised body invoked through `call`, or a lifecycle hook. A thunk is read at
   * dispatch time, because a mount's root does not exist yet when its scope is built.
   */
  target?: EventTarget | null | (() => EventTarget | null);
}

/*
 * Statement bodies come from documents that are not schema-validated at runtime, so the branch
 * arrays the schema requires may still be absent; these views say so and keep the fallbacks
 * honest.
 */
interface UncheckedIfStatement extends Omit<JxIfStatement, "then"> {
  then?: JxStatement[];
}

interface UncheckedSwitchStatement extends Omit<JxSwitchStatement, "cases"> {
  cases?: JxSwitchStatement["cases"];
}

type ClassifiedStatement =
  | { kind: "expression"; node: JxExpressionNode }
  | { kind: "if"; node: UncheckedIfStatement }
  | { kind: "switch"; node: UncheckedSwitchStatement }
  | { kind: "dispatch"; node: JxDispatchStatement }
  | { kind: "stopPropagation" }
  | { kind: "preventDefault" };

function classifyStatement(statement: JxStatement): ClassifiedStatement {
  if ("operator" in statement) {
    return { kind: "expression", node: statement };
  }
  if ("if" in statement) {
    return { kind: "if", node: statement };
  }
  if ("$switch" in statement) {
    return { kind: "switch", node: statement };
  }
  if ("stopPropagation" in statement) {
    return { kind: "stopPropagation" };
  }
  if ("preventDefault" in statement) {
    return { kind: "preventDefault" };
  }
  return { kind: "dispatch", node: statement };
}

/** A value `await` would adopt: anything with a callable `then` (ECMA-262 thenable). */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (isNonNullObject(value) || isFunction(value)) && "then" in value && isFunction(value.then);
}

/**
 * Execute a statement list sequentially against the reactive scope. A statement whose value is a
 * thenable is awaited before the next runs (ECMA async/await semantics); purely synchronous bodies
 * complete synchronously before the returned promise settles.
 */
export async function runStatements(
  statements: JxStatement[],
  state: JxScope,
  event: Event | null,
  opts: RunOpts = {},
): Promise<void> {
  const iterCtx: IterCtx | undefined = opts.args ? { args: opts.args } : undefined;
  for (const statement of statements) {
    const classified = classifyStatement(statement);
    switch (classified.kind) {
      case "expression": {
        const result = evaluateExpression(classified.node, state, event, iterCtx);
        if (isThenable(result)) {
          // Awaited for its ordering alone: the next statement runs once this one settles.
          void (await result);
        }
        break;
      }
      case "if": {
        const branch = classified.node;
        const taken = evaluateOperand(branch.if, state, event, iterCtx) ? branch.then : branch.else;
        if (Array.isArray(taken)) {
          await runStatements(taken, state, event, opts);
        }
        break;
      }
      case "switch": {
        const branch = classified.node;
        const key = String(evaluateOperand(branch.$switch, state, event, iterCtx));
        const cases = branch.cases ?? {};
        const taken = Object.hasOwn(cases, key) ? cases[key] : branch.default;
        if (Array.isArray(taken)) {
          await runStatements(taken, state, event, opts);
        }
        break;
      }
      case "dispatch": {
        const dispatch = classified.node;
        // An event's own target wins; the option is the fallback for bodies run without one.
        const fallback = isFunction(opts.target) ? opts.target() : opts.target;
        const target = event?.currentTarget ?? fallback;
        if (!target) {
          break;
        }
        const init: CustomEventInit = {};
        if ("detail" in dispatch) {
          init.detail = evaluateOperand(dispatch.detail, state, event, iterCtx);
        }
        if (dispatch.bubbles !== undefined) {
          init.bubbles = dispatch.bubbles;
        }
        if (dispatch.composed !== undefined) {
          init.composed = dispatch.composed;
        }
        target.dispatchEvent(new CustomEvent(dispatch.dispatchEvent, init));
        break;
      }
      case "stopPropagation": {
        // The event the handler is running for; a body run without one has nothing to stop.
        event?.stopPropagation();
        break;
      }
      case "preventDefault": {
        event?.preventDefault();
        break;
      }
      default: {
        break;
      }
    }
  }
}

interface StatementCompileOpts extends CompileOpts {
  /** JS expression for the dispatchEvent target; defaults to `(event && event.currentTarget)`. */
  dispatchTarget?: string;
  /** Indentation prefix for emitted lines. */
  indent?: string;
}

/**
 * Compile a statement list to a JS statement block (no surrounding braces). Mirrors `runStatements`
 * exactly; each statement kind lowers to its genuine ECMAScript form — expression statements,
 * `if`/`else`, `switch` over the discriminant's string form, and `dispatchEvent(new
 * CustomEvent(...))`.
 */
export function compileStatements(
  statements: JxStatement[],
  opts: StatementCompileOpts = {},
): string {
  const indent = opts.indent ?? "";
  const lines: string[] = [];
  for (const statement of statements) {
    const classified = classifyStatement(statement);
    switch (classified.kind) {
      case "expression": {
        lines.push(`${indent}${compileExpression(classified.node, opts)};`);
        break;
      }
      case "if": {
        const branch = classified.node;
        const test = compileOperandSource(branch.if, opts);
        const inner = { ...opts, indent: `${indent}  ` };
        lines.push(`${indent}if (${test}) {`, compileStatements(branch.then ?? [], inner));
        if (branch.else) {
          lines.push(`${indent}} else {`, compileStatements(branch.else, inner));
        }
        lines.push(`${indent}}`);
        break;
      }
      case "switch": {
        const branch = classified.node;
        const disc = compileOperandSource(branch.$switch, opts);
        const inner = { ...opts, indent: `${indent}    ` };
        lines.push(`${indent}switch (String(${disc})) {`);
        for (const [key, caseStatements] of Object.entries(branch.cases ?? {})) {
          lines.push(
            `${indent}  case ${JSON.stringify(key)}: {`,
            compileStatements(caseStatements, inner),
            `${indent}    break;`,
            `${indent}  }`,
          );
        }
        if (branch.default) {
          lines.push(
            `${indent}  default: {`,
            compileStatements(branch.default, inner),
            `${indent}  }`,
          );
        }
        lines.push(`${indent}}`);
        break;
      }
      case "dispatch": {
        const dispatch = classified.node;
        const eventName = opts.eventParam ?? "event";
        const target = opts.dispatchTarget ?? `(${eventName} && ${eventName}.currentTarget)`;
        const init: string[] = [];
        if ("detail" in dispatch) {
          init.push(`detail: ${compileOperandSource(dispatch.detail, opts)}`);
        }
        if (dispatch.bubbles !== undefined) {
          init.push(`bubbles: ${JSON.stringify(dispatch.bubbles)}`);
        }
        if (dispatch.composed !== undefined) {
          init.push(`composed: ${JSON.stringify(dispatch.composed)}`);
        }
        const initSource = init.length > 0 ? `, { ${init.join(", ")} }` : "";
        lines.push(
          `${indent}${target}?.dispatchEvent(new CustomEvent(${JSON.stringify(dispatch.dispatchEvent)}${initSource}));`,
        );
        break;
      }
      case "stopPropagation": {
        lines.push(`${indent}${opts.eventParam ?? "event"}?.stopPropagation();`);
        break;
      }
      case "preventDefault": {
        lines.push(`${indent}${opts.eventParam ?? "event"}?.preventDefault();`);
        break;
      }
      default: {
        break;
      }
    }
  }
  return lines.join("\n");
}
