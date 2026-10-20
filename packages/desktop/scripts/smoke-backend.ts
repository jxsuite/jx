/**
 * Start the backend the way the application does and exercise the RPCs that reach files and modules
 * a bundle can lose.
 *
 * A bundle is a different program from the sources it was made from. Inlined modules find their own
 * data and their dependencies by path (`import.meta.dirname`, `createRequire`), and none of those
 * paths survive bundling by accident: a data file nobody staged, a native module with no
 * `node_modules` to resolve from. Unit tests run the sources and cannot see any of it, and the
 * first person to see it was whoever opened the packaged app. So this starts what was PACKAGED,
 * with the Bun that ships beside it, through the same IPC the Electron main process uses, and asks
 * it to do the things that fail that way.
 *
 *     bun run smoke [--bun <bun>] [--backend <index.js>] [--studio <dir>] [--allow <rpc,rpc>]
 *
 * The defaults are the staged layout (`bun run stage`). `--backend src/hub/main.ts --bun "$(which
 * bun)"` runs the same checks against the sources, which is how to tell a bundling regression from
 * a bug. `--allow` names RPCs whose failure is already known and tracked, so CI stays green on them
 * without going blind to the rest.
 */
// oxlint-disable deslop/no-unknown-parameters, deslop/no-unknown-returns, deslop/no-runtime-typeof -- This script IS the I/O boundary: it sends arbitrary RPC params to the packaged backend and judges whatever comes back, so each verifier takes `unknown` and narrows it on purpose.
// oxlint-disable unicorn/no-process-exit -- a CLI whose exit code is its interface
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const desktopDir = resolve(import.meta.dir, "..");

/** The value of `--name <value>`, if given. */
function option(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

const bun = resolve(
  option("bun") ??
    join(desktopDir, "build/resources/bun", process.platform === "win32" ? "bun.exe" : "bun"),
);
const backend = resolve(option("backend") ?? join(desktopDir, "build/resources/backend/index.js"));
const studio = resolve(option("studio") ?? join(desktopDir, "build/resources/studio"));
const allowed = new Set((option("allow") ?? "").split(",").filter(Boolean));
const verbose = process.argv.includes("--verbose");

const scratch = mkdtempSync(join(tmpdir(), "jx-smoke-"));
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") {
    env[key] = value;
  }
}
env.JX_STUDIO_ASSETS = studio;

/** One message the backend sent, as far as this script reads it. */
interface Message {
  id?: number;
  partition?: string;
  type?: string;
  url?: string;
}

const messages: Message[] = [];
const waiters: (() => void)[] = [];
const child = Bun.spawn([bun, backend], {
  env,
  ipc: (message: Message) => {
    messages.push(message);
    for (const wake of waiters.splice(0)) {
      wake();
    }
  },
  serialization: "json",
  stderr: "inherit",
  stdout: "inherit",
});

/** Wait for the first message of `type` the backend has not been waited on for. */
async function next(type: string, timeoutMs = 30_000): Promise<Message> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const index = messages.findIndex((message) => message.type === type);
    if (index !== -1) {
      return messages.splice(index, 1)[0] ?? {};
    }
    if (Date.now() > deadline) {
      throw new Error(`The backend never sent "${type}".`);
    }
    await new Promise<void>((resolveWait) => {
      waiters.push(resolveWait);
      setTimeout(resolveWait, 250);
    });
  }
}

await next("ready");
child.send({ root: null, type: "open-project" });
const opened = await next("open-window");
const url = new URL(opened.url ?? "");
const socket = new WebSocket(`ws://${url.host}/?token=${url.searchParams.get("token")}`);
await new Promise<void>((resolveOpen, reject) => {
  socket.addEventListener("open", () => resolveOpen());
  socket.addEventListener("error", () => reject(new Error("The window's socket would not open.")));
});

const pending = new Map<number, (frame: { error?: string; result?: unknown }) => void>();
socket.addEventListener("message", (event) => {
  // SAFETY: the backend's own server answers with JSON frames of this shape.
  const frame = JSON.parse(String(event.data)) as { error?: string; id?: number; result?: unknown };
  if (frame.id !== undefined) {
    pending.get(frame.id)?.(frame);
  }
});

let nextId = 1;
/** Call an RPC; resolves the result, or rejects with the backend's error text. */
function call(method: string, params?: unknown, timeoutMs = 120_000): Promise<unknown> {
  const id = nextId;
  nextId += 1;
  return new Promise((resolveCall, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
    pending.set(id, (frame) => {
      clearTimeout(timer);
      if (frame.error === undefined) {
        resolveCall(frame.result);
      } else {
        reject(new Error(frame.error));
      }
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

/** A check: an RPC and what a working answer looks like. */
interface Check {
  name: string;
  params?: unknown;
  rpc: string;
  verify: (result: unknown) => string | null;
}

const isNonEmptyArray = (what: string) => (result: unknown) =>
  Array.isArray(result) && result.length > 0
    ? null
    : `expected a non-empty ${what}, got ${JSON.stringify(result).slice(0, 80)}`;
const isArray = (result: unknown) => (Array.isArray(result) ? null : "expected an array");
const isObject = (result: unknown) =>
  typeof result === "object" && result !== null ? null : "expected an object";

const projectParent = join(scratch, "projects");
const checks: Check[] = [
  { name: "appInfo", rpc: "appInfo", verify: isObject },
  { name: "listStarters", rpc: "listStarters", verify: isNonEmptyArray("starter list") },
  {
    name: "createProject",
    params: {
      destination: { kind: "path", parent: projectParent },
      directory: "smoke",
      name: "smoke",
    },
    rpc: "createProject",
    verify: isObject,
  },
  { name: "listExtensionCatalog", rpc: "listExtensionCatalog", verify: isNonEmptyArray("catalog") },
  { name: "listExtensions", rpc: "listExtensions", verify: isArray },
  { name: "fetchProjectSchemas", rpc: "fetchProjectSchemas", verify: isObject },
  { name: "listFormats", rpc: "listFormats", verify: isArray },
  {
    name: "listDirectory",
    params: { dir: "." },
    rpc: "listDirectory",
    verify: isNonEmptyArray("directory"),
  },
  {
    name: "readFile",
    params: { path: "project.json" },
    rpc: "readFile",
    verify: (result) =>
      typeof result === "string" && result.includes("smoke")
        ? null
        : "project.json is not the new project's",
  },
  { name: "discoverComponents", params: {}, rpc: "discoverComponents", verify: isArray },
  {
    name: "fetchPluginSchema",
    params: { src: "@jxsuite/parser/ContentCollection.class.json" },
    rpc: "fetchPluginSchema",
    verify: isObject,
  },
  {
    name: "buildSite",
    rpc: "buildSite",
    verify: (result) =>
      typeof result === "object" &&
      result !== null &&
      "routes" in result &&
      Number(result.routes) > 0
        ? null
        : `built no routes: ${JSON.stringify(result).slice(0, 120)}`,
  },
  {
    name: "previewSite",
    params: { route: "/" },
    rpc: "previewSite",
    verify: (result) =>
      typeof result === "object" &&
      result !== null &&
      "url" in result &&
      typeof result.url === "string"
        ? null
        : "no preview origin",
  },
];

let failed = 0;

/* The by-name resolution the compiler does from the backend's own directory: a directory the
   backend is in, with the bundled Bun, resolving what `BACKEND_MODULES` staged. */
for (const name of ["lit-html", "@vue/reactivity"]) {
  const probe = Bun.spawnSync(
    [
      bun,
      "-e",
      `console.log(Bun.resolveSync(${JSON.stringify(name)}, ${JSON.stringify(resolve(backend, ".."))}))`,
    ],
    { env, stderr: "pipe", stdout: "pipe" },
  );
  if (probe.exitCode === 0) {
    console.log(`  ok    ${name} resolves from the backend directory`);
  } else if (allowed.has(`resolve:${name}`)) {
    console.log(`  known ${name} does not resolve from the backend directory`);
  } else {
    console.log(`  FAIL  ${name} does not resolve from the backend directory`);
    failed += 1;
  }
}

for (const check of checks) {
  try {
    const result = await call(check.rpc, check.params);
    if (verbose) {
      console.log(`        ${check.name} ->`, JSON.stringify(result).slice(0, 400));
    }
    const problem = check.verify(result);
    if (problem === null) {
      console.log(`  ok    ${check.name}`);
    } else {
      throw new Error(problem);
    }
  } catch (error) {
    const known = allowed.has(check.name);
    console.log(
      `  ${known ? "known" : "FAIL "} ${check.name}: ${error instanceof Error ? error.message.split("\n")[0] : error}`,
    );
    if (!known) {
      failed += 1;
    }
  }
}

socket.close();
child.kill();
rmSync(scratch, { force: true, recursive: true });
console.log(failed === 0 ? "smoke: all checks passed" : `smoke: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
