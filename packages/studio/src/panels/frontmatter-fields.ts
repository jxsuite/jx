/// <reference lib="dom" />
/**
 * Frontmatter-fields.ts — the shared schema-driven frontmatter field set, and the row it projects.
 *
 * {@link collectFmFields} is the half that says WHICH keys a document has: schema-declared fields in
 * schema order, then any extra frontmatter keys already present, minus the `$`-prefixed ones and
 * minus whatever a named control elsewhere has reserved. Fields come from the content-collection
 * schema (`findContentTypeSchema`).
 *
 * {@link projectFmField} is the half that says WHAT ONE OF THEM LOOKS LIKE — which control it draws,
 * what that control currently holds, and how to read the control's answer back into a frontmatter
 * value. It is a projection rather than a renderer, and that is the whole of why it lives here:
 * both surfaces that edit frontmatter are Jx documents now (the Document Header card,
 * `src/surfaces/doc-header.json`, and the Navigator's Page panel, `src/surfaces/panel-page.json`),
 * and a document draws its own markup. What they must not each decide is that a `$ref` field is a
 * picker, that `"uri-reference"` is a media format, or that an array is a comma-separated line — so
 * they do not: they ask here and draw the answer.
 *
 * It replaces `renderFmField`, which was a lit template and could therefore only ever have ONE of
 * the two hosts. The Page panel was the last one, and the renderer went with it.
 */

import { previewAssetSrc } from "../canvas/asset-refs";
import { IMAGE_EXTENSIONS, extensionOf } from "../files/media-upload";
import { referenceEntryState } from "../ui/form-controls";
import { findContentTypeSchema, isMediaFormat } from "../utils/studio-utils";
import { referenceTarget } from "../ui/schema-form";

import type { JsonValue } from "../types";
import type { Tab } from "../tabs/tab";
import type { ProjectConfig } from "@jxsuite/schema/types";

export interface FmSchemaEntry {
  type?: string;
  enum?: string[];
  format?: string;
  properties?: Record<string, unknown>;
  /** `#/content/<type>` — a relationship to another collection (site-architecture.md §6.1). */
  $ref?: string;
}

export interface FmField {
  field: string;
  entry: FmSchemaEntry;
  value: JsonValue;
}

export interface FmFieldSet {
  /** Matched content collection, or null when the doc isn't part of one. */
  collection: { name: string; schema: unknown } | null;
  /** Schema-declared fields (schema order) followed by extra frontmatter keys. */
  fields: FmField[];
  requiredFields: Set<string>;
  /** True when the matched collection declares `schema.properties`. */
  hasSchema: boolean;
}

/**
 * Collect the frontmatter fields to display for a tab: schema-declared fields first (in schema
 * order), then any extra frontmatter keys not in the schema with types inferred from their values.
 * `$`-prefixed keys and `reserved` keys are skipped.
 *
 * @param {Tab} tab
 * @param {ProjectConfig | null | undefined} projectConfig
 * @param {Set<string>} reserved — keys managed by dedicated controls elsewhere
 * @returns {FmFieldSet}
 */
export function collectFmFields(
  tab: Tab,
  projectConfig: ProjectConfig | null | undefined,
  reserved: Set<string>,
): FmFieldSet {
  const fm = tab.doc.content?.frontmatter || {};
  const collection = findContentTypeSchema(tab.documentPath, projectConfig);
  const schema = collection?.schema as
    | { properties?: Record<string, FmSchemaEntry>; required?: string[] }
    | undefined;
  const schemaProps = schema?.properties;
  const requiredFields = new Set(schema?.required || []);

  const fields: FmField[] = [];
  if (schemaProps) {
    for (const [field, fieldSchema] of Object.entries(schemaProps)) {
      if (reserved.has(field)) {
        continue;
      }
      fields.push({ entry: fieldSchema, field, value: fm[field] as JsonValue });
    }
    for (const [field, value] of Object.entries(fm)) {
      if (schemaProps[field] || field.startsWith("$") || reserved.has(field)) {
        continue;
      }
      fields.push({
        entry: { type: typeof value === "boolean" ? "boolean" : "string" },
        field,
        value: value as JsonValue,
      });
    }
  } else {
    for (const [field, value] of Object.entries(fm)) {
      if (field.startsWith("$") || reserved.has(field)) {
        continue;
      }
      fields.push({
        entry: { type: typeof value === "boolean" ? "boolean" : "string" },
        field,
        value: value as JsonValue,
      });
    }
  }

  return { collection, fields, hasSchema: Boolean(schemaProps), requiredFields };
}

/** One choice in a row's picker — the shape `jx-select` reads. */
export interface FmChoice {
  value: string;
  label: string;
}

/**
 * One frontmatter field as a surface draws it. Every field is present whatever the `kind`, because
 * a document's binding renders a value and its `$switch` chooses on one: a row that omitted
 * `options` would leave the picker case reading an absent path.
 */
export interface FmRowView {
  /** The visible label, already carrying the required marker where the schema asks for one. */
  label: string;
  /** Which control the row draws. */
  kind: "text" | "number" | "boolean" | "select" | "media";
  /** Whether the value is set on this document — §4.2's dot, and the row's only clear affordance. */
  isSet: boolean;
  /** The text, number or chosen value, always as a string. Empty for a boolean row. */
  value: string;
  /** A boolean row's state. `false` on every other kind. */
  checked: boolean;
  /** A text row's placeholder. Empty draws none. */
  placeholder: string;
  /** A picker's rows, in the order they are offered. Empty on every other kind. */
  options: FmChoice[];
  /** A sentence under the control — an empty collection, or a listing that failed. */
  note: string;
  /** Whether {@link FmRowView.note} has anything in it; `$switch` is a document's conditional. */
  hasNote: boolean;
  /** A media row's thumbnail source. Empty draws none. */
  thumb: string;
  /** Whether {@link FmRowView.thumb} has anything in it. */
  hasThumb: boolean;
}

/** What one field looks like, and how to read its control's answer back. */
export interface FmRowProjection {
  row: FmRowView;
  /**
   * Turn what the control settled on into the value the frontmatter key should hold — `undefined`
   * where the key should be deleted rather than written empty.
   */
  parse: (raw: string | boolean) => JsonValue | undefined;
}

/** A frontmatter value as the text a field shows. An object is not a string and never pretends. */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A blank row, so every kind carries every field a surface's bindings read. */
function blankRow(label: string): FmRowView {
  return {
    checked: false,
    hasNote: false,
    hasThumb: false,
    isSet: false,
    kind: "text",
    label,
    note: "",
    options: [],
    placeholder: "",
    thumb: "",
    value: "",
  };
}

/**
 * One schema-driven frontmatter field, as the row that draws it and the read that commits it.
 *
 * @param {string} field The frontmatter key.
 * @param {FmSchemaEntry} entry Its schema, or the type inferred from the value it already holds.
 * @param {unknown} value What the document says today.
 * @param {Set<string>} requiredFields The collection's required keys, for the label's marker.
 * @param {{ rerender: () => void }} opts How a surface is repainted when a referenced collection's
 *   entry ids land — the one asynchronous read a row can start.
 * @returns {FmRowProjection}
 */
export function projectFmField(
  field: string,
  entry: FmSchemaEntry,
  value: unknown,
  requiredFields: Set<string>,
  opts: { rerender: () => void },
): FmRowProjection {
  const label = field.replaceAll(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
  const row = blankRow(label + (requiredFields.has(field) ? " *" : ""));
  row.isSet = value !== undefined && value !== "" && value !== false;
  const asText = (raw: string | boolean): JsonValue | undefined => String(raw) || undefined;

  /* A relationship to another collection is a PICKER, not a text box. Before this branch existed a
     `$ref` field fell through to the textfield at the bottom of this function, so the author typed
     an entry id from memory with no way to see what ids exist and no sign when the one they typed
     was wrong. The choices are `ui/form-controls.ts`'s read, shared with the control the entry
     editor and the settings forms draw. */
  const collection = referenceTarget(entry);
  if (collection !== null) {
    const current = text(value);
    const state = referenceEntryState(collection, opts.rerender);
    row.kind = "select";
    row.value = current;
    if (state === null) {
      row.options = [{ label: "Loading…", value: current }];
      return { parse: asText, row };
    }
    if ("error" in state) {
      // The value stays EDITABLE as text with the reason beside it: swapping a failed read for an
      // Empty dropdown would present "no entries" and "could not find out" as the same screen.
      row.kind = "text";
      row.hasNote = true;
      row.note = `Could not list ${collection} entries — ${state.error}`;
      return { parse: asText, row };
    }
    const dangling = current !== "" && !state.ids.includes(current);
    row.options = [
      { label: "—", value: "" },
      ...(dangling ? [{ label: `${current} — not found`, value: current }] : []),
      ...state.ids.map((id) => ({ label: id, value: id })),
    ];
    if (state.ids.length === 0) {
      row.hasNote = true;
      row.note = `No ${collection} entries yet.`;
    }
    return { parse: asText, row };
  }

  if (entry.type === "boolean") {
    row.kind = "boolean";
    row.checked = Boolean(value);
    return { parse: (raw) => (raw === true ? true : undefined), row };
  }

  if (entry.type === "array") {
    row.value = Array.isArray(value) ? value.join(", ") : text(value);
    row.placeholder = "comma, separated";
    return {
      parse: (raw) => {
        const list = String(raw);
        return list
          ? list
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
      },
      row,
    };
  }

  if (Array.isArray(entry.enum)) {
    row.kind = "select";
    row.value = text(value);
    row.options = [
      { label: "—", value: "" },
      ...entry.enum.map((opt: string) => ({ label: opt, value: opt })),
    ];
    return { parse: asText, row };
  }

  /* Both spellings. `"uri-reference"` is the one the SPEC uses and the one the content loader keys
     its asset rewrite on (`rewriteEntryAssets`), so a schema written against the spec got a plain
     text box here while the same field got a media picker in the properties panel — which reads
     `inferInputType`, and that has always accepted it. */
  if (isMediaFormat(entry.format)) {
    const current = text(value);
    row.kind = "media";
    row.value = current;
    row.hasThumb = current !== "" && IMAGE_EXTENSIONS.has(extensionOf(current));
    row.thumb = row.hasThumb ? previewAssetSrc(current) : "";
    return { parse: asText, row };
  }

  if (entry.type === "number") {
    row.kind = "number";
    row.value = value === undefined ? "" : String(value);
    return {
      parse: (raw) => {
        /* NaN is deleted rather than written. The two surfaces this replaced disagreed here: the
           Page panel's `spNumberField` refused a non-number and the Document Header card wrote
           `NaN` into the frontmatter, where it round-trips to `null`. One answer, and it is the
           one that cannot corrupt the document. */
        const trimmed = String(raw).trim();
        const parsed = Number(trimmed);
        return trimmed === "" || Number.isNaN(parsed) ? undefined : parsed;
      },
      row,
    };
  }

  row.value = text(value);
  row.placeholder = entry.format === "date" ? "YYYY-MM-DD" : "";
  return { parse: asText, row };
}
