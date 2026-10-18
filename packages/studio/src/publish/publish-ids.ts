/**
 * The Publish workspace's closed vocabularies: its four sub-tabs and its two destinations.
 *
 * A module with no DOM import, for the reason `workspace/workspace-ids.ts` gives: the
 * `publish.open` record names {@link PUBLISH_TABS} as its `args` enum, and
 * `commands/app-commands.ts` loads every record in a bare Bun process for the CI checks.
 * `src/shell.ts` reads the same lists for the session's `shell.publish` record, so there is one
 * copy of each.
 *
 * @docs studio/publish
 */

/** The sub-tabs, in the order the workspace draws them (studio.md §22.8). */
export const PUBLISH_TABS = ["review", "deploys", "branches", "hosting"] as const;

export type PublishTab = (typeof PUBLISH_TABS)[number];

/** What each sub-tab is called. The first is a verb phrase because it is the thing to do. */
export const PUBLISH_TAB_TITLES: Readonly<Record<PublishTab, string>> = {
  branches: "Branches",
  deploys: "Deploys",
  hosting: "Hosting",
  review: "Review changes",
};

/**
 * Where a change set goes: committed to the current branch and shipped (`live`), or committed to a
 * branch of its own and opened as a pull request (`review`).
 */
export const PUBLISH_DESTINATIONS = ["live", "review"] as const;

export type PublishDestination = (typeof PUBLISH_DESTINATIONS)[number];

/** The tab the workspace opens on, and the destination it offers first. */
export const DEFAULT_PUBLISH_TAB: PublishTab = "review";
export const DEFAULT_PUBLISH_DESTINATION: PublishDestination = "live";

const TAB_SET: ReadonlySet<string> = new Set(PUBLISH_TABS);
const DESTINATION_SET: ReadonlySet<string> = new Set(PUBLISH_DESTINATIONS);

/** Whether a value is one of the sub-tabs. A narrowing guard, so a caller needs no cast. */
export function isPublishTab(value: unknown): value is PublishTab {
  return typeof value === "string" && TAB_SET.has(value);
}

/** Whether a value is one of the destinations. */
export function isPublishDestination(value: unknown): value is PublishDestination {
  return typeof value === "string" && DESTINATION_SET.has(value);
}
