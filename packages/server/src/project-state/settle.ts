/**
 * The usage query's reading of a running host's graph (`specs/project-state.md` §12): the graph
 * answers only once the host is `indexed`, its watcher is not degraded, and it has settled every
 * change it has been told of, so a change the watcher has not delivered yet is never missed. Shared
 * by the desktop session and the dev server, which both run `createProjectStateHost`.
 *
 * @docs studio/desktop
 */

import type { ProjectReferences, ProjectStateHost } from "./host.ts";

/** How long the usage query waits for the host to settle before it walks the tree, in ms. */
export const SETTLE_LIMIT_MS = 2000;

/** How long the host must be quiet before the usage query reads its graph, in ms. */
export const SETTLE_QUIET_MS = 100;

/**
 * The graph's references once `host` has settled, or `null` when it is below `indexed`, its watcher
 * is degraded, or it has not settled within `limitMs`: the caller then walks the tree.
 */
export async function settledReferences(
  host: Pick<ProjectStateHost, "idle" | "references">,
  limitMs: number = SETTLE_LIMIT_MS,
): Promise<ProjectReferences | null> {
  if (host.references() === null) {
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    host.idle(SETTLE_QUIET_MS).then(() => true),
    new Promise<false>((resolveLimit) => {
      timer = setTimeout(resolveLimit, limitMs, false);
    }),
  ]);
  clearTimeout(timer);
  return settled ? host.references() : null;
}
