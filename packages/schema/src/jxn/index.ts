/**
 * Jx Notation (`.jxn`): a Jx document spelled in KDL 2, with the same data model as `.json`.
 *
 * `spec.md` §22 is the grammar. Keep `@bgotink/kdl` behind this folder, so it remains replaceable.
 */
export { classifyJxn } from "./classify.ts";
export type { JxnKind } from "./classify.ts";
export { JxnError } from "./errors.ts";
export type { JxnSpan } from "./errors.ts";
export { lintJxn } from "./lint.ts";
export type { JxnWarning } from "./lint.ts";
export { parseJxn, parseJxnWithSpans } from "./parse.ts";
export { serializeJxn } from "./serialize.ts";
