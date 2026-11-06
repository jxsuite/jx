/**
 * What installing Jx Studio may do to the types a machine already opens (specs/desktop.md §7.4),
 * read from the files electron-builder reads. Only a release runs an installer, so these are the
 * properties a careless edit would otherwise break on someone else's computer.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const desktopDir = resolve(import.meta.dir, "..");
const read = (relative: string): string => readFileSync(resolve(desktopDir, relative), "utf8");

const builder = read("electron-builder.yml");
const installer = read("build-resources/installer.nsh");

/** One top-level block of electron-builder.yml, with its indented body. */
function block(name: string): string {
  return new RegExp(`^${name}:\\n((?:(?:  .*)?\\n)+)`, "m").exec(builder)?.[1] ?? "";
}

/** A macro's body from the installer script. */
function macro(name: string): string {
  return new RegExp(`!macro ${name}\\b[^\\n]*\\n([\\s\\S]*?)!macroend`).exec(installer)?.[1] ?? "";
}

describe("electron-builder.yml", () => {
  test("declares no top-level fileAssociations, which on Windows would take over the type", () => {
    expect(builder).not.toMatch(/^fileAssociations:/m);
    expect(block("win")).not.toContain("fileAssociations");
    expect(block("nsis")).not.toContain("fileAssociations");
  });

  test("offers macOS an alternate handler for JSON, not the default one", () => {
    const mac = block("mac");
    expect(mac).toContain("LSHandlerRank: Alternate");
    expect(mac).toContain("- public.json");
    expect(mac).not.toContain("LSHandlerRank: Owner");
    expect(mac).not.toContain("LSHandlerRank: Default");
  });

  test("leaves extendInfo to the mac block, because the mas block's would be ignored", () => {
    expect(block("mas")).not.toContain("extendInfo");
  });

  test("hands the installer the script this suite reads", () => {
    expect(block("nsis")).toContain("include: build-resources/installer.nsh");
  });

  test("points the Store package at a file that exists from the app directory", () => {
    const path = /customExtensionsPath: (.+)/.exec(block("appx"))?.[1];
    expect(path).toBeDefined();
    /* Electron-builder resolves this against `directories.app`. A wrong path fails the release
       lane's build, which is loud but late, so it is checked here. */
    expect(existsSync(resolve(desktopDir, "build/app", path ?? ""))).toBe(true);
  });

  test("declares the Store association for JSON and nothing else", () => {
    const xml = read("build-resources/msix-json-association.xml");
    expect([...xml.matchAll(/<uap:FileType>([^<]+)</g)].map((match) => match[1])).toEqual([
      ".json",
    ]);
  });
});

describe("the installer script", () => {
  const install = macro("customInstall");
  const forget = macro("jxForgetJsonClaim");

  test("never writes the class of .json", () => {
    const writes = [...installer.matchAll(/WriteReg\w+ \S+ "([^"]+)" "([^"]*)"/g)];
    expect(writes.length).toBeGreaterThan(0);
    for (const [, key, value] of writes) {
      expect(key === String.raw`Software\Classes\.json` && value === "").toBe(false);
    }
  });

  test("adds itself to Open With only", () => {
    expect(install).toContain(
      String.raw`WriteRegNone SHELL_CONTEXT "Software\Classes\.json\OpenWithProgids" "JxStudio.Json"`,
    );
  });

  test("takes back an earlier build's claim from both hives", () => {
    expect(install).toContain("!insertmacro jxForgetJsonClaim HKCU");
    expect(install).toContain("!insertmacro jxForgetJsonClaim HKLM");
  });

  test("removes the default only when it is still the name earlier builds wrote", () => {
    const lines = forget.split("\n").map((line) => line.trim());
    const compare = lines.indexOf('StrCmp $0 "Jx Project" 0 +2');
    expect(compare).toBeGreaterThan(-1);
    // `+2` skips exactly one instruction, so the delete must be the very next line.
    expect(lines[compare + 1]).toBe('DeleteRegValue ${HIVE} "Software\\Classes\\.json" ""');
    expect(lines.filter((line) => line.endsWith(String.raw`"Software\Classes\.json" ""`))).toHaveLength(2);
  });

  test("restores the register it borrows", () => {
    const body = install.split("\n").map((line) => line.trim());
    expect(body.indexOf("Push $0")).toBeLessThan(
      body.indexOf("!insertmacro jxForgetJsonClaim HKCU"),
    );
    expect(body.indexOf("Pop $0")).toBeGreaterThan(
      body.indexOf("!insertmacro jxForgetJsonClaim HKLM"),
    );
  });

  test("uninstalls what it added, and tells the shell both times", () => {
    const uninstall = macro("customUnInstall");
    expect(uninstall).toContain(String.raw`"Software\Classes\.json\OpenWithProgids" "JxStudio.Json"`);
    expect(uninstall).toContain(String.raw`DeleteRegKey SHELL_CONTEXT "Software\Classes\JxStudio.Json"`);
    for (const body of [install, uninstall]) {
      expect(body).toContain("shell32::SHChangeNotify");
    }
  });
});
