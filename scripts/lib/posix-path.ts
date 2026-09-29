/**
 * Posix-path.ts — one place to fix the bug every `Bun.Glob` call site was one Windows machine away
 * from having.
 *
 * `Bun.Glob(...).scan()`/`.scanSync()` returns paths in the HOST's native separator — forward slash
 * on Linux and macOS, backslash on Windows — while every git command, every `code:`/`spec:`
 * frontmatter value, and every hardcoded ratchet Set in this repo is written with forward slashes,
 * because the person who wrote it was on Linux or macOS and never saw a backslash. A scan result
 * compared or printed without normalizing first silently fails to match on Windows: not an error,
 * just a `Set.has()` or `.endsWith("/x.md")` that is always false, or a report that prints
 * `src\panels\x.ts` where a reader (and every downstream string match) expects `src/panels/x.ts`.
 *
 * `readdirSync`/`path.join` recursion has the same failure mode for the same reason: `path.join`
 * uses `path.sep`, which is backslash on Windows.
 *
 * @license MIT
 */

/** Normalize a path to forward slashes. Idempotent, and a no-op on an already-posix path. */
export function toPosixPath(path: string): string {
  return path.includes("\\") ? path.replaceAll("\\", "/") : path;
}
