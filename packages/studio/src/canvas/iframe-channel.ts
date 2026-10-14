/// <reference lib="dom" />
/**
 * IframeChannel — the typed message boundary between the editor (parent) and the canvas iframe.
 *
 * Per the migration's cross-origin bridge decision, the parent never touches the iframe's
 * `contentDocument`; everything (render commands, patches, geometry, selection, hit-tests) crosses
 * as serializable messages through this one interface. Phases 1+ instantiate it with concrete
 * message unions (`ParentToIframe`/`IframeToParent`); this module owns only the transport contract
 * plus an in-memory `fakeChannelPair` so cross-frame logic is unit-testable without a live iframe.
 */

import { isNonNullObject } from "@jxsuite/schema/guards";

/**
 * A typed, bidirectional message channel. `TOut` is what this side sends; `TIn` is what it
 * receives. Implementations: a real `postMessage` channel over an `<iframe>` (added with the iframe
 * host), and {@link fakeChannelPair} for tests.
 */
export interface IframeChannel<TOut, TIn> {
  /** Send a message to the other side. */
  post: (message: TOut) => void;
  /** Subscribe to messages from the other side. Returns an unsubscribe function. */
  onMessage: (handler: (message: TIn) => void) => () => void;
  /** Detach all handlers and release the transport. */
  dispose: () => void;
}

/** Envelope key that tags every cross-frame message so foreign `message` events are ignored. */
const ENVELOPE = "jx:canvas";

/** What crosses the frame boundary: the session token beside the typed message it authenticates. */
export interface CanvasEnvelope<T> {
  [ENVELOPE]: string;
  payload: T;
}

interface PostMessageTarget<TOut> {
  postMessage: (message: CanvasEnvelope<TOut>, targetOrigin: string) => void;
}

interface MessageSource {
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
}

/**
 * A real `IframeChannel` over `window.postMessage`. Outbound messages are wrapped in an envelope
 * tagged with a shared `token`; inbound messages are dropped unless their `event.origin` matches
 * `acceptOrigin` (pass `"*"` to skip the origin check) AND they carry the same token. This is the
 * origin + secret-token authentication that keeps other local pages from driving the canvas.
 *
 * Parent side: `target` = the iframe's `contentWindow`, `source` = `window`, origins = the iframe
 * origin. Iframe side: `target` = `window.parent`, `source` = `window`, origins = the editor
 * origin.
 */
export function postMessageChannel<TOut, TIn>(opts: {
  target: PostMessageTarget<TOut>;
  source: MessageSource;
  targetOrigin: string;
  acceptOrigin: string;
  token: string;
}): IframeChannel<TOut, TIn> {
  const { target, source, targetOrigin, acceptOrigin, token } = opts;
  const handlers = new Set<(message: TIn) => void>();

  const listener = (event: MessageEvent) => {
    if (acceptOrigin !== "*" && event.origin !== acceptOrigin) {
      return;
    }
    const envelope: unknown = event.data;
    if (!isNonNullObject(envelope) || !(ENVELOPE in envelope) || envelope[ENVELOPE] !== token) {
      return;
    }
    /* SAFETY: The envelope carries this session's secret token, which only the peer channel holds,
       and that peer's `post` is typed to send exactly `TIn`; a foreign page cannot forge the token. */
    const payload = ("payload" in envelope ? envelope.payload : undefined) as TIn;
    for (const handler of handlers) {
      handler(payload);
    }
  };
  source.addEventListener("message", listener);

  return {
    dispose() {
      handlers.clear();
      source.removeEventListener("message", listener);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    post(message) {
      target.postMessage({ [ENVELOPE]: token, payload: message }, targetOrigin);
    },
  };
}

/** Both ends of an in-memory channel, and the controls that deliver what they posted. */
export interface FakeChannelPair<ParentOut, IframeOut> {
  parent: IframeChannel<ParentOut, IframeOut>;
  iframe: IframeChannel<IframeOut, ParentOut>;
  flush: () => void;
  /** Number of messages waiting to be delivered (both directions). */
  pending: () => number;
}

/**
 * Two in-memory channels wired to each other for tests. A message `parent.post(x)` is delivered to
 * the `iframe` side's handlers (and vice versa) only when `flush()` is called — so tests drive the
 * inherently-async postMessage ordering deterministically. Messages posted _during_ a flush are
 * queued for the next flush, never delivered re-entrantly.
 */
export function fakeChannelPair<ParentOut, IframeOut>(): FakeChannelPair<ParentOut, IframeOut> {
  let toIframe: ParentOut[] = [];
  let toParent: IframeOut[] = [];
  const iframeHandlers = new Set<(m: ParentOut) => void>();
  const parentHandlers = new Set<(m: IframeOut) => void>();

  const parent: IframeChannel<ParentOut, IframeOut> = {
    dispose() {
      parentHandlers.clear();
    },
    onMessage(handler) {
      parentHandlers.add(handler);
      return () => parentHandlers.delete(handler);
    },
    post(message) {
      toIframe.push(message);
    },
  };

  const iframe: IframeChannel<IframeOut, ParentOut> = {
    dispose() {
      iframeHandlers.clear();
    },
    onMessage(handler) {
      iframeHandlers.add(handler);
      return () => iframeHandlers.delete(handler);
    },
    post(message) {
      toParent.push(message);
    },
  };

  function flush() {
    const forIframe = toIframe;
    const forParent = toParent;
    toIframe = [];
    toParent = [];
    for (const message of forIframe) {
      for (const handler of iframeHandlers) {
        handler(message);
      }
    }
    for (const message of forParent) {
      for (const handler of parentHandlers) {
        handler(message);
      }
    }
  }

  return {
    flush,
    iframe,
    parent,
    pending: () => toIframe.length + toParent.length,
  };
}
