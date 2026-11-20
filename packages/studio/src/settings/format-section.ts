/// <reference lib="dom" />
/**
 * Document format — which notation a project writes new documents in, and the conversion of the
 * ones it already has (studio.md §8.6).
 *
 * The default is one key, `defaults.format`, written through the configuration chokepoint like
 * every other Settings edit. Converting is a separate act the section only starts: the plan, the
 * warnings (unsaved tabs, branches that are not merged) and the write are
 * `format/convert-project-flow.ts`. Choosing a default never converts anything, and converting
 * always offers to make its target the default, so the two cannot drift apart by accident.
 *
 * @docs studio/projects/settings
 */

import { projectConfigPath } from "../tabs/tab";
import { errorMessage } from "@jxsuite/schema/parse";
import { projectState } from "../store";
import { updateSiteConfig } from "../site-context";
import { mountFormatSurface } from "../surfaces/settings-format";
import type { FormatActions, FormatSurfaceHandle, FormatValues } from "../surfaces/settings-format";
import { NATIVE_FORMATS, defaultNativeExt } from "../format/default-format";
import type { NativeExt } from "../format/default-format";

/** The last failed write per rendered container, as the other save-on-change sections keep it. */
const errors = new WeakMap<HTMLElement, string>();
/** The census last read per container, or null before the first read answers. */
const censuses = new WeakMap<HTMLElement, { json: number; jxn: number }>();
const mounts = new WeakMap<HTMLElement, FormatSurfaceHandle>();
const bound = new WeakMap<HTMLElement, FormatActions>();

/** The sentence under the picker. */
export function summaryOf(census: { json: number; jxn: number } | null): string {
  if (census === null) {
    return "Counting the project's documents…";
  }
  const total = census.json + census.jxn;
  if (total === 0) {
    return "The project has no pages, templates or components yet.";
  }
  const plural = (n: number) => `${n} ${n === 1 ? "document is" : "documents are"}`;
  if (census.json === 0) {
    return `All ${total} documents are Jx Notation.`;
  }
  if (census.jxn === 0) {
    return `All ${total} documents are JSON.`;
  }
  return `${plural(census.json)} JSON and ${census.jxn} ${census.jxn === 1 ? "is" : "are"} Jx Notation.`;
}

/** What the button offers. */
export interface ConvertOffer {
  canConvert: boolean;
  label: string;
}

/** What the button says, and whether there is anything for it to do. */
export function convertOffer(
  census: { json: number; jxn: number } | null,
  target: NativeExt,
): ConvertOffer {
  const count = census === null ? 0 : target === ".jxn" ? census.json : census.jxn;
  const name = NATIVE_FORMATS.find((row) => row.ext === target)?.label ?? target;
  return {
    canConvert: count > 0,
    label: `Convert ${count} document${count === 1 ? "" : "s"} to ${name}…`,
  };
}

function values(container: HTMLElement): FormatValues {
  const target = defaultNativeExt();
  const census = censuses.get(container) ?? null;
  const offer = convertOffer(census, target);
  return {
    canConvert: offer.canConvert,
    convertLabel: offer.label,
    error: errors.get(container) ?? "",
    format: target === ".json" ? "json" : "jxn",
    formats: NATIVE_FORMATS.map((row) => ({ label: row.label, value: row.value })),
    summary: summaryOf(census),
  };
}

/** Read the census and redraw. Errors leave the count unknown rather than wrong. */
async function refreshCensus(container: HTMLElement): Promise<void> {
  try {
    const { censusOf, scanNativeDocuments } = await import("../format/convert-project");
    censuses.set(container, await censusOf(await scanNativeDocuments()));
  } catch {
    censuses.delete(container);
  }
  mounts.get(container)?.update(values(container));
}

function actions(container: HTMLElement): FormatActions {
  let acts = bound.get(container);
  if (!acts) {
    acts = {
      convert: () => {
        void (async () => {
          const { convertProject } = await import("../format/convert-project-flow");
          await convertProject(defaultNativeExt() === ".json" ? "json" : "jxn");
          await refreshCensus(container);
        })();
      },
      setFormat: (value: string) => {
        /* Echoed first so a refused write puts the old notation back (see Deploy's setAdapter). */
        mounts.get(container)?.update({ format: value });
        void (async () => {
          try {
            await updateSiteConfig({
              defaults: {
                ...projectState?.projectConfig?.defaults,
                format: value === "json" ? "json" : "jxn",
              },
            });
            errors.delete(container);
          } catch (error) {
            errors.set(container, `Could not save ${projectConfigPath()} — ${errorMessage(error)}`);
          }
          mounts.get(container)?.update(values(container));
        })();
      },
    };
    bound.set(container, acts);
  }
  return acts;
}

/**
 * Draw the section into a container.
 *
 * A standing surface is updated rather than remounted, so a redraw from outside never takes the
 * keyboard out of the picker.
 */
export function renderFormatSection(container: HTMLElement): void {
  const standing = mounts.get(container);
  if (standing?.connected()) {
    standing.update(values(container));
    return;
  }
  standing?.dispose();
  mounts.set(container, mountFormatSurface(container, values(container), actions(container)));
  void refreshCensus(container);
}
