/// <reference lib="dom" />
/**
 * One way to put a surface DOCUMENT in the popover layer.
 *
 * `renderPopover` is the lit answer to the same question: it takes a template, appends an anonymous
 * slot and hands back a handle. A document cannot use it — a document CLEARS the host it is given
 * and lit renders BESIDE foreign nodes, so the two can never share a container — and every
 * converted panel would otherwise re-derive the same six steps: take a named slot, mount, wait for
 * the element's own `jx-ready`, show the platform popover, listen for its `toggle`, and tear the
 * slot down once. Three of the grid's surfaces needed exactly that on the same day, which is what
 * made it a module rather than a paragraph copied three times.
 *
 * **The panel is a `jx-popover`, so the PLATFORM owns dismissal.** Light dismissal, Escape, the top
 * layer and focus restoration to the invoker are the popover's own contract; nothing here binds a
 * document listener, and `dismissOnOutsideClick` — which the lit helper had to implement, and had
 * to un-arm again to stop a corpse closing its successor — has no counterpart because there is
 * nothing to arm.
 *
 * **Each panel owns its own slot, and that is not a detail.** A NAMED slot (`getLayerSlot`) is
 * reused while it is still parented, and the platform's own stacking is what makes that fatal:
 * showing a second `popover=auto` hides the first, the first's `toggle` runs its teardown, and the
 * teardown clears a slot the second is already mounted in — so the panel that just opened
 * disappears and nothing reports an error. A slot created here and removed here can only ever take
 * its own panel down with it. The region id is still `overlay.<kind>:<id>`, so the surface stays
 * addressable by name.
 *
 * @docs extending/ui-kit
 */

import { layerHost } from "./layers";
import { overlayRegion, REGION_ATTR } from "./regions";
import { mountSurface } from "./surface";
import type { JxMountOptions } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "./surface";

/** A popover panel element, as the platform's popover API sees it. */
type PanelElement = HTMLElement & {
  open?: boolean;
  showPopover: (options?: { source?: Element }) => void;
  hidePopover: () => void;
};

export interface PopoverSurfaceHandle {
  /** The named layer slot, which is what carries the `overlay.<kind>:<id>` region. */
  readonly host: HTMLElement;
  /** Settles once the document is mounted and the panel shown, or it was closed first. */
  readonly ready: Promise<void>;
  /** Whether the panel is still up. */
  readonly isOpen: () => boolean;
  /** Close it now. Idempotent, and it does not call `onDismissed`. */
  readonly close: () => void;
}

export interface OpenPopoverSurfaceOptions {
  /** The registered surface name — its document's root must be a `jx-popover`. */
  name: string;
  /** The panel's instance name; its region becomes `overlay.<kind>:<id>`. */
  slot: string;
  /** The reactive scope the document reads. */
  scope: Record<string, unknown>;
  /**
   * The control it was opened from. It becomes the popover's invoker, so a press on that control
   * does not light-dismiss the panel its own click is about to toggle, and focus goes back to it.
   */
  anchor?: HTMLElement | null;
  /** The platform closed it — clicked outside, Escape, or a second press on the invoker. */
  onDismissed?: () => void;
  /**
   * A node the document made exists. The one seam an island reaches its host through (§9.4), passed
   * straight to the runtime.
   */
  onNodeCreated?: JxMountOptions["onNodeCreated"];
}

/**
 * Mount a surface document into a named popover slot and show it.
 *
 * @param {OpenPopoverSurfaceOptions} options
 * @returns {PopoverSurfaceHandle}
 */
export function openPopoverSurface(options: OpenPopoverSurfaceOptions): PopoverSurfaceHandle {
  const { anchor, name, scope, slot: slotId } = options;
  const host = document.createElement("div");
  host.style.pointerEvents = "auto";
  host.setAttribute(REGION_ATTR, overlayRegion("popover", slotId));
  layerHost("popover").append(host);
  const controller = new AbortController();
  let panel: PanelElement | null = null;
  let mounted: SurfaceHandle | null = null;
  let closed = false;

  const finish = (fromPlatform: boolean): void => {
    if (closed) {
      return;
    }
    closed = true;
    controller.abort();
    mounted?.dispose();
    mounted = null;
    host.remove();
    if (fromPlatform) {
      options.onDismissed?.();
    }
  };

  const ready = (async () => {
    const surface = await mountSurface(name, scope, host, {
      signal: controller.signal,
      ...(options.onNodeCreated ? { onNodeCreated: options.onNodeCreated } : {}),
    });
    if (controller.signal.aborted) {
      return;
    }
    mounted = surface;
    panel = surface.root as PanelElement;
    panel.addEventListener("toggle", (event) => {
      if ((event as { newState?: string }).newState === "closed") {
        finish(true);
      }
    });
    /* A custom element connects asynchronously: `jx-ready` is the panel saying its `popover`
       attribute is on and it may be shown. Showing before that is a silent no-op — the panel is
       built, correctly styled, and never in the top layer. */
    if (!panel.hasAttribute("popover")) {
      await new Promise<void>((resolve) => {
        panel?.addEventListener("jx-ready", () => resolve(), { once: true });
      });
    }
    if (controller.signal.aborted) {
      return;
    }
    panel.showPopover(anchor ? { source: anchor } : undefined);
  })();

  return {
    close: () => {
      if (closed) {
        return;
      }
      if (panel?.open) {
        panel.hidePopover();
      }
      finish(false);
    },
    host,
    isOpen: () => !closed,
    ready,
  };
}
