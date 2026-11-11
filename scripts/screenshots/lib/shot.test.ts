import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bootUrl,
  DOCK_COMMAND,
  frameBlockers,
  isCollectedPromise,
  matchState,
  OPEN_COMMANDS,
  rootStep,
  stepExpression,
} from "./shot";
import { resolveShot, validateManifest } from "./types";
import type { ShotContext, StepRecord } from "./shot";
import type { ResolvedOpen } from "./types";

const ctx: ShotContext = {
  force: false,
  log: () => {},
  outDir: "/repo/docs/images",
  projectRoot: "/repo/.cache/screenshots/projects/packages-starters-sites-restaurant",
  repoRoot: "/repo",
  serverUrl: "http://127.0.0.1:3000",
  studioPath: "/packages/studio/index.html",
};

function open(patch: Partial<ResolvedOpen> = {}): ResolvedOpen {
  const m = validateManifest({
    contract: 1,
    outDir: "docs/images",
    shots: [{ capture: [{ image: "x" }], name: "x" }],
  });
  return { ...resolveShot(m, m.shots[0]!).open, ...patch };
}

describe("bootUrl", () => {
  test("carries the four fields that are genuinely boot state", () => {
    const url = new URL(
      bootUrl(ctx, open({ clock: "2026-01-15T09:30:00Z", file: "pages/index.md" })),
    );
    expect(url.pathname).toBe("/packages/studio/index.html");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      automation: "1",
      clock: "2026-01-15T09:30:00Z",
      file: "pages/index.md",
      profile: "fresh",
      project: ctx.projectRoot!,
    });
  });

  test("opens the OVERLAY, never the repo-relative path the manifest wrote", () => {
    const url = new URL(bootUrl(ctx, open({ project: "packages/starters/sites/restaurant" })));
    const project = url.searchParams.get("project");
    expect(project).toBe(ctx.projectRoot!);
    expect(project).toContain(".cache/screenshots");
  });

  test("a shot with no project boots the welcome screen — no project, no file", () => {
    const bare: ShotContext = { ...ctx };
    delete bare.projectRoot;
    const url = new URL(bootUrl(bare, open()));
    expect(url.searchParams.has("project")).toBe(false);
    expect(url.searchParams.has("file")).toBe(false);
    expect(url.searchParams.get("profile")).toBe("fresh");
  });

  test("the profile is always stated — it replaced reaching around the app to clear an origin", () => {
    expect(bootUrl(ctx, open({ profile: "default" }))).toContain("profile=default");
  });
});

describe("the open→command mapping", () => {
  test("names one idempotent command per app-owned field", () => {
    expect(OPEN_COMMANDS).toEqual({
      fit: { arg: "fit", id: "canvas.setFit" },
      theme: { arg: "color", id: "view.setTheme" },
      view: { arg: "mode", id: "canvas.setMode" },
    });
    expect(DOCK_COMMAND).toBe("view.setDock");
  });

  test("no open field is applied through a toggle", () => {
    // DOCK_COMMAND is pinned to "view.setDock" exactly by the test above.
    for (const { id } of Object.values(OPEN_COMMANDS)) {
      expect(id).not.toMatch(/\.toggle[A-Z]/);
    }
  });
});

describe("matchState", () => {
  const state = {
    document: { dirty: false, mode: "md", open: true },
    git: { ahead: 0, dirtyCount: 3 },
    selection: { count: 1, kind: "p" },
  };

  test("a partial match reports nothing", () => {
    expect(matchState({ git: { dirtyCount: 3 } }, state)).toEqual([]);
    expect(matchState({}, state)).toEqual([]);
    expect(matchState({ document: { mode: "md" }, selection: { count: 1 } }, state)).toEqual([]);
  });

  test("a mismatch names the path, what it is and what was wanted", () => {
    expect(matchState({ document: { dirty: true } }, state)).toEqual([
      "document.dirty is false, expected true",
    ]);
  });

  test("every mismatch is reported, not just the first", () => {
    expect(matchState({ document: { dirty: true, mode: "json" } }, state)).toHaveLength(2);
  });

  test("a key the state does not carry is a mismatch, not a pass", () => {
    expect(matchState({ shell: { leftTab: "git" } }, state)).toEqual([
      "shell is undefined, expected an object",
    ]);
    expect(matchState({ git: { behind: 0 } }, state)).toEqual([
      "git.behind is undefined, expected 0",
    ]);
  });

  test("arrays compare by value, so a path assertion is exact", () => {
    expect(matchState({ sel: [1, 2] }, { sel: [1, 2] })).toEqual([]);
    expect(matchState({ sel: [1, 2] }, { sel: [1, 3] })).toEqual(["sel is [1,3], expected [1,2]"]);
  });

  test("expecting an object where the state holds a scalar says so", () => {
    expect(matchState({ git: { ahead: 0 } }, { git: 3 })).toEqual(["git is 3, expected an object"]);
  });
});

// ─── Where the pointer parks ─────────────────────────────────────────────────

describe("resetPointerAndFocus", () => {
  test("parks the cursor INSIDE the viewport", () => {
    /*
     * It used to move to `(-1, -1)` — off-canvas, so nothing matched `:hover`. CDP accepted that;
     * **WebDriver BiDi refuses it**: `input.performActions` rejects a move beyond the viewport with
     * "move target out of bounds", and every shot failed the moment the pipeline spoke the
     * standard's protocol. The bottom-right corner has the same property — no panel's interactive
     * content occupies it — in coordinates the standard allows.
     */
    const source = readFileSync(join(import.meta.dir, "shot.ts"), "utf8");
    expect(source).not.toContain("mouse.move(-1, -1)");
    expect(source).toContain("viewport.width - 1");
    expect(source).toContain("viewport.height - 1");
  });
});

// ─── frameBlockers ────────────────────────────────────────────────────────────

/**
 * A stand-in for one `@font-face` in a frame's `document.fonts`.
 *
 * `load()` moving the face to "loading" synchronously is the behaviour the predicate leans on, and
 * it is what the CSS Font Loading spec requires of an unloaded face, so the fake owes it too.
 */
class FakeFace {
  status: string;
  loads = 0;
  constructor(status: string) {
    this.status = status;
  }
  load(): Promise<FakeFace> {
    this.loads += 1;
    if (this.status === "unloaded") {
      this.status = "loading";
    }
    return Promise.resolve(this);
  }
}

/** Install the three globals `frameBlockers` reads, as a frame would present them. */
function installFrame(faces: FakeFace[], setStatus = "loaded"): void {
  Object.assign(globalThis, {
    document: {
      activeElement: null,
      fonts: { status: setStatus, [Symbol.iterator]: () => faces[Symbol.iterator]() },
      getAnimations: () => [],
    },
    window: {},
  });
}

/** Only the font clause; the focus clause reports once on first sight by design. */
const fontLines = () => frameBlockers().filter((line) => line.includes("font face"));

describe("frameBlockers", () => {
  test("triggers a declared-but-unstarted face and blocks on it", () => {
    const face = new FakeFace("unloaded");
    installFrame([face]);

    // The window the runner used to fall through: the stylesheet has parsed, nothing is in flight,
    // And `document.fonts.status` reads "loaded" over a set that has not begun.
    expect(fontLines()).toEqual(["1 font face(s) loading"]);
    expect(face.loads).toBe(1);
    expect(face.status).toBe("loading");
  });

  test("keeps blocking while a face is loading", () => {
    installFrame([new FakeFace("loading")]);
    expect(fontLines()).toEqual(["1 font face(s) loading"]);
  });

  test("clears once every face has resolved", () => {
    installFrame([new FakeFace("loaded"), new FakeFace("loaded")]);
    expect(fontLines()).toEqual([]);
  });

  test("a face that cannot load stops blocking, so an offline container terminates", () => {
    // "error" is where an unreachable webfont lands. Blocking on it would hang the shot until the
    // Idle timeout and then fail a capture that was never going to get its font.
    installFrame([new FakeFace("error")]);
    expect(fontLines()).toEqual([]);
  });

  test("honours the set's own aggregate status", () => {
    installFrame([], "loading");
    expect(fontLines()).toEqual(["1 font face(s) loading"]);
  });
});

// ─── Awaited steps ────────────────────────────────────────────────────────────

/** Give `rootStep` the page global it writes to, empty, and hand back the map it will fill. */
function installSteps(): Map<string, StepRecord> {
  const steps = new Map<string, StepRecord>();
  Object.assign(globalThis, { window: { __jxShotSteps: steps } });
  return steps;
}

describe("a rooted step", () => {
  test("is held from the page while it runs, and let go once it resolves", async () => {
    const steps = installSteps();
    let finish: (value: string[]) => void = () => {};
    const step = rootStep(
      "step-1",
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        }),
    );
    expect(steps.get("step-1")).toEqual({ promise: step, state: "pending" });
    finish(["quiet"]);
    expect(await step).toEqual(["quiet"]);
    expect(steps.get("step-1")).toEqual({ state: "done", value: ["quiet"] });
  });

  test("records what it rejected with, and still rejects", async () => {
    const steps = installSteps();
    const step = rootStep("step-2", () => Promise.reject(new RangeError("no such section")));
    let caught = "";
    try {
      await step;
    } catch (error) {
      caught = String(error);
    }
    expect(caught).toBe("RangeError: no such section");
    expect(steps.get("step-2")).toEqual({ message: "no such section", state: "error" });
  });

  test("records a synchronous throw as the step's rejection", async () => {
    const steps = installSteps();
    const step = rootStep("step-3", () => {
      throw new TypeError("broken hook");
    });
    await step.catch(() => {});
    expect(steps.get("step-3")).toEqual({ message: "broken hook", state: "error" });
  });

  test("makes the global when the page has none yet", async () => {
    const page: Pick<Window, "__jxShotSteps"> = {};
    Object.assign(globalThis, { window: page });
    await rootStep("step-4", () => 7);
    expect(page.__jxShotSteps?.get("step-4")).toEqual({ state: "done", value: 7 });
  });

  test("ships as one expression that runs the function with its arguments", async () => {
    const steps = installSteps();
    const expression = stepExpression("step-5", "(a, b) => Promise.resolve(a + b.n)", [
      2,
      { n: 3 },
    ]);
    // oxlint-disable-next-line no-eval -- the page evaluates this same string
    const result: unknown = await (0, eval)(expression);
    expect(result).toBe(5);
    expect(steps.get("step-5")).toEqual({ state: "done", value: 5 });
  });
});

describe("isCollectedPromise", () => {
  test("is the inspector's loss, in whatever the protocol wraps it", () => {
    expect(
      isCollectedPromise(
        "Protocol error (script.callFunction): unknown error Protocol error (Runtime.callFunctionOn): Promise was collected",
      ),
    ).toBe(true);
    expect(isCollectedPromise("Promise was collected")).toBe(true);
  });

  test("is not a step's own failure", () => {
    expect(isCollectedPromise('"data" is not a registered settings section')).toBe(false);
  });
});
