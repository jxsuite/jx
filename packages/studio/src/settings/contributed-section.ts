/// <reference lib="dom" />
/**
 * Contributed settings section — the generic renderer behind `$studio.settings`
 * (specs/extensions.md §9.1). An extension's `project` class declares a settings section and this
 * module renders it over `projectConfig[key]`: layout "form" is one schema form over the whole
 * section value; layout "map" is master-detail (key list left, entry form right) for `type: object`
 * + `additionalProperties` sections. Persistence mirrors the content-types editor: mutate
 * projectState.projectConfig and rewrite project.json through the platform.
 *
 * **The markup left.** The section is the `settings-contributed` surface
 * (`surfaces/settings-contributed.json`), mounted by `surfaces/settings-contributed.ts`; what is
 * here is the section itself — what an entry may be named, what reaches `project.json`, and what
 * the validator said about it. `renderContributedSection` is unchanged as a contract: the registry
 * hands a container to a `render`, and this one mounts a document into it instead of rendering
 * lit.
 *
 * **Two islands, and both are somebody else's surface.** The form is drawn from a JSON Schema by
 * `ui/schema-form.ts`, and the actions row (Test Connection, Push Schema, Open Data Grid) is
 * contributed by `panels/data-grid.ts`. The document renders a host node for each and nothing
 * inside it, announced through `onNodeCreated` (specs/studio-ui-guidelines.md §9.4), and this
 * module fills them. That is what made the two convert one at a time, and the schema form has since
 * gone: it is a document of its own now, so {@link paintForm} PLACES its host element instead of
 * rendering a template into the node — the seam did not move, exactly as designed. The actions row
 * is still lit.
 *
 * Two things the conversion settled, and each was a defect rather than a translation:
 *
 * - **A refused rename snaps back because the scope moves, not because a handler writes to an
 *   input.** The lit version assigned `target.value = selected` from inside the change handler. A
 *   document's binding writes only when the scope value CHANGES, and after a refusal the scope
 *   still holds the key on disk — so {@link say} states what the control now holds first, and the
 *   correction that follows is a real move.
 * - **The new-entry name lives in this module rather than in the DOM.** It always did for `Create`,
 *   but the field itself was uncontrolled, so a redraw arriving mid-typing (an extension
 *   registering, a validator returning) put the field back to empty while the module still held the
 *   text. It is one value now, and the field shows it.
 */

import { nothing, render as litRender } from "lit-html";
import { errorMessage } from "@jxsuite/schema/parse";
import { getPlatform } from "../platform";
import { commitProjectConfig } from "../tabs/project-config";
import { projectState } from "../store";
import { mountSchemaForm } from "../ui/schema-form";
import { resolveContextPointer } from "../services/context-resolver";
import { deriveSecretEnvName } from "../services/data-service";
import { validateProjectConfig } from "../services/jx-validate";
import { notify } from "../services/notify";
import { paneRegion } from "../ui/regions";
import { paneOfContainer } from "../canvas/canvas-surface";
import { mountContributedSurface } from "../surfaces/settings-contributed";

import type { TemplateResult } from "lit-html";
import type { JsonSchema, SchemaFormContext } from "../ui/schema-form";
import type { ProjectConfig } from "@jxsuite/schema/types";
import type {
  ContributedActions,
  ContributedSurfaceHandle,
  ContributedView,
} from "../surfaces/settings-contributed";

// ─── Contribution shape ───────────────────────────────────────────────────────

/** A `$studio.settings` contribution paired with the entry schema from the project fragment. */
export interface SettingsContribution {
  /** The project.json top-level property the section owns. */
  key: string;
  /** Section heading; falls back to the key. */
  title?: string | undefined;
  /** The `$studio.settings` block from the class descriptor. */
  settings: {
    layout?: "map" | "form" | undefined;
    entry?:
      | {
          ui?: Record<string, { control?: string; enum?: unknown }> | undefined;
          newEntry?: Record<string, unknown> | undefined;
        }
      | undefined;
  };
  /** JSON Schema for one entry (map layout) or the whole section value (form layout). */
  entrySchema: JsonSchema;
}

/** Context handed to a host-provided section actions renderer. */
export interface SectionActionsContext {
  sectionKey: string;
  /** The selected entry key (map layout), or null. */
  selected: string | null;
  rerender: () => void;
}

/** Host options threaded to the schema-form context. */
export interface ContributedSectionOptions {
  /** Registered formats backing the `$formats` virtual root. */
  formats?: { name: string }[] | undefined;
  /**
   * Optional actions row rendered under the section title — the hook domain modules use to surface
   * section-scoped operations (e.g. the data surface's Test/Push actions) without the generic
   * renderer knowing any extension.
   */
  actions?: ((ctx: SectionActionsContext) => TemplateResult) | undefined;
}

// ─── Module state ─────────────────────────────────────────────────────────────

/**
 * Selected entry key per SECTION (map layout), and the two halves of the new-entry form beside it.
 *
 * Per section rather than per container, unlike `settings/defs-editor.ts`, and the reason is a
 * contract rather than an oversight: {@link selectContributedEntry} is the `settings.open {section,
 * entry}` command's writer and addresses an entry by its section key alone. A per- container
 * selection would have nothing for that command to write into.
 */
const selectedEntries = new Map<string, string | null>();
/** Sections whose new-entry form is open (map layout). */
const newEntryOpen = new Set<string>();
/** Pending new-entry names per section (map layout). */
const newEntryNames = new Map<string, string>();

/** Reset contributed-section ephemeral UI state (test hook). */
export function resetContributedSectionState(): void {
  selectedEntries.clear();
  newEntryOpen.clear();
  newEntryNames.clear();
}

/**
 * Select an entry of a map-layout section by key — the addressable form of clicking an entry row.
 *
 * Five screenshot steps used to reach these rows by typing an empty string into a hand-stamped
 * region id, carrying `unstable: { reason: "\"settings.selectEntry\" has no command record", until:
 * "P6.2" }`. This is P6.2 and the record is `settings.open {section, entry}`: an entry is a KEY in
 * the section's own map, so naming it is naming state rather than reproducing a gesture.
 *
 * @param {string} sectionKey
 * @param {string} entryKey
 * @returns {string[] | null} `null` once selected; the section's actual entry keys when it has no
 *   such entry, so the caller's refusal can name both sides.
 */
export function selectContributedEntry(sectionKey: string, entryKey: string): string[] | null {
  const section = (projectState?.projectConfig as Record<string, unknown> | null | undefined)?.[
    sectionKey
  ];
  const entries =
    section && typeof section === "object" && !Array.isArray(section)
      ? (section as Record<string, unknown>)
      : {};
  if (!Object.hasOwn(entries, entryKey)) {
    return Object.keys(entries);
  }
  selectedEntries.set(sectionKey, entryKey);
  return null;
}

// ─── Validation (§7.1 inline tier, §7.2 Problems) ─────────────────────────────

/**
 * The last validator run's messages, keyed by the JSON-pointer base they were rendered under.
 *
 * `jx-validate` validates the WHOLE `project.json` against the project's generated entry document,
 * so its output has to be routed back to individual controls. Until now it was wired to exactly one
 * caller — the AI's `write_project_config` — which meant the model's edits to this file were
 * schema-checked and a human's edits through this very form were not.
 */
const diagnostics = new Map<string, Record<string, string>>();

/** Drop every cached diagnostic (test hook, and the "project closed" path). */
export function resetContributedDiagnostics(): void {
  diagnostics.clear();
}

/**
 * Route `jx-validate` messages ("/search/index: must be string") to the field they are about.
 *
 * Only the messages one level under `base` become field errors: `/search/index` belongs to the
 * `index` control, and `/search/index/0/kind` belongs to it too — the deepest control that exists
 * on this form is the one that can be corrected. A message ABOUT the base itself has no field to
 * live at and is returned separately, for the section line.
 *
 * @param {string} base - JSON pointer of the record the form is editing, e.g. `/search`
 * @param {string[]} messages
 * @returns
 */
export function routeDiagnostics(
  base: string,
  messages: string[],
): { fields: Record<string, string>; section: string[] } {
  const fields: Record<string, string> = {};
  const section: string[] = [];
  for (const message of messages) {
    const at = message.indexOf(": ");
    const pointer = at === -1 ? "" : message.slice(0, at);
    const text = at === -1 ? message : message.slice(at + 2);
    if (pointer === base) {
      section.push(text);
      continue;
    }
    if (!pointer.startsWith(`${base}/`)) {
      continue;
    }
    const [prop] = pointer.slice(base.length + 1).split("/");
    if (prop && fields[prop] === undefined) {
      fields[prop] = text;
    }
  }
  return { fields, section };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/**
 * Commit `project.json`, then say what is wrong with it.
 *
 * The write itself now belongs to `tabs/project-config.ts` — one serialisation, one error path, and
 * a transaction the author can undo. This module used to own a second writer, at
 * `JSON.stringify(config, null, "\t")`, which re-indented the whole file on any edit; and before
 * that it was `void saveProjectConfig()` at five call sites with no validation at all. §7.2 files a
 * failed config write as a Problem, because it must be fixed and it is about a named file; the
 * chokepoint files it, so a failure here only has to stop.
 *
 * **The write comes first, and the order is the honest one.** This form mutates
 * `projectState.projectConfig` in place before calling here, so the value is already live in the
 * editor and the canvas; a validator run in front of the write could not have prevented anything,
 * it would only have delayed persisting what the user can already see. This surface REPORTS. The
 * one that gates is `contexts-section.ts`, which builds a candidate map and validates it before
 * anything is applied.
 *
 * @param {string} base - JSON pointer of the record being edited, for routing field errors
 * @param {() => void} rerender
 */
async function saveProjectConfig(base: string, rerender: () => void) {
  const config = (projectState as { projectConfig: ProjectConfig }).projectConfig;

  const commit = await commitProjectConfig();
  if (!commit.ok) {
    return;
  }

  let messages: string[] = [];
  try {
    messages = await validateProjectConfig(config);
  } catch (error) {
    /* A validator that will not compile must not be silent about it — but it is not the edit's
       fault, so it is a problem of its own rather than an error parked on the user's field. */
    notify.warn(`Could not validate project.json — ${errorMessage(error)}`, {
      key: "settings:validator",
      path: "project.json",
      source: "Settings",
      tier: "problem",
    });
    return;
  }
  diagnostics.set(base, routeDiagnostics(base, messages).fields);
  rerender();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Apply a schema-form patch onto a record in place; `undefined` values unset the key. */
function applyPatch(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete target[key];
    } else {
      target[key] = value;
    }
  }
}

/** Slugify a user-entered entry name — same rules as new content-type names. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^a-z0-9-]/g, "");
}

/** Instantiate a newEntry template, substituting `${key}` in every string value. */
function instantiateNewEntry(
  template: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> {
  if (!template) {
    return {};
  }
  const substitute = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.replaceAll("${key}", key);
    }
    if (Array.isArray(value)) {
      return value.map((item) => substitute(item));
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = substitute(v);
      }
      return out;
    }
    return value;
  };
  return substitute(template) as Record<string, unknown>;
}

/**
 * Schema-form context resolving `#/$context/…` pointers over the live project config. When the
 * platform has a secrets surface, `commitSecret` backs the "secret" control: the VALUE goes to
 * platform.setSecrets under a derived env name; the returned NAME is what lands in project.json.
 */
function buildContext(
  sectionKey: string,
  opts: ContributedSectionOptions,
  entryKey: string | null = null,
): SchemaFormContext {
  const platform = getPlatform();
  return {
    fieldKeyPrefix: `$settings.${sectionKey}`,
    resolvePointer: (pointer, scope) =>
      resolveContextPointer(pointer, {
        projectConfig: (projectState?.projectConfig ?? {}) as Record<string, unknown>,
        ...(scope !== undefined && { scope }),
        ...(opts.formats !== undefined && { formats: opts.formats }),
      }),
    ...(typeof platform.setSecrets === "function"
      ? {
          commitSecret: async (key: string, value: string) => {
            const envName = deriveSecretEnvName(sectionKey, entryKey, key);
            await platform.setSecrets!({ set: { [envName]: value } });
            return envName;
          },
        }
      : {}),
  };
}

/** The section's value object in the project config, created on demand. */
function sectionValue(key: string): Record<string, unknown> | null {
  const config = projectState?.projectConfig as Record<string, unknown> | null | undefined;
  if (!config) {
    return null;
  }
  const existing = config[key];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const fresh: Record<string, unknown> = {};
  config[key] = fresh;
  return fresh;
}

// ─── Per-container mount ──────────────────────────────────────────────────────

/* There is no `paneOfContainer` here. It moved to `canvas/canvas-surface.ts`, beside the other
   "which pane is this about" answers, because it is not a settings idea: any stage content handed
   only a host needs it, and `settings/general-settings.ts` and `settings/project-sections.ts` are
   two more that do — both write a canvas mode, and both used to write the FOCUSED pane's. */

/** One mounted section: its document, its two island hosts, and what it was last asked to draw. */
interface SectionMount {
  /** The element the registry handed the renderer, and this record's identity. */
  container: HTMLElement;
  handle: ContributedSurfaceHandle;
  contribution: SettingsContribution;
  opts: ContributedSectionOptions;
  /** Where the schema form goes, once the document has made one. */
  formHost: HTMLElement | null;
  /** Where the host's actions row goes, once the document has made one. */
  actionsHost: HTMLElement | null;
  /**
   * What the rename field holds while a rename is being decided, or `null`.
   *
   * One at a time is the whole truth of it: a `change` commits one control and the decision about
   * it is synchronous, so there is never a second control in flight. See {@link say}.
   */
  echo: string | null;
}

const mounts = new WeakMap<HTMLElement, SectionMount>();

/** Draw the section again from what the store and this module now say. */
function redraw(record: SectionMount): void {
  renderContributedSection(record.container, record.contribution, record.opts);
}

/**
 * Say what the rename field now holds, before anything is decided about it.
 *
 * This is what `live()` did for the lit template. A document's binding writes only when the SCOPE
 * value changes, and after a refusal the scope still holds the key on disk — so without this
 * nothing is written back and the refused text stays in the field.
 */
function say(record: SectionMount, value: string): void {
  record.echo = value;
  redraw(record);
}

// ─── Projection ───────────────────────────────────────────────────────────────

/** What the document draws right now, read from the store and this module's own state. */
function project(record: SectionMount): ContributedView {
  const { container, contribution, opts } = record;
  const sectionKey = contribution.key;
  const title = contribution.title ?? sectionKey;
  const actionsState = opts.actions ? "slot" : "none";
  const paneId = paneOfContainer(container);
  const editorRegion = paneRegion(paneId, "editor");

  if ((contribution.settings.layout ?? "form") !== "map") {
    return {
      actionsState,
      editorRegion,
      editorState: "empty",
      entries: [],
      entryName: "",
      layout: "form",
      newName: "",
      newState: "closed",
      title,
    };
  }

  const entries = sectionValue(sectionKey) ?? {};
  const selected = selectedEntries.get(sectionKey) ?? null;
  const value = selected === null ? undefined : entries[selected];
  const editing =
    selected !== null && value !== undefined && value !== null && typeof value === "object";
  return {
    actionsState,
    editorRegion,
    editorState: editing ? "editing" : "empty",
    entries: Object.keys(entries).map((name) => ({
      key: name,
      region: paneRegion(paneId, `entry:${name}`),
      selected: name === selected,
    })),
    entryName: record.echo ?? (editing ? selected : ""),
    layout: "map",
    newName: newEntryNames.get(sectionKey) ?? "",
    newState: newEntryOpen.has(sectionKey) ? "open" : "closed",
    title,
  };
}

// ─── The two islands ──────────────────────────────────────────────────────────

/**
 * Put the schema form into the node the document made for it.
 *
 * `ui/schema-form.ts` is a document too now, and a document CLEARS the host it is given — so what
 * arrives here is the form's own host element rather than a template, and this function's whole job
 * is to place it. Calling `mountSchemaForm` again with the same key updates the standing form in
 * place, which is what keeps the caret in a field across the repaint a commit provokes; a key that
 * stops being asked for is swept when its host leaves the page.
 */
function paintForm(record: SectionMount): void {
  const host = record.formHost;
  if (!host) {
    return;
  }
  const { contribution, opts } = record;
  const sectionKey = contribution.key;
  const ui = contribution.settings.entry?.ui;
  const rerender = () => redraw(record);

  const place = (form: HTMLElement) => {
    if (form.parentNode !== host) {
      host.replaceChildren(form);
    }
  };

  if ((contribution.settings.layout ?? "form") !== "map") {
    const base = `/${sectionKey}`;
    place(
      mountSchemaForm(
        `section:${sectionKey}`,
        contribution.entrySchema,
        sectionValue(sectionKey) ?? {},
        {
          context: buildContext(sectionKey, opts, null),
          errors: diagnostics.get(base) ?? {},
          onChange: (patch) => {
            const target = sectionValue(sectionKey);
            if (!target) {
              return;
            }
            applyPatch(target, patch);
            rerender();
            void saveProjectConfig(base, rerender);
          },
          rerender,
          ...(ui !== undefined && { ui }),
        },
      ),
    );
    return;
  }

  const entries = sectionValue(sectionKey) ?? {};
  const selected = selectedEntries.get(sectionKey) ?? null;
  const value = selected === null ? undefined : entries[selected];
  if (selected === null || !value || typeof value !== "object") {
    host.replaceChildren();
    return;
  }
  const entry = value as Record<string, unknown>;
  const base = `/${sectionKey}/${selected}`;
  place(
    mountSchemaForm(`section:${sectionKey}:${selected}`, contribution.entrySchema, entry, {
      context: buildContext(sectionKey, opts, selected),
      errors: diagnostics.get(base) ?? {},
      onChange: (patch) => {
        applyPatch(entry, patch);
        rerender();
        void saveProjectConfig(base, rerender);
      },
      rerender,
      ...(ui !== undefined && { ui }),
    }),
  );
}

/** Draw the host's actions row into the node the document made for it. */
function paintActions(record: SectionMount): void {
  const host = record.actionsHost;
  const { actions } = record.opts;
  if (!host) {
    return;
  }
  if (!actions) {
    litRender(nothing, host);
    return;
  }
  const sectionKey = record.contribution.key;
  const selected =
    (record.contribution.settings.layout ?? "form") === "map"
      ? (selectedEntries.get(sectionKey) ?? null)
      : null;
  litRender(actions({ rerender: () => redraw(record), sectionKey, selected }), host);
}

// ─── What the reader can do ───────────────────────────────────────────────────

/**
 * The handlers the document calls. Each reads the container's record at call time rather than
 * closing over a contribution: the registry may hand the same container a fresh contribution when
 * an extension re-registers, and a handler that had captured the old one would write to the wrong
 * section.
 */
function actionsFor(record: SectionMount): ContributedActions {
  /** A write went through: forget the echo, redraw from the file, and commit it. */
  const done = (base: string): void => {
    record.echo = null;
    redraw(record);
    void saveProjectConfig(base, () => redraw(record));
  };
  /** The write was refused: forget the echo, so the field shows the file again. */
  const refuse = (): void => {
    record.echo = null;
    redraw(record);
  };
  /** The section this record is currently drawing. Read per call, never captured. */
  const keyOf = (): string => record.contribution.key;

  return {
    cancelNew() {
      newEntryOpen.delete(keyOf());
      newEntryNames.delete(keyOf());
      redraw(record);
    },
    cancelRename(held) {
      /* The held value comes in because the scope may already agree with the file: nothing was
         committed, so `entryName` still says what is on disk, and a redraw alone would be an equal
         write the binding skips — leaving the abandoned text in the field. Saying what the control
         holds first makes the snap-back a real move. */
      say(record, held);
      refuse();
    },
    createNew() {
      const sectionKey = keyOf();
      const slug = slugify(newEntryNames.get(sectionKey) ?? "");
      const target = sectionValue(sectionKey);
      if (!slug || !target || target[slug]) {
        return;
      }
      target[slug] = instantiateNewEntry(record.contribution.settings.entry?.newEntry, slug);
      selectedEntries.set(sectionKey, slug);
      newEntryOpen.delete(sectionKey);
      newEntryNames.delete(sectionKey);
      done(`/${sectionKey}`);
    },
    editNew(value) {
      newEntryNames.set(keyOf(), value);
      redraw(record);
    },
    openNew() {
      newEntryOpen.add(keyOf());
      redraw(record);
    },
    removeEntry() {
      const sectionKey = keyOf();
      const selected = selectedEntries.get(sectionKey) ?? null;
      const target = sectionValue(sectionKey);
      if (!selected || !target?.[selected]) {
        return;
      }
      delete target[selected];
      selectedEntries.set(sectionKey, null);
      done(`/${sectionKey}`);
    },
    renameEntry(value) {
      say(record, value);
      const sectionKey = keyOf();
      const selected = selectedEntries.get(sectionKey) ?? null;
      const target = sectionValue(sectionKey);
      const slug = slugify(value.trim());
      if (!selected || !target || !slug || slug === selected || target[slug]) {
        refuse();
        return;
      }
      // Rebuild the map to preserve entry order under the new key
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(target)) {
        next[k === selected ? slug : k] = v;
        delete target[k];
      }
      Object.assign(target, next);
      selectedEntries.set(sectionKey, slug);
      done(`/${sectionKey}`);
    },
    select(name) {
      selectedEntries.set(keyOf(), name);
      record.echo = null;
      redraw(record);
    },
  };
}

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * Render a contributed settings section into the settings document's content area.
 *
 * @param {HTMLElement} container
 * @param {SettingsContribution} contribution
 * @param {ContributedSectionOptions} [opts]
 */
export function renderContributedSection(
  container: HTMLElement,
  contribution: SettingsContribution,
  opts: ContributedSectionOptions = {},
) {
  let record = mounts.get(container);
  if (record) {
    record.contribution = contribution;
    record.opts = opts;
  }
  if (!record?.handle.attached()) {
    record?.handle.dispose();
    const fresh: SectionMount = {
      actionsHost: null,
      container,
      contribution,
      echo: null,
      formHost: null,
      handle: undefined as unknown as ContributedSurfaceHandle,
      opts,
    };
    mounts.set(container, fresh);
    fresh.handle = mountContributedSurface(container, actionsFor(fresh), {
      actionsSlot: (host) => {
        fresh.actionsHost = host;
        paintActions(fresh);
      },
      formSlot: (host) => {
        fresh.formHost = host;
        paintForm(fresh);
      },
    });
    record = fresh;
  }
  record.handle.update(project(record));
  paintActions(record);
  paintForm(record);
}
