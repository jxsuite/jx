/**
 * site-loader.js — Load and validate site.json configuration
 *
 * Parses the project root's site.json file and provides normalized
 * configuration with sensible defaults for all site-level properties.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * Default site configuration. All properties are optional in site.json;
 * these defaults fill in anything the author omits.
 */
const DEFAULTS = {
  name: "JSONsx Site",
  url: "",
  defaults: {
    layout: null,
    lang: "en",
    charset: "utf-8",
  },
  $head: [],
  imports: {},
  $media: {},
  style: {},
  state: {},
  redirects: {},
  build: {
    outDir: "./dist",
    format: "directory",
    trailingSlash: "always",
  },
};

/**
 * Load and validate site.json from a project root.
 *
 * @param {string} projectRoot - Absolute path to the project directory
 * @returns {{ config: Record<string, any>, configPath: string, projectRoot: string }}
 * @throws {Error} if site.json is missing or invalid JSON
 */
export function loadSiteConfig(projectRoot) {
  const configPath = resolve(projectRoot, "site.json");

  if (!existsSync(configPath)) {
    throw new Error(`site.json not found in ${projectRoot}`);
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    const err = /** @type {any} */ (e);
    throw new Error(`Invalid JSON in ${configPath}: ${err.message}`);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`site.json must be a JSON object, got ${typeof raw}`);
  }

  // Deep merge with defaults
  const config = {
    ...DEFAULTS,
    ...raw,
    defaults: { ...DEFAULTS.defaults, ...raw.defaults },
    build: { ...DEFAULTS.build, ...raw.build },
  };

  // Preserve arrays and objects that shouldn't be shallow-merged
  if (raw.$head) config.$head = raw.$head;
  if (raw.$media) config.$media = raw.$media;
  if (raw.style) config.style = raw.style;
  if (raw.state) config.state = raw.state;
  if (raw.redirects) config.redirects = raw.redirects;
  if (raw.imports) config.imports = raw.imports;

  return {
    config,
    configPath,
    projectRoot: resolve(projectRoot),
  };
}
