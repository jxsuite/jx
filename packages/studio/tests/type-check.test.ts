/**
 * Type errors in a function body (`studio.md` §16.7): the worker's diagnostics for the wrapped body
 * become ranges of the body the author wrote, drawn as markers and filed as Problems. Monaco and
 * its worker cannot load under happy-dom, so both are doubled; the real pair is covered by the
 * Chrome pass in the pull request and by `packages/schema`'s `tsc` corpus test, which checks the
 * same file.
 */
import "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { IPosition, editor } from "monaco-editor";
import type { Diagnostic } from "monaco-editor/languages/features/typescript/register";
import type { JxElement } from "@jxsuite/schema/types";
import { generateBodyTypes } from "@jxsuite/schema/virtual-types";
import type { TypeCheckInit, TypeWorker } from "../src/services/type-check";

/** A TypeScript diagnostic with the members the service reads. */
function diagnostic(
  over: Partial<Diagnostic> & Pick<Diagnostic, "code" | "messageText" | "start">,
): Diagnostic {
  return { category: 1, file: undefined, length: 1, ...over };
}

const DOC: JxElement = { state: { a: 1 } };
const TARGET = { key: "a", kind: "state" } as const;

/** The text a fake model holds, with the position arithmetic Monaco does for it. */
class FakeTextModel {
  text: string;
  disposed = false;
  constructor(text: string) {
    this.text = text;
  }
  setValue(text: string): void {
    this.text = text;
  }
  dispose(): void {
    this.disposed = true;
  }
  getPositionAt(offset: number): IPosition {
    const before = this.text.slice(0, offset).split("\n");
    return { column: (before.at(-1) ?? "").length + 1, lineNumber: before.length };
  }
}

const markers: [FakeTextModel, string, editor.IMarkerData[]][] = [];
const created: FakeTextModel[] = [];
const buffer = new FakeTextModel("const n = 1;\nstate.nope = n;");
let monacoLoaded = true;
let worker: TypeWorker;
let semantic: Diagnostic[] = [];
let syntactic: Diagnostic[] = [];
const asked: string[] = [];
/** How often Monaco refuses its worker before handing it over, and how often it was asked. */
let refusals = 0;
let asks = 0;

void mock.module("../src/services/monaco-lazy", () => ({
  loadedMonaco: () =>
    monacoLoaded
      ? {
          MarkerSeverity: { Error: 8 },
          Uri: { parse: (value: string) => ({ toString: () => value }) },
          editor: {
            createModel: (text: string) => {
              const model = new FakeTextModel(text);
              created.push(model);
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
    if (refusals > 0) {
      refusals -= 1;
      // As Monaco refuses: with a string, before the language's mode has been set up.
      // eslint-disable-next-line prefer-promise-reject-errors -- what Monaco rejects with
      return Promise.reject("TypeScript not registered!");
    }
    return Promise.resolve(() => Promise.resolve(worker));
  },
}));

const {
  TYPE_MARKER_OWNER,
  TYPE_PROBLEM_SOURCE,
  createTypeCheck,
  findingsFor,
  outsideOfDocument,
  typeScriptWorker,
} = await import("../src/services/type-check");
const { problemFindings, resetNotifications } = await import("../src/services/notify");

describe("findingsFor", () => {
  const body = "const n = 1;\nstate.nope = n;";
  const unit = generateBodyTypes(DOC, TARGET, body);
  const at = (text: string): number => unit.text.indexOf(text);
  test("puts an error at its place in the body", () => {
    const found = findingsFor(
      unit,
      [],
      [diagnostic({ code: 2339, length: 4, messageText: "no such member", start: at("nope") })],
    );
    expect(found).toEqual([
      {
        code: 2339,
        end: body.indexOf("nope") + 4,
        message: "no such member",
        start: body.indexOf("nope"),
      },
    ]);
  });

  test("says nothing while the body does not parse", () => {
    const found = findingsFor(
      unit,
      [diagnostic({ category: 1, code: 1005, messageText: "';' expected", start: at("nope") })],
      [diagnostic({ code: 2339, messageText: "downstream noise", start: at("nope") })],
    );
    expect(found).toEqual([]);
  });

  test("leaves out what the author cannot act on", () => {
    const found = findingsFor(
      unit,
      [],
      [
        diagnostic({ category: 2, code: 80_001, messageText: "a suggestion", start: at("nope") }),
        diagnostic({ code: 2339, messageText: "no start", start: undefined }),
        diagnostic({ code: 2307, messageText: "Cannot find module 'x'", start: at("nope") }),
        diagnostic({ code: 2792, messageText: "Cannot find module 'y'", start: at("nope") }),
        diagnostic({ code: 2304, messageText: "in the wrapper", start: 0 }),
      ],
    );
    expect(found).toEqual([]);
  });

  test("gives a range with no length one character, and never runs past the body", () => {
    const [one, past] = findingsFor(
      unit,
      [],
      [
        diagnostic({ code: 1, messageText: "a", start: at("nope") }),
        diagnostic({ code: 2, length: 500, messageText: "b", start: at("nope") }),
      ],
    );
    expect(one!.end - one!.start).toBe(1);
    expect(past!.end).toBe(body.length);
    const [unmeasured] = findingsFor(
      unit,
      [],
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
    );
    expect(unmeasured!.end - unmeasured!.start).toBe(1);
  });

  test("lays a chained explanation out one line per link, indented", () => {
    const [found] = findingsFor(
      unit,
      [],
      [
        diagnostic({
          code: 2322,
          messageText: {
            category: 1,
            code: 2322,
            messageText: "Type 'string' is not assignable to type 'number'.",
            next: [
              {
                category: 1,
                code: 2,
                messageText: "because of this",
                next: [{ category: 1, code: 3, messageText: "and of this" }],
              },
            ],
          },
          start: at("nope"),
        }),
      ],
    );
    expect(found!.message).toBe(
      "Type 'string' is not assignable to type 'number'.\n  because of this\n    and of this",
    );
  });
});

describe("typeScriptWorker", () => {
  /** Run `fn` with every wait over at once. */
  async function withNoWaiting<T>(fn: () => Promise<T>): Promise<T> {
    const real = globalThis.setTimeout;
    const immediate = (callback: () => void): number => {
      queueMicrotask(callback);
      return 0;
    };
    // SAFETY: the one caller inside `fn` passes a callback and drops the handle it is given.
    globalThis.setTimeout = immediate as typeof setTimeout;
    try {
      return await fn();
    } finally {
      globalThis.setTimeout = real;
    }
  }

  beforeEach(() => {
    asks = 0;
    refusals = 0;
    worker = {
      getSemanticDiagnostics: () => Promise.resolve([]),
      getSyntacticDiagnostics: () => Promise.resolve([]),
    };
  });

  test("hands over the worker Monaco has set up", async () => {
    const forModel = await typeScriptWorker();
    const held: TypeWorker = await forModel();
    expect(held).toBe(worker);
    expect(asks).toBe(1);
  });

  test("asks again where Monaco refuses, until the worker is there", async () => {
    refusals = 2;
    const forModel = await typeScriptWorker();
    const held: TypeWorker = await forModel();
    expect(held).toBe(worker);
    expect(asks).toBe(3);
  });

  test("gives up with what Monaco said, where the worker never comes", async () => {
    refusals = Number.POSITIVE_INFINITY;
    const said = await withNoWaiting(() => typeScriptWorker().catch((error: string) => error));
    expect(said).toBe("TypeScript not registered!");
    // The first asking, and every one of the two hundred after it.
    expect(asks).toBe(201);
  });
});

describe("outsideOfDocument", () => {
  const config = { defaults: { layout: "./layouts/base.json" }, state: { shared: 1 } };

  test("is what the project gives a page, a layout and a component", () => {
    expect(outsideOfDocument("pages/index.json", config)).toEqual({ layout: true, state: true });
    expect(outsideOfDocument("./pages/blog/post.jxn", config)).toEqual({
      layout: true,
      state: true,
    });
    expect(outsideOfDocument("layouts/base.json", config)).toEqual({ state: true, wraps: true });
    expect(outsideOfDocument("components/site-card.jxn", config)).toEqual({});
    expect(outsideOfDocument("pages/index.json", {})).toEqual({ layout: false, state: false });
  });

  test("is nothing for a document with no path, or open in no project", () => {
    expect(outsideOfDocument(null, config)).toEqual({});
    expect(outsideOfDocument("pages/index.json", null)).toEqual({});
    expect(outsideOfDocument(undefined, null)).toEqual({});
  });
});

describe("createTypeCheck", () => {
  /** An editor that has the one thing a check asks of it, its model. */
  function editorWith(model: FakeTextModel | null): editor.IStandaloneCodeEditor {
    return Object.assign(Object.create(null), { getModel: () => model });
  }

  /** A check for `buffer`, in a document that has not changed. */
  function check(
    over: Partial<Omit<TypeCheckInit, "path">> = {},
    path: string | null = "pages/index.json",
  ) {
    const init: TypeCheckInit = {
      document: () => DOC,
      editor: editorWith(buffer),
      id: "fn1",
      key: "tab1:state/a",
      label: "state.a",
      target: TARGET,
      wanted: () => true,
      ...over,
    };
    if (path !== null) {
      init.path = path;
    }
    return createTypeCheck(init);
  }

  const nope = (): Diagnostic => {
    const unit = generateBodyTypes(DOC, TARGET, buffer.text);
    return diagnostic({
      code: 2339,
      length: 4,
      messageText: "Property 'nope' does not exist on type 'State'.",
      start: unit.text.indexOf("nope"),
    });
  };

  beforeEach(() => {
    markers.length = 0;
    created.length = 0;
    asked.length = 0;
    asks = 0;
    refusals = 0;
    monacoLoaded = true;
    semantic = [];
    syntactic = [];
    worker = {
      getSemanticDiagnostics: (name) => {
        asked.push(name);
        return Promise.resolve(semantic);
      },
      getSyntacticDiagnostics: () => Promise.resolve(syntactic),
    };
    resetNotifications();
  });

  test("draws an error on the buffer at its line and column, and files it as a Problem", async () => {
    semantic = [nope()];
    await check().run(buffer.text);
    expect(created.map((model) => model.text.includes("state.nope"))).toEqual([true]);
    expect(asked).toEqual(["file:///jx-virtual/fn1.ts"]);
    expect(markers).toHaveLength(1);
    const [model, owner, data] = markers[0]!;
    expect(model).toBe(buffer);
    expect(owner).toBe(TYPE_MARKER_OWNER);
    expect(data).toEqual([
      {
        code: "TS2339",
        endColumn: 11,
        endLineNumber: 2,
        message: "Property 'nope' does not exist on type 'State'.",
        severity: 8,
        source: "typescript",
        startColumn: 7,
        startLineNumber: 2,
      },
    ]);
    const [problem] = problemFindings(TYPE_PROBLEM_SOURCE);
    expect(problem).toMatchObject({
      detail: "In state.a, line 2, column 7 (TS2339)",
      key: "types.tab1:state/a.0",
      message: "Property 'nope' does not exist on type 'State'.",
      path: "pages/index.json",
      severity: "error",
    });
  });

  test("checks the body against an open State where the project gives the document state", async () => {
    await check().run(buffer.text);
    await check({ outside: () => ({ state: true }) }).run(buffer.text);
    expect(created.map((model) => model.text.includes("[key: string]: any;"))).toEqual([
      false,
      true,
    ]);
  });

  test("replaces the last run's markers and Problems, and reuses its file", async () => {
    const handle = check();
    semantic = [nope()];
    await handle.run(buffer.text);
    semantic = [];
    await handle.run(buffer.text);
    expect(created).toHaveLength(1);
    expect(markers.map((drawn) => drawn[2].length)).toEqual([1, 0]);
    expect(problemFindings(TYPE_PROBLEM_SOURCE)).toEqual([]);
  });

  test("files nothing when no path is known", async () => {
    semantic = [nope()];
    await check({}, null).run(buffer.text);
    expect(problemFindings(TYPE_PROBLEM_SOURCE)[0]?.path).toBeUndefined();
  });

  test("keeps another editor's Problems", async () => {
    semantic = [nope()];
    await check({ key: "tab1:state/a" }).run(buffer.text);
    await check({ key: "tab1:state/b" }).run(buffer.text);
    expect(problemFindings(TYPE_PROBLEM_SOURCE).map((p) => p.key)).toEqual([
      "types.tab1:state/a.0",
      "types.tab1:state/b.0",
    ]);
  });

  test("drops an answer that is no longer wanted", async () => {
    semantic = [nope()];
    await check({ wanted: () => false }).run(buffer.text);
    expect(markers).toEqual([]);
    expect(problemFindings(TYPE_PROBLEM_SOURCE)).toEqual([]);
  });

  test("drops the older of two overlapping runs", async () => {
    const handle = check();
    semantic = [nope()];
    const first = handle.run(buffer.text);
    semantic = [];
    const second = handle.run(buffer.text);
    await Promise.all([first, second]);
    expect(markers.map((drawn) => drawn[2].length)).toEqual([0]);
  });

  test("says nothing about a body that does not parse", async () => {
    syntactic = [diagnostic({ code: 1005, messageText: "';' expected", start: 0 })];
    semantic = [nope()];
    await check().run(buffer.text);
    expect(markers[0]![2]).toEqual([]);
  });

  test("does nothing before Monaco has loaded, or with no document", async () => {
    monacoLoaded = false;
    await check().run(buffer.text);
    monacoLoaded = true;
    await check({ document: () => null }).run(buffer.text);
    expect(created).toEqual([]);
    expect(markers).toEqual([]);
  });

  test("draws nothing when the editor has lost its model", async () => {
    semantic = [nope()];
    await check({
      editor: editorWith(null),
    }).run(buffer.text);
    expect(markers).toEqual([]);
  });

  test("a reopened body replaces the Problems its last editor left", async () => {
    semantic = [nope()];
    await check({ id: "fn1" }).run(buffer.text);
    semantic = [];
    await check({ id: "fn2" }).run(buffer.text);
    expect(problemFindings(TYPE_PROBLEM_SOURCE)).toEqual([]);
  });

  test("is released with its editor: markers and file, but not the Problems", async () => {
    const handle = check();
    semantic = [nope()];
    await handle.run(buffer.text);
    handle.dispose();
    handle.dispose();
    expect(created[0]!.disposed).toBe(true);
    expect(markers.at(-1)![2]).toEqual([]);
    expect(problemFindings(TYPE_PROBLEM_SOURCE)).toHaveLength(1);
    const draws = markers.length;
    await handle.run(buffer.text);
    expect(markers).toHaveLength(draws);
  });

  test("is released cleanly when it never ran, and when the editor's model is gone", () => {
    check().dispose();
    check({
      editor: editorWith(null),
    }).dispose();
    expect(markers).toHaveLength(1);
  });
});
