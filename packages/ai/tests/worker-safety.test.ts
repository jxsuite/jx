/**
 * The Worker-safety gate for @jxsuite/ai.
 *
 * `./streaming-client`, `./tools` and `./gateway` are the subpaths a Worker backend (the `ai/chat`
 * route on Cloudflare, for one) imports. Nothing structural keeps them loadable there: one import
 * of `./chat-state`, `node:path` or `@jxsuite/schema` and a Worker bundle either fails or quietly
 * ships Studio's reactivity engine. This file bundles each Worker-safe entry the way a Worker build
 * resolves it and fails on any module in the graph that the policy below forbids.
 *
 * It is one half of the gate. A bundle graph only sees what is IMPORTED; a global such as
 * `Bun.file` compiles to no import at all. `tsconfig.worker.json` is the other half (bare ES2023
 * lib, `@cloudflare/workers-types` as the only ambient types): `bunx tsc -p
 * packages/ai/tsconfig.worker.json` from the repository root. The last block here keeps the two in
 * step. The one hole between them, `process` and `Buffer`, which workers-types declares as `any`,
 * is closed by scanning the bundled text (HOST_GLOBALS).
 *
 * Three things keep the gate from passing vacuously: every Worker-safe graph is pinned module for
 * module, the bundle's exports must equal the module's runtime exports, and every forbidden rule is
 * proven to FIRE, on a synthetic graph and, where the dependency is certain to be installed, on a
 * real build.
 *
 * @module @jxsuite/ai/tests/worker-safety
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { BuildMetafile } from "bun";

const PKG_DIR = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(PKG_DIR, "../..");

// ─── The policy ──────────────────────────────────────────────────────────────

/**
 * The subpaths a Worker may import, keyed and valued exactly as `package.json` `exports` names
 * them. Adding a subpath here is a claim that its whole bundle graph passes FORBIDDEN; the tests
 * below hold it to that, and `tsconfig.worker.json`'s `include` must name the same files.
 */
const WORKER_SAFE_ENTRIES: Readonly<Record<string, string>> = {
  "./gateway": "./src/gateway/index.ts",
  "./streaming-client": "./src/streaming-client.ts",
  "./tools": "./src/tools.ts",
};

/**
 * Every other export, with the rule it trips today. Listing them keeps WORKER_SAFE_ENTRIES honest
 * in both directions: a new subpath must be classified before this file passes, and an entry here
 * that starts bundling clean fails too, so it gets promoted rather than left looking unsafe.
 */
const NOT_WORKER_SAFE: Readonly<Record<string, { file: string; trips: string; why: string }>> = {
  ".": {
    file: "./src/index.ts",
    trips: "@vue/reactivity",
    why: "the barrel re-exports ./chat-state",
  },
  "./chat-state": {
    file: "./src/chat-state.ts",
    trips: "@vue/reactivity",
    why: "createChatState is built on reactive()",
  },
};

/**
 * The module graph each Worker-safe entry bundles today, repository-relative and sorted. This is
 * the non-vacuity pin: a build that resolved nothing cannot match it, and a new module entering a
 * Worker graph is a diff someone reads. Note what is NOT here: streaming-client's only import is
 * `import type { ProblemDetails } from "@jxsuite/protocol"`, which is erased, so @jxsuite/protocol
 * contributes no module at runtime. The gateway is the one entry that imports protocol at runtime,
 * and only its two problem modules (for `problemDetails` and `PROBLEM_MEDIA_TYPE`), never the root
 * barrel, which would bring the route table too. Its type-only imports (`gateway/types.ts`, and the
 * frame types it borrows from streaming-client) are erased the same way. When a change adds a
 * module on purpose, confirm it passes FORBIDDEN ("reaches no forbidden module" checks) and add it
 * here.
 */
const FROZEN_GRAPHS: Readonly<Record<string, readonly string[]>> = {
  "./gateway": [
    "packages/ai/src/gateway/chat.ts",
    "packages/ai/src/gateway/index.ts",
    "packages/ai/src/gateway/models.ts",
    "packages/ai/src/gateway/normalize.ts",
    "packages/ai/src/gateway/problem.ts",
    "packages/ai/src/gateway/sse.ts",
    "packages/ai/src/gateway/upstream-error.ts",
    "packages/protocol/src/problem.ts",
    "packages/protocol/src/problems.ts",
  ],
  "./streaming-client": ["packages/ai/src/streaming-client.ts"],
  "./tools": ["packages/ai/src/tools.ts"],
};

/** A forbidden module, matched by how it was imported, where it resolved, or both. */
interface ForbiddenRule {
  /** The name a failure reports. */
  id: string;
  /** Tested against every specifier as written, and against an external import's path. */
  specifier: RegExp;
  /** Tested against every module's resolved path (repository-relative, or a `node:` / `bun:` id). */
  path: RegExp;
}

/** A third-party package's files, wherever the installer put them (hoisted or nested). */
const inNodeModules = (name: string): RegExp => new RegExp(`(?:^|/)node_modules/${name}/`);

/**
 * A Jx workspace package's files, as a workspace symlink resolves them (`packages/<dir>/`) or as a
 * published copy shadowing the workspace does (`node_modules/@jxsuite/<dir>/`).
 */
const inJxPackage = (dir: string): RegExp =>
  new RegExp(`(?:^|/)(?:packages/${dir}|node_modules/@jxsuite/${dir})/`);

/**
 * What a Worker-safe graph may not contain. Bun's browser target is FORGIVING, which is the reason
 * this list exists: it polyfills most Node builtins silently (`node:path`, `node:crypto`, and bare
 * `path` or `events`, which it records as `node:*` modules), externalizes the ones it cannot
 * polyfill (`fs`, `node:fs`), and reports success either way. Only `bun` builtins fail the build.
 */
const FORBIDDEN: readonly ForbiddenRule[] = [
  // Node builtins, polyfilled or not. A Worker without nodejs_compat has none of them.
  { id: "node:", specifier: /^node:/, path: /^node:/ },
  /* Bun builtins (`bun`, `bun:sqlite`, `bun:test`). A browser build refuses these outright; the
     rule is here so a synthetic graph can prove the gate would name one. */
  { id: "bun", specifier: /^bun(?::|$)/, path: /^bun(?::|$)/ },
  // Studio's reactivity engine. The only consumer in this package is ./chat-state.
  {
    id: "@vue/reactivity",
    specifier: /^@vue\/reactivity(?:\/|$)/,
    path: inNodeModules("@vue/reactivity"),
  },
  /* Ajv (and its plugins, ajv-formats and friends) compiles validators with `new Function`, which a
     Worker refuses at runtime. */
  {
    id: "ajv",
    specifier: /^ajv(?:-[\w-]+)?(?:\/|$)/,
    path: /(?:^|\/)node_modules\/ajv(?:-[\w-]+)?\//,
  },
  // Collaboration, MCP and schema-validation machinery: host-side, and large.
  { id: "yjs", specifier: /^yjs(?:\/|$)/, path: inNodeModules("yjs") },
  {
    id: "@modelcontextprotocol",
    specifier: /^@modelcontextprotocol\//,
    path: inNodeModules("@modelcontextprotocol/[^/]+"),
  },
  { id: "zod", specifier: /^zod(?:\/|$)/, path: inNodeModules("zod") },
  // DOM- and host-bound Jx packages.
  { id: "packages/studio", specifier: /^@jxsuite\/studio(?:\/|$)/, path: inJxPackage("studio") },
  { id: "packages/runtime", specifier: /^@jxsuite\/runtime(?:\/|$)/, path: inJxPackage("runtime") },
  { id: "packages/ui", specifier: /^@jxsuite\/ui(?:\/|$)/, path: inJxPackage("ui") },
  /* The ROOT entry of @jxsuite/schema (src/schema.ts) builds the whole schema from @webref data
     and reaches ajv. Its subpaths (./types, ./doc-ops, ./guards, ...) are separate modules and stay
     allowed; only the root and the two below are named. */
  {
    id: "@jxsuite/schema root",
    specifier: /^@jxsuite\/schema$/,
    path: /(?:^|\/)(?:packages\/schema|node_modules\/@jxsuite\/schema)\/src\/schema\.ts$/,
  },
  // Project validation: node:fs, node:module, node:path and node:url.
  {
    id: "validate-project",
    specifier: /(?:^|\/)validate-project(?:\.[cm]?[jt]s)?$/,
    path: /(?:^|\/)validate-project\.[cm]?[jt]s$/,
  },
  // Per-project schema composition: build-host machinery, not a Worker's.
  {
    id: "project-schemas",
    specifier: /(?:^|\/)project-schemas(?:\.[cm]?[jt]s)?$/,
    path: /(?:^|\/)project-schemas\.[cm]?[jt]s$/,
  },
];

/**
 * The rule every external import trips unless it is listed in ALLOWED_EXTERNALS. It closes the hole
 * FORBIDDEN alone leaves: Bun records an unpolyfillable bare builtin (`fs`) as an external with no
 * `node:` prefix anywhere, so no specifier or path rule would see it.
 */
const EXTERNAL_RULE = "external";

/** External imports a Worker-safe bundle may keep. Empty: a Worker-safe entry bundles whole. */
const ALLOWED_EXTERNALS: ReadonlySet<string> = new Set<string>();

/**
 * Host globals the bundled code may not touch. `tsconfig.worker.json` already rejects `Bun` and
 * every DOM global, but @cloudflare/workers-types 5.x declares `process` and `Buffer` as `any`
 * (they exist under nodejs_compat), so tsc accepts both. Matched as a member access or a call,
 * never as a bare word, so prose inside a string ("could not process the reply") is not a hit.
 */
const HOST_GLOBALS: readonly (readonly [name: string, pattern: RegExp])[] = [
  ["process", /\bprocess\s*\./],
  ["Buffer", /\bBuffer\s*[.(]/],
  ["Bun", /\bBun\s*\./],
];

// ─── The scanner ─────────────────────────────────────────────────────────────

interface Violation {
  rule: string;
  /** The offending module: repository-relative path, builtin id, or external specifier. */
  module: string;
  /** Shortest import chain from the entry to `module`, both ends included. */
  chain: string[];
}

interface WorkerGraph {
  /** False when Bun could not bundle the entry at all; `logs` says why. */
  ok: boolean;
  logs: string[];
  /** Every module in the bundle, repository-relative (or a builtin id), sorted. */
  modules: string[];
  /** The entry output's export names, sorted. */
  exports: string[];
  violations: Violation[];
  /** The bundled JavaScript, every output concatenated. */
  code: string;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Metafile paths are relative to `base`; builtins (`node:url`) have no file and pass through. */
function normalize(path: string, base: string): string {
  if (!isAbsolute(path) && SCHEME.test(path)) {
    return path;
  }
  return relative(REPO_ROOT, resolve(base, path)).split(sep).join("/");
}

function compare(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Judge a metafile. `base` is the directory its paths are relative to, which for Bun.build is the
 * process working directory (verified on Bun 1.4.2; `root` does not change it).
 */
function scanMetafile(meta: BuildMetafile, entry: string, base: string): Violation[] {
  const edges = new Map<string, string[]>();
  /** Every specifier each module was imported by. */
  const specifiers = new Map<string, Set<string>>();
  /** External targets, with the module that imported each first. */
  const externals = new Map<string, string>();

  for (const [rawPath, input] of Object.entries(meta.inputs)) {
    const from = normalize(rawPath, base);
    const targets: string[] = [];
    for (const imp of input.imports) {
      const target = imp.external ? imp.path : normalize(imp.path, base);
      const seen = specifiers.get(target) ?? new Set<string>();
      if (imp.original !== undefined) {
        seen.add(imp.original);
      }
      if (imp.external) {
        seen.add(imp.path);
        if (!externals.has(target)) {
          externals.set(target, from);
        }
      } else {
        targets.push(target);
      }
      specifiers.set(target, seen);
    }
    edges.set(from, targets);
  }

  // Shortest chains, breadth-first from the entry.
  const parent = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
    for (const next of edges.get(node) ?? []) {
      if (parent.has(next)) {
        continue;
      }
      parent.set(next, node);
      queue.push(next);
    }
  }
  const chainTo = (module: string): string[] => {
    const importer = externals.get(module);
    if (importer !== undefined && !parent.has(module)) {
      return [...chainTo(importer), module];
    }
    const chain: string[] = [];
    for (let at: string | null | undefined = module; typeof at === "string"; at = parent.get(at)) {
      chain.unshift(at);
    }
    return chain;
  };

  const violations: Violation[] = [];
  const candidates = new Set([...edges.keys(), ...externals.keys()]);
  for (const module of candidates) {
    const written = [...(specifiers.get(module) ?? [])];
    const rules = FORBIDDEN.filter(
      (rule) => rule.path.test(module) || written.some((s) => rule.specifier.test(s)),
    ).map((rule) => rule.id);
    if (externals.has(module) && !ALLOWED_EXTERNALS.has(module)) {
      rules.push(EXTERNAL_RULE);
    }
    for (const rule of rules) {
      violations.push({ rule, module, chain: chainTo(module) });
    }
  }
  return violations.toSorted((a, b) => compare(a.module, b.module) || compare(a.rule, b.rule));
}

/**
 * Bundle `entry` as a Worker build resolves it and judge the graph. `source`, when given, is the
 * entry's content served from memory (Bun.build `files`), so a canary needs no file on disk; the
 * path still decides how its imports resolve.
 */
async function bundleForWorker(entry: string, source?: string): Promise<WorkerGraph> {
  const result = await Bun.build({
    entrypoints: [entry],
    ...(source === undefined ? {} : { files: { [entry]: source } }),
    target: "browser",
    conditions: ["workerd", "worker"],
    metafile: true,
    throw: false,
  });
  const logs = result.logs.map((log) => log.message);
  const meta = result.metafile;
  if (!result.success || meta === undefined) {
    return { ok: false, logs, modules: [], exports: [], violations: [], code: "" };
  }
  const base = process.cwd();
  const from = normalize(entry, REPO_ROOT);
  const output = Object.values(meta.outputs).find(
    (out) => out.entryPoint !== undefined && normalize(out.entryPoint, base) === from,
  );
  const texts = await Promise.all(result.outputs.map((artifact) => artifact.text()));
  const code = texts.join("\n");
  return {
    ok: true,
    logs,
    modules: Object.keys(meta.inputs)
      .map((path) => normalize(path, base))
      .toSorted(compare),
    exports: (output?.exports ?? []).toSorted(compare),
    violations: scanMetafile(meta, from, base),
    code,
  };
}

/** The HOST_GLOBALS names `code` references, in list order. */
function hostGlobalsIn(code: string): string[] {
  return HOST_GLOBALS.filter(([, pattern]) => pattern.test(code)).map(([name]) => name);
}

/** One line per violation, so a failure reads as a list of reasons rather than an object dump. */
function describeViolations(violations: readonly Violation[]): string[] {
  return violations.map((v) => `[${v.rule}] ${v.module}  (${v.chain.join(" -> ")})`);
}

const rulesOf = (graph: WorkerGraph): string[] => [...new Set(graph.violations.map((v) => v.rule))];

const pkgFile = (file: string): string => join(PKG_DIR, file);

/** A virtual entry beside the real sources, so its bare imports resolve as this package's do. */
const CANARY_ENTRY = pkgFile("src/__worker_gate_canary__.ts");

// ─── The Worker-safe entries ─────────────────────────────────────────────────

describe("Worker-safe entries", () => {
  for (const [subpath, file] of Object.entries(WORKER_SAFE_ENTRIES)) {
    describe(`@jxsuite/ai${subpath.slice(1)}`, () => {
      it("bundles for a Worker", async () => {
        const graph = await bundleForWorker(pkgFile(file));
        expect(graph.logs).toEqual([]);
        expect(graph.ok).toBe(true);
      });

      it("reaches no forbidden module", async () => {
        const graph = await bundleForWorker(pkgFile(file));
        expect(describeViolations(graph.violations)).toEqual([]);
      });

      it("references no host global a Worker lacks", async () => {
        const graph = await bundleForWorker(pkgFile(file));
        expect(graph.code.length).toBeGreaterThan(0);
        expect(hostGlobalsIn(graph.code)).toEqual([]);
      });

      it("bundles exactly the frozen graph", async () => {
        const graph = await bundleForWorker(pkgFile(file));
        expect(graph.modules).toContain(normalize(pkgFile(file), REPO_ROOT));
        expect(graph.modules).toEqual([...(FROZEN_GRAPHS[subpath] ?? [])]);
      });

      it("bundles every runtime export of the module", async () => {
        const graph = await bundleForWorker(pkgFile(file));
        const runtime = Object.keys((await import(pkgFile(file))) as object).toSorted(compare);
        expect(runtime.length).toBeGreaterThan(0);
        expect(graph.exports).toEqual(runtime);
      });
    });
  }
});

// ─── The list stays honest ───────────────────────────────────────────────────

describe("the Worker-safe list stays honest", () => {
  it("classifies every package.json export, and nothing else", () => {
    const pkg = JSON.parse(readFileSync(pkgFile("package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    const classified: Record<string, string> = { ...WORKER_SAFE_ENTRIES };
    for (const [subpath, entry] of Object.entries(NOT_WORKER_SAFE)) {
      classified[subpath] = entry.file;
    }
    expect(
      Object.keys(WORKER_SAFE_ENTRIES).filter((subpath) => subpath in NOT_WORKER_SAFE),
    ).toEqual([]);
    expect(pkg.exports).toEqual(classified);
    expect(Object.keys(FROZEN_GRAPHS).toSorted(compare)).toEqual(
      Object.keys(WORKER_SAFE_ENTRIES).toSorted(compare),
    );
  });

  for (const [subpath, entry] of Object.entries(NOT_WORKER_SAFE)) {
    it(`${subpath} is not Worker-safe today (${entry.why})`, async () => {
      const graph = await bundleForWorker(pkgFile(entry.file));
      // If this fails because the entry now bundles clean, move it to WORKER_SAFE_ENTRIES.
      expect(graph.ok).toBe(true);
      expect(rulesOf(graph)).toContain(entry.trips);
    });
  }

  it("the root barrel reaches @vue/reactivity through ./chat-state", async () => {
    const graph = await bundleForWorker(pkgFile("src/index.ts"));
    const hit = graph.violations.find((v) => v.rule === "@vue/reactivity");
    expect(hit).toBeDefined();
    expect(hit?.chain.slice(0, 2)).toEqual([
      "packages/ai/src/index.ts",
      "packages/ai/src/chat-state.ts",
    ]);
    expect(hit?.module).toMatch(/^node_modules\/@vue\/reactivity\//);
  });
});

// ─── Every rule fires ────────────────────────────────────────────────────────

/** A synthetic one-import graph: [specifier as written, where it resolved, external?]. */
type Edge = readonly [specifier: string, resolved: string, external?: boolean];

const SYNTHETIC_ENTRY = "packages/ai/src/entry.ts";

function synthetic(...imports: Edge[]): BuildMetafile {
  const inputs: BuildMetafile["inputs"] = {
    [SYNTHETIC_ENTRY]: {
      bytes: 1,
      imports: imports.map(([original, path, external]) =>
        external === true
          ? { path, kind: "import-statement" as const, original, external: true }
          : { path, kind: "import-statement" as const, original },
      ),
    },
  };
  for (const [, path, external] of imports) {
    if (external !== true) {
      inputs[path] = { bytes: 1, imports: [] };
    }
  }
  return { inputs, outputs: {} };
}

const scanSynthetic = (...imports: Edge[]): string[] =>
  [
    ...new Set(scanMetafile(synthetic(...imports), SYNTHETIC_ENTRY, REPO_ROOT).map((v) => v.rule)),
  ].toSorted(compare);

/** At least one positive example per rule, including the ones a real build cannot show cheaply. */
const POSITIVE: readonly (readonly [rule: string, edge: Edge])[] = [
  ["node:", ["node:url", "node:url"]],
  ["node:", ["path", "node:path"]],
  ["bun", ["bun:sqlite", "bun:sqlite", true]],
  [
    "@vue/reactivity",
    ["@vue/reactivity", "node_modules/@vue/reactivity/dist/reactivity.esm-bundler.js"],
  ],
  ["ajv", ["ajv/dist/2020.js", "node_modules/ajv/dist/2020.js"]],
  ["ajv", ["ajv-formats", "node_modules/ajv-formats/dist/index.js"]],
  ["yjs", ["yjs", "node_modules/yjs/dist/yjs.mjs"]],
  [
    "@modelcontextprotocol",
    [
      "@modelcontextprotocol/sdk/server/mcp.js",
      "node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js",
    ],
  ],
  ["zod", ["zod", "node_modules/zod/index.js"]],
  ["packages/studio", ["@jxsuite/studio", "packages/studio/src/studio.ts"]],
  ["packages/runtime", ["@jxsuite/runtime", "packages/runtime/src/runtime.ts"]],
  ["packages/ui", ["@jxsuite/ui/button", "packages/ui/src/button.ts"]],
  ["@jxsuite/schema root", ["@jxsuite/schema", "packages/schema/src/schema.ts"]],
  [
    "validate-project",
    ["@jxsuite/schema/validate-project", "packages/schema/src/validate-project.ts"],
  ],
  [
    "project-schemas",
    ["@jxsuite/schema/project-schemas", "packages/schema/src/project-schemas.ts"],
  ],
  [EXTERNAL_RULE, ["fs", "fs", true]],
];

/** Neighbours of forbidden modules that must NOT trip anything. */
const NEGATIVE: readonly Edge[] = [
  ["@jxsuite/protocol/problems", "packages/protocol/src/problems.ts"],
  ["@jxsuite/schema/types", "packages/schema/types.ts"],
  ["@jxsuite/schema/doc-ops", "packages/schema/src/doc-ops.ts"],
  ["@vue/shared", "node_modules/@vue/shared/dist/shared.esm-bundler.js"],
  ["node-fetch", "node_modules/node-fetch/src/index.js"],
  ["bunyan", "node_modules/bunyan/lib/bunyan.js"],
  ["zodiac", "node_modules/zodiac/index.js"],
  ["ajvish", "node_modules/ajvish/index.js"],
  ["./uikit", "packages/uikit/src/index.ts"],
  ["./runtime-helpers", "packages/ai/src/runtime-helpers.ts"],
];

describe("every forbidden rule fires", () => {
  it("has a positive example for every rule", () => {
    const covered = [...new Set(POSITIVE.map(([rule]) => rule))].toSorted(compare);
    expect(covered).toEqual([...FORBIDDEN.map((r) => r.id), EXTERNAL_RULE].toSorted(compare));
  });

  for (const [rule, edge] of POSITIVE) {
    it(`${rule} names ${edge[0]} -> ${edge[1]}`, () => {
      expect(scanSynthetic(edge)).toContain(rule);
    });
  }

  for (const edge of NEGATIVE) {
    it(`nothing names ${edge[0]} -> ${edge[1]}`, () => {
      expect(scanSynthetic(edge)).toEqual([]);
    });
  }

  it("matches a module by its path alone (a relative import into packages/studio)", () => {
    expect(scanSynthetic(["../../studio/src/state.ts", "packages/studio/src/state.ts"])).toEqual([
      "packages/studio",
    ]);
  });

  it("matches a module by its specifier alone (a forbidden package marked external)", () => {
    expect(scanSynthetic(["@vue/reactivity", "@vue/reactivity", true])).toEqual([
      "@vue/reactivity",
      EXTERNAL_RULE,
    ]);
  });

  it("matches a published @jxsuite/schema shadowing the workspace", () => {
    expect(
      scanSynthetic(["@jxsuite/schema", "node_modules/@jxsuite/schema/src/schema.ts"]),
    ).toEqual(["@jxsuite/schema root"]);
  });

  it("reports the chain from the entry, through the importer, to an external", () => {
    const meta: BuildMetafile = {
      inputs: {
        [SYNTHETIC_ENTRY]: {
          bytes: 1,
          imports: [
            { path: "packages/ai/src/mid.ts", kind: "import-statement", original: "./mid.ts" },
          ],
        },
        "packages/ai/src/mid.ts": {
          bytes: 1,
          imports: [{ path: "fs", kind: "import-statement", external: true }],
        },
      },
      outputs: {},
    };
    expect(describeViolations(scanMetafile(meta, SYNTHETIC_ENTRY, REPO_ROOT))).toEqual([
      "[external] fs  (packages/ai/src/entry.ts -> packages/ai/src/mid.ts -> fs)",
    ]);
  });
});

/**
 * Real builds of in-memory canaries: proof that the rules match what Bun actually RECORDS, which is
 * not always what was written (bare `path` resolves to a `node:path` module; `fs` becomes an
 * external). Only dependencies certain to be installed are used: builtins, the reactivity package
 * this package itself depends on, and the @jxsuite/schema workspace that @jxsuite/protocol already
 * depends on.
 */
const CANARIES: readonly (readonly [trips: string, source: string])[] = [
  ["node:", `import { parse } from "node:url";\nexport const x = parse;\n`],
  ["node:", `import { join } from "path";\nexport const x = join;\n`],
  [EXTERNAL_RULE, `import { readFileSync } from "fs";\nexport const x = readFileSync;\n`],
  ["@vue/reactivity", `import { reactive } from "@vue/reactivity";\nexport const x = reactive;\n`],
  [
    "@jxsuite/schema root",
    `import * as schema from "@jxsuite/schema";\nexport const x = schema;\n`,
  ],
  ["ajv", `import * as schema from "@jxsuite/schema";\nexport const x = schema;\n`],
  [
    "project-schemas",
    `import * as ps from "@jxsuite/schema/project-schemas";\nexport const x = ps;\n`,
  ],
];

describe("canary builds trip the gate", () => {
  for (const [trips, source] of CANARIES) {
    it(`${trips} <- ${source.split("\n")[0] ?? ""}`, async () => {
      const graph = await bundleForWorker(CANARY_ENTRY, source);
      expect(graph.logs).toEqual([]);
      expect(graph.ok).toBe(true);
      expect(rulesOf(graph)).toContain(trips);
    });
  }

  it("a Bun builtin fails the browser build outright", async () => {
    const graph = await bundleForWorker(
      CANARY_ENTRY,
      `import { file } from "bun";\nexport const x = file;\n`,
    );
    expect(graph.ok).toBe(false);
    expect(graph.logs.join("\n")).toContain(`"bun"`);
  });

  it("validate-project is not Worker-safe (today its node:url import fails the build)", async () => {
    const graph = await bundleForWorker(
      CANARY_ENTRY,
      `import * as vp from "@jxsuite/schema/validate-project";\nexport const x = vp;\n`,
    );
    /* Either verdict keeps it out of a Worker. Today Bun's node:url polyfill lacks fileURLToPath, so
       the build fails; a Bun whose polyfill grew it would build, and the rule would name it. */
    const verdict = graph.ok ? rulesOf(graph).join(" ") : graph.logs.join("\n");
    expect(verdict).toMatch(graph.ok ? /\bvalidate-project\b/ : /node:url/);
  });

  it("a host global is caught in the bundled text, and prose is not", async () => {
    const graph = await bundleForWorker(
      CANARY_ENTRY,
      [
        `export const env = process.env.JX_KEY;`,
        `export const bytes = Buffer.from("x");`,
        `export const blob = Bun.file("x");`,
        `export const prose = "could not process the reply; no Buffer or Bun here";`,
      ].join("\n"),
    );
    expect(graph.ok).toBe(true);
    expect(hostGlobalsIn(graph.code)).toEqual(["process", "Buffer", "Bun"]);
    expect(hostGlobalsIn(`export const prose = "could not process the reply";`)).toEqual([]);
  });

  it("a clean canary passes, so the canaries above are not tripping on the harness", async () => {
    const graph = await bundleForWorker(
      CANARY_ENTRY,
      `export { createToolRegistry } from "./tools.ts";\nexport { STREAM_EVENT_TYPES } from "./streaming-client.ts";\n`,
    );
    expect(graph.ok).toBe(true);
    expect(describeViolations(graph.violations)).toEqual([]);
    expect(graph.modules).toEqual([
      "packages/ai/src/__worker_gate_canary__.ts",
      "packages/ai/src/streaming-client.ts",
      "packages/ai/src/tools.ts",
    ]);
  });
});

// ─── The typecheck half ──────────────────────────────────────────────────────

describe("tsconfig.worker.json", () => {
  const config = JSON.parse(readFileSync(pkgFile("tsconfig.worker.json"), "utf8")) as {
    compilerOptions: Record<string, unknown>;
    include: string[];
  };

  it("includes exactly the Worker-safe entry files", () => {
    const entries = Object.values(WORKER_SAFE_ENTRIES).map((file) => file.replace(/^\.\//, ""));
    expect([...config.include].toSorted(compare)).toEqual(entries.toSorted(compare));
  });

  it("compiles with a Worker's globals and nothing else", () => {
    expect(config.compilerOptions).toMatchObject({
      lib: ["ES2023"],
      types: ["@cloudflare/workers-types"],
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
    });
  });

  it("names ambient types that resolve from this package", () => {
    expect(() => Bun.resolveSync("@cloudflare/workers-types/index.d.ts", PKG_DIR)).not.toThrow();
  });
});
