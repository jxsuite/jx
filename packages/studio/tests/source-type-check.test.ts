/**
 * Type errors in the Code view of a `.jxn` file (`studio.md` §16.7): the modules written for the
 * file are handed to the worker as models beside each other, and what it says of each is drawn
 * where the author wrote it. Monaco and its worker are doubled here, so this is about what the
 * service asks and what it does with the answers; `source-type-check-worker.test.ts` puts Monaco's
 * real worker over the same modules.
 */
import "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { IPosition, editor } from "monaco-editor";
import type { Diagnostic } from "monaco-editor/languages/features/typescript/register";
import { generateVirtualDocument } from "@jxsuite/schema/virtual-document";
import type { VirtualUnit } from "@jxsuite/schema/virtual-document";
import type { SourceTypeCheckInit } from "../src/services/source-type-check";
import type { TypeWorker } from "../src/services/type-check";

/** A TypeScript diagnostic with the members the service reads. */
function diagnostic(
  over: Partial<Diagnostic> & Pick<Diagnostic, "code" | "messageText" | "start">,
): Diagnostic {
  return { category: 1, file: undefined, length: 1, ...over };
}

const SOURCE = [
  "/- kdl-version 2",
  "div {",
  "    state {",
  "        count 0",
  '        (fn)bump "state.nope = 1"',
  '        (fn)twice "return state.count * 2"',
  "    }",
  "    button {",
  "        (fn)onclick \"state.count = 'a'\"",
  "    }",
  // eslint-disable-next-line no-template-curly-in-string -- a template of the document under test
  '    p "${state.missing}"',
  "}",
  "",
].join("\n");
const FOLDER = "file:///jx-virtual/src1/";

/** The modules the service writes for `source`, in the order it names them. */
function unitsOf(source: string): VirtualUnit[] {
  const written = generateVirtualDocument(source, { specifier: "./page.jxn" });
  return [written.main, ...written.supplemental];
}

/** A module of the file, and the name the worker knows it by. */
interface NamedUnit {
  name: string;
  unit: VirtualUnit;
}

/** The module holding `text`. */
function unitWith(source: string, text: string): NamedUnit {
  const units = unitsOf(source);
  const at = units.findIndex((unit) => unit.text.includes(text));
  const unit = units[at];
  if (!unit) {
    throw new Error(`no module holds ${text}`);
  }
  const name = at === 0 ? "page.jxn.ts" : `page.jxn.${String(at)}${unit.extension}`;
  return { name: `${FOLDER}${name}`, unit };
}

/** The text a fake model holds, with the position arithmetic Monaco does for it. */
class FakeTextModel {
  text: string;
  language: string;
  name: string;
  disposed = false;
  writes = 0;
  constructor(text: string, language = "jxn", name = "") {
    this.text = text;
    this.language = language;
    this.name = name;
  }
  getValue(): string {
    return this.text;
  }
  setValue(text: string): void {
    this.text = text;
    this.writes += 1;
  }
  dispose(): void {
    this.disposed = true;
  }
  getPositionAt(offset: number): IPosition {
    const before = this.text.slice(0, offset).split("\n");
    return { column: (before.at(-1) ?? "").length + 1, lineNumber: before.length };
  }
}

interface FakeUri {
  toString: () => string;
}

const markers: [FakeTextModel, string, editor.IMarkerData[]][] = [];
const created: FakeTextModel[] = [];
/** The models of the worker's own language, which is what has Monaco set the worker up. */
const woke: FakeTextModel[] = [];
/** How often the worker was asked for. */
let asks = 0;
const synced: string[][] = [];
const askedSemantic: string[] = [];
const askedSyntactic: string[] = [];
let buffer = new FakeTextModel(SOURCE);
let monacoLoaded = true;
let worker: TypeWorker;
let semantic = new Map<string, Diagnostic[]>();
let syntactic = new Map<string, Diagnostic[]>();
/** Runs when the worker is first asked a question, so a test can act while a check waits. */
let whenAsked: (() => void) | null = null;
/** Runs when the worker is handed the modules, before it has taken them. */
let whenSynced: (() => void) | null = null;

void mock.module("../src/services/monaco-lazy", () => ({
  loadedMonaco: () =>
    monacoLoaded
      ? {
          MarkerSeverity: { Error: 8 },
          Uri: { parse: (value: string): FakeUri => ({ toString: () => value }) },
          editor: {
            createModel: (text: string, language: string, uri?: FakeUri) => {
              const model = new FakeTextModel(text, language, uri?.toString());
              (language === "typescript" ? woke : created).push(model);
              return model;
            },
            setModelMarkers: (model: FakeTextModel, owner: string, data: editor.IMarkerData[]) => {
              markers.push([model, owner, data]);
            },
          },
        }
      : null,
}));
void mock.module("monaco-editor/languages/features/typescript/register", () => ({
  getTypeScriptWorker: () => {
    asks += 1;
    // As Monaco does: it has no worker to hand over until it has met a model of the language, and
    // Not at once then either.
    if (woke.length === 0 || asks === 1) {
      // eslint-disable-next-line prefer-promise-reject-errors -- what Monaco rejects with
      return Promise.reject("TypeScript not registered!");
    }
    return Promise.resolve((...uris: FakeUri[]) => {
      synced.push(uris.map(String));
      whenSynced?.();
      whenSynced = null;
      return Promise.resolve(worker);
    });
  },
}));

const { createSourceTypeCheck, findingsIn } = await import("../src/services/source-type-check");
const { TYPE_MARKER_OWNER, TYPE_PROBLEM_SOURCE } = await import("../src/services/type-check");
const { notify, problemFindings, resetNotifications } = await import("../src/services/notify");

/** The markers the last draw left on a model. */
function lastDrawn(): editor.IMarkerData[] {
  return markers.at(-1)?.[2] ?? [];
}

describe("findingsIn", () => {
  const { unit } = unitWith(SOURCE, "state.nope");
  const at = (text: string): number => unit.text.indexOf(text);

  test("puts an error at its place in the file", () => {
    const found = findingsIn(
      unit,
      [diagnostic({ code: 2339, length: 4, messageText: "no such member", start: at("nope") })],
      false,
    );
    expect(found).toEqual([
      {
        code: 2339,
        end: SOURCE.indexOf("nope") + 4,
        message: "no such member",
        start: SOURCE.indexOf("nope"),
      },
    ]);
  });

  test("leaves out what the author cannot act on", () => {
    const found = findingsIn(
      unit,
      [
        diagnostic({ category: 2, code: 80_001, messageText: "a suggestion", start: at("nope") }),
        diagnostic({ code: 2339, messageText: "no start", start: undefined }),
        diagnostic({ code: 2307, messageText: "Cannot find module 'x'", start: at("nope") }),
        diagnostic({ code: 2304, messageText: "in the module's own text", start: 0 }),
      ],
      false,
    );
    expect(found).toEqual([]);
  });

  test("gives an error with no length one character", () => {
    const [found] = findingsIn(
      unit,
      // SAFETY: the worker omits `length` on some diagnostics although the type says it is there.
      [
        {
          category: 1,
          code: 3,
          file: undefined,
          messageText: "c",
          start: at("nope"),
        } as Diagnostic,
      ],
      false,
    );
    expect(found!.end - found!.start).toBe(1);
  });

  test("draws a syntax error placed after the code at the end of that code", () => {
    const close = unit.text.lastIndexOf("}");
    const said = [diagnostic({ code: 1005, messageText: "'}' expected.", start: close })];
    const end = SOURCE.indexOf("state.nope = 1") + "state.nope = 1".length;
    expect(findingsIn(unit, said, true)).toEqual([
      { code: 1005, end, message: "'}' expected.", start: end },
    ]);
    // The same place is no type error: that would be about text the author did not write.
    expect(findingsIn(unit, said, false)).toEqual([]);
  });

  test("draws a syntax error placed before any code at the first thing written", () => {
    const said = [diagnostic({ code: 1109, messageText: "Expression expected.", start: 0 })];
    const first = SOURCE.indexOf("state.nope");
    expect(findingsIn(unit, said, true)).toEqual([
      { code: 1109, end: first, message: "Expression expected.", start: first },
    ]);
    // A module that holds nothing of the author's has nowhere to draw it.
    expect(findingsIn({ extension: ".ts", spans: [], text: "" }, said, true)).toEqual([]);
  });
});

describe("createSourceTypeCheck", () => {
  /** An editor that has the one thing a check asks of it, its model. */
  function editorWith(model: FakeTextModel | null): editor.IStandaloneCodeEditor {
    return Object.assign(Object.create(null), { getModel: () => model });
  }

  /** A check for `buffer`. */
  function check(
    over: Partial<Omit<SourceTypeCheckInit, "path">> = {},
    path: string | null = "pages/page.jxn",
  ) {
    const init: SourceTypeCheckInit = {
      editor: editorWith(buffer),
      id: "src1",
      key: "tab1",
      name: "page.jxn",
      wanted: () => true,
      ...over,
    };
    if (path !== null) {
      init.path = path;
    }
    return createSourceTypeCheck(init);
  }

  /** What the worker says of the module holding `text`: `word` is the error. */
  function say(
    where: Map<string, Diagnostic[]>,
    text: string,
    word: string,
    over: Pick<Diagnostic, "code" | "messageText">,
    source = SOURCE,
  ): void {
    const { name, unit } = unitWith(source, text);
    where.set(name, [diagnostic({ ...over, length: word.length, start: unit.text.indexOf(word) })]);
  }

  const NOPE = { code: 2339, messageText: "Property 'nope' does not exist on type 'State'." };
  const MISSING = { code: 2339, messageText: "Property 'missing' does not exist on type 'State'." };

  beforeEach(() => {
    markers.length = 0;
    created.length = 0;
    woke.length = 0;
    asks = 0;
    synced.length = 0;
    askedSemantic.length = 0;
    askedSyntactic.length = 0;
    buffer = new FakeTextModel(SOURCE);
    monacoLoaded = true;
    semantic = new Map();
    syntactic = new Map();
    whenAsked = null;
    whenSynced = null;
    worker = {
      getSemanticDiagnostics: (name) => {
        askedSemantic.push(name);
        return Promise.resolve(semantic.get(name) ?? []);
      },
      getSyntacticDiagnostics: (name) => {
        whenAsked?.();
        whenAsked = null;
        askedSyntactic.push(name);
        return Promise.resolve(syntactic.get(name) ?? []);
      },
    };
    resetNotifications();
  });

  test("hands the worker every module of the file, named as files beside each other", async () => {
    await check().run(SOURCE);
    const names = [
      `${FOLDER}page.jxn.ts`,
      `${FOLDER}page.jxn.1.ts`,
      `${FOLDER}page.jxn.2.ts`,
      `${FOLDER}page.jxn.3.ts`,
      `${FOLDER}page.jxn.4.js`,
    ];
    expect(created.map((model) => model.name)).toEqual(names);
    // Plain text, so Monaco's own checker never reads them.
    expect(new Set(created.map((model) => model.language))).toEqual(new Set(["plaintext"]));
    expect(created.map((model) => model.text)).toEqual(unitsOf(SOURCE).map((unit) => unit.text));
    expect(created[1]!.text).toContain('import type { State } from "./page.jxn";');
    expect(synced).toEqual([names]);
    expect(askedSyntactic).toEqual(names);
    expect(askedSemantic).toEqual(names);
    expect(markers.map((drawn) => drawn[2])).toEqual([[]]);
  });

  test("wakes Monaco's worker once, with a model that holds nothing and is gone", async () => {
    const handle = check();
    await handle.run(SOURCE);
    // Refused the first time it asked, as Monaco does while it sets the worker up, and asked again.
    expect(asks).toBe(2);
    expect(markers.map((drawn) => drawn[2])).toEqual([[]]);
    await handle.run(SOURCE.replace("count 0", "count 1"));
    expect(woke.map((model) => [model.language, model.text, model.disposed])).toEqual([
      ["typescript", "", true],
    ]);
  });

  test("draws an error where the author wrote it, and files it as a Problem", async () => {
    say(semantic, "state.nope", "nope", NOPE);
    await check().run(SOURCE);
    expect(markers).toHaveLength(1);
    const [model, owner, data] = markers[0]!;
    expect(model).toBe(buffer);
    expect(owner).toBe(TYPE_MARKER_OWNER);
    expect(data).toEqual([
      {
        code: "TS2339",
        endColumn: 29,
        endLineNumber: 5,
        message: "Property 'nope' does not exist on type 'State'.",
        severity: 8,
        source: "typescript",
        startColumn: 25,
        startLineNumber: 5,
      },
    ]);
    const [problem] = problemFindings(TYPE_PROBLEM_SOURCE);
    expect(problem).toMatchObject({
      detail: "In pages/page.jxn, line 5, column 25 (TS2339)",
      key: "types.tab1:source.0",
      message: "Property 'nope' does not exist on type 'State'.",
      path: "pages/page.jxn",
      severity: "error",
    });
  });

  test("reads the errors of every module down the file", async () => {
    // eslint-disable-next-line no-template-curly-in-string -- a template of the document under test
    say(semantic, "${state.missing}", "missing", MISSING);
    say(semantic, "state.nope", "nope", NOPE);
    await check().run(SOURCE);
    expect(markers[0]![2].map((marker) => marker.startLineNumber)).toEqual([5, 11]);
    expect(problemFindings(TYPE_PROBLEM_SOURCE).map((problem) => problem.detail)).toEqual([
      "In pages/page.jxn, line 5, column 25 (TS2339)",
      "In pages/page.jxn, line 11, column 16 (TS2339)",
    ]);
  });

  test("reports syntax errors alone while any module does not parse", async () => {
    say(syntactic, "state.count = 'a'", "'a'", { code: 1005, messageText: "';' expected." });
    say(semantic, "state.nope", "nope", NOPE);
    await check().run(SOURCE);
    expect(askedSemantic).toEqual([]);
    expect(markers[0]![2].map((marker) => [marker.code, marker.startLineNumber])).toEqual([
      ["TS1005", 9],
    ]);
  });

  test("checks against an open State where the project gives the document state", async () => {
    await check().run(SOURCE);
    await check({ id: "src2", outside: () => ({ state: true }) }).run(SOURCE);
    const mains = created.filter((model) => model.name.endsWith("/page.jxn.ts"));
    expect(mains.map((model) => model.text.includes("[key: string]: any;"))).toEqual([false, true]);
  });

  test("names the file in a message as its author does", async () => {
    // The module's name is the file's, spelled so a URI holds it; the message says the file's.
    const { name, unit } = unitWith(SOURCE, "state.nope");
    semantic.set(name.replace("page.jxn", "my_page.jxn"), [
      diagnostic({
        code: 2694,
        messageText: `Namespace '"${FOLDER}my_page.jxn"' has no exported member 'nope'.`,
        start: unit.text.indexOf("nope"),
      }),
    ]);
    await check({ name: "my page.jxn" }).run(SOURCE);
    expect(markers[0]![2][0]!.message).toBe(
      "Namespace '\"my page.jxn\"' has no exported member 'nope'.",
    );
  });

  test("names its modules with nothing a URI would escape", async () => {
    await check({ name: "my page.jxn" }).run(SOURCE);
    expect(created[0]!.name).toBe(`${FOLDER}my_page.jxn.ts`);
    expect(created[1]!.text).toContain('import type { State } from "./my_page.jxn";');
  });

  test("keeps its models between runs, writes only what changed, and drops what left", async () => {
    const handle = check();
    await handle.run(SOURCE);
    const before = created.length;
    const shorter = SOURCE.replace('        (fn)twice "return state.count * 2"\n', "");
    await handle.run(shorter);
    // One body fewer, so the template is the third module after the main one, under a new name.
    expect(created).toHaveLength(before + 1);
    expect(created.at(-1)!.name).toBe(`${FOLDER}page.jxn.3.js`);
    // The first body is the same text under the same name, and is not written again.
    expect(created[1]!.writes).toBe(0);
    expect(created[2]!.writes).toBe(1);
    expect(created.map((model) => model.disposed)).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
    ]);
    expect(synced[1]).toEqual([...synced[0]!.slice(0, 3), `${FOLDER}page.jxn.3.js`]);
    // And a module that comes back is made again.
    await handle.run(SOURCE);
    expect(created).toHaveLength(before + 3);
    expect(created[5]!.disposed).toBe(true);
  });

  test("replaces every Type check Problem of its tab, and no other tab's", async () => {
    const filed = { source: TYPE_PROBLEM_SOURCE, tier: "problem" } as const;
    notify.error("a body's", { ...filed, key: "types.tab1:state/bump.0" });
    notify.error("another tab's", { ...filed, key: "types.tab11:state/bump.0" });
    notify.error("another check's", { key: "types.tab1:lint.0", source: "Lint", tier: "problem" });
    const handle = check();
    say(semantic, "state.nope", "nope", NOPE);
    await handle.run(SOURCE);
    expect(problemFindings(TYPE_PROBLEM_SOURCE).map((problem) => problem.key)).toEqual([
      "types.tab11:state/bump.0",
      "types.tab1:source.0",
    ]);
    expect(problemFindings("Lint")).toHaveLength(1);
    semantic.clear();
    await handle.run(SOURCE);
    expect(markers.map((drawn) => drawn[2].length)).toEqual([1, 0]);
    expect(problemFindings(TYPE_PROBLEM_SOURCE).map((problem) => problem.key)).toEqual([
      "types.tab11:state/bump.0",
    ]);
  });

  test("says where a Problem is by the file's name when no path is known", async () => {
    say(semantic, "state.nope", "nope", NOPE);
    await check({}, null).run(SOURCE);
    const [problem] = problemFindings(TYPE_PROBLEM_SOURCE);
    expect(problem?.detail).toBe("In page.jxn, line 5, column 25 (TS2339)");
    expect(problem?.path).toBeUndefined();
  });

  test("marks a buffer that is not Jx Notation where it stops being one, with no Problem", async () => {
    const handle = check();
    say(semantic, "state.nope", "nope", NOPE);
    await handle.run(SOURCE);
    const text = '{ "tagName": "div" }';
    buffer.text = text;
    synced.length = 0;
    await handle.run(text);
    expect(synced).toEqual([]);
    const data = lastDrawn();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      endColumn: 2,
      endLineNumber: 1,
      severity: 8,
      source: "jx",
      startColumn: 1,
      startLineNumber: 1,
    });
    expect(data[0]!.code).toBeUndefined();
    expect(data[0]!.message).toContain("Unexpected token");
    // The document never takes such a buffer, so what the file said before is not kept either.
    expect(problemFindings(TYPE_PROBLEM_SOURCE)).toEqual([]);
  });

  test("drops an answer that is no longer wanted", async () => {
    say(semantic, "state.nope", "nope", NOPE);
    await check({ wanted: () => false }).run(SOURCE);
    await check({ wanted: () => false }).run("{");
    expect(markers).toEqual([]);
    expect(problemFindings(TYPE_PROBLEM_SOURCE)).toEqual([]);
  });

  test("drops the older of two overlapping runs", async () => {
    const handle = check();
    say(semantic, "state.nope", "nope", NOPE);
    const first = handle.run(SOURCE);
    const second = handle.run(SOURCE);
    await Promise.all([first, second]);
    expect(markers).toHaveLength(1);
    // The older one stopped before it asked the worker anything.
    expect(askedSyntactic).toHaveLength(5);
  });

  test("drops an answer that arrives after its editor went", async () => {
    const handle = check();
    say(semantic, "state.nope", "nope", NOPE);
    whenAsked = () => handle.dispose();
    await handle.run(SOURCE);
    // The one draw is the release's own, which clears.
    expect(markers.map((drawn) => drawn[2])).toEqual([[]]);
    expect(askedSemantic).toEqual([]);
    expect(problemFindings(TYPE_PROBLEM_SOURCE)).toEqual([]);
  });

  test("asks nothing of a worker whose editor went while it took the modules", async () => {
    const handle = check();
    whenSynced = () => handle.dispose();
    await handle.run(SOURCE);
    expect(synced).toHaveLength(1);
    expect(askedSyntactic).toEqual([]);
    expect(markers.map((drawn) => drawn[2])).toEqual([[]]);
  });

  test("drops an answer a newer run overtook while the worker was reading", async () => {
    const handle = check();
    say(semantic, "state.nope", "nope", NOPE);
    let second: Promise<void> | undefined;
    whenAsked = () => {
      semantic.clear();
      second = handle.run(SOURCE);
    };
    await handle.run(SOURCE);
    await second;
    expect(markers.map((drawn) => drawn[2].length)).toEqual([0]);
  });

  test("does nothing before Monaco has loaded", async () => {
    monacoLoaded = false;
    await check().run(SOURCE);
    expect(created).toEqual([]);
    expect(markers).toEqual([]);
  });

  test("draws nothing when the editor has lost its model", async () => {
    say(semantic, "state.nope", "nope", NOPE);
    await check({ editor: editorWith(null) }).run(SOURCE);
    expect(markers).toEqual([]);
    expect(problemFindings(TYPE_PROBLEM_SOURCE)).toEqual([]);
  });

  test("is released with its editor: markers and models, but not the Problems", async () => {
    const handle = check();
    say(semantic, "state.nope", "nope", NOPE);
    await handle.run(SOURCE);
    handle.dispose();
    handle.dispose();
    expect(created.every((model) => model.disposed)).toBe(true);
    expect(markers.at(-1)![2]).toEqual([]);
    expect(problemFindings(TYPE_PROBLEM_SOURCE)).toHaveLength(1);
    const draws = markers.length;
    await handle.run(SOURCE);
    expect(markers).toHaveLength(draws);
  });

  test("is released cleanly when it never ran, and when the editor's model is gone", () => {
    check().dispose();
    check({ editor: editorWith(null) }).dispose();
    expect(markers).toHaveLength(1);
  });
});
