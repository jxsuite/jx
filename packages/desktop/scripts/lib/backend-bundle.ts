/**
 * What the packaged application's backend is made of, and the one function that makes it.
 *
 * The backend (`src/hub/main.ts`) is one ESM bundle, `index.js`, that inlines the JavaScript graph
 * of `@jxsuite/server`, `/create`, `/compiler` and the rest, and runs on the Node inside Electron
 * as a utility process (specs/desktop.md §7.1, §9.7). It is built for `target: "node"` with the
 * default export conditions, so every runtime seam (`#serve`, `#bundler-backend`) resolves to its
 * Node side and the bundle holds no Bun code; `tests/backend-bundle.test.ts` fails the moment it
 * does. `stage-app.ts` (the installers), `run-electron-app.ts` (a checkout) and `package.nix` all
 * call {@link bundleBackend}, so there is one bundle, not three. Four facts about it are easy to
 * get wrong, so they are written down once, here:
 *
 * - Some modules cannot be inlined and are not needed: the prettier plugins are optional formats the
 *   code service reaches by `import()` and answers "not installed" for when they are absent. They
 *   stay external and unstaged.
 * - Inlined modules that read their own data files do it relative to `import.meta.dirname`, which in
 *   a bundle is the directory of `index.js`. The directories they read are copied beside it at
 *   exactly the names in {@link BACKEND_DATA}.
 * - Some packages find files of their own by path at run time, which no bundler can follow: `esbuild`
 *   and `sharp` load a platform binary from a sibling package, and Arborist resolves its own
 *   helpers (`node-gyp`'s path, `@npmcli/run-script`). They stay external ({@link BACKEND_NATIVES})
 *   and are staged as REAL files: a `node_modules` beside the bundle, closed under their installed
 *   dependencies, so the binary that ships is the one this host installed. The release lanes build
 *   on native runners for exactly that reason.
 * - A few modules are resolved BY NAME at run time, from the backend's own directory, because what
 *   they find is files to serve rather than code to run: the compiler asks whether `lit-html` and
 *   `@vue/reactivity` resolve so it can copy them into a built site's `/assets`, and falls back to
 *   a third-party CDN (which a `default-src 'self'` policy blocks) when they do not. They are
 *   staged the same way ({@link BACKEND_MODULES}).
 *
 * `scripts/smoke-backend.ts` starts the staged result under Node and proves each of these paths
 * works, because a source tree that passes its tests says nothing about a bundle.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Modules the backend bundle leaves out and nothing stages. */
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
 * Packages left out of the bundle because they load files of their own by path, staged as real
 * files with their dependency closure.
 */
export const BACKEND_NATIVES = ["esbuild", "sharp", "@npmcli/arborist"] as const;

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

const desktopDir = resolve(import.meta.dirname, "../..");
/** The workspace install every package is hoisted into. */
export const WORKSPACE_MODULES = resolve(desktopDir, "../../node_modules");

/** The members of an installed `package.json` the closure reads. */
interface Manifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** Read an installed package's manifest. */
function manifestOf(dir: string): Manifest {
  // SAFETY: an installed package's own manifest; both members are maps of name to range.
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
}

/**
 * The directory `name` resolves to from `fromDir`, walking up through `node_modules` the way Node
 * does, but never above `root`; null when it is not installed (an optional dependency for another
 * platform).
 */
function resolvePackageDir(name: string, fromDir: string, root: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    if (dir === root || dirname(dir) === dir) {
      return null;
    }
    dir = dirname(dir);
  }
}

/**
 * The top-level package names to stage so `names` and everything they load at run time resolve from
 * a `node_modules` beside the bundle: each name, then its installed `dependencies` and
 * `optionalDependencies`, recursively. A dependency installed nested under its dependent travels
 * with that package's directory, but its own dependencies are still followed.
 *
 * @param names The packages the bundle reaches.
 * @param modules The install they are resolved from (the workspace's hoisted `node_modules`).
 * @throws {Error} When one of `names` is not installed.
 */
export function moduleClosure(names: readonly string[], modules = WORKSPACE_MODULES): string[] {
  const root = dirname(modules);
  const staged = new Set<string>();
  const seen = new Set<string>();
  const queue: { dir: string; top: string | null }[] = [];
  for (const name of names) {
    const dir = resolvePackageDir(name, root, root);
    if (!dir) {
      throw new Error(`${name} is not installed; run \`bun install\` before staging.`);
    }
    queue.push({ dir, top: name });
  }
  for (let item = queue.shift(); item; item = queue.shift()) {
    const real = realpathSync(item.dir);
    if (seen.has(real)) {
      continue;
    }
    seen.add(real);
    if (item.top !== null) {
      staged.add(item.top);
    }
    const { dependencies = {}, optionalDependencies = {} } = manifestOf(item.dir);
    for (const dep of new Set([
      ...Object.keys(dependencies),
      ...Object.keys(optionalDependencies),
    ])) {
      const dir = resolvePackageDir(dep, item.dir, root);
      if (dir) {
        // Hoisted to the root is a package of its own to stage; nested travels with its parent.
        queue.push({ dir, top: dir === join(modules, dep) ? dep : null });
      }
    }
  }
  return [...staged].toSorted();
}

/** What {@link bundleBackend} produced. */
export interface BackendBundle {
  /** The bundle, `<outdir>/index.js`. */
  entry: string;
  /** Every source file the bundle inlined, absolute, from the bundler's metafile. */
  inputs: string[];
  /** The bundle's text. */
  code: string;
}

/**
 * Bundle the backend into `outdir`: `index.js`, the `package.json` that makes Node read it as ESM,
 * and the data its inlined modules read. With `stageModules`, also the `node_modules` of
 * {@link BACKEND_NATIVES} and {@link BACKEND_MODULES} with their closure, which is what an
 * installer ships; a caller whose bundle sits inside an install that already resolves them (the Nix
 * package) passes false.
 *
 * @throws {AggregateError} With the bundler's diagnostics when bundling fails.
 */
export async function bundleBackend(
  outdir: string,
  options: { stageModules: boolean },
): Promise<BackendBundle> {
  const result = await Bun.build({
    entrypoints: [join(desktopDir, "src/hub/main.ts")],
    external: [...BACKEND_EXTERNALS, ...BACKEND_NATIVES],
    format: "esm",
    metafile: true,
    naming: "index.js",
    outdir,
    target: "node",
  });
  const output = result.outputs.at(0);
  if (!result.success || output === undefined) {
    throw new AggregateError(result.logs, "Bundling the backend failed.");
  }
  writeFileSync(join(outdir, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
  for (const { from, to } of BACKEND_DATA) {
    cpSync(join(desktopDir, from), join(outdir, to), { recursive: true });
  }
  if (options.stageModules) {
    for (const name of moduleClosure([...BACKEND_NATIVES, ...BACKEND_MODULES])) {
      const target = join(outdir, "node_modules", name);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(WORKSPACE_MODULES, name), target, { dereference: true, recursive: true });
    }
  }
  const inputs = Object.keys(result.metafile?.inputs ?? {}).map((input) => resolve(input));
  return { code: await output.text(), entry: join(outdir, "index.js"), inputs };
}
