/**
 * An instant as the calendar day it is where Studio runs.
 *
 * A file's modification time, an upload's, "today": each is an instant, and the day a reader means
 * by it is their own. `toISOString().slice(0, 10)` answers in UTC, so a file saved at 9 pm in
 * Denver was listed as edited tomorrow. A date the author WROTE (`2026-06-03`) is not an instant
 * and never goes through here: it is taken as written (`content/entry-summaries.ts` `entryDay`).
 */

/** `date` as `YYYY-MM-DD` in the local time zone, or "" for an invalid date. */
export function localDay(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}
