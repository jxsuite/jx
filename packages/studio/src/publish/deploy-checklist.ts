/// <reference lib="dom" />
/**
 * Deploy-checklist.ts — what is MISSING before this project can ship, as an ordered list.
 *
 * What this replaces: a Cloudflare form that opened asking for a GitHub owner and repository on a
 * project that had never been `git init`-ed, failed with a Cloudflare API error naming neither
 * fact, and offered no way forward. Publishing is a CHAIN — the repository exists, it has a remote
 * and the remote is current, a provider is connected, a deployment happened — and every link is a
 * different command owned by a different module. Nothing in Studio held the chain, so no surface
 * could say which link was missing.
 *
 * This module is the chain (plan §9.5):
 *
 * - {@link deployChecklist} is the ordered prerequisite list, each step carrying **the command that
 *   satisfies it** rather than a sentence telling the reader to go and find one;
 * - {@link deployChecklistView} is its projection and {@link syncDeployChecklist} mounts the document
 *   that draws it (`surfaces/panel-deploy-checklist.json`), in the Bottom dock's **Activity** tab
 *   because a deploy is a long operation with a log and the dock cap is four (§2 principle 9). It
 *   draws in the Activity tab's vocabulary — the same row, the same ordered steps, the same glyphs
 *   — for the same reason: a fifth visual idiom for "an ordered list of stages that finish" would
 *   be a second design of a thing the tab already has;
 * - {@link deployStatusItem} is the status bar's project-field item, whose **label is the next
 *   blocking prerequisite** — the shortcut and the explanation in one 24px item, and ambient state
 *   rather than a transient message, which is the only thing that bar carries (§3.2 ⑫).
 *
 * **A step it cannot answer says `unknown`.** `services/references.ts` established the rule and it
 * matters more here: "no deployment" and "we have not asked Cloudflare" look identical from inside
 * the app, and a checklist that renders the second as the first tells the user to redo a deploy
 * that already succeeded. The observation cache ({@link noteDeployment}) is written by the code
 * that actually asked — the Publish panel's load and {@link import("./publish-commands").runDeploy}
 * — and by nothing else.
 *
 * **No secret reaches this module.** A provider is connected or it is not; the token that proves it
 * is read by `platforms/devserver.ts` on its way to the same-origin proxy and by nothing that
 * renders (`studio.md` §15 rule 1).
 */

import { activeRegistry } from "../commands/active-registry";
import { platformSupportsPublish } from "./pages-service";
import { projectState } from "../store";
import { shallowReactive } from "../reactivity";
import { shell } from "../shell";
import {
  disposeDeployChecklistSurface,
  mountDeployChecklistSurface,
} from "../surfaces/panel-deploy-checklist";
import type { DeployChecklistView, DeployStepRowView } from "../surfaces/panel-deploy-checklist";
import type { DeployConfig, ProjectConfig } from "@jxsuite/schema/types";
import type { PagesDeploymentInfo } from "./pages-service";

/** The chain, in the order the links must be forged. */
export const DEPLOY_STEP_IDS = ["repo", "remote", "provider", "deployed"] as const;

export type DeployStepId = (typeof DEPLOY_STEP_IDS)[number];

/**
 * Whether a link is forged.
 *
 * `unknown` is not a third kind of "no": it is the honest answer when the fact lives on a server
 * nobody has asked. It blocks like a `todo` and it READS differently, which is the whole point.
 */
export type DeployStepState = "done" | "todo" | "unknown";

/** One prerequisite. */
export interface DeployStep {
  readonly id: DeployStepId;
  /** Imperative, and short enough to be a 24px status-bar label. */
  readonly label: string;
  readonly state: DeployStepState;
  /** One sentence: what is true now, or what satisfying it buys. Never a secret. */
  readonly detail: string;
  /** The command that satisfies it — an id, so the row inherits title, chord and refusal. */
  readonly command: string;
}

/** The active project's configuration, or null when no project is open. */
function currentConfig(): ProjectConfig | null {
  return (projectState?.projectConfig as ProjectConfig | undefined) ?? null;
}

/**
 * The connected provider block, or `undefined`.
 *
 * Exported because the Publish panel asks the same question and P6's lesson was that two copies of
 * one derivation drift apart in silence — there is one reader of `build.deploy` in the app.
 */
export function currentDeploy(): DeployConfig | undefined {
  return currentConfig()?.build?.deploy;
}

/**
 * The last deployment anybody actually observed, and whether anybody has asked at all.
 *
 * Module state rather than a field on the config: a deployment is a fact about Cloudflare, not
 * about this repository, and writing it into `project.json` would commit a timestamp that is stale
 * the moment it is pushed.
 *
 * Reactive, because the checklist is a document now and follows its inputs rather than being
 * repainted by whatever else the dock was drawing: a deploy that finishes writes here, and the row
 * moves off `unknown` with nothing subscribing by hand. `shallowReactive` and not `reactive`, so
 * {@link observedDeployment} hands back the record Cloudflare answered with rather than a proxy of
 * it — `asked` is the flag anything tracks, and the info is read whole or not at all.
 */
const _seen = shallowReactive<{ asked: boolean; observed: PagesDeploymentInfo | null }>({
  asked: false,
  observed: null,
});

/** Record what Cloudflare answered. `null` means "asked, and there are none". */
export function noteDeployment(info: PagesDeploymentInfo | null): void {
  _seen.observed = info;
  _seen.asked = true;
}

/** The observed deployment, or null. */
export function observedDeployment(): PagesDeploymentInfo | null {
  return _seen.observed;
}

/** Forget the observation — project close, and every test that asserts the `unknown` branch. */
export function forgetDeployment(): void {
  _seen.observed = null;
  _seen.asked = false;
}

function repoStep(): DeployStep {
  const { status } = shell.git;
  if (status === null) {
    return {
      command: "git.init",
      detail: "Source control has not reported on this project yet.",
      id: "repo",
      label: "Track this project with git",
      state: "unknown",
    };
  }
  return status.isRepo
    ? {
        command: "git.init",
        detail: `Tracked${status.branch ? ` — on branch ${status.branch}` : ""}.`,
        id: "repo",
        label: "Track this project with git",
        state: "done",
      }
    : {
        command: "git.init",
        detail: "A deploy ships what the repository holds, so the repository comes first.",
        id: "repo",
        label: "Track this project with git",
        state: "todo",
      };
}

function remoteStep(): DeployStep {
  const { status } = shell.git;
  if (status === null || !status.isRepo) {
    return {
      command: "git.createGithubRepository",
      detail: "A remote is where the provider builds from.",
      id: "remote",
      label: "Push to a remote",
      state: status === null ? "unknown" : "todo",
    };
  }
  // A GitStatus from a host that reports no remotes array is not a repo with remotes — it is a
  // Host that did not say. Reading through it took the whole status bar down with a TypeError.
  if ((status.remotes ?? []).length === 0) {
    return {
      command: "git.createGithubRepository",
      detail: "This repository is local only — nothing outside this machine can build it.",
      id: "remote",
      label: "Push to a remote",
      state: "todo",
    };
  }
  return status.ahead > 0
    ? {
        command: "git.push",
        detail: `${status.ahead} commit(s) are not on ${status.remotes[0]} yet, so a build would ship the older tree.`,
        id: "remote",
        label: "Push to a remote",
        state: "todo",
      }
    : {
        command: "git.push",
        detail: `Up to date with ${status.remotes[0]}.`,
        id: "remote",
        label: "Push to a remote",
        state: "done",
      };
}

function providerStep(): DeployStep {
  const deploy = currentDeploy();
  if (deploy) {
    return {
      command: "publish.setUp",
      detail: `Cloudflare Pages project ${deploy.projectName}.`,
      id: "provider",
      label: "Connect a deploy provider",
      state: "done",
    };
  }
  return platformSupportsPublish()
    ? {
        command: "publish.setUp",
        detail: "Connecting one makes every commit build and publish on its own.",
        id: "provider",
        label: "Connect a deploy provider",
        state: "todo",
      }
    : {
        command: "publish.setUp",
        detail:
          "This platform cannot reach the Cloudflare API. Commit and push instead — your host " +
          "runs bunx jx build and serves dist/.",
        id: "provider",
        label: "Connect a deploy provider",
        state: "unknown",
      };
}

function deployedStep(): DeployStep {
  if (!currentDeploy()) {
    return {
      command: "publish.deploy",
      detail: "Nothing has been deployed, because no provider is connected.",
      id: "deployed",
      label: "Deploy",
      state: "todo",
    };
  }
  if (!_seen.asked) {
    return {
      command: "publish.deploy",
      detail: "Cloudflare has not been asked yet, so this is not a claim that nothing shipped.",
      id: "deployed",
      label: "Deploy",
      state: "unknown",
    };
  }
  if (_seen.observed === null) {
    return {
      command: "publish.deploy",
      detail: "Cloudflare reports no deployments for this project.",
      id: "deployed",
      label: "Deploy",
      state: "todo",
    };
  }
  const { observed } = _seen;
  return observed.status === "success"
    ? {
        command: "publish.deploy",
        detail: `${observed.environment} — ${observed.url}`,
        id: "deployed",
        label: "Deploy",
        state: "done",
      }
    : {
        command: "publish.deploy",
        detail: `Last deployment ${observed.stage}: ${observed.status}.`,
        id: "deployed",
        label: "Deploy",
        state: "todo",
      };
}

/** The four prerequisites, in order. */
export function deployChecklist(): DeployStep[] {
  return [repoStep(), remoteStep(), providerStep(), deployedStep()];
}

/**
 * The first link that is not forged, or null when the chain is whole.
 *
 * `unknown` counts as not forged: the app may not claim a step is done on the strength of not
 * having asked.
 */
export function nextDeployStep(): DeployStep | null {
  return deployChecklist().find((step) => step.state !== "done") ?? null;
}

/** What the status bar's project field shows. `null` when there is no project to deploy. */
export interface DeployStatusItem {
  readonly command: string;
  readonly label: string;
  readonly title: string;
}

/**
 * The status-bar item — ambient state, never a transient message.
 *
 * Its LABEL is the next blocking prerequisite, so the item explains itself: a reader who does not
 * know what is missing learns it from the same 24px string that fixes it.
 */
export function deployStatusItem(): DeployStatusItem | null {
  if (!projectState) {
    return null;
  }
  const next = nextDeployStep();
  if (next) {
    return { command: next.command, label: next.label, title: next.detail };
  }
  const url = currentDeploy()?.productionUrl;
  return {
    command: "publish.openDashboard",
    label: "Deployed",
    title: url ?? "Everything this project needs to ship is in place.",
  };
}

// ─── The surface ──────────────────────────────────────────────────────────────

/** Which glyph a link's state wears. One character, so it fits the row it labels. */
const STEP_ICON: Readonly<Record<DeployStepState, string>> = {
  done: "✓",
  todo: "·",
  unknown: "?",
};

/** One prerequisite, flattened for the document: a key, a state, a glyph and a sentence. */
function stepView(step: DeployStep): DeployStepRowView {
  return {
    icon: STEP_ICON[step.state],
    id: step.id,
    state: step.state,
    /* The detail is dropped once the link is forged: what a done step buys you is not news, and
       four sentences about things that are fine bury the one about the thing that is not. */
    text: step.state === "done" ? step.label : `${step.label} — ${step.detail}`,
  };
}

/**
 * The next action, as the document reads it — or nothing.
 *
 * A command the registry does not have, or whose `when` is false, draws NOTHING rather than a dead
 * label. The status bar's projection takes the same position for the same reason: a surface may
 * choose whether to show a command, never whether it exists (§12.4).
 */
function actionView(
  step: DeployStep | null,
): Pick<DeployChecklistView, "actionDisabled" | "actionLabel" | "actionTitle" | "hasAction"> {
  const none = { actionDisabled: false, actionLabel: "", actionTitle: "", hasAction: false };
  if (!step) {
    return none;
  }
  const registry = activeRegistry();
  const command = registry?.get(step.command);
  if (!registry || !command || !registry.isVisible(step.command)) {
    return none;
  }
  const reason = registry.disabledReason(step.command);
  return {
    actionDisabled: reason !== undefined,
    actionLabel: command.title,
    actionTitle: reason ? `${command.title} — requires ${reason}` : command.title,
    hasAction: true,
  };
}

/**
 * The checklist as the document draws it — or an empty row set, when no project is open.
 *
 * Read from inside the surface's own effect, so every reactive record it touches on the way (source
 * control's status, the project config, the observation above, the active registry) is tracked and
 * the row follows them.
 */
export function deployChecklistView(): DeployChecklistView {
  if (!projectState) {
    return {
      actionDisabled: false,
      actionLabel: "",
      actionTitle: "",
      hasAction: false,
      hasProject: false,
      rowIcon: "",
      rowState: "running",
      steps: [],
      summary: "",
    };
  }
  const steps = deployChecklist();
  const next = steps.find((step) => step.state !== "done") ?? null;
  return {
    ...actionView(next),
    hasProject: true,
    rowIcon: next ? "⋯" : "✓",
    rowState: next ? "running" : "done",
    steps: steps.map((entry) => stepView(entry)),
    summary: next ? next.detail : "Everything this project needs to ship is in place.",
  };
}

/** Run the next blocking step's command, if the registry has one it will run. */
function runNextStep(): void {
  const next = nextDeployStep();
  if (!next) {
    return;
  }
  void activeRegistry()?.run(next.command);
}

/** What the surface asks this module for: the projection, and the one decision a click makes. */
const CHECKLIST_SURFACE = { project: deployChecklistView, runAction: runNextStep };

/**
 * Mount the checklist into the container the Activity tab just painted, or take it down.
 *
 * The tab's `afterRender`, so it runs against the DOM lit has committed — and it runs on every
 * paint of the dock, including the ones where another tab is showing. No container means this tab
 * is not on screen, and the document standing in DOM that lit has already thrown away is disposed
 * rather than left holding an effect.
 *
 * Rendered ABOVE the operation feed rather than as an entry in it: an activity is something that
 * happened, and this is something that has not. It carries no `data-jx-region` stamp — the region
 * is `dock.bottom/panel:activity`, which the dock derives, and a hand-stamped leaf is a committed
 * budget (§13.2) that this does not need to spend.
 *
 * @param host The dock body element the tab was rendered into.
 */
export function syncDeployChecklist(host: HTMLElement): void {
  const container = host.querySelector<HTMLElement>("[data-deploy-checklist]");
  if (!container) {
    disposeDeployChecklistSurface();
    return;
  }
  mountDeployChecklistSurface(container, CHECKLIST_SURFACE);
}
