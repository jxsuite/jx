/**
 * Structural validation of every shipped starter: project.json must satisfy the project-config
 * schema AND its committed bundled entry schema, every component/layout/page document must validate
 * against the starter's bundled document schema (the same schema editors and the studio consume),
 * the committed entry documents must be self-contained (no relative $refs), and every content .md
 * must carry YAML frontmatter. (Full image-optimizing compilation is covered by CI screenshots — it
 * requires the compiler's native addon, which a checkout builds with `bun run build:addon`.)
 */
import { parseNativeDocument } from "@jxsuite/schema/jxn";
import { parseProjectSource } from "@jxsuite/schema/project-file";
import { projectFilePath } from "@jxsuite/schema/project-file/node";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import { listStarters, SITES_DIR } from "../index";

const starters = listStarters();

/** Parse a committed bundled entry schema, which is always a JSON Schema object document. */
function parseSchemaDocument(raw: string): JsonObject {
  const parsed: unknown = JSON.parse(raw);
  if (!isJsonObject(parsed)) {
    throw new Error("A bundled entry schema must be a JSON object");
  }
  return parsed;
}

/** Compile each distinct schema once — starters share identical bundled entry documents. */
const validatorCache = new Map<string, ReturnType<Ajv2020["compile"]>>();

function compileSchema(raw: string) {
  let validate = validatorCache.get(raw);
  if (!validate) {
    const ajv = new Ajv2020({ allErrors: true, ownProperties: true, strict: false });
    addFormats(ajv);
    validate = ajv.compile(parseSchemaDocument(raw));
    validatorCache.set(raw, validate);
  }
  return validate;
}

/** Collect relative-path $refs — committed entry documents must be self-contained bundles. */
function collectRelativeRefs(node: JsonValue, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectRelativeRefs(item, out);
    }
    return;
  }
  if (!isJsonObject(node)) {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "$ref" &&
      isString(value) &&
      !value.startsWith("#") &&
      !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)
    ) {
      out.push(value);
    }
    collectRelativeRefs(value, out);
  }
}

describe("starter sites validate", () => {
  for (const starter of starters) {
    const dir = join(SITES_DIR, starter.id);

    describe(starter.id, () => {
      test("its project file reads, and is project.jxn", () => {
        const path = projectFilePath(dir);
        expect(path).toBe(join(dir, "project.jxn"));
        expect(() => parseProjectSource(readFileSync(path, "utf8"), path)).not.toThrow();
      });

      test("committed entry documents are self-contained bundles", () => {
        for (const name of ["project.schema.json", "document.schema.json"]) {
          const raw = readFileSync(join(dir, name), "utf8");
          const residual: string[] = [];
          collectRelativeRefs(parseSchemaDocument(raw), residual);
          expect(residual, `${starter.id}/${name} carries relative $refs`).toEqual([]);
        }
      });

      test("its project file validates against the bundled entry schema", () => {
        const validate = compileSchema(readFileSync(join(dir, "project.schema.json"), "utf8"));
        const path = projectFilePath(dir);
        const project: unknown = parseProjectSource(readFileSync(path, "utf8"), path);
        const valid = validate(project);
        expect(valid, `${starter.id}/project.jxn: ${JSON.stringify(validate.errors)}`).toBe(true);
      });

      test("every component/layout/page validates against the bundled document schema", () => {
        const validate = compileSchema(readFileSync(join(dir, "document.schema.json"), "utf8"));
        const glob = new Bun.Glob("{components,layouts,pages}/**/*.{json,jxn}");
        let count = 0;
        for (const rel of glob.scanSync({ cwd: dir })) {
          count += 1;
          const doc: unknown = parseNativeDocument(readFileSync(join(dir, rel), "utf8"), rel);
          const valid = validate(doc);
          expect(
            valid,
            `${starter.id}/${rel}: ${JSON.stringify(validate.errors?.slice(0, 5))}`,
          ).toBe(true);
        }
        expect(count, `${starter.id} has no page/component/layout files`).toBeGreaterThan(0);
      });

      test("every content .md carries frontmatter", () => {
        const glob = new Bun.Glob("content/**/*.md");
        for (const rel of glob.scanSync({ cwd: dir })) {
          const raw = readFileSync(join(dir, rel), "utf8");
          expect(raw.startsWith("---"), `${starter.id}/${rel} has no frontmatter`).toBe(true);
        }
      });
    });
  }
});
