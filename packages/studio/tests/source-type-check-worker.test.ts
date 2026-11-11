/**
 * The Code view's type check over Monaco's own TypeScript worker (`studio.md` §16.7).
 *
 * `source-type-check.test.ts` doubles the worker, so it cannot say whether the modules written for
 * a file are a program TypeScript can read: whether a body's `import type { State } from
 * "./page.jxn"` resolves to the model beside it, whether a template's `.js` module is checked at
 * all, whether a syntax error stops the type errors. This suite answers that with the class Monaco
 * runs in its worker, constructed here on the main thread over the models the service made, and
 * with the compiler options `monaco-setup.ts` gives it. Only the editor around the worker is
 * doubled.
 */
import "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { IPosition, editor } from "monaco-editor";
import type { SourceTypeCheckInit } from "../src/services/source-type-check";
import type { TypeWorker } from "../src/services/type-check";

/** What the worker reads of a URI: its path, to tell a library file, and its text form. */
interface MirrorUri {
  path: string;
  toString: () => string;
}

/** A model as the worker sees one: Monaco's mirror of a model on the main thread. */
class MirrorModel {
  text: string;
  uri: MirrorUri;
  version = 1;
  constructor(text: string, name: string) {
    this.text = text;
    this.uri = { path: new URL(name).pathname, toString: () => name };
  }
  getValue(): string {
    return this.text;
  }
  setValue(text: string): void {
    this.text = text;
    this.version += 1;
  }
  dispose(): void {
    mirrored.delete(this);
  }
  getPositionAt(offset: number): IPosition {
    const before = this.text.slice(0, offset).split("\n");
    return { column: (before.at(-1) ?? "").length + 1, lineNumber: before.length };
  }
}

/** The members of Monaco's worker class this suite constructs it with. */
interface WorkerHost {
  getMirrorModels: () => MirrorModel[];
}
interface WorkerOptions {
  compilerOptions: object;
  extraLibs: object;
}
interface WorkerModule {
  TypeScriptWorker: new (host: WorkerHost, options: WorkerOptions) => TypeWorker;
}

/** Every model the service holds, which is every file of the worker's program. */
const mirrored = new Set<MirrorModel>();
const markers: editor.IMarkerData[][] = [];
/** Whether Monaco has met a model of the worker's language, which is when it sets the worker up. */
let woken = false;

/** As `monaco-setup.ts` sets them, in the numbers its enums stand for (`monaco-setup.test.ts`). */
const COMPILER_OPTIONS = {
  allowNonTsExtensions: true,
  module: 99,
  moduleResolution: 2,
  noEmit: true,
  noImplicitAny: false,
  skipLibCheck: true,
  strict: true,
  target: 99,
};

// A variable, so the compiler does not look for declarations the module does not ship.
const WORKER_ENTRY = "monaco-editor/languages/features/typescript/tsWorker";
// SAFETY: the module ships no declarations; this is the class `ts.worker.js` hands its host, and
// The members named here are the ones it is constructed with and the two the service calls.
const { TypeScriptWorker } = (await import(WORKER_ENTRY)) as WorkerModule;
const worker = new TypeScriptWorker(
  { getMirrorModels: () => [...mirrored] },
  { compilerOptions: COMPILER_OPTIONS, extraLibs: {} },
);

void mock.module("../src/services/monaco-lazy", () => ({
  loadedMonaco: () => ({
    MarkerSeverity: { Error: 8 },
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    editor: {
      createModel: (text: string, language: string, uri?: { toString: () => string }) => {
        if (!uri) {
          // The model the service wakes the worker with: no file of any program.
          woken ||= language === "typescript";
          return { dispose: () => {} };
        }
        const model = new MirrorModel(text, uri.toString());
        mirrored.add(model);
        return model;
      },
      setModelMarkers: (_model: MirrorModel, _owner: string, data: editor.IMarkerData[]) => {
        markers.push(data);
      },
    },
  }),
}));
void mock.module("monaco-editor/languages/features/typescript/register", () => ({
  getTypeScriptWorker: () =>
    woken
      ? Promise.resolve(() => Promise.resolve(worker))
      : // eslint-disable-next-line prefer-promise-reject-errors -- what Monaco rejects with
        Promise.reject("TypeScript not registered!"),
}));

const { createSourceTypeCheck } = await import("../src/services/source-type-check");
const { resetNotifications } = await import("../src/services/notify");

/** One error as the author sees it: its code, and the text of the file it is drawn under. */
interface Drawn {
  code: string;
  under: string;
}

/** A Code view open on a file, checked as it is typed. */
interface Opened {
  dispose: () => void;
  /** Put `text` in the buffer, check it, and say what is drawn on it afterwards. */
  type: (text: string) => Promise<Drawn[]>;
}

/** Open a Code view the way `canvas-render.ts` does, over a buffer this suite can type into. */
function open(id: string): Opened {
  const buffer = new MirrorModel("", "file:///pages/page.jxn");
  const init: SourceTypeCheckInit = {
    // A check asks its editor for the model and nothing else.
    editor: Object.assign(Object.create(null), { getModel: () => buffer }),
    id,
    key: "tab1",
    name: "page.jxn",
    path: "pages/page.jxn",
    wanted: () => true,
  };
  const check = createSourceTypeCheck(init);
  return {
    dispose: () => check.dispose(),
    type: async (text) => {
      buffer.setValue(text);
      await check.run(text);
      const lines = text.split("\n");
      return (markers.at(-1) ?? []).map((marker) => ({
        code: String(marker.code),
        under:
          marker.startLineNumber === marker.endLineNumber
            ? (lines[marker.startLineNumber - 1] ?? "").slice(
                marker.startColumn - 1,
                marker.endColumn - 1,
              )
            : `lines ${String(marker.startLineNumber)} to ${String(marker.endLineNumber)}`,
      }));
    },
  };
}

/** Check one text and close the view again. */
async function drawnOn(source: string, id: string): Promise<Drawn[]> {
  const view = open(id);
  const drawn = await view.type(source);
  view.dispose();
  return drawn;
}

const file = (...lines: string[]): string => ["/- kdl-version 2", ...lines, ""].join("\n");

beforeEach(() => {
  markers.length = 0;
  resetNotifications();
});

const DOCUMENT = [
  "div {",
  '  script #"""',
  "    export const double = (state: State) => state.count * 2;",
  '    """#',
  "  state {",
  "    count 0",
  "    (export)double",
  '    (fn)bump "state.count += 1"',
  "  }",
  '  button "Go" onclick=(ref)"#/state/bump"',
  // eslint-disable-next-line no-template-curly-in-string -- a template of the document under test
  '  p "${state.count} doubled is ${state.double}"',
  "}",
];

/** {@link DOCUMENT} with one stretch of it written differently. */
function documentWith(was: string, now: string): string {
  const text = file(...DOCUMENT);
  if (!text.includes(was)) {
    throw new Error(`the document does not hold ${was}`);
  }
  return text.replace(was, now);
}

describe("Monaco's worker over the modules of a file", () => {
  test("has nothing to say of a file that is right", async () => {
    expect(await drawnOn(file(...DOCUMENT), "ok")).toEqual([]);
    // Every module was one of its program, and each is dropped with the view.
    expect(mirrored.size).toBe(0);
  });

  test("finds a type error in a script, a body, a reference and a template", async () => {
    const source = file(...DOCUMENT)
      .replace("state.count * 2", "state.count.nope")
      .replace("state.count += 1", "state.count = 'a'")
      .replace("#/state/bump", "#/state/absent")
      .replace("state.double}", "state.missing}");
    expect(await drawnOn(source, "each")).toEqual([
      { code: "TS2339", under: "nope" },
      { code: "TS2322", under: "state.count" },
      { code: "TS2339", under: "absent" },
      { code: "TS2339", under: "missing" },
    ]);
  });

  test("reads a body against the State the script and the file's own state make", async () => {
    // `double` is what the script's function answers: a number, which has no length.
    const source = documentWith("state.count += 1", "state.count = state.double.length");
    expect(await drawnOn(source, "state")).toEqual([{ code: "TS2339", under: "length" }]);
  });

  test("reports a syntax error alone, at the end of the code that did not close", async () => {
    const source = documentWith("state.count += 1", "if (state.nope) { state.count = 'a'");
    expect(await drawnOn(source, "syntax")).toEqual([{ code: "TS1005", under: "" }]);
  });

  test("follows the buffer as it is typed", async () => {
    const view = open("typed");
    const wrong = documentWith("state.count += 1", "state.count = 'a'");
    expect(await view.type(wrong)).toEqual([{ code: "TS2322", under: "state.count" }]);
    expect(await view.type(file(...DOCUMENT))).toEqual([]);
    // A change to the script is a change to every module that reads `State` from it.
    const renamed = documentWith("const double", "const twice");
    expect(await view.type(renamed)).toEqual([{ code: "TS2694", under: "double" }]);
    // And the message names the file as its author knows it.
    expect(markers.at(-1)?.[0]?.message).toBe(
      "Namespace '\"page.jxn\"' has no exported member 'double'.",
    );
    view.dispose();
  });
});
