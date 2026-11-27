/**
 * The packaged layout's witness: the code services, bundled for Node as the backend is and run with
 * only what is staged beside the bundle. Sources that pass their tests say nothing about a bundle,
 * which finds the formatter's binding and oxlint's CLI by path.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BACKEND_CODE_TOOLS,
  BACKEND_EXTERNALS,
  napiTriple,
  stubPlugin,
} from "../scripts/lib/backend-bundle";

const CODE_API = resolve(import.meta.dir, "../../server/src/code-api.ts");

let root: string;
let backend: string;

/** Run the bundle with an empty PATH, no override and no install, and read what it printed. */
async function run(): Promise<{
  format: { code?: string } | null;
  lint: { diagnostics?: unknown[] };
  command: string[] | null;
}> {
  const proc = Bun.spawn([process.execPath, "--no-install", join(backend, "index.js")], {
    env: { PATH: "" },
    stderr: "pipe",
    stdout: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  // SAFETY: the entry below prints exactly this object.
  return JSON.parse(text) as Awaited<ReturnType<typeof run>>;
}

/** Stage the rows into the backend directory, without the ones `skip` names. */
function stage(skip: (to: string) => boolean): void {
  for (const { from, to } of BACKEND_CODE_TOOLS()) {
    if (!skip(to)) {
      const target = join(backend, to);
      mkdirSync(resolve(target, ".."), { recursive: true });
      Bun.spawnSync(["cp", "-R", resolve(import.meta.dir, "..", from), target]);
    }
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "jx-code-tools-bundle-"));
  backend = join(root, "backend");
  mkdirSync(backend);
  const entry = join(root, "entry.ts");
  writeFileSync(
    entry,
    `import { resolveOxlintCommand, runCodeService } from ${JSON.stringify(CODE_API)};
console.log(JSON.stringify({
  command: resolveOxlintCommand(),
  format: await runCodeService("format", { code: "const  a  =  1" }),
  lint: await runCodeService("lint", { code: "debugger;" }),
}));
`,
  );
  const result = await Bun.build({
    entrypoints: [entry],
    external: [...BACKEND_EXTERNALS],
    format: "esm",
    naming: "index.js",
    outdir: backend,
    plugins: [stubPlugin],
    target: "node",
  });
  expect(result.success).toBe(true);
  writeFileSync(join(backend, "package.json"), '{"type":"module"}');
}, 60_000);

afterAll(() => rmSync(root, { force: true, recursive: true }));

describe("the code services from the packaged layout", () => {
  test("format and lint load from what is staged beside the bundle", async () => {
    stage(() => false);
    const out = await run();
    expect(out.format?.code).toBe("const a = 1;");
    expect(JSON.stringify(out.lint)).toContain("no-debugger");
    expect(out.command?.[1]).toStartWith(join(backend, "oxlint"));
  }, 60_000);

  test("without the formatter's binding, format answers null and lint still works", async () => {
    rmSync(join(backend, `oxfmt.${napiTriple(process.platform, process.arch)}.node`));
    const out = await run();
    expect(out.format).toBeNull();
    expect(JSON.stringify(out.lint)).toContain("no-debugger");
  }, 60_000);
});
