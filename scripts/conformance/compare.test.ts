import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { BUILD_RECORD, compareCaptures, lineDifference, report } from "./compare.ts";
import type { Observation } from "./observe.ts";

/** A PNG of one solid colour, enough for the pixel comparison to decode. */
function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(8 + body.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 4 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width }, () => rgb).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, chunk("IHDR", header), chunk("IDAT", deflateSync(raw))];
  return Buffer.concat([...parts, chunk("IEND", new Uint8Array(0))]);
}

const BASE: Observation = {
  accessibility: ['RootWebArea "Home"'],
  complaints: [],
  dom: ['html lang="en" @0,0,10,10', '  body class="jx-1"', '    "Hello"'],
  interactions: [],
  route: "/",
  screenshot: "same",
  viewport: "wide",
};

let root = "";
const side = (name: string) => join(root, name);

function write(
  capture: string,
  project: string,
  page: string,
  observation: Observation,
  png = solidPng(4, 4, [10, 20, 30]),
) {
  const dir = join(side(capture), project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${page}.json`), JSON.stringify(observation));
  writeFileSync(join(dir, `${page}.png`), png);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jx-conformance-compare-"));
});
afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("lineDifference", () => {
  test("equal lists have no difference", () => {
    expect(lineDifference(["a", "b"], ["a", "b"])).toBeNull();
  });

  test("it reports where they first part, how many lines differ, and quotes both sides", () => {
    expect(lineDifference(["a", "  b", "c"], ["a", "  x", "c", "d"])).toEqual({
      at: 1,
      count: 2,
      detail: ["- b", "- c", "+ x", "+ c", "+ d"],
    });
  });
});

describe("compareCaptures", () => {
  test("two captures that differ only in what is tolerated agree", () => {
    write("a", "blog", "index.wide", BASE);
    write("b", "blog", "index.wide", {
      ...BASE,
      dom: ['html lang="en" @0,0,10,10', '  body class="jx-9"', '    "Hello"'],
    });
    expect(compareCaptures(side("a"), side("b"))).toEqual([]);
    expect(report([])).toBe("conformance: the two captures agree.");
  });

  test("a changed line is a finding of its field, quoted", () => {
    write("a", "blog", "index.wide", BASE);
    write("b", "blog", "index.wide", {
      ...BASE,
      accessibility: ['RootWebArea "Home page"'],
      complaints: ["uncaught: state is not defined"],
      dom: ['html lang="en" @0,0,10,10', '  body class="jx-9"', '    "Hullo"'],
      interactions: ['button "Add" -> 0123456789abcdef'],
    });
    const findings = compareCaptures(side("a"), side("b"));
    expect(findings.map((finding) => finding.kind)).toEqual([
      "dom",
      "accessibility",
      "complaints",
      "interactions",
    ]);
    expect(findings[0]).toEqual({
      detail: ['- "Hello"', '+ "Hullo"'],
      kind: "dom",
      page: "index.wide",
      project: "blog",
      summary: "1 line(s) differ, the first at line 3",
    });
    const text = report(findings);
    expect(text).toStartWith(
      "conformance: 4 finding(s): 1 dom, 1 accessibility, 1 complaints, 1 interactions.",
    );
    expect(text).toContain("blog index.wide [complaints] 1 line(s) differ, the first at line 1");
    expect(text).toContain("    + uncaught: state is not defined");
  });

  test("a page or a project on one side only is a finding", () => {
    write("a", "blog", "index.wide", BASE);
    write("a", "blog", "about.wide", BASE);
    write("b", "blog", "index.wide", BASE);
    write("b", "blog", "contact.wide", BASE);
    write("b", "shop", "index.wide", BASE);
    expect(
      compareCaptures(side("a"), side("b")).map((f) => `${f.project} ${f.page} ${f.kind}`),
    ).toEqual(["blog contact.wide extra", "blog about.wide missing", "shop index.wide extra"]);
  });

  test("pictures with one hash are not decoded, and different pictures are measured", () => {
    write("a", "blog", "index.wide", BASE);
    write("b", "blog", "index.wide", BASE, solidPng(4, 4, [200, 20, 30]));
    expect(compareCaptures(side("a"), side("b"))).toEqual([]);

    write(
      "b",
      "blog",
      "index.wide",
      { ...BASE, screenshot: "other" },
      solidPng(4, 4, [200, 20, 30]),
    );
    expect(compareCaptures(side("a"), side("b"))).toEqual([
      {
        kind: "pixels",
        page: "index.wide",
        project: "blog",
        summary: "100.000% of pixels differ (tolerance 0.000%)",
      },
    ]);
  });

  test("a tolerance forgives a small channel move or a small share of pixels", () => {
    write("a", "blog", "index.wide", BASE);
    write(
      "b",
      "blog",
      "index.wide",
      { ...BASE, screenshot: "other" },
      solidPng(4, 4, [12, 20, 30]),
    );
    const strict = { channelTolerance: 0, pixelTolerance: 0 };
    expect(compareCaptures(side("a"), side("b"), strict)).toHaveLength(1);
    expect(compareCaptures(side("a"), side("b"), { ...strict, channelTolerance: 2 })).toEqual([]);
    expect(compareCaptures(side("a"), side("b"), { ...strict, pixelTolerance: 1 })).toEqual([]);
  });

  test("a resized or undecodable picture says which", () => {
    write("a", "blog", "index.wide", BASE);
    write(
      "b",
      "blog",
      "index.wide",
      { ...BASE, screenshot: "other" },
      solidPng(4, 8, [10, 20, 30]),
    );
    expect(compareCaptures(side("a"), side("b"))[0]?.summary).toBe(
      "the screenshots differ in size: 4x4 against 4x8",
    );
    write("b", "blog", "index.wide", { ...BASE, screenshot: "other" }, new Uint8Array([1, 2, 3]));
    expect(compareCaptures(side("a"), side("b"))[0]?.summary).toBe(
      "a screenshot could not be decoded",
    );
  });

  test("builds that report different errors are a finding, and equal errors are not", () => {
    write("a", "blog", "index.wide", BASE);
    write("b", "blog", "index.wide", BASE);
    const record = (capture: string, errors: string[]) => {
      writeFileSync(join(side(capture), "blog", BUILD_RECORD), JSON.stringify({ errors }));
    };
    record("a", ["Error compiling /x: Layout not found"]);
    record("b", ["Error compiling /x: Layout not found"]);
    expect(compareCaptures(side("a"), side("b"))).toEqual([]);

    record("b", []);
    expect(compareCaptures(side("a"), side("b"))).toEqual([
      {
        detail: ["- Error compiling /x: Layout not found"],
        kind: "build",
        page: "(build)",
        project: "blog",
        summary: "the builds report different errors, 1 line(s)",
      },
    ]);
    // A record that is not one is read as no errors rather than trusted.
    record("a", []);
    writeFileSync(join(side("b"), "blog", BUILD_RECORD), "[]");
    expect(compareCaptures(side("a"), side("b"))).toEqual([]);
  });

  test("a file that is not an observation stops the comparison and is named", () => {
    write("a", "blog", "index.wide", BASE);
    write("b", "blog", "index.wide", BASE);
    writeFileSync(join(side("b"), "blog", "index.wide.json"), '{"dom":"no"}');
    expect(() => compareCaptures(side("a"), side("b"))).toThrow("is not an observation");
  });

  test("captures that do not exist hold no projects", () => {
    expect(compareCaptures(side("nowhere"), side("nowhere-else"))).toEqual([]);
  });
});
