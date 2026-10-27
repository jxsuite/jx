/**
 * What the packaged application's backend is made of.
 *
 * The backend (`src/hub/main.ts`) is one Bun entry that inlines the whole JavaScript graph of
 * `@jxsuite/server`, `/create`, `/compiler` and the rest into `resources/backend/index.js`, which
 * the app runs under the Bun it carries in `resources/bun`. Two facts about that file are easy to
 * get wrong, so they are written down once, here, for `stage-app.ts` to use and the tests to hold:
 *
 * - Some modules cannot be inlined and are not needed: the prettier plugins are optional formats the
 *   code service reaches by `import()` and answers "not installed" for when they are absent. They
 *   stay external. `package.nix`'s `resolveExternals` is the same list, because its install check
 *   bundles the same entry, and `tests/nix-bundle-completeness.test.ts` holds the two equal.
 * - Inlined modules that read their own data files do it relative to `import.meta.dirname`, which in
 *   a bundle is the directory of `index.js`. The directories they read are staged beside it at
 *   exactly the names below.
 * - A few modules are resolved BY NAME at run time, from the backend's own directory, because what
 *   they find is files to serve rather than code to run: the compiler asks whether `lit-html` and
 *   `@vue/reactivity` resolve so it can copy them into a built site's `/assets`, and falls back to
 *   a third-party CDN (which a `default-src 'self'` policy blocks) when they do not. They are
 *   staged as a `node_modules` beside the bundle, closed under their own dependencies.
 *
 * `scripts/smoke-backend.ts` starts the staged result and proves each of these paths works, because
 * a source tree that passes its tests says nothing about a bundle.
 */

/** Modules the backend bundle leaves out. */
export const BACKEND_EXTERNALS = [
  "@prettier/plugin-oxc",
  "@prettier/plugin-hermes",
  "@prettier/plugin-pug",
  "prettier-plugin-astro",
  "prettier-plugin-svelte",
  "prettier-plugin-marko",
  "@zackad/prettier-plugin-twig",
  "@shopify/prettier-plugin-liquid",
  "@astrojs/compiler-rs",
] as const;

/**
 * Static data `@jxsuite/create` and `@jxsuite/starters` read relative to their own location: each
 * is a file or directory staged beside the backend bundle, `from` relative to `packages/desktop`
 * and `to` relative to the directory `index.js` is in.
 */
export const BACKEND_DATA: readonly { from: string; to: string }[] = [
  { from: "../create/template", to: "template" },
  { from: "../create/templates", to: "templates" },
  { from: "../starters/registry.json", to: "registry.json" },
  { from: "../starters/sites", to: "sites" },
  { from: "../catalog/catalog.json", to: "catalog.json" },
];

/** Packages staged as `node_modules/<name>` beside the bundle, for the by-name resolution above. */
export const BACKEND_MODULES = ["@vue/reactivity", "@vue/shared", "lit-html"] as const;
