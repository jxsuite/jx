/// <reference lib="dom" />
/**
 * The Packages settings section, as a mounted document.
 *
 * `settings/dependencies-editor.ts` is the flow — it asks the platform what the project depends on,
 * asks the registry what each of those is at now, decides which of the two is newer and runs the
 * four `bun` verbs — and this is the surface it draws into: the reactive scope the document reads,
 * the flags it discriminates on, and the mount that stays put while the section is redrawn around
 * it.
 *
 * **The flow tells the surface what a row says, never what it means.** `latest` arrives as the
 * string to print, `—` included, and `upgrade` as the version an update would install or `""` —
 * because "the registry did not answer" and "this package is already current" are two different
 * absences that a document with one conditional could not tell apart, and only the flow knows which
 * one it is looking at.
 *
 * **The add field is an ECHO, and that is load-bearing.** The lit template bound `.value` through
 * `live()`, so a field the reader had typed into was pushed back to the module's `_addName` on
 * every render. A document binding writes only when the SCOPE moves, so the flow states what the
 * control now holds before it decides anything — otherwise clearing the field after a successful
 * add would be a write of `""` over a scope that still said `""`, and the installed package's name
 * would sit in the field as though nothing had happened.
 *
 * **Keyed by host, not by module.** Project Settings is a pane document and a pane can be split, so
 * two containers may be showing this section at once; a single module-level mount would take the
 * first one's surface away from it the moment the second drew.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import packagesDoc from "./settings-packages.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("settings-packages", packagesDoc as unknown as JxDocument);

/** One dependency, as the table draws it. Every field is already a string the row can print. */
export interface PackageRow {
  name: string;
  /** The range in `package.json`, as it is written there. */
  version: string;
  /** The newest published version, or `—` where there is genuinely nothing to show. */
  latest: string;
  /**
   * The version an update would install, or `""` when this row is not behind one. The flow decides
   * it: a project pinned ahead of the registry has a `latest` to show and no upgrade to offer.
   */
  upgrade: string;
  /** Whether the package is a devDependency, said beside its name. */
  dev: boolean;
}

/** What the section shows — the flow's projection of the project's dependencies. */
export interface PackagesView {
  rows: PackageRow[];
  /** The list has not come back yet. Distinct from a project that has no dependencies. */
  loading: boolean;
  /** A `bun` run is in flight; every control on the surface is refused until it settles. */
  busy: boolean;
  /** The package name being typed, kept so an outside redraw does not take it away. */
  addName: string;
}

/** Everything the reader can do here. Each one is a decision the flow makes. */
export interface PackagesActions {
  /** Install the typed name. */
  add: () => void;
  /** State what the add field now holds — the echo, before anything is decided about it. */
  edit: (value: string) => void;
  /** Move one package to its newest published version. */
  update: (name: string) => void;
  /** Move every package that is behind one. */
  updateAll: () => void;
  remove: (name: string) => void;
  /** Run `bun install` over the project as it stands. */
  reinstall: () => void;
}

/** One row plus the flag its buttons switch on. */
interface RowScope extends Record<string, unknown>, PackageRow {
  /** Whether to draw the update button — `upgrade` said as something a `$switch` can read. */
  canUpdate: boolean;
}

/** What the document discriminates on. Derived here, so the flow never has to spell it. */
interface PackagesFlags {
  /**
   * Which of the three bodies to draw. "Loading…" and "No dependencies." are not the same sentence:
   * a project with no dependencies is an ordinary project, and drawing its empty table while the
   * answer is still in flight would say so before anybody knows.
   */
  listState: "loading" | "empty" | "listed";
  /** Whether anything is behind, which is the whole of the Update all button's existence. */
  hasUpdates: boolean;
}

interface PackagesScope
  extends Record<string, unknown>, Omit<PackagesView, "rows">, PackagesActions, PackagesFlags {
  rows: RowScope[];
}

interface Mounted {
  scope: PackagesScope;
  /** `null` while the mount is still in flight — which is a standing surface, not a missing one. */
  handle: SurfaceHandle | null;
}

const mounts = new WeakMap<HTMLElement, Mounted>();

/** The view plus the flags the document switches on. */
function derive(view: PackagesView): Omit<PackagesScope, keyof PackagesActions> {
  const rows = view.rows.map((row): RowScope => ({ ...row, canUpdate: row.upgrade !== "" }));
  return {
    addName: view.addName,
    busy: view.busy,
    hasUpdates: rows.some((row) => row.canUpdate),
    listState: view.loading ? "loading" : rows.length === 0 ? "empty" : "listed",
    loading: view.loading,
    rows,
  };
}

/**
 * Draw the section into `host`, or bring the one already there up to date.
 *
 * A mount whose root has left the document is remade; one still standing is only assigned to, which
 * is what keeps a `bun` run from rebuilding the table under the reader — and what keeps the add
 * field's caret where it is while they type into it.
 *
 * @param {HTMLElement} host The section container the registry handed the renderer.
 * @param {PackagesView} view What to show.
 * @param {PackagesActions} actions What the reader may do — read once, when the surface is mounted.
 */
export function renderPackagesSurface(
  host: HTMLElement,
  view: PackagesView,
  actions: PackagesActions,
): void {
  const existing = mounts.get(host);
  if (existing && (existing.handle === null || existing.handle.root.isConnected)) {
    Object.assign(existing.scope, derive(view));
    return;
  }
  existing?.handle?.dispose();
  host.textContent = "";
  const scope = reactive({ ...derive(view), ...actions }) as PackagesScope;
  const record: Mounted = { handle: null, scope };
  mounts.set(host, record);
  /* No race to arbitrate: a redraw arriving while this is in flight takes the branch above — a
     record with no handle yet IS the standing one — so a second mount into the same host cannot
     start before this settles. The previous handle, when there was one, was disposed a few lines
     up; that is the only mount this surface ever has to take down. */
  void mountSurface("settings-packages", scope, host).then((handle) => {
    record.handle = handle;
  });
}
