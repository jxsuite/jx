/**
 * The TypeScript a checker reads for one function body (`spec.md` §23.3).
 *
 * A body is the inside of a function, so no checker can read it alone: `return` is not allowed at
 * the top of a file, and `state` is not declared anywhere. This module writes the file around it. A
 * checker is handed {@link VirtualBody.text}, finds its errors there, and {@link bodyOffsetOf} puts
 * each one back at its place in the body the author wrote. The body is copied into the file
 * verbatim, so that mapping is a single shift and cannot drift.
 *
 * It is pure and has no dependency on a compiler, a DOM or Node, so every surface that checks types
 * (Studio's editor, and later a mapper for `tsc`) reads the same file and cannot disagree about
 * what a document's types are.
 *
 * **What `State` says is what the document can prove, and no more.** A literal gives its type, an
 * object its shape and an array the types of its items. Anything a document does not determine (a
 * `$prototype` instance, an `$expression`, a template, a `timing: "server"` call, a `null`) is
 * `any`, because an error about code the author cannot fix teaches them to ignore the checker. What
 * `State` does not declare is an error: `state.nope = 1` is the case this exists to catch.
 *
 * @docs framework/concepts/functions
 */
import { isJsonObject } from "../guards";
import {
  boundEvents,
  eventLines,
  eventType,
  itemType,
  membersOf,
  readsRow,
  rootSite,
  siteInto,
} from "./document-scopes";
import type { Site, StateScope } from "./document-scopes";
import { definitionParts, definitionsOf, pointerInto, propertyName, written } from "./schema-types";
import { parametersOf, stateIndex, typeOfEntry } from "./state-types";
import type { JsonObject, JsonValue, JxElement } from "../../types";

/** Where a body sits in a document. */
export type VirtualTarget =
  | {
      /** A `state` entry of the document root. */
      kind: "state";
      key: string;
    }
  | {
      /** An inline `on*` handler on the element at `path`. */
      kind: "event";
      eventKey: string;
      path: readonly (string | number)[];
    };

/** One body, wrapped for a checker. */
export interface VirtualBody {
  /** The file a checker reads. */
  text: string;
  /** Where the body's first character is in {@link VirtualBody.text}. */
  bodyStart: number;
  /** One past the body's last character in {@link VirtualBody.text}. */
  bodyEnd: number;
  /** The names the function is called with, as the runtime binds them. */
  params: string[];
}

/**
 * Diagnostic codes that say a module could not be found. A body is not a module: it cannot `import`
 * statically, and a dynamic `import("x")` resolves in the browser, not in the checker, so an
 * unresolved specifier is not something the author can fix from here (`studio.md` §16.7).
 */
export const UNRESOLVED_MODULE_CODES: ReadonlySet<number> = new Set([2307, 2792, 7016]);

/** What a target names: the function entry, and what surrounds the element that holds it. */
interface Located {
  definition: JsonValue | undefined;
  /** The type of the event the body is given. */
  event: string;
  site: Site;
}

/** Find a target in a document. */
function locate(doc: JsonObject, target: VirtualTarget): Located {
  let site = rootSite(doc);
  if (target.kind === "state") {
    const event = boundEvents(doc).get(pointerInto("/state", target.key)) ?? "any";
    return { definition: isJsonObject(doc.state) ? doc.state[target.key] : undefined, event, site };
  }
  let owner: JsonValue | undefined = doc;
  let pointer = "";
  for (const segment of target.path) {
    const child: JsonValue | undefined = Array.isArray(owner)
      ? owner[Number(segment)]
      : isJsonObject(owner)
        ? owner[String(segment)]
        : undefined;
    pointer = pointerInto(pointer, segment);
    site = siteInto(site, owner, segment, child, pointer);
    owner = child;
  }
  return isJsonObject(owner)
    ? { definition: owner[target.eventKey], event: eventType(owner, target.eventKey, site), site }
    : { definition: undefined, event: "any", site };
}

/**
 * Write the `State` a body reads: one interface for each element on the way down that has `state`,
 * each under the one around it, and over them the row of the map the body is drawn in.
 */
function stateLines(site: Site, index: string, defs: boolean): string[] {
  const chain: StateScope[] = [];
  for (let at: StateScope | null = site.scope; at; at = at.parent) {
    chain.unshift(at);
  }
  const inRow = site.row !== null && readsRow(site.scope);
  // The innermost is `State` itself, unless the row is written over it.
  const nameOf = (scope: StateScope): string =>
    scope === site.scope && !inRow ? "State" : `State$${chain.indexOf(scope)}`;
  const lines: string[] = [];
  for (const scope of chain) {
    const { inherited, own } = membersOf(scope);
    const around = scope.parent ? nameOf(scope.parent) : null;
    const closed = around === null || inherited !== null;
    lines.push(`interface ${nameOf(scope)}${closed ? "" : ` extends ${around}`} {`);
    for (const key of inherited ?? []) {
      lines.push(`  ${propertyName(key)}: ${around}[${JSON.stringify(key)}];`);
    }
    for (const { entry, key, role } of own) {
      lines.push(`  ${propertyName(key)}: ${typeOfEntry(entry, role, defs)};`);
    }
    lines.push(...(closed ? [`  ${index}`, "}"] : ["}"]));
  }
  if (site.row && inRow) {
    lines.push(
      `interface State extends ${nameOf(site.scope)} {`,
      `  $map: { item: ${itemType(site.row, nameOf)}; index: number };`,
      "}",
    );
  }
  return lines;
}

/**
 * Wrap one body for a checker.
 *
 * @param doc The document the body is in.
 * @param target Which body: a root `state` entry, or an inline handler on an element.
 * @param body The body's text, which need not be the text the document holds yet (an editor's
 *   buffer is checked as typed).
 * @returns The file to check, and where the body sits in it.
 */
export function generateBodyTypes(
  doc: JxElement,
  target: VirtualTarget,
  body: string,
): VirtualBody {
  // SAFETY: a document is JSON data; its types name what it holds.
  const data = doc as JsonObject;
  const located = locate(data, target);
  const params = parametersOf(located.definition);
  /* The event a handler receives is bound to a name only when the entry declares one, though the
     runtime passes it and `window.event` holds it. Not declaring it would call a working handler
     an error, so it is declared wherever it is not a parameter. */
  const event = eventLines(located.event, params);
  // A handler is called with its state and the event, in that order (`spec.md` §5.3).
  const signature = params.map(
    (name, at) => `${name}: ${at === 0 ? "State" : at === 1 ? event.parameter : "any"}`,
  );
  const defs = definitionsOf(data);
  const head = [
    "export {};",
    ...(defs ? [written(definitionParts(defs, false))] : []),
    ...stateLines(located.site, stateIndex(doc), defs !== null),
    `${event.head}async function body(${["this: any", ...signature].join(", ")}) {`,
    "",
  ].join("\n");
  return {
    bodyEnd: head.length + body.length,
    bodyStart: head.length,
    params,
    text: `${head}${body}\n}\n`,
  };
}

/**
 * Where a position in {@link VirtualBody.text} is in the body, or null when it is outside it (the
 * wrapper, which the author did not write).
 *
 * @param unit The wrapped body.
 * @param offset An offset in `unit.text`.
 * @returns An offset in the body, or null.
 */
export function bodyOffsetOf(unit: VirtualBody, offset: number): number | null {
  return offset >= unit.bodyStart && offset <= unit.bodyEnd ? offset - unit.bodyStart : null;
}
