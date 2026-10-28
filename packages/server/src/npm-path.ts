/**
 * Resolving an npm bare specifier from a URL path, shared by the dev server (`server.ts`) and the
 * desktop's project server (`project-server.ts`). Its own module so the project server does not
 * import the dev server, which stays Bun-only (server.md §1).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isJsonObject, isNonNullObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";

/**
 * Read `key` off a parsed `package.json` value, or `undefined` when the value is not an object.
 *
 * Every lookup below reads through this one, so a manifest of the wrong shape (an `exports` that is
 * a string, a `main` that is an array) yields "absent" rather than a member of something else.
 */
function manifestField(value: JsonValue | undefined, key: string): JsonValue | undefined {
  return isJsonObject(value) ? value[key] : undefined;
}

/** Read and parse a package's `package.json`. Throws when the file is not JSON. */
function readManifest(pkgJsonPath: string): JsonValue {
  // SAFETY: JSON.parse without a reviver only ever yields a JSON value; its `any` says no more.
  return JSON.parse(readFileSync(pkgJsonPath, "utf8")) as JsonValue;
}

/**
 * Resolve an npm-style bare specifier from a URL path via node_modules. Handles scoped packages
 * (@scope/pkg/subpath) and respects package.json exports. Strips leading directory segments (e.g.
 * /pages/@scope/pkg/file → @scope/pkg/file).
 *
 * @param {string} root - Absolute project root
 * @param {string} urlPath - URL pathname (e.g. "/pages/@jxsuite/parser/Foo.class.json")
 * @returns {string | null} Absolute file path or null
 */
export function resolveNpmPath(rootDir: string, urlPath: string): string | null {
  let root = rootDir;
  let segments = urlPath.split("/").filter(Boolean);

  // If "node_modules" appears in the path, use everything before it as a subdirectory
  // Prefix and everything after as the package specifier.
  // E.g. /examples/demo/node_modules/@scope/pkg → root=root/examples/demo, pkg=@scope/pkg
  const nmIdx = segments.indexOf("node_modules");
  if (nmIdx !== -1) {
    if (nmIdx > 0) {
      root = join(root, ...segments.slice(0, nmIdx));
    }
    segments = segments.slice(nmIdx + 1);
  }

  // Find the package start — either @scope/pkg or unscoped pkg
  let start = -1;
  let isScoped = false;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i]!.startsWith("@")) {
      start = i;
      isScoped = true;
      break;
    }
  }

  let pkgDir = "";
  let subpath = "";

  if (isScoped) {
    if (start < 0 || start + 1 >= segments.length) {
      return null;
    }
    const scope = segments[start]!;
    const pkg = segments[start + 1]!;
    subpath = segments.slice(start + 2).join("/");
    pkgDir = join(root, "node_modules", scope, pkg);
  } else {
    // Unscoped: try each segment as a package name in node_modules
    for (let i = 0; i < segments.length; i++) {
      const candidate = join(root, "node_modules", segments[i]!);
      if (existsSync(join(candidate, "package.json"))) {
        start = i;
        pkgDir = candidate;
        subpath = segments.slice(i + 1).join("/");
        break;
      }
    }
    if (start < 0) {
      return null;
    }
  }

  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return null;
  }

  // If there's a subpath, check package.json exports first
  if (subpath) {
    try {
      const pkgJson = readManifest(pkgJsonPath);
      const exportVal = manifestField(manifestField(pkgJson, "exports"), `./${subpath}`);
      if (isString(exportVal)) {
        const mapped = join(pkgDir, exportVal);
        if (existsSync(mapped)) {
          return mapped;
        }
      }
    } catch {}
    // Fall back to direct path
    const direct = join(pkgDir, subpath);
    if (existsSync(direct)) {
      return direct;
    }
    // CEM-relative: subpath may be relative to the custom elements manifest directory
    try {
      const customElements = manifestField(readManifest(pkgJsonPath), "customElements");
      if (isString(customElements) && customElements) {
        const cemDir = customElements.replace(/\/[^/]+$/, "");
        const cemRelative = join(pkgDir, cemDir, subpath);
        if (existsSync(cemRelative)) {
          return cemRelative;
        }
      }
    } catch {}
  }

  // Bare package (no subpath): resolve entry point
  try {
    const pkgJson = readManifest(pkgJsonPath);
    const exp = manifestField(manifestField(pkgJson, "exports"), ".");
    // An explicit `null` entry declines the package's entry point outright: no `module`/`main`.
    if (exp !== null) {
      const conditional = isNonNullObject(exp)
        ? (manifestField(exp, "import") ?? manifestField(exp, "default"))
        : exp;
      const entry =
        conditional ?? manifestField(pkgJson, "module") ?? manifestField(pkgJson, "main");
      if (isString(entry) && entry) {
        const resolved = join(pkgDir, entry);
        if (existsSync(resolved)) {
          return resolved;
        }
      }
    }
  } catch {}

  return null;
}
