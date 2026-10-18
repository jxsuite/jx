/**
 * Studio-api.js — Studio filesystem integration
 *
 * REST endpoints under /__studio/* that provide server-backed file operations so the studio can
 * work universally (not just Chrome with File System Access API).
 *
 * All paths are relative to the project root. Directory traversal above root is rejected.
 */

import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { componentMetaFrom } from "@jxsuite/schema/component-meta";
import { errorMessage } from "@jxsuite/schema/parse";
import { mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { LOCATION_ID_FILE } from "@jxsuite/protocol/routes";
import {
  buildExtensionsPayload,
  buildProjectExtensionRegistry,
} from "@jxsuite/compiler/format-host";
import { readBundledProjectSchemas } from "@jxsuite/compiler/schema-command";
import { handleDataApi } from "./data-api.ts";
import { containedPath } from "./net-guard.ts";
import { startSitePreview } from "./site-preview.ts";
import {
  clearLivePreviewOverlay,
  navigateLivePreview,
  setLivePreviewOverlay,
  startLivePreview,
} from "./live-preview.ts";
import { applyRename } from "./refactor/apply.ts";
import { findReferences } from "./refactor/find-refs.ts";
import {
  bunExecutable,
  dependenciesNeedInstall,
  installDependencies,
  packageVersions,
  setPackageVersions,
} from "./packages.ts";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type { FormatRegistry } from "@jxsuite/schema/format-registry";
import type { ClassJsonDef } from "./types.ts";
import type { DesignOptions, ProjectOptions } from "@jxsuite/create/generate";
import type { JsonObject, JsonPrimitive, JsonValue, ProjectConfig } from "@jxsuite/schema/types";
import { isFunction, isJsonObject, isNonNullObject, isString } from "@jxsuite/schema/guards";
import { problem } from "./problem.ts";

/** Normalise a path to forward slashes (Windows `path` module returns backslashes). */
const fwd = (p: string) => p.replaceAll("\\", "/");

/**
 * Expand a leading `~` to the user's home directory using path.join so separators are normalised (a
 * plain string replace left the input's forward slashes intact, yielding mixed separators on
 * Windows) and falling back to USERPROFILE where HOME is unset.
 */
const expandTilde = (p: string) =>
  p.startsWith("~") ? join(process.env.HOME || process.env.USERPROFILE || "", p.slice(1)) : p;

/** The `package.json` members these routes read. */
interface PackageJson {
  name?: string;
  workspaces?: JsonValue;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  customElements?: string;
}

/** A custom-element-manifest declaration (subset consumed here). */
interface CemDeclaration {
  customElement?: boolean;
  tagName?: string;
  description?: string;
  cssProperties?: JsonValue[];
  events?: JsonValue[];
  slots?: JsonValue[];
  /** Relayed verbatim once filtered on `kind` and `privacy`. */
  members?: JsonObject[];
  attributes?: {
    name?: string;
    default?: JsonValue;
    description?: string;
    type?: { text?: string };
  }[];
}

interface CemModule {
  path?: string;
  declarations?: CemDeclaration[];
}

interface Cem {
  modules?: CemModule[];
}

// ─── Extension registry (per project root, invalidated on project.json change) ──

const extensionRegistryCache = new Map<string, { mtime: number; registry: ExtensionRegistry }>();

/**
 * Build (or reuse) a project's extension registry (built from its project.json `extensions` array).
 * An empty registry is returned when there is no project.json — only .json files are handled then.
 *
 * @param {string} projectRoot
 * @returns {Promise<ExtensionRegistry>}
 */
async function getExtensionRegistry(projectRoot: string): Promise<ExtensionRegistry> {
  const projectJsonPath = resolve(projectRoot, "project.json");
  let mtime = 0;
  let projectConfig: ProjectConfig | undefined;
  try {
    mtime = statSync(projectJsonPath).mtimeMs;
    /* SAFETY: buildProjectExtensionRegistry reads only `projectConfig?.extensions` and validates
       that list itself; every other ProjectConfig member is optional and unread on this path. */
    projectConfig = JSON.parse(readFileSync(projectJsonPath, "utf8")) as ProjectConfig;
  } catch {
    projectConfig = undefined;
  }
  const cached = extensionRegistryCache.get(projectRoot);
  if (cached && cached.mtime === mtime) {
    return cached.registry;
  }
  const registry = await buildProjectExtensionRegistry(projectRoot, projectConfig);
  extensionRegistryCache.set(projectRoot, { mtime, registry });
  return registry;
}

/** Format-dispatch view of {@link getExtensionRegistry} (parse/serialize/discover/load lookups). */
async function getFormatRegistry(projectRoot: string): Promise<FormatRegistry> {
  const registry = await getExtensionRegistry(projectRoot);
  return registry.formats;
}

/**
 * Check that a path is under either the server root OR the active project root. This allows file
 * operations on external projects that have been explicitly activated via /__studio/activate.
 *
 * @param {string} filePath
 * @param {string} root
 * @param {string | null} activeProjectRoot
 */
export function assertAccessible(filePath: string, root: string, activeProjectRoot: string | null) {
  // Realpath containment (symlink-safe) against the server root, or an explicitly-activated project.
  if (containedPath(filePath, root) !== null) {
    return;
  }
  if (activeProjectRoot && containedPath(filePath, activeProjectRoot) !== null) {
    return;
  }
  throw new Error("Path outside project root");
}

/**
 * Check that a NEW project may be scaffolded under `parent` (specs/server.md §4.2).
 *
 * Deliberately wider than {@link assertAccessible}: a new project is normally created _outside_ the
 * server root — the whole point of the modal's Location field — so root containment cannot apply.
 * What it still refuses is a destination the user did not name (relative paths) and anything
 * outside the places a person keeps projects: the server root, any configured `allowedRoots`, and
 * the account's home directory. That keeps a hostile page on the loopback origin from scaffolding
 * into system paths while leaving every realistic location reachable.
 *
 * @param {string} parent
 * @param {string} root
 * @param {string[]} allowedRoots
 */
export function assertCreatableParent(parent: string, root: string, allowedRoots: string[] = []) {
  if (!parent || !isAbsolute(parent)) {
    throw new Error("Destination folder must be an absolute path");
  }
  const bases = [root, ...allowedRoots, homedir()].filter(Boolean);
  if (bases.some((base) => containedPath(parent, resolve(base)) !== null)) {
    return;
  }
  throw new Error(
    "Destination folder is outside the permitted roots (the server root, an allowed root, or your home directory)",
  );
}

/**
 * True when `dir` is a Jx project this account already owns: an absolute directory holding a
 * `project.json`, somewhere under the user's home directory (specs/server.md §4.2).
 *
 * Existing projects live outside the server root as a matter of course — the dev server serving
 * this monorepo is not where anyone keeps their sites — so root containment alone would leave
 * `?project=/abs/path`, the Open Project picker, and the recent-projects list unable to activate
 * anything but a project inside the checkout. This admits those without opening the filesystem API
 * to arbitrary directories: a hostile page on the loopback origin still cannot bind the server to
 * `/etc` or another account's files, only to a project the account already has on disk.
 *
 * @param {string} dir
 */
export function isOwnedProjectDir(dir: string): boolean {
  const home = homedir();
  if (!home || !dir || !isAbsolute(dir)) {
    return false;
  }
  if (containedPath(dir, resolve(home)) === null) {
    return false;
  }
  return existsSync(resolve(dir, "project.json"));
}

/**
 * Whether the project at `dir` is under version control of its own, rather than a stranger inside
 * somebody else's checkout.
 *
 * `git` answers for the nearest enclosing work tree, which is not the same question. A project
 * copied into a folder another repository IGNORES (a scratch copy under a monorepo's `.cache/`, a
 * download into a dotfiles repo's ignored `tmp/`) is "inside a work tree" by git's account, yet
 * none of its files can ever be committed there: Publish would list the enclosing repository's
 * branches and commits, and opening the project would fetch and pull a repository the user never
 * chose. Such a project is therefore not a repository, and offers to initialise one. A project that
 * is a TRACKED subfolder of a larger repository (a site inside a monorepo) still is one.
 *
 * @param {string} dir - The project root
 * @returns {Promise<boolean>}
 */
export async function projectHasRepository(dir: string): Promise<boolean> {
  const exitOf = async (args: string[]) => {
    const proc = Bun.spawn(["git", ...args], { cwd: dir, stderr: "ignore", stdout: "ignore" });
    return await proc.exited;
  };
  if ((await exitOf(["rev-parse", "--is-inside-work-tree"])) !== 0) {
    return false;
  }
  // `check-ignore` exits 0 when the path IS ignored, 1 when it is not.
  return (await exitOf(["check-ignore", "-q", "."])) !== 0;
}

/**
 * Parse raw `git status --porcelain=v2 --branch` output into structured data.
 *
 * The route runs it with `-z`, and that is the form that matters: without `-z` git C-quotes every
 * path holding a byte outside printable ASCII (`72” Grapple.md` arrives as `"72\342\200\235
 * Grapple.md"`), so Studio listed octal escapes inside stray quotes and asked git to stage a file
 * that does not exist. With `-z` each record ends in NUL and every path is verbatim; a rename's
 * original path is the record after it, which is skipped. Newline-separated output is still read,
 * for callers and tests that hand it plain text.
 *
 * @param {string} out
 * @returns {{
 *   branch: string;
 *   ahead: number;
 *   behind: number;
 *   files: { path: string; status: string; staged: boolean }[];
 *   isRepo?: boolean;
 *   remotes?: string[];
 * }}
 */
export function parseGitStatus(out: string) {
  let branch = "";
  let ahead = 0;
  let behind = 0;
  /** @type {{ path: string; status: string; staged: boolean }[]} */
  const files = [];

  const nulTerminated = out.includes("\0");
  const records = out.split(nulTerminated ? "\0" : "\n");
  for (let index = 0; index < records.length; index += 1) {
    const line = records[index]!;
    if (!line) {
      continue;
    }

    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) {
        ahead = Math.trunc(Number(m[1]!));
        behind = Math.trunc(Number(m[2]!));
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const parts = line.split(" ");
      const xy = parts[1]!;
      const stagedCode = xy[0]!;
      const unstagedCode = xy[1]!;
      let filePath;
      if (line.startsWith("2 ") && nulTerminated) {
        // `2 XY sub mH mI mW hH hI Xscore path`, then the original path as its own record.
        filePath = parts.slice(9).join(" ");
        index += 1;
      } else if (line.startsWith("2 ")) {
        const tabIdx = line.indexOf("\t");
        const pathPart = line.slice(tabIdx + 1);
        filePath = pathPart.split("\t").pop() || "";
      } else {
        filePath = parts.slice(8).join(" ");
      }
      // Porcelain v2 XY codes (A, C, D, M, R, T, U, ...) are reported verbatim; "." means unchanged.
      if (stagedCode !== ".") {
        files.push({
          path: filePath,
          staged: true,
          status: stagedCode,
        });
      }
      if (unstagedCode !== ".") {
        files.push({
          path: filePath,
          staged: false,
          status: unstagedCode,
        });
      }
    } else if (line.startsWith("? ")) {
      files.push({ path: line.slice(2), staged: false, status: "U" });
    }
  }

  return { ahead, behind, branch, files };
}

/** An imported plugin module, or its default export, read by export name. */
interface PluginModule {
  readonly [exportName: string]: PluginExport;
}

/** A function a plugin module exports: the plugin class, whose static `schema` the studio renders. */
interface PluginClass extends PluginModule {
  (...args: never[]): void;
}

/**
 * What schema discovery can meet under an export name, spelled out by kind. Only a function is used
 * (as the plugin class); an object is searched one level, as a default export; every other kind of
 * value is a miss.
 */
type PluginExport = PluginClass | PluginModule | JsonPrimitive | bigint | symbol | undefined;

/** Whether an export is a function, and so a candidate plugin class. */
function isPluginClass(value: PluginExport): value is PluginClass {
  return isFunction(value);
}

/** The body of `POST /__studio/git/push`; an absent or unparsable body means a plain push. */
interface PushBody {
  setUpstream?: boolean;
}

/** Host hooks for the routes that reach outside the server root (project creation). */
export interface StudioApiOptions {
  /** Extra roots a new project may be created under, mirroring `createDevServer.allowedRoots`. */
  allowedRoots?: string[];
  /**
   * Called with the absolute root of a project this API just created, so the host can permit a
   * subsequent `/__studio/activate` on it — a project created outside the server root is otherwise
   * unreachable by the very request that made it.
   */
  onProjectCreated?: (projectRoot: string) => void;
  /**
   * Tell the collaboration registry a path changed underneath it — the same hook the file watcher
   * uses (`server.ts`), handed to the one mutation the watcher cannot describe.
   *
   * A rename MOVES a file, and a live room is keyed by the old path. Without this the room survives
   * the move holding pre-rename content, and `stop()`'s graceful-shutdown flush writes it back —
   * RECREATING the file the rename deleted. `pendingPersist` receives a path on the room's seed
   * transaction, so a clean editor does not protect against it either. Passing the OLD absolute
   * path lets the registry reset that room, which deletes it and makes the later flush a no-op.
   */
  onFileMoved?: (absPath: string) => void;
}

/**
 * Handle /__studio/* requests.
 *
 * @param {Request} req
 * @param {URL} url
 * @param {string} root
 * @param {string | null} [activeProjectRoot]
 * @param {StudioApiOptions} [opts]
 * @returns {Promise<Response | null>}
 */
/**
 * The paths git reported as conflicting, from a failed merge or pull's output.
 *
 * Parsed from the porcelain text because there is no machine-readable form of it: `git pull` writes
 * `CONFLICT (content): Merge conflict in <path>` to stdout and exits non-zero, and the alternative
 * — a second `git diff --name-only --diff-filter=U` — would be a separate command whose answer
 * could already have changed. An empty result means the failure was not a conflict, and the caller
 * rethrows rather than mislabelling it.
 *
 * @param {string} output - Combined git output from the failed command
 * @returns {string[]} Conflicting paths, deduplicated, in the order git reported them
 */
function conflictingPaths(output: string): string[] {
  const paths = new Set<string>();
  for (const line of output.split("\n")) {
    const match = /^CONFLICT \([^)]*\): Merge conflict in (.+)$/.exec(line.trim());
    if (match?.[1]) {
      paths.add(match[1].trim());
    }
  }
  return [...paths];
}

/**
 * Order a directory listing so two identical requests answer identically.
 *
 * `readdir` and `Bun.Glob.scan` both answer in FILESYSTEM order, which is not an order at all: it
 * varies with the directory's internal layout and therefore with the history of writes to it. That
 * reached the screenshots as a picture that changed on its own — `blog-grid.png` photographs a
 * content collection, `content-source.ts` inserts rows in listing order (deliberately, so a
 * concurrent read cannot decide it), and the listing underneath was unsorted. The collection's
 * three posts swapped places between runs and rewrote the image 15 times in ten days.
 *
 * Codepoint order, not `localeCompare`: the comparison has to answer the same on a maintainer's
 * machine and in the capture container, and a locale-aware collation does not promise that.
 */
function byPathOrder<T extends { path: string }>(entries: T[]): T[] {
  return entries.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * A git command that exited non-zero, carrying both output streams (git splits failures across
 * them).
 */
class GitCommandError extends Error {
  readonly stderr: string;
  readonly stdout: string;

  constructor(message: string, stderr: string, stdout: string) {
    super(message);
    this.name = "GitCommandError";
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

/** True when a failed filesystem call failed because the path does not exist (`ENOENT`). */
function isNotFound(cause: unknown): boolean {
  return isNonNullObject(cause) && "code" in cause && cause.code === "ENOENT";
}

export async function handleStudioApi(
  req: Request,
  url: URL,
  root: string,
  activeProjectRoot: string | null = null,
  opts: StudioApiOptions = {},
) {
  const path = url.pathname;

  // Data-domain owner console + secrets (names only) — delegated to data-api.ts.
  const dataRes = await handleDataApi(req, url, root, activeProjectRoot);
  if (dataRes) {
    return dataRes;
  }

  // Project metadata
  if (path === "/__studio/project" && req.method === "GET") {
    try {
      /* SAFETY: only `name` and `workspaces` are read, each behind a `??` fallback; a file whose
         JSON is not an object yields undefined members (or throws on null) and answers the same
         fallback shape as the catch below. */
      const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as PackageJson;
      return Response.json({
        name: pkg.name ?? basename(root),
        root,
        workspaces: pkg.workspaces ?? [],
      });
    } catch {
      return Response.json({ name: basename(root), root, workspaces: [] });
    }
  }

  // Project info — probe a directory for site-project characteristics
  if (path === "/__studio/project-info" && req.method === "GET") {
    const dir = url.searchParams.get("dir") || activeProjectRoot || root;
    const absDir = isAbsolute(dir) ? dir : resolve(root, dir);
    try {
      assertAccessible(absDir, root, activeProjectRoot);
    } catch (error) {
      return problem("invalidRequest", errorMessage(error));
    }
    try {
      const projectRoot = fwd(absDir);
      const conventionalDirs = [
        "pages",
        "layouts",
        "components",
        "content",
        "data",
        "public",
        "styles",
      ];
      const directories = [];
      for (const d of conventionalDirs) {
        try {
          const s = await stat(resolve(absDir, d));
          if (s.isDirectory()) {
            directories.push(d);
          }
        } catch {}
      }

      let isSiteProject = false;
      let projectConfig: ProjectConfig | null = null;
      try {
        // SAFETY: JSON.parse without a reviver only ever produces JSON values.
        const raw = JSON.parse(
          await readFile(resolve(absDir, "project.json"), "utf8"),
        ) as JsonValue;
        if (isJsonObject(raw)) {
          isSiteProject = true;
          /* SAFETY: `raw` is a JSON object and every ProjectConfig member is optional; the config
             is only relayed to the client here, never interpreted. */
          projectConfig = raw as ProjectConfig;
        }
      } catch {}

      return Response.json({
        directories,
        isSiteProject,
        projectConfig,
        projectRoot,
      });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Resolve nearest project.json ancestor for a given file path
  if (path === "/__studio/resolve-site" && req.method === "GET") {
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      return problem("invalidRequest", "Missing path param");
    }
    try {
      // Walk up looking for project.json. Accept a directory (e.g. the project root itself, as
      // Deep links like ?project=/abs/my-site pass) by starting the walk AT the directory and
      // Treating its project.json as the target file, so callers land on the home page.
      let absFile = expandTilde(filePath);
      let dir: string;
      let isDir = false;
      try {
        isDir = statSync(absFile).isDirectory();
      } catch {}
      if (isDir) {
        dir = absFile;
        absFile = resolve(absFile, "project.json");
      } else {
        dir = dirname(absFile);
      }
      while (dir) {
        const candidate = resolve(dir, "project.json");
        if (existsSync(candidate)) {
          /* SAFETY: the config is relayed to the client verbatim and not interpreted here, so its
             member types are the client's to check; malformed JSON throws into the catch below. */
          const config = JSON.parse(readFileSync(candidate, "utf8")) as ProjectConfig;
          const relPath = fwd(dir);
          const fileRelPath = fwd(relative(dir, absFile));
          return Response.json({
            fileRelPath,
            projectConfig: config,
            relPath,
            sitePath: dir,
          });
        }
        const parent = dirname(dir);
        if (parent === dir) {
          break;
        }
        dir = parent;
      }
      return Response.json({ sitePath: null });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Find a project directory by name — searches $HOME for the first matching directory with a
  // Project.json. Dev-mode workaround for when showDirectoryPicker() can't provide absolute paths.
  if (path === "/__studio/find-project" && req.method === "GET") {
    const name = url.searchParams.get("name");
    if (!name) {
      return problem("invalidRequest", "Missing name");
    }
    try {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      if (!home) {
        return Response.json({ path: null });
      }
      const glob = new Bun.Glob(`**/${name}/project.json`);
      try {
        for await (const match of glob.scan({ cwd: home, dot: false })) {
          if (match.includes("node_modules") || match.includes(".Trash")) {
            continue;
          }
          const abs = resolve(home, dirname(match));
          return Response.json({ path: abs });
        }
      } catch {}
      return Response.json({ path: null });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  /*
   * Recover the absolute path of a directory the browser picked with `showDirectoryPicker()`.
   *
   * A `FileSystemDirectoryHandle` exposes only `.name`, never a filesystem path (§8.2), and unlike
   * /__studio/find-project there is no `project.json` to search for — the whole point is that the
   * folder is empty. So the client tags the folder with a hidden LOCATION_ID_FILE holding a random
   * id and asks us which directory carries that id.
   *
   * Identity lives in the file's CONTENTS, not its name: matching the id is exact where matching a
   * path shape is only probable — two folders can share a basename, and a file left behind by a
   * crashed session can still be on disk. A candidate whose contents do not equal `id` is skipped,
   * so a stale tag can never redirect a create. The winning file is deleted here, the moment it has
   * served its purpose, rather than being left for the client to tidy up.
   */
  if (path === "/__studio/locate-directory" && req.method === "GET") {
    const name = url.searchParams.get("name");
    const id = url.searchParams.get("id");
    // `name` is interpolated into a glob; the id is only ever compared, never used as a pattern.
    if (!name || !id || !/^[a-f0-9]{32}$/.test(id) || !/^[^/\\]+$/.test(name)) {
      return problem("invalidRequest", "Missing or invalid name/id");
    }
    try {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      if (!home) {
        return Response.json({ path: null });
      }
      /** The tagged directory when this candidate holds our id, else null. */
      const claim = (dir: string): string | null => {
        const file = resolve(dir, LOCATION_ID_FILE);
        try {
          if (readFileSync(file, "utf8").trim() !== id) {
            return null;
          }
        } catch {
          return null;
        }
        try {
          unlinkSync(file);
        } catch {
          // Read-only or already gone; the client's own cleanup is the backstop.
        }
        return dir;
      };

      // The home directory itself is a legitimate pick, and no `**/<name>/` glob can match it.
      const atHome = claim(home);
      if (atHome) {
        return Response.json({ path: atHome });
      }
      // `dot: true` — the tag is a dotfile, so a dot-blind scan would never see it.
      const glob = new Bun.Glob(`**/${name}/${LOCATION_ID_FILE}`);
      try {
        for await (const match of glob.scan({ cwd: home, dot: true })) {
          if (match.includes("node_modules") || match.includes(".Trash")) {
            continue;
          }
          const claimed = claim(resolve(home, dirname(match)));
          if (claimed) {
            return Response.json({ path: claimed });
          }
        }
      } catch {}
      return Response.json({ path: null });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Discover site projects — find all project.json files under root
  if (path === "/__studio/sites" && req.method === "GET") {
    try {
      const glob = new Bun.Glob("**/project.json");
      const sites = [];
      for await (const match of glob.scan({ cwd: root, dot: false })) {
        if (
          match.includes("node_modules") ||
          fwd(match).includes("dist/") ||
          fwd(match).includes(".claude/")
        ) {
          continue;
        }
        const fp = resolve(root, match);
        try {
          // SAFETY: JSON.parse without a reviver only ever produces JSON values.
          const raw = JSON.parse(await readFile(fp, "utf8")) as JsonValue;
          if (isJsonObject(raw)) {
            const projectDir = fwd(dirname(fp));
            /* SAFETY: `raw` is a JSON object and every ProjectConfig member is optional; the site
               list only relays the config to the client. */
            sites.push({ config: raw as ProjectConfig, path: projectDir });
          }
        } catch {}
      }
      return Response.json(sites);
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Create a new project
  if (path === "/__studio/create-project" && req.method === "POST") {
    try {
      /* SAFETY: trust boundary. The only client is Studio's New Project modal, which sends these
         members with these types. `name`, `directory` and `destination` are checked below before
         any filesystem use, and `template` goes through isTemplateId. `description`, `url`,
         `adapter`, `starter` and `design` are relayed to generateProject unchecked (a falsy
         `adapter` is dropped so the static default applies), and it writes them into the scaffold
         as given. */
      const body = (await req.json()) as {
        name?: string;
        description?: string;
        url?: string;
        adapter?: "static" | "cloudflare-pages" | "cloudflare-workers" | "node" | "bun";
        directory?: string;
        destination?: { kind?: string; parent?: string };
        starter?: string;
        template?: string;
        design?: DesignOptions;
      };
      const {
        name,
        description,
        url: siteUrl,
        adapter,
        directory,
        destination,
        starter,
        template,
        design,
      } = body;
      if (!name || !directory) {
        return problem("invalidRequest", "name and directory are required");
      }
      // The destination is the user's to choose (specs/server.md §4.2). Without one the project
      // Would silently land under the server root — which, when the dev server is the jx checkout,
      // Means scaffolding into the monorepo. Refuse instead of guessing.
      if (destination?.kind !== "path" || !destination.parent) {
        return problem("invalidRequest", "A destination folder is required.");
      }
      // `directory` names the project FOLDER, not a path: a separator or dot-segment would walk out
      // Of the parent that was just vetted below, which is exactly what the vetting is for.
      if (/[/\\]/.test(directory) || directory === "." || directory === "..") {
        return problem("invalidRequest", "Directory must be a folder name, not a path");
      }
      const { isTemplateId } = await import("@jxsuite/create/templates");
      if (template !== undefined && !isTemplateId(template)) {
        return problem("invalidRequest", `Unknown template: "${template}"`);
      }
      // A bad destination is client input, so answer 400 rather than letting the guard's throw fall
      // Through to the catch-all 500 below.
      try {
        assertCreatableParent(destination.parent, root, opts.allowedRoots);
      } catch (error) {
        return problem("invalidRequest", errorMessage(error));
      }
      const destPath = resolve(destination.parent, directory);

      const { generateProject } = await import("@jxsuite/create/generate");
      const projectOptions: ProjectOptions = { name };
      if (adapter) {
        projectOptions.adapter = adapter;
      }
      if (description !== undefined) {
        projectOptions.description = description;
      }
      if (siteUrl !== undefined) {
        projectOptions.url = siteUrl;
      }
      if (starter !== undefined) {
        projectOptions.starter = starter;
      }
      if (template !== undefined && isTemplateId(template)) {
        projectOptions.template = template;
      }
      if (design !== undefined) {
        projectOptions.design = design;
      }
      await generateProject(destPath, projectOptions);

      /* SAFETY: generateProject just wrote this project.json from its own template, so it is a
         project config; it is relayed to the client, not interpreted here. */
      const config = JSON.parse(
        await readFile(resolve(destPath, "project.json"), "utf8"),
      ) as ProjectConfig;
      // Root-relative while the project happens to sit under the server root (the historical
      // Shape every caller already handles); absolute otherwise, which is the same shape
      // /__studio/find-project returns for an external project.
      const inRoot = containedPath(destPath, root) !== null;
      opts.onProjectCreated?.(destPath);
      return Response.json({ config, root: inRoot ? fwd(relative(root, destPath)) : destPath });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // List available starter templates (for the New Project picker)
  if (path === "/__studio/starters" && req.method === "GET") {
    try {
      const { listStarters } = await import("@jxsuite/starters");
      return Response.json(listStarters());
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // List files
  if (path === "/__studio/files" && req.method === "GET") {
    const dir = url.searchParams.get("dir") || activeProjectRoot || root;
    const pattern = url.searchParams.get("glob");
    const absDir = isAbsolute(dir) ? dir : resolve(root, dir);
    try {
      assertAccessible(absDir, root, activeProjectRoot);
    } catch (error) {
      return problem("invalidRequest", errorMessage(error));
    }

    /*
     * Every path out is relative to the active project root (§4.1), a path BESIDE the project
     * included: `../../docs/start`, not `docs/start`. A collection may live outside its project
     * (`sites/jxsuite.com` declares `content.docs.source: "../../docs"`), and a server-root-relative
     * reply for it reads as project-relative to the client, which resolves it against the server
     * root again on the next call and names a directory nobody has. A recursive walk of that
     * collection stopped at its first level, with a 500 for every subdirectory.
     */
    const reportRelative = (fp: string) => fwd(relative(activeProjectRoot ?? root, fp));

    try {
      if (pattern) {
        const glob = new Bun.Glob(pattern);
        const files = [];
        for await (const match of glob.scan({ cwd: absDir, dot: false })) {
          const fp = resolve(absDir, match);
          try {
            const s = await stat(fp);
            if (!s.isDirectory()) {
              files.push({
                modified: s.mtime.toISOString(),
                name: basename(match),
                path: reportRelative(fp),
                size: s.size,
              });
            }
          } catch {}
        }
        return Response.json(byPathOrder(files));
      }

      const entries = await readdir(absDir, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".")) {
          continue;
        }
        const fp = resolve(absDir, entry.name);
        const s = await stat(fp);
        files.push({
          modified: s.mtime.toISOString(),
          name: entry.name,
          path: reportRelative(fp),
          size: s.size,
          type: entry.isDirectory() ? "directory" : "file",
        });
      }
      return Response.json(byPathOrder(files));
    } catch (error) {
      // A directory that does not exist is a 404, not a server fault: a client probing whether a
      // Folder exists yet (Add new's collision check) asks exactly this.
      return isNotFound(error)
        ? problem("notFound", errorMessage(error))
        : problem("internalError", errorMessage(error));
    }
  }

  // Component discovery — scan project for custom element definitions
  if (path === "/__studio/components" && req.method === "GET") {
    const dir = url.searchParams.get("dir") || activeProjectRoot || root;
    const scanRoot = isAbsolute(dir) ? dir : resolve(root, dir);
    try {
      assertAccessible(scanRoot, root, activeProjectRoot);
    } catch (error) {
      return problem("invalidRequest", errorMessage(error));
    }
    try {
      const registry = await getFormatRegistry(scanRoot);
      const componentExts = registry.documentExtensions("component").map((e: string) => e.slice(1));
      const glob = new Bun.Glob(`**/*.{${["json", ...componentExts].join(",")}}`);
      const components = [];
      for await (const match of glob.scan({ cwd: scanRoot, dot: false })) {
        if (
          match.includes("node_modules") ||
          fwd(match).includes("dist/") ||
          fwd(match).includes(".claude/")
        ) {
          continue;
        }
        const fp = resolve(scanRoot, match);
        try {
          let content: JsonValue;
          if (match.endsWith(".json")) {
            // SAFETY: JSON.parse without a reviver only ever produces JSON values.
            content = JSON.parse(await readFile(fp, "utf8")) as JsonValue;
          } else {
            const entry = registry.byExtension(extname(match), "parse");
            if (!entry) {
              continue;
            }
            const source = await readFile(fp, "utf8");
            const parsed = await entry.call("parse", source);
            /* Only a document object can declare a component, and componentMetaFrom answers null
               for anything else, so loaded entries reach it as null rather than as a document. */
            content = isJsonObject(parsed) ? parsed : null;
          }
          /* The metadata rules live in @jxsuite/schema/component-meta because THREE backends need
             the same answer — this one, the desktop session, and now the cloud adapter, which can
             discover JSON components precisely because deriving them executes nothing. Two copies
             had already drifted apart in wording; a third would have made "which state entries are
             props" a question with three answers. */
          const meta = componentMetaFrom(content, fwd(match));
          if (meta) {
            components.push({ ...meta, source: "jx" });
          }
        } catch {} // Skip non-JSON or parse errors
      }

      // Discover CEM-bearing npm packages
      try {
        const projectPkgPath = resolve(scanRoot, "package.json");
        if (existsSync(projectPkgPath)) {
          /* SAFETY: only the keys of the dependency maps are used, each as a package name that must
             resolve to node_modules/<name>/package.json before anything else is read, so a name
             that does not is skipped; a throw skips this whole scan. */
          const pkg = JSON.parse(await readFile(projectPkgPath, "utf8")) as PackageJson;
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          for (const name of Object.keys(deps)) {
            try {
              const depPkgPath = resolve(
                scanRoot,
                "node_modules",
                ...name.split("/"),
                "package.json",
              );
              // Fall back to root node_modules for hoisted packages
              const fallbackPath = resolve(
                root,
                "node_modules",
                ...name.split("/"),
                "package.json",
              );
              const actualPath = existsSync(depPkgPath)
                ? depPkgPath
                : existsSync(fallbackPath)
                  ? fallbackPath
                  : null;
              if (!actualPath) {
                continue;
              }
              /* SAFETY: `customElements` is the one member read; npm defines it as the manifest
                 path, and a non-string value makes resolve() throw into this package's catch. */
              const depPkg = JSON.parse(await readFile(actualPath, "utf8")) as PackageJson;
              if (!depPkg.customElements) {
                continue;
              }
              const cemPath = resolve(dirname(actualPath), depPkg.customElements);
              if (!existsSync(cemPath)) {
                continue;
              }
              /* SAFETY: the package names this file as its custom-elements manifest, and every
                 member read below has a fallback; a manifest of another shape either throws into
                 this package's catch or contributes no declarations. */
              const cem = JSON.parse(await readFile(cemPath, "utf8")) as Cem;
              for (const mod of cem.modules || []) {
                for (const decl of mod.declarations || []) {
                  if (decl.customElement && decl.tagName) {
                    components.push({
                      $id: null,
                      cssProperties: decl.cssProperties || [],
                      description: decl.description || null,
                      events: decl.events || [],
                      hasElements: false,
                      members: (decl.members || []).filter(
                        (m) => m.kind === "field" && m.privacy !== "private",
                      ),
                      modulePath: mod.path,
                      package: name,
                      path: null,
                      props: (decl.attributes || []).map((a) => ({
                        default: a.default,
                        description: a.description || null,
                        name: a.name,
                        type: a.type?.text,
                      })),
                      slots: decl.slots || [],
                      source: "npm",
                      tagName: decl.tagName,
                    });
                  }
                }
              }
            } catch {} // Skip packages without valid CEM
          }
        }
      } catch {} // Skip if no project package.json

      return Response.json(components);
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // ─── Site build ──────────────────────────────────────────────────────────────

  /**
   * Build the site, so `View: Open in Browser` opens what the author is looking at.
   *
   * The compiler is imported dynamically for the same reason `dev.ts` does it: the server depends
   * on the compiler for this one call, and a static import would pull the whole build pipeline into
   * every server process that never builds anything.
   *
   * Build errors come back in the payload rather than as a 500. A partial build still produced
   * pages, and the author is better served by opening the page they asked for with the failures
   * named beside it than by a preview that refuses and says only "500".
   *
   * The reply carries the ORIGIN to open the result at, not just the counts, because the built site
   * is served on its own port ({@link file://./site-preview.ts}) rather than on this one — the
   * caller has no way to know that port and no business guessing it.
   */
  if (path === "/__studio/build" && req.method === "POST") {
    const dir = activeProjectRoot ?? root;
    if (!existsSync(resolve(dir, "project.json"))) {
      return problem("invalidRequest", "Not a site project");
    }
    try {
      const { buildSite } = await import("@jxsuite/compiler/site");
      // `clean: false` — this runs on the way to opening a page, and wiping the output directory
      // First would mean every asset 404s for as long as the build takes.
      const result = await buildSite(dir, { clean: false, verbose: false });
      const preview = startSitePreview(dir);
      const built = { errors: result.errors, files: result.files, routes: result.routes };
      // `url` follows the build fields, and only when a preview origin exists.
      return Response.json(preview ? { ...built, url: preview.origin } : built);
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  /**
   * Preview the site LIVE — the working tree browsable at real routes, with no build on the path.
   *
   * The sibling of `/__studio/build` and the one Open in Browser reaches first. What it answers
   * with is not compiler output: `@jxsuite/site` composes each page on demand and
   * `@jxsuite/runtime` assembles it in the reader's browser, so what opens is the tree as it stands
   * — the author's unsaved edits included, because Studio publishes those as an overlay this origin
   * reads first.
   *
   * `reused` is the second answer and the caller must honour it. A tab already holding this
   * project's reload stream is retargeted in place, and opening another would give the author two
   * tabs on one project — which is the thing the retarget exists to prevent.
   */
  if (path === "/__studio/preview" && req.method === "POST") {
    const dir = activeProjectRoot ?? root;
    if (!existsSync(resolve(dir, "project.json"))) {
      return problem("invalidRequest", "Not a site project");
    }
    let body: { route?: string };
    try {
      /* SAFETY: `route` is the only member read, and only when truthy; it is relayed verbatim in
         the preview tab's `navigate` event, so nothing here depends on its runtime type. */
      body = (await req.json()) as { route?: string };
    } catch {
      return problem("invalidRequest", "Invalid JSON body");
    }
    try {
      const preview = await startLivePreview(dir);
      const reused = body.route ? await navigateLivePreview(dir, body.route) : false;
      return Response.json({
        errors: preview.errors,
        /* A live preview writes nothing, so there are no files to count. The field is part of the
           shared shape and saying zero is the honest answer rather than an omission. */
        files: 0,
        mode: "live",
        reused,
        routes: preview.routes,
        url: preview.origin,
      });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  /**
   * The unsaved bytes a live preview reads before the disk.
   *
   * POST publishes one document, DELETE retracts one or all of them. Studio owns the lifecycle — it
   * knows which documents are dirty and when a save, a close or a discard ends that — so this route
   * stores what it is told and decides nothing.
   */
  if (path === "/__studio/preview/overlay") {
    const dir = activeProjectRoot ?? root;
    let body: { path?: string; contents?: string };
    try {
      /* SAFETY: both members are re-checked with isString below before either reaches the
         overlay store. */
      body = (await req.json()) as { path?: string; contents?: string };
    } catch {
      return problem("invalidRequest", "Invalid JSON body");
    }
    if (req.method === "POST") {
      if (!isString(body.path) || !isString(body.contents)) {
        return problem("invalidRequest", "Missing path or contents");
      }
      setLivePreviewOverlay(dir, body.path, body.contents);
      return new Response(null, { status: 204 });
    }
    if (req.method === "DELETE") {
      clearLivePreviewOverlay(dir, isString(body.path) ? body.path : undefined);
      return new Response(null, { status: 204 });
    }
  }

  // ─── Package management ──────────────────────────────────────────────────────

  // List CEM-bearing npm packages
  if (path === "/__studio/packages" && req.method === "GET") {
    const dir = url.searchParams.get("dir") || activeProjectRoot || root;
    const scanRoot = isAbsolute(dir) ? dir : resolve(root, dir);
    try {
      const pkgPath = resolve(scanRoot, "package.json");
      if (!existsSync(pkgPath)) {
        return Response.json([]);
      }
      /* SAFETY: npm and bun write `dependencies` / `devDependencies` as name-to-range string maps,
         which is all this route reads; a package.json that is not JSON throws into the catch. */
      const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as PackageJson;
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const packages: {
        name: string;
        version: string;
        dev: boolean;
        hasCem: boolean;
        customElementsPath: string | null;
      }[] = [];
      for (const [name, version] of Object.entries(deps)) {
        const depPkgPath = resolve(scanRoot, "node_modules", ...name.split("/"), "package.json");
        const fallbackPath = resolve(root, "node_modules", ...name.split("/"), "package.json");
        const actualPath = existsSync(depPkgPath)
          ? depPkgPath
          : existsSync(fallbackPath)
            ? fallbackPath
            : null;
        if (!actualPath) {
          continue;
        }
        try {
          /* SAFETY: `customElements` is the one member read, and it is relayed verbatim or tested
             for truthiness; malformed JSON skips the package in the catch. */
          const depPkg = JSON.parse(await readFile(actualPath, "utf8")) as PackageJson;
          packages.push({
            customElementsPath: depPkg.customElements || null,
            dev: pkg.dependencies?.[name] === undefined,
            hasCem: Boolean(depPkg.customElements),
            name,
            version,
          });
        } catch {}
      }
      return Response.json(packages);
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Read CEM from a specific package
  if (path === "/__studio/cem" && req.method === "GET") {
    const pkg = url.searchParams.get("pkg");
    if (!pkg) {
      return problem("invalidRequest", "Missing pkg");
    }
    const dir = url.searchParams.get("dir") || activeProjectRoot || root;
    const scanRoot = isAbsolute(dir) ? dir : resolve(root, dir);
    try {
      const depPkgPath = resolve(scanRoot, "node_modules", ...pkg.split("/"), "package.json");
      const fallbackPath = resolve(root, "node_modules", ...pkg.split("/"), "package.json");
      const actualPath = existsSync(depPkgPath)
        ? depPkgPath
        : existsSync(fallbackPath)
          ? fallbackPath
          : null;
      if (!actualPath) {
        return Response.json({ cem: null });
      }
      /* SAFETY: `customElements` is the one member read; npm defines it as the manifest path, and
         a non-string value makes resolve() throw into the catch below. */
      const depPkg = JSON.parse(await readFile(actualPath, "utf8")) as PackageJson;
      if (!depPkg.customElements) {
        return Response.json({ cem: null });
      }
      const cemPath = resolve(dirname(actualPath), depPkg.customElements);
      if (!existsSync(cemPath)) {
        return Response.json({ cem: null });
      }
      /* SAFETY: JSON.parse without a reviver only ever produces JSON values, and the manifest is
         relayed verbatim, so it needs decoding no further than that. */
      const cem = JSON.parse(await readFile(cemPath, "utf8")) as JsonValue;
      return Response.json({ cem });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Add an npm package
  if (path === "/__studio/packages/add" && req.method === "POST") {
    try {
      /* SAFETY: `name` reaches argv, so it is re-checked with isString below; `dir` is only
         path-resolved and `dev` only tested for truthiness, and a wrongly typed `dir` throws in
         isAbsolute inside this try and answers 500. */
      const body = (await req.json()) as { name?: string; dir?: string; dev?: boolean };
      const { name } = body;
      if (!name || !isString(name)) {
        return problem("invalidRequest", "Missing name");
      }
      const dir = body.dir || activeProjectRoot;
      const cwd = dir ? (isAbsolute(dir) ? dir : resolve(root, dir)) : root;
      const args = ["add", name];
      if (body.dev) {
        args.splice(1, 0, "-d");
      }
      const proc = Bun.spawn([bunExecutable(), ...args], {
        cwd,
        stderr: "pipe",
        stdout: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        return problem("internalError", stderr || `bun add exited with ${exitCode}`);
      }
      return Response.json({ ok: true });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Remove an npm package
  if (path === "/__studio/packages/remove" && req.method === "POST") {
    try {
      /* SAFETY: `name` reaches argv, so it is re-checked with isString below; a wrongly typed
         `dir` throws in isAbsolute inside this try and answers 500. */
      const body = (await req.json()) as { name?: string; dir?: string };
      const { name } = body;
      if (!name || !isString(name)) {
        return problem("invalidRequest", "Missing name");
      }
      const dir = body.dir || activeProjectRoot;
      const cwd = dir ? (isAbsolute(dir) ? dir : resolve(root, dir)) : root;
      const proc = Bun.spawn([bunExecutable(), "remove", name], {
        cwd,
        stderr: "pipe",
        stdout: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        return problem("internalError", stderr || `bun remove exited with ${exitCode}`);
      }
      return Response.json({ ok: true });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Install all dependencies (bun install)
  if (path === "/__studio/packages/install" && req.method === "POST") {
    try {
      /* SAFETY: `dir` is the only member read and is only path-resolved; a wrongly typed `dir`
         throws in isAbsolute inside this try and answers 500. */
      const body = (await req.json().catch(() => ({}))) as { dir?: string };
      const dir = body.dir || activeProjectRoot || root;
      const scanRoot = isAbsolute(dir) ? dir : resolve(root, dir);
      return Response.json(await installDependencies(scanRoot));
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Whether dependencies need installing (node_modules missing)
  if (path === "/__studio/packages/needs-install" && req.method === "GET") {
    const dir = url.searchParams.get("dir") || activeProjectRoot || root;
    const scanRoot = isAbsolute(dir) ? dir : resolve(root, dir);
    return Response.json({ needsInstall: dependenciesNeedInstall(scanRoot) });
  }

  // The newest published version of each dependency (whether or not it is behind)
  if (path === "/__studio/packages/versions" && req.method === "GET") {
    try {
      const dir = url.searchParams.get("dir") || activeProjectRoot || root;
      const scanRoot = isAbsolute(dir) ? dir : resolve(root, dir);
      return Response.json(await packageVersions(scanRoot));
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Set version ranges for one or more packages, then reinstall
  if (path === "/__studio/packages/set-versions" && req.method === "POST") {
    try {
      /* SAFETY: `updates` is checked to be an array below and each entry is Studio's own
         `{ name, version, dev }` triple from the versions panel; a wrongly typed `dir` throws in
         isAbsolute inside this try and answers 500. */
      const body = (await req.json()) as {
        dir?: string;
        updates?: { name: string; version: string; dev?: boolean }[];
      };
      if (!Array.isArray(body.updates)) {
        return problem("invalidRequest", "Missing updates");
      }
      const dir = body.dir || activeProjectRoot || root;
      const scanRoot = isAbsolute(dir) ? dir : resolve(root, dir);
      return Response.json(await setPackageVersions(scanRoot, body.updates));
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Read file
  if (path === "/__studio/file" && req.method === "GET") {
    const fp = url.searchParams.get("path");
    if (!fp) {
      return problem("invalidRequest", "Missing path");
    }
    const abs = expandTilde(fp);
    try {
      assertAccessible(abs, root, activeProjectRoot);
    } catch (error) {
      return new Response(errorMessage(error), { status: 400 });
    }
    try {
      return Response.json(
        {
          content: await readFile(abs, "utf8"),
          path: fp,
        },
        { headers: { "Cache-Control": "public, max-age=5" } },
      );
    } catch (error) {
      if (!isNotFound(error)) {
        return problem("internalError", errorMessage(error));
      }
      /* `optional=1`: the caller is asking whether the file is there, and "no" is an ordinary
         answer rather than a failure — the same reasoning that makes a missing directory's listing
         a 404 instead of a 500, one step further. A per-directory `.gitignore` probe is the case
         that needs it: a listing hides dotfiles, so the only way to learn a directory has none is
         to ask, and a 404 per directory lands in the browser console as a failed request. Never
         cached, so a file created a moment later is read rather than remembered as absent. */
      return url.searchParams.get("optional") === "1"
        ? Response.json({ content: null, path: fp }, { headers: { "Cache-Control": "no-store" } })
        : problem("notFound", "Not found");
    }
  }

  /* Read a file's raw BYTES.
     The read side of `/__studio/file/upload`, and a separate route from `/__studio/file` rather
     than a flag on it, because the two differ in more than encoding: that route answers a JSON
     envelope `{ content, path }` with `max-age=5`, and both are wrong here. A caller wanting bytes
     wants a body, and a caller about to overwrite the file must not be handed a five-second-old
     copy of it — an edit applied to stale bytes is a silently wrong file.

     `Bun.file` streams from disk and infers the media type from the extension, which is what makes
     this a handful of lines rather than a decoder. */
  if (path === "/__studio/file/bytes" && req.method === "GET") {
    const fp = url.searchParams.get("path");
    if (!fp) {
      return problem("invalidRequest", "Missing path");
    }
    const abs = expandTilde(fp);
    try {
      assertAccessible(abs, root, activeProjectRoot);
    } catch (error) {
      return new Response(errorMessage(error), { status: 400 });
    }
    const file = Bun.file(abs);
    if (!(await file.exists())) {
      return problem("notFound", "Not found");
    }
    return new Response(file, { headers: { "Cache-Control": "no-store" } });
  }

  // Write file
  if (path === "/__studio/file" && req.method === "PUT") {
    const fp = url.searchParams.get("path");
    if (!fp) {
      return problem("invalidRequest", "Missing path");
    }
    const abs = resolve(root, fp);
    try {
      assertAccessible(abs, root, activeProjectRoot);
    } catch (error) {
      return new Response(errorMessage(error), { status: 400 });
    }
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, await req.text(), "utf8");
      return Response.json({ ok: true, path: fwd(relative(activeProjectRoot ?? root, abs)) });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Upload binary file
  if (path === "/__studio/file/upload" && req.method === "POST") {
    const fp = url.searchParams.get("path");
    if (!fp) {
      return problem("invalidRequest", "Missing path");
    }
    const abs = resolve(root, fp);
    try {
      assertAccessible(abs, root, activeProjectRoot);
    } catch (error) {
      return new Response(errorMessage(error), { status: 400 });
    }
    try {
      await mkdir(dirname(abs), { recursive: true });
      const buffer = await req.arrayBuffer();
      await Bun.write(abs, new Uint8Array(buffer));
      return Response.json({ ok: true, path: fwd(relative(activeProjectRoot ?? root, abs)) });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Delete file
  if (path === "/__studio/file" && req.method === "DELETE") {
    const fp = url.searchParams.get("path");
    if (!fp) {
      return problem("invalidRequest", "Missing path");
    }
    const abs = resolve(root, fp);
    try {
      assertAccessible(abs, root, activeProjectRoot);
    } catch (error) {
      return new Response(errorMessage(error), { status: 400 });
    }
    try {
      /* A directory is removed only when it is EMPTY (`rmdir`), never recursively: a folder of
         files is a decision about every file in it, which the client makes one file at a time. */
      const entry = await stat(abs);
      await (entry.isDirectory() ? rmdir(abs) : unlink(abs));
      return Response.json({ ok: true, path: fwd(relative(activeProjectRoot ?? root, abs)) });
    } catch (error) {
      if (isNotFound(error)) {
        return problem("notFound", "Not found");
      }
      return isNonNullObject(error) && "code" in error && error.code === "ENOTEMPTY"
        ? problem("conflict", "The folder is not empty.")
        : problem("internalError", errorMessage(error));
    }
  }

  // Rename file
  if (path === "/__studio/file/rename" && req.method === "POST") {
    let body: { from?: string; to?: string };
    try {
      /* SAFETY: both members are truthiness-checked below and then path-resolved, where a
         non-string throws before any filesystem call is made. */
      body = (await req.json()) as { from?: string; to?: string };
    } catch {
      return problem("invalidRequest", "Invalid JSON");
    }
    const { from, to } = body;
    if (!from || !to) {
      return problem("invalidRequest", "Missing from or to");
    }
    const absFrom = resolve(root, from);
    const absTo = resolve(root, to);
    try {
      assertAccessible(absFrom, root, activeProjectRoot);
      assertAccessible(absTo, root, activeProjectRoot);
    } catch (error) {
      return new Response(errorMessage(error), { status: 400 });
    }
    try {
      await mkdir(dirname(absTo), { recursive: true });
      await rename(absFrom, absTo);
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
    // Immediately, and before the refactor pass: a room still keyed to the old path would be
    // Flushed back onto disk at shutdown, recreating the file this rename just moved.
    opts.onFileMoved?.(absFrom);
    // Refactor pass: rewrite path references project-wide and, for a component, auto-rename its tag.
    // The move already succeeded, so a refactor failure is reported but never fails the rename.
    const scanRoot = activeProjectRoot ?? root;
    try {
      const registry = await getFormatRegistry(scanRoot);
      const report = await applyRename({ absFrom, absTo, registry, root: scanRoot });
      return Response.json(report);
    } catch (error) {
      /* Project-relative, like the report this stands in for. The route takes its `from`/`to` in
         server space and answers in project space; emitting two spaces from one route is what
         made the sibling `references` route's own confusion survive review (issue 239). */
      return Response.json({
        error: errorMessage(error),
        from: fwd(relative(scanRoot, absFrom)),
        ok: true,
        to: fwd(relative(scanRoot, absTo)),
      });
    }
  }

  // Where a file / component tag is used (the read side of the rename refactor's walker)
  if (path === "/__studio/references" && req.method === "GET") {
    let target = url.searchParams.get("path");
    const tag = url.searchParams.get("tag");
    if (!target && !tag) {
      return problem("invalidRequest", "Missing path or tag");
    }
    const scanRoot = activeProjectRoot ?? root;
    if (target) {
      /* Server-root-relative in (like every sibling route, and like the adapter's `serverPath()`
         sends), project-relative out. The sweep runs in the project's space, so the target has to
         be re-expressed into it: resolving against `scanRoot` directly doubles the prefix, and a
         doubled prefix names a file that does not exist — which reads as a confident zero (issue 239). */
      const abs = resolve(root, target);
      try {
        assertAccessible(abs, root, activeProjectRoot);
      } catch (error) {
        return new Response(errorMessage(error), { status: 400 });
      }
      const inProject = fwd(relative(scanRoot, abs));
      if (inProject === "" || inProject.startsWith("../") || isAbsolute(inProject)) {
        return problem("invalidRequest", "path is outside the active project");
      }
      target = inProject;
    }
    try {
      const registry = await getFormatRegistry(scanRoot);
      return Response.json(
        await findReferences({ path: target, registry, root: scanRoot, tagName: tag }),
      );
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Locate a file by name within the project root
  if (path === "/__studio/locate" && req.method === "POST") {
    let body: { name?: string };
    try {
      /* SAFETY: `name` is truthiness-checked below and then interpolated into a glob pattern, so
         a non-string value is stringified the same way a template literal always would. */
      body = (await req.json()) as { name?: string };
    } catch {
      return problem("invalidRequest", "Invalid JSON");
    }
    const { name } = body;
    if (!name) {
      return problem("invalidRequest", "Missing name");
    }

    try {
      const glob = new Bun.Glob(`**/${name}`);
      const matches = [];
      for await (const match of glob.scan({ cwd: root, dot: false })) {
        // Skip node_modules / dist / hidden dirs
        if (match.includes("node_modules") || fwd(match).includes("dist/")) {
          continue;
        }
        matches.push(fwd(match));
      }
      const [first] = matches;
      if (first === undefined) {
        return Response.json({ path: null });
      }
      return Response.json(
        matches.length > 1 ? { path: first, alternatives: matches } : { path: first },
      );
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Discover a plugin module's schema for studio form rendering
  /* Cloudflare API passthrough — the backend of the publish surface's `cfApi`.
     Stateless: the credential arrives per-request in X-CF-Token (the user's
     pasted API token, kept client-side) and is never stored. Only account
     listing and Pages project/deployment paths are reachable. */
  if (path === "/__studio/cf/proxy" && req.method === "POST") {
    const CF_PROXY_ALLOWLIST = [
      /^\/accounts$/,
      /^\/accounts\/[0-9a-f]{32}\/pages\/projects(?:\/[\w-]+)?$/,
      /^\/accounts\/[0-9a-f]{32}\/pages\/projects\/[\w-]+\/deployments(?:\/[\w-]+)?$/,
      /^\/accounts\/[0-9a-f]{32}\/pages\/projects\/[\w-]+\/deployments\/[\w-]+\/retry$/,
    ];
    const cfToken = req.headers.get("X-CF-Token");
    if (!cfToken) {
      return problem("unauthorized", "Missing X-CF-Token header");
    }
    let payload: { path?: string; method?: string; body?: JsonValue };
    try {
      /* SAFETY: `path` is matched against CF_PROXY_ALLOWLIST before use, `method` goes to fetch,
         which converts and validates it per the Fetch standard, and `body` is re-serialized with
         JSON.stringify, so it only ever needs to be the JSON value it was parsed as. */
      payload = (await req.json()) as typeof payload;
    } catch {
      return problem("invalidRequest", "Invalid JSON body");
    }
    const apiPath = payload.path ?? "";
    if (!CF_PROXY_ALLOWLIST.some((re) => re.test(apiPath))) {
      return problem("forbidden", `Path not allowed: ${apiPath}`);
    }
    const method = payload.method ?? "GET";
    const authorization = `Bearer ${cfToken}`;
    const init: RequestInit =
      payload.body === undefined
        ? { method, headers: { Authorization: authorization } }
        : {
            method,
            headers: { Authorization: authorization, "Content-Type": "application/json" },
            body: JSON.stringify(payload.body),
          };
    const upstream = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, init);
    return new Response(upstream.body, {
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
      status: upstream.status,
    });
  }

  // Format capability proxy — studio fallback for capabilities whose timing excludes "client".
  // Dispatches parse/serialize through the project's format registry by import name.
  if (path === "/__studio/format" && req.method === "POST") {
    try {
      /* SAFETY: `format` and `action` are checked below (`action` against the two capability
         names), and `source`, `doc` and `options` are handed to the format's own parse/serialize,
         which owns their validation; any throw answers 500 from this try. */
      const body = (await req.json()) as {
        format?: string;
        action?: string;
        source?: string;
        doc?: JsonObject;
        options?: JsonObject;
        dir?: string;
      };
      const { format, action, source, doc, options } = body;
      const dir = body.dir || activeProjectRoot || root;
      const projectRoot = isAbsolute(dir) ? dir : resolve(root, dir);
      assertAccessible(projectRoot, root, activeProjectRoot);

      if (!format || !action) {
        return problem("invalidRequest", "Missing format or action");
      }
      if (action !== "parse" && action !== "serialize") {
        return problem("invalidRequest", `Unsupported action "${action}"`);
      }
      const registry = await getFormatRegistry(projectRoot);
      const entry = registry.byName(format);
      if (!entry) {
        return problem("notFound", `Format "${format}" is not an imported format class`);
      }
      const result =
        action === "parse"
          ? await entry.call("parse", source ?? "", options)
          : await entry.call("serialize", doc ?? {}, options);
      return Response.json({ result });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Format registry listing — lets the studio introspect available formats without
  // Fetching each .class.json itself. The sibling `extensions` array carries each enabled
  // Extension's manifest identity and project-section contributions (additive; the `formats`
  // Shape is unchanged for compat).
  if (path === "/__studio/formats" && req.method === "GET") {
    const dir = url.searchParams.get("dir") || activeProjectRoot || root;
    const projectRoot = isAbsolute(dir) ? dir : resolve(root, dir);
    try {
      assertAccessible(projectRoot, root, activeProjectRoot);
      const registry = await getExtensionRegistry(projectRoot);
      return Response.json({
        extensions: buildExtensionsPayload(registry),
        formats: registry.formats.entries.map((e) => ({
          capabilities: e.capabilities,
          documentKinds: e.documentKinds,
          exportTarget: e.exportTarget,
          extensions: e.extensions,
          mediaType: e.mediaType,
          name: e.name,
          remote: e.remote,
          studio: e.studio,
        })),
      });
    } catch (error) {
      return problem("invalidRequest", errorMessage(error));
    }
  }

  // What this backend can OFFER, enabled or not (specs/extensions.md §9.2) — the shipped
  // First-party catalogue plus any dependency of THIS project exporting a jx-extension.json, each
  // Marked with whether the project resolves it and whether this host does.
  //
  // Deliberately NOT a field on /__studio/formats. That route builds the project's registry and
  // Fails when a declared extension does not resolve, which is exactly the state a reader is in
  // When they need the catalogue to repair it; riding on formats would make the answer unavailable
  // Precisely when it is the fix.
  if (path === "/__studio/catalog" && req.method === "GET") {
    const dir = url.searchParams.get("dir") || activeProjectRoot || root;
    const projectRoot = isAbsolute(dir) ? dir : resolve(root, dir);
    try {
      assertAccessible(projectRoot, root, activeProjectRoot);
      const { buildExtensionCatalog } = await import("./extension-catalog.ts");
      return Response.json(await buildExtensionCatalog(projectRoot));
    } catch (error) {
      return problem("invalidRequest", errorMessage(error));
    }
  }

  // Pre-bundled per-project entry schemas (project.schema.json / document.schema.json) for the
  // Studio's editor — regenerated on demand when missing or older than project.json, then bundled
  // Into self-contained compound documents so no relative $ref resolution is needed client-side.
  if (path === "/__studio/project-schemas" && req.method === "GET") {
    const dir = url.searchParams.get("dir") || activeProjectRoot || root;
    const projectRoot = isAbsolute(dir) ? dir : resolve(root, dir);
    try {
      assertAccessible(projectRoot, root, activeProjectRoot);
    } catch (error) {
      return problem("invalidRequest", errorMessage(error));
    }
    try {
      const { document, project } = await readBundledProjectSchemas(projectRoot);
      return Response.json({ document, project });
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  if (path === "/__studio/plugin-schema" && req.method === "GET") {
    const src = url.searchParams.get("src");
    const prototype = url.searchParams.get("prototype");
    const base = url.searchParams.get("base");
    if (!src) {
      return problem("invalidRequest", "Missing src param");
    }

    let moduleAbsPath;
    try {
      if (src.startsWith("./") || src.startsWith("../")) {
        // Relative path
        if (base) {
          const docUrlPath = new URL(base).pathname;
          const docDir = docUrlPath.slice(0, docUrlPath.lastIndexOf("/") + 1);
          moduleAbsPath = resolve(resolve(root, `.${docDir}`), src);
        } else {
          moduleAbsPath = resolve(activeProjectRoot || root, src);
          if (!existsSync(moduleAbsPath) && activeProjectRoot) {
            moduleAbsPath = resolve(root, src);
          }
        }
      } else {
        // Npm/bare specifier — use createRequire from project root, fall back to server package
        const projectRoot = activeProjectRoot || root;
        const { createRequire } = await import("node:module");
        const projRequire = createRequire(resolve(projectRoot, "package.json"));
        try {
          moduleAbsPath = projRequire.resolve(src);
        } catch {
          const serverRequire = createRequire(import.meta.url);
          moduleAbsPath = serverRequire.resolve(src);
        }
      }
    } catch (error) {
      return Response.json({
        error: errorMessage(error),
        schema: null,
      });
    }

    // .class.json: read and extract schema directly
    if (moduleAbsPath.endsWith(".class.json")) {
      try {
        const content = readFileSync(moduleAbsPath, "utf8");
        /* SAFETY: every ClassJsonDef member is optional and extractStudioSchema guards or relays
           each one it reads; a non-object file throws into the catch below or yields no members. */
        const classDef = JSON.parse(content) as ClassJsonDef;
        return Response.json({
          schema: extractStudioSchema(classDef, moduleAbsPath),
        });
      } catch (error) {
        return Response.json({
          error: errorMessage(error),
          schema: null,
        });
      }
    }

    // Sibling .class.json auto-discovery: check for <ClassName>.class.json next to the .js module
    const exportName = prototype || src;
    const classJsonPath = resolve(dirname(moduleAbsPath), `${exportName}.class.json`);
    if (existsSync(classJsonPath)) {
      try {
        const content = readFileSync(classJsonPath, "utf8");
        /* SAFETY: every ClassJsonDef member is optional and extractStudioSchema guards or relays
           each one it reads; a malformed file throws and falls through to the module import. */
        const classDef = JSON.parse(content) as ClassJsonDef;
        return Response.json({
          schema: extractStudioSchema(classDef, classJsonPath),
        });
      } catch {
        // Fall through to JS module import
      }
    }

    // Fallback: import JS module (backwards compat for classes without .class.json)
    try {
      /* SAFETY: import() only ever resolves to a module namespace object, and PluginExport names
         every kind of value (primitive, function, object) a string-keyed member can hold. */
      const mod = (await import(moduleAbsPath)) as PluginModule;
      const fallback = mod.default;
      const ExportedClass =
        mod[exportName] ??
        (isNonNullObject(fallback) || isPluginClass(fallback) ? fallback[exportName] : undefined);
      if (!isPluginClass(ExportedClass)) {
        return Response.json({
          error: `Export "${exportName}" not found`,
          schema: null,
        });
      }
      return Response.json({ schema: ExportedClass.schema ?? null });
    } catch (error) {
      return Response.json({
        error: errorMessage(error),
        schema: null,
      });
    }
  }

  // ── Git endpoints ──────────────────────────────────────────────────────────

  if (path.startsWith("/__studio/git/")) {
    /* THE REPOSITORY IS THE REQUEST'S, NOT THE SERVER'S. One dev server serves every Studio tab
       pointed at it, and `activeProjectRoot` is whichever project was activated last. Read from it
       alone, two sessions on two projects ran each other's git: Initialize Repository in one
       initialised the other. Every git call names its project with `?dir=`, as the file routes do,
       under the same access rule; the fallback is for a caller that names none (no project open). */
    const named = url.searchParams.get("dir");
    const cwd = named
      ? isAbsolute(named)
        ? named
        : resolve(root, named)
      : activeProjectRoot || root;
    if (named) {
      try {
        assertAccessible(cwd, root, activeProjectRoot);
      } catch (error) {
        return problem("invalidRequest", errorMessage(error));
      }
    }
    const gitCmd = path.slice("/__studio/git/".length);

    const runGit = async (args: string[]) => {
      const proc = Bun.spawn(["git", ...args], {
        cwd,
        stderr: "pipe",
        stdout: "pipe",
      });
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      if (exitCode !== 0) {
        /*
         * Both streams, because git splits its failures across them and stderr alone loses the
         * ones that matter most. A conflicting `git pull` writes every `CONFLICT (…)` line to
         * STDOUT and leaves stderr empty — so the old `stderr || "git exited with 1"` turned the
         * one failure this API publishes a shape for into a contentless message, and the 409 the
         * route table promises could never be produced.
         */
        throw new GitCommandError(
          stderr || stdout || `git exited with ${exitCode}`,
          stderr,
          stdout,
        );
      }
      return stdout;
    };

    try {
      /* Every command but the two that make a repository acts on THE PROJECT'S repository, so one
         that has none of its own is refused rather than handed to whatever checkout encloses it
         (see `projectHasRepository`). */
      const makesRepository = gitCmd === "init" || gitCmd === "clone";
      const hasRepository = makesRepository || (await projectHasRepository(cwd));
      if (gitCmd === "status" && req.method === "GET") {
        if (!hasRepository) {
          return Response.json({
            ahead: 0,
            behind: 0,
            branch: "",
            files: [],
            isRepo: false,
            remotes: [],
          });
        }

        /* `--untracked-files=all`: every untracked FILE, not its collapsed folder. By default git
           reports a wholly untracked `content/` as one entry, so a fresh repository listed a
           handful of folders that no group, comparison or checkbox could treat as a file, and the
           count jumped to the real one the moment staging expanded them (studio.md §22.8). */
        const [out, remotesOut] = await Promise.all([
          runGit(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]),
          runGit(["remote"]),
        ]);
        const status = parseGitStatus(out);
        const fullStatus = {
          ...status,
          isRepo: true,
          remotes: remotesOut.trim().split("\n").filter(Boolean),
        };
        return Response.json(fullStatus);
      }

      if (!hasRepository) {
        return problem(
          "conflict",
          "This project is not a git repository of its own. Initialize one to use source control.",
        );
      }

      if (gitCmd === "init" && req.method === "POST") {
        await runGit(["init"]);
        return Response.json({ ok: true });
      }

      if (gitCmd === "add-remote" && req.method === "POST") {
        /* SAFETY: both members are truthiness-checked below and reach git as their own argv
           entries with no shell; Bun.spawn stringifies a non-string entry, so a wrong type can only
           become a literal remote name or URL, which git validates and refuses or records. */
        const { name, url: remoteUrl } = (await req.json()) as {
          name?: string;
          url?: string;
        };
        if (!name || !remoteUrl) {
          return problem("invalidRequest", "name and url required");
        }
        await runGit(["remote", "add", name, remoteUrl]);
        return Response.json({ ok: true });
      }

      if (gitCmd === "branches" && req.method === "GET") {
        const out = await runGit(["branch", "--format=%(refname:short)\t%(HEAD)"]);
        let current = "";
        const branches = [];
        for (const line of out.trim().split("\n")) {
          if (!line) {
            continue;
          }
          const [name, head] = line.split("\t");
          branches.push(name!);
          if (head === "*") {
            current = name!;
          }
        }
        return Response.json({ branches, current });
      }

      if (gitCmd === "log" && req.method === "GET") {
        const limit = url.searchParams.get("limit") || "20";
        const out = await runGit(["log", `--max-count=${limit}`, "--format=%H\t%s\t%an\t%aI"]);
        const entries = out
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [hash, message, author, date] = line.split("\t");
            return { author, date, hash, message };
          });
        return Response.json(entries);
      }

      if (gitCmd === "stage" && req.method === "POST") {
        /* SAFETY: `files` is checked to be a non-empty array below; each entry is screened with
           `.includes("..")` (an entry without that method throws inside this try) and reaches git
           after `--`, where it can only be read as a pathspec. */
        const { files } = (await req.json()) as { files?: string[] };
        if (!Array.isArray(files) || files.length === 0) {
          return problem("invalidRequest", "Missing files");
        }
        for (const f of files) {
          if (f.includes("..")) {
            return problem("invalidRequest", "Invalid path");
          }
        }
        await runGit(["add", "--", ...files]);
        return Response.json({ ok: true });
      }

      if (gitCmd === "unstage" && req.method === "POST") {
        /* SAFETY: `files` is checked to be a non-empty array below, and its entries reach git
           after `--`, so they can only ever be read as pathspecs. */
        const { files } = (await req.json()) as { files?: string[] };
        if (!Array.isArray(files) || files.length === 0) {
          return problem("invalidRequest", "Missing files");
        }
        await runGit(["restore", "--staged", "--", ...files]);
        return Response.json({ ok: true });
      }

      if (gitCmd === "commit" && req.method === "POST") {
        // SAFETY: `message` is re-checked with isString below before it reaches argv.
        const { message } = (await req.json()) as { message?: string };
        if (!message || !isString(message)) {
          return problem("invalidRequest", "Missing message");
        }
        const statusOut = await runGit(["status", "--porcelain"]);
        const hasStaged = statusOut
          .split("\n")
          .some((l) => l.length > 0 && l[0] !== " " && l[0] !== "?");
        const args = hasStaged ? ["commit", "-m", message] : ["commit", "-a", "-m", message];
        const out = await runGit(args);
        const hashMatch = out.match(/\[[\w/]+ ([a-f0-9]+)\]/);
        return Response.json({ hash: hashMatch?.[1] || "", ok: true });
      }

      if (gitCmd === "push" && req.method === "POST") {
        let body: PushBody = {};
        try {
          // SAFETY: `setUpstream` is the only member read, and only for truthiness.
          body = (await req.json()) as PushBody;
        } catch {}
        const { setUpstream } = body;
        if (setUpstream) {
          const branchRaw = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
          const branch = branchRaw.trim();
          await runGit(["push", "-u", "origin", branch]);
        } else {
          await runGit(["push"]);
        }
        return Response.json({ ok: true });
      }

      if (gitCmd === "pull" && req.method === "POST") {
        /*
         * The one failure the route table has always published — `409 {conflicts}` — and never
         * produced: a conflicting pull threw like any other git failure and reached the catch-all
         * as a 500, so Studio told the user the backend broke rather than that their branch and
         * the remote both touched the same files. The conflicting paths are the only thing that
         * makes the message actionable, so they ride along as the extension member the type
         * documents.
         */
        try {
          await runGit(["pull"]);
        } catch (error) {
          const conflicts =
            error instanceof GitCommandError
              ? conflictingPaths(`${error.stdout}\n${error.stderr}`)
              : [];
          if (conflicts.length === 0) {
            throw error;
          }
          return problem(
            "conflict",
            `Pull stopped: ${conflicts.length} file(s) changed on both sides.`,
            { conflicts },
          );
        }
        return Response.json({ ok: true });
      }

      if (gitCmd === "fetch" && req.method === "POST") {
        await runGit(["fetch"]);
        return Response.json({ ok: true });
      }

      if (gitCmd === "checkout" && req.method === "POST") {
        // SAFETY: `branch` is re-checked with isString below before it reaches argv.
        const { branch } = (await req.json()) as { branch?: string };
        if (!branch || !isString(branch)) {
          return problem("invalidRequest", "Missing branch");
        }
        await runGit(["checkout", branch]);
        return Response.json({ ok: true });
      }

      if (gitCmd === "create-branch" && req.method === "POST") {
        // SAFETY: `name` is re-checked with isString below before it reaches argv.
        const { name } = (await req.json()) as { name?: string };
        if (!name || !isString(name)) {
          return problem("invalidRequest", "Missing name");
        }
        await runGit(["checkout", "-b", name]);
        return Response.json({ ok: true });
      }

      if (gitCmd === "diff" && req.method === "GET") {
        const fp = url.searchParams.get("path");
        if (!fp) {
          return problem("invalidRequest", "Missing path");
        }
        if (fp.includes("..")) {
          return problem("invalidRequest", "Invalid path");
        }
        const diff = await runGit(["diff", "--", fp]);
        return Response.json({ diff });
      }

      if (gitCmd === "show" && req.method === "GET") {
        const fp = url.searchParams.get("path");
        const ref = url.searchParams.get("ref") || "HEAD";
        if (!fp) {
          return problem("invalidRequest", "Missing path");
        }
        if (fp.includes("..")) {
          return problem("invalidRequest", "Invalid path");
        }
        /* `./` IS LOAD-BEARING. `git show <rev>:<path>` resolves <path> from the REPOSITORY ROOT,
           whatever the cwd is; only a `./` prefix makes it relative to the cwd. Every other verb
           here — status, diff, checkout — is cwd-relative, and so is the `readFile` the studio
           pairs this with, so without it a project nested inside its repo compared two DIFFERENT
           FILES: the working copy of `examples/package.json` against the committed root
           `package.json`, with no error anywhere and a plausible-looking diff. */
        const content = await runGit(["show", `${ref}:./${fp}`]);
        return Response.json({ content });
      }

      if (gitCmd === "discard" && req.method === "POST") {
        /* SAFETY: `files` is checked to be a non-empty array below; each entry is screened with
           `.includes("..")` (an entry without that method throws inside this try) and reaches git
           after `--`, where it can only be read as a pathspec. */
        const { files } = (await req.json()) as { files?: string[] };
        if (!Array.isArray(files) || files.length === 0) {
          return problem("invalidRequest", "Missing files");
        }
        for (const f of files) {
          if (f.includes("..")) {
            return problem("invalidRequest", "Invalid path");
          }
        }
        await runGit(["checkout", "--", ...files]);
        return Response.json({ ok: true });
      }

      if (gitCmd === "clone" && req.method === "POST") {
        // SAFETY: `url` is re-checked with isString below before it reaches argv.
        const { url: repoUrl } = (await req.json()) as { url?: string };
        if (!repoUrl || !isString(repoUrl)) {
          return problem("invalidRequest", "Missing url");
        }
        const repoName = basename(repoUrl.replace(/\.git$/, ""));
        const dest = resolve(cwd, repoName);
        const proc = Bun.spawn(["git", "clone", repoUrl, dest], {
          cwd,
          stderr: "pipe",
          stdout: "pipe",
        });
        const exitCode = await proc.exited;
        const stderr = await new Response(proc.stderr).text();
        if (exitCode !== 0) {
          throw new Error(stderr || `git clone exited with ${exitCode}`);
        }
        return Response.json({ ok: true, root: dest });
      }
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  return null;
}

/** The flat form-rendering schema the studio's renderSchemaFields() consumes. */
interface StudioSchema {
  description: string | undefined;
  properties: Record<string, JsonObject>;
  required: string[];
  returns?: JsonValue;
  format?: JsonValue;
  $studio?: JsonValue;
  capabilities?: Record<string, { identifier: string; timing: string[] }>;
}

/**
 * Extract a studio-friendly schema from a .class.json definition. Transforms $defs.parameters and
 * $defs.fields into the flat { description, properties, required } shape that renderSchemaFields()
 * in the studio already consumes.
 *
 * @param {ClassJsonDef} classDef
 * @param {string} classJsonPath
 */
function extractStudioSchema(classDef: ClassJsonDef, classJsonPath: string): StudioSchema {
  // If extends.$ref points to a parent, recursively merge
  let parentSchema = null;
  // `?.$ref` is undefined for a non-object `extends`, so a primitive never reaches resolve().
  if (classDef.extends?.$ref) {
    try {
      const parentPath = resolve(dirname(classJsonPath), classDef.extends.$ref);
      const parentContent = readFileSync(parentPath, "utf8");
      /* SAFETY: every ClassJsonDef member is optional and each one read here is either guarded
         (isNonNullObject on `type`, truthiness elsewhere) or relayed verbatim; a non-object file
         throws into the catch below or yields no members. */
      const parentDef = JSON.parse(parentContent) as ClassJsonDef;
      parentSchema = extractStudioSchema(parentDef, parentPath);
    } catch {
      // Parent not found — proceed without inheritance
    }
  }

  const params = classDef.$defs?.parameters ?? {};
  const fields = classDef.$defs?.fields ?? {};
  const properties: Record<string, JsonObject> = {};
  const required: string[] = [];

  // Start with parent properties (child overrides)
  if (parentSchema?.properties) {
    Object.assign(properties, parentSchema.properties);
  }
  if (parentSchema?.required) {
    required.push(...parentSchema.required);
  }

  // Build properties from parameters (constructor config surface)
  for (const [key, param] of Object.entries(params)) {
    const id = param.identifier ?? key;
    const prop: JsonObject = {};
    if (isNonNullObject(param.type)) {
      Object.assign(prop, param.type);
    }
    if (param.description) {
      prop.description = param.description;
    }
    if (param.examples) {
      prop.examples = param.examples;
    }
    if (param.format) {
      prop.format = param.format;
    }
    properties[id] = prop;
  }

  // Build properties from fields (config-visible ones only)
  for (const [key, field] of Object.entries(fields)) {
    if (field.role !== "field") {
      continue;
    }
    if (field.access === "private") {
      continue;
    }
    const id = field.identifier ?? key;
    const prop: JsonObject = {};
    if (isNonNullObject(field.type)) {
      Object.assign(prop, field.type);
    }
    if (field.description) {
      prop.description = field.description;
    }
    if (field.default !== undefined) {
      prop.default = field.default;
    }
    if (field.initializer !== undefined && prop.default === undefined) {
      prop.default = field.initializer;
    }
    if (field.examples) {
      prop.examples = field.examples;
    }
    properties[id] = prop;
  }

  // Determine required from constructor parameters that have no default
  const ctorParams = classDef.$defs?.constructor?.parameters ?? [];
  const requiredSet = new Set<string>(required);
  for (const p of ctorParams) {
    const name = p.$ref ? p.$ref.split("/").pop() : (p.identifier ?? p.name);
    if (name && properties[name] && properties[name].default === undefined) {
      requiredSet.add(name);
    }
  }

  const resolveMethod = classDef.$defs?.methods?.resolve;

  // Surface format-extension metadata: the format block, studio hints, and a
  // Capability summary ({ parse: { timing }, serialize: { timing }, ... }).
  const capabilityRoles = new Set(["parse", "serialize", "discover", "load"]);
  const capabilities: Record<string, { identifier: string; timing: string[] }> = {};
  const methods = classDef.$defs?.methods ?? {};
  for (const [key, method] of Object.entries(methods)) {
    if (method.role && capabilityRoles.has(method.role)) {
      capabilities[method.role] = {
        identifier: method.identifier ?? key,
        timing: method.timing ?? ["compiler", "server"],
      };
    }
  }

  // Optional members are added in this order, which is the key order the studio receives.
  const schema: StudioSchema = {
    description: classDef.description ?? classDef.title,
    properties,
    required: [...requiredSet],
  };
  if (resolveMethod?.returns) {
    schema.returns = resolveMethod.returns;
  }
  if (classDef.format) {
    schema.format = classDef.format;
  }
  if (classDef.$studio) {
    schema.$studio = classDef.$studio;
  }
  if (Object.keys(capabilities).length > 0) {
    schema.capabilities = capabilities;
  }
  return schema;
}
