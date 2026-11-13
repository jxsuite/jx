/**
 * The conformance harness's command line (scripts/conformance/README.md).
 *
 *     bun run conformance capture <dir> [--tree <repo root>] [--only a,b] [--max-routes N]
 *     bun run conformance compare <baseline dir> <candidate dir> [--pixel-tolerance 0.001]
 *                                 [--channel-tolerance 8] [--json]
 *     bun run conformance self [--only a,b] [--max-routes N]
 *
 * `capture` builds every project of a tree with THAT tree's compiler and records what a browser
 * sees. `compare` reads two captures and exits 1 when they differ. `self` captures this tree twice
 * and compares exactly, which is the harness proving itself: a difference there is the harness or
 * the build being nondeterministic, and nothing it says about two compilers can be trusted until it
 * is zero.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser } from "puppeteer-core";
import { launchBrowser } from "../screenshots/lib/browser.ts";
import { BUILD_RECORD, compareCaptures, EXACT, report } from "./compare.ts";
import { corpus, leaveAsFound, routesOf, sample, selectProjects, slugOf } from "./corpus.ts";
import { observe, VIEWPORTS } from "./observe.ts";
import type { Project } from "./corpus.ts";

const REPO = resolve(import.meta.dir, "../..");
/** Where `self` keeps its two captures. Gitignored with the rest of `.cache/`. */
const SELF_DIR = join(REPO, ".cache/conformance");

/** What a tree's compiler exports, as far as the harness calls it. */
interface Compiler {
  buildSite: (root: string, options: { clean: boolean }) => Promise<{ errors: readonly string[] }>;
}

function isCompiler(value: unknown): value is Compiler {
  return (
    typeof value === "object" &&
    value !== null &&
    "buildSite" in value &&
    typeof value.buildSite === "function"
  );
}

/** Load the compiler of a tree, which need not be the tree this script is in. */
async function compilerOf(tree: string): Promise<Compiler> {
  const loaded: unknown = await import(join(tree, "packages/compiler/src/site/site-build.ts"));
  if (!isCompiler(loaded)) {
    throw new TypeError(`${tree} has no compiler exporting buildSite`);
  }
  return loaded;
}

/** Serve a built site as the root of an origin, as a static host would. */
function serve(dist: string) {
  return Bun.serve({
    async fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      const candidates = path.endsWith("/")
        ? [join(dist, path, "index.html")]
        : [join(dist, path), join(dist, path, "index.html")];
      for (const candidate of candidates) {
        const file = Bun.file(candidate);
        // A directory "exists" and cannot be served; `size` is what tells a file from one.
        if ((await file.exists()) && file.size > 0) {
          return new Response(file);
        }
      }
      return new Response("Not Found", { status: 404 });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
}

/**
 * Run `task` over `items` with one worker per entry of `workers`, each taking the next item as it
 * finishes its last. A worker is handed to every task it runs, so a task never shares one.
 */
async function pooled<T, W>(
  items: readonly T[],
  workers: readonly W[],
  task: (item: T, worker: W) => Promise<void>,
) {
  let next = 0;
  const run = async (worker: W) => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) {
        await task(item, worker);
      }
    }
  };
  await Promise.all(workers.map(async (worker) => run(worker)));
}

interface CaptureOptions {
  tree: string;
  only: string;
  maxRoutes: number;
  concurrency: number;
}

async function captureProject(
  browsers: readonly Browser[],
  compiler: Compiler,
  project: Project,
  out: string,
  options: CaptureOptions,
): Promise<number> {
  const root = join(options.tree, project.dir);
  const restore = leaveAsFound(root);
  const built = await compiler.buildSite(root, { clean: true });
  const dist = join(root, "dist");
  const routes = sample(routesOf(dist), options.maxRoutes);
  const target = join(out, project.id);
  rmSync(target, { force: true, recursive: true });
  mkdirSync(target, { recursive: true });
  /* What the build said, with the tree's own path taken out so two trees can agree. A project
     that does not build cleanly is still captured: its errors are part of what a compiler does
     with it, and the pages it did write are observed like any others. */
  const errors = built.errors.map((error) => error.replaceAll(options.tree, "<tree>"));
  writeFileSync(join(target, BUILD_RECORD), `${JSON.stringify({ errors }, null, 1)}\n`);

  const server = serve(dist);
  const origin = `http://127.0.0.1:${server.port}`;
  const visits = routes.flatMap((route) => VIEWPORTS.map((viewport) => ({ route, viewport })));
  try {
    await pooled(visits, browsers, async ({ route, viewport }, browser) => {
      // A context of its own: nothing cached, stored or registered by an earlier visit.
      const context = await browser.createBrowserContext();
      try {
        const page = await context.newPage();
        const { observation, png } = await observe(page, origin, route, viewport);
        const name = `${slugOf(route)}.${viewport.name}`;
        writeFileSync(join(target, `${name}.json`), `${JSON.stringify(observation, null, 1)}\n`);
        writeFileSync(join(target, `${name}.png`), png);
      } finally {
        await context.close();
      }
    });
  } finally {
    await server.stop(true);
    restore();
  }
  return visits.length;
}

async function capture(out: string, options: CaptureOptions): Promise<void> {
  const projects = selectProjects(corpus(options.tree), options.only);
  const compiler = await compilerOf(options.tree);
  // A capture is a whole statement about one tree: nothing from an earlier one may sit in it.
  rmSync(out, { force: true, recursive: true });
  // The accessibility tree is read over CDP; WebDriver BiDi has no equivalent yet.
  process.env.JX_SHOTS_PROTOCOL = "cdp";
  /* One browser PROCESS per worker, each with one page open at a time. Pages sharing a process
     share its raster and compositor threads, and six of them in one browser gave pictures that
     differed by a few dozen pixels between two captures of one build. */
  const browsers = await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, async () => launchBrowser()),
  );
  try {
    for (const project of projects) {
      const started = performance.now();
      const visits = await captureProject(browsers, compiler, project, out, options);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      console.log(`captured ${project.id}: ${visits} observation(s) in ${seconds}s`);
    }
  } finally {
    await Promise.all(browsers.map(async (browser) => browser.close()));
  }
}

function flag(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function captureOptions(args: readonly string[]): CaptureOptions {
  return {
    concurrency: Number(flag(args, "--concurrency") ?? 4),
    maxRoutes: Number(flag(args, "--max-routes") ?? 12),
    only: flag(args, "--only") ?? "",
    tree: resolve(flag(args, "--tree") ?? REPO),
  };
}

const USAGE = `usage:
  bun run conformance capture <dir> [--tree <repo root>] [--only a,b] [--max-routes N]
  bun run conformance compare <baseline> <candidate> [--pixel-tolerance R] [--channel-tolerance N] [--json]
  bun run conformance self [--only a,b] [--max-routes N]`;

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const [first, second] = args.filter((arg, index) => {
    const previous = args[index - 1];
    return !arg.startsWith("--") && !previous?.startsWith("--");
  });
  if (command === "capture" && first) {
    await capture(resolve(first), captureOptions(args));
  } else if (command === "compare" && first && second) {
    const findings = compareCaptures(resolve(first), resolve(second), {
      channelTolerance: Number(flag(args, "--channel-tolerance") ?? EXACT.channelTolerance),
      pixelTolerance: Number(flag(args, "--pixel-tolerance") ?? EXACT.pixelTolerance),
    });
    console.log(args.includes("--json") ? JSON.stringify(findings, null, 2) : report(findings));
    process.exit(findings.length > 0 ? 1 : 0);
  } else if (command === "self") {
    const options = captureOptions(args);
    const [a, b] = [join(SELF_DIR, "self-a"), join(SELF_DIR, "self-b")];
    await capture(a, options);
    await capture(b, options);
    const findings = compareCaptures(a, b);
    console.log(report(findings));
    process.exit(findings.length > 0 ? 1 : 0);
  } else {
    console.error(USAGE);
    process.exit(2);
  }
}
