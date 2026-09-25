/// <reference lib="dom" />
/**
 * The two Project Settings sections the document adds directly — Deploy and Raw JSON.
 *
 * They live together because each is a small, direct view of ONE `project.json` key and neither
 * owns a dialog, a picker or a schema form: `build.adapter` (one enum), and the file itself.
 *
 * **Extensions used to be the third.** It was a free-text field over the `extensions` array, which
 * wrote `project.json` and nothing else — so a name that was not installed produced a project that
 * failed to build. It now needs a catalogue, a package list and an install path, which is more than
 * "a direct view of one key", and it lives in `./extensions-section.ts`. What stayed behind is the
 * error plumbing both still share.
 *
 * **Raw JSON does not open a second editor.** It shows what is on disk and hands the author to the
 * Code editor over the SAME tab — one document, three editors (§9.3), so switching to the text and
 * back keeps one undo stack instead of forking two.
 *
 * **The markup left.** Each section is a Jx document over the kit — `surfaces/settings-deploy.json`
 * and `surfaces/settings-rawjson.json`, mounted by the adapters beside them — and what is here is
 * what was always this module's: what an adapter name means, what reaches `project.json`, what a
 * failed write says, and what "Edit as code" does to the tab. Two documents rather than one,
 * because they are two sections: the registry contributes each under its own key and only one of
 * them is ever on screen, so a single document would have to carry a discriminant whose only job
 * was to hide half of itself. `renderDeploySection` and `renderRawJsonSection` are unchanged as
 * contracts — the registry hands a container to a `render`, and each of these mounts a document
 * into it instead of rendering lit.
 *
 * @docs studio/projects/settings
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { projectState, updateUi } from "../store";
import { serializeProjectConfig } from "../tabs/project-config";
import { tabOfContainer } from "../canvas/canvas-surface";
import { updateSiteConfig } from "../site-context";
import { mountDeploySurface } from "../surfaces/settings-deploy";
import { mountRawJsonSurface } from "../surfaces/settings-rawjson";

import type { DeployActions, DeploySurfaceHandle, DeployValues } from "../surfaces/settings-deploy";
import type { RawJsonSurfaceHandle, RawJsonValues } from "../surfaces/settings-rawjson";
import type { ProjectConfig } from "@jxsuite/schema/types";

/** The mode the Code editor draws under — `tabs/tab.ts`'s `EDITOR_KIND_BY_MODE` maps it to `code`. */
const CODE_MODE = "source";

/**
 * The last failed write per rendered section container.
 *
 * Keyed by container so two mounted copies (and two tests) never share a message — the same shape
 * `general-settings.ts` uses, and for the same reason: these sections save on change, so a silent
 * rejection would read as "my edit just vanished".
 */
const errors = new WeakMap<HTMLElement, string>();

/** The live project configuration, or an empty one before a project is open. */
function config(): ProjectConfig {
  return (projectState?.projectConfig ?? {}) as ProjectConfig;
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

/** The build adapters `@jxsuite/compiler` ships. One enumeration, shared with New Project. */
export const BUILD_ADAPTERS: readonly { value: string; label: string }[] = [
  { label: "Static", value: "static" },
  { label: "Bun", value: "bun" },
  { label: "Node", value: "node" },
  { label: "Cloudflare Workers", value: "cloudflare-workers" },
  { label: "Cloudflare Pages", value: "cloudflare-pages" },
];

/** The surface mounted in each Deploy container, so a redraw updates one rather than making another. */
const deployMounts = new WeakMap<HTMLElement, DeploySurfaceHandle>();

/** What the Deploy section shows, from the file and the parked error as they stand now. */
function deployValues(container: HTMLElement): DeployValues {
  return {
    adapter: config().build?.adapter || "static",
    adapters: BUILD_ADAPTERS.map((entry) => ({ label: entry.label, value: entry.value })),
    error: errors.get(container) ?? "",
  };
}

/**
 * Persist a patch, surfacing the rejection instead of swallowing it.
 *
 * `updateSiteConfig` rejects on a failed write and the chokepoint has already filed the Problem, so
 * all that is left here is to keep the form honest about what is on disk.
 *
 * @param {HTMLElement} container
 * @param {Partial<ProjectConfig>} patch
 */
async function persist(container: HTMLElement, patch: Partial<ProjectConfig>): Promise<void> {
  try {
    await updateSiteConfig(patch);
    errors.delete(container);
  } catch (error) {
    errors.set(container, `Could not save project.json — ${errorMessage(error)}`);
  }
  renderDeploySection(container);
}

/**
 * What the reader may do, bound to one container.
 *
 * Memoized per container so the surface is handed the same function every time: actions are read
 * once, when it mounts, and a fresh one on every refresh would be a scope write that says nothing.
 */
const bound = new WeakMap<HTMLElement, DeployActions>();

function deployActions(container: HTMLElement): DeployActions {
  let acts = bound.get(container);
  if (!acts) {
    acts = {
      setAdapter: (value: string) => {
        /* What the picker now holds, told to the scope before anything is decided about it.
           Without this a rejected write leaves the refused platform showing: the binding writes
           the value the scope names, and the scope never said anything but the adapter on disk —
           so re-stating it is not a change and nothing is written back. Echoing first makes the
           snap-back a real move, which is the job `live()` did in the template this replaced. */
        deployMounts.get(container)?.update({ adapter: value });
        void persist(container, { build: { ...config().build, adapter: value } });
      },
    };
    bound.set(container, acts);
  }
  return acts;
}

/**
 * Where the project is built for, and what it is built with.
 *
 * The adapter moved off Overview: Overview says what the site IS, and the adapter is a fact about
 * where it SHIPS — the same split §2 principle 5 applies to Contexts.
 *
 * The pane calls this again whenever something it cannot see may have changed, and a remount would
 * take the keyboard out of the picker the reader is in — so a standing surface is updated and only
 * a container the document has left is mounted into again.
 *
 * @param {HTMLElement} container
 */
export function renderDeploySection(container: HTMLElement): void {
  const standing = deployMounts.get(container);
  if (standing?.connected()) {
    standing.update(deployValues(container));
    return;
  }
  standing?.dispose();
  deployMounts.set(
    container,
    mountDeploySurface(container, deployValues(container), deployActions(container)),
  );
}

// ─── Raw JSON ─────────────────────────────────────────────────────────────────

/** The surface mounted in each Raw JSON container. */
const rawJsonMounts = new WeakMap<HTMLElement, RawJsonSurfaceHandle>();

/**
 * The file as it is written.
 *
 * The serialisation is the chokepoint's own (`serializeProjectConfig`), so what this shows is what
 * a save writes — not a second pretty-printer that would disagree with the file by an indent.
 */
function rawJsonValues(): RawJsonValues {
  return { json: serializeProjectConfig(config()) };
}

/**
 * `project.json` as it is written, and the way into editing it as text.
 *
 * @param {HTMLElement} container
 */
export function renderRawJsonSection(container: HTMLElement): void {
  const standing = rawJsonMounts.get(container);
  if (standing?.connected()) {
    standing.update(rawJsonValues());
    return;
  }
  standing?.dispose();
  rawJsonMounts.set(
    container,
    mountRawJsonSurface(container, rawJsonValues(), {
      editAsCode: () => updateUi(tabOfContainer(container), "canvasMode", CODE_MODE),
    }),
  );
}
