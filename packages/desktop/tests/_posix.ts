/**
 * Spell a path the way a POSIX host does, so a test can state the paths it expects once.
 *
 * `node:path` answers in the host's own syntax: on Windows `resolve("/cwd", "site")` is
 * `C:\cwd\site`. What these tests are about is which directory is chosen, not how the OS spells it,
 * so the answer is compared after the drive and the separators are normalized.
 */
export function posix(path: string): string {
  return path.replace(/^[A-Za-z]:/, "").replaceAll("\\", "/");
}
