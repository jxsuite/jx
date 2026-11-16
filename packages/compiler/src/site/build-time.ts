/**
 * The build's own timestamp, for the few generated files that have no date of their own to report.
 *
 * Follows the reproducible-builds convention: when `SOURCE_DATE_EPOCH` is set the build time is
 * that instant and the clock is never read, so rebuilding one commit writes the same bytes.
 * Otherwise it is the clock at the moment the build asks. The one exception is a
 * scheduled-publishing rule's `$now`, which is deliberately the real clock (site-architecture.md
 * §7.6).
 */

/** `SOURCE_DATE_EPOCH` is a decimal count of seconds since the Unix epoch, and nothing else. */
const EPOCH_SECONDS = /^\d+$/;

/** A build instant as RFC 3339 at second precision in UTC, the shape a feed's `<updated>` takes. */
export function formatBuildTime(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The build's timestamp.
 *
 * @param {Readonly<Record<string, string | undefined>>} env The environment to read
 *   `SOURCE_DATE_EPOCH` from.
 * @param {() => Date} clock Read only when `SOURCE_DATE_EPOCH` is unset.
 * @returns {string} RFC 3339, UTC, second precision.
 * @throws {RangeError} When `SOURCE_DATE_EPOCH` is set but is not a non-negative integer number of
 *   seconds. The convention says to fail rather than guess, because a value silently replaced by
 *   the clock would make a build that was asked to be reproducible quietly not be.
 */
export function resolveBuildTime(
  env: Readonly<Record<string, string | undefined>>,
  clock: () => Date = () => new Date(),
): string {
  const raw = env.SOURCE_DATE_EPOCH;
  if (raw === undefined || raw === "") {
    return formatBuildTime(clock());
  }
  const instant = new Date(Number(raw) * 1000);
  if (!EPOCH_SECONDS.test(raw) || Number.isNaN(instant.getTime())) {
    throw new RangeError(
      `SOURCE_DATE_EPOCH must be a non-negative integer number of seconds, got "${raw}"`,
    );
  }
  return formatBuildTime(instant);
}
