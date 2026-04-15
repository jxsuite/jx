/**
 * handlers.ts — Bun-side PAL implementation
 *
 * Each export maps to a StudioRPCSchema["bun"]["requests"] method.
 * The handlers perform direct filesystem operations against the project root.
 *
 * See spec/desktop.md §7.3 for the architecture.
 */

import { Utils } from "electrobun/bun";
import { readdir, readFile, writeFile, unlink, rename, stat, mkdir } from "node:fs/promises";
import { resolve, relative, join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

import type {
  DirEntry,
  ComponentMeta,
  OpenProjectResult,
  CodeServiceResult,
} from "./rpc-schema.ts";

// ─── State ────────────────────────────────────────────────────────────────────

let projectRoot: string | null = null;

export function setProjectRoot(root: string) {
  projectRoot = root;
}

export function getProjectRoot(): string | null {
  return projectRoot;
}

// ─── Guards ───────────────────────────────────────────────────────────────────

function requireRoot(): string {
  if (!projectRoot) throw new Error("No project open");
  return projectRoot;
}

function assertUnderRoot(absPath: string, root: string) {
  const rel = relative(root, absPath);
  if (rel.startsWith("..") || rel.startsWith("/")) {
    throw new Error("Path outside project root");
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function openProject(): Promise<OpenProjectResult | null> {
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

export async function listDirectory(params: { dir: string }): Promise<DirEntry[]> {
  const root = requireRoot();
  const absDir = resolve(root, params.dir);
  assertUnderRoot(absDir, root);

  const entries = await readdir(absDir, { withFileTypes: true });
  const result: DirEntry[] = [];

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

export async function handleReadFile(params: { path: string }): Promise<string> {
  const root = requireRoot();
  const abs = resolve(root, params.path);
  assertUnderRoot(abs, root);
  return readFile(abs, "utf8");
}

export async function handleWriteFile(params: { path: string; content: string }): Promise<void> {
  const root = requireRoot();
  const abs = resolve(root, params.path);
  assertUnderRoot(abs, root);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, params.content, "utf8");
}

export async function handleDeleteFile(params: { path: string }): Promise<void> {
  const root = requireRoot();
  const abs = resolve(root, params.path);
  assertUnderRoot(abs, root);
  await unlink(abs);
}

export async function handleRenameFile(params: { from: string; to: string }): Promise<void> {
  const root = requireRoot();
  const absFrom = resolve(root, params.from);
  const absTo = resolve(root, params.to);
  assertUnderRoot(absFrom, root);
  assertUnderRoot(absTo, root);
  await mkdir(dirname(absTo), { recursive: true });
  await rename(absFrom, absTo);
}

export async function handleCreateDirectory(params: { path: string }): Promise<void> {
  const root = requireRoot();
  const abs = resolve(root, params.path);
  assertUnderRoot(abs, root);
  await mkdir(abs, { recursive: true });
}

export async function discoverComponents(params: { dir?: string }): Promise<ComponentMeta[]> {
  const root = requireRoot();
  const scanRoot = params.dir ? resolve(root, params.dir) : root;
  if (params.dir) assertUnderRoot(scanRoot, root);

  const glob = new Bun.Glob("**/*.json");
  const components: ComponentMeta[] = [];

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
            .filter(([, d]: [string, any]) => d && typeof d === "object" && !d.$prototype && !d.$handler && !d.$compute)
            .map(([name, d]: [string, any]) => ({ name, type: d.type, default: d.default })),
          hasElements: Array.isArray(content.$elements) && content.$elements.length > 0,
        });
      }
    } catch {} // skip non-JSON or parse errors
  }

  return components;
}

export async function codeService(params: { action: string; payload: unknown }): Promise<CodeServiceResult | null> {
  // Code services run in the Bun process directly.
  // For now, return null — oxfmt/oxlint integration is Phase 3.
  return null;
}

export async function locateFile(params: { name: string }): Promise<string | null> {
  const root = requireRoot();
  const glob = new Bun.Glob(`**/${params.name}`);
  const matches: string[] = [];

  for await (const match of glob.scan({ cwd: root, dot: false })) {
    if (match.includes("node_modules") || match.includes("dist/")) continue;
    matches.push(match.split("\\").join("/"));
  }

  return matches.length > 0 ? matches[0] : null;
}

export async function fetchPluginSchema(params: {
  src: string;
  prototype?: string;
  base?: string;
}): Promise<unknown | null> {
  const root = requireRoot();

  let moduleAbsPath: string;
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

function extractStudioSchema(classDef: any, classJsonPath: string): any {
  let parentSchema: any = null;
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
  const properties: Record<string, any> = {};
  const required: string[] = [];

  if (parentSchema?.properties) Object.assign(properties, parentSchema.properties);
  if (parentSchema?.required) required.push(...parentSchema.required);

  for (const [key, param] of Object.entries<any>(params)) {
    const id = param.identifier ?? key;
    const prop: any = {};
    if (param.type && typeof param.type === "object") Object.assign(prop, param.type);
    if (param.description) prop.description = param.description;
    if (param.examples) prop.examples = param.examples;
    if (param.format) prop.format = param.format;
    properties[id] = prop;
  }

  for (const [key, field] of Object.entries<any>(fields)) {
    if (field.role !== "field") continue;
    if (field.access === "private") continue;
    const id = field.identifier ?? key;
    const prop: any = {};
    if (field.type && typeof field.type === "object") Object.assign(prop, field.type);
    if (field.description) prop.description = field.description;
    if (field.default !== undefined) prop.default = field.default;
    if (field.initializer !== undefined && prop.default === undefined) prop.default = field.initializer;
    if (field.examples) prop.examples = field.examples;
    properties[id] = prop;
  }

  const ctorParams: any[] = classDef.$defs?.constructor?.parameters ?? [];
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
