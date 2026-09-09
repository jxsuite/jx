/// <reference lib="dom" />
/**
 * Dependencies settings section — a registry-aware table of the project's npm dependencies. Shows
 * current vs latest version, with per-row update/remove, an add-package field, "update all", and
 * reinstall.
 *
 * **Every row's Latest is that package's own newest version on npm.** Two assumptions used to sit
 * between this table and the registry, and both are gone:
 *
 * 1. `@jxsuite/*` rows targeted `VERSION`, the version this Studio build embeds — right only while the
 *    whole suite released as one number. The packages release on their own cadences now, so that
 *    proposed a version that may never have been published, for a package whose real latest the
 *    table had not looked at. The same correction `packages/jxsuite-update.ts` already made.
 * 2. The backend was asked for _outdated_ packages, so a package already at its latest arrived as an
 *    absence and the column read `—` — the registry's answer was known and thrown away. It now asks
 *    `platform.packageVersions()`, which reports every dependency's latest either way, and the
 *    comparison that decides whether an update button appears happens here.
 *
 * A row shows `—` only where there is genuinely nothing to show: a `workspace:`/`file:`/git spec, a
 * package the registry does not answer for, or a host with no registry lookup at all.
 *
 * **The markup left.** The section is the `settings-packages` surface
 * (`surfaces/settings-packages.json`), mounted by `surfaces/settings-packages.ts`; what is here is
 * the section itself — what the platform is asked, which of two versions is newer, what each verb
 * runs and what it says when it fails. `renderDependenciesEditor` is unchanged as a contract: the
 * registry hands a container to a `render`, and this one mounts a document into it instead of
 * rendering lit.
 *
 * @docs studio/projects/settings
 */

import { getPlatform } from "../platform";
import { notify } from "../services/notify";
import { showProgressModal } from "../ui/progress-modal";
import { isUpgrade, stripRange } from "../packages/semver";
import { renderPackagesSurface } from "../surfaces/settings-packages";
import type { PackageRow, PackagesActions, PackagesView } from "../surfaces/settings-packages";
import type { PackageInfo } from "../types";

interface Update {
  name: string;
  version: string;
  dev: boolean;
}

let _container: HTMLElement | null = null;
let _packages: PackageInfo[] | null = null;
let _latest = new Map<string, string>();
let _busy = false;
let _addName = "";

/** This package's newest published version, or null when the registry did not answer for it. */
function latestFor(p: PackageInfo): string | null {
  return _latest.get(p.name) ?? null;
}

/**
 * The version a package can be updated TO, or null when it is current or ahead.
 *
 * `isUpgrade`, not "differs from latest": a project deliberately pinned ahead of the registry — a
 * prerelease, or a range bumped before the publish landed — would otherwise be offered a downgrade
 * with an update button.
 */
function upgradeFor(p: PackageInfo): string | null {
  const latest = latestFor(p);
  return latest && isUpgrade(p.version, latest) ? latest : null;
}

/** The package a row's button names, or undefined when the list has moved on since it was drawn. */
function packageNamed(name: string): PackageInfo | undefined {
  return (_packages ?? []).find((p) => p.name === name);
}

async function load() {
  const platform = getPlatform();
  try {
    _packages = await platform.listPackages();
  } catch {
    _packages = [];
  }
  _latest = new Map();
  if (platform.packageVersions) {
    try {
      for (const info of await platform.packageVersions()) {
        _latest.set(info.name, info.latest);
      }
    } catch {
      /* Registry lookups are best-effort */
    }
  }
  render();
}

async function withBusy(fn: () => Promise<void>) {
  if (_busy) {
    return;
  }
  _busy = true;
  render();
  const progress = showProgressModal({ status: "Running bun…", title: "Updating dependencies" });
  try {
    await fn();
    progress.done();
  } catch (error) {
    progress.fail(error instanceof Error ? error.message : String(error));
  } finally {
    _busy = false;
    await load();
  }
}

async function onAdd() {
  const name = _addName.trim();
  if (!name) {
    return;
  }
  await withBusy(async () => {
    await getPlatform().addPackage(name);
    _addName = "";
    notify.success(`Added ${name}.`);
  });
}

async function onRemove(name: string) {
  await withBusy(async () => {
    await getPlatform().removePackage(name);
    notify.success(`Removed ${name}.`);
  });
}

async function onUpdate(name: string) {
  const platform = getPlatform();
  const p = packageNamed(name);
  const latest = p ? upgradeFor(p) : null;
  if (!platform.setPackageVersions || !p || !latest) {
    return;
  }
  await withBusy(async () => {
    const target = stripRange(latest);
    const res = await platform.setPackageVersions!([
      { dev: Boolean(p.dev), name: p.name, version: `^${target}` },
    ]);
    if (!res.ok) {
      throw new Error(res.log ?? "Update failed");
    }
    notify.success(`Updated ${p.name} to ${target}.`);
  });
}

async function onUpdateAll() {
  const platform = getPlatform();
  if (!platform.setPackageVersions) {
    return;
  }
  const updates = (_packages ?? [])
    .map((p): Update | null => {
      const target = upgradeFor(p);
      return target
        ? { dev: Boolean(p.dev), name: p.name, version: `^${stripRange(target)}` }
        : null;
    })
    .filter((u): u is Update => u !== null);
  if (updates.length === 0) {
    return;
  }
  await withBusy(async () => {
    const res = await platform.setPackageVersions!(updates);
    if (!res.ok) {
      throw new Error(res.log ?? "Update failed");
    }
    notify.success(`Updated ${updates.length} package(s).`);
  });
}

async function onReinstall() {
  const platform = getPlatform();
  if (!platform.installDependencies) {
    return;
  }
  await withBusy(async () => {
    const res = await platform.installDependencies!();
    if (!res.ok) {
      throw new Error(res.log ?? "Install failed");
    }
    notify.success("Dependencies reinstalled.");
  });
}

/**
 * One dependency as the surface draws it.
 *
 * The two version columns are answered separately on purpose. `latest` is what the registry said
 * and is shown whatever it says, `—` when it said nothing at all; `upgrade` is the far narrower
 * claim that the row is BEHIND that version, and it is the only one an update button may act on.
 */
function row(p: PackageInfo): PackageRow {
  return {
    dev: Boolean(p.dev),
    latest: latestFor(p) ?? "—",
    name: p.name,
    upgrade: upgradeFor(p) ?? "",
    version: p.version,
  };
}

/** What the section shows right now. */
function view(): PackagesView {
  return {
    addName: _addName,
    busy: _busy,
    loading: _packages === null,
    rows: (_packages ?? []).map((p) => row(p)),
  };
}

/**
 * What the reader may do. One set for the module, because the section's whole state is the module's
 * — one project's dependencies, and one `bun` run at a time over them.
 */
const ACTIONS: PackagesActions = {
  add: () => {
    void onAdd();
  },
  edit: (value: string) => {
    /* The echo. The scope has to be told what the field now holds even though nothing about the
       section changes, because emptying it after a successful add is otherwise a write of "" over
       a scope that already said "" — no change, no binding, and the installed package's name left
       sitting in the field. */
    _addName = value;
    render();
  },
  reinstall: () => {
    void onReinstall();
  },
  remove: (name: string) => {
    void onRemove(name);
  },
  update: (name: string) => {
    void onUpdate(name);
  },
  updateAll: () => {
    void onUpdateAll();
  },
};

function render() {
  if (!_container) {
    return;
  }
  renderPackagesSurface(_container, view(), ACTIONS);
}

/** @param {HTMLElement} container */
export function renderDependenciesEditor(container: HTMLElement) {
  _container = container;
  _packages = null;
  _addName = "";
  render();
  void load();
}
