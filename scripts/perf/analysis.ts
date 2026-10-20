interface Breakdown {
  scripting: number;
  rendering: number;
  painting: number;
  loading: number;
  gc: number;
}

/** Every Breakdown category, so the rounding pass below reaches each one without a key cast. */
const BREAKDOWN_KEYS = [
  "scripting",
  "rendering",
  "painting",
  "loading",
  "gc",
] as const satisfies readonly (keyof Breakdown)[];

export interface Analysis {
  scenario: string;
  wallMs: number;
  busyMs: number;
  longTasks: number[];
  breakdown: Breakdown;
  styleRecalc: { count: number; time: number; elements: number };
  styleCauses: { label: string; count: number; time: number }[];
  layout: { count: number; time: number; invalidated: number };
  topFrames: { label: string; selfMs: number; totalMs: number }[];
  bundled: { url: string; line: number; totalMs: number }[];
  /**
   * Scripting cost of the tracer's own idle-probe wait, subtracted from breakdown.scripting after
   * sourcemap attribution.
   */
  harnessMs: number;
  gcMs: number;
}

/** A trace event's thread identity, `pid:tid`. */
export function threadKey(e: { pid?: unknown; tid?: unknown }): string {
  return `${Number(e.pid ?? 0)}:${Number(e.tid ?? 0)}`;
}

/**
 * The renderer main threads in a trace: every thread the `thread_name` metadata names
 * `CrRendererMain`.
 *
 * The analysis used to take `tid === 1` as the main thread, which no current Chrome emits: the
 * renderer main thread's tid is the renderer's pid, so `busyMs` read 0 and `longTasks` was empty on
 * every run, whatever the page did. A trace with no thread metadata (a hand-built fixture) falls
 * back to the old `tid 1` convention.
 */
export function mainThreads(events: any[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain") {
      out.add(threadKey(e));
    }
  }
  if (out.size === 0) {
    for (const e of events) {
      if (Number(e.tid) === 1) {
        out.add(threadKey(e));
      }
    }
  }
  return out;
}

/** CPU-profile pseudo-frames that are not a function's own work. */
const IDLE_NODES = new Set(["(garbage collector)", "(program)", "(idle)", "(root)"]);

/** The two names Chrome has given a scheduler task's envelope: `RunTask`, and the newer one. */
const TASK_NAMES = new Set(["RunTask", "ThreadControllerImpl::RunTask"]);

/**
 * A predicate answering whether a main-thread task envelope sits inside another one (a nested run
 * loop, or a task Chrome emits under `Receive mojo message`'s own envelope). Only the outermost
 * envelope is a task a user waits on, so only it counts toward `busyMs` and the long-task list.
 */
function taskNesting(events: any[], main: Set<string>): (e: any) => boolean {
  const nested = new Set<any>();
  const byThread = new Map<string, any[]>();
  for (const e of events) {
    if (TASK_NAMES.has(e.name) && e.dur !== undefined && main.has(threadKey(e))) {
      const list = byThread.get(threadKey(e)) ?? [];
      list.push(e);
      byThread.set(threadKey(e), list);
    }
  }
  for (const list of byThread.values()) {
    list.sort((a, b) => Number(a.ts) - Number(b.ts) || Number(b.dur) - Number(a.dur));
    let end = -Infinity;
    for (const e of list) {
      if (Number(e.ts) < end) {
        nested.add(e);
      } else {
        end = Number(e.ts) + Number(e.dur);
      }
    }
  }
  return (e) => nested.has(e);
}

/** The V8 slice a CPU profiler's start runs in, interrupting whatever task the page is in. */
const PROFILER_INTERRUPT = "V8.InvokeApiInterruptCallbacks";

/** How much of a task the profiler's interrupt must fill for the task to be the harness's own. */
const HARNESS_SHARE = 0.8;

/**
 * A predicate answering whether an outermost main-thread task is the TRACER's rather than the
 * app's: a task at least {@link HARNESS_SHARE} of which is the CPU profiler starting
 * (`V8.InvokeApiInterruptCallbacks`).
 *
 * Every capture opens with one: starting the sampling profiler interrupts the renderer, and the
 * interrupt lands as a 55 to 150 ms task inside `Receive mojo message`. It set the "max task" of
 * five scenarios whose own longest task was half that, and it was counted in `busyMs` of all of
 * them. A task the app ran that happens to contain a short interrupt is still the app's.
 */
function harnessTasks(events: any[], main: Set<string>, nested: (e: any) => boolean) {
  const interrupts = new Map<string, any[]>();
  for (const e of events) {
    if (e.name === PROFILER_INTERRUPT && e.dur !== undefined && main.has(threadKey(e))) {
      const list = interrupts.get(threadKey(e)) ?? [];
      list.push(e);
      interrupts.set(threadKey(e), list);
    }
  }
  return (task: any): boolean => {
    if (nested(task)) {
      return false;
    }
    const start = Number(task.ts);
    const end = start + Number(task.dur);
    let inside = 0;
    for (const e of interrupts.get(threadKey(task)) ?? []) {
      if (Number(e.ts) >= start && Number(e.ts) < end) {
        inside += Math.min(Number(e.dur), end - Number(e.ts));
      }
    }
    return Number(task.dur) > 0 && inside >= HARNESS_SHARE * Number(task.dur);
  };
}

type Category = keyof Breakdown | "other";

const SCRIPTING = new Set([
  "FunctionCall",
  "EventDispatch",
  "TimerFire",
  "FireAnimationFrame",
  "FireIdleCallback",
  "RunMicrotasks",
  "EvaluateScript",
  "V8.Execute",
  "v8.callFunction",
  "v8.run",
  "v8.compile",
  "v8.compileModule",
  "v8.evaluateModule",
  "V8.CompileCode",
  "V8.CompileLazy",
  "V8.ParseFunction",
  "V8.ParseProgram",
  "XHRReadyStateChange",
  "XHRLoad",
  "BlinkScheduler_PerformMicrotaskCheckpoint",
]);
const RENDERING = new Set([
  "UpdateLayoutTree",
  "Layout",
  "RecalculateStyles",
  "PrePaint",
  "HitTest",
  "UpdateLayerTree",
  "IntersectionObserverController::computeIntersections",
  "ScheduleStyleRecalculation",
]);
const PAINTING = new Set(["Paint", "PaintImage", "Layerize", "Commit", "CompositeLayers"]);
const LOADING = new Set(["ParseHTML", "ParseAuthorStyleSheet", "ResourceReceivedData"]);

/** The bucket an event's own (self) time belongs to, or null when it inherits its parent's. */
export function categoryOf(name: string): Category | null {
  if (
    name === "MajorGC" ||
    name === "MinorGC" ||
    name.startsWith("V8.GC") ||
    name.startsWith("BlinkGC")
  ) {
    return "gc";
  }
  if (SCRIPTING.has(name)) {
    return "scripting";
  }
  if (RENDERING.has(name)) {
    return "rendering";
  }
  if (PAINTING.has(name) || name.startsWith("Rasterize") || name.startsWith("Decode")) {
    return "painting";
  }
  if (LOADING.has(name) || name.startsWith("Resource")) {
    return "loading";
  }
  return null;
}

/**
 * Main-thread SELF time per category, the model the DevTools Performance panel's summary uses: each
 * complete event's own time (its duration minus its children's) goes to its category, and an event
 * with no category of its own (a task envelope, a mojo dispatch, a V8 interrupt) bills its self
 * time to the nearest categorised ancestor, or to nothing at top level.
 *
 * What it replaced summed `RunTask` + `FunctionCall` durations on EVERY thread of every process: a
 * task envelope is not scripting (it contains the style and layout it runs), a `FunctionCall`
 * inside it was counted twice, the GPU and IO threads' tasks were added in, and promise-driven work
 * under `RunMicrotasks` or `EventDispatch` was never counted at all. On a current Chrome, where the
 * envelope is named `ThreadControllerImpl::RunTask`, "scripting" had become just the `FunctionCall`
 * total.
 */
export function selfTimeBreakdown(events: any[], main: Set<string>): Breakdown {
  const out: Breakdown = { scripting: 0, rendering: 0, painting: 0, loading: 0, gc: 0 };
  const byThread = new Map<string, any[]>();
  for (const e of events) {
    if (e.ph === "M" || e.dur === undefined || !main.has(threadKey(e))) {
      continue;
    }
    const list = byThread.get(threadKey(e)) ?? [];
    list.push(e);
    byThread.set(threadKey(e), list);
  }
  for (const list of byThread.values()) {
    list.sort((a, b) => Number(a.ts) - Number(b.ts) || Number(b.dur) - Number(a.dur));
    const stack: { end: number; cat: Category; self: number }[] = [];
    const flush = (frame: { cat: Category; self: number }) => {
      if (frame.cat !== "other") {
        out[frame.cat] += Math.max(0, frame.self) / 1000;
      }
    };
    for (const e of list) {
      const ts = Number(e.ts);
      while (stack.length > 0 && stack.at(-1)!.end <= ts) {
        flush(stack.pop()!);
      }
      const parent = stack.at(-1);
      const end = Math.min(ts + Number(e.dur), parent ? parent.end : Infinity);
      const dur = Math.max(0, end - ts);
      if (parent) {
        parent.self -= dur;
      }
      stack.push({ end, cat: categoryOf(String(e.name)) ?? parent?.cat ?? "other", self: dur });
    }
    while (stack.length > 0) {
      flush(stack.pop()!);
    }
  }
  return out;
}

export function analyze(scenario: string, wallMs: number, events: any[]): Analysis {
  const main = mainThreads(events);
  const nestedTask = taskNesting(events, main);
  const harnessTask = harnessTasks(events, main, nestedTask);
  let busy = 0;
  const topFrames = new Map<string, { label: string; self: number; total: number }>();
  const profileNodes = new Map<string, { name: string; url: string; line: number }>();
  const bundleTotals = new Map<string, number>();
  const styleCauses = new Map<string, { count: number; time: number }>();
  const invalidations: { ts: number; cause: string }[] = [];
  const longTasks: number[] = [];
  let styleCount = 0;
  let styleElems = 0;
  let styleTime = 0;
  let layoutCount = 0;
  let layoutInvalid = 0;
  let layoutTime = 0;
  let gc = 0;

  const noteSelf = (label: string, ms: number) => {
    const f = topFrames.get(label) ?? { label, self: 0, total: 0 };
    f.self += ms;
    topFrames.set(label, f);
  };
  const noteTotal = (label: string, ms: number) => {
    const f = topFrames.get(label) ?? { label, self: 0, total: 0 };
    f.total += ms;
    topFrames.set(label, f);
  };

  for (const e of events) {
    const dur = Number(e.dur ?? 0) / 1000;
    const data = e.args?.data ?? {};
    switch (e.name) {
      case "RunTask":
      case "ThreadControllerImpl::RunTask": {
        if (!main.has(threadKey(e)) || nestedTask(e) || harnessTask(e)) {
          break;
        }
        busy += dur;
        if (dur >= 50) {
          longTasks.push(Number(dur.toFixed(0)));
        }
        break;
      }
      case "FunctionCall": {
        const cf = data;
        if (cf.url) {
          const key = `${cf.url}|${cf.lineNumber}`;
          bundleTotals.set(key, (bundleTotals.get(key) ?? 0) + dur);
        }
        const navbar = /^https?:\/\/[^/]+/.exec(cf.url ?? "")?.[0] ?? "";
        const label = `${cf.functionName || "(anonymous)"}${
          cf.url
            ? ` ${String(cf.url)
                .replace(navbar, "")
                .replace(/.*\/(packages|extensions)\/[^/]+/, "$1")}:${cf.lineNumber ?? ""}`
            : ""
        }`;
        noteTotal(label, dur);
        break;
      }
      case "ProfileChunk": {
        /* A profile streams as many chunks, and a chunk's samples name nodes an EARLIER chunk
           declared, so the node table spans the whole trace, keyed by the profile's id. Each
           sample's weight is its own `timeDeltas` entry: there is no `samplingInterval` field,
           which is why every self time this used to report was 0. */
        const cpu = data.cpuProfile ?? {};
        for (const n of cpu.nodes ?? []) {
          const cf = n.callFrame ?? {};
          profileNodes.set(`${e.id}:${n.id}`, {
            name: cf.functionName || "(anonymous)",
            url: cf.url ?? "",
            line: cf.lineNumber ?? 0,
          });
        }
        const deltas: unknown[] = Array.isArray(data.timeDeltas) ? data.timeDeltas : [];
        const samples: unknown[] = Array.isArray(cpu.samples) ? cpu.samples : [];
        for (const [i, sample] of samples.entries()) {
          const n = profileNodes.get(`${e.id}:${String(sample)}`);
          if (!n || IDLE_NODES.has(n.name)) {
            continue;
          }
          const where =
            /\/(packages|extensions)\/.*/.exec(n.url)?.[0] ?? n.url.replace(/^.*\//, "");
          noteSelf(`${n.name} ${where}:${n.line}`, Math.max(0, Number(deltas[i] ?? 0)) / 1000);
        }
        break;
      }
      case "UpdateLayoutTree": {
        styleCount += 1;
        styleTime += dur;
        styleElems += Number(e.args?.beginData?.totalElementCount ?? 0);
        const t0 = e.args?.beginData?.stackTrace?.[0] ?? {};
        let key = `${t0.functionName || "(anonymous)"}${t0.url ? ` ${String(t0.url).replace(/^https?:\/\/[^/]+/, "")}:${t0.lineNumber ?? ""}` : ""}`;
        if ((!t0.url && !t0.functionName) || key.startsWith("(anonymous) http")) {
          const near = invalidations.filter((iv) => iv.ts <= e.ts && iv.ts >= e.ts - 30);
          const inval = near.at(-1);
          if (inval) {
            key = inval.cause;
          }
        }
        const s = styleCauses.get(key) ?? { count: 0, time: 0 };
        s.count += 1;
        s.time += dur;
        styleCauses.set(key, s);
        break;
      }
      case "StyleRecalcInvalidationTracking":
      case "LayoutInvalidationTracking": {
        const d = e.args?.data ?? {};
        const f = (d.stackTrace ?? [])[0] ?? {};
        let cause = `${String(d.reason ?? "").trim() || "?"}`;
        if (f.functionName || d.functionName) {
          cause += ` ${d.functionName ?? f.functionName}`;
        }
        const url = f.url ?? d.url ?? "";
        if (url) {
          cause += ` ${String(url)
            .replace(/^https?:\/\/[^/]+/, "")
            .replace(
              /.*\/(packages|extensions)\/[^/]+/,
              "$1",
            )}:${d.lineNumber ?? f.lineNumber ?? ""}`;
        }
        invalidations.push({ ts: e.ts, cause });
        break;
      }
      case "Layout": {
        layoutCount += 1;
        layoutTime += dur;
        layoutInvalid += Number(e.args?.beginData?.dirtyObjects ?? 0);
        break;
      }
      case "MajorGC":
      case "MinorGC": {
        gc += dur;
        break;
      }
      default: {
        break;
      }
    }
  }

  const breakdown = selfTimeBreakdown(events, main);
  for (const k of BREAKDOWN_KEYS) {
    breakdown[k] = Number(breakdown[k].toFixed(1));
  }

  const ranked = [...topFrames.values()]
    .filter((f) => f.self > 5 || f.total > 15)
    .toSorted((a, b) => Math.max(b.self, b.total / 4) - Math.max(a.self, a.total / 4))
    .slice(0, 15)
    .map((f) => ({
      label: f.label,
      selfMs: Number(f.self.toFixed(1)),
      totalMs: Number(f.total.toFixed(1)),
    }));

  return {
    scenario,
    wallMs: Number(wallMs.toFixed(1)),
    busyMs: Number(busy.toFixed(1)),
    longTasks: longTasks.toSorted((a, b) => b - a).slice(0, 12),
    breakdown,
    styleRecalc: { count: styleCount, time: Number(styleTime.toFixed(1)), elements: styleElems },
    styleCauses: [...styleCauses.entries()]
      .flatMap(([label, s]) => {
        const time = Number(s.time.toFixed(1));
        return time > 1 ? [{ label, count: s.count, time }] : [];
      })
      .toSorted((a, b) => b.time - a.time)
      .slice(0, 10),
    layout: { count: layoutCount, time: Number(layoutTime.toFixed(1)), invalidated: layoutInvalid },
    topFrames: ranked,
    bundled: [...bundleTotals.entries()]
      .flatMap(([k, ms]) => {
        const [url, line] = k.split("|");
        const totalMs = Number(ms.toFixed(1));
        return totalMs > 10 ? [{ url: url!, line: Number(line) + 1, totalMs }] : [];
      })
      .toSorted((a, b) => b.totalMs - a.totalMs)
      .slice(0, 30),
    gcMs: Number(gc.toFixed(1)),
    harnessMs: 0,
  };
}
