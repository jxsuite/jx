import { describe, expect, test } from "bun:test";
import { scriptAdopter } from "../src/canvas/iframe-scripts";
import type { BodyEraserModule, ModuleLoader } from "@jxsuite/runtime";
import type { JxScope } from "@jxsuite/runtime/types";

/*
 * The frame's half of a document's own script (`spec.md` §23.2): the client text arrives beside the
 * document, and is registered with the runtime under the specifier the document names.
 */

const SPECIFIER = "jx-script:http://localhost:3000/proj/pages/index.json#client";

/** One call of the eraser's module loader: what it was asked for, and with what. */
interface Load {
  npm: string | undefined;
  specifier: string;
  text: string | undefined;
}

/** A frame with a recording runtime, and an eraser that can load a module unless told otherwise. */
function frame(canLoad = true) {
  const preloaded = new Map<string, () => Promise<JxScope>>();
  /** Every registration, in order, so one made twice shows twice. */
  const registered: string[] = [];
  const loads: Load[] = [];
  const loadModule: ModuleLoader = (specifier, options) => {
    loads.push({ npm: options.resolveNpm?.("npm:lit"), specifier, text: options.text });
    return Promise.resolve({ greet: () => "hi" });
  };
  const eraseBody: BodyEraserModule["eraseBody"] = (code) => ({ code, problems: [] });
  const adopt = scriptAdopter({
    loadEraser: () => Promise.resolve(canLoad ? { eraseBody, loadModule } : { eraseBody }),
    preload(specifier, load) {
      registered.push(specifier);
      preloaded.set(specifier, load);
    },
    resolveNpm: (specifier) => `/npm/${specifier}`,
  });
  /** Ask for the module registered under `specifier`, as the runtime does at first use. */
  const load = (specifier: string): Promise<JxScope> => {
    const loader = preloaded.get(specifier);
    if (!loader) {
      throw new Error(`nothing was registered under ${specifier}`);
    }
    return loader();
  };
  return { adopt, load, loads, registered };
}

describe("scriptAdopter", () => {
  test("each script is registered under its specifier, and loaded only when it is asked for", async () => {
    const { adopt, load, loads, registered } = frame();

    adopt({ [SPECIFIER]: "export const greet = () => 'hi';" });

    expect(registered).toEqual([SPECIFIER]);
    expect(loads).toEqual([]);

    const module = await load(SPECIFIER);

    expect(module).toHaveProperty("greet");
    expect(loads).toEqual([
      { npm: "/npm/npm:lit", specifier: SPECIFIER, text: "export const greet = () => 'hi';" },
    ]);
  });

  test("a render that carries the same text registers nothing again", () => {
    const { adopt, registered } = frame();
    adopt({ [SPECIFIER]: "export const a = 1;" });
    adopt({ [SPECIFIER]: "export const a = 1;" });
    expect(registered).toEqual([SPECIFIER]);
  });

  test("a saved script is a different text, and replaces the module", async () => {
    const { adopt, load, loads, registered } = frame();
    adopt({ [SPECIFIER]: "export const a = 1;" });
    adopt({ [SPECIFIER]: "export const a = 2;" });

    expect(registered).toEqual([SPECIFIER, SPECIFIER]);
    await load(SPECIFIER);
    expect(loads.map((entry) => entry.text)).toEqual(["export const a = 2;"]);
  });

  test("a render with no scripts registers nothing", () => {
    const { adopt, registered } = frame();
    adopt();
    adopt({});
    expect(registered).toEqual([]);
  });

  test("an eraser that cannot load a module says which script it could not load", async () => {
    const { adopt, load } = frame(false);
    adopt({ [SPECIFIER]: "export const a = 1;" });
    let message = "";
    try {
      await load(SPECIFIER);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain(`Jx: ${SPECIFIER} is a document's script`);
  });
});
