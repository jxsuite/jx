/**
 * What installing Jx Studio may do to the types a machine already opens (specs/desktop.md §7.4),
 * and how each channel declares `.jxn`, the one type it owns (§7.8), read from the files
 * electron-builder reads. Only a release runs an installer, so these are the properties a careless
 * edit would otherwise break on someone else's computer.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const desktopDir = resolve(import.meta.dir, "..");
const read = (relative: string): string => readFileSync(resolve(desktopDir, relative), "utf8");

const builder = read("electron-builder.yml");

/** The parts of the config these tests read, as electron-builder reads them. */
interface BuilderConfig {
  fileAssociations?: unknown;
  linux: { fileAssociations: { ext: string; mimeType?: string; name: string }[] };
  mac: {
    extendInfo: {
      CFBundleDocumentTypes: {
        CFBundleTypeName: string;
        CFBundleTypeRole: string;
        LSHandlerRank: string;
        LSItemContentTypes: string[];
      }[];
      UTExportedTypeDeclarations: unknown;
    };
    fileAssociations?: unknown;
  };
  win: { fileAssociations: unknown };
}

// SAFETY: the committed config, whose shape the tests below assert key by key.
const config = Bun.YAML.parse(builder) as BuilderConfig;

/** The type every channel names `.jxn` by (specs/desktop.md §7.8). */
const MIME_TYPE = "text/x-jxn";
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
    expect(block("nsis")).not.toContain("fileAssociations");
    expect(config.fileAssociations).toBeUndefined();
  });

  test("associates Windows, and so the Store package, with .jxn and nothing else", () => {
    expect(config.win.fileAssociations).toEqual([
      // A class-shaped name, which the installer's APP_ASSOCIATE macro asks for.
      { description: "Jx file", ext: "jxn", name: "JxStudio.Document", role: "Editor" },
    ]);
  });

  test("offers macOS an alternate handler for JSON, and owns only its own type", () => {
    const types = config.mac.extendInfo.CFBundleDocumentTypes;
    expect(types.filter((type) => type.LSHandlerRank === "Owner")).toEqual([
      {
        CFBundleTypeName: "Jx file",
        CFBundleTypeRole: "Editor",
        LSHandlerRank: "Owner",
        LSItemContentTypes: ["com.jxsuite.jxn"],
      },
    ]);
    const others = types.filter((type) => type.LSHandlerRank !== "Owner");
    expect(others.map((type) => [type.LSHandlerRank, type.LSItemContentTypes])).toEqual([
      ["Alternate", ["public.json"]],
      ["Alternate", ["net.daringfireball.markdown"]],
    ]);
  });

  test("exports .jxn on macOS as text, so Quick Look and text editors read it", () => {
    expect(config.mac.extendInfo.UTExportedTypeDeclarations).toEqual([
      {
        UTTypeConformsTo: ["public.plain-text"],
        UTTypeDescription: "Jx file",
        UTTypeIdentifier: "com.jxsuite.jxn",
        UTTypeTagSpecification: {
          "public.filename-extension": ["jxn"],
          "public.mime-type": [MIME_TYPE],
        },
      },
    ]);
    expect(config.mac.fileAssociations).toBeUndefined();
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
    expect(
      lines.filter((line) => line.endsWith(String.raw`"Software\Classes\.json" ""`)),
    ).toHaveLength(2);
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
    expect(uninstall).toContain(
      String.raw`"Software\Classes\.json\OpenWithProgids" "JxStudio.Json"`,
    );
    expect(uninstall).toContain(
      String.raw`DeleteRegKey SHELL_CONTEXT "Software\Classes\JxStudio.Json"`,
    );
    for (const body of [install, uninstall]) {
      expect(body).toContain("shell32::SHChangeNotify");
    }
  });
});

describe("the .jxn type on Linux", () => {
  const mime = read("jx-studio.mime.xml");

  test("is text/x-jxn, a kind of text, for files named *.jxn", () => {
    expect(mime).toContain(`<mime-type type="${MIME_TYPE}">`);
    expect(mime).toContain('<sub-class-of type="text/plain"/>');
    expect(mime).toContain('<glob pattern="*.jxn"/>');
  });

  test("is named by every desktop entry and by the generated one", () => {
    for (const entry of ["jx-studio.desktop", "snap/gui/jx-studio.desktop"]) {
      const mimeTypes = /^MimeType=(.*)$/m.exec(read(entry))?.[1]?.split(";") ?? [];
      expect([entry, mimeTypes]).toEqual([entry, expect.arrayContaining([MIME_TYPE])]);
    }
    expect(config.linux.fileAssociations).toEqual([
      { ext: "jxn", mimeType: MIME_TYPE, name: "Jx file" },
    ]);
  });

  test("reaches the entry electron-builder writes for the AppImage", async () => {
    /* `--dir` is a NoOpTarget and writes no entry, so the builder's own function is asked, with
       the config's associations, which is everything it reads to name the types. */
    const { LinuxTargetHelper } = await import("app-builder-lib/out/targets/LinuxTargetHelper.js");
    type Helper = InstanceType<typeof LinuxTargetHelper>;
    /* `computeDesktopEntry` reads these members of its packager and nothing else (its source,
       app-builder-lib 26.18), so the rest of a LinuxPackager is never touched. A real one needs
       a whole build's state, which is what a test cannot have. */
    const packager = {
      appInfo: { description: "", productName: "Jx Studio", sanitizedProductName: "Jx Studio" },
      config,
      executableName: "jx-studio",
      fileAssociations: config.linux.fileAssociations,
      info: { metadata: { desktopName: "jx-studio.desktop" } },
      platformSpecificBuildOptions: config.linux,
    };
    const helper: Helper = Reflect.construct(LinuxTargetHelper, [packager]);
    // No target options: the types come from the packager's associations, which is the point.
    const entry = await helper.computeDesktopEntry({}, "jx-studio %U", {});
    expect(entry).toContain(`MimeType=${MIME_TYPE};`);
  });

  test("is installed by the Nix package beside the desktop entry", () => {
    expect(read("package.nix")).toContain(
      "install -Dm644 packages/desktop/jx-studio.mime.xml $out/share/mime/packages/jx-studio.xml",
    );
  });
});
