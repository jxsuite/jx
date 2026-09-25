/// <reference lib="dom" />
/**
 * About — the app's version, build metadata, external links, the resolved `@jxsuite/*` package
 * versions, and (on desktop) the release channel and update status.
 *
 * The dialog itself is `src/surfaces/about.json`, a `jx-dialog`; this module is the flow around it.
 * It used to be a lit template with module-level `_packages` and `_appInfo` and a `renderModal()`
 * that redrew the whole thing whenever either landed — the surface is reactive now, so a list that
 * arrives late appears without anything else being touched.
 *
 * Build metadata comes from `src/version.ts`, injected at bundle time. Both platform reads are
 * OPTIONAL: `listPackages` failing still leaves the app able to state its own version, and
 * `getAppInfo` is implemented only by the desktop, so its absence is a missing row rather than an
 * error to report.
 *
 * @docs studio/interface
 */

import { openAboutSurface } from "../surfaces/about";
import { layerHost } from "../ui/layers";
import { getPlatform } from "../platform";
import { APP_NAME, BUILD_DATE, GIT_COMMIT, LINKS, VERSION } from "../version";
import type { AboutRow, AboutSurfaceHandle } from "../surfaces/about";
import type { AppInfo } from "../types";
import type { Command, CommandRegistry } from "../commands/registry";

let _handle: AboutSurfaceHandle | null = null;

/** `—` rather than an empty cell: a row with nothing in it reads as a missing row. */
function formatBuildDate(iso: string): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** The metadata rows, with the desktop's two appended when the platform reported them. */
function metaRows(info: AppInfo | null): AboutRow[] {
  const rows: AboutRow[] = [
    { label: "Version", value: VERSION },
    { label: "Build date", value: formatBuildDate(BUILD_DATE) },
    { label: "Commit", value: GIT_COMMIT },
  ];
  if (info) {
    rows.push({ label: "Channel", value: info.channel });
    if (info.updateStatus) {
      rows.push({ label: "Updates", value: info.updateStatus });
    }
  }
  return rows;
}

/** Ask the platform for what it can tell us, and patch whatever comes back. */
async function loadDetails(handle: AboutSurfaceHandle): Promise<void> {
  const platform = getPlatform();
  let packages: { name: string; version: string }[] = [];
  try {
    packages = await platform.listPackages();
  } catch {
    packages = [];
  }
  let info: AppInfo | null = null;
  if (platform.getAppInfo) {
    try {
      info = await platform.getAppInfo();
    } catch {
      info = null;
    }
  }
  if (_handle === handle) {
    handle.update({ packages, rows: metaRows(info) });
  }
}

export function openAboutModal(): void {
  if (_handle) {
    return;
  }
  const handle = openAboutSurface({
    headline: `About ${APP_NAME}`,
    layer: layerHost("dialog"),
    links: [
      { href: LINKS.github, label: "GitHub" },
      { href: LINKS.docs, label: "Documentation" },
      { href: LINKS.license, label: "License" },
    ],
    onClosed: () => {
      if (_handle === handle) {
        _handle = null;
      }
    },
    rows: metaRows(null),
  });
  _handle = handle;
  void loadDetails(handle);
}

/**
 * There is no `closeAboutModal`, and its absence is the conversion rather than an omission.
 *
 * The dialog dismisses ITSELF now — Escape and the Close button are the platform's and the kit's,
 * and both arrive as events the document hands back to this module. An exported closer had no
 * caller left in the running app, which `tests/reachability.test.ts` said out loud: built, tested,
 * and reachable from nothing.
 */

export function aboutCommands(): Command[] {
  return [
    {
      id: "help.about",
      title: `About ${APP_NAME}`,
      category: "Help",
      level: "application",
      menus: ["commandbar/overflow", "palette"],
      group: "9_help",
      run: () => {
        openAboutModal();
      },
    },
  ];
}

/**
 * Register the About verb on the app registry.
 *
 * `appCommandSet()` is the projection CI counts and `docs/studio/interface/commands.md` is
 * generated from — it is NOT what the running app registers. P4 composed `help.about` into that set
 * only, and deleted the rail's About button in the same change, so About became unreachable in the
 * app while every check reported it present. The two roots have to agree.
 *
 * @param {CommandRegistry} registry
 * @returns {void}
 */
export function registerAboutCommands(registry: CommandRegistry): void {
  registry.registerAll(aboutCommands());
}
