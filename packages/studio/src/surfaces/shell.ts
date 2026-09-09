/**
 * The shell surface: the application frame as a Jx document.
 *
 * It is the one surface with no scope and no adapter state, because the frame is not a projection
 * of anything — it is the set of HOSTS every other surface mounts into. What it does have is a
 * boot-order contract the others do not: `store.ts`'s `initShellRefs` and `ui/panel-resize.ts` read
 * these cells out of the document by id, so the mount has to be awaited before either runs.
 *
 * The frame's STYLE is not here. It is `styles/shell-frame.css`, generated from
 * `styles/shell-frame.json`, because the frame is what the first paint lays out and an adopted
 * sheet arrives after it (specs/studio-ui-guidelines.md §1.1).
 *
 * @docs studio/interface
 */

import { mountSurface, registerSurface } from "../ui/surface";
import shellDoc from "./shell.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("shell", shellDoc as unknown as JxDocument);

/**
 * Render the frame into `host`, and resolve once its cells exist.
 *
 * @param host Where `#app` goes — the theme wrapper at boot.
 */
export function mountShellSurface(host: HTMLElement): Promise<SurfaceHandle> {
  return mountSurface("shell", {}, host);
}
