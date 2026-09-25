/**
 * Lazy grid engine — memoization, the sync accessor's contract, and the load-once guarantee.
 *
 * Mirrors `monaco-lazy.test.ts`: `grid-panel.ts` must stay statically importable with no DOM (see
 * `grid-lazy.ts`'s header), so these tests pin the loader's behaviour directly rather than through
 * a mounted panel.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { tabulatorMockModule } from "./tabulator-mock";

void mock.module("tabulator-tables", () => tabulatorMockModule);
void mock.module("tabulator-tables/dist/css/tabulator.min.css", () => ({}));

const { loadedGridEngine, loadGridEngine, resetGridLazy } = await import("../src/grid/grid-lazy");

beforeEach(() => {
  resetGridLazy();
});

describe("loadGridEngine", () => {
  test("does not load until asked", () => {
    expect(loadedGridEngine()).toBeNull();
  });

  test("resolves the engine module and reports it loaded", async () => {
    const engine = await loadGridEngine();
    expect(typeof engine.createGridView).toBe("function");
    expect(loadedGridEngine()).toBe(engine);
  });

  test("is memoized — a second call returns the same module", async () => {
    const first = await loadGridEngine();
    const second = await loadGridEngine();
    expect(second).toBe(first);
  });

  test("concurrent callers share ONE in-flight load", async () => {
    const a = loadGridEngine();
    const b = loadGridEngine();
    expect(a).toBe(b);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
  });

  test("a load after a reset starts a fresh in-flight promise", async () => {
    const first = loadGridEngine();
    await first;
    resetGridLazy();
    const second = loadGridEngine();
    expect(second).not.toBe(first);
    expect(await second).toBeTruthy();
  });
});

describe("loadedGridEngine", () => {
  test("stays null until a load completes, then returns the module", async () => {
    const pending = loadGridEngine();
    // Synchronously after kicking off the load, nothing is available yet — call sites that use the
    // Sync accessor are only reachable once a grid has already mounted in the session.
    expect(loadedGridEngine()).toBeNull();
    const engine = await pending;
    expect(loadedGridEngine()).toBe(engine);
  });
});
