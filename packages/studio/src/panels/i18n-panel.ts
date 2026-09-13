/// <reference lib="dom" />
/**
 * Languages — which pages exist in which locale, and which do not.
 *
 * Jx has no message catalogue. A translation is a DIFFERENT FILE in a different directory
 * (`pages/fr/about.json` beside `pages/about.json`, `specs/site-architecture.md` §13.3), and that
 * is why nothing in the shell could answer "is this site translated": the Files panel draws `fr/`
 * the way it draws any other directory, and a page nobody has translated is invisible precisely
 * because the file that would prove it does not exist.
 *
 * So this panel is a grid over ABSENCE. One row per translation key — the path with its locale
 * segment taken out, which is what makes two files the same page — and one column per declared
 * locale. A cell says one of three things:
 *
 * | Cell      | Means                                                         | Its button         |
 * | --------- | ------------------------------------------------------------- | ------------------ |
 * | `present` | the file is there                                             | opens it           |
 * | `stale`   | it is there, and older than the source it was translated from | opens it, and says |
 * | `missing` | it is not there, and this is where it would go                | creates it         |
 *
 * **Every button is a command, run by id through the registry** — never a direct call, for the
 * reason `panels/problems-panel.ts` gives about its recovery button: the registry is what makes the
 * action reachable from the palette and from automation, and it is where the refusal sentence comes
 * from. A cell whose command this window has not registered is drawn disabled with that as its
 * tooltip, rather than as a button that does nothing.
 *
 * **The body is a Jx document** (`surfaces/panel-i18n.json`, mounted by `surfaces/panel-i18n.ts`),
 * so `render` draws nothing and `afterRender` mounts. What stays here is everything that is a
 * DECISION — the scan, the fold from files to rows, which command a square runs, whether the
 * registry refuses it and what the refusal says — projected into a scope whose every square already
 * carries its glyph, its sentence and the three arguments its command takes. `afterRender` runs on
 * every repaint, so the mount is idempotent: the standing surface is updated where it is still
 * there, and re-mounted only where lit has taken it out (which is what a switch to another panel
 * does, because the document is appended into the `.panel-content` lit renders `nothing` into).
 *
 * **Off the rail.** `railDeclarations()` does not apply `when`, so a rail button here would spend
 * the last `rail/project` slot in every monolingual project and shift every document panel's ⌘1–8
 * chord by one. `i18n.showParity` is how this panel is reached.
 *
 * @docs studio/interface/languages
 */

import { activeRegistry } from "../commands/active-registry";
import { errorMessage } from "@jxsuite/schema/parse";
import { getEffectiveLocales } from "../site-context";
import { getPlatform } from "../platform";
import {
  localeLabel,
  localeOfPath,
  translationKeyOfPath,
  translationPathFor,
} from "@jxsuite/schema/locale";
import { mountI18nSurface } from "../surfaces/panel-i18n";
import { notify } from "../services/notify";
import { nothing } from "lit-html";
import { projectState } from "../store";
import { registerPanel } from "./panel-registry";
import { scanLibrary } from "../browse/library-model";
import type {
  I18nActions,
  I18nParityCell,
  I18nParityRow,
  I18nSurfaceHandle,
  I18nValues,
} from "../surfaces/panel-i18n";
import type { LibraryFile, ScanFailure } from "../browse/library-model";
import type { NavigatorPanelContext, PanelBody } from "./panel-registry";
import type { ResolvedI18n } from "@jxsuite/schema/locale";

/**
 * One cell of the parity grid.
 *
 * **Stale is defined here and nowhere else**: a translation is stale when the DEFAULT locale's file
 * for the same key carries a `modified` strictly newer than the translation's. A file the platform
 * reported no `modified` for is `present`, never `stale` — an absent timestamp is not evidence of
 * being behind, and `browse/library-layouts.ts`'s `formatModified` already set the precedent of
 * refusing to invent one.
 */
export type ParityCell =
  /** The file is on disk at `path`. */
  | { state: "present"; path: string }
  /** The file is on disk at `path` and older than `behind`, the source it was translated from. */
  | { state: "stale"; path: string; behind: string }
  /**
   * No file. `path` is where it WOULD go, and `null` when the key cannot carry a locale directory
   * at all — a file directly under `content/`, outside any collection, has no place to put one.
   */
  | { state: "missing"; path: string | null };

/** One row of the parity grid: a translation key and its cell per declared locale. */
export interface ParityRow {
  /** `translationKeyOfPath` of the files behind the row — the path with the locale taken out. */
  key: string;
  /** Locale → cell, one entry per declared locale, in declaration order. */
  cells: Map<string, ParityCell>;
}

/**
 * The directories a translation can live in — the two layouts §13 defines, and nothing else.
 *
 * Not `projectState.projectDirs`: `layouts/` and `components/` are shared by every locale and
 * `public/` is not addressable per language, so scanning them would fill the grid with rows whose
 * every cell is permanently `missing` for a reason that is not the author's to fix.
 */
const PARITY_DIRS = ["pages", "content"] as const;

/**
 * How many keys the grid draws.
 *
 * It states the remainder rather than dropping it silently, which is what `calendarTpl` does with
 * the days it does not show — a truncation nobody is told about is indistinguishable from a project
 * that really is that small.
 */
export const PARITY_ROW_LIMIT = 200;

/** One completed pass over {@link PARITY_DIRS}, and the project root it was taken in. */
interface ParityScan {
  root: string;
  files: readonly LibraryFile[];
  failures: readonly ScanFailure[];
  /** Path → the `$translationKey` that document declares, for the documents that declare one. */
  declared: ReadonlyMap<string, string>;
}

/*
 * The scan is module state rather than panel state because the panel's `render` is synchronous and
 * the Navigator repaints it on every keystroke elsewhere in the shell. Keying it on the project
 * root is what makes a project switch re-read rather than draw the previous project's file tree.
 */
let scanned: ParityScan | null = null;
let scanning: string | null = null;

/** Forget the scan, so the next render takes a fresh one. The Rescan button, and every test. */
export function refreshParityScan(): void {
  scanned = null;
  scanning = null;
}

/**
 * Walk the project once, then repaint.
 *
 * `scanLibrary` never rejects, so the only way into the catch is {@link getPlatform} throwing in a
 * window that has none. That is recorded as a scan failure rather than swallowed, for the reason
 * `browse/library-model.ts` states at length: a listing that half-worked and a project that is
 * empty produced the same sentence, and only one of them is true.
 */
async function takeScan(root: string, rerender: () => void): Promise<void> {
  try {
    const scan = await scanLibrary(PARITY_DIRS, getPlatform());
    scanned = {
      declared: await readDeclaredKeys(scan.files),
      failures: scan.failures,
      files: scan.files,
      root,
    };
  } catch (error) {
    scanned = {
      declared: new Map(),
      failures: [{ dir: PARITY_DIRS.join(", "), error: errorMessage(error) }],
      files: [],
      root,
    };
  }
  scanning = null;
  rerender();
}

/**
 * The `$translationKey` each page declares, for the pages that declare one.
 *
 * Without this the grid keys on the path alone, and a **localized slug** — the case
 * `site-architecture.md` §13.5 exists to handle — reads as two half-translated pages rather than
 * one whole one: `pages/about.json` present in English and Arabic, `pages/a-propos.json` present in
 * French, and four `missing` cells describing files nobody should write. That is the wrong answer
 * on the one surface whose whole job is to say which pages are translated.
 *
 * A route parameter is normalized to its template spelling — `exhibitions/${slug}` and the English
 * `pages/exhibitions/[slug].json` are the same page — because the grid keys on FILES where the
 * build keys on routes, and a template stands for every route it expands to.
 *
 * Read from the raw text, and only for the files that mention the key: the parse is what costs, and
 * most pages of a multilingual site never declare one — their paths are parallel and the derivation
 * is right. A file that cannot be read is simply absent from the map, which leaves it keyed by
 * path.
 *
 * @param {readonly LibraryFile[]} files
 * @returns {Promise<Map<string, string>>}
 */
async function readDeclaredKeys(files: readonly LibraryFile[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const platform = getPlatform();
  for (const file of files) {
    if (file.category === "Media" || !file.path.startsWith("pages/")) {
      continue;
    }
    let text: string;
    try {
      text = await platform.readFile(file.path);
    } catch {
      continue;
    }
    if (!text.includes("$translationKey")) {
      continue;
    }
    const declared = /"\$translationKey"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
    if (declared !== undefined && declared !== "") {
      out.set(file.path, declared.replaceAll(/\$\{(\w+)\}/g, "[$1]").replaceAll(/^\/+|\/+$/g, ""));
    }
  }
  return out;
}

/** ISO timestamp as a comparable number, or `null` — never a guessed "now". */
function timeOf(modified: string | undefined): number | null {
  if (!modified) {
    return null;
  }
  const parsed = Date.parse(modified);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Fold a scan into the grid. Pure: no I/O, no platform, no DOM.
 *
 * A file under no locale segment lands under the DEFAULT locale, because that is what it is — under
 * `prefix-except-default` the unprefixed path is the default locale's copy, and under
 * `prefix-always` it is the copy an author wrote before declaring the locale they meant. Either way
 * it is the source the other columns are measured against, and hiding it would leave the grid with
 * a column of `missing` cells whose sources are on disk.
 *
 * Assets are skipped. `categoryFor` already decides what is media by extension, so an image beside
 * a page is not a row here for the same reason it is not a page anywhere else.
 */
export function parityRows(
  files: readonly LibraryFile[],
  i18n: ResolvedI18n,
  declared: ReadonlyMap<string, string> = new Map(),
): ParityRow[] {
  const byKey = new Map<string, Map<string, LibraryFile>>();
  /*
   * A document's own `$translationKey` overrides the one its path implies, exactly as it does in
   * the build (§13.5) — which is what makes a localized slug one row instead of two half-empty
   * ones. Prefixed with the directory the derivation would have produced, so the two spellings meet:
   * a declared key is route-shaped (`about`) and this grid is file-shaped (`pages/about.json`).
   */
  /* Every key the paths alone produce, so a declared one can be matched against a real file rather
     than against a spelling. */
  const derivedKeys = new Set(
    files.filter((f) => f.category !== "Media").map((f) => translationKeyOfPath(f.path, i18n)),
  );
  const keyOf = (file: LibraryFile): string => {
    const own = declared.get(file.path);
    if (own === undefined) {
      return translationKeyOfPath(file.path, i18n);
    }
    /*
     * A declared key is route-shaped (`about`, `exhibitions`) while this grid is file-shaped
     * (`pages/about.json`, `pages/exhibitions/index.json`), and one route can be either — a page or
     * a directory's index. Both spellings are tried against the files actually scanned, so the key
     * lands on the page that exists; the plain form stands when neither does, which keeps the row
     * visible instead of merging it into something arbitrary.
     */
    const ext = /\.[^./]+$/.exec(file.path)?.[0] ?? "";
    for (const candidate of [`pages/${own}${ext}`, `pages/${own}/index${ext}`]) {
      if (derivedKeys.has(candidate)) {
        return candidate;
      }
    }
    return `pages/${own}${ext}`;
  };
  for (const file of files) {
    if (file.category === "Media") {
      continue;
    }
    const key = keyOf(file);
    const locale = localeOfPath(file.path, i18n) ?? i18n.defaultLocale;
    const cell = byKey.get(key) ?? new Map<string, LibraryFile>();
    /*
     * Two files can claim one square — `pages/about.json` and `pages/en/about.json` are both the
     * English copy under `prefix-except-default`. The one at the CANONICAL path wins, so the grid
     * agrees with the location `i18n.createTranslation` would have written to; otherwise the first
     * in path order stands, and the duplicate is the author's to reconcile.
     */
    if (!cell.has(locale) || file.path === translationPathFor(key, locale, i18n)) {
      cell.set(locale, file);
    }
    byKey.set(key, cell);
  }

  const rows: ParityRow[] = [];
  for (const [key, found] of byKey) {
    const source = found.get(i18n.defaultLocale);
    const sourceTime = timeOf(source?.modified);
    const cells = new Map<string, ParityCell>();
    for (const locale of i18n.locales) {
      const file = found.get(locale);
      if (!file) {
        cells.set(locale, { path: translationPathFor(key, locale, i18n), state: "missing" });
        continue;
      }
      const time = timeOf(file.modified);
      const behind =
        source !== undefined &&
        source.path !== file.path &&
        sourceTime !== null &&
        time !== null &&
        sourceTime > time;
      cells.set(
        locale,
        behind
          ? { behind: source.path, path: file.path, state: "stale" }
          : { path: file.path, state: "present" },
      );
    }
    rows.push({ cells, key });
  }
  return rows.toSorted((a, b) => a.key.localeCompare(b.key));
}

/** Where a monolingual project declares its languages — the empty state's one action. */
const SETTINGS_COMMAND = "settings.open";

/** The command each cell state runs. */
const CELL_COMMAND: Readonly<Record<ParityCell["state"], string>> = {
  missing: "i18n.createTranslation",
  present: "i18n.openTranslation",
  stale: "i18n.openTranslation",
};

/** One glyph per state, the way `problems-panel.ts` draws severity — scannable down a column. */
const CELL_GLYPH: Readonly<Record<ParityCell["state"], string>> = {
  missing: "+",
  present: "✓",
  stale: "!",
};

/**
 * The path a row's commands are addressed by: whichever file of the row actually exists, preferring
 * the source, and the key itself when the row is empty in every locale.
 *
 * Any sibling answers, because `translationPathFor` takes the locale out before it puts one back.
 */
function rowSourcePath(row: ParityRow, i18n: ResolvedI18n): string {
  const source = row.cells.get(i18n.defaultLocale);
  if (source && source.state !== "missing") {
    return source.path;
  }
  for (const cell of row.cells.values()) {
    if (cell.state !== "missing") {
      return cell.path;
    }
  }
  return row.key;
}

/** Why a cell's button will not run, or `undefined` when it will. */
function cellRefusal(cell: ParityCell, id: string): string | undefined {
  if (cell.state === "missing" && cell.path === null) {
    return "a file that can hold a locale directory — this one is under no collection";
  }
  const registry = activeRegistry();
  if (!registry?.get(id)) {
    return "the Languages commands, which this window has not registered";
  }
  return registry.disabledReason(id);
}

/** The cell's whole sentence: what the click does, or what it needs first. */
function cellTitle(cell: ParityCell, locale: string, refusal: string | undefined): string {
  const label = localeLabel(locale);
  const said =
    cell.state === "missing"
      ? cell.path === null
        ? `No place for a ${label} copy of this file`
        : `Create ${cell.path}`
      : cell.state === "stale"
        ? `Open ${cell.path} — older than ${cell.behind}`
        : `Open ${cell.path}`;
  return refusal === undefined ? said : `${said} — requires ${refusal}`;
}

/**
 * Run one of this panel's actions, by id, and say so when it refuses.
 *
 * The `catch` is the point: `i18n.createTranslation` rejects when the file it would write is
 * already there, and a click that produced nothing and printed nothing would leave the author
 * looking at a grid that disagrees with the disk.
 */
function runByName(id: string, args: Record<string, unknown> = {}): void {
  const registry = activeRegistry();
  if (!registry?.get(id)) {
    return;
  }
  void Promise.resolve(registry.run(id, args)).catch((error: unknown) => {
    notify("error", errorMessage(error), { source: "Languages" });
  });
}

/**
 * One row of the projection: the row's key, and a square per declared locale with every decision
 * about it already taken.
 *
 * The path a row's commands are addressed by is the ROW's, not the square's — `rowSourcePath` picks
 * whichever file of the row actually exists — so every cell in a row carries the same `rowPath` and
 * differs only in the locale it asks for.
 */
function projectRow(row: ParityRow, i18n: ResolvedI18n): I18nParityRow {
  const rowPath = rowSourcePath(row, i18n);
  const cells: I18nParityCell[] = i18n.locales.map((locale) => {
    const cell: ParityCell = row.cells.get(locale) ?? { path: null, state: "missing" };
    const command = CELL_COMMAND[cell.state];
    const refusal = cellRefusal(cell, command);
    return {
      command,
      disabled: refusal !== undefined,
      glyph: CELL_GLYPH[cell.state],
      locale,
      rowPath,
      state: cell.state,
      title: cellTitle(cell, locale, refusal),
    };
  });
  return { cells, key: row.key };
}

/** How many squares are not yet a file, and how many are behind their source. */
function countCells(rows: readonly ParityRow[]): { missing: number; stale: number } {
  let missing = 0;
  let stale = 0;
  for (const row of rows) {
    for (const cell of row.cells.values()) {
      if (cell.state === "missing") {
        missing += 1;
      } else if (cell.state === "stale") {
        stale += 1;
      }
    }
  }
  return { missing, stale };
}

/** The one sentence above the grid: its size, and what is outstanding in it. */
function summaryText(rows: readonly ParityRow[]): string {
  const { missing, stale } = countCells(rows);
  const pages = `${rows.length} page${rows.length === 1 ? "" : "s"}`;
  if (missing === 0 && stale === 0) {
    return `${pages}, translated into every declared language.`;
  }
  const parts: string[] = [];
  if (missing > 0) {
    parts.push(`${missing} not written`);
  }
  if (stale > 0) {
    parts.push(`${stale} older than their source`);
  }
  return `${pages} — ${parts.join(", ")}.`;
}

/** An empty projection, so the two bodies that draw no grid do not have to spell one out. */
function blankValues(mode: I18nValues["mode"]): I18nValues {
  return {
    heads: [],
    incomplete: "",
    mode,
    rows: [],
    settingsDisabled: activeRegistry()?.get(SETTINGS_COMMAND) === undefined,
    summary: "",
    truncated: "",
  };
}

/**
 * What the surface should be showing right now.
 *
 * `getEffectiveLocales()` is read HERE, on every paint, rather than cached at module scope:
 * `projectState` is a plain binding replaced wholesale by `setProjectState`, so a locale added in
 * Settings reaches a cached copy never.
 */
function panelValues(ctx: NavigatorPanelContext): I18nValues {
  const i18n = getEffectiveLocales();
  if (i18n === null || i18n.locales.length < 2) {
    return blankValues("mono");
  }

  const root = projectState?.projectRoot ?? "";
  if (scanned === null || scanned.root !== root) {
    if (scanning !== root) {
      scanning = root;
      void takeScan(root, ctx.rerender);
    }
    return blankValues("scanning");
  }

  const rows = parityRows(scanned.files, i18n, scanned.declared);
  const shown = rows.slice(0, PARITY_ROW_LIMIT);
  const hidden = rows.length - shown.length;
  return {
    ...blankValues("grid"),
    heads: i18n.locales.map((locale) => ({
      isDefault: locale === i18n.defaultLocale,
      label: localeLabel(locale),
      locale,
    })),
    incomplete: scanned.failures.map((failure) => `${failure.dir} (${failure.error})`).join("; "),
    rows: shown.map((row) => projectRow(row, i18n)),
    summary: summaryText(rows),
    truncated:
      hidden > 0
        ? `${hidden} more page${hidden === 1 ? " is" : "s are"} not shown — the grid stops at ` +
          `${PARITY_ROW_LIMIT}.`
        : "",
  };
}

/**
 * Repaint the Navigator.
 *
 * Held at module scope rather than closed over at mount, because the standing surface outlives the
 * `NavigatorPanelContext` that mounted it and its Rescan button has to reach the CURRENT renderer.
 */
let rerender: () => void = () => {};

/** What the document's three controls do. Every one of them is a decision this module owns. */
const ACTIONS: I18nActions = {
  openSettings: () => {
    runByName(SETTINGS_COMMAND);
  },
  rescan: () => {
    refreshParityScan();
    rerender();
  },
  runCell: (command, locale, path) => {
    runByName(command, { locale, path });
  },
};

/**
 * The surface standing in the Navigator, and the node it was mounted into.
 *
 * One slot rather than a per-host map, because there is one Navigator: a mount into a DIFFERENT
 * node is the old one being replaced, and holding both would leave the first one's effects running
 * against a scope nobody writes any more.
 */
let standing: { host: HTMLElement; handle: I18nSurfaceHandle } | null = null;

/**
 * Draw the panel body — mounting the document the first time, updating it every time after.
 *
 * The document goes into `.panel-content`, not into the `.panel-body` this is handed. Both are
 * lit's, but only one of them is the node lit renders this panel's body INTO: a repaint commits
 * `nothing` there, which lit skips, and a switch to another panel commits that panel's template,
 * which clears to the end of the parent and takes this document with it. Appending to `.panel-body`
 * instead would survive the switch — and leave the parity grid drawn underneath the Files tree.
 */
export function mountI18nPanel(ctx: NavigatorPanelContext, host: HTMLElement): void {
  ({ rerender } = ctx);
  const container = host.querySelector<HTMLElement>(".panel-content") ?? host;
  if (standing && (standing.host !== container || !standing.handle.connected())) {
    standing.handle.dispose();
    standing = null;
  }
  const values = panelValues(ctx);
  if (standing) {
    standing.handle.update(values);
    return;
  }
  standing = { handle: mountI18nSurface(container, values, ACTIONS), host: container };
}

/**
 * Define the Languages panel.
 *
 * `level: "project"` because it writes project FILES, and its body therefore never reads `ctx.doc`
 * — `tests/panel-registry.test.ts` renders every project-level panel with `doc: null` and a deps
 * object whose document-level members throw.
 *
 * One caller: `panels/navigator-panels.ts`, which is the one place panel records are composed.
 */
export function registerI18nPanel(): void {
  registerPanel({
    id: "i18n",
    title: "Languages",
    level: "project",
    dock: "navigator",
    // Inert, like every other `rail: false` panel's: the glyph is only ever drawn by a rail
    // Button, and `check-icons.ts` fails on a resolver row no rail panel declares.
    icon: "globe",
    // OFF THE RAIL. `railDeclarations()` does not apply `when`, so a rail button would spend the
    // Last rail/project slot in every monolingual project — and would shift every document panel's
    // ⌘1-8 chord by one. `i18n.showParity` is how it is reached.
    rail: false,
    when: (ctx) => ctx.project.isMultilingual,
    // The body is a document, so lit draws nothing and the mount happens against the painted
    // DOM. `afterRender` runs on every repaint; {@link mountI18nPanel} is idempotent.
    render: (): PanelBody => nothing,
    afterRender: (ctx, host) => {
      mountI18nPanel(ctx, host);
    },
  });
}
