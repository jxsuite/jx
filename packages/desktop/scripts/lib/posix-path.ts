/**
 * Posix-path.ts — one place to fix the bug every `Bun.Glob` call site in this package's build
 * scripts was one Windows machine away from having.
 *
 * `Bun.Glob(...).scan()`/`.scanSync()` returns paths in the HOST's native separator — forward slash
 * on Linux and macOS, backslash on Windows — while a joined artifact URL or a printed filename is
 * meant to read the same on every OS. `src/project-session.ts` keeps its own private equivalent
 * (`toPosix`/`relPosix`, guarded by `tests/posix-paths.test.ts`) for the runtime session; this is the
 * same fix for this package's `scripts/**`, which is a separate concern (build tooling, not the
 * studio-facing session) and does not import from `src/`.
 *
 * @license MIT
 */

/** Normalize a path to forward slashes. Idempotent, and a no-op on an already-posix path. */
export function toPosixPath(path: string): string {
  return path.includes("\\") ? path.replaceAll("\\", "/") : path;
}
