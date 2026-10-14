/// <reference lib="dom" />
/**
 * Shared.js — Shared compiler utilities
 *
 * Detection, scope resolution, HTML building, CSS extraction, and naming utilities used across all
 * compilation targets (static, client, element, server).
 */

import {
  COLOR_SCHEME_ATTR,
  COLOR_SCHEME_STORAGE_KEY,
  MAX_COMPONENT_NESTING,
  RESERVED_KEYS,
  booleanAttrValue,
  buildStyleRules,
  enumeratedAttrNames,
  isNestedSelectorKey,
  camelToKebab,
  isSingleExpression,
  splitSelectorList,
} from "@jxsuite/runtime";
import { evaluateExpression, isMutating } from "@jxsuite/runtime/expression";
import { runStatements } from "@jxsuite/runtime/statements";
import { buildSiteStyleCSS } from "@jxsuite/site/site-style";
import {
  bodyReturnsValue,
  childrenContainArray,
  hasStructuredBody,
  isExpressionDef,
  isBoolean,
  isFunction,
  isFunctionDef,
  isMappedArray,
  isNamedFormulaDef,
  isNonNullObject,
  isNumber,
  isPrototypeDef,
  isRef,
  isSchemaOnlyDef,
  isServerFnDef,
  isString,
  isTagExpression,
  isTemplateString,
  paramNames,
  tagNameCandidates,
} from "@jxsuite/schema/guards";
import type { TagNameSlot } from "@jxsuite/schema/guards";
import { resolveShadowMode, styleScopePrefix } from "./shadow.ts";
import type { ShadowMode } from "./shadow.ts";
import { readPath } from "@jxsuite/runtime/pointer";
import type { JxScope } from "@jxsuite/runtime/types";
import type {
  CemParameter,
  JsonValue,
  JxDocumentValue,
  JxElement,
  JxMutableNode,
  JxPrototypeDef,
  JxRef,
  JxStateDefinition,
  JxStyle,
  ProjectConfig,
} from "@jxsuite/schema/types";

// Re-export runtime utilities used by submodules
export {
  COLOR_SCHEME_ATTR,
  COLOR_SCHEME_STORAGE_KEY,
  RESERVED_KEYS,
  booleanAttrValue,
  camelToKebab,
  isSingleExpression,
  pureSchemeOf,
  schemeSelectors,
  toCSSText,
} from "@jxsuite/runtime";
export {
  compileExpression,
  compileOperandSource,
  evaluateExpression,
  evaluateOperand,
  isMutating,
} from "@jxsuite/runtime/expression";
export { compileStatements, runStatements } from "@jxsuite/runtime/statements";

/**
 * Emit the JS source of a named formula's scope callable: positional arguments are mapped onto the
 * declared parameter names (honoring CemParameter defaults) as the `_args` object the compiled
 * body's `$args/` refs read from. Call sites stay positional, matching the interpreter.
 */
export function emitFormulaFn(
  def: { parameters?: readonly FormulaParameter[] | undefined },
  compiledBody: string,
): string {
  const entries: string[] = [];
  for (const [i, p] of (def.parameters ?? []).entries()) {
    const name = formulaParameterName(p);
    if (!name) {
      continue;
    }
    const arg = hasParameterDefault(p)
      ? `_a[${i}] === undefined ? ${JSON.stringify(p.default)} : _a[${i}]`
      : `_a[${i}]`;
    entries.push(`${JSON.stringify(name)}: ${arg}`);
  }
  return `(..._a) => { const _args = { ${entries.join(", ")} }; return ${compiledBody}; }`;
}

/**
 * One declared formula parameter as a document holds it: a bare name or a CEM parameter object. A
 * hand-edited list may also carry a `null` hole, which both the emitted and the build-time callable
 * skip like an unnamed entry.
 */
type FormulaParameter = string | CemParameter | null;

/**
 * The name a formula parameter binds under `$args/`, or "" for an entry that names nothing.
 *
 * @param {FormulaParameter} p
 * @returns {string}
 */
function formulaParameterName(p: FormulaParameter): string {
  return isString(p) ? p : (p?.name ?? "");
}

/**
 * Whether a formula parameter declares a `default`, which fills an argument the call site omits.
 *
 * @param {FormulaParameter} p
 * @returns {boolean}
 */
function hasParameterDefault(p: FormulaParameter): p is CemParameter {
  return isNonNullObject(p) && "default" in p;
}

/**
 * Emit the import-clause binding for one Function-def `$src` entry.
 *
 * `$export` names the export inside the module and defaults to the state key (spec.md §5.3 4d).
 * When the two differ the clause has to alias, because the local name the rest of the generated
 * module calls is the state key — importing the bare key instead requests an export the module does
 * not have, and the browser rejects the whole module at link time.
 *
 * Aliasing rather than renaming call sites is what makes the awkward cases work: two keys may alias
 * the same export, a key may collide with another entry's export name, and `$export: "default"` is
 * only reachable as `default as key`.
 *
 * @param {string} key - State key, and the local binding name
 * @param {SrcExportOwner} def - The Function definition
 * @returns {string}
 */
export function srcImportBinding(key: string, def: SrcExportOwner) {
  const exportName = srcExportName(key, def);
  return exportName === key ? key : `${exportName} as ${key}`;
}

/**
 * The export a Function-def `$src` entry names inside its module: `$export`, or the state key.
 *
 * Separate from {@link srcImportBinding} because a lazily loaded `$src` has no import clause to
 * alias in — it reaches the export off the module namespace object a dynamic `import()` resolves
 * to, where the local name is chosen by the generated code and only the export name is fixed.
 *
 * @param {string} key - State key
 * @param {SrcExportOwner} def - The Function definition
 * @returns {string}
 */
export function srcExportName(key: string, def: SrcExportOwner): string {
  const declared = def?.$export;
  return isString(declared) && declared !== "" ? declared : key;
}

/**
 * The Function definition a `$src` export is named on, as the document holds it. `$export` is read
 * unchecked from document data, so anything but a non-empty string falls back to the state key.
 */
type SrcExportOwner =
  | { $export?: JxDocumentValue | undefined; [key: string]: JxDocumentValue | undefined }
  | null
  | undefined;

/**
 * Emit the auto-fetch `effect()` for a `$prototype: "Request"` state entry.
 *
 * Shared by the client and element targets so both honour `manual`, template URLs and
 * `method`/`headers`/`body` the same way. They diverged once: the element target emitted no fetch
 * at all, leaving every Request entry permanently `null` with nothing thrown.
 *
 * A template `url` is read inside the effect, so the fetch re-runs whenever the interpolated state
 * changes; an URL that still interpolates to `undefined` is skipped rather than fetched.
 *
 * @param {string} key - State key receiving the response
 * @param {JxPrototypeDef} def - The Request definition
 * @param {{ statePrefix?: string; indent?: string; collect?: string }} [opts] - `statePrefix` is
 *   the expression the emitted code assigns through (`state` for the client module scope,
 *   `this.state` inside a custom element); `indent` prefixes every emitted line; `collect`, when
 *   given, is an array expression the effect runner is pushed onto so the caller can `stop()` it on
 *   teardown.
 * @returns {string}
 */
export function emitRequestFetch(
  key: string,
  def: JxPrototypeDef,
  opts: { statePrefix?: string; indent?: string; collect?: string } = {},
) {
  const { statePrefix = "state", indent = "", collect } = opts;
  const { url } = def;
  const isTemplateUrl = isTemplateString(url);
  const method = def.method ?? "GET";

  if (def.manual) {
    return `${indent}// ${key}: manual Request — fetch triggered by user action`;
  }

  const lines: string[] = [
    `// ${key}: auto-fetch from ${isTemplateUrl ? "(dynamic URL)" : url}`,
    collect ? `${collect}.push(effect(() => {` : "effect(() => {",
  ];

  if (isTemplateUrl) {
    lines.push(
      `  const url = \`${withStatePrefix(url, statePrefix)}\`;`,
      '  if (!url || url === "undefined" || url.includes("undefined")) return;',
    );
  } else {
    lines.push(`  const url = ${JSON.stringify(url)};`);
  }

  const fetchOpts: string[] = [];
  if (method !== "GET") {
    fetchOpts.push(`method: ${JSON.stringify(method)}`);
  }
  if (def.headers) {
    fetchOpts.push(`headers: ${JSON.stringify(def.headers)}`);
  }
  if (def.body) {
    const bodyStr = isNonNullObject(def.body)
      ? JSON.stringify(JSON.stringify(def.body))
      : JSON.stringify(def.body);
    fetchOpts.push(`body: ${bodyStr}`);
  }

  const optsStr = fetchOpts.length > 0 ? `, { ${fetchOpts.join(", ")} }` : "";
  lines.push(
    `  fetch(url${optsStr})`,
    "    .then(r => r.ok ? r.json() : Promise.reject(r.statusText))",
    `    .then(d => { ${statePrefix}.${key} = d; })`,
    `    .catch(e => { ${statePrefix}.${key} = { error: String(e) }; });`,
    collect ? "}));" : "});",
  );

  return lines.map((line) => `${indent}${line}`).join("\n");
}

/**
 * Rebase the bare `state.` reads in a template string onto `statePrefix`.
 *
 * Only the `${…}` interpolation holes are rewritten. A blanket replace would corrupt the literal
 * text around them — `/api/state.json?q=${state.q}` would request `/api/this.state.json` — and the
 * `\b` guard keeps an identifier that merely ends in `state` (`substate.z`) intact. Reads already
 * carrying the prefix are left alone.
 *
 * @param {string} str
 * @param {string} statePrefix
 * @returns {string}
 */
function withStatePrefix(str: string, statePrefix: string) {
  if (statePrefix === "state") {
    return str;
  }
  return str.replaceAll(
    /\$\{([^}]*)\}/g,
    (_match: string, expr: string) =>
      `\${${expr.replaceAll(/(?<!this\.)\bstate\./g, `${statePrefix}.`)}}`,
  );
}

/**
 * Non-enumerable marker on a build-time scope listing the state keys that hold no build-time value.
 * Non-enumerable so it stays out of `Object.entries(scope)` and out of template evaluation.
 */
const RUNTIME_ONLY_KEYS = Symbol("jx.runtimeOnlyStateKeys");

// CDN defaults
export const DEFAULT_REACTIVITY_SRC = "https://esm.sh/@vue/reactivity@3.5.40";
export const DEFAULT_LIT_HTML_SRC = "https://esm.sh/lit-html@3.3.0";

// ─── Schema keywords & detection ─────────────────────────────────────────────
// Centralized in @jxsuite/schema/guards; re-exported here for existing callers.

export {
  SCHEMA_KEYWORDS,
  isSchemaOnlyDef as isSchemaOnly,
  isTemplateString,
} from "@jxsuite/schema/guards";

/**
 * Returns true if a $src path points to a .class.json schema-defined class.
 *
 * @param {unknown} src
 * @returns {boolean}
 */
export function isClassJsonSrc(src?: unknown): src is string {
  return typeof src === "string" && src.endsWith(".class.json");
}

/**
 * Determine whether a node (or any of its descendants) requires client-side JavaScript.
 *
 * @param {JxElement | JxMutableNode | string} def
 * @returns {boolean}
 */
export function isDynamic(def: JxElement | JxMutableNode | string) {
  if (!isNonNullObject(def)) {
    return false;
  }

  if (def.state) {
    for (const [k, d] of Object.entries(def.state)) {
      // Skip injected context (read-only, not reactive)
      if (k === "$site" || k === "$page") {
        continue;
      }
      if (!isNonNullObject(d) || Array.isArray(d)) {
        return true;
      }
      // Skip timing: "compiler" entries — resolved at build time, baked into static HTML
      if (d.timing === "compiler") {
        continue;
      }
      if (d.$prototype) {
        return true;
      }
      if ("default" in d) {
        return true;
      }
      if (isSchemaOnlyDef(d)) {
        continue;
      }
      return true;
    }
  }

  if (def.$switch) {
    return true;
  }
  if (isMappedArray(def) || childrenContainArray(def.children)) {
    return true;
  }

  if (Array.isArray(def.children) && def.children.some((c) => isDynamic(c))) {
    return true;
  }

  for (const [key, val] of Object.entries(def)) {
    if (RESERVED_KEYS.has(key)) {
      continue;
    }
    if (isRef(val)) {
      return true;
    }
    if (isTemplateString(val)) {
      return true;
    }
  }

  if (isNonNullObject(def.style)) {
    for (const val of Object.values(def.style)) {
      if (isTemplateString(val)) {
        return true;
      }
    }
  }

  if (isNonNullObject(def.attributes)) {
    for (const val of Object.values(def.attributes)) {
      if (isTemplateString(val)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Shallow variant of isDynamic — checks only this node's own properties, not its children.
 *
 * @param {JxElement | JxMutableNode | string} def
 * @returns {boolean}
 */
export function isNodeDynamic(def: JxElement | JxMutableNode | string) {
  if (!isNonNullObject(def)) {
    return false;
  }

  if (def.$switch) {
    return true;
  }
  if (isMappedArray(def) || childrenContainArray(def.children)) {
    return true;
  }

  for (const [key, val] of Object.entries(def)) {
    if (RESERVED_KEYS.has(key)) {
      continue;
    }
    if (isRef(val)) {
      return true;
    }
    if (isTemplateString(val)) {
      return true;
    }
  }

  if (isNonNullObject(def.style)) {
    for (const val of Object.values(def.style)) {
      if (isTemplateString(val)) {
        return true;
      }
    }
  }

  if (isNonNullObject(def.attributes)) {
    for (const val of Object.values(def.attributes)) {
      if (isTemplateString(val)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Returns true if any node in the tree will need dynamic handling.
 *
 * @param {JxElement | JxMutableNode | string} def
 * @returns {boolean}
 */
export function hasAnyIsland(def: JxElement | JxMutableNode | string): boolean {
  if (!isNonNullObject(def)) {
    return false;
  }
  if (isDynamic(def)) {
    return true;
  }
  if (Array.isArray(def.children)) {
    return def.children.some((c): boolean => hasAnyIsland(c));
  }
  return false;
}

// ─── Scope / value resolution ─────────────────────────────────────────────────

/** What a compile target threads down the tree: the scope in effect, its definitions and `$media`. */
export interface CompileContext {
  scope: JxScope;
  /** The `state` definitions the scope was built from. */
  scopeDefs: Record<string, JxStateDefinition>;
  media: Record<string, string>;
  /** True inside a `<pre>`-like subtree, where emitters must not indent nested children. */
  preformatted?: boolean;
}

/**
 * @param {JxElement | JxMutableNode | null} raw
 * @param {JxScope | null} [parentScope]
 * @param {Record<string, JxStateDefinition>} [scopeDefs]
 * @param {Record<string, string>} [media]
 * @returns {CompileContext}
 */
export function createCompileContext(
  raw: JxElement | JxMutableNode | null,
  parentScope: JxScope | null = null,
  scopeDefs: Record<string, JxStateDefinition> = {},
  media: Record<string, string> = {},
): CompileContext {
  const scope = raw?.state
    ? buildInitialScope(raw.state, parentScope)
    : (parentScope ?? emptyScope());
  return { media, scope, scopeDefs };
}

/**
 * A fresh scope inheriting from `parent`, or from nothing at all, so no `Object.prototype` member
 * can answer for an undeclared state key.
 *
 * @param {JxScope | null} [parent]
 * @returns {JxScope}
 */
function emptyScope(parent: JxScope | null = null): JxScope {
  /* SAFETY: `Object.create` returns a new object with no own keys whose prototype is `parent` (a
     scope) or null, so every key it answers is a scope member or absent — exactly a JxScope. */
  return Object.create(parent) as JxScope;
}

/**
 * The runtime-only marks `buildInitialScope` attached to `scope` or to a scope it inherits from.
 *
 * @param {JxScope} scope
 * @returns {Set<string> | undefined}
 */
function runtimeOnlyKeysOf(scope: JxScope): Set<string> | undefined {
  /* SAFETY: `RUNTIME_ONLY_KEYS` is module-private and `buildInitialScope` is the only writer, which
     always stores a `Set<string>` under it; a scope built anywhere else answers undefined. */
  return (scope as { [RUNTIME_ONLY_KEYS]?: Set<string> })[RUNTIME_ONLY_KEYS];
}

/**
 * `state.x = …`, `state.x += …`, `state.x++` — every form a string handler body can use to write a
 * state entry. `===`/`!==`/`<=`/`>=` are excluded by the `(?!=)` guard and by the operator set.
 */
const STATE_ASSIGNMENT_RE =
  /\bstate\.([A-Za-z_$][\w$]*)\s*(?:\+\+|--|(?:\*\*|\|\||&&|\?\?|<<|>>>|>>|[-+*/%&|^])?=(?!=))/g;

/** `state.list.push(…)` and friends mutate in place without ever assigning to the entry. */
const STATE_MUTATING_METHOD_RE =
  /\bstate\.([A-Za-z_$][\w$]*)\s*\.\s*(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\s*\(/g;

/**
 * Collect every state key a handler writes to, across all the forms a body can take: a string body,
 * a structured body (spec §20), and an `$expression` node with a mutating operator.
 *
 * Used to keep prerender from baking a binding over an entry that changes after hydration. A plain
 * `{ "type": "string" }` entry holds a perfectly ordinary build-time value, so nothing else
 * distinguishes it from a constant — but if a handler assigns to it, interpolating it at build time
 * replaces the template in the emitted output and the element is dead for the life of the page.
 *
 * @param {JxDocumentValue | undefined} node
 * @param {Set<string>} into
 */
function collectAssignedStateKeys(node: JxDocumentValue | undefined, into: Set<string>) {
  if (isString(node)) {
    for (const m of node.matchAll(STATE_ASSIGNMENT_RE)) {
      // SAFETY: the pattern's one capture group is outside any optional part, so a match has it.
      into.add(m[1] as string);
    }
    for (const m of node.matchAll(STATE_MUTATING_METHOD_RE)) {
      // SAFETY: the pattern's one capture group is outside any optional part, so a match has it.
      into.add(m[1] as string);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const entry of node) {
      collectAssignedStateKeys(entry, into);
    }
    return;
  }
  if (!isNonNullObject(node)) {
    return;
  }
  /* SAFETY: `node` is a non-array object inside a handler body or an expression, so it is a
     document object, and every member of a document object is itself a document value. */
  const rec = node as Record<string, JxDocumentValue | undefined>;
  // A mutating expression names its destination as `target: { $ref: "#/state/x" }`.
  const { operator, target } = rec;
  if (
    isString(operator) &&
    isMutating(operator) &&
    isRef(target) &&
    target.$ref.startsWith("#/state/")
  ) {
    // SAFETY: `String.prototype.split` always returns at least one element.
    into.add(target.$ref.slice("#/state/".length).split("/")[0] as string);
  }
  for (const value of Object.values(rec)) {
    collectAssignedStateKeys(value, into);
  }
}

/**
 * @param {Record<string, JxStateDefinition>} [defs]
 * @param {JxScope | null} [parentScope]
 * @returns {JxScope}
 */
export function buildInitialScope(
  defs: Record<string, JxStateDefinition> = {},
  parentScope: JxScope | null = null,
) {
  const scope = emptyScope(parentScope);
  // Keys whose real value only exists after hydration, so prerender must not interpolate them —
  // See `readsRuntimeOnlyState`. Seeded from the parent so nested scopes inherit the marks.
  const inherited = parentScope ? runtimeOnlyKeysOf(parentScope) : undefined;
  const runtimeOnly = new Set<string>(inherited);
  // Attached up front, and mutated in place by the passes below, so the template pass at the end can
  // Consult the marks the earlier passes added.
  Object.defineProperty(scope, RUNTIME_ONLY_KEYS, {
    configurable: true,
    enumerable: false,
    value: runtimeOnly,
    writable: true,
  });

  // Pass 0: every entry some handler in this document writes to is mutable, so prerender must not
  // Bake a binding over it. Narrow on purpose — an entry nothing ever writes stays bakeable, so
  // Prerendered content is preserved for SEO. A `$src` handler's assignments live in a JS file this
  // Builder cannot open, so a write that only happens there is still missed (issue #125).
  const assigned = new Set<string>();
  for (const def of Object.values(defs)) {
    if (isFunctionDef(def) || isExpressionDef(def)) {
      collectAssignedStateKeys(def.body ?? def.$expression, assigned);
    }
  }
  for (const key of assigned) {
    if (key in defs) {
      runtimeOnly.add(key);
    }
  }

  for (const [key, def] of Object.entries(defs)) {
    if (!isNonNullObject(def) || Array.isArray(def)) {
      setOwnScopeValue(scope, key, cloneValue(def));
      continue;
    }
    if ("default" in def) {
      setOwnScopeValue(scope, key, cloneValue(def.default));
      continue;
    }
    if (!def.$prototype && !("$expression" in def) && !isSchemaOnlyDef(def)) {
      setOwnScopeValue(scope, key, cloneValue(def));
    }
  }

  // Template-string entries are deferred to a third pass: whether one is resolvable depends on the
  // Runtime-only marks the loop below adds, and key order must not decide the answer.
  const templateDefs: [string, string][] = [];
  // Computed (`bodyReturnsValue`) entries are deferred for the same reason. A computed is stored in
  // The scope as its already-evaluated *result*, so a template reading it sees an ordinary string
  // And prerender bakes it — destroying the binding rather than merely staling it (issue #124).
  const computedBodies: [string, string][] = [];

  for (const [key, def] of Object.entries(defs)) {
    if (isTemplateString(def)) {
      templateDefs.push([key, def]);
      continue;
    }
    if (!isNonNullObject(def)) {
      continue;
    }
    if (isExpressionDef(def)) {
      const node = def.$expression;
      if (isNamedFormulaDef(def)) {
        // Named formula: callable, positional args mapped onto its declared parameters.
        const params: readonly FormulaParameter[] = def.parameters;
        setOwnScopeValue(scope, key, (...argValues: JxScope[string][]) => {
          const args: JxScope = {};
          for (const [i, p] of params.entries()) {
            const name = formulaParameterName(p);
            if (!name) {
              continue;
            }
            args[name] =
              argValues[i] === undefined && hasParameterDefault(p) ? p.default : argValues[i];
          }
          return evaluateExpression(node, scope, null, { args });
        });
      } else if (isMutating(node.operator)) {
        setOwnScopeValue(scope, key, (s: JxScope, event: Event) =>
          evaluateExpression(node, s, event),
        );
      } else {
        defineLazyScopeValue(scope, key, () => evaluateExpression(node, scope, null));
      }
      continue;
    }
    if (isFunctionDef(def)) {
      if (hasStructuredBody(def)) {
        // Structured body (spec §20): a side-effecting handler in the build-time scope. Build-time
        // Code may call it bare, so the scope it runs against falls back to this one.
        const { body } = def;
        setOwnScopeValue(scope, key, (s?: JxScope, event?: Event) => {
          void runStatements(body, s ?? scope, event ?? null);
        });
      } else if (isString(def.body)) {
        const declared = def.parameters ? paramNames(def.parameters) : (def.arguments ?? []);
        const { body } = def;
        // Declared names bind by name, not by position (spec.md §5.3 4d): a parameter literally
        // Named `state` receives the scope, anything else receives the event. `state` is prepended
        // When undeclared so a body may always reference it. Unconditionally prepending it instead —
        // The older behaviour here — produced a duplicate parameter for the `["state", "event"]`
        // Form that examples/components/task-manager.json uses, leaving `state` undefined.
        const params = declared.includes("state") ? declared : ["state", ...declared];
        /* SAFETY: `new Function` returns an ordinary function of exactly `params`; `invoke` below is
           its only caller and passes the scope or the event in each position, and what the body
           returns is one more scope member. */
        const fn = new Function(...params, body) as (
          ...args: (JxScope | Event | undefined)[]
        ) => JxScope[string];
        const invoke = (state: JxScope, event?: Event) =>
          fn(...params.map((name) => (name === "state" ? state : event)));
        if (bodyReturnsValue(body)) {
          defineLazyScopeValue(scope, key, () => invoke(scope));
          computedBodies.push([key, body]);
        } else {
          setOwnScopeValue(scope, key, invoke);
        }
      } else {
        // Bodyless `$src` Function — the real implementation is only loaded in the browser, so this
        // Is a placeholder standing in for its callable shape, never its value.
        setOwnScopeValue(scope, key, () => {});
        runtimeOnly.add(key);
      }
      continue;
    }
    if (
      isPrototypeDef(def) &&
      (def.$prototype === "LocalStorage" || def.$prototype === "SessionStorage")
    ) {
      setOwnScopeValue(scope, key, cloneValue(def.default ?? null));
      continue;
    }
    if (isPrototypeDef(def) && def.$prototype === "Request") {
      // A client-timing fetch has no build-time value at all — not even a placeholder.
      runtimeOnly.add(key);
    }
  }

  // A state entry that reads a runtime-only key cannot resolve until hydration either, so it is
  // Runtime-only in turn. Without this, prerender would bake the failed evaluation (`null`) into
  // Every template that reads *this* entry, one step removed from the original. Iterated to a
  // Fixpoint because marking one entry can qualify another, in either direction, and declaration
  // Order must not decide the answer.
  let marked = true;
  while (marked) {
    marked = false;
    for (const [key, source] of [...computedBodies, ...templateDefs]) {
      if (!runtimeOnly.has(key) && readsRuntimeOnlyState(source, scope)) {
        runtimeOnly.add(key);
        marked = true;
      }
    }
  }

  for (const [key, template] of templateDefs) {
    defineLazyScopeValue(scope, key, () => evaluateStaticTemplate(template, scope));
  }

  return scope;
}

/**
 * @param {JxScope} scope
 * @param {string} key
 * @param {JxScope[string]} value - Any scope member: document data or a build-time callable
 */
export function setOwnScopeValue(scope: JxScope, key: string, value: JxScope[string]) {
  Object.defineProperty(scope, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * @param {JxScope} scope
 * @param {string} key
 * @param {() => JxScope[string]} getter - Computes the member on read
 */
export function defineLazyScopeValue(scope: JxScope, key: string, getter: () => JxScope[string]) {
  Object.defineProperty(scope, key, {
    configurable: true,
    enumerable: true,
    get: getter,
  });
}

/**
 * @param {JxDocumentValue | undefined} value - A bindable document value: a `$ref`, a template
 *   string, or a literal returned as is
 * @param {JxScope | null} scope
 * @returns {unknown}
 */
export function resolveStaticValue(value: JxDocumentValue | undefined, scope: JxScope | null) {
  if (isRef(value)) {
    return resolveRefValue(value.$ref, scope!);
  }
  if (isTemplateString(value)) {
    return evaluateStaticTemplate(value, scope);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRefObject(value: unknown): value is JxRef {
  return isRef(value);
}

/**
 * @param {JsonValue | undefined} refValue - A `$ref` member as the document holds it; anything but
 *   a string is returned as is
 * @param {JxScope} scope
 * @returns {unknown}
 */
export function resolveRefValue(refValue: JsonValue | undefined, scope: JxScope) {
  if (!isString(refValue)) {
    return refValue;
  }
  if (refValue.startsWith("$map/")) {
    const parts = refValue.split("/");
    const key = parts[1]!;
    /* SAFETY: `?.` stops at null and undefined, and every other value answers a member read by
       name; the member comes back as a scope member, so the view claims nothing about its type. */
    const row = scope.$map as JxScope | null | undefined;
    const base = row?.[key] ?? scope[`$map/${key}`];
    return parts.length > 2 ? getPathValue(base, parts.slice(2).join("/")) : base;
  }
  if (refValue.startsWith("#/state/")) {
    // One call, not a hand-split leading token: slicing at the first `/` skipped unescaping it, so
    // `#/state/a~1b/c` looked for a member called `a~1b` rather than `a/b`.
    return getPathValue(scope, refValue.slice("#/state/".length));
  }
  /*
   * An unrecognized scheme is still a path, matching the runtime resolvers and the lowerer.
   * Reading it as one key returned null for `a/b` while the emitted client module walked it.
   */
  return getPathValue(scope, refValue) ?? null;
}

/**
 * Detect whether a template string interpolates a state value that only exists after hydration.
 *
 * Evaluating one of those at build time is worse than leaving it alone. The build-time scope holds
 * a `() => {}` placeholder for a bodyless `$src` Function and nothing at all for a `Request`, so
 * the template resolves to text like `() => {}`, `undefined` or `""` — and that text _replaces_ the
 * template in the emitted HTML, so the client-side binding is destroyed rather than merely wrong.
 * Returning "unresolvable" instead leaves the template in place for the client to populate.
 *
 * A read that _calls_ the value is left alone: invoking a build-time callable is exactly how named
 * formulas (spec.md §19.4c) are meant to be used during prerender.
 *
 * @param {string} str
 * @param {JxScope | null} scope
 * @returns {boolean}
 */
function readsRuntimeOnlyState(str: string, scope: JxScope | null) {
  if (!scope) {
    return false;
  }
  const runtimeOnly = runtimeOnlyKeysOf(scope);
  for (const match of str.matchAll(/\bstate\.([A-Za-z_$][\w$]*)\s*(\()?/g)) {
    if (match[2]) {
      continue;
    }
    // SAFETY: capture group 1 is outside any optional part of the pattern, so a match has it.
    const key = match[1] as string;
    if (runtimeOnly?.has(key)) {
      return true;
    }
    // Reading the key can run a computed's getter, which is free to throw on partial build-time
    // Data. A throw says nothing about whether the entry is runtime-only, so it is not a mark.
    let value: JxScope[string];
    try {
      value = scope[key];
    } catch {
      continue;
    }
    if (isFunction(value)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} str
 * @param {JxScope | null} scope
 * @returns {unknown}
 */
export function evaluateStaticTemplate(str: string, scope: JxScope | null) {
  if (readsRuntimeOnlyState(str, scope)) {
    return null;
  }
  /*
   * `$site` and `$page` are bound as parameters, not just left on `state`.
   *
   * `injectContext` puts them on the document's state, so `${state.$site.name}` always worked — but
   * every example in site-architecture.md §8.2 writes the bare `${$site.name}`, and that threw a
   * ReferenceError the catch below turned into a silent null. A `$head` title referencing the site
   * name reached the page as the literal template text.
   */
  const args = ["state", "$map", "$site", "$page"] as const;
  const values = [scope, scope?.$map, scope?.$site, scope?.$page];
  try {
    const body = isSingleExpression(str) ? `return (${str.slice(2, -1)})` : `return \`${str}\``;
    /* SAFETY: `new Function` compiles exactly the four parameters in `args`, and its body returns a
       template's value, which is whatever the scope it reads holds: one more scope member. */
    const fn = new Function(...args, body) as (...a: JxScope[string][]) => JxScope[string];
    return fn(...values);
  } catch {
    return null;
  }
}

/**
 * @param {JxScope[string]} base - A scope, or any member read from one
 * @param {string} path
 * @returns {unknown}
 */
export function getPathValue(base: JxScope[string], path: string) {
  return readPath(base, path);
}

/**
 * A deep copy of an object, so a scope never aliases the document it was built from; anything else
 * is returned as is.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function cloneValue<T>(value: T): T {
  if (!isNonNullObject(value)) {
    return value;
  }
  return structuredClone(value);
}

// ─── HTML building ────────────────────────────────────────────────────────────

/**
 * The inline `style` declarations of one node: its template-string entries, resolved against
 * `scope`. Everything else in a `style` object is a stylesheet rule (`collectStyles` gives it a
 * class handle), so only a per-instance value is written on the element.
 *
 * @param {JxStyle | null | undefined} style
 * @param {JxScope | null} scope
 * @returns {string} `prop: value; prop: value`, or "" when nothing resolves
 */
export function inlineStyleDeclarations(
  style: JxStyle | null | undefined,
  scope: JxScope | null,
): string {
  if (!style || !scope) {
    return "";
  }
  return Object.entries(style)
    .filter(
      ([k, v]) =>
        !k.startsWith(":") &&
        !k.startsWith(".") &&
        !k.startsWith("&") &&
        !k.startsWith("[") &&
        !k.startsWith("@") &&
        isTemplateString(v),
    )
    .map(([k, v]) => {
      const value = resolveStaticValue(v, scope);
      return value == null ? null : `${camelToKebab(k)}: ${value}`;
    })
    .filter(Boolean)
    .join("; ");
}

/**
 * Build an HTML attribute string from a static element definition.
 *
 * @param {JxElement | JxMutableNode} def
 * @param {JxScope | null} scope
 * @param {string} [hostStyle] - Declarations resolved by the caller against ANOTHER scope, folded
 *   into the same `style` attribute after the node's own. A nested component instance is the one
 *   caller: its own `style` resolves against the parent's scope, while the definition's host style
 *   resolves against the instance's, and an element cannot carry two `style` attributes.
 * @returns {string}
 */
export function buildAttrs(def: JxElement | JxMutableNode, scope: JxScope | null, hostStyle = "") {
  let out = "";

  const id = resolveStaticValue(def.id, scope);
  const className = resolveStaticValue(def.className, scope);
  const hidden = resolveStaticValue(def.hidden, scope);
  const tabIndex = resolveStaticValue(def.tabIndex, scope);
  const title = resolveStaticValue(def.title, scope);
  const lang = resolveStaticValue(def.lang, scope);
  const dir = resolveStaticValue(def.dir, scope);

  if (id) {
    out += ` id="${escapeHtml(String(id))}"`;
  }
  if (className) {
    out += ` class="${escapeHtml(String(className))}"`;
  }
  if (hidden) {
    out += " hidden";
  }
  if (tabIndex !== undefined && tabIndex !== null) {
    out += ` tabindex="${escapeHtml(String(tabIndex))}"`;
  }
  if (title) {
    out += ` title="${escapeHtml(String(title))}"`;
  }
  if (lang) {
    out += ` lang="${escapeHtml(String(lang))}"`;
  }
  if (dir) {
    out += ` dir="${escapeHtml(String(dir))}"`;
  }

  // The host declarations go last: in one `style` attribute the later declaration of a property
  // Wins, and the page walk gives the definition's resolved host style the same precedence over an
  // Instance's own (`{ ...node.style, ...resolvedStyle }`), so the two paths agree.
  const inline = [inlineStyleDeclarations(def.style, scope), hostStyle].filter(Boolean).join("; ");
  if (inline) {
    /*
     * Escaped like every other attribute. Both halves carry values a template string resolved
     * from data — a `background-image: url("…")` host style reads its target from a prop — and a
     * `"` in that data would otherwise end the attribute and hand the rest of the value to the
     * parser as attributes. The HTML parser decodes `&quot;` before the CSS parser sees the
     * declaration, so `url(&quot;…&quot;)` renders exactly as `url("…")`, and `rewriteHtmlBase`
     * already reads the entity-wrapped form back when it re-roots a `url()`.
     */
    out += ` style="${escapeHtml(inline)}"`;
  }
  if (def.attributes) {
    for (const [k, v] of Object.entries(def.attributes)) {
      const value = resolveStaticValue(v, scope);
      /*
       * A boolean is the attribute's PRESENCE or its text, depending on which family HTML puts the
       * attribute in — `booleanAttrValue` owns that judgement, and the runtime asks it the same
       * question so a prerendered page cannot change meaning as it hydrates.
       *
       * @docs framework/concepts/elements
       *
       * Stringifying a boolean emitted `open="false"`, and HTML reads a boolean attribute by
       * Presence alone — so the author wrote "closed" and the page rendered open. Nor could the
       * Template return nothing instead: `resolveDocTemplates` and `expandMapTemplate` both `?? v`,
       * Which restores the raw `${…}` source on a null. Absence therefore has to be expressible
       * HERE, and `false` is the only value that can mean it.
       *
       * A *string* is never reinterpreted, in either family. `"aria-current": "false"` is the docs
       * Sidebar's own not-the-current-page marker, and second-guessing it would be this same defect
       * Pointed the other way.
       */
      if (isBoolean(value)) {
        const text = booleanAttrValue(k, value);
        if (text !== null) {
          out += text === "" ? ` ${k}` : ` ${k}="${escapeHtml(text)}"`;
        }
        continue;
      }
      if (isString(value) || isNumber(value)) {
        out += ` ${k}="${escapeHtml(String(value))}"`;
      }
    }
  }

  if (def.$static) {
    out += ` data-jx-static`;
  } else if (def.$prerendered) {
    out += ` data-jx-prerendered`;
  }

  return out;
}

/**
 * Tags rendered with `white-space: pre` by every UA, where inter-element whitespace is content
 * rather than formatting. Emitters indent nested children for readability; inside these tags — and
 * anywhere below them, since `white-space` inherits — that indentation would render as literal
 * blank lines and leading spaces, so children must be concatenated with no separator.
 */
export const PREFORMATTED_TAGS = new Set(["pre", "textarea", "listing", "plaintext", "xmp"]);

/**
 * The separator to place between an element's compiled children: none inside a preformatted
 * subtree, a newline plus `indent` elsewhere.
 *
 * @param {boolean | undefined} preformatted
 * @param {string} [indent]
 * @returns {string}
 */
export function childSeparator(preformatted: boolean | undefined, indent = "  "): string {
  return preformatted ? "" : `\n${indent}`;
}

/**
 * A {@link CompileContext} as a static emitter hands it to a node, before that node's own scope is
 * known: the scope in effect may still be none.
 */
export type InnerCompileContext = Omit<CompileContext, "scope"> & { scope: JxScope | null };

/**
 * Build the inner HTML (textContent or children) for a node.
 *
 * @param {JxElement} def
 * @param {JxElement | null} raw
 * @param {InnerCompileContext} context
 * @param {(
 *   def: JxElement | string,
 *   raw: JxElement | string,
 *   context: InnerCompileContext,
 * ) => string} childCompiler
 * @returns {string}
 */
export function buildInner(
  def: JxElement,
  raw: JxElement | null,
  context: InnerCompileContext,
  childCompiler: (
    def: JxElement | string,
    raw: JxElement | string,
    context: InnerCompileContext,
  ) => string,
) {
  const source = raw ?? def;

  if (source.textContent !== undefined) {
    const value = resolveStaticValue(source.textContent, context.scope);
    return value == null ? "" : escapeHtml(String(value));
  }
  if (source.innerHTML) {
    const value = resolveStaticValue(source.innerHTML, context.scope);
    return value == null ? "" : String(value);
  }
  if (Array.isArray(source.children)) {
    const rawChildren = raw?.children;
    return source.children
      .map((c, i) => {
        const childRaw = (Array.isArray(rawChildren) ? rawChildren[i] : undefined) ?? c;
        return childCompiler(c, childRaw, context);
      })
      .join(childSeparator(context.preformatted));
  }
  return "";
}

// ─── CSS extraction ───────────────────────────────────────────────────────────

/**
 * The inline pre-paint script injected into <head> when a project declares a pure color-scheme
 * media query: restores the visitor's persisted forced scheme before first paint (no FOUC).
 *
 * @returns {string}
 * @docs framework/concepts/color-schemes
 */
export function colorSchemePrePaintScript(): string {
  const key = JSON.stringify(COLOR_SCHEME_STORAGE_KEY);
  const attr = JSON.stringify(COLOR_SCHEME_ATTR);
  return `(function(){try{var s=localStorage.getItem(${key});if(s==="light"||s==="dark"){document.documentElement.setAttribute(${attr},s)}}catch(e){}})()`;
}

/**
 * Push the rules one style object becomes, scoped to `selector`.
 *
 * The single door from the compiler to `buildStyleRules`, which is now the ONE definition of what a
 * Jx style object means as CSS — shared with the DOM runtime and the site-style builder. Three
 * emitters used to answer that question separately, and each dropped a different combination: this
 * one emitted `selector → @media` but only ever ONE selector level inside an at-rule group, so
 * `@media → .card → :hover` was silently lost, while the runtime dropped the opposite order.
 *
 * Template-string and `$ref` values are omitted rather than resolved: a compiled page's CSS is
 * static by construction, and the runtime writes those declarations at render time.
 *
 * @param {string[]} rules
 * @param {JxStyle} style
 * @param {string | null} selector - The scope, or null for a bare declaration-body at-rule
 * @param {Record<string, string>} mediaQueries
 */
function pushStyleRules(
  rules: string[],
  style: JxStyle,
  selector: string | null,
  mediaQueries: Record<string, string>,
) {
  for (const rule of buildStyleRules(style, {
    mediaQueries,
    /* Records what a STATIC build drops, and returns `null` so it drops exactly as before — the
       emitted bytes are unchanged. A reactive declaration is a runtime declaration: it resolves
       against a live scope, which a compiled page has only where the runtime is present, so a
       static emitter has always dropped it. Silently, which is the defect: a document is correct
       in Studio and simply unstyled in the built page, with nothing said. */
    resolveValue: (property, value) => recordDroppedReactive(property, value, selector),
    scope: selector,
  })) {
    rules.push(rule.text);
  }
}

/**
 * Record a reactive declaration a static build drops, and answer `null` so it is dropped.
 *
 * One recorder for both emitters the build reaches — `pushStyleRules` for element styles, and
 * `buildSiteStyleCSS` for the project block, which takes it as its resolver — so a `${…}` in
 * `project.json#/style` is reported the way one in an element's `style` is.
 */
function recordDroppedReactive(
  property: string,
  value: string | JxRef,
  selector: string | null,
): null {
  const source = isString(value) ? value : value.$ref;
  _droppedReactive.push({ property, selector, source });
  return null;
}

/** One entry per reactive declaration a static build dropped, since the last drain. */
const _droppedReactive: { property: string; selector: string | null; source: string }[] = [];

/**
 * Take the reactive declarations dropped since the last call, as warning lines, and clear them.
 *
 * A build drains this once and reports what it finds. Draining is what keeps two builds in one
 * process from inheriting each other's, and what keeps the list from growing without bound.
 *
 * @returns {string[]} One line per dropped declaration, naming the property and where it was.
 */
export function takeDroppedReactiveStyles(): string[] {
  const lines = _droppedReactive.map(
    ({ property, selector, source }) =>
      `A static build drops the reactive style declaration \`${property}: ${source}\`` +
      `${selector ? ` on \`${selector}\`` : ""}. It resolves against a live scope, which a ` +
      "built page has only where the runtime is present, so the declaration is absent from the " +
      "page. Give it a static value, or move it to an element the runtime renders.",
  );
  _droppedReactive.length = 0;
  return lines;
}

/**
 * The name of the boolean-attribute helper the generated modules call.
 *
 * Prefixed and improbable because it lands in the same scope as the author's own bindings.
 */
export const ATTR_HELPER = "__jxAttrText";

/**
 * The source of that helper, to be emitted into a generated module's preamble.
 *
 * **Why an inlined copy rather than an import.** `booleanAttrValue` is the single decision about
 * which family an attribute belongs to, and `buildAttrs` here calls it directly — but the element
 * and client targets emit standalone ES modules that a built site loads with `lit-html` and
 * `@vue/reactivity` and nothing else. Importing `@jxsuite/runtime` into every compiled component to
 * reach four lines would put the whole renderer on the critical path of pages that never use it.
 *
 * So the rule is inlined, and the enumerated names are SERIALIZED from `enumeratedAttrNames()`
 * rather than retyped. `compile-element.test.ts` asserts the emitted literal still equals that
 * export, which is what keeps this from becoming a fourth, drifting definition — the exact failure
 * the essay above `buildAttrs` exists to prevent, and the one these two targets shipped for months:
 * they stringified booleans, so a component's `open: true` compiled to `open="true"` and a bound
 * `open` that flipped false wrote `open="false"` — an OPEN `<details>` the author had closed.
 *
 * Returns the text to write, or `null` to mean "remove the attribute"; each caller adapts that null
 * to its own idiom (`nothing` in a lit template, `removeAttribute` in the hydration script).
 *
 * @returns {string} One `function` declaration, ready to push into a module's line list.
 */
export function attrHelperSource(): string {
  const names = JSON.stringify(enumeratedAttrNames());
  return (
    `const __jxEnumAttrs = new Set(${names});\n` +
    `function ${ATTR_HELPER}(n, v) {\n` +
    `  if (typeof v !== 'boolean') return v;\n` +
    `  const l = n.toLowerCase();\n` +
    `  if (l.startsWith('aria-') || __jxEnumAttrs.has(l)) return String(v);\n` +
    `  return v ? '' : null;\n` +
    `}`
  );
}

/**
 * Walk the entire document tree and collect all static nested CSS rules.
 *
 * The project block is NOT split here. `buildSiteStyleCSS` (`@jxsuite/site/site-style`) is the one
 * definition of how `project.json#/style` becomes a page's stylesheet — custom properties and
 * `color-scheme` on `:root`, other declarations on `body`, `&`-keyed blocks as states of `:root`,
 * selector keys as their own rules, `@`-blocks resolved and dual-emitted, then the forced-scheme
 * `color-scheme` triplet — and the built page calls it with an identity transposer, so the canvas
 * and the live preview show what the build ships by construction. This function used to carry its
 * own copy of that split, and the two copies disagreed on two shapes the site builder had right: a
 * top-level `&[data-theme="light"]` reached the page as a raw `&` selector, which no engine
 * matches, and a top-level `colorScheme` went to `body`, where `light-dark()` on the root reads the
 * UA default instead (#329, spec.md §9.5).
 *
 * The one thing the build adds is the resolver: a host drops a reactive project declaration in
 * silence because it has nothing to evaluate it against, and a static build drops it for the same
 * reason but SAYS SO, through the same recorder `pushStyleRules` uses for element styles.
 *
 * @param {JxElement | JxMutableNode} doc
 * @param {Record<string, string>} [mediaQueries]
 * @param {JxStyle | null} [projectStyle]
 * @returns {string}
 */
export function compileStyles(
  doc: JxElement | JxMutableNode,
  mediaQueries: Record<string, string> = {},
  projectStyle: JxStyle | null = null,
) {
  const rules: string[] = [];

  /* An absent project block is an empty one: the builder emits nothing for `{}` except the
     `color-scheme` triplet a scheme query in `$media` still calls for, which is exactly what a
     page with a scheme query and no project style has always carried. */
  const projectSheet = buildSiteStyleCSS(
    isNonNullObject(projectStyle) ? projectStyle : {},
    mediaQueries,
    (value) => value,
    recordDroppedReactive,
  );
  if (projectSheet !== "") {
    rules.push(projectSheet);
  }

  const counter = { n: 0 };
  collectStyles(doc, rules, mediaQueries, "", counter);
  if (rules.length === 0) {
    return "";
  }
  return `<style>\n${escapeStyleText(rules.join("\n"))}\n</style>`;
}

/**
 * Make CSS safe to sit inside a `<style>` element.
 *
 * An HTML parser ends a `<style>` at the first `</style` in the text, wherever it appears — inside
 * a CSS string, inside a comment, anywhere. Since a project's style values are author data
 * (`content: "</style>"` is a legal declaration), inlining them unescaped would let content close
 * the element and the rest of the stylesheet would render as markup. `\/` is a valid CSS escape for
 * `/`, so the declaration keeps its meaning.
 */
export function escapeStyleText(css: string): string {
  return css.replaceAll(/<\/(?=style)/gi, String.raw`<\/`);
}

/**
 * @param {JxElement | JxMutableNode | string} def
 * @param {string[]} rules
 * @param {Record<string, string>} mediaQueries
 * @param {string} [_parentSel]
 * @param {{ n: number }} [counter]
 */
export function collectStyles(
  def: JxElement | JxMutableNode | string,
  rules: string[],
  mediaQueries: Record<string, string>,
  _parentSel = "",
  counterArg?: { n: number },
  prefix = "jx",
) {
  const counter = counterArg ?? { n: 0 };
  if (!isNonNullObject(def)) {
    return;
  }

  if (def.style && !def.id && !def.className) {
    def.className = `${prefix}-${counter.n}`;
    counter.n += 1;
  }

  /* A chosen tag needs a selector that matches every candidate, not the first one.
     `#id` and `.class` are unaffected — they identify the element regardless of what it turns out
     to be — but a bare tag selector has to become the union, or styling an `<a>|<div>` wrapper
     would style exactly one of the two branches and silently miss the other. */
  const tagSelector = tagNameCandidates(def.tagName).join(", ") || "*";
  const selector = def.id
    ? `#${def.id}`
    : def.className
      ? `.${def.className.split(" ")[0]}`
      : tagSelector;

  if (def.style) {
    pushStyleRules(rules, def.style, selector, mediaQueries);
  }

  if (Array.isArray(def.children)) {
    for (const c of def.children) {
      collectStyles(c, rules, mediaQueries, selector, counter, prefix);
    }
  }

  // $switch case nodes render in place of the container's content — collect their styles too
  if (isNonNullObject(def.cases)) {
    for (const c of Object.values<JxElement | JxMutableNode>(def.cases)) {
      collectStyles(c, rules, mediaQueries, selector, counter, prefix);
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * HTML-escape a string for safe attribute and text content embedding.
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str: string) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Convert a page title to a valid custom element tag name.
 *
 * @param {string} title
 * @returns {string}
 */
export function titleToTagName(title: string) {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return slug.includes("-") ? slug : `jx-${slug}`;
}

/**
 * @param {string} tagName
 * @returns {string}
 */
export function tagNameToClassName(tagName: string) {
  return tagName
    .split("-")
    .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

/**
 * Recursively collect unique $src values from $prototype: "Function" entries.
 *
 * @param {JxElement} doc
 * @returns {string[]}
 */
export function collectSrcImports(doc: JxElement) {
  const srcs = new Set<string>();
  _walkSrc(doc, srcs);
  return [...srcs];
}

/**
 * @param {JxElement | JxMutableNode | string} def
 * @param {Set<string>} srcs
 */
function _walkSrc(def: JxElement | JxMutableNode | string, srcs: Set<string>) {
  if (!isNonNullObject(def)) {
    return;
  }
  if (def.state) {
    for (const d of Object.values(def.state)) {
      if (isFunctionDef(d) && d.$src) {
        srcs.add(d.$src);
      }
    }
  }
  if (Array.isArray(def.children)) {
    for (const c of def.children) {
      _walkSrc(c, srcs);
    }
  }
}

/**
 * Recursively collect all `timing: "server"` entries from the document tree.
 *
 * @param {JxElement} doc
 * @returns {{ key: string; exportName: string; src: string }[]}
 */
export function collectServerEntries(doc: JxElement) {
  const entries = new Map<string, { key: string; exportName: string; src: string }>();
  _walkServerEntries(doc, entries);
  return [...entries.values()];
}

/**
 * @param {JxElement | JxMutableNode | string} def
 * @param {Map<string, { key: string; exportName: string; src: string }>} entries
 */
function _walkServerEntries(
  def: JxElement | JxMutableNode | string,
  entries: Map<string, { key: string; exportName: string; src: string }>,
) {
  if (!isNonNullObject(def)) {
    return;
  }
  if (def.state) {
    for (const [key, d] of Object.entries(def.state)) {
      if (isServerFnDef(d)) {
        entries.set(d.$export, { exportName: d.$export, key, src: d.$src });
      }
    }
  }
  if (Array.isArray(def.children)) {
    for (const c of def.children) {
      _walkServerEntries(c, entries);
    }
  }
}

// ─── Component pre-rendering ─────────────────────────────────────────────────

export const SELF_CLOSING = new Set<string>([
  "input",
  "br",
  "hr",
  "img",
  "meta",
  "link",
  "area",
  "col",
  "source",
]);

/**
 * A tag for the PRERENDER, resolved against the same scope the attributes are.
 *
 * The static renderer produces bytes, so it must commit to one element. Every candidate is a
 * literal `TagName`, so committing is safe — and it is resolved here rather than left as text
 * precisely because the old `${…}` form was left as text and then re-resolved against the page
 * scope, where a component's own state is undefined.
 *
 * @param {TagNameSlot} tagName
 * @param {JxScope | null} scope
 * @returns {string}
 */
export function resolveStaticTagName(tagName: TagNameSlot, scope: JxScope | null): string {
  if (isString(tagName)) {
    return tagName;
  }
  const candidates = tagNameCandidates(tagName);
  if (candidates.length === 0) {
    return "div";
  }
  if (!isTagExpression(tagName)) {
    return candidates[0]!;
  }
  const expression = tagName.$expression;
  /* SAFETY: a tag expression is parsed from a document, so its `target` is a document value (a
     `$ref`, a template string or a literal); the schema leaves it untyped only because any operand
     may stand there. */
  const target = expression.target as JxDocumentValue | undefined;
  if (expression.operator === "?:") {
    return resolveStaticValue(target, scope) ? expression.value : expression.initial;
  }
  const key = resolveStaticValue(target, scope);
  return expression.cases[String(key)] ?? expression.default;
}

/**
 * What the static renderer needs to expand a component instance it meets INSIDE a definition.
 *
 * Without one, a custom-element tag in a component's `children` is an element like any other: the
 * generic path emits `<inner-chip></inner-chip>` with the instance's own (empty) children, no
 * content and no host style — and because the parent still looks static, no module ever loads to
 * fill it (issue #286). The page walk in `site-build` has always expanded the instances it meets in
 * the PAGE tree; this is the same registry, handed down so the definition walk expands too.
 *
 * `path` is the chain of instances currently being expanded, outermost first. It is what makes the
 * recursion terminate: a component graph is bounded, but a definition may name itself.
 */
export interface ComponentPrerenderContext {
  /** Tag name → parsed definition, the registry the page walk expands from. */
  componentDefs: ReadonlyMap<string, JxElement>;
  /** Project defaults, read for `defaults.shadow` (spec.md §16.6). */
  defaults?: ProjectConfig["defaults"] | undefined;
  /** The instances being expanded, outermost first; empty at a page-level instance. */
  path?: readonly PrerenderFrame[] | undefined;
}

/** One instance on the expansion path: its tag, and its resolved props as an identity. */
interface PrerenderFrame {
  tag: string;
  /** `JSON.stringify` of the resolved props — two frames with equal keys are the same instance. */
  key: string;
}

/** What {@link liftPropsAttributes} splits an instance's attributes into. */
export interface LiftedPropsAttributes {
  /** The `props.*` values keyed by prop name, or null when the instance wrote none. */
  lifted: Record<string, JsonValue> | null;
  /** Every other attribute, unchanged. */
  rest: NonNullable<JxElement["attributes"]>;
}

/**
 * Lift literal `props.*` attribute keys off an instance's attributes.
 *
 * JSON-authored instances pass props as literal `props.*` attribute keys (markdown directives are
 * normalized to `$props` by the parser's `expandDotPaths`, but JSON is parsed verbatim). They are
 * lifted so the prerender sees them, and stripped so they do not leak into the emitted HTML. Values
 * stay raw strings — no coercion, matching the markdown path and the runtime's `$props` semantics.
 * Pure: the page walk writes the result back onto its node, the definition walk must not touch a
 * definition every page shares.
 *
 * @param {Record<string, JxAttributeValue> | undefined} attributes
 * @returns {LiftedPropsAttributes} The lifted props (null when there were none) and the attributes
 *   that remain
 */
export function liftPropsAttributes(attributes: JxElement["attributes"]): LiftedPropsAttributes {
  let lifted: Record<string, JsonValue> | null = null;
  const rest: NonNullable<JxElement["attributes"]> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (key.startsWith("props.") && key.length > "props.".length) {
      lifted ??= {};
      /* SAFETY: a JxAttributeValue is a JSON primitive or a `{ $ref }` object with one string
         member, so it is a JsonValue; only the interface's missing index signature hides that. */
      lifted[key.slice("props.".length)] = value as JsonValue;
    } else {
      rest[key] = value;
    }
  }
  return { lifted, rest };
}

/**
 * The build-time scope of one component instance: the definition's `state` with the instance's
 * props laid over it.
 *
 * A prop for an entry declared as an object keeps the declaration and replaces its `default`, so a
 * typed entry stays typed; a bare or undeclared entry is the value itself. Shared by the inner
 * render and the host-style resolution so both read the same instance — they used to build the
 * scope separately, in two slightly different ways.
 *
 * @param {JxElement} doc - Component definition
 * @param {Record<string, JsonValue> | null} props - Instance-specific prop values
 * @returns {JxScope}
 */
export function buildInstanceScope(
  doc: JxElement,
  props: Record<string, JsonValue> | null,
): JxScope {
  if (!props) {
    return buildInitialScope(doc.state ?? {}, null);
  }
  const stateDefs = { ...doc.state };
  for (const [key, value] of Object.entries(props)) {
    const existing = stateDefs[key];
    stateDefs[key] =
      isNonNullObject(existing) && !Array.isArray(existing) && "default" in existing
        ? { ...existing, default: value }
        : value;
  }
  return buildInitialScope(stateDefs, null);
}

/**
 * Resolved host declarations by (camelCase) property: each is what its template read from the
 * instance's scope.
 */
export type ResolvedHostStyle = Record<string, JxScope[string]>;

/**
 * The definition's host `style` entries that depend on the instance, resolved against it.
 *
 * Only template-string values are per-instance (`maskImage: "${'var(--icon-' + state.name +
 * ')'}"`); a literal declaration is in the component's stylesheet already. This is the resolution
 * the page walk performs for a page-level instance, extracted so a nested instance gets the same
 * one.
 *
 * @param {JxStyle | null | undefined} style - The definition's `style`
 * @param {JxScope} scope - The instance's scope (`buildInstanceScope`)
 * @returns {ResolvedHostStyle}
 */
export function resolveHostStyle(
  style: JxStyle | null | undefined,
  scope: JxScope,
): ResolvedHostStyle {
  return Object.fromEntries(
    Object.entries(style ?? {}).flatMap(([prop, value]) => {
      if (!isTemplateString(value)) {
        return [];
      }
      const val = resolveStaticValue(value, scope);
      return val == null ? [] : [[prop, val] as const];
    }),
  );
}

/**
 * The content of one node: `textContent`, else `innerHTML`, else rendered `children`.
 *
 * Shared with `preRenderComponentHtml`, which returns a component's innerHTML and so cannot call
 * `renderStaticNode` (that would wrap the result in the host tag). It used to look at `children`
 * alone and return "" for anything else, so a component whose content is root-level `textContent` —
 * the shape spec.md §17.2 recommends when every child is a bare string — prerendered to nothing.
 *
 * @param {JxElement | JxMutableNode} node
 * @param {JxScope | null} scope
 * @param {string | null} slotContent
 * @param {ComponentPrerenderContext | null} context
 * @returns {string}
 */
function renderInner(
  node: JxElement | JxMutableNode,
  scope: JxScope | null,
  slotContent: string | null,
  context: ComponentPrerenderContext | null,
): string {
  if (node.textContent !== undefined) {
    const val = resolveStaticValue(node.textContent, scope);
    return val != null ? escapeHtml(String(val)) : "";
  }
  if (node.innerHTML) {
    const val = resolveStaticValue(node.innerHTML, scope);
    return val != null ? String(val) : node.innerHTML;
  }
  if (Array.isArray(node.children)) {
    return node.children
      .map((c: JxElement | JxMutableNode | string) =>
        renderStaticNode(c, scope, slotContent, context),
      )
      .join("\n");
  }
  return "";
}

/**
 * A child slot as the static renderer meets it: a node or a text string, plus the JSON scalars,
 * holes and nested lists a hand-written `children` array may also carry.
 */
export type StaticChild =
  | JxElement
  | JxMutableNode
  | string
  | number
  | boolean
  | null
  | undefined
  | StaticChild[];

/**
 * Recursively render a Jx node tree to static HTML for pre-rendering.
 *
 * @param {StaticChild} node
 * @param {JxScope | null} scope
 * @param {string | null} [slotContent] - HTML to substitute for `<slot>` elements
 * @param {ComponentPrerenderContext | null} [context] - The component registry, when a custom
 *   element tag met here should be expanded rather than emitted bare
 * @returns {string}
 */
export function renderStaticNode(
  node: StaticChild,
  scope: JxScope | null,
  slotContent: string | null = null,
  context: ComponentPrerenderContext | null = null,
): string {
  if (isString(node)) {
    if (isTemplateString(node) && scope) {
      const val = evaluateStaticTemplate(node, scope);
      return val != null ? escapeHtml(String(val)) : escapeHtml(node);
    }
    return escapeHtml(node);
  }
  if (isNumber(node) || isBoolean(node)) {
    return escapeHtml(String(node));
  }
  if (Array.isArray(node)) {
    return node.map((c): string => renderStaticNode(c, scope, slotContent, context)).join("\n");
  }
  if (!isNonNullObject(node)) {
    return "";
  }

  // Skip mapped arrays — can't pre-render dynamic lists
  if (node.$prototype === "Array") {
    return "";
  }

  // $switch/cases — resolve the key statically and render the matched case inside a container
  // Element (mirrors the runtime's renderSwitch DOM shape). External $ref cases can't be fetched
  // At compile time, so they render the empty container.
  if (node.$switch) {
    const switchTag = node.tagName ?? "div";
    const attrs = buildAttrs(node, scope);
    const key = resolveStaticValue(node.$switch, scope);
    const caseDef = key == null ? undefined : node.cases?.[String(key)];
    const inner =
      caseDef !== undefined && !isRefObject(caseDef)
        ? renderStaticNode(caseDef, scope, slotContent, context)
        : "";
    return `<${switchTag}${attrs}>${inner}</${switchTag}>`;
  }

  /* Resolved against the SAME scope the attributes are resolved against, so the prerendered markup
     and the client's first render agree about what element this is. The old `${…}` form could not
     do this — it re-resolved the emitted string against the page scope, where a component's own
     state does not exist, so SSR silently emitted the fallback branch's tag. */
  const tag = resolveStaticTagName(node.tagName, scope);

  // Replace <slot> with provided slot content
  if (tag === "slot" && slotContent != null) {
    return slotContent;
  }

  // A registered component: expanded exactly as the page walk expands one, not emitted bare.
  const def = context?.componentDefs.get(tag);
  if (def && context) {
    return renderComponentInstance(node, def, scope, slotContent, context);
  }

  const attrs = buildAttrs(node, scope);

  if (SELF_CLOSING.has(tag)) {
    return `<${tag}${attrs}>`;
  }

  return `<${tag}${attrs}>${renderInner(node, scope, slotContent, context)}</${tag}>`;
}

/**
 * Render one component instance met inside a definition, with everything the page walk gives a
 * page-level instance — the expansion is the same in both places, so the pieces are shared.
 *
 * - Props: `props.*` attributes lifted, then `$props`; a template value resolves against the PARENT's
 *   scope, which is what `resolveDocTemplates` does for a page-level instance before the page walk
 *   reaches it.
 * - Slot content: the instance's own children, rendered in the parent's scope and with the parent's
 *   slot content, so a `<slot>` written among them passes the grandparent's through.
 * - Shadow mode: a declarative shadow root with the stylesheet link inside it (spec.md §16.6).
 * - Host style: the definition's template-string entries resolved against the INSTANCE, written on
 *   the element — the page walk's `resolvedStyle` in inline form, since there is no page stylesheet
 *   to append a class rule to from here.
 * - `data-jx-props` when the instance is not static, so the props survive the element's re-render on
 *   upgrade (compiler.md §4.4); `data-jx-static` / `data-jx-prerendered` by the same predicate.
 *
 * Termination: a frame equal to one already on the path — same tag, same props — is the instance
 * rendering itself, and a path at the cap is recursion that never settled. Both are the author's
 * error and both name the chain, because "Maximum call stack size exceeded" names nothing.
 *
 * @param {JxElement | JxMutableNode} node - The instance as written in the parent's tree
 * @param {JxElement} def - The registered definition for its tag
 * @param {JxScope | null} scope - The parent's scope
 * @param {string | null} slotContent - The parent's slot content
 * @param {ComponentPrerenderContext} context
 * @returns {string}
 * @docs framework/build
 */
function renderComponentInstance(
  node: JxElement | JxMutableNode,
  def: JxElement,
  scope: JxScope | null,
  slotContent: string | null,
  context: ComponentPrerenderContext,
): string {
  /* SAFETY: the caller looked `def` up in `componentDefs` by the node's resolved string tag, and
     that registry is keyed by each definition's own `tagName`, so this is that same string. */
  const tag = def.tagName as string;
  const { lifted, rest: attributes } = liftPropsAttributes(node.attributes);
  const written = { ...lifted, ...node.$props };
  const props: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(written)) {
    /* SAFETY: a prop resolves against the parent's build-time scope, where what a `$ref` or template
       may read is JSON state, and the props travel on as JSON either way (`data-jx-props` below), as
       the page walk serializes a page-level instance's. */
    props[key] = (resolveStaticValue(value, scope) as JsonValue | null) ?? value;
  }
  const hasProps = Object.keys(props).length > 0;

  const path = context.path ?? [];
  const frame: PrerenderFrame = { key: JSON.stringify(props), tag };
  const chain = [...path.map((f) => f.tag), tag].join(" → ");
  if (path.some((f) => f.tag === frame.tag && f.key === frame.key)) {
    throw new Error(
      `Component <${tag}> renders itself: ${chain}. A component cannot appear inside its own ` +
        `definition with the same props — the expansion would never end.`,
    );
  }
  if (path.length >= MAX_COMPONENT_NESTING) {
    throw new Error(
      `Component nesting exceeds ${MAX_COMPONENT_NESTING} levels: ${chain}. A component that ` +
        `renders itself with changing props needs a case that stops.`,
    );
  }
  const nested: ComponentPrerenderContext = { ...context, path: [...path, frame] };

  // The instance's children are the parent's nodes: parent scope, parent slot, parent path.
  const slot =
    Array.isArray(node.children) && node.children.length > 0
      ? node.children
          .map((c: JxElement | JxMutableNode | string) =>
            renderStaticNode(c, scope, slotContent, context),
          )
          .join("\n")
      : null;

  const shadow = resolveShadowMode(def, context.defaults);
  const isStatic = isComponentFullyStatic(def);
  const instanceScope = buildInstanceScope(def, hasProps ? props : null);
  const inner = renderInner(def, instanceScope, shadow ? null : slot, nested);
  const innerHTML = shadow
    ? `<template shadowrootmode="${shadow}">` +
      `<link rel="stylesheet" href="/components/${tag}.css">` +
      `${inner}</template>${slot ?? ""}`
    : inner;

  const hostStyle = Object.entries(resolveHostStyle(def.style, instanceScope))
    .map(([prop, value]) => `${camelToKebab(prop)}: ${value}`)
    .join("; ");

  // The element as the page walk would leave it: props consumed, children rendered, stamped. A
  // Copy, because `node` is a definition every page shares.
  const instance = { ...node };
  delete instance.$props;
  delete instance.children;
  instance.attributes =
    !isStatic && hasProps ? { ...attributes, "data-jx-props": JSON.stringify(props) } : attributes;
  if (isStatic) {
    instance.$static = true;
  } else {
    instance.$prerendered = true;
  }
  return `<${tag}${buildAttrs(instance, scope, hostStyle)}>${innerHTML}</${tag}>`;
}

/**
 * Pre-render a component definition to static HTML for its inner content.
 *
 * @param {JxElement} doc - Component JSON definition
 * @param {Record<string, JsonValue> | null} [propsOverride] - Instance-specific prop values to
 *   merge into state
 * @param {string | null} [slotContent] - HTML to substitute for `<slot>` elements
 * @param {ComponentPrerenderContext | null} [context] - The component registry; with one, an
 *   instance of a registered component inside `doc` is expanded rather than emitted bare
 * @returns {string} The pre-rendered innerHTML
 */
export function preRenderComponentHtml(
  doc: JxElement,
  propsOverride: Record<string, JsonValue> | null = null,
  slotContent: string | null = null,
  context: ComponentPrerenderContext | null = null,
) {
  return renderInner(doc, buildInstanceScope(doc, propsOverride), slotContent, context);
}

/**
 * Check if a component definition is fully static (no runtime behavior needed).
 *
 * Returns true when: no event handlers, no $prototype entries (Functions, Request, Storage), no
 * $ref values. Conservative — returns false when uncertain.
 *
 * @param {JxElement} doc - Component JSON definition
 * @returns {boolean}
 */
export function isComponentFullyStatic(doc: JxElement) {
  return _isStaticNode(doc);
}

/**
 * @param {JxElement | string | (JxElement | string)[]} node
 * @returns {boolean}
 */
function _isStaticNode(node: JxElement | string | (JxElement | string)[]): boolean {
  if (!isNonNullObject(node)) {
    return true;
  }
  if (Array.isArray(node)) {
    return node.every((n) => _isStaticNode(n));
  }

  // Check for $prototype (Functions, Request, Storage, etc.)
  if (node.$prototype) {
    return false;
  }
  // Check for $ref
  if (node.$ref) {
    return false;
  }

  // Check state entries
  if (node.state) {
    for (const def of Object.values(node.state)) {
      if (!isNonNullObject(def) || Array.isArray(def)) {
        continue;
      }
      if (def.$prototype) {
        return false;
      }
      if (def.$ref) {
        return false;
      }
    }
  }

  // Check for event handlers
  for (const key of Object.keys(node)) {
    if (key.startsWith("on") && key !== "observedAttributes") {
      return false;
    }
  }

  // Recurse into children
  if (Array.isArray(node.children)) {
    return node.children.every((c) => _isStaticNode(c));
  }
  // The legacy bare children slot: a mapped array builds its children at runtime.
  if (isMappedArray(node.children)) {
    return false;
  }

  return true;
}

/**
 * Generate CSS rules for a component: host-level styles using tag selector, plus inner element
 * styles using .jx-N selectors via collectStyles.
 *
 * @param {string} tagName - The custom element tag name (used as CSS selector)
 * @param {JxStyle | null} styleDef - The component's style object
 * @param {JxElement | null} [doc] - The full component document (for walking children)
 * @param {Record<string, string>} [mediaQueries] - Project media query definitions
 * @returns {string} CSS text, or empty string if no styles
 */
/** `::slotted()` and `::part()` select through a shadow boundary, not the host that owns it. */
const SHADOW_STANDALONE = /^(?:::slotted\(|::part\()/;

/**
 * Turn one nested style key into a selector, given the component's scope prefix.
 *
 * Three shapes, and the interesting one is `:host`. A style object should mean the same thing in
 * both modes, so `:host` and `:host(.foo)` are **translated** rather than passed through: inside a
 * shadow root they stand alone, and in the light DOM they become the tag name and `<tag>.foo` —
 * which is what "the host, matching this" means when there is no shadow root. Moving a component
 * between modes therefore does not silently break its styles.
 *
 * @param {string} prop - The style-object key, e.g. `":hover"`, `"& .inner"`, `":host(.wide)"`
 * @param {string} scope - `":host"` in shadow mode, the tag name otherwise
 * @returns {string}
 */
function resolveSelector(prop: string, scope: string): string {
  /* Member by member, for the reason css.ts's `resolveNestedSelector` does it: a key may be a
     SELECTOR LIST, and splicing one as a single string spliced only its first `&`. `"& .a, & .b"`
     came out as `sty-card .a, & .b`, and a raw `&` in a built stylesheet is not a nesting selector
     at all — the browser discards the list and the component silently loses those rules. This is
     the one selector path that does not go through the shared builder, because `:host` has to be
     translated before the scope is applied, so it needed the same fix separately. */
  return splitSelectorList(prop)
    .map((member) => resolveSelectorMember(member, scope))
    .join(", ");
}

/** One member of {@link resolveSelector}'s list against the scope. */
function resolveSelectorMember(prop: string, scope: string): string {
  if (prop.startsWith("&")) {
    return prop.replaceAll("&", scope);
  }
  if (prop.startsWith(":host")) {
    const inner = /^:host\((.*)\)$/.exec(prop)?.[1];
    if (scope === ":host") {
      return prop;
    }
    return inner === undefined ? scope : `${scope}${inner}`;
  }
  // `:host::slotted(x)` matches nothing — the pseudo-element attaches to a slot, not the host.
  if (scope === ":host" && SHADOW_STANDALONE.test(prop)) {
    return prop;
  }
  return `${scope}${prop}`;
}

export function buildComponentCSS(
  tagName: string,
  styleDef?: JxStyle | null | undefined,
  doc: JxElement | null = null,
  mediaQueries: Record<string, string> = {},
  shadow: ShadowMode | null = null,
) {
  const rules: string[] = [];
  /*
   * The scope prefix. In light DOM it is the tag name, which is what keeps `sty-card .inner` from
   * reaching another component's `.inner`. Inside a shadow root the selector cannot see the host's
   * tag name at all, and `:host` is the standard's way to address it — so the same style object
   * produces different, correct CSS in each mode without the author restating it.
   */
  const scope = styleScopePrefix(tagName, shadow);

  if (isNonNullObject(styleDef)) {
    /* The top level is walked here rather than handed straight to the builder, because ONE of its
       keys does not mean what `resolveNestedSelector` would make of it: `:host` and `:host(.foo)`
       are TRANSLATED per {@link resolveSelector} so a style object means the same thing in both
       modes. Everything below the top level is ordinary nesting, so each block goes to the builder
       whole — which is also what gives a component's nested selectors the recursion they never had
       (this used to emit exactly one level and drop anything under it). */
    const own: JxStyle = {};
    const blocks: [string, JxStyle][] = [];
    for (const [prop, value] of Object.entries(styleDef)) {
      /* `isRef` first, and it is the whole point: an object carrying `$ref` is a reactive VALUE,
         not a nested block (spec.md §9.1). Sorted into `blocks` it matched neither branch below —
         not an at-rule, not a nested selector — and was dropped without reaching the builder at
         all, so the one emitter that could have reported it never saw it. */
      if (isRef(value)) {
        own[prop] = value;
      } else if (isNonNullObject(value) && !Array.isArray(value)) {
        blocks.push([prop, value]);
      } else if (!prop.startsWith("@") && !isNestedSelectorKey(prop)) {
        own[prop] = value;
      }
    }
    pushStyleRules(rules, own, scope, mediaQueries);
    for (const [prop, val] of blocks) {
      if (prop.startsWith("@")) {
        pushStyleRules(rules, { [prop]: val }, scope, mediaQueries);
      } else if (isNestedSelectorKey(prop)) {
        pushStyleRules(rules, val, resolveSelector(prop, scope), mediaQueries);
      }
    }
  }

  if (doc && Array.isArray(doc.children)) {
    const counter = { n: 0 };
    for (const child of doc.children) {
      collectStyles(child, rules, mediaQueries, "", counter, tagName);
    }
  }

  return rules.length > 0 ? `${rules.join("\n")}\n` : "";
}
