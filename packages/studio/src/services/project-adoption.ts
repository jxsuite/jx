/**
 * Project-adoption.ts — a late-bound slot for opening a freshly created project in this window.
 *
 * The AI `create_project` tool (services/ai-project-tools.ts) needs to run the full project-open
 * flow (`openRecentProject` in studio.ts), but services must not import studio.ts — the entry
 * module imports the services. studio.ts registers the adopter at boot; the tool calls
 * `adoptProject(root)`.
 *
 * @license MIT
 */

import { initProjectRepo } from "../files/files";
import { getPlatform, hasPlatform } from "../platform";
import { beginBatch, endBatch, isBatching } from "../tabs/transact";
import { workspace } from "../workspace/workspace";
import type { Tab } from "../tabs/tab";

let _adopter: ((root: string) => Promise<void>) | null = null;

/** Register the project-open flow (studio.ts boot). */
export function setProjectAdopter(fn: (root: string) => Promise<void>): void {
  _adopter = fn;
}

/**
 * Open the project at `root` in this window via the registered flow.
 *
 * @param {string} root - Absolute project root.
 */
export async function adoptProject(root: string): Promise<void> {
  if (!_adopter) {
    throw new Error(
      "Project adoption is not available in this environment — open the project manually from the welcome screen.",
    );
  }
  await _adopter(root);
}

/** What {@link adoptCreatedProject} observed, so a tool reports the outcome instead of the intent. */
export interface AdoptOutcome {
  /** The workspace is now on this root. False means the project exists but this window is not on it. */
  adopted: boolean;
  /** Why adoption failed, when it threw. Null when it did not (including when it silently did not). */
  error: string | null;
  /**
   * `adopted` is false BY DESIGN: a different project was already showing here, so the open flow
   * below put the new one in a window of its own instead of replacing what this one is showing. Not
   * a failure — a caller that only checks `adopted` would otherwise report a success as one.
   */
  openedElsewhere: boolean;
}

/** The seams {@link adoptCreatedProject} runs through, so each caller keeps the one it already had. */
export interface AdoptCreatedOptions {
  /** The active tab, read AFTER adoption to re-anchor the agent loop's undo batch. */
  getTab: () => Tab | null;
  /** The project-open flow. Defaults to this module's late-bound {@link adoptProject}. */
  adopt?: (root: string) => Promise<void>;
  /** Version-control init. Defaults to `files/files.ts`'s `initProjectRepo`. */
  initRepo?: (root: string) => Promise<boolean>;
}

/**
 * Everything that must happen to a project the moment it exists: version control, then adoption.
 *
 * Extracted because `create_project` and `import_site` are the same act with different backends,
 * and the wizard is a third caller of half of it. Two things it does are easy to leave out, and
 * both were:
 *
 * - **Git init.** `specs/desktop.md` §4.5 is normative — _"On the create path, every source,
 *   including Import and Agent, Studio therefore binds the backend to the new root (`activate`),
 *   reads `gitStatus`, and runs `gitInit`."_ `initProjectRepo` had exactly two call sites, both in
 *   the New Project modal, so a project the ASSISTANT bootstrapped was not a repository and nothing
 *   said so. It runs first because it is what calls `platform.activate(root)`, which the open flow
 *   below needs.
 * - **Verifying.** `openRecentProject` swallows its failures into a status message, so a resolved
 *   promise is not proof of adoption. The caller must be told which of the two happened.
 *
 * The batch dance is the third: the agent loop may hold an undo batch on the pre-adoption tab, and
 * adoption replaces every tab in the workspace. Flush it, adopt, re-open one on whatever tab
 * adoption left active.
 *
 * @param {string} root - Absolute root of the project that was just created.
 * @param {AdoptCreatedOptions} opts
 * @returns {Promise<AdoptOutcome>}
 */
export async function adoptCreatedProject(
  root: string,
  { getTab, adopt = adoptProject, initRepo = initProjectRepo }: AdoptCreatedOptions,
): Promise<AdoptOutcome> {
  // Never fails the create: a project that was written stays written (initProjectRepo notifies).
  await initRepo(root);

  /* `initRepo` ran git init through THIS window's backend — `platform.createProject` re-roots it to
     `root` as a side effect of scaffolding, because git init has no explicit-root variant of its
     own. That is fine when this window is about to show `root` too, but wrong when a DIFFERENT
     project was already showing here: `adopt` below (`openRecentProject`) would open `root` in a
     new window on exactly that condition, and that new-window flow dedupes by asking the backend
     which window already has `root` open — which, thanks to the reroot above, now reads as THIS
     one. Left alone, that either hands `root` back to this same window (skipping the new window
     entirely) or opens a second window while leaving this one's backend silently pointed at `root`
     even though its own UI still names the project it had before. Putting this window's backend
     back where its UI says it is — before `adopt` runs — is what keeps both promises: the window
     that already had a project keeps that project, backend included, and `root` gets a window of
     its own. */
  const platform = hasPlatform() ? getPlatform() : null;
  const shownRoot = workspace.projectRoot;
  const openedElsewhere = Boolean(
    platform && shownRoot && shownRoot !== root && platform.openProjectInNewWindow,
  );
  if (openedElsewhere && shownRoot && platform?.setWindowProject) {
    try {
      await platform.setWindowProject(shownRoot);
    } catch {
      /* Best-effort restore — `adopt` below still runs, and a failed restore here is no worse than
         the mismatch this guards against. */
    }
  }

  const wasBatching = isBatching();
  if (wasBatching) {
    endBatch();
  }
  let adoptionError: string | null = null;
  try {
    await adopt(root);
  } catch (error) {
    adoptionError = error instanceof Error ? error.message : String(error);
  }
  if (wasBatching) {
    beginBatch(getTab());
  }

  return { adopted: workspace.projectRoot === root, error: adoptionError, openedElsewhere };
}
