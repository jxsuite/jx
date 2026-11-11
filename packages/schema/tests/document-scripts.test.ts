import { describe, expect, test } from "bun:test";
import {
  CLIENT_SCRIPT_REF,
  findScriptAdvice,
  isRelativeScriptSrc,
  isScriptSpecifier,
  isTypeScriptPath,
  parseScriptSpecifier,
  qualifyScripts,
  SCRIPT_SPECIFIER_PREFIX,
  scriptRefSide,
  scriptSpecifier,
  SERVER_SCRIPT_REF,
  withoutServerScript,
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

describe("isTypeScriptPath", () => {
  test("is true for each TypeScript module extension, in any case", () => {
    for (const path of ["/lib/a.ts", "/lib/a.mts", "/lib/a.cts", "/LIB/A.TS"]) {
      expect(isTypeScriptPath(path)).toBe(true);
    }
  });

  test("is false for anything a browser imports as written", () => {
    for (const path of ["/lib/a.js", "/lib/a.tsx", "/lib/ts", "/lib/a.ts.json", "/lib/a.jxn"]) {
      expect(isTypeScriptPath(path)).toBe(false);
    }
  });
});

describe("withoutServerScript", () => {
  test("leaves the server module out and keeps everything else", () => {
    const doc: JxDocument = {
      $script: { client: "export const a = 1;", server: "export const b = 2;" },
      tagName: "div",
    };
    expect(withoutServerScript(doc)).toEqual({
      $script: { client: "export const a = 1;" },
      tagName: "div",
    });
    // The document given is not changed.
    expect(doc.$script?.server).toBe("export const b = 2;");
  });

  test("keeps $script when the server module was all it held", () => {
    // What is left still says the document has modules, so its entries are still qualified.
    const serverOnly: JxDocument = { $script: { server: "export const b = 2;" } };
    expect(withoutServerScript(serverOnly)).toEqual({ $script: {} });
  });

  test("returns a document with no server module as it is", () => {
    const clientOnly: JxDocument = { $script: { client: "export const a = 1;" } };
    const plain: JxDocument = { tagName: "div" };
    expect(withoutServerScript(clientOnly)).toBe(clientOnly);
    expect(withoutServerScript(plain)).toBe(plain);
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

describe("isRelativeScriptSrc", () => {
  test("is true for a script file beside the document", () => {
    expect(isRelativeScriptSrc("./counter.js")).toBe(true);
    expect(isRelativeScriptSrc("../lib/format.ts")).toBe(true);
  });

  test("is false for every $src with no other spelling", () => {
    expect(isRelativeScriptSrc("npm:lodash-es")).toBe(false);
    expect(isRelativeScriptSrc("jx-ui:/behaviors/dialog.ts")).toBe(false);
    expect(isRelativeScriptSrc("/lib/x.js")).toBe(false);
    expect(isRelativeScriptSrc("https://example.com/x.js")).toBe(false);
    expect(isRelativeScriptSrc("@jxsuite/md")).toBe(false);
    expect(isRelativeScriptSrc("./lib/Weather.class.json")).toBe(false);
    expect(isRelativeScriptSrc(CLIENT_SCRIPT_REF)).toBe(false);
    expect(isRelativeScriptSrc("jx-script:a.jxn#client")).toBe(false);
  });
});

describe("findScriptAdvice", () => {
  test("advises moving a relative $src into the document's script", () => {
    const advice = findScriptAdvice({
      state: {
        bump: { $prototype: "Function", $src: "./counter.js" },
        history: { $export: "history", $src: "../server/history.ts", timing: "server" },
      },
      tagName: "my-counter",
    });
    expect(advice.map((entry) => [entry.rule, entry.path])).toEqual([
      ["relative-src", ["state", "bump"]],
      ["relative-src", ["state", "history"]],
    ]);
    expect(advice[0]?.message).toBe(
      '"bump" imports ./counter.js, which the document could carry as its own script',
    );
    expect(advice[0]?.detail).toContain('$src: "#client"');
  });

  test("says nothing about a package, a kit behaviour, a class schema or the script itself", () => {
    expect(
      findScriptAdvice({
        $script: { client: "export const bump = () => {}" },
        state: {
          bump: { $prototype: "Function", $src: "#client" },
          debounce: { $prototype: "Function", $src: "npm:lodash-es" },
          forecast: { $prototype: "Forecast", $src: "./lib/Forecast.class.json" },
          open: { $prototype: "Function", $src: "jx-ui:/behaviors/dialog.ts" },
        },
        tagName: "my-counter",
      }),
    ).toEqual([]);
  });

  test("finds a handler written on an element, and names it by where it is", () => {
    const advice = findScriptAdvice({
      children: [
        { onclick: { $prototype: "Function", $src: "./counter.js" }, tagName: "button" },
        { $map: [{ $prototype: "Function", $src: "./rows.js" }], tagName: "ul" },
      ],
      tagName: "my-counter",
    });
    expect(advice.map((entry) => entry.path)).toEqual([
      ["children", 0, "onclick"],
      ["children", 1, "$map", 0],
    ]);
    expect(advice[0]?.message).toStartWith('"onclick" imports');
    expect(advice[1]?.message).toStartWith("this entry imports");
  });

  test("does not read the script's own text for entries", () => {
    /* SAFETY: a `$script` is two strings; an object there is what a walk that read it would trip
       over, which is the thing under test. */
    const doc = { $script: { client: { $src: "./x.js" } }, tagName: "my-counter" } as never;
    expect(findScriptAdvice(doc)).toEqual([]);
  });

  test("leaves a $lazy entry its own module", () => {
    expect(
      findScriptAdvice({
        state: { chart: { $lazy: true, $prototype: "Function", $src: "./chart.js" } },
        tagName: "my-chart",
      }),
    ).toEqual([]);
  });

  test("advises that $lazy defers nothing in a script another entry loads up front", () => {
    const doc: JxDocument = {
      $script: { client: "export const bump = () => {}; export const chart = () => {}" },
      state: {
        bump: { $prototype: "Function", $src: "#client" },
        chart: { $lazy: true, $prototype: "Function", $src: "#client" },
      },
      tagName: "my-chart",
    };
    const advice = findScriptAdvice(doc);
    expect(advice.map((entry) => [entry.rule, entry.path])).toEqual([
      ["lazy-shares-script", ["state", "chart"]],
    ]);
    expect(advice[0]?.message).toBe(
      '"chart" is $lazy, but the script it is in loads with the page',
    );
    // The same document once a host has given it its address says the same.
    expect(findScriptAdvice(qualifyScripts(doc, "components/chart.jxn"))).toEqual(advice);
  });

  test("says nothing when every entry in the script is $lazy, or the eager one is the server's", () => {
    expect(
      findScriptAdvice({
        $script: {
          client: "export const chart = () => {}",
          server: "export const rows = () => []",
        },
        state: {
          chart: { $lazy: true, $prototype: "Function", $src: "#client" },
          rows: { $src: "#server", timing: "server" },
        },
        tagName: "my-chart",
      }),
    ).toEqual([]);
  });
});
