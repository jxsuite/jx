/**
 * `@jxsuite/runtime/dom-properties` is the one table of which DOM property HTML reflects to which
 * content attribute (spec.md §8.1). The static emitter writes built HTML from it, so a wrong row is
 * a built page that disagrees with the page the runtime renders.
 *
 * The last case checks every row against the IDL the platform publishes. It proves each row is
 * valid; it does not prove the table complete, so a new HTML attribute is a missing row and never a
 * failing dependency update.
 */

import { describe, expect, test } from "bun:test";

import idl from "@webref/idl";
import { listAll } from "@webref/elements";

import {
  ELEMENT_ROWS,
  GLOBAL_ROWS,
  isContentProperty,
  reflectedAttribute,
} from "../src/dom-properties.ts";

import type { Reflection } from "../src/dom-properties.ts";

/** The attribute a property writes, or `null`. */
function attributeOf(tag: string, property: string): string | null {
  return reflectedAttribute(tag, property)?.attribute ?? null;
}

describe("reflectedAttribute", () => {
  test("a reflected property names its attribute", () => {
    expect(reflectedAttribute("a", "href")).toEqual({ attribute: "href", kind: "text" });
    expect(attributeOf("label", "htmlFor")).toBe("for");
    expect(attributeOf("td", "colSpan")).toBe("colspan");
    expect(attributeOf("div", "ariaLabel")).toBe("aria-label");
    expect(attributeOf("div", "className")).toBe("class");
    expect(attributeOf("input", "readOnly")).toBe("readonly");
    expect(attributeOf("meta", "httpEquiv")).toBe("http-equiv");
    expect(attributeOf("form", "encoding")).toBe("enctype");
  });

  test("the tag is matched in any case", () => {
    expect(attributeOf("A", "href")).toBe("href");
  });

  test("boolean rows are kind boolean", () => {
    expect(reflectedAttribute("input", "disabled")?.kind).toBe("boolean");
    expect(reflectedAttribute("details", "open")?.kind).toBe("boolean");
    expect(reflectedAttribute("div", "draggable")?.kind).toBe("boolean");
    expect(reflectedAttribute("div", "translate")).toEqual({
      attribute: "translate",
      keywords: ["yes", "no"],
      kind: "boolean",
    });
    expect(reflectedAttribute("div", "autocorrect")?.keywords).toEqual(["on", "off"]);
  });

  test("hidden is its own kind", () => {
    expect(reflectedAttribute("div", "hidden")).toEqual({ attribute: "hidden", kind: "hidden" });
  });

  test("the live rows", () => {
    expect(reflectedAttribute("input", "value")?.live).toBe(true);
    expect(reflectedAttribute("input", "checked")?.live).toBe(true);
    expect(reflectedAttribute("option", "selected")?.live).toBe(true);
    expect(reflectedAttribute("video", "muted")?.live).toBe(true);
    expect(reflectedAttribute("option", "value")?.live).toBeUndefined();
  });

  test("an inherited row reaches every element of the interface", () => {
    expect(attributeOf("audio", "preload")).toBe("preload");
    expect(attributeOf("video", "defaultMuted")).toBe("muted");
    expect(attributeOf("area", "href")).toBe("href");
  });

  test("a property the element lacks is null", () => {
    expect(reflectedAttribute("div", "href")).toBeNull();
    expect(reflectedAttribute("my-card", "href")).toBeNull();
    expect(reflectedAttribute("my-card", "disabled")).toBeNull();
  });

  test("a custom element gets the global rows", () => {
    expect(attributeOf("my-card", "title")).toBe("title");
    expect(attributeOf("my-card", "role")).toBe("role");
    expect(attributeOf("my-card", "ariaLabel")).toBe("aria-label");
  });

  test("a property with no attribute is null", () => {
    for (const property of [
      "indeterminate",
      "valueAsNumber",
      "scrollTop",
      "innerText",
      "textContent",
      "nonce",
    ]) {
      expect(reflectedAttribute("input", property)).toBeNull();
    }
  });

  test("prototype keys are not rows", () => {
    for (const property of ["constructor", "toString", "__proto__"]) {
      expect(reflectedAttribute("div", property)).toBeNull();
      expect(reflectedAttribute("constructor", property)).toBeNull();
    }
  });
});

describe("isContentProperty", () => {
  test("content properties", () => {
    expect(isContentProperty("textarea", "value")).toBe(true);
    expect(isContentProperty("TEXTAREA", "defaultValue")).toBe(true);
    expect(isContentProperty("output", "value")).toBe(true);
    expect(isContentProperty("option", "text")).toBe(true);
    expect(isContentProperty("a", "text")).toBe(true);
    expect(isContentProperty("title", "text")).toBe(true);
    expect(isContentProperty("p", "innerText")).toBe(true);
  });

  test("everything else is not", () => {
    expect(isContentProperty("input", "value")).toBe(false);
    expect(isContentProperty("script", "text")).toBe(false);
    expect(isContentProperty("body", "text")).toBe(false);
    expect(isContentProperty("p", "textContent")).toBe(false);
  });

  test("no content property is also a reflected row", () => {
    for (const [property, tags] of ELEMENT_ROWS) {
      for (const tag of tags.split(" ")) {
        expect(`${tag}.${property}: ${isContentProperty(tag, property)}`).toBe(
          `${tag}.${property}: false`,
        );
      }
    }
  });
});

// ─── The rows against the platform's IDL ──────────────────────────────────────

/** A writable IDL attribute, reduced to what a row claims about it. */
interface IdlAttribute {
  boolean: boolean;
}

/** Each interface's writable attributes, with the interfaces it inherits from and includes. */
interface IdlIndex {
  attributes: Map<string, Map<string, IdlAttribute>>;
  inheritance: Map<string, string>;
  includes: Map<string, string[]>;
}

async function loadIdl(): Promise<IdlIndex> {
  const files = await idl.listAll();
  const index: IdlIndex = { attributes: new Map(), includes: new Map(), inheritance: new Map() };
  for (const shortname of ["html", "dom", "wai-aria"]) {
    const file = files[shortname];
    if (!file) {
      throw new Error(`@webref/idl has no ${shortname}.idl`);
    }
    for (const definition of await file.parse()) {
      if (definition.type === "includes" && definition.target && definition.includes) {
        const mixins = index.includes.get(definition.target) ?? [];
        mixins.push(definition.includes);
        index.includes.set(definition.target, mixins);
        continue;
      }
      if (!definition.name || !definition.members) {
        continue;
      }
      // A partial interface adds to the one it names, so members accumulate under one name.
      const members = index.attributes.get(definition.name) ?? new Map<string, IdlAttribute>();
      for (const member of definition.members) {
        if (member.type === "attribute" && member.name && member.readonly !== true) {
          members.set(member.name, { boolean: member.idlType?.idlType === "boolean" });
        }
      }
      index.attributes.set(definition.name, members);
      if (definition.inheritance) {
        index.inheritance.set(definition.name, definition.inheritance);
      }
    }
  }
  return index;
}

/** Find a writable attribute on an interface, an interface it inherits, or a mixin either includes. */
function findAttribute(index: IdlIndex, start: string, property: string): IdlAttribute | null {
  let current: string | undefined = start;
  while (current !== undefined) {
    for (const host of [current, ...(index.includes.get(current) ?? [])]) {
      const found = index.attributes.get(host)?.get(property);
      if (found) {
        return found;
      }
    }
    current = index.inheritance.get(current);
  }
  return null;
}

/** What a row says of a property, in the words the failure message uses. */
function describeRow(found: IdlAttribute | null, reflection: Reflection): [string, string] {
  if (!found) {
    return ["not a writable attribute", reflection.kind];
  }
  return [
    found.boolean ? "boolean" : "not boolean",
    reflection.kind === "boolean" ? "boolean" : "not boolean",
  ];
}

describe("the table against @webref", () => {
  test("every row is an IDL attribute of the element it names", async () => {
    const index = await loadIdl();
    const specs = await listAll();
    const spec = specs.html;
    if (!spec) {
      throw new Error("@webref/elements has no html entry");
    }
    const interfaces = new Map(spec.elements.map((element) => [element.name, element.interface]));
    const wrong: string[] = [];

    for (const [property, reflection] of GLOBAL_ROWS) {
      const [actual, claimed] = describeRow(
        findAttribute(index, "HTMLElement", property),
        reflection,
      );
      if (actual !== claimed) {
        wrong.push(`global ${property}: IDL says ${actual}, the row says ${claimed}`);
      }
    }
    for (const [property, tags, reflection] of ELEMENT_ROWS) {
      for (const tag of tags.split(" ")) {
        const host = interfaces.get(tag);
        const found = host === undefined ? null : findAttribute(index, host, property);
        const [actual, claimed] = describeRow(found, reflection);
        if (actual !== claimed) {
          wrong.push(`${tag}.${property}: IDL says ${actual}, the row says ${claimed}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // The walk resolved inherited members, which is what keeps `muted` on both media elements.
    expect(findAttribute(index, "HTMLVideoElement", "muted")).toEqual({ boolean: true });
    expect(findAttribute(index, "HTMLVideoElement", "nope")).toBeNull();
  });

  test("an element row is not also a global row, and no row is written twice", () => {
    const globals = new Set(GLOBAL_ROWS.map(([property]) => property));
    expect(globals.size).toBe(GLOBAL_ROWS.length);
    const seen = new Set<string>();
    for (const [property, tags] of ELEMENT_ROWS) {
      expect(globals.has(property)).toBe(false);
      for (const tag of tags.split(" ")) {
        expect(seen.has(`${tag} ${property}`)).toBe(false);
        seen.add(`${tag} ${property}`);
      }
    }
  });
});
