/// <reference lib="dom" />
/**
 * On project open, offer to bring the project's `@jxsuite/*` dependencies up to their newest
 * PUBLISHED versions — each package to its own latest, asked of the npm registry.
 *
 * It used to target `VERSION`, the version this Studio build embeds, and bump every `@jxsuite/*`
 * range to `^VERSION` in one move. That was right exactly once: when the whole suite released
 * together, so "the version Studio is" and "the newest version of each package" were the same
 * string. They are not any more — the packages release on their own cadences, and `@jxsuite/parser`
 * being at 1.2.0 while Studio is 2.0.1 is the normal case, not a fault. Targeting the embedded
 * version therefore proposed a version that may never have been published, for a package whose real
 * latest it had not looked at.
 *
 * **Studio's own copies are not involved.** The app resolves `@jxsuite/*` from its own install
 * (that is the hermetic host rule the schema loader enforces), so the project's ranges govern `jx
 * build` and the project's types — not the running app. There is no reason for them to match
 * Studio, and pinning them to it was the residue of an assumption that is no longer true.
 *
 * The registry lookup is `platform.packageVersions()`, the same seam the dependencies editor uses.
 * A host that does not offer it (the cloud session, which manages dependencies server-side) simply
 * gets no prompt: without the registry there is no honest target, and guessing is what this
 * replaced.
 */

import { getPlatform } from "../platform";
import { shouldInstallAutomation } from "../services/automation";
import { layerHost } from "../ui/layers";
import { openJxsuiteUpdateSurface } from "../surfaces/jxsuite-update";
import { showProgressModal } from "../ui/progress-modal";
import { notify } from "../services/notify";
import { isUpgrade } from "./semver";
import type { JxsuiteUpdateSurfaceHandle } from "../surfaces/jxsuite-update";

const JXSUITE_PREFIX = "@jxsuite/";

export interface JxsuiteUpdate {
  name: string;
  /** The range pinned in package.json, e.g. `^1.2.0`. */
  current: string;
  /** THIS package's newest published version — not a suite-wide number. */
  latest: string;
  dev: boolean;
}

/**
 * The project's `@jxsuite/*` dependencies that are behind their own newest published version.
 *
 * Empty when there is nothing to do, when the host cannot reach the registry, or when it offers no
 * lookup at all. Every failure path is empty rather than thrown: this runs on project open, and a
 * registry that is unreachable on a train is not an error the author needs to see.
 */
export async function checkJxsuiteUpdate(): Promise<JxsuiteUpdate[]> {
  const platform = getPlatform();
  if (!platform.packageVersions) {
    return [];
  }
  let reported;
  try {
    reported = await platform.packageVersions();
  } catch {
    return [];
  }
  const outdated: JxsuiteUpdate[] = [];
  for (const p of reported) {
    /*
     * `isUpgrade`, not merely "differs from latest". `packageVersions` reports the registry's answer
     * for every dependency, current ones included, and a project deliberately pinned AHEAD of the
     * registry — a prerelease, or a range bumped before the publish landed — would otherwise be
     * offered a downgrade described as an update.
     */
    if (p.name.startsWith(JXSUITE_PREFIX) && isUpgrade(p.current, p.latest)) {
      outdated.push({ current: p.current, dev: Boolean(p.dev), latest: p.latest, name: p.name });
    }
  }
  return outdated;
}

/**
 * The dismissal is remembered against the exact set of versions declined.
 *
 * It used to be keyed on the single target version, which no longer exists. Keying on the set means
 * a later publish of any one package asks again — which is the behaviour you want from "not now",
 * and the reason this is not keyed on the project alone.
 */
function dismissKey(root: string, outdated: JxsuiteUpdate[]): string {
  const signature = outdated
    .map((p) => `${p.name}@${p.latest}`)
    .toSorted()
    .join(",");
  return `jx:jxsuite-update-dismissed:${root}:${signature}`;
}

function isDismissed(root: string, outdated: JxsuiteUpdate[]): boolean {
  try {
    return localStorage.getItem(dismissKey(root, outdated)) === "1";
  } catch {
    return false;
  }
}

function setDismissed(root: string, outdated: JxsuiteUpdate[]): void {
  try {
    localStorage.setItem(dismissKey(root, outdated), "1");
  } catch {
    /* Ignore storage errors */
  }
}

/** Pin each package to `^<its own latest>` and reinstall, behind a progress modal. */
export async function applyJxsuiteUpdate(outdated: JxsuiteUpdate[]): Promise<void> {
  const platform = getPlatform();
  if (!platform.setPackageVersions || outdated.length === 0) {
    return;
  }
  const progress = showProgressModal({
    status: "Updating @jxsuite packages…",
    title: "Updating dependencies",
  });
  try {
    const result = await platform.setPackageVersions(
      // Per package. One shared `^${target}` for all of them is the bug this module was refactored
      // To remove.
      outdated.map((p) => ({ dev: p.dev, name: p.name, version: `^${p.latest}` })),
    );
    if (result.ok) {
      progress.done();
      notify.success(`Updated ${outdated.length} @jxsuite package(s) to their latest versions.`);
    } else {
      progress.fail(result.log ?? "Update failed");
    }
  } catch (error) {
    progress.fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Put the offer up and wait for an answer.
 *
 * The promise is this module's, not the surface's: the dialog reports three things as callbacks —
 * confirmed, declined, closed — and lets the flow decide what each one means, so `resolve` happens
 * here and taking the dialog down is a consequence of the answer rather than the thing that
 * produces it. `settle` is guarded because both ends arrive: answering closes the dialog, which
 * raises `onClosed` behind it, and a resolved promise must not be re-resolved a tick later.
 *
 * Every path that is not an explicit Update resolves `false`, the platform's own close included — a
 * dialog the reader dismissed with Escape declined the offer just as surely as the Not now button
 * did, and the dismissal key is what makes the difference visible later.
 */
function askToUpdate(outdated: JxsuiteUpdate[]): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const settle = (value: boolean): void => {
      if (answered) {
        return;
      }
      answered = true;
      resolve(value);
    };
    /**
     * Take the dialog down, once.
     *
     * Guarded here rather than trusted to the handle, because closing is what RAISES `onClosed` —
     * so a teardown that re-entered through it would call itself until the stack ran out.
     */
    let closing = false;
    const takeDown = (): void => {
      if (closing) {
        return;
      }
      closing = true;
      handle.close();
    };
    const handle: JxsuiteUpdateSurfaceHandle = openJxsuiteUpdateSurface({
      layer: layerHost("dialog"),
      onCancel: () => {
        takeDown();
      },
      /* Closing too, not only settling: a `close` the flow did not ask for — Escape, or a
         dismissal the platform allows — must ALSO take the document out of the dialog layer, or
         the surface outlives the dialog it drew. `settle` has already answered by then if
         anything did. */
      onClosed: () => {
        settle(false);
        takeDown();
      },
      onConfirm: () => {
        settle(true);
        takeDown();
      },
      // `^<its own latest>`, spelled once: this is the same string `applyJxsuiteUpdate` writes into
      // The manifest, so the row cannot promise a range the install would not produce.
      packages: outdated.map((p) => ({
        current: p.current,
        name: p.name,
        target: `^${p.latest}`,
      })),
    });
  });
}

/**
 * Prompt to update on open. Skips when there is nothing to do or the user already declined this
 * exact set of versions for this project (remembered in localStorage).
 */
export async function maybePromptJxsuiteUpdate(projectRoot: string): Promise<void> {
  // Automation/screenshot runs open projects read-only to drive the canvas — the same rule
  // Ensure-deps.ts states, and for the same reason: confirming here calls `setPackageVersions`,
  // Which rewrites the opened project's package.json.
  //
  // It also has to hold when nobody confirms anything. The offer is a modal `<dialog>`, and a
  // Modal dialog makes the rest of the page inert — so a prompt raised at boot means every
  // Subsequent click in a shot lands on nothing at all. That is not hypothetical: with the
  // Underlay this surface used to paint it put the dialog into the middle of 33 committed
  // Screenshots, including docs/images/hero.png, which is the jxsuite.com marketing hero. The
  // Substrate changed and the hazard did not: inertness is what an underlay was imitating.
  //
  // Correct pins are NOT sufficient on their own. This compares the range's BASE version against
  // The registry's `latest`, not whether the range resolves it — so a project pinned `^1.4.1` is
  // Behind the moment 1.4.2 publishes, and every starter shot would be blocked again by the next
  // Patch release of any @jxsuite package.
  if (shouldInstallAutomation(location.search)) {
    return;
  }
  const platform = getPlatform();
  if (!platform.setPackageVersions) {
    return;
  }
  const outdated = await checkJxsuiteUpdate();
  if (outdated.length === 0 || isDismissed(projectRoot, outdated)) {
    return;
  }
  const confirmed = await askToUpdate(outdated);
  if (!confirmed) {
    setDismissed(projectRoot, outdated);
    return;
  }
  await applyJxsuiteUpdate(outdated);
}
