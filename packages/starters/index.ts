/*
 * Starters — the catalogue of ready-made starter sites a user can clone when creating a new Jx
 * project (in Studio's New Project modal or via `bun create @jxsuite --template <id>`).
 *
 * This module is metadata-only: it exposes the registry and resolves each starter's on-disk
 * directory. The actual copy-and-rewrite happens in create's generate.ts. Keeping resolution here
 * (relative to `import.meta.dirname`) means it works both from the monorepo and from the published
 * package bundled inside the desktop app.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { StarterInfo } from "@jxsuite/protocol";

/**
 * One entry in `registry.json`. The wire contract owns the declaration (`StarterInfo`); this
 * package keeps exporting it under its published name so existing importers keep compiling.
 */
export type { StarterInfo as StarterMeta } from "@jxsuite/protocol";

const STARTERS_DIR = import.meta.dirname;

/** Absolute path to the directory holding the per-starter project trees. */
export const SITES_DIR = join(STARTERS_DIR, "sites");

let _cache: StarterInfo[] | null = null;

/** Read and cache the starter registry. */
export function listStarters(): StarterInfo[] {
  if (!_cache) {
    const raw = readFileSync(join(STARTERS_DIR, "registry.json"), "utf8");
    /*
     * SAFETY: registry.json is a committed file shipped inside this package, never user input, and
     * tests/registry.test.ts asserts that every entry carries each StarterInfo member as a non-empty
     * string (features as a non-empty string array), so the parsed array matches StarterInfo[].
     */
    _cache = JSON.parse(raw) as StarterInfo[];
  }
  return _cache;
}

/**
 * Look up a single starter's metadata by id.
 *
 * @param {string} id
 * @returns {StarterInfo | undefined}
 */
export function getStarter(id: string): StarterInfo | undefined {
  return listStarters().find((s) => s.id === id);
}

/**
 * Absolute path to a starter's project directory. Throws if the id is unknown, so callers get a
 * clear error rather than copying from a non-existent path.
 *
 * @param {string} id
 * @returns {string}
 */
export function getStarterDir(id: string): string {
  if (!getStarter(id)) {
    throw new Error(`Unknown starter: "${id}"`);
  }
  return join(SITES_DIR, id);
}
