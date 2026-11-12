/**
 * The mapper's own part (`spec.md` §23.3): what a document's project gives it, and the form the
 * compiler's protocol takes a document's modules in.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { PositionEncoding, SpanMapping, TransformResult } from "ts-content-mapper";

import { DIAGNOSTIC_SOURCE, NOT_NOTATION, createMapper, outsideOf } from "../src/mapper";
import type { MapperProject } from "../src/mapper";

const folders: string[] = [];

/** A folder deleted when the file's tests are done, holding the files given. */
function folder(files: Readonly<Record<string, string>> = {}): string {
  const made = mkdtempSync(join(tmpdir(), "jx-mapper-"));
  const root = realpathSync(made);
  folders.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** What a compile remembers before it has read anything. */
const remembered = (root: string | null = null): MapperProject => ({ facts: new Map(), root });

const WITH_BOTH = 'project "x"\ndefaults layout="./layouts/base.jxn"\nstate {\n  shared 1\n}\n';
const WITH_NEITHER = 'project "x"\n';

afterAll(() => {
  for (const root of folders) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("what a project gives a document", () => {
  test("is nothing where there is no project", () => {
    const root = folder();
    expect(outsideOf(join(root, "pages/a.jxn"), remembered())).toEqual({});
  });

  test("is its state and its default layout, for a page", () => {
    const root = folder({ "project.jxn": WITH_BOTH });
    expect(outsideOf(join(root, "pages/blog/a.jxn"), remembered())).toEqual({
      components: {},
      layout: true,
      state: true,
    });
  });

  test("is neither, for a page of a project that has neither", () => {
    const root = folder({ "project.jxn": WITH_NEITHER });
    expect(outsideOf(join(root, "pages/a.jxn"), remembered())).toEqual({
      components: {},
      layout: false,
      state: false,
    });
  });

  test("is read from a project.json as from a project.jxn", () => {
    const root = folder({
      "project.json": JSON.stringify({ defaults: { layout: "./layouts/base.json" }, name: "x" }),
    });
    expect(outsideOf(join(root, "pages/a.jxn"), remembered())).toEqual({
      components: {},
      layout: true,
      state: false,
    });
  });

  test("is the pages it wraps and no layout, for a layout, which the default one does not wrap", () => {
    const root = folder({ "project.jxn": WITH_BOTH });
    expect(outsideOf(join(root, "layouts/base.jxn"), remembered())).toEqual({
      components: {},
      state: true,
      wraps: true,
    });
    const bare = folder({ "project.jxn": WITH_NEITHER });
    expect(outsideOf(join(bare, "layouts/nested/base.jxn"), remembered())).toEqual({
      components: {},
      state: false,
      wraps: true,
    });
  });

  test("is nothing for a component, which is a scope of its own", () => {
    const root = folder({ "project.jxn": WITH_BOTH });
    expect(outsideOf(join(root, "components/card.jxn"), remembered())).toEqual({
      components: {},
    });
  });

  test("is everything when the project file cannot be read, so its own error is the one told", () => {
    const typo = folder({ "project.jxn": 'project "x"\nstate {\n' });
    expect(outsideOf(join(typo, "pages/a.jxn"), remembered())).toEqual({
      components: {},
      layout: true,
      state: true,
    });
    const broken = folder({ "project.json": "{" });
    expect(outsideOf(join(broken, "pages/a.jxn"), remembered())).toEqual({
      components: {},
      layout: true,
      state: true,
    });
  });

  test("is everything when the folder holds both project files, which nothing chooses between", () => {
    const both = folder({ "project.json": '{"name":"x"}', "project.jxn": WITH_NEITHER });
    expect(outsideOf(join(both, "pages/a.jxn"), remembered())).toEqual({
      components: {},
      layout: true,
      state: true,
    });
    // The second is another tool's file by the same name, and still leaves two to choose between.
    const shared = folder({ "project.json": '{"targets":{}}', "project.jxn": WITH_NEITHER });
    expect(outsideOf(join(shared, "pages/a.jxn"), remembered())).toEqual({
      components: {},
      layout: true,
      state: true,
    });
  });

  test("is not looked for above the folder the compile is configured in", () => {
    const root = folder({ "project.jxn": WITH_BOTH });
    const page = join(root, "app/pages/a.jxn");
    const inside = remembered(join(root, "app"));
    expect(outsideOf(page, inside)).toEqual({});
    expect(outsideOf(page, remembered(root))).toEqual({
      components: {},
      layout: true,
      state: true,
    });
    expect(outsideOf(page, remembered())).toEqual({ components: {}, layout: true, state: true });
  });

  test("is each component the project keeps, by its tag, as a path from the document", () => {
    const root = folder({
      "components/README.md": "",
      "components/card.jxn": "div\n",
      "components/nested/in-ner.jxn": "in-ner\n",
      "components/old-card.json": "{}",
      "components/x-card.jxn": "x-card\n",
      "components/y-band.jxn": "y-band\n",
      "project.jxn": WITH_NEITHER,
    });
    // A file with no hyphen names no tag, a `.json` one says no types, and a folder is not read.
    expect(outsideOf(join(root, "pages/blog/a.jxn"), remembered())).toEqual({
      components: {
        "x-card": "../../components/x-card.jxn",
        "y-band": "../../components/y-band.jxn",
      },
      layout: false,
      state: false,
    });
    expect(outsideOf(join(root, "index.jxn"), remembered()).components).toEqual({
      "x-card": "./components/x-card.jxn",
      "y-band": "./components/y-band.jxn",
    });
    // A component uses the others, and itself, as any document does.
    expect(outsideOf(join(root, "components/x-card.jxn"), remembered())).toEqual({
      components: { "x-card": "./x-card.jxn", "y-band": "./y-band.jxn" },
    });
  });

  test("is a component added since the last document was read", () => {
    const root = folder({ "project.jxn": WITH_NEITHER });
    const page = join(root, "pages/a.jxn");
    const project = remembered();
    expect(outsideOf(page, project).components).toEqual({});
    mkdirSync(join(root, "components"));
    writeFileSync(join(root, "components/x-card.jxn"), "x-card\n");
    expect(outsideOf(page, project).components).toEqual({ "x-card": "../components/x-card.jxn" });
  });

  test("is read again only when the project file has changed", () => {
    const root = folder({ "project.jxn": WITH_BOTH });
    const file = join(root, "project.jxn");
    const page = join(root, "pages/a.jxn");
    const saved = new Date("2026-01-01T00:00:00Z");
    utimesSync(file, saved, saved);
    const project = remembered();
    expect(outsideOf(page, project)).toEqual({ components: {}, layout: true, state: true });

    // Different text under the same name and time is the file the compile has already read.
    writeFileSync(file, WITH_NEITHER);
    utimesSync(file, saved, saved);
    expect(outsideOf(page, project)).toEqual({ components: {}, layout: true, state: true });

    const later = new Date("2026-01-02T00:00:00Z");
    utimesSync(file, later, later);
    expect(outsideOf(page, project)).toEqual({ components: {}, layout: false, state: false });
  });
});

const mapper = createMapper();

// oxlint-disable-next-line unicorn/text-encoding-identifier-case -- the protocol's own spelling
const UTF_8: PositionEncoding = "utf-8";
const { signal } = new AbortController();

/** Open a project as the compiler does, by the path of its `tsconfig`. */
async function open(configFileName: string) {
  const opened = await mapper.openProject?.(
    { compilerOptions: {}, configFileName, projectHandle: "p" },
    { positionEncoding: "utf-16", signal },
  );
  if (!opened?.project) {
    throw new Error("The mapper remembers something for every project");
  }
  return { ...opened, project: opened.project };
}

/** Map one file as the compiler asks, in the encoding it agreed on. */
async function transform(
  fileName: string,
  content: string,
  positionEncoding: PositionEncoding = "utf-16",
  project: MapperProject = remembered(),
): Promise<TransformResult> {
  return await mapper.transform(
    { content, fileName, projectHandle: "p" },
    {
      openProjectParams: { compilerOptions: {}, configFileName: "", projectHandle: "p" },
      positionEncoding,
      project,
      signal,
    },
  );
}

/** Each mapping as the two texts it joins, cut in the unit its offsets count. */
function joined(
  mappings: readonly SpanMapping[] | undefined,
  written: string,
  source: string,
  encoding: PositionEncoding,
): [kind: number, virtual: string, original: string][] {
  const cut = (text: string, start: number, length: number): string =>
    encoding === "utf-16"
      ? text.slice(start, start + length)
      : Buffer.from(text)
          .subarray(start, start + length)
          .toString();
  return (mappings ?? []).map(
    ([virtualStart, virtualLength, originalStart, originalLength, kind]) => [
      kind,
      cut(written, virtualStart, virtualLength),
      cut(source, originalStart, originalLength),
    ],
  );
}

describe("opening a project", () => {
  test("names the mapper's errors", () => {
    expect(mapper.diagnosticSource).toBe(DIAGNOSTIC_SOURCE);
    expect(DIAGNOSTIC_SOURCE).toBe("jx");
  });

  test("says what the project beside the tsconfig gives, and watches for either of its files", async () => {
    const root = folder({ "project.jxn": WITH_BOTH });
    const opened = await open(join(root, "tsconfig.json"));
    expect(opened.configIdentity).toBe('{".":{"layout":true,"state":true}}');
    expect(opened.watchedFiles).toEqual([join(root, "project.jxn"), join(root, "project.json")]);
    expect(opened.project.root).toBe(root);
    // What it read to say so is what the first file mapped is answered from.
    expect([...opened.project.facts.keys()]).toEqual([root]);
  });

  test("says the same of the same project however often it is saved", async () => {
    const root = folder({ "project.jxn": WITH_BOTH });
    const first = await open(join(root, "tsconfig.json"));
    const later = new Date("2030-01-01T00:00:00Z");
    utimesSync(join(root, "project.jxn"), later, later);
    const second = await open(join(root, "tsconfig.json"));
    expect(second.configIdentity).toBe(first.configIdentity);
  });

  test("says there is none where the folder holds no project, and still watches for one", async () => {
    const root = folder();
    const opened = await open(join(root, "tsconfig.json"));
    expect(opened.configIdentity).toBe("{}");
    expect(opened.watchedFiles).toEqual([join(root, "project.jxn"), join(root, "project.json")]);
  });

  test("says what every project under the tsconfig gives, and watches each one's files", async () => {
    const root = folder({
      // Neither is a folder a document is read from, so neither is looked in.
      ".cache/project.jxn": WITH_BOTH,
      "node_modules/kept/project.jxn": WITH_BOTH,
      // A folder holding both files is a project nothing can be said of.
      "both/project.json": "{}",
      "both/project.jxn": WITH_NEITHER,
      "sites/a/project.jxn": WITH_BOTH,
      // A page may have the name, and its folder is watched in case it becomes a project.
      "sites/b/pages/project.jxn": 'div "a page"\n',
      "sites/b/project.jxn": WITH_NEITHER,
    });
    symlinkSync(join(root, "sites/a"), join(root, "linked"), "dir");
    const opened = await open(join(root, "tsconfig.json"));
    const all = { layout: true, state: true };
    expect(JSON.parse(opened.configIdentity ?? "")).toEqual({
      both: all,
      "sites/a": all,
      "sites/b": { layout: false, state: false },
    });
    expect(opened.watchedFiles).toEqual(
      ["", "both", "sites/a", "sites/b", "sites/b/pages"].flatMap((at) => [
        join(root, at, "project.jxn"),
        join(root, at, "project.json"),
      ]),
    );
    expect([...opened.project.facts.keys()]).toEqual([
      join(root, "sites/a"),
      join(root, "sites/b"),
    ]);
  });

  test("says another thing when a project under the tsconfig gives another", async () => {
    const root = folder({ "sites/a/project.jxn": WITH_NEITHER });
    const first = await open(join(root, "tsconfig.json"));
    writeFileSync(join(root, "sites/a/project.jxn"), WITH_BOTH);
    const second = await open(join(root, "tsconfig.json"));
    expect(second.configIdentity).not.toBe(first.configIdentity);
    expect(second.watchedFiles).toEqual(first.watchedFiles);
  });

  test("finds no project in a folder that cannot be listed", async () => {
    const root = folder();
    const opened = await open(join(root, "gone/tsconfig.json"));
    expect(opened.configIdentity).toBe("{}");
    expect(opened.watchedFiles).toEqual([
      join(root, "gone/project.jxn"),
      join(root, "gone/project.json"),
    ]);
  });

  test("has no folder to read for files the compiler holds without a tsconfig", async () => {
    const opened = await open("");
    expect(opened.configIdentity).toBe("");
    expect(opened.watchedFiles).toBeUndefined();
    expect(opened.project.root).toBeNull();
  });
});

describe("mapping a file", () => {
  const source = [
    "div {",
    "  state {",
    "    // \u00E9\u{1F600}",
    "    count 0",
    '    "my key" 1',
    "  }",
    '  (fn)onclick "state.count += 1"',
    "}",
    "",
  ].join("\n");

  test("answers with the document's module as TypeScript, and a module for each body", async () => {
    const result = await transform("/somewhere/a.jxn", source);
    expect(result.extension).toBe(".ts");
    expect(result.text).toContain("export interface State");
    expect(result.diagnostics).toEqual([]);
    expect(result.supplemental?.map((unit) => unit.extension)).toEqual([".ts"]);
    // A body reads the document's types by the name the file has beside it.
    expect(result.supplemental?.[0]?.text).toContain('from "./a.jxn"');
    expect(result.supplemental?.[0]?.text).toContain("state.count += 1");
  });

  test("answers a template as JavaScript, and what the document refers to as TypeScript", async () => {
    const said = [
      "div {",
      "  state { count 0 }",
      '  p "${state.count} left" hidden=(ref)"#/state/count"',
      "}",
      "",
    ].join("\n");
    const result = await transform("/somewhere/a.jxn", said);
    expect(result.supplemental?.map((unit) => unit.extension)).toEqual([".js", ".ts"]);
    const [template, refs] = result.supplemental ?? [];
    expect(template?.text).toContain("return `${state.count} left`;");
    expect(joined(template?.mappings, template?.text ?? "", said, "utf-16")).toContainEqual([
      0,
      "${state.count} left",
      "${state.count} left",
    ]);
    expect(refs?.text).toContain("void s0.count;");
    expect(joined(refs?.mappings, refs?.text ?? "", said, "utf-16")).toEqual([
      [1, "s0.", "#/state/"],
      [0, "count", "count"],
    ]);
  });

  test("joins each name and each body to where its author wrote it, counted in UTF-16", async () => {
    const result = await transform("/somewhere/a.jxn", source);
    expect(joined(result.mappings, result.text, source, "utf-16")).toEqual([
      [0, "count", "count"],
      [1, '"my key"', '"my key"'],
    ]);
    const [body] = result.supplemental ?? [];
    expect(joined(body?.mappings, body?.text ?? "", source, "utf-16")).toContainEqual([
      0,
      "state.count += 1",
      "state.count += 1",
    ]);
  });

  test("joins them at the same text counted in UTF-8, past characters of several bytes", async () => {
    const result = await transform("/somewhere/a.jxn", source, UTF_8);
    expect(joined(result.mappings, result.text, source, UTF_8)).toEqual([
      [0, "count", "count"],
      [1, '"my key"', '"my key"'],
    ]);
    const utf16 = await transform("/somewhere/a.jxn", source);
    // Six bytes where UTF-16 counts three units: the offsets differ, and the text they cut does not.
    expect(result.mappings?.[0]?.[2]).toBe((utf16.mappings?.[0]?.[2] ?? 0) + 3);
  });

  test("gives a page what its project gives it", async () => {
    const root = folder({ "project.jxn": WITH_BOTH });
    const body = 'div {\n  (fn)onclick "state.shared"\n}\n';
    const page = await transform(join(root, "pages/a.jxn"), body);
    const alone = await transform(join(folder(), "a.jxn"), body);
    expect(page.text).toContain("[key: string]: any;");
    expect(alone.text).not.toContain("[key: string]: any;");
  });

  test("reports a file that is not Jx Notation where it stops being it, in the encoding agreed", async () => {
    const bad = "div {\n  // \u00E9\n}\np\n";
    // The second root is the file's last character but its line ending.
    const at = bad.length - 2;
    const utf16 = await transform("/somewhere/bad.jxn", bad);
    expect(utf16.diagnostics).toEqual([
      {
        code: NOT_NOTATION,
        length: 1,
        messageText: "A document has one root element, and this is a second",
        start: at,
      },
    ]);
    const utf8 = await transform("/somewhere/bad.jxn", bad, UTF_8);
    expect(utf8.diagnostics?.[0]?.start).toBe(at + 1);
    expect(utf8.diagnostics?.[0]?.length).toBe(1);
    // Nothing of the file is offered to the compiler as code.
    expect(utf16.supplemental).toEqual([]);
  });
});
