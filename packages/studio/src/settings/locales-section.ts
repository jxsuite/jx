/// <reference lib="dom" />
/**
 * Locales — the project's languages, its default, and how a locale appears in a URL.
 *
 * `project.json`'s `i18n` block was authorable only by hand: every other i18n surface in Studio
 * (the parity panel, the pane's locale companion, the translation verbs) reads a locale list
 * nothing in the app could write, so a project became multilingual in a text editor and only then
 * grew any of the affordances that make it worth being.
 *
 * **One write, two doors.** {@link addProjectLocale} is the whole of "declare a language" and the
 * `i18n.addLocale` command calls this function rather than repeating the patch — a second spelling
 * of the same merge is how the command and the form would come to disagree about what happens to
 * `defaultLocale` when the first locale is added.
 *
 * **The form is a document.** The markup and the styling are `surfaces/settings-locales.json`, its
 * mount is `surfaces/settings-locales.ts`, and what is left here is the part that was always this
 * module's: what the file says, what a tag is allowed to be, and what each edit writes back. The
 * section renderer is still `renderLocalesSection`, because a section is a contribution to
 * CONFIGURATION and the registry's seam does not move when the substrate under it does.
 *
 * @docs studio/projects/settings
 */

import { canonicalizeLocale, isWellFormedLocale, localeLabel } from "@jxsuite/schema/locale";
import { errorMessage } from "@jxsuite/schema/parse";
import { notify } from "../services/notify";
import { projectState } from "../store";
import { renderLocalesSurface } from "../surfaces/settings-locales";
import { updateSiteConfig } from "../site-context";
import type { LocalesActions, LocalesView } from "../surfaces/settings-locales";
import type { LocaleRouting } from "@jxsuite/schema/locale";
import type { ProjectConfig } from "@jxsuite/schema/types";

/**
 * The form beside the file: the tag being typed, and the last write that failed.
 *
 * Keyed by container so two mounted copies (and two tests) never share either — the same shape
 * `project-sections.ts` and `general-settings.ts` use for their own errors, and for the same
 * reason: these sections save on change, so a silent rejection would read as "my edit just
 * vanished". The pending tag is here rather than in the document because typing must survive the
 * section being redrawn from outside — a nav click, an extension registering — and a document that
 * remounts is a field that empties.
 */
interface Form {
  pending: string;
  error: string;
}

const forms = new WeakMap<HTMLElement, Form>();

/** This container's form, minted on first sight. */
function form(container: HTMLElement): Form {
  let state = forms.get(container);
  if (!state) {
    state = { error: "", pending: "" };
    forms.set(container, state);
  }
  return state;
}

/**
 * Persist a patch, surfacing the rejection instead of swallowing it.
 *
 * `updateSiteConfig` rejects on a failed write and the chokepoint has already filed the Problem, so
 * all that is left here is to keep the form honest about what is on disk. A bare `void
 * updateSiteConfig(...)` would drop the rejection and the field would silently snap back to the
 * value the file still holds.
 *
 * @param {HTMLElement} container
 * @param {Partial<ProjectConfig>} patch
 */
async function persist(container: HTMLElement, patch: Partial<ProjectConfig>): Promise<void> {
  try {
    await updateSiteConfig(patch);
    form(container).error = "";
  } catch (error) {
    form(container).error = `Could not save project.json — ${errorMessage(error)}`;
  }
  refresh(container);
}

/** The live project configuration, or an empty one before a project is open. */
function config(): ProjectConfig {
  return (projectState?.projectConfig ?? {}) as ProjectConfig;
}

/**
 * The patch that removes the whole `i18n` block.
 *
 * `undefined` survives the object spread inside `updateSiteConfig` and `JSON.stringify` then drops
 * the key, so removing the last locale leaves a project with no `i18n` at all rather than one
 * declaring an empty list — which `resolveI18n` reports as "declared with no usable locale", a
 * build error for a state the author reached by deleting things. The cast is the price of
 * `exactOptionalPropertyTypes`, the same one `general-settings.ts`'s `CLEAR_URL` pays.
 */
const CLEAR_I18N = { i18n: undefined } as unknown as Partial<ProjectConfig>;

/** The routing modes, with the sentence that says what each does to a URL. */
export const LOCALE_ROUTINGS: readonly { value: LocaleRouting; label: string }[] = [
  { label: "Prefix every locale but the default", value: "prefix-except-default" },
  { label: "Prefix every locale", value: "prefix-always" },
];

/**
 * The tags as the author wrote them, not as `resolveI18n` reports them.
 *
 * Reading the resolved list back would rewrite the file on the next save: `resolveI18n` unshifts a
 * `defaultLocale` that is missing from `locales` and canonicalizes the case of every entry, so a
 * patch built from it edits lines the author did not touch.
 */
function declaredLocales(): string[] {
  const raw = config().i18n?.locales;
  return Array.isArray(raw) ? raw.filter((tag): tag is string => typeof tag === "string") : [];
}

/** Whether `tag` names a language the project already declares, whatever case it was written in. */
function alreadyDeclared(tag: string): boolean {
  const canonical = canonicalizeLocale(tag);
  return declaredLocales().some((declared) => canonicalizeLocale(declared) === canonical);
}

/**
 * Add one tag to `i18n.locales` — the one write both this section and `i18n.addLocale` make.
 *
 * The patch spreads `config().i18n` because `commitProjectConfig` merges at the TOP LEVEL only: `{
 * i18n: { locales } }` replaces the block wholesale and takes `defaultLocale` and `routing` with
 * it, so a project that declared a default would silently lose it the first time a language was
 * added.
 *
 * Refusals are notified rather than thrown: the palette reports a rejected `run` to the console and
 * nowhere else, so a thrown refusal is one the author never sees. The form refuses both of them
 * before it gets here, with the reason under the field.
 *
 * @param {string} tag - A BCP 47 language tag, in any case.
 * @throws {Error} Whatever `updateSiteConfig` rejects with — the caller decides where a failed
 *   write shows.
 */
export async function addProjectLocale(tag: string): Promise<void> {
  const canonical = canonicalizeLocale(tag);
  if (canonical === null) {
    notify.error(`"${tag}" is not a well-formed language tag.`, {
      detail:
        "Languages are BCP 47 tags — a language, optionally a script and a region: `fr`, " +
        "`pt-BR`, `zh-Hant`. Underscores and spaces are not part of the grammar.",
      source: "Languages",
    });
    return;
  }
  if (alreadyDeclared(canonical)) {
    notify.info(`${localeLabel(canonical)} is already one of this project's languages.`, {
      source: "Languages",
    });
    return;
  }
  await updateSiteConfig({
    i18n: { ...config().i18n, locales: [...declaredLocales(), canonical] },
  });
}

/**
 * Why the pending tag cannot be added, or `""` when it can.
 *
 * Both refusals are stated while the author is typing rather than after the Add: a language tag is
 * the one field in this section whose value the author cannot check by looking at it, and "nothing
 * happened" is what a silently refused Add looks like.
 */
function pendingRefusal(container: HTMLElement): string {
  const tag = form(container).pending.trim();
  if (tag === "") {
    return "";
  }
  if (!isWellFormedLocale(tag)) {
    return `"${tag}" is not a well-formed language tag. Try \`fr\`, \`pt-BR\` or \`zh-Hant\`.`;
  }
  return alreadyDeclared(tag) ? `${localeLabel(tag)} is already declared.` : "";
}

/**
 * What the section shows right now.
 *
 * Read from `config()` at the moment of drawing rather than carried from the last one:
 * `projectState` is a plain module binding replaced wholesale on a project switch, and an extension
 * or the raw JSON editor can write `i18n` between two of these.
 */
function view(container: HTMLElement): LocalesView {
  const locales = declaredLocales();
  const { i18n } = config();
  const { error, pending } = form(container);
  return {
    defaultLocale: i18n?.defaultLocale ?? locales[0] ?? "",
    error,
    localeOptions: locales.map((tag) => ({ label: localeLabel(tag), value: tag })),
    locales: locales.map((tag) => ({ label: localeLabel(tag), tag })),
    pending,
    refusal: pendingRefusal(container),
    routing: i18n?.routing ?? "prefix-except-default",
    routings: LOCALE_ROUTINGS.map((mode) => ({ label: mode.label, value: mode.value })),
  };
}

/** Re-read the file and the form, and let the surface reconcile. */
function refresh(container: HTMLElement): void {
  renderLocalesSurface(container, view(container), actions(container));
}

/** Add the pending tag, if it is one this project can take. */
function add(container: HTMLElement): void {
  const tag = form(container).pending.trim();
  if (tag === "" || pendingRefusal(container) !== "") {
    return;
  }
  form(container).pending = "";
  void persist(container, {
    i18n: { ...config().i18n, locales: [...declaredLocales(), canonicalizeLocale(tag)!] },
  });
}

/** Drop a language, and the block itself when it was the last one. */
function remove(container: HTMLElement, tag: string): void {
  const kept = declaredLocales().filter((declared) => declared !== tag);
  if (kept.length === 0) {
    /* The last language leaves with the block. An `i18n` holding an empty `locales` is a build
       error (`resolveI18n`: "declared with no usable locale"), so removing the last row would
       otherwise break the build of a project that is once again ordinary and monolingual. */
    void persist(container, CLEAR_I18N);
    return;
  }
  const current = config().i18n;
  /* A `defaultLocale` naming a locale that is no longer declared does not go away — `resolveI18n`
     puts it BACK at the head of the list, so deleting the default row without this would delete
     nothing and reorder the rest. */
  const orphaned =
    current?.defaultLocale !== undefined &&
    canonicalizeLocale(current.defaultLocale) === canonicalizeLocale(tag);
  void persist(container, {
    i18n: { ...current, ...(orphaned ? { defaultLocale: kept[0]! } : {}), locales: kept },
  });
}

/**
 * What the reader may do, bound to one container.
 *
 * Memoized per container so the surface is handed the same functions every time: they are read
 * once, when it mounts, and a fresh set on every refresh would be a scope write that says nothing.
 */
const bound = new WeakMap<HTMLElement, LocalesActions>();

function actions(container: HTMLElement): LocalesActions {
  let acts = bound.get(container);
  if (!acts) {
    acts = {
      add: () => {
        add(container);
      },
      chooseDefault: (value: string) => {
        void persist(container, { i18n: { ...config().i18n, defaultLocale: value } });
      },
      chooseRouting: (value: string) => {
        void persist(container, {
          i18n: { ...config().i18n, routing: value as LocaleRouting },
        });
      },
      edit: (value: string) => {
        /* Every keystroke, with no verdict check in front of it. The lit form re-rendered only when
           the refusal CHANGED, because redrawing pushed `.value` back into the field mid-word; the
           document writes the same string the field already holds and `jx-textfield` leaves the
           caret where it is, so the guard has nothing left to protect. */
        form(container).pending = value;
        refresh(container);
      },
      remove: (tag: string) => {
        remove(container, tag);
      },
    };
    bound.set(container, acts);
  }
  return acts;
}

/**
 * The project's languages, its default, and how a locale is spelled in a URL.
 *
 * @param {HTMLElement} container
 */
export function renderLocalesSection(container: HTMLElement): void {
  refresh(container);
}
