/**
 * Handing `.jxn` files to TypeScript's language server (`spec.md` §23.3): what the TypeScript
 * extension is told, and that it is told once, whenever it turns up.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";

import type { ContentMapperContribution } from "../src/content-mapper";

import { fakeVscode } from "./_fake-vscode";

const fake = fakeVscode();
void mock.module("vscode", () => fake.module);

const { Uri } = await import("vscode");
const {
  CONTRIBUTOR_ID,
  TYPESCRIPT_EXTENSION_ID,
  mapperCommand,
  mapperContribution,
  registerContentMapper,
} = await import("../src/content-mapper");

const HERE = "/extensions/jx-vscode";

/** One call of the TypeScript extension's `registerContentMappers`. */
interface Registered {
  contributions: readonly ContentMapperContribution[];
  contributor: string;
  disposed: boolean;
}

/** A TypeScript extension that has content mappers, and what it was told. */
function typescriptApi(registered: Registered[]) {
  return {
    registerContentMappers: (
      contributor: string,
      contributions: readonly ContentMapperContribution[],
    ) => {
      const record: Registered = { contributions, contributor, disposed: false };
      registered.push(record);
      return {
        dispose: () => {
          record.disposed = true;
        },
      };
    },
  };
}

/** Let what was started without being waited for run to its end. */
async function settled(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Install a TypeScript extension that exports what `exports` returns. */
function install(exports?: () => Promise<object>) {
  return fake.install(TYPESCRIPT_EXTENSION_ID, exports);
}

beforeEach(() => {
  fake.reset();
});

describe("the command that starts the mapper", () => {
  test("is the editor's own binary where the extension host runs it as Node", () => {
    const runtime = { env: { ELECTRON_RUN_AS_NODE: "1" }, execPath: "/opt/code/code" };
    expect(mapperCommand(HERE, runtime)).toEqual([
      "/opt/code/code",
      join(HERE, "dist", "mapper.mjs"),
    ]);
  });

  test("is `node` anywhere else, as a project's own copy is started", () => {
    expect(mapperCommand(HERE, { env: {}, execPath: "/usr/bin/bun" })).toEqual([
      "node",
      join(HERE, "dist", "mapper.mjs"),
    ]);
  });
});

describe("what the TypeScript extension is told", () => {
  test("is that .jxn files are its to read, and the mapper for one no tsconfig reads", () => {
    const runtime = { env: {}, execPath: "/usr/bin/node" };
    expect(mapperContribution(HERE, runtime)).toEqual({
      extensions: [".jxn"],
      inferredProjectContribution: {
        manifest: {
          cwd: Uri.file(HERE),
          // The mapper answers with an identity of its own, which this says it will.
          dynamicConfig: true,
          exec: ["node", join(HERE, "dist", "mapper.mjs")],
          name: "@jxsuite/content-mapper",
        },
      },
    });
  });
});

describe("registering", () => {
  test("activates the TypeScript extension, which a .jxn file alone does not", async () => {
    const registered: Registered[] = [];
    const typescript = install(() => Promise.resolve(typescriptApi(registered)));
    const reports: string[] = [];
    registerContentMapper(HERE, (message) => reports.push(message));
    await settled();

    expect(typescript.activations).toBe(1);
    expect(registered).toEqual([
      { contributions: [mapperContribution(HERE)], contributor: CONTRIBUTOR_ID, disposed: false },
    ]);
    expect(reports).toEqual([]);
  });

  test("waits for a TypeScript extension that is not there yet, and asks it once", async () => {
    const registered: Registered[] = [];
    registerContentMapper(HERE, () => {});
    await settled();
    expect(registered).toEqual([]);

    // Installed, enabled, or given the trust it will not run without.
    const typescript = install(() => Promise.resolve(typescriptApi(registered)));
    fake.changed();
    fake.changed();
    await settled();

    expect(typescript.activations).toBe(1);
    expect(registered).toHaveLength(1);
  });

  test("says so where the TypeScript extension has no content mappers", async () => {
    const reports: string[] = [];
    install(() => Promise.resolve({}));
    registerContentMapper(HERE, (message) => reports.push(message));
    await settled();
    expect(reports).toEqual([
      "The TypeScript extension has no content mappers: .jxn files are not type checked.",
    ]);
  });

  test("says so where the TypeScript extension exports nothing at all", async () => {
    const reports: string[] = [];
    // Its own switch for programs like a mapper is off, and then it has no API to give.
    install();
    registerContentMapper(HERE, (message) => reports.push(message));
    await settled();
    expect(reports).toHaveLength(1);
  });

  test("says why where the TypeScript extension does not start", async () => {
    const reports: string[] = [];
    install(() => Promise.reject(new Error("no server")));
    registerContentMapper(HERE, (message) => reports.push(message));
    await settled();
    expect(reports).toEqual([
      "The TypeScript extension did not take the .jxn content mapper: Error: no server",
    ]);
  });

  test("says why where the TypeScript extension refuses the mapper", async () => {
    const reports: string[] = [];
    install(() =>
      Promise.resolve({
        registerContentMappers: () => {
          throw new Error("already registered");
        },
      }),
    );
    registerContentMapper(HERE, (message) => reports.push(message));
    await settled();
    expect(reports).toEqual([
      "The TypeScript extension did not take the .jxn content mapper: Error: already registered",
    ]);
  });
});

describe("stopping", () => {
  test("takes the registration away, and stops waiting", async () => {
    const registered: Registered[] = [];
    install(() => Promise.resolve(typescriptApi(registered)));
    const registration = registerContentMapper(HERE, () => {});
    await settled();
    expect(fake.watchers()).toBe(1);

    registration.dispose();
    expect(registered[0]?.disposed).toBe(true);
    expect(fake.watchers()).toBe(0);
  });

  test("before the TypeScript extension has started registers nothing afterwards", async () => {
    const registered: Registered[] = [];
    install(() => Promise.resolve(typescriptApi(registered)));
    const registration = registerContentMapper(HERE, () => {});
    registration.dispose();
    await settled();
    expect(registered).toEqual([]);
    expect(fake.watchers()).toBe(0);
  });
});
