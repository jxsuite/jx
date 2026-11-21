/**
 * Open-sequence.ts — the one sequence every door into a project runs once it has chosen a root.
 *
 * There are four doors: the dev server's root probe (`loadProject`), the folder picker
 * (`openProject`), a recent project or a freshly created one (`openRecentProject`, which New
 * Project and the assistant's `create_project` adopt through), and a `?project=` URL (the boot path
 * a browser reload comes through). Each used to carry its own copy of this sequence, and the copies
 * drifted: one fetched the format registry before installing dependencies and never fetched it
 * again, so a project created from a starter opened with no formats, its Markdown pages unroutable
 * and missing from the Site panel. The doors keep what genuinely differs (how they find the root,
 * the state they open with, the progress surface they report to) and run everything else here.
 *
 * Two halves, because every door has work of its own between them (reading the project file,
 * closing tabs, binding the window's backend):
 *
 * 1. {@link enterProject}: forget the project being left and adopt the new one's state.
 * 2. {@link loadOpenedProject}: sync, install, then read the project with the registries the install
 *    made available. The directory loader is passed in, because `files.ts` is one of the doors and
 *    importing it here would be a cycle.
 *
 * @license MIT
 * @docs studio/projects/dependencies
 */

import type { ProjectConfig } from "@jxsuite/schema/types";
import { resetSavedScripts } from "../canvas/canvas-scripts";
import { loadFormats, refreshExtensionUi, refreshFormats } from "../format/format-host";
import { ensureDependenciesInstalled } from "../packages/ensure-deps";
import { autoSyncProjectOnOpen } from "../packages/pull-package-sync";
import { disarmPreviewOverlay } from "../preview/preview-overlay";
import { cleanupSourceControl } from "../publish/source-control";
import { resetProjectShell } from "../shell";
import { setProjectState } from "../store";
import type { ProjectState, StudioPlatform } from "../types";
import { setWorkspaceProject } from "../workspace/workspace";
import { resetAssetVersions } from "./asset-versions";
import { loadComponentRegistry } from "./components";
import { resetIgnoreCache } from "./gitignore";
import { learnProjectFileName } from "./project-file-name";

/** The phases {@link loadOpenedProject} reports, named as every door's progress surface lists them. */
export type OpenPhase = "Sync with the remote" | "Install dependencies" | "Read the project";

/** The host members the sequence reaches. */
export type OpenPlatform = Pick<StudioPlatform, "fetchProjectSchemas" | "listDirectory">;

/** How a door enters its project. */
export interface EnterProjectOptions {
  platform: OpenPlatform;
  /** The project state the door opens with; each door knows its root and name differently. */
  state: ProjectState;
  /**
   * The site project to bind the workspace to, or null for a root that is not one (a bare monorepo
   * root on the dev server keeps the assistant in bootstrap mode).
   */
  site: { root: string; config: ProjectConfig | null } | null;
  /**
   * The door already learned the project file's name, because it had to read the file to build
   * `state`. Learning it twice would list the root twice and report a conflict twice.
   */
  fileNameLearned?: boolean;
  /**
   * Drop the caches panels above the file layer keep for the project being left (the Site panel's
   * index, the media listing). Injected because those panels import from this layer.
   */
  resetProjectCaches?: (() => void) | undefined;
  /**
   * The door already ran {@link leaveProject}, because it closes the previous project's tabs and
   * must leave before it does.
   */
  left?: boolean;
}

/**
 * Drop the format registry, the extensions payload and the extension UI fetched for the previous
 * root, and start fetching this root's. The previous root's registry (often empty on a fresh
 * desktop launch) must not answer for this project.
 */
export function resetProjectRegistries(
  platform: Pick<StudioPlatform, "fetchProjectSchemas">,
): void {
  refreshFormats();
  void loadFormats();
  refreshExtensionUi(platform);
}

/**
 * Forget the project being left: source control, the shell's per-project slots (including which
 * project's session this window may write), the panels' caches and the published preview map.
 *
 * A door that closes the previous project's tabs runs this FIRST. Closing tabs changes the
 * workspace's shape, and the shell persists the session on every shape change for the project it
 * has restored; run in the other order, the empty workspace is written over the session of the
 * project being left, and reopening it later restores nothing. {@link enterProject} runs it too
 * unless told the door already has (`left`), so a door with no tabs to close needs nothing else.
 */
export function leaveProject({
  resetProjectCaches,
}: Pick<EnterProjectOptions, "resetProjectCaches"> = {}): void {
  cleanupSourceControl();
  resetProjectShell();
  resetProjectCaches?.();
  disarmPreviewOverlay();
}

/**
 * Leave the previous project ({@link leaveProject}) and adopt `state` as the open one.
 *
 * Everything here describes the project being left, so it all goes before the new state is set:
 * source control (a previous repository's branch under the new project's name), the shell's
 * per-project slots, the published preview map (keyed by project-relative path, so one project's
 * `pages/index.json` could answer for another's), the registries, the ignore and asset-version
 * caches, and the scripts the canvas has seen saved.
 */
export async function enterProject({
  platform,
  state,
  site,
  fileNameLearned = false,
  resetProjectCaches,
  left = false,
}: EnterProjectOptions): Promise<void> {
  if (!left) {
    leaveProject({ resetProjectCaches });
  }
  resetProjectRegistries(platform);
  resetIgnoreCache();
  resetAssetVersions();
  resetSavedScripts();
  setProjectState(state);
  if (site) {
    if (!fileNameLearned) {
      await learnProjectFileName(platform);
    }
    setWorkspaceProject(site.root, site.config);
  }
}

/** How a door loads the project it entered. */
export interface LoadOpenedProjectOptions {
  platform: Pick<StudioPlatform, "fetchProjectSchemas">;
  /**
   * Read the project's top-level directories into the tree (`files.ts`'s `loadProjectDirectories`).
   * Passed rather than imported because `files.ts` is itself a door, and it imports this module.
   */
  loadDirectories: () => Promise<void>;
  /** Told as each phase starts, for the door's progress surface (the Start pane, an Activity). */
  onPhase?: (phase: OpenPhase) => void;
}

/** What {@link loadOpenedProject} did, for a door that reports it. */
export interface LoadOpenedProjectResult {
  /** Dependencies were installed, so the registries were fetched again after the install. */
  installed: boolean;
}

/**
 * Sync, install dependencies, then read the project.
 *
 * The order is the contract. The format registry and the extension UI come from the project's
 * `node_modules`, so a fresh clone or a project just created from a starter answers with none until
 * the install has run: after a real install both are fetched again, and the registry is resolved
 * before the tree and the component registry are read, so nothing that reads the tree routes it
 * through an empty registry.
 */
export async function loadOpenedProject({
  platform,
  loadDirectories,
  onPhase,
}: LoadOpenedProjectOptions): Promise<LoadOpenedProjectResult> {
  onPhase?.("Sync with the remote");
  await autoSyncProjectOnOpen();
  onPhase?.("Install dependencies");
  const installed = await ensureDependenciesInstalled();
  if (installed) {
    refreshFormats();
    refreshExtensionUi(platform);
  }
  await loadFormats();
  onPhase?.("Read the project");
  await loadDirectories();
  await loadComponentRegistry();
  return { installed };
}
