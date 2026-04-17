import { describe, test, expect } from "bun:test";
import { handleResolve } from "../src/resolve.js";
import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

const FIXTURES = resolve(import.meta.dir, "_fixtures");

// Create fixtures before tests
mkdirSync(FIXTURES, { recursive: true });

// Self-contained .class.json with resolve() method
const selfContainedClass = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Adder",
  $prototype: "Class",
  $defs: {
    fields: {
      a: { role: "field", access: "public", scope: "instance", identifier: "a", default: 0 },
      b: { role: "field", access: "public", scope: "instance", identifier: "b", default: 0 },
    },
    constructor: {
      role: "constructor",
      $prototype: "Function",
    },
    methods: {
      resolve: {
        role: "method",
        identifier: "resolve",
        body: "return this.a + this.b;",
      },
    },
  },
};
writeFileSync(join(FIXTURES, "Adder.class.json"), JSON.stringify(selfContainedClass), "utf8");

// Self-contained .class.json with value property (no resolve)
const valueClass = {
  title: "Greeter",
  $prototype: "Class",
  $defs: {
    fields: {
      name: {
        role: "field",
        access: "public",
        scope: "instance",
        identifier: "name",
        default: "world",
      },
    },
    methods: {
      greeting: {
        role: "accessor",
        identifier: "value",
        getter: { body: 'return "Hello " + this.name;' },
      },
    },
  },
};
writeFileSync(join(FIXTURES, "Greeter.class.json"), JSON.stringify(valueClass), "utf8");

// Self-contained .class.json with neither resolve nor value
const plainClass = {
  title: "Point",
  $prototype: "Class",
  $defs: {
    fields: {
      x: { role: "field", access: "public", scope: "instance", identifier: "x", default: 0 },
      y: { role: "field", access: "public", scope: "instance", identifier: "y", default: 0 },
    },
  },
};
writeFileSync(join(FIXTURES, "Point.class.json"), JSON.stringify(plainClass), "utf8");

// Hybrid .class.json with $implementation
const hybridImpl = `
export class Calculator {
  constructor(/** @type {any} */ config) { this.a = config.a ?? 0; this.b = config.b ?? 0; }
  async resolve() { return this.a * this.b; }
}
`;
writeFileSync(join(FIXTURES, "calc.js"), hybridImpl, "utf8");

const hybridClass = {
  title: "Calculator",
  $prototype: "Class",
  $implementation: "./calc.js",
  $defs: {
    parameters: {
      a: { identifier: "a", type: { type: "number" } },
      b: { identifier: "b", type: { type: "number" } },
    },
  },
};
writeFileSync(join(FIXTURES, "Calculator.class.json"), JSON.stringify(hybridClass), "utf8");

// Hybrid with missing export
const badHybridClass = {
  title: "Missing",
  $prototype: "Class",
  $implementation: "./calc.js",
};
writeFileSync(join(FIXTURES, "Missing.class.json"), JSON.stringify(badHybridClass), "utf8");

// Private fields .class.json
const privateFieldsClass = {
  title: "Secret",
  $prototype: "Class",
  $defs: {
    fields: {
      data: {
        role: "field",
        access: "private",
        scope: "instance",
        identifier: "data",
        default: "hidden",
      },
    },
    methods: {
      resolve: {
        role: "method",
        identifier: "resolve",
        body: "return this.data;",
      },
    },
  },
};
writeFileSync(join(FIXTURES, "Secret.class.json"), JSON.stringify(privateFieldsClass), "utf8");

// Helper: create a mock Request
function mockRequest(/** @type {any} */ body) {
  return new Request("http://localhost/__jx_resolve__", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── handleResolve — self-contained .class.json ─────────────────────────────

describe("handleResolve — self-contained .class.json", () => {
  test("resolves class with resolve() method", async () => {
    const req = mockRequest({
      $src: "./_fixtures/Adder.class.json",
      $prototype: "Adder",
      a: 3,
      b: 7,
    });
    const res = await handleResolve(req, import.meta.dir);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBe(10);
  });

  test("resolves class with value property", async () => {
    const req = mockRequest({
      $src: "./_fixtures/Greeter.class.json",
      $prototype: "Greeter",
      name: "Alice",
    });
    const res = await handleResolve(req, import.meta.dir);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBe("Hello Alice");
  });

  test("resolves class with neither resolve nor value (returns instance)", async () => {
    const req = mockRequest({
      $src: "./_fixtures/Point.class.json",
      $prototype: "Point",
      x: 5,
      y: 10,
    });
    const res = await handleResolve(req, import.meta.dir);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.x).toBe(5);
    expect(data.y).toBe(10);
  });

  test("private fields map to _-prefixed public properties", async () => {
    const req = mockRequest({
      $src: "./_fixtures/Secret.class.json",
      $prototype: "Secret",
    });
    const res = await handleResolve(req, import.meta.dir);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBe("hidden");
  });

  test("uses default values when config omitted", async () => {
    const req = mockRequest({
      $src: "./_fixtures/Adder.class.json",
      $prototype: "Adder",
    });
    const res = await handleResolve(req, import.meta.dir);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBe(0);
  });
});

// ─── handleResolve — hybrid .class.json with $implementation ────────────────

describe("handleResolve — hybrid .class.json", () => {
  test("follows $implementation to JS module", async () => {
    const req = mockRequest({
      $src: "./_fixtures/Calculator.class.json",
      $prototype: "Calculator",
      a: 6,
      b: 7,
    });
    const res = await handleResolve(req, import.meta.dir);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBe(42);
  });

  test("returns 500 when export not found in $implementation", async () => {
    const req = mockRequest({
      $src: "./_fixtures/Missing.class.json",
      $prototype: "Missing",
    });
    const res = await handleResolve(req, import.meta.dir);
    expect(res.status).toBe(500);
  });
});

// ─── handleResolve — error handling ─────────────────────────────────────────

describe("handleResolve — errors", () => {
  test("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/__jx_resolve__", {
      method: "POST",
      body: "not json",
    });
    const res = await handleResolve(req, import.meta.dir);
    expect(res.status).toBe(400);
  });

  test("returns 400 when $src is missing", async () => {
    const req = mockRequest({ $prototype: "Foo" });
    const res = await handleResolve(req, import.meta.dir);
    expect(res.status).toBe(400);
  });

  test("returns 400 when non-Function $src points to .js", async () => {
    const req = mockRequest({
      $src: "./_fixtures/calc.js",
      $prototype: "Calculator",
    });
    const res = await handleResolve(req, import.meta.dir);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain(".class.json");
  });
});

// Cleanup
process.on("exit", () => {
  try {
    rmSync(FIXTURES, { recursive: true });
  } catch {}
});
