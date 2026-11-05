/**
 * What a project nested inside a larger repository sees of it.
 *
 * Git answers in two coordinate systems. `status` and `diff --name-only` print paths from the
 * REPOSITORY ROOT whatever the cwd is (porcelain ignores `status.relativePaths`), while `add`,
 * `restore`, `checkout` and the `readFile` Studio pairs them with read paths from the PROJECT ROOT.
 * Handed straight across, a site at `Sites/acme/` asked git to stage
 * `Sites/acme/Sites/acme/pages/index.md`.
 *
 * So every path a backend gives Studio is project-relative, and a project's status and commit cover
 * that project (`desktop.md` §5.1, `studio.md` §22.8). Both backends run these same rules so they
 * cannot disagree about one working tree. At a repository's root the prefix is empty and each of
 * them is the identity.
 *
 * @module
 * @docs extending/embedding/platform-adapter
 */

/** Runs one git command in the project root, resolving stdout and rejecting on a non-zero exit. */
export type GitRunner = (args: string[]) => Promise<string>;

/** `git rev-parse --show-prefix`: the project's folder within its repository, `""` at the root. */
export async function readGitPrefix(run: GitRunner): Promise<string> {
  const out = await run(["rev-parse", "--show-prefix"]);
  // A prefix is empty or ends in `/`, so this can only remove the newline git adds.
  return out.trimEnd();
}

/**
 * A root-relative path git printed, as the project-relative path every other verb reads.
 *
 * A path outside the project stays as git printed it: it has no project-relative spelling the file
 * routes would accept, and a `conflicts` list still has to name it.
 *
 * @param {string} prefix - From {@link readGitPrefix}
 * @param {string} path - Relative to the repository root
 * @returns {string}
 */
export function projectRelativePath(prefix: string, path: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * The `git commit` that publishes THIS project's staged changes and nothing else.
 *
 * Review changes lists only the project, and a commit made from a subfolder still takes the whole
 * index. In a repository of several sites, where each one's changes are staged the first time its
 * Review changes shows them, a plain commit would carry another site's changes under this site's
 * summary. So those stay staged, for the project they belong to:
 *
 * - **At the root**, everything is the project: the index, or every tracked change when nothing is
 *   staged (the route's "staged, else all dirty").
 * - **During a merge** the commit is the merge, which git refuses to split, and which is the
 *   repository's rather than the project's.
 * - **Nothing of the project's staged**: its own tracked changes, never `-a`, which reaches past it.
 * - **Only the project's staged**: the index, exactly.
 * - **Others staged too**: `--only` the project's paths. Those paths are committed from the working
 *   tree rather than the index, so this is reserved for the case that needs it.
 *
 * `--no-renames` because a staged rename's old path has to be committed too, or `--only` would keep
 * it in the tree and turn the rename into a copy; `--no-relative` because `diff.relative` would
 * otherwise hide exactly the paths this is looking for.
 *
 * @param {GitRunner} run - Runs git in the project root
 * @param {string} message - The commit message
 * @returns {Promise<string[]>} The argv to hand git
 */
export async function projectCommitArgs(run: GitRunner, message: string): Promise<string[]> {
  const [prefix, stagedOut, merging] = await Promise.all([
    readGitPrefix(run),
    run(["diff", "--cached", "--name-only", "--no-renames", "--no-relative", "-z"]),
    run(["rev-parse", "--quiet", "--verify", "MERGE_HEAD"]).then(
      () => true,
      () => false,
    ),
  ]);
  const commit = ["commit", "-m", message];
  const staged = stagedOut.split("\0").filter(Boolean);
  if (prefix === "") {
    return staged.length > 0 ? commit : [...commit, "-a"];
  }
  if (merging) {
    return commit;
  }
  const own = staged
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length));
  if (own.length === 0) {
    return [...commit, "--", "."];
  }
  return own.length === staged.length ? commit : [...commit, "--only", "--", ...own];
}
