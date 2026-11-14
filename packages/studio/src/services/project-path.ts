/**
 * Project-path.ts — the containment check the assistant's file tools run before they touch disk.
 *
 * `ai.md` §4: a file tool refuses a path outside the open project itself, rather than leaving the
 * server to. The check is `@jxsuite/ai/jx-tools`'s, where the portable file tools run it
 * (specs/ai.md §3.14); Studio's own tools that take a path (`create_component`, `create_page`) run
 * the same one through this module, so the two sets of tools cannot disagree about what "inside the
 * project" means.
 *
 * @license MIT
 * @docs studio/ai/chat
 */

export { invalidPathResult, normalizeProjectPath as normalizeRelPath } from "@jxsuite/ai/jx-tools";
