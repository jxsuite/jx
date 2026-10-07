/**
 * A project folder in its one canonical spelling: slash-separated, no leading, trailing or doubled
 * slashes, `""` for the repository root. Null for a path that climbs (`..`) or names itself (`.`),
 * which no project location can be.
 *
 * Canonical because the folder is part of a cloud project's IDENTITY — the root key Recent stores,
 * the editor URL, and the session the backend keys a working tree on — so `sites/a/` and `/sites/a`
 * must not become two projects, two Recent rows and two sessions over the same files. The cloud
 * adapter spells the grammar on the wire with this function, and Open Project's folder field checks
 * what the reader typed with it, so the field can never accept a folder the adapter would refuse.
 *
 * @param dir - The folder as typed, listed or parsed
 * @returns The canonical folder, or null when it is not one
 */
export function normalizeProjectDir(dir: string): string | null {
  const segments = dir
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== "");
  return segments.some((segment) => segment === "." || segment === "..")
    ? null
    : segments.join("/");
}
