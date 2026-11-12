/// <reference lib="dom" />
/**
 * Remote data in the canvas frame: fetched once, kept, and reported honestly (studio.md §4.5).
 *
 * Edit and Design used to start no automatic `Request` and no `timing: "server"` call at all,
 * because a full render builds the scope again and every authoring action that escalated to one
 * repeated the request. Here the frame answers the runtime's every remote lookup instead
 * (`setRemoteLookupHandler`, embedding.md §5.2): the first time a lookup is asked for it runs, and
 * every later ask, from any later render, is handed what it answered. So author code runs on the
 * canvas once, and four things follow from taking that seriously:
 *
 * - **Nothing blocks.** A lookup is a promise the render never waits on. One that never answers is
 *   given up after {@link REMOTE_TIMEOUT_MS} and reads as failed.
 * - **Nothing breaks the render.** A rejection is an answer, kept like any other; the entry holds
 *   what the page would hold after the same failure.
 * - **Nothing fires in a loop.** A lookup is keyed by what it asks for with every binding resolved
 *   ({@link remoteKey}), so a URL that reads a state value is a new lookup per value and never a
 *   second one for the same value. A document may start {@link REMOTE_LIMIT} distinct lookups
 *   between two Refreshes; past that the canvas stops asking.
 * - **Nothing writes.** Only a `GET` runs. Any other method changes something somewhere, and drawing
 *   a page is no reason to do that.
 *
 * The answers belong to the TAB, not to this frame: a frame is reused from tab to tab, Design draws
 * one frame per breakpoint, and a frame reloads. So the host keeps them (`canvas/remote-data.ts`),
 * hands every render the ones it has, and names one frame of the tab to fetch the rest; the others
 * wait for the host to pass the answer on.
 *
 * Everything here is pure state and DOM attributes, so all of it runs under happy-dom.
 *
 * @docs studio/logic/data
 */

import { isJsonObject, isRef, isString } from "@jxsuite/schema/guards";
import type { RemoteLookup, RemoteLookupAnswer } from "@jxsuite/runtime";
import type { JxScope } from "@jxsuite/runtime/types";
import type { JsonObject, JsonValue, JxDocumentValue } from "@jxsuite/schema/types";
import { BOUND_FIELD_ATTR, TAG_ATTR, TAG_REF_ATTR } from "../utils/edit-display";
import { TEMPLATE_ROW_ATTR } from "./iframe-rows";
import { ECHO_PATH_ATTR, STAMPED_SELECTOR } from "./path-mapping";
import { FAILED_NOTE, NOT_RUN_NOTE, PENDING_NOTE, THROWN_NOTE } from "./iframe-protocol";
import type {
  BindingState,
  BindingStatus,
  EntryStatus,
  RemoteResult,
  RemoteWire,
} from "./iframe-protocol";

/** How long a lookup may go unanswered before the canvas reads it as failed. */
export const REMOTE_TIMEOUT_MS = 30_000;

/** How many distinct lookups one document may start between two Refreshes. */
export const REMOTE_LIMIT = 32;

/** The attribute a chip, a bound block or a template row carries its unresolved state in. */
export const STATUS_ATTR = "data-jx-status";

/** The attribute that carries the few words drawn beside the state. */
export const STATUS_NOTE_ATTR = "data-jx-status-note";

/** Why the canvas did not start a lookup. */
type NotRun = "method" | "host" | "limit";

/** The last lookup the runtime asked about for one state key of one scope. */
interface Asked {
  /** Its {@link remoteKey}, or null for one the canvas does not run. */
  cacheKey: string | null;
  notRun?: NotRun;
}

/** A lookup this frame is waiting on another frame for. */
interface Waiting {
  /** What everything that asks while it waits is handed. */
  promise: Promise<JsonValue>;
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
}

/** One frame's view of its tab's remote data. */
export interface RemoteStore {
  /** The session the answers below belong to, or null before the first editable render. */
  session: string | null;
  /** Whether this frame fetches what the session lacks. */
  fetch: boolean;
  /** Whether the host can run a `timing: "server"` function. */
  server: boolean;
  settled: Map<string, RemoteResult>;
  /**
   * Lookups THIS frame started that have not answered, by {@link runningKey}: one promise for
   * everything that asks while it is out. Kept across sessions, because a frame is handed another
   * tab's document and then the first one again while a request is still out, and the request is
   * still the first tab's: asked for again in its own session it is the same lookup, not a second.
   */
  running: Map<string, Promise<JsonValue>>;
  /** Lookups of this session another frame is to fetch, by key. A new session abandons them. */
  waiting: Map<string, Waiting>;
  /** How many lookups this frame has started in this session. */
  started: number;
  /** Per scope, the last lookup asked about under each state key. */
  asked: WeakMap<JxScope, Map<string, Asked>>;
  /**
   * Told each answer this frame's own lookup produced, with the session it was asked in: the host
   * is who keeps it, and who knows whether that session is still the tab's.
   */
  onSettled: (key: string, result: RemoteResult, session: string) => void;
  /** Told whenever a status may have changed. */
  onChange: () => void;
  /** {@link REMOTE_TIMEOUT_MS}, or a test's own. */
  timeoutMs: number;
}

/** A store with nothing in it. */
export function newRemoteStore(
  onSettled: RemoteStore["onSettled"] = () => {},
  onChange: RemoteStore["onChange"] = () => {},
  timeoutMs = REMOTE_TIMEOUT_MS,
): RemoteStore {
  return {
    asked: new WeakMap(),
    fetch: false,
    onChange,
    onSettled,
    running: new Map(),
    server: false,
    session: null,
    settled: new Map(),
    started: 0,
    timeoutMs,
    waiting: new Map(),
  };
}

/** `value` as JSON with every object's keys in order, so equal values are equal text. */
function stableJson(value: JsonValue | undefined): string {
  if (value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((member) => stableJson(member)).join(",")}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * What a lookup is kept under: its kind and what it asks for, every binding resolved. The entry's
 * definition IS what it asks for, so an edit to a URL, a header or an argument is another key, and
 * the state key the entry happens to be declared under is not part of it.
 */
export function remoteKey(lookup: Pick<RemoteLookup, "kind" | "request">): string {
  return `${lookup.kind} ${stableJson(lookup.request)}`;
}

/** A failure as the words the author is shown. */
function failureOf(error: Error | string): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return error === "" ? "The request failed" : error;
}

/** What a lookup this frame started is kept under while it is out: its session, then its key. */
function runningKey(session: string | null, cacheKey: string): string {
  return `${session ?? ""}\n${cacheKey}`;
}

/** The error a wait is ended with when its session is over: the runtime drops it unreported. */
function abandoned(): Error {
  const error = new Error("The canvas moved on");
  error.name = "AbortError";
  return error;
}

/**
 * Take a render's word on the tab's remote data. Another session forgets every answer held and ends
 * every wait (a Refresh, or a frame handed another tab's document); the same one gains the answers
 * it lacked. What the host holds is the tab's answer: should this frame hold another for the same
 * lookup (two frames each fetched it, across a view that was torn down mid-request), the host's
 * replaces it here, so every frame of the tab draws one answer from the next render on.
 *
 * A lookup this frame has out is NOT dropped with the session it was asked in ({@link
 * RemoteStore.running}).
 */
export function adoptRemote(store: RemoteStore, wire: RemoteWire): void {
  if (wire.session !== store.session) {
    for (const wait of store.waiting.values()) {
      wait.reject(abandoned());
    }
    store.session = wire.session;
    store.settled = new Map();
    store.waiting = new Map();
    store.started = 0;
  }
  store.fetch = wire.fetch;
  store.server = wire.server;
  takeResults(store, wire.results, true);
}

/** Take answers another frame of the tab fetched. Ones for another session are dropped. */
export function adoptRemoteResults(
  store: RemoteStore,
  session: string,
  results: Readonly<Record<string, RemoteResult>>,
): void {
  if (session === store.session) {
    takeResults(store, results, false);
  }
}

/**
 * Keep `results` and end the waits they answer. `replace` lets one stand in for an answer already
 * held, which only a render may do: an entry is written from what is held when its scope is built.
 */
function takeResults(
  store: RemoteStore,
  results: Readonly<Record<string, RemoteResult>>,
  replace: boolean,
): void {
  let changed = false;
  for (const [key, result] of Object.entries(results)) {
    if (store.settled.has(key) && !replace) {
      continue;
    }
    store.settled.set(key, result);
    changed = true;
    const wait = store.waiting.get(key);
    if (wait) {
      store.waiting.delete(key);
      if (result.ok) {
        wait.resolve(result.value);
      } else {
        wait.reject(new Error(result.error));
      }
    }
  }
  if (changed) {
    store.onChange();
  }
}

/** Remember what the runtime last asked about under `lookup`'s state key. */
function note(store: RemoteStore, lookup: RemoteLookup, asked: Asked): void {
  let keys = store.asked.get(lookup.scope);
  if (!keys) {
    keys = new Map();
    store.asked.set(lookup.scope, keys);
  }
  keys.set(lookup.key, asked);
}

/**
 * Why the canvas will not start `lookup`, or null when it may.
 *
 * A request runs only when its method is the text `GET`, in any case, or is not given at all. The
 * test is what it IS and not what it is not: the canvas draws a document as written, valid or not,
 * and `fetch` makes a method of whatever it is handed, so `["POST"]` is sent as a `POST`.
 */
function refusal(store: RemoteStore, lookup: RemoteLookup): NotRun | null {
  if (lookup.kind === "request") {
    const { method } = lookup.request;
    const reads = method === undefined || (isString(method) && method.toUpperCase() === "GET");
    return reads ? null : "method";
  }
  return store.server ? null : "host";
}

/** `lookup`, given up as failed when it has not answered in `ms`. */
function bounded(lookup: Promise<JsonValue>, ms: number): Promise<JsonValue> {
  return new Promise<JsonValue>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`No answer after ${Math.round(ms / 1000)} seconds`));
    }, ms);
    lookup.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: Error | string) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(failureOf(error)));
      },
    );
  });
}

/**
 * The frame's answer to one remote lookup: the runtime's `RemoteLookupHandler`, over `store`.
 *
 * A kept answer is written at once, so a render after the first draws its data with its first
 * paint. A kept FAILURE is written as the page would have left the entry (a request's `{ error }`,
 * a server function's untouched value) without starting anything or logging again.
 */
export function answerLookup(
  store: RemoteStore,
  lookup: RemoteLookup,
  run: () => Promise<JsonValue>,
): RemoteLookupAnswer {
  const refused = refusal(store, lookup);
  if (refused) {
    note(store, lookup, { cacheKey: null, notRun: refused });
    store.onChange();
    return null;
  }
  const cacheKey = remoteKey(lookup);
  const kept = store.settled.get(cacheKey);
  if (kept) {
    note(store, lookup, { cacheKey });
    store.onChange();
    if (kept.ok) {
      return { value: kept.value };
    }
    return lookup.kind === "request" ? { value: { error: kept.error } } : null;
  }
  const { session } = store;
  const runs = runningKey(session, cacheKey);
  const out = store.running.get(runs);
  if (out) {
    note(store, lookup, { cacheKey });
    store.onChange();
    return out;
  }
  const wait = store.waiting.get(cacheKey);
  if (!store.fetch) {
    // Another frame of the tab fetches; the host passes its answer on (`adoptRemoteResults`).
    note(store, lookup, { cacheKey });
    store.onChange();
    if (wait) {
      return wait.promise;
    }
    const { promise, reject, resolve } = Promise.withResolvers<JsonValue>();
    store.waiting.set(cacheKey, { promise, reject, resolve });
    return promise;
  }
  if (store.started >= REMOTE_LIMIT) {
    note(store, lookup, { cacheKey: null, notRun: "limit" });
    store.onChange();
    return null;
  }
  store.started += 1;
  /* Started inside the executor, so a lookup that throws before it returns a promise (a URL the
     platform refuses) fails like any other instead of out of the render that asked. */
  const started = bounded(
    new Promise<JsonValue>((resolve) => {
      resolve(run());
    }),
    store.timeoutMs,
  );
  const settle = (result: RemoteResult): void => {
    store.running.delete(runs);
    /* The host is told whatever this frame draws now, under the session the lookup was asked in:
       it keeps the answer for that session's tab if the session is still the tab's, and drops it
       after a Refresh. */
    if (session !== null) {
      store.onSettled(cacheKey, result, session);
    }
    // Another document, or a Refresh, since it went out: not an answer of what is drawn now.
    if (store.session !== session) {
      return;
    }
    store.settled.set(cacheKey, result);
    store.onChange();
  };
  started.then(
    (value) => settle({ ok: true, value }),
    (error: Error) => settle({ error: failureOf(error), ok: false }),
  );
  store.running.set(runs, started);
  if (wait) {
    /* This frame was waiting for another to fetch this and has been named the fetcher since (the
       artboard that fetched is gone). What asked while it waited is answered by this run. */
    store.waiting.delete(cacheKey);
    started.then(wait.resolve, wait.reject);
  }
  note(store, lookup, { cacheKey });
  store.onChange();
  return started;
}

/** Where the lookup last asked about under one state key stands. */
function askedStatus(store: RemoteStore, asked: Asked | undefined): EntryStatus {
  if (!asked || asked.cacheKey === null) {
    return { status: "not-run" };
  }
  const result = store.settled.get(asked.cacheKey);
  if (!result) {
    return { status: "pending" };
  }
  return result.ok ? { status: "resolved" } : { error: result.error, status: "failed" };
}

/** Whether a state entry is one whose value comes from a remote lookup. */
export function isRemoteEntry(def: JxDocumentValue | undefined): def is JsonObject {
  return isJsonObject(def) && (def.timing === "server" || def.$prototype === "Request");
}

/**
 * Where each remote entry of `state` stands, by state key, for the scope built from it.
 *
 * An entry the runtime never asked about is not run here: a `manual` request waits for a handler
 * the canvas strips. One that is not `manual` was not asked about because what it asks for is not
 * known yet (a URL that reads a value still `undefined`), and where what it reads is itself loading
 * or failed, that is where it stands too: the canvas did not choose to leave it alone, it is held
 * up by something the canvas can name.
 */
export function entryStatuses(
  store: RemoteStore,
  scope: JxScope,
  state: Readonly<Record<string, JxDocumentValue | undefined>> | undefined,
) {
  const asked = store.asked.get(scope);
  const out: Record<string, EntryStatus> = {};
  const unasked: [string, string][] = [];
  for (const [key, def] of Object.entries(state ?? {})) {
    if (!isRemoteEntry(def)) {
      continue;
    }
    const last = asked?.get(key);
    out[key] = askedStatus(store, last);
    if (!last && def.manual !== true) {
      unasked.push([key, JSON.stringify(def)]);
    }
  }
  for (let grew = unasked.length > 0; grew;) {
    grew = false;
    const unresolved = inheritedStatuses(out, state);
    for (const [key, text] of unasked) {
      const held = out[key]?.status === "not-run" ? statusOfText(text, unresolved) : null;
      if (held && held.status !== "not-run") {
        out[key] = held;
        grew = true;
      }
    }
  }
  return out;
}

/** A regular expression's metacharacters, escaped. */
function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Whether `text` reads the state entry `key`: `state.key`, `state["key"]`, or `#/state/key`. */
export function readsStateKey(text: string, key: string): boolean {
  const name = escapeRegExp(key);
  const quoted = escapeRegExp(JSON.stringify(key).slice(1, -1));
  return new RegExp(
    String.raw`(?<![\w$])(?<!(?<!\.\.)\.)state\s*(?:\??\.\s*${name}(?![\w$])|\??\.?\[\s*["']${quoted}["']\s*\])` +
      String.raw`|#/state/${escapeRegExp(key.replaceAll("~", "~0").replaceAll("/", "~1"))}(?![\w$~-])`,
  ).test(text);
}

/** Which of two unresolved states a binding that reads both shows. */
const WEIGHT: Record<BindingState, number> = { failed: 3, "not-run": 1, pending: 2, resolved: 0 };

/**
 * `entries` widened to every state entry that reads an unresolved one, however far: a computed
 * entry over a list that is still loading is still loading.
 */
export function inheritedStatuses(
  entries: Readonly<Record<string, EntryStatus>>,
  state: Readonly<Record<string, JxDocumentValue | undefined>> | undefined,
) {
  const out: Record<string, EntryStatus> = {};
  for (const [key, status] of Object.entries(entries)) {
    if (status.status !== "resolved") {
      out[key] = status;
    }
  }
  const defs = Object.entries(state ?? {})
    .filter(([key]) => !(key in entries))
    .map(([key, def]): [string, string] => [key, def === undefined ? "" : JSON.stringify(def)]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [key, text] of defs) {
      if (key in out) {
        continue;
      }
      const status = statusOfText(text, out);
      if (status) {
        out[key] = status;
        grew = true;
      }
    }
  }
  return out;
}

/** The weightiest unresolved state among the entries `text` reads, or null when it reads none. */
function statusOfText(
  text: string,
  unresolved: Readonly<Record<string, EntryStatus>>,
): EntryStatus | null {
  let found: EntryStatus | null = null;
  for (const [key, status] of Object.entries(unresolved)) {
    if (
      (!found || WEIGHT[status.status] > WEIGHT[found.status]) &&
      text.includes("state") &&
      readsStateKey(text, key)
    ) {
      found = status;
    }
  }
  return found;
}

/** The few words drawn for an unresolved state. */
function noteOf(status: EntryStatus): string {
  if (status.status === "pending") {
    return PENDING_NOTE;
  }
  return status.status === "failed" ? FAILED_NOTE : NOT_RUN_NOTE;
}

/** Write `status` on `el`, or take a stale one off. `words` stands in for the state's own. */
function mark(el: Element, status: EntryStatus | null, words = status ? noteOf(status) : ""): void {
  if (!status || status.status === "resolved") {
    el.removeAttribute(STATUS_ATTR);
    el.removeAttribute(STATUS_NOTE_ATTR);
    return;
  }
  if (el.getAttribute(STATUS_ATTR) !== status.status) {
    el.setAttribute(STATUS_ATTR, status.status);
  }
  if (el.getAttribute(STATUS_NOTE_ATTR) !== words) {
    el.setAttribute(STATUS_NOTE_ATTR, words);
  }
}

/**
 * The document path stamped on the nearest drawn element at or above `el`, or null. An echo row's
 * elements carry the path under another attribute (studio.md §4.5), and a binding drawn in one is
 * drawn in the same document node as the active row's.
 */
function pathAround(el: Element): (string | number)[] | null {
  const drawn = el.closest<HTMLElement>(STAMPED_SELECTOR);
  const text = drawn?.dataset.jxPath ?? drawn?.getAttribute(ECHO_PATH_ATTR);
  if (!text) {
    return null;
  }
  try {
    /* SAFETY: both attributes are written by the frame's stamper alone, as the JSON of a JxPath. */
    return JSON.parse(text) as (string | number)[];
  } catch {
    return null;
  }
}

/** What {@link stampStatuses} needs to know about the drawn document. */
export interface StatusContext {
  /** Each unresolved state entry ({@link inheritedStatuses}). */
  unresolved: Readonly<Record<string, EntryStatus>>;
  /** The document node at a stamped path: what a bound block and a repeater are read from. */
  nodeAt: (path: (string | number)[]) => JxDocumentValue | undefined;
  /**
   * Why an empty chip is empty: the message of what its expression throws against the scope it was
   * drawn with, or null when it evaluates (to nothing) or cannot be asked. Never asked of a chip in
   * a template row.
   */
  failureOf: (chip: Element, source: string) => string | null;
}

/**
 * Mark every chip, bound block and template row under `container` with where its binding stands,
 * and answer the same as a list (studio.md §4.5).
 *
 * A chip is unresolved when its expression reads an unresolved entry, or when it drew nothing
 * because its expression throws, which it says in other words than a lookup that failed
 * ({@link THROWN_NOTE}): nothing was fetched, so "could not load" would send the author to the
 * network for a mistake in the expression. A block is when a property of its own reads one. A
 * template row is when the list it stands in for does: the row is there because the data is not,
 * and it says which of the three reasons that is instead of "No items".
 *
 * A chip in a template row is not asked why it is empty. The row has no item (studio.md §4.5), so
 * every binding that reads one throws by design, and the row's own label already says so.
 */
export function stampStatuses(container: Element, ctx: StatusContext): BindingStatus[] {
  const out: BindingStatus[] = [];
  const any = Object.keys(ctx.unresolved).length > 0;
  for (const chip of container.querySelectorAll(`[${TAG_ATTR}]`)) {
    const ref = chip.getAttribute(TAG_REF_ATTR);
    const source = chip.getAttribute(TAG_ATTR) ?? "";
    let status = any ? statusOfText(ref ?? source, ctx.unresolved) : null;
    let thrown = false;
    // A chip that drew nothing and reads nothing unresolved is asked why: its expression may throw.
    if (
      !status &&
      ref === null &&
      chip.firstElementChild === null &&
      chip.textContent === "" &&
      chip.closest(`[${TEMPLATE_ROW_ATTR}]`) === null
    ) {
      const error = ctx.failureOf(chip, source);
      if (error !== null) {
        status = { error, status: "failed" };
        thrown = true;
      }
    }
    if (thrown) {
      mark(chip, status, THROWN_NOTE);
    } else {
      mark(chip, status);
    }
    // The reason, where a pointer resting on the chip finds it. A chip is never read back as text.
    if (status?.error === undefined) {
      chip.removeAttribute("title");
    } else {
      chip.setAttribute("title", status.error);
    }
    out.push({
      path: pathAround(chip),
      source: ref === null ? source : JSON.stringify({ $ref: ref }),
      ...(status ?? { status: "resolved" }),
    });
  }
  for (const block of container.querySelectorAll(`[${BOUND_FIELD_ATTR}][data-jx-path]`)) {
    const path = pathAround(block);
    const node = path ? ctx.nodeAt(path) : undefined;
    let status: EntryStatus | null = null;
    if (any && isJsonObject(node)) {
      /* The block's own properties. What its children hold is theirs to report, and its text is
         drawn as chips, which carry their own. */
      const { children: _children, map: _map, cases: _cases, textContent: _text, ...own } = node;
      status = statusOfText(JSON.stringify(own), ctx.unresolved);
    }
    mark(block, status);
    if (status && path) {
      out.push({ path, source: block.getAttribute(BOUND_FIELD_ATTR) ?? "", ...status });
    }
  }
  for (const row of container.querySelectorAll(`[${TEMPLATE_ROW_ATTR}]`)) {
    const path = pathAround(row);
    // A row's root is stamped `[…, "map"]`: the repeater is the node above it.
    const repeater = path && path.at(-1) === "map" ? ctx.nodeAt(path.slice(0, -1)) : undefined;
    const items = isJsonObject(repeater) ? repeater.items : undefined;
    const status = any && isRef(items) ? statusOfText(items.$ref, ctx.unresolved) : null;
    mark(row, status);
    if (status && path) {
      out.push({ path: path.slice(0, -1), source: JSON.stringify(items), ...status });
    }
  }
  return out;
}
