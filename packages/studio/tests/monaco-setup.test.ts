/**
 * Monaco-setup wiring tests (E9). Monaco itself cannot load in happy-dom, so every entrypoint it
 * imports is mocked (`./monaco-setup-mocks`) and the test asserts the wiring: worker environment
 * registration and JX/project JSON schema registration on jsonDefaults — plus that the mock list
 * still matches the feature set the module declares.
 */
import "./harness";
import { describe, expect, mock, test } from "bun:test";
import { flattenSchema } from "@jxsuite/schema/project-schemas";
import jxSchema from "@jxsuite/schema/schema.json";
import { isNonNullObject } from "@jxsuite/schema/guards";
import type { DiagnosticsOptions } from "monaco-editor/languages/features/json/register";
import { installMonacoSetupMocks, MONACO_SETUP_ENTRIES } from "./monaco-setup-mocks";

const setDiagnosticsOptions = mock((_opts: DiagnosticsOptions) => {});

installMonacoSetupMocks({ jsonDefaults: { setDiagnosticsOptions } });

class FakeWorker {
  url: string;
  options: WorkerOptions | undefined;
  constructor(url: string, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
  }
}
// Plain assignment semantics, as `globalThis.Worker = …` would be: a recording stand-in.
Object.assign(globalThis, { Worker: FakeWorker });
if (typeof self === "undefined") {
  Object.assign(globalThis, { self: globalThis });
}

const { applyProjectSchemas, modelUriFor, resetProjectSchemas } =
  await import("../src/services/monaco-setup");

/** One entry of a `setDiagnosticsOptions` payload's `schemas` list. */
type SchemaRegistration = NonNullable<DiagnosticsOptions["schemas"]>[number];

/** The `schemas` list of a payload; every registration monaco-setup makes carries one. */
function registrations(opts: DiagnosticsOptions): readonly SchemaRegistration[] {
  if (!opts.schemas) {
    throw new Error("setDiagnosticsOptions was called without a schemas list");
  }
  return opts.schemas;
}

/** The registration at `index`, failing loudly rather than reading through `undefined`. */
function registrationAt(opts: DiagnosticsOptions, index: number): SchemaRegistration {
  const entry = registrations(opts)[index];
  if (!entry) {
    throw new Error(`no schema registration at index ${index}`);
  }
  return entry;
}

function diagnosticsArg(): DiagnosticsOptions {
  const [opts] = setDiagnosticsOptions.mock.calls[0]!;
  return opts;
}

function latestDiagnosticsArg(): DiagnosticsOptions {
  const call = setDiagnosticsOptions.mock.calls.at(-1)!;
  return call[0];
}

describe("monaco-setup — JSON diagnostics registration", () => {
  test("registers the bundled fallback once at import", () => {
    expect(setDiagnosticsOptions.mock.calls).toHaveLength(1);
    // The one registration is the shipped core schema, flattened for offline resolution.
    expect(registrationAt(diagnosticsArg(), 0).schema).toEqual(flattenSchema(jxSchema));
  });

  test("registers validation with comments disallowed", () => {
    const opts = diagnosticsArg();
    expect(opts.validate).toBe(true);
    expect(opts.allowComments).toBe(false);
    expect(opts.schemas).toHaveLength(4);
  });

  test("registers the JX document schema for document folders", () => {
    const jx = registrationAt(diagnosticsArg(), 0);
    expect(jx.uri).toBe("https://jxsuite.com/schema/v1");
    expect(jx.schema).toBeTruthy();
    expect(isNonNullObject(jx.schema)).toBe(true);
    for (const pattern of [
      "pages/*.json",
      "pages/**/*.json",
      "layouts/*.json",
      "layouts/**/*.json",
      "components/*.json",
      "components/**/*.json",
      "elements/*.json",
      "elements/**/*.json",
    ]) {
      expect(jx.fileMatch).toContain(pattern);
    }
  });

  test("registers the project schema for project.json", () => {
    const project = registrationAt(diagnosticsArg(), 1);
    expect(project.uri).toBe("https://jxsuite.com/schema/project/v1");
    expect(project.fileMatch).toEqual(["project.json"]);
    expect(project.schema).toBeTruthy();
  });

  /* The committed entry documents are bound by a RELATIVE in-document `$schema`
     (extensions.md §5.2), which the language service resolves against the model's own directory —
     every studio model is mounted at file:///<project-relative-path>, so project.json's
     "./project.schema.json" lands on the project root. An in-document `$schema` also OVERRIDES
     fileMatch, so without these ids registered the resolution has nothing to hit,
     `enableSchemaRequest` being off turns that into "No schema request service available", and the
     file validates against an empty schema. */
  test("registers the same schemas under the entry-document file:// ids", () => {
    const opts = diagnosticsArg();
    const documentByPattern = registrationAt(opts, 0);
    const projectByPattern = registrationAt(opts, 1);
    const projectById = registrationAt(opts, 2);
    const documentById = registrationAt(opts, 3);
    expect(projectById.uri).toBe("file:///project.schema.json");
    expect(projectById.schema).toBe(projectByPattern.schema);
    expect(documentById.uri).toBe("file:///document.schema.json");
    expect(documentById.schema).toBe(documentByPattern.schema);
  });

  test("the file:// registrations carry no fileMatch — they resolve by id only", () => {
    const byId = registrations(diagnosticsArg()).filter((s) => s.uri.startsWith("file:///"));
    expect(byId).toHaveLength(2);
    for (const entry of byId) {
      expect(entry.fileMatch).toBeUndefined();
    }
  });
});

describe("monaco-setup — MonacoEnvironment workers", () => {
  const getWorker = (label: string): FakeWorker => {
    const worker = self.MonacoEnvironment?.getWorker?.("", label);
    if (!(worker instanceof FakeWorker)) {
      throw new Error(`MonacoEnvironment.getWorker(${label}) did not construct a Worker`);
    }
    return worker;
  };

  /**
   * Workers resolve against the ENTRY, which `tests/with-dom.ts` anchors at the url the repo dev
   * server really serves it from. So the expected base is `dist/`, exactly as in a browser.
   *
   * This helper used to read `../src/services/workers/${file}` — module-relative — and that was the
   * bug rather than the contract: after the code-split `services/monaco-setup` is emitted into
   * `dist/chunks/`, so the shipped url pointed at `dist/chunks/workers/`, which no distribution has
   * ever staged.
   */
  const expected = (file: string) => `http://localhost:3000/packages/studio/dist/workers/${file}`;

  test("maps known labels to their worker bundles as module workers", () => {
    const json = getWorker("json");
    expect(json).toBeInstanceOf(FakeWorker);
    expect(json.url).toBe(expected("json.worker.js"));
    expect(json.options).toEqual({ type: "module" });

    expect(getWorker("typescript").url).toBe(expected("ts.worker.js"));
    expect(getWorker("javascript").url).toBe(expected("ts.worker.js"));
    expect(getWorker("editorWorkerService").url).toBe(expected("editor.worker.js"));
  });

  test("falls back to the editor worker for unknown labels", () => {
    expect(getWorker("made-up-label").url).toBe(expected("editor.worker.js"));
  });

  /* Regression guard for every packaged host, and it has caught two distinct bugs now.
     The root-absolute /monaco-editor/… path this started as resolved on the repo dev server alone,
     because that server serves bare specifiers out of the monorepo's node_modules. Its replacement,
     `new URL("workers/…", import.meta.url)`, then broke everywhere the moment `splitting: true`
     hoisted this module into dist/chunks/ — it began naming chunks/workers/, a directory nothing
     stages. Both failures are silent: a worker that never starts takes the whole JSON language
     service with it, schema validation included, and reports nothing.
     So the rule asserted here is the surviving one — resolve against the ENTRY, whose emitted path
     is a contract (studio.md §11.1) — and it is the only rule that holds for the repo dev server,
     views://studio/, the loopback /__studio__/ mount, AND the cloud's deep
     /edit/:owner/:repo@:branch shell path, where a document-relative url lands in /edit/:owner/. */
  test("worker urls are absolute, entry-relative, and never root-absolute or in chunks/", () => {
    for (const label of ["json", "typescript", "editorWorkerService", "made-up-label"]) {
      const { url } = getWorker(label);
      expect(url.startsWith("/monaco-editor/")).toBe(false);
      expect(new URL(url).href).toBe(url);
      expect(url).not.toContain("/chunks/");
      // Sibling of the ENTRY, not of this module and not of the document that loads it.
      const file = url.slice(url.lastIndexOf("/") + 1);
      expect(url).toBe(expected(file));
    }
  });
});

describe("monaco-setup — applyProjectSchemas", () => {
  const bundledDocumentSchema = registrationAt(diagnosticsArg(), 0).schema;
  const bundledProjectSchema = registrationAt(diagnosticsArg(), 1).schema;

  test("a null or empty payload leaves the bundled registration untouched", () => {
    const before = setDiagnosticsOptions.mock.calls.length;
    expect(applyProjectSchemas(null)).toBe(false);
    expect(applyProjectSchemas({})).toBe(false);
    expect(setDiagnosticsOptions.mock.calls.length).toBe(before);
  });

  test("registers fetched schemas inline, keeping fileMatch and uris stable", () => {
    const project = { allOf: [{ $ref: "https://jxsuite.com/schema/project/core/v2" }] };
    const documentSchema = { $ref: "https://jxsuite.com/schema/v1" };
    expect(applyProjectSchemas({ document: documentSchema, project })).toBe(true);
    const opts = latestDiagnosticsArg();
    expect(registrationAt(opts, 0).schema).toBe(documentSchema);
    expect(registrationAt(opts, 0).uri).toBe("https://jxsuite.com/schema/v1");
    expect(registrationAt(opts, 0).fileMatch).toContain("pages/**/*.json");
    expect(registrationAt(opts, 1).schema).toBe(project);
    expect(registrationAt(opts, 1).uri).toBe("https://jxsuite.com/schema/project/v1");
    expect(registrationAt(opts, 1).fileMatch).toEqual(["project.json"]);
    // The per-project pair must ALSO reach the ids the committed entry documents bind by,
    // Otherwise the `$schema` pointer keeps resolving to the core fallback.
    expect(registrationAt(opts, 2)).toEqual({
      schema: project,
      uri: "file:///project.schema.json",
    });
    expect(registrationAt(opts, 3)).toEqual({
      schema: documentSchema,
      uri: "file:///document.schema.json",
    });
  });

  test("a partial payload falls back to the bundled schema for the missing half", () => {
    const project = { type: "object" };
    expect(applyProjectSchemas({ project })).toBe(true);
    const opts = latestDiagnosticsArg();
    expect(registrationAt(opts, 0).schema).toBe(bundledDocumentSchema);
    expect(registrationAt(opts, 1).schema).toBe(project);
    expect(registrationAt(opts, 3).schema).toBe(bundledDocumentSchema);
  });

  /* Monaco's JSON adapter calls resetSchema(model.uri) when a model is disposed, which drops the
     inline content of the handle registered under the SAME id. Mounting the generated entry
     documents at their natural path would mean opening project.schema.json in the source view and
     closing it silently un-registers the project schema for the rest of the session. */
  test("the generated entry documents mount off the registered ids", () => {
    const ids = registrations(diagnosticsArg())
      .map((s) => s.uri)
      .filter((uri) => uri.startsWith("file:///"));
    for (const name of ["project.schema.json", "document.schema.json"]) {
      expect(modelUriFor(name)).toBe(`file:///.jx/generated/${name}`);
      expect(ids).not.toContain(modelUriFor(name));
      expect(ids).toContain(`file:///${name}`);
    }
  });

  test("every other file keeps its project-relative uri", () => {
    // The relative `$schema` of a document is resolved against THIS uri's directory, so the path
    // Has to stay faithful to where the file actually lives.
    expect(modelUriFor("project.json")).toBe("file:///project.json");
    expect(modelUriFor("pages/index.json")).toBe("file:///pages/index.json");
    expect(modelUriFor("pages/blog/post.json")).toBe("file:///pages/blog/post.json");
    // Only the project ROOT copies are reserved — a same-named file in a subfolder is not one.
    expect(modelUriFor("schemas/project.schema.json")).toBe("file:///schemas/project.schema.json");
  });

  test("resetProjectSchemas restores the bundled pair", () => {
    resetProjectSchemas();
    const opts = latestDiagnosticsArg();
    expect(registrationAt(opts, 0).schema).toBe(bundledDocumentSchema);
    expect(registrationAt(opts, 1).schema).toBe(bundledProjectSchema);
  });
});

/**
 * The declared feature set, checked against the doubles that stand in for it.
 *
 * Since 0.56 Studio DECLARES what the code editor can do — one `register` import per capability
 * (studio.md §11.1) — and a suite that imports `monaco-setup` must mock every one of them, because
 * real Monaco cannot load under happy-dom. Adding a feature and forgetting the double crashes some
 * unrelated suite with a DOM error that names nothing; this fails here, naming the specifier.
 */
describe("the declared Monaco feature set", () => {
  test("is exactly what ./monaco-setup-mocks doubles", async () => {
    const source = await Bun.file(
      new URL("../src/services/monaco-setup.ts", import.meta.url),
    ).text();
    const imported = new Set(
      [...source.matchAll(/(?:from|import)\s*\(?\s*"(monaco-editor[^"]*)"/g)].map((m) => m[1]!),
    );
    // Named both ways round, so the failure says which side to fix.
    const undoubled = [...imported].filter((s) => !MONACO_SETUP_ENTRIES.includes(s)).toSorted();
    const stale = MONACO_SETUP_ENTRIES.filter((s) => !imported.has(s)).toSorted();
    expect({ stale, undoubled }).toEqual({ stale: [], undoubled: [] });
  });

  test("registers the suggest WIDGET, not just the suggest provider", async () => {
    /* `features/suggest/register` registers the provider that renders suggest items as inline text;
       `contrib/suggest/browser/suggestController.js` is the widget, and `features/inlineCompletions/
       register` is the only public entry that reaches it. Drop that import and the JSON schema
       completions and the Logic tab's `state.*` completions both register and never appear — with
       no error anywhere. */
    const source = await Bun.file(
      new URL("../src/services/monaco-setup.ts", import.meta.url),
    ).text();
    expect(source).toContain('import "monaco-editor/features/inlineCompletions/register"');
  });
});
