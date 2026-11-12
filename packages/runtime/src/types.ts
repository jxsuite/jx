/// <reference lib="dom" />
import type {
  JxDocument,
  JxDocumentValue,
  JxElement,
  JxMappedArray,
  JxPath,
} from "@jxsuite/schema/types";
import type { Ref } from "@vue/reactivity";

export type { JxPath } from "@jxsuite/schema/types";

/**
 * What one member of a {@link JxScope} holds: every kind of value the runtime puts into a scope or
 * hands to a document's code.
 *
 * - A document's own values (`JxDocumentValue`): JSON, and the typed shapes a naked `state` entry, a
 *   `$`-local or a literal `$props` value copies in (spec.md §5.3).
 * - `undefined`, for a member or an argument that is absent.
 * - Arrays and records of scope values: reactive objects, host records, `$props`, and the instance an
 *   external class constructs (spec.md §12.3), every one of them read by member name.
 * - Functions ({@link JxScopeFunction}): handlers, formulas, `$src` exports, server-function proxies
 *   and a host's own functions.
 * - Refs: the computed and data-source entries the reactive proxy unwraps on read.
 * - The `$map` context a mapped row renders under ({@link JxRowContext}).
 * - DOM objects: event targets (nodes, the window, the document) and events, which `window#/`,
 *   `document#/` and `event#/` references read.
 * - The platform objects a `$prototype` entry resolves to (spec.md §11.2): `Map`, `Set`, `FormData`,
 *   `Blob`, and the `IDBObjectStore` an `IndexedDB` entry's `getStore()` yields.
 * - A promise of any of those: a computed entry over an `async` function settles later.
 *
 * Narrow it with the guards in `@jxsuite/schema/guards`, which work on the union.
 */
export type JxScopeValue = JxSettledValue | Promise<JxSettledValue>;

/**
 * A scope member that is not a promise: what a {@link JxScopeValue} settles to. A promise never
 * fulfils with another promise, which is what lets an `await` on a scope member end.
 */
export type JxSettledValue =
  | JxDocumentValue
  | undefined
  | JxScopeValue[]
  | readonly JxScopeValue[]
  | JxScope
  | JxScopeFunction
  | Ref<JxScopeValue>
  | JxRowContext
  | EventTarget
  | Event
  | ReadonlyMap<JxScopeValue, JxScopeValue>
  | ReadonlySet<JxScopeValue>
  | FormData
  | Blob
  | IDBObjectStore;

/**
 * The live reactive scope (spec.md §15): a prototype-chained record of state entries, `$props`, a
 * host's members and the runtime's `$` vocabulary, each read and written by name.
 */
export interface JxScope {
  [name: string]: JxScopeValue;
}

/**
 * A function a scope holds, as the scope sees it: a handler, a formula, a `$src` export, a
 * server-function proxy or a host's own function. JavaScript checks neither the arguments a call
 * passes nor what it returns, so this is every function; a call site narrows it to the signature it
 * calls with, and a result it reads is a scope member by the contract of whatever stored the
 * function (a computed entry, a formula, a server call).
 */
export type JxScopeFunction = (...args: never[]) => void;

/**
 * The `$map` context a mapped row renders under (spec.md §10.2): the row's item, and its index in
 * the list. Both are written in place when the row is reused.
 */
export interface JxRowContext {
  index: number;
  item: JxScopeValue;
}

/**
 * A value a host hands the runtime, held to {@link JxScopeValue} member by member.
 *
 * A host declares its scope with interfaces, and TypeScript gives an interface no implicit index
 * signature, so a host's record is never assignable to {@link JxScope}, however its members are
 * typed. This walks the declared type instead: a scope value stays as it is, a `bigint` or a
 * `symbol` is refused (neither is a scope value), a function is held to what it returns, and
 * anything else — an array, a record — is held member by member.
 */
export type JxHostValue<T> = T extends JxScopeValue
  ? T
  : T extends bigint | symbol
    ? never
    : T extends (...args: infer A) => infer R
      ? (...args: A) => JxHostValue<R>
      : { [K in keyof T]: JxHostValue<T[K]> };

/** A host's scope, held to {@link JxScopeValue} member by member (see {@link JxHostValue}). */
export type JxHostScope<S> = { [K in keyof S]: JxHostValue<S[K]> };

/** An event handler stored in the scope: `(scope, event) => void`. */
export type JxEventHandler = (scope: JxScope, event: Event) => void;

/**
 * A host-supplied document source consulted before the network. Returning `undefined` means "not
 * mine" and the runtime fetches as usual; a hit is served for THIS mount only and never enters the
 * shared resolve cache.
 */
export type DocumentResolver = (url: string) => JxDocument | Promise<JxDocument> | undefined;

/**
 * Per-mount configuration, threaded through a render instead of read from module globals. A shell
 * that hosts many roots beside a canvas needs each root to answer "which `$media`, which base,
 * which documents" for itself; the module-level setters remain the defaults a context inherits.
 */
export interface JxContext {
  /** Base URL the document's own references resolve against. */
  base: string;
  /**
   * Root `$media` map for components that declare `@--name` blocks but carry no own `$media`; null
   * inherits the module default.
   */
  media: Record<string, string> | null;
  /** The mount's rendered root, set once render completes — the default `dispatchEvent` target. */
  root: HTMLElement | Text | null;
  resolver?: DocumentResolver;
  /** Per-mount override of `setSkipServerFunctions`; undefined inherits the module default. */
  skipServerFunctions?: boolean;
  /** Per-mount override of `setSkipAutoRequests`; undefined inherits the module default. */
  skipAutoRequests?: boolean;
}

/**
 * Options for {@link mount}: the host's half of the embedding contract (specs/embedding.md). `S` is
 * the host's own scope type, which `mount` holds to {@link JxHostScope}.
 */
export interface JxMountOptions<S = JxScope> {
  /**
   * Host members merged into the document's scope before its own `state` is built: reactive
   * records, refs, computeds and plain functions. A document `state` entry of the same name wins.
   * Keys beginning with `$` or `#` are runtime vocabulary and are refused.
   */
  scope?: S;
  base?: string;
  media?: Record<string, string>;
  resolver?: DocumentResolver;
  skipServerFunctions?: boolean;
  skipAutoRequests?: boolean;
  /** Aborting disposes the mount; an already-aborted signal mounts nothing. */
  signal?: AbortSignal;
  onNodeCreated?: JxRenderOptions["onNodeCreated"];
  onNodeMoved?: JxRenderOptions["onNodeMoved"];
  /** Authoring hook, off by default: see {@link JxRenderOptions.rowLimit}. */
  rowLimit?: JxRenderOptions["rowLimit"];
  /** Authoring hook, off by default: see {@link JxRenderOptions.emptyRow}. */
  emptyRow?: JxRenderOptions["emptyRow"];
  /** Authoring hook, off by default: see {@link JxRenderOptions.onListReconciled}. */
  onListReconciled?: JxRenderOptions["onListReconciled"];
}

/** What one reconciliation of a mapped array drew: see {@link JxRenderOptions.onListReconciled}. */
export interface JxListReconciliation {
  /** How many items the list resolved to, after `filter` and `sort` and before any `rowLimit`. */
  count: number;
  /** How many rows stand in the DOM, the `emptyRow` placeholder included. */
  rendered: number;
  /** Whether the list resolved to no items (so a row that is drawn is the `emptyRow` one). */
  empty: boolean;
}

/** A mounted document: its live scope, its root node, and the disposer that tears it down. */
export interface JxMount {
  /** The reactive scope. Host writes to members it supplied propagate into the render. */
  readonly scope: JxScope;
  readonly root: HTMLElement | Text;
  /**
   * Custom-element tag names this render instantiated, so a host can re-mount what a redefinition
   * touches.
   */
  readonly elements: ReadonlySet<string>;
  /** Removes the root, stops every effect, then calls `onUnmount`. Idempotent. */
  readonly dispose: () => void;
}

export interface JxRenderOptions {
  _path?: JxPath;
  /** The mount context this render belongs to; absent on the legacy direct-render path. */
  _ctx?: JxContext;
  /** Read by {@link Jx} only: aborting disposes the mount. */
  signal?: AbortSignal;
  /**
   * Base URL the document's own references resolve against — `$ref`, `$elements`, `$head` and the
   * asset paths beneath them.
   *
   * Only {@link Jx} reads it, and only when it was handed a document OBJECT rather than a URL. A URL
   * carries its own base; an object does not, so the base defaulted to `location.href` — which is
   * right for a page served at the project root and wrong everywhere else. A host that composes a
   * document server-side and serves it at `/blog/hello/` needs to say that its references are still
   * root-relative, or every one of them resolves a directory too deep.
   */
  base?: string;
  /** The namespace the parent element established — SVG and MathML descendants inherit it. */
  _ns?: string | null;
  /**
   * Called for each created ELEMENT (a text node is not reported). `state` is the local scope the
   * node's children render with — callers can capture it to re-render a subtree in isolation
   * later.
   *
   * `path` is the node's document path, with two exceptions that name something the document does
   * not hold as a node. A mapped row is at `[…array, "map", index]`. A node a template splices in
   * (spec.md §8.4) is at the template's own position followed by its index in the resolved array:
   * `[…, "children", j]` for a whole-`children` template, `[…, "children", i, j]` for a templated
   * string member at `children[i]`; its `def` is the resolved value, not a member of the document.
   */
  onNodeCreated?: (
    el: HTMLElement | Text,
    path: JxPath,
    def: JxElement | string,
    state?: JxScope,
  ) => void;
  /**
   * Called when a keyed mapped-array row is reused at a new index. The node is the same one
   * `onNodeCreated` reported; `path` is its new document path, so a host that stamped the old one
   * can re-stamp it.
   *
   * Only the row's ROOT is reported. Every descendant's path changed with it (each begins with the
   * row's), and none of them is reported: a host that stamped the subtree rewrites that prefix
   * itself.
   */
  onNodeMoved?: (node: HTMLElement | Text, path: JxPath) => void;
  /**
   * Authoring hook, off by default: the most rows any one mapped array draws. Items past it are not
   * rendered at all (no node, no scope, no effects). A value that is not a number of zero or more
   * is ignored; a fraction is floored. It applies to every list this render reaches, nested ones
   * included, and after `emptyRow`, so a limit of zero draws nothing.
   */
  rowLimit?: number;
  /**
   * Authoring hook, off by default: called when a mapped array that has a `map` resolves to no
   * items (an empty array, or `items` that is not an array yet). Returning anything but `undefined`
   * draws ONE row with that value as its `$map.item` at index 0, so an editor has a row to show and
   * select; returning `undefined` draws nothing, as without the hook. `path` is the array's own
   * document path. The row is replaced by real rows as soon as the list has any.
   */
  emptyRow?: (arrayDef: JxMappedArray, path: JxPath) => JxScopeValue;
  /**
   * Authoring hook, off by default: called after each reconciliation of a mapped array, the first
   * render included, with the array's own document path.
   */
  onListReconciled?: (path: JxPath, result: JxListReconciliation) => void;
}

/**
 * A method body compiled by `new Function` from a `.class.json` method definition. Only document
 * code calls it, so its arguments and result are opaque to TypeScript.
 */
export type DynamicMethod = (...args: never[]) => void;

/** The prototype of a {@link DynamicClass}: instance methods attached by name. */
export type DynamicPrototype = Record<string, DynamicMethod>;

/**
 * A class built at runtime from a `.class.json` definition. Its static side carries the static
 * methods attached by name beside the prototype; an instance holds the constructor `config` values
 * under its field names.
 */
export interface DynamicClass {
  new (config?: JxScope): JxScope;
  [member: string]: DynamicMethod | DynamicPrototype;
  prototype: DynamicPrototype;
}
