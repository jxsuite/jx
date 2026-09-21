interface Analysis {
  scenario: string;
  wallMs: number;
  busyMs: number;
  longTasks: number[];
  breakdown: Record<string, number>;
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

export function analyze(scenario: string, wallMs: number, events: any[]): Analysis {
  let busy = 0;
  const topFrames = new Map<string, { label: string; self: number; total: number }>();
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
      case "RunTask": {
        if (Number(e.tid) !== 1) {
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
        const cpu = e.args?.data?.cpuProfile ?? {};
        const nodes = new Map<number, { name: string; url: string; line: number }>();
        for (const n of cpu.nodes ?? []) {
          const cf = n.callFrame ?? {};
          nodes.set(n.id, {
            name: cf.functionName || "(anonymous)",
            url: cf.url ?? "",
            line: cf.lineNumber ?? 0,
          });
        }
        const interval = Number(e.args?.data?.samplingInterval ?? 0);
        if (interval && Array.isArray(cpu.samples)) {
          const step = interval / 1000;
          for (const s of cpu.samples) {
            const n = nodes.get(s);
            if (!n || n.name === "(garbage collector)" || n.name === "(program)") {
              continue;
            }
            const label = `${n.name} ${/\/(packages|extensions)\/[^/]+/.exec(n.url)?.[0] ?? ""}:${n.line}`;
            noteSelf(label, step);
          }
        }
        break;
      }
      case "UpdateLayoutTree": {
        styleCount += 1;
        styleTime += dur;
        styleElems += Number(e.args?.beginData?.totalElementCount ?? 0);
        const t0 = (e.args?.beginData?.stackTrace?.[0] ?? {}) as any;
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

  const breakdown: Record<string, number> = {
    scripting: 0,
    rendering: 0,
    painting: 0,
    loading: 0,
    gc: 0,
  };
  for (const e of events) {
    const c = String(e.cat ?? "");
    const ms = Number(e.dur ?? 0) / 1000;
    if (e.name === "MajorGC" || e.name === "MinorGC") {
      breakdown.gc += ms;
    } else if (e.name === "RunTask" || e.name === "FunctionCall") {
      breakdown.scripting += ms;
    } else if (e.name === "UpdateLayoutTree" || e.name === "Layout") {
      breakdown.rendering += ms;
    } else if (
      c.includes("painting") ||
      e.name.startsWith("Paint") ||
      e.name.startsWith("Rasterize") ||
      e.name === "CompositeLayers"
    ) {
      breakdown.painting += ms;
    } else if (c.includes("loading") || e.name.startsWith("Resource")) {
      breakdown.loading += ms;
    }
  }
  for (const [k, v] of Object.entries(breakdown)) {
    breakdown[k] = Number(v.toFixed(1));
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
      .map(([label, s]) => ({ label, count: s.count, time: Number(s.time.toFixed(1)) }))
      .filter((s) => s.time > 1)
      .toSorted((a, b) => b.time - a.time)
      .slice(0, 10),
    layout: { count: layoutCount, time: Number(layoutTime.toFixed(1)), invalidated: layoutInvalid },
    topFrames: ranked,
    bundled: [...bundleTotals.entries()]
      .map(([k, ms]) => {
        const [url, line] = k.split("|");
        return { url, line: Number(line) + 1, totalMs: Number(ms.toFixed(1)) };
      })
      .filter((f) => f.totalMs > 10)
      .toSorted((a, b) => b.totalMs - a.totalMs)
      .slice(0, 30),
    gcMs: Number(gc.toFixed(1)),
    harnessMs: 0,
  };
}
