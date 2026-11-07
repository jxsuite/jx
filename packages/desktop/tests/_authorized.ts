/** Stand in for the hub's gate, in a test that is about something else. */
import type { AuthorizedRoot } from "../src/backend/roots";

/**
 * Mark a folder as one the user has answered for. A test may; the application's only source is the
 * hub's gate.
 *
 * @param root The folder.
 */
export function authorized(root: string): AuthorizedRoot;
export function authorized(root: string | null): AuthorizedRoot | null;
export function authorized(root: string | null): AuthorizedRoot | null {
  // SAFETY: a test's own scratch directory, which nothing but the test will run.
  return root as AuthorizedRoot | null;
}
