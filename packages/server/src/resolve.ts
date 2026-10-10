/** Resolve.js — Generic $src module proxy + timing: "server" function proxy */

import { siteBasePath } from "@jxsuite/schema/asset-paths";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { errorMessage, parseClassDef } from "@jxsuite/schema/parse";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { projectDevEnv } from "./dev-vars.ts";
import { containedPath } from "./net-guard.ts";
import { buildProjectExtensionRegistry } from "@jxsuite/compiler/format-host";
import { loadProjectSections } from "@jxsuite/compiler/project-sections";
import { loadAssetMounts } from "@jxsuite/compiler/asset-mounts";
import type { AssetMount } from "@jxsuite/schema/asset-paths";
import type { DynamicClass } from "@jxsuite/runtime/types";
import type { JxClassDef, ProjectConfig } from "@jxsuite/schema/types";
import { problem } from "./problem.ts";

interface ModuleNamespace {
  default?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ClassInstance {
  resolve?: () => unknown;
  value?: unknown;
  [key: string]: unknown;
}

interface ResolveBody {
  $src?: string;
  $prototype?: string;
  $export?: string;
  $base?: string;
  [key: string]: unknown;
}

interface ServerFunctionBody {
  $src?: string;
  $export?: string;
  $base?: string;
  arguments?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * True when `p` is contained within `root` or (when set) `activeProjectRoot`. Guards every
 * `import()`/read of a caller-supplied `$src`/`$base`/`$implementation` so a `../` or absolute path
 * cannot pull in arbitrary modules from the filesystem.
 */
function isImportable(p: string, root: string, activeProjectRoot: string | null): boolean {
  if (containedPath(p, root) !== null) {
    return true;
  }
  if (activeProjectRoot && containedPath(p, activeProjectRoot) !== null) {
    return true;
  }
  return false;
}

/**
 * The directory holding the document a `$base` names, which a relative `$src` resolves against.
 *
 * Hosts spell a base two ways. A page served at a site URL (`jx dev`, the live preview) names a
 * path under `root`, and a single leading slash always means that, even when the path would also
 * read as an absolute one: a root `/app` may hold a site directory `app/`. Studio's canvas
 * addresses a project by its absolute filesystem path instead (`documentBase` in
 * `packages/studio`), so its base arrives as `//abs/project/pages/x.json`, or
 * `/C:/project/pages/x.json` on Windows: the spelling the static file lanes map back to the file
 * (`serveProjectFile`). A `file:` URL's path is a filesystem path too. Those spellings name the
 * path itself only when it lies under `root` or the active project, so any other path keeps meaning
 * a site URL. The pathname is percent-decoded first, because a URL encodes a space in a directory
 * name and the filesystem does not.
 *
 * @param {string} $base - The document URL the runtime sent
 * @param {string} root - The root a site URL names a path under
 * @param {string} projectRoot - The active project, which may sit outside `root`
 * @returns {string} An absolute directory
 */
function baseDirectory($base: string, root: string, projectRoot: string): string {
  const url = new URL($base);
  const pathname = decodeURIComponent(url.pathname);
  const urlDir = pathname.slice(0, pathname.lastIndexOf("/") + 1);
  const spellsPath = urlDir.startsWith("//") || /^\/[A-Za-z]:/.test(urlDir);
  const fsDir = spellsPath ? urlDir.slice(1) : url.protocol === "file:" ? urlDir : null;
  if (
    fsDir !== null &&
    isAbsolute(fsDir) &&
    (containedPath(fsDir, root) !== null || containedPath(fsDir, projectRoot) !== null)
  ) {
    return resolve(fsDir);
  }
  return resolve(root, `.${urlDir}`);
}

/** Per-project context cache, invalidated when project.json changes on disk. */
const projectContextCache = new Map<
  string,
  { mtime: number; context: Record<string, unknown>; mounts: AssetMount[] }
>();

/**
 * Lazy-load project context (project.json + extension-loaded sections) for class instantiation.
 * Sections land under their section keys (e.g. `content` for the parser), matching the compiler's
 * `_project` shape.
 *
 * @param {string} projectRoot
 * @returns {Promise<Record<string, unknown> | null>} `{ config, root, ...sections }` or null
 */
async function loadProjectContext(projectRoot: string) {
  const entry = await loadProjectEntry(projectRoot);
  return entry?.context ?? null;
}

/** Load (or reuse) the cached project context plus its extension asset mounts. */
async function loadProjectEntry(projectRoot: string) {
  const projectJsonPath = resolve(projectRoot, "project.json");
  if (!existsSync(projectJsonPath)) {
    return null;
  }
  try {
    const { mtimeMs } = statSync(projectJsonPath);
    const cached = projectContextCache.get(projectRoot);
    if (cached && cached.mtime === mtimeMs) {
      return cached;
    }
    const config = JSON.parse(readFileSync(projectJsonPath, "utf8")) as ProjectConfig;
    const registry = await buildProjectExtensionRegistry(projectRoot, config);
    const sections = await loadProjectSections(projectRoot, config, registry);
    const { mounts } = await loadAssetMounts(registry, config, projectRoot);
    const context = { config, root: projectRoot, ...sections };
    const entry = { context, mounts, mtime: mtimeMs };
    projectContextCache.set(projectRoot, entry);
    return entry;
  } catch {
    return null;
  }
}

/**
 * The path a project says it is deployed under, or `""` for a site at an origin root.
 *
 * Read off `project.json`'s `url` (`@jxsuite/schema/asset-paths`), through the same mtime-keyed
 * cache the asset mounts use — a second cache on the same file would be a second thing to
 * invalidate, and this is asked on every request.
 *
 * @param {string} projectRoot
 * @returns {Promise<string>} A path with a leading slash and no trailing one, or `""`
 */
export async function projectSiteBase(projectRoot: string): Promise<string> {
  const entry = await loadProjectEntry(projectRoot);
  const config = entry?.context.config as ProjectConfig | undefined;
  return siteBasePath(config?.url);
}

/**
 * Extension asset mounts for a project (specs/extensions.md §8.5) — the directories the dev server
 * serves at their site URLs, so content-relative images resolve exactly as they will once built.
 *
 * @param {string} projectRoot
 * @returns {Promise<AssetMount[]>} Mounts, or an empty list when there is no project here
 */
export async function projectAssetMounts(projectRoot: string): Promise<AssetMount[]> {
  const entry = await loadProjectEntry(projectRoot);
  return entry?.mounts ?? [];
}

/**
 * Handle POST /**jx_resolve** — proxy $prototype + $src entries.
 *
 * @param {Request} req
 * @param {string} root
 * @param {string | null} [activeProjectRoot]
 */
export async function handleResolve(
  req: Request,
  root: string,
  activeProjectRoot: string | null = null,
) {
  let body: ResolveBody;
  try {
    body = (await req.json()) as ResolveBody;
  } catch {
    return problem("invalidRequest", "Invalid JSON body");
  }

  const { $src, $prototype, $export: xport, $base, ...config } = body;
  if (!$src) {
    return problem("invalidRequest", "Missing $src");
  }

  let moduleAbsPath;
  // A bare specifier resolves through Node's module resolution (an installed package), so the
  // Class file — and the `$implementation` sibling it names — are as trusted as the package's own
  // Code. The root-escape guard only binds a caller-supplied relative `$src`/`$base`.
  let trustedResolution = false;
  try {
    if ($src.startsWith("./") || $src.startsWith("../")) {
      // Relative path
      if ($base) {
        const docUrlPath = new URL($base).pathname;
        const docDir = docUrlPath.slice(0, docUrlPath.lastIndexOf("/") + 1);
        moduleAbsPath = resolve(resolve(root, `.${docDir}`), $src);
      } else {
        moduleAbsPath = resolve(activeProjectRoot || root, $src);
      }
      if (!isImportable(moduleAbsPath, root, activeProjectRoot)) {
        return new Response(`$src "${$src}" escapes the project root`, { status: 403 });
      }
    } else {
      // Npm/bare specifier — use createRequire from project root, fall back to server package
      const projectRoot = activeProjectRoot || root;
      const projRequire = createRequire(resolve(projectRoot, "package.json"));
      try {
        moduleAbsPath = projRequire.resolve($src);
      } catch {
        const serverRequire = createRequire(import.meta.url);
        moduleAbsPath = serverRequire.resolve($src);
      }
      trustedResolution = true;
    }
  } catch (error) {
    return new Response(`Cannot resolve $src "${$src}": ${errorMessage(error)}`, { status: 400 });
  }

  // Rebase relative config paths from doc-relative to CWD-relative
  if ($base) {
    const docUrlPath = new URL($base).pathname;
    const docDir = docUrlPath.slice(0, docUrlPath.lastIndexOf("/") + 1);
    const docAbsDir = resolve(root, `.${docDir}`);
    for (const [k, v] of Object.entries(config)) {
      if (typeof v === "string" && (v.startsWith("./") || v.startsWith("../"))) {
        config[k] = `./${relative(process.cwd(), resolve(docAbsDir, v)).split("\\").join("/")}`;
      }
    }
  }

  // .class.json: read schema, follow $implementation to the real JS module
  if (moduleAbsPath.endsWith(".class.json")) {
    try {
      const content = readFileSync(moduleAbsPath, "utf8");
      const classDef = parseClassDef(content, moduleAbsPath);

      // Inject project context for classes that need it
      const projectRoot = activeProjectRoot || root;
      const projectCtx = await loadProjectContext(projectRoot);
      if (projectCtx) {
        config._project = projectCtx;
      }
      config._document = { route: { _pathParams: {} }, state: {} };

      if (classDef.$implementation) {
        // Hybrid mode: redirect to the JS implementation
        const implPath = resolve(dirname(moduleAbsPath), classDef.$implementation);
        // A trusted (bare-specifier) class file names its own sibling implementation; only a
        // Project-local relative $src is held to the root-escape guard.
        if (!trustedResolution && !isImportable(implPath, root, activeProjectRoot)) {
          return problem("pathOutsideProject", "$implementation escapes the project root");
        }
        const exportName = xport ?? classDef.title ?? $prototype;
        const mod = (await import(implPath)) as ModuleNamespace;
        const ExportedClass =
          exportName === undefined ? undefined : (mod[exportName] ?? mod.default?.[exportName]);
        if (typeof ExportedClass !== "function") {
          return new Response(`Export "${exportName}" not found in "${classDef.$implementation}"`, {
            status: 500,
          });
        }
        const ClassCtor = ExportedClass as new (config: unknown) => ClassInstance;
        const instance = new ClassCtor(config);
        const value =
          typeof instance.resolve === "function"
            ? await instance.resolve()
            : "value" in instance
              ? instance.value
              : instance;
        return Response.json(value);
      }

      // Self-contained: construct class from schema
      const DynClass = classFromSchema(classDef);
      const instance = new DynClass(config) as {
        resolve?: () => unknown;
        value?: unknown;
      };
      const value =
        typeof instance.resolve === "function"
          ? await instance.resolve()
          : "value" in instance
            ? instance.value
            : instance;
      return Response.json(value);
    } catch (error) {
      return problem("internalError", errorMessage(error));
    }
  }

  // Non-Function $prototype must use .class.json as entrypoint
  return new Response(
    `Non-Function $prototype "${$prototype}" requires a .class.json $src, got "${$src}". ` +
      `Wrap the class in a .class.json schema with $implementation.`,
    { status: 400 },
  );
}

/**
 * Handle POST `/__jx_server__` — proxy timing: "server" function calls. It is the only way an
 * interpreting runtime calls a server function (spec.md §11.4): the runtime never imports the
 * module in the browser, it posts the call here, and the function runs server-side with `env`.
 *
 * A relative `$src` resolves against the directory of the document `$base` names (`baseDirectory`):
 * a site URL's path under `root`, or the absolute path Studio's canvas sends. The imported module
 * stays cached for as long as the host runs, so an edit to it takes effect when the host restarts.
 *
 * @param {Request} req
 * @param {string} root - The root a site-URL `$base`, or a `$src` without one, resolves under
 * @param {string} [projectRoot] - The active project: the function's `env` carries its `.dev.vars`,
 *   and a module under it is importable as one under `root` is. `root` when omitted
 */
export async function handleServerFunction(req: Request, root: string, projectRoot = root) {
  let body: ServerFunctionBody;
  try {
    body = (await req.json()) as ServerFunctionBody;
  } catch {
    return problem("invalidRequest", "Invalid JSON body");
  }

  const { $src, $export: xport, $base, arguments: args = {} } = body;
  if (!$src || !xport) {
    return problem("invalidRequest", "Missing $src or $export");
  }

  let moduleAbsPath;
  try {
    moduleAbsPath = $base
      ? resolve(baseDirectory($base, root, projectRoot), $src)
      : resolve(root, $src);
  } catch (error) {
    return problem("invalidRequest", `Cannot resolve $src: ${errorMessage(error)}`);
  }

  if (!isImportable(moduleAbsPath, root, projectRoot)) {
    return new Response(`$src "${$src}" escapes the project root`, { status: 403 });
  }

  let mod: ModuleNamespace;
  try {
    mod = (await import(moduleAbsPath)) as ModuleNamespace;
  } catch (error) {
    return new Response(`Failed to import "${$src}": ${errorMessage(error)}`, {
      status: 500,
    });
  }

  const fn = mod[xport] ?? mod.default?.[xport];
  if (typeof fn !== "function") {
    return new Response(`Export "${xport}" not found in "${$src}"`, {
      status: 500,
    });
  }

  try {
    /* Match the production contract `fn(args, env)` (compiler emits `fn(args, c.env)`): the dev
       proxy runs server-side, so its `env` is the extension mounts' own, `process.env` merged under
       the project's `.dev.vars` plus `JX_PROJECT_ROOT` (server.md §3.3). */
    const result = await (fn as (args: Record<string, unknown>, env: unknown) => unknown)(
      args,
      projectDevEnv(projectRoot),
    );
    return Response.json(result ?? null);
  } catch (error) {
    return problem("internalError", errorMessage(error));
  }
}

/**
 * Dynamically construct a class from a .class.json schema definition. Server-side variant — no
 * private field limitations.
 *
 * @param {JxClassDef} classDef
 */
function classFromSchema(classDef: JxClassDef) {
  const fields = classDef.$defs?.fields ?? {};
  // JSON objects inherit Object.prototype.constructor — only an own object value counts.
  const rawCtor = classDef.$defs?.constructor;
  const ctor = typeof rawCtor === "object" ? rawCtor : undefined;
  const methods = classDef.$defs?.methods ?? {};

  // oxlint-disable-next-line typescript/no-extraneous-class -- methods are attached to the prototype dynamically below
  class DynClass {
    constructor(config = {}) {
      const self = this as Record<string, unknown>;
      const cfg = config as Record<string, unknown>;
      for (const [key, field] of Object.entries(fields)) {
        const id = field.identifier ?? key;
        if (cfg[id] !== undefined) {
          self[id] = cfg[id];
        } else if (field.initializer !== undefined) {
          self[id] = field.initializer;
        } else if (field.default !== undefined) {
          self[id] = structuredClone(field.default);
        } else {
          self[id] = null;
        }
      }
      if (ctor?.body) {
        const bodyStr = Array.isArray(ctor.body) ? ctor.body.join("\n") : ctor.body;
        new Function("config", bodyStr).call(this, config);
      }
    }
  }

  for (const [key, method] of Object.entries(methods)) {
    const name = method.identifier ?? key;
    const params = (method.parameters ?? []).map((p) => {
      if (p.$ref) {
        return p.$ref.split("/").pop() ?? "arg";
      }
      const n = p.identifier ?? p.name;
      return typeof n === "string" ? n : "arg";
    });
    const bodyStr = Array.isArray(method.body) ? method.body.join("\n") : (method.body ?? "");

    if (method.role === "accessor") {
      const descriptor: PropertyDescriptor = {};
      if (method.getter) {
        descriptor.get = new Function(method.getter.body ?? "") as () => unknown;
      }
      if (method.setter) {
        const sp = (method.setter.parameters ?? []).map((p) => p.$ref?.split("/").pop() ?? "v");
        descriptor.set = new Function(...sp, method.setter.body ?? "") as (v: unknown) => void;
      }
      Object.defineProperty(DynClass.prototype, name, {
        ...descriptor,
        configurable: true,
      });
    } else if (method.scope === "static") {
      (DynClass as DynamicClass)[name] = new Function(...params, bodyStr);
    } else {
      (DynClass as DynamicClass).prototype[name] = new Function(...params, bodyStr);
    }
  }

  Object.defineProperty(DynClass, "name", {
    configurable: true,
    value: classDef.title,
  });
  return DynClass;
}
