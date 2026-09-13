/// <reference lib="dom" />
// ─── Convert to Repeater ──────────────────────────────────────────────────────
/**
 * Turn the selected element into an `$prototype: "Array"` template.
 *
 * This is the flow only. It decides which state definitions can be an items source (including the
 * plugin ones, whose schema has to be fetched to find out), keeps the answer the reader is
 * assembling, refuses a name it cannot mint, and replaces the element in place. The dialog is
 * `src/surfaces/convert-repeater.json`, a `jx-dialog` over the kit, mounted by
 * `src/surfaces/convert-repeater.ts` — so the markup, the labels, the keyboard and the styling are
 * the document's, and nothing here re-renders anything: a refusal changes the one string it names.
 *
 * @docs studio/design/repeaters
 */
import { childIndex, childList, getNodeAtPath, parentElementPath } from "../store";
import { primarySelection } from "../tabs/selection";
import { activeTab } from "../workspace/workspace";
import { transactDoc } from "../tabs/transact";
import { layerHost } from "../ui/layers";
import { defCategory } from "../panels/signals-panel";
import { fetchPluginSchema } from "../services/code-services";
import { CREATE_NEW_SOURCE, openConvertRepeaterSurface } from "../surfaces/convert-repeater";

import type { ConvertRepeaterView } from "../surfaces/convert-repeater";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** What a name has to look like to become a state definition. */
const IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

interface RepeaterConfig {
  items: { $ref: string } | unknown[];
  filter?: { $ref: string };
  sort?: { $ref: string };
  newDef?: { name: string };
}

/** Convert the currently selected element into a repeater template. */
export async function convertToRepeater() {
  const tab = activeTab.value;
  const path = primarySelection(tab?.session.selection);
  if (!tab || !path || path.length < 2) {
    return;
  }

  const node = getNodeAtPath(tab.doc.document, path);
  if (!node) {
    return;
  }

  const defs = tab.doc.document.state || {};
  const config = await promptRepeaterConfig(defs);
  if (!config) {
    return;
  }

  transactDoc(tab, (t) => {
    const doc = t.doc.document;
    if (config.newDef) {
      if (!doc.state) {
        doc.state = {};
      }
      doc.state[config.newDef.name] = { default: [], type: "array" };
    }
    const pp = parentElementPath(path);
    if (!pp) {
      return;
    }
    const idx = childIndex(path) as number;
    const parent = getNodeAtPath(doc, pp);
    if (!parent?.children) {
      return;
    }
    const element = childList(parent)[idx];

    const repeater: Record<string, unknown> = {
      $prototype: "Array",
      items: config.items,
      map: element,
    };
    if (config.filter) {
      repeater.filter = config.filter;
    }
    if (config.sort) {
      repeater.sort = config.sort;
    }

    // Replace the selected element in place with the array pseudo-element — no wrapper div. The
    // Repeated items render directly among the original parent's children.
    (parent.children as (string | JxMutableNode)[])[idx] = repeater as unknown as JxMutableNode;
  });
}

/**
 * Every state definition that can be the items of a repeater.
 *
 * Three of the four answers are free: a declared `type: "array"`, an array `default`, or the
 * `Array` prototype itself. The fourth costs a round trip — a plugin definition only says what it
 * returns in its schema — so it is asked for once per definition, and only for the ones the first
 * three did not already claim.
 */
async function arraySourceNames(defs: Record<string, unknown>): Promise<string[]> {
  const named = Object.entries(defs)
    .filter(([, d]) => {
      const def = d as Record<string, unknown> | null;
      return def?.type === "array" || Array.isArray(def?.default) || def?.$prototype === "Array";
    })
    .map(([name]) => name);

  const docPath = activeTab.value?.documentPath;
  for (const [name, d] of Object.entries(defs)) {
    const def = d as Record<string, unknown> | null;
    if (!def?.$prototype || def.$prototype === "Function" || def.$prototype === "Array") {
      continue;
    }
    if (named.includes(name)) {
      continue;
    }
    const schema = await fetchPluginSchema(
      {
        ...(def.$src != null && { $src: def.$src as string }),
        $prototype: def.$prototype as string,
      },
      { ...(docPath != null && { documentPath: docPath }) },
    );
    if (schema?.returns?.type === "array") {
      named.push(name);
    }
  }
  return named;
}

/**
 * Ask which definition the repeater reads, and optionally which function filters and which sorts.
 *
 * Resolves the configuration, or `null` when the dialog was dismissed. Confirming an unusable new
 * name keeps the dialog open with the reason under the field — the flow's state machine, which is
 * the half the surface deliberately does not have.
 *
 * @param {Record<string, unknown>} defs
 * @returns {Promise<RepeaterConfig | null>}
 */
async function promptRepeaterConfig(defs: Record<string, unknown>): Promise<RepeaterConfig | null> {
  const sources = await arraySourceNames(defs);
  const functions = Object.entries(defs)
    .filter(([, d]) => defCategory(d) === "function")
    .map(([name]) => name);

  return new Promise<RepeaterConfig | null>((resolve) => {
    const view: ConvertRepeaterView = {
      error: "",
      filter: "",
      functions,
      newName: "",
      sort: "",
      source: sources[0] ?? CREATE_NEW_SOURCE,
      sources,
    };

    let settled = false;
    /* Resolve once, and take the dialog down with it. `close()` provokes the platform's own
       `close`, which comes back as `onClosed` — so the guard is what keeps a confirmed answer from
       being overwritten by the dismissal its own commit caused. */
    const finish = (config: RepeaterConfig | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      handle.close();
      resolve(config);
    };

    const refuse = (message: string): void => {
      view.error = message;
      handle.update(view);
    };

    /** The optional halves, which are the same two lines whichever source was chosen. */
    const optional = () => ({
      ...(view.filter && { filter: { $ref: `#/state/${view.filter}` } }),
      ...(view.sort && { sort: { $ref: `#/state/${view.sort}` } }),
    });

    const confirm = (): void => {
      if (view.source !== CREATE_NEW_SOURCE) {
        finish({ items: { $ref: `#/state/${view.source}` }, ...optional() });
        return;
      }
      const name = view.newName.trim();
      if (!name) {
        refuse("Enter a name for the new state definition.");
        return;
      }
      if (defs[name]) {
        refuse(`"${name}" already exists.`);
        return;
      }
      if (!IDENTIFIER.test(name)) {
        refuse("Invalid identifier name.");
        return;
      }
      finish({
        items: { $ref: `#/state/${name}` },
        ...optional(),
        newDef: { name },
      });
    };

    const handle = openConvertRepeaterSurface({
      layer: layerHost("dialog"),
      onClosed: () => finish(null),
      onConfirm: confirm,
      onName: (value) => {
        view.newName = value;
        // A keystroke retires the refusal it is answering; the confirm mints the next one.
        view.error = "";
        handle.update(view);
      },
      onPickFilter: (value) => {
        view.filter = value;
        handle.update(view);
      },
      onPickSort: (value) => {
        view.sort = value;
        handle.update(view);
      },
      onPickSource: (value) => {
        view.source = value;
        view.error = "";
        handle.update(view);
      },
      view,
    });
  });
}
