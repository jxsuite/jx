/**
 * Validate-project — project.json validation against the generated per-project entry schema
 * (specs/extensions.md §5.4).
 *
 * Node-only by design (mirrors the dynamic-ajv-import pattern of `validateDocument`): reads
 * `<root>/project.json` and `<root>/project.schema.json`, compiles the entry document with
 * ajv-2020, and resolves its relative `$ref`s through a file loader restricted to the project root
 * and its node_modules. The entry file's URL is injected as `$id` at load time so the committed,
 * machine-path-free relative refs resolve.
 *
 * When a `./node_modules/...` ref does not exist on disk (workspace hoisting leaves in-repo
 * starters without their own node_modules), the loader falls back to host resolution of the bare
 * specifier — the same project-first-then-host order as createNodeFormatIO.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { JsonObject, JsonValue } from "../types";

export interface ProjectValidationResult {
  valid: boolean;
  errors: unknown[] | null;
}

// Minimal structural types for the optional `ajv` peer dependency (no direct dependency, and it
// Ships no types usable from here) — same pattern as validateDocument in src/schema.ts.
interface AjvValidateFn {
  (doc: JsonValue): boolean;
  errors?: unknown[] | null;
}
interface AjvInstance {
  compileAsync: (schema: JsonValue) => Promise<AjvValidateFn>;
}
type AjvCtor = new (opts: {
  allErrors: boolean;
  strict: boolean;
  loadSchema: (uri: string) => Promise<JsonValue>;
}) => AjvInstance;

/**
 * Read and parse a JSON file. `JSON.parse` without a reviver only ever produces JSON values, so the
 * declared type is exact; what shape of JSON it is stays for the caller to check.
 *
 * @param {string} path - Absolute path to a JSON file
 * @returns {JsonValue}
 */
function readJson(path: string): JsonValue {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Validate `<projectRoot>/project.json` against `<projectRoot>/project.schema.json`.
 *
 * Validation failures are data (`{ valid: false, errors }`); infrastructure failures — missing
 * files, unresolvable refs, refs escaping the project root — throw.
 *
 * @param {string} projectRoot - Absolute path to the project directory
 * @returns {Promise<ProjectValidationResult>}
 */
export async function validateProjectFile(projectRoot: string): Promise<ProjectValidationResult> {
  const root = resolve(projectRoot);
  const projectPath = resolve(root, "project.json");
  const schemaPath = resolve(root, "project.schema.json");

  if (!existsSync(projectPath)) {
    throw new Error(`project.json not found in ${root}`);
  }
  if (!existsSync(schemaPath)) {
    throw new Error(
      `project.schema.json not found in ${root} — run \`jx schema\` to generate it from ` +
        `project.json#/extensions`,
    );
  }

  const project = readJson(projectPath);
  /*
   * SAFETY: project.schema.json is written by `jx schema` (emitProjectSchema), which always emits a
   * JSON object. A hand-damaged file that is not one fails loudly either way: the `$id` write below
   * throws on a primitive in this strict-mode module, and ajv rejects an array as a schema.
   */
  const entrySchema = readJson(schemaPath) as JsonObject;
  // The committed entry document is machine-path-free; injecting its file URL as $id makes its
  // Relative ./node_modules/... refs resolve against the project root.
  entrySchema.$id = pathToFileURL(schemaPath).href;

  let Ajv: AjvCtor;
  try {
    /*
     * The entry document is JSON Schema 2020-12, so use the matching Ajv build.
     * SAFETY: the default export of `ajv/dist/2020` is the Ajv2020 class. AjvCtor restates, in
     * JSON terms, only the three constructor options, `compileAsync` and the validate function's
     * call and `errors` used below; ajv reports a schema value it cannot use as a thrown error.
     */
    ({ default: Ajv } = (await import("ajv/dist/2020")) as { default: AjvCtor });
  } catch (error) {
    throw new Error("Project validation requires ajv: bun add ajv", { cause: error });
  }

  const ajv = new Ajv({
    allErrors: true,
    loadSchema: (uri) => loadProjectSchemaRef(uri, root),
    strict: false,
  });

  const validate = await ajv.compileAsync(entrySchema);
  const valid = validate(project);
  return { errors: validate.errors ?? null, valid };
}

/**
 * Restricted schema loader: only `file:` URLs inside the project root are served. Missing files
 * under `<root>/node_modules/` fall back to host resolution of the corresponding bare specifier
 * (in-repo starters have no local node_modules; the fragments still ship with the host).
 *
 * @param {string} uri - The `$ref` target ajv could not resolve from already-loaded resources
 * @param {string} root - Absolute project root
 * @returns {Promise<JsonValue>}
 */
async function loadProjectSchemaRef(uri: string, root: string): Promise<JsonValue> {
  if (!uri.startsWith("file:")) {
    throw new Error(
      `Cannot resolve schema ref "${uri}": only project-relative file refs are loadable ` +
        `(canonical URIs must resolve from already-loaded fragments)`,
    );
  }

  const filePath = fileURLToPath(uri);
  const rel = relative(root, filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Schema ref "${uri}" escapes the project root ${root}`);
  }

  if (existsSync(filePath)) {
    return readJson(filePath);
  }

  // Host fallback: <root>/node_modules/<specifier> is absent — resolve the specifier through the
  // Project's own resolution first, then the host's (workspace symlinks resolve transparently).
  const posixRel = rel.split("\\").join("/");
  const marker = "node_modules/";
  const markerIndex = posixRel.lastIndexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Schema ref "${uri}" does not exist`);
  }
  const specifier = posixRel.slice(markerIndex + marker.length);

  let resolved: string;
  try {
    const projRequire = createRequire(resolve(root, "package.json"));
    resolved = projRequire.resolve(specifier);
  } catch {
    try {
      const selfRequire = createRequire(import.meta.url);
      resolved = selfRequire.resolve(specifier);
    } catch (error) {
      // Exports-map subpath resolution is brittle against version-skewed shadowing installs (a
      // Stale local copy terminates Node's walk-up with ERR_PACKAGE_PATH_NOT_EXPORTED). Our own
      // Schema files are pure data and the running validator's copy is guaranteed to match, so
      // Read them straight off this package's disk as the last resort.
      const ownPrefix = "@jxsuite/schema/";
      if (specifier.startsWith(ownPrefix)) {
        const ownFile = fileURLToPath(
          new URL(`../${specifier.slice(ownPrefix.length)}`, import.meta.url),
        );
        if (existsSync(ownFile)) {
          return readJson(ownFile);
        }
      }
      throw new Error(
        `Schema ref "${uri}" does not exist and "${specifier}" is not resolvable from the ` +
          `project or the host`,
        { cause: error },
      );
    }
  }
  return readJson(resolved);
}
