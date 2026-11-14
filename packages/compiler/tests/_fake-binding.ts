/**
 * A double for `@jxsuite/compiler-binding`, the compiler's native addon.
 *
 * The suite runs without a built addon, as it used to run without a loadable sharp: what these
 * tests prove is what the compiler asks of the encoder and what it does with the answer. The
 * encoder itself is proven in `packages/compiler-binding/crates/jx_media` and against the real
 * addon in `packages/compiler-binding/tests`. The double keeps the two behaviours callers depend
 * on: the width ladder (capped at the source, native width offered below the top rung) and a file
 * on disk for every variant it names.
 */

import { mock } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ImageManifest, ImageMetadata, ImageRequest } from "@jxsuite/compiler-binding";

/** What the double reports for every source. Mutate it in a test to change the source's size. */
export const fakeSource: ImageMetadata = { format: "jpeg", height: 600, width: 800 };

/** Restore the default source. */
export function resetFakeSource() {
  Object.assign(fakeSource, { format: "jpeg", height: 600, width: 800 });
}

function ladder(sourceWidth: number, configured: number[]): number[] {
  const ceiling = configured.length > 0 ? Math.max(...configured) : sourceWidth;
  const widths = configured.filter((width) => width > 0 && width <= sourceWidth);
  if (sourceWidth < ceiling || widths.length === 0) {
    widths.push(sourceWidth);
  }
  return [...new Set(widths)].toSorted((a, b) => a - b);
}

export const imageMetadata = mock(async (_source: string): Promise<ImageMetadata> => ({
  ...fakeSource,
}));

export const processImage = mock(async (request: ImageRequest): Promise<ImageManifest> => {
  mkdirSync(request.outDir, { recursive: true });
  const variants = ladder(fakeSource.width, request.widths).flatMap((width) =>
    request.formats.map((format) => {
      const fileName = `${request.stem}-${width}-${request.hash}.${format}`;
      writeFileSync(join(request.outDir, fileName), "");
      return { fileName, format, width };
    }),
  );
  return { original: { ...fakeSource }, variants };
});

/** Replace the addon with the double for every module imported after this call. */
export function installFakeBinding() {
  void mock.module("@jxsuite/compiler-binding", () => ({ imageMetadata, processImage }));
}
