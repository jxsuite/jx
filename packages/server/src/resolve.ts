/** Resolve.js — Generic $src module proxy + timing: "server" function proxy */

import { siteBasePath } from "@jxsuite/schema/asset-paths";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { errorMessage, parseClassDef } from "@jxsuite/schema/parse";
import { isFunction, isNonNullObject, isString } from "@jxsuite/schema/guards";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { projectDevEnv } from "./dev-vars.ts";
import { containedPath } from "./net-guard.ts";
import { buildProjectExtensionRegistry } from "@jxsuite/compiler/format-host";
import { loadProjectSections } from "@jxsuite/compiler/project-sections";
import { loadAssetMounts } from "@jxsuite/compiler/asset-mounts";
import type { AssetMount } from "@jxsuite/schema/asset-paths";
import type { DynamicMethod } from "@jxsuite/runtime/types";
import type { ProjectSections } from "@jxsuite/compiler/project-sections";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  JxClassCtorDef,
  JxClassDef,
  ProjectConfig,
} from "@jxsuite/schema/types";
import type { ProjectDevEnv } from "./dev-vars.ts";
import { problem } from "./problem.ts";

/**
 * Any value a module exports, as the proxies see it before they check it. Nothing about an export
 * is known statically (it is project or package code loaded by path), so the type only says what
 * reading it can yield: a function, an object whose members can be read in turn, or a primitive.
 */
type ExportedValue =
  | ExportedFunction
  | ExportedConstructor
  | ExportedObject
  | JsonPrimitive
  | bigint
  | symbol
  | undefined;

/** A function export as it is called. Its real signature is the contract of whoever calls it. */
type ExportedFunction = (...args: never[]) => ExportedValue | Promise<ExportedValue>;

/** A class export as it is constructed. Its real signature is the contract of whoever builds it. */
type ExportedConstructor = new (...args: never[]) => object;

/** A non-primitive export. Reading any member of it yields another {@link ExportedValue}. */
interface ExportedObject {
  readonly [member: string]: ExportedValue;
}

/**
 * A loaded module's namespace object. `default` is read as an object because the proxies only ever
 * read a named member off it, which is defined for any non-nullish value.
 */
interface ModuleNamespace extends ExportedObject {
  readonly default?: ExportedObject;
}

/**
 * The project context a class receives as `config._project`: the config, the root, and every
 * extension-loaded section under its section key (the compiler's `_project` shape).
 */
type ProjectContext = ProjectSections & { config: ProjectConfig; root: string };

/**
 * One `project.json` generation: its config, extension registry and asset mounts, loaded together
 * because they are cheap, and the extension-loaded sections, loaded only when a class asks for
 * them.
 */
interface ProjectEntry {
  mtime: number;
  config: ProjectConfig;
  registry: ExtensionRegistry;
  mounts: AssetMount[];
  /** The full `_project` context, started by the first {@link loadProjectContext} and shared. */
  context?: Promise<ProjectContext> | undefined;
}

/** A value the resolve proxy hands a class constructor under one config key. */
type ConfigValue = JsonValue | ProjectContext | undefined;

/**
 * The `config` a class is constructed with: the request's own members, plus the injected project
 * context and an empty document scope.
 */
interface ResolveConfig {
  [key: string]: ConfigValue;
  _project?: ProjectContext;
}

/** A class `/__jx_resolve__` constructs from an `$implementation` module. */
type ResolvableClass = new (config: ResolveConfig) => ResolvableInstance;

/**
 * What the resolve proxy reads off a constructed instance, in the order spec.md §12.3 fixes:
 * `resolve()` when it is a method, else `value` when the instance has one, else the instance.
 */
interface ResolvableInstance {
  readonly resolve?: ExportedValue;
  readonly value?: ExportedValue;
}

/**
 * What a server function may answer: a JSON value, sent as the response body (`undefined` →
 * `null`).
 */
type ServerFunctionResult = JsonValue | undefined;

/** A `timing: "server"` function: `fn(args, env)`, the production contract the compiler emits. */
type ServerFunction = (
  args: JsonObject,
  env: ProjectDevEnv,
) => ServerFunctionResult | Promise<ServerFunctionResult>;

interface ResolveBody {
  $src?: string;
  $prototype?: string;
  $export?: string;
  $base?: string;
  [key: string]: JsonValue | undefined;
}

interface ServerFunctionBody {
  $src?: string;
  $export?: string;
  $base?: string;
  arguments?: JsonObject;
  [key: string]: JsonValue | undefined;
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

/**
 * Per-project cache, invalidated when project.json changes on disk. It holds the PROMISE, keyed by
 * the mtime it was started for, so concurrent requests on a cold cache share one load.
 *
 * Both halves of that are load-bearing. Every project file the canvas fetches asks for the asset
 * mounts, and the canvas fetches a document's `$elements` in parallel: before the promise was
 * cached, each of them started its own load, so a page with 25 components ran 25 at once. And the
 * sections are not part of it: a content section loads every entry of every collection, which for a
 * 910-entry knowledge base is ten seconds of parsing, so serving a JSON file next to it waited ten
 * seconds for data it never reads. Both together put a component fetch past the canvas's register
 * timeout on every cold open.
 */
const projectEntryCache = new Map<string, { mtime: number; entry: Promise<ProjectEntry | null> }>();

/**
 * Lazy-load project context (project.json + extension-loaded sections) for class instantiation.
 * Sections land under their section keys (e.g. `content` for the parser), matching the compiler's
 * `_project` shape.
 *
 * @param {string} projectRoot
 * @returns {Promise<ProjectContext | null>} `{ config, root, ...sections }` or null
 */
async function loadProjectContext(projectRoot: string): Promise<ProjectContext | null> {
  const entry = await loadProjectEntry(projectRoot);
  if (!entry) {
    return null;
  }
  entry.context ??= loadProjectSections(projectRoot, entry.config, entry.registry, {
    lazy: true,
  }).then((sections) => ({ config: entry.config, root: projectRoot, ...sections }));
  try {
    return await entry.context;
  } catch {
    // A failed load is not remembered: the next class to ask tries again.
    entry.context = undefined;
    return null;
  }
}

/**
 * Whether a class reads `_project` through its sections' on-demand methods, by declaring `static
 * projectOnDemand = true` (specs/extensions.md §8). The sections here are loaded lazily, so a class
 * that reads one synchronously (a `content.get(type)`) would find nothing it had not loaded; such a
 * class is handed every section whole instead, exactly what it was always given.
 */
function readsProjectOnDemand(ExportedClass: ExportedFunction | ExportedConstructor): boolean {
  return "projectOnDemand" in ExportedClass && ExportedClass.projectOnDemand === true;
}

/** A section an owner loaded on demand: `complete()` makes it whole (extensions.md §8). */
interface OnDemandSection {
  complete: () => Promise<void>;
}

/** Whether a project-context value is a section loaded on demand, by its `complete` method. */
function isOnDemandSection(
  value: ProjectContext[string],
): value is ProjectContext[string] & OnDemandSection {
  return isNonNullObject(value) && "complete" in value && isFunction(value.complete);
}

/** Make every section of a project context whole, for a class that reads them synchronously. */
async function completeSections(context: ProjectContext): Promise<void> {
  for (const value of Object.values(context)) {
    if (isOnDemandSection(value)) {
      await value.complete();
    }
  }
}

/** Load (or reuse) the cached project config, extension registry and asset mounts. */
async function loadProjectEntry(projectRoot: string): Promise<ProjectEntry | null> {
  const projectJsonPath = resolve(projectRoot, "project.json");
  const mtime = statSync(projectJsonPath, { throwIfNoEntry: false })?.mtimeMs;
  if (mtime === undefined) {
    return null;
  }
  const cached = projectEntryCache.get(projectRoot);
  if (cached && cached.mtime === mtime) {
    return cached.entry;
  }
  const entry = readProjectEntry(projectRoot, projectJsonPath, mtime);
  projectEntryCache.set(projectRoot, { entry, mtime });
  return entry;
}

/** Read one `project.json` generation. Never rejects: any failure answers "no project context". */
async function readProjectEntry(
  projectRoot: string,
  projectJsonPath: string,
  mtime: number,
): Promise<ProjectEntry | null> {
  try {
    /* SAFETY: trust boundary. project.json is the project's own config file, which the editor
       and `jx validate` hold to its per-project schema. Any failure reading it below is caught
       here and answers "no project context". */
    const config = JSON.parse(readFileSync(projectJsonPath, "utf8")) as ProjectConfig;
    const registry = await buildProjectExtensionRegistry(projectRoot, config);
    const { mounts } = await loadAssetMounts(registry, config, projectRoot);
    return { config, mounts, mtime, registry };
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
  return siteBasePath(entry?.config.url);
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
    /* SAFETY: trust boundary. The body parsed as JSON, and this route's caller is the runtime's
       `$prototype` proxy, which posts the entry's own JSON members with string `$`-keys. A body
       that breaks that throws in this handler, as it always has. */
    body = (await req.json()) as ResolveBody;
  } catch {
    return problem("invalidRequest", "Invalid JSON body");
  }

  const { $src, $prototype, $export: xport, $base, ...members } = body;
  const config: ResolveConfig = members;
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
      if (isString(v) && (v.startsWith("./") || v.startsWith("../"))) {
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
        const mod = await importModule(implPath);
        const ExportedClass =
          exportName === undefined ? undefined : (mod[exportName] ?? mod.default?.[exportName]);
        if (!isExportedFunction(ExportedClass)) {
          return new Response(`Export "${exportName}" not found in "${classDef.$implementation}"`, {
            status: 500,
          });
        }
        if (config._project && !readsProjectOnDemand(ExportedClass)) {
          await completeSections(config._project);
        }
        /* SAFETY: trust boundary. A class file's `$implementation` names the module exporting the
           class it describes, whose constructor takes one config object (spec.md §12.3, §12.4).
           It is a function, checked above; one that is not constructible throws here, inside the
           try whose catch answers a problem. */
        const ClassCtor = ExportedClass as ResolvableClass;
        return Response.json(await instanceResult(new ClassCtor(config)));
      }

      // Self-contained: construct class from schema. Its JSON bodies cannot await a section.
      if (config._project) {
        await completeSections(config._project);
      }
      const DynClass = classFromSchema(classDef);
      return Response.json(await instanceResult(new DynClass(config)));
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
    /* SAFETY: trust boundary. The body parsed as JSON, and this route's caller is the runtime's
       server-function proxy, which posts `{ $src, $export, $base, arguments }` with string
       `$`-keys and an object of arguments. A body that breaks that throws in this handler, as it
       always has. */
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

  // Match the production contract `fn(args, env)` (compiler emits `fn(args, c.env)`): the dev proxy
  // Runs server-side, so its `env` is the extension mounts' own, `process.env` merged under the
  // Project's `.dev.vars` plus `JX_PROJECT_ROOT` (server.md §3.3).
  const result = await callServerExport(moduleAbsPath, xport, args, projectDevEnv(projectRoot));
  if (result.ok) {
    return Response.json(result.value ?? null);
  }
  if (result.stage === "import") {
    return new Response(`Failed to import "${$src}": ${result.message}`, { status: 500 });
  }
  if (result.stage === "export") {
    return new Response(`Export "${xport}" not found in "${$src}"`, { status: 500 });
  }
  return problem("internalError", result.message);
}

/** What {@link callServerExport} answers: the function's value, or the stage that failed and why. */
export type ServerExportResult =
  | { ok: true; value: ServerFunctionResult }
  | { ok: false; stage: "import" | "export" | "call"; message: string };

/**
 * Import a module, read one export and call it as `fn(args, env)`, the contract a `timing:
 * "server"` function has in production (compiler.md §6.3).
 *
 * The one place a dev host runs a server function, so the `/__jx_server__` proxy and the site
 * worker's stand-in route in `jx dev` agree on what an export is (a named export, else a member of
 * a default export) and on where each failure belongs. It decides nothing about WHICH module may
 * run: the proxy's caller names one in a request and checks containment first, while the stand-in
 * route's modules come from the build, so each does its own checking before it gets here.
 *
 * @param {string} modulePath - Absolute path of the module, or a specifier already resolved
 * @param {string} exportName - The export to call
 * @param {JsonObject} args - The function's first argument
 * @param {ProjectDevEnv} env - The function's second argument: the platform environment
 * @returns {Promise<ServerExportResult>}
 */
export async function callServerExport(
  modulePath: string,
  exportName: string,
  args: JsonObject,
  env: ProjectDevEnv,
): Promise<ServerExportResult> {
  let mod: ModuleNamespace;
  try {
    mod = await importModule(modulePath);
  } catch (error) {
    return { message: errorMessage(error), ok: false, stage: "import" };
  }

  const fn = mod[exportName] ?? mod.default?.[exportName];
  if (!isExportedFunction(fn)) {
    return { message: `Export "${exportName}" not found`, ok: false, stage: "export" };
  }

  try {
    /* SAFETY: trust boundary. A `timing: "server"` module exports its functions with the signature
       `fn(args, env)` and a JSON answer (spec.md §11.4); this one is a function, checked above. */
    const serverFn = fn as ServerFunction;
    return { ok: true, value: await serverFn(args, env) };
  } catch (error) {
    return { message: errorMessage(error), ok: false, stage: "call" };
  }
}

/**
 * Whether an export is a function. Every function is callable, constructible or both, which is all
 * the narrowed type claims; which of the two a proxy needs is that proxy's own contract.
 */
function isExportedFunction(value: ExportedValue): value is ExportedFunction | ExportedConstructor {
  return isFunction(value);
}

/** Import a module by absolute path, as its namespace object. */
async function importModule(path: string): Promise<ModuleNamespace> {
  /* SAFETY: a dynamic import() resolves to the module's namespace object, whose own members are its
     exports; every member the proxies read off one is checked to be a function before use. */
  return (await import(path)) as ModuleNamespace;
}

/** What a constructed class answers with: its `resolve()` result, else its `value`, else itself. */
async function instanceResult(
  instance: ResolvableInstance,
): Promise<ExportedValue | ResolvableInstance> {
  if (isFunction(instance.resolve)) {
    return await instance.resolve();
  }
  return "value" in instance ? instance.value : instance;
}

/**
 * Whether a class document's `$defs.constructor` is its own constructor definition, rather than the
 * `Object.prototype.constructor` function every object parsed from JSON inherits.
 *
 * @param rawCtor What `$defs.constructor` reads as
 */
function isCtorDef(
  rawCtor: NonNullable<JxClassDef["$defs"]>["constructor"],
): rawCtor is JxClassCtorDef {
  return isNonNullObject(rawCtor);
}

/**
 * Dynamically construct a class from a .class.json schema definition. Server-side variant — no
 * private field limitations.
 *
 * @param {JxClassDef} classDef
 */
function classFromSchema(classDef: JxClassDef) {
  const fields = classDef.$defs?.fields ?? {};
  const rawCtor = classDef.$defs?.constructor;
  const ctor = isCtorDef(rawCtor) ? rawCtor : undefined;
  const methods = classDef.$defs?.methods ?? {};

  // oxlint-disable-next-line typescript/no-extraneous-class -- methods are attached to the prototype dynamically below
  class DynClass {
    constructor(config: ResolveConfig = {}) {
      // Each field lands as an own property by assignment, as `this[id] = value` would put it.
      for (const [key, field] of Object.entries(fields)) {
        const id = field.identifier ?? key;
        if (config[id] !== undefined) {
          Object.assign(this, { [id]: config[id] });
        } else if (field.initializer !== undefined) {
          Object.assign(this, { [id]: field.initializer });
        } else if (field.default !== undefined) {
          Object.assign(this, { [id]: structuredClone(field.default) });
        } else {
          Object.assign(this, { [id]: null });
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
      return isString(n) ? n : "arg";
    });
    const bodyStr = Array.isArray(method.body) ? method.body.join("\n") : (method.body ?? "");

    if (method.role === "accessor") {
      const descriptor: PropertyDescriptor = {};
      if (method.getter) {
        // SAFETY: `new Function(body)` with no parameter names builds the zero-argument getter.
        descriptor.get = new Function(method.getter.body ?? "") as DynamicMethod;
      }
      if (method.setter) {
        const sp = (method.setter.parameters ?? []).map((p) => p.$ref?.split("/").pop() ?? "v");
        // SAFETY: `new Function(...sp, body)` builds a function over the setter's own parameters.
        descriptor.set = new Function(...sp, method.setter.body ?? "") as DynamicMethod;
      }
      Object.defineProperty(DynClass.prototype, name, {
        ...descriptor,
        configurable: true,
      });
    } else if (method.scope === "static") {
      Object.assign(DynClass, { [name]: new Function(...params, bodyStr) });
    } else {
      Object.assign(DynClass.prototype, { [name]: new Function(...params, bodyStr) });
    }
  }

  Object.defineProperty(DynClass, "name", {
    configurable: true,
    value: classDef.title,
  });
  return DynClass;
}
