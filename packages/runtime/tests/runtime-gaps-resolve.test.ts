import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, describe, test, expect, spyOn } from "bun:test";
import { buildScope, preloadModule, resolvePrototype, setResolveToken } from "../src/runtime";
import { reactive } from "@vue/reactivity";
import { isFunction, isJsonObject, isNumber, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue, JxDocument } from "@jxsuite/schema/types";
import type { JxScope } from "../src/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

/* The fixture modules and the schema class bodies below publish these on `globalThis` so a test can
   reach an instance the runtime built, or prove a module was loaded at all. */
declare global {
  /** The last `Resolvable` instance `_gaps_class_impl.ts` constructed. */
  var __gapsResolvable: { push: (v: JsonValue) => void } | undefined;
  /** The callback the `Subby` schema class's `subscribe` body stored. */
  var __gapsSelfCb: ((v: JsonValue) => void) | undefined;
  /** Set by `_server_fn_tripwire.ts` the moment it is evaluated. */
  var __jxTripwire: boolean | undefined;
}

const wait = (ms = 0) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

const BASE = import.meta.url;
const IMPL_SRC = "./_gaps_class_impl.js";
const IMPL2_SRC = "./_gaps_class_impl2.js";
const SERVER_SRC = new URL("_gaps_server_fns.js", import.meta.url).href;

/** Answer every `fetch` from `respond`, keeping Bun's `preconnect` so the stub is a whole `fetch`. */
function stubFetch(respond: (url: string, init: RequestInit | undefined) => Promise<Response>) {
  const { preconnect } = fetch;
  const stub = (input: RequestInfo | URL, init?: RequestInit) => respond(String(input), init);
  global.fetch = Object.assign(stub, { preconnect });
}

/** Decode a dev-proxy POST body: the runtime always posts `JSON.stringify` of an object. */
function postedBody(init: RequestInit | undefined): JsonObject {
  const raw = init?.body;
  const parsed: JsonValue = JSON.parse(isString(raw) ? raw : "{}");
  if (!isJsonObject(parsed)) {
    throw new Error("dev-proxy POST body is not a JSON object");
  }
  return parsed;
}

/** A member the test that reads it always posts; its absence is a runtime regression. */
function postedMember(posted: JsonObject, name: string): JsonValue {
  const value = posted[name];
  if (value === undefined) {
    throw new Error(`dev-proxy body carries no "${name}"`);
  }
  return value;
}

/** The named member of a server-proxy body's `arguments` object. */
function postedArgument(body: JsonObject, name: string): JsonValue {
  const args = body.arguments;
  if (!isJsonObject(args)) {
    throw new Error("server-proxy body carries no arguments object");
  }
  return postedMember(args, name);
}

/** One recorded dev-proxy POST. */
interface ProxyPost {
  body: JsonObject;
  url: string;
}

interface FetchOptions {
  /** `.class.json` documents served to GETs, keyed by a substring of the requested URL. */
  classDefs?: Record<string, JsonObject>;
  classOk?: boolean;
  proxyOk?: boolean;
  proxyValue?: (body: JsonObject) => JsonValue;
}

/**
 * Install a fetch mock that serves .class.json GETs and records dev-proxy POSTs. Returns the array
 * of recorded POST bodies.
 */
function installFetch(opts: FetchOptions) {
  const posts: ProxyPost[] = [];
  stubFetch((url, init) => {
    if (init?.method === "POST") {
      const body = postedBody(init);
      posts.push({ body, url });
      if (opts.proxyOk === false) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      const value = opts.proxyValue ? opts.proxyValue(body) : { proxied: true };
      return Promise.resolve(Response.json(value));
    }
    if (opts.classOk === false) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    for (const [match, def] of Object.entries(opts.classDefs ?? {})) {
      if (url.includes(match)) {
        return Promise.resolve(Response.json(def));
      }
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  return posts;
}

// ─── resolveFunction: $src import branches ───────────────────────────────────

describe("resolveFunction $src branches", () => {
  test("falls back to bare-specifier import when base resolution fails", async () => {
    const doc: JxDocument = {
      state: {
        fn: { $export: "computed", $prototype: "Function", $src: "@vue/reactivity" },
      },
    };
    const state = await buildScope(doc, {}, "file:///nonexistent/");
    expect(isFunction(state.fn)).toBe(true);
  });

  test("imports absolute $src without base", async () => {
    const doc: JxDocument = {
      state: {
        dbl: { $export: "double", $prototype: "Function", $src: SERVER_SRC },
      },
    };
    const state = await buildScope(doc, {}, "");
    // Double() has a return statement and <=1 params: wrapped in computed (async → Promise)
    expect(state.dbl).toBeInstanceOf(Promise);
    expect(await state.dbl).toBe(0);
  });

  test("throws when $src export is missing", async () => {
    const doc: JxDocument = {
      state: {
        bad: { $export: "nope", $prototype: "Function", $src: SERVER_SRC },
      },
    };
    expect(buildScope(doc, {}, "")).rejects.toThrow('export "nope" not found');
  });
});

// ─── resolveClassJson: hybrid $implementation ────────────────────────────────

describe("resolveClassJson hybrid", () => {
  test("instance with `value` property resolves to that value", async () => {
    installFetch({
      classDefs: { "vb.class.json": { $implementation: IMPL_SRC, title: "ValueBox" } },
    });
    const doc: JxDocument = {
      state: { box: { $prototype: "ValueBox", $src: "./vb.class.json", initial: "hello" } },
    };
    const state = await buildScope(doc, {}, BASE);
    expect(state.box).toBe("hello");
  });

  test("instance with resolve() + subscribe() resolves async and updates on push", async () => {
    installFetch({
      classDefs: { "rs.class.json": { $implementation: IMPL_SRC, title: "Resolvable" } },
    });
    const doc: JxDocument = {
      state: { r: { $prototype: "Resolvable", $src: "./rs.class.json", label: "x" } },
    };
    const state = await buildScope(doc, {}, BASE);
    expect(state.r).toBe("resolved:x");
    const inst = globalThis.__gapsResolvable;
    expect(inst).toBeDefined();
    inst?.push("next-value");
    await wait();
    expect(state.r).toBe("next-value");
    Reflect.deleteProperty(globalThis, "__gapsResolvable");
  });

  test("plain instance (no resolve, no value) resolves to the instance itself", async () => {
    installFetch({
      classDefs: { "pl.class.json": { $implementation: IMPL2_SRC, title: "PlainInstance" } },
    });
    const doc: JxDocument = {
      state: { p: { $prototype: "PlainInstance", $src: "./pl.class.json", label: "custom" } },
    };
    const state = await buildScope(doc, {}, BASE);
    expect(state.p).toHaveProperty("label", "custom");
  });

  test("non-class export falls back to dev proxy", async () => {
    const posts = installFetch({
      classDefs: {
        "nc.class.json": { $implementation: IMPL_SRC, title: "Whatever" },
      },
      proxyValue: () => "from-proxy",
    });
    const doc: JxDocument = {
      state: {
        v: { $export: "notAClass", $prototype: "Anything", $src: "./nc.class.json" },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.v).toBe("from-proxy");
    expect(posts.length).toBe(1);
    expect(posts[0]!.url).toBe("/__jx_resolve__");
    expect(posts[0]!.body.$export).toBe("notAClass");
  });

  test("missing export falls back to dev proxy", async () => {
    const posts = installFetch({
      classDefs: {
        "me.class.json": { $implementation: IMPL_SRC, title: "DoesNotExist" },
      },
      proxyValue: () => "proxy-2",
    });
    const doc: JxDocument = {
      state: { v: { $prototype: "DoesNotExist", $src: "./me.class.json" } },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.v).toBe("proxy-2");
    expect(posts.length).toBe(1);
  });

  test("unimportable $implementation falls back to dev proxy", async () => {
    const posts = installFetch({
      classDefs: {
        "ni.class.json": { $implementation: "./__gaps_no_such_module__.js", title: "Nope" },
      },
      proxyValue: () => "proxy-3",
    });
    const doc: JxDocument = {
      state: { v: { $prototype: "Nope", $src: "./ni.class.json" } },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.v).toBe("proxy-3");
    expect(posts.length).toBe(1);
  });

  test("$context reference goes straight to dev proxy", async () => {
    const posts = installFetch({
      classDefs: {
        "cx.class.json": {
          $defs: { entry: { $ref: "#/$context/content" } },
          $implementation: IMPL_SRC,
          title: "ValueBox",
        },
      },
      proxyValue: () => "ctx-proxied",
    });
    const doc: JxDocument = {
      state: { v: { $prototype: "ValueBox", $src: "./cx.class.json" } },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.v).toBe("ctx-proxied");
    expect(posts.length).toBe(1);
  });

  test("failed .class.json fetch (HTTP error) falls back to dev proxy", async () => {
    const posts = installFetch({ classOk: false, proxyValue: () => "http-fallback" });
    const doc: JxDocument = {
      state: { v: { $prototype: "X", $src: "./missing.class.json" } },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.v).toBe("http-fallback");
    expect(posts.length).toBe(1);
  });

  test("non-.class.json $src throws", () => {
    expect(
      resolvePrototype({ $prototype: "X", $src: "./thing.js" }, reactive({}), "v", BASE),
    ).rejects.toThrow("requires a .class.json $src");
  });
});

// ─── resolveClassJson: self-contained schema classes ─────────────────────────

/** The members `counterDef` below declares, as `classFromSchema` builds them onto an instance. */
interface CounterInstance {
  built: boolean;
  count: number[];
  label: string;
  _secret: number;
  getCount: () => number;
  addTo: (amount: number) => number;
  named: (n: string) => string;
  tot: number;
}

describe("classFromSchema (self-contained)", () => {
  const counterDef = {
    $defs: {
      constructor: { body: "this.built = true;" },
      fields: {
        count: { default: [1, 2], identifier: "count" },
        label: { identifier: "label" },
        secret: { access: "private", identifier: "secret", initializer: 5 },
      },
      methods: {
        addTo: {
          body: "return amount + 1;",
          identifier: "addTo",
          parameters: [{ $ref: "#/params/amount" }],
        },
        getCount: { body: "return this.count.length;", identifier: "getCount" },
        makeIt: { body: "return 'static';", identifier: "makeIt", scope: "static" },
        named: { body: "return n;", identifier: "named", parameters: [{ identifier: "n" }] },
        tot: {
          getter: { body: "return this._secret;" },
          identifier: "tot",
          role: "accessor",
          setter: { body: "this._secret = v;", parameters: [{ $ref: "#/params/v" }] },
        },
      },
    },
    title: "Counter",
  };

  test("constructs instance with fields, constructor, methods, accessor", async () => {
    installFetch({ classDefs: { "counter.class.json": counterDef } });
    const doc: JxDocument = {
      state: {
        c: { $prototype: "Counter", $src: "./counter.class.json", label: "lbl" },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    /* SAFETY: state.c is the instance classFromSchema built from counterDef, whose fields (count,
       label, secret as _secret), constructor (built), methods (getCount, addTo, named) and accessor
       (tot) are exactly CounterInstance's members; each one is asserted below, so a member the
       runtime failed to build fails the test instead of being trusted. */
    const c = state.c as CounterInstance;
    expect(c.built).toBe(true);
    expect(c.count).toEqual([1, 2]); // StructuredClone of default
    expect(c.label).toBe("lbl"); // From config
    expect(c._secret).toBe(5); // Private initializer
    expect(c.getCount()).toBe(2);
    expect(c.addTo(4)).toBe(5); // $ref parameter name
    expect(c.named("hi")).toBe("hi"); // Identifier parameter name
    expect(c.tot).toBe(5); // Accessor getter
    c.tot = 9; // Accessor setter
    expect(c.tot).toBe(9);
  });

  test("field without config/initializer/default is null", async () => {
    installFetch({ classDefs: { "counter2.class.json": counterDef } });
    const doc: JxDocument = {
      state: { c: { $prototype: "Counter", $src: "./counter2.class.json" } },
    };
    const state = await buildScope(doc, {}, BASE);
    expect(state.c).toHaveProperty("label", null);
  });

  test("schema-defined subscribe wires reactive updates", async () => {
    const subDef = {
      $defs: {
        fields: { tag: { identifier: "tag", initializer: "sub" } },
        methods: {
          subscribe: {
            body: "globalThis.__gapsSelfCb = cb;",
            identifier: "subscribe",
            parameters: [{ identifier: "cb" }],
          },
        },
      },
      title: "Subby",
    };
    installFetch({ classDefs: { "subby.class.json": subDef } });
    const doc: JxDocument = {
      state: { s: { $prototype: "Subby", $src: "./subby.class.json" } },
    };
    const state = await buildScope(doc, {}, BASE);
    expect(state.s).toHaveProperty("tag", "sub");
    const selfCb = globalThis.__gapsSelfCb;
    expect(selfCb).toBeDefined();
    selfCb?.(42);
    await wait();
    expect(state.s).toBe(42);
    Reflect.deleteProperty(globalThis, "__gapsSelfCb");
  });
});

// ─── resolveViaDevProxy ──────────────────────────────────────────────────────

describe("resolveViaDevProxy", () => {
  test("bare specifier $src posts to /__jx_resolve__ with config", async () => {
    const posts = installFetch({ proxyValue: (b) => ({ echoed: postedMember(b, "q") }) });
    const doc: JxDocument = {
      state: {
        v: { $prototype: "Search", $src: "@fake/pkg/x.class.json", q: "static-q" },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.v).toEqual({ echoed: "static-q" });
    expect(posts[0]!.body.$src).toBe("@fake/pkg/x.class.json");
    expect(posts[0]!.body.$prototype).toBe("Search");
    expect(posts[0]!.body.q).toBe("static-q");
  });

  test("template config values re-resolve reactively", async () => {
    const posts = installFetch({ proxyValue: (b) => ({ echoed: postedMember(b, "q") }) });
    const doc: JxDocument = {
      state: {
        term: { default: "first" },
        v: { $prototype: "Search", $src: "@fake/pkg/y.class.json", q: "${state.term}" },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.v).toEqual({ echoed: "first" });
    state.term = "second";
    await wait(5);
    expect(state.v).toEqual({ echoed: "second" });
    expect(posts.map((p) => p.body.q)).toEqual(["first", "second"]);
  });

  test("proxy HTTP error logs via console.error (template path)", async () => {
    const err = spyOn(console, "error").mockImplementation(() => {});
    installFetch({ proxyOk: false });
    const doc: JxDocument = {
      state: {
        term: { default: "t" },
        v: { $prototype: "Search", $src: "@fake/pkg/z.class.json", q: "${state.term}" },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.v).toBe(null);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

// ─── resolveServerFunction (timing: "server") ────────────────────────────────

/**
 * Register the fixture module as a host does with `preloadModule`: the only way a server entry runs
 * in process. Every other entry is a POST to the proxy, however importable its module is.
 */
async function seedServerFns() {
  preloadModule(SERVER_SRC, await import(SERVER_SRC));
}

/**
 * A fetch whose POSTs stay pending until the test settles them, so answers can arrive in any order.
 * Returns the pending calls in the order they were made.
 */
function installDeferredFetch() {
  const calls: {
    body: JsonObject;
    answer: (value: JsonValue) => void;
    fail: (status: number) => void;
  }[] = [];
  stubFetch((_url, init) => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    calls.push({
      answer: (value) => resolve(Response.json(value)),
      body: postedBody(init),
      fail: (status) => resolve(new Response(null, { status })),
    });
    return promise;
  });
  return calls;
}

describe("resolveServerFunction", () => {
  test("static args: awaits result; second entry hits module cache", async () => {
    await seedServerFns();
    const doc: JxDocument = {
      state: {
        echo: {
          $export: "echoArgs",
          $src: SERVER_SRC,
          arguments: { a: 1 },
          timing: "server",
        },
        ok: {
          $export: "failing",
          $src: SERVER_SRC,
          arguments: { boom: false },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    expect(state.echo).toEqual({ got: { a: 1 } });
    expect(state.ok).toBe("ok");
  });

  test("reactive $ref args re-invoke on change", async () => {
    await seedServerFns();
    const doc: JxDocument = {
      state: {
        n: { default: 2 },
        result: {
          $export: "double",
          $src: SERVER_SRC,
          arguments: { n: { $ref: "#/state/n" } },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.result).toBe(4);
    state.n = 5;
    await wait(5);
    expect(state.result).toBe(10);
  });

  test("reactive args report a rejection, recover when args change", async () => {
    await seedServerFns();
    const err = spyOn(console, "error").mockImplementation(() => {});
    const doc: JxDocument = {
      state: {
        boom: { default: true },
        result: {
          $export: "failing",
          $src: SERVER_SRC,
          arguments: { boom: { $ref: "#/state/boom" } },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.result).toBe(null);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]![0]).toBe("Jx server function:");
    expect(String(err.mock.calls[0]![1])).toContain("boom");
    state.boom = false;
    await wait(5);
    expect(state.result).toBe("ok");
    err.mockRestore();
  });

  test("a host-registered module's superseded answer is dropped, as the proxy's is", async () => {
    const err = spyOn(console, "error").mockImplementation(() => {});
    const calls: { n: JsonValue | undefined; settle: PromiseWithResolvers<string> }[] = [];
    preloadModule("jx-test:/race-server.js", {
      slow: (args: JsonObject) => {
        const settle = Promise.withResolvers<string>();
        calls.push({ n: args.n, settle });
        return settle.promise;
      },
    });
    const doc: JxDocument = {
      state: {
        n: { default: 1 },
        result: {
          $export: "slow",
          $src: "jx-test:/race-server.js",
          arguments: { n: { $ref: "#/state/n" } },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    state.n = 2;
    expect(calls.map((c) => c.n)).toEqual([1, 2]);

    // The second call answers first, then the first call's late answer arrives and is dropped.
    calls[1]!.settle.resolve("second");
    await wait(5);
    expect(state.result).toBe("second");
    calls[0]!.settle.resolve("first");
    await wait(5);
    expect(state.result).toBe("second");

    // A superseded call's failure is dropped; the current call's keeps the value and is reported.
    state.n = 3;
    state.n = 4;
    calls[2]!.settle.reject(new Error("stale"));
    calls[3]!.settle.reject(new Error("current"));
    await wait(5);
    expect(state.result).toBe("second");
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![1])).toContain("current");
    err.mockRestore();
  });

  test("a host-registered function may answer or throw synchronously", async () => {
    // One call, one outcome: a synchronous throw is reported, never thrown out of the state write.
    const err = spyOn(console, "error").mockImplementation(() => {});
    preloadModule("jx-test:/sync-server.js", {
      twice: (args: JsonObject) => {
        if (args.n === 0) {
          throw new Error("zero");
        }
        if (!isNumber(args.n)) {
          throw new Error("twice takes a numeric n");
        }
        return args.n * 2;
      },
    });
    const doc: JxDocument = {
      state: {
        n: { default: 2 },
        result: {
          $export: "twice",
          $src: "jx-test:/sync-server.js",
          arguments: { n: { $ref: "#/state/n" } },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.result).toBe(4);
    expect(() => {
      state.n = 0;
    }).not.toThrow();
    await wait(5);
    expect(state.result).toBe(4);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  test("missing export throws", async () => {
    await seedServerFns();
    const doc: JxDocument = {
      state: {
        r: { $export: "ghost", $src: SERVER_SRC, timing: "server" },
      },
    };
    // oxlint-disable-next-line typescript/await-thenable -- bun-types types `.rejects.toThrow()` as void, but it returns a Promise at runtime that must be awaited
    await expect(buildScope(doc, {}, BASE)).rejects.toThrow('export "ghost" not found');
  });

  test("non-function export throws", async () => {
    await seedServerFns();
    const doc: JxDocument = {
      state: {
        r: { $export: "notFn", $src: SERVER_SRC, timing: "server" },
      },
    };
    // oxlint-disable-next-line typescript/await-thenable -- see above
    await expect(buildScope(doc, {}, BASE)).rejects.toThrow("is not a function");
  });

  test("an importable module is posted to the proxy, never imported", async () => {
    /* Before the runtime was proxy-only, a relative $src that failed to import from the runtime's
       own location was retried against the base, and a `file:` base made that second import
       succeed: the module ran in the browser. The tripwire flags any load of the module at all. */
    const tripped = () => globalThis.__jxTripwire === true;
    Reflect.deleteProperty(globalThis, "__jxTripwire");
    const posts = installFetch({ proxyValue: () => "proxied" });
    const doc: JxDocument = {
      state: {
        remote: {
          $export: "trip",
          $src: "./_server_fn_tripwire.js",
          arguments: { a: 1 },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.remote).toBe("proxied");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("/__jx_server__");
    expect(posts[0]!.body.$src).toBe("./_server_fn_tripwire.js");
    expect(posts[0]!.body.$base).toBe(BASE);
    expect(tripped()).toBe(false);

    // The tripwire can fire: that $src resolved against the same base loads the module.
    await import(new URL("_server_fn_tripwire.js", BASE).href);
    expect(tripped()).toBe(true);
    Reflect.deleteProperty(globalThis, "__jxTripwire");
  });

  test("a module the runtime imported for a Function entry is not reused", async () => {
    /* The Function entry (third pass) imports the specifier and caches it under that spelling; the
       server entry (fifth pass) names the same specifier, and still goes to the proxy, because only
       a host registration admits a server module in process. */
    const posts = installFetch({ proxyValue: () => "proxied" });
    const doc: JxDocument = {
      state: {
        dbl: { $export: "double", $prototype: "Function", $src: "./_gaps_server_fns.js" },
        remote: {
          $export: "double",
          $src: "./_gaps_server_fns.js",
          arguments: { n: 2 },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    await wait(5);
    expect(state.dbl).toBeInstanceOf(Promise);
    expect(await state.dbl).toBe(0);
    expect(state.remote).toBe("proxied");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.$src).toBe("./_gaps_server_fns.js");
    expect(posts[0]!.body.arguments).toEqual({ n: 2 });
  });

  test("a superseded proxy answer is dropped", async () => {
    const err = spyOn(console, "error").mockImplementation(() => {});
    const calls = installDeferredFetch();
    const doc: JxDocument = {
      state: {
        n: { default: 1 },
        remote: {
          $export: "fn6",
          $src: "./__gaps_missing_server_6__.js",
          arguments: { n: { $ref: "#/state/n" } },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, BASE);
    state.n = 2;
    expect(calls.map((c) => postedArgument(c.body, "n"))).toEqual([1, 2]);

    // The second call answers first, then the first call's late answer arrives and is dropped.
    calls[1]!.answer("second");
    await wait(5);
    expect(state.remote).toBe("second");
    calls[0]!.answer("first");
    await wait(5);
    expect(state.remote).toBe("second");

    // A superseded call's failure is dropped too: neither stored nor reported.
    state.n = 3;
    state.n = 4;
    calls[3]!.answer("fourth");
    calls[2]!.fail(500);
    await wait(5);
    expect(state.remote).toBe("fourth");
    expect(err).not.toHaveBeenCalled();

    // The current call's failure keeps the entry's last value, and is reported.
    state.n = 5;
    calls[4]!.fail(500);
    await wait(5);
    expect(state.remote).toBe("fourth");
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  test("an argument the proxy cannot serialize is reported, never thrown out of the write", async () => {
    /* The request body is serialized before the fetch starts, so a BigInt fails synchronously. That
       is still one failed call: reported once, with the entry keeping its last value. */
    const err = spyOn(console, "error").mockImplementation(() => {});
    const posts = installFetch({ proxyValue: (b) => postedArgument(b, "n") });
    const doc: JxDocument = {
      state: {
        n: { default: 1 },
        // A body is JavaScript (spec.md §21.4), so it can store what JSON cannot carry.
        overflow: { $prototype: "Function", body: "state.n = 10n" },
        remote: {
          $export: "fn7",
          $src: "./__gaps_missing_server_7__.js",
          arguments: { n: { $ref: "#/state/n" } },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, "file:///nonexistent/d7/");
    await wait(5);
    expect(state.remote).toBe(1);
    const { overflow } = state;
    if (!isFunction(overflow)) {
      throw new TypeError("state.overflow is not a function");
    }
    /* SAFETY: buildScope compiles a `body` with no parameters and no `return` into a handler of the
       scope (spec.md §5.3, Shape 4a), which takes the scope as its first argument. */
    const writeBigInt = overflow as (scope: JxScope) => void;
    expect(() => {
      writeBigInt(state);
    }).not.toThrow();
    await wait(5);
    expect(state.remote).toBe(1);
    expect(posts).toHaveLength(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]![0]).toBe("Jx server proxy:");
    expect(String(err.mock.calls[0]![1])).toContain("BigInt");
    err.mockRestore();
  });

  test("a static argument the proxy cannot serialize leaves the entry null", async () => {
    /* A document built in code can carry one (here a cycle, which only code can build); buildScope
       still resolves, and the call is reported. */
    const err = spyOn(console, "error").mockImplementation(() => {});
    const posts = installFetch({ proxyValue: () => "unreachable" });
    const cyclic: JsonObject = {};
    cyclic.self = cyclic;
    const doc: JxDocument = {
      state: {
        remote: {
          $export: "fn8",
          $src: "./__gaps_missing_server_8__.js",
          arguments: { n: cyclic },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, "file:///nonexistent/d8/");
    await wait(5);
    expect(state.remote).toBe(null);
    expect(posts).toHaveLength(0);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]![0]).toBe("Jx server proxy:");
    err.mockRestore();
  });

  test("posts $src, $export and $base to the /__jx_server__ proxy", async () => {
    const posts = installFetch({
      proxyValue: (b) => ({ r: postedArgument(b, "a") }),
    });
    const doc: JxDocument = {
      state: {
        remote: {
          $export: "anyFn",
          $src: "./__gaps_missing_server__.js",
          arguments: { a: "x" },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, "file:///nonexistent/dir/");
    await wait(5);
    expect(state.remote).toEqual({ r: "x" });
    expect(posts[0]!.url).toBe("/__jx_server__");
    expect(posts[0]!.body.$export).toBe("anyFn");
    expect(posts[0]!.body.$src).toBe("./__gaps_missing_server__.js");
    expect(posts[0]!.body.$base).toBe("file:///nonexistent/dir/");
  });

  test("posts to the proxy without a base", async () => {
    const posts = installFetch({ proxyValue: () => "no-base-proxied" });
    const doc: JxDocument = {
      state: {
        remote: {
          $export: "fn2",
          $src: "./__gaps_missing_server_2__.js",
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, "");
    await wait(5);
    expect(state.remote).toBe("no-base-proxied");
    expect(posts.length).toBe(1);
  });

  test("proxy with reactive $ref args re-posts on change", async () => {
    const posts = installFetch({
      proxyValue: (b) => ({ n: postedArgument(b, "n") }),
    });
    const doc: JxDocument = {
      state: {
        n: { default: 1 },
        remote: {
          $export: "fn3",
          $src: "./__gaps_missing_server_3__.js",
          arguments: { n: { $ref: "#/state/n" } },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, "file:///nonexistent/d2/");
    await wait(5);
    expect(state.remote).toEqual({ n: 1 });
    state.n = 7;
    await wait(5);
    expect(state.remote).toEqual({ n: 7 });
    expect(posts.map((p) => postedArgument(p.body, "n"))).toEqual([1, 7]);
  });

  test("proxy HTTP error logs via console.error (static and reactive paths)", async () => {
    const err = spyOn(console, "error").mockImplementation(() => {});
    installFetch({ proxyOk: false });
    const doc: JxDocument = {
      state: {
        n: { default: 1 },
        remoteReactive: {
          $export: "fn5",
          $src: "./__gaps_missing_server_5__.js",
          arguments: { n: { $ref: "#/state/n" } },
          timing: "server",
        },
        remoteStatic: {
          $export: "fn4",
          $src: "./__gaps_missing_server_4__.js",
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, "file:///nonexistent/d3/");
    await wait(5);
    expect(state.remoteStatic).toBe(null);
    expect(state.remoteReactive).toBe(null);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

// ─── setResolveToken / resolveProxyPath (dev-proxy auth token) ────────────────
//
// `_resolveToken` is MODULE-GLOBAL state. The afterEach below resets it after
// Every test, so a leaked token cannot bleed into the bare-path suites above.

describe("setResolveToken / resolveProxyPath", () => {
  afterEach(() => {
    setResolveToken(null);
  });

  /** A bare-specifier $src that always falls through to resolveViaDevProxy. */
  function bareSpecifierDoc(key: string): JxDocument {
    return {
      state: { v: { $prototype: "Search", $src: `@fake/pkg/${key}.class.json`, q: "x" } },
    };
  }

  test("calling the setter directly returns undefined (covers the exported setter)", () => {
    expect(setResolveToken("anything")).toBeUndefined();
    expect(setResolveToken(null)).toBeUndefined();
    expect(setResolveToken("")).toBeUndefined();
  });

  test("default (no token): dev-proxy resolve posts to the BARE /__jx_resolve__", async () => {
    const posts = installFetch({ proxyValue: () => "ok" });
    const state = await buildScope(bareSpecifierDoc("default"), {}, BASE);
    await wait(5);
    expect(state.v).toBe("ok");
    expect(posts.length).toBe(1);
    // No token configured → no "?token=" query appended.
    expect(posts[0]!.url).toBe("/__jx_resolve__");
    expect(posts[0]!.url).not.toContain("?token=");
  });

  test('setResolveToken("abc123"): dev-proxy resolve posts to /__jx_resolve__?token=abc123', async () => {
    setResolveToken("abc123");
    const posts = installFetch({ proxyValue: () => "ok" });
    const state = await buildScope(bareSpecifierDoc("tokened"), {}, BASE);
    await wait(5);
    expect(state.v).toBe("ok");
    expect(posts[0]!.url).toBe("/__jx_resolve__?token=abc123");
  });

  test("token value is encodeURIComponent-escaped in the query", async () => {
    // Characters that MUST be percent-encoded: space, &, =, /, +, #.
    setResolveToken("a b&c=d/e+f#g");
    const posts = installFetch({ proxyValue: () => "ok" });
    await buildScope(bareSpecifierDoc("encoded"), {}, BASE);
    await wait(5);
    expect(posts[0]!.url).toBe(`/__jx_resolve__?token=${encodeURIComponent("a b&c=d/e+f#g")}`);
    // Sanity: the raw, un-escaped token must NOT appear verbatim.
    expect(posts[0]!.url).not.toContain("a b&c=d/e+f#g");
  });

  test("server-function proxy (/__jx_server__) is token-gated too", async () => {
    setResolveToken("srv-tok");
    const posts = installFetch({ proxyValue: () => "served" });
    const doc: JxDocument = {
      state: {
        remote: {
          $export: "anyFn",
          $src: "./__gaps_token_missing_server__.js",
          arguments: { a: "x" },
          timing: "server",
        },
      },
    };
    const state = await buildScope(doc, {}, "file:///nonexistent/tok/");
    await wait(5);
    expect(state.remote).toBe("served");
    expect(posts[0]!.url).toBe("/__jx_server__?token=srv-tok");
  });

  test("is idempotent/resettable: setting back to null restores the bare path", async () => {
    setResolveToken("temp");
    const first = installFetch({ proxyValue: () => "with-token" });
    await buildScope(bareSpecifierDoc("reset-a"), {}, BASE);
    await wait(5);
    expect(first[0]!.url).toBe("/__jx_resolve__?token=temp");

    // Reset to null mid-test → next resolve must drop the query entirely.
    setResolveToken(null);
    const second = installFetch({ proxyValue: () => "no-token" });
    await buildScope(bareSpecifierDoc("reset-b"), {}, BASE);
    await wait(5);
    expect(second[0]!.url).toBe("/__jx_resolve__");
    expect(second[0]!.url).not.toContain("?token=");
  });

  test('empty-string token is treated as unset (setResolveToken("") → bare path)', async () => {
    // The setter normalizes falsy input to null (`token || null`).
    setResolveToken("");
    const posts = installFetch({ proxyValue: () => "ok" });
    await buildScope(bareSpecifierDoc("empty"), {}, BASE);
    await wait(5);
    expect(posts[0]!.url).toBe("/__jx_resolve__");
  });
});

// ─── observeScope (same-instance reactive observer) ───────────────────────────

describe("observeScope", () => {
  test("runs immediately, re-runs when a tracked runtime ref/reactive changes, and the disposer stops it", async () => {
    const { observeScope } = await import("../src/runtime");
    const state = reactive<{ items: number[] | string | null }>({ items: null });
    const seen: (number[] | string | null)[] = [];
    const stop = observeScope(() => {
      seen.push(state.items);
    });
    // First run is synchronous.
    expect(seen).toEqual([null]);

    // A change to the tracked reactive re-runs the observer (same reactivity instance).
    state.items = [1, 2];
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual([1, 2]);

    // After the disposer, further changes no longer re-run it.
    stop();
    state.items = "later";
    expect(seen).toHaveLength(2);
  });
});

// ─── runScoped (same-instance render scope ownership) ─────────────────────────

describe("runScoped", () => {
  test("owns renderNode's binding effects: live until stop(), dead after", async () => {
    const { renderNode: rn, runScoped } = await import("../src/runtime");
    const state = reactive({ msg: "one" });
    const { result: el, stop } = runScoped(() => {
      const node = rn({ children: ["${state.msg}"], tagName: "p" }, state);
      if (!(node instanceof HTMLElement)) {
        throw new Error("renderNode returned a Text node for a <p> definition");
      }
      return node;
    });
    expect(el.textContent).toBe("one");

    // The template effect attached to the runScoped scope and tracks the reactive state.
    state.msg = "two";
    expect(el.textContent).toBe("two");

    // After stop() the effect is gone — further state changes leave the DOM untouched.
    stop();
    state.msg = "three";
    expect(el.textContent).toBe("two");
  });

  test("a throwing fn stops its partial scope and rethrows", async () => {
    const { runScoped } = await import("../src/runtime");
    expect(() =>
      runScoped(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
  });
});
