/**
 * The browser's eraser: `eraseBody` and nothing else, for a host to build into a file of its own
 * beside the runtime and hand to it with `setBodyEraser` or `setBodyEraserLoader` (`spec.md`
 * §23.1). It imports no runtime, so the runtime a page already has is the one that receives it. The
 * stripper is imported, not required: a page loads this whole file only when a body needs it.
 *
 * @docs framework/concepts/functions
 */
import tsBlankSpace from "ts-blank-space";
import { setStripperLoader } from "./core.ts";

setStripperLoader(() => tsBlankSpace);

export { eraseBody } from "./core.ts";
export type { EraseProblem, ErasedBody } from "./core.ts";
