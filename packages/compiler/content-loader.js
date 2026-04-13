/**
 * content-loader.js — Content collection loader
 *
 * Loads content collections defined in content/content.config.json.
 * Supports Markdown (.md), JSON (.json), and CSV (.csv) source files.
 *
 * Phase 2 implementation of site-architecture spec §6.
 *
 * @module content-loader
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, basename, extname, dirname } from "node:path";
import { globSync } from "glob";

// ─── CSV Parser (minimal, spec-compliant) ─────────────────────────────────────

/**
 * Parse a CSV string into an array of objects using the first row as headers.
 * Handles quoted fields with commas and newlines.
 *
 * @param {string} csv - Raw CSV text
 * @returns {object[]} Array of row objects
 */
function parseCSV(csv) {
  const rows = [];
  let current = "";
  let inQuotes = false;
  const lines = [];

  // Split into rows respecting quoted newlines
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (inQuotes && csv[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "\n" || (ch === "\r" && csv[i + 1] === "\n")) && !inQuotes) {
      lines.push(current);
      current = "";
      if (ch === "\r") i++;
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  if (lines.length === 0) return [];

  const parseRow = (line) => {
    const fields = [];
    let field = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          q = !q;
        }
      } else if (ch === "," && !q) {
        fields.push(field);
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field);
    return fields;
  };

  const headers = parseRow(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const fields = parseRow(lines[i]);
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j].trim()] = fields[j]?.trim() ?? "";
    }
    rows.push(obj);
  }
  return rows;
}

// ─── Markdown loader ──────────────────────────────────────────────────────────

let _mdModule = null;

/**
 * Lazily import @jsonsx/parser for Markdown support.
 * This avoids hard dependency — only loads when MD collections exist.
 */
async function getMarkdownModule() {
  if (!_mdModule) {
    _mdModule = await import("@jsonsx/parser");
  }
  return _mdModule;
}

/**
 * Load a single markdown file into a ContentEntry.
 * @param {string} filePath - Absolute path to .md file
 * @returns {Promise<object>} ContentEntry shape
 */
async function loadMarkdownEntry(filePath) {
  const { MarkdownFile } = await getMarkdownModule();
  const file = new MarkdownFile({ src: filePath });
  const result = await file.resolve();
  return {
    id: result.slug,
    data: result.frontmatter,
    body: readFileSync(filePath, "utf-8"),
    rendered: result.$body,
    _meta: {
      excerpt: result.$excerpt,
      toc: result.$toc,
      readingTime: result.$readingTime,
      wordCount: result.$wordCount,
    },
  };
}

/**
 * Load a JSON file into ContentEntry(s).
 * If the file is an array, each element is an entry.
 * If it's an object with an `id` field, it's a single entry.
 * @param {string} filePath - Absolute path to .json file
 * @returns {object[]} Array of ContentEntry shapes
 */
function loadJSONEntries(filePath) {
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  if (Array.isArray(raw)) {
    return raw.map((item, i) => ({
      id: item.id ?? basename(filePath, ".json") + "-" + i,
      data: item,
      body: null,
      rendered: null,
    }));
  }
  // Single object file — filename is the id
  return [{
    id: raw.id ?? basename(filePath, ".json"),
    data: raw,
    body: null,
    rendered: null,
  }];
}

/**
 * Load a CSV file into ContentEntry(s).
 * @param {string} filePath - Absolute path to .csv file
 * @param {object} [schema] - Collection schema (for type coercion)
 * @returns {object[]} Array of ContentEntry shapes
 */
function loadCSVEntries(filePath, schema) {
  const csv = readFileSync(filePath, "utf-8");
  const rows = parseCSV(csv);
  return rows.map((row, i) => {
    // Apply type coercion based on schema if available
    if (schema?.properties) {
      for (const [key, def] of Object.entries(schema.properties)) {
        if (key in row) {
          if (def.type === "number") row[key] = Number(row[key]);
          else if (def.type === "boolean") row[key] = row[key] === "true";
        }
      }
    }
    // Use `id` column, `sku` column, or row index as the entry ID
    const id = row.id ?? row.sku ?? String(i);
    return { id, data: row, body: null, rendered: null };
  });
}

// ─── Content Config ───────────────────────────────────────────────────────────

/**
 * Load and parse content/content.config.json.
 *
 * @param {string} projectRoot - Project root directory
 * @returns {{ config: object, contentDir: string } | null} Parsed config or null if no content dir
 */
export function loadContentConfig(projectRoot) {
  const contentDir = resolve(projectRoot, "content");
  const configPath = resolve(contentDir, "content.config.json");

  if (!existsSync(contentDir)) return null;

  let config = { collections: {} };
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  }

  return { config, contentDir };
}

// ─── Collection Loading ───────────────────────────────────────────────────────

/**
 * Load all content collections defined in content.config.json.
 *
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<Map<string, object[]>>} Map of collection name → array of ContentEntry
 */
export async function loadCollections(projectRoot) {
  const result = loadContentConfig(projectRoot);
  if (!result) return new Map();

  const { config, contentDir } = result;
  const collections = new Map();

  for (const [name, collectionDef] of Object.entries(config.collections)) {
    const entries = await loadCollection(name, collectionDef, contentDir);
    collections.set(name, entries);
  }

  return collections;
}

/**
 * Load a single collection by its definition.
 *
 * @param {string} name - Collection name
 * @param {object} collectionDef - Collection definition from content.config.json
 * @param {string} contentDir - Absolute path to content/ directory
 * @returns {Promise<object[]>} Array of ContentEntry
 */
async function loadCollection(name, collectionDef, contentDir) {
  const source = collectionDef.source;
  const schema = collectionDef.schema;

  // Resolve the glob pattern relative to content/
  const pattern = resolve(contentDir, source).split("\\").join("/");
  const files = globSync(pattern, { absolute: true });

  const entries = [];

  for (const filePath of files) {
    const ext = extname(filePath).toLowerCase();

    if (ext === ".md") {
      entries.push(await loadMarkdownEntry(filePath));
    } else if (ext === ".json") {
      entries.push(...loadJSONEntries(filePath));
    } else if (ext === ".csv") {
      entries.push(...loadCSVEntries(filePath, schema));
    }
  }

  // Validate entries against schema if present
  if (schema) {
    validateEntries(entries, schema, name);
  }

  return entries;
}

// ─── Schema Validation ────────────────────────────────────────────────────────

/**
 * Validate content entries against their collection schema.
 * Logs warnings for missing required fields and type mismatches.
 *
 * @param {object[]} entries - Array of ContentEntry
 * @param {object} schema - JSON Schema for the collection
 * @param {string} collectionName - For error messages
 */
function validateEntries(entries, schema, collectionName) {
  const required = schema.required ?? [];
  const properties = schema.properties ?? {};

  for (const entry of entries) {
    // Check required fields
    for (const field of required) {
      if (!(field in entry.data) || entry.data[field] == null) {
        console.warn(
          `Content validation: "${collectionName}/${entry.id}" missing required field "${field}"`
        );
      }
    }

    // Check types
    for (const [field, def] of Object.entries(properties)) {
      const value = entry.data[field];
      if (value == null) continue;

      if (def.type === "string" && typeof value !== "string") {
        console.warn(
          `Content validation: "${collectionName}/${entry.id}" field "${field}" expected string, got ${typeof value}`
        );
      } else if (def.type === "number" && typeof value !== "number") {
        console.warn(
          `Content validation: "${collectionName}/${entry.id}" field "${field}" expected number, got ${typeof value}`
        );
      } else if (def.type === "boolean" && typeof value !== "boolean") {
        console.warn(
          `Content validation: "${collectionName}/${entry.id}" field "${field}" expected boolean, got ${typeof value}`
        );
      } else if (def.type === "array" && !Array.isArray(value)) {
        console.warn(
          `Content validation: "${collectionName}/${entry.id}" field "${field}" expected array, got ${typeof value}`
        );
      }
    }
  }
}

// ─── Collection Querying ──────────────────────────────────────────────────────

/**
 * Query a loaded collection with filter, sort, and limit.
 * Implements the ContentCollection $prototype resolution.
 *
 * @param {object[]} entries - Full collection entries
 * @param {object} query - Query options
 * @param {object} [query.filter] - Key-value filter (AND semantics)
 * @param {object} [query.sort] - { field, order }
 * @param {number} [query.limit] - Max entries to return
 * @returns {object[]} Filtered, sorted, limited entries
 */
export function queryCollection(entries, query = {}) {
  let result = [...entries];

  // Filter
  if (query.filter && typeof query.filter === "object") {
    result = result.filter((entry) => {
      for (const [key, expected] of Object.entries(query.filter)) {
        const actual = entry.data[key];
        if (actual !== expected) return false;
      }
      return true;
    });
  }

  // Sort
  if (query.sort) {
    const { field, order = "asc" } = query.sort;
    result.sort((a, b) => {
      const aVal = a.data[field] ?? "";
      const bVal = b.data[field] ?? "";
      if (aVal < bVal) return order === "asc" ? -1 : 1;
      if (aVal > bVal) return order === "asc" ? 1 : -1;
      return 0;
    });
  }

  // Limit
  if (query.limit && query.limit > 0) {
    result = result.slice(0, query.limit);
  }

  return result;
}

/**
 * Find a single entry by ID in a collection.
 * Implements the ContentEntry $prototype resolution.
 *
 * @param {object[]} entries - Full collection entries
 * @param {string} id - Entry ID to find
 * @returns {object|null} The matching entry or null
 */
export function findEntry(entries, id) {
  return entries.find((e) => e.id === id) ?? null;
}

// ─── Collection Reference Resolution ─────────────────────────────────────────

/**
 * Resolve cross-collection $ref references in entry data.
 * For example, a blog post's `author: "jane-doe"` with a schema `$ref`
 * to the authors collection gets resolved to the full author entry.
 *
 * @param {Map<string, object[]>} collections - All loaded collections
 * @param {object} config - content.config.json
 */
export function resolveCollectionRefs(collections, config) {
  for (const [name, collectionDef] of Object.entries(config.collections)) {
    const schema = collectionDef.schema;
    if (!schema?.properties) continue;

    const entries = collections.get(name);
    if (!entries) continue;

    for (const [field, def] of Object.entries(schema.properties)) {
      if (!def.$ref?.startsWith("#/collections/")) continue;
      const refCollection = def.$ref.replace("#/collections/", "");
      const refEntries = collections.get(refCollection);
      if (!refEntries) continue;

      for (const entry of entries) {
        const refId = entry.data[field];
        if (typeof refId === "string") {
          const resolved = refEntries.find((e) => e.id === refId);
          if (resolved) {
            entry.data[field] = resolved;
          }
        }
      }
    }
  }
}
