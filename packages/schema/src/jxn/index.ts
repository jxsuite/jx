/**
 * Jx Notation (`.jxn`): a Jx document spelled in KDL 2, with the same data model as `.json`.
 *
 * `spec.md` §22 is the grammar. Keep `@bgotink/kdl` behind this folder, so it remains replaceable.
 *
 * @docs framework/concepts/jxn-files
 */
export { classifyJxn } from "./classify.ts";
export { isJxnPath, isNativeDocumentPath, parseNativeDocument } from "./document.ts";
export type { JxnKind } from "./classify.ts";
export { JxnError } from "./errors.ts";
export type { JxnSpan } from "./errors.ts";
export { countJxnComments, lintJxn } from "./lint.ts";
export type { JxnWarning } from "./lint.ts";
export { kdlProblem, parseJxn, parseJxnWithSpans } from "./parse.ts";
export { reconcileJxn } from "./reconcile.ts";
export type { JxnReader, JxnReading } from "./reconcile.ts";
export { serializeJxn } from "./serialize.ts";
export { parseProject, parseProjectWithSpans, serializeProject } from "./project.ts";
