/**
 * What Studio calls an HTML element, in the reader's language: "Heading 1" for `h1`, "Bulleted
 * list" for `ul`, and the names of the Insert palette's categories (§5.3).
 *
 * **No web-platform database carries these names.** `@webref/elements` lists each element's tag and
 * interface and nothing a person reads, and MDN's translated pages are prose, not data. So the
 * names are Studio's own, kept as one catalog per language under `data/locales/<language>/`.
 * English (`data/locales/en/elements.json`) is the source: it names every tag the palette offers,
 * which `tests/locale-element-names.test.ts` holds it to, and a translation is a copy of that file
 * with its values translated and its keys left alone, registered in {@link CATALOGS}.
 *
 * **The language is the reader's, and Studio has no setting for it yet.** {@link studioLocale}
 * takes the first of the browser's preferred languages that has a catalog, by exact tag and then by
 * base language (`fr-CA` reads `fr`), and falls back to English. A name the chosen catalog lacks
 * falls back to the English one, and a tag no catalog knows is shown as itself, so a translation
 * can land incomplete and an element a future `@webref` release adds is never nameless.
 *
 * Three surfaces read this module, so they cannot disagree about a name: the Insert palette's
 * cards, the slash menu, and the block action bar's convert menu.
 *
 * @docs studio/design/elements
 */

import en from "../../data/locales/en/elements.json";

/** One element's entry: the name a card shows, and the line that says what it is for. */
export interface ElementEntry {
  name: string;
  description: string;
}

/** One language's catalog: category names by key, and element entries by tag. */
export interface ElementCatalog {
  categories: Readonly<Record<string, string>>;
  elements: Readonly<Record<string, ElementEntry>>;
}

/** The language every lookup falls back to, and the catalog that is complete by contract. */
export const SOURCE_LOCALE = "en";

/** The source catalog, read through the open shape every other catalog has. */
const SOURCE: ElementCatalog = en;

/**
 * Every catalog Studio ships, keyed by BCP 47 language tag. Adding a language is a new
 * `data/locales/<tag>/elements.json` and one entry here.
 */
const CATALOGS = new Map([[SOURCE_LOCALE, SOURCE]]);

/**
 * The best catalog for a list of preferred languages, most preferred first.
 *
 * Each preference is tried whole and then by its base language before the next one is, because a
 * reader who asked for Canadian French first wants French before their second choice. The match is
 * case-insensitive, as BCP 47 tags are.
 *
 * @param {readonly string[]} preferred - Language tags, most preferred first
 * @param {readonly string[]} available - The tags a catalog exists for
 * @returns {string} One of `available`, or {@link SOURCE_LOCALE}
 */
export function resolveLocale(
  preferred: readonly string[],
  available: readonly string[] = [...CATALOGS.keys()],
): string {
  const byLower = new Map(available.map((tag) => [tag.toLowerCase(), tag]));
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    const match = byLower.get(lower) ?? byLower.get(lower.split("-")[0] ?? "");
    if (match) {
      return match;
    }
  }
  return SOURCE_LOCALE;
}

/**
 * The browser's preferred languages, or none where there is no `navigator` to ask. Anything that is
 * not a non-empty string is dropped: an embedder or a privacy setting can blank the answer, and a
 * reader with no stated language gets English rather than an exception.
 */
function preferredLanguages(): readonly string[] {
  if (typeof navigator === "undefined") {
    return [];
  }
  /* SAFETY: the DOM typings promise both members, but a navigator outside a browser window (Bun's
     own, a worker's in some engines) lacks `languages`, so each is read as possibly absent and
     checked before use. */
  const { language, languages } = navigator as Partial<Pick<Navigator, "language" | "languages">>;
  const listed: readonly unknown[] = languages && languages.length > 0 ? languages : [language];
  return listed.filter((tag): tag is string => typeof tag === "string" && tag !== "");
}

/** The language Studio names elements in for this reader. */
export function studioLocale(): string {
  return resolveLocale(preferredLanguages());
}

/** The catalog for `locale`, or the source catalog when there is none. */
function catalog(locale: string): ElementCatalog {
  return CATALOGS.get(locale) ?? SOURCE;
}

/**
 * The name of the element `tag`: the catalog's, else the English one, else the tag itself.
 *
 * @param {string} tag
 * @param {string} [locale]
 */
export function elementName(tag: string, locale: string = studioLocale()): string {
  return catalog(locale).elements[tag]?.name ?? SOURCE.elements[tag]?.name ?? tag;
}

/**
 * What the element `tag` is for, in one line, or `""` when no catalog says.
 *
 * @param {string} tag
 * @param {string} [locale]
 */
export function elementDescription(tag: string, locale: string = studioLocale()): string {
  return catalog(locale).elements[tag]?.description ?? SOURCE.elements[tag]?.description ?? "";
}

/**
 * The name of the palette category `key` (§5.3), else the English one, else the key.
 *
 * @param {string} key
 * @param {string} [locale]
 */
export function categoryName(key: string, locale: string = studioLocale()): string {
  return catalog(locale).categories[key] ?? SOURCE.categories[key] ?? key;
}
