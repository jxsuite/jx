/**
 * Records what a platform adapter passes to the WebSocket constructor when it opens its collab
 * socket. Both adapters are under the same contract — the URL they build and the subprotocol they
 * offer — so both read this rather than each keeping a stub.
 *
 * The socket never answers, so the returned `openDoc` promise never resolves; that is deliberate.
 * The session-level timeout owns fallback, and only the handshake inputs are under test here.
 */

import type { WsCollabConnectionOptions } from "@jxsuite/collab/client";
import type { StudioPlatform } from "../src/types";

/**
 * What one WebSocket constructor call received: both adapters open their socket through
 * `createWsCollabConnection`, which forwards exactly its options' `url` and `protocols`.
 */
export type RecordedSocket = Pick<WsCollabConnectionOptions, "protocols" | "url">;

/**
 * Install a recording WebSocket, ask the platform for a collab handle, and return what it built.
 *
 * @param {() => Pick<StudioPlatform, "collab">} makePlatform
 * @param {number} opens How many `collab()` calls to make (2 proves the socket is multiplexed).
 * @returns {Promise<RecordedSocket[]>}
 */
export async function recordCollabSockets(
  makePlatform: () => Pick<StudioPlatform, "collab">,
  opens = 1,
): Promise<RecordedSocket[]> {
  const seen: RecordedSocket[] = [];
  class RecordingWebSocket {
    binaryType = "";
    readyState = 0;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    sent = 0;
    constructor(url: string, protocols?: string[]) {
      seen.push(protocols === undefined ? { url } : { protocols, url });
    }
    send(): void {
      this.sent += 1;
    }
    close(): void {
      this.sent = -1;
    }
  }
  const realWs = globalThis.WebSocket;
  /* The adapters under test only construct the socket (recorded above), set `binaryType`, read
     `readyState`, assign the four handlers, and call `send` / `close`, so the recorder stands in
     for the global without implementing the rest of the WebSocket interface. */
  Object.assign(globalThis, { WebSocket: RecordingWebSocket });
  try {
    const platform = makePlatform();
    for (let i = 0; i < opens; i++) {
      void platform.collab?.(`pages/${String.fromCodePoint(97 + i)}.md`);
    }
    const deadline = Date.now() + 3000;
    while (seen.length === 0 && Date.now() < deadline) {
      await new Promise((resolveSleep) => {
        setTimeout(resolveSleep, 10);
      });
    }
  } finally {
    globalThis.WebSocket = realWs;
  }
  return seen;
}
