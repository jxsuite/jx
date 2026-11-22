/**
 * An in-process preview realm for tests (`src/preview-realm/`, `project-state.md` §11.2).
 *
 * A frame cannot load `canvas.html` under happy-dom, so a suite whose surfaces ask for previews
 * runs the realm's own code (`startPreviewRealm`) in the test's window instead, over a channel that
 * clones every message as `postMessage` does and delivers it on a later microtask. The realm is the
 * real one; only the frame around it is missing.
 */
import { startPreviewRealm } from "../src/preview-realm/frame";
import type { SettleFn } from "../src/preview-realm/frame";
import type { RealmFactory, RealmTransport } from "../src/preview-realm/host";
import type { FromRealm, ToRealm } from "../src/preview-realm/protocol";
import type { IframeChannel } from "../src/canvas/iframe-channel";

/** The two ends of a {@link linkedChannels} pair. */
export interface LinkedChannels {
  shell: IframeChannel<ToRealm, FromRealm>;
  realm: IframeChannel<FromRealm, ToRealm>;
  /** Every message the shell sent, in order. */
  sent: ToRealm[];
}

/** Two channel ends wired to each other, each delivering a clone on a later microtask. */
export function linkedChannels(): LinkedChannels {
  const toRealm = new Set<(message: ToRealm) => void>();
  const toShell = new Set<(message: FromRealm) => void>();
  const sent: ToRealm[] = [];
  const deliver = <T>(handlers: Set<(message: T) => void>, message: T) => {
    const copy = structuredClone(message);
    queueMicrotask(() => {
      for (const handler of handlers) {
        handler(copy);
      }
    });
  };
  return {
    realm: {
      dispose: () => toRealm.clear(),
      onMessage(handler) {
        toRealm.add(handler);
        return () => toRealm.delete(handler);
      },
      post: (message) => deliver(toShell, message),
    },
    sent,
    shell: {
      dispose: () => toShell.clear(),
      onMessage(handler) {
        toShell.add(handler);
        return () => toShell.delete(handler);
      },
      post(message) {
        sent.push(message);
        deliver(toRealm, message);
      },
    },
  };
}

/** A tree is read after one macrotask: enough for a component's own render in happy-dom. */
export const quickSettle: SettleFn = async () => {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
};

/** What one in-process realm made: its transport, and the messages the shell sent it. */
export interface InProcessRealm extends RealmTransport {
  readonly sent: ToRealm[];
  disposed: boolean;
}

/**
 * Make in-process realms. Every realm made is pushed onto `made`, so a test can see how many the
 * shell asked for and what it sent each one.
 */
export function inProcessRealm(
  options: { settle?: SettleFn; made?: InProcessRealm[] } = {},
): RealmFactory {
  return () => {
    const { realm, sent, shell } = linkedChannels();
    const stop = startPreviewRealm({
      channel: realm,
      document,
      registry: customElements,
      settle: options.settle ?? quickSettle,
    });
    const made: InProcessRealm = {
      channel: shell,
      dispose() {
        made.disposed = true;
        stop();
        realm.dispose();
        shell.dispose();
      },
      disposed: false,
      sent,
    };
    options.made?.push(made);
    return made;
  };
}
