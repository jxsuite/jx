/**
 * Head panel — Page meta, OpenGraph, Google Fonts, and custom `$head` entries.
 *
 * Uses `renderFieldRow()` for consistent indicator-dot fields and `renderMediaPicker()` for image
 * selection (icon, og:image).
 */

import { html } from "lit-html";
import { live } from "lit-html/directives/live.js";
import { renderFieldRow } from "../ui/field-row.js";
import { renderMediaPicker } from "../ui/media-picker.js";
import { debouncedStyleCommit } from "../store.js";

// ─── Field definitions ───────────────────────────────────────────────────

/**
 * @typedef {{
 *   label: string;
 *   attr: "name" | "property";
 *   key: string;
 *   multiline?: boolean;
 *   media?: boolean;
 * }} MetaField
 */

/** @type {MetaField[]} */
const PAGE_FIELDS = [
  { label: "Description", attr: "name", key: "description" },
  { label: "Viewport", attr: "name", key: "viewport" },
];

/** @type {MetaField[]} */
const OG_FIELDS = [
  { label: "Title", attr: "property", key: "og:title" },
  { label: "Description", attr: "property", key: "og:description", multiline: true },
  { label: "Image", attr: "property", key: "og:image", media: true },
  { label: "Type", attr: "property", key: "og:type" },
];

/** Set of `name`/`property` values managed by the structured forms. */
const MANAGED_META_KEYS = new Set([...PAGE_FIELDS, ...OG_FIELDS].map((f) => f.key));

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Find a `$head` meta entry by attribute match.
 *
 * @param {any[]} head
 * @param {"name" | "property"} attr
 * @param {string} key
 * @returns {any | undefined}
 */
function findMetaEntry(head, attr, key) {
  if (!head) return undefined;
  return head.find(
    (/** @type {any} */ e) => e?.tagName === "meta" && e?.attributes?.[attr] === key,
  );
}

/**
 * Find a `$head` link entry by `rel` attribute.
 *
 * @param {any[]} head
 * @param {string} rel
 * @returns {any | undefined}
 */
function findLinkEntry(head, rel) {
  if (!head) return undefined;
  return head.find((/** @type {any} */ e) => e?.tagName === "link" && e?.attributes?.rel === rel);
}

/**
 * Check if a `$head` entry is managed by the structured forms.
 *
 * @param {any} entry
 * @returns {boolean}
 */
function isManagedEntry(entry) {
  if (!entry?.tagName) return false;
  // Managed meta tags
  if (entry.tagName === "meta") {
    const name = entry?.attributes?.name;
    const prop = entry?.attributes?.property;
    return (name && MANAGED_META_KEYS.has(name)) || (prop && MANAGED_META_KEYS.has(prop));
  }
  // Managed link: favicon
  if (entry.tagName === "link" && entry?.attributes?.rel === "icon") return true;
  return false;
}

/**
 * Upsert or remove a meta entry in `doc.$head`.
 *
 * @param {any} doc
 * @param {"name" | "property"} attr
 * @param {string} key
 * @param {string} content
 */
function upsertMeta(doc, attr, key, content) {
  if (!doc.$head) doc.$head = [];
  const idx = doc.$head.findIndex(
    (/** @type {any} */ e) => e?.tagName === "meta" && e?.attributes?.[attr] === key,
  );
  if (content) {
    const entry = { tagName: "meta", attributes: { [attr]: key, content } };
    if (idx >= 0) {
      doc.$head[idx] = entry;
    } else {
      doc.$head.push(entry);
    }
  } else if (idx >= 0) {
    doc.$head.splice(idx, 1);
  }
}

/**
 * Upsert or remove a link entry in `doc.$head`.
 *
 * @param {any} doc
 * @param {string} rel
 * @param {string} href
 */
function upsertLink(doc, rel, href) {
  if (!doc.$head) doc.$head = [];
  const idx = doc.$head.findIndex(
    (/** @type {any} */ e) => e?.tagName === "link" && e?.attributes?.rel === rel,
  );
  if (href) {
    const entry = { tagName: "link", attributes: { rel, href } };
    if (idx >= 0) {
      doc.$head[idx] = entry;
    } else {
      doc.$head.push(entry);
    }
  } else if (idx >= 0) {
    doc.$head.splice(idx, 1);
  }
}

/**
 * Get a display label for an arbitrary $head entry.
 *
 * @param {any} entry
 * @returns {string}
 */
function entryLabel(entry) {
  if (!entry?.tagName) return "unknown";
  const a = entry.attributes ?? {};
  if (a.name) return `<meta name="${a.name}">`;
  if (a.property) return `<meta property="${a.property}">`;
  if (a.rel && a.href) return `<link rel="${a.rel}">`;
  if (a.src) return `<script src="${a.src}">`;
  if (a.charset) return `<meta charset="${a.charset}">`;
  return `<${entry.tagName}>`;
}

/**
 * Get a display value for an arbitrary $head entry.
 *
 * @param {any} entry
 * @returns {string}
 */
function entryValue(entry) {
  const a = entry?.attributes ?? {};
  return a.content ?? a.href ?? a.src ?? entry?.textContent ?? "";
}

// ─── Google Fonts helpers ────────────────────────────────────────────────

const GFONTS_CSS_PREFIX = "https://fonts.googleapis.com/css2?";
const GFONTS_PRECONNECT_ORIGINS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];

/**
 * Check if a `$head` entry is a Google Fonts stylesheet link.
 *
 * @param {any} entry
 * @returns {boolean}
 */
function isGoogleFontEntry(entry) {
  return (
    entry?.tagName === "link" &&
    entry?.attributes?.rel === "stylesheet" &&
    typeof entry?.attributes?.href === "string" &&
    entry.attributes.href.startsWith(GFONTS_CSS_PREFIX)
  );
}

/**
 * Check if a `$head` entry is a Google Fonts preconnect link.
 *
 * @param {any} entry
 * @returns {boolean}
 */
function isGoogleFontPreconnect(entry) {
  return (
    entry?.tagName === "link" &&
    entry?.attributes?.rel === "preconnect" &&
    GFONTS_PRECONNECT_ORIGINS.includes(entry?.attributes?.href)
  );
}

/**
 * Extract the font family name from a Google Fonts CSS URL.
 *
 * @param {string} href
 * @returns {string}
 */
function extractFontFamily(href) {
  const match = href.match(/family=([^&:]+)/);
  if (!match) return "";
  return decodeURIComponent(match[1].replace(/\+/g, " "));
}

/**
 * Build a Google Fonts CSS2 URL for a family name.
 *
 * @param {string} family
 * @returns {string}
 */
function buildGoogleFontUrl(family) {
  return `${GFONTS_CSS_PREFIX}family=${encodeURIComponent(family).replace(/%20/g, "+")}&display=swap`;
}

/**
 * Ensure preconnect links exist in `$head` for Google Fonts.
 *
 * @param {any} doc
 */
function ensureGoogleFontPreconnects(doc) {
  if (!doc.$head) doc.$head = [];
  for (const origin of GFONTS_PRECONNECT_ORIGINS) {
    const exists = doc.$head.some(
      (/** @type {any} */ e) =>
        e?.tagName === "link" &&
        e?.attributes?.rel === "preconnect" &&
        e?.attributes?.href === origin,
    );
    if (!exists) {
      /** @type {Record<string, any>} */
      const attrs = { rel: "preconnect", href: origin };
      if (origin === "https://fonts.gstatic.com") attrs.crossorigin = "";
      doc.$head.push({ tagName: "link", attributes: attrs });
    }
  }
}

/**
 * Remove preconnect links if no Google Font stylesheets remain.
 *
 * @param {any} doc
 */
function cleanupGoogleFontPreconnects(doc) {
  if (!doc.$head) return;
  const hasFont = doc.$head.some((/** @type {any} */ e) => isGoogleFontEntry(e));
  if (!hasFont) {
    doc.$head = doc.$head.filter((/** @type {any} */ e) => !isGoogleFontPreconnect(e));
  }
}

// ─── Field renderers ─────────────────────────────────────────────────────

/**
 * Render a meta field row using renderFieldRow.
 *
 * @param {MetaField} field
 * @param {any[]} head
 * @param {(fn: (doc: any) => void) => void} applyMutation
 * @returns {any}
 */
function renderMetaFieldRow(field, head, applyMutation) {
  const entry = findMetaEntry(head, field.attr, field.key);
  const val = entry?.attributes?.content ?? "";

  if (field.media) {
    return renderFieldRow({
      prop: field.key,
      label: field.label,
      hasValue: !!val,
      onClear: () =>
        applyMutation((/** @type {any} */ d) => upsertMeta(d, field.attr, field.key, "")),
      widget: renderMediaPicker(field.key, val, (/** @type {any} */ v) => {
        applyMutation((/** @type {any} */ d) => upsertMeta(d, field.attr, field.key, v || ""));
      }),
    });
  }

  const widget = field.multiline
    ? html`
        <sp-textfield
          size="s"
          multiline
          .value=${live(val)}
          placeholder="${field.label}…"
          @input=${debouncedStyleCommit(`head:${field.key}`, 400, (/** @type {any} */ e) => {
            const content = e.target.value?.trim() ?? "";
            applyMutation((/** @type {any} */ d) => upsertMeta(d, field.attr, field.key, content));
          })}
        ></sp-textfield>
      `
    : html`
        <sp-textfield
          size="s"
          .value=${live(val)}
          placeholder=${field.key === "viewport"
            ? "width=device-width, initial-scale=1"
            : `${field.label}…`}
          @input=${debouncedStyleCommit(`head:${field.key}`, 400, (/** @type {any} */ e) => {
            const content = e.target.value?.trim() ?? "";
            applyMutation((/** @type {any} */ d) => upsertMeta(d, field.attr, field.key, content));
          })}
        ></sp-textfield>
      `;

  return renderFieldRow({
    prop: field.key,
    label: field.label,
    hasValue: !!val,
    onClear: () =>
      applyMutation((/** @type {any} */ d) => upsertMeta(d, field.attr, field.key, "")),
    widget,
  });
}

// ─── Template ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   document: any;
 *   applyMutation: (fn: (doc: any) => void) => void;
 *   renderLeftPanel: () => void;
 * }} ctx
 * @returns {any}
 */
export function renderHeadTemplate({ document: doc, applyMutation, renderLeftPanel }) {
  const head = doc.$head ?? [];
  const title = doc.title ?? "";

  // Icon (favicon) link
  const iconEntry = findLinkEntry(head, "icon");
  const iconHref = iconEntry?.attributes?.href ?? "";

  // Custom entries not managed by structured forms, fonts, or preconnects
  const customEntries = head.filter(
    (/** @type {any} */ e) =>
      !isManagedEntry(e) && !isGoogleFontEntry(e) && !isGoogleFontPreconnect(e),
  );

  // Google Font entries
  const fontEntries = head.filter((/** @type {any} */ e) => isGoogleFontEntry(e));

  return html`
    <div class="imports-panel">
      <!-- Page section -->
      <div class="imports-section">
        <div class="imports-section-header">
          <span class="imports-section-title">Page</span>
        </div>
        <div class="head-section-body">
          ${renderFieldRow({
            prop: "title",
            label: "Title",
            hasValue: !!title,
            onClear: () =>
              applyMutation((/** @type {any} */ d) => {
                delete d.title;
              }),
            widget: html`
              <sp-textfield
                size="s"
                .value=${live(title)}
                placeholder="Page title…"
                @input=${debouncedStyleCommit("head:title", 400, (/** @type {any} */ e) => {
                  const val = e.target.value?.trim() ?? "";
                  applyMutation((/** @type {any} */ d) => {
                    if (val) d.title = val;
                    else delete d.title;
                  });
                })}
              ></sp-textfield>
            `,
          })}
          ${PAGE_FIELDS.map((field) => renderMetaFieldRow(field, head, applyMutation))}
          ${renderFieldRow({
            prop: "icon",
            label: "Icon",
            hasValue: !!iconHref,
            onClear: () => applyMutation((/** @type {any} */ d) => upsertLink(d, "icon", "")),
            widget: renderMediaPicker("icon", iconHref, (/** @type {any} */ v) => {
              applyMutation((/** @type {any} */ d) => upsertLink(d, "icon", v || ""));
            }),
          })}
        </div>
      </div>

      <!-- OpenGraph section -->
      <div class="imports-section">
        <div class="imports-section-header">
          <span class="imports-section-title">OpenGraph</span>
        </div>
        <div class="head-section-body">
          ${OG_FIELDS.map((field) => renderMetaFieldRow(field, head, applyMutation))}
        </div>
      </div>

      <!-- Google Fonts -->
      <div class="imports-section">
        <div class="imports-section-header">
          <span class="imports-section-title">Google Fonts</span>
          <span class="imports-count">${fontEntries.length}</span>
        </div>
        ${fontEntries.length > 0
          ? html`
              <div class="imports-list">
                ${fontEntries.map((/** @type {any} */ entry) => {
                  const family = extractFontFamily(entry.attributes.href);
                  return html`
                    <div class="import-row">
                      <span class="import-name">${family}</span>
                      <sp-action-button
                        quiet
                        size="xs"
                        title="Remove"
                        @click=${() => {
                          applyMutation((/** @type {any} */ d) => {
                            if (!d.$head) return;
                            d.$head = d.$head.filter((/** @type {any} */ e) => e !== entry);
                            cleanupGoogleFontPreconnects(d);
                          });
                          renderLeftPanel();
                        }}
                      >
                        <sp-icon-close slot="icon" size="xs"></sp-icon-close>
                      </sp-action-button>
                    </div>
                  `;
                })}
              </div>
            `
          : html`<div class="imports-empty">No fonts imported</div>`}
        <div class="head-add-form">
          <sp-textfield
            placeholder="Font family name…"
            size="s"
            style="flex:1"
            @keydown=${(/** @type {any} */ e) => {
              if (e.key !== "Enter") return;
              const family = e.target.value?.trim();
              if (!family) return;
              e.target.value = "";
              applyMutation((/** @type {any} */ d) => {
                if (!d.$head) d.$head = [];
                ensureGoogleFontPreconnects(d);
                d.$head.push({
                  tagName: "link",
                  attributes: { rel: "stylesheet", href: buildGoogleFontUrl(family) },
                });
              });
              renderLeftPanel();
            }}
          ></sp-textfield>
          <sp-action-button
            quiet
            size="xs"
            title="Add font"
            @click=${(/** @type {any} */ e) => {
              const input = e.target.closest(".head-add-form")?.querySelector("sp-textfield");
              const family = input?.value?.trim();
              if (!family) return;
              input.value = "";
              applyMutation((/** @type {any} */ d) => {
                if (!d.$head) d.$head = [];
                ensureGoogleFontPreconnects(d);
                d.$head.push({
                  tagName: "link",
                  attributes: { rel: "stylesheet", href: buildGoogleFontUrl(family) },
                });
              });
              renderLeftPanel();
            }}
          >
            <sp-icon-add slot="icon" size="xs"></sp-icon-add>
          </sp-action-button>
        </div>
      </div>

      <!-- Custom $head entries -->
      <div class="imports-section">
        <div class="imports-section-header">
          <span class="imports-section-title">Custom Tags</span>
          <span class="imports-count">${customEntries.length}</span>
        </div>
        ${customEntries.length > 0
          ? html`
              <div class="imports-list">
                ${customEntries.map((/** @type {any} */ entry) => {
                  const label = entryLabel(entry);
                  const value = entryValue(entry);
                  return html`
                    <div class="import-row">
                      <span class="import-name" title=${value}>${label}</span>
                      <span class="import-path">${value}</span>
                      <sp-action-button
                        quiet
                        size="xs"
                        title="Remove"
                        @click=${() => {
                          applyMutation((/** @type {any} */ d) => {
                            if (!d.$head) return;
                            const idx = d.$head.indexOf(entry);
                            if (idx >= 0) d.$head.splice(idx, 1);
                          });
                          renderLeftPanel();
                        }}
                      >
                        <sp-icon-close slot="icon" size="xs"></sp-icon-close>
                      </sp-action-button>
                    </div>
                  `;
                })}
              </div>
            `
          : html`<div class="imports-empty">No custom tags</div>`}

        <!-- Add custom tag form -->
        <div class="head-add-form">
          <sp-picker size="s" label="Tag" class="head-add-tag" value="meta">
            <sp-menu-item value="meta">meta</sp-menu-item>
            <sp-menu-item value="link">link</sp-menu-item>
            <sp-menu-item value="script">script</sp-menu-item>
          </sp-picker>
          <sp-textfield
            placeholder="Attribute (e.g. name)"
            size="s"
            class="head-add-attr"
          ></sp-textfield>
          <sp-textfield placeholder="Value" size="s" class="head-add-val"></sp-textfield>
          <sp-action-button
            quiet
            size="xs"
            title="Add tag"
            @click=${(/** @type {any} */ e) => {
              const form = e.target.closest(".head-add-form");
              const tagPicker = form?.querySelector(".head-add-tag");
              const attrField = form?.querySelector(".head-add-attr");
              const valField = form?.querySelector(".head-add-val");
              const tagName = tagPicker?.value || "meta";
              const attrKey = attrField?.value?.trim();
              const attrVal = valField?.value?.trim();
              if (!attrKey || !attrVal) return;
              attrField.value = "";
              valField.value = "";

              /** @type {Record<string, any>} */
              const entry = { tagName, attributes: {} };
              if (tagName === "meta") {
                entry.attributes = { name: attrKey, content: attrVal };
              } else if (tagName === "link") {
                entry.attributes = { rel: attrKey, href: attrVal };
              } else if (tagName === "script") {
                entry.attributes = { [attrKey]: attrVal };
              }

              applyMutation((/** @type {any} */ d) => {
                if (!d.$head) d.$head = [];
                d.$head.push(entry);
              });
              renderLeftPanel();
            }}
          >
            <sp-icon-add slot="icon" size="xs"></sp-icon-add>
          </sp-action-button>
        </div>
      </div>
    </div>
  `;
}
