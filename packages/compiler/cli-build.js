#!/usr/bin/env node
/**
 * jx-build — CLI entry point for multi-page site builds
 *
 * Usage:
 *   bun packages/compiler/cli-build.js [project-root]
 *   bun packages/compiler/cli-build.js ./my-site --verbose
 *
 * Options:
 *   --verbose    Print detailed build progress
 *   --no-clean   Don't clean outDir before building
 */

import { resolve } from "node:path";
import { buildSite } from "./site-build.js";

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith("--")));
const positional = args.filter(a => !a.startsWith("--"));

const projectRoot = resolve(positional[0] ?? ".");
const verbose = flags.has("--verbose");
const clean = !flags.has("--no-clean");

console.log(`Building site from ${projectRoot}...`);

try {
  const result = await buildSite(projectRoot, { verbose, clean });

  if (result.errors.length > 0) {
    console.error(`\nBuild completed with ${result.errors.length} error(s):`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(`\nDone: ${result.routes} routes → ${result.files} files`);
} catch (e) {
  const err = /** @type {any} */ (e);
  console.error(`Build failed: ${err.message}`);
  process.exit(1);
}
