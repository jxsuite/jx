/**
 * The canvas's eraser for TypeScript function bodies (`spec.md` §23.1), as its own chunk: it
 * carries a compiler, so the frame fetches it only when a document it renders has a body that needs
 * it.
 *
 * @docs framework/concepts/functions
 */
import type { BodyEraserModule } from "@jxsuite/runtime";

/** Fetch `@jxsuite/erase/browser`. Handed to `setBodyEraserLoader`, which runs it at most once. */
export function loadBodyEraser(): Promise<BodyEraserModule> {
  return import("@jxsuite/erase/browser");
}
