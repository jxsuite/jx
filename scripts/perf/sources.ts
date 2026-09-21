/**
 * Source-map attribution for perf traces: decode mappings and resolve bundled frames to original
 * sources.
 */

/** Decode the VLQ segments we need: original source index, line, col. */
/* oxlint-disable no-bitwise -- VLQ base64 decoding of source maps is inherently bit arithmetic. */
function vlqDecode(str: string): number[] {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const out: number[] = [];
  let sh = 0;
  let value = 0;
  for (const c of str) {
    const d = chars.indexOf(c);
    if (d === -1) {
      break;
    }
    value += (d & 31) << sh;
    if ((d & 32) !== 0) {
      sh += 5;
      continue;
    }
    out.push((value & 1) !== 0 ? -(value >> 1) : value >> 1);
    value = 0;
    sh = 0;
  }
  return out;
}
/* oxlint-enable no-bitwise */

export interface SourceMapFile {
  sources: string[];
  mappings: string;
}

export function parseMappings(sm: SourceMapFile): number[][][] {
  const byLine: number[][][] = [];
  let lineIdx = 0;
  let srcIdx = 0;
  for (const rawLine of sm.mappings.split(";")) {
    const segs: number[][] = [];
    let col = 0;
    for (const seg of rawLine.split(",")) {
      if (!seg) {
        continue;
      }
      const f = vlqDecode(seg);
      col += f[0]!;
      if (f.length >= 4) {
        srcIdx += f[1]!;
        lineIdx += f[2]!;
        segs.push([col, srcIdx, lineIdx]);
      }
    }
    byLine.push(segs);
  }
  return byLine;
}

export function lookupMapped(byLine: number[][][], sm: SourceMapFile, line0: number, col: number) {
  const segs = byLine[Math.min(line0, byLine.length - 1)];
  if (!segs?.length) {
    return null;
  }
  let best = segs[0]!;
  for (const s of segs) {
    if (s[0] <= col) {
      best = s!;
    } else {
      break;
    }
  }
  if (best.length < 3) {
    return null;
  }
  const src = sm.sources[best[1]!] ?? "";
  if (!src) {
    return null;
  }
  const stripped = src.replace(/^(\.\.\/)+/, "");
  return {
    file: stripped.startsWith("src/")
      ? `packages/studio/${stripped}`
      : stripped.startsWith("packages/")
        ? stripped
        : `packages/${stripped}`,
    line: best[2]! + 1,
  };
}

/**
 * Resolve bundled FunctionCall totals to original studio sources via the bundle's source map.
 * `bundled` is per-URL+line aggregated totals produced by analyze().
 */
export async function mapSources(bundled: { url: string; line: number; totalMs: number }[]) {
  const maps = new Map<string, { byLine: number[][][]; sm: SourceMapFile }>();
  const ensure = async (url: string) => {
    if (maps.has(url)) {
      return maps.get(url);
    }
    try {
      const response = await fetch(`${url}.map`);
      const sm = (await response.json()) as SourceMapFile;
      const entry = { byLine: parseMappings(sm), sm };
      maps.set(url, entry);
      return entry;
    } catch {
      maps.set(url, { byLine: [], sm: { sources: [], mappings: "" } });
      return maps.get(url)!;
    }
  };
  const byFile = new Map<string, number>();
  for (const frame of bundled) {
    const entry = await ensure(frame.url);
    const m = lookupMapped(entry.byLine, entry.sm, frame.line - 1, 200);
    const key = m ? `${m.file}:${m.line}` : `${frame.url.replace(/^.*\//, "")}:${frame.line}`;
    byFile.set(key, (byFile.get(key) ?? 0) + frame.totalMs);
  }
  return [...byFile.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([file, ms]) => ({ file, totalMs: Number(ms.toFixed(1)) }));
}
