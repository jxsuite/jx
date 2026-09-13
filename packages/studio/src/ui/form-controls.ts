/// <reference lib="dom" />
/**
 * Built-in schema-form controls (specs/extensions.md §9.1): "schema-builder" (the visual
 * JSON-Schema field editor), "secret" (value committed via the host's secret store, never
 * project.json) and "reference" (an entry of another content collection).
 *
 * Three, not the four the spec still lists: `"binding"` was the signal/route-param picker, and P5
 * replaced it with the value-source ladder every scalar field now carries (`ui/dynamic-slot.ts`,
 * `ui/value-source.ts`). Nothing has registered it since, so a descriptor naming it falls through
 * to the control its type would have had anyway.
 *
 * **All three are Jx documents, and the registry has one shape again.** Each is registered as a
 * MOUNT (`ui/schema-form.ts`'s {@link SchemaFormMountedControl}): the form's own document announces
 * an empty `[part="control-host"]` per field, a document clears the host it is given, and the flow
 * for each control lives here while its markup lives beside it in `surfaces/schema-builder.json`,
 * `surfaces/secret-field.json` and `surfaces/reference-field.json`. The template half of the
 * registry went with the last of them — this module was its only producer, and `ui/schema-form.ts`
 * imported lit for nothing else.
 *
 * Imported once for side effects from studio startup.
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { referenceTarget, registerFormControl } from "./schema-form";
import {
  FIELD_TYPES,
  FORMAT_OPTIONS,
  detectFieldFormat,
  detectFieldType,
  schemaForType,
} from "../settings/schema-field-ui";
import { mountSchemaBuilderSurface } from "../surfaces/schema-builder";
import { mountReferenceFieldSurface } from "../surfaces/reference-field";
import { mountSecretFieldSurface } from "../surfaces/secret-field";
import { camelToLabel, toCamelCase } from "../utils/studio-utils";

import type { SchemaProperty } from "../settings/schema-field-ui";
import type {
  NestedSchemaFieldView,
  SchemaBuilderView,
  SchemaFieldChoice,
  SchemaFieldView,
} from "../surfaces/schema-builder";
import type { ReferenceChoice, ReferenceFieldView } from "../surfaces/reference-field";
import type {
  SchemaFormContext,
  SchemaFormControlArgs,
  SchemaFormControlHandle,
  SchemaFormMountedControl,
} from "./schema-form";

// ─── Schema-builder control ──────────────────────────────────────────────────

/**
 * The visual JSON-Schema field editor: `surfaces/schema-builder.json` draws it, and everything
 * below decides it.
 *
 * It is a MOUNTED control (`ui/schema-form.ts`'s {@link SchemaFormMountedControl}) rather than a
 * template one, which is the whole of this conversion: the form's own document announces an empty
 * `[part="control-host"]` per field, a Jx document clears the host it is given, and the two facts
 * together are what let the last lit consumer of the registry become a document. Three things the
 * move settled, and each was a defect rather than a translation:
 *
 * - **The add rows no longer read themselves.** The nested add row found its own name field and its
 *   own picker with `closest()` and `querySelector` at click time — a node found by selector is
 *   real only until the next render — so what the reader had typed lived in the DOM and nowhere
 *   else, and an outside repaint took it away. Each object field carries its draft in
 *   {@link BuilderUi.drafts} now.
 * - **A refused rename snaps back because the value moves, not because a handler writes to an
 *   input.** The lit card assigned `target.value = fieldName` from inside its change handler. A
 *   document's binding only writes when the scope value CHANGES, and after a refusal the scope
 *   still holds what the schema says — so every rename says what the control now holds first
 *   ({@link say}), and the snap-back is then a real move.
 * - **A vanished field is a no-op, not an empty commit.** Every handler used to clone the value, run
 *   a mutation that returned early, and commit the clone anyway — so an edit to a card whose field
 *   had gone underneath it wrote the schema back minus nothing, and the host recorded an edit that
 *   was not one. A refusal now commits nothing at all.
 */

/** The JSON-Schema object shape the schema-builder edits. */
interface BuilderSchema {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

/** A draft with its three lists filled in, which is what a mutation is handed. */
interface BuilderDraft extends BuilderSchema {
  properties: Record<string, SchemaProperty>;
  required: string[];
}

/** One object field's unsubmitted nested field. */
interface NestedDraft {
  name: string;
  type: string;
}

/**
 * What the reader is part-way through, per mounted control.
 *
 * Per mount rather than per module, which is what the host element buys: two panes may each be
 * showing a content type's schema, and the module-level `Map` keyed on `${fieldKeyPrefix}.${key}`
 * this replaced gave the second one the first one's open add form.
 */
interface BuilderUi {
  addOpen: boolean;
  add: { format: string; name: string; required: boolean; type: string };
  /** Each object field's nested add row, by the field's name in the schema. */
  drafts: Map<string, NestedDraft>;
  /**
   * The ONE control whose value has parted from the schema, and what it holds.
   *
   * One at a time is the whole truth of it: a `change` commits one control, and the decision about
   * it is synchronous, so there is never a second control in flight. See {@link say}.
   */
  echo: { id: string; value: string | boolean } | null;
}

/** The field types, as picker rows. One array, made once: an equal write re-runs no binding. */
const TYPE_ROWS: SchemaFieldChoice[] = FIELD_TYPES.map((type) => ({ label: type, value: type }));

/** The formats, with the empty one named: a blank row says nothing about what choosing it does. */
const FORMAT_ROWS: SchemaFieldChoice[] = FORMAT_OPTIONS.map((format) => ({
  label: format || "(none)",
  value: format,
}));

/** What a new field starts as. */
const BLANK_FIELD = { format: "", name: "", required: false, type: "string" };

/** The last target list, so an unchanged one is the same array and re-runs no binding. */
let targetRows: SchemaFieldChoice[] = [];
let targetNames = " ";

/**
 * Forget the memoised reference-target rows (test hook).
 *
 * The builder's own ephemeral state — which add form is open, what each add row holds — lives with
 * the mount now and goes when the control does, so this is what is left of a module-level reset.
 */
export function resetFormControlUiState(): void {
  targetRows = [];
  targetNames = " ";
}

/**
 * The content types a `reference` field can point at, through the host's context.
 *
 * The same list `settings/defs-editor.ts` reads straight off the live config: this one goes through
 * `#/$context/content` because a form control is given a context and never the project.
 */
function targetsFor(ctx: SchemaFormContext): SchemaFieldChoice[] {
  const content = ctx.resolvePointer("#/$context/content");
  const names =
    content && typeof content === "object" && !Array.isArray(content) ? Object.keys(content) : [];
  const id = names.join(" ");
  if (id !== targetNames) {
    targetNames = id;
    targetRows = names.map((name) => ({ label: name, value: name }));
  }
  return targetRows;
}

/** Whether a type carries a format at all — only `string` and `array` do. */
function takesFormat(type: string): boolean {
  return type === "string" || type === "array";
}

/** The value as a schema object: anything else is an object with no fields in it yet. */
function readSchema(value: unknown): BuilderSchema {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as BuilderSchema)
    : { properties: {}, required: [], type: "object" };
}

/** Working clone of the schema value — JSON round-trip, as values may be reactive proxies. */
function cloneSchema(value: unknown): BuilderDraft {
  // oxlint-disable-next-line unicorn/prefer-structured-clone
  const draft = JSON.parse(JSON.stringify(readSchema(value))) as BuilderSchema;
  draft.type ??= "object";
  draft.properties ??= {};
  draft.required ??= [];
  return draft as BuilderDraft;
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

/** What a control shows: what it was last told it holds, or what the schema says. */
function shown<T extends string | boolean>(ui: BuilderUi, id: string, held: T): T {
  return ui.echo?.id === id ? (ui.echo.value as T) : held;
}

/** One child of an object field, as the document draws it. */
function nestedView(
  ui: BuilderUi,
  parent: string,
  key: string,
  schema: SchemaProperty,
  required: boolean,
): NestedSchemaFieldView {
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

/** One field of the object, as the document draws it. */
function fieldView(
  ui: BuilderUi,
  key: string,
  schema: SchemaProperty,
  required: boolean,
  hasTargets: boolean,
): SchemaFieldView {
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

/** A property map with one key renamed, rebuilt in place so a rename never reorders the list. */
function renameKey<T>(properties: Record<string, T>, from: string, to: string): void {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(properties)) {
    next[key === from ? to : key] = value;
    delete properties[key];
  }
  Object.assign(properties, next);
}

/** Add or remove a name from a `required` list, made on first use. */
function markRequired(
  holder: { required?: string[] | undefined },
  key: string,
  required: boolean,
): void {
  holder.required ??= [];
  const at = holder.required.indexOf(key);
  if (required && at === -1) {
    holder.required.push(key);
  }
  if (!required && at !== -1) {
    holder.required.splice(at, 1);
  }
}

/**
 * Mount the schema-builder into the host the form drew for it.
 *
 * @param {HTMLElement} host - The field's `[part="control-host"]`
 * @param {SchemaFormControlArgs} args - The value, the context and the commit hook
 * @returns {SchemaFormControlHandle}
 */
function mountSchemaBuilder(
  host: HTMLElement,
  args: SchemaFormControlArgs,
): SchemaFormControlHandle {
  let latest = args;
  /**
   * The schema this control last committed, until the host hands one back.
   *
   * Every host that draws this control redraws on a commit, and the redraw arrives as an `update`
   * carrying the new value — but the frontmatter renderer passes no `rerender` at all, and a host
   * that never came back would leave the cards showing the schema as it was before the edit. The
   * commit is what is shown until the value itself moves.
   */
  let committed: BuilderSchema | null = null;
  const ui: BuilderUi = {
    add: { ...BLANK_FIELD },
    addOpen: false,
    drafts: new Map(),
    echo: null,
  };

  /** What the cards are drawn from. */
  const source = (): BuilderSchema => committed ?? readSchema(latest.value);

  const project = (): SchemaBuilderView => {
    const schema = source();
    const required = schema.required ?? [];
    const rows = targetsFor(latest.ctx);
    return {
      addFormat: ui.add.format,
      addHasFormat: takesFormat(ui.add.type),
      addName: ui.add.name,
      addRequired: ui.add.required,
      addState: ui.addOpen ? "open" : "closed",
      addType: ui.add.type,
      fields: Object.entries(schema.properties ?? {}).map(([key, property]) =>
        fieldView(ui, key, property, required.includes(key), rows.length > 0),
      ),
      formatOptions: FORMAT_ROWS,
      targets: rows,
      typeOptions: TYPE_ROWS,
    };
  };

  const redraw = (): void => surface.update(project());

  /**
   * Say what a control now holds, before anything is decided about it.
   *
   * This is what `live()` did for the lit card. A document's binding writes only when the SCOPE
   * value changes, and after a refusal the scope still holds what the schema says — so without this
   * nothing is written back and the refused text stays in the field.
   */
  const say = (id: string, value: string | boolean): void => {
    ui.echo = { id, value };
    redraw();
  };

  /** A refusal: every control goes back to what the schema says, and nothing is committed. */
  const refuse = (): void => {
    ui.echo = null;
    redraw();
  };

  /**
   * Edit the schema and commit the result.
   *
   * The draft is a clone, so a mutation that answers `false` costs nothing: it is a REFUSAL, and
   * the host hears nothing at all. A mutation that answers `true` is what the field now holds, and
   * it is shown from this moment rather than when the host gets round to redrawing.
   */
  const write = (mutate: (draft: BuilderDraft) => boolean): void => {
    const draft = cloneSchema(source());
    if (!mutate(draft)) {
      refuse();
      return;
    }
    committed = draft;
    ui.echo = null;
    latest.onChange(draft);
    redraw();
  };

  /** The parent object a nested edit is about, or `undefined` when it has gone underneath. */
  const parentOf = (draft: BuilderDraft, parent: string): SchemaProperty | undefined =>
    draft.properties[parent];

  /** One object field's add-row draft, made on first use. */
  const draftOf = (parent: string): NestedDraft => {
    let draft = ui.drafts.get(parent);
    if (!draft) {
      draft = { name: "", type: "string" };
      ui.drafts.set(parent, draft);
    }
    return draft;
  };

  const surface = mountSchemaBuilderSurface(host, {
    addNested(parent) {
      const draft = draftOf(parent);
      const name = toCamelCase(draft.name.trim());
      if (!name) {
        return;
      }
      write((next) => {
        const holder = parentOf(next, parent);
        if (!holder) {
          return false;
        }
        holder.properties ??= {};
        holder.properties[name] = schemaForType(draft.type || "string");
        /* The name clears and the type does not: adding three strings in a row is the ordinary
           case, and re-choosing the type each time would be the editor asking what it just heard. */
        draft.name = "";
        return true;
      });
    },
    cancelAdd() {
      ui.addOpen = false;
      ui.add = { ...BLANK_FIELD };
      redraw();
    },
    confirmAdd() {
      const name = toCamelCase(ui.add.name.trim());
      if (!name) {
        return;
      }
      const { format, required, type } = ui.add;
      ui.addOpen = false;
      ui.add = { ...BLANK_FIELD };
      write((next) => {
        next.properties[name] = schemaForType(type, format || undefined);
        if (required) {
          markRequired(next, name, true);
        }
        return true;
      });
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
    openAdd() {
      ui.addOpen = true;
      ui.add = { ...BLANK_FIELD };
      redraw();
    },
    removeField(key) {
      write((next) => {
        if (!next.properties[key]) {
          return false;
        }
        delete next.properties[key];
        next.required = next.required.filter((name) => name !== key);
        return true;
      });
    },
    removeNested(parent, key) {
      write((next) => {
        const holder = parentOf(next, parent);
        if (!holder?.properties?.[key]) {
          return false;
        }
        delete holder.properties[key];
        if (holder.required) {
          holder.required = holder.required.filter((name) => name !== key);
        }
        return true;
      });
    },
    renameField(key, value) {
      say(nameId(key), value);
      const name = toCamelCase(value.trim());
      write((next) => {
        if (!next.properties[key] || !name || name === key || next.properties[name]) {
          return false;
        }
        renameKey(next.properties, key, name);
        next.required = next.required.map((entry) => (entry === key ? name : entry));
        return true;
      });
    },
    renameNested(parent, key, value) {
      say(nameId(nestedId(parent, key)), value);
      const name = toCamelCase(value.trim());
      write((next) => {
        const holder = parentOf(next, parent);
        if (!holder?.properties?.[key] || !name || name === key || holder.properties[name]) {
          return false;
        }
        renameKey(holder.properties, key, name);
        if (holder.required) {
          holder.required = holder.required.map((entry) => (entry === key ? name : entry));
        }
        return true;
      });
    },
    setFormat(key, value) {
      write((next) => {
        const property = next.properties[key];
        if (!property) {
          return false;
        }
        next.properties[key] = schemaForType(property.type || "string", value || undefined);
        return true;
      });
    },
    setNestedFormat(parent, key, value) {
      write((next) => {
        const holder = parentOf(next, parent);
        const property = holder?.properties?.[key];
        if (!holder?.properties || !property) {
          return false;
        }
        holder.properties[key] = schemaForType(property.type || "string", value || undefined);
        return true;
      });
    },
    setNestedRequired(parent, key, required) {
      say(requiredId(nestedId(parent, key)), required);
      write((next) => {
        const holder = parentOf(next, parent);
        if (!holder) {
          return false;
        }
        markRequired(holder, key, required);
        return true;
      });
    },
    setNestedType(parent, key, value) {
      write((next) => {
        const holder = parentOf(next, parent);
        const property = holder?.properties?.[key];
        if (!holder?.properties || !property) {
          return false;
        }
        /* A format survives a move between the two types that carry one, and is dropped by any type
           that does not: `schemaForType` is handed the old format only when the new type takes it. */
        const format = takesFormat(value) ? detectFieldFormat(property) : undefined;
        holder.properties[key] = schemaForType(value, format || undefined);
        return true;
      });
    },
    setRequired(key, required) {
      say(requiredId(key), required);
      write((next) => {
        if (!next.properties[key]) {
          return false;
        }
        markRequired(next, key, required);
        return true;
      });
    },
    setTarget(key, value) {
      write((next) => {
        if (!next.properties[key]) {
          return false;
        }
        /* The pointer form is `#/content/<type>` — the same one `settings/defs-editor.ts` writes,
           so a reference authored here and one authored in Data Shapes are the same value. */
        next.properties[key] = { $ref: `#/content/${value}` };
        return true;
      });
    },
    setType(key, value) {
      write((next) => {
        const property = next.properties[key];
        if (!property) {
          return false;
        }
        const format = takesFormat(value) ? detectFieldFormat(property) : undefined;
        next.properties[key] = schemaForType(value, format || undefined);
        return true;
      });
    },
  });

  redraw();

  return {
    dispose: () => surface.dispose(),
    update(next) {
      latest = next;
      /* The host has spoken: what it says the value is wins over what this control last committed,
         and any control that had parted from it is put back. */
      committed = null;
      ui.echo = null;
      redraw();
    },
  };
}

/**
 * The schema-builder as the registry holds it — a MOUNT, because it is a Jx document
 * (`src/surfaces/schema-builder.json`) and a document needs a host of its own rather than a
 * template slot. Named rather than written inline at the registration below so a test can drive the
 * control the way the engine does, without the registry growing a second public lookup for it.
 */
export const schemaBuilderControl: SchemaFormMountedControl = { mount: mountSchemaBuilder };

registerFormControl("schema-builder", schemaBuilderControl);

// ─── Secret control ──────────────────────────────────────────────────────────

/**
 * The env-var name a field currently points at, or `null` when it points at nothing.
 *
 * The field persists a NAME — the value itself went to the platform's secret store — so a non-empty
 * string here is the whole of what a screen may say about the secret.
 */
function envNameOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * Mount the secret field into the host the form drew for it.
 *
 * Secret VALUES commit through the host's secret store (`ctx.commitSecret` → the platform's
 * `setSecrets`), never project.json; the field itself persists only the derived env-var NAME that
 * call answers with. A host with no secrets surface leaves the control disabled, because there is
 * nowhere for what the reader types to go.
 *
 * **The field is emptied the moment the value leaves it, not when the commit lands.** The commit is
 * asynchronous and the clear is not, so ordering them the other way round would leave the
 * credential on screen for the length of a platform round trip — and would leave it there for good
 * if the call refused. This way a failure costs the reader their typing, which is the direction a
 * mistake in a secret field should fail in.
 *
 * @param {HTMLElement} host - The field's `[part="control-host"]`
 * @param {SchemaFormControlArgs} args - The value, the context and the commit hook
 * @returns {SchemaFormControlHandle}
 */
function mountSecret(host: HTMLElement, args: SchemaFormControlArgs): SchemaFormControlHandle {
  let latest = args;

  const redraw = (): void => {
    const envName = envNameOf(latest.value);
    surface.update({
      disabled: !latest.ctx.commitSecret,
      /* The FIELD's key, exactly as the row above shows it: `surfaces/schema-form.json` draws a
         `jx-field` whose visible label is the raw property name, and the kit names a slotted
         control from that label — but this control is mounted into a plain host, which a label
         cannot point at. So the control carries the accessible name itself, and it is the same
         string a sighted reader sees rather than a prettier one (WCAG 2.5.3). */
      label: latest.key,
      placeholder: envName ? `Stored as ${envName}` : "Not set",
    });
  };

  const surface = mountSecretFieldSurface(host, {
    commit(value) {
      const { commitSecret } = latest.ctx;
      if (!commitSecret || !value) {
        return;
      }
      surface.clear();
      const { key, onChange } = latest;
      const envName = envNameOf(latest.value);
      void Promise.resolve(commitSecret(key, value)).then((name) => {
        /* A name equal to the one the field already holds is not an edit: the same secret was
           rotated in place, the store answered with the same env var, and a patch would rewrite
           project.json with the bytes it already has. */
        if (typeof name === "string" && name && name !== envName) {
          onChange(name);
        }
      });
    },
  });

  redraw();

  return {
    dispose: () => surface.dispose(),
    update(next) {
      latest = next;
      redraw();
    },
  };
}

/**
 * The secret control as the registry holds it. Named rather than written inline at the registration
 * below so a test can drive it the way the engine does, without the registry growing a second
 * public lookup for it.
 */
export const secretControl: SchemaFormMountedControl = { mount: mountSecret };

registerFormControl("secret", secretControl);

// ─── Reference control ───────────────────────────────────────────────────────

/**
 * An entry of another content collection — site-architecture.md §6.1's `{ "$ref": "#/content/x" }`
 * and §7.4's "entry picker (dropdown of collection entries)".
 *
 * **Registered once, consulted by everything.** `ui/schema-form.ts` dispatches to it for any
 * property whose `$ref` names a collection, so the settings forms, the entry editor and the
 * frontmatter card all draw the same picker without any of them knowing it exists. That is the
 * whole point: P5 collapsed six value-source vocabularies into one and three call sites still spoke
 * their own, so this one arrives as a registration rather than as a fourth renderer.
 *
 * Three states, and none of them lies:
 *
 * - **loading** — a disabled picker saying so, replaced when the read lands. The control redraws
 *   ITSELF when that happens now: it used to need the host's `rerender`, and the frontmatter
 *   renderer passes none, so lit's `until` was standing in for a second frame the control could not
 *   ask for;
 * - **failed** — the current value stays EDITABLE as text, with the reason and a Retry beside it.
 *   Swapping a failed read for an empty dropdown would present "no entries" and "could not find
 *   out" as the same screen, which is §16.1's complaint in miniature;
 * - **ready** — the entries, plus the current value even when it is not among them, marked `— not
 *   found`. A dangling reference is a fact about the project and the author has to see it; silently
 *   blanking the field would delete the evidence and the value in one repaint.
 */

/** Entry ids per collection, as the in-flight read. Started on first ask. */
const entryIdCache = new Map<string, Promise<string[]>>();

/**
 * What the read ENDED as, per collection.
 *
 * Kept beside the promise so a settled collection is answered without waiting. Without it every
 * repaint of the enclosing form would go back to a promise, and a picker that has had its answer
 * for ten minutes would flash "Loading…" on every keystroke in the field beside it.
 */
const entryIdResult = new Map<string, { ids: string[] } | { error: string }>();

/**
 * Who is waiting for a collection's read to land, by collection. Emptied when it does.
 *
 * A SET rather than a flag, and the difference is a field that never finishes loading. It was one
 * boolean per collection — "a settle handler is already attached" — so the first control to ask got
 * the answer and every later one was told nothing at all. That was survivable while the only asker
 * was a lit template (`until` held a promise of its own) or a whole panel repainting on the first
 * control's behalf; with three independently mounted documents on one collection, the second and
 * third would sit on "Loading…" for the life of the pane. Repeated asks from one waiter dedupe by
 * identity, and the set is dropped whole the moment the read settles, so it cannot grow past the
 * length of one listing.
 */
const entryIdWaiting = new Map<string, Set<() => void>>();

/**
 * Forget cached entry ids — for one collection, or all of them.
 *
 * Creating, renaming or deleting an entry changes the answer, and the picker would otherwise keep
 * offering a file that is gone until the window reloads. Called by `content/entry-commands.ts`
 * after a create; exported so the test harness can start from a known state.
 */
export function invalidateReferenceEntries(collection?: string): void {
  if (collection === undefined) {
    entryIdCache.clear();
    entryIdResult.clear();
    entryIdWaiting.clear();
  } else {
    entryIdCache.delete(collection);
    entryIdResult.delete(collection);
    entryIdWaiting.delete(collection);
  }
}

/** The collection's entry ids, reading them once however many fields reference it. */
function entryIdsFor(collection: string): Promise<string[]> {
  const known = entryIdCache.get(collection);
  if (known) {
    return known;
  }
  /* Dynamic: the collection reader pulls in the platform, the format registry and the workspace,
     and this module is imported for its side effects at startup and by the bare-Bun checks. A
     static import would make registering a form control cost the whole file layer. */
  const pending = import("../grid/sources/content-source").then((m) =>
    m.listCollectionEntryIds(collection),
  );
  entryIdCache.set(collection, pending);
  return pending;
}

/**
 * How listing a collection's entry ids ENDED, for a surface that draws its own picker.
 *
 * `null` means the read is still in flight, and `onSettled` is called when it lands — which is the
 * second frame a document has to be GIVEN, since nothing repaints it on the read's behalf.
 *
 * Exported because two surfaces draw the choices and neither is this control: the Document Header
 * card and the Navigator's Page panel project a `$ref` field as a picker row of their own
 * (`panels/frontmatter-fields.ts`), and what they need is not the widget but the answer behind it.
 * Taking it from here rather than calling `listCollectionEntryIds` directly is what keeps ONE cache
 * and ONE invalidation: a collection listed for the Document Header card is not listed again for
 * the entry editor, and {@link invalidateReferenceEntries} after an entry is created is still the
 * single event that forgets it.
 *
 * @param {string} collection
 * @param {() => void} [onSettled]
 * @returns {{ ids: string[] } | { error: string } | null}
 */
export function referenceEntryState(
  collection: string,
  onSettled?: () => void,
): { ids: string[] } | { error: string } | null {
  const done = entryIdResult.get(collection);
  if (done) {
    return done;
  }
  const pending = entryIdsFor(collection);
  const waiting = entryIdWaiting.get(collection);
  if (waiting) {
    if (onSettled) {
      waiting.add(onSettled);
    }
    return null;
  }
  entryIdWaiting.set(collection, new Set(onSettled ? [onSettled] : []));
  /**
   * Record how the read ended and tell everyone who asked — unless this is not the read anyone is
   * waiting for any more.
   *
   * A Retry invalidates the collection and starts a second read while the first is still in flight,
   * so without the identity check the loser writes its stale answer over the winner's and notifies
   * a set of waiters that belongs to the other read. An invalidated read settles into nothing,
   * which is what "forget this collection" has to mean.
   */
  const settle = (result: { ids: string[] } | { error: string }): void => {
    if (entryIdCache.get(collection) !== pending) {
      return;
    }
    const listeners = entryIdWaiting.get(collection);
    entryIdWaiting.delete(collection);
    entryIdResult.set(collection, result);
    for (const run of listeners ?? []) {
      run();
    }
  };
  void pending.then(
    (ids) => settle({ ids }),
    (error: unknown) => settle({ error: errorMessage(error) }),
  );
  return null;
}

/**
 * The view a reference field is drawn from, given what the flow knows right now.
 *
 * Every branch answers with a whole view rather than patching one, so the three states cannot leak
 * into each other: a picker that failed to list is a TEXT field, and a text field's `options` is
 * empty rather than stale.
 */
function referenceView(args: SchemaFormControlArgs, onSettled: () => void): ReferenceFieldView {
  const current = typeof args.value === "string" ? args.value : "";
  const base = {
    canRetry: false,
    disabled: false,
    hasNote: false,
    /* The row's own visible label, verbatim — see the secret control's note on why the control
       carries its accessible name rather than inheriting one from the field around it. */
    label: args.key,
    note: "",
    noteTone: "dim",
    options: [] as ReferenceChoice[],
    value: current,
  } satisfies Omit<ReferenceFieldView, "kind">;

  const collection = referenceTarget(args.schema);
  if (collection === null) {
    /* The control was named by a `ui.control` override on a property that references nothing. The
       field is still editable — refusing to draw it would lose the value — and the note says which
       half of the declaration is missing. */
    return {
      ...base,
      hasNote: true,
      kind: "text",
      note: 'No collection referenced — add "$ref": "#/content/<type>" to this field.',
    };
  }

  const state = referenceEntryState(collection, onSettled);
  if (state === null) {
    // Only the FIRST paint of a collection waits; a settled one is answered from the cache above.
    return {
      ...base,
      disabled: true,
      kind: "picker",
      options: [{ label: "Loading…", value: current }],
    };
  }
  if ("error" in state) {
    return {
      ...base,
      canRetry: true,
      hasNote: true,
      kind: "text",
      note: `Could not list ${collection} entries — ${state.error}`,
      noteTone: "danger",
    };
  }

  const dangling = current !== "" && !state.ids.includes(current);
  return {
    ...base,
    hasNote: state.ids.length === 0,
    kind: "picker",
    note: state.ids.length === 0 ? `No ${collection} entries yet.` : "",
    options: [
      { label: "—", value: "" },
      ...(dangling ? [{ label: `${current} — not found`, value: current }] : []),
      ...state.ids.map((id) => ({ label: id, value: id })),
    ],
  };
}

/**
 * Mount the reference picker into the host the form drew for it.
 *
 * @param {HTMLElement} host - The field's `[part="control-host"]`, or a row cell's own host
 * @param {SchemaFormControlArgs} args - The value, the schema and the commit hook
 * @returns {SchemaFormControlHandle}
 */
function mountReference(host: HTMLElement, args: SchemaFormControlArgs): SchemaFormControlHandle {
  let latest = args;
  let disposed = false;

  /* The read lands turns after the control asked for it, and the field may be gone by then — a
     cell whose row was removed, a form the pane took down. A redraw after that would update a scope
     nothing is mounted on. */
  const redraw = (): void => {
    if (!disposed) {
      surface.update(referenceView(latest, redraw));
    }
  };

  const surface = mountReferenceFieldSurface(host, {
    choose(value) {
      latest.onChange(value === "" ? undefined : value);
    },
    edit(value) {
      latest.onChange(value.trim() || undefined);
    },
    retry() {
      const collection = referenceTarget(latest.schema);
      if (collection !== null) {
        invalidateReferenceEntries(collection);
      }
      redraw();
    },
  });

  redraw();

  return {
    dispose() {
      disposed = true;
      surface.dispose();
    },
    update(next) {
      latest = next;
      redraw();
    },
  };
}

/**
 * The reference control as the registry holds it. Named rather than written inline at the
 * registration below so a test can drive it the way the engine does, without the registry growing a
 * second public lookup for it.
 */
export const referenceControl: SchemaFormMountedControl = { mount: mountReference };

registerFormControl("reference", referenceControl);

// Keep an explicit export so hosts can assert the built-ins module loaded
export const builtinFormControls = ["schema-builder", "secret", "reference"] as const;
