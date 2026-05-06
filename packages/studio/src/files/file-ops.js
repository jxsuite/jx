/**
 * File Operations — open, load, save documents.
 *
 * Each function that mutates state accepts a `commit(newState)` callback so the caller (studio.js)
 * can assign S and trigger render().
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { mdToJx, jxToMd } from "../markdown/md-convert.js";
import { createState } from "../store.js";
import { locateDocument } from "../services/code-services.js";
import { statusMessage } from "../panels/statusbar.js";
import { getPlatform } from "../platform.js";

/**
 * Open a file via the File System Access API (or fallback input).
 *
 * @param {{ S: any; commit: (s: any) => void; renderToolbar: () => void }} ctx
 */
export async function openFile({ S: _S, commit, renderToolbar: _renderToolbar }) {
  try {
    if ("showOpenFilePicker" in window) {
      const [handle] = await /** @type {any} */ (window).showOpenFilePicker({
        types: [
          { description: "Jx Component", accept: { "application/json": [".json"] } },
          { description: "Markdown Content", accept: { "text/markdown": [".md"] } },
        ],
      });
      const file = await handle.getFile();
      const text = await file.text();

      if (handle.name.endsWith(".md")) {
        const newState = loadMarkdown(text, handle);
        commit(newState);
      } else {
        const doc = JSON.parse(text);
        const newState = createState(doc);
        newState.fileHandle = handle;
        newState.dirty = false;
        newState.documentPath = await locateDocument(handle.name);
        await loadCompanionJS(handle, newState);
        commit(newState);
      }

      statusMessage(`Opened ${handle.name}`);
    } else {
      // Fallback: file input
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,.md";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();

        if (file.name.endsWith(".md")) {
          const newState = loadMarkdown(text, null);
          commit(newState);
        } else {
          const doc = JSON.parse(text);
          const newState = createState(doc);
          newState.dirty = false;
          commit(newState);
        }

        statusMessage(`Opened ${file.name}`);
      };
      input.click();
    }
  } catch (/** @type {any} */ e) {
    if (e.name !== "AbortError") statusMessage(`Error: ${e.message}`);
  }
}

/**
 * Parse a markdown string into a Jx state object (pure — no side effects).
 *
 * @param {any} source Markdown text
 * @param {any} fileHandle File handle (or null)
 * @returns {any} A new state object ready for commit()
 */
export function loadMarkdown(source, fileHandle) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkDirective);

  const mdast = processor.parse(source);

  // Extract frontmatter from the first YAML node
  let frontmatter = {};
  const yamlNode = mdast.children.find((n) => n.type === "yaml");
  if (yamlNode) {
    try {
      frontmatter = parseYaml(yamlNode.value) ?? {};
    } catch {}
  }

  const jxTree = mdToJx(mdast);

  const newState = createState(jxTree);
  newState.mode = "content";
  newState.content = { frontmatter };
  newState.fileHandle = fileHandle;
  newState.dirty = false;
  return newState;
}

/**
 * Load companion JS file metadata into state.
 *
 * @param {any} handle
 * @param {any} state State object to mutate in-place
 */
async function loadCompanionJS(handle, state) {
  try {
    if (handle.getParent) {
      // Not yet available in any browser; skip for now
    }
    if (state.document.$handlers) {
      state.handlersSource = `// Companion file: ${state.document.$handlers}\n// (Read-only in builder — edit the JS file directly)`;
    }
  } catch {}
}

/**
 * Save the current document back to its source location.
 *
 * @param {{ S: any; commit: (s: any) => void; renderToolbar: () => void }} ctx
 */
export async function saveFile({ S, commit, renderToolbar }) {
  try {
    const output = serializeDocument(S);

    if (S.documentPath) {
      // Project file — save via platform
      const platform = getPlatform();
      await platform.writeFile(S.documentPath, output);
      commit({ ...S, dirty: false });
      renderToolbar();
      statusMessage("Saved");
    } else if (S.fileHandle && "createWritable" in S.fileHandle) {
      // Standalone file opened via FS Access API
      const writable = await S.fileHandle.createWritable();
      await writable.write(output);
      await writable.close();
      commit({ ...S, dirty: false });
      renderToolbar();
      statusMessage("Saved");
    } else {
      statusMessage("No save target — use Export");
    }
  } catch (/** @type {any} */ e) {
    if (e.name !== "AbortError") statusMessage(`Save error: ${e.message}`);
  }
}

/**
 * Export the current document to a new location (Save As / download).
 *
 * @param {{ S: any; commit: (s: any) => void; renderToolbar: () => void }} ctx
 */
export async function exportFile({ S, commit, renderToolbar }) {
  try {
    const isContent = S.mode === "content";
    const output = serializeDocument(S);
    const mimeType = isContent ? "text/markdown" : "application/json";
    const ext = isContent ? ".md" : ".json";
    const description = isContent ? "Markdown Content" : "Jx Component";

    if ("showSaveFilePicker" in window) {
      const suggestedName = S.documentPath
        ? S.documentPath.split("/").pop()
        : isContent
          ? "content.md"
          : "component.json";
      const handle = await /** @type {any} */ (window).showSaveFilePicker({
        suggestedName,
        types: [{ description, accept: { [mimeType]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(output);
      await writable.close();
      commit({ ...S, dirty: false });
      renderToolbar();
      statusMessage(`Exported as ${handle.name}`);
    } else {
      // Fallback: download
      const blob = new Blob([output], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = isContent ? "content.md" : "component.json";
      a.click();
      URL.revokeObjectURL(url);
      commit({ ...S, dirty: false });
      renderToolbar();
      statusMessage("Downloaded");
    }
  } catch (/** @type {any} */ e) {
    if (e.name !== "AbortError") statusMessage(`Export error: ${e.message}`);
  }
}

/**
 * Serialize the current document to its output format (JSON or Markdown).
 *
 * @param {any} S
 * @returns {string}
 */
function serializeDocument(S) {
  if (S.mode === "content") {
    const mdast = jxToMd(S.document);
    const md = unified()
      .use(remarkStringify, { bullet: "-", emphasis: "*", strong: "*" })
      .stringify(mdast);
    const fm = S.content?.frontmatter;
    const hasFrontmatter = fm && Object.keys(fm).length > 0;
    return hasFrontmatter ? `---\n${stringifyYaml(fm).trim()}\n---\n\n${md}` : md;
  }
  return JSON.stringify(S.document, null, 2);
}
