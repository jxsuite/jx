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
import { mdToJsonsx, jxToMd } from "../markdown/md-convert.js";
import { createState } from "../../store.js";
import { locateDocument } from "../services/code-services.js";
import { statusMessage } from "../panels/statusbar.js";

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

  const jxTree = mdToJsonsx(mdast);

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
 * Save the current document to disk (or download as fallback).
 *
 * @param {{ S: any; commit: (s: any) => void; renderToolbar: () => void }} ctx
 */
export async function saveFile({ S, commit, renderToolbar }) {
  try {
    const isContent = S.mode === "content";
    let output, mimeType, ext, description;

    if (isContent) {
      const mdast = jxToMd(S.document);
      const md = unified()
        .use(remarkStringify, { bullet: "-", emphasis: "*", strong: "*" })
        .stringify(mdast);

      const fm = S.content?.frontmatter;
      const hasFrontmatter = fm && Object.keys(fm).length > 0;
      output = hasFrontmatter ? `---\n${stringifyYaml(fm).trim()}\n---\n\n${md}` : md;
      mimeType = "text/markdown";
      ext = ".md";
      description = "Markdown Content";
    } else {
      output = JSON.stringify(S.document, null, 2);
      mimeType = "application/json";
      ext = ".json";
      description = "Jx Component";
    }

    if (S.fileHandle && "createWritable" in S.fileHandle) {
      const writable = await S.fileHandle.createWritable();
      await writable.write(output);
      await writable.close();
      commit({ ...S, dirty: false });
      renderToolbar();
      statusMessage("Saved");
    } else if ("showSaveFilePicker" in window) {
      const handle = await /** @type {any} */ (window).showSaveFilePicker({
        suggestedName: isContent ? "content.md" : "component.json",
        types: [{ description, accept: { [mimeType]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(output);
      await writable.close();
      commit({ ...S, fileHandle: handle, dirty: false });
      renderToolbar();
      statusMessage(`Saved as ${handle.name}`);
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
    if (e.name !== "AbortError") statusMessage(`Save error: ${e.message}`);
  }
}
