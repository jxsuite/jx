/**
 * Perf tracing for Jx Studio user interactions.
 *
 * Launches headless Chrome, drives the studio through `window.__jxAutomation` (the app's own
 * command projection — the same paths a user hits), and records a DevTools timeline per scenario.
 * Output: scripts/perf/out/traces.json + a printed summary.
 *
 * Usage: bun scripts/perf/trace-studio.ts [--url <studio-url>] [--scen boot,palette] [--reps N]
 */

import { resolve as resolvePath } from "node:path";

import { mapSources } from "./sources.ts";

import { analyze } from "./analysis";

/* Resolved from THIS file's own location rather than a fixed home-directory path, so the same
 * default works on any checkout — a contributor's machine, a fresh clone, or CI's container,
 * where neither the checkout path nor `$HOME` match a developer's local layout. */
const DEFAULT_PROJECT = resolvePath(import.meta.dir, "../../sites/jxsuite.com/project.json");
const DEFAULT_URL = `http://127.0.0.1:3000/packages/studio/index.html?project=${encodeURIComponent(DEFAULT_PROJECT)}&automation=1`;

/* The binary is overridable via `--chrome` or `CHROME_BIN`: CI hands the container Chrome for
 * Testing over, and NixOS installs it under another name.
 */
const CHROME_BIN = (() => {
  const argvIdx = Bun.argv.indexOf("--chrome");
  if (argvIdx !== -1) {
    return Bun.argv[argvIdx + 1]! as string;
  }
  return process.env.CHROME_BIN ?? "google-chrome-stable";
})();

const CATEGORIES = [
  "devtools.timeline",
  "toplevel",
  "v8.execute",
  "disabled-by-default-devtools.timeline.stack",
  "disabled-by-default-devtools.timeline.invalidationTracking",
  "disabled-by-default-v8.cpu_profiler",
];

class Cdp {
  private nextId = 1;
  private ws: WebSocket;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private events: { method: string; params: any }[] = [];
  private listeners = new Map<string, ((params: any) => void)[]>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (m) => {
      const msg = JSON.parse(String(m.data)) as any;
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(JSON.stringify(msg.error)));
          } else {
            p.resolve(msg.result);
          }
        }
      } else if (msg.method) {
        const fns = this.listeners.get(msg.method);
        if (fns?.length) {
          for (const fn of fns) {
            fn(msg.params);
          }
        } else {
          this.events.push({ method: msg.method, params: msg.params });
        }
      }
    });
  }

  static async connect(port: number) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const list = (await response.json()) as any[];
    const page =
      list.find((target) => target.type === "page" && target.url === "about:blank") ??
      list.find((target) => target.type === "page");
    if (!page) {
      throw new Error("no page target");
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      const onOpen = () => {
        res();
      };
      const onError = () => {
        rej(new Error("websocket failed"));
      };
      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onError, { once: true });
    });
    const cdp = new Cdp(ws);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    return cdp;
  }

  send<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, fn: (params: any) => void) {
    if (!this.listeners.has(method)) {
      this.listeners.set(method, []);
    }
    this.listeners.get(method)!.push(fn);
  }

  off(method: string, fn?: (params: any) => void) {
    if (fn) {
      const fns = this.listeners.get(method);
      if (fns) {
        const i = fns.indexOf(fn);
        if (i !== -1) {
          fns.splice(i, 1);
        }
      }
    } else {
      this.listeners.delete(method);
    }
  }

  eventsOf(method: string): any[] {
    return this.events.filter((e) => e.method === method).map((e) => e.params);
  }

  drain() {
    this.events = [];
  }

  close() {
    this.ws.close();
  }
}

async function launchChrome(userDataDir: string, port: number) {
  const proc = Bun.spawn(
    [
      CHROME_BIN,
      "--headless=new",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      // Chromium's own sandbox refuses to run as root (the CI container is `--user root`) and a
      // Container's default 64 MB /dev/shm is too small for Chrome's shared memory, so both
      // Guards are disabled here rather than left to crash the renderer on first navigation.
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  let stderr = "";
  void new Response(proc.stderr)
    .text()
    .then((text) => {
      stderr = text;
    })
    .catch(() => {});
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
      return proc;
    } catch {
      await Bun.sleep(250);
    }
  }
  proc.kill(9);
  throw new Error(`Chrome did not come up${stderr ? `:\n${stderr.slice(-2000)}` : ""}`);
}

type CdpLike = InstanceType<typeof Cdp>;

async function evalJs(cdp: CdpLike, expression: string, awaitPromise = false): Promise<any> {
  const r: any = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    replMode: true,
  });
  if (r.exceptionDetails) {
    throw new Error(
      String(
        r.exceptionDetails.exception?.description ??
          JSON.stringify(r.exceptionDetails).slice(0, 300),
      ),
    );
  }
  return r.result.value;
}

async function waitFor(cdp: CdpLike, expression: string, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evalJs(cdp, expression)) {
        return;
      }
    } catch {
      /* Mid-navigation */
    }
    await Bun.sleep(200);
  }
  throw new Error(`waitFor timed out: ${expression}`);
}

async function idle(cdp: CdpLike) {
  await evalJs(cdp, "__jxAutomation.probe.idle().then(true)").catch(() => {});
}

async function runCommand(cdp: CdpLike, id: string, args: Record<string, unknown> = {}) {
  await evalJs(cdp, `__jxAutomation.run(${JSON.stringify(id)}, ${JSON.stringify(args)})`, true);
  await idle(cdp);
}

// ─── Trace capture ───────────────────────────────────────────────────────────

async function capture(cdp: CdpLike, name: string, interactions: () => Promise<void>) {
  cdp.drain();
  await cdp.send("Tracing.start", { traceConfig: { includedCategories: CATEGORIES } });
  const t0 = performance.now();
  await interactions();
  const wall = performance.now() - t0;
  const done = new Promise<void>((res) => {
    cdp.on("Tracing.tracingComplete", () => {
      res();
    });
  });
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.tracingComplete");
  const raw = cdp.eventsOf("Tracing.dataCollected").flatMap((p: any) => p.value);
  return { name, wall, events: raw };
}

// ─── Analysis ────────────────────────────────────────────────────────────────

// ─── Scenarios ───────────────────────────────────────────────────────────────

const SCENARIOS: {
  name: string;
  describe: string;
  url?: string;
  interactions: (cdp: CdpLike) => Promise<void>;
}[] = [
  {
    name: "boot",
    describe: "Cold boot, no document: navigation → app idle (perceived startup cost)",
    interactions: async (cdp) => {
      await cdp.send("Page.navigate", { url: BOOT_URL! });
      await waitFor(cdp, "!!globalThis.__jxAutomation");
      await idle(cdp);
    },
  },
  {
    name: "document-boot",
    describe:
      "Cold boot straight into a document (?file=pages/index.md): navigation → canvas live and idle",
    url: `${DEFAULT_URL}&file=pages/index.md`,
    interactions: async (cdp) => {
      await cdp.send("Page.navigate", { url: `${BOOT_URL}&file=pages/index.md` });
      await waitFor(cdp, "__jxAutomation.probe.state().document?.open === true");
      await idle(cdp);
    },
  },
  {
    name: "assistant",
    describe: "Assistant panel open + focus + new chat, then close (×3)",
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "view.setAssistant", { open: true });
        await runCommand(cdp, "assistant.newChat");
        await runCommand(cdp, "view.setAssistant", { open: false });
      }
    },
  },
  {
    name: "palette",
    describe: "Command palette: open → typed filter → Escape (×3)",
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "palette.open");
        await cdp.send("Input.insertText", { text: "open" });
        await idle(cdp);
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
        await idle(cdp);
      }
    },
  },
  {
    name: "palette-files",
    describe: "File palette: openFiles → typed filter → Escape (×3)",
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "palette.openFiles");
        await idle(cdp);
        await cdp.send("Input.insertText", { text: "jx" });
        await idle(cdp);
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
        await idle(cdp);
      }
    },
  },
  {
    name: "canvas-edit",
    describe:
      "Selection + inspector tab cycling on an open document (×3). Run document-boot (or any scenario that opens a document) first — this one measures the editing path, not the open.",
    interactions: async (cdp) => {
      if (!(await evalJs(cdp, "__jxAutomation.probe.state().document?.open === true"))) {
        await cdp.send("Page.navigate", { url: `${BOOT_URL}&file=pages/index.md` });
        await waitFor(cdp, "__jxAutomation.probe.state().document?.open === true");
        await idle(cdp);
      }
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "selection.set", { path: [] });
        await runCommand(cdp, "view.setRightTab", { tab: "style" });
        await runCommand(cdp, "view.setRightTab", { tab: "properties" });
        await runCommand(cdp, "selection.set", { path: null });
        await runCommand(cdp, "view.setRightTab", { tab: "events" });
        await runCommand(cdp, "view.setRightTab", { tab: "properties" });
      }
    },
  },
  {
    name: "grid-edit",
    describe: `Collection grid: open the "docs" grid, cycle to Source mode and back (read-only; ×3)`,
    interactions: async (cdp) => {
      // Requires the project to declare a content collection (the traced site's `docs` does).
      await evalJs(cdp, "__jxAutomation.run('collection.editInGrid', { name: 'docs' })", true);
      await idle(cdp);
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "canvas.setMode", { mode: "source" });
        await runCommand(cdp, "canvas.setMode", { mode: "grid" });
      }
    },
  },
  {
    name: "regions",
    describe: `Shell region cycling: view.cycleRegion (×6)`,
    interactions: async (cdp) => {
      for (let i = 0; i < 6; i++) {
        await runCommand(cdp, "view.cycleRegion");
      }
    },
  },
  {
    name: "panels",
    describe: `Navigator + inspector + bottom dock switching (each command ×3)`,
    interactions: async (cdp) => {
      await runCommand(cdp, "view.setNavigator", { panel: "outline" });
      await runCommand(cdp, "view.setNavigator", { panel: "collection" });
      await runCommand(cdp, "view.setNavigator", { panel: "page" });
      await runCommand(cdp, "view.setRightPanel", { panel: "content" });
      await runCommand(cdp, "view.setRightPanel", { panel: "assistant" });
      await runCommand(cdp, "view.setRightPanel", { panel: "content" });
      await runCommand(cdp, "view.setBottomTab", { tab: "events" });
      await runCommand(cdp, "view.setBottomTab", { tab: "problems" });
      await runCommand(cdp, "view.setBottomTab", { tab: "activity" });
    },
  },
  {
    name: "settings",
    describe: "Settings modal: open → Escape (×3)",
    interactions: async (cdp) => {
      for (let i = 0; i < 3; i++) {
        await runCommand(cdp, "settings.open");
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
        });
        await idle(cdp);
      }
    },
  },
];

let BOOT_URL: string | null = null;

// ─── Orchestration ───────────────────────────────────────────────────────────

const argv = Bun.argv.slice(2);
function flag(name: string, fallback: string) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : fallback;
}

async function main() {
  const url = flag("url", DEFAULT_URL);
  const reps = Math.max(1, Number(flag("reps", "3")));
  const scenFilter = flag("scen", "");
  const port = Number(flag("port", "9226"));
  const chrome = await launchChrome(`/tmp/opencode/jx-perf-${Date.now()}`, port);
  BOOT_URL = url;
  try {
    await Bun.sleep(400);
    const cdp: CdpLike = await Cdp.connect(port);

    const outDir =
      flag("out", "") === ""
        ? `/tmp/opencode/jx-perf-out-${Date.now()}`
        : new URL(flag("out", "./out"), `file://${new URL(".", import.meta.url).pathname}`)
            .pathname;
    if (flag("out", "") !== "") {
      await Bun.mkdir(outDir, { recursive: true });
    }
    const targets = scenFilter ? scenFilter.split(",") : SCENARIOS.map((s) => s.name);
    const results: Analysis[] = [];

    if (!targets.includes("boot")) {
      await cdp.send("Page.navigate", { url });
      await waitFor(cdp, "!!globalThis.__jxAutomation");
      await idle(cdp);
    }

    for (const scenario of SCENARIOS.filter((s) => targets.includes(s.name))) {
      const runs: Analysis[] = [];
      for (let r = 0; r < reps; r++) {
        console.error(`[scenario ${scenario.name} rep ${r}] start`);
        const t0 = Date.now();
        const { name, wall, events } = await capture(cdp, scenario.name, () =>
          scenario.interactions(cdp),
        );
        if (flag("dump", "0") === "1") {
          await Bun.write(
            `${outDir}/${scenario.name}-raw.json`,
            JSON.stringify(events, null, 0).slice(0, 20_000_000),
          );
        }
        console.error(
          `[scenario ${scenario.name} rep ${r}] captured ${events.length} events in ${Date.now() - t0}ms`,
        );
        runs.push(analyze(name, wall, events));
        cdp.drain();
      }
      const active = (run: Analysis) =>
        run.breakdown.scripting + run.breakdown.rendering + run.breakdown.painting;
      const median = [...runs].toSorted((a, b) => active(a) - active(b))[
        Math.floor(runs.length / 2)
      ]!;
      console.log(
        `[${scenario.name}] active per rep: ${runs.map((x) => active(x)).join(", ")}ms (reported median ${active(median)}ms)`,
      );
      results.push(median);
    }

    await Bun.write(
      `${outDir}/traces.json`,
      JSON.stringify({ generatedAt: new Date().toISOString(), url, reps, results }, null, 2),
    );
    for (const r of results) {
      console.log(`\n== ${r.scenario} (wall ${r.wallMs}ms, busy ${r.busyMs}ms) ==`);
      console.log(
        JSON.stringify(
          {
            breakdown: r.breakdown,
            styleRecalc: r.styleRecalc,
            styleCauses: r.styleCauses,
            layout: r.layout,
            gcMs: r.gcMs,
            longTasks: r.longTasks,
          },
          null,
          2,
        ),
      );
      if (r.topFrames.length > 0) {
        console.log("top frames:");
        for (const f of r.topFrames) {
          console.log(`  ${f.label} (self ${f.selfMs}ms, total ${f.totalMs}ms)`);
        }
      }
      const mapped = await mapSources(r.bundled);
      r.harnessMs = Number(
        mapped
          .filter((f) => f.file.includes("/services/idle.ts"))
          .map((f) => f.totalMs)
          .reduce((a, b) => a + b, 0)
          .toFixed(1),
      );
      r.breakdown.scripting = Number(Math.max(0, r.breakdown.scripting - r.harnessMs).toFixed(1));
      console.log(
        `harness idle-probe cost attributed: ${r.harnessMs}ms (subtracted from scripting)`,
      );
      if (mapped.some((f) => f.file.startsWith("packages/"))) {
        console.log("hot original sources:");
        for (const f of mapped.slice(0, 10)) {
          console.log(`  ${f.file} (${f.totalMs}ms)`);
        }
      }
    }
    console.log(`\nWrote ${outDir}/traces.json`);

    if (flag("write-baseline", "0") === "1") {
      const baselinePath =
        flag("baseline-out", "") === ""
          ? new URL("baseline.json", import.meta.url).pathname
          : flag("baseline-out", "./out/baseline.json").startsWith("/")
            ? flag("baseline-out", "")
            : new URL(
                flag("baseline-out", "./baseline.json"),
                `file://${new URL(".", import.meta.url).pathname}`,
              ).pathname;
      const baseline = {
        updatedAt: new Date().toISOString(),
        scenarios: results.map((r) => ({
          name: r.scenario,
          wallMs: r.wallMs,
          scriptingMs: r.breakdown.scripting + r.harnessMs,
          harnessMs: r.harnessMs,
          styleRecalcMs: r.styleRecalc.time,
          styleRecalcCount: r.styleRecalc.count,
          layoutMs: r.layout.time,
          gcMs: r.gcMs,
        })),
      };
      await Bun.write(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
      console.log(`Wrote ${baselinePath}`);
    }

    const comparePath = flag("compare", "");
    if (comparePath) {
      const baseline = JSON.parse(await Bun.file(comparePath).text()) as {
        scenarios: {
          name: string;
          wallMs: number;
          scriptingMs: number;
          styleRecalcMs: number;
          layoutMs: number;
        }[];
      };
      let regression = false;
      console.log(`\n== compare vs ${comparePath} ==`);
      console.log("scenario | wall | scripting | styleRecalc | layout");
      for (const base of baseline.scenarios) {
        const now = results.find((r) => r.scenario === base.name);
        if (!now) {
          continue;
        }
        const busyNow = now.breakdown.scripting + now.harnessMs;
        const cells: string[] = [];
        for (const [oldValue, freshValue] of [
          [base.wallMs, now.wallMs],
          [base.scriptingMs, busyNow],
          [base.styleRecalcMs, now.styleRecalc.time],
          [base.layoutMs, now.layout.time],
        ]) {
          if (!oldValue) {
            cells.push(`n/a → ${freshValue}`);
            continue;
          }
          const pct = Math.round(((freshValue - oldValue) / oldValue) * 100);
          if (pct > 20 && freshValue - oldValue > 25) {
            regression = true;
          }
          cells.push(`${oldValue} → ${freshValue} (${pct > 0 ? "+" : ""}${pct}%)`);
        }
        console.log(`${now.scenario} | ${cells.join(" | ")}`);
      }
      if (regression) {
        console.log("REGRESSION: at least one metric grew by more than 20% against the baseline");
        process.exitCode = 1;
      }
    }
  } finally {
    chrome.kill(9);
  }
}

if (Bun.main === Bun.argv[1]) {
  await main();
}
