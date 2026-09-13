/// <reference lib="dom" />
// ─── Convert to Component ─────────────────────────────────────────────────────
/**
 * Extract the selected element into a reusable component.
 *
 * The naming question is `showPromptDialog` — one headline, one sentence, one field, one refusal —
 * which is exactly the shape this used to hand-render as an `sp-dialog-wrapper` of its own, down to
 * the Enter binding, the focus move and the select-all. That helper is already a document over the
 * kit (`src/surfaces/dialog.json`, studio-ui-guidelines §8.7), so the conversion here is a DELETION
 * rather than a second surface: a prompt authored beside the prompt would be a second answer to a
 * question Studio has settled once, and the two would drift the first time one of them was fixed.
 *
 * What is left is the flow, which is all this module ever owned that mattered: what the default
 * name is, what makes a name usable, whether the document actually took the reference, and what is
 * written to disk once it has.
 *
 * @docs studio/design/components
 */
import { displayTagName } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import { childIndex, getNodeAtPath, parentElementPath } from "../store";
import { primarySelection } from "../tabs/selection";
import { activeTab } from "../workspace/workspace";
import { transact } from "../tabs/transact";
import { componentRegistry, computeRelativePath, loadComponentRegistry } from "../files/components";
import { getPlatform } from "../platform";
import { jsonClone } from "../utils/studio-utils";
import { notify } from "../services/notify";
import { showPromptDialog } from "../ui/layers";
import { validateComponentSlots } from "../services/cem-export";

import type { JxMutableNode } from "@jxsuite/schema/types";

const VALID_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

/** Convert the currently selected element into a reusable component. */
export async function convertToComponent() {
  const tab = activeTab.value;
  const selected = primarySelection(tab?.session.selection);
  if (!tab || !selected || selected.length < 2) {
    return;
  }

  const node = getNodeAtPath(tab.doc.document, selected);
  if (!node || !node.tagName) {
    return;
  }

  const defaultName = deriveDefaultName(node);
  const chosen = await promptComponentName(defaultName);
  if (!chosen) {
    return;
  }
  /* The prompt resolves the TRIMMED value; the case fold is this module's, because it is the case
     fold `validateName` already judged the name in. A tag name is lower-case by the same rule that
     made `Hero-Block` default to `hero-block`. */
  const name = chosen.toLowerCase();

  // Extract component definition
  const componentDef = extractComponentDef(node);
  componentDef.tagName = name;

  // Compute paths
  const componentFile = `components/${name}.json`;
  const refPath = computeRelativePath(tab.documentPath, componentFile);

  // Single atomic mutation: replace node + add $elements ref
  const selectionPath = selected;
  const converted = transact(tab, (doc) => {
    // Navigate to parent's children array and replace the node
    const pp = parentElementPath(selectionPath) ?? [];
    const idx = childIndex(selectionPath) as number;
    let parent = doc;
    // Paths address nodes by construction (same contract as getNodeAtPath).
    for (const seg of pp) {
      parent = parent[seg] as JxMutableNode;
    }
    if (!Array.isArray(parent.children)) {
      parent.children = [];
    }
    parent.children[idx] = { tagName: name };

    // Ensure $elements exists and add the $ref
    if (!doc.$elements) {
      doc.$elements = [];
    }
    const alreadyReferenced = doc.$elements.some(
      (/** @type {JxMutableNode | string | { $ref: string }} */ el) =>
        el && typeof el === "object" && "$ref" in el && el.$ref === refPath,
    );
    if (!alreadyReferenced) {
      doc.$elements.push({ $ref: refPath });
    }
  });
  /* THE FILE IS WRITTEN ONLY IF THE DOCUMENT TOOK THE REFERENCE.
     `transact` consults the collab gate, which pauses structural editing while source is canonical.
     A refusal used to be invisible here: the extraction still wrote `components/<name>.json` to
     disk and still said "Converted to <name>" — leaving a component file nothing references, in a
     document the author was told had been changed. The gate raises its own toast saying why the
     edit is paused; the honest thing to add to it is nothing at all. */
  if (!converted) {
    return;
  }

  // Write component file and refresh registry
  try {
    const platform = getPlatform();
    await platform.writeFile(componentFile, JSON.stringify(componentDef, null, 2));
    await loadComponentRegistry();
    const warning = validateComponentSlots(componentDef);
    notify.success(`Converted to <${name}>`);
    if (warning) {
      // A slot warning is a thing to FIX, not a thing to read once: the component is written and
      // Usable, and the defect stays listed until somebody edits it.
      notify.warn(`<${name}> has a slot problem: ${warning}`, {
        path: componentFile,
        source: "Components",
        tier: "problem",
      });
    }
  } catch (error) {
    notify.error(`Could not save the <${name}> component.`, {
      detail: errorMessage(error),
      path: componentFile,
      source: "Components",
    });
  }
}

/**
 * Derive a default tag name from a node.
 *
 * @param {JxMutableNode} node
 * @returns {string}
 */
function deriveDefaultName(node: JxMutableNode) {
  if (node.$id && node.$id.includes("-")) {
    return node.$id.toLowerCase();
  }
  const tag = (displayTagName(node.tagName) || "div").toLowerCase();
  return tag.includes("-") ? tag : `jx-${tag}`;
}

/**
 * Deep clone a node and strip page-specific keys.
 *
 * @param {JxMutableNode} node
 * @returns {JxMutableNode}
 */
function extractComponentDef(node: JxMutableNode) {
  // JsonClone, not structuredClone: the selected node is a @vue/reactivity proxy,
  // Which structuredClone rejects with DataCloneError.
  const clone = jsonClone(node);
  delete clone.$id;
  delete clone.$layout;
  delete clone.$paths;
  return clone;
}

/**
 * Validate a component name against naming rules and existing registry.
 *
 * @param {string} val
 * @returns {{ valid: boolean; error: string }}
 */
function validateName(val: string) {
  const name = val.trim().toLowerCase();
  if (!name.includes("-")) {
    return {
      error: "Name must contain a hyphen (e.g. my-component)",
      valid: false,
    };
  }
  if (!VALID_NAME.test(name)) {
    return {
      error: "Lowercase letters, digits, and hyphens only",
      valid: false,
    };
  }
  const exists = componentRegistry.some((c) => c.tagName === name);
  if (exists) {
    return { error: `Component <${name}> already exists`, valid: false };
  }
  return { error: "", valid: true };
}

/**
 * Ask for the new component's tag name.
 *
 * Resolves the trimmed name, or `null` when the dialog was dismissed. The refusal, the Enter
 * binding, the focus move and the select-all all belong to `showPromptDialog`, which owns them for
 * every prompt in Studio; the only thing this passes in that no other prompt has is what counts as
 * a usable tag name.
 *
 * @param {string} defaultName
 * @returns {Promise<string | null>}
 */
function promptComponentName(defaultName: string): Promise<string | null> {
  return showPromptDialog("Convert to Component", {
    confirmLabel: "Convert",
    message: "Enter a hyphenated tag name for the new component.",
    placeholder: "my-component",
    validate: (value) => validateName(value).error,
    value: defaultName,
  });
}
