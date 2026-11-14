/**
 * The Custom Elements Manifest a build writes for its compiled definitions (spec.md §16.8).
 *
 * The manifest says what the element does, so most cases here are about what is LEFT OUT: an
 * `attribute` annotation the element does not observe, a computed entry, a lifecycle hook, a part
 * on a light-DOM definition.
 */
import { describe, expect, test } from "bun:test";
import { cemManifest, cemManifestText, cemModule, cssPartNames } from "../src/cem-manifest";
import type { CemDefinition } from "../src/cem-manifest";
import type { JsonObject, JxElement } from "../types";

/**
 * A fixture document. Written as JSON, because a manifest is generated from whatever a project's
 * files hold, including annotation shapes the document types leave out.
 */
function asDocument(json: JsonObject): JxElement {
  /* SAFETY: a Jx element is JSON data, and the generator reads every member through a guard. */
  return json as JxElement;
}

const definition = (doc: JsonObject, shadow = false): CemDefinition => ({
  className: "XCard",
  doc: asDocument(doc),
  modulePath: "dist/components/x-card.js",
  shadow,
  tagName: "x-card",
});
const declarationOf = (doc: JsonObject, shadow = false) =>
  cemModule(definition(doc, shadow)).module.declarations[0];
const memberNames = (doc: JsonObject) => declarationOf(doc).members.map((member) => member.name);

describe("cemModule", () => {
  test("a definition becomes one custom-element declaration and its define export", () => {
    expect(cemModule(definition({ tagName: "x-card" }))).toEqual({
      module: {
        declarations: [
          { customElement: true, kind: "class", members: [], name: "XCard", tagName: "x-card" },
        ],
        exports: [
          { declaration: { name: "XCard" }, kind: "custom-element-definition", name: "x-card" },
        ],
        kind: "javascript-module",
        path: "dist/components/x-card.js",
      },
      warnings: [],
    });
  });

  test("attributes are the observed names, linked to the entry each one writes", () => {
    const declaration = declarationOf({
      observedAttributes: ["user-name", "count", "orphan", "count"],
      state: {
        count: 1,
        userName: { default: "Guest", description: "Shown in the header", type: "string" },
      },
      tagName: "x-card",
    });
    expect(declaration.attributes).toEqual([
      {
        default: '"Guest"',
        description: "Shown in the header",
        fieldName: "userName",
        name: "user-name",
        type: { text: "string" },
      },
      { default: "1", fieldName: "count", name: "count", type: { text: "number" } },
      { name: "orphan" },
    ]);
    expect(declaration.members[1]).toMatchObject({ attribute: "user-name", name: "userName" });
    expect(declaration.members[0]).toMatchObject({ attribute: "count", name: "count" });
  });

  test("an attribute the element does not observe into the entry is left out and warned", () => {
    const { module, warnings } = cemModule(
      definition({
        observedAttributes: ["label"],
        state: {
          // Observed, but under a name that writes another entry.
          caption: { attribute: "label", default: "", type: "string" },
          label: { default: "", type: "string" },
          // Not observed at all.
          size: { attribute: "size", default: "md", type: "string" },
        },
        tagName: "x-card",
      }),
    );
    const [declaration] = module.declarations;
    expect(declaration.attributes?.map((attribute) => attribute.name)).toEqual(["label"]);
    for (const member of declaration.members) {
      expect("attribute" in member && member.name !== "label").toBe(false);
    }
    expect(warnings).toEqual([
      'x-card: state entry "caption" declares attribute "label", but the element does not observe it into that entry (spec.md §16.5); add it to observedAttributes or remove it',
      'x-card: state entry "size" declares attribute "size", but the element does not observe it into that entry (spec.md §16.5); add it to observedAttributes or remove it',
    ]);
  });

  test("reflects rides only on a linked field", () => {
    const declaration = declarationOf({
      observedAttributes: ["open"],
      state: {
        loose: { attribute: "loose", default: false, reflects: true, type: "boolean" },
        open: { default: false, reflects: true, type: "boolean" },
      },
      tagName: "x-card",
    });
    expect(declaration.members).toEqual([
      { default: "false", kind: "field", name: "loose", type: { text: "boolean" } },
      {
        attribute: "open",
        default: "false",
        kind: "field",
        name: "open",
        reflects: true,
        type: { text: "boolean" },
      },
    ]);
  });

  test("fields are Shape 1 and Shape 2 entries only", () => {
    const doc: JsonObject = {
      state: {
        "#cache": 1,
        bag: { a: 1 },
        count: 3,
        empty: {},
        feed: { $prototype: "Request", url: "/api" },
        list: ["a"],
        name: "Ada",
        nothing: null,
        old: { default: 1, deprecated: "Use count", type: "number" },
        older: { default: 1, deprecated: true },
        on: true,
        pointer: { $ref: "#/state/name" },
        shout: "${state.name}!",
        total: { $expression: { operator: "+", target: 1, value: 2 } },
        typeOnly: { type: "string" },
      },
      tagName: "x-card",
    };
    expect(declarationOf(doc).members).toEqual([
      { default: '{"a":1}', kind: "field", name: "bag", type: { text: "object" } },
      { default: "3", kind: "field", name: "count", type: { text: "number" } },
      { default: "{}", kind: "field", name: "empty", type: { text: "object" } },
      { default: '["a"]', kind: "field", name: "list", type: { text: "array" } },
      { default: '"Ada"', kind: "field", name: "name", type: { text: "string" } },
      { default: "null", kind: "field", name: "nothing", type: { text: "null" } },
      {
        default: "1",
        deprecated: "Use count",
        kind: "field",
        name: "old",
        type: { text: "number" },
      },
      { default: "1", deprecated: true, kind: "field", name: "older", type: { text: "number" } },
      { default: "true", kind: "field", name: "on", type: { text: "boolean" } },
    ]);
  });

  test("a type renders as text", () => {
    const types = (doc: JsonObject) =>
      declarationOf(doc).members.map((member) => ("type" in member ? member.type.text : ""));
    expect(
      types({
        state: {
          a: { default: "", type: "string" },
          b: { default: null, type: { text: "CustomEvent" } },
          c: { default: null, type: { type: ["string", "null", 7] } },
          d: { default: null, type: { $ref: "#/$defs/User" } },
          e: { $ref: "#/$defs/Post", default: null },
          f: { default: [1] },
          g: { default: 1, type: { type: "integer" } },
          h: { default: 1, type: { nope: true } },
          i: { default: 1, type: 7 },
        },
        tagName: "x-card",
      }),
    ).toEqual([
      "string",
      "CustomEvent",
      "string | null",
      "User",
      "Post",
      "array",
      "integer",
      "number",
      "number",
    ]);
  });

  test("Function entries are methods, except hooks and computed bodies", () => {
    const doc: JsonObject = {
      children: [{ onclick: { $ref: "#/state/remote" }, tagName: "button" }],
      state: {
        add: {
          $prototype: "Function",
          body: "state.n += by",
          description: "Adds to the count",
          parameters: [
            "state",
            { default: 1, description: "How much", name: "by", optional: true, type: "number" },
            { name: "note", type: { text: "string" } },
            { nameless: true },
            7,
          ],
          type: { text: "void" },
        },
        legacy: { $prototype: "Function", arguments: ["state", "event"], body: "state.n = 0" },
        onMount: { $prototype: "Function", body: "state.n = 1" },
        picked: {
          $prototype: "Function",
          body: "return state.n * factor",
          parameters: ["factor"],
        },
        remote: { $prototype: "Function", $src: "./lib.js" },
        // A bodyless `$src` entry the document only reads is a computed value.
        rows: { $prototype: "Function", $src: "./lib.js" },
        steps: { $prototype: "Function", body: [{ operator: "=", target: 1, value: 1 }] },
        total: { $prototype: "Function", body: "return state.a + state.b" },
      },
      tagName: "x-card",
    };
    expect(declarationOf(doc).members).toEqual([
      {
        description: "Adds to the count",
        kind: "method",
        name: "add",
        parameters: [
          {
            default: "1",
            description: "How much",
            name: "by",
            optional: true,
            type: { text: "number" },
          },
          { name: "note", type: { text: "string" } },
        ],
        return: { type: { text: "void" } },
      },
      { kind: "method", name: "legacy", parameters: [{ name: "event" }] },
      { kind: "method", name: "picked", parameters: [{ name: "factor" }] },
      { kind: "method", name: "remote" },
      { kind: "method", name: "steps" },
    ]);
  });

  test("events come from the root and from every public Function entry, first name winning", () => {
    const doc: JsonObject = {
      emits: [{ name: "ready" }, "not an event", { description: "no name" }],
      state: {
        "#secret": { $prototype: "Function", body: "", emits: [{ name: "hidden" }] },
        onMount: {
          $prototype: "Function",
          body: "",
          emits: [
            { deprecated: "Listen for ready", name: "mounted", type: { text: "CustomEvent" } },
          ],
        },
        save: {
          $prototype: "Function",
          body: "",
          emits: [
            { description: "Saved", name: "change" },
            { deprecated: true, name: "ready", type: "Late" },
          ],
        },
        total: { $prototype: "Function", body: "return 1", emits: [{ name: "computed" }] },
      },
      tagName: "x-card",
    };
    expect(declarationOf(doc).events).toEqual([
      { name: "ready", type: { text: "Event" } },
      { deprecated: "Listen for ready", name: "mounted", type: { text: "CustomEvent" } },
      { description: "Saved", name: "change", type: { text: "Event" } },
      { name: "computed", type: { text: "Event" } },
    ]);
  });

  test("slots, custom properties and the root description are listed", () => {
    const declaration = declarationOf({
      children: [
        { attributes: { name: " icon " }, tagName: "slot" },
        { children: [{ tagName: "slot" }], tagName: "span" },
      ],
      description: "A card",
      style: { "--card-gap": "1rem", "--card-pad": 4, color: "red" },
      tagName: "x-card",
    });
    expect(declaration.description).toBe("A card");
    expect(declaration.slots).toEqual([{ name: "icon" }, { name: "" }]);
    expect(declaration.cssProperties).toEqual([
      { default: "1rem", name: "--card-gap" },
      { default: "4", name: "--card-pad" },
    ]);
    expect(
      declarationOf({ $description: "From $description", tagName: "x-card" }).description,
    ).toBe("From $description");
  });

  test("css parts are listed only for a shadow definition, split and deduplicated", () => {
    const doc: JsonObject = {
      attributes: { part: "host" },
      children: [
        { attributes: { part: "a  b" }, tagName: "span" },
        "text",
        {
          attributes: { class: "x" },
          children: [{ attributes: { part: "a c" }, tagName: "i" }],
          tagName: "div",
        },
      ],
      tagName: "x-card",
    };
    // The root's own `part` names the host in the tree around it, not a part of its shadow tree.
    expect(cssPartNames(doc)).toEqual(["a", "b", "c"]);
    expect(declarationOf(doc, true).cssParts).toEqual([
      { name: "a" },
      { name: "b" },
      { name: "c" },
    ]);
    expect(declarationOf(doc).cssParts).toBeUndefined();
    expect(declarationOf({ tagName: "x-card" }, true).cssParts).toBeUndefined();
  });

  test("a document without state, children or style gives a bare declaration", () => {
    expect(memberNames({ tagName: "x-card" })).toEqual([]);
    expect(Object.keys(declarationOf({ state: "not an object", tagName: "x-card" }))).toEqual([
      "customElement",
      "kind",
      "members",
      "name",
      "tagName",
    ]);
  });
});

describe("cemManifest", () => {
  test("sorts modules by tag, stamps 2.1.0 and concatenates warnings", () => {
    const entry = (tagName: string): CemDefinition => ({
      className: tagName,
      doc: asDocument({
        state: { size: { attribute: "size", default: "", type: "string" } },
        tagName,
      }),
      modulePath: `dist/components/${tagName}.js`,
      shadow: false,
      tagName,
    });
    const { manifest, warnings } = cemManifest([entry("x-b"), entry("x-a"), entry("x-c")]);
    expect(manifest.schemaVersion).toBe("2.1.0");
    expect(manifest.modules.map((module) => module.path)).toEqual([
      "dist/components/x-a.js",
      "dist/components/x-b.js",
      "dist/components/x-c.js",
    ]);
    expect(warnings.map((warning) => warning.slice(0, 4))).toEqual(["x-a:", "x-b:", "x-c:"]);
  });

  test("the file text is two-space JSON with a trailing newline", () => {
    const { manifest } = cemManifest([]);
    expect(cemManifestText(manifest)).toBe('{\n  "modules": [],\n  "schemaVersion": "2.1.0"\n}\n');
  });
});
