/// <reference lib="dom" />
/**
 * The Inspector's bound-value strip, as a flow (studio.md §6.6, §6.9).
 *
 * A row whose value is a template or a `{ "$ref" }` is drawn as the canvas draws bound text:
 * literal runs, and one chip per tag carrying its name and what it resolves to. A chip opens the
 * tag popover, which is the one place a tag is changed, so the Inspector and the canvas edit one
 * representation. The template's characters are a press away for the literal runs between tags.
 *
 * The values are the frame's (`evalTemplate`), asked once per value a row holds and kept, so a
 * repaint of the panel costs nothing and a chip never shows a value the canvas does not draw.
 *
 * @docs studio/editing/dynamic-tags
 */

import { isString, templateExpressions } from "@jxsuite/schema/guards";
import { requestTemplateEval } from "../canvas/iframe-host";
import { boundTagsOf, sameSlot } from "../editor/dynamic-tags";
import { tagTitlesAt } from "../editor/repeater-scope";
import { getNodeAtPath, projectState } from "../state";
import {
  disposeDetachedTagStrips,
  holdsTagStrip,
  renderTagStripSurface,
} from "../surfaces/tag-strip";
import { rectOf } from "../utils/geometry";
import { activeTab } from "../workspace/workspace";
import { openTagPopover, TAG_POPOVER_GAP } from "./tag-popover-door";

import type { JsonValue, JxDocumentValue } from "@jxsuite/schema/types";
import type { BoundTag } from "../editor/dynamic-tags";
import type { JxPath } from "../state";
import type { TagStripRun } from "../surfaces/tag-strip";

/** What a row hands the strip. */
export interface TagStripOpts {
  /** The row's own key: what "show the characters" is remembered under. */
  fieldKey: string;
  /** What the value is called: "Text Content", "href". */
  label: string;
  path: JxPath;
  /** The key path of the property on the node: `["attributes", "href"]`. */
  slot: (string | number)[];
  value: JxDocumentValue | undefined;
  /** Store a template typed as characters. */
  onChange: (value?: JsonValue) => void;
}

/** The rows showing their characters, by field key. */
const rawFields = new Set<string>();

/** What each host was last asked to draw, so a value that arrives later can draw it again. */
const lastOpts = new WeakMap<HTMLElement, TagStripOpts>();

/** What the frame said each tag of a value resolves to, by tab, place and value. */
const values = new Map<string, Map<number, string>>();

/** The values asked for and not yet answered. */
const asked = new Set<string>();

/** How many values are kept before the oldest are dropped. */
const VALUE_CAP = 200;

/** The runs of a row's value: its literal text and a chip per tag. */
export function stripRuns(
  value: JxDocumentValue | undefined,
  tags: readonly BoundTag[],
  resolved?: ReadonlyMap<number, string>,
): TagStripRun[] {
  const chip = (tag: BoundTag): TagStripRun => {
    const shown = resolved?.get(tag.index) ?? "";
    return {
      key: String(tag.index),
      kind: "chip",
      name: shown === "" ? tag.label : `${tag.label}: ${shown}`,
      tagKind: tag.kind,
      text: tag.label,
      value: shown,
    };
  };
  if (!isString(value)) {
    return tags.map((tag) => chip(tag));
  }
  const runs: TagStripRun[] = [];
  let at = 0;
  const text = (end: number): void => {
    if (end > at) {
      runs.push({
        key: `t${at}`,
        kind: "text",
        name: "",
        tagKind: "",
        text: value.slice(at, end),
        value: "",
      });
    }
  };
  for (const [index, part] of templateExpressions(value).entries()) {
    text(part.start);
    const tag = tags.find((candidate) => candidate.index === index);
    if (tag) {
      runs.push(chip(tag));
    }
    at = part.end;
  }
  text(value.length);
  return runs;
}

/**
 * Draw a row's bound value into `host` as runs and chips, or bring the strip there up to date.
 * Idempotent, like every control a row hands a box to.
 */
export function paintTagStrip(host: HTMLElement, opts: TagStripOpts): void {
  disposeDetachedTagStrips();
  lastOpts.set(host, opts);
  const tab = activeTab.value;
  const node = tab ? getNodeAtPath(tab.doc.document, opts.path) : null;
  const titles = tab
    ? tagTitlesAt(tab.doc.document, opts.path, projectState?.projectConfig ?? null)
    : null;
  const tags = boundTagsOf(node, titles).filter((tag) => sameSlot(tag.slot, opts.slot));
  /* What a value is asked under: the tab, the place, what the property holds, and the two things
     of the tab's that change what it resolves to without changing it (the active row a row tag
     reads, a state value set for the canvas). */
  const key = JSON.stringify([
    tab?.id ?? null,
    opts.path,
    opts.slot,
    opts.value ?? null,
    tab?.session.ui.activeRows ?? null,
    tab?.session.ui.stateValues ?? null,
  ]);
  const raw = isString(opts.value) && rawFields.has(opts.fieldKey);

  renderTagStripSurface(
    host,
    {
      label: opts.label,
      runs: stripRuns(opts.value, tags, values.get(key)),
      template: isString(opts.value) ? opts.value : "",
      toggleDisabled: !isString(opts.value),
      toggleLabel: raw ? "Show as tags" : "Edit as text",
      view: raw ? "raw" : "strip",
    },
    {
      commitRaw: (text) => {
        if (text !== opts.value) {
          opts.onChange(text === "" ? undefined : text);
        }
      },
      openChip: (index, anchor) => {
        const box = rectOf(anchor);
        openTagPopover(
          { index: Number(index), path: opts.path, slot: opts.slot },
          { at: { x: box.left, y: box.bottom + TAG_POPOVER_GAP }, returnFocus: anchor },
        );
      },
      toggleRaw: () => {
        if (rawFields.has(opts.fieldKey)) {
          rawFields.delete(opts.fieldKey);
        } else {
          rawFields.add(opts.fieldKey);
        }
        const current = lastOpts.get(host);
        if (current) {
          paintTagStrip(host, current);
        }
      },
    },
  );

  const templates = tags.flatMap((tag) =>
    tag.expr === null ? [] : [{ id: String(tag.index), template: `\${${tag.expr}}` }],
  );
  if (!tab || templates.length === 0 || values.has(key) || asked.has(key)) {
    return;
  }
  asked.add(key);
  void requestTemplateEval(tab.id, { path: opts.path, templates }).then((reply) => {
    asked.delete(key);
    if (!reply) {
      return;
    }
    if (values.size >= VALUE_CAP) {
      const [oldest] = values.keys();
      if (oldest !== undefined) {
        values.delete(oldest);
      }
    }
    values.set(key, new Map(reply.results.map((result) => [Number(result.id), result.text])));
    const current = lastOpts.get(host);
    // Only a box that still holds this strip: one another control has been given is not ours.
    if (current && host.isConnected && holdsTagStrip(host)) {
      paintTagStrip(host, current);
    }
  });
}

/**
 * Forget which rows were showing their characters and what each tag resolved to. Called when the
 * Inspector's tab body is bound or let go: both are the panel's own for as long as it stands.
 */
export function resetTagStrips(): void {
  rawFields.clear();
  values.clear();
  asked.clear();
}
