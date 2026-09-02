/// <reference lib="dom" />
import type { JxDocument, JxElement, JxPath } from "@jxsuite/schema/types";

export type { JxPath } from "@jxsuite/schema/types";

/**
 * The live reactive scope: a prototype-chained object whose keys are user-defined state names.
 * Values are runtime JS values (signals, functions, JSON data) and must be narrowed at use — this
 * alias marks the dynamic boundary by name.
 */
export type JxScope = Record<string, unknown>;

/** An event handler stored in the scope: `(scope, event) => void`. */
export type JxEventHandler = (scope: JxScope, event: Event) => unknown;

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

/** Options for {@link mount}: the host's half of the embedding contract (specs/embedding.md). */
export interface JxMountOptions {
  /**
   * Host members merged into the document's scope before its own `state` is built: reactive
   * records, refs, computeds and plain functions. A document `state` entry of the same name wins.
   * Keys beginning with `$` or `#` are runtime vocabulary and are refused.
   */
  scope?: Record<string, unknown>;
  base?: string;
  media?: Record<string, string>;
  resolver?: DocumentResolver;
  skipServerFunctions?: boolean;
  skipAutoRequests?: boolean;
  /** Aborting disposes the mount; an already-aborted signal mounts nothing. */
  signal?: AbortSignal;
  onNodeCreated?: JxRenderOptions["onNodeCreated"];
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
  /** Stops every effect, calls `onUnmount`, removes the root. Idempotent. */
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
   * Called for each created node. `state` is the local scope the node's children render with —
   * callers can capture it to re-render a subtree in isolation later.
   */
  onNodeCreated?: (
    el: HTMLElement | Text,
    path: JxPath,
    def: JxElement | string,
    state?: JxScope,
  ) => void;
}

export interface DynamicClass {
  new (config?: Record<string, unknown>): Record<string, unknown>;
  [key: string]: unknown;
  prototype: Record<string, unknown>;
}
