/**
 * What the project state host (`./host.ts`) reaches outside itself for, each behind a function the
 * host takes as an option, and the default each option has: the project's formats and asset mounts
 * once its extensions are loaded (§2.2, §7), whether its dependencies are installed and how to
 * install them (§7), and each content type's entry files (§8.1).
 *
 * The defaults import their implementations lazily, so a host given its own (a test, the cloud's
 * Worker) never loads the compiler's format host or the package installer.
 *
 * @module
 */

import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { AssetMount } from "@jxsuite/schema/asset-paths";
import type { FormatRegistry } from "@jxsuite/schema/format-registry";
import type { JsonObject, JsonValue, ProjectConfig } from "@jxsuite/schema/types";

/** The project's document formats, as its loaded extensions register them (§2.2). */
export interface ProjectFormats {
  /** Every file extension a registered format parses, lowercase with its dot (`.md`). */
  extensions: readonly string[];
  /** Parse one document of a registered extension into the tree `extractRefs` reads. */
  parse: (extension: string, text: string) => Promise<JsonValue>;
  /** Project-relative asset mounts, through which a rooted reference resolves. */
  mounts: readonly AssetMount[];
  /**
   * The registry behind `parse`, whose formats also write a document back; a rename rewrites a
   * document in a registered format through it (§9). Without one such a document is named in the
   * rename's report rather than rewritten.
   */
  registry?: FormatRegistry;
}

/** The formats of a project whose extensions could not be loaded: none beyond the native ones. */
export const NO_FORMATS: ProjectFormats = Object.freeze({
  extensions: [],
  mounts: [],
  parse: (extension: string) => Promise.reject(new Error(`No parser for "${extension}"`)),
});

/** Load the extensions `config` names and answer the formats they register (§7). */
export type ExtensionLoader = (
  root: string,
  config: ProjectConfig | undefined,
) => Promise<ProjectFormats>;

/** Install the dependencies the manifest declares, writing the lockfile (§7). */
export type Installer = (root: string) => Promise<void>;

/** Whether every dependency `manifest` declares is installed under `root`. */
export type InstalledCheck = (root: string, manifest: JsonObject | null) => Promise<boolean>;

/** What a collection resolver is given: the configuration and every file in the index. */
export interface CollectionInput {
  root: string;
  config: ProjectConfig | undefined;
  /** Every indexed file (not directory), project-relative. */
  files: readonly string[];
}

/** Each content type's entry files, project-relative, as the collection loader resolves them. */
export type CollectionResolver = (
  input: CollectionInput,
) => Promise<Readonly<Record<string, readonly string[]>>>;

/** The manifest fields a fingerprint covers, and whose packages must be installed (§7). */
export const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/**
 * The default {@link ExtensionLoader}: the registry the editor already builds
 * (`buildInstalledExtensionRegistry`), whose formats parse each document, and the project's asset
 * mounts. An extension the project names but has not installed is skipped, as it is everywhere.
 */
export const loadInstalledFormats: ExtensionLoader = async (root, config) => {
  const [{ buildInstalledExtensionRegistry }, { refactorMounts }] = await Promise.all([
    import("@jxsuite/compiler/format-host"),
    import("../refactor/mounts.ts"),
  ]);
  const { registry } = await buildInstalledExtensionRegistry(root, config);
  const { formats } = registry;
  return {
    extensions: formats.documentExtensions().filter((extension) => extension !== ".jxn"),
    mounts: await refactorMounts(root),
    async parse(extension, text) {
      const entry = formats.byExtension(extension, "parse");
      if (entry === undefined) {
        throw new Error(`No parser for "${extension}"`);
      }
      /* SAFETY: a `parse` answer is a JxDocument or a ContentLoaderEntry[], both JSON trees but
         for leaves such as a frontmatter Date; every walk `extractRefs` runs re-checks each node's
         shape before reading it, so such a leaf is skipped rather than misread. */
      return (await entry.call("parse", text)) as JsonValue;
    },
    registry: formats,
  };
};

/** The default {@link Installer}: the package service's install, which writes `package-lock.json`. */
export const installPackages: Installer = async (root) => {
  const { installDependencies } = await import("../packages.ts");
  const result = await installDependencies(root);
  if (!result.ok) {
    throw new Error(result.log ?? "The install failed");
  }
};

/**
 * The default {@link InstalledCheck}: every package named in the manifest's dependency fields has a
 * `package.json` under a `node_modules` in the root or one of its ancestors, as Node resolves a
 * bare specifier, so a workspace member whose dependencies are hoisted to the workspace root counts
 * as installed. Peer dependencies are the consumer's to provide, so they are not required here.
 */
export const dependenciesInstalled: InstalledCheck = async (root, manifest) => {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const declared = manifest?.[field];
    if (isJsonObject(declared)) {
      for (const name of Object.keys(declared)) {
        names.add(name);
      }
    }
  }
  for (const name of names) {
    if (!(await resolvesUpward(root, name))) {
      return false;
    }
  }
  return true;
};

/** Whether `node_modules/<name>/package.json` exists in `from` or any directory above it. */
async function resolvesUpward(from: string, name: string): Promise<boolean> {
  for (let dir = from; ;) {
    try {
      await stat(join(dir, "node_modules", name, "package.json"));
      return true;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) {
        return false;
      }
      dir = parent;
    }
  }
}

/**
 * A source glob (`content/*.md`, `docs/**`) as a regular expression over project paths. With
 * `beneath`, a path under a matching directory matches too, as a directory source's entries do.
 */
function globPattern(glob: string, beneath = false): RegExp {
  let out = "";
  for (let at = 0; at < glob.length; at += 1) {
    const char = glob[at]!;
    if (char === "*" && glob[at + 1] === "*") {
      out += ".*";
      at += 1;
      if (glob[at + 1] === "/") {
        at += 1;
        out += "/?";
      }
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`);
    }
  }
  return new RegExp(beneath ? `^${out}(?:/.*)?$` : `^${out}$`);
}

/** A configuration path as a project path: no `./`, no trailing `/`. */
const projectPath = (value: string): string =>
  value
    .replace(/^\.?\//, "")
    .replaceAll(/\/+$/g, "")
    .replaceAll("{locale}", "*");

/** Whether `path` is a member of the source `source` names. */
function underSource(path: string, source: string): boolean {
  if (/[*?[]/.test(source)) {
    return globPattern(source, true).test(path);
  }
  return path === source || path.startsWith(`${source}/`);
}

/**
 * The default {@link CollectionResolver}: each content type's `source` (a directory, a file or a
 * glob, with `{locale}` matching any one segment) over the index, less its `exclude` globs. It
 * evaluates no `where`, so an entry a filter leaves out is still listed; a host that runs the
 * collection loader passes its own resolver for the exact list (§8.1).
 */
export const sourceCollections: CollectionResolver = (input) => {
  const content = input.config?.content;
  const out: Record<string, string[]> = {};
  if (!isJsonObject(content)) {
    return Promise.resolve(out);
  }
  for (const [type, def] of Object.entries(content)) {
    if (!isJsonObject(def) || !isString(def.source) || /^[a-z][a-z0-9+.-]*:/i.test(def.source)) {
      continue;
    }
    const source = projectPath(def.source);
    const exclude = (Array.isArray(def.exclude) ? def.exclude : [])
      .filter((item) => isString(item))
      .map((item) => globPattern(projectPath(item)));
    out[type] = input.files.filter(
      (path) =>
        underSource(path, source) &&
        !exclude.some(
          (pattern) => pattern.test(path.slice(source.length + 1)) || pattern.test(path),
        ),
    );
  }
  return Promise.resolve(out);
};
