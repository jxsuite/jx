/// <reference lib="dom" />
/**
 * Contexts — the ONE place a project's rendering contexts are defined (plan §4.2, §2 principle 5).
 *
 * A rendering context is anything the document can be resolved _under_: a size breakpoint, a colour
 * scheme, a feature query. All three are the same thing on disk — one entry in `project.json`'s
 * `$media` map — and until this section existed they were **defined in four places**, none of which
 * said "context" and only one of which said "breakpoint":
 *
 * 1. The New Project wizard's four breakpoint presets, described by media-query direction;
 * 2. Settings › General's "Breakpoints" field;
 * 3. Properties › Media, which renders **only when the document root is selected** — so adding a
 *    breakpoint cost you your element selection, the Style tab's scope, and your place;
 * 4. The CSS Variables editor's "Enable dark scheme" button, which appended `'--dark':
 *    '(prefers-color-scheme: dark)'` to `$media` **without ever using the word breakpoint**, so the
 *    one control that created a colour scheme was filed under variables.
 *
 * All four are gone. §2 principle 5 is why: **definition and selection are different levels.** The
 * pane context bar's Rendering-context control _selects_ among these; its popover's footer is
 * "Manage contexts…", which opens this section. Nothing here selects, and nothing there defines.
 *
 * **This section writes the project, not the document.** Per-document `$media` overlays still merge
 * at render time (`site-context.ts`'s `getEffectiveMedia`) and the on-disk format is unchanged —
 * what moved is the authoring surface, from a panel that required a selection to a settings section
 * that requires only a project.
 *
 * Failures are surfaced, not swallowed: every write runs through {@link persistMedia}, which
 * schema-validates the candidate `project.json` with `jx-validate` first (the human editing this
 * file used to get **no validation at all** — that was wired to the AI's `write_project_config`
 * alone), parks any rejection under the control that caused it, and re-projects. §7.1's third tier:
 * a bad value belongs at its control, not in a toast that expires.
 *
 * **The markup is `surfaces/settings-contexts.json`.** This module is the section's decisions —
 * what a context is, what refuses one, and what reaches disk — and the surface adapter beside that
 * document owns the mount. The registry seam did not move: `renderContextsSection` is still the
 * `render(container)` a `SettingsSection` declares, and it is still called again for every change
 * the host notices. What changed underneath is that a call is now a PROJECTION rather than a
 * repaint: the reactive scope takes the new view and the runtime touches the rows that differ,
 * where the lit version rebuilt the whole section on every keystroke's write.
 *
 * @docs studio/projects/settings
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { projectState } from "../store";
import { updateSiteConfig } from "../site-context";
import { validateProjectConfig } from "../services/jx-validate";
import { isSchemeQuery, schemeOfQuery } from "../utils/canvas-media";
import { mediaDisplayName } from "../panels/shared";
import { mountContextsSurface } from "../surfaces/settings-contexts";

import type {
  ContextGroupView,
  ContextRowView,
  ContextsSurfaceHandle,
  ContextsView,
} from "../surfaces/settings-contexts";
import type { ProjectConfig } from "@jxsuite/schema/types";

/** The `$media` key the base width lives under. Not a query — a number of CSS pixels. */
const BASE_KEY = "--";

/** What a new size breakpoint starts as. Narrow-first, because `--` is the widest canvas. */
const NEW_BREAKPOINT_QUERY = "(max-width: 768px)";

/** What a new feature query starts as — a real query, so the row is valid the moment it exists. */
const NEW_FEATURE_QUERY = "(prefers-reduced-motion: reduce)";

/** The three kinds of context, in the order they are defined and rendered. */
export type ContextKind = "size" | "scheme" | "feature";

/** One `$media` entry, classified. */
export interface ContextEntry {
  key: string;
  query: string;
  kind: ContextKind;
}

/**
 * Which kind of context an entry is.
 *
 * The classification is the same one the canvas makes (`utils/canvas-media.ts`) so a row defined
 * here lands in the group the pane context bar will show it in — a size breakpoint gets a canvas
 * width, a scheme query drives the Auto/Light/Dark segment, and everything else is a plain toggle.
 * Deriving it from the query rather than storing it is what keeps the on-disk format unchanged.
 *
 * @param {string} query
 * @returns {ContextKind}
 */
export function contextKindOf(query: string): ContextKind {
  if (isSchemeQuery(query)) {
    return "scheme";
  }
  return /(?:min|max)-width:/.test(query) ? "size" : "feature";
}

/**
 * Split a `$media` map into the base width and the three context groups.
 *
 * @param {Record<string, string> | undefined} media
 * @returns {{ base: string; entries: ContextEntry[] }}
 */
export function splitContexts(media?: Record<string, string> | undefined): {
  base: string;
  entries: ContextEntry[];
} {
  const source = media ?? {};
  const entries: ContextEntry[] = [];
  for (const [key, raw] of Object.entries(source)) {
    if (key === BASE_KEY) {
      continue;
    }
    const query = String(raw);
    entries.push({ key, kind: contextKindOf(query), query });
  }
  return { base: String(source[BASE_KEY] ?? ""), entries };
}

/**
 * The `$media` key a typed name becomes: `Wide screen` → `--wide-screen`.
 *
 * Typing the leading dashes is allowed but never required — the dashes are a storage detail of the
 * CSS custom-property namespace `$media` shares, and §8.4 says a definition surface may not make
 * the user spell one.
 *
 * @param {string} name
 * @returns {string}
 */
export function contextKeyOf(name: string): string {
  const slug = name
    .trim()
    .replace(/^-+/, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug ? `--${slug}` : "";
}

// ─── The three groups ─────────────────────────────────────────────────────────

/** A group's fixed half: its words, and what its add button creates. */
interface GroupSpec {
  kind: ContextKind;
  label: string;
  desc: string;
  addLabel: string;
  empty: string;
  /** The `--<stem>` an added entry is named after, before de-duplication. */
  stem: string;
  /** The query an added entry starts as — always a real one, never a blank to fill in. */
  newQuery: string;
}

/**
 * The groups, in render order.
 *
 * A table rather than three call sites, because the only thing that differed between them in the
 * lit version was seven strings and a control choice — and the control choice is derived from the
 * kind, so there was nothing left for a hand-written group to decide.
 */
const GROUPS: readonly GroupSpec[] = [
  {
    addLabel: "Add breakpoint",
    desc: "Screen widths that get their own canvas and their own style values.",
    empty: "No breakpoints yet — every width uses the base styles.",
    kind: "size",
    label: "Size breakpoints",
    newQuery: NEW_BREAKPOINT_QUERY,
    stem: "breakpoint",
  },
  {
    addLabel: "Add colour scheme",
    desc: "Light and dark renderings. Defining one turns on the Auto / Light / Dark control.",
    empty: "No colour schemes yet — the project renders one way.",
    kind: "scheme",
    label: "Colour schemes",
    newQuery: "(prefers-color-scheme: dark)",
    stem: "dark",
  },
  {
    addLabel: "Add feature query",
    desc: "Anything else a media query can ask: reduced motion, print, hover, orientation.",
    empty: "No feature queries yet.",
    kind: "feature",
    label: "Feature queries",
    newQuery: NEW_FEATURE_QUERY,
    stem: "feature",
  },
];

// ─── Per-container error state ────────────────────────────────────────────────

/**
 * Where an error belongs. A `$media` key addresses the row it came from; `"base"` is the base-width
 * field and `"section"` is a whole-file write failure with no single guilty control.
 */
type ErrorTarget = string;

/**
 * The last failure, per rendered container.
 *
 * Keyed by container so two mounted copies (and two tests) never share a message — the same reason
 * `general-settings.ts` does it. One at a time is deliberate: settings persist on change, so there
 * is exactly one write in flight and exactly one thing that just went wrong.
 */
const errors = new WeakMap<HTMLElement, { target: ErrorTarget; message: string }>();

/**
 * Schema errors the file already had when this section last wrote to it.
 *
 * Reported at section level rather than under a control, because they belong to no control — and
 * kept per container for the same reason {@link errors} is. Populated by the first write, since
 * validating on every render would compile a schema for a section nobody is editing.
 */
const inheritedErrors = new WeakMap<HTMLElement, string[]>();

/** The mounted surface, per container — see {@link renderContextsSection}. */
const mounts = new WeakMap<HTMLElement, ContextsSurfaceHandle>();

/** Read the current failure for a container — exported for tests and for re-render helpers. */
export function contextsError(container: HTMLElement): { target: string; message: string } | null {
  return errors.get(container) ?? null;
}

// ─── The project, as it stands now ────────────────────────────────────────────

/**
 * The config and its `$media`, read at the moment they are needed.
 *
 * The lit version closed over both at render time and rebuilt every handler on every render, so a
 * stale closure was impossible only because there were no long-lived ones. The handlers now outlive
 * a projection, which makes reading through to the store the thing that keeps them honest.
 */
function currentConfig(): ProjectConfig {
  return (projectState?.projectConfig || {}) as ProjectConfig;
}

function currentMedia(): Record<string, string> {
  return (currentConfig().$media || {}) as Record<string, string>;
}

// ─── Writing ──────────────────────────────────────────────────────────────────

/** Park a failure under one control without writing anything. */
function reject(container: HTMLElement, target: ErrorTarget, message: string): void {
  errors.set(container, { message, target });
  renderContextsSection(container);
}

/**
 * Write a whole `$media` map, validating it first and surfacing whatever refuses it.
 *
 * Both failure modes are real and both used to be invisible here: the schema can refuse the shape,
 * and the disk can refuse the write. The predecessor surfaces (`Properties › Media` and the
 * CSS-variables "Enable dark scheme") did `void updateSiteConfig(...)` and dropped the rejection,
 * so a failed write read as the field snapping back for no reason.
 *
 * **Only the errors THIS edit introduces block it.** The candidate is the whole `project.json`, so
 * a violation anywhere else in the file used to refuse every context edit and park the reason under
 * whichever control had been touched — typing `1280px` into Base width reported three
 * unevaluated-property errors about `title`, `description` and `$style`, none of which is a width.
 * The baseline is validated first and subtracted, the same way `services/ai-tools.ts` subtracts it
 * before blaming the model for a document it inherited. A pre-existing problem is still worth
 * saying, so it is reported once at section level, where a whole-file problem belongs — and it is
 * reported rather than repaired, because `project.json` is the author's file and a settings screen
 * that silently drops keys it did not recognise is worse than one that names them.
 */
async function persistMedia(
  container: HTMLElement,
  next: Record<string, string>,
  target: ErrorTarget,
): Promise<void> {
  const config = currentConfig();
  const candidate = { ...config, $media: next } as unknown;
  let schemaErrors: string[] = [];
  let inherited: string[] = [];
  try {
    inherited = await validateProjectConfig(config);
    const found = await validateProjectConfig(candidate);
    schemaErrors = found.filter((error) => !inherited.includes(error));
  } catch (error) {
    /* A validator that cannot compile must not block the edit — but it must not be silent either,
       so the message rides the same inline slot the schema errors would have used. */
    reject(container, target, `Could not validate project.json — ${errorMessage(error)}`);
    return;
  }
  if (schemaErrors.length > 0) {
    reject(container, target, schemaErrors.join("; "));
    return;
  }
  inheritedErrors.set(container, inherited);
  try {
    await updateSiteConfig({ $media: next });
    errors.delete(container);
  } catch (error) {
    errors.set(container, {
      message: `Could not save project.json — ${errorMessage(error)}`,
      target,
    });
  }
  renderContextsSection(container);
}

/** What every control in one container does. Built once, and read through to the store. */
function actionsFor(container: HTMLElement): Parameters<typeof mountContextsSurface>[1] {
  return {
    /** Add an entry under the first free `--<stem>` / `--<stem>-2` … name. */
    add(kind) {
      const spec = GROUPS.find((group) => group.kind === kind);
      if (!spec) {
        return;
      }
      const media = currentMedia();
      let key = `--${spec.stem}`;
      let n = 2;
      while (key in media) {
        key = `--${spec.stem}-${n}`;
        n += 1;
      }
      void persistMedia(container, { ...media, [key]: spec.newQuery }, key);
    },
    remove(key) {
      const next = { ...currentMedia() };
      delete next[key];
      void persistMedia(container, next, "section");
    },
    rename(oldKey, value) {
      const media = currentMedia();
      const newKey = contextKeyOf(value);
      if (!newKey) {
        reject(container, oldKey, "A context needs a name.");
        return;
      }
      if (newKey === oldKey) {
        return;
      }
      if (newKey in media) {
        reject(container, oldKey, `"${mediaDisplayName(newKey)}" is already defined.`);
        return;
      }
      /* Rebuild in place so renaming never reorders the list — the order is the order the pane
         context bar offers them in, and a rename is not a reordering. */
      const next: Record<string, string> = {};
      for (const [key, entry] of Object.entries(media)) {
        next[key === oldKey ? newKey : key] = entry;
      }
      void persistMedia(container, next, newKey);
    },
    setBase(value) {
      const width = value.trim();
      if (width && !/^\d+px$/.test(width)) {
        reject(container, "base", "Enter a width in pixels, like 1280px.");
        return;
      }
      const next = { ...currentMedia() };
      if (width) {
        next[BASE_KEY] = width;
      } else {
        delete next[BASE_KEY];
      }
      void persistMedia(container, next, "base");
    },
    setQuery(key, value) {
      const query = value.trim();
      if (!query) {
        reject(container, key, "A context needs a media query, like (max-width: 768px).");
        return;
      }
      void persistMedia(container, { ...currentMedia(), [key]: query }, key);
    },
    /** The scheme picker writes the canonical query, so a scheme is never mistyped into a feature. */
    setScheme(key, scheme) {
      void persistMedia(
        container,
        { ...currentMedia(), [key]: `(prefers-color-scheme: ${scheme})` },
        key,
      );
    },
  };
}

// ─── Projection ───────────────────────────────────────────────────────────────

/** One `$media` entry, as the document draws it. */
function rowView(
  entry: ContextEntry,
  shown: { target: ErrorTarget; message: string } | undefined,
): ContextRowView {
  const display = mediaDisplayName(entry.key);
  const invalid = shown?.target === entry.key;
  return {
    control: entry.kind === "scheme" ? "scheme" : "query",
    error: invalid ? shown.message : "",
    invalid,
    key: entry.key,
    name: entry.key.replace(/^--/, ""),
    nameLabel: `Name for ${display}`,
    query: entry.query,
    removeLabel: `Remove ${display}`,
    scheme: schemeOfQuery(entry.query) ?? "dark",
    valueLabel:
      entry.kind === "scheme" ? `Colour scheme for ${display}` : `Media query for ${display}`,
  };
}

/**
 * What the file already got wrong, said once and not blamed on a control.
 *
 * It does not block anything — the edit that surfaced it went through. It is here because a file
 * that fails its own schema will keep failing it, and until this notice existed the only place that
 * fact appeared was as an unexplained refusal of an unrelated field.
 */
function noticeOf(inherited: readonly string[]): string {
  if (inherited.length === 0) {
    return "";
  }
  const what = inherited.length === 1 ? "problem" : "problems";
  return `project.json has ${inherited.length} pre-existing schema ${what} that this section did not cause: ${inherited.join("; ")}`;
}

/** The whole section, as one value the document can be handed. */
function project(container: HTMLElement): ContextsView {
  const shown = errors.get(container);
  const { base, entries } = splitContexts(currentMedia());
  const groups: ContextGroupView[] = GROUPS.map((spec) => {
    const rows = entries
      .filter((entry) => entry.kind === spec.kind)
      .map((entry) => rowView(entry, shown));
    return {
      addLabel: spec.addLabel,
      desc: spec.desc,
      empty: spec.empty,
      hasRows: rows.length > 0,
      kind: spec.kind,
      label: spec.label,
      rows,
    };
  });
  return {
    base,
    baseError: shown?.target === "base" ? shown.message : "",
    baseInvalid: shown?.target === "base",
    groups,
    notice: noticeOf(inheritedErrors.get(container) ?? []),
    queryPlaceholder: NEW_BREAKPOINT_QUERY,
    sectionError: shown?.target === "section" ? shown.message : "",
  };
}

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * Render Project Settings › Contexts into `container`.
 *
 * One mount per container, re-used for every subsequent call. The host calls this again for any
 * change it notices, and a section whose container has meanwhile been given to a DIFFERENT section
 * finds its document gone — `litRender` into the same node replaces everything in it — so the mount
 * is rebuilt exactly when it has actually been evicted, and disposed on the way out rather than
 * left running over detached nodes.
 *
 * @param {HTMLElement} container
 */
export function renderContextsSection(container: HTMLElement): void {
  let handle = mounts.get(container);
  if (!handle?.attached()) {
    handle?.dispose();
    handle = mountContextsSurface(container, actionsFor(container));
    mounts.set(container, handle);
  }
  handle.update(project(container));
}
