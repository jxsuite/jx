/**
 * A document's client script, run by the runtime through the loader a host really installs
 * (`spec.md` §23.2): fetched with its document, erased, and imported, with nothing built.
 *
 * No DOM is registered here, on purpose. The loader makes a module importable as a `blob:` URL,
 * which is the platform's `Blob` and `URL` and not a DOM library's stand-ins for them.
 */
import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { loadModule } from "@jxsuite/erase/browser";
import { isFunction, isString } from "@jxsuite/schema/guards";
import {
  buildScope,
  resolve,
  setBodyEraser,
  setBodyEraserLoader,
  setModuleLoader,
} from "../src/runtime.ts";
import type { JxDocument } from "@jxsuite/schema/types";
import type { JxScope, JxScopeValue } from "../src/types.ts";

/** What the site under test answers, by URL: a document, or a module's text. */
const served = new Map<string, JxDocument | string>();

/** Every URL fetched, in order. */
const fetches: string[] = [];

/** A counter whose one function is its own script's, which imports a file beside it. */
function counter(step: string): JxDocument {
  return {
    $script: {
      client:
        `import { step } from "${step}";\n` +
        "interface Counted { count: number }\n" +
        "export function bump(state: Counted): void {\n  state.count += step;\n}\n",
    },
    state: {
      bump: { $prototype: "Function", $src: "#client", parameters: ["state"] },
      count: 0,
    },
    tagName: "div",
  };
}

/** Call a scope's `bump` the way a handler does, and read the count it leaves. */
function bumped(scope: JxScope): JxScopeValue {
  const { bump } = scope;
  if (!isFunction(bump)) {
    throw new TypeError("scope.bump is not a function");
  }
  /* SAFETY: `bump` is the script's export, written in `counter()` above to take the scope and
     return nothing. */
  (bump as (state: JxScope) => void)(scope);
  return scope.count;
}

beforeAll(() => {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: new URL("http://page.test/app/"),
  });
  /* SAFETY: the runtime and the loader each call `fetch(url)` and nothing else of it, so the one
     call signature this answers is all of `fetch` that is used. */
  spyOn(globalThis, "fetch").mockImplementation(((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    fetches.push(url);
    const answer = served.get(url);
    if (answer === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(
      isString(answer)
        ? new Response(answer, { headers: { "Content-Type": "text/javascript" } })
        : Response.json(answer),
    );
  }) as typeof fetch);
});

afterEach(() => {
  setModuleLoader(null);
  setBodyEraser(null);
  setBodyEraserLoader(null);
});

describe("a document's client script", () => {
  test("runs on a page that read its document from a URL, and is fetched with it", async () => {
    setModuleLoader(loadModule);
    const url = "http://site.test/components/counter.json";
    served.set(url, counter("./step.ts"));
    served.set("http://site.test/components/step.ts", "export const step: number = 5;");
    const scope = await buildScope(await resolve(url), {}, url);
    expect(bumped(scope)).toBe(5);
    // The document once, and the file its script imports from the document's own directory.
    expect(fetches).toEqual([url, "http://site.test/components/step.ts"]);
  });

  test("runs for a document that was never at a URL, from where the page says it stands", async () => {
    setModuleLoader(loadModule);
    served.set("http://site.test/inline/lib/two.ts", "export const step: number = 2;");
    const scope = await buildScope(counter("./lib/two.ts"), {}, "http://site.test/inline/");
    expect(bumped(scope)).toBe(2);
  });

  test("runs on a page that only said where the loader's file is", async () => {
    setBodyEraserLoader(() => import("@jxsuite/erase/browser"));
    const url = "http://site.test/on-demand/counter.json";
    served.set(url, counter("./three.ts"));
    served.set("http://site.test/on-demand/three.ts", "export const step: number = 3;");
    const scope = await buildScope(await resolve(url), {}, url);
    expect(bumped(scope)).toBe(3);
  });

  test("that needs compiling stops the page with the document's name and the place", async () => {
    setModuleLoader(loadModule);
    const url = "http://site.test/refused/counter.json";
    const doc = counter("./step.ts");
    served.set(url, { ...doc, $script: { client: "export enum Size {\n  Small,\n}\n" } });
    const read = await resolve(url);
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(buildScope(read, {}, url)).rejects.toThrow(`${url}.jx-client.ts cannot run`);
  });
});
