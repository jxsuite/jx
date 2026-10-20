/**
 * The row a file's grid should land on when it opens: a file-backed collection's record.
 *
 * A collection whose `source` names one file (`./content/projects.csv`) is written in that file's
 * grid, so opening one of its records in the Content home opens the file (`specs/studio.md` §22.5).
 * Opening the whole table and leaving the reader to find the row they clicked is not opening the
 * record, so the opener names the record's position here and the grid selects that row and scrolls
 * it into view once its rows have loaded.
 *
 * Reactive and keyed by the file's path, so a request reaches a grid that is already on screen as
 * well as one still loading: the grid panel's one effect reads it, applies it and takes it.
 *
 * @docs studio/projects/browse
 */

import { reactive } from "../reactivity";

/** File path → the position of the row to reveal, among the file's data rows from 0. */
const pending = reactive(new Map<string, number>());

/** Ask the grid of `path` to reveal the row at `position` (its place among the data rows, from 0). */
export function requestGridReveal(path: string, position: number): void {
  pending.set(path, position);
}

/** The row the grid of `path` is asked to reveal, or `undefined`. Reading it tracks it. */
export function pendingGridReveal(path: string | null | undefined): number | undefined {
  return path ? pending.get(path) : undefined;
}

/** Drop the request for `path` once the grid has acted on it. */
export function clearGridReveal(path: string): void {
  pending.delete(path);
}
