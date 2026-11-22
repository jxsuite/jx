/// <reference lib="dom" />
/**
 * The preview realm, from the shell's side (`project-state.md` §11.2, `studio.md` §9.1.2).
 *
 * One realm serves every preview surface: the frame is made on the first request, answers each
 * request with a snapshot (`frame.ts`), and is **replaced** when a definition its registry already
 * holds changes, because a custom-element registry cannot redefine a tag. Replacing it costs the
 * runtime and the definitions the next previews need, loaded once again; it costs no preview the
 * cards already show, since a snapshot outlives the realm that drew it.
 *
 * The frame is `canvas.html` with `?realm=preview`, so every host that serves the canvas serves the
 * realm, at the same origin and with the same dev-proxy token. The channel is the canvas's own
 * (`canvas/iframe-channel.ts`): token- and origin-gated, with a token of the realm's own so a
 * canvas frame and the realm never read each other's messages.
 *
 * @docs studio/interface
 */

import { postMessageChannel } from "../canvas/iframe-channel";
import type { IframeChannel } from "../canvas/iframe-channel";
import { isFunction } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import { PREVIEW_REALM_PARAM, PREVIEW_REALM_VALUE } from "./protocol";
import type { FromRealm, RealmReply, RealmRequest, RealmSnapshot, ToRealm } from "./protocol";

/** What a realm runs over: its channel, and what takes it down. */
export interface RealmTransport {
  readonly channel: IframeChannel<ToRealm, FromRealm>;
  dispose: () => void;
}

/** Makes a realm. The default makes the frame; a test hands an in-process one. */
export type RealmFactory = () => RealmTransport;

/** A snapshot as the shell holds it: the realm's markup, and the sheet its rules are in. */
export interface PreviewSnapshot {
  readonly html: string;
  /** The rules the realm wrote, as a sheet of the shell's; null where sheets cannot be made. */
  readonly sheet: CSSStyleSheet | null;
}

/**
 * One request's answer, as the shell reads it. A `failed` answer with `lost` set is the realm's
 * failure, not the document's: the realm was replaced, did not start, did not answer in time, or
 * none is installed. It says nothing about whether the document renders, so a caller neither
 * remembers it as the document's answer nor reports it as the document's failure.
 */
export type RealmAnswer =
  | { readonly kind: "rendered"; readonly snapshot: PreviewSnapshot }
  | { readonly kind: "trialed" }
  | { readonly kind: "failed"; readonly message: string; readonly lost?: boolean };

/** The shell's handle on the realm. */
export interface PreviewRealmHost {
  /** Ask the realm to draw or try something; never rejects. */
  ask: (request: RealmRequest) => Promise<RealmAnswer>;
  /**
   * Definitions of `tags` changed: replace the realm when its registry holds any of them, since it
   * cannot redefine one. Answers whether it was replaced.
   */
  definitionsChanged: (tags: readonly string[]) => boolean;
  /** Replace the realm whatever it holds; the next request makes a new one. */
  replace: () => void;
  /** The custom element names the realm defines now. */
  tags: () => ReadonlySet<string>;
  /** How many requests are waiting for an answer. */
  inFlight: () => number;
  /**
   * Moves each time a realm is made or let go: a preview that failed in one realm may draw in the
   * next, and one drawn by a realm that was let go may be stale.
   */
  generation: () => number;
}

/** How long a request waits for its answer before it is answered `failed`. */
export const REALM_REQUEST_TIMEOUT_MS = 20_000;

interface Realm {
  readonly transport: RealmTransport;
  readonly ready: Promise<null>;
  readonly pending: Map<number, (answer: RealmAnswer) => void>;
  readonly tags: Set<string>;
  /**
   * Tags whose definitions changed while requests were in flight, before the realm said it holds
   * them: a request in flight may have defined one from the old definition, and its reply is the
   * first the shell hears of it. A reply naming one of these replaces the realm.
   */
  readonly doubted: Set<string>;
  /** The requests that were in flight when {@link doubted} was last added to. */
  readonly doubtedIds: Set<number>;
  /** Whether the realm has said it is ready. */
  started: boolean;
  sheet: CSSStyleSheet | null;
  css: string;
}

/** A sheet of the shell's holding `css`, or null where this window cannot make one. */
function newSheet(): CSSStyleSheet | null {
  return isFunction(globalThis.CSSStyleSheet) ? new CSSStyleSheet() : null;
}

/**
 * Make the shell's handle on a realm.
 *
 * @param factory Makes the realm when the first request needs one.
 * @param timeoutMs How long one request waits for its answer.
 * @param onReplaced Called once a realm is replaced because what it holds is stale, whether at once
 *   or when a reply in flight shows it: every preview that failed is then worth asking again.
 */
export function createPreviewRealmHost(
  factory: RealmFactory,
  timeoutMs: number = REALM_REQUEST_TIMEOUT_MS,
  onReplaced: () => void = () => {},
): PreviewRealmHost {
  let realm: Realm | null = null;
  let generation = 0;
  let nextId = 0;

  /** The snapshot as the shell holds it, its rules in this realm's one sheet. */
  function held(current: Realm, snapshot: RealmSnapshot): PreviewSnapshot {
    if (snapshot.css !== current.css) {
      current.sheet ??= newSheet();
      try {
        current.sheet?.replaceSync(snapshot.css);
        current.css = snapshot.css;
      } catch {
        // A rule this window cannot parse: the previous rules stay, and the next answer tries again.
      }
    }
    return { html: snapshot.html, sheet: current.sheet };
  }

  /** Request `id` is answered: once every doubted request is, the change it doubted is settled. */
  function settleDoubt(current: Realm, id: number): void {
    current.doubtedIds.delete(id);
    if (current.doubtedIds.size === 0) {
      current.doubted.clear();
    }
  }

  function receive(current: Realm, message: FromRealm, ready: (value: null) => void): void {
    if (message.kind === "ready") {
      current.started = true;
      ready(null);
      return;
    }
    for (const tag of message.tags) {
      current.tags.add(tag);
    }
    if (message.tags.some((tag) => current.doubted.has(tag))) {
      // A definition that changed while this realm was drawing reached its registry: it is stale.
      replaceStale(current);
      return;
    }
    settleDoubt(current, message.id);
    const settle = current.pending.get(message.id);
    if (!settle) {
      return;
    }
    current.pending.delete(message.id);
    settle(answerOf(current, message));
  }

  function answerOf(current: Realm, reply: RealmReply): RealmAnswer {
    switch (reply.kind) {
      case "rendered": {
        return { kind: "rendered", snapshot: held(current, reply.snapshot) };
      }
      case "trialed": {
        return { kind: "trialed" };
      }
      default: {
        return { kind: "failed", message: reply.message };
      }
    }
  }

  function open(): Realm {
    const transport = factory();
    generation += 1;
    const { promise: ready, resolve: markReady } = Promise.withResolvers<null>();
    const current: Realm = {
      css: "",
      doubted: new Set(),
      doubtedIds: new Set(),
      pending: new Map(),
      ready,
      sheet: null,
      started: false,
      tags: new Set(),
      transport,
    };
    transport.channel.onMessage((message) => {
      receive(current, message, markReady);
    });
    return current;
  }

  function close(current: Realm, reason: string): void {
    if (realm === current) {
      realm = null;
      generation += 1;
    }
    for (const settle of current.pending.values()) {
      settle({ kind: "failed", lost: true, message: reason });
    }
    current.pending.clear();
    current.transport.dispose();
  }

  /** Let a realm go because a definition it holds is stale, and say so. */
  function replaceStale(current: Realm): void {
    close(current, "the preview realm was replaced");
    onReplaced();
  }

  return {
    ask(request) {
      try {
        realm ??= open();
      } catch (error) {
        return Promise.resolve({ kind: "failed", lost: true, message: errorMessage(error) });
      }
      const current = realm;
      nextId += 1;
      const id = nextId;
      return new Promise<RealmAnswer>((resolve) => {
        const timer = setTimeout(() => {
          if (current.pending.delete(id)) {
            settleDoubt(current, id);
            resolve({ kind: "failed", lost: true, message: "the preview realm did not answer" });
            // A realm that never said it was ready is not coming back; the next request makes another.
            if (!current.started) {
              close(current, "the preview realm did not start");
            }
          }
        }, timeoutMs);
        current.pending.set(id, (answer) => {
          clearTimeout(timer);
          resolve(answer);
        });
        void current.ready.then(() => {
          if (current.pending.has(id)) {
            /* SAFETY: the request is one member of `RealmRequest` with its id added, which is the
               same member of `ToRealm`; spreading a union member keeps its `kind`. */
            current.transport.channel.post({ ...request, id } as ToRealm);
          }
        });
      });
    },
    definitionsChanged(tags) {
      const current = realm;
      if (current === null) {
        return false;
      }
      if (tags.some((tag) => current.tags.has(tag))) {
        replaceStale(current);
        return true;
      }
      /* The realm may be defining one of these for a request it has not answered: it reports a
         tag only in a reply. Remember the change until every request in flight now has answered. */
      if (current.pending.size > 0) {
        for (const tag of tags) {
          current.doubted.add(tag);
        }
        for (const id of current.pending.keys()) {
          current.doubtedIds.add(id);
        }
      }
      return false;
    },
    generation: () => generation,
    inFlight: () => realm?.pending.size ?? 0,
    replace() {
      if (realm !== null) {
        replaceStale(realm);
      }
    },
    tags: () => realm?.tags ?? new Set(),
  };
}

// ─── The frame ───────────────────────────────────────────────────────────────

/** Marks the realm's frame, which `styles/canvas.css` keeps out of sight and out of the way. */
export const PREVIEW_REALM_CLASS = "jx-preview-realm";

/** What {@link frameRealm} needs from the shell. */
export interface FrameRealmOptions {
  /** The canvas document's URL as the platform names it (`iframe-host.ts`). */
  canvasUrl: string;
  /** Where the frame is put; the shell's body. */
  parent: HTMLElement;
}

/**
 * Make the realm as a frame: `canvas.html?realm=preview`, carrying the channel's token and, for a
 * shell served over http(s), the shell's origin, exactly as a canvas frame does.
 */
export function frameRealm({ canvasUrl, parent }: FrameRealmOptions): RealmTransport {
  const doc = parent.ownerDocument;
  const { location } = doc.defaultView ?? globalThis;
  const token = crypto.randomUUID();
  const source = new URL(canvasUrl, location.href);
  const frameOrigin = source.origin;
  source.searchParams.set(PREVIEW_REALM_PARAM, PREVIEW_REALM_VALUE);
  source.searchParams.set("token", token);
  if (location.protocol === "http:" || location.protocol === "https:") {
    source.searchParams.set("parentOrigin", location.origin);
  }
  const frame = doc.createElement("iframe");
  frame.className = PREVIEW_REALM_CLASS;
  frame.title = "Preview realm";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.inert = true;
  frame.src = frameOrigin === location.origin ? `${source.pathname}${source.search}` : source.href;
  parent.append(frame);
  const channel = postMessageChannel<ToRealm, FromRealm>({
    acceptOrigin: frameOrigin,
    source: doc.defaultView ?? window,
    // Read lazily: a frame that navigates swaps its window.
    target: {
      postMessage: (message, targetOrigin) =>
        frame.contentWindow?.postMessage(message, targetOrigin),
    },
    targetOrigin: frameOrigin,
    token,
  });
  return {
    channel,
    dispose() {
      channel.dispose();
      frame.remove();
    },
  };
}
