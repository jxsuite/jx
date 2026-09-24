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
import type { ToolRegistry, ToolResult } from "@jxsuite/ai/tools";
import type { JxMutableNode, JxPath, JxStateDefinition } from "@jxsuite/schema/types";
import { getNodeAtPath } from "../state";
import type { Tab } from "../tabs/tab";
import {
  mutateAddDef,
  mutateInsertNode,
  mutateMoveNode,
  mutateRemoveDef,
  mutateUpdateProperty,
  mutateUpdateStyle,
  transactDoc,
} from "../tabs/transact";
import type { JxNodeValue } from "../tabs/transact";
import type { JsonValue } from "../types";
import { validateDoc } from "./jx-validate";
import { recordWrite } from "./ai-writes";
import { serializeJson } from "@jxsuite/schema/json-layout";
import {
  reportDocumentWrite,
  snapshotBeforeWrite,
  translateValidationError,
} from "./ai-write-report";
import type { RenderVerdict } from "./ai-write-report";

/* Re-exported from its new home so `ai-project-tools.ts` and the tests keep their import: the
   translation moved with the verdict it belongs to (`ai-write-report.ts`), where every document
   write — hand-registered or projected from a command record — now reads it. */
export { translateValidationError } from "./ai-write-report";

const PATH_DESCRIPTION =
  "Path to a node in the document, as a JSON array of keys/indices from the root " +
  '(e.g. ["children", 0, "children", 1]). Use read_document to discover valid paths.';

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
 * @param {import("../tabs/tab").Tab} tab
 * @param {(t: import("../tabs/tab").Tab) => void} mutationFn
 * @param {string} summary
 * @param {(doc: unknown) => Promise<string[]>} validate
 * @param {((doc: unknown) => Promise<RenderVerdict>) | undefined} renderCheck
 * @param {Record<string, string> | undefined} projectStyle
 * @returns {Promise<import("@jxsuite/ai/tools").ToolResult>}
 */
async function applyAndValidate(
  tab: Tab,
  mutationFn: (t: Tab) => void,
  summary: string,
  validate: (doc: unknown) => Promise<string[]>,
  renderCheck: ((doc: unknown) => Promise<RenderVerdict>) | undefined,
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
  if (!transactDoc(tab, mutationFn)) {
    return {
      success: false,
      error:
        "The document is frozen: a collaborator is editing its source, so structural edits are " +
        "paused. Nothing was changed. Try again once source editing ends.",
    };
  }
  /* One ledger entry per mutation, so the panel's "Changed N files" counts documents the model
     touched rather than sentences it wrote (§7.4). `disk: false` is the load-bearing half: this
     went through transactDoc, so the tab's history — and "Restore to here" — can reach it. */
  recordWrite({ disk: false, ok: true, path: tab.documentPath ?? "(untitled)", tool: summary });

  return reportDocumentWrite(tab, before, summary, deps);
}

/**
 * Register the document-manipulation tools into a tool registry.
 *
 * @param {import("@jxsuite/ai/tools").ToolRegistry} registry
 * @param {{
 *   getTab: () => import("../tabs/tab").Tab | null;
 *   validate?: (doc: unknown) => Promise<string[]>;
 *   saveFile?: (relPath: string, content: string) => Promise<void>;
 *   renderCheck?: (doc: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
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
    validate?: (doc: unknown) => Promise<string[]>;
    saveFile?: (relPath: string, content: string) => Promise<void>;
    renderCheck?: (doc: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
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
        const { path } = args as { path?: JxPath };
        const node =
          path && path.length > 0 ? getNodeAtPath(tab.doc.document, path) : tab.doc.document;
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
         * but the registry rejects null on required args (tools.js:181). See §14.
         */
        required: ["path", "key"],
      },
      async execute(args) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        const { path, key, value } = args as { path: JxPath; key: string; value?: JxNodeValue };
        const node = getNodeAtPath(tab.doc.document, path);
        if (node === undefined) {
          return { success: false, error: `No node exists at path ${JSON.stringify(path)}.` };
        }
        return applyAndValidate(
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
      async execute(args) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        const {
          parentPath,
          index,
          node: childNode,
        } = args as {
          parentPath: JxPath;
          index: number;
          node: JxMutableNode;
        };
        const parent = getNodeAtPath(tab.doc.document, parentPath);
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
        if (parent.children !== undefined && !Array.isArray(parent.children)) {
          return {
            success: false,
            error: "Cannot insert into mapped-array children; edit the map template instead.",
          };
        }
        return applyAndValidate(
          tab,
          (t) => mutateInsertNode(t, parentPath, index, childNode),
          `Inserted node at ${JSON.stringify([...parentPath, "children", index])}.`,
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
         * required args, tools.js:181). See §14.
         */
        required: ["path", "property"],
      },
      async execute(args) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        const { path, property, value } = args as {
          path: JxPath;
          property: string;
          value?: unknown;
        };
        if (getNodeAtPath(tab.doc.document, path) === undefined) {
          return { success: false, error: `No node exists at path ${JSON.stringify(path)}.` };
        }
        const prop = property;
        const val = value == null ? undefined : String(value);
        return applyAndValidate(
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
      async execute(args) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        const { path, value } = args as { path: JxPath; value: string };
        if (getNodeAtPath(tab.doc.document, path) === undefined) {
          return { success: false, error: `No node exists at path ${JSON.stringify(path)}.` };
        }
        return applyAndValidate(
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
      async execute(args) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        const { key, value } = args as { key: string; value: JxStateDefinition };
        if (tab.doc.document.state && tab.doc.document.state[key] !== undefined) {
          return {
            success: false,
            error: `State key "${key}" already exists. Use update_state to change it, or remove it first.`,
          };
        }
        return applyAndValidate(
          tab,
          /* `mutateAddDef` rather than `mutateUpdateProperty`: the latter deletes on "", which is
             wrong for a state default (`"title": ""`). It also records the op, so the canvas, the
             history and collaborators each get the edit as an edit. */
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
         * args, tools.js:181). See §14.
         */
        required: ["key"],
      },
      async execute(args) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        const { key, value } = args as { key: string; value?: JxStateDefinition | null };
        if (!tab.doc.document.state || tab.doc.document.state[key] === undefined) {
          return {
            success: false,
            error: `State key "${key}" does not exist. Use add_state to create it, or check the name. Current state keys: ${Object.keys(tab.doc.document.state || {}).join(", ") || "(none)"}`,
          };
        }
        return applyAndValidate(
          tab,
          /* The recording def mutators, for the reason `add_state` gives. Removing the last key
             drops the empty `state` object, as the Inspector's own removal does. */
          (t) => {
            if (value == null) {
              mutateRemoveDef(t, key);
            } else {
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
      async execute(args) {
        const tab = getTab();
        if (!tab) {
          return noDocError();
        }
        const { fromPath, toParentPath, toIndex } = args as {
          fromPath: JxPath;
          toParentPath: JxPath;
          toIndex: number;
        };
        if (fromPath.length < 2) {
          return { success: false, error: "Cannot move the document root." };
        }
        if (getNodeAtPath(tab.doc.document, fromPath) === undefined) {
          return {
            success: false,
            error: `No node exists at fromPath ${JSON.stringify(fromPath)}.`,
          };
        }
        if (getNodeAtPath(tab.doc.document, toParentPath) === undefined) {
          return {
            success: false,
            error: `No node exists at toParentPath ${JSON.stringify(toParentPath)}.`,
          };
        }
        return applyAndValidate(
          tab,
          (t) => mutateMoveNode(t, fromPath, toParentPath, toIndex),
          `Moved node from ${JSON.stringify(fromPath)} to ${JSON.stringify([...toParentPath, "children", toIndex])}.`,
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
      async execute(args) {
        if (!saveFile) {
          return {
            success: false,
            error: "File operations are not available in this environment.",
          };
        }
        const { path: relPath, content } = args as { path: string; content: object };
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
          recordWrite({ disk: true, ok: true, path: relPath, tool: "create_component" });
          return {
            success: true,
            summary: await reconcileAfterWrite(relPath, `Created component at "${relPath}".`),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          recordWrite({
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
      async execute(args) {
        if (!saveFile) {
          return {
            success: false,
            error: "File operations are not available in this environment.",
          };
        }
        const { path: relPath, content } = args as { path: string; content: object };
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
          recordWrite({ disk: true, ok: true, path: relPath, tool: "create_page" });
          return {
            success: true,
            summary: await reconcileAfterWrite(relPath, `Created page at "${relPath}".`),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          recordWrite({
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
   * are one `run` and one gate (§12.4). The hand tool read `getTab()` after the open and called
   * whatever it found a success — a missing file left the previous document active and reported
   * "Switched to" — and it re-anchored the undo batch itself, which `tool-executor.ts` has done
   * after EVERY tool since project adoption started replacing tabs mid-loop.
   */
}
