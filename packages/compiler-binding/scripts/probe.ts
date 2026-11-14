/**
 * Prove one built addon works on the machine running this: load it by path, encode a small image to
 * AVIF and JPEG, and read a result back.
 *
 *     bun packages/compiler-binding/scripts/probe.ts <path to jx-compiler.<triple>.node>
 *     node packages/compiler-binding/scripts/probe.ts <path>      (Node 24 runs it as written)
 *
 * It is what the addon lanes (.github/workflows/addon.yml) run after each build, on the platform
 * the build is for. A linked library is not a loadable one: the first release's musl legs failed at
 * the link, and a link that succeeds against the wrong C library fails only here. AVIF is in the
 * probe because its encoder is the one part with per-platform assembly.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isBinding } from "../src/index.ts";
import { gradientPng } from "../tests/_png.ts";

const [path] = process.argv.slice(2);
if (!path) {
  throw new Error("usage: probe.ts <path to the addon>");
}
const addon: unknown = createRequire(import.meta.url)(resolve(path));
if (!isBinding(addon)) {
  throw new Error(`${path} loaded, but it is not the Jx compiler addon`);
}

const dir = mkdtempSync(join(tmpdir(), "jx-probe-"));
try {
  const source = join(dir, "probe.png");
  writeFileSync(source, gradientPng(64, 32));
  const manifest = await addon.processImage({
    formats: ["avif", "jpeg"],
    hashes: { avif: "probe", jpeg: "probe" },
    outDir: join(dir, "out"),
    quality: { avif: 50, jpeg: 70 },
    source,
    stem: "probe",
    widths: [32],
  });
  const names = manifest.variants.map((variant) => variant.fileName);
  const avif = readFileSync(join(dir, "out", "probe-32-probe.avif"));
  if (names.length !== 2 || avif.subarray(4, 12).toString("latin1") !== "ftypavif") {
    throw new Error(`${path} encoded ${names.join(", ") || "nothing"}, and no AVIF among it`);
  }
  const jpeg = await addon.imageMetadata(join(dir, "out", "probe-32-probe.jpeg"));
  if (jpeg.format !== "jpeg" || jpeg.width !== 32) {
    throw new Error(`${path} wrote a JPEG it reads back as ${JSON.stringify(jpeg)}`);
  }
  console.log(`${path}: core ${addon.coreVersion()}, encoded ${names.join(" and ")}`);
} finally {
  rmSync(dir, { force: true, recursive: true });
}
