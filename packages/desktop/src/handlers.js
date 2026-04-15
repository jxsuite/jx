/**
 * handlers.js — Bun-side PAL implementation
 *
 * Each export maps to a StudioRPCSchema bun request handler.
 * The handlers perform direct filesystem operations against the project root.
 *
 * See spec/desktop.md §7.3 for the architecture.
 */

import { Utils } from "electrobun/bun";
import { readdir, readFile, writeFile, unlink, rename, stat, mkdir } from "node:fs/promises";
import { resolve, relative, join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

/** @typedef {import("./rpc-schema.js").DirEntry} DirEntry */
/** @typedef {import("./rpc-schema.js").ComponentMeta} ComponentMeta */
/** @typedef {import("./rpc-schema.js").OpenProjectResult} OpenProjectResult */
/** @typedef {import("./rpc-schema.js").CodeServiceResult} CodeServiceResult */

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {string | null} */
let projectRoot = null;

/** @param {string} root */
export function setProjectRoot(root) {
  projectRoot = root;
}

/** @returns {string | null} */
export function getProjectRoot() {
  return projectRoot;
}

// ─── Guards ───────────────────────────────────────────────────────────────────

/** @returns {string} */
function requireRoot() {
  if (!projectRoot) throw new Error("No project open");
  return projectRoot;
}

/**
 * @param {string} absPath
 * @param {string} root
 */
function assertUnderRoot(absPath, root) {
  const rel = relative(root, absPath);
  if (rel.startsWith("..") || rel.startsWith("/")) {
    throw new Error("Path outside project root");
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/** @returns {Promise<OpenProjectResult | null>} */
export async function openProject() {
  const paths = await Utils.openFileDialog({
    startingFolder: projectRoot || homedir(),
    allowedFileTypes: "json",
    canChooseFiles: true,
    canChooseDirectory: false,
    allowsMultipleSelection: false,
  });

  if (!paths || paths.length === 0) return null;

  const filePath = paths[0];
  if (basename(filePath) !== "site.json") {
    throw new Error("Please select a site.json file");
  }

  const raw = await readFile(filePath, "utf8");
  const config = JSON.parse(raw);
  projectRoot = resolve(filePath, "..");

  return {
    config,
    handle: {
      root: projectRoot,
      name: config.name || basename(projectRoot),
      siteConfig: config,
    },
  };
}

/**
 * @param {{ dir: string }} params
 * @returns {Promise<DirEntry[]>}
 */
export async function listDirectory(params) {
  const root = requireRoot();
  const absDir = resolve(root, params.dir);
  assertUnderRoot(absDir, root);

  const entries = await readdir(absDir, { withFileTypes: true });
  /** @type {DirEntry[]} */
  const result = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absPath = join(absDir, entry.name);
    try {
      const s = await stat(absPath);
      result.push({
        name: entry.name,
        path: relative(root, absPath),
        type: entry.isDirectory() ? "directory" : "file",
        size: s.size,
        modified: s.mtime.toISOString(),
      });
    } catch {}
  }

  return result;
}

/**
 * @param {{ path: string }} params
 * @returns {Promise<string>}
 */
export async function handleReadFile(params) {
  const root = requireRoot();
  const abs = resolve(root, params.path);
  assertUnderRoot(abs, root);
  return readFile(abs, "utf8");
}

/**
 * @param {{ path: string; content: string }} params
 * @returns {Promise<void>}
 */
export async function handleWriteFile(params) {
  const root = requireRoot();
  const abs = resolve(root, params.path);
  assertUnderRoot(abs, root);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, params.content, "utf8");
}

/**
 * @param {{ path: string }} params
 * @returns {Promise<void>}
 */
export async function handleDeleteFile(params) {
  const root = requireRoot();
  const abs = resolve(root, params.path);
  assertUnderRoot(abs, root);
  await unlink(abs);
}

/**
 * @param {{ from: string; to: string }} params
 * @returns {Promise<void>}
 */
export async function handleRenameFile(params) {
  const root = requireRoot();
  const absFrom = resolve(root, params.from);
  const absTo = resolve(root, params.to);
  assertUnderRoot(absFrom, root);
  assertUnderRoot(absTo, root);
  await mkdir(dirname(absTo), { recursive: true });
  await rename(absFrom, absTo);
}

/**
 * @param {{ path: string }} params
 * @returns {Promise<void>}
 */
export async function handleCreateDirectory(params) {
  const root = requireRoot();
  const abs = resolve(root, params.path);
  assertUnderRoot(abs, root);
  await mkdir(abs, { recursive: true });
}

/**
 * @param {{ dir?: string }} params
 * @returns {Promise<ComponentMeta[]>}
 */
export async function discoverComponents(params) {
  const root = requireRoot();
  const scanRoot = params.dir ? resolve(root, params.dir) : root;
  if (params.dir) assertUnderRoot(scanRoot, root);

  const glob = new Bun.Glob("**/*.json");
  /** @type {ComponentMeta[]} */
  const components = [];

  for await (const match of glob.scan({ cwd: scanRoot, dot: false })) {
    if (match.includes("node_modules") || match.includes("dist/") || match.includes(".claude/")) continue;
    const fp = resolve(scanRoot, match);
    try {
      const content = JSON.parse(await readFile(fp, "utf8"));
      if (content.tagName && content.tagName.includes("-")) {
        components.push({
          tagName: content.tagName,
          $id: content.$id || null,
          path: match,
          props: Object.entries(content.state || {})
            .filter(([, d]) => d && typeof d === "object" && !/** @type {any} */(d).$prototype && !/** @type {any} */(d).$handler && !/** @type {any} */(d).$compute)
            .map(([name, d]) => ({ name, type: /** @type {any} */(d).type, default: /** @type {any} */(d).default })),
          hasElements: Array.isArray(content.$elements) && content.$elements.length > 0,
        });
      }
    } catch {} // skip non-JSON or parse errors
  }

  return components;
}

/**
 * @param {{ action: string; payload: unknown }} params
 * @returns {Promise<CodeServiceResult | null>}
 */
export async function codeService(params) {
  // Code services run in the Bun process directly.
  // For now, return null — oxfmt/oxlint integration is Phase 3.
  return null;
}

/**
 * @param {{ name: string }} params
 * @returns {Promise<string | null>}
 */
export async function locateFile(params) {
  const root = requireRoot();
  const glob = new Bun.Glob(`**/${params.name}`);
  /** @type {string[]} */
  const matches = [];

  for await (const match of glob.scan({ cwd: root, dot: false })) {
    if (match.includes("node_modules") || match.includes("dist/")) continue;
    matches.push(match.split("\\").join("/"));
  }

  return matches.length > 0 ? matches[0] : null;
}

/**
 * @param {{ src: string; prototype?: string; base?: string }} params
 * @returns {Promise<unknown>}
 */
export async function fetchPluginSchema(params) {
  const root = requireRoot();

  /** @type {string} */
  let moduleAbsPath;
  try {
    if (params.base) {
      const docUrlPath = new URL(params.base).pathname;
      const docDir = docUrlPath.slice(0, docUrlPath.lastIndexOf("/") + 1);
      moduleAbsPath = resolve(resolve(root, "." + docDir), params.src);
    } else {
      moduleAbsPath = resolve(root, params.src);
    }
  } catch {
    return null;
  }

  // .class.json: read and extract schema directly
  if (moduleAbsPath.endsWith(".class.json")) {
    try {
      const content = readFileSync(moduleAbsPath, "utf8");
      const classDef = JSON.parse(content);
      return extractStudioSchema(classDef, moduleAbsPath);
    } catch {
      return null;
    }
  }

  // Sibling .class.json auto-discovery
  const exportName = params.prototype || params.src;
  const classJsonPath = resolve(dirname(moduleAbsPath), `${exportName}.class.json`);
  if (existsSync(classJsonPath)) {
    try {
      const content = readFileSync(classJsonPath, "utf8");
      const classDef = JSON.parse(content);
      return extractStudioSchema(classDef, classJsonPath);
    } catch {}
  }

  // Fallback: import JS module
  try {
    const mod = await import(moduleAbsPath);
    const ExportedClass = mod[exportName] ?? mod.default?.[exportName];
    if (typeof ExportedClass !== "function") return null;
    return ExportedClass.schema ?? null;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * @param {any} classDef
 * @param {string} classJsonPath
 * @returns {any}
 */
function extractStudioSchema(classDef, classJsonPath) {
  /** @type {any} */
  let parentSchema = null;
  if (classDef.extends?.["$ref"]) {
    try {
      const parentPath = resolve(dirname(classJsonPath), classDef.extends["$ref"]);
      const parentContent = readFileSync(parentPath, "utf8");
      const parentDef = JSON.parse(parentContent);
      parentSchema = extractStudioSchema(parentDef, parentPath);
    } catch {}
  }

  const params = classDef.$defs?.parameters ?? {};
  const fields = classDef.$defs?.fields ?? {};
  /** @type {Record<string, any>} */
  const properties = {};
  /** @type {string[]} */
  const required = [];

  if (parentSchema?.properties) Object.assign(properties, parentSchema.properties);
  if (parentSchema?.required) required.push(...parentSchema.required);

  for (const [key, param] of Object.entries(params)) {
    const p = /** @type {any} */ (param);
    const id = p.identifier ?? key;
    /** @type {any} */
    const prop = {};
    if (p.type && typeof p.type === "object") Object.assign(prop, p.type);
    if (p.description) prop.description = p.description;
    if (p.examples) prop.examples = p.examples;
    if (p.format) prop.format = p.format;
    properties[id] = prop;
  }

  for (const [key, field] of Object.entries(fields)) {
    const f = /** @type {any} */ (field);
    if (f.role !== "field") continue;
    if (f.access === "private") continue;
    const id = f.identifier ?? key;
    /** @type {any} */
    const prop = {};
    if (f.type && typeof f.type === "object") Object.assign(prop, f.type);
    if (f.description) prop.description = f.description;
    if (f.default !== undefined) prop.default = f.default;
    if (f.initializer !== undefined && prop.default === undefined) prop.default = f.initializer;
    if (f.examples) prop.examples = f.examples;
    properties[id] = prop;
  }

  /** @type {any[]} */
  const ctorParams = classDef.$defs?.constructor?.parameters ?? [];
  const requiredSet = new Set(required);
  for (const p of ctorParams) {
    const name = p.$ref ? p.$ref.split("/").pop() : (p.identifier ?? p.name);
    if (name && properties[name] && properties[name].default === undefined) {
      requiredSet.add(name);
    }
  }

  return {
    description: classDef.description ?? classDef.title,
    properties,
    required: [...requiredSet],
  };
}
