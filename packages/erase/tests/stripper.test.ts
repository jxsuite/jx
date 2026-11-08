/**
 * When the stripper is loaded (`spec.md` §23.1): only for a body that could be TypeScript, because
 * loading TypeScript's parser slows every later compile in the process.
 */
import { describe, expect, test } from "bun:test";
import tsBlankSpace from "ts-blank-space";
import { eraseBody, setStripperLoader } from "../src/core.ts";
import type { Stripper } from "../src/core.ts";

/** How often the loader was asked, and how often its stripper ran. */
interface Counts {
  loads: () => number;
  runs: () => number;
}

/** A loader that counts how often it is asked, and the stripper it hands back how often it runs. */
function counting(): Counts {
  let loads = 0;
  let runs = 0;
  setStripperLoader(() => {
    loads += 1;
    const stripper: Stripper = (text, onError) => {
      runs += 1;
      return tsBlankSpace(text, onError);
    };
    return stripper;
  });
  return { loads: () => loads, runs: () => runs };
}

describe("the stripper", () => {
  test("is never loaded for a body that is JavaScript with no `<`", () => {
    const count = counting();
    expect(eraseBody("state.count++; if (state.count > 3) state.count = 0;").code).toBe(
      "state.count++; if (state.count > 3) state.count = 0;",
    );
    expect(eraseBody('const x = "a < b"; // c < d\nreturn x;').problems).toEqual([]);
    expect(count.loads()).toBe(0);
  });

  test("is loaded once, for the first body that could be TypeScript, and reused", () => {
    const count = counting();
    expect(eraseBody("const n: number = 1;").code).toBe("const n         = 1;");
    expect(eraseBody("return (x as string).length;").code).toBe("return (x          ).length;");
    expect(count.loads()).toBe(1);
    expect(count.runs()).toBe(2);
  });

  test("still reads a generic call, which is JavaScript too", () => {
    counting();
    const [problem] = eraseBody("f < T > (x)").problems;
    expect(problem?.kind).toBe("meaning");
  });

  test("is an error to need without an entry that loads it", () => {
    setStripperLoader(() => {
      throw new Error("no stripper here");
    });
    expect(() => eraseBody("let unloaded: string;")).toThrow("no stripper here");
  });
});
