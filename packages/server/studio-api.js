/**
 * studio-api.js — Studio filesystem integration
 *
 * REST endpoints under /__studio/* that provide server-backed file operations
 * so the studio can work universally (not just Chrome with File System Access API).
 *
 * All paths are relative to the project root. Directory traversal above root is rejected.
 */

import { resolve, relative, basename, dirname } from "node:path";
import { readdir, stat, readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";

function assertUnderRoot(filePath, root) {
  const rel = relative(root, filePath);
  if (rel.startsWith("..") || rel.startsWith("/")) throw new Error("Path outside project root");
}

/**
 * Handle /__studio/* requests.
 */
export async function handleStudioApi(req, url, root) {
  const path = url.pathname;

  // Project metadata
  if (path === "/__studio/project" && req.method === "GET") {
    try {
      const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
      return Response.json({
        root,
        name: pkg.name ?? basename(root),
        workspaces: pkg.workspaces ?? [],
      });
    } catch {
      return Response.json({ root, name: basename(root), workspaces: [] });
    }
  }

  // List files
  if (path === "/__studio/files" && req.method === "GET") {
    const dir = url.searchParams.get("dir") ?? ".";
    const pattern = url.searchParams.get("glob");
    const absDir = resolve(root, dir);
    try {
      assertUnderRoot(absDir, root);
    } catch (e) {
      return Response.json({ error: e.message }, { status: 400 });
    }

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
                name: basename(match),
                path: relative(root, fp),
                size: s.size,
                modified: s.mtime.toISOString(),
              });
            }
          } catch {}
        }
        return Response.json(files);
      }

      const entries = await readdir(absDir, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fp = resolve(absDir, entry.name);
        const s = await stat(fp);
        files.push({
          name: entry.name,
          path: relative(root, fp),
          type: entry.isDirectory() ? "directory" : "file",
          size: s.size,
          modified: s.mtime.toISOString(),
        });
      }
      return Response.json(files);
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Component discovery — scan project for custom element definitions
  if (path === "/__studio/components" && req.method === "GET") {
    try {
      const glob = new Bun.Glob("**/*.json");
      const components = [];
      for await (const match of glob.scan({ cwd: root, dot: false })) {
        if (match.includes("node_modules") || match.includes("dist/") || match.includes(".claude/")) continue;
        const fp = resolve(root, match);
        try {
          const content = JSON.parse(await readFile(fp, "utf8"));
          if (content.tagName && content.tagName.includes("-")) {
            components.push({
              tagName: content.tagName,
              $id: content.$id || null,
              path: match,
              props: Object.entries(content.$defs || {})
                .filter(([, d]) => d && typeof d === "object" && !d.$prototype && !d.$handler && !d.$compute)
                .map(([name, d]) => ({ name, type: d.type, default: d.default })),
              hasElements: Array.isArray(content.$elements) && content.$elements.length > 0,
            });
          }
        } catch {} // skip non-JSON or parse errors
      }
      return Response.json(components);
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Read file
  if (path === "/__studio/file" && req.method === "GET") {
    const fp = url.searchParams.get("path");
    if (!fp) return new Response("Missing path", { status: 400 });
    const abs = resolve(root, fp);
    try {
      assertUnderRoot(abs, root);
    } catch (e) {
      return new Response(e.message, { status: 400 });
    }
    try {
      return Response.json({ content: await readFile(abs, "utf8"), path: relative(root, abs) });
    } catch (e) {
      return e.code === "ENOENT"
        ? new Response("Not found", { status: 404 })
        : Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Write file
  if (path === "/__studio/file" && req.method === "PUT") {
    const fp = url.searchParams.get("path");
    if (!fp) return new Response("Missing path", { status: 400 });
    const abs = resolve(root, fp);
    try {
      assertUnderRoot(abs, root);
    } catch (e) {
      return new Response(e.message, { status: 400 });
    }
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, await req.text(), "utf8");
      return Response.json({ ok: true, path: relative(root, abs) });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Delete file
  if (path === "/__studio/file" && req.method === "DELETE") {
    const fp = url.searchParams.get("path");
    if (!fp) return new Response("Missing path", { status: 400 });
    const abs = resolve(root, fp);
    try {
      assertUnderRoot(abs, root);
    } catch (e) {
      return new Response(e.message, { status: 400 });
    }
    try {
      await unlink(abs);
      return Response.json({ ok: true, path: relative(root, abs) });
    } catch (e) {
      return e.code === "ENOENT"
        ? new Response("Not found", { status: 404 })
        : Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Rename file
  if (path === "/__studio/file/rename" && req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const { from, to } = body;
    if (!from || !to) return new Response("Missing from or to", { status: 400 });
    const absFrom = resolve(root, from);
    const absTo = resolve(root, to);
    try {
      assertUnderRoot(absFrom, root);
      assertUnderRoot(absTo, root);
    } catch (e) {
      return new Response(e.message, { status: 400 });
    }
    try {
      await mkdir(dirname(absTo), { recursive: true });
      await rename(absFrom, absTo);
      return Response.json({ ok: true, from: relative(root, absFrom), to: relative(root, absTo) });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Locate a file by name within the project root
  if (path === "/__studio/locate" && req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const { name } = body;
    if (!name) return new Response("Missing name", { status: 400 });

    try {
      const glob = new Bun.Glob(`**/${name}`);
      const matches = [];
      for await (const match of glob.scan({ cwd: root, dot: false })) {
        // Skip node_modules / dist / hidden dirs
        if (match.includes("node_modules") || match.includes("dist/")) continue;
        matches.push(match.split("\\").join("/"));
      }
      if (matches.length === 0) return Response.json({ path: null });
      return Response.json({
        path: matches[0],
        ...(matches.length > 1 ? { alternatives: matches } : {}),
      });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Discover a plugin module's schema for studio form rendering
  if (path === "/__studio/plugin-schema" && req.method === "GET") {
    const src = url.searchParams.get("src");
    const prototype = url.searchParams.get("prototype");
    const base = url.searchParams.get("base");
    if (!src) return new Response("Missing src param", { status: 400 });

    let moduleAbsPath;
    try {
      if (base) {
        const docUrlPath = new URL(base).pathname;
        const docDir = docUrlPath.slice(0, docUrlPath.lastIndexOf("/") + 1);
        moduleAbsPath = resolve(resolve(root, "." + docDir), src);
      } else {
        moduleAbsPath = resolve(root, src);
      }
    } catch (e) {
      return Response.json({ schema: null, error: e.message });
    }

    // .class.json: read and extract schema directly
    if (moduleAbsPath.endsWith(".class.json")) {
      try {
        const content = readFileSync(moduleAbsPath, "utf8");
        const classDef = JSON.parse(content);
        return Response.json({ schema: extractStudioSchema(classDef, moduleAbsPath) });
      } catch (e) {
        return Response.json({ schema: null, error: e.message });
      }
    }

    // Sibling .class.json auto-discovery: check for <ClassName>.class.json next to the .js module
    const exportName = prototype || src;
    const classJsonPath = resolve(dirname(moduleAbsPath), `${exportName}.class.json`);
    if (existsSync(classJsonPath)) {
      try {
        const content = readFileSync(classJsonPath, "utf8");
        const classDef = JSON.parse(content);
        return Response.json({ schema: extractStudioSchema(classDef, classJsonPath) });
      } catch {
        // Fall through to JS module import
      }
    }

    // Fallback: import JS module (backwards compat for classes without .class.json)
    try {
      const mod = await import(moduleAbsPath);
      const ExportedClass = mod[exportName] ?? mod.default?.[exportName];
      if (typeof ExportedClass !== "function") {
        return Response.json({ schema: null, error: `Export "${exportName}" not found` });
      }
      return Response.json({ schema: ExportedClass.schema ?? null });
    } catch (e) {
      return Response.json({ schema: null, error: e.message });
    }
  }

  return null;
}

/**
 * Extract a studio-friendly schema from a .class.json definition.
 * Transforms $defs.parameters and $defs.fields into the flat { description, properties, required }
 * shape that renderSchemaFields() in the studio already consumes.
 */
function extractStudioSchema(classDef, classJsonPath) {
  // If extends.$ref points to a parent, recursively merge
  let parentSchema = null;
  if (classDef.extends && typeof classDef.extends === "object" && classDef.extends.$ref) {
    try {
      const parentPath = resolve(dirname(classJsonPath), classDef.extends.$ref);
      const parentContent = readFileSync(parentPath, "utf8");
      const parentDef = JSON.parse(parentContent);
      parentSchema = extractStudioSchema(parentDef, parentPath);
    } catch {
      // Parent not found — proceed without inheritance
    }
  }

  const params = classDef.$defs?.parameters ?? {};
  const fields = classDef.$defs?.fields ?? {};
  const properties = {};
  const required = [];

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
    const prop = {};
    if (param.type && typeof param.type === "object") Object.assign(prop, param.type);
    if (param.description) prop.description = param.description;
    if (param.examples) prop.examples = param.examples;
    if (param.format) prop.format = param.format;
    properties[id] = prop;
  }

  // Build properties from fields (config-visible ones only)
  for (const [key, field] of Object.entries(fields)) {
    if (field.role !== "field") continue;
    if (field.access === "private") continue;
    const id = field.identifier ?? key;
    const prop = {};
    if (field.type && typeof field.type === "object") Object.assign(prop, field.type);
    if (field.description) prop.description = field.description;
    if (field.default !== undefined) prop.default = field.default;
    if (field.initializer !== undefined && prop.default === undefined) prop.default = field.initializer;
    if (field.examples) prop.examples = field.examples;
    properties[id] = prop;
  }

  // Determine required from constructor parameters that have no default
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
