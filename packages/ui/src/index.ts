/**
 * `@jxsuite/ui` — register the kit's elements into the current realm, with no network.
 *
 * The kit ships JSON sources, not compiled classes. `registerUi()` preloads every document under
 * its `jx-ui:/components/<tag>.json` URL and every behaviour module under the specifier the
 * documents spell in `$src`, then defines each element through the runtime's own `defineElement`. A
 * document's `$elements` and `$src` therefore resolve exactly as they would from a server, and the
 * bundler saw every file (embedding.md §6).
 *
 * @docs extending/ui-kit
 */
import { defineElement, preloadDocument, preloadModule } from "@jxsuite/runtime";
import * as menu from "./behaviors/menu.ts";
import { documents } from "./documents.ts";
import * as icons from "./icons.ts";
import { installTheme } from "./theme.ts";

export { documents, KIT_TAGS } from "./documents.ts";
export { hasIcon, ICON_NAMES, ICON_WEIGHTS, iconPath, iconViewBox } from "./icons.ts";
export type { IconWeight } from "./icons.ts";
export {
  installTheme,
  THEME_LAYER,
  themeCSS,
  themeInstalled,
  themeTokenNames,
  themeTokens,
} from "./theme.ts";

/** The base every kit document resolves its references against. */
export const KIT_BASE = "jx-ui:/components/";

/** Behaviour modules, under the `$src` specifiers the documents use. */
export const KIT_MODULES: Readonly<Record<string, Record<string, unknown>>> = {
  "jx-ui:/behaviors/menu.ts": menu,
  "jx-ui:/icons.ts": icons,
};

export interface RegisterUiOptions {
  /** Adopt the theme into the document as well. Default is true. */
  theme?: boolean;
  /** The document to adopt the theme into. Default is the global document. */
  document?: Document;
}

let registration: Promise<void> | null = null;

/**
 * Define every kit element in this realm, once. Idempotent: later calls return the same promise.
 *
 * @param {RegisterUiOptions} [options]
 * @returns {Promise<void>} Settles when every element is defined
 */
export function registerUi(options: RegisterUiOptions = {}): Promise<void> {
  if (options.theme !== false) {
    installTheme(options.document);
  }
  registration ??= (async () => {
    for (const [specifier, mod] of Object.entries(KIT_MODULES)) {
      preloadModule(specifier, mod);
    }
    for (const [tag, doc] of Object.entries(documents)) {
      preloadDocument(`${KIT_BASE}${tag}.json`, doc);
    }
    for (const doc of Object.values(documents)) {
      await defineElement(doc, KIT_BASE);
    }
  })();
  return registration;
}
