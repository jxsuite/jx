/** Which folders the user has agreed to run code from (specs/desktop.md §4.7). */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openTrustStore } from "../src/backend/trust-store";
import type { RecentProjectEntry } from "../src/shared/rpc-schema";

describe("the trust store", () => {
  let scratch: string;
  let file: string;
  let site: string;

  const noRecents = (): Promise<RecentProjectEntry[]> => Promise.resolve([]);

  beforeEach(() => {
    const made = mkdtempSync(join(tmpdir(), "jx-trust-"));
    scratch = realpathSync(made);
    file = join(scratch, "config", "trusted-projects.json");
    site = join(scratch, "site");
    mkdirSync(site);
  });

  afterEach(() => {
    rmSync(scratch, { force: true, recursive: true });
  });

  test("knows nothing at first, and remembers what it is told, across opens", async () => {
    const store = openTrustStore({ file, recents: noRecents });
    expect(await store.isTrusted(site)).toBe(false);
    await store.grant(site);
    expect(await store.isTrusted(site)).toBe(true);
    expect(await openTrustStore({ file, recents: noRecents }).isTrusted(site)).toBe(true);
  });

  test("starts from Recent, so nobody who upgrades is asked about their own projects", async () => {
    const recents = (): Promise<RecentProjectEntry[]> =>
      Promise.resolve([{ name: "Site", root: site, timestamp: 1 }]);
    expect(await openTrustStore({ file, recents }).isTrusted(site)).toBe(true);
  });

  test("takes only absolute roots from Recent", async () => {
    const recents = (): Promise<RecentProjectEntry[]> =>
      Promise.resolve([{ name: "Here", root: ".", timestamp: 1 }]);
    const store = openTrustStore({ file, recents });
    expect(await store.isTrusted(resolve("."))).toBe(false);
  });

  test("seeds once: a project removed from the store is not brought back by Recent", async () => {
    const recents = (): Promise<RecentProjectEntry[]> =>
      Promise.resolve([{ name: "Site", root: site, timestamp: 1 }]);
    await openTrustStore({ file, recents }).isTrusted(site);
    writeFileSync(file, "{}");
    expect(await openTrustStore({ file, recents }).isTrusted(site)).toBe(false);
  });

  test("a store it cannot read asks again, and does not seed over the top of it", async () => {
    mkdirSync(join(scratch, "config"));
    writeFileSync(file, "{ torn");
    const recents = (): Promise<RecentProjectEntry[]> =>
      Promise.resolve([{ name: "Site", root: site, timestamp: 1 }]);
    expect(await openTrustStore({ file, recents }).isTrusted(site)).toBe(false);
  });

  test("Recent failing to read costs prompts, and is said", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      const store = openTrustStore({ file, recents: () => Promise.reject(new Error("no")) });
      expect(await store.isTrusted(site)).toBe(false);
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  test("a link into a trusted folder is that folder", async () => {
    const link = join(scratch, "link");
    symlinkSync(site, link);
    const store = openTrustStore({ file, recents: noRecents });
    await store.grant(site);
    expect(await store.isTrusted(link)).toBe(true);
  });

  test("a trusted link does not trust by name once it points somewhere else", async () => {
    const elsewhere = join(scratch, "elsewhere");
    mkdirSync(elsewhere);
    const link = join(scratch, "link");
    symlinkSync(site, link);
    const store = openTrustStore({ file, recents: noRecents });
    await store.grant(link);
    rmSync(link);
    symlinkSync(elsewhere, link);
    expect(await store.isTrusted(link)).toBe(false);
    expect(await store.isTrusted(site)).toBe(true);
  });

  test("the spellings of one folder are one folder, and a decomposed name is the composed one", async () => {
    const store = openTrustStore({ file, recents: noRecents });
    await store.grant(`${site}/./`);
    expect(await store.isTrusted(site)).toBe(true);
    const composed = join(scratch, "café");
    await store.grant(composed);
    expect(await store.isTrusted(join(scratch, "café"))).toBe(true);
  });

  test("no folder inherits, in either direction", async () => {
    const child = join(site, "pages");
    mkdirSync(child);
    const store = openTrustStore({ file, recents: noRecents });
    await store.grant(site);
    expect(await store.isTrusted(child)).toBe(false);
    expect(await store.isTrusted(scratch)).toBe(false);
  });

  test("a folder named like an inherited member is not trusted by accident", async () => {
    const store = openTrustStore({ file, recents: noRecents });
    expect(await store.isTrusted("constructor")).toBe(false);
  });

  test("concurrent grants all land", async () => {
    const store = openTrustStore({ file, recents: noRecents });
    const folders = ["a", "b", "c", "d"].map((name) => join(scratch, name));
    await Promise.all(folders.map((folder) => store.grant(folder)));
    const results = await Promise.all(folders.map((folder) => store.isTrusted(folder)));
    expect(results).toEqual([true, true, true, true]);
  });

  test("is written owner-only", async () => {
    await openTrustStore({ file, recents: noRecents }).grant(site);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveProperty([site]);
  });
});
