/**
 * Source text the docs gates' suites build their fixtures from, shared so two suites that feed the
 * same parser cannot drift apart on what a well-formed input looks like.
 */

/** Built at runtime so no line of a suite is itself a plan citation the real gate would see. */
export const PLAN = "plan:";

/** The header and divider rows of a spec's Standards Alignment table (standards.md §3). */
export const HEADER =
  "| Standard | Class | Binds | Evidence | Note |\n| --- | --- | --- | --- | --- |";
