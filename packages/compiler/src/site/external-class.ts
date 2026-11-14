/**
 * External-class.ts — the classes state entries name, as a site build finds, loads and runs them
 *
 * A state entry whose `$prototype` is not a built-in names an external class (spec.md §12.3,
 * compiler.md §3). This module is everything the build does with one, for both timings: where its
 * `.class.json` is, which class that document means (its `$implementation`'s export, or the class
 * generated from its schema, compiler.md §5.4), how an instance becomes a value, and the module a
 * `timing: "client"` class ships as.
 *
 * @module external-class
 * @docs extending/extensions/classes
 * @docs framework/build
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isFunction, isString } from "@jxsuite/schema/guards";
import { parseClassDef } from "@jxsuite/schema/parse";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type {
  JsonObject,
  JsonValue,
  JxClassDef,
  JxDocumentValue,
  JxPrototypeDef,
  JxStateDefinition,
  ProjectConfig,
} from "@jxsuite/schema/types";
import { compileClassJson } from "../targets/compile-class.ts";
import { implementationFile, importImplementation } from "./format-host.ts";
import type { ProjectSectionData } from "./project-sections.ts";

/** The route a document is being resolved for, as far as a class reads it. */
export interface ClassRoute {
  sourcePath?: string;
  _pathParams?: Record<string, string>;
}

/** `config._project`: the project config and root, plus every loaded section under its key. */
export interface ClassProjectContext {
  config: ProjectConfig | null;
  root: string;
  [sectionKey: string]: ProjectSectionData | ProjectConfig | string | null;
}

/** `config._document`: the route being built and the document's whole state. */
export interface ClassDocumentContext {
  route: ClassRoute;
  state: Record<string, JxStateDefinition>;
}

/**
 * The config an external class is constructed with during a build: the entry's own non-reserved
 * keys, plus the build host's `_project` and `_document` context.
 */
export type ExternalClassConfig = Record<
  string,
  JxDocumentValue | ClassProjectContext | ClassDocumentContext | undefined
>;

/** A class instance that computes its value: `resolve()` answers with the JSON to bake in. */
interface ResolvingInstance {
  resolve: () => JsonValue | Promise<JsonValue>;
}

/** A class instance that holds its value: a `value` field, or an accessor of that name. */
interface ValueInstance {
  value: JsonValue;
}

/**
 * What an external class constructs (spec.md §12.3): an instance that resolves its value, one that
 * holds it as `value`, or one whose own fields ARE the value.
 */
export type ExternalClassInstance = ResolvingInstance | ValueInstance | JsonObject;

/** An external class, as its implementation module exports it or as its schema generates it. */
export type ExternalClassCtor = new (config: ExternalClassConfig) => ExternalClassInstance;

/** A state entry's class, found: its descriptor, where that is, and the export that is the class. */
export interface LocatedClass {
  /** Absolute path of the `.class.json` descriptor. */
  classJsonPath: string;
  classDef: JxClassDef;
  /** The export the class is read by: `$export`, else the descriptor's `title`, else the name. */
  exportName: string;
}

/** Where a state entry's class is looked for. */
export interface ClassLookup {
  /** The directory of the document that declares the entry; a relative `$src` resolves from it. */
  docDir?: string | null | undefined;
  projectRoot: string;
  /** The document's `imports` map. */
  imports?: Record<string, string> | undefined;
  /** The project's extension registry, whose enabled manifest classes are found by name. */
  registry?: ExtensionRegistry | undefined;
}

/**
 * Find the class a state entry names. The descriptor is the entry's `$src`, else the document's
 * `imports` entry for the name, else an enabled extension's manifest class of that name, in that
 * order; `undefined` when none of the three names one.
 *
 * A relative descriptor path resolves against the declaring document's directory, and anything else
 * as a package specifier from the project's own `node_modules`. A descriptor that is named but
 * cannot be read throws, naming the path.
 *
 * @param {JxPrototypeDef} def
 * @param {ClassLookup} where
 * @returns {LocatedClass | undefined}
 */
export function locateClass(def: JxPrototypeDef, where: ClassLookup): LocatedClass | undefined {
  const src =
    def.$src ??
    where.imports?.[def.$prototype] ??
    where.registry?.byName(def.$prototype)?.classPath;
  if (!src) {
    return undefined;
  }

  let classJsonPath: string;
  if (src.startsWith("./") || src.startsWith("../")) {
    classJsonPath = resolve(where.docDir ?? where.projectRoot, src);
  } else {
    // A bare specifier or an absolute path: resolved from the project root, walking node_modules.
    const require = createRequire(resolve(where.projectRoot, "package.json"));
    classJsonPath = require.resolve(src);
  }

  const classDef = parseClassDef(readFileSync(classJsonPath, "utf8"), classJsonPath);
  return {
    classDef,
    classJsonPath,
    exportName: def.$export ?? classDef.title ?? def.$prototype,
  };
}

/**
 * Refuse a self-contained class whose `extends` is a `$ref`. The class generated for it imports its
 * base from the sibling module a direct compile of that document writes (compiler.md §5.2, §5.6),
 * which a site build does not write.
 *
 * @param {LocatedClass} located
 */
function refuseDocumentBase(located: LocatedClass): void {
  const base = located.classDef.extends;
  if (base !== undefined && !isString(base)) {
    throw new Error(
      `${located.classJsonPath} has no $implementation and extends another class document ` +
        `("${base.$ref}"), which a site build does not compile: give it an $implementation`,
    );
  }
}

/** Generated classes already loaded by this process, by the hash of their module text. */
const generatedClasses = new Map<string, Promise<ExternalClassCtor>>();

/**
 * Load the class a self-contained descriptor generates: compile it to its ES class module
 * (compiler.md §5.5), write that to a temporary file, import it, and remove the file.
 *
 * The module is named by a hash of its text and kept by that hash, so the same class is loaded once
 * however many documents name it, and a descriptor edited between two builds in one process is a
 * different module.
 *
 * @param {LocatedClass} located
 * @returns {Promise<ExternalClassCtor>}
 */
function loadGeneratedClass(located: LocatedClass): Promise<ExternalClassCtor> {
  refuseDocumentBase(located);
  const source = compileClassJson(located.classDef);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  let loading = generatedClasses.get(hash);
  if (loading === undefined) {
    const dir = join(tmpdir(), `jx-class-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${located.classDef.title}-${hash}.mjs`);
    writeFileSync(file, source, "utf8");
    /* SAFETY: the module is `compileClassJson`'s output, which ends `export default <Title>`: a
       class whose constructor takes one config object and reads members off it. */
    loading = (import(pathToFileURL(file).href) as Promise<{ default: ExternalClassCtor }>)
      .then((mod) => mod.default)
      .finally(() => {
        rmSync(file, { force: true });
      });
    generatedClasses.set(hash, loading);
  }
  return loading;
}

/**
 * Load a located class in the build host. With an `$implementation`, the module is imported and the
 * class is its export of the located name, or that member of its default export; without one, the
 * class is generated from the descriptor's schema (compiler.md §5.4).
 *
 * @param {LocatedClass} located
 * @returns {Promise<ExternalClassCtor>}
 */
export async function loadClass(located: LocatedClass): Promise<ExternalClassCtor> {
  const { classDef, classJsonPath, exportName } = located;
  if (!classDef.$implementation) {
    return loadGeneratedClass(located);
  }
  const mod = await importImplementation(resolve(dirname(classJsonPath), classDef.$implementation));
  /* SAFETY: trust boundary, the external class contract (spec.md §12.3). The export a `.class.json`
     names as its implementation is written as a class taking this config; that it is a function is
     all that can be checked before `new`, which the guard below does, and its instance is read only
     through the optional members `instantiateAndResolve` checks. */
  const exported = (mod[exportName] ?? mod.default?.[exportName]) as
    | ExternalClassCtor
    | null
    | undefined;
  if (!isFunction(exported)) {
    throw new Error(`Module ${classDef.$implementation} does not export "${exportName}"`);
  }
  return exported;
}

/** Whether a constructed instance computes its value through `resolve()`. */
function isResolvingInstance(instance: ExternalClassInstance): instance is ResolvingInstance {
  return "resolve" in instance && isFunction(instance.resolve);
}

/** Whether a constructed instance holds its value as `value`, own or inherited. */
function isValueInstance(instance: ExternalClassInstance): instance is ValueInstance {
  return "value" in instance;
}

/**
 * Construct an external class and take its value, by the order spec.md §12.3 states: `resolve()`
 * when the instance has one, else `value` when it has that, else the instance itself. The browser
 * half of the same rule is `externalClassHelperSource()` (`shared.ts`).
 *
 * @param {ExternalClassCtor} Ctor
 * @param {ExternalClassConfig} config
 * @returns {Promise<{ value: JsonValue; instance: ExternalClassInstance }>}
 */
export async function instantiateAndResolve(
  Ctor: ExternalClassCtor,
  config: ExternalClassConfig,
): Promise<{ value: JsonValue; instance: ExternalClassInstance }> {
  const instance = new Ctor(config);
  if (isResolvingInstance(instance)) {
    return { instance, value: await instance.resolve() };
  }
  if (isValueInstance(instance)) {
    return { instance, value: instance.value };
  }
  return { instance, value: instance };
}

/**
 * Whether a class descriptor reads the build host's context (`#/$context/…`): a content
 * collection's types, a connector's connections. A browser cannot supply that, so such a class runs
 * only during the build.
 *
 * @param {JxClassDef} classDef
 * @returns {boolean}
 */
export function readsBuildContext(classDef: JxClassDef): boolean {
  return JSON.stringify(classDef).includes('"#/$context/');
}

/**
 * The entry module a `timing: "client"` class is bundled from (compiler.md §12): a module whose
 * default export is the class. With an `$implementation` it re-exports that module's class, by the
 * lookup {@link loadClass} makes; without one it is the class generated from the schema.
 *
 * @param {LocatedClass} located
 * @returns {string}
 */
export function classEntrySource(located: LocatedClass): string {
  const { classDef, classJsonPath, exportName } = located;
  if (!classDef.$implementation) {
    refuseDocumentBase(located);
    return compileClassJson(classDef);
  }
  const file = implementationFile(resolve(dirname(classJsonPath), classDef.$implementation));
  const name = JSON.stringify(exportName);
  return [
    `import * as m from ${JSON.stringify(file)};`,
    `export default m[${name}] ?? m.default?.[${name}];`,
    "",
  ].join("\n");
}
