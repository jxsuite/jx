/**
 * The schemas a `.jxn` file is completed from (`spec.md` §22.6): the two its project root holds,
 * which are the ones its JSON siblings are validated against, and the bundled core for a half the
 * root does not hold.
 *
 * They are read off disk at each completion and kept by the time each was last written, so `jx
 * schema` is followed without a watcher and an unchanged file is parsed once.
 *
 * @docs framework/concepts/jxn-files
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { isJsonObject } from "@jxsuite/schema/guards";
import { findEnclosingProjectOnDisk } from "@jxsuite/schema/project-file/node";
import { flattenSchema } from "@jxsuite/schema/project-schemas";
import type { ComposedProjectSchemas } from "@jxsuite/schema/project-schemas";
import projectSchema from "@jxsuite/schema/project-schema.json";
import jxSchema from "@jxsuite/schema/schema.json";
import type { JsonObject } from "@jxsuite/schema/types";

/** A schema file as it was last read; null when what it holds is not a schema. */
interface Kept {
  mtime: number;
  schema: JsonObject | null;
}

const kept = new Map<string, Kept>();

let core: ComposedProjectSchemas | undefined;

/** The schemas of a file that is in no project: the core, with no extension's part. */
function coreSchemas(): ComposedProjectSchemas {
  // Flattened when first asked for, so a window that never completes never pays for it.
  core ??= { document: flattenSchema(jxSchema), project: flattenSchema(projectSchema) };
  return core;
}

/** A schema file's contents; null when it is absent or is not a JSON object. */
function readSchema(path: string): JsonObject | null {
  const mtime = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
  if (mtime === undefined) {
    kept.delete(path);
    return null;
  }
  const last = kept.get(path);
  if (last?.mtime === mtime) {
    return last.schema;
  }
  let schema: JsonObject | null = null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    schema = isJsonObject(parsed) ? parsed : null;
  } catch {
    // Half written, or not JSON: the core stands in until it is.
  }
  kept.set(path, { mtime, schema });
  return schema;
}

/**
 * The schemas in force for a file.
 *
 * @param file The file's path; null for a document that is not on disk, which is in no project.
 * @returns The nearest project root's two schemas, each replaced by the core where the root does
 *   not hold it.
 */
export function schemasFor(file: string | null): ComposedProjectSchemas {
  const project = file === null ? null : findEnclosingProjectOnDisk(dirname(file));
  if (!project) {
    return coreSchemas();
  }
  return {
    document: readSchema(join(project.root, "document.schema.json")) ?? coreSchemas().document,
    project: readSchema(join(project.root, "project.schema.json")) ?? coreSchemas().project,
  };
}
