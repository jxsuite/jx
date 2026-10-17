/**
 * The project cache behind `/__jx_resolve__` and every project file the servers serve.
 *
 * Two properties, each of which kept the canvas from registering a large project's components on a
 * cold open: concurrent requests share ONE load, and serving a file never loads the extension
 * sections (a content section parses every entry of every collection).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type { ProjectConfig } from "@jxsuite/schema/types";

/** What the mocks saw: section loads and the `lazy` each asked for, registries, completions. */
interface Calls {
  completed: number;
  lazy: (boolean | undefined)[];
  registry: number;
  sections: number;
}
const calls: Calls = { completed: 0, lazy: [], registry: 0, sections: 0 };
let failSections = false;

void mock.module("@jxsuite/compiler/project-sections", () => ({
  loadProjectSections: async (
    _root: string,
    config: ProjectConfig,
    _registry: ExtensionRegistry,
    options: { lazy?: boolean } = {},
  ) => {
    calls.sections += 1;
    calls.lazy.push(options.lazy);
    await Promise.resolve();
    if (failSections) {
      throw new Error("sections failed");
    }
    /* A section that loads on demand, as the parser's content store does: `complete` is what a
       host calls before handing `_project` to a class that reads it synchronously. */
    const onDemand = {
      complete: async () => {
        calls.completed += 1;
        await Promise.resolve();
      },
    };
    return { content: { name: config.name ?? null }, onDemand, plain: "not completable" };
  },
}));

const realFormatHost = await import("@jxsuite/compiler/format-host");
const realBuildRegistry = realFormatHost.buildProjectExtensionRegistry;

void mock.module("@jxsuite/compiler/format-host", () => ({
  ...realFormatHost,
  buildProjectExtensionRegistry: (...args: Parameters<typeof realBuildRegistry>) => {
    calls.registry += 1;
    return realBuildRegistry(...args);
  },
}));

const { handleResolve, projectAssetMounts, projectSiteBase } = await import("../src/resolve");

const FIXTURES = resolve(import.meta.dir, "_project_entry_cache_fixtures");

/** A class whose `resolve()` reports the `_project` it was constructed with. */
const probeClass = {
  $defs: {
    fields: {
      _project: { access: "public", identifier: "_project", role: "field", scope: "instance" },
    },
    methods: {
      resolve: {
        body: "return { hasProject: Boolean(this._project), name: this._project?.content?.name ?? null };",
        identifier: "resolve",
        role: "method",
      },
    },
  },
  $prototype: "Class",
  title: "Probe",
};

let fixture = 0;

/** A fresh project directory, so each test starts on a cold cache. */
function project(config: ProjectConfig): string {
  fixture += 1;
  const root = join(FIXTURES, `p${fixture}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "project.json"), JSON.stringify(config));
  writeFileSync(join(root, "Probe.class.json"), JSON.stringify(probeClass));
  return root;
}

/** What the probe class reports: whether it got a `_project`, and the section's marker. */
interface ProbeResult {
  hasProject: boolean;
  name: string | null;
}

/** Resolve the probe class in `root` through `/__jx_resolve__`. */
async function probe(root: string): Promise<ProbeResult> {
  const res = await handleResolve(
    new Request("http://localhost/__jx_resolve__", {
      body: JSON.stringify({ $prototype: "Probe", $src: "./Probe.class.json" }),
      method: "POST",
    }),
    root,
  );
  /* SAFETY: the probe class's `resolve()` returns exactly this shape, and the proxy answers it as
     JSON; a failed resolve is a non-2xx body the equality assertions then reject. */
  return (await res.json()) as ProbeResult;
}

beforeAll(() => {
  rmSync(FIXTURES, { force: true, recursive: true });
});
afterAll(() => {
  rmSync(FIXTURES, { force: true, recursive: true });
});
beforeEach(() => {
  calls.completed = 0;
  calls.lazy = [];
  calls.registry = 0;
  calls.sections = 0;
  failSections = false;
});

describe("project entry cache", () => {
  test("concurrent cold requests share one load and never load the sections", async () => {
    const root = project({ name: "shared" });
    const results = await Promise.all(Array.from({ length: 25 }, () => projectAssetMounts(root)));
    expect(results).toHaveLength(25);
    expect(new Set(results).size).toBe(1);
    expect(calls.registry).toBe(1);
    expect(calls.sections).toBe(0);
  });

  test("the site base reads the config without loading the sections", async () => {
    const root = project({ name: "based", url: "https://example.com/docs/" });
    expect(await projectSiteBase(root)).toBe("/docs");
    expect(calls.sections).toBe(0);
  });

  test("a class gets the sections, loaded once for every request that asks", async () => {
    const root = project({ name: "ctx" });
    const values = await Promise.all([probe(root), probe(root), probe(root)]);
    const expected = { hasProject: true, name: "ctx" };
    expect(values).toEqual([expected, expected, expected]);
    expect(calls.sections).toBe(1);
    expect(calls.registry).toBe(1);
  });

  test("a failed section load answers no context and is retried by the next request", async () => {
    const root = project({ name: "retry" });
    failSections = true;
    expect(await probe(root)).toEqual({ hasProject: false, name: null });
    failSections = false;
    expect(await probe(root)).toEqual({ hasProject: true, name: "retry" });
    expect(calls.sections).toBe(2);
  });

  test("a project.json change starts a new generation", async () => {
    const root = project({ name: "before" });
    await probe(root);
    writeFileSync(join(root, "project.json"), JSON.stringify({ name: "after" }));
    const later = new Date(Date.now() + 5000);
    utimesSync(join(root, "project.json"), later, later);
    expect(await probe(root)).toEqual({ hasProject: true, name: "after" });
    expect(calls.registry).toBe(2);
    expect(calls.sections).toBe(2);
  });

  test("an unreadable project.json is no project", async () => {
    const root = project({ name: "x" });
    writeFileSync(join(root, "project.json"), "{broken");
    expect(await projectAssetMounts(root)).toEqual([]);
    expect(await probe(root)).toEqual({ hasProject: false, name: null });
  });

  test("a directory without project.json is no project", async () => {
    const root = join(FIXTURES, "bare");
    mkdirSync(root, { recursive: true });
    expect(await projectAssetMounts(root)).toEqual([]);
    expect(await projectSiteBase(root)).toBe("");
  });
});

/** A `.class.json` whose `$implementation` reports whether its sections were completed first. */
function implementedClass(root: string, title: string, onDemand: boolean): void {
  writeFileSync(
    join(root, `${title}.js`),
    `export class ${title} {
  ${onDemand ? "static projectOnDemand = true;" : ""}
  constructor(config) { this.config = config; }
  resolve() { return { name: this.config._project?.content?.name ?? null }; }
}
`,
  );
  writeFileSync(
    join(root, `${title}.class.json`),
    JSON.stringify({ $implementation: `./${title}.js`, $prototype: "Class", title }),
  );
}

/** What both fixture classes resolve to: the content section's marker. */
interface NameResult {
  name: string | null;
}

async function resolveClass(root: string, title: string): Promise<NameResult> {
  const res = await handleResolve(
    new Request("http://localhost/__jx_resolve__", {
      body: JSON.stringify({ $prototype: title, $src: `./${title}.class.json` }),
      method: "POST",
    }),
    root,
  );
  /* SAFETY: both fixture classes resolve to `{ name }`; a failed resolve is a non-2xx body the
     assertions then reject. */
  return (await res.json()) as NameResult;
}

describe("sections loaded on demand", () => {
  test("the server asks for them on demand", async () => {
    const root = project({ name: "lazy" });
    await probe(root);
    expect(calls.lazy).toEqual([true]);
  });

  test("a class that reads them synchronously gets them completed first", async () => {
    const root = project({ name: "sync" });
    implementedClass(root, "Sync", false);
    expect(await resolveClass(root, "Sync")).toEqual({ name: "sync" });
    expect(calls.completed).toBe(1);
  });

  test("a self-contained class gets them completed too: its bodies cannot await", async () => {
    const root = project({ name: "self" });
    await probe(root);
    expect(calls.completed).toBe(1);
  });

  test("a class that declares projectOnDemand gets them as they are", async () => {
    const root = project({ name: "lazy-class" });
    implementedClass(root, "OnDemand", true);
    expect(await resolveClass(root, "OnDemand")).toEqual({ name: "lazy-class" });
    expect(calls.completed).toBe(0);
  });
});
