/**
 * A store that appears between `migrateLegacyStore`'s existence check and its copy is not
 * overwritten by the legacy file.
 */
import { afterAll, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";

const HOME = fs.mkdtempSync(join(process.env.TMPDIR || "/tmp", "jx-migrate-race-"));
process.env.XDG_CONFIG_HOME = join(HOME, ".config");

void mock.module("node:os", () => {
  const homedir = () => HOME;
  const tmpdir = () => "/tmp";
  return { default: { homedir, tmpdir }, homedir, tmpdir };
});

let hideStore = "";
const realExists = fs.existsSync;
void mock.module("node:fs", () => ({
  ...fs,
  existsSync: (path: string) => (path === hideStore ? false : realExists(path)),
}));

const { configFile, migrateLegacyStore } = await import("../src/backend/user-config");

afterAll(() => {
  fs.rmSync(HOME, { force: true, recursive: true });
});

test("a store that appears between the check and the copy is not overwritten", async () => {
  const store = configFile("settings.json");
  fs.mkdirSync(join(store, ".."), { recursive: true });
  fs.writeFileSync(store, JSON.stringify({ patched: "yes" }));
  fs.mkdirSync(join(HOME, ".jx"), { recursive: true });
  fs.writeFileSync(join(HOME, ".jx", "settings.json"), JSON.stringify({ legacy: "yes" }));
  hideStore = store;
  await migrateLegacyStore("settings.json");
  expect(JSON.parse(fs.readFileSync(store, "utf8"))).toEqual({ patched: "yes" });
});
