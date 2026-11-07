/** The project file on a real filesystem. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  NODE_PROJECT_WALK_IO,
  findEnclosingProjectOnDisk,
  hasProjectFile,
  projectFilePath,
  readProjectFile,
} from "../src/project-file-node.ts";
import {
  isProjectConfigPath,
  parseProjectFile,
  serializeProjectFile,
} from "../src/project-file.ts";
import { rewriteJson } from "../src/json-layout.ts";

let scratch: string;
const posixOnly = process.platform === "win32" ? test.skip : test;

function write(path: string, text: string): string {
  const absolute = join(scratch, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, text);
  return absolute;
}

beforeAll(() => {
  const made = mkdtempSync(join(tmpdir(), "jx-project-file-"));
  scratch = realpathSync(made);
});

afterAll(() => {
  rmSync(scratch, { force: true, recursive: true });
});

describe("isProjectConfigPath", () => {
  test.each([
    ["project.json", true],
    ["pages/project.json", false],
    ["new-project.json", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("%s is %s", (path, expected) => {
    expect(isProjectConfigPath(path)).toBe(expected);
  });
});

describe("parseProjectFile", () => {
  test("answers with the configuration", () => {
    expect(parseProjectFile("p/project.json", '{ "name": "Site" }')).toEqual({
      config: { name: "Site" },
      path: "p/project.json",
      text: '{ "name": "Site" }',
    });
  });

  test("answers with what is wrong, for the host to decide about, and does not throw", () => {
    const read = parseProjectFile("p/project.json", "{ oops");
    expect("error" in read && read.error).toBeString();
    expect(read.path).toBe("p/project.json");
    expect(read.text).toBe("{ oops");
  });
});

describe("serializeProjectFile and rewriteJson", () => {
  test("a new file is written as a formatter would, ending in a newline", () => {
    const text = serializeProjectFile({ name: "Site" }, null);
    expect(JSON.parse(text)).toEqual({ name: "Site" });
    expect(text.endsWith("\n")).toBe(true);
  });

  test("a formatted file keeps its layout, and only what changed moves", () => {
    const previous = `{
  "name": "Old",
  "images": { "optimize": true },

  "defaults": {
    "lang": "en"
  }
}
`;
    const config = { defaults: { lang: "en" }, images: { optimize: true }, name: "New" };
    const ordered = { name: config.name, images: config.images, defaults: config.defaults };
    expect(serializeProjectFile(ordered, previous)).toBe(previous.replace("Old", "New"));
  });

  test("a tab-indented file stays tab-indented", () => {
    const previous = `${JSON.stringify({ name: "Old" }, null, "\t")}\n`;
    expect(rewriteJson({ name: "New" }, previous)).toBe(
      `${JSON.stringify({ name: "New" }, null, "\t")}\n`,
    );
  });

  test("a file with no final newline is not given one", () => {
    expect(rewriteJson({ a: 1 }, '{ "a": 2 }').endsWith("\n")).toBe(false);
    expect(rewriteJson({ a: 1 }, JSON.stringify({ a: 2 }, null, "\t")).endsWith("\n")).toBe(false);
  });
});

describe("on disk", () => {
  test("a folder named explicitly is judged by name", () => {
    write("named/project.json", "{ oops");
    expect(hasProjectFile(join(scratch, "named"))).toBe(true);
    expect(hasProjectFile(join(scratch, "nowhere"))).toBe(false);
    expect(projectFilePath("/w/site").endsWith("project.json")).toBe(true);
  });

  test("readProjectFile answers null for no file, and a problem for a broken one", () => {
    write("good/project.json", '{ "name": "Good" }');
    expect(readProjectFile(join(scratch, "nowhere"))).toBeNull();
    expect(readProjectFile(join(scratch, "good"))).toMatchObject({ config: { name: "Good" } });
    expect(readProjectFile(join(scratch, "named"))).toHaveProperty("error");
  });

  test("a search walks past a page by that name, to the project above it", () => {
    write("site/project.json", '{ "name": "Site" }');
    write("site/pages/project.json", '{ "tagName": "main" }');
    const found = findEnclosingProjectOnDisk(join(scratch, "site/pages"));
    expect(found?.root).toBe(join(scratch, "site"));
  });

  test("a search can be told where to stop", () => {
    write("outer/project.json", '{ "name": "Outer" }');
    mkdirSync(join(scratch, "outer/inner"));
    const inner = join(scratch, "outer/inner");
    expect(findEnclosingProjectOnDisk(inner, inner)).toBeNull();
  });

  posixOnly("a FIFO is not read, so it cannot hold up the process", () => {
    mkdirSync(join(scratch, "fifo"));
    const path = join(scratch, "fifo/project.json");
    execFileSync("mkfifo", [path]);
    expect(NODE_PROJECT_WALK_IO.readText(path)).toBeNull();
  });

  posixOnly("a link to a device is not read either", () => {
    mkdirSync(join(scratch, "device"));
    const path = join(scratch, "device/project.json");
    symlinkSync("/dev/zero", path);
    expect(NODE_PROJECT_WALK_IO.readText(path)).toBeNull();
  });

  test("a directory by that name is not a file", () => {
    const path = join(scratch, "dir/project.json");
    mkdirSync(path, { recursive: true });
    expect(NODE_PROJECT_WALK_IO.readText(path)).toBeNull();
  });

  test("a file too large to be one reads as there and unreadable", () => {
    const path = write("huge/project.json", "");
    truncateSync(path, 5 * 1024 * 1024);
    expect(NODE_PROJECT_WALK_IO.readText(path)).toBe("");
  });

  test("a file that is not there is not there", () => {
    expect(NODE_PROJECT_WALK_IO.readText(join(scratch, "nowhere/project.json"))).toBeNull();
  });

  const notRoot = process.platform !== "win32" && process.getuid?.() !== 0;
  (notRoot ? test : test.skip)("one it can see and may not read reads as unreadable", () => {
    const path = write("locked/project.json", "{}");
    chmodSync(path, 0o000);
    try {
      expect(NODE_PROJECT_WALK_IO.readText(path)).toBe("");
    } finally {
      chmodSync(path, 0o600);
    }
  });

  (notRoot ? test : test.skip)("a place it may not look at all is not a project", () => {
    const folder = join(scratch, "shut");
    mkdirSync(folder);
    chmodSync(folder, 0o000);
    try {
      // What a strict snap's confinement looks like from here: denied, and nothing to be seen.
      expect(NODE_PROJECT_WALK_IO.readText(join(folder, "project.json"))).toBeNull();
    } finally {
      chmodSync(folder, 0o700);
    }
  });
});
