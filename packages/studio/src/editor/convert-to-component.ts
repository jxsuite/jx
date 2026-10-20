/// <reference lib="dom" />
// ─── Convert to Component ─────────────────────────────────────────────────────
/**
 * Extract the selected element into a reusable component.
 *
 * The naming question is `showPromptDialog` — one headline, one sentence, one field, one refusal —
 * which is exactly the shape this used to hand-render as an `sp-dialog-wrapper` of its own, down to
 * the Enter binding, the focus move and the select-all. That helper is already a document over the
 * kit (`src/surfaces/dialog.json`, studio-ui-guidelines.md §8.7), so the conversion here is a
 * DELETION rather than a second surface: a prompt authored beside the prompt would be a second
 * answer to a question Studio has settled once, and the two would drift the first time one of them
 * was fixed.
 *
 * What is left is the flow, which is all this module ever owned that mattered: what the default
 * name is, whether the document actually took the reference, and what is written to disk once it
 * has. What makes a name usable is no longer this module's: it is HTML's valid custom element name,
 * stated once in `create/element-name.ts` and asked by Add new's Component kind too, which runs
 * {@link convertSelectionToComponent} for **Start from: Current selection** (`specs/studio.md`
 * §9.1.1).
 *
 * @docs studio/design/components
 */
import { displayTagName, isNonNullObject } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import { getNodeAtPath } from "@jxsuite/schema/doc-ops";
import { childIndex, parentElementPath } from "../store";
import { primarySelection } from "../tabs/selection";
import { activeTab } from "../workspace/workspace";
import { transact } from "../tabs/transact";
import { componentRegistry, computeRelativePath, loadComponentRegistry } from "../files/components";
import { getPlatform } from "../platform";
import { jsonClone } from "../utils/studio-utils";
import { serializeJson } from "@jxsuite/schema/json-layout";
import { notify } from "../services/notify";
import { showPromptDialog } from "../ui/layers";
import { validateComponentSlots } from "../services/cem-export";
import { customElementNameProblem, deriveTagName } from "../create/element-name";

import type { JxMutableNode, JxPath } from "@jxsuite/schema/types";

/**
 * The selected element a conversion would lift out, or `null` when there is none to convert.
 *
 * The root is not convertible (it is the document, not an element in it), and neither is a
 * selection the document cannot resolve to a node with a tag. Exported so Add new can say WHY its
 * Current selection choice is disabled rather than offering a button that does nothing.
 */
export function convertibleSelection(): { path: JxPath; node: JxMutableNode } | null {
  const tab = activeTab.value;
  const selected = primarySelection(tab?.session.selection);
  if (!tab || !selected || selected.length < 2) {
    return null;
  }
  const node = getNodeAtPath(tab.doc.document, selected);
  if (!node || !node.tagName) {
    return null;
  }
  return { node, path: selected };
}

/** Convert the currently selected element into a reusable component. */
export async function convertToComponent() {
  const subject = convertibleSelection();
  if (!subject) {
    return;
  }
  const chosen = await promptComponentName(deriveDefaultName(subject.node));
  if (!chosen) {
    return;
  }
  /* The prompt resolves the TRIMMED value; the case fold is this module's, because it is the case
     fold `validateName` already judged the name in. A tag name is lower-case by the same rule that
     made `Hero-Block` default to `hero-block`. */
  await convertSelectionToComponent(chosen.toLowerCase());
}

/**
 * Replace the selected element with an instance of a new component named `name`, and write the
 * component's definition to `components/<name>.json`.
 *
 * The caller has validated `name` (`create/element-name.ts`). The reference goes into the document
 * FIRST, in one transaction, and the file is written only if that transaction landed — see below.
 *
 * @returns The component file's path, or `null` when nothing was converted or the write failed.
 */
export async function convertSelectionToComponent(name: string): Promise<string | null> {
  const tab = activeTab.value;
  const subject = convertibleSelection();
  if (!tab || !subject) {
    return null;
  }
  const { node, path: selected } = subject;

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
    /* SAFETY: an element with a sibling position ends in `"children", <index>`, so this is the
       numeric child index. A selected repeater template (`…, "map"`) or `$switch` case also passes
       the two-segment check above; callers do not exclude that case yet, so it reaches here with a
       string segment exactly as before this cast. */
    const idx = childIndex(selectionPath) as number;
    let parent = doc;
    for (const seg of pp) {
      /* SAFETY: `pp` is the parent element's path, and a `JxPath` alternates node keys with
         `"children"` and an index, so walking it from the root lands on a node (the same contract as
         getNodeAtPath). */
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
      (el) => isNonNullObject(el) && "$ref" in el && el.$ref === refPath,
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
    return null;
  }

  // Write component file and refresh registry
  try {
    const platform = getPlatform();
    /* Through the save serializer (`@jxsuite/schema/json-layout`) rather than `JSON.stringify`, so the new
       file lands in the formatter's layout with its trailing newline and the first save from its
       tab is a clean diff. No layout to carry: the subtree was lifted out of another document, and
       its record there is keyed by that document's pointers. */
    await platform.writeFile(componentFile, serializeJson(componentDef, null));
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
    return componentFile;
  } catch (error) {
    notify.error(`Could not save the <${name}> component.`, {
      detail: errorMessage(error),
      path: componentFile,
      source: "Components",
    });
    return null;
  }
}

/**
 * The default tag name for a node: its `$id` when it has one, else its tag, through the shared
 * deriver — so `$id: "Hero"` proposes `site-hero` and a `<section>` proposes `site-section`, the
 * same answer Add new gives a component typed as "Hero".
 */
function deriveDefaultName(node: JxMutableNode) {
  if (node.$id) {
    const fromId = deriveTagName(node.$id);
    if (fromId !== "") {
      return fromId;
    }
  }
  const tag = (displayTagName(node.tagName) || "div").toLowerCase();
  return tag.includes("-") ? tag : deriveTagName(tag);
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
 * The refusal a component name earns, or `""`: HTML's valid custom element name, then uniqueness
 * against the registry.
 */
function validateName(val: string): string {
  const name = val.trim().toLowerCase();
  const problem = customElementNameProblem(name);
  if (problem !== "") {
    return problem;
  }
  return componentRegistry.some((c) => c.tagName === name)
    ? `Component <${name}> already exists`
    : "";
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
    validate: validateName,
    value: defaultName,
  });
}
