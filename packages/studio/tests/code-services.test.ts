import { installMockPlatform } from "./harness";
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { isNonNullObject } from "@jxsuite/schema/guards";
import type { editor } from "monaco-editor";
import type { StudioPlatform } from "../src/types";

import {
  codeService,
  locateDocument,
  fetchPluginSchema,
  pluginSchemaCache,
  setLintMarkers,
  getFunctionArgs,
} from "../src/services/code-services";
import type { OxLintDiagnostic } from "../src/services/code-services";

const setModelMarkers = mock(
  (_model: editor.ITextModel, _owner: string, _markers: editor.IMarkerData[]) => {},
);

// Mock monaco-editor
void mock.module("monaco-editor/editor", () => ({
  MarkerSeverity: { Error: 8, Warning: 4 },
  Uri: { parse: (url: string) => ({ toString: () => url }) },
  editor: { setModelMarkers },
}));

/** The markers argument of the most recent `setModelMarkers` call. */
function lastMarkers(): editor.IMarkerData[] {
  const call = setModelMarkers.mock.calls.at(-1);
  if (!call) {
    throw new Error("setModelMarkers was never called");
  }
  return call[2];
}

/**
 * An editor showing `model`. setLintMarkers calls nothing on the editor but `getModel()`, so the
 * stub supplies that one member.
 */
function editorShowing(model: editor.ITextModel | null): editor.IStandaloneCodeEditor {
  const stub: Pick<editor.IStandaloneCodeEditor, "getModel"> = { getModel: () => model };
  // SAFETY: setLintMarkers reads only `getModel()` from its editor argument, which the stub supplies.
  return stub as editor.IStandaloneCodeEditor;
}

/* SAFETY: setLintMarkers never reads a model member; it only hands the model, by identity, to
   `setModelMarkers`, which the monaco mock above replaces with a recorder. */
const MODEL = {} as editor.ITextModel;

// ─── codeService ────────────────────────────────────────────────────────────

// `setLintMarkers` reads the loaded Monaco namespace synchronously — in production it is only
// Reachable with an editor already mounted, so prime the lazy loader here (the module is mocked
// Above, so this resolves immediately).
beforeAll(async () => {
  const { loadMonaco } = await import("../src/services/monaco-lazy");
  await loadMonaco();
});

describe("codeService", () => {
  test("relays a null answer from platform.codeService", async () => {
    installMockPlatform();
    const result = await codeService("lint", { code: "x" });
    expect(result).toBeNull();
  });

  test("delegates to platform.codeService", async () => {
    const mockFn = mock<StudioPlatform["codeService"]>(async () => ({ diagnostics: [] }));
    installMockPlatform({ codeService: mockFn });
    const result = await codeService("lint", { code: "x" });
    expect(result).toEqual({ diagnostics: [] });
    expect(mockFn).toHaveBeenCalledWith("lint", { code: "x" });
  });
});

// ─── locateDocument ─────────────────────────────────────────────────────────

describe("locateDocument", () => {
  test("relays a null answer from platform.locateFile", async () => {
    installMockPlatform();
    const result = await locateDocument("page.json");
    expect(result).toBeNull();
  });

  test("delegates to platform.locateFile", async () => {
    const mockFn = mock<StudioPlatform["locateFile"]>(async () => "pages/page.json");
    installMockPlatform({ locateFile: mockFn });
    const result = await locateDocument("page.json");
    expect(result).toBe("pages/page.json");
    expect(mockFn).toHaveBeenCalledWith("page.json");
  });
});

// ─── fetchPluginSchema ──────────────────────────────────────────────────────

describe("fetchPluginSchema", () => {
  beforeEach(() => {
    pluginSchemaCache.clear();
  });

  test("returns null when def has no $src", async () => {
    installMockPlatform();
    const result = await fetchPluginSchema({ $prototype: "Foo" }, {});
    expect(result).toBeNull();
  });

  test("returns null when def has no $prototype", async () => {
    installMockPlatform();
    const result = await fetchPluginSchema({ $src: "./foo.js" }, {});
    expect(result).toBeNull();
  });

  test("caches null when the platform has no schema for the module", async () => {
    installMockPlatform();
    const result = await fetchPluginSchema({ $prototype: "Foo", $src: "./foo.js" }, {});
    expect(result).toBeNull();
    expect(pluginSchemaCache.get("./foo.js::Foo")).toBeNull();
  });

  test("fetches and caches schema from platform", async () => {
    const schema = { properties: { url: { type: "string" } } };
    const mockFn = mock<StudioPlatform["fetchPluginSchema"]>(async () => schema);
    installMockPlatform({ fetchPluginSchema: mockFn });
    const result = await fetchPluginSchema(
      { $prototype: "DataSource", $src: "./DataSource.class.json" },
      { documentPath: "pages/index.json" },
    );
    expect(result).toEqual(schema);
    expect(pluginSchemaCache.get("./DataSource.class.json::DataSource")).toEqual(schema);
  });

  test("returns cached schema on second call", async () => {
    const schema = { properties: {} };
    const mockFn = mock<StudioPlatform["fetchPluginSchema"]>(async () => schema);
    installMockPlatform({ fetchPluginSchema: mockFn });
    const def = { $prototype: "Cached", $src: "./cached.js" };
    const first = await fetchPluginSchema(def, {});
    const second = await fetchPluginSchema(def, {});
    expect(first).toBe(schema);
    expect(second).toBe(schema);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  test("caches null on error", async () => {
    const mockFn = mock<StudioPlatform["fetchPluginSchema"]>(async () => {
      throw new Error("network");
    });
    installMockPlatform({ fetchPluginSchema: mockFn });
    const def = { $prototype: "Err", $src: "./err.js" };
    const result = await fetchPluginSchema(def, {});
    expect(result).toBeNull();
    expect(pluginSchemaCache.get("./err.js::Err")).toBeNull();
  });
});

// ─── setLintMarkers ─────────────────────────────────────────────────────────

describe("setLintMarkers", () => {
  test("does nothing when editor has no model", () => {
    setModelMarkers.mockClear();
    setLintMarkers(editorShowing(null), []);
    expect(setModelMarkers.mock.calls).toEqual([]);
  });

  test("sets markers from diagnostics", () => {
    const diagnostics: OxLintDiagnostic[] = [
      {
        code: "no-unused-vars",
        help: "Remove it",
        labels: [{ span: { column: 3, length: 4, line: 5 } }],
        message: "Unused variable",
        severity: "error",
      },
    ];
    setLintMarkers(editorShowing(MODEL), diagnostics);
    const call = setModelMarkers.mock.calls.at(-1);
    expect(call?.[0]).toBe(MODEL);
    expect(call?.[1]).toBe("oxlint");
    const [marker] = lastMarkers();
    expect(marker?.message).toBe("Unused variable\nRemove it");
    expect(marker?.startLineNumber).toBe(5);
    expect(marker?.startColumn).toBe(3);
    expect(marker?.endColumn).toBe(7);
    expect(marker?.severity).toBe(8); // Error
  });

  test("handles warning severity", () => {
    const diagnostics: OxLintDiagnostic[] = [
      {
        code: "prefer-const",
        labels: [{ span: { column: 1, length: 3, line: 1 } }],
        message: "Prefer const",
        severity: "warning",
        url: "https://docs.example.com",
      },
    ];
    setLintMarkers(editorShowing(MODEL), diagnostics);
    const [marker] = lastMarkers();
    expect(marker?.severity).toBe(4); // Warning
    const code = marker?.code;
    if (!isNonNullObject(code)) {
      throw new Error("expected the linked form of the rule code");
    }
    expect(code.value).toBe("prefer-const");
    expect(code.target.toString()).toBe("https://docs.example.com");
  });

  test("filters diagnostics without labels", () => {
    const diagnostics: OxLintDiagnostic[] = [
      { labels: [], message: "No labels", severity: "error" },
      { message: "Absent labels", severity: "error" },
      {
        code: "x",
        labels: [{ span: { column: 1, length: 1, line: 1 } }],
        message: "With label",
        severity: "error",
      },
    ];
    setLintMarkers(editorShowing(MODEL), diagnostics);
    const markers = lastMarkers();
    expect(markers.length).toBe(1);
    expect(markers[0]?.message).toBe("With label");
  });
});

// ─── getFunctionArgs ────────────────────────────────────────────────────────

describe("getFunctionArgs", () => {
  test("returns parameters from state def", () => {
    const editing = { defName: "onClick", type: "def" };
    const document = {
      state: { onClick: { parameters: ["state", "event", "el"] } },
    };
    expect(getFunctionArgs(editing, document)).toEqual(["state", "event", "el"]);
  });

  test("returns default when state def has no parameters", () => {
    const editing = { defName: "handler", type: "def" };
    const document = { state: { handler: {} } };
    expect(getFunctionArgs(editing, document)).toEqual(["state", "event"]);
  });

  test("returns default when state def not found", () => {
    const editing = { defName: "missing", type: "def" };
    const document = { state: {} };
    expect(getFunctionArgs(editing, document)).toEqual(["state", "event"]);
  });

  test("returns parameters from event node", () => {
    const editing = {
      eventKey: "onclick",
      path: ["children", 0],
      type: "event",
    };
    const document = { children: [{ onclick: { parameters: ["state"] } }] };
    expect(getFunctionArgs(editing, document)).toEqual(["state"]);
  });

  test("returns default for unknown editing type", () => {
    const editing = { type: "unknown" };
    const document = {};
    expect(getFunctionArgs(editing, document)).toEqual(["state", "event"]);
  });
});
