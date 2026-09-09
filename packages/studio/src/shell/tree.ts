/**
 * The shell's mount tree — the one definition of what the application frame IS.
 *
 * It was `index.html`'s body, and, in drifted copies, the body of twenty-three test files. The copy
 * in `tests/studio-shell-fixture.ts` had lost `#resize-bottom`, `#bottom-dock` and `#layer-toast`,
 * so every shell-boot test ran against a shell with no bottom dock and no toast host — a difference
 * no test could report, because the fixture WAS the thing under test.
 *
 * Nothing here is dynamic: `mountShellTree()` renders once at boot, before `initShellRefs()` adopts
 * the hosts, and each region then renders into its own host through its own effect (see
 * studio-ui-guidelines.md §9.3). It is a lit template rather than a string because that makes the
 * region attributes bindings the tree owns, and because the twenty-three test files can now ask for
 * the real shell instead of describing one.
 */

import { html, render as litRender } from "lit-html";
import type { TemplateResult } from "lit-html";
import { mountShellSurface } from "../surfaces/shell";

/**
 * The four overlay layers that `ui/layers.ts` renders into, in stacking order.
 *
 * Exported apart from {@link shellTree} because it is the piece a unit test usually wants alone
 * (through `mountOverlayLayers` in the test harness) — twenty fixtures were describing this set by
 * hand, and they had already stopped agreeing: most carried three layers and one carried four, so
 * whether a toast host existed at all depended on which test file you happened to be in.
 */
export function overlayLayers(): TemplateResult {
  return html`
    <!-- The four overlay layers, in stacking order. Their z-indices were inline style
       attributes, which put the one piece of ordering the whole overlay system depends on
       outside the reach of check-styles.ts's stacking rule — the check that exists because a
       blocking progress modal once shipped above its own scrim with no reachable exit. They are
       classes in styles/overlays.css now, and the toast host is ABOVE the dialog host because
       an operation started from a dialog reports its outcome to the person still looking at
       it. -->
    <div id="layer-popover" class="jx-layer jx-layer--popover"></div>
    <div id="layer-modal" class="jx-layer jx-layer--modal"></div>
    <div id="layer-dialog" class="jx-layer jx-layer--dialog"></div>
    <!-- role="status" sits on the HOST, so a stack of toasts is announced as one live region
       rather than one region per notification. It carries its region id whether or not a toast
       has ever been raised: a region that only exists once something has gone wrong is one a
       screenshot cannot address and focus cannot be moved into. -->
    <div
      id="layer-toast"
      class="jx-layer jx-layer--toast"
      role="status"
      aria-live="polite"
      data-jx-region="overlay.toasts"
    ></div>
  `;
}

/**
 * Render the frame and the overlay layers into `host`, in that order.
 *
 * `#app` and its cells are `src/surfaces/shell.json`, mounted through the runtime — the frame is a
 * Jx document, which is the whole point of the migration. The four overlay LAYERS are still a lit
 * template, and deliberately: they belong to `ui/layers.ts` rather than to the frame, and they move
 * when that module does. Both land in the theme wrapper, `#app` first, exactly as before.
 *
 * **This is now asynchronous, and every caller must await it.** `store.ts`'s `initShellRefs` reads
 * five of these cells out of the document on the line after the mount, and `ui/panel-resize.ts`
 * reads three more; a mount that has not settled hands each of them a null. The runtime renders one
 * microtask after insertion and waits for the kit to be defined first, so there is no synchronous
 * spelling of this to fall back on.
 *
 * @param host Where the frame goes. Defaults to the document body.
 */
export async function mountShellTree(host: ParentNode = document.body): Promise<void> {
  const theme = themeHost(host);
  /* The same clear-and-eject the lit mount did, for the same two reasons — a fixture that empties
     the host leaves lit's part marker pointing at comment nodes that are gone, and ejecting without
     clearing makes a second mount paint a second frame beside the first — and now for a third: the
     document mount APPENDS, so without this a remount leaves two `#app`s and every `querySelector`
     silently picks the stale one. */
  theme.textContent = "";
  // @ts-expect-error -- _$litPart$ is lit's private render-part marker, not in the DOM types
  delete theme["_$litPart$"];
  await mountShellSurface(theme);
  /* After the frame, so the layers are its siblings in the order they always were. lit's `render`
     manages only the range between its own markers, so appending here leaves `#app` alone. */
  litRender(overlayLayers(), theme);
}

/**
 * The Spectrum theme wrapper, created once and reused.
 *
 * It is NOT part of {@link shellTree}, and the reason is a real constraint rather than taste. lit
 * instantiates a template by cloning it with `importNode`, and cloning a registered custom element
 * enqueues its `attributeChangedCallback` before the constructor body has run — Spectrum's Theme
 * then reaches for a field it assigns in that body and throws. `createElement` runs the constructor
 * first, so the attributes are safe to set afterwards.
 *
 * `shell.ts` rewrites `color` on the first theme effect, so the value here is only the first frame.
 */
function themeHost(host: ParentNode): HTMLElement {
  const existing = host.querySelector?.("sp-theme");
  if (existing) {
    return existing as HTMLElement;
  }
  const theme = document.createElement("sp-theme");
  theme.setAttribute("color", "dark");
  theme.setAttribute("scale", "medium");
  theme.setAttribute("system", "spectrum");
  (host as HTMLElement).append(theme);
  return theme;
}
