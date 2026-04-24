/**
 * Studio-api.js — Studio filesystem integration
 *
 * REST endpoints under /__studio/* that provide server-backed file operations so the studio can
 * work universally (not just Chrome with File System Access API).
 *
 * All paths are relative to the project root. Directory traversal above root is rejected.
 */

import { resolve, relative, basename, dirname } from "node:path";
import { readdir, stat, readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";

/** Normalise a path to forward slashes (Windows `path` module returns backslashes). */
const fwd = (/** @type {string} */ p) => p.replaceAll("\\", "/");

/**
 * @param {string} filePath
 * @param {string} root
 */
function assertUnderRoot(filePath, root) {
  const rel = relative(root, filePath);
  if (rel.startsWith("..") || rel.startsWith("/")) throw new Error("Path outside project root");
}

/**
 * Handle /__studio/* requests.
 *
 * @param {Request} req
 * @param {URL} url
 * @param {string} root
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

  // Project info — probe a directory for site-project characteristics
  if (path === "/__studio/project-info" && req.method === "GET") {
    const dir = url.searchParams.get("dir") ?? ".";
    const absDir = resolve(root, dir);
    try {
      assertUnderRoot(absDir, root);
    } catch (/** @type {any} */ e) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    try {
      const projectRoot = relative(root, absDir) || ".";
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
          if (s.isDirectory()) directories.push(d);
        } catch {}
      }

      let isSiteProject = false;
      let projectConfig = null;
      try {
        const raw = JSON.parse(await readFile(resolve(absDir, "project.json"), "utf8"));
        if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
          isSiteProject = true;
          projectConfig = raw;
        }
      } catch {}

      return Response.json({ isSiteProject, projectConfig, directories, projectRoot });
    } catch (/** @type {any} */ e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Resolve nearest project.json ancestor for a given file path
  if (path === "/__studio/resolve-site" && req.method === "GET") {
    const filePath = url.searchParams.get("path");
    if (!filePath) return Response.json({ error: "Missing path param" }, { status: 400 });
    try {
      // Walk up from file's directory looking for project.json
      let dir = dirname(
        filePath.startsWith("~") ? filePath.replace("~", process.env.HOME || "") : filePath,
      );
      while (dir) {
        const candidate = resolve(dir, "project.json");
        if (existsSync(candidate)) {
          const config = JSON.parse(readFileSync(candidate, "utf8"));
          const relPath = fwd(relative(root, dir));
          const absFile = filePath.startsWith("~")
            ? filePath.replace("~", process.env.HOME || "")
            : filePath;
          const fileRelPath = fwd(relative(dir, absFile));
          return Response.json({
            sitePath: dir,
            relPath: relPath || ".",
            fileRelPath,
            projectConfig: config,
          });
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return Response.json({ sitePath: null });
    } catch (/** @type {any} */ e) {
      return Response.json({ error: e.message }, { status: 500 });
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
        )
          continue;
        const fp = resolve(root, match);
        try {
          const raw = JSON.parse(await readFile(fp, "utf8"));
          if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
            const projectDir = dirname(match) === "." ? "." : fwd(dirname(match));
            sites.push({ path: projectDir, config: raw });
          }
        } catch {}
      }
      return Response.json(sites);
    } catch (/** @type {any} */ e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // List files
  if (path === "/__studio/files" && req.method === "GET") {
    const dir = url.searchParams.get("dir") ?? ".";
    const pattern = url.searchParams.get("glob");
    const absDir = resolve(root, dir);
    try {
      assertUnderRoot(absDir, root);
    } catch (/** @type {any} */ e) {
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
                path: fwd(relative(root, fp)),
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
          path: fwd(relative(root, fp)),
          type: entry.isDirectory() ? "directory" : "file",
          size: s.size,
          modified: s.mtime.toISOString(),
        });
      }
      return Response.json(files);
    } catch (/** @type {any} */ e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Component discovery — scan project for custom element definitions
  if (path === "/__studio/components" && req.method === "GET") {
    const dir = url.searchParams.get("dir");
    const scanRoot = dir ? resolve(root, dir) : root;
    if (dir) {
      try {
        assertUnderRoot(scanRoot, root);
      } catch (/** @type {any} */ e) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    }
    try {
      const glob = new Bun.Glob("**/*.json");
      const components = [];
      for await (const match of glob.scan({ cwd: scanRoot, dot: false })) {
        if (
          match.includes("node_modules") ||
          fwd(match).includes("dist/") ||
          fwd(match).includes(".claude/")
        )
          continue;
        const fp = resolve(scanRoot, match);
        try {
          const content = JSON.parse(await readFile(fp, "utf8"));
          if (content.tagName && content.tagName.includes("-")) {
            components.push({
              tagName: content.tagName,
              $id: content.$id || null,
              path: fwd(match),
              source: "jx",
              props: Object.entries(content.state || {})
                .filter(
                  ([, d]) =>
                    d && typeof d === "object" && !d.$prototype && !d.$handler && !d.$compute,
                )
                .map(([name, d]) => ({ name, type: d.type, default: d.default })),
              hasElements: Array.isArray(content.$elements) && content.$elements.length > 0,
            });
          }
        } catch {} // skip non-JSON or parse errors
      }

      // Discover CEM-bearing npm packages
      try {
        const projectPkgPath = resolve(scanRoot, "package.json");
        if (existsSync(projectPkgPath)) {
          const pkg = JSON.parse(await readFile(projectPkgPath, "utf8"));
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
              if (!actualPath) continue;
              const depPkg = JSON.parse(await readFile(actualPath, "utf8"));
              if (!depPkg.customElements) continue;
              const cemPath = resolve(dirname(actualPath), depPkg.customElements);
              if (!existsSync(cemPath)) continue;
              const cem = JSON.parse(await readFile(cemPath, "utf8"));
              for (const mod of cem.modules || []) {
                for (const decl of mod.declarations || []) {
                  if (decl.customElement && decl.tagName) {
                    components.push({
                      tagName: decl.tagName,
                      $id: null,
                      path: null,
                      modulePath: mod.path,
                      source: "npm",
                      package: name,
                      description: decl.description || null,
                      props: (decl.attributes || []).map((/** @type {any} */ a) => ({
                        name: a.name,
                        type: a.type?.text,
                        default: a.default,
                        description: a.description || null,
                      })),
                      members: (decl.members || []).filter(
                        (/** @type {any} */ m) => m.kind === "field" && m.privacy !== "private",
                      ),
                      slots: decl.slots || [],
                      events: decl.events || [],
                      cssProperties: decl.cssProperties || [],
                      hasElements: false,
                    });
                  }
                }
              }
            } catch {} // skip packages without valid CEM
          }
        }
      } catch {} // skip if no project package.json

      return Response.json(components);
    } catch (/** @type {any} */ e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // ─── Package management ──────────────────────────────────────────────────────

  // List CEM-bearing npm packages
  if (path === "/__studio/packages" && req.method === "GET") {
    const dir = url.searchParams.get("dir");
    const scanRoot = dir ? resolve(root, dir) : root;
    try {
      const pkgPath = resolve(scanRoot, "package.json");
      if (!existsSync(pkgPath)) return Response.json([]);
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      /** @type {any[]} */
      const packages = [];
      for (const [name, version] of Object.entries(deps)) {
        const depPkgPath = resolve(scanRoot, "node_modules", ...name.split("/"), "package.json");
        const fallbackPath = resolve(root, "node_modules", ...name.split("/"), "package.json");
        const actualPath = existsSync(depPkgPath)
          ? depPkgPath
          : existsSync(fallbackPath)
            ? fallbackPath
            : null;
        if (!actualPath) continue;
        try {
          const depPkg = JSON.parse(await readFile(actualPath, "utf8"));
          packages.push({
            name,
            version: /** @type {string} */ (version),
            hasCem: !!depPkg.customElements,
            customElementsPath: depPkg.customElements || null,
          });
        } catch {}
      }
      return Response.json(packages);
    } catch (/** @type {any} */ e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Read CEM from a specific package
  if (path === "/__studio/cem" && req.method === "GET") {
    const pkg = url.searchParams.get("pkg");
    if (!pkg) return new Response("Missing pkg", { status: 400 });
    const dir = url.searchParams.get("dir");
    const scanRoot = dir ? resolve(root, dir) : root;
    try {
      const depPkgPath = resolve(scanRoot, "node_modules", ...pkg.split("/"), "package.json");
      const fallbackPath = resolve(root, "node_modules", ...pkg.split("/"), "package.json");
      const actualPath = existsSync(depPkgPath)
        ? depPkgPath
        : existsSync(fallbackPath)
          ? fallbackPath
          : null;
      if (!actualPath) return Response.json({ cem: null });
      const depPkg = JSON.parse(await readFile(actualPath, "utf8"));
      if (!depPkg.customElements) return Response.json({ cem: null });
      const cemPath = resolve(dirname(actualPath), depPkg.customElements);
      if (!existsSync(cemPath)) return Response.json({ cem: null });
      const cem = JSON.parse(await readFile(cemPath, "utf8"));
      return Response.json({ cem });
    } catch (/** @type {any} */ e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Add an npm package
  if (path === "/__studio/packages/add" && req.method === "POST") {
    try {
      const body = await req.json();
      const name = body.name;
      if (!name || typeof name !== "string")
        return Response.json({ error: "Missing name" }, { status: 400 });
      const dir = body.dir;
      const cwd = dir ? resolve(root, dir) : root;
      const args = ["add", name];
      if (body.dev) args.splice(1, 0, "-d");
      const proc = Bun.spawn(["bun", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        return Response.json(
          { error: stderr || `bun add exited with ${exitCode}` },
          { status: 500 },
        );
      }
      return Response.json({ ok: true });
    } catch (/** @type {any} */ e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Remove an npm package
  if (path === "/__studio/packages/remove" && req.method === "POST") {
    try {
      const body = await req.json();
      const name = body.name;
      if (!name || typeof name !== "string")
        return Response.json({ error: "Missing name" }, { status: 400 });
      const dir = body.dir;
      const cwd = dir ? resolve(root, dir) : root;
      const proc = Bun.spawn(["bun", "remove", name], { cwd, stdout: "pipe", stderr: "pipe" });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        return Response.json(
          { error: stderr || `bun remove exited with ${exitCode}` },
          { status: 500 },
        );
      }
      return Response.json({ ok: true });
    } catch (/** @type {any} */ e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // Read file (supports absolute system paths for ?open= workflow)
  if (path === "/__studio/file" && req.method === "GET") {
    const fp = url.searchParams.get("path");
    if (!fp) return new Response("Missing path", { status: 400 });
    const isAbsolute = fp.startsWith("/") || fp.startsWith("~") || /^[A-Za-z]:[/\\]/.test(fp);
    const abs = isAbsolute
      ? fp.startsWith("~")
        ? fp.replace("~", process.env.HOME || "")
        : fp
      : resolve(root, fp);
    if (!isAbsolute) {
      try {
        assertUnderRoot(abs, root);
      } catch (/** @type {any} */ e) {
        return new Response(e.message, { status: 400 });
      }
    }
    try {
      return Response.json({
        content: await readFile(abs, "utf8"),
        path: isAbsolute ? fp : fwd(relative(root, abs)),
      });
    } catch (/** @type {any} */ e) {
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
    } catch (/** @type {any} */ e) {
      return new Response(e.message, { status: 400 });
    }
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, await req.text(), "utf8");
      return Response.json({ ok: true, path: fwd(relative(root, abs)) });
    } catch (/** @type {any} */ e) {
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
    } catch (/** @type {any} */ e) {
      return new Response(e.message, { status: 400 });
    }
    try {
      await unlink(abs);
      return Response.json({ ok: true, path: fwd(relative(root, abs)) });
    } catch (/** @type {any} */ e) {
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
    } catch (/** @type {any} */ e) {
      return new Response(e.message, { status: 400 });
    }
    try {
      await mkdir(dirname(absTo), { recursive: true });
      await rename(absFrom, absTo);
      return Response.json({
        ok: true,
        from: fwd(relative(root, absFrom)),
        to: fwd(relative(root, absTo)),
      });
    } catch (/** @type {any} */ e) {
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
        if (match.includes("node_modules") || fwd(match).includes("dist/")) continue;
        matches.push(fwd(match));
      }
      if (matches.length === 0) return Response.json({ path: null });
      return Response.json({
        path: matches[0],
        ...(matches.length > 1 ? { alternatives: matches } : {}),
      });
    } catch (/** @type {any} */ e) {
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
    } catch (/** @type {any} */ e) {
      return Response.json({ schema: null, error: e.message });
    }

    // .class.json: read and extract schema directly
    if (moduleAbsPath.endsWith(".class.json")) {
      try {
        const content = readFileSync(moduleAbsPath, "utf8");
        const classDef = JSON.parse(content);
        return Response.json({ schema: extractStudioSchema(classDef, moduleAbsPath) });
      } catch (/** @type {any} */ e) {
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
    } catch (/** @type {any} */ e) {
      return Response.json({ schema: null, error: e.message });
    }
  }

  return null;
}

/**
 * Extract a studio-friendly schema from a .class.json definition. Transforms $defs.parameters and
 * $defs.fields into the flat { description, properties, required } shape that renderSchemaFields()
 * in the studio already consumes.
 *
 * @param {any} classDef
 * @param {string} classJsonPath
 * @returns {{ description: any; properties: Record<string, any>; required: string[] }}
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
  /** @type {Record<string, any>} */
  const properties = {};
  /** @type {string[]} */
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
    if (field.initializer !== undefined && prop.default === undefined)
      prop.default = field.initializer;
    if (field.examples) prop.examples = field.examples;
    properties[id] = prop;
  }

  // Determine required from constructor parameters that have no default
  const ctorParams = classDef.$defs?.constructor?.parameters ?? [];
  /** @type {Set<string>} */
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
