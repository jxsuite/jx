/**
 * The browser's eraser: `eraseBody` and nothing else, for a host to build into a file of its own
 * beside the runtime and hand to it with `setBodyEraser` or `setBodyEraserLoader` (`spec.md`
 * §23.1). It imports no runtime, so the runtime a page already has is the one that receives it.
 *
 * @docs framework/concepts/functions
 */
export { eraseBody } from "./index.ts";
export type { EraseProblem, ErasedBody } from "./index.ts";
