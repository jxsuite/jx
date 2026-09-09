/// <reference lib="dom" />
/**
 * The Extensions section of Project Settings — what this project can turn on, and what it has.
 *
 * **The section exists because enabling an extension is two writes, and nothing kept them
 * together.** A project names an extension in `project.json` `extensions[]`, and the package has to
 * be a dependency for the registry to resolve it. The section this replaces wrote only the first,
 * so typing a name that was not installed appended a string and the next build threw `Extension "…"
 * is not resolvable`. A toggle here does both halves, in the one order that cannot leave the
 * project broken (see `enableExtension`).
 *
 * **What is offered comes from the backend, not from a list here.** Not every host can run every
 * extension — a Worker ships a fixed set of packages (specs/extensions.md §5.5) — so the catalogue
 * is a platform capability, and a host that cannot answer simply offers nothing. That is also why
 * there is no `@jxsuite/` prefix test below: which extensions are first-party is the backend's
 * answer, and a second definition of it here would be wrong for a fork.
 *
 * **The markup left.** The section is the `settings-extensions` surface
 * (`surfaces/settings-extensions.json`), mounted by `surfaces/settings-extensions.ts`; what is here
 * is what was always this module's — what the three sources add up to, which sentence a row's state
 * deserves, why a control cannot be used, and what a failed operation says.
 * `renderExtensionsSection` is unchanged as a contract: the registry hands a container to a
 * `render`, and this one mounts a document into it instead of rendering lit.
 *
 * @docs studio/projects/settings
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { buildRows } from "./extension-rows";
import { getPlatform } from "../platform";
import {
  disableExtension,
  enableExtension,
  extensionOpInFlight,
  removeExtensionPackage,
} from "./extension-commands";
import { mountExtensionsSurface } from "../surfaces/settings-extensions";
import type { ExtensionOrigin, ExtensionRow } from "./extension-rows";
import type {
  ExtensionGroupView,
  ExtensionRowView,
  ExtensionsActions,
  ExtensionsSurfaceHandle,
  ExtensionsView,
} from "../surfaces/settings-extensions";
import type { PackageInfo } from "../types";

/** Group headings, in render order, each with the sentence that says what the group is. */
const GROUPS: { origin: ExtensionOrigin; label: string; blurb: string }[] = [
  {
    blurb:
      "Extensions this project can turn on. Enabling one installs its package first if it is missing.",
    label: "Available",
    origin: "catalog",
  },
  {
    blurb: "Extension packages already in this project's dependencies.",
    label: "Installed",
    origin: "installed",
  },
  {
    blurb:
      "Named in project.json, but this backend does not describe them. You can still turn them off.",
    label: "Named in project.json",
    origin: "configured",
  },
];

/**
 * The project's dependencies, re-read whenever an operation may have changed them.
 *
 * Module-level rather than per container, because it is a fact about the PROJECT: two panes showing
 * this section are not looking at two dependency lists.
 */
let _packages: PackageInfo[] | null = null;

/** The surface mounted in each container, so a redraw updates one rather than making another. */
const mounted = new WeakMap<HTMLElement, ExtensionsSurfaceHandle>();

/**
 * The last failed operation, per rendered section, shown under the section title.
 *
 * Keyed by container, the shape `general-settings.ts` and `locales-section.ts` use, and for the
 * reason they use it: a message belongs to the copy of the section the reader was looking at when
 * the operation failed. It is cleared when the next operation starts and when one succeeds, and a
 * section the reader navigated away from and back is drawn into a fresh host
 * (`panels/settings-pane.ts`), so it starts with nothing to say rather than with a stale
 * complaint.
 */
const errors = new WeakMap<HTMLElement, string>();

/** The sentence a row's state deserves, and the tone it is said in. */
function noteFor(row: ExtensionRow): { note: string; noteTone: ExtensionRowView["noteTone"] } {
  if (row.unavailable !== undefined) {
    return { note: row.unavailable, noteTone: "warn" };
  }
  if (row.broken) {
    return {
      note:
        `${row.name} is named in project.json but is not installed, so the next build will fail. ` +
        `Turn it off, or turn it off and on again to install it.`,
      noteTone: "warn",
    };
  }
  if (!row.installed && !row.bundled) {
    return { note: "Not installed. Turning this on installs it first.", noteTone: "note" };
  }
  if (row.bundled) {
    return { note: "Ships with this backend, so it needs no install.", noteTone: "note" };
  }
  return { note: "", noteTone: "none" };
}

/** Why a row's toggle cannot be used right now, or `""` when it can. */
function blockedReason(row: ExtensionRow): string {
  // Turning something OFF is always safe, even on a backend that cannot run it — otherwise a row
  // That arrived unsupported could never be removed from the project that names it.
  if (row.unavailable !== undefined && !row.enabled) {
    return row.unavailable;
  }
  const busy = extensionOpInFlight();
  return busy === null ? "" : `Waiting for ${busy} to finish.`;
}

/**
 * The per-row Remove, as the document reads it.
 *
 * Refused while the extension is still enabled, and DISABLED with the reason rather than hidden
 * (guidelines §10): removing the package while `project.json` still names it manufactures exactly
 * the broken state this section exists to eliminate. It is absent only when there is nothing to
 * remove — a package the project never installed, or one the backend bundles.
 */
function removeFor(
  row: ExtensionRow,
): Pick<ExtensionRowView, "canRemove" | "removeDisabled" | "removeHint" | "removeLabel"> {
  const refusal = row.enabled
    ? `Turn ${row.title} off first. Removing the package while project.json still names it would fail the next build.`
    : "";
  return {
    canRemove: row.installed && !row.bundled,
    removeDisabled: refusal !== "" || extensionOpInFlight() !== null,
    removeHint: refusal === "" ? `Remove ${row.name}` : refusal,
    removeLabel: `Remove ${row.name}`,
  };
}

/** One row, projected. */
function rowView(row: ExtensionRow): ExtensionRowView {
  const blocked = blockedReason(row);
  return {
    blocked: blocked !== "",
    blockedReason: blocked,
    broken: row.broken,
    description: row.description ?? "",
    enabled: row.enabled,
    hasDescription: (row.description ?? "") !== "",
    hasSections: row.sections.length > 0,
    name: row.name,
    sections: row.sections.map((key) => ({ key })),
    specifier: row.specifier,
    title: row.title,
    ...noteFor(row),
    ...removeFor(row),
  };
}

/**
 * What the section shows right now.
 *
 * A group with no rows is left out rather than drawn empty: the three origins are a classification
 * of what happens to exist, not a set of shelves a project is expected to fill.
 */
function view(container: HTMLElement): ExtensionsView {
  const rows = buildRows(_packages);
  const groups: ExtensionGroupView[] = [];
  for (const group of GROUPS) {
    const matching = rows.filter((row) => row.origin === group.origin);
    if (matching.length > 0) {
      groups.push({
        blurb: group.blurb,
        label: group.label,
        origin: group.origin,
        rows: matching.map((row) => rowView(row)),
      });
    }
  }
  return { error: errors.get(container) ?? "", groups };
}

/** Draw the section, or bring the surface already there up to date. */
function refresh(container: HTMLElement): void {
  const standing = mounted.get(container);
  if (standing?.connected()) {
    standing.update(view(container));
    return;
  }
  standing?.dispose();
  mounted.set(container, mountExtensionsSurface(container, view(container), actions(container)));
}

/** Re-read the package list, then repaint. Installed-ness is what a config write cannot move. */
async function reload(container: HTMLElement): Promise<void> {
  try {
    _packages = await getPlatform().listPackages();
  } catch {
    _packages = [];
  }
  refresh(container);
}

async function onToggle(
  container: HTMLElement,
  specifier: string,
  checked: boolean,
): Promise<void> {
  /* The echo, first and before anything is decided: the scope is made to agree with the switch, so
     that the projection which follows — the file's answer — is a real move rather than a
     restatement of a value the scope never left. */
  mounted.get(container)?.echo(specifier, checked);
  errors.delete(container);
  // Intent is the DOCUMENT's truth inverted, never the switch's own `checked` — the browser has
  // Already moved that by the time this fires, so reading it would compound a double event.
  const row = buildRows(_packages).find((candidate) => candidate.specifier === specifier);
  if (row === undefined) {
    refresh(container);
    return;
  }
  // Started, THEN painted: both operations take the in-flight latch synchronously before their
  // First await, so this repaint is what disables every other switch for the duration.
  const op = row.enabled ? disableExtension(row.specifier) : enableExtension(row.specifier);
  refresh(container);
  try {
    await op;
  } catch (error) {
    errors.set(container, errorMessage(error));
  }
  // Either way the row repaints from `project.json`, so a switch the operation did not earn is put
  // Back where the document says it belongs.
  await reload(container);
}

async function onRemove(container: HTMLElement, name: string): Promise<void> {
  errors.delete(container);
  const op = removeExtensionPackage(name);
  refresh(container);
  try {
    await op;
  } catch (error) {
    errors.set(container, errorMessage(error));
  }
  await reload(container);
}

/**
 * What the reader may do, bound to one container.
 *
 * Memoized per container so the surface is handed the same functions every time: they are read
 * once, when it mounts, and a fresh pair on every refresh would be a scope write that says
 * nothing.
 */
const bound = new WeakMap<HTMLElement, ExtensionsActions>();

function actions(container: HTMLElement): ExtensionsActions {
  let acts = bound.get(container);
  if (!acts) {
    acts = {
      remove: (name: string) => {
        void onRemove(container, name);
      },
      toggle: (specifier: string, checked: boolean) => {
        void onToggle(container, specifier, checked);
      },
    };
    bound.set(container, acts);
  }
  return acts;
}

/**
 * Render the Extensions section into a settings-document container.
 *
 * @param {HTMLElement} container
 */
export function renderExtensionsSection(container: HTMLElement): void {
  refresh(container);
  void reload(container);
}
