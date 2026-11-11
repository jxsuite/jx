import { describe, expect, test } from "bun:test";
import {
  CLIENT_SCRIPT_REF,
  isScriptSpecifier,
  parseScriptSpecifier,
  qualifyScripts,
  SCRIPT_SPECIFIER_PREFIX,
  scriptRefSide,
  scriptSpecifier,
  SERVER_SCRIPT_REF,
} from "../src/document-scripts.ts";
import { parseJxn, serializeJxn } from "../src/jxn/index.ts";
import { validateDocument } from "../src/schema.ts";
import type { JxDocument } from "../types.ts";

describe("scriptRefSide", () => {
  test("names the side an authored reference means", () => {
    expect(scriptRefSide(CLIENT_SCRIPT_REF)).toBe("client");
    expect(scriptRefSide(SERVER_SCRIPT_REF)).toBe("server");
  });

  test("is null for every other $src", () => {
    expect(scriptRefSide("./counter.ts")).toBeNull();
    expect(scriptRefSide("npm:lodash")).toBeNull();
    expect(scriptRefSide("#clients")).toBeNull();
    expect(scriptRefSide("jx-script:a.jxn#client")).toBeNull();
  });
});

describe("scriptSpecifier", () => {
  test("names the document and the side", () => {
    expect(scriptSpecifier("components/counter.jxn", "client")).toBe(
      "jx-script:components/counter.jxn#client",
    );
    expect(scriptSpecifier("pages/index.json", "server")).toBe(
      `${SCRIPT_SPECIFIER_PREFIX}pages/index.json#server`,
    );
  });

  test("spells one document one way, whatever the platform wrote", () => {
    expect(scriptSpecifier(String.raw`components\forms\field.jxn`, "client")).toBe(
      "jx-script:components/forms/field.jxn#client",
    );
    expect(scriptSpecifier("./components/counter.jxn", "client")).toBe(
      scriptSpecifier("components/counter.jxn", "client"),
    );
  });
});

describe("parseScriptSpecifier", () => {
  test("reads back what scriptSpecifier wrote", () => {
    expect(parseScriptSpecifier(scriptSpecifier("layouts/base.jxn", "server"))).toEqual({
      path: "layouts/base.jxn",
      side: "server",
    });
    expect(parseScriptSpecifier("jx-script:a#b.jxn#client")).toEqual({
      path: "a#b.jxn",
      side: "client",
    });
  });

  test("is null for anything else", () => {
    expect(parseScriptSpecifier("./counter.ts")).toBeNull();
    expect(parseScriptSpecifier("#client")).toBeNull();
    expect(parseScriptSpecifier("jx-script:counter.jxn")).toBeNull();
    expect(parseScriptSpecifier("jx-script:#client")).toBeNull();
    expect(parseScriptSpecifier("jx-script:counter.jxn#worker")).toBeNull();
  });

  test("isScriptSpecifier reads only the prefix", () => {
    expect(isScriptSpecifier("jx-script:counter.jxn#client")).toBe(true);
    expect(isScriptSpecifier("#client")).toBe(false);
  });
});

describe("qualifyScripts", () => {
  const counter: JxDocument = {
    $script: {
      client: 'export function bump(state) { state.count += 1 } // $src: "#client"',
      server: "export async function history() { return [] }",
    },
    children: [
      {
        children: [
          {
            state: { nested: { $prototype: "Function", $src: "#client", $export: "bump" } },
            tagName: "span",
          },
        ],
        tagName: "div",
      },
      "text",
    ],
    state: {
      bump: { $prototype: "Function", $src: "#client" },
      count: 0,
      external: { $prototype: "Function", $src: "./counter.ts" },
      history: { $export: "history", $src: "#server", timing: "server" },
    },
    tagName: "my-counter",
  };

  test("gives every reference the document it was written in", () => {
    const qualified = qualifyScripts(counter, "components/counter.jxn");
    expect(qualified.state?.bump).toEqual({
      $prototype: "Function",
      $src: "jx-script:components/counter.jxn#client",
    });
    expect(qualified.state?.history).toEqual({
      $export: "history",
      $src: "jx-script:components/counter.jxn#server",
      timing: "server",
    });
    expect(JSON.stringify(qualified.children)).toContain(
      '"$src":"jx-script:components/counter.jxn#client"',
    );
  });

  test("leaves every other $src, and the script text, as written", () => {
    const qualified = qualifyScripts(counter, "components/counter.jxn");
    expect(qualified.state?.external).toBe(counter.state?.external);
    expect(qualified.$script).toBe(counter.$script);
    expect(qualified.state?.count).toBe(0);
  });

  test("does not change the document it was given", () => {
    const before = JSON.stringify(counter);
    qualifyScripts(counter, "components/counter.jxn");
    expect(JSON.stringify(counter)).toBe(before);
  });

  test("two documents with the same reference name two modules", () => {
    const page = qualifyScripts(counter, "pages/index.jxn");
    const layout = qualifyScripts(counter, "layouts/base.jxn");
    expect(page.state?.bump).not.toEqual(layout.state?.bump);
  });

  test("a document with nothing to qualify is returned as it is", () => {
    const plain: JxDocument = {
      children: [{ tagName: "p", textContent: "hi" }],
      state: { load: { $prototype: "Function", $src: "./load.ts" } },
      tagName: "div",
    };
    expect(qualifyScripts(plain, "pages/plain.json")).toBe(plain);
  });

  test("qualifying twice changes nothing", () => {
    const once = qualifyScripts(counter, "components/counter.jxn");
    expect(qualifyScripts(once, "somewhere/else.jxn")).toBe(once);
  });
});

describe("$script in Jx Notation", () => {
  test("a document's modules survive a round trip through .jxn", () => {
    const text = [
      "my-counter {",
      "    $script {",
      '        client #"""',
      '            import { clamp } from "./math.ts"',
      "            export function bump(state: { count: number }): void {",
      "                state.count = clamp(state.count + 1, 0, 10)",
      "            }",
      '            """#',
      '        server "export async function history() { return [] }"',
      "    }",
      "    state {",
      "        count 0",
      '        (fn)bump $src="#client"',
      "    }",
      "}",
      "",
    ].join("\n");
    const doc = parseJxn(text);
    expect(doc.$script).toEqual({
      client: [
        'import { clamp } from "./math.ts"',
        "export function bump(state: { count: number }): void {",
        "    state.count = clamp(state.count + 1, 0, 10)",
        "}",
      ].join("\n"),
      server: "export async function history() { return [] }",
    });
    expect(parseJxn(serializeJxn(doc))).toEqual(doc);
  });
});

describe("$script in the document schema", () => {
  test("a document carrying both modules validates", async () => {
    const result = await validateDocument({
      $script: {
        client: "export function bump(state) { state.count += 1 }",
        server: "export async function history() { return [] }",
      },
      state: {
        bump: { $prototype: "Function", $src: "#client" },
        count: 0,
        history: { $export: "history", $src: "#server", timing: "server" },
      },
      tagName: "my-counter",
    });
    expect(result.errors).toBeNull();
    expect(result.valid).toBe(true);
  });

  test("a module that is not text, or a third module, is refused", async () => {
    const notText = await validateDocument({ $script: { client: 1 }, tagName: "my-counter" });
    expect(notText.valid).toBe(false);
    const third = await validateDocument({ $script: { worker: "" }, tagName: "my-counter" });
    expect(third.valid).toBe(false);
  });
});
