import "./with-dom.js";

import { describe, expect, mock, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isFunction, isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JxScope, JxScopeFunction } from "@jxsuite/runtime/types";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

import { resetSurfaceRegistry } from "../src/services/surface-registry";
import { SPECIMENS } from "../src/surfaces/specimens";
import { mountSurface, registerSurface } from "../src/ui/surface";
import type { SurfaceSpecimen } from "../src/surfaces/specimen";

const SURFACES_DIR = join(import.meta.dir, "../src/surfaces");

/**
 * The surfaces with no specimen yet (studio.md §4.6). On the canvas each still draws with no scope.
 *
 * This list only shrinks. A surface that gains a specimen leaves it, and the suite fails until it
 * does; a NEW surface ships with its specimen and is never added here, which is what
 * {@link BACKLOG_CEILING} holds.
 */
const SPECIMEN_BACKLOG = [
  "about",
  "add-new",
  "add-repo",
  "ai-chat",
  "ai-credentials-form",
  "ai-managed-connect",
  "block-action-bar",
  "boot-failure",
  "bottom-dock",
  "canvas-stage",
  "cf-account-picker",
  "collections-panel",
  "commandbar",
  "convert-repeater",
  "data-actions",
  "dialog",
  "diff-toolbar",
  "dynamic-tag",
  "empty-state",
  "entry-editor",
  "entry-inspector",
  "entry-preview",
  "expression-editor",
  "files-panel",
  "formula-palette",
  "github-auth",
  "github-publish",
  "grid-cell",
  "grid-open",
  "grid-panel",
  "grid-replace",
  "grid-views",
  "image-editor",
  "inspector-dock",
  "jump-bar",
  "jxsuite-update",
  "library-pane",
  "logic-panel",
  "logic-workspace",
  "media-browser",
  "media-field",
  "media-library",
  "media-pane",
  "media-pick-dialog",
  "navigator-dock",
  "new-project",
  "palette",
  "pane-context",
  "pane-grid",
  "panel-activity",
  "panel-deploy-checklist",
  "panel-elements",
  "panel-i18n",
  "panel-imports",
  "panel-outline",
  "panel-page",
  "panel-problems",
  "panel-signals",
  "panel-stylebook-layers",
  "preferences",
  "properties-panel",
  "publish",
  "publish-quick",
  "publish-workspace",
  "push-plan",
  "rail",
  "reference-field",
  "schema-builder",
  "schema-form",
  "secret-field",
  "seo",
  "settings-contexts",
  "settings-contributed",
  "settings-css-vars",
  "settings-defs",
  "settings-extensions",
  "settings-head",
  "settings-locales",
  "settings-overview",
  "settings-packages",
  "settings-pane",
  "settings-rawjson",
  "shell",
  "site-panel",
  "slash-menu",
  "statements",
  "stylebook-chrome",
  "styles-panel",
  "styles-variables",
  "tab-strip",
  "tag-strip",
  "target-line",
  "toasts",
  "welcome",
  "writing-banner",
];

/** The most {@link SPECIMEN_BACKLOG} may hold. Lower it with the list; never raise it. */
const BACKLOG_CEILING = 95;

/**
 * Scope members a surface document does not read, by surface, each with the reason the adapter
 * still carries it. The specimen is typed against the adapter's scope, so it carries them too.
 */
const UNREAD = new Map<string, readonly string[]>([
  // The flow's own word for the refusal; the document switches on `hasFailure`.
  ["ai-model-picker", ["failure"]],
]);

/**
 * Row fields a surface document does not read, each with the reason the projection carries it.
 * Keyed by the surface and the list's `items` pointer.
 */
const UNREAD_ROW_FIELDS = new Map<string, readonly string[]>([
  // `project()` derives it beside `dividerAbove`, which is the one the document switches on.
  ["menu #/state/rows", ["noDivider"]],
  // A submenu row is the same projection one level down, where a row holds no submenu of its own.
  ["menu $map/item/children", ["children", "haspopup", "noDivider", "submenuLabel"]],
  // What `run(key)` runs: the adapter looks the item up by its key and reads these two.
  ["statusbar $map/item/items", ["args", "command"]],
]);

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** The surface document of a name, read off disk as the canvas reads it. */
async function surfaceDoc(name: string): Promise<JxDocument> {
  /* SAFETY: every `src/surfaces/*.json` is a Jx document: the shell mounts each through the
     runtime, and `surfaces-a11y.test.ts` walks every one of them as a document. */
  return (await Bun.file(join(SURFACES_DIR, `${name}.json`)).json()) as JxDocument;
}

/** Every name with a file of the given suffix under `src/surfaces/`. */
function namesWith(suffix: string, except = ""): string[] {
  return readdirSync(SURFACES_DIR)
    .filter((file) => file.endsWith(suffix) && (except === "" || !file.endsWith(except)))
    .map((file) => file.slice(0, -suffix.length))
    .toSorted();
}

/** The specimens, loaded one at a time: overlapping imports lose a file's coverage record. */
async function loadAll(): Promise<[string, SurfaceSpecimen][]> {
  const all: [string, SurfaceSpecimen][] = [];
  for (const [name, entry] of SPECIMENS) {
    const module = await entry.load();
    all.push([name, module.specimen]);
  }
  return all;
}

/** A pointer or a template read, as the first segment under `state` and the rest. */
function stateReads(doc: JsonValue): Set<string> {
  // A `$description` is prose about the document and may name a file such as `state.ts`.
  const text = JSON.stringify(doc, (key, value: JsonValue) =>
    key === "$description" ? undefined : value,
  );
  const reads = new Set<string>();
  for (const match of text.matchAll(/#\/state\/([A-Za-z0-9_]+)/gu)) {
    reads.add(match[1]!);
  }
  for (const match of text.matchAll(/\bstate\.([A-Za-z0-9_]+)/gu)) {
    reads.add(match[1]!);
  }
  return reads;
}

/** The value a `#/state/a/b` or `$map/item/a` pointer names, read off its root. */
function follow(root: JsonValue | JxScope | undefined, segments: string[]): JsonValue | undefined {
  let at: unknown = root;
  for (const segment of segments) {
    if (!isJsonObject(at)) {
      return undefined;
    }
    at = at[segment];
  }
  /* SAFETY: a specimen's rows are plain data by its type (`JxHostScope`), read here only to list
     their keys. */
  return at as JsonValue | undefined;
}

interface ListRead {
  /** The list's `items` pointer, as written. */
  items: string;
  /** The row fields its template reads, down to the next list. */
  fields: Set<string>;
  /** The first row of the list in the specimen's scope, or undefined for an empty one. */
  row: JsonValue | undefined;
}

/** The row fields a template subtree reads, stopping at the lists nested in it. */
function rowFieldsOf(node: JsonValue, into: Set<string>, nested: JsonValue[]): void {
  if (isString(node)) {
    for (const match of node.matchAll(/\$map\.item\.([A-Za-z0-9_]+)/gu)) {
      into.add(match[1]!);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const member of node) {
      rowFieldsOf(member, into, nested);
    }
    return;
  }
  if (!isJsonObject(node)) {
    return;
  }
  if (node.$prototype === "Array") {
    nested.push(node);
    return;
  }
  if (isString(node.$ref) && node.$ref.startsWith("$map/item/")) {
    into.add(node.$ref.split("/")[2]!);
  }
  for (const value of Object.values(node)) {
    rowFieldsOf(value, into, nested);
  }
}

/** Every list a document draws, with what its template reads and a row of the specimen's. */
function listsOf(node: JsonValue, scope: JxScope, rows: JsonValue[]): ListRead[] {
  if (Array.isArray(node)) {
    return node.flatMap((member) => listsOf(member, scope, rows));
  }
  if (!isJsonObject(node)) {
    return [];
  }
  if (node.$prototype !== "Array") {
    return Object.values(node).flatMap((value) => listsOf(value, scope, rows));
  }
  const pointer = isJsonObject(node.items) && isString(node.items.$ref) ? node.items.$ref : "";
  /* A list under `state` is the scope's; one under a row is read off the first row of the list
     around it that has any, so a submenu only the fourth row carries is still checked. */
  const candidates = pointer.startsWith("#/state/")
    ? [follow(scope, pointer.slice("#/state/".length).split("/"))]
    : rows.map((row) => follow(row, pointer.slice("$map/item/".length).split("/")));
  const list = candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0);
  const own = Array.isArray(list) ? list : [];
  const fields = new Set<string>();
  const nested: JsonValue[] = [];
  rowFieldsOf(node.key ?? null, fields, nested);
  rowFieldsOf(node.map ?? null, fields, nested);
  // A list nested in the template reads the row field its own `items` names.
  for (const inner of nested) {
    rowFieldsOf(isJsonObject(inner) ? (inner.items ?? null) : null, fields, []);
  }
  return [
    { fields, items: pointer, row: own[0] },
    ...nested.flatMap((inner) => listsOf(inner, scope, own)),
  ];
}

/**
 * The controls held to a name. A `role="none"` button is the picker glyph inside a `jx-select`,
 * which the `select` around it names.
 */
const NAMED_CONTROLS = 'button:not([role="none"]), [role="menuitem"]';

/** The text a reader or a screen reader is given for a control. */
function accessibleName(el: Element): string {
  return [
    el.textContent,
    el.getAttribute("aria-label"),
    el.getAttribute("title"),
    el.getAttribute("label"),
  ]
    .map((part) => (part ?? "").trim())
    .join("");
}

describe("the specimen table", () => {
  test("lists each module's variants, and none is called default", async () => {
    for (const [name, specimen] of await loadAll()) {
      expect([...specimen.variants], name).toEqual([...(SPECIMENS.get(name)?.variants ?? [])]);
      expect(specimen.variants.includes("default"), name).toBe(false);
    }
  });

  test("is the directory's specimens, and the surfaces without one are the backlog", () => {
    const surfaces = namesWith(".json");
    const specimens = namesWith(".specimen.ts");
    expect([...SPECIMENS.keys()].toSorted()).toEqual(specimens);
    expect(specimens.filter((name) => !surfaces.includes(name))).toEqual([]);
    expect(surfaces.filter((name) => !specimens.includes(name))).toEqual(SPECIMEN_BACKLOG);
    expect(SPECIMEN_BACKLOG.length).toBeLessThanOrEqual(BACKLOG_CEILING);
  });
});

describe("a specimen's scope is what its surface reads", () => {
  test("every state the document reads is supplied, and every member supplied is read", async () => {
    for (const [name, specimen] of await loadAll()) {
      /* SAFETY: a surface document is JSON read off disk. */
      const doc = (await surfaceDoc(name)) as JsonValue;
      const reads = stateReads(doc);
      for (const variant of [null, ...specimen.variants]) {
        const { scope } = specimen.make(variant);
        const supplied = new Set(Object.keys(scope));
        expect(
          [...reads].filter((key) => !supplied.has(key)),
          `${name} (${variant ?? "default"}) reads state its specimen does not supply`,
        ).toEqual([]);
        expect(
          [...supplied].filter((key) => !reads.has(key)).toSorted(),
          `${name} (${variant ?? "default"}) supplies members its document never reads`,
        ).toEqual([...(UNREAD.get(name) ?? [])].toSorted());
      }
    }
  });

  test("every row field a list's template reads is a field of the specimen's rows", async () => {
    for (const [name, specimen] of await loadAll()) {
      /* SAFETY: as above. */
      const doc = (await surfaceDoc(name)) as JsonValue;
      for (const list of listsOf(doc, specimen.make().scope, [])) {
        if (!isJsonObject(list.row)) {
          continue;
        }
        const has = new Set(Object.keys(list.row));
        expect(
          [...list.fields].filter((field) => !has.has(field)),
          `${name}: ${list.items} reads row fields its specimen's rows lack`,
        ).toEqual([]);
        expect(
          [...has].filter((field) => !list.fields.has(field)).toSorted(),
          `${name}: ${list.items} rows carry fields the template never reads`,
        ).toEqual([...(UNREAD_ROW_FIELDS.get(`${name} ${list.items}`) ?? [])].toSorted());
      }
    }
  });
});

describe("a specimen mounts as the shell mounts its surface", () => {
  test("it draws text and named controls, and every function it offers is reached", async () => {
    for (const [name, specimen] of await loadAll()) {
      resetSurfaceRegistry();
      registerSurface(name, await surfaceDoc(name));
      const reached = new Map<string, number>();
      for (const variant of [null, ...specimen.variants]) {
        const label = `${name} (${variant ?? "default"})`;
        const instance = specimen.make(variant);
        const spies = new Map<string, ReturnType<typeof mock>>();
        for (const [key, value] of Object.entries(instance.scope)) {
          if (isFunction(value)) {
            /* SAFETY: a scope function is called by the runtime with whatever the document's
               handler passes; the spy forwards those arguments unchanged. */
            const spy = mock(value as (...args: never[]) => void);
            spies.set(key, spy);
            /* SAFETY: the spy has the signature of the function it wraps, which the scope held. */
            instance.scope[key] = spy as JxScopeFunction;
          }
        }
        const host = document.createElement("div");
        document.body.append(host);
        const handle = await mountSurface(name, instance.scope, host);
        await tick();

        const text = host.textContent;
        expect(text, label).not.toMatch(/\$\{|❪|undefined|\[object Object\]/u);
        for (const control of host.querySelectorAll(NAMED_CONTROLS)) {
          expect(accessibleName(control), `${label}: a control with no name`).not.toBe("");
        }

        if (handle.root instanceof HTMLElement) {
          await instance.drive(handle.root);
        }
        await tick();
        for (const [key, spy] of spies) {
          reached.set(key, (reached.get(key) ?? 0) + spy.mock.calls.length);
        }
        handle.dispose();
        expect(host.childElementCount, label).toBe(0);
        host.remove();
      }
      expect(
        [...reached].flatMap(([key, calls]) => (calls === 0 ? [key] : [])),
        `${name}: functions no variant's drive reaches through the surface`,
      ).toEqual([]);
    }
  });
});
