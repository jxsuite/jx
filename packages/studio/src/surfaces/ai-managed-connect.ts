/// <reference lib="dom" />
/**
 * The keyless "Connect Cloudflare" offer, as a mounted document.
 *
 * `ui/ai-managed-connect.ts` is the flow — it decides whether a managed platform can broker Workers
 * AI at all, what a finished OAuth round trip meant, and which words a fresh grant and a lapsed one
 * get — and this is the surface it draws into.
 *
 * **The host element belongs to this module, not to the gate.** Every credentials gate is still a
 * lit template that interpolates the offer beside the key form, so there is no container in the
 * host to mount into and no way to make one without editing three surfaces this conversion does not
 * own. So the surface carries its own: one `<div>` per controller, mounted once and handed to lit
 * as a child value. lit inserts a Node it is given rather than cloning it, and re-inserting the
 * same node is a no-op, so the document survives every repaint of the gate around it — and when the
 * offer is withdrawn lit merely `remove()`s the node, which leaves the mount inside it intact for
 * the next time it is offered.
 *
 * The host is `display: contents` for the same reason: the gates lay their children out in a flex
 * column (`.prefs-assistant` centres them, `.new-project-creds` stretches them), and a wrapper box
 * would become the flex item in the document root's place and take the `width: 100%` below it with
 * it.
 *
 * @docs studio/ai
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import connectDoc from "./ai-managed-connect.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("ai-managed-connect", connectDoc as unknown as JxDocument);

/** What the offer says right now. Every field is the flow's wording, never a state it derives. */
export interface ManagedConnectView {
  /** The recommendation, or the explanation a lapsed grant gets instead. */
  intro: string;
  /** What the button reads — including while it is working. */
  buttonLabel: string;
  /** A flow already in flight: the button says so and refuses a second one. */
  busy: boolean;
  /** Why the last attempt did not finish. Empty draws nothing. */
  error: string;
}

/** The one thing the reader can do here. */
export interface ManagedConnectActions {
  /** Run the hosted OAuth flow. Read once, when the surface is created. */
  connect: () => void;
}

export interface ManagedConnectSurface {
  /** The element the document lives in — handed to a gate's lit template as a child value. */
  readonly host: HTMLElement;
  /** Bring the standing surface up to date, remounting only if its root has been taken away. */
  update: (view: ManagedConnectView) => void;
}

/** What the document discriminates on, derived here so the flow never has to spell it. */
interface ManagedConnectFlags {
  /** Whether there is a refusal to draw. The `$switch` reads it, so `true` names the case. */
  hasError: boolean;
}

interface ManagedConnectScope
  extends Record<string, unknown>, ManagedConnectView, ManagedConnectActions, ManagedConnectFlags {}

/** The view plus the flag the document switches on. */
function derive(view: ManagedConnectView): ManagedConnectView & ManagedConnectFlags {
  return { ...view, hasError: view.error !== "" };
}

/**
 * Create the offer's surface, mounted into a host of its own.
 *
 * There is no teardown, deliberately: a controller lives as long as the gate that made it, and the
 * host it owns is the thing lit takes in and out of the page. Withdrawing the offer is a `remove()`
 * of that node, which leaves the document inside it intact and ready to be inserted again.
 *
 * @param {ManagedConnectView} view What the offer says to begin with.
 * @param {ManagedConnectActions} actions What the button does.
 * @returns {ManagedConnectSurface}
 */
export function createManagedConnectSurface(
  view: ManagedConnectView,
  actions: ManagedConnectActions,
): ManagedConnectSurface {
  const host = document.createElement("div");
  host.style.display = "contents";
  const scope = reactive({ ...derive(view), ...actions }) as ManagedConnectScope;

  /** `null` while a mount is in flight — which is a standing surface, not a missing one. */
  let handle: SurfaceHandle | null = null;
  let mounting = false;

  function mount(): void {
    mounting = true;
    void mountSurface("ai-managed-connect", scope, host).then((mounted) => {
      mounting = false;
      handle = mounted;
    });
  }

  mount();

  return {
    host,
    update(next) {
      Object.assign(scope, derive(next));
      /* A standing mount is only ASSIGNED to: rebuilding it on every repaint of the gate around it
         would take the button out from under a reader mid-press. The remount below answers the one
         case assignment cannot — a host the document has been taken out of — and it cannot fire
         while a mount is in flight, because a record with no handle yet IS the standing one. */
      if (mounting || (handle !== null && host.contains(handle.root))) {
        return;
      }
      handle?.dispose();
      handle = null;
      host.textContent = "";
      mount();
    },
  };
}
