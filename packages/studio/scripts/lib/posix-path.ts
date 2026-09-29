/**
 * Posix-path.ts — one place to fix the bug every `Bun.Glob` call site in this package was one
 * Windows machine away from having.
 *
 * `Bun.Glob(...).scan()`/`.scanSync()` returns paths in the HOST's native separator — forward slash
 * on Linux and macOS, backslash on Windows — while every hardcoded path this package compares a scan
 * result against (a ratchet Set, a `.endsWith("/x.json")`) is written with forward slashes, because
 * whoever wrote it was on Linux or macOS and never saw a backslash. A scan result compared or printed
 * without normalizing first silently fails to match on Windows: not an error, just a `Set.has()` or
 * `.endsWith(...)` that is always false.
 *
 * `node:path`'s `relative`/`join`/`resolve` have the same failure mode for the same reason — they
 * use `path.sep`, which is backslash on Windows.
 *
 * A package-local copy rather than importing the repo-root `scripts/lib/posix-path.ts`: this
 * package's own tests and scripts stay inside its coverage workspace, and `packages/desktop`
 * already keeps its own private equivalent (`src/project-session.ts`'s `toPosix`) for the same
 * reason.
 *
 * @license MIT
 */

/** Normalize a path to forward slashes. Idempotent, and a no-op on an already-posix path. */
export function toPosixPath(path: string): string {
  return path.includes("\\") ? path.replaceAll("\\", "/") : path;
}
