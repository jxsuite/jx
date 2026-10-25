/**
 * Ai-tools.js — Jx document manipulation tools for the AI assistant
 *
 * Concrete `.jx` AST tools registered into a `@jxsuite/ai` ToolRegistry. Each tool wraps an
 * existing `transactDoc()` mutation helper so AI edits get the same undo/redo history as manual
 * edits (specs/ai.md §3.1 and §3.2 — optimistic apply, undo as the backstop).
 *
 * @license MIT
 */

import { createToolDefinition } from "@jxsuite/ai/tools";
import type { ToolContext, ToolRegistry, ToolResult } from "@jxsuite/ai/tools";
import type { JsonObject, JxMutableNode, JxPath } from "@jxsuite/schema/types";
import { coerceIndex, insertionSlot, isAncestor, isSpliceablePath } from "@jxsuite/schema/doc-ops";
import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import { getNodeAtPath } from "../state";
import type { Tab } from "../tabs/tab";
import {
  mutateAddDef,
  mutateInsertNode,
  mutateMoveNode,
  mutateRemoveDef,
  mutateUpdateProperty,
  mutateUpdateStyle,
  planMove,
  transactDoc,
} from "../tabs/transact";
import type { JxNodeValue } from "../tabs/transact";
import type { JsonValue } from "../types";
import { validateDoc } from "./jx-validate";
import { invalidPathResult, normalizeRelPath } from "./project-path";
import { serializeJson } from "@jxsuite/schema/json-layout";
import {
  reportDocumentWrite,
  snapshotBeforeWrite,
  translateValidationError,
} from "./ai-write-report";
import type { CandidateDocument, RenderVerdict } from "./ai-write-report";

/* Re-exported from its new home so `ai-project-tools.ts` and the tests keep their import: the
   translation moved with the verdict it belongs to (`ai-write-report.ts`), where every document
   write — hand-registered or projected from a command record — now reads it. */
export { translateValidationError } from "./ai-write-report";

const PATH_DESCRIPTION =
  "Path to a node in the document, as a JSON array of keys/indices from the root " +
  '(e.g. ["children", 0, "children", 1]). Use read_document to discover valid paths.';

/**
 * The node at `path`, typed as what {@link getNodeAtPath} actually answers: a path the model made up
 * runs off the tree, and that is `undefined`, which every tool here reports as "No node exists".
 */
function nodeAt(doc: JxMutableNode, path: JxPath): JxMutableNode | undefined {
  return getNodeAtPath(doc, path);
}

/**
 * A path as the model wrote it, with each index after a `"children"` segment that was written as a
 * canonical numeric string (`"0"`, `"12"`) read as its number. The tool schema admits strings in a
 * path because keys are strings, and the registry's validator admits a numeric string where an
 * integer is declared; either way `["children", "1"]` resolves (an array answers `"1"` as it does
 * `1`) and then fails every splice test downstream, which is how an edit succeeded without effect.
 *
 * @param {JxPath} path
 * @returns {JxPath}
 */
function coercePath(path: JxPath): JxPath {
  return path.map((segment, at) => {
    const index = at > 0 && path[at - 1] === "children" ? coerceIndex(segment) : null;
    return index ?? segment;
  });
}

/** Refusal for an index that is not a non-negative integer, naming the argument and its value. */
function indexError(name: string, value: JsonValue | undefined): ToolResult {
  return {
    success: false,
    error: `${name} must be a non-negative integer, such as 0 or 2 (got ${JSON.stringify(value)}).`,
  };
}

/** What {@link elementAt} answers: the element, or the refusal to hand back as the tool's result. */
type ElementLookup = { node: JxMutableNode; refusal?: never } | { refusal: ToolResult };

/**
 * The element `path` names, or the sentence refusing a write there. A key set on a text child or a
 * children array lands where nothing renders it, so the write would report success and change
 * nothing; a primitive value cannot hold keys at all.
 *
 * @param {JxMutableNode} doc
 * @param {JxPath} path
 * @param {string} name - The argument the path came from, as the model knows it
 * @returns {ElementLookup}
 */
function elementAt(doc: JxMutableNode, path: JxPath, name = "path"): ElementLookup {
  const node = nodeAt(doc, path);
  const where = `${name} ${JSON.stringify(path)}`;
  if (node === undefined) {
    return { refusal: { success: false, error: `No node exists at ${where}.` } };
  }
  if (Array.isArray(node)) {
    return {
      refusal: {
        success: false,
        error: `${where} points at a children array, not a node. Drop the trailing "children" segment.`,
      },
    };
  }
  if (!isNonNullObject(node)) {
    const what = isString(node) ? "a text child" : "a value";
    return {
      refusal: {
        success: false,
        error: `${where} points at ${what}, not a node. Address the element that holds it.`,
      },
    };
  }
  return { node };
}

/** Steering error for document tools called with no active tab. */
function noDocError(): ToolResult {
  return {
    success: false,
    error:
      "No document is open — use open_document(path) to open one on the canvas, or " +
      "read_file/write_file to work with project files directly.",
  };
}

/**
 * Apply a mutation, then hand the verdict to `ai-write-report.ts`: only the schema errors the edit
 * NEWLY introduced are reported, the render check runs when a renderCheck was provided and
 * rendering worked before, and a success carries the token hints. The change stays applied either
 * way (optimistic apply + undo); reporting the errors lets the agent loop self-correct on the next
 * round. Both rules are specs/ai.md §3.1.
 *
 * @param {Pick<ToolContext, "actor" | "ledger">} ctx - The call's actor and ledger
 * @param {import("../tabs/tab").Tab} tab
 * @param {(t: import("../tabs/tab").Tab) => void} mutationFn
 * @param {string} summary
 * @param {(doc: CandidateDocument) => Promise<string[]>} validate
 * @param {((doc: CandidateDocument) => Promise<RenderVerdict>) | undefined} renderCheck
 * @param {Record<string, string> | undefined} projectStyle
 * @returns {Promise<import("@jxsuite/ai/tools").ToolResult>}
 */
async function applyAndValidate(
  { actor, ledger }: Pick<ToolContext, "actor" | "ledger">,
  tab: Tab,
  mutationFn: (t: Tab) => void,
  summary: string,
  validate: (doc: CandidateDocument) => Promise<string[]>,
  renderCheck: ((doc: CandidateDocument) => Promise<RenderVerdict>) | undefined,
  projectStyle: Record<string, string> | undefined,
): Promise<ToolResult> {
  const deps = { getProjectStyle: () => projectStyle, renderCheck, validate };
  const before = await snapshotBeforeWrite(tab, deps);

  /* AND THE WRITE CAN BE REFUSED, in which case the model must be told rather than congratulated.
     The collab gate pauses structural editing while source is canonical, and this went on to
     record a ledger entry ("Changed N files") and validate the UNCHANGED document — which produces
     no new errors, so the tool answered `success: true`. The model then built its next three edits
     on a change that never existed. A refusal is an ordinary state of the room, so it is an error
     result with a reason the model can act on (wait, or ask the author), not a thrown exception. */
  /* Named, not inferred: the write joins the turn's batch lane by its actor (specs/ai.md §3.3), and
     the `await` above means any scope opened around this call would already have ended. */
  if (!transactDoc(tab, mutationFn, { actor })) {
    return {
      success: false,
      error:
        "The document is frozen: a collaborator is editing its source, so structural edits are " +
        "paused. Nothing was changed. Try again once source editing ends.",
    };
  }
  /* One ledger entry per mutation, so the panel's "Changed N files" counts documents the model
     touched rather than sentences it wrote (`ai.md` §3.2). `disk: false` is the load-bearing half:
     this went through transactDoc, so the tab's history — and "Restore to here" — can reach it. */
  ledger.record({ disk: false, ok: true, path: tab.documentPath ?? "(untitled)", tool: summary });

  return reportDocumentWrite(tab, before, summary, deps);
}

/**
 * Register the document-manipulation tools into a tool registry.
 *
 * @param {import("@jxsuite/ai/tools").ToolRegistry} registry
 * @param {{
 *   getTab: () => import("../tabs/tab").Tab | null;
 *   validate?: (doc: CandidateDocument) => Promise<string[]>;
 *   saveFile?: (relPath: string, content: string) => Promise<void>;
 *   renderCheck?: (doc: CandidateDocument) => Promise<{ ok: true } | { ok: false; error: string }>;
 *   projectStyle?: Record<string, string>;
 *   getProjectStyle?: () => Record<string, string> | undefined;
 *   findOpenTab?: (path: string) => import("../tabs/tab").Tab | null;
 *   reloadTab?: (path: string) => Promise<void>;
 * }} ctx
 */
export function registerAiTools(
  registry: Pick<ToolRegistry, "register">,
  {
    getTab,
    validate = validateDoc,
    saveFile,
    renderCheck,
    projectStyle,
    getProjectStyle,
    findOpenTab,
    reloadTab,
  }: {
    getTab: () => Tab | null;
    validate?: (doc: CandidateDocument) => Promise<string[]>;
    saveFile?: (relPath: string, content: string) => Promise<void>;
    renderCheck?: (doc: CandidateDocument) => Promise<{ ok: true } | { ok: false; error: string }>;
    projectStyle?: Record<string, string> | undefined;
    /**
     * Live variant of `projectStyle` — takes precedence; re-read per tool call so a project
     * bootstrapped mid-session contributes its design tokens.
     */
    getProjectStyle?: () => Record<string, string> | undefined;
    /** The open tab whose documentPath equals a project-relative path (write reconciliation). */
    findOpenTab?: (path: string) => Tab | null;
    /** Reload an open tab's document from disk after a file write. */
    reloadTab?: (path: string) => Promise<void>;
  },
) {
  const styleOf = getProjectStyle ?? (() => projectStyle);

  /**
   * Guard a disk write against an open tab: refuse while the tab has unsaved changes (the write
   * would silently diverge from the editor). Returns null when the write may proceed.
   */
  function dirtyTabError(relPath: string): ToolResult | null {
    const tab = findOpenTab?.(relPath);
    if (tab?.doc.dirty) {
      return {
        success: false,
        error:
          `"${relPath}" is open in the editor with unsaved changes. Use open_document plus the ` +
          `document tools to edit it, or ask the user to save or discard their changes first.`,
      };
    }
    return null;
  }

  /** Refresh an open (clean) tab from disk after a write; annotate the summary accordingly. */
  async function reconcileAfterWrite(relPath: string, summary: string): Promise<string> {
    if (findOpenTab?.(relPath)) {
      await reloadTab?.(relPath);
      return `${summary} The file's open editor tab was refreshed. (Saved to disk; not undoable.)`;
    }
    return `${summary} (Saved to disk; not undoable.)`;
  }
  registry.register(
    createToolDefinition({
      name: "read_document",
      description:
        "Read the current Jx document, or the subtree at a given path. Use this to discover " +
        "node paths before calling set_property, add_child, or delete_node.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "array",
            description: `${PATH_DESCRIPTION} Omit to read the whole document.`,
            items: { type: ["string", "number"] },
          },
        },
        required: [],
      },
      execute(args) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed, which refuses
           a `path` that is present but not an array. Its items are not checked; a key that does
           not resolve makes `nodeAt` answer undefined, reported just below. */
        const { path: written } = args as { path?: JxPath };
        const path = written && coercePath(written);
        const node = path && path.length > 0 ? nodeAt(tab.doc.document, path) : tab.doc.document;
        if (node === undefined) {
          return { success: false, error: `No node exists at path ${JSON.stringify(path)}.` };
        }
        return { success: true, data: node };
      },
    }),
  );

  registry.register(
    createToolDefinition({
      name: "set_property",
      description:
        "Set or remove a property on a node (e.g. tagName, textContent, className, style, " +
        "attributes, $props). Pass value: null to remove the property.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "array",
            description: PATH_DESCRIPTION,
            items: { type: ["string", "number"] },
          },
          key: {
            type: "string",
            description: 'The property name to set, e.g. "textContent" or "className".',
          },
          value: {
            description: "The new value, or null to remove the property.",
          },
        },
        /*
         * "value" omitted from required: passing null / omitting it means "remove the property",
         * but the registry rejects null on required args (tools.js:181). See `ai.md` §3.6.
         */
        required: ["path", "key"],
      },
      async execute(args, ctx) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `path` is a
           present array and `key` a present string. `value` declares no type, so it is any JSON
           value or absent, all of which `JxNodeValue` includes. A `path` whose items do not resolve
           is caught by `elementAt` just below. */
        const {
          key,
          path: written,
          value,
        } = args as {
          key: string;
          path: JxPath;
          value?: JxNodeValue;
        };
        const path = coercePath(written);
        const target = elementAt(tab.doc.document, path);
        if (target.refusal) {
          return target.refusal;
        }
        return applyAndValidate(
          ctx,
          tab,
          (t) => mutateUpdateProperty(t, path, key, value ?? undefined),
          `Set "${key}" at ${JSON.stringify(path)}.`,
          validate,
          renderCheck,
          styleOf(),
        );
      },
    }),
  );

  registry.register(
    createToolDefinition({
      name: "add_child",
      description:
        "Insert a new child node into the children array of the node at parentPath, at the " +
        "given index (0 = first child). The node definition follows the Jx document schema " +
        '(e.g. { "tagName": "p", "textContent": "Hello" }).',
      parameters: {
        type: "object",
        properties: {
          parentPath: {
            type: "array",
            description: `${PATH_DESCRIPTION} Must point at a node, not a children array.`,
            items: { type: ["string", "number"] },
          },
          index: { type: "integer", description: "Position in the children array to insert at." },
          node: {
            type: "object",
            description:
              'The Jx node definition to insert, e.g. { "tagName": "div", "children": [] }.',
          },
        },
        required: ["parentPath", "index", "node"],
      },
      async execute(args, ctx) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `parentPath` is
           a present array and `node` a present object. `node` is a model-written tree whose shape
           the schema check after the write judges, and a `parentPath` that does not resolve is
           caught just below. `index` is read untyped: the validator admits a numeric string for an
           integer, so `coerceIndex` decides what it names. */
        const { node: childNode, parentPath: writtenParent } = args as {
          node: JxMutableNode;
          parentPath: JxPath;
        };
        const parentPath = coercePath(writtenParent);
        const index = coerceIndex(args.index);
        if (index === null || index < 0) {
          return indexError("index", args.index);
        }
        const parent = nodeAt(tab.doc.document, parentPath);
        if (parent === undefined) {
          return { success: false, error: `No node exists at path ${JSON.stringify(parentPath)}.` };
        }
        /*
         * Guard against a parentPath that points at a children *array* rather than a node — the
         * common failure is a trailing "children" segment (e.g. ["children",0,"children"]).
         * add_child appends "children" + index itself, so an array-valued parentPath would splice
         * into a bogus `.children` property on the array (childArray() creates one) and the node
         * would be stored where nothing renders, yet the tool would report success. Reject it with
         * a precise message so the loop self-corrects.
         */
        if (Array.isArray(parent)) {
          return {
            success: false,
            error:
              `parentPath ${JSON.stringify(parentPath)} points at a children array, not a node. ` +
              `Drop the trailing "children" segment — add_child appends "children" and the index ` +
              `automatically. For example, to insert into the node at ["children",0,"children",1], ` +
              `pass parentPath: ["children",0,"children",1].`,
          };
        }
        const target = elementAt(tab.doc.document, parentPath, "parentPath");
        if (target.refusal) {
          return target.refusal;
        }
        if (parent.children !== undefined && !Array.isArray(parent.children)) {
          return {
            success: false,
            error: "Cannot insert into mapped-array children; edit the map template instead.",
          };
        }
        // Past the end appends, and the summary names the slot the node really landed in.
        const slot = insertionSlot(index, parent.children?.length ?? 0);
        return applyAndValidate(
          ctx,
          tab,
          (t) => mutateInsertNode(t, parentPath, slot, childNode),
          `Inserted node at ${JSON.stringify([...parentPath, "children", slot])}.`,
          validate,
          renderCheck,
          styleOf(),
        );
      },
    }),
  );

  // ── set_style ──────────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "set_style",
      description:
        "Set or remove a CSS style property on a node. Style property names use camelCase " +
        '(e.g. "backgroundColor", "fontSize", "borderRadius"). Values are always strings ' +
        '(e.g. "10px", "center", "var(--color-accent)"). Pass value: null to remove.',
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "array",
            description: PATH_DESCRIPTION,
            items: { type: ["string", "number"] },
          },
          property: {
            type: "string",
            description: 'CSS property name in camelCase, e.g. "backgroundColor".',
          },
          value: {
            description:
              'CSS value as a string (e.g. "10px", "var(--color-accent)"), or null to remove.',
          },
        },
        /*
         * "value" omitted from required so null / omitted = remove (registry rejects null on
         * required args, tools.js:181). See `ai.md` §3.6.
         */
        required: ["path", "property"],
      },
      async execute(args, ctx) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `path` is a
           present array and `property` a present string; a `path` that does not resolve is caught
           just below. `value` is read untyped and stringified. */
        const { path: written, property } = args as { path: JxPath; property: string };
        const { value } = args;
        const path = coercePath(written);
        const target = elementAt(tab.doc.document, path);
        if (target.refusal) {
          return target.refusal;
        }
        /* A nested key is a whole rule (`@media …`, `:hover`, `&.active`, `[open]`) whose value is an
           object; written here it would be stringified to "[object Object]". */
        if (/^[@:&[]/.test(property)) {
          return {
            success: false,
            error:
              `"${property}" is a nested style rule (a media query, pseudo-class or selector), ` +
              'which set_style cannot write. Use set_property with key "style" and the whole ' +
              "style object instead.",
          };
        }
        const prop = property;
        const val = value == null ? undefined : String(value);
        return applyAndValidate(
          ctx,
          tab,
          (t) => mutateUpdateStyle(t, path, prop, val),
          `Set style "${prop}" at ${JSON.stringify(path)}.`,
          validate,
          renderCheck,
          styleOf(),
        );
      },
    }),
  );

  // ── set_text ───────────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "set_text",
      description:
        "Set the textContent of a node. Convenience alias for set_property with key: 'textContent'.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "array",
            description: PATH_DESCRIPTION,
            items: { type: ["string", "number"] },
          },
          value: { type: "string", description: "Text content." },
        },
        required: ["path", "value"],
      },
      async execute(args, ctx) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `path` is a
           present array and `value` a present string; a `path` that does not resolve is caught
           just below. */
        const { path: written, value } = args as { path: JxPath; value: string };
        const path = coercePath(written);
        const target = elementAt(tab.doc.document, path);
        if (target.refusal) {
          return target.refusal;
        }
        return applyAndValidate(
          ctx,
          tab,
          /* Through the recording mutators, as two `set-key` ops, rather than by writing the node
             directly. An unrecorded write reaches the canvas only as a full re-render, history only
             as a whole-document snapshot, and collaborators only as a diff. */
          (t) => {
            mutateUpdateProperty(t, path, "textContent");
            mutateUpdateProperty(t, path, "children", [value]);
          },
          `Set text at ${JSON.stringify(path)}.`,
          validate,
          renderCheck,
          styleOf(),
        );
      },
    }),
  );

  // ── add_state ──────────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "add_state",
      description:
        "Add a new reactive state variable under the document's `state` object. The value can be a scalar " +
        '(e.g. 0, ""), a typed object ({ "type": "string", "default": "" }), a computed ' +
        'string ("${state.other}"), a function ({ "$prototype": "Function", "body": "..." }), ' +
        'or a data source ({ "$prototype": "Data", "$src": "./data.json" }).',
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: 'State variable name, e.g. "count", "isOpen".' },
          value: {
            description:
              "Initial value or state shape object (scalar, typed, computed, function, or data source).",
          },
        },
        required: ["key", "value"],
      },
      async execute(args, ctx) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed, so `key` is a
           present string. */
        const { key } = args as { key: string };
        const { value } = args;
        if (tab.doc.document.state && tab.doc.document.state[key] !== undefined) {
          return {
            success: false,
            error: `State key "${key}" already exists. Use update_state to change it, or remove it first.`,
          };
        }
        return applyAndValidate(
          ctx,
          tab,
          /* `mutateAddDef` rather than `mutateUpdateProperty`: the latter deletes on "", which is
             wrong for a state default (`"title": ""`). It also records the op, so the canvas, the
             history and collaborators each get the edit as an edit. */
          /* SAFETY: `value` is required, so the registry refused it missing or null; it is the
             model's state entry, possibly a scalar default (`0`, `""`) the schema admits.
             `mutateAddDef` only clones `def` and stores it under `state[key]`, never reading it
             as the object its parameter names. */
          (t) => mutateAddDef(t, key, value as Record<string, JsonValue>),
          `Added state "${key}".`,
          validate,
          renderCheck,
          styleOf(),
        );
      },
    }),
  );

  // ── update_state ───────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "update_state",
      description:
        "Update or remove an existing state variable at the document root. Pass value: null to remove.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: 'State variable name to update, e.g. "count".' },
          value: {
            description:
              "New value (same shapes as add_state), or null to remove the state variable.",
          },
        },
        /*
         * "value" omitted from required so null = remove (registry rejects null on required
         * args, tools.js:181). See `ai.md` §3.6.
         */
        required: ["key"],
      },
      async execute(args, ctx) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed, so `key` is a
           present string. */
        const { key } = args as { key: string };
        const { value } = args;
        if (!tab.doc.document.state || tab.doc.document.state[key] === undefined) {
          return {
            success: false,
            error: `State key "${key}" does not exist. Use add_state to create it, or check the name. Current state keys: ${Object.keys(tab.doc.document.state || {}).join(", ") || "(none)"}`,
          };
        }
        return applyAndValidate(
          ctx,
          tab,
          /* The recording def mutators, for the reason `add_state` gives. Removing the last key
             drops the empty `state` object, as the Inspector's own removal does. */
          (t) => {
            if (value == null) {
              mutateRemoveDef(t, key);
            } else {
              /* SAFETY: the model's state entry, possibly a scalar default the schema admits.
                 `mutateAddDef` only clones `def` and stores it under `state[key]`, never reading
                 it as the object its parameter names. */
              mutateAddDef(t, key, value as Record<string, JsonValue>);
            }
          },
          value == null ? `Removed state "${key}".` : `Updated state "${key}".`,
          validate,
          renderCheck,
          styleOf(),
        );
      },
    }),
  );

  // ── move_node ──────────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "move_node",
      description:
        "Move a node from one location to another in the document tree. The node is removed " +
        "from fromPath and inserted into toParentPath at toIndex.",
      parameters: {
        type: "object",
        properties: {
          fromPath: {
            type: "array",
            description: `${PATH_DESCRIPTION} The node to move.`,
            items: { type: ["string", "number"] },
          },
          toParentPath: {
            type: "array",
            description: `${PATH_DESCRIPTION} The target parent (a node, not a children array).`,
            items: { type: ["string", "number"] },
          },
          toIndex: {
            type: "integer",
            description: "Insertion index in the target parent's children array.",
          },
        },
        required: ["fromPath", "toParentPath", "toIndex"],
      },
      async execute(args, ctx) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed: both paths are
           present arrays, and paths that do not resolve are caught just below. `toIndex` is read
           untyped: the validator admits a numeric string for an integer, so `coerceIndex` decides
           what it names. */
        const written = args as { fromPath: JxPath; toParentPath: JxPath };
        const fromPath = coercePath(written.fromPath);
        const toParentPath = coercePath(written.toParentPath);
        const toIndex = coerceIndex(args.toIndex);
        if (toIndex === null || toIndex < 0) {
          return indexError("toIndex", args.toIndex);
        }
        if (fromPath.length < 2) {
          return { success: false, error: "Cannot move the document root." };
        }
        if (nodeAt(tab.doc.document, fromPath) === undefined) {
          return {
            success: false,
            error: `No node exists at fromPath ${JSON.stringify(fromPath)}.`,
          };
        }
        if (!isSpliceablePath(fromPath)) {
          return {
            success: false,
            error:
              `fromPath ${JSON.stringify(fromPath)} is not a child in a children array, so it ` +
              "cannot be moved. A $switch case or a repeater's template is changed with " +
              "set_property on the node that holds it.",
          };
        }
        const target = elementAt(tab.doc.document, toParentPath, "toParentPath");
        if (target.refusal) {
          return target.refusal;
        }
        if (isAncestor(fromPath, toParentPath)) {
          return {
            success: false,
            error:
              `Cannot move a node into itself or its own descendants: toParentPath ` +
              `${JSON.stringify(toParentPath)} is inside fromPath ${JSON.stringify(fromPath)}.`,
          };
        }
        /* SAFETY: `fromPath` resolves and is a splice coordinate, so its parent is a node with a
           static children array holding it, and `toParentPath` resolves to a node: every case in
           which `planMove` answers null was refused above. */
        const planned = planMove(tab.doc.document, fromPath, toParentPath, toIndex)!;
        // Where the node is after the move, which the summary must name for the next call to use.
        const { fromIndex, fromParentPath } = planned.inverse;
        const landed = [...fromParentPath, "children", fromIndex];
        return applyAndValidate(
          ctx,
          tab,
          (t) => mutateMoveNode(t, fromPath, toParentPath, toIndex),
          `Moved node from ${JSON.stringify(fromPath)} to ${JSON.stringify(landed)}.`,
          validate,
          renderCheck,
          styleOf(),
        );
      },
    }),
  );

  // ── create_component ───────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "create_component",
      description:
        "Create a new Jx component file on disk. Writes the component JSON to the given " +
        "relative path within the project. The content must be a valid Jx component document.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'File path relative to the project root, e.g. "components/newsletter-form.json".',
          },
          content: {
            type: "object",
            description:
              "The complete Jx component JSON (must include tagName, optionally state, style, children, $elements).",
          },
        },
        required: ["path", "content"],
      },
      async execute(args, ctx) {
        if (!saveFile) {
          return {
            success: false,
            error: "File operations are not available in this environment.",
          };
        }
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `path` is a
           present string and `content` a present JSON object (not an array, not null). Whether that
           object is a Jx document is what `validate` and `renderCheck` below decide. */
        const { path, content } = args as { path: string; content: JsonObject };
        // Inside the project or not at all (ai.md §4): the platform write is given this path.
        const relPath = normalizeRelPath(path);
        if (relPath === null) {
          return invalidPathResult(path);
        }
        const dirtyError = dirtyTabError(relPath);
        if (dirtyError) {
          return dirtyError;
        }
        const errors = await validate(content);
        if (errors.length > 0) {
          const formatted = errors.map((e) => `- ${translateValidationError(e)}`).join("\n");
          return {
            success: false,
            error: `Component content has schema errors. Fix these before creating the file:\n${formatted}`,
          };
        }
        if (renderCheck) {
          const renderResult = await renderCheck(content);
          if (!renderResult.ok) {
            return {
              success: false,
              error: `Component is schema-valid but fails to render. Fix before creating:\n- ${renderResult.error}`,
            };
          }
        }
        try {
          // The save serializer, layout-less (`@jxsuite/schema/json-layout`): the assistant supplied a
          // Value, not a text, so the formatter's layout for fresh output is the right one.
          await saveFile(relPath, serializeJson(content, null));
          ctx.ledger.record({ disk: true, ok: true, path: relPath, tool: "create_component" });
          return {
            success: true,
            summary: await reconcileAfterWrite(relPath, `Created component at "${relPath}".`),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ledger.record({
            disk: true,
            error: message,
            ok: false,
            path: relPath,
            tool: "create_component",
          });
          return {
            success: false,
            error: `Failed to write file: ${message}`,
          };
        }
      },
    }),
  );

  // ── create_page ────────────────────────────────────────────────────────

  registry.register(
    createToolDefinition({
      name: "create_page",
      description:
        "Create a new Jx page file on disk. A page typically includes a layout component and " +
        "section children. The content must be a valid Jx page document.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'File path relative to the project root, e.g. "pages/about.json".',
          },
          content: {
            type: "object",
            description:
              "The complete Jx page JSON (typically includes $elements to import a layout, children for sections).",
          },
        },
        required: ["path", "content"],
      },
      async execute(args, ctx) {
        if (!saveFile) {
          return {
            success: false,
            error: "File operations are not available in this environment.",
          };
        }
        /* SAFETY: a strict tool runs only after the registry's `validate()` passed: `path` is a
           present string and `content` a present JSON object (not an array, not null). Whether that
           object is a Jx document is what `validate` and `renderCheck` below decide. */
        const { path, content } = args as { path: string; content: JsonObject };
        const relPath = normalizeRelPath(path);
        if (relPath === null) {
          return invalidPathResult(path);
        }
        const dirtyError = dirtyTabError(relPath);
        if (dirtyError) {
          return dirtyError;
        }
        const errors = await validate(content);
        if (errors.length > 0) {
          const formatted = errors.map((e) => `- ${translateValidationError(e)}`).join("\n");
          return {
            success: false,
            error: `Page content has schema errors. Fix these before creating the file:\n${formatted}`,
          };
        }
        if (renderCheck) {
          const renderResult = await renderCheck(content);
          if (!renderResult.ok) {
            return {
              success: false,
              error: `Page is schema-valid but fails to render. Fix before creating:\n- ${renderResult.error}`,
            };
          }
        }
        try {
          // As `create_component`: a value the assistant supplied, written in the formatter's layout.
          await saveFile(relPath, serializeJson(content, null));
          ctx.ledger.record({ disk: true, ok: true, path: relPath, tool: "create_page" });
          return {
            success: true,
            summary: await reconcileAfterWrite(relPath, `Created page at "${relPath}".`),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ledger.record({
            disk: true,
            error: message,
            ok: false,
            path: relPath,
            tool: "create_page",
          });
          return {
            success: false,
            error: `Failed to write file: ${message}`,
          };
        }
      },
    }),
  );

  /*
   * `open_document` is NOT here any more. It is the projection of the `document.open` record
   * (`workspace/workspace.ts`'s `tabCommands`), so the person's palette row and the model's tool
   * are one `run` and one gate (`studio-ui-guidelines.md` §12.4). The hand tool read `getTab()`
   * after the open and called whatever it found a success — a missing file left the previous
   * document active and reported "Switched to" — and it re-anchored the undo batch itself, which
   * `tool-executor.ts` has done after EVERY tool since project adoption started replacing tabs
   * mid-loop.
   */
}
