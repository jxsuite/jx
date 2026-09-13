/// <reference lib="dom" />
/**
 * Data Shapes — the editor for project-level `$defs` (JSON Schema type definitions).
 *
 * Manages entries in project.json `$defs` — reusable type schemas for external datasets, API
 * responses, CMS payloads, etc. Same concept as component-level `$defs` but scoped to the entire
 * project. The on-disk key stays `$defs` and the section key stays `definitions`; the surface is
 * named for neither, because a surface is named for what it draws.
 *
 * **The reference field type is complete here.** `schema-field-ui.ts` has always been able to draw
 * the target picker, and `ui/form-controls.ts` (the content-types builder) has always passed it the
 * available content types — this editor never did, so choosing "reference" emitted a bare
 * `#/content/` that pointed at nothing and offered no way to say what it pointed at. The list is
 * read straight off the live config's `content` map, which is where a `#/content/<type>` pointer
 * resolves.
 *
 * **The markup left.** The section is the `settings-defs` surface (`surfaces/settings-defs.json`),
 * mounted by `surfaces/settings-defs.ts`; what is here is the section itself — what a shape is,
 * what a field may be renamed to, and what reaches `project.json`. `renderDefsEditor` is unchanged
 * as a contract: the registry hands a container to a `render`, and this one mounts a document into
 * it instead of rendering lit.
 *
 * Three things the conversion settled, and each was a defect rather than a translation:
 *
 * - **The field cards are this section's own now.** They were `schema-field-ui.ts`'s lit templates,
 *   shared with the content-types builder, and that sharing is what made every card a Spectrum one.
 *   That module is untouched and still draws the builder's cards; this section draws its own out of
 *   the kit, so the two surfaces can move one at a time. Nothing was deleted from it.
 * - **The nested add row no longer reads itself.** It found its own name field and its own picker
 *   with `closest()` and `querySelector` at click time — a node found by selector is real only
 *   until the next render — so what the reader had typed lived in the DOM and nowhere else. Each
 *   object field now carries its draft in this section's own state ({@link DefsUi.drafts}), which
 *   is what lets a redraw arrive mid-typing without taking the half-typed name away.
 * - **A refused rename snaps back because the scope moves, not because a handler writes to an
 *   input.** The lit version assigned `target.value = fieldName` from inside the change handler. A
 *   document's binding only writes when the scope value CHANGES, and after a refusal the scope
 *   still holds what is on disk — so every setter says what the control now holds first
 *   ({@link say}), and the snap-back is then a real move.
 *
 * @docs studio/projects/settings
 */

import { projectState } from "../store";
import { commitProjectConfig } from "../tabs/project-config";
import { camelToLabel } from "../utils/studio-utils";
import {
  FIELD_TYPES,
  FORMAT_OPTIONS,
  detectFieldFormat,
  detectFieldType,
  schemaForType,
} from "./schema-field-ui";
import { mountDefsSurface } from "../surfaces/settings-defs";

import type { SchemaProperty } from "./schema-field-ui";
import type {
  DefsActions,
  DefsChoice,
  DefsFieldView,
  DefsSurfaceHandle,
  DefsView,
  NestedFieldView,
} from "../surfaces/settings-defs";
import type { ContentTypeSchema, ContentTypeSchemaField } from "@jxsuite/schema/types";

// ─── The pickers ──────────────────────────────────────────────────────────────

/** The field types, as picker rows. One array, made once: an equal write re-runs no binding. */
const TYPE_ROWS: DefsChoice[] = FIELD_TYPES.map((type) => ({ label: type, value: type }));

/** The formats, with the empty one named: a blank row says nothing about what choosing it does. */
const FORMAT_ROWS: DefsChoice[] = FORMAT_OPTIONS.map((format) => ({
  label: format || "(none)",
  value: format,
}));

/** What a new field starts as. */
const BLANK_FIELD = { format: "", name: "", required: false, type: "string" };

// ─── Per-container state ──────────────────────────────────────────────────────

/** One object field's unsubmitted nested field. */
interface Draft {
  name: string;
  type: string;
}

/**
 * What the reader is part-way through, per rendered container.
 *
 * Per container rather than per module, for the reason `general-settings.ts` and
 * `contexts-section.ts` keep their errors that way: Project Settings is a pane document and a pane
 * can be split, so two containers may be showing this section at once. Module state would make the
 * second one take the first one's selection away the moment either was redrawn.
 */
interface DefsUi {
  selected: string | null;
  newOpen: boolean;
  newName: string;
  addOpen: boolean;
  add: { format: string; name: string; required: boolean; type: string };
  /** Each object field's nested add row, by the field's name on disk. */
  drafts: Map<string, Draft>;
  /**
   * The ONE control whose value has parted from what is on disk, and what it holds.
   *
   * One at a time is the whole truth of it: a `change` commits one control, and the decision about
   * it is synchronous, so there is never a second control in flight. See {@link say}.
   */
  echo: { id: string; value: string | boolean } | null;
}

const uis = new WeakMap<HTMLElement, DefsUi>();

/** The mounted surface, per container — see {@link renderDefsEditor}. */
const mounts = new WeakMap<HTMLElement, DefsSurfaceHandle>();

/** This container's state, made on first use. */
function uiFor(container: HTMLElement): DefsUi {
  let ui = uis.get(container);
  if (!ui) {
    ui = {
      add: { ...BLANK_FIELD },
      addOpen: false,
      drafts: new Map(),
      echo: null,
      newName: "",
      newOpen: false,
      selected: null,
    };
    uis.set(container, ui);
  }
  return ui;
}

/** The id of a field's name control. */
function nameId(key: string): string {
  return `name:${key}`;
}

/** The id of a field's required switch. */
function requiredId(key: string): string {
  return `required:${key}`;
}

/** A child is addressed by both halves, because two objects may hold the same child name. */
function nestedId(parent: string, key: string): string {
  return `${parent} ${key}`;
}

/**
 * Say what a control now holds, before anything is decided about it.
 *
 * This is what `live()` did for the lit templates. A document's binding writes only when the SCOPE
 * value changes, and after a refusal the scope still holds the value on disk — so without this
 * nothing is written back and the refused text stays in the field. Echoing first makes the
 * projection that follows a real change.
 */
function say(container: HTMLElement, id: string, value: string | boolean): void {
  uiFor(container).echo = { id, value };
  renderDefsEditor(container);
}

/** Forget the echo: every control shows what the file says again. */
function hush(container: HTMLElement): void {
  uiFor(container).echo = null;
}

/** What a control shows: what it was last told it holds, or what is on disk. */
function shown<T extends string | boolean>(ui: DefsUi, id: string, disk: T): T {
  return ui.echo?.id === id ? (ui.echo.value as T) : disk;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/**
 * Commit the configuration this editor has just mutated in place.
 *
 * Every handler below edits `projectState.projectConfig.$defs` directly and then says so here. The
 * predecessor was this module's own writer — `JSON.stringify(config, null, "\t")` straight to
 * `platform.writeFile`, called as `void saveProjectConfig()` at fourteen sites. It re-indented the
 * whole file (every `project.json` on disk uses two spaces), it recorded nothing an undo could
 * reach, and a rejected write became an unhandled rejection while the form went on showing a data
 * shape that was never saved.
 *
 * `commitProjectConfig` transacts the mutation onto the configuration document and reports its own
 * failures as Problems, so there is nothing left here to await or to swallow.
 */
function persist(): void {
  void commitProjectConfig();
}

// ─── The project, as it stands now ────────────────────────────────────────────

/**
 * The live `$defs`, read at the moment it is needed.
 *
 * The lit version closed over the config at render time and rebuilt every handler on every render,
 * so a stale closure was impossible only because there were no long-lived ones. The handlers now
 * outlive a projection, which makes reading through to the store the thing that keeps them honest.
 */
function currentDefs(): Record<string, ContentTypeSchema> | undefined {
  return projectState?.projectConfig?.$defs as Record<string, ContentTypeSchema> | undefined;
}

/** The selected shape's schema, or `undefined` when nothing is selected or it has gone. */
function selectedDef(ui: DefsUi): ContentTypeSchema | undefined {
  return ui.selected === null ? undefined : currentDefs()?.[ui.selected];
}

/**
 * The content types a `reference` field can point at — the same list the content-types builder
 * resolves through `#/$context/content`, read here without a schema-form context to go through.
 */
function contentTypeNames(): string[] {
  const content = (projectState?.projectConfig as Record<string, unknown> | null | undefined)
    ?.content;
  return content && typeof content === "object" && !Array.isArray(content)
    ? Object.keys(content)
    : [];
}

/** The last target list, so an unchanged one is the same array and re-runs no binding. */
let targetRows: DefsChoice[] = [];
let targetNames = " ";

/** The reference targets, as picker rows. */
function targets(): DefsChoice[] {
  const names = contentTypeNames();
  const id = names.join(" ");
  if (id !== targetNames) {
    targetNames = id;
    targetRows = names.map((name) => ({ label: name, value: name }));
  }
  return targetRows;
}

// ─── Projection ───────────────────────────────────────────────────────────────

/** Whether a type carries a format at all — only `string` and `array` do. */
function takesFormat(type: string): boolean {
  return type === "string" || type === "array";
}

/** One child of an object field, as the document draws it. */
function nestedView(
  ui: DefsUi,
  parent: string,
  key: string,
  schema: SchemaProperty,
  required: boolean,
): NestedFieldView {
  const id = nestedId(parent, key);
  const type = detectFieldType(schema);
  return {
    format: detectFieldFormat(schema),
    hasFormat: takesFormat(type),
    key,
    name: shown(ui, nameId(id), key),
    parent,
    required: shown(ui, requiredId(id), required),
    type,
  };
}

/** One field of the selected shape, as the document draws it. */
function fieldView(
  ui: DefsUi,
  key: string,
  schema: SchemaProperty,
  required: boolean,
  hasTargets: boolean,
): DefsFieldView {
  const type = detectFieldType(schema);
  const nested = type === "object";
  const draft = ui.drafts.get(key);
  const childRequired = schema.required ?? [];
  return {
    children: nested
      ? Object.entries(schema.properties ?? {}).map(([child, sub]) =>
          nestedView(ui, key, child, sub, childRequired.includes(child)),
        )
      : [],
    draftName: draft?.name ?? "",
    draftType: draft?.type ?? "string",
    /* A reference with nothing to point at draws no picker: a control whose list is empty offers
       the reader no answer, which is why the lit card gated on the same thing. */
    extra: type === "reference" && hasTargets ? "reference" : nested ? "nested" : "none",
    format: detectFieldFormat(schema),
    hasFormat: takesFormat(type),
    key,
    label: camelToLabel(key),
    name: shown(ui, nameId(key), key),
    refTarget: schema.$ref ? schema.$ref.replace(/^#\/[^/]+\//, "") : "",
    required: shown(ui, requiredId(key), required),
    type,
  };
}

/** The whole section, as one value the document can be handed. */
function project(container: HTMLElement): DefsView {
  const ui = uiFor(container);
  const defs = currentDefs() ?? {};
  const def = selectedDef(ui);
  const rows = targets();
  const properties = def?.properties ?? {};
  const required = def?.required ?? [];
  return {
    addFormat: ui.add.format,
    addHasFormat: takesFormat(ui.add.type),
    addName: ui.add.name,
    addRequired: ui.add.required,
    addState: ui.addOpen && def ? "open" : "closed",
    addType: ui.add.type,
    editorState: def ? "editing" : "empty",
    fields: Object.entries(properties).map(([key, schema]) =>
      fieldView(ui, key, schema as SchemaProperty, required.includes(key), rows.length > 0),
    ),
    formatOptions: FORMAT_ROWS,
    newName: ui.newName,
    newState: ui.newOpen ? "open" : "closed",
    selected: def && ui.selected !== null ? ui.selected : "",
    shapes: Object.keys(defs).map((name) => ({ name, selected: name === ui.selected })),
    targets: rows,
    typeOptions: TYPE_ROWS,
  };
}

// ─── The decisions ────────────────────────────────────────────────────────────

/**
 * What every control in one container does. Built once, when that container's surface is mounted,
 * and read through to the store on every call.
 */
function actionsFor(container: HTMLElement): DefsActions {
  const ui = uiFor(container);
  const redraw = (): void => renderDefsEditor(container);

  /** The parent object a nested edit is about, or `undefined` when it has gone underneath. */
  const parentOf = (parent: string): SchemaProperty | undefined =>
    selectedDef(ui)?.properties?.[parent] as SchemaProperty | undefined;

  /** One object field's add-row draft, made on first use. */
  const draftOf = (parent: string): Draft => {
    let draft = ui.drafts.get(parent);
    if (!draft) {
      draft = { name: "", type: "string" };
      ui.drafts.set(parent, draft);
    }
    return draft;
  };

  /** A property map with one key renamed, rebuilt in place so a rename never reorders the list. */
  const renameKey = <T>(properties: Record<string, T>, from: string, to: string): void => {
    const next: Record<string, T> = {};
    for (const [key, value] of Object.entries(properties)) {
      next[key === from ? to : key] = value;
      delete properties[key];
    }
    Object.assign(properties, next);
  };

  /** Add or remove a name from a `required` list, made on first use. */
  const markRequired = (
    holder: { required?: string[] | undefined },
    key: string,
    required: boolean,
  ): void => {
    if (!holder.required) {
      holder.required = [];
    }
    const at = holder.required.indexOf(key);
    if (required && at === -1) {
      holder.required.push(key);
    }
    if (!required && at !== -1) {
      holder.required.splice(at, 1);
    }
  };

  /** A refusal: the control goes back to what the file says, and nothing is written. */
  const refuse = (): void => {
    hush(container);
    redraw();
  };

  /** A write went through: forget the echo, redraw from the file, and commit it. */
  const done = (): void => {
    hush(container);
    redraw();
    persist();
  };

  return {
    addNested(parent) {
      const draft = draftOf(parent);
      const name = draft.name.trim();
      const holder = parentOf(parent);
      if (!name || !holder) {
        return;
      }
      if (!holder.properties) {
        holder.properties = {};
      }
      holder.properties[name] = schemaForType(draft.type || "string");
      /* The name clears and the type does not: adding three strings in a row is the ordinary case,
         and re-choosing the type each time would be the editor asking what it just heard. */
      draft.name = "";
      done();
    },
    cancelAdd() {
      ui.addOpen = false;
      ui.add = { ...BLANK_FIELD };
      redraw();
    },
    cancelNew() {
      ui.newOpen = false;
      ui.newName = "";
      redraw();
    },
    confirmAdd() {
      const name = ui.add.name.trim();
      const def = selectedDef(ui);
      if (!name || !def) {
        return;
      }
      if (!def.properties) {
        def.properties = {};
      }
      def.properties[name] = schemaForType(ui.add.type, ui.add.format || undefined);
      if (ui.add.required) {
        markRequired(def, name, true);
      }
      ui.addOpen = false;
      ui.add = { ...BLANK_FIELD };
      done();
    },
    createNew() {
      const name = ui.newName.trim();
      const config = projectState?.projectConfig;
      if (!name || !config) {
        return;
      }
      if (!config.$defs) {
        config.$defs = {};
      }
      if (config.$defs[name]) {
        return;
      }
      config.$defs[name] = { properties: {}, required: [], type: "object" };
      ui.selected = name;
      ui.newOpen = false;
      ui.newName = "";
      done();
    },
    editAddFormat(value) {
      ui.add.format = value;
      redraw();
    },
    editAddName(value) {
      ui.add.name = value;
      redraw();
    },
    editAddRequired(required) {
      ui.add.required = required;
      redraw();
    },
    editAddType(value) {
      ui.add.type = value;
      redraw();
    },
    editDraftName(parent, value) {
      draftOf(parent).name = value;
      redraw();
    },
    editDraftType(parent, value) {
      draftOf(parent).type = value;
      redraw();
    },
    editNew(value) {
      ui.newName = value;
      redraw();
    },
    openAdd() {
      ui.addOpen = true;
      ui.add = { ...BLANK_FIELD };
      redraw();
    },
    openNew() {
      ui.newOpen = true;
      ui.newName = "";
      redraw();
    },
    removeField(key) {
      const def = selectedDef(ui);
      if (!def?.properties) {
        return;
      }
      delete def.properties[key];
      if (def.required) {
        def.required = def.required.filter((name) => name !== key);
      }
      done();
    },
    removeNested(parent, key) {
      const holder = parentOf(parent);
      if (!holder?.properties) {
        return;
      }
      delete holder.properties[key];
      if (holder.required) {
        holder.required = holder.required.filter((name) => name !== key);
      }
      done();
    },
    removeShape() {
      const defs = currentDefs();
      if (ui.selected === null || !defs?.[ui.selected]) {
        return;
      }
      delete defs[ui.selected];
      ui.selected = null;
      ui.addOpen = false;
      done();
    },
    renameField(key, value) {
      say(container, nameId(key), value);
      const def = selectedDef(ui);
      const name = value.trim();
      if (!def?.properties || !name || name === key || def.properties[name]) {
        refuse();
        return;
      }
      renameKey(def.properties, key, name);
      if (def.required) {
        def.required = def.required.map((entry) => (entry === key ? name : entry));
      }
      done();
    },
    renameNested(parent, key, value) {
      say(container, nameId(nestedId(parent, key)), value);
      const holder = parentOf(parent);
      const name = value.trim();
      if (!holder?.properties || !name || name === key || holder.properties[name]) {
        refuse();
        return;
      }
      renameKey(holder.properties, key, name);
      if (holder.required) {
        holder.required = holder.required.map((entry) => (entry === key ? name : entry));
      }
      done();
    },
    select(name) {
      ui.selected = name;
      ui.addOpen = false;
      redraw();
    },
    setFormat(key, value) {
      const def = selectedDef(ui);
      const property = def?.properties?.[key];
      if (!def?.properties || !property) {
        return;
      }
      def.properties[key] = schemaForType(property.type || "string", value || undefined);
      done();
    },
    setNestedFormat(parent, key, value) {
      const holder = parentOf(parent);
      const property = holder?.properties?.[key];
      if (!holder?.properties || !property) {
        return;
      }
      holder.properties[key] = schemaForType(property.type || "string", value || undefined);
      done();
    },
    setNestedRequired(parent, key, required) {
      say(container, requiredId(nestedId(parent, key)), required);
      const holder = parentOf(parent);
      if (!holder) {
        refuse();
        return;
      }
      markRequired(holder, key, required);
      done();
    },
    setNestedType(parent, key, value) {
      const holder = parentOf(parent);
      const property = holder?.properties?.[key];
      if (!holder?.properties || !property) {
        return;
      }
      /* A format survives a move between the two types that carry one, and is dropped by any type
         that does not: `schemaForType` is handed the old format only when the new type takes it. */
      const format = takesFormat(value) ? detectFieldFormat(property) : undefined;
      holder.properties[key] = schemaForType(value, format || undefined);
      done();
    },
    setRequired(key, required) {
      say(container, requiredId(key), required);
      const def = selectedDef(ui);
      if (!def) {
        refuse();
        return;
      }
      markRequired(def, key, required);
      done();
    },
    setTarget(key, value) {
      const def = selectedDef(ui);
      if (!def?.properties?.[key]) {
        return;
      }
      /* The pointer form is `#/content/<type>` — the same one `ui/form-controls.ts` writes, so a
         reference authored here and one authored in the content-types builder are the same value. */
      def.properties[key] = { $ref: `#/content/${value}` } as ContentTypeSchemaField;
      done();
    },
    setType(key, value) {
      const def = selectedDef(ui);
      const property = def?.properties?.[key];
      if (!def?.properties || !property) {
        return;
      }
      const format = takesFormat(value) ? detectFieldFormat(property) : undefined;
      def.properties[key] = schemaForType(value, format || undefined);
      done();
    },
  };
}

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * Render Project Settings › Data Shapes into `container`.
 *
 * One mount per container, re-used for every subsequent call. The host calls this again for any
 * change it notices, and a section whose container has meanwhile been given to a DIFFERENT section
 * finds its document gone — `litRender` into the same node replaces everything in it — so the mount
 * is rebuilt exactly when it has actually been evicted, and disposed on the way out rather than
 * left running over detached nodes.
 *
 * @param {HTMLElement} container
 */
export function renderDefsEditor(container: HTMLElement): void {
  let handle = mounts.get(container);
  if (!handle?.attached()) {
    handle?.dispose();
    handle = mountDefsSurface(container, actionsFor(container));
    mounts.set(container, handle);
  }
  handle.update(project(container));
}
