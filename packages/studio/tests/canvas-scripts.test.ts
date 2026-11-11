import { beforeEach, describe, expect, test } from "bun:test";
import {
  noteSavedScript,
  ownPatch,
  ownShadow,
  resetSavedScripts,
  scriptAddress,
  scriptCollector,
} from "../src/canvas/canvas-scripts";
import type { JxMutableNode } from "@jxsuite/schema/types";

/*
 * A document's own script on the canvas (`spec.md` §23.2). The canvas draws several documents as
 * one, so each is addressed before it is merged, and a script is drawn as its document was last
 * saved.
 */

const BASE = "http://localhost:3000/proj/";
const PAGE = "http://localhost:3000/proj/pages/index.json";
const LAYOUT = "http://localhost:3000/proj/layouts/base.json";

/** A document with a client script and one entry reading it. */
function scripted(client: string, extra: Partial<JxMutableNode> = {}): JxMutableNode {
  return {
    $script: { client },
    state: { greet: { $export: "greet", $prototype: "Function", $src: "#client" } },
    tagName: "div",
    ...extra,
  };
}

beforeEach(() => {
  resetSavedScripts();
});

describe("scriptCollector().own", () => {
  test("qualifies a document's own `$src`, drops `$script`, and keeps the client text", () => {
    const collector = scriptCollector(BASE);
    const doc = scripted("export const greet = () => 'hi';");

    const owned = collector.own(doc, "pages/index.json");

    expect(owned).toEqual({
      state: {
        greet: { $export: "greet", $prototype: "Function", $src: `jx-script:${PAGE}#client` },
      },
      tagName: "div",
    });
    expect(collector.scripts).toEqual({
      [`jx-script:${PAGE}#client`]: "export const greet = () => 'hi';",
    });
    // The document given is the editor's, and is not the canvas's to change.
    expect(doc.$script).toEqual({ client: "export const greet = () => 'hi';" });
    expect(doc.state).toEqual({
      greet: { $export: "greet", $prototype: "Function", $src: "#client" },
    });
  });

  test("a page and its layout name two modules, where a merged document would name one", () => {
    const collector = scriptCollector(BASE);

    const page = collector.own(
      scripted("export const greet = () => 'page';"),
      "./pages/index.json",
    );
    const layout = collector.own(
      scripted("export const greet = () => 'layout';"),
      "layouts/base.json",
    );

    expect(page.state).toEqual({
      greet: { $export: "greet", $prototype: "Function", $src: `jx-script:${PAGE}#client` },
    });
    expect(layout.state).toEqual({
      greet: { $export: "greet", $prototype: "Function", $src: `jx-script:${LAYOUT}#client` },
    });
    expect(collector.scripts).toEqual({
      [`jx-script:${LAYOUT}#client`]: "export const greet = () => 'layout';",
      [`jx-script:${PAGE}#client`]: "export const greet = () => 'page';",
    });
  });

  test("a server script is addressed for the host to find, and its text goes nowhere", () => {
    const collector = scriptCollector(BASE);
    const owned = collector.own(
      {
        $script: { server: "export const total = () => 3;" },
        state: { total: { $export: "total", $src: "#server", timing: "server" } },
        tagName: "div",
      },
      "pages/index.json",
    );

    expect(owned.state).toEqual({
      total: { $export: "total", $src: `jx-script:${PAGE}#server`, timing: "server" },
    });
    expect(owned.$script).toBeUndefined();
    expect(collector.scripts).toEqual({});
  });

  test("a document with no script is returned as it is", () => {
    const collector = scriptCollector(BASE);
    const doc: JxMutableNode = { children: ["hi"], tagName: "p" };
    expect(collector.own(doc, "pages/index.json")).toBe(doc);
    expect(collector.scripts).toEqual({});
  });

  test("a document with no file has no address, and is left for the runtime to give one", () => {
    const collector = scriptCollector(BASE);
    const doc = scripted("export const greet = () => 'hi';");
    expect(collector.own(doc, null)).toBe(doc);
    expect(collector.own(doc, "")).toBe(doc);
    expect(collector.scripts).toEqual({});
  });

  test("an unsaved document is drawn with the script it was last saved with", () => {
    scriptCollector(BASE).own(scripted("export const greet = () => 'saved';"), "pages/index.json");

    const collector = scriptCollector(BASE);
    collector.own(scripted("export const greet = () => 'half ty"), "pages/index.json", true);

    expect(collector.scripts).toEqual({
      [`jx-script:${PAGE}#client`]: "export const greet = () => 'saved';",
    });
  });

  test("an unsaved document that was saved with no script is drawn with none", () => {
    scriptCollector(BASE).own({ tagName: "div" }, "pages/index.json");

    const collector = scriptCollector(BASE);
    const owned = collector.own(scripted("export const greet = 1;"), "pages/index.json", true);

    // Its entries are still addressed: the module they name is simply not there until a save.
    expect(owned.state).toEqual({
      greet: { $export: "greet", $prototype: "Function", $src: `jx-script:${PAGE}#client` },
    });
    expect(collector.scripts).toEqual({});
  });

  test("an unsaved document never seen saved is drawn with the script it has", () => {
    const collector = scriptCollector(BASE);
    collector.own(scripted("export const greet = () => 'new';"), "pages/index.json", true);
    expect(collector.scripts).toEqual({
      [`jx-script:${PAGE}#client`]: "export const greet = () => 'new';",
    });
  });

  test("a clean document is what its file says, and replaces what was remembered", () => {
    scriptCollector(BASE).own(scripted("export const greet = () => 'old';"), "pages/index.json");
    scriptCollector(BASE).own(
      scripted("export const greet = () => 'reloaded';"),
      "pages/index.json",
    );

    const collector = scriptCollector(BASE);
    collector.own(scripted("export const greet = () => 'typing';"), "pages/index.json", true);
    expect(collector.scripts).toEqual({
      [`jx-script:${PAGE}#client`]: "export const greet = () => 'reloaded';",
    });
  });

  test("a `$script` that is not an object, or whose client is not text, carries no client", () => {
    const collector = scriptCollector(BASE);
    const owned = collector.own({ $script: "nope", tagName: "div" }, "pages/index.json");
    collector.own({ $script: { client: 3 }, tagName: "div" }, "layouts/base.json");
    expect(owned).toEqual({ tagName: "div" });
    expect(collector.scripts).toEqual({});
  });
});

describe("noteSavedScript", () => {
  test("a first save with a script is news; a first save without one is not", () => {
    expect(noteSavedScript(PAGE, scripted("export const greet = 1;"))).toBe(true);
    expect(noteSavedScript(LAYOUT, { tagName: "div" })).toBe(false);
  });

  test("a save that leaves the script as it was is not news", () => {
    scriptCollector(BASE).own(scripted("export const greet = 1;"), "pages/index.json");
    expect(noteSavedScript(PAGE, scripted("export const greet = 1;", { title: "x" }))).toBe(false);
  });

  test("a save that changes the script is news, once, and is what the canvas then draws", () => {
    scriptCollector(BASE).own(scripted("export const greet = 1;"), "pages/index.json");

    const saves = [1, 2].map(() => noteSavedScript(PAGE, scripted("export const greet = 2;")));
    expect(saves).toEqual([true, false]);

    const collector = scriptCollector(BASE);
    collector.own(scripted("export const greet = 3;"), "pages/index.json", true);
    expect(collector.scripts).toEqual({ [`jx-script:${PAGE}#client`]: "export const greet = 2;" });
  });

  test("a save that removes the script is news", () => {
    scriptCollector(BASE).own(scripted("export const greet = 1;"), "pages/index.json");
    expect(noteSavedScript(PAGE, { tagName: "div" })).toBe(true);
  });
});

describe("scriptAddress", () => {
  test("is the URL a frame reads the document from", () => {
    expect(scriptAddress("pages/index.json", BASE)).toBe(PAGE);
    expect(scriptAddress("./pages/index.json", BASE)).toBe(PAGE);
  });

  test("is nothing for a document with no file, and nothing where no URL can be made", () => {
    expect(scriptAddress(null, BASE)).toBeNull();
    expect(scriptAddress(undefined, BASE)).toBeNull();
    expect(scriptAddress("", BASE)).toBeNull();
    // A page at about:blank has the origin "null", which is no base for anything.
    expect(scriptAddress("pages/index.json", "null/proj/")).toBeNull();
    expect(noteSavedScript(null, scripted("export const greet = 1;"))).toBe(false);
  });
});

describe("ownPatch", () => {
  const ops = [
    {
      op: "insert",
      value: {
        state: { greet: { $export: "greet", $prototype: "Function", $src: "#client" } },
        tagName: "x-card",
      },
    },
    { key: "title", op: "set-key", value: "plain" },
  ];

  test("a value a patch carries names the edited document's script", () => {
    const [insert, plain] = ownPatch(ops, "pages/index.json", BASE);
    expect(insert).toEqual({
      op: "insert",
      value: {
        state: {
          greet: { $export: "greet", $prototype: "Function", $src: `jx-script:${PAGE}#client` },
        },
        tagName: "x-card",
      },
    });
    // An operation naming no script is the object it was.
    expect(plain).toBe(ops[1]);
  });

  test("a document with no file has no address to give", () => {
    expect(ownPatch(ops, null, BASE)).toBe(ops);
  });
});

describe("ownShadow", () => {
  test("the document patches are folded into names the modules the drawn one names", () => {
    const doc = scripted("export const greet = 1;", {
      children: [
        {
          state: { inner: { $export: "greet", $prototype: "Function", $src: "#client" } },
          tagName: "x-card",
        },
      ],
    });

    expect(ownShadow(doc, "pages/index.json", BASE)).toEqual({
      children: [
        {
          state: {
            inner: { $export: "greet", $prototype: "Function", $src: `jx-script:${PAGE}#client` },
          },
          tagName: "x-card",
        },
      ],
      state: {
        greet: { $export: "greet", $prototype: "Function", $src: `jx-script:${PAGE}#client` },
      },
      tagName: "div",
    });
    // It records nothing: what the frame is sent is the drawn document's to say.
    const collector = scriptCollector(BASE);
    collector.own(scripted("export const greet = 2;"), "pages/index.json", true);
    expect(collector.scripts).toEqual({ [`jx-script:${PAGE}#client`]: "export const greet = 2;" });
  });

  test("a document with no script, or with no file, is returned as it is", () => {
    const plain: JxMutableNode = { tagName: "div" };
    expect(ownShadow(plain, "pages/index.json", BASE)).toBe(plain);
    const doc = scripted("export const greet = 1;");
    expect(ownShadow(doc, null, BASE)).toBe(doc);
  });
});
