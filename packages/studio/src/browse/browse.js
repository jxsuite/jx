/**
 * Browse view — project-level file browser rendered as a Spectrum table.
 *
 * Displays pages, layouts, components, content, and media in a filterable table grid. Fills the
 * center canvas area as a parallel state to Edit/Design/Preview/Code/Stylebook.
 */

import { html, render as litRender } from "lit-html";
import { getPlatform } from "../platform.js";
import { projectState } from "../store.js";

// ─── Category definitions ────────────────────────────────────────────────────

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "pages", label: "Pages", dir: "pages" },
  { key: "layouts", label: "Layouts", dir: "layouts" },
  { key: "components", label: "Components", dir: "components" },
  { key: "content", label: "Content", dir: "content" },
  { key: "media", label: "Media", dir: "public" },
];

const MEDIA_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".ogg",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
]);

// ─── Module state ────────────────────────────────────────────────────────────

let activeCategory = "all";
let searchQuery = "";
/** @type {{ name: string; path: string; type: string; category: string; ext: string }[]} */
let fileCache = [];
let loading = false;
/** Track which projectDirs were used for the last load, so we re-scan when they change. */
let lastProjectDirsKey = "";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** @param {string} name */
function extOf(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** Map a file path to a display category. Media files override by extension. */
function categoryFor(/** @type {string} */ dir, /** @type {string} */ ext) {
  if (ext && MEDIA_EXTENSIONS.has(ext)) return "Media";
  if (dir.startsWith("pages")) return "Pages";
  if (dir.startsWith("layouts")) return "Layouts";
  if (dir.startsWith("components")) return "Components";
  if (dir.startsWith("content")) return "Content";
  if (dir.startsWith("public")) return "Media";
  if (dir.startsWith("data")) return "Content";
  if (dir.startsWith("styles")) return "Components";
  return "Other";
}

/**
 * Recursively collect all files under a directory.
 *
 * @param {string} dir
 * @param {ReturnType<typeof getPlatform>} platform
 * @returns {Promise<
 *   { name: string; path: string; type: string; category: string; ext: string }[]
 * >}
 */
async function collectFiles(dir, platform) {
  /** @type {{ name: string; path: string; type: string; category: string; ext: string }[]} */
  const results = [];
  try {
    const entries = await platform.listDirectory(dir);
    for (const entry of entries) {
      if (entry.type === "directory") {
        const sub = await collectFiles(entry.path, platform);
        results.push(...sub);
      } else {
        const ext = extOf(entry.name);
        results.push({
          name: entry.name,
          path: entry.path,
          type: ext || "file",
          category: categoryFor(entry.path, ext),
          ext,
        });
      }
    }
  } catch {
    // Directory may not exist or be inaccessible
  }
  return results;
}

// ─── Data loading ────────────────────────────────────────────────────────────

async function loadFiles() {
  if (!projectState) return;
  loading = true;
  const platform = getPlatform();
  const dirs = projectState.projectDirs || [];
  lastProjectDirsKey = dirs.join(",");
  const all = await Promise.all(dirs.map((/** @type {string} */ d) => collectFiles(d, platform)));
  fileCache = all.flat();
  fileCache.sort((a, b) => a.path.localeCompare(b.path));
  loading = false;
}

// ─── Filtering ───────────────────────────────────────────────────────────────

function filteredFiles() {
  let files = fileCache;
  if (activeCategory !== "all") {
    const cat = CATEGORIES.find((c) => c.key === activeCategory);
    if (cat && cat.label) {
      files = files.filter((f) => f.category === cat.label);
    }
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    files = files.filter(
      (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
    );
  }
  return files;
}

// ─── Render ──────────────────────────────────────────────────────────────────

/**
 * Render the Browse view into the canvas area.
 *
 * @param {HTMLElement} container — the #canvas-wrap element
 * @param {{ openFile: (path: string) => void }} ctx — callbacks from studio.js
 */
export async function renderBrowse(container, ctx) {
  // Re-load when projectDirs changed (e.g. project opened after initial render)
  const currentKey = (projectState?.projectDirs || []).join(",");
  if ((!fileCache.length && !loading) || currentKey !== lastProjectDirsKey) {
    await loadFiles();
  }

  const files = filteredFiles();

  const filterBar = html`
    <div class="browse-filter-bar">
      <sp-action-group selects="single" size="s" compact>
        ${CATEGORIES.map(
          (cat) => html`
            <sp-action-button
              size="s"
              ?selected=${activeCategory === cat.key}
              @click=${() => {
                activeCategory = cat.key;
                renderBrowse(container, ctx);
              }}
            >
              ${cat.label}
            </sp-action-button>
          `,
        )}
      </sp-action-group>
      <sp-search
        size="s"
        placeholder="Filter files..."
        .value=${searchQuery}
        @input=${(/** @type {any} */ e) => {
          searchQuery = e.target.value;
          renderBrowse(container, ctx);
        }}
        @submit=${(/** @type {Event} */ e) => e.preventDefault()}
      ></sp-search>
    </div>
  `;

  const table = html`
    <sp-table size="m" quiet>
      <sp-table-head>
        <sp-table-head-cell>Name</sp-table-head-cell>
        <sp-table-head-cell>Category</sp-table-head-cell>
        <sp-table-head-cell>Type</sp-table-head-cell>
        <sp-table-head-cell>Path</sp-table-head-cell>
      </sp-table-head>
      <sp-table-body>
        ${files.length === 0
          ? html`<sp-table-row
              ><sp-table-cell
                >${loading ? "Loading..." : "No files found"}</sp-table-cell
              ></sp-table-row
            >`
          : files.map(
              (f) => html`
                <sp-table-row
                  value=${f.path}
                  class="browse-row"
                  @click=${() => ctx.openFile(f.path)}
                >
                  <sp-table-cell class="browse-name-cell">${f.name}</sp-table-cell>
                  <sp-table-cell>${f.category}</sp-table-cell>
                  <sp-table-cell>${f.ext || "—"}</sp-table-cell>
                  <sp-table-cell class="browse-path-cell">${f.path}</sp-table-cell>
                </sp-table-row>
              `,
            )}
      </sp-table-body>
    </sp-table>
  `;

  const tpl = html`
    <div class="browse-view">
      ${filterBar}
      <div class="browse-table">${table}</div>
    </div>
  `;

  litRender(tpl, container);
}

/** Force a data reload on next render (e.g., after file creation/deletion). */
export function invalidateBrowseCache() {
  fileCache = [];
}
