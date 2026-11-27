/**
 * The inlined cookie helper (spec.md §11.2a). A built module carries a copy of the runtime's cookie
 * rule, so these tests evaluate that copy and hold it to `readCookieValue` and `serializeCookie`
 * over every prefix, attribute and value combination, and drive the binding the emitter wraps
 * around it.
 */

import { describe, expect, test } from "bun:test";
import { effect, reactive } from "@vue/reactivity";
import {
  COOKIE_HOST_PREFIX,
  COOKIE_SECURE_PREFIX,
  readCookieValue,
  serializeCookie,
} from "@jxsuite/runtime";
import type { CookieOptions } from "@jxsuite/runtime";
import type { JsonValue, JxPrototypeDef } from "@jxsuite/schema/types";

import { cookieHelperSource, emitCookieBinding } from "../src/shared.ts";

interface Helpers {
  __jxCookieRead: (header: string, name: string) => JsonValue;
  __jxCookieText: (name: string, value: JsonValue, options: CookieOptions) => string;
}

function load(): Helpers {
  // oxlint-disable-next-line no-new-func -- the emitted helper source is the subject under test
  return new Function(`${cookieHelperSource()}\nreturn { __jxCookieRead, __jxCookieText };`)();
}

describe("cookieHelperSource", () => {
  test("the inlined writer agrees with serializeCookie", () => {
    const { __jxCookieText } = load();
    const names = [
      "ck",
      `${COOKIE_HOST_PREFIX}sid`,
      `${COOKIE_SECURE_PREFIX}sid`,
      "a.b",
      "(unclosed",
    ];
    const values: JsonValue[] = ["v", { a: 1 }, null, 42];
    let count = 0;
    for (const name of names) {
      for (const maxAge of [undefined, 0, 60]) {
        for (const path of [undefined, "/app"]) {
          for (const domain of [undefined, "example.com"]) {
            for (const secure of [undefined, true, false]) {
              for (const sameSite of [undefined, "lax", "none", "None", "strict"]) {
                for (const value of values) {
                  const options = { domain, maxAge, path, sameSite, secure };
                  expect(__jxCookieText(name, value, options)).toBe(
                    serializeCookie(name, value, options),
                  );
                  count += 1;
                }
              }
            }
          }
        }
      }
    }
    expect(count).toBeGreaterThan(1000);
  });

  test("the inlined reader agrees with readCookieValue", () => {
    const { __jxCookieRead } = load();
    const headers = [
      `k=${encodeURIComponent(JSON.stringify({ a: 1 }))}`,
      "k=dark",
      "token=a=b=c",
      "novalue; k=1",
      "not_theme=no; theme=yes",
      "k=%E0%A4%A",
      "k=null",
      "",
    ];
    for (const header of headers) {
      for (const name of ["k", "token", "theme", "missing", "a.b", "(x", "k|j"]) {
        expect(__jxCookieRead(header, name)).toEqual(readCookieValue(header, name));
      }
    }
  });

  test("the prefixes are serialized from the runtime", () => {
    const src = cookieHelperSource();
    expect(src).toContain(JSON.stringify(COOKIE_HOST_PREFIX));
    expect(src).toContain(JSON.stringify(COOKIE_SECURE_PREFIX));
  });
});

const WEIRD = String.raw`a"b\c.(*`;

describe("emitCookieBinding", () => {
  function run(header: string, key: string, def: Partial<JxPrototypeDef>) {
    const writes: string[] = [];
    const doc = {
      get cookie() {
        return header;
      },
      set cookie(v: string) {
        writes.push(v);
      },
    };
    const state = reactive<Record<string, JsonValue>>({ [key]: null });
    const runners: unknown[] = [];
    const source = `${cookieHelperSource()}\n${emitCookieBinding(key, { $prototype: "Cookie", ...def }, { collect: "runners" })}`;
    // oxlint-disable-next-line no-new-func -- the emitted binding is the subject under test
    new Function("document", "effect", "state", "runners", source)(doc, effect, state, runners);
    return { runners, state, writes };
  }

  test("the binding reads on creation and persists every change", () => {
    const def = { name: "__Host-k", path: "/app", default: "d" };
    const empty = run("", "k", def);
    expect(empty.state.k).toBe("d");
    expect(empty.writes[0]).toBe(serializeCookie("__Host-k", "d", { path: "/app" }));
    expect(empty.writes[0]).toContain("Path=/");
    expect(empty.writes[0]).toContain("Secure");
    expect(empty.runners).toHaveLength(1);
    empty.state.k = "w";
    expect(empty.writes).toHaveLength(2);
    expect(empty.writes[1]).toContain("%22w%22");

    const stored = run("__Host-k=%22v%22", "k", def);
    expect(stored.state.k).toBe("v");
  });

  test("a hostile name and key are data", () => {
    const block = emitCookieBinding("user.name", { $prototype: "Cookie", name: WEIRD });
    expect(block).toContain(JSON.stringify(WEIRD));
    expect(block).toContain('state["user.name"]');
    expect(block).not.toContain("RegExp");
    expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(block)).not.toThrow();
  });

  test("the element-target options", () => {
    const block = emitCookieBinding(
      "k",
      { $prototype: "Cookie" },
      { statePrefix: "this.state", indent: "    ", collect: "this.#effects" },
    );
    expect(block).toContain("this.#effects.push(effect(");
    expect(block).toContain("this.state.k = ");
    expect(block).toContain("this.state.k, _o");
    for (const line of block.split("\n")) {
      expect(line.startsWith("    ")).toBe(true);
    }
  });
});
