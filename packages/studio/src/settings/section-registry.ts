/**
 * The Project Settings section registry, and which of its sections the document is showing.
 *
 * `registerSettingsSection` is a **preserved public contract** (specs/extensions.md §9.1): an
 * extension's `project` class declares a `$studio.settings` block and `settings/extension-sections`
 * turns it into one of these records. Project Settings has moved host twice — a modal, then a
 * document in the pane, and now a dialog again (§17.1) — and the registry moved with neither,
 * because a section is a contribution to CONFIGURATION, not to whatever draws it. Splitting it out
 * is what lets the host be replaced without the contribution point being touched.
 *
 * **This module holds no renderer and imports nothing.** That is load-bearing rather than tidy: the
 * gear menu (`panels/settings-menu.ts`) enumerates these sections from the top bar, so anything
 * this module imports becomes part of the chrome's import graph. The section RENDERERS are
 * registered by `settings/settings-document.ts`, which the app loads when it registers its
 * commands.
 *
 * **What is requested and what is displayed are two variables, and unregistering touches neither.**
 * The modal had one, and its `unregisterSettingsSection` reset it to `"general"` — which is half of
 * the deep-link race `settings.open { section, entry }` (§17.1) exists to close. The contribution
 * sync unregisters stale keys before it registers fresh ones, so a section merely being REFRESHED
 * took the caller's requested section down with it, silently, after the awaited readiness promise
 * had already resolved. Here a request outlives its section going away and is satisfied the moment
 * the key comes back.
 */

/**
 * The three groups the Project Settings nav is drawn in (§17.1), in display order.
 *
 * - **General** is what every author sets: the site's name, address and icon, and its languages.
 * - **Integrations** is what an extension adds, and so where every contributed section lands unless
 *   it says otherwise (`specs/extensions.md` §9.1, `group`).
 * - **Advanced** is the project's machinery, marked "For developers": rendering contexts, the site
 *   head, data shapes, packages and the raw file.
 *
 * `intro` is the sentence the body opens with while a section of that group is showing: what the
 * group is FOR, so the reader learns that Advanced is the risky one from a sentence rather than
 * from a two-word qualifier. General's sections need no preamble, so it has none.
 */
export const SETTINGS_GROUPS = [
  { id: "general", intro: "", label: "General", note: "" },
  {
    id: "integrations",
    intro: "Turn on what your site needs. Each one adds its own options where you use it.",
    label: "Integrations",
    note: "",
  },
  {
    id: "advanced",
    intro: "Changes here affect every page. Most sites never need them.",
    label: "Advanced",
    note: "For developers",
  },
] as const;

/** A settings group's id. */
export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]["id"];

/** Where a section with no `group` is listed: the extension default `extensions.md` §9.1 names. */
export const DEFAULT_SETTINGS_GROUP: SettingsGroupId = "integrations";

/**
 * Whether a value names one of {@link SETTINGS_GROUPS}.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSettingsGroupId(value: unknown): value is SettingsGroupId {
  return SETTINGS_GROUPS.some((group) => group.id === value);
}

/** A Project Settings section: an inner-nav entry plus a renderer for the content area. */
export interface SettingsSection {
  key: string;
  label: string;
  /** Which nav group lists the section. Absent means {@link DEFAULT_SETTINGS_GROUP}. */
  group?: SettingsGroupId | undefined;
  /**
   * Nav icon name (reserved for future nav treatments).
   *
   * A KEY into the kit's glyph manifest (`@jxsuite/ui/icons`), the same space `PanelRecord.icon`
   * resolves in — never a tag. A key with no row is not a missing element, it is zero nodes
   * (`studio.md` §13.5), so a wrong name here is silent in both directions: silent now because
   * nothing draws it, and silent later because `jx-icon` falls back to nothing.
   */
  icon?: string | undefined;
  /** Sort position — lower orders render higher in the inner nav. */
  order: number;
  /**
   * Draw the section into `container`. A renderer that returns a promise is awaited, so a section
   * whose first paint needs IO fails where the reader is looking: a rejection, like a throw, is
   * shown in the body in place of the section (`panels/settings-pane.ts`).
   */
  render: (container: HTMLElement) => void | Promise<void>;
}

/** Where a settings document lands when nobody named a section. */
export const DEFAULT_SETTINGS_SECTION = "overview";

const sections = new Map<string, SettingsSection>();

const listeners = new Set<() => void>();

/**
 * Tell every subscriber something changed.
 *
 * A `Set` tolerates deletion during its own iteration, so a listener that unsubscribes itself (the
 * pane host, on unmount) is safe without copying.
 */
function announce(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Redraw the settings document — for a change this module cannot see, such as a command selecting
 * an entry inside the section that is already on screen.
 */
export function notifySettingsDocument(): void {
  announce();
}

/**
 * Subscribe to everything that changes what the settings document draws: the section set (an
 * extension registering or going away) and the chosen section. Returns the unsubscribe.
 *
 * @param {() => void} listener
 * @returns {() => void}
 */
export function onSettingsDocumentChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register (or replace) a settings section.
 *
 * @param {SettingsSection} section
 */
export function registerSettingsSection(section: SettingsSection): void {
  sections.set(section.key, section);
  announce();
}

/**
 * Remove a registered section — used when a descriptor-contributed section's extension is disabled
 * (see ./extension-sections). Built-ins are never unregistered.
 *
 * @param {string} key
 */
export function unregisterSettingsSection(key: string): void {
  if (sections.delete(key)) {
    announce();
  }
}

/** Registered sections sorted by order (registration order breaks ties). */
export function sortedSettingsSections(): SettingsSection[] {
  return [...sections.values()].toSorted((a, b) => a.order - b.order);
}

/** One nav group and the sections listed under it. */
export interface SettingsSectionGroup {
  id: SettingsGroupId;
  label: string;
  /** A qualifier drawn beside the label ("For developers"), or the empty string. */
  note: string;
  /** What the body opens with while one of this group's sections shows, or the empty string. */
  intro: string;
  sections: SettingsSection[];
}

/**
 * The registered sections in their nav groups: groups in {@link SETTINGS_GROUPS} order, sections in
 * `order` within each. A group with no section is left out, so an empty heading is never drawn.
 *
 * @returns {SettingsSectionGroup[]}
 */
export function groupedSettingsSections(): SettingsSectionGroup[] {
  const sorted = sortedSettingsSections();
  return SETTINGS_GROUPS.flatMap((group) => {
    const listed = sorted.filter(
      (section) => (section.group ?? DEFAULT_SETTINGS_GROUP) === group.id,
    );
    return listed.length === 0
      ? []
      : [
          {
            id: group.id,
            intro: group.intro,
            label: group.label,
            note: group.note,
            sections: listed,
          },
        ];
  });
}

/**
 * Every registered section key, built-ins and contributions alike, in display order.
 *
 * Display order is the GROUPED order (General, then Integrations, then Advanced), so the gear's
 * submenu and a refusal naming the registered keys list them as the reader sees them.
 *
 * @returns {string[]}
 */
export function settingsSectionKeys(): string[] {
  return groupedSettingsSections().flatMap((group) => group.sections.map((section) => section.key));
}

/**
 * One section by key, or `undefined`.
 *
 * @param {string} key
 * @returns {SettingsSection | undefined}
 */
export function settingsSection(key: string): SettingsSection | undefined {
  return sections.get(key);
}

// ─── Which section is on screen ───────────────────────────────────────────────

/** The section the last caller ASKED for, kept until it is satisfied. */
let _requested: string | null = null;

/** The section the document is drawing. Only a nav click and a satisfied request move it. */
let _displayed = DEFAULT_SETTINGS_SECTION;

/**
 * The section key the document should render right now.
 *
 * A pending request wins as soon as its section exists. Otherwise the displayed one, and — when
 * that has been unregistered too — the first section there is, so the content area is never blank
 * because of bookkeeping.
 *
 * @returns {string}
 */
export function settingsDocumentSection(): string {
  if (_requested !== null && sections.has(_requested)) {
    _displayed = _requested;
    _requested = null;
    return _displayed;
  }
  if (sections.has(_displayed)) {
    return _displayed;
  }
  return settingsSectionKeys()[0] ?? _displayed;
}

/**
 * Show a section. A nav click satisfies itself immediately; a deep link to a section that has not
 * registered yet is remembered until it does.
 *
 * @param {string} key
 */
export function setSettingsSection(key: string): void {
  if (sections.has(key)) {
    _displayed = key;
    _requested = null;
  } else {
    _requested = key;
  }
  announce();
}

/** Forget the chosen section — the project-close and test hook. */
export function resetSettingsDocumentState(): void {
  _requested = null;
  _displayed = DEFAULT_SETTINGS_SECTION;
}
